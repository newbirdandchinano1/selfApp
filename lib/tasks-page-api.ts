import {

  apiGetTasksBootstrap,

  type TasksBootstrapPayload,

  type TasksPageFilteredMeta,

} from '@/lib/api-client';

import { withApiTableSyncLock } from '@/lib/api-read';

import { syncApiReadResultToLocal } from '@/lib/api-read-local-sync';

import { throwIfAborted } from '@/lib/cloud-fetch-retry';

import { sortByUpdatedDesc } from '@/lib/api-read-helpers';

import {

  INBOX_PROJECT_CATEGORY_ID,

  isProjectInInboxCategory,

} from '@/lib/repositories/projects/constants';

import { getProjectCategories, getProjects } from '@/lib/repositories/projects/project';

import type { ProjectCategoryRow, ProjectRow } from '@/lib/repositories/projects/project.types';

import { getTaskCategories, getTasks } from '@/lib/repositories/tasks/task';

import type { TaskCategoryRow, TaskRow } from '@/lib/repositories/tasks/task.types';

import { getCurrentWeekRange } from '@/lib/repositories/insights/weekly-review';

import { overlayLocalPendingOnApiTableRows } from '@/lib/api-read-pending-overlay';

import { fetchTasksCatalog } from '@/lib/tasks-catalog-api';

import { syncTasksTableFromApi } from '@/lib/tasks-table-sync';

import { isStandaloneTodoTask } from '@/lib/standalone-todo-task';

import {

  getLogicalLocalYmd,

  loadTasksDayBoundary,

  logicalYmdToLocalDate,

  type TasksDayBoundary,

} from '@/lib/tasks-logical-day';

import {

  isStandaloneTodoRepeatWaiting,

  standaloneTodoPassesDayBoundaryFilter,

  standaloneTodoPassesStandaloneListFilter,

} from '@/lib/standalone-todo-visibility';

import { taskHasRepeatingSchedule } from '@/lib/task-repeat-rollover';



export const TASKS_PAGE_FILTERS_VERSION = 'tasks-page-v1';

/** 待办栏单视图请求分页上限（与后端契约一致） */
export const STANDALONE_TODOS_API_PAGE_LIMIT = 200;



export type TasksPageTaskView = 'standaloneTodos' | 'matrixWeek';



export type TasksViewData = {

  logicalToday: string;

  weekStart: string;

  weekEnd: string;

  tasks: TaskRow[];

  serverFiltered: boolean;

  filtersVersion: string | null;

};



export type TasksPageData = {

  logicalToday: string;

  weekStart: string;

  weekEnd: string;

  standaloneTodos: TaskRow[];

  matrixWeekTasks: TaskRow[];

  standaloneServerFiltered: boolean;

  matrixServerFiltered: boolean;

  filtersVersion: string | null;

  projects: ProjectRow[];

  projectCategories: ProjectCategoryRow[];

  taskCategories: TaskCategoryRow[];

};



const TASKS_PAGE_INCLUDE = 'tasks';



function readTasksPageFilteredMeta(

  meta: Record<string, unknown> | undefined,

): TasksPageFilteredMeta | undefined {

  if (!meta || typeof meta !== 'object') return undefined;

  return meta as TasksPageFilteredMeta;

}



function isServerFilteredTasksPage(meta: TasksPageFilteredMeta | undefined): boolean {

  return meta?.serverFiltered === true && meta?.filtersVersion === TASKS_PAGE_FILTERS_VERSION;

}



/** 待办栏单视图 meta 校验（须 taskView=standaloneTodos 且 tasksScope 一致） */
export function isServerFilteredStandaloneTodos(meta: TasksPageFilteredMeta | undefined): boolean {

  return (

    meta?.serverFiltered === true &&

    meta?.filtersVersion === TASKS_PAGE_FILTERS_VERSION &&

    meta?.tasksScope === 'standaloneTodos'

  );

}



function isServerFilteredMatrixWeek(meta: TasksPageFilteredMeta | undefined): boolean {

  return (

    meta?.serverFiltered === true &&

    meta?.filtersVersion === TASKS_PAGE_FILTERS_VERSION &&

    meta?.tasksScope === 'matrixWeek'

  );

}



function isServerFilteredTaskView(

  taskView: TasksPageTaskView,

  meta: TasksPageFilteredMeta | undefined,

): boolean {

  if (taskView === 'standaloneTodos') return isServerFilteredStandaloneTodos(meta);

  if (taskView === 'matrixWeek') return isServerFilteredMatrixWeek(meta);

  return isServerFilteredTasksPage(meta);

}



async function syncTasksPageTableRows(

  tableName: string,

  rows: Record<string, unknown>[],

): Promise<void> {

  if (rows.length === 0) return;

  await withApiTableSyncLock(tableName, async () => {

    await syncApiReadResultToLocal(tableName, rows);

  });

}



async function resolveTasksPageDateContext(boundary?: TasksDayBoundary): Promise<{

  boundary: TasksDayBoundary;

  logicalToday: string;

  weekStart: string;

  weekEnd: string;

}> {

  const resolved = boundary ?? (await loadTasksDayBoundary());

  const logicalToday = getLogicalLocalYmd(new Date(), resolved);

  const weekRange = getCurrentWeekRange(logicalYmdToLocalDate(logicalToday));

  return {

    boundary: resolved,

    logicalToday,

    weekStart: weekRange.startYmd,

    weekEnd: weekRange.endYmd,

  };

}



/** 本周列表 Tab → bootstrap matrixWeek 的 projectIds 参数 */

export function resolveMatrixProjectIds(

  projects: ProjectRow[],

  taskTab: string,

): string | undefined {

  let ids: string[];

  if (taskTab === 'all') {

    ids = projects.filter((p) => !isProjectInInboxCategory(p.category_id)).map((p) => p.id);

  } else if (taskTab === INBOX_PROJECT_CATEGORY_ID) {

    ids = projects.filter((p) => isProjectInInboxCategory(p.category_id)).map((p) => p.id);

  } else {

    ids = projects.filter((p) => p.category_id === taskTab).map((p) => p.id);

  }

  const trimmed = ids.map((id) => id.trim()).filter(Boolean);

  return trimmed.length > 0 ? trimmed.join(',') : undefined;

}



/**
 * 未完成在前 → 未到执行日的重复待办置底 → 搁置置底 → 已完成/取消置底；
 * 组内按优先级降序，其次按截止/创建时间升序。
 */
export function sortStandaloneTodosLocally(rows: TaskRow[], logicalTodayYmd?: string): TaskRow[] {

  const isDoneRow = (t: TaskRow) => t.status === 'done' || t.status === 'cancelled';

  const createdMs = (t: TaskRow) => {

    const ms = Date.parse(t.created_at);

    return Number.isNaN(ms) ? 0 : ms;

  };

  const dueMs = (t: TaskRow) => {

    if (!t.due_date) return Number.POSITIVE_INFINITY;

    const ms = Date.parse(t.due_date);

    return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms;

  };

  const isWaiting = (t: TaskRow) =>
    !!logicalTodayYmd && isStandaloneTodoRepeatWaiting(t, logicalTodayYmd);

  return rows.slice().sort((a, b) => {

    const da = isDoneRow(a);

    const db = isDoneRow(b);

    if (da !== db) return da ? 1 : -1;

    const sa = a.status === 'shelved';

    const sb = b.status === 'shelved';

    if (sa !== sb) return sa ? 1 : -1;

    const wa = isWaiting(a);

    const wb = isWaiting(b);

    if (wa !== wb) return wa ? 1 : -1;

    if (a.priority !== b.priority) return b.priority - a.priority;

    const byDue = dueMs(a) - dueMs(b);

    if (byDue !== 0) return byDue;

    const byCreated = createdMs(a) - createdMs(b);

    if (byCreated !== 0) return byCreated;

    return a.id.localeCompare(b.id);

  });

}



function filterStandaloneTodosOffline(

  rows: TaskRow[],

  boundary: TasksDayBoundary,

  logicalToday: string,

): TaskRow[] {

  return sortStandaloneTodosLocally(

    rows.filter((t) => standaloneTodoPassesStandaloneListFilter(t, boundary, logicalToday)),

    logicalToday,

  );

}



function filterMatrixWeekOffline(

  rows: TaskRow[],

  weekStart: string,

  weekEnd: string,

  logicalToday: string,

  projects: ProjectRow[],

  taskTab: string,

): TaskRow[] {

  const projectById = new Map(projects.map((p) => [p.id, p]));

  const taskById = new Map(rows.map((t) => [t.id, t]));



  const resolveCategoryId = (task: TaskRow): string | null => {

    if (task.project_id) {

      const project = projectById.get(task.project_id);

      if (project) {

        return project.category_id ?? INBOX_PROJECT_CATEGORY_ID;

      }

    }

    if (task.parent_task_id) {

      const parent = taskById.get(task.parent_task_id);

      if (parent) return resolveCategoryId(parent);

    }

    return task.category_id ?? INBOX_PROJECT_CATEGORY_ID;

  };



  const inWeek = (t: TaskRow) => {

    const due = t.due_date?.slice(0, 10);

    if (due && due >= weekStart && due <= weekEnd) return true;

    if (due && due < logicalToday) return true;

    return false;

  };



  return rows.filter((t) => {

    if (!t.project_id && !t.parent_task_id) return false;

    if (!inWeek(t)) return false;

    const catId = resolveCategoryId(t);

    if (taskTab === 'all') return !isProjectInInboxCategory(catId);

    return catId === taskTab;

  });

}



async function pullTasksViewFromApi(opts: {

  taskView: TasksPageTaskView;

  boundary: TasksDayBoundary;

  logicalToday: string;

  weekStart: string;

  weekEnd: string;

  projectIds?: string;

  signal?: AbortSignal;

}): Promise<{ tasks: TaskRow[]; meta: TasksPageFilteredMeta | undefined }> {

  const { taskView, boundary, logicalToday, weekStart, weekEnd, projectIds, signal } = opts;

  const allTasks: Record<string, unknown>[] = [];

  let page = 1;

  let totalPages = 1;

  let firstMeta: TasksPageFilteredMeta | undefined;



  while (page <= totalPages) {

    throwIfAborted(signal);



    const payload = await apiGetTasksBootstrap({

      include: TASKS_PAGE_INCLUDE,

      taskView,

      logicalToday,

      weekStart,

      weekEnd,

      projectIds,

      dayBoundaryHour: boundary.hour,

      dayBoundaryMinute: boundary.minute,

      page,

      limit: taskView === 'standaloneTodos' ? STANDALONE_TODOS_API_PAGE_LIMIT : undefined,

      includeShelved: taskView === 'standaloneTodos' ? true : undefined,

      signal,

    });



    const meta = readTasksPageFilteredMeta(payload.meta);

    if (page === 1) {

      firstMeta = meta;

      totalPages =

        typeof meta?.totalPages === 'number' && meta.totalPages > 0 ? meta.totalPages : 1;

    }



    const tasks = Array.isArray(payload.tasks) ? payload.tasks : [];

    allTasks.push(...tasks);

    page += 1;

  }



  if (allTasks.length > 0) {

    await syncTasksPageTableRows('tasks', allTasks);

  }



  return {

    tasks: allTasks as TaskRow[],

    meta: firstMeta,

  };

}



function buildTasksViewData(

  ctx: { logicalToday: string; weekStart: string; weekEnd: string },

  meta: TasksPageFilteredMeta | undefined,

  tasks: TaskRow[],

  taskView: TasksPageTaskView,

): TasksViewData {

  const serverFiltered = isServerFilteredTaskView(taskView, meta);

  if (!serverFiltered) {

    console.warn(

      `[tasks-page-api] ${taskView} 响应 meta 未通过校验（tasksScope=${meta?.tasksScope ?? 'unknown'}）`,

    );

  }

  const orderedTasks =

    taskView === 'standaloneTodos' ? sortStandaloneTodosLocally(tasks, ctx.logicalToday) : tasks;

  return {

    logicalToday: ctx.logicalToday,

    weekStart: ctx.weekStart,

    weekEnd: ctx.weekEnd,

    tasks: orderedTasks,

    serverFiltered,

    filtersVersion: typeof meta?.filtersVersion === 'string' ? meta.filtersVersion : null,

  };

}



type ReadTasksViewFromLocalOpts = {

  taskView: TasksPageTaskView;

  boundary: TasksDayBoundary;

  logicalToday: string;

  weekStart: string;

  weekEnd: string;

  projects?: ProjectRow[];

  taskTab?: string;

};



/** 待办栏列表：meta 已校验时信任 API 返回的 done/cancelled；否则全量本地筛选 */
async function resolveStandaloneTodosList(

  apiTasks: TaskRow[],

  serverFiltered: boolean,

  localReadOpts: ReadTasksViewFromLocalOpts,

): Promise<TaskRow[]> {

  const { boundary, logicalToday } = localReadOpts;

  if (serverFiltered) {

    const fromApi = apiTasks.filter((t) => isStandaloneTodoTask(t));

    const withPending = (await overlayLocalPendingOnApiTableRows(

      'tasks',

      fromApi as Record<string, unknown>[],

    )) as TaskRow[];

    const apiIds = new Set(withPending.map((t) => String(t.id)));

    const extras: TaskRow[] = [];

    for (const t of await getTasks()) {

      if (!isStandaloneTodoTask(t) || apiIds.has(String(t.id))) continue;

      const syncStatus = String(t.sync_status ?? 'synced');

      // 服务端筛选列表已权威：缺席的「已同步未完成」待办视为他端已完成/移出，禁止再拼回未完成。
      // 仅保留尚未上传的本地新建、本地已完成且仍落在今日日界内的行，
      // 以及可能仍被旧版服务端按「非重复日」隐藏的开放重复待办。
      if (t.status === 'done' || t.status === 'cancelled') {

        if (standaloneTodoPassesDayBoundaryFilter(t, boundary, logicalToday)) extras.push(t);

      } else if (syncStatus === 'pending_create') {

        if (standaloneTodoPassesStandaloneListFilter(t, boundary, logicalToday)) {

          extras.push(t);

        }

      } else if (
        taskHasRepeatingSchedule(t.extra_data) &&
        standaloneTodoPassesStandaloneListFilter(t, boundary, logicalToday)
      ) {

        extras.push(t);

      }

    }

    return sortStandaloneTodosLocally([...withPending, ...extras], logicalToday);

  }

  return filterStandaloneTodosOffline(await getTasks(), boundary, logicalToday);

}



async function finalizeTasksViewFromApi(

  ctx: { logicalToday: string; weekStart: string; weekEnd: string },

  taskView: TasksPageTaskView,

  apiResult: { tasks: TaskRow[]; meta: TasksPageFilteredMeta | undefined },

  localReadOpts: ReadTasksViewFromLocalOpts,

  offlineFallback?: boolean,

): Promise<TasksViewData> {

  const viewData = buildTasksViewData(ctx, apiResult.meta, apiResult.tasks, taskView);

  if (offlineFallback !== false && taskView === 'standaloneTodos') {

    const tasks = await resolveStandaloneTodosList(

      apiResult.tasks,

      viewData.serverFiltered,

      localReadOpts,

    );

    return {

      ...ctx,

      tasks,

      serverFiltered: viewData.serverFiltered,

      filtersVersion: viewData.filtersVersion,

    };

  }

  return viewData;

}



async function readTasksViewFromLocal(opts: {

  taskView: TasksPageTaskView;

  boundary: TasksDayBoundary;

  logicalToday: string;

  weekStart: string;

  weekEnd: string;

  projects?: ProjectRow[];

  taskTab?: string;

}): Promise<TaskRow[]> {

  const rows = await getTasks();

  if (opts.taskView === 'standaloneTodos') {

    return filterStandaloneTodosOffline(rows, opts.boundary, opts.logicalToday);

  }

  const projects = opts.projects ?? (await getProjects());

  return filterMatrixWeekOffline(

    rows,

    opts.weekStart,

    opts.weekEnd,

    opts.logicalToday,

    projects,

    opts.taskTab ?? 'all',

  );

}



async function pullTasksView(opts: {

  taskView: TasksPageTaskView;

  boundary?: TasksDayBoundary;

  projectIds?: string;

  taskTab?: string;

  projects?: ProjectRow[];

  offlineFallback?: boolean;

  forceLocal?: boolean;

  forceRefresh?: boolean;

  signal?: AbortSignal;

}): Promise<TasksViewData> {

  const { boundary, logicalToday, weekStart, weekEnd } = await resolveTasksPageDateContext(opts.boundary);

  const ctx = { logicalToday, weekStart, weekEnd };



  if (!opts?.forceLocal) {

    try {

      const result = await pullTasksViewFromApi({

        taskView: opts.taskView,

        boundary,

        logicalToday,

        weekStart,

        weekEnd,

        projectIds: opts.projectIds,

        signal: opts.signal,

      });

      return finalizeTasksViewFromApi(

        ctx,

        opts.taskView,

        result,

        {

          taskView: opts.taskView,

          boundary,

          logicalToday,

          weekStart,

          weekEnd,

          projects: opts.projects,

          taskTab: opts.taskTab,

        },

        opts.offlineFallback,

      );

    } catch (e) {

      if (!opts?.offlineFallback) throw e;

      console.warn(`[tasks-page-api] ${opts.taskView} 接口失败，回退本地 SQLite`, e);

    }

  }



  const tasks = await readTasksViewFromLocal({

    taskView: opts.taskView,

    boundary,

    logicalToday,

    weekStart,

    weekEnd,

    projects: opts.projects,

    taskTab: opts.taskTab,

  });

  return {

    ...ctx,

    tasks,

    serverFiltered: false,

    filtersVersion: null,

  };

}



/** 待办区：`GET /api/pages/tasks?taskView=standaloneTodos` */

export async function fetchStandaloneTodos(opts?: {

  boundary?: TasksDayBoundary;

  offlineFallback?: boolean;

  forceLocal?: boolean;

  forceRefresh?: boolean;

  signal?: AbortSignal;

}): Promise<TasksViewData> {

  return pullTasksView({ ...opts, taskView: 'standaloneTodos' });

}



/** 本周四象限：`GET /api/pages/tasks?taskView=matrixWeek` */

export async function fetchMatrixWeekTasks(opts?: {

  boundary?: TasksDayBoundary;

  projectIds?: string;

  taskTab?: string;

  projects?: ProjectRow[];

  offlineFallback?: boolean;

  forceLocal?: boolean;

  forceRefresh?: boolean;

  signal?: AbortSignal;

}): Promise<TasksViewData> {

  return pullTasksView({ ...opts, taskView: 'matrixWeek' });

}



async function pullTasksPageFromApi(opts: {

  boundary: TasksDayBoundary;

  logicalToday: string;

  weekStart: string;

  weekEnd: string;

  matrixProjectIds?: string;

  taskTab?: string;

  forceRefresh?: boolean;

  signal?: AbortSignal;

}): Promise<{

  catalog: {

    projects: ProjectRow[];

    projectCategories: ProjectCategoryRow[];

    taskCategories: TaskCategoryRow[];

  };

  standalone: TasksViewData;

  matrix: TasksViewData;

}> {

  const { boundary, logicalToday, weekStart, weekEnd, matrixProjectIds, taskTab, forceRefresh, signal } =

    opts;



  // 先增量合并全表 tasks（含他端完成），再拉筛选视图；避免筛选结果缺行时本地仍显示未完成
  try {
    await syncTasksTableFromApi({ forceRefresh, signal });
  } catch (e) {
    console.warn('[tasks-page-api] tasks 表增量同步失败，继续拉筛选视图', e);
  }

  const catalog = await fetchTasksCatalog({ forceRefresh, signal, offlineFallback: false });

  const resolvedMatrixProjectIds =
    matrixProjectIds ?? resolveMatrixProjectIds(catalog.projects, taskTab ?? 'all');

  const [standaloneResult, matrixResult] = await Promise.all([

    pullTasksViewFromApi({

      taskView: 'standaloneTodos',

      boundary,

      logicalToday,

      weekStart,

      weekEnd,

      signal,

    }),

    pullTasksViewFromApi({

      taskView: 'matrixWeek',

      boundary,

      logicalToday,

      weekStart,

      weekEnd,

      projectIds: resolvedMatrixProjectIds,

      signal,

    }),

  ]);



  const pageCtx = { logicalToday, weekStart, weekEnd };

  const [standalone, matrix] = await Promise.all([

    finalizeTasksViewFromApi(

      pageCtx,

      'standaloneTodos',

      standaloneResult,

      {

        taskView: 'standaloneTodos',

        boundary,

        logicalToday,

        weekStart,

        weekEnd,

      },

      true,

    ),

    finalizeTasksViewFromApi(

      pageCtx,

      'matrixWeek',

      matrixResult,

      {

        taskView: 'matrixWeek',

        boundary,

        logicalToday,

        weekStart,

        weekEnd,

        projects: catalog.projects,

        taskTab: taskTab ?? 'all',

      },

      true,

    ),

  ]);

  return {

    catalog,

    standalone,

    matrix,

  };

}



async function readTasksPageFromLocal(

  boundary: TasksDayBoundary,

  taskTab = 'all',

): Promise<TasksPageData> {

  const { logicalToday, weekStart, weekEnd } = await resolveTasksPageDateContext(boundary);

  const [projects, projectCategories, taskCategories] = await Promise.all([

    getProjects(),

    getProjectCategories(),

    getTaskCategories(),

  ]);

  const standaloneTodos = await readTasksViewFromLocal({

    taskView: 'standaloneTodos',

    boundary,

    logicalToday,

    weekStart,

    weekEnd,

  });

  const matrixWeekTasks = await readTasksViewFromLocal({

    taskView: 'matrixWeek',

    boundary,

    logicalToday,

    weekStart,

    weekEnd,

    projects,

    taskTab,

  });

  return {

    logicalToday,

    weekStart,

    weekEnd,

    standaloneTodos,

    matrixWeekTasks,

    standaloneServerFiltered: false,

    matrixServerFiltered: false,

    filtersVersion: null,

    projects,

    projectCategories,

    taskCategories,

  };

}



/**

 * 任务页读数：catalog + standaloneTodos + matrixWeek 并行拉取，失败且允许时回退 SQLite。

 */

export async function fetchTasksPageData(opts?: {

  boundary?: TasksDayBoundary;

  matrixProjectIds?: string;

  taskTab?: string;

  offlineFallback?: boolean;

  forceLocal?: boolean;

  forceRefresh?: boolean;

  signal?: AbortSignal;

}): Promise<TasksPageData> {

  const { boundary, logicalToday, weekStart, weekEnd } = await resolveTasksPageDateContext(opts?.boundary);



  if (!opts?.forceLocal) {

    try {

      const pulled = await pullTasksPageFromApi({

        boundary,

        logicalToday,

        weekStart,

        weekEnd,

        matrixProjectIds: opts?.matrixProjectIds,

        taskTab: opts?.taskTab,

        forceRefresh: opts?.forceRefresh,

        signal: opts?.signal,

      });

      return {

        logicalToday,

        weekStart,

        weekEnd,

        standaloneTodos: pulled.standalone.tasks,

        matrixWeekTasks: pulled.matrix.tasks,

        standaloneServerFiltered: pulled.standalone.serverFiltered,

        matrixServerFiltered: pulled.matrix.serverFiltered,

        filtersVersion: pulled.standalone.filtersVersion ?? pulled.matrix.filtersVersion,

        projects: pulled.catalog.projects,

        projectCategories: pulled.catalog.projectCategories,

        taskCategories: pulled.catalog.taskCategories,

      };

    } catch (e) {

      if (!opts?.offlineFallback) throw e;

      console.warn('[tasks-page-api] 任务页接口失败，回退本地 SQLite', e);

    }

  }



  return readTasksPageFromLocal(boundary, opts?.taskTab ?? 'all');

}

