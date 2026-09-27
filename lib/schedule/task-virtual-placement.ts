/**
 * 重复待办 → 日程表虚拟入格（不写 schedule_placements）
 * 开启 autoPlaceIntoSchedule + 重复规则 + 具体时间 → 按重复日叠到对应工作格。
 */
import type { AxisLike } from '@/lib/schedule/axis';
import { mapHabitTimeToWorkSlotIndex } from '@/lib/schedule/habit-virtual-placement';
import { parseScheduleMetaFromExtra, type ScheduleMeta } from '@/lib/schedule/meta';
import type { SchedulePlacementRow } from '@/lib/schedule/types';
import { ymdForWeekday } from '@/lib/schedule/week';
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
  spanSlots: 1;
  hour: number;
  minute: number;
  done: boolean;
  priority: number;
  extraData: string | null;
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

/** 任务是否开启自动入格 */
export function parseAutoPlaceIntoSchedule(extraData: string | null | undefined): boolean {
  return parseExtraObject(extraData).autoPlaceIntoSchedule === true;
}

/** 日程 meta 是否具备自动入格所需的具体时间 */
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

/** 表单：当前日程是否允许开启自动入格（有重复 + 具体时间） */
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
  // 非重复完成标记：终态 done 视为完成（一般不入格，仅兜底）
  return task.status === 'done';
}

/** 单日是否应虚拟入格（不含轴映射；不含与真实占用去重） */
export function shouldShowVirtualTaskOnDay(params: {
  task: TaskRow;
  viewYmd: string;
  logicalTodayYmd: string;
  dayBoundary: TasksDayBoundary;
}): boolean {
  const { task, viewYmd, logicalTodayYmd, dayBoundary } = params;
  if (viewYmd < logicalTodayYmd) return false;
  if (isTaskShelvedStatus(task.status) || task.status === 'cancelled') return false;

  if (!parseAutoPlaceIntoSchedule(task.extra_data)) return false;

  const schedule = parseScheduleMetaFromExtra(task.extra_data);
  if (!scheduleMetaHasExactTimeForAutoPlace(schedule)) return false;

  const repeat = parseTaskRepeatSchedule(task.extra_data);
  if (!repeat) return false;
  if (!isTaskRepeatDueOnLogicalDay(viewYmd, repeat)) return false;

  if (!isHabitVisibleOnCalendarDay(task.created_at, viewYmd, dayBoundary)) return false;

  // 已完成：仅在本周期完成日仍展示（打勾态）；其它日不入格
  if (!isTaskActiveStatus(task.status)) {
    return isTaskDoneOnAssignYmd(task, viewYmd);
  }

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

  for (const task of tasks) {
    if (!parseAutoPlaceIntoSchedule(task.extra_data)) continue;
    const schedule = parseScheduleMetaFromExtra(task.extra_data);
    if (!scheduleMetaHasExactTimeForAutoPlace(schedule)) continue;
    const hm = parseStartTimeHm(schedule!.startTime!);
    if (!hm) continue;
    const slotIndex = mapHabitTimeToWorkSlotIndex(axis, hm.hour, hm.minute);
    if (slotIndex == null) continue;

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

      out.push({
        taskId: task.id,
        title: task.title?.trim() || '待办',
        assignYmd: ymd,
        startSlotIndex: slotIndex,
        spanSlots: 1,
        hour: hm.hour,
        minute: hm.minute,
        done: isTaskDoneOnAssignYmd(task, ymd),
        priority: task.priority ?? 0,
        extraData: task.extra_data,
      });
    }
  }

  return out;
}
