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
import type { TaskTreeNode } from '@/lib/repositories/tasks/task';
import type { TaskRow } from '@/lib/repositories/tasks/task.types';
import { ensureTaskCategoryMirrorLocally } from '@/lib/repositories/tasks/task-category-mirror';

const PROJECTS_LIST_PAGE_LIMIT = 200;

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

function apiTreeNodeToTaskTreeNode(node: ApiTaskTreeNode): TaskTreeNode {
  const childNodes = Array.isArray(node.children)
    ? node.children.map((child) => apiTreeNodeToTaskTreeNode(child))
    : [];
  const { children: _children, ...rest } = node;
  return { ...(rest as TaskRow), children: childNodes };
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
    for (const child of children) {
      walk(child, String(node.id));
    }
  };
  for (const node of nodes) walk(node, parentTaskId);
  return rows;
}

function buildProjectTaskTreeMap(
  list: ApiProjectListItem[],
): Record<string, TaskTreeNode[]> {
  const map: Record<string, TaskTreeNode[]> = {};
  for (const project of list) {
    const projectId = String(project.id ?? '').trim();
    if (!projectId) continue;
    const roots = Array.isArray(project.tasks) ? project.tasks : [];
    map[projectId] = roots.map((node) => apiTreeNodeToTaskTreeNode(node));
  }
  return map;
}

function normalizeProjectRow(row: ApiProjectListItem): ProjectRow {
  const { tasks: _tasks, ...rest } = row;
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
    limit: PROJECTS_LIST_PAGE_LIMIT,
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
  const merged: ApiProjectListItem[] = [];
  let page = 1;
  let totalPages = 1;
  let meta: PageListMeta | undefined;

  while (page <= totalPages) {
    throwIfAborted(query.signal);
    const batch = await pullProjectsListPage(query, page);
    if (page === 1) {
      meta = batch.meta;
      totalPages = batch.totalPages;
    }
    merged.push(...batch.list);
    page += 1;
  }

  return { list: merged, meta };
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

async function pullProjectsListFromApi(
  queries: ProjectsListQueryParams[],
): Promise<ProjectsListData> {
  const mergedById = new Map<string, ApiProjectListItem>();
  let meta: PageListMeta | undefined;

  for (const query of queries) {
    throwIfAborted(query.signal);
    const batch = await pullProjectsListAllPages(query);
    warnProjectsListMetaMismatch(query, batch.meta);
    if (!meta && batch.meta) meta = batch.meta;
    for (const project of batch.list) {
      const id = String(project.id ?? '').trim();
      if (id) mergedById.set(id, project);
    }
  }

  const list = [...mergedById.values()];
  const projects = list.map(normalizeProjectRow);
  const projectTaskTreeMap = buildProjectTaskTreeMap(list);
  const taskRows = Object.values(projectTaskTreeMap).flatMap(flattenTaskTree);

  await syncProjectsListRows(projects, taskRows);

  return { projects, projectTaskTreeMap, meta };
}

/**
 * 按项目分类 Tab 拉取项目及任务树：`GET /api/pages/projects`。
 * 成功时写入本地 projects / tasks 表。
 */
export async function fetchProjectsListForTab(
  projectTab: string,
  opts?: ProjectsListFetchOpts,
): Promise<ProjectsListData> {
  const terminalFilters =
    opts?.hideCompletedProjectTasks != null
      ? resolveProjectsListTerminalTaskFilters(opts.hideCompletedProjectTasks)
      : {
          ...(opts?.includeCompleted === false ? { includeCompleted: false as const } : {}),
          ...(opts?.includeCancelled === false ? { includeCancelled: false as const } : {}),
        };
  const baseQuery: ProjectsListQueryParams = {
    ...terminalFilters,
    includeShelved: opts?.includeShelved,
    updatedSince: opts?.updatedSince,
    signal: opts?.signal,
  };
  const queries = resolveProjectsListQueries(projectTab).map((q) => ({ ...baseQuery, ...q }));
  const data = await pullProjectsListFromApi(queries);
  return {
    ...data,
    projects: filterProjectsForTab(projectTab, data.projects),
  };
}
