import AsyncStorage from '@react-native-async-storage/async-storage';

import { setLastApiIncrementalSyncAtIso } from '@/lib/api-backup-meta';
import { ensureApiLoggedIn } from '@/lib/api-client';
import { invalidateInflightApiTableFetch } from '@/lib/api-read';
import {
  ApiRowUploadSkippedError,
  rowPrimaryKeyValue,
  upsertProjectCategoriesReferencedByProjects,
  upsertFinanceAccountsReferencedByTransactions,
  upsertMemoDimensionsReferencedByMemos,
  upsertHabitsReferencedByCheckIns,
  upsertProjectsReferencedByTasks,
  upsertParentTasksReferencedByTasks,
  upsertRowToApi,
  upsertTaskCategoriesReferencedByTasks,
} from '@/lib/api-row-upsert';
import {
  applyMysqlIdRemapToUploadBundle,
  buildMysqlIdRemapForUpload,
} from '@/lib/api-mysql-id';
import {
  beginCloudSqliteDirtyIgnoreBatch,
  endCloudSqliteDirtyIgnoreBatch,
} from '@/lib/cloud-sql-dirty-track';
import {
  ensureProjectCategoryRefsForApiUpload,
  ensureFinanceAccountRefsForApiUpload,
  ensureMemoDimensionRefsForApiUpload,
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
  /** 本地迁移/回填标记，仅设备内有效，见 API_LOCAL_READ_ONLY_TABLES */
  'app_meta',
]);

const API_DIRTY_STATE_KEY = 'selfapp:api-dirty-tables-v1';
/** 合并同一交互内的多次脏表标记，再串行推送到 REST */
const COALESCE_PUSH_DELAY_MS = 50;
const MAX_PUSH_BACKOFF_MS = 30_000;

const apiDirtyTables = new Set<string>();
let apiPersistTimer: ReturnType<typeof setTimeout> | null = null;
let coalescedApiPushTimer: ReturnType<typeof setTimeout> | null = null;
let coalescedApiPushBackoffMs = COALESCE_PUSH_DELAY_MS;
let apiPushInFlight = false;

const SQLITE_RESERVED_TABLE_NAMES = new Set(['on', 'off', 'begin', 'end', 'commit', 'rollback']);

function isSafeTableName(name: string): boolean {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return false;
  if (SQLITE_RESERVED_TABLE_NAMES.has(name.toLowerCase())) return false;
  return true;
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
  invalidateInflightApiTableFetch(t);
  schedulePersistApiDirty();
  scheduleCoalescedApiPush();
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
          if (typeof x === 'string' && isSafeTableName(x) && !REST_SKIP_TABLES.has(x)) {
            apiDirtyTables.add(x);
          }
        }
      }
    }
    apiDirtyTables.delete('ON');
    apiDirtyTables.delete('on');
    for (const t of REST_SKIP_TABLES) apiDirtyTables.delete(t);
    if (apiDirtyTables.size > 0) scheduleCoalescedApiPush();
    else void persistApiDirtyNow();
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

export function clearAllApiDirtyTables(): void {
  apiDirtyTables.clear();
  void persistApiDirtyNow();
}

/** 仅清除已无待同步行的脏表标记 */
async function clearApiDirtyTablesWithoutPending(tables: Iterable<string>): Promise<void> {
  const toClear: string[] = [];
  for (const table of tables) {
    if (REST_SKIP_TABLES.has(table)) {
      toClear.push(table);
      continue;
    }
    const pending = await readPendingRowsForTable(table);
    if (pending.length === 0) toClear.push(table);
  }
  if (toClear.length > 0) clearApiDirtyTables(toClear);
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
      if (row.sync_status === 'pending_delete') {
        await db.runAsync(`DELETE FROM ${quoteIdent(table)} WHERE ${quoteIdent(pkCol)} = ?`, [pk]);
      } else {
        await db.runAsync(
          `UPDATE ${quoteIdent(table)} SET sync_status = 'synced' WHERE ${quoteIdent(pkCol)} = ?`,
          [pk],
        );
      }
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

  await ensureProjectCategoryRefsForApiUpload(rowsByTable);
  await ensureTaskCategoryMirrorForApiUpload(rowsByTable);
  await ensureFinanceAccountRefsForApiUpload(rowsByTable);
  await ensureMemoDimensionRefsForApiUpload(rowsByTable);

  const seedWithRefs = [...filtered];
  if ((rowsByTable.get('finance_accounts')?.length ?? 0) > 0 && !seedWithRefs.includes('finance_accounts')) {
    seedWithRefs.push('finance_accounts');
  }
  if ((rowsByTable.get('memo_dimensions')?.length ?? 0) > 0 && !seedWithRefs.includes('memo_dimensions')) {
    seedWithRefs.push('memo_dimensions');
  }
  if ((rowsByTable.get('habit_check_ins')?.length ?? 0) > 0 && !seedWithRefs.includes('habits')) {
    seedWithRefs.push('habits');
  }

  const effectiveOrder = (await resolveApiPushInsertOrder(seedWithRefs)).filter(
    t => (rowsByTable.get(t)?.length ?? 0) > 0,
  );
  return { insertOrder: effectiveOrder, rowsByTable };
}

/** 脏表标记后合并推送（全局：所有经 markApiTableDirty 的写入均会触发） */
function scheduleCoalescedApiPush(): void {
  if (coalescedApiPushTimer) clearTimeout(coalescedApiPushTimer);
  coalescedApiPushTimer = setTimeout(() => {
    coalescedApiPushTimer = null;
    void import('@/lib/api-write-sync').then(m => m.pushLocalChangesToApi());
  }, coalescedApiPushBackoffMs);
}

function scheduleCoalescedApiPushAfterFailure(): void {
  coalescedApiPushBackoffMs = Math.min(
    Math.max(COALESCE_PUSH_DELAY_MS, coalescedApiPushBackoffMs * 2),
    MAX_PUSH_BACKOFF_MS,
  );
  scheduleCoalescedApiPush();
}

/** @deprecated 使用 scheduleCoalescedApiPush */
export function scheduleApiPushDebounced(): void {
  scheduleCoalescedApiPush();
}

/** 取消 debounce 并立即推送脏表（财务记账等需即时入库后端的场景） */
export async function flushApiDirtyTablesNow(opts?: {
  rethrow?: boolean;
  /** 仅推送这些表（及其 FK 父表扩展）；未指定则推送全部脏表 */
  onlyTables?: string[];
}): Promise<void> {
  if (coalescedApiPushTimer) {
    clearTimeout(coalescedApiPushTimer);
    coalescedApiPushTimer = null;
  }
  const maxWaitMs = 30000;
  const start = Date.now();
  while (apiPushInFlight) {
    if (Date.now() - start > maxWaitMs) break;
    await new Promise<void>(resolve => setTimeout(resolve, 50));
  }
  await pushApiDirtyTablesIfNeeded(opts);
}

/** 启动时扫描仍有待同步行的表并标记脏表 */
export async function markAllPendingTablesDirty(): Promise<void> {
  await markPendingTablesDirty(await listPendingApiSyncTableNames());
}

/** 仅将指定表中仍有 pending 行的表标记为脏（避免全库扫描引发无关表反复推送） */
export async function markPendingTablesDirty(tables: Iterable<string>): Promise<void> {
  const db = await getDatabase();
  if (!db) return;

  for (const table of tables) {
    const t = table.trim();
    if (!t || REST_SKIP_TABLES.has(t)) continue;
    if (!(await tableHasSyncStatusColumn(t))) continue;
    const pending = await db.getFirstAsync<{ n: number }>(
      `SELECT 1 AS n FROM ${quoteIdent(t)} WHERE sync_status != 'synced' LIMIT 1`,
    );
    if (pending) markApiTableDirty(t);
  }
}

async function listPendingApiSyncTableNames(): Promise<string[]> {
  const db = await getDatabase();
  if (!db) return [];
  const tables = (await listLocalUserTablesForApiUpload()).filter(t => !REST_SKIP_TABLES.has(t));
  const out: string[] = [];
  for (const table of tables) {
    if (!(await tableHasSyncStatusColumn(table))) continue;
    const pending = await db.getFirstAsync<{ n: number }>(
      `SELECT 1 AS n FROM ${quoteIdent(table)} WHERE sync_status != 'synced' LIMIT 1`,
    );
    if (pending) out.push(table);
  }
  return out;
}

/** 脏表增量：将本地待同步行推送到 REST 后端 */
export async function pushApiDirtyTablesIfNeeded(opts?: {
  rethrow?: boolean;
  onlyTables?: string[];
}): Promise<void> {
  const only = (opts?.onlyTables ?? [])
    .map(t => t.trim())
    .filter(t => t && isSafeTableName(t) && !REST_SKIP_TABLES.has(t));
  const mustRun = only.length > 0 || opts?.rethrow === true;

  // 关键路径若碰上正在推送，不可直接 return（否则 awaitSync 会误判成功且未推打卡）
  if (apiPushInFlight) {
    if (!mustRun) return;
    const maxWaitMs = 30000;
    const start = Date.now();
    while (apiPushInFlight) {
      if (Date.now() - start > maxWaitMs) {
        if (opts?.rethrow) throw new Error('同步繁忙，请稍后重试');
        scheduleCoalescedApiPush();
        return;
      }
      await new Promise<void>(resolve => setTimeout(resolve, 50));
    }
  }

  if (isSilentCloudRestoreInFlight()) {
    scheduleCoalescedApiPush();
    return;
  }

  const dirtyList =
    only.length > 0 ? only : peekApiDirtyTables().filter(t => !REST_SKIP_TABLES.has(t));
  if (dirtyList.length === 0) return;

  const db = await getDatabase();
  if (!db) return;

  try {
    await ensureApiLoggedIn();
  } catch (e) {
    if (__DEV__) console.warn('[api incremental] 登录失败', e);
    if (opts?.rethrow) throw e;
    scheduleCoalescedApiPush();
    return;
  }

  if (apiPushInFlight) {
    if (mustRun) {
      // 等待空档后重入，避免与其它推送交错丢 onlyTables
      const maxWaitMs = 30000;
      const start = Date.now();
      while (apiPushInFlight) {
        if (Date.now() - start > maxWaitMs) {
          if (opts?.rethrow) throw new Error('同步繁忙，请稍后重试');
          scheduleCoalescedApiPush();
          return;
        }
        await new Promise<void>(resolve => setTimeout(resolve, 50));
      }
      return pushApiDirtyTablesIfNeeded(opts);
    }
    return;
  }

  apiPushInFlight = true;
  try {
    const { insertOrder, rowsByTable } = await collectPendingDataForApiPush(dirtyList);
    // onlyTables 时禁止把未请求的脏表（如 points_wallet）捎带进同一次推送
    const allowed =
      only.length > 0
        ? new Set(
            insertOrder.filter(
              t => only.includes(t) || t === 'habits' || t === 'habit_check_ins',
            ),
          )
        : null;
    const effectiveOrder =
      allowed != null ? insertOrder.filter(t => allowed.has(t)) : insertOrder;

    if (effectiveOrder.length === 0) {
      await clearApiDirtyTablesWithoutPending(dirtyList);
      return;
    }

    const pkColsByTable = new Map<string, string[]>();
    for (const table of effectiveOrder) {
      pkColsByTable.set(table, await readTablePrimaryKeyColumns(db, table));
    }

    const idRemap = buildMysqlIdRemapForUpload(rowsByTable, pkColsByTable);
    applyMysqlIdRemapToUploadBundle(rowsByTable, idRemap);
    if (idRemap.size > 0) {
      const { applyEntityIdRemapToLocalDatabase } = await import('@/lib/entity-id-migrate');
      await applyEntityIdRemapToLocalDatabase(idRemap);
    }

    const uploadedPkByTable = new Map<string, Set<string>>();
    const fkRefsByTable = new Map<string, Awaited<ReturnType<typeof readLocalForeignKeyRefs>>>();
    for (const table of effectiveOrder) {
      fkRefsByTable.set(table, await readLocalForeignKeyRefs(table));
      uploadedPkByTable.set(table, new Set<string>());
    }

    for (const table of effectiveOrder) {
      const rawRows = rowsByTable.get(table) ?? [];
      if (rawRows.length === 0) continue;

      const pkCols = pkColsByTable.get(table) ?? ['id'];

      if (table === 'projects') {
        await ensureProjectCategoryRefsForApiUpload(rowsByTable);
        await upsertProjectCategoriesReferencedByProjects(
          rawRows,
          rowsByTable,
          pkColsByTable,
          uploadedPkByTable,
          fkRefsByTable,
        );
      }

      if (table === 'tasks') {
        await ensureTaskCategoryMirrorForApiUpload(rowsByTable);
        await upsertTaskCategoriesReferencedByTasks(
          rawRows,
          rowsByTable,
          pkColsByTable,
          uploadedPkByTable,
          fkRefsByTable,
        );
        await upsertProjectsReferencedByTasks(
          rawRows,
          rowsByTable,
          pkColsByTable,
          uploadedPkByTable,
          fkRefsByTable,
        );
        await upsertParentTasksReferencedByTasks(
          rawRows,
          rowsByTable,
          pkColsByTable,
          uploadedPkByTable,
          fkRefsByTable,
        );
      }

      const prepared = await prepareLocalRowsForUpload(table, rawRows, rowsByTable);
      let rows = dedupeRowsByPrimaryKey(prepared, pkCols);
      if (table === 'project_categories') {
        rows = sortProjectCategoriesForApiUpload(rows);
      }

      const uploadedRows: Record<string, unknown>[] = [];
      const uploadedPks = uploadedPkByTable.get(table)!;

      if (table === 'memos') {
        await upsertMemoDimensionsReferencedByMemos(
          rows,
          rowsByTable,
          pkColsByTable,
          uploadedPkByTable,
          fkRefsByTable,
        );
      }

      if (table === 'finance_transactions') {
        await upsertFinanceAccountsReferencedByTransactions(
          rows,
          rowsByTable,
          pkColsByTable,
          uploadedPkByTable,
          fkRefsByTable,
        );
      }

      if (table === 'habit_check_ins') {
        await upsertHabitsReferencedByCheckIns(
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
          // 积分钱包 OCC 不得中断同批其它表（打卡/流水）
          if (
            table === 'points_wallet' &&
            e instanceof Error &&
            /已有更新版本|过期数据覆盖|points_wallet/i.test(e.message)
          ) {
            if (__DEV__) console.warn('[api incremental] points_wallet 冲突已隔离', e.message);
            continue;
          }
          throw e;
        }
      }

      await markLocalRowsSynced(table, pkCols, uploadedRows);
    }

    await clearApiDirtyTablesWithoutPending(dirtyList);
    await setLastApiIncrementalSyncAtIso(new Date().toISOString());
    coalescedApiPushBackoffMs = COALESCE_PUSH_DELAY_MS;
  } catch (e) {
    if (__DEV__) console.warn('[api incremental] 推送失败', e);
    if (opts?.rethrow) throw e;
    scheduleCoalescedApiPushAfterFailure();
  } finally {
    apiPushInFlight = false;
  }
}
