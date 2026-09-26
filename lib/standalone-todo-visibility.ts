import { parseTaskAuditDatetimeForLogicalDay } from '@/lib/api-mysql-datetime';
import {
  addDaysToYmd,
  isLogicalDayInYmdRange,
  parseScheduleMetaFromExtra,
  scheduleDateToYmd,
  type ScheduleDateBounds,
  ymdToLocalDate,
} from '@/lib/schedule';
import {
  getRepeatDoneOnYmd,
  isTaskRepeatDueOnLogicalDay,
  parseTaskRepeatSchedule,
  type TaskRepeatSchedule,
} from '@/lib/task-repeat-rollover';
import type { TasksDayBoundary } from '@/lib/tasks-logical-day';
import { getLogicalLocalYmd } from '@/lib/tasks-logical-day';
import type { TaskRow } from '@/lib/repositories/tasks/task.types';
import {
  isTaskActiveStatus,
  isTaskShelvedStatus,
  isTaskTerminalStatus,
} from '@/lib/repositories/tasks/task.types';

export { addDaysToYmd, isLogicalDayInYmdRange };

/** @deprecated 使用 scheduleDateToYmd */
export const formatScheduleDateToYMD = scheduleDateToYmd;

/** 选择器「时刻」单日槽：同日，或 end 为次日的半开区间 [start, end)。 */
function isSingleDayMomentRange(startYmd: string, endYmd: string): boolean {
  return startYmd === endYmd || endYmd === addDaysToYmd(startYmd, 1);
}

type StandaloneTodoScheduleWindow =
  | { kind: 'moment'; ymd: string }
  | { kind: 'period'; startYmd: string; endYmd: string }
  | { kind: 'none' };

/**
 * 待办日程：日期/时刻 → 当天；跨多日时间段 → 含首尾的区间。
 */
function getStandaloneTodoScheduleWindow(task: TaskRow): StandaloneTodoScheduleWindow {
  const schedule = parseScheduleMetaFromExtra(task.extra_data);
  if (!schedule) return { kind: 'none' };

  if (schedule.mode === 'time' && schedule.range?.start && schedule.range?.end) {
    const startYmd = scheduleDateToYmd(schedule.range.start);
    const endYmd = scheduleDateToYmd(schedule.range.end);
    if (!startYmd || !endYmd) return { kind: 'none' };
    if (isSingleDayMomentRange(startYmd, endYmd)) {
      return { kind: 'moment', ymd: startYmd };
    }
    return { kind: 'period', startYmd, endYmd };
  }

  if (schedule.date) {
    const ymd = scheduleDateToYmd(schedule.date);
    if (!ymd) return { kind: 'none' };
    return { kind: 'moment', ymd };
  }

  return { kind: 'none' };
}

/** 未完成且截止日期（本地日）早于今天。 */
export function isTaskDueOverdue(dueYmd: string, isDone: boolean, todayYmd: string): boolean {
  if (isDone || !dueYmd.trim()) return false;
  const due = ymdToLocalDate(dueYmd);
  const today = ymdToLocalDate(todayYmd);
  if (!due || !today) return false;
  return due.getTime() < today.getTime();
}

export function isTaskRowOverdue(task: TaskRow, logicalTodayYmd: string): boolean {
  const isDone = task.status === 'done' || task.status === 'cancelled';
  const due = task.due_date?.slice(0, 10) ?? '';
  return isTaskDueOverdue(due, isDone, logicalTodayYmd);
}

export function isStandaloneTodoOpen(task: TaskRow): boolean {
  return isTaskActiveStatus(task.status);
}

/** 独立待办：日程日/区间已结束且未完成（未开始的时间段不算过期） */
export function isStandaloneTodoScheduleExpired(task: TaskRow, logicalTodayYmd: string): boolean {
  if (!isStandaloneTodoOpen(task)) return false;

  const window = getStandaloneTodoScheduleWindow(task);
  if (window.kind === 'moment') return logicalTodayYmd > window.ymd;
  if (window.kind === 'period') return logicalTodayYmd > window.endYmd;
  return false;
}

/** 今日之前存在应执行但未完成的重复日（用于非重复日仍展示过期待办） */
export function hasMissedRepeatOccurrenceBeforeToday(
  task: TaskRow,
  logicalTodayYmd: string,
  repeatSchedule: TaskRepeatSchedule,
): boolean {
  const createdYmd = task.created_at?.trim().slice(0, 10) ?? '';
  let cursor = addDaysToYmd(logicalTodayYmd, -1);
  for (let i = 0; i < 400; i += 1) {
    if (createdYmd && /^\d{4}-\d{2}-\d{2}$/.test(createdYmd) && cursor < createdYmd) break;
    if (isTaskRepeatDueOnLogicalDay(cursor, repeatSchedule)) return true;
    cursor = addDaysToYmd(cursor, -1);
  }
  return false;
}

/** 列表/四象限：截止或计划已过期，或重复周期内错过未完成 */
export function isTaskOverdueForList(task: TaskRow, logicalTodayYmd: string): boolean {
  if (isTaskShelvedStatus(task.status) || isTaskTerminalStatus(task.status)) return false;
  if (isTaskRowOverdue(task, logicalTodayYmd)) return true;
  if (isStandaloneTodoScheduleExpired(task, logicalTodayYmd)) return true;

  const repeat = parseTaskRepeatSchedule(task.extra_data);
  if (repeat && !isTaskRepeatDueOnLogicalDay(logicalTodayYmd, repeat)) {
    return hasMissedRepeatOccurrenceBeforeToday(task, logicalTodayYmd, repeat);
  }
  return false;
}

export function standaloneTodoPassesDayBoundaryFilter(
  task: TaskRow,
  boundary: TasksDayBoundary,
  logicalTodayYmd: string,
): boolean {
  if (task.status !== 'done' && task.status !== 'cancelled') return true;

  const repeatDone = getRepeatDoneOnYmd(task.extra_data);
  if (repeatDone && repeatDone >= logicalTodayYmd) return true;

  const raw = task.completed_at?.trim() || task.updated_at?.trim();
  if (!raw) return true;
  const doneAt = parseTaskAuditDatetimeForLogicalDay(raw);
  if (Number.isNaN(doneAt.getTime())) return true;
  const doneLogicalYmd = getLogicalLocalYmd(doneAt, boundary);
  return doneLogicalYmd >= logicalTodayYmd;
}

/** 待办栏可见性：与后端 standaloneTodos 契约一致——已完成/取消仅按逻辑日界判断，不再叠加重复/日程窗 */
export function standaloneTodoPassesStandaloneListFilter(
  task: TaskRow,
  boundary: TasksDayBoundary,
  logicalTodayYmd: string,
): boolean {
  if (task.project_id || task.parent_task_id) return false;
  if (task.status === 'done' || task.status === 'cancelled') {
    return standaloneTodoPassesDayBoundaryFilter(task, boundary, logicalTodayYmd);
  }
  return (
    standaloneTodoPassesDayBoundaryFilter(task, boundary, logicalTodayYmd) &&
    standaloneTodoPassesRepeatDayFilter(task, logicalTodayYmd) &&
    standaloneTodoPassesScheduleWindowFilter(task, logicalTodayYmd)
  );
}

/** 未到执行日的重复待办：仅提前这么多天进入待办列表 */
export const STANDALONE_TODO_REPEAT_ADVANCE_DAYS = 3;

/**
 * 重复独立待办可见性：
 * - 执行日 / 过期或漏做：始终显示
 * - 未到执行日：仅提前 {@link STANDALONE_TODO_REPEAT_ADVANCE_DAYS} 天显示（变灰置底，见 `isStandaloneTodoRepeatWaiting`）
 * - 更早则隐藏；搁置不受此限
 */
export function standaloneTodoPassesRepeatDayFilter(
  task: TaskRow,
  logicalTodayYmd: string,
): boolean {
  if (isTaskShelvedStatus(task.status)) return true;
  const schedule = parseTaskRepeatSchedule(task.extra_data);
  if (!schedule) return true;
  if (isTaskRepeatDueOnLogicalDay(logicalTodayYmd, schedule)) return true;
  if (isTaskOverdueForList(task, logicalTodayYmd)) return true;
  for (let i = 1; i <= STANDALONE_TODO_REPEAT_ADVANCE_DAYS; i += 1) {
    if (isTaskRepeatDueOnLogicalDay(addDaysToYmd(logicalTodayYmd, i), schedule)) return true;
  }
  return false;
}

/**
 * 重复性待办尚未到规定执行日（且未过期/未错过）：列表中变灰置底。
 * 已过期或错过既往执行日的仍视为需处理，不高亮为 waiting。
 * 可见性由 `standaloneTodoPassesRepeatDayFilter` 控制（仅提前 N 天出现）。
 */
export function isStandaloneTodoRepeatWaiting(task: TaskRow, logicalTodayYmd: string): boolean {
  if (!isStandaloneTodoOpen(task) || isTaskShelvedStatus(task.status)) return false;
  const schedule = parseTaskRepeatSchedule(task.extra_data);
  if (!schedule) return false;
  if (isTaskRepeatDueOnLogicalDay(logicalTodayYmd, schedule)) return false;
  if (isTaskOverdueForList(task, logicalTodayYmd)) return false;
  return true;
}

/**
 * 独立待办日程窗：
 * - 时刻/单日：当天显示；过期未完成仍保留（特殊标识 + 置顶）
 * - 时间段：区间内显示，过期未完成仍保留
 * - 未开始的未来日程不提前展示
 * 重复规则由 repeat 过滤器处理。
 */
export function standaloneTodoPassesScheduleWindowFilter(task: TaskRow, logicalTodayYmd: string): boolean {
  if (isTaskShelvedStatus(task.status)) return true;
  if (parseTaskRepeatSchedule(task.extra_data)) return true;

  const window = getStandaloneTodoScheduleWindow(task);
  if (window.kind === 'moment') {
    if (logicalTodayYmd === window.ymd) return true;
    return isStandaloneTodoOpen(task) && logicalTodayYmd > window.ymd;
  }
  if (window.kind === 'period') {
    if (logicalTodayYmd >= window.startYmd && logicalTodayYmd <= window.endYmd) return true;
    return isStandaloneTodoOpen(task) && logicalTodayYmd > window.endYmd;
  }

  return true;
}

export function isStandaloneTodoVisibleOnDay(
  task: TaskRow,
  logicalViewYmd: string,
  boundary: TasksDayBoundary,
): boolean {
  return standaloneTodoPassesStandaloneListFilter(task, boundary, logicalViewYmd);
}

export function isStandaloneTodoOverdue(task: TaskRow, logicalTodayYmd: string): boolean {
  if (isTaskShelvedStatus(task.status)) return false;
  if (!isStandaloneTodoOpen(task)) return false;
  return isTaskOverdueForList(task, logicalTodayYmd);
}

/**
 * 有效截止毫秒（与项目 getDueMs 对齐）：due_date → schedule.range.end → schedule.date；
 * 无截止返回 null（排序时沉底）。不含 created_at 回退。
 */
export function getStandaloneTodoDueMs(task: TaskRow): number | null {
  const due = task.due_date?.trim().slice(0, 10) ?? '';
  if (due) {
    const d = ymdToLocalDate(due);
    if (d) return d.getTime();
    const parsed = Date.parse(task.due_date!);
    if (!Number.isNaN(parsed)) return parsed;
  }
  const schedule = parseScheduleMetaFromExtra(task.extra_data);
  if (schedule?.mode === 'time' && schedule.range?.end) {
    const endRaw = schedule.range.end.trim();
    const endYmd = scheduleDateToYmd(endRaw);
    const d = ymdToLocalDate(endYmd);
    if (d) return d.getTime();
    const ms = Date.parse(endRaw);
    if (!Number.isNaN(ms)) return ms;
  }
  if (schedule?.date) {
    const dateRaw = schedule.date.trim();
    const d = ymdToLocalDate(scheduleDateToYmd(dateRaw));
    if (d) return d.getTime();
    const ms = Date.parse(dateRaw);
    if (!Number.isNaN(ms)) return ms;
  }
  return null;
}

/** 过期组内排序键：有有效截止用截止；否则回退 created_at（保证组内稳定） */
export function getStandaloneTodoOverdueSortMs(task: TaskRow): number {
  const dueMs = getStandaloneTodoDueMs(task);
  if (dueMs != null) return dueMs;
  const ms = Date.parse(task.created_at);
  return Number.isNaN(ms) ? 0 : ms;
}

/** 待办列表截止文案：仅时间段显示结束日；时刻/单日不展示截止。 */
export function getStandaloneTodoOverdueDisplayYmd(task: TaskRow): string {
  const window = getStandaloneTodoScheduleWindow(task);
  if (window.kind === 'period') return window.endYmd;
  return '';
}

function isYmdInRange(ymd: string, startYmd: string, endYmd: string): boolean {
  return ymd >= startYmd && ymd <= endYmd;
}

function scheduleIntersectsWeek(
  schedule: ScheduleDateBounds | null,
  weekStartYmd: string,
  weekEndYmd: string,
): boolean {
  if (schedule?.range?.start && schedule.range?.end) {
    const start = scheduleDateToYmd(schedule.range.start);
    const end = scheduleDateToYmd(schedule.range.end);
    if (start && end) return start <= weekEndYmd && weekStartYmd <= end;
  }

  if (schedule?.date) {
    const schedYmd = scheduleDateToYmd(schedule.date);
    if (schedYmd) return isYmdInRange(schedYmd, weekStartYmd, weekEndYmd);
  }

  return false;
}

/** 本周列表：计划时间范围与本周相交（任务自身日程优先，可回落到所属项目日程） */
export function isMatrixTaskInCurrentWeek(
  task: TaskRow,
  weekStartYmd: string,
  weekEndYmd: string,
  _logicalTodayYmd: string,
  opts?: { projectExtraData?: string | null },
): boolean {
  const taskSchedule = parseScheduleMetaFromExtra(task.extra_data);
  if (scheduleIntersectsWeek(taskSchedule, weekStartYmd, weekEndYmd)) return true;

  const projectSchedule = parseScheduleMetaFromExtra(opts?.projectExtraData ?? null);
  if (scheduleIntersectsWeek(projectSchedule, weekStartYmd, weekEndYmd)) return true;

  const dueYmd = task.due_date?.trim().slice(0, 10) ?? '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(dueYmd) && isYmdInRange(dueYmd, weekStartYmd, weekEndYmd)) {
    return true;
  }

  return false;
}
