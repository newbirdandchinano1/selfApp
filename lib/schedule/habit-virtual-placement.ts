/**
 * 习惯 → 日程表虚拟入格（不写 schedule_placements）
 * 养成：每天 / 每周定期 / 每月定期 / 每周N天 / 每月N天
 * 任务型：每日 / 每周 / 每月 / 每年（周期达标后本周期剩余日不再入格）
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
  getTaskHabitTasksViewState,
  TASK_REPEAT_PERIODS,
  type TaskRepeatPeriod,
} from '@/lib/repositories/habits/habit-task-period';
import type { HabitRow } from '@/lib/repositories/habits/habit.types';
import { listWorkSlots, type AxisLike } from '@/lib/schedule/axis';
import { isHabitVisibleOnCalendarDay } from '@/lib/tasks-calendar-data';
import type { TasksDayBoundary } from '@/lib/tasks-logical-day';

/** 养成：允许虚拟入格的循环模式 */
export const HABIT_SCHEDULE_PLACEABLE_TABS: readonly HabitCycleTab[] = [
  '每天',
  '每周定期',
  '每月定期',
  '每周N天',
  '每月N天',
] as const;

/** 任务型：允许虚拟入格的重复周期 */
export const TASK_HABIT_SCHEDULE_PLACEABLE_TABS: readonly TaskRepeatPeriod[] = [
  ...TASK_REPEAT_PERIODS,
] as const;

export type VirtualHabitPlacement = {
  habitId: string;
  name: string;
  icon: string;
  assignYmd: string;
  startSlotIndex: number;
  spanSlots: 1;
  hour: number;
  minute: number;
  todayCount: number;
  dailyGoal: number | null;
  done: boolean;
  extraData: string | null;
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

/** 养成/任务型 + 提醒开 + 可入格循环 + 未终局达成 → 走日程格提醒通道（不走习惯提醒） */
export function habitUsesScheduleSlotReminderChannel(extraData: string | null): boolean {
  const kind = parseHabitKind(extraData);
  if (kind !== 'build' && kind !== 'task') return false;
  if (kind === 'build' && isBuildHabitSucceeded(extraData)) return false;
  const rem = parseHabitReminder(extraData);
  if (!rem.enabled) return false;
  return isHabitSchedulePlaceableCycle(extraData);
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
  const h = Math.max(0, Math.min(23, Math.round(hour)));
  const m = Math.max(0, Math.min(59, Math.round(minute)));
  const mins = h * 60 + m;
  if (mins < axis.startMinutes || mins >= axis.endMinutes) return null;
  const slots = listWorkSlots(axis);
  for (const slot of slots) {
    if (mins >= slot.startMinutes && mins < slot.endMinutes) {
      return slot.slotIndex;
    }
  }
  return null;
}

/** 编辑页提示：当前时刻能否落入工作格 */
export function describeHabitScheduleSlotMapping(
  axis: AxisLike,
  hour: number,
  minute: number,
): { ok: true; slotIndex: number } | { ok: false; reason: string } {
  const slot = mapHabitTimeToWorkSlotIndex(axis, hour, minute);
  if (slot != null) return { ok: true, slotIndex: slot };
  const mins = Math.max(0, Math.min(23, Math.round(hour))) * 60 + Math.max(0, Math.min(59, Math.round(minute)));
  if (mins < axis.startMinutes || mins >= axis.endMinutes) {
    return { ok: false, reason: '该时刻在日程表时间轴之外，无法入格' };
  }
  return { ok: false, reason: '该时刻落在断开时段（如午休），无法入格' };
}

export function habitSchedulePlacementEligibilityHint(extraData: string | null): string | null {
  const kind = parseHabitKind(extraData);
  if (kind !== 'build' && kind !== 'task') return null;
  const rem = parseHabitReminder(extraData);
  if (!rem.enabled) return null;
  if (!isHabitSchedulePlaceableCycle(extraData)) {
    return '当前循环模式不支持自动入格日程表';
  }
  return null;
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
  if (kind !== 'build' && kind !== 'task') return false;
  if (kind === 'build' && isBuildHabitSucceeded(habit.extra_data)) return false;

  const rem = parseHabitReminder(habit.extra_data);
  if (!rem.enabled) return false;
  if (!isHabitSchedulePlaceableCycle(habit.extra_data)) return false;
  if (!isHabitVisibleOnCalendarDay(habit.created_at, viewYmd, dayBoundary)) return false;
  if (!isHabitScheduledOnLogicalYmd(habit.extra_data, viewYmd)) return false;

  // 每周N天 / 每月N天：本周期配额在查看日之前已达成 → 剩余日不再显示
  if (kind === 'build' && isBuildNDaysPeriodHiddenOnViewDay({
    extraData: habit.extra_data,
    checkIns,
    viewYmd,
  })) {
    return false;
  }

  // 任务型：本周期预期目标在查看日之前已达成 → 剩余日不再显示
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

  for (const habit of habits) {
    const rem = parseHabitReminder(habit.extra_data);
    if (!rem.enabled) continue;
    const slotIndex = mapHabitTimeToWorkSlotIndex(axis, rem.hour, rem.minute);
    if (slotIndex == null) continue;

    const kind = parseHabitKind(habit.extra_data);
    if (kind !== 'build' && kind !== 'task') continue;

    const dailyGoal = parseHabitDailyGoal(habit.extra_data, kind);
    const checkIns = checkInsByHabit?.get(habit.id) ?? {};

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
      const todayCount = checkIns[ymd] ?? 0;
      let done = isHabitDayGoalMet({
        kind,
        todayCount,
        dailyGoal,
      });
      // 任务型：达成日当日也视为完成（与任务页 showPeriodCheck 对齐）
      if (kind === 'task' && !done) {
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
        startSlotIndex: slotIndex,
        spanSlots: 1,
        hour: rem.hour,
        minute: rem.minute,
        todayCount,
        dailyGoal,
        done,
        extraData: habit.extra_data,
      });
    }
  }

  return out;
}

/** 日程格提醒用稳定 id（非占用表行） */
export function virtualHabitScheduleReminderId(habitId: string, assignYmd: string): string {
  return `habit:${habitId}:${assignYmd}`;
}
