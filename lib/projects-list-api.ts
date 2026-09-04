import {
  apiGetProjectsList,
  type ApiProjectListItem,
  type ApiTaskTreeNode,
  type PageListMeta,
  type ProjectsListQueryParams,
} from '@/lib/api-client';
import { withApiTableSyncLock } from '@/lib/api-read';
import { syncApiReadResultToLocal } from '@/lib/api-read-local-sync';
import { ensureLocalRowPresent } from '@/lib/api-local-row';
import { throwIfAborted } from '@/lib/cloud-fetch-retry';
import { compareDatetimeDesc } from '@/lib/api-read-helpers';
import {
  INBOX_PROJECT_CATEGORY_ID,
  isProjectInInboxCategory,
} from '@/lib/repositories/projects/constants';
import type { ProjectRow } from '@/lib/repositories/projects/project.types';
import {
  buildTaskTreeFromRows,
  countTaskTreeNodes,
  getProjectTaskTreeMap,
  getTasksByProjectId,
  type TaskTreeNode,
} from '@/lib/repositories/tasks/task';
import type { TaskRow } from '@/lib/repositories/tasks/task.types';
import { isTaskTerminalStatus } from '@/lib/repositories/tasks/task.types';
import { ensureTaskCategoryMirrorLocally } from '@/lib/repositories/tasks/task-category-mirror';
import { syncTasksTableFromApi } from '@/lib/tasks-table-sync';

const PROJECTS_LIST_PAGE_LIMIT = 200;
const PROJECTS_LIST_MAX_PAGES = 500;

export type ProjectsListData = {
  projects: ProjectRow[];
  projectTaskTreeMap: Record<string, TaskTreeNode[]>;
  meta?: PageListMeta;
};

export type ProjectsListFetchOpts = Omit<ProjectsListQueryParams, 'page' | 'limit'> & {
  forceRefresh?: boolean;
  offlineFallback?: boolean;
  /** 与任务页「隐藏已完成任务」开关联动；优先于 includeCompleted / includeCancelled */
  hideCompletedProjectTasks?: boolean;
};

/** 将 projects-list 接口结果并入已有列表（按 id 覆盖，updated_at 降序） */
export function mergeProjectRowsById(existing: ProjectRow[], fromApi: ProjectRow[]): ProjectRow[] {
  const map = new Map(existing.map((p) => [String(p.id), p]));
  for (const p of fromApi) {
    map.set(String(p.id), p);
  }
  return [...map.values()].sort((a, b) => compareDatetimeDesc(a.updated_at, b.updated_at));
}

export { countTaskTreeNodes };

/** 拍平任务树后按 id 去重，再按 parent_task_id 重组（两棵残缺树取并集） */
export function unionProjectTaskTrees(a: TaskTreeNode[], b: TaskTreeNode[]): TaskTreeNode[] {
  return buildTaskTreeFromRows(
    dedupeTaskRowsById([...flattenTaskTree(a), ...flattenTaskTree(b)]),
  );
}

/** 按项目合并任务树：同一项目取节点并集，其它项目保留 */
export function mergeProjectTaskTreeMaps(
  existing: Record<string, TaskTreeNode[]>,
  incoming: Record<string, TaskTreeNode[]>,
): Record<string, TaskTreeNode[]> {
  const next: Record<string, TaskTreeNode[]> = { ...existing };
  for (const [projectId, tree] of Object.entries(incoming)) {
    const prev = next[projectId];
    if (!prev || prev.length === 0) {
      next[projectId] = tree;
      continue;
    }
    if (!tree || tree.length === 0) continue;
    next[projectId] = unionProjectTaskTrees(prev, tree);
  }
  return next;
}

/**
 * 「隐藏已完成任务」开关 → GET /api/pages/projects 的状态过滤参数。
 * 隐藏时必须显式传 false；显示时不传（后端默认返回已完成）。
 */
export function resolveProjectsListTerminalTaskFilters(hideCompletedProjectTasks: boolean): Pick<
  ProjectsListQueryParams,
  'includeCompleted' | 'includeCancelled'
> {
  if (hideCompletedProjectTasks) {
    return {
      includeCompleted: false,
      includeCancelled: false,
    };
  }
  return {};
}

function warnProjectsListMetaMismatch(
  query: ProjectsListQueryParams,
  meta: PageListMeta | undefined,
): void {
  if (!__DEV__ || !meta) return;
  if (query.includeCompleted === false && meta.includeCompleted !== false) {
    console.warn(
      '[projects-list-api] 请求 includeCompleted=false，但响应 meta.includeCompleted 不为 false',
      meta,
    );
  }
  if (query.includeCompleted === true && meta.includeCompleted !== true) {
    console.warn(
      '[projects-list-api] 请求 includeCompleted=true，但响应 meta.includeCompleted 不为 true',
      meta,
    );
  }
  if (query.includeCancelled === false && meta.includeCancelled !== false) {
    console.warn(
      '[projects-list-api] 请求 includeCancelled=false，但响应 meta.includeCancelled 不为 false',
      meta,
    );
  }
}

function readTaskCountHint(project: ApiProjectListItem): number | undefined {
  const raw = project.taskCount ?? project.task_count;
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) return raw;
  const n = typeof raw === 'string' ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function flattenApiTaskNodes(
  nodes: ApiTaskTreeNode[] | undefined,
  parentId: string | null = null,
): TaskRow[] {
  if (!Array.isArray(nodes)) return [];
  const rows: TaskRow[] = [];
  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue;
    const { children, ...rest } = node;
    const id = String(rest.id ?? '').trim();
    if (!id) continue;
    const explicitParent =
      rest.parent_task_id != null && String(rest.parent_task_id).trim() !== ''
        ? String(rest.parent_task_id).trim()
        : null;
    rows.push({
      ...(rest as TaskRow),
      id,
      parent_task_id: explicitParent ?? parentId,
    });
    if (Array.isArray(children) && children.length > 0) {
      rows.push(...flattenApiTaskNodes(children, id));
    }
  }
  return rows;
}

function flattenTaskTree(nodes: TaskTreeNode[], parentTaskId: string | null = null): TaskRow[] {
  const rows: TaskRow[] = [];
  const walk = (node: TaskTreeNode, parentId: string | null) => {
    const { children, ...rest } = node;
    const explicitParent =
      rest.parent_task_id != null && String(rest.parent_task_id).trim() !== ''
        ? String(rest.parent_task_id).trim()
        : null;
    rows.push({
      ...(rest as TaskRow),
      parent_task_id: explicitParent ?? parentId,
    });
    for (const child of children ?? []) {
      walk(child, String(node.id));
    }
  };
  for (const node of nodes) walk(node, parentTaskId);
  return rows;
}

function dedupeTaskRowsById(rows: TaskRow[]): TaskRow[] {
  const map = new Map<string, TaskRow>();
  for (const row of rows) {
    const id = String(row.id ?? '').trim();
    if (!id) continue;
    const prev = map.get(id);
    if (!prev) {
      map.set(id, row);
      continue;
    }
    const prevUp = String(prev.updated_at ?? '');
    const nextUp = String(row.updated_at ?? '');
    map.set(id, nextUp >= prevUp ? { ...prev, ...row } : { ...row, ...prev });
  }
  return [...map.values()];
}

function mergeApiProjectListItem(
  existing: ApiProjectListItem | undefined,
  incoming: ApiProjectListItem,
): ApiProjectListItem {
  if (!existing) return incoming;
  const mergedTasks = dedupeTaskRowsById([
    ...flattenApiTaskNodes(existing.tasks),
    ...flattenApiTaskNodes(incoming.tasks),
  ]);
  const existingCount = readTaskCountHint(existing);
  const incomingCount = readTaskCountHint(incoming);
  const taskCount =
    existingCount != null && incomingCount != null
      ? Math.max(existingCount, incomingCount)
      : (incomingCount ?? existingCount);
  return {
    ...existing,
    ...incoming,
    ...(taskCount != null ? { taskCount } : {}),
    tasks: mergedTasks as unknown as ApiTaskTreeNode[],
  };
}

function buildProjectTaskTreeMap(list: ApiProjectListItem[]): Record<string, TaskTreeNode[]> {
  const map: Record<string, TaskTreeNode[]> = {};
  for (const project of list) {
    const projectId = String(project.id ?? '').trim();
    if (!projectId) continue;
    const rows = dedupeTaskRowsById(flattenApiTaskNodes(project.tasks));
    map[projectId] = buildTaskTreeFromRows(rows);
    const hinted = readTaskCountHint(project);
    const got = countTaskTreeNodes(map[projectId]);
    if (hinted != null && got < hinted) {
      console.warn(
        `[projects-list-api] 项目 ${projectId} 任务树不完整：接口树 ${got} / taskCount ${hinted}`,
      );
    }
  }
  return map;
}

function normalizeProjectRow(row: ApiProjectListItem): ProjectRow {
  const { tasks: _tasks, taskCount: _taskCount, task_count: _taskCountSnake, ...rest } = row;
  return rest as ProjectRow;
}

/** 父任务先于子任务，避免同批写入时 parent_task_id 外键失败 */
function sortTaskRowsParentsFirst(rows: TaskRow[]): TaskRow[] {
  const byId = new Map(rows.map((r) => [String(r.id), r]));
  const depthMemo = new Map<string, number>();

  const depthOf = (id: string, visiting = new Set<string>()): number => {
    const cached = depthMemo.get(id);
    if (cached != null) return cached;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const row = byId.get(id);
    const parentId = row?.parent_task_id ? String(row.parent_task_id).trim() : '';
    const d = parentId && byId.has(parentId) ? depthOf(parentId, visiting) + 1 : 0;
    visiting.delete(id);
    depthMemo.set(id, d);
    return d;
  };

  return [...rows].sort((a, b) => {
    const da = depthOf(String(a.id));
    const db = depthOf(String(b.id));
    if (da !== db) return da - db;
    return String(a.id).localeCompare(String(b.id));
  });
}

async function ensureProjectCategoryRefsForProjects(projects: ProjectRow[]): Promise<void> {
  const categoryIds = new Set<string>([INBOX_PROJECT_CATEGORY_ID]);
  for (const project of projects) {
    const cid = String(project.category_id ?? '').trim();
    if (cid) categoryIds.add(cid);
  }
  for (const cid of categoryIds) {
    await ensureLocalRowPresent('project_categories', cid);
    await ensureTaskCategoryMirrorLocally(cid);
  }
}

async function syncProjectsListRows(
  projects: ProjectRow[],
  taskRows: TaskRow[],
): Promise<void> {
  await ensureProjectCategoryRefsForProjects(projects);

  if (projects.length > 0) {
    await withApiTableSyncLock('projects', async () => {
      for (const project of projects) {
        await syncApiReadResultToLocal('projects', [project as Record<string, unknown>]);
      }
    });
  }

  const sortedTasks = sortTaskRowsParentsFirst(taskRows);
  if (sortedTasks.length > 0) {
    await withApiTableSyncLock('tasks', async () => {
      for (const task of sortedTasks) {
        await syncApiReadResultToLocal('tasks', [task as Record<string, unknown>]);
      }
    });
  }
}

async function pullProjectsListPage(
  query: ProjectsListQueryParams,
  page: number,
): Promise<{ list: ApiProjectListItem[]; totalPages: number; meta?: PageListMeta }> {
  const res = await apiGetProjectsList({
    ...query,
    page,
    limit: query.limit ?? PROJECTS_LIST_PAGE_LIMIT,
    signal: query.signal,
  });
  const totalPages =
    typeof res.pagination.totalPages === 'number' && res.pagination.totalPages > 0
      ? res.pagination.totalPages
      : 1;
  return { list: res.list, totalPages, meta: res.meta };
}

async function pullProjectsListAllPages(
  query: ProjectsListQueryParams,
): Promise<{ list: ApiProjectListItem[]; meta?: PageListMeta }> {
  const mergedById = new Map<string, ApiProjectListItem>();
  let page = 1;
  let meta: PageListMeta | undefined;

  while (page <= PROJECTS_LIST_MAX_PAGES) {
    throwIfAborted(query.signal);
    const batch = await pullProjectsListPage(query, page);
    if (page === 1) meta = batch.meta;
    let addedNewProject = false;
    let grewTaskTree = false;
    for (const project of batch.list) {
      const id = String(project.id ?? '').trim();
      if (!id) continue;
      const prev = mergedById.get(id);
      if (!prev) addedNewProject = true;
      const merged = mergeApiProjectListItem(prev, project);
      if (prev) {
        const prevN = flattenApiTaskNodes(prev.tasks).length;
        const nextN = flattenApiTaskNodes(merged.tasks).length;
        if (nextN > prevN) grewTaskTree = true;
      }
      mergedById.set(id, merged);
    }
    const gotFullPage = batch.list.length >= (query.limit ?? PROJECTS_LIST_PAGE_LIMIT);
    const moreByMeta = page < batch.totalPages;
    if (!addedNewProject && !grewTaskTree && !moreByMeta) break;
    if (!addedNewProject && !grewTaskTree) break;
    if (!gotFullPage && !moreByMeta) break;
    page += 1;
  }

  return { list: [...mergedById.values()], meta };
}

/** 将任务页项目 Tab 映射为列表接口 query（收集箱需两次请求合并） */
export function resolveProjectsListQueries(projectTab: string): ProjectsListQueryParams[] {
  if (projectTab === 'all') return [{}];
  if (projectTab === INBOX_PROJECT_CATEGORY_ID) {
    return [{ uncategorized: true }, { categoryId: INBOX_PROJECT_CATEGORY_ID }];
  }
  return [{ categoryId: projectTab }];
}

function filterProjectsForTab(projectTab: string, projects: ProjectRow[]): ProjectRow[] {
  if (projectTab === 'all') {
    return projects.filter((p) => !isProjectInInboxCategory(p.category_id));
  }
  if (projectTab === INBOX_PROJECT_CATEGORY_ID) {
    return projects.filter((p) => isProjectInInboxCategory(p.category_id));
  }
  return projects.filter((p) => p.category_id === projectTab);
}

async function hydrateTreesFromLocal(
  projects: ProjectRow[],
  apiTreeMap: Record<string, TaskTreeNode[]>,
  opts?: { omitTerminalFromApi?: boolean },
): Promise<Record<string, TaskTreeNode[]>> {
  try {
    const localMap = await getProjectTaskTreeMap(projects.map((p) => p.id));
    if (!opts?.omitTerminalFromApi) {
      return mergeProjectTaskTreeMaps(apiTreeMap, localMap);
    }

    // 接口已省略终态任务：缺席的「已同步未完成」视为他端已完成，禁止从本地旧库拼回。
    const next: Record<string, TaskTreeNode[]> = { ...apiTreeMap };
    for (const project of projects) {
      const projectId = String(project.id);
      const apiTree = apiTreeMap[projectId] ?? [];
      const localTree = localMap[projectId] ?? [];
      if (localTree.length === 0) continue;
      const apiIds = new Set(flattenTaskTree(apiTree).map((t) => String(t.id)));
      const allowedLocal = flattenTaskTree(localTree).filter((t) => {
        if (apiIds.has(String(t.id))) return true;
        const syncStatus = String(t.sync_status ?? 'synced');
        if (syncStatus === 'pending_create' || syncStatus === 'pending_update') return true;
        // 本地已是终态：隐藏开关下不必拼回
        if (isTaskTerminalStatus(t.status)) return false;
        return false;
      });
      if (allowedLocal.length === 0) continue;
      next[projectId] = unionProjectTaskTrees(apiTree, buildTaskTreeFromRows(allowedLocal));
    }
    return next;
  } catch (err) {
    console.warn('[projects-list-api] 本地任务树补全失败，沿用接口树', err);
    return apiTreeMap;
  }
}

async function pullProjectsListFromApi(
  queries: ProjectsListQueryParams[],
  opts?: { forceRefresh?: boolean },
): Promise<ProjectsListData> {
  const mergedById = new Map<string, ApiProjectListItem>();
  let meta: PageListMeta | undefined;

  // 隐藏已完成时接口不带回 done 行；先增量同步 tasks 表，避免本地旧 todo 被 hydrate 拼回
  const signal = queries.find((q) => q.signal)?.signal;
  try {
    await syncTasksTableFromApi({ forceRefresh: opts?.forceRefresh, signal });
  } catch (e) {
    console.warn('[projects-list-api] tasks 表增量同步失败，继续拉项目列表', e);
  }

  for (const query of queries) {
    throwIfAborted(query.signal);
    const batch = await pullProjectsListAllPages(query);
    warnProjectsListMetaMismatch(query, batch.meta);
    if (!meta && batch.meta) meta = batch.meta;
    for (const project of batch.list) {
      const id = String(project.id ?? '').trim();
      if (!id) continue;
      mergedById.set(id, mergeApiProjectListItem(mergedById.get(id), project));
    }
  }

  const list = [...mergedById.values()];
  const projects = list.map(normalizeProjectRow);
  const apiTreeMap = buildProjectTaskTreeMap(list);
  const taskRows = Object.values(apiTreeMap).flatMap((nodes) => flattenTaskTree(nodes));

  await syncProjectsListRows(projects, taskRows);
  const omitTerminalFromApi = queries.some((q) => q.includeCompleted === false);
  const projectTaskTreeMap = await hydrateTreesFromLocal(projects, apiTreeMap, {
    omitTerminalFromApi,
  });

  return { projects, projectTaskTreeMap, meta };
}

function resolveTerminalFilters(opts?: ProjectsListFetchOpts): Pick<
  ProjectsListQueryParams,
  'includeCompleted' | 'includeCancelled'
> {
  if (opts?.hideCompletedProjectTasks != null) {
    return resolveProjectsListTerminalTaskFilters(opts.hideCompletedProjectTasks);
  }
  return {
    ...(opts?.includeCompleted === false ? { includeCompleted: false as const } : {}),
    ...(opts?.includeCancelled === false ? { includeCancelled: false as const } : {}),
  };
}

/**
 * 按项目分类 Tab 拉取项目及任务树：`GET /api/pages/projects`。
 * 成功时写入本地 projects / tasks 表，并用本地库补全被截断的树。
 */
export async function fetchProjectsListForTab(
  projectTab: string,
  opts?: ProjectsListFetchOpts,
): Promise<ProjectsListData> {
  const terminalFilters = resolveTerminalFilters(opts);
  const baseQuery: ProjectsListQueryParams = {
    ...terminalFilters,
    includeShelved: opts?.includeShelved,
    updatedSince: opts?.updatedSince,
    signal: opts?.signal,
  };
  const queries = resolveProjectsListQueries(projectTab).map((q) => ({ ...baseQuery, ...q }));
  const data = await pullProjectsListFromApi(queries, { forceRefresh: opts?.forceRefresh });
  return {
    ...data,
    projects: filterProjectsForTab(projectTab, data.projects),
  };
}

/**
 * 拉取单个项目的完整任务树：`GET /api/pages/projects?projectId=`。
 * 后端未支持该参数时可能返回列表页，APP 仍按 id 取出该项目并与本地合并。
 */
export async function fetchProjectsListForProject(
  projectId: string,
  opts?: ProjectsListFetchOpts,
): Promise<ProjectsListData> {
  const id = projectId.trim();
  if (!id) return { projects: [], projectTaskTreeMap: {} };
  const terminalFilters = resolveTerminalFilters(opts);
  const data = await pullProjectsListFromApi(
    [
      {
        ...terminalFilters,
        includeShelved: opts?.includeShelved,
        projectId: id,
        limit: 1,
        signal: opts?.signal,
      },
    ],
    { forceRefresh: opts?.forceRefresh },
  );
  const project = data.projects.find((p) => String(p.id) === id);
  let tree = data.projectTaskTreeMap[id] ?? [];
  try {
    const localTree = await getTasksByProjectId(id);
    if (terminalFilters.includeCompleted === false) {
      const apiIds = new Set(flattenTaskTree(tree).map((t) => String(t.id)));
      const allowedLocal = flattenTaskTree(localTree).filter((t) => {
        if (apiIds.has(String(t.id))) return true;
        const syncStatus = String(t.sync_status ?? 'synced');
        if (syncStatus === 'pending_create' || syncStatus === 'pending_update') return true;
        return false;
      });
      tree = unionProjectTaskTrees(tree, buildTaskTreeFromRows(allowedLocal));
    } else {
      tree = unionProjectTaskTrees(tree, localTree);
    }
  } catch (err) {
    console.warn('[projects-list-api] 单项目本地补全失败', err);
  }
  return {
    projects: project ? [project] : [],
    projectTaskTreeMap: { [id]: tree },
    meta: data.meta,
  };
}
