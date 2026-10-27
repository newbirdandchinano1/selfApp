/**
 * 习惯 → 日程表虚拟入格（不写 schedule_placements）
 * - 循环规则决定「哪几天」；格子上一律全天（与手动「全天」一致）
 * - 提醒仅驱动通知，不决定是否入格 / 入格时刻
 * - 戒除无循环表时：每天全天，直至现有隐藏规则生效
 */
import { isHabitScheduledOnLogicalYmd, type HabitCycleTab } from '@/lib/habit-schedule';
import { isBuildHabitSucceeded } from '@/lib/repositories/habits/habit-build-success';
import { isBuildNDaysPeriodHiddenOnViewDay } from '@/lib/repositories/habits/habit-build-n-days-period';
import {
  isHabitDayGoalMet,
  parseHabitDailyGoal,
} from '@/lib/repositories/habits/habit-goal';
import { parseHabitKind } from '@/lib/repositories/habits/habit-kind';
import { parseHabitReminder } from '@/lib/repositories/habits/habit-reminder-meta';
import {
  areAllSubHabitsCompletedForYmd,
  countSubHabitsCompletedForYmd,
  hasActiveSubHabits,
  parseHabitSubHabitsMeta,
} from '@/lib/repositories/habits/habit-sub';
import {
  getTaskHabitTasksViewState,
  TASK_REPEAT_PERIODS,
  type TaskRepeatPeriod,
} from '@/lib/repositories/habits/habit-task-period';
import type { HabitRow } from '@/lib/repositories/habits/habit.types';
import {
  clockHmToAxisMinutes,
  getSlotCount,
  listWorkSlots,
  type AxisLike,
} from '@/lib/schedule/axis';
import { isHabitVisibleOnCalendarDay } from '@/lib/tasks-calendar-data';
import type { TasksDayBoundary } from '@/lib/tasks-logical-day';

/** 养成：允许按循环入格的模式（提示文案用；入格日以 isHabitScheduledOnLogicalYmd 为准） */
export const HABIT_SCHEDULE_PLACEABLE_TABS: readonly HabitCycleTab[] = [
  '每天',
  '每周定期',
  '每月定期',
  '每周N天',
  '每月N天',
] as const;

/** 任务型：允许按循环入格的重复周期 */
export const TASK_HABIT_SCHEDULE_PLACEABLE_TABS: readonly TaskRepeatPeriod[] = [
  ...TASK_REPEAT_PERIODS,
] as const;

export type VirtualHabitPlacement = {
  habitId: string;
  name: string;
  icon: string;
  assignYmd: string;
  startSlotIndex: number;
  spanSlots: number;
  hour: number;
  minute: number;
  todayCount: number;
  dailyGoal: number | null;
  done: boolean;
  extraData: string | null;
  /** 习惯虚拟入格一律全天 */
  allDay: true;
};

function parseActiveTab(extraData: string | null): string | null {
  if (!extraData) return null;
  try {
    const p = JSON.parse(extraData) as { schedule?: { activeTab?: unknown } };
    const tab = p?.schedule?.activeTab;
    return typeof tab === 'string' ? tab : null;
  } catch {
    return null;
  }
}

/** 循环是否属于可入格白名单（养成 N 天 / 定期 / 每天；任务型 每日～每年） */
export function isHabitSchedulePlaceableCycle(extraData: string | null): boolean {
  const tab = parseActiveTab(extraData);
  if (!tab) return false;
  const kind = parseHabitKind(extraData);
  if (kind === 'task') {
    return (TASK_HABIT_SCHEDULE_PLACEABLE_TABS as readonly string[]).includes(tab);
  }
  if (kind === 'build') {
    return (HABIT_SCHEDULE_PLACEABLE_TABS as readonly string[]).includes(tab);
  }
  return false;
}

/**
 * 习惯入格已与提醒解耦且一律全天 → 不再走日程格提醒通道。
 * 有提醒时仍由习惯提醒通道按时刻推送。
 */
export function habitUsesScheduleSlotReminderChannel(_extraData: string | null): boolean {
  return false;
}

/**
 * 将时刻映射到工作格：落在 [start, end) 内的工作格。
 * 轴外或断开时段 → null。
 */
export function mapHabitTimeToWorkSlotIndex(
  axis: AxisLike,
  hour: number,
  minute: number,
): number | null {
  const mins = clockHmToAxisMinutes(axis, hour, minute);
  if (mins == null) return null;
  const slots = listWorkSlots(axis);
  for (const slot of slots) {
    if (mins >= slot.startMinutes && mins < slot.endMinutes) {
      return slot.slotIndex;
    }
  }
  return null;
}

/** 编辑页提示：当前时刻能否落入工作格（提醒时刻预览，与入格无关） */
export function describeHabitScheduleSlotMapping(
  axis: AxisLike,
  hour: number,
  minute: number,
): { ok: true; slotIndex: number } | { ok: false; reason: string } {
  const slot = mapHabitTimeToWorkSlotIndex(axis, hour, minute);
  if (slot != null) return { ok: true, slotIndex: slot };
  const mins =
    Math.max(0, Math.min(23, Math.round(hour))) * 60 +
    Math.max(0, Math.min(59, Math.round(minute)));
  if (mins < axis.startMinutes || mins >= axis.endMinutes) {
    return { ok: false, reason: '该时刻在日程表时间轴之外' };
  }
  return { ok: false, reason: '该时刻落在断开时段（如午休）' };
}

export function habitSchedulePlacementEligibilityHint(extraData: string | null): string | null {
  const kind = parseHabitKind(extraData);
  if (kind === 'break') return null;
  if (kind !== 'build' && kind !== 'task') return null;
  const tab = parseActiveTab(extraData);
  if (!tab) return null;
  if (!isHabitSchedulePlaceableCycle(extraData)) {
    return '当前循环模式不按日展开入格（将按现有循环判断）';
  }
  return null;
}

/** 全天：自首工作格铺满当日可排格（对齐手动「全天」） */
export function allDaySpanForAxis(axis: AxisLike): { startSlotIndex: number; spanSlots: number } {
  const count = getSlotCount(axis);
  return { startSlotIndex: 0, spanSlots: Math.max(1, count) };
}

/** 单日是否应虚拟入格（不含轴映射） */
export function shouldShowVirtualHabitOnDay(params: {
  habit: HabitRow;
  viewYmd: string;
  logicalTodayYmd: string;
  dayBoundary: TasksDayBoundary;
  /** 该习惯打卡 map；N 天/任务型周期隐藏需要 */
  checkIns?: Record<string, number>;
}): boolean {
  const { habit, viewYmd, logicalTodayYmd, dayBoundary, checkIns = {} } = params;
  if (viewYmd < logicalTodayYmd) return false;

  const kind = parseHabitKind(habit.extra_data);
  if (kind !== 'build' && kind !== 'task' && kind !== 'break') return false;
  if (kind === 'build' && isBuildHabitSucceeded(habit.extra_data)) return false;

  if (!isHabitVisibleOnCalendarDay(habit.created_at, viewYmd, dayBoundary)) return false;
  // 无循环 tab 时 isHabitScheduledOnLogicalYmd 返回 true → 戒除/未配循环 = 每天
  if (!isHabitScheduledOnLogicalYmd(habit.extra_data, viewYmd)) return false;

  if (
    kind === 'build' &&
    isBuildNDaysPeriodHiddenOnViewDay({
      extraData: habit.extra_data,
      checkIns,
      viewYmd,
    })
  ) {
    return false;
  }

  if (kind === 'task') {
    const taskView = getTaskHabitTasksViewState({
      extraData: habit.extra_data,
      checkIns,
      logicalYmd: viewYmd,
    });
    if (taskView?.hiddenOnViewDay) return false;
  }

  return true;
}

export function buildVirtualHabitPlacementsForDays(params: {
  habits: HabitRow[];
  dayYmds: string[];
  logicalTodayYmd: string;
  axis: AxisLike;
  dayBoundary: TasksDayBoundary;
  /** habitId → ymd → count */
  checkInsByHabit?: Map<string, Record<string, number>>;
}): VirtualHabitPlacement[] {
  const { habits, dayYmds, logicalTodayYmd, axis, dayBoundary, checkInsByHabit } = params;
  const out: VirtualHabitPlacement[] = [];
  const { startSlotIndex, spanSlots } = allDaySpanForAxis(axis);
  const axisStartH = Math.floor(axis.startMinutes / 60);
  const axisStartM = axis.startMinutes % 60;

  for (const habit of habits) {
    const kind = parseHabitKind(habit.extra_data);
    if (kind !== 'build' && kind !== 'task' && kind !== 'break') continue;

    const parsedDailyGoal = parseHabitDailyGoal(habit.extra_data, kind);
    const checkIns = checkInsByHabit?.get(habit.id) ?? {};
    const subActive = hasActiveSubHabits(habit.extra_data);
    const subMeta = subActive ? parseHabitSubHabitsMeta(habit.extra_data) : null;
    const subTotal = subMeta?.items.length ?? 0;
    // 提醒时刻仅作详情展示；入格位置为全天
    const rem = parseHabitReminder(habit.extra_data);
    const hour = rem.enabled ? rem.hour : axisStartH;
    const minute = rem.enabled ? rem.minute : axisStartM;

    for (const ymd of dayYmds) {
      if (
        !shouldShowVirtualHabitOnDay({
          habit,
          viewYmd: ymd,
          logicalTodayYmd,
          dayBoundary,
          checkIns,
        })
      ) {
        continue;
      }
      const parentCount = checkIns[ymd] ?? 0;
      let todayCount = parentCount;
      let dailyGoal = parsedDailyGoal;
      let done = isHabitDayGoalMet({
        kind,
        todayCount: parentCount,
        dailyGoal: parsedDailyGoal,
        hasDayRecord: Object.prototype.hasOwnProperty.call(checkIns, ymd),
      });
      if (subActive && subTotal > 0) {
        const subCompleted = countSubHabitsCompletedForYmd(habit.extra_data, ymd);
        todayCount = subCompleted;
        dailyGoal = subTotal;
        done = areAllSubHabitsCompletedForYmd(habit.extra_data, ymd);
      } else if (kind === 'task' && !done) {
        const taskView = getTaskHabitTasksViewState({
          extraData: habit.extra_data,
          checkIns,
          logicalYmd: ymd,
        });
        if (taskView?.showPeriodCheckOnViewDay) done = true;
      }
      out.push({
        habitId: habit.id,
        name: habit.name?.trim() || '习惯',
        icon: habit.icon || 'check',
        assignYmd: ymd,
        startSlotIndex,
        spanSlots,
        hour,
        minute,
        todayCount,
        dailyGoal,
        done,
        extraData: habit.extra_data,
        allDay: true,
      });
    }
  }

  return out;
}

/** 日程格提醒用稳定 id（非占用表行）；全天项不应再登记日程格提醒 */
export function virtualHabitScheduleReminderId(habitId: string, assignYmd: string): string {
  return `habit:${habitId}:${assignYmd}`;
}
