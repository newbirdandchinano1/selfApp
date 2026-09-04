import type { TaskRow } from '@/lib/repositories/tasks/task.types';
import {
  buildTaskReminderFireAt,
  isTaskReminderConfigured,
  parseTaskReminderAdvanceDays,
} from '@/lib/task-reminder-schedule';
import { canScheduleAppNotification } from '@/lib/notification-center-settings';
import { isExpoSandboxNotificationDisabled } from '@/lib/notification-policy';
import { Platform } from 'react-native';

const NOTIFICATION_PREFIX = 'selfapp-task-reminder:';
const ANDROID_CHANNEL_ID = 'task-reminders';

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
 * 根据当前任务列表重新登记本地通知：未完成、有截止日且用户配置了提醒（当天或提前）的任务各最多一条。
 */
export async function syncScheduledTaskReminders(tasks: TaskRow[]): Promise<void> {
  if (Platform.OS === 'web' || isExpoSandboxNotificationDisabled()) return;

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

  const now = Date.now();
  const SchedulableTriggerInputTypes = Notifications.SchedulableTriggerInputTypes;

  for (const task of tasks) {
    if (task.status === 'done' || task.status === 'cancelled' || task.status === 'shelved') continue;

    const extra = parseTaskExtra(task.extra_data);
    const reminderOpt = resolveReminderOption(extra);
    if (!isTaskReminderConfigured(reminderOpt, extra.reminder)) {
      continue;
    }

    const advance = parseTaskReminderAdvanceDays(reminderOpt);
    const ymd = getAnchorYmd(task, extra.schedule);
    if (!ymd) continue;

    const fireAt = buildTaskReminderFireAt(ymd, advance, extra.schedule);
    if (!fireAt || Number.isNaN(fireAt.getTime())) continue;
    if (fireAt.getTime() <= now + 2000) continue;

    const id = `${NOTIFICATION_PREFIX}${task.id}`;
    if (!(await canScheduleAppNotification({ category: 'task-reminder', identifier: id }))) {
      continue;
    }

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
