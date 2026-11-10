/**
 * 独立待办：截止日期（due_date / schedule）与青蛙指派日（frogAssigned*）彼此独立。
 * - 新建/编辑表单写入的日期 = 截止日期
 * - 用户手动入格/指派写入的日期 = 指派日
 * 项目任务 / 项目青蛙不走此模块。
 */

import {
  clearFrogAssignedOn,
  getFrogAssignedDates,
  replaceFrogAssignedOn,
} from '@/lib/frog-assignment';
import { formatMinutesAsHm } from '@/lib/schedule/axis';
import {
  dueDateFromScheduleMeta,
  parseScheduleMetaFromExtra,
} from '@/lib/schedule/meta';
import { isStandaloneTodoTask } from '@/lib/standalone-todo-task';
import {
  isTaskShelvedStatus,
  type TaskRow,
} from '@/lib/repositories/tasks/task.types';

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 编辑表单重建 extra 时需保留的青蛙相关字段 */
const FROG_EXTRA_KEYS = [
  'frogAssignedOn',
  'frogAssignedDates',
  'frogSessionCompletedOn',
] as const;

export type StandaloneAssignScheduleTime = {
  startMinutes?: number;
  endMinutes?: number;
  allDay?: boolean;
};

function parseExtraObject(extraData: string | null): Record<string, unknown> {
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

function normalizeYmd(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().slice(0, 10);
  return YMD_RE.test(trimmed) ? trimmed : null;
}

/** 是否为可指派的独立待办（搁置除外） */
export function shouldSyncStandaloneTodoAssign(
  task: Pick<TaskRow, 'project_id' | 'parent_task_id' | 'status'>,
): boolean {
  return isStandaloneTodoTask(task) && !isTaskShelvedStatus(task.status);
}

/**
 * 从 due_date / schedule 解析截止日期日。
 * 优先 due_date → schedule.date → schedule.range.end。
 */
export function assignYmdFromStandaloneTodo(
  task: Pick<TaskRow, 'due_date' | 'extra_data'>,
): string | null {
  const due = normalizeYmd(task.due_date);
  if (due) return due;
  const fromMeta = dueDateFromScheduleMeta(parseScheduleMetaFromExtra(task.extra_data), null);
  return normalizeYmd(fromMeta);
}

/** @deprecated 截止日期不再自动写成指派日 */
export function isStandaloneTodoNeedingAssignBackfill(
  _task: Pick<TaskRow, 'project_id' | 'parent_task_id' | 'status' | 'due_date' | 'extra_data'>,
): boolean {
  return false;
}

/**
 * 按 ymd 写入/清除 frog 指派（仅显式调用；表单保存不再走此路径）。
 * ymd 为空则清除全部青蛙指派字段。
 */
export function applyAssignFromDueToExtra(
  extraData: string | null,
  dueYmd: string | null,
): string | null {
  const ymd = normalizeYmd(dueYmd);
  if (!ymd) return clearFrogAssignedOn(extraData);
  return replaceFrogAssignedOn(extraData, ymd);
}

/**
 * 编辑/保存独立待办时：把旧行的青蛙指派字段合并进新重建的 extra，
 * 避免表单只改截止日期时把已有指派冲掉。
 */
export function preserveFrogAssignFieldsInExtra(
  nextExtra: string | null,
  previousExtra: string | null,
): string | null {
  const prev = parseExtraObject(previousExtra);
  const hasFrog = FROG_EXTRA_KEYS.some((key) => key in prev);
  if (!hasFrog) return nextExtra;

  const next = parseExtraObject(nextExtra);
  for (const key of FROG_EXTRA_KEYS) {
    if (key in prev) next[key] = prev[key];
  }
  return Object.keys(next).length === 0 ? null : JSON.stringify(next);
}

/**
 * @deprecated 指派不再回写 due_date / schedule；保留导出兼容。
 */
export function applyDueFromAssignToTaskFields(
  extraData: string | null,
  _assignYmd: string,
  _scheduleTime?: StandaloneAssignScheduleTime,
): { due_date: string | null; extra_data: string | null } {
  return {
    due_date: null,
    extra_data: extraData,
  };
}

/**
 * @deprecated 取消指派不再清空截止日期。
 */
export function clearDueFieldsOnUnassign(
  extraData: string | null,
  _opts?: { keepRepeatSkeleton?: boolean },
): { due_date: string | null; extra_data: string | null } {
  return { due_date: null, extra_data: clearFrogAssignedOn(extraData) };
}

/** 入格/指派成功后：不再改 due_date / schedule */
export async function syncStandaloneTodoAfterAssign(
  _taskId: string,
  _assignYmd: string,
  _scheduleTime?: StandaloneAssignScheduleTime,
): Promise<void> {
  // no-op：截止日期与指派日解耦
}

/** 取消指派后：不再清空 due_date / schedule */
export async function syncStandaloneTodoAfterUnassign(
  _taskId: string,
  _removedYmd?: string,
): Promise<void> {
  // no-op：截止日期与指派日解耦
}

/** @deprecated 不再把 due 懒对齐成 frog */
export async function backfillStandaloneTodoFrogFromDue(_task: TaskRow): Promise<TaskRow | null> {
  return null;
}

/** @deprecated 不再批量对齐；原样返回 */
export async function backfillStandaloneTodosFrogFromDue(tasks: TaskRow[]): Promise<TaskRow[]> {
  return tasks;
}

/** 调试/文案：时段标签 */
export function formatAssignScheduleTimeLabel(scheduleTime?: StandaloneAssignScheduleTime): string {
  if (!scheduleTime || scheduleTime.allDay || scheduleTime.startMinutes == null) return '全天';
  const start = formatMinutesAsHm(scheduleTime.startMinutes);
  const end =
    scheduleTime.endMinutes != null
      ? formatMinutesAsHm(scheduleTime.endMinutes)
      : formatMinutesAsHm(scheduleTime.startMinutes + 60);
  return `${start}–${end}`;
}

/** 是否仍有 frog 指派 */
export function standaloneTodoHasFrogAssign(extraData: string | null): boolean {
  return getFrogAssignedDates(extraData).length > 0;
}
