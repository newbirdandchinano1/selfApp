/**
 * 道路首页「本周推进」：仅当前月目标关联项目下的本周任务。
 */
import { getTasks } from '@/lib/repositories/tasks/task';
import { isMatrixTaskInCurrentWeek } from '@/lib/standalone-todo-visibility';
import {
  selectCurrentMonthWeekTasks as selectCore,
  type ProjectWeekContext,
  type RoadWeekTasksResult,
} from '@/lib/life-road/road-week-tasks-core';

export {
  formatWeekRangeSlash,
  selectCurrentMonthWeekTasks as selectCurrentMonthWeekTasksWithPredicate,
  weekRangeFromAnchor,
  type ProjectWeekContext,
  type RoadWeekTaskItem,
  type RoadWeekTasksEmptyReason,
  type RoadWeekTasksResult,
  type WeekTaskPredicate,
} from '@/lib/life-road/road-week-tasks-core';

/** 使用现有本周判定：任务日程 / 项目日程 / due_date */
export function selectCurrentMonthWeekTasks(opts: {
  monthGoalId: string | null | undefined;
  projects: ProjectWeekContext[];
  tasks: Parameters<typeof selectCore>[0]['tasks'];
  now?: Date;
  limit?: number;
}): RoadWeekTasksResult {
  return selectCore({
    ...opts,
    isTaskInWeek: (task, weekStart, weekEnd, today, projectExtraData) =>
      isMatrixTaskInCurrentWeek(task, weekStart, weekEnd, today, {
        projectExtraData,
      }),
  });
}

export async function loadCurrentMonthWeekTasks(opts: {
  monthGoalId: string | null | undefined;
  projects: ProjectWeekContext[];
  now?: Date;
  limit?: number;
}): Promise<RoadWeekTasksResult> {
  if (!opts.monthGoalId?.trim() || opts.projects.length === 0) {
    return selectCurrentMonthWeekTasks({
      monthGoalId: opts.monthGoalId,
      projects: opts.projects,
      tasks: [],
      now: opts.now,
      limit: opts.limit,
    });
  }
  const tasks = await getTasks();
  return selectCurrentMonthWeekTasks({
    monthGoalId: opts.monthGoalId,
    projects: opts.projects,
    tasks,
    now: opts.now,
    limit: opts.limit,
  });
}
