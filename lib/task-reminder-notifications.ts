import type { TaskRow } from '@/lib/repositories/tasks/task.types';
import { isTaskRepeatDueOnLogicalDay, parseTaskRepeatSchedule } from '@/lib/task-repeat-rollover';
import { getLogicalLocalYmd, loadTasksDayBoundary } from '@/lib/tasks-logical-day';
import { Platform } from 'react-native';

const NOTIFICATION_PREFIX = 'selfapp-task-reminder:';
const ANDROID_CHANNEL_ID = 'task-reminders';
/** 仅日期、全天或未勾选具体时刻时的默认提醒时刻（本地） */
const DEFAULT_EVENT_HOUR = 9;
const DEFAULT_EVENT_MINUTE = 0;

type TaskExtraSchedule = {
  mode?: 'date' | 'time';
  allDay?: boolean;
  hasExactTime?: boolean;
  reminderOption?: string;
  date?: string;
  range?: { start?: string; end?: string };
  startTime?: string;
};

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
      schedule: schedule && typeof schedule === 'object' && !Array.isArray(schedule) ? (schedule as TaskExtraSchedule) : null,
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

function parseAdvanceDays(reminderOption: string): number {
  const t = reminderOption.trim();
  if (!t || t === '不提前') return 0;
  const m = /^提前(\d+)天$/.exec(t);
  if (m) return Math.min(30, Math.max(0, parseInt(m[1], 10) || 0));
  return 0;
}

function resolveReminderOption(extra: ReturnType<typeof parseTaskExtra>): string {
  const fromSchedule = extra.schedule?.reminderOption?.trim();
  if (fromSchedule) return fromSchedule;
  const fromReminder = extra.reminder?.trim();
  if (fromReminder) return fromReminder;
  return '不提前';
}

function buildEventLocalDate(ymd: string, schedule: TaskExtraSchedule | null | undefined): Date {
  const [y, mo, d] = ymd.split('-').map((x) => parseInt(x, 10));
  const base = new Date(y, mo - 1, d);
  const allDay = schedule?.allDay === true;
  const hasExact = schedule?.hasExactTime === true && typeof schedule?.startTime === 'string' && schedule.startTime.length > 0;
  if (!allDay && hasExact) {
    const t = new Date(schedule!.startTime as string);
    if (!Number.isNaN(t.getTime())) {
      base.setHours(t.getHours(), t.getMinutes(), t.getSeconds(), t.getMilliseconds());
      return base;
    }
  }
  base.setHours(DEFAULT_EVENT_HOUR, DEFAULT_EVENT_MINUTE, 0, 0);
  return base;
}

function subtractLocalDays(date: Date, days: number): Date {
  const next = new Date(date.getTime());
  next.setDate(next.getDate() - days);
  return next;
}

async function ensureAndroidChannel() {
  if (Platform.OS !== 'android') return;
  const Notifications = await import('expo-notifications');
  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    name: '待办提醒',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });
}

async function cancelAllTaskReminderNotifications() {
  const Notifications = await import('expo-notifications');
  const pending = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    pending
      .filter((r) => typeof r.identifier === 'string' && r.identifier.startsWith(NOTIFICATION_PREFIX))
      .map((r) => Notifications.cancelScheduledNotificationAsync(r.identifier)),
  );
}

/**
 * 根据当前任务列表重新登记本地通知：未完成且有截止信息的任务在「提前 N 天 / 不提前」规则下各最多一条。
 */
export async function syncScheduledTaskReminders(tasks: TaskRow[]): Promise<void> {
  if (Platform.OS === 'web') return;

  let Notifications: typeof import('expo-notifications');
  try {
    Notifications = await import('expo-notifications');
  } catch (e) {
    console.warn('expo-notifications 不可用', e);
    return;
  }

  await cancelAllTaskReminderNotifications();

  const perm = await Notifications.getPermissionsAsync();
  let granted = perm.status === 'granted';
  if (!granted && perm.canAskAgain !== false) {
    const req = await Notifications.requestPermissionsAsync();
    granted = req.status === 'granted';
  }
  if (!granted) {
    return;
  }

  await ensureAndroidChannel();

  const boundary = await loadTasksDayBoundary();
  const logicalTodayYmd = getLogicalLocalYmd(new Date(), boundary);
  const now = Date.now();
  const SchedulableTriggerInputTypes = Notifications.SchedulableTriggerInputTypes;

  for (const task of tasks) {
    if (task.status === 'done' || task.status === 'cancelled') continue;

    const extra = parseTaskExtra(task.extra_data);
    const reminderOpt = resolveReminderOption(extra);
    const advance = parseAdvanceDays(reminderOpt);
    let ymd = getAnchorYmd(task, extra.schedule);
    if (!ymd) {
      const repeat = parseTaskRepeatSchedule(task.extra_data);
      if (repeat && isTaskRepeatDueOnLogicalDay(logicalTodayYmd, repeat)) {
        ymd = logicalTodayYmd;
      }
    }
    if (!ymd) continue;

    let eventAt: Date;
    try {
      eventAt = buildEventLocalDate(ymd, extra.schedule);
    } catch {
      continue;
    }
    if (Number.isNaN(eventAt.getTime())) continue;

    const fireAt = subtractLocalDays(eventAt, advance);
    if (fireAt.getTime() <= now + 2000) continue;

    const id = `${NOTIFICATION_PREFIX}${task.id}`;
    const title = '待办提醒';
    const body = task.title?.trim() || '待办';

    try {
      await Notifications.scheduleNotificationAsync({
        identifier: id,
        content: {
          title,
          body,
          sound: true,
          data: { type: 'task-reminder', taskId: task.id },
        },
        trigger: {
          type: SchedulableTriggerInputTypes.DATE,
          date: fireAt,
          channelId: Platform.OS === 'android' ? ANDROID_CHANNEL_ID : undefined,
        },
      });
    } catch (e) {
      console.warn('登记待办提醒失败', task.id, e);
    }
  }
}
