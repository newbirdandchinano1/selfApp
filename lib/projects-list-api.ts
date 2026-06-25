import {
  apiGetProjectsList,
  type ApiProjectListItem,
  type ApiTaskTreeNode,
  type PageListMeta,
  type ProjectsListQueryParams,
} from '@/lib/api-client';
import { withApiTableSyncLock } from '@/lib/api-read';
import { syncApiReadResultToLocal } from '@/lib/api-read-local-sync';
import { throwIfAborted } from '@/lib/cloud-fetch-retry';
import {
  INBOX_PROJECT_CATEGORY_ID,
  isProjectInInboxCategory,
} from '@/lib/repositories/projects/constants';
import type { ProjectRow } from '@/lib/repositories/projects/project.types';
import type { TaskTreeNode } from '@/lib/repositories/tasks/task';
import type { TaskRow } from '@/lib/repositories/tasks/task.types';

const PROJECTS_LIST_PAGE_LIMIT = 200;

export type ProjectsListData = {
  projects: ProjectRow[];
  projectTaskTreeMap: Record<string, TaskTreeNode[]>;
  meta?: PageListMeta;
};

export type ProjectsListFetchOpts = Omit<ProjectsListQueryParams, 'page' | 'limit'> & {
  forceRefresh?: boolean;
  offlineFallback?: boolean;
};

function apiTreeNodeToTaskTreeNode(node: ApiTaskTreeNode): TaskTreeNode {
  const childNodes = Array.isArray(node.children)
    ? node.children.map((child) => apiTreeNodeToTaskTreeNode(child))
    : [];
  const { children: _children, ...rest } = node;
  return { ...(rest as TaskRow), children: childNodes };
}

function flattenTaskTree(nodes: TaskTreeNode[]): TaskRow[] {
  const rows: TaskRow[] = [];
  const walk = (node: TaskTreeNode) => {
    const { children, ...row } = node;
    rows.push(row as TaskRow);
    for (const child of children) walk(child);
  };
  for (const node of nodes) walk(node);
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

async function syncProjectsListRows(
  projects: ProjectRow[],
  taskRows: TaskRow[],
): Promise<void> {
  if (projects.length > 0) {
    await withApiTableSyncLock('projects', async () => {
      await syncApiReadResultToLocal('projects', projects as Record<string, unknown>[]);
    });
  }
  if (taskRows.length > 0) {
    await withApiTableSyncLock('tasks', async () => {
      await syncApiReadResultToLocal('tasks', taskRows as Record<string, unknown>[]);
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
  const baseQuery: ProjectsListQueryParams = {
    includeCompleted: opts?.includeCompleted,
    includeCancelled: opts?.includeCancelled,
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

/**
 * 直接按 query 拉取项目列表（含任务树），供增量同步等场景使用。
 */
export async function fetchProjectsList(
  query: ProjectsListQueryParams,
): Promise<ProjectsListData> {
  return pullProjectsListFromApi([query]);
}
