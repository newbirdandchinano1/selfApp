/**
 * 习惯 → 日程表虚拟入格（不写 schedule_placements）
 * - 循环规则决定「哪几天」
 * - 执行时间段（extra_data.executionTime）：默认全天不入格；仅指定起止时间段才入格
 * - 提醒（reminder）仅驱动通知，不决定是否入格
 */
import { isHabitScheduledOnLogicalYmd, type HabitCycleTab } from '@/lib/habit-schedule';
import { isBuildHabitSucceeded } from '@/lib/repositories/habits/habit-build-success';
import { isBuildNDaysPeriodHiddenOnViewDay } from '@/lib/repositories/habits/habit-build-n-days-period';
import {
  habitHasTimedExecution,
  parseHabitExecutionTime,
} from '@/lib/repositories/habits/habit-execution-time';
import {
  isHabitDayDisplayCompleted,
  parseHabitDailyGoal,
} from '@/lib/repositories/habits/habit-goal';
import { parseHabitKind } from '@/lib/repositories/habits/habit-kind';
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

/** 周期配额：允许按循环入格的重复周期 */
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
  /** 有具体起止时写入轴分钟，时间线按此时长算高度 */
  startMinutes?: number;
  endMinutes?: number;
  todayCount: number;
  dailyGoal: number | null;
  done: boolean;
  extraData: string | null;
  /** 习惯虚拟入格仅时间段；恒为 false（轴外夹紧后仍按时段） */
  allDay: boolean;
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

/** 是否可入日程表：须指定执行时间段（默认全天不入格）。 */
export function habitHasExecutionTime(extraData: string | null): boolean {
  return habitHasTimedExecution(extraData);
}

/** 循环是否属于可入格白名单（养成节奏 / 旧 N 天；周期配额 每日～每年） */
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
 * 提醒仍由习惯提醒通道负责；虚拟习惯不走日程格提醒，避免双推。
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

/** 开始落在断开/缝隙时，取最近可排格索引（仅占位；时间线以分钟为准） */
function nearestWorkSlotIndex(axis: AxisLike, axisMinutes: number): number {
  const slots = listWorkSlots(axis);
  if (slots.length === 0) return 0;
  for (const slot of slots) {
    if (axisMinutes >= slot.startMinutes && axisMinutes < slot.endMinutes) {
      return slot.slotIndex;
    }
  }
  for (const slot of slots) {
    if (slot.startMinutes >= axisMinutes) return slot.slotIndex;
  }
  return slots[slots.length - 1]!.slotIndex;
}

/** 编辑页提示：当前时刻能否落入工作格（提醒时刻预览） */
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
  if (kind !== 'build' && kind !== 'task') return null;
  if (!habitHasTimedExecution(extraData)) {
    return '默认全天不入日程表；在量化记录指定执行时间段后按循环日入格';
  }
  const tab = parseActiveTab(extraData);
  if (!tab) return null;
  if (!isHabitSchedulePlaceableCycle(extraData)) {
    return '当前循环模式不按日展开入格（将按现有循环判断）';
  }
  return '已指定执行时间段：按循环日入格';
}

/**
 * 全天：数据上仍记为自首格铺满当日可排格（兼容旧逻辑 / 轴重映射）。
 * 课表 UI 将此类占用收拢到顶部「全天」专属格，不再逐格铺色。
 */
export function allDaySpanForAxis(axis: AxisLike): { startSlotIndex: number; spanSlots: number } {
  const count = getSlotCount(axis);
  return { startSlotIndex: 0, spanSlots: Math.max(1, count) };
}

function resolveHabitTimedInterval(
  axis: AxisLike,
  startHour: number,
  startMinute: number,
  endHour: number,
  endMinute: number,
): {
  startSlotIndex: number;
  spanSlots: number;
  startMinutes: number;
  endMinutes: number;
  allDay: boolean;
} | null {
  const rawStart = startHour * 60 + startMinute;
  const rawEnd = endHour * 60 + endMinute;
  if (!(rawEnd > rawStart)) return null;

  // 与轴无交集则不入格（不再回退全天）
  if (rawEnd <= axis.startMinutes || rawStart >= axis.endMinutes) return null;

  const startMinutes = Math.max(rawStart, axis.startMinutes);
  const endMinutes = Math.min(rawEnd, axis.endMinutes);
  if (!(endMinutes > startMinutes)) return null;

  const startH = Math.floor(startMinutes / 60);
  const startM = startMinutes % 60;
  const mapped = clockHmToAxisMinutes(axis, startH, startM);
  const startSlotIndex =
    mapped != null
      ? (mapHabitTimeToWorkSlotIndex(axis, startH, startM) ?? nearestWorkSlotIndex(axis, mapped))
      : nearestWorkSlotIndex(axis, startMinutes);

  return {
    startSlotIndex,
    spanSlots: 1,
    startMinutes,
    endMinutes,
    allDay: false,
  };
}

/** 单日是否应虚拟入格（不含轴映射）；须指定执行时间段 */
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

  // 默认全天 → 不入日程表
  if (!habitHasTimedExecution(habit.extra_data)) return false;

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

  for (const habit of habits) {
    const kind = parseHabitKind(habit.extra_data);
    if (kind !== 'build' && kind !== 'task' && kind !== 'break') continue;

    const execution = parseHabitExecutionTime(habit.extra_data);
    if (execution.allDay) continue;

    const parsedDailyGoal = parseHabitDailyGoal(habit.extra_data, kind);
    const checkIns = checkInsByHabit?.get(habit.id) ?? {};
    const subActive = hasActiveSubHabits(habit.extra_data);
    const subMeta = subActive ? parseHabitSubHabitsMeta(habit.extra_data) : null;
    const subTotal = subMeta?.items.length ?? 0;

    const hour = execution.startHour;
    const minute = execution.startMinute;
    const timed = resolveHabitTimedInterval(
      axis,
      execution.startHour,
      execution.startMinute,
      execution.endHour,
      execution.endMinute,
    );
    if (!timed) continue;

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
      const hasDayRecord = Object.prototype.hasOwnProperty.call(checkIns, ymd);
      let todayCount = parentCount;
      let dailyGoal = parsedDailyGoal;
      // 与任务页小习惯「今日完成」同口径（戒除有记录即已处理；养成/任务看达标）
      let done = isHabitDayDisplayCompleted({
        kind,
        todayCount: parentCount,
        dailyGoal: parsedDailyGoal,
        hasDayRecord,
        ymd,
        logicalTodayYmd,
      });
      if (subActive && subTotal > 0) {
        const subCompleted = countSubHabitsCompletedForYmd(habit.extra_data, ymd);
        todayCount = subCompleted;
        dailyGoal = subTotal;
        if (kind === 'break') {
          // 戒除子项：有破戒勾选或父行已确认，即不再待打卡
          done = subCompleted > 0 || hasDayRecord;
        } else {
          done = areAllSubHabitsCompletedForYmd(habit.extra_data, ymd);
        }
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
        startSlotIndex: timed.startSlotIndex,
        spanSlots: timed.spanSlots,
        hour,
        minute,
        startMinutes: timed.startMinutes,
        endMinutes: timed.endMinutes,
        todayCount,
        dailyGoal,
        done,
        extraData: habit.extra_data,
        allDay: timed.allDay,
      });
    }
  }

  return out;
}

/** 日程格提醒用稳定 id（非占用表行）；全天项不应再登记日程格提醒 */
export function virtualHabitScheduleReminderId(habitId: string, assignYmd: string): string {
  return `habit:${habitId}:${assignYmd}`;
}
