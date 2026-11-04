/**
 * 习惯打卡本地提醒：行为锚点。
 * - soft：到点一次
 * - normal：到点 + 未完成傍晚收口
 * - strong：到点强提醒（升级链）+ 未完成傍晚收口
 * 养成/任务型看 dailyGoal；戒除看当日是否已标记。
 */

import { isHabitScheduledOnLogicalYmd } from '@/lib/habit-schedule';
import { buildNotificationIdentifier } from '@/lib/notification-catalog';
import {
  cancelScheduledByIdentifier,
  cancelScheduledByPrefixes,
  isLocalNotificationSchedulingUnavailable,
  scheduleDateReminder,
  scheduleDateRemindersBulk,
  type ScheduleDateReminderParams,
} from '@/lib/notification-scheduler';
import { getHabits, getHabitById } from '@/lib/repositories/habits/habit';
import {
  getAllHabitCheckInsMaps,
  getCheckInsMapByHabitId,
} from '@/lib/repositories/habits/habit-check-in';
import { isHabitDayGoalMet, parseHabitDailyGoal } from '@/lib/repositories/habits/habit-goal';
import { parseHabitKind, type HabitKind } from '@/lib/repositories/habits/habit-kind';
import {
  buildHabitEveningWrapFireAt,
  habitReminderNeedsEveningWrap,
  type HabitReminderIntensity,
} from '@/lib/habit-reminder-logic';
import { parseHabitReminder } from '@/lib/repositories/habits/habit-reminder-meta';
import { getLogicalLocalYmd, loadTasksDayBoundary } from '@/lib/tasks-logical-day';

export { buildHabitEveningWrapFireAt, habitReminderNeedsEveningWrap };

const ANDROID_CHANNEL = {
  id: 'habit-reminders',
  name: '习惯打卡提醒',
  importance: 'default' as const,
  vibrationPattern: [0, 200, 120, 200],
};

/** 向前扫描候选提醒日（覆盖每月定期等稀疏日程） */
const MAX_LOOKAHEAD_DAYS = 40;

export function habitReminderIdentifier(habitId: string): string {
  return buildNotificationIdentifier('habit-reminder', habitId) ?? `selfapp-habit-reminder:${habitId}`;
}

export function habitReminderWrapIdentifier(habitId: string): string {
  return `${habitReminderIdentifier(habitId)}:wrap`;
}

/** 取消某习惯的本地提醒（主提醒 + 收口）。 */
export async function cancelScheduledHabitReminder(habitId: string): Promise<void> {
  // 收口标识 …:wrap 或误带实体后缀时剥掉，避免只清半截
  const key = habitId.trim().replace(/:wrap$/i, '');
  if (!key) return;
  const base = habitReminderIdentifier(key);
  try {
    await cancelScheduledByIdentifier(base);
    await cancelScheduledByIdentifier(habitReminderWrapIdentifier(key));
    // 清强提醒升级链附属
    await cancelScheduledByPrefixes([`${base}:`]);
  } catch (e) {
    console.warn('取消习惯提醒失败', key, e);
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
  intensity?: HabitReminderIntensity;
  eveningWrapHour?: number;
  eveningWrapMinute?: number;
};

/**
 * 登记下一次需要提醒的时刻（DATE）。
 * 若当日已完成/已标记，则跳到后续仍需打卡且日程命中的一天。
 */
export async function syncHabitReminderNotification(params: SyncHabitReminderParams): Promise<{
  scheduled: boolean;
  permissionDenied: boolean;
}> {
  if (isLocalNotificationSchedulingUnavailable()) {
    return { scheduled: false, permissionDenied: false };
  }

  const { habitId, enabled, hour, minute, title } = params;
  await cancelScheduledHabitReminder(habitId);

  if (!enabled) {
    return { scheduled: false, permissionDenied: false };
  }

  let extraData = params.extraData ?? null;
  if (params.extraData === undefined) {
    const habit = await getHabitById(habitId);
    extraData = habit?.extra_data ?? null;
  }

  // 养成入格习惯改走日程格提醒，避免双推
  const { habitUsesScheduleSlotReminderChannel } = await import(
    '@/lib/schedule/habit-virtual-placement'
  );
  if (habitUsesScheduleSlotReminderChannel(extraData)) {
    return { scheduled: false, permissionDenied: false };
  }

  const parsed = parseHabitReminder(
    extraData ??
      JSON.stringify({
        reminder: {
          enabled: true,
          hour,
          minute,
          intensity: params.intensity,
          eveningWrapHour: params.eveningWrapHour,
          eveningWrapMinute: params.eveningWrapMinute,
        },
      }),
  );
  const intensity: HabitReminderIntensity =
    params.intensity ?? (parsed.enabled ? parsed.intensity : 'normal');
  const wrapHour =
    params.eveningWrapHour ?? (parsed.enabled ? parsed.eveningWrapHour : 20);
  const wrapMinute =
    params.eveningWrapMinute ?? (parsed.enabled ? parsed.eveningWrapMinute : 0);

  const h = Math.max(0, Math.min(23, Math.floor(hour)));
  const m = Math.max(0, Math.min(59, Math.floor(minute)));

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

  const habitName = title.trim() || '习惯';
  const strong = intensity === 'strong';
  const id = habitReminderIdentifier(habitId);
  const fingerprint = `${habitId}|${habitName}|${h}:${m}|${intensity}|${fireAt.toISOString().slice(0, 16)}`;

  const items: ScheduleDateReminderParams[] = [
    {
      category: 'habit-reminder',
      identifier: id,
      fireAt,
      channel: ANDROID_CHANNEL,
      data: { type: 'habit-reminder', habitId, intensity, wave: 'primary' },
      fallback: {
        title: intensity === 'strong' ? '习惯 · 重点提醒' : '习惯打卡提醒',
        body: `${habitName}，该打卡啦`,
      },
      fingerprint,
      strong,
      contextBlock: [
        '【频道】习惯打卡提醒',
        `【习惯名】${habitName}`,
        `【强度】${intensity}`,
        `【类型】${kind}`,
      ].join('\n'),
    },
  ];

  if (habitReminderNeedsEveningWrap(intensity)) {
    const wrapAt = buildHabitEveningWrapFireAt({
      primaryFireAt: fireAt,
      wrapHour,
      wrapMinute,
    });
    if (wrapAt) {
      items.push({
        category: 'habit-reminder',
        identifier: habitReminderWrapIdentifier(habitId),
        fireAt: wrapAt,
        channel: ANDROID_CHANNEL,
        data: { type: 'habit-reminder', habitId, intensity, wave: 'evening_wrap' },
        fallback: {
          title: '习惯收口',
          body: `${habitName}，今天还没完成哦`,
        },
        fingerprint: `${fingerprint}|wrap|${wrapAt.toISOString().slice(0, 16)}`,
        strong: false,
        contextBlock: [
          '【频道】习惯打卡提醒',
          '【波次】傍晚收口',
          `【习惯名】${habitName}`,
        ].join('\n'),
      });
    }
  }

  const result = await scheduleDateRemindersBulk(items, { skipCancel: true });
  return {
    scheduled: result.scheduledCount > 0 || items.length > 0,
    permissionDenied: result.permissionDenied,
  };
}

/** 按当前习惯与打卡状态，重新登记所有已开启提醒的习惯。 */
export async function resyncAllHabitReminders(): Promise<void> {
  if (isLocalNotificationSchedulingUnavailable()) return;

  const [habits, checkInsMaps] = await Promise.all([getHabits(), getAllHabitCheckInsMaps()]);
  await Promise.all(
    habits.map(async habit => {
      const reminder = parseHabitReminder(habit.extra_data);
      if (!reminder.enabled) {
        await cancelScheduledHabitReminder(habit.id);
        return;
      }
      const { habitUsesScheduleSlotReminderChannel } = await import(
        '@/lib/schedule/habit-virtual-placement'
      );
      if (habitUsesScheduleSlotReminderChannel(habit.extra_data)) {
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
        intensity: reminder.intensity,
        eveningWrapHour: reminder.eveningWrapHour,
        eveningWrapMinute: reminder.eveningWrapMinute,
      });
    }),
  );
}

/** 单个习惯打卡/撤销后刷新其下一次提醒。 */
export async function resyncHabitReminderForHabitId(habitId: string): Promise<void> {
  if (isLocalNotificationSchedulingUnavailable()) return;
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
  const { habitUsesScheduleSlotReminderChannel } = await import(
    '@/lib/schedule/habit-virtual-placement'
  );
  if (habitUsesScheduleSlotReminderChannel(habit.extra_data)) {
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
    intensity: reminder.intensity,
    eveningWrapHour: reminder.eveningWrapHour,
    eveningWrapMinute: reminder.eveningWrapMinute,
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
