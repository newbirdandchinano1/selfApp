import { apiGetTodayFrogs } from '@/lib/api-client';
import { syncApiReadResultToLocal } from '@/lib/api-read-local-sync';
import { getFrogAssignedOn } from '@/lib/frog-assignment';
import { isFrogDoneForToday } from '@/lib/long-term-task';
import { getActivePageApiReadOpts } from '@/lib/page-api-session';
import { projectToFrogTaskRow } from '@/lib/project-frog';
import { getProjects } from '@/lib/repositories/projects/project';
import type { ProjectRow } from '@/lib/repositories/projects/project.types';
import { getTasks } from '@/lib/repositories/tasks/task';
import type { TaskRow } from '@/lib/repositories/tasks/task.types';
import {
  getLogicalLocalYmd,
  loadTasksDayBoundary,
  type TasksDayBoundary,
} from '@/lib/tasks-logical-day';

export type TodayFrogsResult = {
  logicalToday: string;
  tasks: TaskRow[];
  /** 今日青蛙中的项目 id（与 tasks 中对应行同源） */
  projectFrogIds: string[];
};

function sortTodayFrogRows(rows: TaskRow[], logicalToday: string): TaskRow[] {
  const dueMs = (t: TaskRow) => {
    if (!t.due_date) return Number.POSITIVE_INFINITY;
    const ms = Date.parse(t.due_date);
    return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms;
  };
  const createdMs = (t: TaskRow) => {
    const ms = Date.parse(t.created_at);
    return Number.isNaN(ms) ? 0 : ms;
  };
  return rows.slice().sort((a, b) => {
    const doneA = isFrogDoneForToday(a.extra_data, a.status, logicalToday);
    const doneB = isFrogDoneForToday(b.extra_data, b.status, logicalToday);
    if (doneA !== doneB) return doneA ? 1 : -1;
    if (a.priority !== b.priority) return b.priority - a.priority;
    const byDue = dueMs(a) - dueMs(b);
    if (byDue !== 0) return byDue;
    const byCreated = createdMs(a) - createdMs(b);
    if (byCreated !== 0) return byCreated;
    return a.id.localeCompare(b.id);
  });
}

export function filterTodayProjectFrogsLocally(projects: ProjectRow[], logicalToday: string): ProjectRow[] {
  return projects.filter((p) => getFrogAssignedOn(p.extra_data) === logicalToday);
}

export function filterTodayFrogsLocally(tasks: TaskRow[], logicalToday: string): TaskRow[] {
  return sortTodayFrogRows(
    tasks.filter((t) => getFrogAssignedOn(t.extra_data) === logicalToday),
    logicalToday,
  );
}

function mergeTaskAndProjectFrogs(
  taskFrogs: TaskRow[],
  projectFrogs: ProjectRow[],
  logicalToday: string,
): { tasks: TaskRow[]; projectFrogIds: string[] } {
  const projectIds = new Set(projectFrogs.map((p) => p.id));
  // 避免任务 id 与项目 id 碰撞时重复展示
  const taskOnly = taskFrogs.filter((t) => !projectIds.has(t.id));
  const asTasks = projectFrogs.map(projectToFrogTaskRow);
  return {
    tasks: sortTodayFrogRows([...taskOnly, ...asTasks], logicalToday),
    projectFrogIds: [...projectIds],
  };
}

async function resolveLogicalToday(boundary?: TasksDayBoundary): Promise<{ boundary: TasksDayBoundary; logicalToday: string }> {
  const resolved = boundary ?? (await loadTasksDayBoundary());
  return {
    boundary: resolved,
    logicalToday: getLogicalLocalYmd(new Date(), resolved),
  };
}

/** 拉取今日青蛙：优先 REST（任务），并合并本地无子任务项目青蛙；失败或仅本地时回退 SQLite */
export async function fetchTodayFrogs(opts?: {
  boundary?: TasksDayBoundary;
  offlineFallback?: boolean;
  forceLocal?: boolean;
  signal?: AbortSignal;
}): Promise<TodayFrogsResult> {
  const { boundary, logicalToday } = await resolveLogicalToday(opts?.boundary);
  const skipNetwork = opts?.forceLocal || Boolean(getActivePageApiReadOpts()?.localOnly);

  if (!skipNetwork) {
    try {
      const data = await apiGetTodayFrogs({
        dayBoundaryHour: boundary.hour,
        dayBoundaryMinute: boundary.minute,
        signal: opts?.signal,
      });
      const rows = (Array.isArray(data.tasks) ? data.tasks : []) as TaskRow[];
      if (rows.length > 0) {
        await syncApiReadResultToLocal('tasks', rows as Record<string, unknown>[]);
      }
      const resolvedToday = data.logicalToday?.trim() || logicalToday;
      // 接口可能返回精简任务行；展示与完成青蛙均以本地全量行为准；项目青蛙仍走本地
      const [allTasks, allProjects] = await Promise.all([getTasks(), getProjects()]);
      const taskFrogs = filterTodayFrogsLocally(allTasks, resolvedToday);
      const projectFrogs = filterTodayProjectFrogsLocally(allProjects, resolvedToday);
      const merged = mergeTaskAndProjectFrogs(taskFrogs, projectFrogs, resolvedToday);
      return {
        logicalToday: resolvedToday,
        tasks: merged.tasks,
        projectFrogIds: merged.projectFrogIds,
      };
    } catch (e) {
      if (!opts?.offlineFallback) throw e;
      console.warn('[today-frogs] 接口失败，回退本地过滤', e);
    }
  }

  const [allTasks, allProjects] = await Promise.all([getTasks(), getProjects()]);
  const taskFrogs = filterTodayFrogsLocally(allTasks, logicalToday);
  const projectFrogs = filterTodayProjectFrogsLocally(allProjects, logicalToday);
  const merged = mergeTaskAndProjectFrogs(taskFrogs, projectFrogs, logicalToday);
  return {
    logicalToday,
    tasks: merged.tasks,
    projectFrogIds: merged.projectFrogIds,
  };
}
