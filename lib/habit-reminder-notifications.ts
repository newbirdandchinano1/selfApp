import { isHabitScheduledOnLogicalYmd } from '@/lib/habit-schedule';
import { getHabits, getHabitById } from '@/lib/repositories/habits/habit';
import {
  getAllHabitCheckInsMaps,
  getCheckInsMapByHabitId,
} from '@/lib/repositories/habits/habit-check-in';
import { isHabitDayGoalMet, parseHabitDailyGoal } from '@/lib/repositories/habits/habit-goal';
import { parseHabitKind, type HabitKind } from '@/lib/repositories/habits/habit-kind';
import { parseHabitReminder } from '@/lib/repositories/habits/habit-reminder-meta';
import { getLogicalLocalYmd, loadTasksDayBoundary } from '@/lib/tasks-logical-day';
import { canScheduleAppNotification } from '@/lib/notification-center-settings';
import { isExpoSandboxNotificationDisabled } from '@/lib/notification-policy';
import { Platform } from 'react-native';

const NOTIFICATION_PREFIX = 'selfapp-habit-reminder:';
const ANDROID_CHANNEL_ID = 'habit-reminders';
/** 向前扫描候选提醒日（覆盖每月定期等稀疏日程） */
const MAX_LOOKAHEAD_DAYS = 40;

function notificationIdentifier(habitId: string): string {
  return `${NOTIFICATION_PREFIX}${habitId}`;
}

async function ensureAndroidChannel() {
  if (Platform.OS !== 'android') return;
  const Notifications = await import('expo-notifications');
  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    name: '习惯打卡提醒',
    importance: Notifications.AndroidImportance.DEFAULT,
    vibrationPattern: [0, 200, 120, 200],
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });
}

/** 取消某习惯的本地提醒（删除习惯或关闭提醒时调用）。 */
export async function cancelScheduledHabitReminder(habitId: string): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    const Notifications = await import('expo-notifications');
    await Notifications.cancelScheduledNotificationAsync(notificationIdentifier(habitId));
  } catch (e) {
    console.warn('取消习惯提醒失败', habitId, e);
  }
}

/**
 * 当日是否已无需再提醒：
 * - 养成/任务：当日已达成目标
 * - 戒除：当日已标记（保持戒除或记录破戒）
 */
export function isHabitReminderSatisfiedForDay(params: {
  kind: HabitKind;
  todayCount: number;
  dailyGoal?: number | null;
  hasDayRecord: boolean;
}): boolean {
  if (params.kind === 'break') return params.hasDayRecord;
  return isHabitDayGoalMet({
    kind: params.kind,
    todayCount: params.todayCount,
    dailyGoal: params.dailyGoal,
    hasDayRecord: params.hasDayRecord,
  });
}

function buildFireAt(ymdParts: { y: number; m0: number; d: number }, hour: number, minute: number): Date {
  return new Date(ymdParts.y, ymdParts.m0, ymdParts.d, hour, minute, 0, 0);
}

async function findNextHabitReminderFireAt(params: {
  extraData: string | null;
  kind: HabitKind;
  dailyGoal: number | null;
  checkIns: Record<string, number>;
  hour: number;
  minute: number;
  now?: Date;
}): Promise<Date | null> {
  const boundary = await loadTasksDayBoundary();
  const now = params.now ?? new Date();
  const cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  for (let i = 0; i < MAX_LOOKAHEAD_DAYS; i++) {
    const day = new Date(cursor);
    day.setDate(cursor.getDate() + i);
    const fireAt = buildFireAt(
      { y: day.getFullYear(), m0: day.getMonth(), d: day.getDate() },
      params.hour,
      params.minute,
    );
    if (fireAt.getTime() <= now.getTime() + 2000) continue;

    const logicalYmd = getLogicalLocalYmd(fireAt, boundary);
    if (!isHabitScheduledOnLogicalYmd(params.extraData, logicalYmd)) continue;

    const todayCount = params.checkIns[logicalYmd] ?? 0;
    const hasDayRecord = Object.prototype.hasOwnProperty.call(params.checkIns, logicalYmd);
    if (
      isHabitReminderSatisfiedForDay({
        kind: params.kind,
        todayCount,
        dailyGoal: params.dailyGoal,
        hasDayRecord,
      })
    ) {
      continue;
    }

    return fireAt;
  }

  return null;
}

export type SyncHabitReminderParams = {
  habitId: string;
  enabled: boolean;
  hour: number;
  minute: number;
  /** 通知正文用习惯名称 */
  title: string;
  /** 可选：避免重复读库；未传则内部加载 */
  extraData?: string | null;
  checkIns?: Record<string, number>;
};

/**
 * 登记下一次需要提醒的时刻（DATE）。
 * 若当日已完成/已标记，则跳到后续仍需打卡且日程命中的一天。
 */
export async function syncHabitReminderNotification(params: SyncHabitReminderParams): Promise<{
  scheduled: boolean;
  permissionDenied: boolean;
}> {
  if (Platform.OS === 'web' || isExpoSandboxNotificationDisabled()) {
    return { scheduled: false, permissionDenied: false };
  }

  const { habitId, enabled, hour, minute, title } = params;
  const id = notificationIdentifier(habitId);

  let Notifications: typeof import('expo-notifications');
  try {
    Notifications = await import('expo-notifications');
  } catch (e) {
    console.warn('expo-notifications 不可用', e);
    return { scheduled: false, permissionDenied: false };
  }

  try {
    await Notifications.cancelScheduledNotificationAsync(id);
  } catch {
    /* 无已登记通知时忽略 */
  }

  if (!enabled) {
    return { scheduled: false, permissionDenied: false };
  }

  if (!(await canScheduleAppNotification({ category: 'habit-reminder', identifier: id }))) {
    return { scheduled: false, permissionDenied: false };
  }

  const perm = await Notifications.getPermissionsAsync();
  let granted = perm.status === 'granted';
  if (!granted && perm.canAskAgain !== false) {
    const req = await Notifications.requestPermissionsAsync();
    granted = req.status === 'granted';
  }
  if (!granted) {
    return { scheduled: false, permissionDenied: true };
  }

  await ensureAndroidChannel();

  const h = Math.max(0, Math.min(23, Math.floor(hour)));
  const m = Math.max(0, Math.min(59, Math.floor(minute)));

  let extraData = params.extraData ?? null;
  if (params.extraData === undefined) {
    const habit = await getHabitById(habitId);
    extraData = habit?.extra_data ?? null;
  }
  const kind = parseHabitKind(extraData);
  const dailyGoal = parseHabitDailyGoal(extraData, kind);
  const checkIns = params.checkIns ?? (await getCheckInsMapByHabitId(habitId));

  const fireAt = await findNextHabitReminderFireAt({
    extraData,
    kind,
    dailyGoal,
    checkIns,
    hour: h,
    minute: m,
  });
  if (!fireAt) {
    return { scheduled: false, permissionDenied: false };
  }

  const SchedulableTriggerInputTypes = Notifications.SchedulableTriggerInputTypes;
  const body = (title.trim() || '习惯') + '，该打卡啦';

  try {
    await Notifications.scheduleNotificationAsync({
      identifier: id,
      content: {
        title: '习惯打卡提醒',
        body,
        sound: true,
        data: { type: 'habit-reminder', habitId },
      },
      trigger: {
        type: SchedulableTriggerInputTypes.DATE,
        date: fireAt,
        channelId: Platform.OS === 'android' ? ANDROID_CHANNEL_ID : undefined,
      },
    });
    return { scheduled: true, permissionDenied: false };
  } catch (e) {
    console.warn('登记习惯提醒失败', habitId, e);
    return { scheduled: false, permissionDenied: false };
  }
}

/** 按当前习惯与打卡状态，重新登记所有已开启提醒的习惯。 */
export async function resyncAllHabitReminders(): Promise<void> {
  if (Platform.OS === 'web' || isExpoSandboxNotificationDisabled()) return;

  const [habits, checkInsMaps] = await Promise.all([getHabits(), getAllHabitCheckInsMaps()]);
  await Promise.all(
    habits.map(async (habit) => {
      const reminder = parseHabitReminder(habit.extra_data);
      if (!reminder.enabled) {
        await cancelScheduledHabitReminder(habit.id);
        return;
      }
      await syncHabitReminderNotification({
        habitId: habit.id,
        enabled: true,
        hour: reminder.hour,
        minute: reminder.minute,
        title: habit.name,
        extraData: habit.extra_data,
        checkIns: checkInsMaps.get(habit.id) ?? {},
      });
    }),
  );
}

/** 单个习惯打卡/撤销后刷新其下一次提醒。 */
export async function resyncHabitReminderForHabitId(habitId: string): Promise<void> {
  if (Platform.OS === 'web' || isExpoSandboxNotificationDisabled()) return;
  const habit = await getHabitById(habitId);
  if (!habit) {
    await cancelScheduledHabitReminder(habitId);
    return;
  }
  const reminder = parseHabitReminder(habit.extra_data);
  if (!reminder.enabled) {
    await cancelScheduledHabitReminder(habitId);
    return;
  }
  await syncHabitReminderNotification({
    habitId,
    enabled: true,
    hour: reminder.hour,
    minute: reminder.minute,
    title: habit.name,
    extraData: habit.extra_data,
  });
}

/** 前台送达前：当日已完成/已标记则抑制展示。 */
export async function shouldSuppressHabitReminderNotification(habitId: string): Promise<boolean> {
  if (!habitId) return false;
  try {
    const habit = await getHabitById(habitId);
    if (!habit) return true;
    const reminder = parseHabitReminder(habit.extra_data);
    if (!reminder.enabled) return true;

    const boundary = await loadTasksDayBoundary();
    const logicalYmd = getLogicalLocalYmd(new Date(), boundary);
    if (!isHabitScheduledOnLogicalYmd(habit.extra_data, logicalYmd)) return true;

    const kind = parseHabitKind(habit.extra_data);
    const dailyGoal = parseHabitDailyGoal(habit.extra_data, kind);
    const checkIns = await getCheckInsMapByHabitId(habitId);
    const todayCount = checkIns[logicalYmd] ?? 0;
    const hasDayRecord = Object.prototype.hasOwnProperty.call(checkIns, logicalYmd);
    return isHabitReminderSatisfiedForDay({ kind, todayCount, dailyGoal, hasDayRecord });
  } catch (e) {
    console.warn('判断习惯提醒抑制失败', habitId, e);
    return false;
  }
}
