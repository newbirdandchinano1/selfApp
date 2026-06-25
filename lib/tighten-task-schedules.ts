/**
 * 父任务 / 项目保存后：仅当子任务时间超出新框架时收紧，不主动扩大子任务时间。
 */

import {
  clampScheduleMetaToDateLimit,
  dueDateFromScheduleMeta,
  hasDateLimitBounds,
  mergeDateLimit,
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

  const childFrame = mergeDateLimit(frame, scheduleMetaToDateLimit(nextSchedule), {
    end: dueDateFromScheduleMeta(nextSchedule, dueDate) ?? undefined,
  });

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
