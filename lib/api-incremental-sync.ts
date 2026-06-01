import AsyncStorage from '@react-native-async-storage/async-storage';

import { setLastApiIncrementalSyncAtIso } from '@/lib/api-backup-meta';
import { ensureApiLoggedIn } from '@/lib/api-client';
import {
  ApiRowUploadSkippedError,
  rowPrimaryKeyValue,
  upsertProjectCategoriesReferencedByProjects,
  upsertProjectsReferencedByTasks,
  upsertRowToApi,
  upsertTaskCategoriesReferencedByTasks,
} from '@/lib/api-row-upsert';
import {
  beginCloudSqliteDirtyIgnoreBatch,
  endCloudSqliteDirtyIgnoreBatch,
} from '@/lib/cloud-sql-dirty-track';
import {
  ensureProjectCategoryRefsForApiUpload,
  ensureTaskCategoryMirrorForApiUpload,
  prepareLocalRowsForUpload,
  readLocalForeignKeyRefs,
  resolveApiPushInsertOrder,
  sortProjectCategoriesForApiUpload,
  listLocalUserTablesForApiUpload,
  type LocalTableUploadBundle,
} from '@/lib/cloud-sql-sync';
import { isSilentCloudRestoreInFlight } from '@/lib/cloud-sync-flags';
import { getDatabase } from '@/lib/database';
import { dedupeRowsByPrimaryKey, readTablePrimaryKeyColumns } from '@/lib/sqlite-primary-key-dedupe';

/** REST 增量同步跳过的表（与全量迁移一致） */
export const REST_SKIP_TABLES = new Set([
  'admin_users',
  /** AI 画像缓存，体积大且可重新生成 */
  'persona_portrait_cache',
]);

const API_DIRTY_STATE_KEY = 'selfapp:api-dirty-tables-v1';
const INCREMENTAL_PUSH_DELAY_MS = 4500;

const apiDirtyTables = new Set<string>();
let apiPersistTimer: ReturnType<typeof setTimeout> | null = null;
let apiPushDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let apiPushInFlight = false;

function isSafeTableName(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

export function markApiTableDirty(table: string): void {
  const t = table.trim();
  if (!t || !isSafeTableName(t)) return;
  if (REST_SKIP_TABLES.has(t)) return;
  if (t.startsWith('sqlite_')) return;
  apiDirtyTables.add(t);
  schedulePersistApiDirty();
  scheduleApiPushDebounced();
}

function schedulePersistApiDirty(): void {
  if (apiPersistTimer) clearTimeout(apiPersistTimer);
  apiPersistTimer = setTimeout(() => {
    apiPersistTimer = null;
    void persistApiDirtyNow();
  }, 400);
}

async function persistApiDirtyNow(): Promise<void> {
  try {
    const sqlite = [...apiDirtyTables].sort();
    if (sqlite.length === 0) {
      await AsyncStorage.removeItem(API_DIRTY_STATE_KEY);
      return;
    }
    await AsyncStorage.setItem(API_DIRTY_STATE_KEY, JSON.stringify({ sqlite }));
  } catch {
    /* 非致命 */
  }
}

export async function hydrateApiDirtyFromStorage(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(API_DIRTY_STATE_KEY);
    if (!raw) return;
    const o = JSON.parse(raw) as unknown;
    if (o && typeof o === 'object' && !Array.isArray(o)) {
      const sqliteRaw = (o as Record<string, unknown>).sqlite;
      if (Array.isArray(sqliteRaw)) {
        for (const x of sqliteRaw) {
          if (typeof x === 'string' && isSafeTableName(x)) apiDirtyTables.add(x);
        }
      }
    }
    if (apiDirtyTables.size > 0) scheduleApiPushDebounced();
  } catch {
    /* ignore */
  }
}

export function peekApiDirtyTables(): string[] {
  return [...apiDirtyTables].sort();
}

export function clearApiDirtyTables(tables: Iterable<string>): void {
  for (const t of tables) apiDirtyTables.delete(t);
  void persistApiDirtyNow();
}

async function tableHasSyncStatusColumn(table: string): Promise<boolean> {
  const db = await getDatabase();
  if (!db) return false;
  const cols = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${quoteIdent(table)})`);
  return cols.some(c => c.name === 'sync_status');
}

async function readPendingRowsForTable(table: string): Promise<Record<string, unknown>[]> {
  const db = await getDatabase();
  if (!db) return [];
  const safe = quoteIdent(table);
  if (await tableHasSyncStatusColumn(table)) {
    const rows = await db.getAllAsync(`SELECT * FROM ${safe} WHERE sync_status != 'synced'`);
    return (rows as Record<string, unknown>[]) ?? [];
  }
  const rows = await db.getAllAsync(`SELECT * FROM ${safe}`);
  return (rows as Record<string, unknown>[]) ?? [];
}

async function fetchRowByPk(
  table: string,
  pkCol: string,
  pk: string,
): Promise<Record<string, unknown> | null> {
  const db = await getDatabase();
  if (!db) return null;
  const row = await db.getFirstAsync<Record<string, unknown>>(
    `SELECT * FROM ${quoteIdent(table)} WHERE ${quoteIdent(pkCol)} = ?`,
    [pk],
  );
  return row ?? null;
}

async function markLocalRowsSynced(
  table: string,
  pkCols: string[],
  rows: Record<string, unknown>[],
): Promise<void> {
  if (rows.length === 0) return;
  if (!(await tableHasSyncStatusColumn(table))) return;

  const db = await getDatabase();
  if (!db) return;

  const pkCol = pkCols[0] ?? 'id';
  beginCloudSqliteDirtyIgnoreBatch();
  try {
    for (const row of rows) {
      const pk = rowPrimaryKeyValue(row, pkCols);
      if (!pk) continue;
      await db.runAsync(
        `UPDATE ${quoteIdent(table)} SET sync_status = 'synced' WHERE ${quoteIdent(pkCol)} = ?`,
        [pk],
      );
    }
  } finally {
    endCloudSqliteDirtyIgnoreBatch();
  }
}

async function collectPendingDataForApiPush(seedTables: string[]): Promise<LocalTableUploadBundle> {
  const filtered = seedTables.filter(t => !REST_SKIP_TABLES.has(t));
  if (filtered.length === 0) {
    return { insertOrder: [], rowsByTable: new Map() };
  }

  const insertOrder = await resolveApiPushInsertOrder(filtered);
  const rowsByTable = new Map<string, Record<string, unknown>[]>();
  const db = await getDatabase();

  for (const table of filtered) {
    const pending = await readPendingRowsForTable(table);
    if (pending.length > 0) rowsByTable.set(table, pending);
  }

  if (db) {
    for (const table of filtered) {
      const pending = rowsByTable.get(table) ?? [];
      if (pending.length === 0) continue;
      const fks = await readLocalForeignKeyRefs(table);
      for (const row of pending) {
        for (const fk of fks) {
          const val = row[fk.fromColumn];
          if (val == null || val === '') continue;
          const parentTable = fk.parentTable;
          if (REST_SKIP_TABLES.has(parentTable)) continue;
          const parentRows = rowsByTable.get(parentTable) ?? [];
          if (parentRows.some(r => String(r[fk.toColumn] ?? r.id) === String(val))) continue;
          const pkCols = await readTablePrimaryKeyColumns(db, parentTable);
          const pkCol = pkCols[0] ?? fk.toColumn ?? 'id';
          const parentRow = await fetchRowByPk(parentTable, pkCol, String(val));
          if (parentRow) {
            parentRows.push(parentRow);
            rowsByTable.set(parentTable, parentRows);
          }
        }
      }
    }
  }

  ensureProjectCategoryRefsForApiUpload(rowsByTable);
  ensureTaskCategoryMirrorForApiUpload(rowsByTable);

  const effectiveOrder = insertOrder.filter(t => (rowsByTable.get(t)?.length ?? 0) > 0);
  return { insertOrder: effectiveOrder, rowsByTable };
}

export function scheduleApiPushDebounced(): void {
  if (apiPushDebounceTimer) clearTimeout(apiPushDebounceTimer);
  apiPushDebounceTimer = setTimeout(() => {
    apiPushDebounceTimer = null;
    void pushApiDirtyTablesIfNeeded();
  }, INCREMENTAL_PUSH_DELAY_MS);
}

/** 启动时扫描仍有待同步行的表并标记脏表 */
export async function markAllPendingTablesDirty(): Promise<void> {
  const db = await getDatabase();
  if (!db) return;

  const tables = (await listLocalUserTablesForApiUpload()).filter(t => !REST_SKIP_TABLES.has(t));
  for (const table of tables) {
    if (!(await tableHasSyncStatusColumn(table))) continue;
    const pending = await db.getFirstAsync<{ n: number }>(
      `SELECT 1 AS n FROM ${quoteIdent(table)} WHERE sync_status != 'synced' LIMIT 1`,
    );
    if (pending) markApiTableDirty(table);
  }
}

/** 脏表增量：将本地待同步行推送到 REST 后端 */
export async function pushApiDirtyTablesIfNeeded(): Promise<void> {
  if (apiPushInFlight) return;
  if (isSilentCloudRestoreInFlight()) {
    scheduleApiPushDebounced();
    return;
  }

  const dirtyList = peekApiDirtyTables().filter(t => !REST_SKIP_TABLES.has(t));
  if (dirtyList.length === 0) return;

  const db = await getDatabase();
  if (!db) return;

  try {
    await ensureApiLoggedIn();
  } catch (e) {
    if (__DEV__) console.warn('[api incremental] 登录失败', e);
    scheduleApiPushDebounced();
    return;
  }

  apiPushInFlight = true;
  try {
    const { insertOrder, rowsByTable } = await collectPendingDataForApiPush(dirtyList);
    if (insertOrder.length === 0) {
      clearApiDirtyTables(dirtyList);
      return;
    }

    const pkColsByTable = new Map<string, string[]>();
    for (const table of insertOrder) {
      pkColsByTable.set(table, await readTablePrimaryKeyColumns(db, table));
    }

    const uploadedPkByTable = new Map<string, Set<string>>();
    const fkRefsByTable = new Map<string, Awaited<ReturnType<typeof readLocalForeignKeyRefs>>>();
    for (const table of insertOrder) {
      fkRefsByTable.set(table, await readLocalForeignKeyRefs(table));
      uploadedPkByTable.set(table, new Set<string>());
    }

    for (const table of insertOrder) {
      const rawRows = rowsByTable.get(table) ?? [];
      if (rawRows.length === 0) continue;

      const prepared = await prepareLocalRowsForUpload(table, rawRows, rowsByTable);
      const pkCols = pkColsByTable.get(table) ?? ['id'];
      let rows = dedupeRowsByPrimaryKey(prepared, pkCols);
      if (table === 'project_categories') {
        rows = sortProjectCategoriesForApiUpload(rows);
      }

      const uploadedRows: Record<string, unknown>[] = [];
      const uploadedPks = uploadedPkByTable.get(table)!;

      if (table === 'projects') {
        await upsertProjectCategoriesReferencedByProjects(
          rows,
          rowsByTable,
          pkColsByTable,
          uploadedPkByTable,
          fkRefsByTable,
        );
      }

      if (table === 'tasks') {
        await upsertTaskCategoriesReferencedByTasks(
          rows,
          rowsByTable,
          pkColsByTable,
          uploadedPkByTable,
          fkRefsByTable,
        );
        await upsertProjectsReferencedByTasks(
          rows,
          rowsByTable,
          pkColsByTable,
          uploadedPkByTable,
          fkRefsByTable,
        );
      }

      for (const row of rows) {
        try {
          const action = await upsertRowToApi(table, row, pkCols, {
            uploadedPkByTable,
            fkRefs: fkRefsByTable.get(table) ?? [],
            rowsByTable,
            pkColsByTable,
            fkRefsByTable,
          });
          uploadedRows.push(row);
          const pk = rowPrimaryKeyValue(row, pkCols);
          if (pk) uploadedPks.add(pk);
          if (__DEV__) console.log(`[api incremental] ${table} ${action}`, pk);
        } catch (e) {
          if (e instanceof ApiRowUploadSkippedError) {
            if (__DEV__) console.warn('[api incremental] 跳过', table, e.message);
            continue;
          }
          throw e;
        }
      }

      await markLocalRowsSynced(table, pkCols, uploadedRows);
    }

    clearApiDirtyTables(dirtyList);
    await setLastApiIncrementalSyncAtIso(new Date().toISOString());
  } catch (e) {
    if (__DEV__) console.warn('[api incremental] 推送失败', e);
    scheduleApiPushDebounced();
  } finally {
    apiPushInFlight = false;
  }
}
