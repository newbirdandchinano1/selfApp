/**
 * 独立待办：设置日期 ⇔ 青蛙指派 双向对齐。
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
  type ScheduleMeta,
} from '@/lib/schedule/meta';
import { isStandaloneTodoTask } from '@/lib/standalone-todo-task';
import { parseTaskRepeatSchedule } from '@/lib/task-repeat-rollover';
import { getTaskById, updateTask } from '@/lib/repositories/tasks/task';
import {
  isTaskShelvedStatus,
  type TaskRow,
} from '@/lib/repositories/tasks/task.types';

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

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

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function ymdAtLocalTime(ymd: string, minutes: number): string {
  const dayMins = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const h = Math.floor(dayMins / 60);
  const m = dayMins % 60;
  return `${ymd}T${pad2(h)}:${pad2(m)}:00`;
}

/** 是否应对该行做独立待办日期↔指派同步（搁置除外） */
export function shouldSyncStandaloneTodoAssign(
  task: Pick<TaskRow, 'project_id' | 'parent_task_id' | 'status'>,
): boolean {
  return isStandaloneTodoTask(task) && !isTaskShelvedStatus(task.status);
}

/**
 * 从 due_date / schedule 解析指派日。
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

/** 有有效日期但尚未写入 frog 字段 → 需懒对齐 */
export function isStandaloneTodoNeedingAssignBackfill(
  task: Pick<TaskRow, 'project_id' | 'parent_task_id' | 'status' | 'due_date' | 'extra_data'>,
): boolean {
  if (!shouldSyncStandaloneTodoAssign(task)) return false;
  if (getFrogAssignedDates(task.extra_data).length > 0) return false;
  return assignYmdFromStandaloneTodo(task) != null;
}

/**
 * 按 dueYmd 写入/清除 frog 指派（独立待办单日替换）。
 * dueYmd 为空则清除全部青蛙指派字段。
 */
export function applyAssignFromDueToExtra(
  extraData: string | null,
  dueYmd: string | null,
): string | null {
  const ymd = normalizeYmd(dueYmd);
  if (!ymd) return clearFrogAssignedOn(extraData);
  return replaceFrogAssignedOn(extraData, ymd);
}

function buildScheduleFromAssign(
  previous: ScheduleMeta | null,
  assignYmd: string,
  scheduleTime?: StandaloneAssignScheduleTime,
): ScheduleMeta {
  const base: ScheduleMeta = {
    reminderOption: previous?.reminderOption ?? '不提前',
    reminderHour: previous?.reminderHour,
    reminderMinute: previous?.reminderMinute,
    advanceMinutesOverride: previous?.advanceMinutesOverride,
    repeatOption: previous?.repeatOption ?? '不重复',
    repeatSummary: previous?.repeatSummary ?? '不重复',
    weeklyDays: previous?.weeklyDays ?? [],
    monthlyDays: previous?.monthlyDays ?? [],
    yearlyDate: previous?.yearlyDate ?? '',
  };

  const allDay = scheduleTime?.allDay === true || scheduleTime?.startMinutes == null;
  if (allDay) {
    return {
      ...base,
      mode: 'date',
      allDay: true,
      hasExactTime: false,
      date: `${assignYmd}T12:00:00`,
      startTime: `${assignYmd}T09:00:00`,
      endTime: `${assignYmd}T18:00:00`,
    };
  }

  const start = scheduleTime!.startMinutes!;
  const end =
    scheduleTime?.endMinutes != null && scheduleTime.endMinutes > start
      ? scheduleTime.endMinutes
      : start + 60;
  const startIso = ymdAtLocalTime(assignYmd, start);
  const endIso = ymdAtLocalTime(assignYmd, end);
  return {
    ...base,
    mode: 'time',
    allDay: false,
    hasExactTime: true,
    date: `${assignYmd}T12:00:00`,
    range: { start: startIso, end: endIso },
    startTime: startIso,
    endTime: endIso,
  };
}

/**
 * 指派日 → due_date + schedule（保留 reminder/repeat 骨架）。
 * 同时将 frog 替换为该单日。
 */
export function applyDueFromAssignToTaskFields(
  extraData: string | null,
  assignYmd: string,
  scheduleTime?: StandaloneAssignScheduleTime,
): { due_date: string; extra_data: string } {
  const ymd = normalizeYmd(assignYmd);
  if (!ymd) {
    return {
      due_date: assignYmd,
      extra_data: replaceFrogAssignedOn(extraData, assignYmd),
    };
  }
  const parsed = parseExtraObject(extraData);
  const prevSchedule = parseScheduleMetaFromExtra(extraData);
  const schedule = buildScheduleFromAssign(prevSchedule, ymd, scheduleTime);
  const nextExtra: Record<string, unknown> = {
    ...parsed,
    schedule,
  };
  // 根级 reminder/repeat 与 schedule 对齐（列表 meta 仍读根级）
  if (typeof schedule.reminderOption === 'string') {
    nextExtra.reminder = schedule.reminderOption;
  }
  if (typeof schedule.repeatSummary === 'string' && schedule.repeatSummary.trim()) {
    nextExtra.repeat = schedule.repeatSummary;
  } else if (typeof schedule.repeatOption === 'string') {
    nextExtra.repeat = schedule.repeatOption;
  }
  const withSchedule = JSON.stringify(nextExtra);
  return {
    due_date: ymd,
    extra_data: replaceFrogAssignedOn(withSchedule, ymd),
  };
}

/**
 * 取消指派后清空日期字段。
 * 重复待办：只清 frog（调用方已清），保留 schedule/repeat 骨架与 due_date。
 */
export function clearDueFieldsOnUnassign(
  extraData: string | null,
  opts?: { keepRepeatSkeleton?: boolean },
): { due_date: string | null; extra_data: string | null } {
  const keepRepeat = opts?.keepRepeatSkeleton ?? !!parseTaskRepeatSchedule(extraData);
  const withoutFrog = clearFrogAssignedOn(extraData);
  if (keepRepeat) {
    return { due_date: null, extra_data: withoutFrog };
  }
  const parsed = parseExtraObject(withoutFrog);
  const { schedule: _s, ...rest } = parsed;
  // 保留 reminder/repeat 文案；去掉具体 schedule 日期对象
  const next = Object.keys(rest).length === 0 ? null : JSON.stringify(rest);
  return { due_date: null, extra_data: next };
}

/** 入格/指派成功后：独立待办回写 due + 单日 frog */
export async function syncStandaloneTodoAfterAssign(
  taskId: string,
  assignYmd: string,
  scheduleTime?: StandaloneAssignScheduleTime,
): Promise<void> {
  const task = await getTaskById(taskId);
  if (!task || !shouldSyncStandaloneTodoAssign(task)) return;
  const ymd = normalizeYmd(assignYmd);
  if (!ymd) return;
  const fields = applyDueFromAssignToTaskFields(task.extra_data, ymd, scheduleTime);
  const sameDue = normalizeYmd(task.due_date) === fields.due_date;
  const sameExtra = (task.extra_data ?? null) === fields.extra_data;
  if (sameDue && sameExtra) return;
  await updateTask(taskId, {
    due_date: fields.due_date,
    extra_data: fields.extra_data,
  });
}

/**
 * 取消指派后：若已无 frog 日，清空独立待办日期（重复待办保留 repeat 骨架，仅清 due_date 可选）。
 * 对重复待办：不清 schedule，只确保 frog 已由 unassign 清掉；due_date 若等于被取消日可清。
 */
export async function syncStandaloneTodoAfterUnassign(
  taskId: string,
  removedYmd?: string,
): Promise<void> {
  const task = await getTaskById(taskId);
  if (!task || !isStandaloneTodoTask(task)) return;
  if (isTaskShelvedStatus(task.status)) return;

  const remaining = getFrogAssignedDates(task.extra_data);
  if (remaining.length > 0) {
    const nextYmd = remaining[remaining.length - 1]!;
    const fields = applyDueFromAssignToTaskFields(task.extra_data, nextYmd);
    await updateTask(taskId, {
      due_date: fields.due_date,
      extra_data: fields.extra_data,
    });
    return;
  }

  const isRepeat = !!parseTaskRepeatSchedule(task.extra_data);
  if (isRepeat) {
    // 不拆 repeat / schedule；若 due 恰好是被取消日则清 due
    const due = normalizeYmd(task.due_date);
    const removed = normalizeYmd(removedYmd);
    if (due && removed && due === removed) {
      await updateTask(taskId, { due_date: null });
    }
    return;
  }

  const cleared = clearDueFieldsOnUnassign(task.extra_data, { keepRepeatSkeleton: false });
  await updateTask(taskId, {
    due_date: cleared.due_date,
    extra_data: cleared.extra_data,
  });
}

/** 有 due 无 frog 的独立待办：把 frog 写成 due 日 */
export async function backfillStandaloneTodoFrogFromDue(task: TaskRow): Promise<TaskRow | null> {
  if (!isStandaloneTodoNeedingAssignBackfill(task)) return null;
  const ymd = assignYmdFromStandaloneTodo(task);
  if (!ymd) return null;
  const nextExtra = applyAssignFromDueToExtra(task.extra_data, ymd);
  if (nextExtra === task.extra_data) return null;
  await updateTask(task.id, { extra_data: nextExtra });
  return { ...task, extra_data: nextExtra };
}

/** 批量懒对齐；返回可能已更新的列表 */
export async function backfillStandaloneTodosFrogFromDue(tasks: TaskRow[]): Promise<TaskRow[]> {
  const out: TaskRow[] = [];
  for (const task of tasks) {
    try {
      const next = await backfillStandaloneTodoFrogFromDue(task);
      out.push(next ?? task);
    } catch (err) {
      console.warn('[standalone-assign-sync] backfill failed', task.id, err);
      out.push(task);
    }
  }
  return out;
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
