import AsyncStorage from '@react-native-async-storage/async-storage';

import { setLastApiIncrementalSyncAtIso } from '@/lib/api-backup-meta';
import { isApiGenericWriteForbidden } from '@/lib/api-allowed-tables';
import { ApiRequestError, ensureApiLoggedIn } from '@/lib/api-client';
import { isSyncOccConflictApiError } from '@/lib/sync-write-meta';
import { invalidateInflightApiTableFetch } from '@/lib/api-read';
import {
  ApiRowUploadSkippedError,
  rowPrimaryKeyValue,
  upsertProjectCategoriesReferencedByProjects,
  upsertFinanceAccountsReferencedByTransactions,
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
  ensureTaskCategoryMirrorForApiUpload,
  prepareLocalRowsForUpload,
  readLocalForeignKeyRefs,
  resolveApiPushInsertOrder,
  sortProjectCategoriesForApiUpload,
  listLocalUserTablesForApiUpload,
  type LocalTableUploadBundle,
} from '@/lib/cloud-sql-sync';
import { isSilentCloudRestoreInFlight } from '@/lib/cloud-sync-flags';
import { extraDataNeedsSlimForMysql, slimExtraDataFieldForMysql } from '@/lib/api-mysql-payload';
import { getDatabase } from '@/lib/database';
import { dedupeRowsByPrimaryKey, readTablePrimaryKeyColumns } from '@/lib/sqlite-primary-key-dedupe';

/**
 * REST 增量同步跳过的表（与全量迁移一致）。
 * 另：高危表中「无 APP 专用 CRUD 适配」的不得再走 /api/data 通用写（见 API_GENERIC_WRITE_FORBIDDEN_TABLES）。
 */
export const REST_SKIP_TABLES = new Set([
  'admin_users',
  /** 本地迁移/回填标记，仅设备内有效，见 API_LOCAL_READ_ONLY_TABLES */
  'app_meta',
  /** 积分权威在服务端 adjust；禁止通用写钱包/流水 */
  'points_wallet',
  'points_ledger',
  /** 课表仅视图/排课层：走 frog-schedule 专用接口，禁止通用 CRUD 推送 */
  'schedule_placements',
  'schedule_week_axis_snapshot',
]);

/** 禁止通用写、但可由 api-app-domain 专用接口上传的表（仍进脏表推送） */
const APP_DOMAIN_GENERIC_WRITE_FORBIDDEN = new Set([
  'wish_board_items',
  'memos',
  'health_records',
  'recipe_categories',
  'recipe_items',
  'finance_transactions',
]);

function shouldSkipGenericRestUpload(table: string): boolean {
  if (REST_SKIP_TABLES.has(table)) return true;
  // 双保险：后端禁写且未走专用适配的表一律不推
  if (isApiGenericWriteForbidden(table) && !APP_DOMAIN_GENERIC_WRITE_FORBIDDEN.has(table)) {
    return true;
  }
  return false;
}

/** 启动闸门只统计真正会走推送的表，避免冲不掉的历史行冒充「没网」。 */
function isPendingFlushTrackedTable(table: string): boolean {
  return !shouldSkipGenericRestUpload(table) || APP_DOMAIN_GENERIC_WRITE_FORBIDDEN.has(table);
}

const API_DIRTY_STATE_KEY = 'selfapp:api-dirty-tables-v1';

const apiDirtyTables = new Set<string>();
let apiPersistTimer: ReturnType<typeof setTimeout> | null = null;
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
  if (shouldSkipGenericRestUpload(t) && !APP_DOMAIN_GENERIC_WRITE_FORBIDDEN.has(t)) return;
  if (t.startsWith('sqlite_')) return;
  // P0-03：单一在线 Outbox（MySQL /api）；Worker 备份不经此队列
  apiDirtyTables.add(t);
  invalidateInflightApiTableFetch(t);
  schedulePersistApiDirty();
  scheduleUnifiedPush();
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
    if (apiDirtyTables.size > 0) scheduleUnifiedPush();
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
    const pending = await readUnsyncedRowsForTable(table);
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

async function readUnsyncedRowsForTable(table: string): Promise<Record<string, unknown>[]> {
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
        continue;
      }
      // habit_check_ins：若本地 count 已比上传快照更新，保留 pending，避免旧快照把更高次数标成 synced 后被下行覆盖
      if (table === 'habit_check_ins' && row.count != null) {
        const uploadedCount = Math.max(0, Math.floor(Number(row.count) || 0));
        await db.runAsync(
          `UPDATE habit_check_ins
            SET sync_status = 'synced'
            WHERE id = ?
              AND sync_status IN ('pending_create', 'pending_update')
              AND count = ?`,
          [pk, uploadedCount],
        );
        continue;
      }
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

  const rowsByTable = new Map<string, Record<string, unknown>[]>();
  const db = await getDatabase();

  for (const table of filtered) {
    const pending = await readUnsyncedRowsForTable(table);
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

  const seedWithRefs = [...filtered];
  if ((rowsByTable.get('finance_accounts')?.length ?? 0) > 0 && !seedWithRefs.includes('finance_accounts')) {
    seedWithRefs.push('finance_accounts');
  }
  if ((rowsByTable.get('habit_check_ins')?.length ?? 0) > 0 && !seedWithRefs.includes('habits')) {
    seedWithRefs.push('habits');
  }

  const effectiveOrder = (await resolveApiPushInsertOrder(seedWithRefs)).filter(
    t => (rowsByTable.get(t)?.length ?? 0) > 0,
  );
  return { insertOrder: effectiveOrder, rowsByTable };
}

/** 脏表标记后走 SyncManager 单一队列（不再自建 50ms timer） */
function scheduleUnifiedPush(): void {
  void import('@/lib/sync-manager').then(m => m.requestPush());
}

function scheduleUnifiedPushAfterFailure(): void {
  void import('@/lib/sync-manager').then(m => m.requestRetryAfterFailure());
}

/** 由 SyncManager 调用的脏表 flush 实现；业务代码请走 requestPush */
export async function flushApiDirtyTablesNow(opts?: {
  rethrow?: boolean;
  /** 仅推送这些表（及其 FK 父表扩展）；未指定则推送全部脏表 */
  onlyTables?: string[];
}): Promise<void> {
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

/** 开发日志 / 启动闸门：各表 pending 行数（仅 >0） */
export async function countPendingApiSyncRowsByTable(): Promise<Record<string, number>> {
  const db = await getDatabase();
  if (!db) return {};
  const tables = (await listLocalUserTablesForApiUpload()).filter(t => isPendingFlushTrackedTable(t));
  const out: Record<string, number> = {};
  for (const table of tables) {
    if (!(await tableHasSyncStatusColumn(table))) continue;
    const row = await db.getFirstAsync<{ n: number }>(
      `SELECT COUNT(*) AS n FROM ${quoteIdent(table)} WHERE sync_status != 'synced'`,
    );
    const n = Number(row?.n ?? 0);
    if (n > 0) out[table] = n;
  }
  return out;
}

function isPayloadTooLargeUploadError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  if (/entity too large|data too long|ER_DATA_TOO_LONG|payload too large/i.test(msg)) return true;
  return err instanceof ApiRequestError && err.httpStatus === 413;
}

async function persistSlimmedExtraData(
  table: string,
  pkCol: string,
  pk: string,
  extraData: string | null,
): Promise<void> {
  const db = await getDatabase();
  if (!db) return;
  beginCloudSqliteDirtyIgnoreBatch();
  try {
    await db.runAsync(
      `UPDATE ${quoteIdent(table)} SET extra_data = ? WHERE ${quoteIdent(pkCol)} = ?`,
      [extraData, pk],
    );
  } catch (e) {
    if (__DEV__) console.warn('[api incremental] 回写瘦身 extra_data 失败', table, e);
  } finally {
    endCloudSqliteDirtyIgnoreBatch();
  }
}

/**
 * 把 pending 行里超大 extra_data（截图 base64 等）就地瘦身，避免 HTTP 413 / MySQL TEXT 写爆。
 * 返回改写行数。
 */
export async function slimPendingExtraDataInSqlite(): Promise<number> {
  const db = await getDatabase();
  if (!db) return 0;
  const tables = (await listLocalUserTablesForApiUpload()).filter(t => isPendingFlushTrackedTable(t));
  let changed = 0;
  for (const table of tables) {
    if (!(await tableHasSyncStatusColumn(table))) continue;
    const cols = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${quoteIdent(table)})`);
    if (!cols.some(c => c.name === 'extra_data')) continue;
    const pkCols = await readTablePrimaryKeyColumns(db, table);
    const pkCol = pkCols[0] ?? 'id';
    const rows = await db.getAllAsync<Record<string, unknown>>(
      `SELECT ${quoteIdent(pkCol)} AS pk, extra_data FROM ${quoteIdent(table)} WHERE sync_status != 'synced'`,
    );
    for (const row of rows ?? []) {
      const pk = row.pk == null || row.pk === '' ? '' : String(row.pk);
      if (!pk) continue;
      if (!extraDataNeedsSlimForMysql(row.extra_data)) continue;
      const slimmed = slimExtraDataFieldForMysql(row.extra_data);
      const before =
        typeof row.extra_data === 'string' ? row.extra_data : JSON.stringify(row.extra_data ?? '');
      const after = slimmed ?? '';
      if (after === before) continue;
      await persistSlimmedExtraData(table, pkCol, pk, slimmed);
      changed += 1;
    }
  }
  return changed;
}

async function listPendingApiSyncTableNames(): Promise<string[]> {
  const db = await getDatabase();
  if (!db) return [];
  const tables = (await listLocalUserTablesForApiUpload()).filter(t => isPendingFlushTrackedTable(t));
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

/** 脏表增量：将本地待同步行推送到 REST 后端。仅 flushApiDirtyTablesNow 可调用。 */
async function pushApiDirtyTablesIfNeeded(opts?: {
  rethrow?: boolean;
  onlyTables?: string[];
}): Promise<void> {
  const only = (opts?.onlyTables ?? [])
    .map(t => t.trim())
    .filter(t => t && isSafeTableName(t) && !REST_SKIP_TABLES.has(t));
  const mustRun = only.length > 0 || opts?.rethrow === true;

  // 关键路径若碰上正在推送，不可直接 return（否则 awaitSync 会误判成功且未推打卡）
  if (apiPushInFlight) {
    if (!mustRun) {
      // 后台 debounce 推送撞上 inflight 时必须再排一次，否则新增行会卡在 pending_create
      scheduleUnifiedPush();
      return;
    }
    const maxWaitMs = 30000;
    const start = Date.now();
    while (apiPushInFlight) {
      if (Date.now() - start > maxWaitMs) {
        if (opts?.rethrow) throw new Error('同步繁忙，请稍后重试');
        scheduleUnifiedPushAfterFailure();
        return;
      }
      await new Promise<void>(resolve => setTimeout(resolve, 50));
    }
  }

  if (isSilentCloudRestoreInFlight()) {
    if (opts?.rethrow) {
      throw new Error('正在恢复本地数据，请稍后重试同步');
    }
    scheduleUnifiedPush();
    return;
  }

  const dirtyList =
    only.length > 0 ? only : peekApiDirtyTables().filter(t => !REST_SKIP_TABLES.has(t));
  if (dirtyList.length === 0) {
    if (opts?.rethrow) {
      const pending = await listPendingApiSyncTableNames();
      if (pending.length > 0) {
        throw new Error('有未同步到服务器的本地修改，请保持网络后重试');
      }
    }
    return;
  }

  const db = await getDatabase();
  if (!db) {
    if (opts?.rethrow) throw new Error('本地数据库未就绪，请稍后重试');
    return;
  }

  try {
    await ensureApiLoggedIn();
  } catch (e) {
    if (__DEV__) console.warn('[api incremental] 登录失败', e);
    if (opts?.rethrow) throw e;
    scheduleUnifiedPushAfterFailure();
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
          scheduleUnifiedPushAfterFailure();
          return;
        }
        await new Promise<void>(resolve => setTimeout(resolve, 50));
      }
      return pushApiDirtyTablesIfNeeded(opts);
    }
    scheduleUnifiedPush();
    return;
  }

  apiPushInFlight = true;
  try {
    // Fast Refresh 不会重跑 initDatabase；推送前必须换掉会 UNIQUE 崩的旧镜像触发器
    const { ensureProjectToTaskCategoryMirrorTriggers } = await import('@/lib/database');
    await ensureProjectToTaskCategoryMirrorTriggers(db);

    const { insertOrder, rowsByTable } = await collectPendingDataForApiPush(dirtyList);
    // onlyTables 时禁止把未请求的脏表（如 points_wallet）捎带进同一次推送
    const allowed =
      only.length > 0
        ? new Set(
            insertOrder.filter(
              t =>
                only.includes(t) ||
                t === 'habits' ||
                t === 'habit_check_ins' ||
                // FK 父表：由 ensure*Refs 扩进 bundle，不得被 onlyTables 滤掉
                t === 'finance_accounts' ||
                t === 'finance_flow_categories' ||
                t === 'project_categories' ||
                t === 'task_categories',
            ),
          )
        : null;
    const effectiveOrder =
      allowed != null ? insertOrder.filter(t => allowed.has(t)) : insertOrder;

    if (effectiveOrder.length === 0) {
      await clearApiDirtyTablesWithoutPending(dirtyList);
      if (opts?.rethrow) {
        const pending = await listPendingApiSyncTableNames();
        if (pending.length > 0) {
          throw new Error(`有未同步到服务器的本地修改（${pending.join('、')}），请保持网络后重试`);
        }
      }
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

    const leftoverReasons: string[] = [];
    let uploadedCount = 0;

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

      if (table === 'finance_transactions' || table === 'finance_scheduled_expenses') {
        // 幽灵 synced：本地账户已标 synced 但服务端缺失时，须强制预传，否则定时支出/流水报「请先同步 finance_accounts」
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
        let uploadRow = row;
        try {
          // habit_check_ins：上传前重读本地，避免 flush 开始时快照仍是 count=1，而连点后已到更高次数
          if (table === 'habit_check_ins') {
            const pkNow = rowPrimaryKeyValue(row, pkCols);
            if (pkNow) {
              const fresh = await fetchRowByPk(table, pkCols[0] ?? 'id', pkNow);
              if (!fresh || fresh.sync_status === 'synced') {
                continue;
              }
              if (fresh.sync_status === 'pending_delete') {
                uploadRow = fresh;
              } else {
                const snapCount = Math.max(0, Math.floor(Number(row.count) || 0));
                const freshCount = Math.max(0, Math.floor(Number(fresh.count) || 0));
                uploadRow = freshCount >= snapCount ? fresh : { ...fresh, count: snapCount };
              }
            }
          }
          if (extraDataNeedsSlimForMysql(uploadRow.extra_data)) {
            const slimmed = slimExtraDataFieldForMysql(uploadRow.extra_data);
            const pkNow = rowPrimaryKeyValue(uploadRow, pkCols);
            if (pkNow) {
              await persistSlimmedExtraData(table, pkCols[0] ?? 'id', pkNow, slimmed);
            }
            uploadRow = { ...uploadRow, extra_data: slimmed };
          }
          const action = await upsertRowToApi(table, uploadRow, pkCols, {
            uploadedPkByTable,
            fkRefs: fkRefsByTable.get(table) ?? [],
            rowsByTable,
            pkColsByTable,
            fkRefsByTable,
          });
          uploadedRows.push(uploadRow);
          uploadedCount += 1;
          const pk = rowPrimaryKeyValue(uploadRow, pkCols);
          if (pk) uploadedPks.add(pk);
          if (__DEV__) console.log(`[api incremental] ${table} ${action}`, pk);
        } catch (e) {
          if (isPayloadTooLargeUploadError(e)) {
            const pkNow = rowPrimaryKeyValue(uploadRow, pkCols);
            const slimmed = slimExtraDataFieldForMysql(uploadRow.extra_data);
            if (pkNow) {
              await persistSlimmedExtraData(table, pkCols[0] ?? 'id', pkNow, slimmed);
            }
            uploadRow = { ...uploadRow, extra_data: slimmed };
            try {
              const action = await upsertRowToApi(table, uploadRow, pkCols, {
                uploadedPkByTable,
                fkRefs: fkRefsByTable.get(table) ?? [],
                rowsByTable,
                pkColsByTable,
                fkRefsByTable,
              });
              uploadedRows.push(uploadRow);
              uploadedCount += 1;
              if (pkNow) uploadedPks.add(pkNow);
              if (__DEV__) console.log(`[api incremental] ${table} ${action} (slim-retry)`, pkNow);
              continue;
            } catch (retryErr) {
              leftoverReasons.push(
                `${table}: ${retryErr instanceof Error ? retryErr.message : String(retryErr)}`,
              );
              throw retryErr;
            }
          }
          if (e instanceof ApiRowUploadSkippedError) {
            if (__DEV__) console.warn('[api incremental] 跳过', table, e.message);
            // 高危表禁写 / 专用接口未覆盖：本地标 synced，避免脏表无限重试拖垮同步
            if (isApiGenericWriteForbidden(table) || /禁止通用|App domain fallback|专用接口未覆盖/i.test(e.message)) {
              uploadedRows.push(uploadRow);
              continue;
            }
            leftoverReasons.push(`${table}: ${e.message}`);
            continue;
          }
          // 后端 403 禁写：隔离该行并标 synced
          if (
            e instanceof ApiRequestError &&
            e.httpStatus === 403 &&
            (/禁止通过|专用业务|writeForbidden/i.test(e.message) || isApiGenericWriteForbidden(table))
          ) {
            if (__DEV__) console.warn('[api incremental] 通用写已禁用，跳过', table, e.message);
            uploadedRows.push(uploadRow);
            continue;
          }
          // OCC：单行隔离，不打断同批其它 pending（1-A 任务冲刷不得被习惯 409 拖死）
          if (isSyncOccConflictApiError(e)) {
            leftoverReasons.push(`${table}: ${e instanceof Error ? e.message : '版本冲突'}`);
            if (__DEV__) console.warn('[api incremental] OCC 已隔离', table, e.message);
            continue;
          }
          // 积分钱包 OCC 不得中断同批其它表（打卡/流水）
          if (
            table === 'points_wallet' &&
            e instanceof Error &&
            /已有更新版本|过期数据覆盖|points_wallet|禁止通用/i.test(e.message)
          ) {
            if (__DEV__) console.warn('[api incremental] points_wallet 冲突已隔离', e.message);
            uploadedRows.push(uploadRow);
            continue;
          }
          // 远端白名单有表但物理表未建：隔离该表，避免整批失败并无限退避重试
          if (
            e instanceof ApiRequestError &&
            (e.httpStatus === 404 || e.httpStatus === 500) &&
            /表\s+\S+\s+不存在/.test(e.message)
          ) {
            leftoverReasons.push(`${table}: ${e.message}`);
            if (__DEV__) console.warn('[api incremental] 远端缺表已隔离', table, e.message);
            clearApiDirtyTables([table]);
            break;
          }
          leftoverReasons.push(`${table}: ${e instanceof Error ? e.message : String(e)}`);
          throw e;
        }
      }

      await markLocalRowsSynced(table, pkCols, uploadedRows);
    }

    await clearApiDirtyTablesWithoutPending(dirtyList);
    await setLastApiIncrementalSyncAtIso(new Date().toISOString());
    const { resetPushBackoff } = await import('@/lib/sync-manager');
    resetPushBackoff();
    if (opts?.rethrow && uploadedCount === 0 && leftoverReasons.length > 0) {
      throw new Error(leftoverReasons.slice(0, 4).join('\n'));
    }
  } catch (e) {
    if (__DEV__) console.warn('[api incremental] 推送失败', e);
    if (opts?.rethrow) throw e;
    scheduleUnifiedPushAfterFailure();
  } finally {
    apiPushInFlight = false;
  }
}
