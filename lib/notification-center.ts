import {
  extractEntityIdFromIdentifier,
  getNotificationCategoryMeta,
  resolveNotificationCategoryFromIdentifier,
  type NotificationCategoryId,
} from '@/lib/notification-catalog';
import {
  canScheduleAppNotification,
  getNotificationCenterSettings,
  muteNotificationIdentifier,
  unmuteNotificationIdentifier,
  type NotificationCenterSettings,
} from '@/lib/notification-center-settings';
import {
  formatDailyReviewReminderClock,
  getDailyReviewReminderSettings,
} from '@/lib/daily-review-reminder-settings';
import { syncDailyReviewReminderNotification } from '@/lib/daily-review-reminder-notifications';
import { cancelScheduledHabitReminder, resyncAllHabitReminders } from '@/lib/habit-reminder-notifications';
import { isExpoSandboxNotificationDisabled } from '@/lib/notification-policy';
import { getHabits } from '@/lib/repositories/habits/habit';
import {
  formatHabitReminderClock,
  parseHabitReminder,
} from '@/lib/repositories/habits/habit-reminder-meta';
import { getTasks } from '@/lib/repositories/tasks/task';
import type { TaskRow } from '@/lib/repositories/tasks/task.types';
import {
  buildTaskReminderFireAt,
  isTaskReminderConfigured,
  parseTaskReminderAdvanceDays,
} from '@/lib/task-reminder-schedule';
import { syncScheduledTaskReminders } from '@/lib/task-reminder-notifications';
import { Linking, Platform } from 'react-native';

export type NotificationPermissionSnapshot = {
  status: 'granted' | 'denied' | 'undetermined' | 'unavailable';
  canAskAgain: boolean;
  sandboxDisabled: boolean;
};

export type ManagedNotificationStatus =
  | 'active'
  | 'muted'
  | 'blocked'
  | 'not_registered';

export type ScheduledAppNotificationItem = {
  identifier: string;
  title: string;
  body: string;
  category: NotificationCategoryId | null;
  sourceLabel: string;
  customizeHref: string | null;
  entityId: string | null;
  /** 触发时刻 ISO；即时/未知则为 null */
  fireAtIso: string | null;
  fireAtLabel: string;
  /** 相对系统队列 / 偏好的状态 */
  status: ManagedNotificationStatus;
  statusLabel: string;
};

type TaskExtraSchedule = {
  mode?: 'date' | 'time';
  allDay?: boolean;
  hasExactTime?: boolean;
  reminderOption?: string;
  reminderHour?: number;
  reminderMinute?: number;
  date?: string;
  range?: { start?: string; end?: string };
  startTime?: string;
};

function formatFireAtLabel(date: Date | null): string {
  if (!date || Number.isNaN(date.getTime())) return '时间待定';
  return date.toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function triggerToDate(trigger: unknown): Date | null {
  if (!trigger || typeof trigger !== 'object') return null;
  const t = trigger as Record<string, unknown>;
  if (typeof t.value === 'number' && Number.isFinite(t.value)) {
    const ms = t.value < 1e12 ? t.value * 1000 : t.value;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof t.date === 'number' && Number.isFinite(t.date)) {
    const ms = t.date < 1e12 ? t.date * 1000 : t.date;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof t.date === 'string') {
    const d = new Date(t.date);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (t.type === 'daily' || t.type === 'calendar') {
    const hour = typeof t.hour === 'number' ? t.hour : null;
    const minute = typeof t.minute === 'number' ? t.minute : null;
    if (hour != null && minute != null) {
      const now = new Date();
      const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0, 0);
      if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
      return next;
    }
  }
  return null;
}

function parseTaskExtra(raw: string | null): {
  reminder?: string;
  schedule?: TaskExtraSchedule | null;
} {
  if (!raw) return {};
  try {
    const p = JSON.parse(raw) as Record<string, unknown>;
    if (!p || typeof p !== 'object' || Array.isArray(p)) return {};
    const schedule = p.schedule;
    return {
      reminder: typeof p.reminder === 'string' ? p.reminder : undefined,
      schedule:
        schedule && typeof schedule === 'object' && !Array.isArray(schedule)
          ? (schedule as TaskExtraSchedule)
          : null,
    };
  } catch {
    return {};
  }
}

function extractYmd(value: string | null | undefined): string | null {
  if (!value) return null;
  const m = value.trim().match(/(\d{4}-\d{2}-\d{2})/);
  return m?.[1] ?? null;
}

function getAnchorYmd(task: TaskRow, schedule: TaskExtraSchedule | null | undefined): string | null {
  if (schedule?.mode === 'time' && schedule.range?.end) return extractYmd(schedule.range.end);
  if (schedule?.date) return extractYmd(schedule.date);
  return extractYmd(task.due_date);
}

function resolveReminderOption(extra: ReturnType<typeof parseTaskExtra>): string {
  const fromSchedule = extra.schedule?.reminderOption?.trim();
  if (fromSchedule) return fromSchedule;
  const fromReminder = extra.reminder?.trim();
  if (fromReminder) {
    if (fromReminder === '当天' || fromReminder.startsWith('当天 ')) return '当天';
    const m = /^(提前\d+天)/.exec(fromReminder);
    if (m) return m[1];
  }
  return '不提前';
}

function resolveItemStatus(params: {
  identifier: string;
  category: NotificationCategoryId;
  settings: NotificationCenterSettings;
  osIdentifiers: Set<string>;
  sandboxDisabled: boolean;
}): { status: ManagedNotificationStatus; statusLabel: string } {
  if (params.settings.mutedIdentifiers.includes(params.identifier)) {
    return { status: 'muted', statusLabel: '已在本页关闭' };
  }
  if (!params.settings.masterEnabled) {
    return { status: 'blocked', statusLabel: '总开关已关' };
  }
  if (params.settings.categories[params.category] === false) {
    return { status: 'blocked', statusLabel: '频道已关' };
  }
  if (params.sandboxDisabled) {
    return { status: 'not_registered', statusLabel: 'Expo Go 未登记系统队列' };
  }
  if (Platform.OS === 'web') {
    return { status: 'not_registered', statusLabel: 'Web 不支持本地推送' };
  }
  if (params.osIdentifiers.has(params.identifier)) {
    return { status: 'active', statusLabel: '已登记系统预约' };
  }
  return { status: 'not_registered', statusLabel: '尚未写入系统队列' };
}

async function readOsScheduledMap(): Promise<Map<string, Date | null>> {
  const map = new Map<string, Date | null>();
  if (Platform.OS === 'web' || isExpoSandboxNotificationDisabled()) return map;
  try {
    const Notifications = await import('expo-notifications');
    const pending = await Notifications.getAllScheduledNotificationsAsync();
    for (const req of pending) {
      const id = typeof req.identifier === 'string' ? req.identifier : '';
      if (!id) continue;
      map.set(id, triggerToDate(req.trigger));
    }
  } catch {
    /* ignore */
  }
  return map;
}

export async function getNotificationPermissionSnapshot(): Promise<NotificationPermissionSnapshot> {
  if (Platform.OS === 'web') {
    return { status: 'unavailable', canAskAgain: false, sandboxDisabled: false };
  }
  if (isExpoSandboxNotificationDisabled()) {
    return { status: 'unavailable', canAskAgain: false, sandboxDisabled: true };
  }
  try {
    const Notifications = await import('expo-notifications');
    const perm = await Notifications.getPermissionsAsync();
    const status =
      perm.status === 'granted'
        ? 'granted'
        : perm.status === 'denied'
          ? 'denied'
          : 'undetermined';
    return {
      status,
      canAskAgain: perm.canAskAgain !== false,
      sandboxDisabled: false,
    };
  } catch {
    return { status: 'unavailable', canAskAgain: false, sandboxDisabled: false };
  }
}

export async function requestAppNotificationPermission(): Promise<NotificationPermissionSnapshot> {
  if (Platform.OS === 'web' || isExpoSandboxNotificationDisabled()) {
    return getNotificationPermissionSnapshot();
  }
  try {
    const Notifications = await import('expo-notifications');
    await Notifications.requestPermissionsAsync();
  } catch (e) {
    console.warn('请求通知权限失败', e);
  }
  return getNotificationPermissionSnapshot();
}

export async function openSystemNotificationSettings(): Promise<void> {
  try {
    await Linking.openSettings();
  } catch (e) {
    console.warn('打开系统设置失败', e);
  }
}

/**
 * 列出各功能中「已开启」的提醒（待办 / 习惯 / 日复盘），并标注是否已写入系统预约队列。
 * 不只依赖 getAllScheduledNotificationsAsync：Expo Go 或尚未 sync 时业务侧仍可见。
 */
export async function listScheduledAppNotifications(): Promise<ScheduledAppNotificationItem[]> {
  const [settings, osMap, habits, tasks, dailySettings] = await Promise.all([
    getNotificationCenterSettings(),
    readOsScheduledMap(),
    getHabits().catch(() => []),
    getTasks().catch(() => []),
    getDailyReviewReminderSettings().catch(() => null),
  ]);

  const osIdentifiers = new Set(osMap.keys());
  const sandboxDisabled = isExpoSandboxNotificationDisabled();
  const items: ScheduledAppNotificationItem[] = [];

  for (const habit of habits) {
    const reminder = parseHabitReminder(habit.extra_data);
    if (!reminder.enabled) continue;
    const identifier = `selfapp-habit-reminder:${habit.id}`;
    const meta = getNotificationCategoryMeta('habit-reminder');
    const clock =
      formatHabitReminderClock(reminder) ?? `${pad2(reminder.hour)}:${pad2(reminder.minute)}`;
    const osFire = osMap.get(identifier) ?? null;
    const { status, statusLabel } = resolveItemStatus({
      identifier,
      category: 'habit-reminder',
      settings,
      osIdentifiers,
      sandboxDisabled,
    });
    items.push({
      identifier,
      title: meta.title,
      body: `${habit.name?.trim() || '习惯'} · 每日 ${clock}`,
      category: 'habit-reminder',
      sourceLabel: meta.sourceLabel,
      customizeHref: `/habit-detail?habitId=${encodeURIComponent(habit.id)}`,
      entityId: habit.id,
      fireAtIso: osFire ? osFire.toISOString() : null,
      fireAtLabel: osFire ? formatFireAtLabel(osFire) : `每日 ${clock}`,
      status,
      statusLabel,
    });
  }

  for (const task of tasks) {
    if (task.status === 'done' || task.status === 'cancelled' || task.status === 'shelved') continue;
    const extra = parseTaskExtra(task.extra_data);
    const reminderOpt = resolveReminderOption(extra);
    if (!isTaskReminderConfigured(reminderOpt, extra.reminder)) continue;

    const identifier = `selfapp-task-reminder:${task.id}`;
    const meta = getNotificationCategoryMeta('task-reminder');
    const advance = parseTaskReminderAdvanceDays(reminderOpt);
    const ymd = getAnchorYmd(task, extra.schedule);
    const computedFire = ymd ? buildTaskReminderFireAt(ymd, advance, extra.schedule) : null;
    const osFire = osMap.get(identifier) ?? null;
    const fireAt = osFire ?? computedFire;
    const { status, statusLabel } = resolveItemStatus({
      identifier,
      category: 'task-reminder',
      settings,
      osIdentifiers,
      sandboxDisabled,
    });
    items.push({
      identifier,
      title: meta.title,
      body: task.title?.trim() || '待办',
      category: 'task-reminder',
      sourceLabel: meta.sourceLabel,
      customizeHref: `/edit-task?id=${encodeURIComponent(task.id)}`,
      entityId: task.id,
      fireAtIso: fireAt && !Number.isNaN(fireAt.getTime()) ? fireAt.toISOString() : null,
      fireAtLabel: fireAt ? formatFireAtLabel(fireAt) : `提醒：${reminderOpt}`,
      status,
      statusLabel,
    });
  }

  if (dailySettings?.enabled) {
    const identifier = 'selfapp-daily-review-reminder';
    const meta = getNotificationCategoryMeta('daily-review-reminder');
    const clock = formatDailyReviewReminderClock(dailySettings.hour, dailySettings.minute);
    const osFire = osMap.get(identifier) ?? null;
    const { status, statusLabel } = resolveItemStatus({
      identifier,
      category: 'daily-review-reminder',
      settings,
      osIdentifiers,
      sandboxDisabled,
    });
    items.push({
      identifier,
      title: meta.title,
      body: `每日 ${clock} · 记得完成今日复盘`,
      category: 'daily-review-reminder',
      sourceLabel: meta.sourceLabel,
      customizeHref: meta.customizeHref,
      entityId: null,
      fireAtIso: osFire ? osFire.toISOString() : null,
      fireAtLabel: osFire ? formatFireAtLabel(osFire) : `每日 ${clock}`,
      status,
      statusLabel,
    });
  }

  // 兜底：系统队列里有、但业务侧未扫到的其它预约
  for (const [identifier, fireAt] of osMap) {
    if (items.some(i => i.identifier === identifier)) continue;
    const category = resolveNotificationCategoryFromIdentifier(identifier);
    const meta = category ? getNotificationCategoryMeta(category) : null;
    const entityId = category ? extractEntityIdFromIdentifier(category, identifier) : null;
    items.push({
      identifier,
      title: meta?.title ?? '系统预约通知',
      body: '',
      category,
      sourceLabel: meta?.sourceLabel ?? '未知来源',
      customizeHref: meta?.customizeHref ?? null,
      entityId,
      fireAtIso: fireAt ? fireAt.toISOString() : null,
      fireAtLabel: formatFireAtLabel(fireAt),
      status: 'active',
      statusLabel: '已登记系统预约',
    });
  }

  items.sort((a, b) => {
    const rank = (s: ManagedNotificationStatus) =>
      s === 'active' ? 0 : s === 'not_registered' ? 1 : s === 'muted' ? 2 : 3;
    const rd = rank(a.status) - rank(b.status);
    if (rd !== 0) return rd;
    const ta = a.fireAtIso ? Date.parse(a.fireAtIso) : Number.POSITIVE_INFINITY;
    const tb = b.fireAtIso ? Date.parse(b.fireAtIso) : Number.POSITIVE_INFINITY;
    return ta - tb;
  });

  return items;
}

/** 取消一条预约通知，并加入静音列表，避免同步立刻重新登记。 */
export async function deleteScheduledAppNotification(identifier: string): Promise<void> {
  const id = identifier.trim();
  if (!id) return;

  await muteNotificationIdentifier(id);

  if (Platform.OS === 'web') return;
  try {
    const Notifications = await import('expo-notifications');
    await Notifications.cancelScheduledNotificationAsync(id);
  } catch (e) {
    console.warn('取消预约通知失败', id, e);
  }

  const category = resolveNotificationCategoryFromIdentifier(id);
  if (category === 'habit-reminder') {
    const habitId = extractEntityIdFromIdentifier(category, id);
    if (habitId) await cancelScheduledHabitReminder(habitId);
  }
}

/** 重新允许某条标识登记（从静音列表移除并触发对应同步）。 */
export async function restoreMutedAppNotification(identifier: string): Promise<void> {
  const id = identifier.trim();
  if (!id) return;
  await unmuteNotificationIdentifier(id);
  await resyncAppNotificationsAfterPreferenceChange();
}

export async function cancelAllScheduledAppNotifications(): Promise<void> {
  if (Platform.OS === 'web' || isExpoSandboxNotificationDisabled()) return;
  try {
    const Notifications = await import('expo-notifications');
    await Notifications.cancelAllScheduledNotificationsAsync();
  } catch (e) {
    console.warn('取消全部预约通知失败', e);
  }
}

/**
 * 偏好变更后：必要时清空预约，并按当前任务/习惯/复盘设置重新登记。
 */
export async function resyncAppNotificationsAfterPreferenceChange(
  settings?: NotificationCenterSettings,
): Promise<void> {
  if (Platform.OS === 'web' || isExpoSandboxNotificationDisabled()) return;

  const resolved = settings ?? (await getNotificationCenterSettings());

  if (!resolved.masterEnabled) {
    await cancelAllScheduledAppNotifications();
    return;
  }

  if (!resolved.categories['task-reminder']) {
    try {
      const Notifications = await import('expo-notifications');
      const pending = await Notifications.getAllScheduledNotificationsAsync();
      await Promise.all(
        pending
          .filter(
            r =>
              typeof r.identifier === 'string' &&
              r.identifier.startsWith('selfapp-task-reminder:'),
          )
          .map(r => Notifications.cancelScheduledNotificationAsync(r.identifier)),
      );
    } catch {
      /* ignore */
    }
  } else {
    try {
      const tasks = await getTasks();
      await syncScheduledTaskReminders(tasks);
    } catch (e) {
      console.warn('重同步待办提醒失败', e);
    }
  }

  if (!resolved.categories['habit-reminder']) {
    try {
      const Notifications = await import('expo-notifications');
      const pending = await Notifications.getAllScheduledNotificationsAsync();
      await Promise.all(
        pending
          .filter(
            r =>
              typeof r.identifier === 'string' &&
              r.identifier.startsWith('selfapp-habit-reminder:'),
          )
          .map(r => Notifications.cancelScheduledNotificationAsync(r.identifier)),
      );
    } catch {
      /* ignore */
    }
  } else {
    try {
      await resyncAllHabitReminders();
    } catch (e) {
      console.warn('重同步习惯提醒失败', e);
    }
  }

  if (!resolved.categories['daily-review-reminder']) {
    try {
      const Notifications = await import('expo-notifications');
      await Notifications.cancelScheduledNotificationAsync('selfapp-daily-review-reminder');
    } catch {
      /* ignore */
    }
  } else {
    try {
      await syncDailyReviewReminderNotification();
    } catch (e) {
      console.warn('重同步复盘提醒失败', e);
    }
  }
}

export { canScheduleAppNotification };
