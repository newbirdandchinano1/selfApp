/**
 * 独立待办 → 日程表虚拟入格（不写 schedule_placements）
 * - 仅独立待办；项目任务仍靠手动青蛙
 * - 有具体时间 → 按时刻落格；无具体时间 → 全天
 * - 有重复 → 按重复日；有日期无时间 → 今天起至截止日每天全天；
 *   无日期无重复 → 每天全天直至完成
 * - 同日已有手动占用则不再叠虚拟块
 */
import type { AxisLike } from '@/lib/schedule/axis';
import {
  allDaySpanForAxis,
  mapHabitTimeToWorkSlotIndex,
} from '@/lib/schedule/habit-virtual-placement';
import {
  parseScheduleMetaFromExtra,
  scheduleMetaToYmdBounds,
  type ScheduleMeta,
} from '@/lib/schedule/meta';
import type { SchedulePlacementRow } from '@/lib/schedule/types';
import { ymdForWeekday } from '@/lib/schedule/week';
import { isStandaloneTodoTask } from '@/lib/standalone-todo-task';
import { isHabitVisibleOnCalendarDay } from '@/lib/tasks-calendar-data';
import type { TasksDayBoundary } from '@/lib/tasks-logical-day';
import {
  getRepeatDoneOnYmd,
  isTaskRepeatDueOnLogicalDay,
  parseTaskRepeatSchedule,
} from '@/lib/task-repeat-rollover';
import {
  isTaskActiveStatus,
  isTaskShelvedStatus,
  type TaskRow,
} from '@/lib/repositories/tasks/task.types';

export type VirtualTaskPlacement = {
  taskId: string;
  title: string;
  assignYmd: string;
  startSlotIndex: number;
  spanSlots: number;
  hour: number;
  minute: number;
  done: boolean;
  priority: number;
  extraData: string | null;
  allDay: boolean;
};

function parseExtraObject(extraData: string | null | undefined): Record<string, unknown> {
  if (!extraData) return {};
  try {
    const parsed = JSON.parse(extraData) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* ignore */
  }
  return {};
}

/** @deprecated 入格不再依赖此开关；保留解析以便读旧数据 */
export function parseAutoPlaceIntoSchedule(extraData: string | null | undefined): boolean {
  return parseExtraObject(extraData).autoPlaceIntoSchedule === true;
}

/** 日程 meta 是否具备具体开始时刻 */
export function scheduleMetaHasExactTimeForAutoPlace(
  schedule: ScheduleMeta | null | undefined,
): boolean {
  if (!schedule?.hasExactTime) return false;
  const raw = typeof schedule.startTime === 'string' ? schedule.startTime.trim() : '';
  if (!raw) return false;
  return parseStartTimeHm(raw) != null;
}

export function parseStartTimeHm(startTimeIsoOrEmpty: string): { hour: number; minute: number } | null {
  const raw = startTimeIsoOrEmpty.trim();
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return { hour: d.getHours(), minute: d.getMinutes() };
}

/** @deprecated 自动入格开关已移除 */
export function canEnableAutoPlaceIntoSchedule(
  schedule: ScheduleMeta | null | undefined,
  repeatText?: string | null,
): { ok: true } | { ok: false; reason: 'no-repeat' | 'no-exact-time' } {
  const repeatOpt = schedule?.repeatOption;
  const hasRepeat =
    (typeof repeatOpt === 'string' && repeatOpt !== '不重复') ||
    (!!repeatText?.trim() && repeatText.trim() !== '不重复');
  if (!hasRepeat) return { ok: false, reason: 'no-repeat' };
  if (!scheduleMetaHasExactTimeForAutoPlace(schedule)) {
    return { ok: false, reason: 'no-exact-time' };
  }
  return { ok: true };
}

function isTaskDoneOnAssignYmd(task: TaskRow, assignYmd: string): boolean {
  const doneOn = getRepeatDoneOnYmd(task.extra_data);
  if (doneOn) return doneOn === assignYmd;
  return task.status === 'done';
}

/**
 * 有日期窗：从 max(今天, start) 到 end 每天；
 * 若已过期仍未完成：今天起每日继续全天，直至完成。
 */
function isViewYmdInDatedAllDayWindow(params: {
  viewYmd: string;
  logicalTodayYmd: string;
  startYmd: string | null;
  endYmd: string | null;
}): boolean {
  const { viewYmd, logicalTodayYmd, startYmd, endYmd } = params;
  if (viewYmd < logicalTodayYmd) return false;
  if (!endYmd && !startYmd) return true;

  if (endYmd && logicalTodayYmd > endYmd) {
    // 过期未完成：继续每日入格
    return true;
  }

  const windowStart =
    startYmd && startYmd > logicalTodayYmd ? startYmd : logicalTodayYmd;
  if (viewYmd < windowStart) return false;
  if (endYmd && viewYmd > endYmd) return false;
  return true;
}

/** 单日是否应虚拟入格（不含轴映射；不含与真实占用去重） */
export function shouldShowVirtualTaskOnDay(params: {
  task: TaskRow;
  viewYmd: string;
  logicalTodayYmd: string;
  dayBoundary: TasksDayBoundary;
}): boolean {
  const { task, viewYmd, logicalTodayYmd, dayBoundary } = params;
  if (!isStandaloneTodoTask(task)) return false;
  if (viewYmd < logicalTodayYmd) return false;
  if (isTaskShelvedStatus(task.status) || task.status === 'cancelled') return false;
  if (!isHabitVisibleOnCalendarDay(task.created_at, viewYmd, dayBoundary)) return false;

  if (!isTaskActiveStatus(task.status)) {
    return isTaskDoneOnAssignYmd(task, viewYmd);
  }

  const schedule = parseScheduleMetaFromExtra(task.extra_data);
  const hasExactTime = scheduleMetaHasExactTimeForAutoPlace(schedule);
  const repeat = parseTaskRepeatSchedule(task.extra_data);

  if (hasExactTime) {
    if (repeat) return isTaskRepeatDueOnLogicalDay(viewYmd, repeat);
    const bounds = scheduleMetaToYmdBounds(schedule, task.due_date);
    if (bounds.startYmd || bounds.endYmd) {
      return isViewYmdInDatedAllDayWindow({
        viewYmd,
        logicalTodayYmd,
        startYmd: bounds.startYmd,
        endYmd: bounds.endYmd,
      });
    }
    // 有时刻、无日期无重复：每天定点直至完成
    return true;
  }

  // 全天
  if (repeat) return isTaskRepeatDueOnLogicalDay(viewYmd, repeat);

  const bounds = scheduleMetaToYmdBounds(schedule, task.due_date);
  if (bounds.startYmd || bounds.endYmd) {
    return isViewYmdInDatedAllDayWindow({
      viewYmd,
      logicalTodayYmd,
      startYmd: bounds.startYmd,
      endYmd: bounds.endYmd,
    });
  }

  // 无日期无重复：每天全天
  return true;
}

function buildPlacedTaskDayKeys(placements: SchedulePlacementRow[] | undefined): Set<string> {
  const keys = new Set<string>();
  if (!placements) return keys;
  for (const p of placements) {
    if (p.subjectKind !== 'task') continue;
    if (p.orphaned) continue;
    const ymd = ymdForWeekday(p.weekStartYmd, p.weekday);
    keys.add(`${p.subjectId}:${ymd}`);
  }
  return keys;
}

export function buildVirtualTaskPlacementsForDays(params: {
  tasks: TaskRow[];
  dayYmds: string[];
  logicalTodayYmd: string;
  axis: AxisLike;
  dayBoundary: TasksDayBoundary;
  /** 已有真实占用时跳过同日同任务虚拟块 */
  placements?: SchedulePlacementRow[];
}): VirtualTaskPlacement[] {
  const { tasks, dayYmds, logicalTodayYmd, axis, dayBoundary, placements } = params;
  const placedKeys = buildPlacedTaskDayKeys(placements);
  const out: VirtualTaskPlacement[] = [];
  const allDay = allDaySpanForAxis(axis);
  const axisStartH = Math.floor(axis.startMinutes / 60);
  const axisStartM = axis.startMinutes % 60;

  for (const task of tasks) {
    if (!isStandaloneTodoTask(task)) continue;

    const schedule = parseScheduleMetaFromExtra(task.extra_data);
    const hasExactTime = scheduleMetaHasExactTimeForAutoPlace(schedule);
    let timedSlot: { hour: number; minute: number; slotIndex: number } | null = null;
    if (hasExactTime) {
      const hm = parseStartTimeHm(schedule!.startTime!);
      if (!hm) continue;
      const slotIndex = mapHabitTimeToWorkSlotIndex(axis, hm.hour, hm.minute);
      if (slotIndex == null) continue;
      timedSlot = { ...hm, slotIndex };
    }

    for (const ymd of dayYmds) {
      if (
        !shouldShowVirtualTaskOnDay({
          task,
          viewYmd: ymd,
          logicalTodayYmd,
          dayBoundary,
        })
      ) {
        continue;
      }
      if (placedKeys.has(`${task.id}:${ymd}`)) continue;

      if (timedSlot) {
        out.push({
          taskId: task.id,
          title: task.title?.trim() || '待办',
          assignYmd: ymd,
          startSlotIndex: timedSlot.slotIndex,
          spanSlots: 1,
          hour: timedSlot.hour,
          minute: timedSlot.minute,
          done: isTaskDoneOnAssignYmd(task, ymd),
          priority: task.priority ?? 0,
          extraData: task.extra_data,
          allDay: false,
        });
      } else {
        out.push({
          taskId: task.id,
          title: task.title?.trim() || '待办',
          assignYmd: ymd,
          startSlotIndex: allDay.startSlotIndex,
          spanSlots: allDay.spanSlots,
          hour: axisStartH,
          minute: axisStartM,
          done: isTaskDoneOnAssignYmd(task, ymd),
          priority: task.priority ?? 0,
          extraData: task.extra_data,
          allDay: true,
        });
      }
    }
  }

  return out;
}

/** 是否为应发日程格提醒的虚拟待办（仅定点，非全天） */
export function virtualTaskUsesScheduleSlotReminder(placement: Pick<VirtualTaskPlacement, 'allDay' | 'done'>): boolean {
  return !placement.allDay && !placement.done;
}

export function virtualTaskScheduleReminderId(taskId: string, assignYmd: string): string {
  return `vtask:${taskId}:${assignYmd}`;
}
