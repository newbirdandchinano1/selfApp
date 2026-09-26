/**
 * 父任务 / 项目保存后：仅当子任务时间超出新框架时收紧，不主动扩大子任务时间。
 * 项目已设定日程时：下属任务完全继承项目日程（覆盖写入）。
 */

import {
  applyScheduleMetaToLabels,
  clampScheduleMetaToDateLimit,
  dueDateFromScheduleMeta,
  hasDateLimitBounds,
  mergeDateLimit,
  scheduleMetaHasConcreteDates,
  scheduleMetaToDateLimit,
  type DateLimitYmd,
  type ScheduleMetaLike,
} from '@/lib/schedule-inherit';
import {
  getChildTasksByParentTaskId,
  getTasksByProjectId,
  updateTask,
  type TaskTreeNode,
  type TaskWriteOptions,
} from '@/lib/repositories/tasks/task';

function parseTaskExtraData(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

function scheduleFromExtra(extraDataRaw: string | null): ScheduleMetaLike | null {
  const extra = parseTaskExtraData(extraDataRaw);
  const schedule = extra.schedule;
  if (schedule && typeof schedule === 'object' && !Array.isArray(schedule)) {
    return schedule as ScheduleMetaLike;
  }
  return null;
}

/** 收紧单个节点及其全部后代；frame 为当前节点允许的最大窗口 */
async function tightenNodeAndDescendants(
  node: TaskTreeNode,
  frame: DateLimitYmd,
  writeOpts?: TaskWriteOptions,
): Promise<number> {
  if (!hasDateLimitBounds(frame)) return 0;

  let count = 0;
  const extra = parseTaskExtraData(node.extra_data);
  const schedule = scheduleFromExtra(node.extra_data);
  const { schedule: nextSchedule, dueDate, changed } = clampScheduleMetaToDateLimit(
    schedule,
    node.due_date,
    frame,
  );

  if (changed) {
    await updateTask(
      node.id,
      {
        due_date: dueDateFromScheduleMeta(nextSchedule, dueDate),
        extra_data: JSON.stringify({
          ...extra,
          schedule: nextSchedule,
        }),
      },
      writeOpts,
    );
    count += 1;
  }

  const childFrame = mergeDateLimit(
    mergeDateLimit(frame, scheduleMetaToDateLimit(nextSchedule)),
    {
      end: dueDateFromScheduleMeta(nextSchedule, dueDate) ?? undefined,
    },
  );

  for (const child of node.children) {
    count += await tightenNodeAndDescendants(child, childFrame, writeOpts);
  }

  return count;
}

/** 父任务保存后：收紧所有子孙任务（不修改父任务自身） */
export async function tightenDescendantTasksOf(
  parentTaskId: string,
  frame: DateLimitYmd,
): Promise<number> {
  if (!hasDateLimitBounds(frame)) return 0;
  const children = await getChildTasksByParentTaskId(parentTaskId);
  let count = 0;
  for (const child of children) {
    count += await tightenNodeAndDescendants(child, frame);
  }
  return count;
}

/** 项目保存后：收紧项目内全部任务（含嵌套子任务） */
export async function tightenAllProjectTasks(
  projectId: string,
  frame: DateLimitYmd,
  writeOpts?: TaskWriteOptions,
): Promise<number> {
  if (!hasDateLimitBounds(frame)) return 0;
  const roots = await getTasksByProjectId(projectId);
  let count = 0;
  for (const root of roots) {
    count += await tightenNodeAndDescendants(root, frame, writeOpts);
  }
  return count;
}

async function applyScheduleToNodeAndDescendants(
  node: TaskTreeNode,
  schedule: ScheduleMetaLike,
  dueDate: string | null,
  reminder: string,
  repeat: string,
  writeOpts?: TaskWriteOptions,
): Promise<number> {
  let count = 0;
  const extra = parseTaskExtraData(node.extra_data);
  await updateTask(
    node.id,
    {
      due_date: dueDate,
      extra_data: JSON.stringify({
        ...extra,
        reminder,
        repeat,
        schedule,
      }),
    },
    writeOpts,
  );
  count += 1;
  for (const child of node.children) {
    count += await applyScheduleToNodeAndDescendants(
      child,
      schedule,
      dueDate,
      reminder,
      repeat,
      writeOpts,
    );
  }
  return count;
}

/**
 * 项目已设定日程时：将完整日程覆盖写入项目内全部任务/子任务。
 * 项目未设定日程时返回 0（调用方勿用此函数收紧）。
 */
export async function applyProjectScheduleToAllTasks(
  projectId: string,
  schedule: ScheduleMetaLike | null | undefined,
  writeOpts?: TaskWriteOptions,
): Promise<number> {
  if (!scheduleMetaHasConcreteDates(schedule)) return 0;
  const labels = applyScheduleMetaToLabels(schedule!);
  const dueDate = dueDateFromScheduleMeta(schedule, null);
  const roots = await getTasksByProjectId(projectId);
  let count = 0;
  for (const root of roots) {
    count += await applyScheduleToNodeAndDescendants(
      root,
      schedule!,
      dueDate,
      labels.reminderText,
      labels.repeatText,
      writeOpts,
    );
  }
  return count;
}
