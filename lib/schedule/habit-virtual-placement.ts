/**
 * 养成习惯 → 日程表虚拟入格（不写 schedule_placements）
 */
import { isHabitScheduledOnLogicalYmd, type HabitCycleTab } from '@/lib/habit-schedule';
import { isBuildHabitSucceeded } from '@/lib/repositories/habits/habit-build-success';
import {
  isHabitDayGoalMet,
  parseHabitDailyGoal,
} from '@/lib/repositories/habits/habit-goal';
import { parseHabitKind } from '@/lib/repositories/habits/habit-kind';
import { parseHabitReminder } from '@/lib/repositories/habits/habit-reminder-meta';
import type { HabitRow } from '@/lib/repositories/habits/habit.types';
import { listWorkSlots, type AxisLike } from '@/lib/schedule/axis';
import { isHabitVisibleOnCalendarDay } from '@/lib/tasks-calendar-data';
import type { TasksDayBoundary } from '@/lib/tasks-logical-day';

/** 允许虚拟入格的循环模式 */
export const HABIT_SCHEDULE_PLACEABLE_TABS: readonly HabitCycleTab[] = [
  '每天',
  '每周定期',
  '每月定期',
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

/** 循环是否属于可入格白名单（不含每周N天/每月N天） */
export function isHabitSchedulePlaceableCycle(extraData: string | null): boolean {
  const tab = parseActiveTab(extraData);
  if (!tab) return false;
  return (HABIT_SCHEDULE_PLACEABLE_TABS as readonly string[]).includes(tab);
}

/** 养成 + 提醒开 + 可入格循环 + 未达成 → 走日程格提醒通道（不走习惯提醒） */
export function habitUsesScheduleSlotReminderChannel(extraData: string | null): boolean {
  if (parseHabitKind(extraData) !== 'build') return false;
  if (isBuildHabitSucceeded(extraData)) return false;
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
  if (parseHabitKind(extraData) !== 'build') return null;
  const rem = parseHabitReminder(extraData);
  if (!rem.enabled) return null;
  const tab = parseActiveTab(extraData);
  if (tab === '每周N天' || tab === '每月N天') {
    return '当前循环只约束次数、不指定具体日，开启提醒不会入格日程表';
  }
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
}): boolean {
  const { habit, viewYmd, logicalTodayYmd, dayBoundary } = params;
  if (viewYmd < logicalTodayYmd) return false;
  if (parseHabitKind(habit.extra_data) !== 'build') return false;
  if (isBuildHabitSucceeded(habit.extra_data)) return false;
  const rem = parseHabitReminder(habit.extra_data);
  if (!rem.enabled) return false;
  if (!isHabitSchedulePlaceableCycle(habit.extra_data)) return false;
  if (!isHabitVisibleOnCalendarDay(habit.created_at, viewYmd, dayBoundary)) return false;
  if (!isHabitScheduledOnLogicalYmd(habit.extra_data, viewYmd)) return false;
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

    const dailyGoal = parseHabitDailyGoal(habit.extra_data, 'build');
    const checkIns = checkInsByHabit?.get(habit.id) ?? {};

    for (const ymd of dayYmds) {
      if (
        !shouldShowVirtualHabitOnDay({
          habit,
          viewYmd: ymd,
          logicalTodayYmd,
          dayBoundary,
        })
      ) {
        continue;
      }
      const todayCount = checkIns[ymd] ?? 0;
      const done = isHabitDayGoalMet({
        kind: 'build',
        todayCount,
        dailyGoal,
      });
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
