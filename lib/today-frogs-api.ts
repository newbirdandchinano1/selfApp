import { apiGetTodayFrogs } from '@/lib/api-client';
import { overlayLocalPendingOnApiTableRows } from '@/lib/api-read-pending-overlay';
import { syncApiReadResultToLocal } from '@/lib/api-read-local-sync';
import { getDatabase } from '@/lib/database';
import { isFrogAssignedOn } from '@/lib/frog-assignment';
import { isFrogDoneForToday } from '@/lib/long-term-task';
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

const TODAY_FROGS_FILTERS_VERSION = 'tasks-page-v1';

export type TodayFrogsResult = {
  logicalToday: string;
  tasks: TaskRow[];
  /** 今日青蛙中的项目 id（与 tasks 中对应行同源） */
  projectFrogIds: string[];
  serverFiltered: boolean;
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
  return projects.filter((p) => isFrogAssignedOn(p.extra_data, logicalToday));
}

export function filterTodayFrogsLocally(tasks: TaskRow[], logicalToday: string): TaskRow[] {
  return sortTodayFrogRows(
    tasks.filter((t) => isFrogAssignedOn(t.extra_data, logicalToday)),
    logicalToday,
  );
}

function mergeTaskAndProjectFrogs(
  taskFrogs: TaskRow[],
  projectFrogs: ProjectRow[],
  logicalToday: string,
): { tasks: TaskRow[]; projectFrogIds: string[] } {
  const projectIds = new Set(projectFrogs.map((p) => p.id));
  const taskOnly = taskFrogs.filter((t) => !projectIds.has(t.id));
  const asTasks = projectFrogs.map(projectToFrogTaskRow);
  return {
    tasks: sortTodayFrogRows([...taskOnly, ...asTasks], logicalToday),
    projectFrogIds: [...projectIds],
  };
}

function isServerFilteredTodayFrogs(meta: { serverFiltered?: boolean; filtersVersion?: string } | undefined): boolean {
  return meta?.serverFiltered === true && meta?.filtersVersion === TODAY_FROGS_FILTERS_VERSION;
}

async function hydrateRowsById<T extends { id: string; extra_data?: string | null }>(
  table: 'tasks' | 'projects',
  apiRows: T[],
): Promise<T[]> {
  if (apiRows.length === 0) return [];
  const db = await getDatabase();
  if (!db) return apiRows;
  const ids = [...new Set(apiRows.map((r) => String(r.id ?? '').trim()).filter(Boolean))];
  if (ids.length === 0) return apiRows;
  const placeholders = ids.map(() => '?').join(',');
  const local = await db.getAllAsync<T>(
    `SELECT * FROM ${table} WHERE id IN (${placeholders}) AND sync_status != 'pending_delete'`,
    ids,
  );
  const localById = new Map((local ?? []).map((r) => [String(r.id), r]));
  return apiRows.map((row) => {
    const localRow = localById.get(String(row.id));
    if (!localRow) return row;
    return {
      ...localRow,
      ...row,
      extra_data: row.extra_data ?? localRow.extra_data ?? null,
    };
  });
}

async function overlayPendingTodayFrogs(
  apiTaskFrogs: TaskRow[],
  apiProjectFrogs: ProjectRow[],
  logicalToday: string,
): Promise<{ tasks: TaskRow[]; projectFrogIds: string[] }> {
  const [pendingTasks, pendingProjects] = await Promise.all([
    overlayLocalPendingOnApiTableRows('tasks', apiTaskFrogs as Record<string, unknown>[]),
    overlayLocalPendingOnApiTableRows('projects', apiProjectFrogs as Record<string, unknown>[]),
  ]);
  const taskFrogs = filterTodayFrogsLocally(pendingTasks as TaskRow[], logicalToday);
  const projectFrogs = filterTodayProjectFrogsLocally(pendingProjects as ProjectRow[], logicalToday);
  return mergeTaskAndProjectFrogs(taskFrogs, projectFrogs, logicalToday);
}

async function resolveLogicalToday(boundary?: TasksDayBoundary): Promise<{ boundary: TasksDayBoundary; logicalToday: string }> {
  const resolved = boundary ?? (await loadTasksDayBoundary());
  return {
    boundary: resolved,
    logicalToday: getLogicalLocalYmd(new Date(), resolved),
  };
}

async function readTodayFrogsFromLocal(logicalToday: string): Promise<TodayFrogsResult> {
  const [allTasks, allProjects] = await Promise.all([getTasks(), getProjects()]);
  const taskFrogs = filterTodayFrogsLocally(allTasks, logicalToday);
  const projectFrogs = filterTodayProjectFrogsLocally(allProjects, logicalToday);
  const merged = mergeTaskAndProjectFrogs(taskFrogs, projectFrogs, logicalToday);
  return {
    logicalToday,
    tasks: merged.tasks,
    projectFrogIds: merged.projectFrogIds,
    serverFiltered: false,
  };
}

/** 拉取今日青蛙：优先 REST 直出；失败或仅本地时回退 SQLite。不再为展示扫任务全表。 */
export async function fetchTodayFrogs(opts?: {
  boundary?: TasksDayBoundary;
  offlineFallback?: boolean;
  forceLocal?: boolean;
  signal?: AbortSignal;
}): Promise<TodayFrogsResult> {
  const { boundary, logicalToday } = await resolveLogicalToday(opts?.boundary);
  const skipNetwork = Boolean(opts?.forceLocal);

  if (!skipNetwork) {
    try {
      const data = await apiGetTodayFrogs({
        dayBoundaryHour: boundary.hour,
        dayBoundaryMinute: boundary.minute,
        signal: opts?.signal,
      });
      const resolvedToday = data.logicalToday?.trim() || logicalToday;
      const apiTasks = (Array.isArray(data.tasks) ? data.tasks : []) as TaskRow[];
      const apiProjectFrogs = (Array.isArray(data.projectFrogs) ? data.projectFrogs : []) as ProjectRow[];
      const apiProjectFrogIds = Array.isArray(data.projectFrogIds)
        ? data.projectFrogIds.map((id) => String(id).trim()).filter(Boolean)
        : [];
      const serverFiltered = isServerFilteredTodayFrogs(data.meta);

      if (apiTasks.length > 0) {
        await syncApiReadResultToLocal('tasks', apiTasks as Record<string, unknown>[]);
      }
      if (apiProjectFrogs.length > 0) {
        await syncApiReadResultToLocal('projects', apiProjectFrogs as Record<string, unknown>[]);
      }

      const [hydratedTasks, hydratedProjects] = await Promise.all([
        hydrateRowsById('tasks', apiTasks),
        hydrateRowsById('projects', apiProjectFrogs),
      ]);

      let projectFrogs = hydratedProjects;
      if (projectFrogs.length === 0 && apiProjectFrogIds.length > 0) {
        const localProjects = await getProjects();
        const idSet = new Set(apiProjectFrogIds);
        projectFrogs = localProjects.filter((p) => idSet.has(p.id));
      }

      if (serverFiltered) {
        const merged = await overlayPendingTodayFrogs(hydratedTasks, projectFrogs, resolvedToday);
        return {
          logicalToday: resolvedToday,
          tasks: merged.tasks,
          projectFrogIds: merged.projectFrogIds,
          serverFiltered: true,
        };
      }

      if (projectFrogs.length === 0) {
        projectFrogs = filterTodayProjectFrogsLocally(await getProjects(), resolvedToday);
      }
      const merged = await overlayPendingTodayFrogs(hydratedTasks, projectFrogs, resolvedToday);
      return {
        logicalToday: resolvedToday,
        tasks: merged.tasks,
        projectFrogIds: merged.projectFrogIds,
        serverFiltered: false,
      };
    } catch (e) {
      if (!opts?.offlineFallback) throw e;
      console.warn('[today-frogs] 接口失败，回退本地过滤', e);
    }
  }

  return readTodayFrogsFromLocal(logicalToday);
}
