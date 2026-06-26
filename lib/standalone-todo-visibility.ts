import { parseTaskAuditDatetimeForLogicalDay } from '@/lib/api-mysql-datetime';
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

type ProjectScheduleMeta = {
  mode?: 'date' | 'time';
  date?: string;
  range?: { start: string; end: string };
};

function formatLocalYmd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDaysToYmd(ymd: string, days: number): string {
  const d = ymdToLocalDate(ymd);
  if (!d) return ymd;
  d.setDate(d.getDate() + days);
  return formatLocalYmd(d);
}

function ymdToLocalDate(ymd: string): Date | null {
  const m = ymd.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  return new Date(year, month - 1, day);
}

export function formatScheduleDateToYMD(value: string): string {
  const t = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return t.slice(0, 10);
  return formatLocalYmd(d);
}

function parseProjectSchedule(extraData: string | null): ProjectScheduleMeta | null {
  if (!extraData) return null;
  try {
    const parsed = JSON.parse(extraData) as { schedule?: ProjectScheduleMeta };
    return parsed?.schedule ?? null;
  } catch {
    return null;
  }
}

/**
 * 判断逻辑日是否落在日程区间内。
 * 单日「时刻」槽为 [start, end)（end 常为次日）；跨多日区间为 [start, end] 含首尾。
 */
export function isLogicalDayInYmdRange(todayYmd: string, startYmd: string, endYmd: string): boolean {
  if (!startYmd || !endYmd) return true;
  if (todayYmd < startYmd) return false;
  if (startYmd === endYmd) return todayYmd === startYmd;
  if (endYmd === addDaysToYmd(startYmd, 1)) return todayYmd < endYmd;
  return todayYmd <= endYmd;
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

/** 独立待办：日程日/区间已结束且未完成 */
export function isStandaloneTodoScheduleExpired(task: TaskRow, logicalTodayYmd: string): boolean {
  if (!isStandaloneTodoOpen(task)) return false;

  const schedule = parseProjectSchedule(task.extra_data);
  if (!schedule) return false;

  if (schedule.mode === 'time' && schedule.range?.start && schedule.range?.end) {
    const start = formatScheduleDateToYMD(schedule.range.start);
    const end = formatScheduleDateToYMD(schedule.range.end);
    return !isLogicalDayInYmdRange(logicalTodayYmd, start, end);
  }
  if (schedule.date) {
    const schedYmd = formatScheduleDateToYMD(schedule.date);
    return logicalTodayYmd > schedYmd;
  }
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

/** 设置了重复的独立待办：重复日展示；非重复日仅当截止/计划已过期或错过重复日时保留 */
export function standaloneTodoPassesRepeatDayFilter(task: TaskRow, logicalTodayYmd: string): boolean {
  if (isTaskShelvedStatus(task.status)) return true;
  const schedule = parseTaskRepeatSchedule(task.extra_data);
  if (!schedule) return true;
  if (isTaskRepeatDueOnLogicalDay(logicalTodayYmd, schedule)) return true;
  if (!isStandaloneTodoOpen(task)) return false;
  if (isTaskRowOverdue(task, logicalTodayYmd)) return true;
  if (isStandaloneTodoScheduleExpired(task, logicalTodayYmd)) return true;
  return hasMissedRepeatOccurrenceBeforeToday(task, logicalTodayYmd, schedule);
}

/** 独立待办：计划日/区间内展示；过期未完成仍保留在列表（重复规则由 repeat 过滤器处理） */
export function standaloneTodoPassesScheduleWindowFilter(task: TaskRow, logicalTodayYmd: string): boolean {
  if (isTaskShelvedStatus(task.status)) return true;
  if (parseTaskRepeatSchedule(task.extra_data)) return true;

  const schedule = parseProjectSchedule(task.extra_data);
  if (schedule?.mode === 'time' && schedule.range?.start && schedule.range?.end) {
    const start = formatScheduleDateToYMD(schedule.range.start);
    const end = formatScheduleDateToYMD(schedule.range.end);
    if (isLogicalDayInYmdRange(logicalTodayYmd, start, end)) return true;
    return isStandaloneTodoOpen(task) && isStandaloneTodoScheduleExpired(task, logicalTodayYmd);
  }
  if (schedule?.date) {
    const schedYmd = formatScheduleDateToYMD(schedule.date);
    if (logicalTodayYmd === schedYmd) return true;
    return isStandaloneTodoOpen(task) && logicalTodayYmd > schedYmd;
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

export function getStandaloneTodoOverdueSortMs(task: TaskRow): number {
  const due = task.due_date?.slice(0, 10) ?? '';
  if (due) {
    const d = ymdToLocalDate(due);
    if (d) return d.getTime();
  }
  const schedule = parseProjectSchedule(task.extra_data);
  if (schedule?.mode === 'time' && schedule.range?.end) {
    const endYmd = formatScheduleDateToYMD(schedule.range.end);
    const d = ymdToLocalDate(endYmd);
    if (d) return d.getTime();
  }
  if (schedule?.date) {
    const d = ymdToLocalDate(formatScheduleDateToYMD(schedule.date));
    if (d) return d.getTime();
  }
  const ms = Date.parse(task.created_at);
  return Number.isNaN(ms) ? 0 : ms;
}

export function getStandaloneTodoOverdueDisplayYmd(task: TaskRow): string {
  const due = task.due_date?.slice(0, 10) ?? '';
  if (due.trim()) return due;
  const schedule = parseProjectSchedule(task.extra_data);
  if (schedule?.mode === 'time' && schedule.range?.end) {
    return formatScheduleDateToYMD(schedule.range.end);
  }
  if (schedule?.date) return formatScheduleDateToYMD(schedule.date);
  return '';
}

function isYmdInRange(ymd: string, startYmd: string, endYmd: string): boolean {
  return ymd >= startYmd && ymd <= endYmd;
}

/** 本周列表：计划落在本周，或未完成且已过期（含计划日/重复周期错过） */
export function isMatrixTaskInCurrentWeek(
  task: TaskRow,
  weekStartYmd: string,
  weekEndYmd: string,
  logicalTodayYmd: string,
): boolean {
  const schedule = parseProjectSchedule(task.extra_data);

  if (schedule?.mode === 'time' && schedule.range?.start && schedule.range?.end) {
    const start = formatScheduleDateToYMD(schedule.range.start);
    const end = formatScheduleDateToYMD(schedule.range.end);
    if (start && end) return start <= weekEndYmd && weekStartYmd <= end;
  }

  if (schedule?.date) {
    const schedYmd = formatScheduleDateToYMD(schedule.date);
    if (schedYmd) return isYmdInRange(schedYmd, weekStartYmd, weekEndYmd);
  }

  const dueYmd = task.due_date?.trim().slice(0, 10) ?? '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(dueYmd)) {
    if (isYmdInRange(dueYmd, weekStartYmd, weekEndYmd)) return true;
  }

  if (isTaskActiveStatus(task.status) && isTaskOverdueForList(task, logicalTodayYmd)) {
    return true;
  }

  return false;
}
