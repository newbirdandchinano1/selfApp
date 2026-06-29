import { apiGetTasksCatalog, type TasksCatalogPayload } from '@/lib/api-client';
import { localDbHasSubstantialUserData, readAppMeta, writeAppMeta } from '@/lib/api-local-bootstrap';
import { fetchApiTableAll, withApiTableSyncLock } from '@/lib/api-read';
import { syncApiReadResultToLocal } from '@/lib/api-read-local-sync';
import { sleep, throwIfAborted } from '@/lib/cloud-fetch-retry';
import {
  INBOX_PROJECT_CATEGORY_ID,
  isProjectInInboxCategory,
} from '@/lib/repositories/projects/constants';
import { getProjectCategories, getProjects } from '@/lib/repositories/projects/project';
import type { ProjectCategoryRow, ProjectRow } from '@/lib/repositories/projects/project.types';
import { getTaskCategories } from '@/lib/repositories/tasks/task';
import type { TaskCategoryRow } from '@/lib/repositories/tasks/task.types';

const TASKS_CATALOG_LAST_SYNC_META_KEY = 'tasks_catalog_last_sync_at_v1';
const TASKS_CATALOG_VERSIONS_META_KEY = 'tasks_catalog_table_versions_v1';
const CATALOG_SYNC_MAX_ATTEMPTS = 3;

const CATALOG_TABLE_MAP: [keyof TasksCatalogPayload, string][] = [
  ['projectCategories', 'project_categories'],
  ['taskCategories', 'task_categories'],
  ['projects', 'projects'],
];

const CATALOG_FALLBACK_TABLES = ['projects', 'project_categories', 'task_categories'] as const;

export type TasksCatalogData = {
  projects: ProjectRow[];
  projectCategories: ProjectCategoryRow[];
  taskCategories: TaskCategoryRow[];
};

type CatalogTablesVersion = Record<
  string,
  { count?: number; version?: string | null; maxUpdatedAt?: string | null } | undefined
>;

async function readCatalogLastSyncAt(): Promise<string | null> {
  const raw = await readAppMeta(TASKS_CATALOG_LAST_SYNC_META_KEY);
  return raw?.trim() || null;
}

async function writeCatalogLastSyncAt(iso: string): Promise<void> {
  await writeAppMeta(TASKS_CATALOG_LAST_SYNC_META_KEY, iso);
}

async function clearCatalogLastSyncAt(): Promise<void> {
  await writeAppMeta(TASKS_CATALOG_LAST_SYNC_META_KEY, '');
}

/** 冷启动清库 / 调试重置后调用，避免增量游标与空本地库不匹配 */
export async function clearTasksCatalogSyncCache(): Promise<void> {
  await clearCatalogLastSyncAt();
  await writeAppMeta(TASKS_CATALOG_VERSIONS_META_KEY, '{}');
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

function readExpectedTableCount(
  tablesVersion: CatalogTablesVersion | undefined,
  tableName: string,
): number | undefined {
  const count = tablesVersion?.[tableName]?.count;
  return typeof count === 'number' && Number.isFinite(count) && count >= 0 ? count : undefined;
}

/** 响应体结构校验：缺字段视为非法，不写入 SQLite、不更新游标 */
function validateCatalogPayload(payload: TasksCatalogPayload): void {
  if (
    !Array.isArray(payload.projects) ||
    !Array.isArray(payload.projectCategories) ||
    !Array.isArray(payload.taskCategories)
  ) {
    throw new Error('[tasks-catalog-api] 响应不完整：projects / projectCategories / taskCategories 必须为数组');
  }

  const serverTime = payload.meta?.serverTime?.trim();
  if (!serverTime) {
    throw new Error('[tasks-catalog-api] 响应不完整：缺少 meta.serverTime');
  }

  const tablesVersion = payload.meta?.tablesVersion;
  if (!tablesVersion || typeof tablesVersion !== 'object') {
    throw new Error('[tasks-catalog-api] 响应不完整：缺少 meta.tablesVersion');
  }

  for (const [, tableName] of CATALOG_TABLE_MAP) {
    if (readExpectedTableCount(tablesVersion, tableName) == null) {
      throw new Error(`[tasks-catalog-api] 响应不完整：缺少 tablesVersion.${tableName}.count`);
    }
  }

  if (payload.meta?.catalogComplete === false) {
    throw new Error('[tasks-catalog-api] meta.catalogComplete=false，需降级逐表 List');
  }
}

/**
 * 决定是否同步某张 catalog 表：空快照在无法确认服务端确实为空时不做 reconcile，避免误删本地分类。
 */
function resolveCatalogTableSync(
  rows: unknown,
  isFullSync: boolean,
  tableName: string,
  tablesVersion: CatalogTablesVersion | undefined,
): { shouldSync: boolean; reconcileSnapshot: boolean; rows: Record<string, unknown>[] } {
  if (!Array.isArray(rows)) {
    return { shouldSync: false, reconcileSnapshot: false, rows: [] };
  }

  const expectedCount = readExpectedTableCount(tablesVersion, tableName);

  if (rows.length === 0) {
    if (!isFullSync) {
      return { shouldSync: false, reconcileSnapshot: false, rows: [] };
    }
    if (expectedCount !== 0) {
      return { shouldSync: false, reconcileSnapshot: false, rows: [] };
    }
    return { shouldSync: true, reconcileSnapshot: true, rows: [] };
  }

  if (isFullSync && expectedCount != null && rows.length < expectedCount) {
    console.warn(
      `[tasks-catalog-api] 表「${tableName}」行数不足（${rows.length}/${expectedCount}），仅 upsert 不做 reconcile`,
    );
    return { shouldSync: true, reconcileSnapshot: false, rows };
  }

  return { shouldSync: true, reconcileSnapshot: isFullSync, rows };
}

async function syncCatalogTableRows(
  tableName: string,
  rows: Record<string, unknown>[],
  reconcileSnapshot: boolean,
): Promise<void> {
  await withApiTableSyncLock(tableName, async () => {
    await syncApiReadResultToLocal(tableName, rows, { reconcileSnapshot, throwOnError: true });
  });
}

async function readTasksCatalogFromLocal(): Promise<TasksCatalogData> {
  const [projects, projectCategories, taskCategories] = await Promise.all([
    getProjects(),
    getProjectCategories(),
    getTaskCategories(),
  ]);
  return { projects, projectCategories, taskCategories };
}

async function validateCatalogSyncLocal(
  payload: TasksCatalogPayload,
  isFullSync: boolean,
): Promise<{ ok: boolean; reason?: string }> {
  const tablesVersion = payload.meta?.tablesVersion;

  if (isFullSync) {
    for (const [responseKey, tableName] of CATALOG_TABLE_MAP) {
      const rows = payload[responseKey];
      const expected = readExpectedTableCount(tablesVersion, tableName);
      if (expected != null && Array.isArray(rows) && rows.length !== expected) {
        return {
          ok: false,
          reason: `全量 ${tableName} 数组长度 ${rows.length} 与 count ${expected} 不一致`,
        };
      }
    }
  }

  const [projectCategories, projects, taskCategories] = await Promise.all([
    getProjectCategories(),
    getProjects(),
    getTaskCategories(),
  ]);

  const categoryIds = new Set(projectCategories.map((c) => c.id));
  const orphanProjectCategory = projects.some(
    (p) =>
      p.category_id &&
      !isProjectInInboxCategory(p.category_id) &&
      !categoryIds.has(p.category_id),
  );
  if (orphanProjectCategory) {
    return { ok: false, reason: '项目引用了本地不存在的分类' };
  }

  const checks: Array<{ table: string; localCount: number }> = [
    { table: 'project_categories', localCount: projectCategories.length },
    { table: 'task_categories', localCount: taskCategories.length },
    { table: 'projects', localCount: projects.length },
  ];

  for (const { table, localCount } of checks) {
    const expected = readExpectedTableCount(tablesVersion, table);
    if (expected != null && localCount < expected) {
      return { ok: false, reason: `${table} 本地 ${localCount} 行，服务端期望 ${expected} 行` };
    }
  }

  const expectedProjectCats = readExpectedTableCount(tablesVersion, 'project_categories');
  const customLocalCount = projectCategories.filter((c) => c.id !== INBOX_PROJECT_CATEGORY_ID).length;
  if (expectedProjectCats != null && expectedProjectCats > 1 && customLocalCount === 0) {
    return { ok: false, reason: '服务端有多条分类但本地仅有收集箱' };
  }

  return { ok: true };
}

async function validateCatalogFallbackLocal(): Promise<{ ok: boolean; reason?: string }> {
  const [projectCategories, projects] = await Promise.all([
    getProjectCategories(),
    getProjects(),
  ]);
  const categoryIds = new Set(projectCategories.map((c) => c.id));
  const orphanProjectCategory = projects.some(
    (p) =>
      p.category_id &&
      !isProjectInInboxCategory(p.category_id) &&
      !categoryIds.has(p.category_id),
  );
  if (orphanProjectCategory) {
    return { ok: false, reason: '降级后项目仍引用不存在的分类' };
  }
  return { ok: true };
}

/** catalog 连续失败时降级：与单表 List 共用后端查询层 */
async function pullTasksCatalogViaTableListFallback(opts?: {
  signal?: AbortSignal;
}): Promise<TasksCatalogData> {
  console.warn('[tasks-catalog-api] catalog 失败，降级逐表 List 拉取');
  for (const table of CATALOG_FALLBACK_TABLES) {
    throwIfAborted(opts?.signal);
    await fetchApiTableAll<Record<string, unknown>>(table, {
      signal: opts?.signal,
      forceRefresh: true,
    });
  }
  const validation = await validateCatalogFallbackLocal();
  if (!validation.ok) {
    throw new Error(`[tasks-catalog-api] 降级校验失败: ${validation.reason ?? 'unknown'}`);
  }
  return readTasksCatalogFromLocal();
}

async function pullTasksCatalogFromApi(opts?: {
  forceRefresh?: boolean;
  signal?: AbortSignal;
}): Promise<TasksCatalogData> {
  throwIfAborted(opts?.signal);

  let forceRefresh = Boolean(opts?.forceRefresh);
  if (!forceRefresh && !(await localDbHasSubstantialUserData())) {
    forceRefresh = true;
  }

  const lastSyncAt = forceRefresh ? null : await readCatalogLastSyncAt();
  const isFullSync = !lastSyncAt;

  const payload = await apiGetTasksCatalog({
    updatedSince: lastSyncAt ?? undefined,
    signal: opts?.signal,
  });

  validateCatalogPayload(payload);

  const tablesVersion = payload.meta!.tablesVersion!;

  if (isFullSync) {
    for (const [responseKey, tableName] of CATALOG_TABLE_MAP) {
      const rows = payload[responseKey];
      const expected = readExpectedTableCount(tablesVersion, tableName);
      if (expected != null && Array.isArray(rows) && rows.length !== expected) {
        throw new Error(
          `[tasks-catalog-api] 全量 ${tableName} 数组长度 ${rows.length} 与 count ${expected} 不一致`,
        );
      }
    }
  }

  for (const [responseKey, tableName] of CATALOG_TABLE_MAP) {
    throwIfAborted(opts?.signal);
    const { shouldSync, reconcileSnapshot, rows } = resolveCatalogTableSync(
      payload[responseKey],
      isFullSync,
      tableName,
      tablesVersion,
    );
    if (!shouldSync) continue;
    await syncCatalogTableRows(tableName, rows, reconcileSnapshot);
  }

  const validation = await validateCatalogSyncLocal(payload, isFullSync);
  if (!validation.ok) {
    throw new Error(`[tasks-catalog-api] 校验失败: ${validation.reason ?? 'unknown'}`);
  }

  const serverTime = payload.meta!.serverTime!.trim();
  await writeCatalogLastSyncAt(serverTime);
  await writeCatalogTableVersions(tablesVersion);

  return readTasksCatalogFromLocal();
}

async function pullTasksCatalogFromApiWithRetry(opts?: {
  forceRefresh?: boolean;
  signal?: AbortSignal;
}): Promise<TasksCatalogData> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= CATALOG_SYNC_MAX_ATTEMPTS; attempt++) {
    throwIfAborted(opts?.signal);
    const forceRefresh = Boolean(opts?.forceRefresh || attempt > 1);

    try {
      return await pullTasksCatalogFromApi({ ...opts, forceRefresh });
    } catch (e) {
      lastError = e;
      console.warn(`[tasks-catalog-api] 同步失败（第 ${attempt}/${CATALOG_SYNC_MAX_ATTEMPTS} 次）`, e);

      if (attempt >= CATALOG_SYNC_MAX_ATTEMPTS) break;

      await clearCatalogLastSyncAt();
      await sleep(500 * attempt, opts?.signal);
    }
  }

  try {
    return await pullTasksCatalogViaTableListFallback(opts);
  } catch (fallbackErr) {
    console.warn('[tasks-catalog-api] 降级逐表 List 失败', fallbackErr);
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
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
      return await pullTasksCatalogFromApiWithRetry({
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
