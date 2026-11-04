/**
 * 待办截止 / 日提醒：接上 buildTaskReminderFireAt，完成/终态取消。
 * 与入格 schedule-slot-reminder 分通道；旧前缀 selfapp-task-reminder: 仅清理兼容。
 */

import { isFrogAssignedOn } from '@/lib/frog-assignment';
import { buildNotificationIdentifier } from '@/lib/notification-catalog';
import { getNotificationCenterSettings } from '@/lib/notification-center-settings';
import {
  cancelScheduledByIdentifier,
  cancelScheduledByPrefixes,
  isLocalNotificationSchedulingUnavailable,
  scheduleDateRemindersBulk,
  type ScheduleDateReminderParams,
} from '@/lib/notification-scheduler';
import {
  dueDateFromScheduleMeta,
  parseScheduleMetaFromExtra,
} from '@/lib/schedule/meta';
import { getTasks, getTasksByIds } from '@/lib/repositories/tasks/task';
import {
  isTaskActiveStatus,
  type TaskRow,
} from '@/lib/repositories/tasks/task.types';
import {
  resolveTaskDeadlineReminderFireAt,
  resolveTaskDeadlineReminderIntensity,
  shouldSuppressTaskDeadlineReminder,
} from '@/lib/task-reminder-schedule';
import {
  getLogicalLocalYmd,
  loadTasksDayBoundary,
} from '@/lib/tasks-logical-day';

const ANDROID_CHANNEL = {
  id: 'task-deadline-reminders',
  name: '待办截止提醒',
  importance: 'default' as const,
  vibrationPattern: [0, 220, 140, 220],
};

/** 历史截止日前缀（不再登记，仅清理） */
const LEGACY_TASK_PREFIX = 'selfapp-task-reminder:';
const DEADLINE_PREFIX = 'selfapp-task-deadline-reminder:';

export function taskDeadlineReminderIdentifier(taskId: string): string {
  return (
    buildNotificationIdentifier('task-deadline-reminder', taskId) ??
    `${DEADLINE_PREFIX}${taskId}`
  );
}

export async function cancelScheduledTaskDeadlineReminder(taskId: string): Promise<void> {
  if (isLocalNotificationSchedulingUnavailable()) return;
  const key = taskId.trim();
  if (!key) return;
  try {
    await cancelScheduledByIdentifier(taskDeadlineReminderIdentifier(key));
  } catch (e) {
    console.warn('取消待办截止提醒失败', key, e);
  }
}

/** 前台送达前：已完成 / 搁置 / 取消则抑制展示。 */
export async function shouldSuppressTaskDeadlineReminderNotification(
  taskId: string,
): Promise<boolean> {
  const key = taskId.trim();
  if (!key) return false;
  try {
    const rows = await getTasksByIds([key]);
    const task = rows[0];
    if (!task) return true;
    return shouldSuppressTaskDeadlineReminder(task.status);
  } catch (e) {
    console.warn('判断待办截止提醒抑制失败', key, e);
    return false;
  }
}

export async function cancelAllTaskDeadlineReminders(): Promise<void> {
  if (isLocalNotificationSchedulingUnavailable()) return;
  try {
    await cancelScheduledByPrefixes([DEADLINE_PREFIX, LEGACY_TASK_PREFIX]);
  } catch (e) {
    console.warn('取消全部待办截止提醒失败', e);
  }
}

function buildDeadlineItem(params: {
  task: TaskRow;
  todayYmd: string;
  now: Date;
  dueSoonWindowDays: number;
  overdueStickyEnabled: boolean;
}): ScheduleDateReminderParams | null {
  const { task, todayYmd, now } = params;
  if (shouldSuppressTaskDeadlineReminder(task.status)) return null;
  if (!isTaskActiveStatus(task.status)) return null;

  const schedule = parseScheduleMetaFromExtra(task.extra_data);
  const dueYmd = dueDateFromScheduleMeta(schedule, task.due_date);
  if (!dueYmd) return null;

  const resolved = resolveTaskDeadlineReminderFireAt({
    dueYmd,
    schedule,
    todayYmd,
    now,
    dueSoonWindowDays: params.dueSoonWindowDays,
    enableAutoDueSoon: true,
    enableOverdueSticky: params.overdueStickyEnabled,
  });
  if (!resolved) return null;
  const { fireAt, kind } = resolved;

  const title = task.title?.trim() || '待办';
  const intensity = resolveTaskDeadlineReminderIntensity({
    priority: task.priority,
    isFrogToday: isFrogAssignedOn(task.extra_data, todayYmd),
  });
  const strong = intensity === 'strong';
  const id = taskDeadlineReminderIdentifier(task.id);
  const opt = (schedule?.reminderOption ?? '').trim() || kind;
  const fingerprint = `${task.id}|${title}|${dueYmd}|${fireAt.toISOString().slice(0, 16)}|${opt}|${kind}|${intensity}`;

  const notifTitle =
    kind === 'overdue_sticky'
      ? strong
        ? '今日滞留 · 重点'
        : '今日滞留'
      : strong
        ? '该做 · 重点待办'
        : '该做';

  return {
    category: 'task-deadline-reminder',
    identifier: id,
    fireAt,
    channel: ANDROID_CHANNEL,
    data: {
      type: 'task-deadline-reminder',
      taskId: task.id,
      dueYmd,
      intensity,
      kind,
    },
    fallback: {
      title: notifTitle,
      body: title,
    },
    fingerprint,
    strong,
    contextBlock: [
      '【频道】待办截止提醒',
      `【标题】${title}`,
      `【截止】${dueYmd}`,
      `【策略】${opt}`,
      `【种类】${kind}`,
      `【强度】${intensity}`,
    ].join('\n'),
  };
}

/** 收集可预约的截止提醒（不登记）。 */
export async function collectTaskDeadlineReminderParams(opts?: {
  tasks?: TaskRow[];
  todayYmd?: string;
  now?: Date;
  dueSoonWindowDays?: number;
  overdueStickyEnabled?: boolean;
}): Promise<ScheduleDateReminderParams[]> {
  const now = opts?.now ?? new Date();
  const boundary = await loadTasksDayBoundary();
  const todayYmd = opts?.todayYmd ?? getLogicalLocalYmd(now, boundary);
  const settings = await getNotificationCenterSettings();
  const dueSoonWindowDays = opts?.dueSoonWindowDays ?? settings.schedule.dueSoonWindowDays;
  const overdueStickyEnabled =
    opts?.overdueStickyEnabled ?? settings.schedule.overdueStickyEnabled !== false;
  const tasks = opts?.tasks ?? (await getTasks());
  const items: ScheduleDateReminderParams[] = [];
  for (const task of tasks) {
    const item = buildDeadlineItem({
      task,
      todayYmd,
      now,
      dueSoonWindowDays,
      overdueStickyEnabled,
    });
    if (item) items.push(item);
  }
  return items;
}

/**
 * 按当前活跃待办重新登记截止/日提醒。
 * 先清本前缀 + 历史 selfapp-task-reminder:，再 bulk 登记。
 */
export async function syncTaskDeadlineReminderNotifications(): Promise<void> {
  if (isLocalNotificationSchedulingUnavailable()) return;

  console.time('syncTaskDeadlineReminderNotifications');
  try {
    await cancelAllTaskDeadlineReminders();

    const settings = await getNotificationCenterSettings();
    if (!settings.masterEnabled || settings.categories['task-deadline-reminder'] === false) {
      return;
    }

    const items = await collectTaskDeadlineReminderParams();
    if (items.length === 0) return;
    await scheduleDateRemindersBulk(items, { skipCancel: true });
  } finally {
    console.timeEnd('syncTaskDeadlineReminderNotifications');
  }
}

/** 单条待办保存 / 完成 / 状态变更后刷新其截止提醒。 */
export async function resyncTaskDeadlineReminderForTaskId(taskId: string): Promise<void> {
  if (isLocalNotificationSchedulingUnavailable()) return;
  const key = taskId.trim();
  if (!key) return;

  await cancelScheduledTaskDeadlineReminder(key);

  const settings = await getNotificationCenterSettings();
  if (!settings.masterEnabled || settings.categories['task-deadline-reminder'] === false) {
    return;
  }

  const rows = await getTasksByIds([key]);
  const task = rows[0];
  if (!task) return;

  const now = new Date();
  const boundary = await loadTasksDayBoundary();
  const todayYmd = getLogicalLocalYmd(now, boundary);
  const item = buildDeadlineItem({
    task,
    todayYmd,
    now,
    dueSoonWindowDays: settings.schedule.dueSoonWindowDays,
    overdueStickyEnabled: settings.schedule.overdueStickyEnabled !== false,
  });
  if (!item) return;

  await scheduleDateRemindersBulk([item], { skipCancel: true });
}

export async function listTaskDeadlineReminderBusinessItems(): Promise<
  {
    identifier: string;
    title: string;
    body: string;
    taskId: string;
    fireAt: Date | null;
    customizeHref: string;
  }[]
> {
  const settings = await getNotificationCenterSettings();
  if (!settings.masterEnabled || settings.categories['task-deadline-reminder'] === false) {
    return [];
  }
  const items = await collectTaskDeadlineReminderParams();
  const now = Date.now();
  return items
    .filter(i => i.fireAt.getTime() > now)
    .map(i => ({
      identifier: i.identifier,
      title: i.fallback.title,
      body: i.fallback.body,
      taskId: String(i.data.taskId ?? ''),
      fireAt: i.fireAt,
      customizeHref: `/edit-task?id=${encodeURIComponent(String(i.data.taskId ?? ''))}`,
    }));
}
