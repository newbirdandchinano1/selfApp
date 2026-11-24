/**
 * 任务页 bootstrap-v2 消费层：一次轻量快照覆盖 core + 当前 Tab 项目树。
 * 未启用 / 404 时由调用方回退旧分批路径。
 */
import {
  ApiRequestError,
  apiGetTasksBootstrapV2,
  type ApiProjectListItem,
  type TasksBootstrapV2Params,
} from '@/lib/api-client';
import { withApiTableSyncLock } from '@/lib/api-read';
import { syncApiReadResultToLocal } from '@/lib/api-read-local-sync';
import { isAbortError, throwIfAborted } from '@/lib/cloud-fetch-retry';
import { shouldSkipPageNetwork } from '@/lib/page-api-fetch';
import {
  INBOX_PROJECT_CATEGORY_ID,
  isProjectInInboxCategory,
} from '@/lib/repositories/projects/constants';
import { getProjectCategories, getProjects } from '@/lib/repositories/projects/project';
import type { ProjectRow } from '@/lib/repositories/projects/project.types';
import { getTaskCategories } from '@/lib/repositories/tasks/task';
import type { TaskRow } from '@/lib/repositories/tasks/task.types';
import { normalizeTaskPriority } from '@/lib/repositories/tasks/task.types';
import {
  ingestProjectsListApiItems,
  resolveProjectsListQueries,
  resolveProjectsListTerminalTaskFilters,
  type ProjectsListData,
} from '@/lib/projects-list-api';
import { getCurrentWeekRange } from '@/lib/repositories/insights/weekly-review';
import {
  TASKS_PAGE_FILTERS_VERSION,
  resolveStandaloneTodosList,
  type TasksPageCoreData,
} from '@/lib/tasks-page-api';
import {
  getLogicalLocalYmd,
  loadTasksDayBoundary,
  type TasksDayBoundary,
} from '@/lib/tasks-logical-day';

function envFlagOn(raw: string | undefined, defaultOn: boolean): boolean {
  if (raw == null || raw.trim() === '') return defaultOn;
  const v = raw.trim().toLowerCase();
  return v !== '0' && v !== 'false' && v !== 'off' && v !== 'no';
}

/** 客户端灰度：默认开；后端未开时 404 自动回退 */
export function isTasksBootstrapV2ClientEnabled(): boolean {
  return envFlagOn(process.env.EXPO_PUBLIC_TASKS_BOOTSTRAP_V2_ENABLED, true);
}

export type TasksBootstrapV2Bundle = {
  core: TasksPageCoreData;
  projectsList: ProjectsListData;
};

function normalizeTaskRowFromApi(row: Record<string, unknown>): TaskRow {
  return {
    ...(row as TaskRow),
    priority: normalizeTaskPriority(row.priority),
  };
}

async function resolveDateContext(boundary?: TasksDayBoundary): Promise<{
  boundary: TasksDayBoundary;
  logicalToday: string;
  weekStart: string;
  weekEnd: string;
}> {
  const resolved = boundary ?? (await loadTasksDayBoundary());
  const logicalToday = getLogicalLocalYmd(new Date(), resolved);
  const { startYmd: weekStart, endYmd: weekEnd } = getCurrentWeekRange(logicalToday);
  return { boundary: resolved, logicalToday, weekStart, weekEnd };
}

function buildBootstrapV2Queries(
  projectTab: string,
  terminal: ReturnType<typeof resolveProjectsListTerminalTaskFilters> | Record<string, never>,
  includeShelved: boolean | undefined,
  pageCtx: { logicalToday: string; boundary: TasksDayBoundary },
  signal?: AbortSignal,
): TasksBootstrapV2Params[] {
  const base: TasksBootstrapV2Params = {
    dayBoundaryHour: pageCtx.boundary.hour,
    dayBoundaryMinute: pageCtx.boundary.minute,
    logicalToday: pageCtx.logicalToday,
    includeCompleted: 'includeCompleted' in terminal ? terminal.includeCompleted : undefined,
    includeCancelled: 'includeCancelled' in terminal ? terminal.includeCancelled : undefined,
    includeShelved,
    signal,
  };
  return resolveProjectsListQueries(projectTab).map((q) => ({
    ...base,
    categoryId: q.categoryId,
    categoryIds: q.categoryIds,
    uncategorized: q.uncategorized,
    projectId: q.projectId,
  }));
}

async function syncCategoryRows(
  projectCategories: Record<string, unknown>[],
  taskCategories: Record<string, unknown>[],
): Promise<void> {
  if (projectCategories.length > 0) {
    await withApiTableSyncLock('project_categories', async () => {
      await syncApiReadResultToLocal('project_categories', projectCategories);
    });
  }
  if (taskCategories.length > 0) {
    await withApiTableSyncLock('task_categories', async () => {
      await syncApiReadResultToLocal('task_categories', taskCategories);
    });
  }
}

function projectBelongsToTab(project: Pick<ProjectRow, 'category_id'>, projectTab: string): boolean {
  if (projectTab === 'all') return !isProjectInInboxCategory(project.category_id);
  if (projectTab === INBOX_PROJECT_CATEGORY_ID) return isProjectInInboxCategory(project.category_id);
  return String(project.category_id ?? '') === projectTab;
}

/**
 * 拉取 bootstrap-v2 并写入本地。
 * 收集箱 Tab 会打两次（uncategorized + inbox category）再合并项目树；standalone/分类取首包。
 */
export async function fetchTasksBootstrapV2Bundle(opts: {
  projectTab: string;
  boundary?: TasksDayBoundary;
  hideCompletedProjectTasks?: boolean;
  includeShelved?: boolean;
  forceRefresh?: boolean;
  forceLocal?: boolean;
  serverFallback?: boolean;
  signal?: AbortSignal;
}): Promise<TasksBootstrapV2Bundle | null> {
  if (!isTasksBootstrapV2ClientEnabled()) return null;
  if (shouldSkipPageNetwork({ forceLocal: opts.forceLocal, forceRefresh: opts.forceRefresh })) {
    return null;
  }

  const pageCtx = await resolveDateContext(opts.boundary);
  const terminal =
    opts.hideCompletedProjectTasks != null
      ? resolveProjectsListTerminalTaskFilters(opts.hideCompletedProjectTasks)
      : {};
  const queries = buildBootstrapV2Queries(
    opts.projectTab,
    terminal,
    opts.includeShelved,
    { logicalToday: pageCtx.logicalToday, boundary: pageCtx.boundary },
    opts.signal,
  );

  try {
    throwIfAborted(opts.signal);
    const payloads = await Promise.all(queries.map((q) => apiGetTasksBootstrapV2(q)));
    const primary = payloads[0];
    if (!primary) return null;

    const projectCategories = Array.isArray(primary.projectCategories)
      ? primary.projectCategories
      : [];
    const taskCategories = Array.isArray(primary.taskCategories) ? primary.taskCategories : [];
    await syncCategoryRows(projectCategories, taskCategories);

    const standaloneRaw = Array.isArray(primary.standaloneTodos) ? primary.standaloneTodos : [];
    const standaloneNormalized = standaloneRaw.map((row) =>
      normalizeTaskRowFromApi(
        typeof row === 'object' && row != null ? (row as Record<string, unknown>) : {},
      ),
    );
    if (standaloneNormalized.length > 0) {
      await withApiTableSyncLock('tasks', async () => {
        await syncApiReadResultToLocal(
          'tasks',
          standaloneNormalized as unknown as Record<string, unknown>[],
        );
      });
    }

    const mergedById = new Map<string, ApiProjectListItem>();
    for (const payload of payloads) {
      for (const project of Array.isArray(payload.projects) ? payload.projects : []) {
        const id = String(project.id ?? '').trim();
        if (!id) continue;
        const prev = mergedById.get(id);
        mergedById.set(id, prev ? { ...prev, ...project } : project);
      }
    }

    const omitTerminal =
      ('includeCompleted' in terminal && terminal.includeCompleted === false) ||
      ('includeCancelled' in terminal && terminal.includeCancelled === false);
    const projectsList = await ingestProjectsListApiItems([...mergedById.values()], {
      omitTerminalFromApi: omitTerminal,
      meta: {
        serverTime: primary.meta?.serverTime,
        includeCompleted:
          'includeCompleted' in terminal ? terminal.includeCompleted : undefined,
        includeCancelled:
          'includeCancelled' in terminal ? terminal.includeCancelled : undefined,
        tasksComplete: true,
      },
    });

    const tabProjects = projectsList.projects.filter((p) =>
      projectBelongsToTab(p, opts.projectTab),
    );

    const [localProjects, localProjectCategories, localTaskCategories] = await Promise.all([
      getProjects(),
      getProjectCategories(),
      getTaskCategories(),
    ]);

    const otherTabProjects = localProjects.filter((p) => !projectBelongsToTab(p, opts.projectTab));
    const mergedProjects = [...otherTabProjects, ...tabProjects];

    const standaloneTodos = await resolveStandaloneTodosList(standaloneNormalized, true, {
      taskView: 'standaloneTodos',
      boundary: pageCtx.boundary,
      logicalToday: pageCtx.logicalToday,
      weekStart: pageCtx.weekStart,
      weekEnd: pageCtx.weekEnd,
    });

    return {
      core: {
        logicalToday: pageCtx.logicalToday,
        weekStart: pageCtx.weekStart,
        weekEnd: pageCtx.weekEnd,
        standaloneTodos,
        standaloneServerFiltered: true,
        filtersVersion: TASKS_PAGE_FILTERS_VERSION,
        projects: mergedProjects,
        projectCategories: localProjectCategories,
        taskCategories: localTaskCategories,
      },
      projectsList: {
        ...projectsList,
        projects: tabProjects,
      },
    };
  } catch (e) {
    if (isAbortError(e)) throw e;
    if (e instanceof ApiRequestError && (e.httpStatus === 404 || e.httpStatus === 410)) {
      console.warn('[tasks-bootstrap-v2] 未启用或不可用，回退分批加载', e.message);
      return null;
    }
    if (opts.serverFallback === false) throw e;
    console.warn('[tasks-bootstrap-v2] 拉取失败，回退分批加载', e);
    return null;
  }
}
