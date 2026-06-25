import { apiGetTasksCatalog, type TasksCatalogPayload } from '@/lib/api-client';
import { readAppMeta, writeAppMeta } from '@/lib/api-local-bootstrap';
import { withApiTableSyncLock } from '@/lib/api-read';
import { syncApiReadResultToLocal } from '@/lib/api-read-local-sync';
import { throwIfAborted } from '@/lib/cloud-fetch-retry';
import { getProjectCategories, getProjects } from '@/lib/repositories/projects/project';
import type { ProjectCategoryRow, ProjectRow } from '@/lib/repositories/projects/project.types';
import { getTaskCategories } from '@/lib/repositories/tasks/task';
import type { TaskCategoryRow } from '@/lib/repositories/tasks/task.types';

const TASKS_CATALOG_LAST_SYNC_META_KEY = 'tasks_catalog_last_sync_at_v1';
const TASKS_CATALOG_VERSIONS_META_KEY = 'tasks_catalog_table_versions_v1';

const CATALOG_TABLE_MAP: [keyof TasksCatalogPayload, string][] = [
  ['projects', 'projects'],
  ['projectCategories', 'project_categories'],
  ['taskCategories', 'task_categories'],
];

export type TasksCatalogData = {
  projects: ProjectRow[];
  projectCategories: ProjectCategoryRow[];
  taskCategories: TaskCategoryRow[];
};

async function readCatalogLastSyncAt(): Promise<string | null> {
  const raw = await readAppMeta(TASKS_CATALOG_LAST_SYNC_META_KEY);
  return raw?.trim() || null;
}

async function writeCatalogLastSyncAt(iso: string): Promise<void> {
  await writeAppMeta(TASKS_CATALOG_LAST_SYNC_META_KEY, iso);
}

async function writeCatalogTableVersions(
  tablesVersion: Record<string, { version?: string | null }> | undefined,
): Promise<void> {
  if (!tablesVersion || typeof tablesVersion !== 'object') return;
  const versions: Record<string, string | null> = {};
  for (const [table, info] of Object.entries(tablesVersion)) {
    versions[table] = info?.version ?? null;
  }
  await writeAppMeta(TASKS_CATALOG_VERSIONS_META_KEY, JSON.stringify(versions));
}

async function syncCatalogTableRows(
  tableName: string,
  rows: Record<string, unknown>[],
  reconcileSnapshot: boolean,
): Promise<void> {
  await withApiTableSyncLock(tableName, async () => {
    await syncApiReadResultToLocal(tableName, rows, { reconcileSnapshot });
  });
}

function normalizeCatalogPayload(payload: TasksCatalogPayload): TasksCatalogData {
  return {
    projects: (Array.isArray(payload.projects) ? payload.projects : []) as ProjectRow[],
    projectCategories: (Array.isArray(payload.projectCategories)
      ? payload.projectCategories
      : []) as ProjectCategoryRow[],
    taskCategories: (Array.isArray(payload.taskCategories)
      ? payload.taskCategories
      : []) as TaskCategoryRow[],
  };
}

async function readTasksCatalogFromLocal(): Promise<TasksCatalogData> {
  const [projects, projectCategories, taskCategories] = await Promise.all([
    getProjects(),
    getProjectCategories(),
    getTaskCategories(),
  ]);
  return { projects, projectCategories, taskCategories };
}

async function pullTasksCatalogFromApi(opts?: {
  forceRefresh?: boolean;
  signal?: AbortSignal;
}): Promise<TasksCatalogData> {
  throwIfAborted(opts?.signal);

  const lastSyncAt = opts?.forceRefresh ? null : await readCatalogLastSyncAt();
  const isFullSync = !lastSyncAt;

  const payload = await apiGetTasksCatalog({
    updatedSince: lastSyncAt ?? undefined,
    signal: opts?.signal,
  });

  for (const [responseKey, tableName] of CATALOG_TABLE_MAP) {
    throwIfAborted(opts?.signal);
    const rows = payload[responseKey];
    if (!Array.isArray(rows)) continue;
    if (rows.length === 0 && !isFullSync) continue;
    await syncCatalogTableRows(tableName, rows, isFullSync);
  }

  const serverTime = payload.meta?.serverTime?.trim();
  if (serverTime) {
    await writeCatalogLastSyncAt(serverTime);
  }
  await writeCatalogTableVersions(payload.meta?.tablesVersion);

  if (isFullSync) {
    return normalizeCatalogPayload(payload);
  }
  return readTasksCatalogFromLocal();
}

/**
 * 拉取项目与分类：优先 `GET /api/pages/tasks/catalog`，失败且允许时回退 SQLite。
 * 成功时写入本地库；增量同步后返回本地合并结果。
 */
export async function fetchTasksCatalog(opts?: {
  offlineFallback?: boolean;
  forceLocal?: boolean;
  forceRefresh?: boolean;
  signal?: AbortSignal;
}): Promise<TasksCatalogData> {
  if (!opts?.forceLocal) {
    try {
      return await pullTasksCatalogFromApi({
        forceRefresh: opts?.forceRefresh,
        signal: opts?.signal,
      });
    } catch (e) {
      if (!opts?.offlineFallback) throw e;
      console.warn('[tasks-catalog-api] 接口失败，回退本地 SQLite', e);
    }
  }

  return readTasksCatalogFromLocal();
}
