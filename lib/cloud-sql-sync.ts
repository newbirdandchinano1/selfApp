import { shouldPreserveForeignKeyOnUpload } from '@/lib/api-fk-preserve';
import { setLastCloudAlignAtIso, setLastFullCloudBackupAtIso } from '@/lib/cloud-backup-meta';
import { CLOUD_BACKUP_NOT_CONFIGURED_MSG, getCloudAuthToken } from '@/lib/cloud-backup-config';
import { executeCloudSql } from '@/lib/cloud-sql-client';
import {
  beginCloudSqliteDirtyIgnoreBatch,
  clearAllCloudSqliteDirtyTables,
  clearCloudSqliteDirtyTables,
  endCloudSqliteDirtyIgnoreBatch,
  peekCloudSqliteDirtyTables,
  scheduleCloudTablePushDebounced,
} from '@/lib/cloud-sql-dirty-track';
import { isSilentCloudRestoreInFlight, setSilentCloudRestoreInFlight } from '@/lib/cloud-sync-flags';
import { getDatabase, initDatabase } from '@/lib/database';
import {
  INBOX_PROJECT_CATEGORY_ID,
  INBOX_PROJECT_CATEGORY_NAME,
} from '@/lib/repositories/projects/constants';
import { throwIfAborted, isAbortError } from '@/lib/cloud-fetch-retry';
import {
  dedupeLocalTablesByPrimaryKeyIfNeeded,
  dedupeRowsByPrimaryKey,
  readTablePrimaryKeyColumns,
} from '@/lib/sqlite-primary-key-dedupe';

/**
 * Cloudflare D1 单条语句绑定变量硬上限约为 999，实测批量 INSERT 在 ~504 即报错（offset 503）。
 * 留足余量，按「列数 × 行数」限制每批行数；必要时降为单行插入。
 */
const D1_MAX_SQL_VARIABLES = 96;

function insertBatchRowCount(columnCount: number): number {
  if (columnCount <= 0) return 1;
  return Math.max(1, Math.floor(D1_MAX_SQL_VARIABLES / columnCount));
}

export function serializeErrorForDiagnostic(err: unknown): string {
  if (err instanceof Error) {
    const anyErr = err as Error & { cause?: unknown };
    const parts = [`${anyErr.name}: ${anyErr.message}`];
    if (typeof anyErr.stack === 'string' && anyErr.stack.trim()) parts.push(anyErr.stack);
    if (anyErr.cause != null) parts.push('', 'cause:', serializeErrorForDiagnostic(anyErr.cause));
    return parts.join('\n');
  }
  try {
    return JSON.stringify(err, null, 2);
  } catch {
    return String(err);
  }
}

export type CloudSyncProgress = {
  phase:
    | 'preparing'
    | 'collecting'
    | 'cloud_schema'
    | 'uploading'
    | 'downloading'
    | 'applying';
  tableIndex?: number;
  tableCount?: number;
  tableLabel?: string;
};

async function yieldToUi(): Promise<void> {
  await new Promise<void>(resolve => setTimeout(resolve, 0));
}

export type CloudSyncResult =
  | {
      ok: true;
      tableCount: number;
      rowCount: number;
      lastUpdated: string;
    }
  | {
      ok: false;
      reason: 'no_config' | 'collect_failed' | 'upload_failed' | 'download_failed' | 'apply_failed' | 'aborted' | 'unsupported_platform';
      message: string;
      diagnosticText: string;
    };

export type CloudRestoreResult =
  | {
      ok: true;
      cloudLastUpdated: string;
      sqliteTables: number;
      sqliteRows: number;
      warnings: string[];
      tablesNotInBackup: string[];
    }
  | {
      ok: false;
      reason: 'no_config' | 'fetch_failed' | 'apply_failed' | 'unsupported_platform' | 'aborted';
      message: string;
      diagnosticText: string;
    };

function isSafeSqliteTableName(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}

/** Cloudflare D1 内置表（如 _cf_KV），不可 DROP，也不参与应用备份同步 */
function isCloudManagedTableName(name: string): boolean {
  const n = name.trim();
  if (!n) return true;
  const lower = n.toLowerCase();
  if (lower.startsWith('sqlite_')) return true;
  if (lower.startsWith('_cf_')) return true;
  return false;
}

/** 本应用可同步的用户业务表 */
function isAppSyncTableName(name: string): boolean {
  return isSafeSqliteTableName(name) && !isCloudManagedTableName(name);
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function toCreateTableIfNotExists(sql: string): string {
  if (/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS/i.test(sql)) return sql;
  return sql.replace(/^CREATE\s+TABLE\s+/i, 'CREATE TABLE IF NOT EXISTS ');
}

/** 云端镜像库不启用外键，避免 D1 批量同步时顺序/历史表结构导致 CONSTRAINT 失败 */
function stripForeignKeysFromCreateTableSql(sql: string): string {
  let s = sql;
  s = s.replace(
    /,?\s*FOREIGN\s+KEY\s*\([^)]*\)\s*REFERENCES\s+(?:[`"]?\w+[`"]?\.)?[`"]?\w+[`"]?\s*\([^)]*\)(?:\s+ON\s+(?:DELETE|UPDATE)\s+(?:SET\s+NULL|SET\s+DEFAULT|CASCADE|RESTRICT|NO\s+ACTION))*/gi,
    '',
  );
  s = s.replace(/,(\s*,)+/g, ',');
  s = s.replace(/,(\s*\))/g, '$1');
  return s;
}

/** 云端镜像表：无外键，且永不因「表已存在」失败 */
function toCloudMirrorCreateSql(localCreateSql: string): string {
  return toCreateTableIfNotExists(stripForeignKeysFromCreateTableSql(localCreateSql));
}

async function cloudTableExists(table: string, signal?: AbortSignal): Promise<boolean> {
  const r = await executeCloudSql<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
    [table],
    { signal },
  );
  if (!r.ok) return false;
  return r.data.some(row => String(row.name) === table);
}

function sqliteBindingFromJson(v: unknown): string | number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return null;
    return v;
  }
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

async function listLocalUserTables(): Promise<string[]> {
  const db = await getDatabase();
  const meta = await db.getAllAsync<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type='table' AND substr(name,1,7) != 'sqlite_' ORDER BY name`,
  );
  return meta.map(r => r.name).filter(n => isAppSyncTableName(n));
}

async function listCloudUserTables(signal?: AbortSignal): Promise<string[]> {
  const r = await executeCloudSql<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type='table' AND substr(name,1,7) != 'sqlite_' ORDER BY name`,
    undefined,
    { signal },
  );
  if (!r.ok) throw new Error(r.message);
  return r.data.map(row => row.name).filter(n => isAppSyncTableName(n));
}

async function getLocalCreateTableSql(table: string): Promise<string | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ sql: string }>(
    `SELECT sql FROM sqlite_master WHERE type='table' AND name=?`,
    [table],
  );
  return row?.sql ?? null;
}

async function getCloudCreateTableSql(table: string, signal?: AbortSignal): Promise<string | null> {
  const r = await executeCloudSql<{ sql: string }>(
    `SELECT sql FROM sqlite_master WHERE type='table' AND name=?`,
    [table],
    { signal },
  );
  if (!r.ok) return null;
  return r.data[0]?.sql ?? null;
}

type LocalForeignKeyGraph = {
  tables: string[];
  parents: Map<string, string[]>;
  children: Map<string, string[]>;
};

let localForeignKeyGraphCache: LocalForeignKeyGraph | null = null;

type ForeignKeyRef = {
  parentTable: string;
  fromColumn: string;
  toColumn: string;
};

export async function readLocalForeignKeyRefs(table: string): Promise<ForeignKeyRef[]> {
  const db = await getDatabase();
  const safe = quoteIdent(table);
  const fks = await db.getAllAsync<{ table: string; from: string; to: string }>(
    `PRAGMA foreign_key_list(${safe})`,
  );
  return fks
    .filter(fk => fk.table && isSafeSqliteTableName(fk.table) && fk.from && fk.to)
    .map(fk => ({ parentTable: fk.table, fromColumn: fk.from, toColumn: fk.to }));
}

async function readLocalForeignKeyParents(table: string): Promise<string[]> {
  const refs = await readLocalForeignKeyRefs(table);
  return [...new Set(refs.map(r => r.parentTable))];
}

function sortRowsBySelfForeignKey(
  rows: Record<string, unknown>[],
  idColumn: string,
  parentColumn: string,
): Record<string, unknown>[] {
  const byId = new Map<string, Record<string, unknown>>();
  const noId: Record<string, unknown>[] = [];

  for (const row of rows) {
    const id = row[idColumn];
    if (id == null || id === '') {
      noId.push(row);
      continue;
    }
    byId.set(String(id), row);
  }

  const sorted: Record<string, unknown>[] = [];
  const done = new Set<string>();
  const visiting = new Set<string>();

  const visit = (id: string): void => {
    if (done.has(id)) return;
    if (visiting.has(id)) return;
    visiting.add(id);
    const row = byId.get(id);
    if (!row) {
      visiting.delete(id);
      return;
    }
    const parentId = row[parentColumn];
    if (parentId != null && parentId !== '') {
      const pid = String(parentId);
      if (byId.has(pid)) visit(pid);
    }
    visiting.delete(id);
    if (!done.has(id)) {
      done.add(id);
      sorted.push(row);
    }
  };

  for (const id of byId.keys()) visit(id);
  return [...sorted, ...noId];
}

/** 打断自引用环，避免插入时 FK 失败 */
function breakSelfForeignKeyCycles(
  rows: Record<string, unknown>[],
  idColumn: string,
  parentColumn: string,
): Record<string, unknown>[] {
  const byId = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const id = row[idColumn];
    if (id != null && id !== '') byId.set(String(id), row);
  }

  const visiting = new Set<string>();
  const breakParent = (id: string): void => {
    if (visiting.has(id)) return;
    visiting.add(id);
    const row = byId.get(id);
    if (!row) {
      visiting.delete(id);
      return;
    }
    const parentId = row[parentColumn];
    if (parentId != null && parentId !== '') {
      const pid = String(parentId);
      if (visiting.has(pid)) {
        row[parentColumn] = null;
      } else if (byId.has(pid)) {
        breakParent(pid);
      }
    }
    visiting.delete(id);
  };

  for (const id of byId.keys()) breakParent(id);
  return rows;
}

async function prepareRowsForCloudInsert(
  table: string,
  rows: Record<string, unknown>[],
  rowsByTable: Map<string, Record<string, unknown>[]>,
): Promise<Record<string, unknown>[]> {
  const fks = await readLocalForeignKeyRefs(table);
  let prepared = rows.map(r => ({ ...r }));

  for (const fk of fks) {
    if (fk.parentTable === table) continue;
    if (shouldPreserveForeignKeyOnUpload(table, fk)) continue;
    const parentRows = rowsByTable.get(fk.parentTable) ?? [];
    const parentIds = new Set<string>();
    for (const pr of parentRows) {
      const pid = pr[fk.toColumn];
      if (pid != null && pid !== '') parentIds.add(String(pid));
    }
    for (const row of prepared) {
      const val = row[fk.fromColumn];
      if (val == null || val === '') continue;
      if (!parentIds.has(String(val))) {
        row[fk.fromColumn] = null;
      }
    }
  }

  for (const fk of fks.filter(f => f.parentTable === table)) {
    const ids = new Set<string>();
    for (const row of prepared) {
      const id = row[fk.toColumn];
      if (id != null && id !== '') ids.add(String(id));
    }
    for (const row of prepared) {
      const parentId = row[fk.fromColumn];
      if (parentId == null || parentId === '') continue;
      if (!ids.has(String(parentId))) {
        row[fk.fromColumn] = null;
      }
    }
    prepared = breakSelfForeignKeyCycles(prepared, fk.toColumn, fk.fromColumn);
    prepared = sortRowsBySelfForeignKey(prepared, fk.toColumn, fk.fromColumn);
  }

  if (table === 'habit_check_ins') {
    prepared = filterHabitCheckInsForCloudUpload(prepared, rowsByTable);
  }

  return prepared;
}

async function buildLocalForeignKeyGraph(): Promise<LocalForeignKeyGraph> {
  if (localForeignKeyGraphCache) return localForeignKeyGraphCache;

  const tables = await listLocalUserTables();
  const parents = new Map<string, string[]>();
  const children = new Map<string, string[]>();
  const tableSet = new Set(tables);

  for (const t of tables) {
    parents.set(t, []);
    children.set(t, []);
  }

  for (const t of tables) {
    const ps = (await readLocalForeignKeyParents(t)).filter(p => tableSet.has(p));
    parents.set(t, ps);
    for (const p of ps) {
      children.get(p)!.push(t);
    }
  }

  localForeignKeyGraphCache = { tables, parents, children };
  return localForeignKeyGraphCache;
}

export function invalidateLocalForeignKeyGraphCache(): void {
  localForeignKeyGraphCache = null;
}

/** 上传前扩展：包含所有外键父表 + 子表（避免只同步父表时云端 DELETE 被子表 FK 拦住） */
function expandTablesForCloudUpload(seedTables: string[], graph: LocalForeignKeyGraph): string[] {
  const allSet = new Set(graph.tables);
  const set = new Set<string>();
  for (const t of seedTables) {
    if (allSet.has(t) && isSafeSqliteTableName(t)) set.add(t);
  }
  const queue = [...set];
  while (queue.length > 0) {
    const t = queue.shift()!;
    for (const p of graph.parents.get(t) ?? []) {
      if (!set.has(p)) {
        set.add(p);
        queue.push(p);
      }
    }
    for (const c of graph.children.get(t) ?? []) {
      if (!set.has(c)) {
        set.add(c);
        queue.push(c);
      }
    }
  }
  return graph.tables.filter(t => set.has(t));
}

/** 从云写入本机时扩展：仅补全外键父表（不主动清空未下载的子表） */
function expandTablesForCloudApply(seedTables: string[], graph: LocalForeignKeyGraph): string[] {
  const allSet = new Set(graph.tables);
  const set = new Set<string>();
  for (const t of seedTables) {
    if (allSet.has(t) && isSafeSqliteTableName(t)) set.add(t);
  }
  const queue = [...set];
  while (queue.length > 0) {
    const t = queue.shift()!;
    for (const p of graph.parents.get(t) ?? []) {
      if (!set.has(p)) {
        set.add(p);
        queue.push(p);
      }
    }
  }
  return graph.tables.filter(t => set.has(t));
}

/** 父表在前、子表在后 */
function sortTablesForCloudInsert(tables: string[], graph: LocalForeignKeyGraph): string[] {
  const tableSet = new Set(tables);
  const sorted: string[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();

  const visit = (table: string): void => {
    if (visited.has(table) || !tableSet.has(table)) return;
    if (visiting.has(table)) {
      sorted.push(table);
      visited.add(table);
      return;
    }
    visiting.add(table);
    for (const parent of graph.parents.get(table) ?? []) {
      if (tableSet.has(parent)) visit(parent);
    }
    visiting.delete(table);
    if (!visited.has(table)) {
      visited.add(table);
      sorted.push(table);
    }
  };

  for (const table of tables) visit(table);
  return sorted;
}

function sortTablesForCloudDelete(insertOrder: string[]): string[] {
  return [...insertOrder].reverse();
}

/** REST 增量推送：按外键依赖排序（仅扩展父表） */
export async function resolveApiPushInsertOrder(seedTables: string[]): Promise<string[]> {
  if (seedTables.length === 0) return [];
  const graph = await buildLocalForeignKeyGraph();
  const tables = expandTablesForCloudApply(seedTables, graph);
  return sortTablesForCloudInsert(tables, graph);
}

async function trySetCloudForeignKeys(enabled: boolean, signal?: AbortSignal): Promise<void> {
  const sql = enabled ? 'PRAGMA foreign_keys = ON' : 'PRAGMA foreign_keys = OFF';
  await executeCloudSql(sql, undefined, { signal });
}

/** 云端无表时按本地结构建表；已有表则不动结构 */
async function ensureCloudTableExists(
  table: string,
  localCreateSql: string,
  signal?: AbortSignal,
): Promise<void> {
  if (await cloudTableExists(table, signal)) return;

  await trySetCloudForeignKeys(false, signal);
  try {
    const createSql = toCloudMirrorCreateSql(localCreateSql);
    const create = await executeCloudSql(createSql, undefined, { signal });
    if (!create.ok) {
      throw new Error(`云端建表 ${table} 失败：${create.message}`);
    }
  } finally {
    await trySetCloudForeignKeys(true, signal);
  }
}

/** 仅重建单张云端表（DROP + CREATE），用于常规同步失败后的兜底 */
async function recreateSingleCloudTableFromLocal(
  table: string,
  localCreateSql: string,
  signal?: AbortSignal,
): Promise<void> {
  await trySetCloudForeignKeys(false, signal);
  try {
    const drop = await executeCloudSql(`DROP TABLE IF EXISTS ${quoteIdent(table)}`, undefined, { signal });
    if (!drop.ok && !/no such table/i.test(drop.message)) {
      throw new Error(`云端删表 ${table} 失败：${drop.message}`);
    }
    const createSql = toCloudMirrorCreateSql(localCreateSql);
    const create = await executeCloudSql(createSql, undefined, { signal });
    if (!create.ok) {
      throw new Error(`云端建表 ${table} 失败：${create.message}`);
    }
  } finally {
    await trySetCloudForeignKeys(true, signal);
  }
}

/**
 * 将单张本地表推送到云端：先确保表存在 → 清空并写入；
 * 任一步失败则仅对该表 DROP 重建后再推送一次。
 */
async function pushLocalTableRowsToCloud(
  table: string,
  rows: Record<string, unknown>[],
  rowsByTable: Map<string, Record<string, unknown>[]>,
  signal?: AbortSignal,
): Promise<number> {
  const createSql = await getLocalCreateTableSql(table);
  if (!createSql) throw new Error(`本地不存在表 ${table} 的建表语句`);

  const uploadRows = async (): Promise<number> => {
    const prepared = await prepareRowsForCloudInsert(table, rows, rowsByTable);
    const dbForPk = await getDatabase();
    const pkCols = await readTablePrimaryKeyColumns(dbForPk, table);
    const deduped = dedupeRowsByPrimaryKey(prepared, pkCols);
    return insertCloudTableRows(table, deduped, signal);
  };

  const syncUsingExistingOrNewTable = async (): Promise<number> => {
    await ensureCloudTableExists(table, createSql, signal);
    await trySetCloudForeignKeys(false, signal);
    try {
      const del = await executeCloudSql(`DELETE FROM ${quoteIdent(table)}`, undefined, { signal });
      if (!del.ok && !/no such table/i.test(del.message)) {
        throw new Error(`云端清空表 ${table} 失败：${del.message}`);
      }
      return await uploadRows();
    } finally {
      await trySetCloudForeignKeys(true, signal);
    }
  };

  try {
    return await syncUsingExistingOrNewTable();
  } catch (firstError) {
    if (__DEV__) {
      console.warn(
        `[cloud] 表 ${table} 常规同步失败，将删表重建后重试`,
        firstError instanceof Error ? firstError.message : firstError,
      );
    }
    await recreateSingleCloudTableFromLocal(table, createSql, signal);
    return await uploadRows();
  }
}

function makeInboxProjectCategoryRow(
  source?: Record<string, unknown>,
): Record<string, unknown> {
  const now = new Date().toISOString();
  return {
    id: INBOX_PROJECT_CATEGORY_ID,
    name:
      typeof source?.name === 'string' && source.name.trim()
        ? source.name
        : INBOX_PROJECT_CATEGORY_NAME,
    sort_order: 0,
    created_at: typeof source?.created_at === 'string' ? source.created_at : now,
    updated_at: typeof source?.updated_at === 'string' ? source.updated_at : now,
    sync_status: typeof source?.sync_status === 'string' ? source.sync_status : 'synced',
    extra_data: source?.extra_data ?? null,
  };
}

function makeProjectCategoryStubRow(
  id: string,
  source?: Record<string, unknown>,
): Record<string, unknown> {
  const now = new Date().toISOString();
  return {
    id,
    name: typeof source?.name === 'string' && source.name.trim() ? source.name : '未命名分类',
    sort_order: typeof source?.sort_order === 'number' ? source.sort_order : 1000,
    created_at: typeof source?.created_at === 'string' ? source.created_at : now,
    updated_at: typeof source?.updated_at === 'string' ? source.updated_at : now,
    sync_status: typeof source?.sync_status === 'string' ? source.sync_status : 'synced',
    extra_data: source?.extra_data ?? null,
  };
}

async function fetchLocalTableRowById(
  table: string,
  id: string,
): Promise<Record<string, unknown> | null> {
  const db = await getDatabase();
  if (!db) return null;
  const row = await db.getFirstAsync<Record<string, unknown>>(
    `SELECT * FROM ${quoteIdent(table)} WHERE id = ? LIMIT 1`,
    [id],
  );
  return row ?? null;
}

/**
 * REST 上传前补齐 project_categories：
 * - 内置收集箱 project_category_inbox（服务端空库无种子数据时必须带客户端 id 写入）
 * - projects 引用的全部分类 id
 * - 优先从本地 SQLite 读取真实分类名，避免占位「未命名分类」覆盖服务端
 */
export async function ensureProjectCategoryRefsForApiUpload(
  rowsByTable: Map<string, Record<string, unknown>[]>,
): Promise<void> {
  const existing = rowsByTable.get('project_categories') ?? [];
  const byId = new Map(
    existing
      .filter(r => r.id != null && r.id !== '')
      .map(r => [String(r.id), r]),
  );

  const neededIds = new Set<string>();
  const projectRows = rowsByTable.get('projects') ?? [];
  for (const row of projectRows) {
    const cid = row.category_id;
    if (cid != null && cid !== '') neededIds.add(String(cid));
  }

  if (
    neededIds.has(INBOX_PROJECT_CATEGORY_ID) ||
    projectRows.some(
      row =>
        row.category_id == null ||
        row.category_id === '' ||
        String(row.category_id) === INBOX_PROJECT_CATEGORY_ID,
    )
  ) {
    neededIds.add(INBOX_PROJECT_CATEGORY_ID);
  }

  const merged = [...existing];
  for (const id of neededIds) {
    if (byId.has(id)) continue;
    if (id === INBOX_PROJECT_CATEGORY_ID) {
      const localInbox = await fetchLocalTableRowById('project_categories', id);
      const row = makeInboxProjectCategoryRow(localInbox ?? byId.get(id));
      merged.push(row);
      byId.set(id, row);
      continue;
    }
    const localRow = await fetchLocalTableRowById('project_categories', id);
    const row = localRow ?? makeProjectCategoryStubRow(id);
    merged.push(row);
    byId.set(id, row);
  }

  merged.sort((a, b) => {
    const aInbox = String(a.id) === INBOX_PROJECT_CATEGORY_ID ? 0 : 1;
    const bInbox = String(b.id) === INBOX_PROJECT_CATEGORY_ID ? 0 : 1;
    if (aInbox !== bInbox) return aInbox - bInbox;
    return Number(a.sort_order ?? 1000) - Number(b.sort_order ?? 1000);
  });

  rowsByTable.set('project_categories', merged);
}

/** 财务流水 account_id 引用 finance_accounts；补全待上传 bundle 中的账户行（含已 synced 但服务端缺失的账户） */
export async function ensureFinanceAccountRefsForApiUpload(
  rowsByTable: Map<string, Record<string, unknown>[]>,
): Promise<void> {
  const txnRows = rowsByTable.get('finance_transactions') ?? [];
  if (txnRows.length === 0) return;

  const neededIds = new Set<string>();
  for (const row of txnRows) {
    const aid = row.account_id;
    if (aid != null && aid !== '') neededIds.add(String(aid));
  }
  if (neededIds.size === 0) return;

  const existing = rowsByTable.get('finance_accounts') ?? [];
  const byId = new Map(
    existing
      .filter(r => r.id != null && r.id !== '')
      .map(r => [String(r.id), r]),
  );

  const db = await getDatabase();
  if (!db) return;

  for (const id of neededIds) {
    if (byId.has(id)) continue;
    const row = await db.getFirstAsync<Record<string, unknown>>(
      'SELECT * FROM finance_accounts WHERE id = ? LIMIT 1',
      [id],
    );
    if (row) {
      existing.push(row);
      byId.set(id, row);
    }
  }

  if (existing.length > 0) {
    rowsByTable.set('finance_accounts', existing);
  }
}

/** 备忘 dimension_id 引用 memo_dimensions；补全待上传 bundle 中的维度行 */
export async function ensureMemoDimensionRefsForApiUpload(
  rowsByTable: Map<string, Record<string, unknown>[]>,
): Promise<void> {
  const memoRows = rowsByTable.get('memos') ?? [];
  if (memoRows.length === 0) return;

  const neededIds = new Set<string>();
  for (const row of memoRows) {
    const did = row.dimension_id;
    if (did != null && did !== '') neededIds.add(String(did));
  }
  if (neededIds.size === 0) return;

  const existing = rowsByTable.get('memo_dimensions') ?? [];
  const byId = new Map(
    existing
      .filter(r => r.id != null && r.id !== '')
      .map(r => [String(r.id), r]),
  );

  const db = await getDatabase();
  if (!db) return;

  for (const id of neededIds) {
    if (byId.has(id)) continue;
    const row = await db.getFirstAsync<Record<string, unknown>>(
      'SELECT * FROM memo_dimensions WHERE id = ? LIMIT 1',
      [id],
    );
    if (row) {
      existing.push(row);
      byId.set(id, row);
    }
  }

  if (existing.length > 0) {
    rowsByTable.set('memo_dimensions', existing);
  }
}

/** habit_check_ins.habit_id 引用 habits；补全待上传 bundle 中的习惯行 */
export async function ensureHabitRefsForApiUpload(
  rowsByTable: Map<string, Record<string, unknown>[]>,
): Promise<void> {
  const checkInRows = rowsByTable.get('habit_check_ins') ?? [];
  if (checkInRows.length === 0) return;

  const neededIds = new Set<string>();
  for (const row of checkInRows) {
    const hid = row.habit_id;
    if (hid != null && hid !== '') neededIds.add(String(hid));
  }
  if (neededIds.size === 0) return;

  const existing = rowsByTable.get('habits') ?? [];
  const byId = new Map(
    existing
      .filter(r => r.id != null && r.id !== '')
      .map(r => [String(r.id), r]),
  );

  const db = await getDatabase();
  if (!db) return;

  for (const id of neededIds) {
    if (byId.has(id)) continue;
    const row = await db.getFirstAsync<Record<string, unknown>>(
      'SELECT * FROM habits WHERE id = ? LIMIT 1',
      [id],
    );
    if (row) {
      existing.push(row);
      byId.set(id, row);
    }
  }

  if (existing.length > 0) {
    rowsByTable.set('habits', existing);
  }
}

function filterHabitCheckInsForCloudUpload(
  rows: Record<string, unknown>[],
  rowsByTable: Map<string, Record<string, unknown>[]>,
): Record<string, unknown>[] {
  const habitIds = new Set(
    (rowsByTable.get('habits') ?? [])
      .filter(r => r.id != null && r.id !== '')
      .map(r => String(r.id)),
  );
  return rows.filter(row => {
    const hid = row.habit_id;
    if (hid == null || hid === '') return false;
    return habitIds.has(String(hid));
  });
}

/** 内置收集箱优先，供 REST 上传 project_categories 时使用 */
export function sortProjectCategoriesForApiUpload(
  rows: Record<string, unknown>[],
): Record<string, unknown>[] {
  return [...rows].sort((a, b) => {
    const aInbox = String(a.id) === INBOX_PROJECT_CATEGORY_ID ? 0 : 1;
    const bInbox = String(b.id) === INBOX_PROJECT_CATEGORY_ID ? 0 : 1;
    if (aInbox !== bInbox) return aInbox - bInbox;
    return Number(a.sort_order ?? 1000) - Number(b.sort_order ?? 1000);
  });
}

/** 任务 category_id 引用 task_categories；将 project_categories 镜像并入待上传的 task_categories */
function mergeProjectCategoriesIntoTaskCategoriesForCloud(
  rowsByTable: Map<string, Record<string, unknown>[]>,
): void {
  const projectCategories = rowsByTable.get('project_categories');
  if (!projectCategories?.length) return;

  const existing = rowsByTable.get('task_categories') ?? [];
  const ids = new Set(
    existing.map(r => r.id).filter(v => v != null && v !== '').map(v => String(v)),
  );
  const merged = [...existing];
  for (const row of projectCategories) {
    const id = row.id;
    if (id == null || id === '') continue;
    const sid = String(id);
    if (ids.has(sid)) continue;
    ids.add(sid);
    merged.push({ ...row });
  }
  rowsByTable.set('task_categories', merged);
}

function makeTaskCategoryMirrorRow(
  id: string,
  source?: Record<string, unknown>,
): Record<string, unknown> {
  const now = new Date().toISOString();
  return {
    id,
    name: typeof source?.name === 'string' && source.name.trim() ? source.name : '未命名分类',
    sort_order: typeof source?.sort_order === 'number' ? source.sort_order : 1000,
    created_at: typeof source?.created_at === 'string' ? source.created_at : now,
    updated_at: typeof source?.updated_at === 'string' ? source.updated_at : now,
    sync_status: typeof source?.sync_status === 'string' ? source.sync_status : 'synced',
    extra_data: source?.extra_data ?? null,
  };
}

/**
 * 上传 REST 前补齐 task_categories：
 * - 镜像全部 project_categories（tasks.category_id 外键指向 task_categories）
 * - 补全 tasks/projects 引用但镜像中缺失的分类行（含 pc_ 前缀项目分类）
 * - 优先从本地 SQLite 读取，避免占位「未命名分类」覆盖服务端
 */
export async function ensureTaskCategoryMirrorForApiUpload(
  rowsByTable: Map<string, Record<string, unknown>[]>,
): Promise<void> {
  await ensureProjectCategoryRefsForApiUpload(rowsByTable);
  mergeProjectCategoriesIntoTaskCategoriesForCloud(rowsByTable);

  const existing = rowsByTable.get('task_categories') ?? [];
  const byId = new Map(
    existing
      .filter(r => r.id != null && r.id !== '')
      .map(r => [String(r.id), r]),
  );
  const projectById = new Map(
    (rowsByTable.get('project_categories') ?? [])
      .filter(r => r.id != null && r.id !== '')
      .map(r => [String(r.id), r]),
  );

  const neededIds = new Set<string>();
  for (const table of ['tasks', 'projects'] as const) {
    for (const row of rowsByTable.get(table) ?? []) {
      const cid = row.category_id;
      if (cid != null && cid !== '') neededIds.add(String(cid));
    }
  }

  const merged = [...existing];
  for (const id of neededIds) {
    if (byId.has(id)) continue;
    const localTaskCategory = await fetchLocalTableRowById('task_categories', id);
    if (localTaskCategory) {
      merged.push(localTaskCategory);
      byId.set(id, localTaskCategory);
      continue;
    }
    const projectSource =
      projectById.get(id) ?? (await fetchLocalTableRowById('project_categories', id)) ?? undefined;
    const row = makeTaskCategoryMirrorRow(id, projectSource);
    merged.push(row);
    byId.set(id, row);
  }
  rowsByTable.set('task_categories', merged);
}

function isTooManySqlVariablesError(message: string): boolean {
  return /too many sql variables/i.test(message);
}

async function insertCloudTableRows(
  table: string,
  rows: Record<string, unknown>[],
  signal?: AbortSignal,
  opts?: { singleRowOnly?: boolean },
): Promise<number> {
  if (rows.length === 0) return 0;

  const colNames = await readLocalTableColumns(table);
  if (colNames.length === 0) return 0;

  const qCols = colNames.map(c => quoteIdent(c)).join(', ');
  const rowPlaceholder = `(${colNames.map(() => '?').join(', ')})`;
  let batchSize = opts?.singleRowOnly ? 1 : insertBatchRowCount(colNames.length);
  let inserted = 0;

  for (let i = 0; i < rows.length; ) {
    throwIfAborted(signal);
    const batch = rows.slice(i, i + batchSize);
    const params: (string | number | null)[] = [];
    for (const row of batch) {
      for (const col of colNames) {
        params.push(sqliteBindingFromJson(row[col]));
      }
    }

    const sql =
      batch.length === 1
        ? `INSERT OR REPLACE INTO ${quoteIdent(table)} (${qCols}) VALUES ${rowPlaceholder}`
        : `INSERT OR REPLACE INTO ${quoteIdent(table)} (${qCols}) VALUES ${batch.map(() => rowPlaceholder).join(', ')}`;

    const ins = await executeCloudSql(sql, params, { signal });
    if (!ins.ok) {
      if (batchSize > 1 && isTooManySqlVariablesError(ins.message)) {
        batchSize = Math.max(1, Math.floor(batchSize / 2));
        continue;
      }
      throw new Error(`写入云端表 ${table} 失败：${ins.message}`);
    }

    inserted += batch.length;
    i += batch.length;
  }

  return inserted;
}

async function readLocalTableRows(table: string): Promise<Record<string, unknown>[]> {
  const db = await getDatabase();
  const safe = quoteIdent(table);
  const rows = await db.getAllAsync(`SELECT * FROM ${safe}`);
  return (rows as Record<string, unknown>[]) ?? [];
}

async function readLocalTableColumns(table: string): Promise<string[]> {
  const db = await getDatabase();
  const safe = quoteIdent(table);
  const cols = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${safe})`);
  return cols.map(c => c.name).filter(Boolean);
}

export type LocalTableUploadBundle = {
  insertOrder: string[];
  rowsByTable: Map<string, Record<string, unknown>[]>;
};

/** 按外键依赖收集本地表数据，供 D1 备份与 REST 上传复用 */
export async function collectLocalTablesDataForUpload(
  seedTables: string[],
  opts?: {
    signal?: AbortSignal;
    onProgress?: (p: CloudSyncProgress) => void;
  },
): Promise<LocalTableUploadBundle> {
  if (seedTables.length === 0) {
    return { insertOrder: [], rowsByTable: new Map() };
  }

  const report = (p: CloudSyncProgress) => opts?.onProgress?.(p);

  report({ phase: 'collecting', tableLabel: '分析表依赖' });
  await yieldToUi();
  const graph = await buildLocalForeignKeyGraph();
  const tables = expandTablesForCloudUpload(seedTables, graph);
  if (tables.length === 0) {
    return { insertOrder: [], rowsByTable: new Map() };
  }

  const insertOrder = sortTablesForCloudInsert(tables, graph);
  const total = insertOrder.length;

  await dedupeLocalTablesByPrimaryKeyIfNeeded(insertOrder, { markDirty: false });

  const rowsByTable = new Map<string, Record<string, unknown>[]>();
  for (let i = 0; i < insertOrder.length; i++) {
    const table = insertOrder[i]!;
    throwIfAborted(opts?.signal);
    report({
      phase: 'collecting',
      tableIndex: i + 1,
      tableCount: total,
      tableLabel: table,
    });
    await yieldToUi();
    rowsByTable.set(table, await readLocalTableRows(table));
  }
  await ensureProjectCategoryRefsForApiUpload(rowsByTable);
  await ensureTaskCategoryMirrorForApiUpload(rowsByTable);
  await ensureHabitRefsForApiUpload(rowsByTable);

  return { insertOrder, rowsByTable };
}

export async function prepareLocalRowsForUpload(
  table: string,
  rows: Record<string, unknown>[],
  rowsByTable: Map<string, Record<string, unknown>[]>,
): Promise<Record<string, unknown>[]> {
  return prepareRowsForCloudInsert(table, rows, rowsByTable);
}

async function listLocalUserTablesForUpload(): Promise<string[]> {
  return listLocalUserTables();
}

export { listLocalUserTablesForUpload as listLocalUserTablesForApiUpload };

async function pushLocalTablesToCloudBatch(
  seedTables: string[],
  opts?: {
    signal?: AbortSignal;
    onProgress?: (p: CloudSyncProgress) => void;
  },
): Promise<number> {
  const { insertOrder, rowsByTable } = await collectLocalTablesDataForUpload(seedTables, opts);
  if (insertOrder.length === 0) return 0;

  const report = (p: CloudSyncProgress) => opts?.onProgress?.(p);
  const total = insertOrder.length;

  let rowCount = 0;
  for (let i = 0; i < insertOrder.length; i++) {
    const table = insertOrder[i]!;
    throwIfAborted(opts?.signal);
    report({
      phase: 'uploading',
      tableIndex: i + 1,
      tableCount: total,
      tableLabel: table,
    });
    await yieldToUi();
    const rawRows = rowsByTable.get(table) ?? [];
    rowCount += await pushLocalTableRowsToCloud(table, rawRows, rowsByTable, opts?.signal);
  }

  return rowCount;
}

/** 将单张本地表及其外键关联表一并推送到云端 */
export async function pushLocalTableToCloud(table: string, opts?: { signal?: AbortSignal }): Promise<number> {
  if (!isSafeSqliteTableName(table)) throw new Error(`非法表名：${table}`);
  return pushLocalTablesToCloudBatch([table], opts);
}

/** 一键全量备份：本地所有 SQLite 表 → 云端 */
export async function triggerCloudFullBackup(opts?: {
  signal?: AbortSignal;
  onProgress?: (p: CloudSyncProgress) => void;
}): Promise<CloudSyncResult> {
  const report = (p: CloudSyncProgress) => opts?.onProgress?.(p);
  const token = await getCloudAuthToken();
  if (!token) {
    return {
      ok: false,
      reason: 'no_config',
      message: CLOUD_BACKUP_NOT_CONFIGURED_MSG,
      diagnosticText: CLOUD_BACKUP_NOT_CONFIGURED_MSG,
    };
  }

  const dbProbe = await getDatabase();
  if (!dbProbe) {
    const message = '当前环境无本地 SQLite（例如 Web），无法执行全量备份。';
    return { ok: false, reason: 'unsupported_platform', message, diagnosticText: message };
  }

  report({ phase: 'preparing' });
  let tables: string[];
  try {
    report({ phase: 'collecting' });
    tables = await listLocalUserTables();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const message = `读取本地表列表失败：${msg}`;
    return {
      ok: false,
      reason: 'collect_failed',
      message,
      diagnosticText: [message, '', serializeErrorForDiagnostic(e)].join('\n'),
    };
  }

  const lastUpdated = new Date().toISOString();
  let rowCount = 0;

  try {
    rowCount = await pushLocalTablesToCloudBatch(tables, {
      signal: opts?.signal,
      onProgress: report,
    });
  } catch (e) {
    if (isAbortError(e) || opts?.signal?.aborted) {
      const message = '全量备份已中止';
      return { ok: false, reason: 'aborted', message, diagnosticText: message };
    }
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      reason: 'upload_failed',
      message: msg,
      diagnosticText: [msg, '', serializeErrorForDiagnostic(e)].join('\n'),
    };
  }

  await setLastFullCloudBackupAtIso(lastUpdated);
  await setLastCloudAlignAtIso(lastUpdated);
  clearAllCloudSqliteDirtyTables();
  return { ok: true, tableCount: tables.length, rowCount, lastUpdated };
}

async function applyCloudRowsToLocalTableWithoutDelete(
  table: string,
  rows: unknown[],
  signal?: AbortSignal,
): Promise<number> {
  const db = await getDatabase();
  const safe = quoteIdent(table);
  const cols = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${safe})`);
  const colNames = cols.map(c => c.name).filter(Boolean);
  if (colNames.length === 0) throw new Error(`本机不存在表 ${table}`);

  const pkCols = await readTablePrimaryKeyColumns(db, table);
  const normalized: Record<string, unknown>[] = [];
  for (const row of rows) {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) continue;
    normalized.push(row as Record<string, unknown>);
  }
  const deduped = dedupeRowsByPrimaryKey(normalized, pkCols);

  let count = 0;
  for (const obj of deduped) {
    throwIfAborted(signal);
    const keys = colNames.filter(c => Object.prototype.hasOwnProperty.call(obj, c));
    if (keys.length === 0) continue;
    const qCols = keys.map(c => quoteIdent(c)).join(', ');
    const placeholders = keys.map(() => '?').join(', ');
    const vals = keys.map(k => sqliteBindingFromJson(obj[k]));
    await db.runAsync(`INSERT OR REPLACE INTO ${safe} (${qCols}) VALUES (${placeholders})`, vals);
    count += 1;
  }
  return count;
}

/** 从云同步：云端所有表 → 覆盖本地 */
export async function triggerCloudFullRestore(opts?: {
  signal?: AbortSignal;
  onProgress?: (p: CloudSyncProgress) => void;
}): Promise<CloudRestoreResult> {
  const report = (p: CloudSyncProgress) => opts?.onProgress?.(p);
  const token = await getCloudAuthToken();
  if (!token) {
    const message = CLOUD_BACKUP_NOT_CONFIGURED_MSG;
    return { ok: false, reason: 'no_config', message, diagnosticText: message };
  }

  const db = await getDatabase();
  if (!db) {
    const message = '当前运行环境无本地 SQLite（例如 Web），无法执行全量同步。';
    return { ok: false, reason: 'unsupported_platform', message, diagnosticText: message };
  }

  setSilentCloudRestoreInFlight(true);
  beginCloudSqliteDirtyIgnoreBatch();
  try {
    report({ phase: 'preparing' });
    let cloudTables: string[];
    try {
      throwIfAborted(opts?.signal);
      cloudTables = await listCloudUserTables(opts?.signal);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        ok: false,
        reason: 'fetch_failed',
        message: `拉取云端表列表失败：${msg}`,
        diagnosticText: [msg, '', serializeErrorForDiagnostic(e)].join('\n'),
      };
    }

    const localTables = await listLocalUserTables();
    const localSet = new Set(localTables);
    const tablesNotInBackup = localTables.filter(t => !cloudTables.includes(t));
    const warnings: string[] = [];
    if (tablesNotInBackup.length > 0) {
      const preview = tablesNotInBackup.slice(0, 12).join('、');
      const more = tablesNotInBackup.length > 12 ? ` 等共 ${tablesNotInBackup.length} 张` : '';
      warnings.push(`以下本机表未出现在云端，未覆盖：${preview}${more}`);
    }

    const snapshots: { table: string; rows: unknown[] }[] = [];

    try {
      for (let i = 0; i < cloudTables.length; i++) {
        throwIfAborted(opts?.signal);
        const table = cloudTables[i]!;
        report({
          phase: 'downloading',
          tableIndex: i + 1,
          tableCount: cloudTables.length,
          tableLabel: table,
        });
        await yieldToUi();
        const r = await executeCloudSql(`SELECT * FROM ${quoteIdent(table)}`, undefined, {
          signal: opts?.signal,
        });
        if (!r.ok) throw new Error(`拉取云端表 ${table} 失败：${r.message}`);
        snapshots.push({ table, rows: r.data });
      }
    } catch (e) {
      if (isAbortError(e) || opts?.signal?.aborted) {
        return {
          ok: false,
          reason: 'aborted',
          message: '从云同步已中止',
          diagnosticText: serializeErrorForDiagnostic(e),
        };
      }
      const msg = e instanceof Error ? e.message : String(e);
      return {
        ok: false,
        reason: 'fetch_failed',
        message: msg,
        diagnosticText: [msg, '', serializeErrorForDiagnostic(e)].join('\n'),
      };
    }

    let sqliteRows = 0;
    let sqliteTables = 0;

    const graph = await buildLocalForeignKeyGraph();
    const snapshotTables = snapshots.map(s => s.table);
    const schemaTables = expandTablesForCloudApply(snapshotTables, graph);
    const applyOrder = sortTablesForCloudInsert(schemaTables, graph);
    const snapshotByTable = new Map(snapshots.map(s => [s.table, s]));

    const applyTotal = applyOrder.filter(t => snapshotByTable.has(t)).length;
    let applyIndex = 0;

    report({ phase: 'applying', tableCount: applyTotal, tableIndex: 0, tableLabel: '准备事务' });
    await yieldToUi();
    try {
      throwIfAborted(opts?.signal);
      await db.execAsync('PRAGMA foreign_keys = OFF');
      await db.execAsync('BEGIN IMMEDIATE');
      try {
        for (const table of applyOrder) {
          throwIfAborted(opts?.signal);
          if (!localSet.has(table)) {
            const createSql =
              (await getLocalCreateTableSql(table)) ?? (await getCloudCreateTableSql(table, opts?.signal));
            if (!createSql) {
              if (snapshotByTable.has(table)) {
                warnings.push(`云端表 ${table} 在本机无法建表，已跳过`);
              }
              continue;
            }
            await db.execAsync(createSql);
            localSet.add(table);
          }
        }

        const tablesToClear = new Set(snapshotTables);
        const clearOrder = sortTablesForCloudDelete(
          sortTablesForCloudInsert([...tablesToClear], graph),
        );
        for (const table of clearOrder) {
          throwIfAborted(opts?.signal);
          if (!tablesToClear.has(table)) continue;
          await db.runAsync(`DELETE FROM ${quoteIdent(table)}`);
        }

        for (const table of applyOrder) {
          throwIfAborted(opts?.signal);
          const snap = snapshotByTable.get(table);
          if (!snap) continue;
          applyIndex += 1;
          report({
            phase: 'applying',
            tableIndex: applyIndex,
            tableCount: applyTotal,
            tableLabel: table,
          });
          await yieldToUi();
          sqliteRows += await applyCloudRowsToLocalTableWithoutDelete(snap.table, snap.rows, opts?.signal);
          sqliteTables += 1;
        }
        const fkViolations = await db.getAllAsync<{ table: string; rowid: number }>(
          'PRAGMA foreign_key_check',
        );
        if (fkViolations.length > 0) {
          throw new Error(`外键检查失败（${fkViolations.length} 条）`);
        }
        await db.execAsync('COMMIT');
      } catch (inner) {
        try {
          await db.execAsync('ROLLBACK');
        } catch {
          /* ignore */
        }
        throw inner;
      }
    } catch (e) {
      if (isAbortError(e) || opts?.signal?.aborted) {
        return {
          ok: false,
          reason: 'aborted',
          message: '写入本地数据库时已中止',
          diagnosticText: serializeErrorForDiagnostic(e),
        };
      }
      const msg = e instanceof Error ? e.message : String(e);
      return {
        ok: false,
        reason: 'apply_failed',
        message: `写入 SQLite 失败：${msg}`,
        diagnosticText: [msg, '', serializeErrorForDiagnostic(e)].join('\n'),
      };
    } finally {
      try {
        await db.execAsync('PRAGMA foreign_keys = ON');
      } catch {
        /* ignore */
      }
    }

    try {
      await initDatabase();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        ok: false,
        reason: 'apply_failed',
        message: `同步后数据库迁移失败：${msg}`,
        diagnosticText: [msg, '', serializeErrorForDiagnostic(e)].join('\n'),
      };
    }

    const cloudLastUpdated = new Date().toISOString();
    await setLastFullCloudBackupAtIso(cloudLastUpdated);
    await setLastCloudAlignAtIso(cloudLastUpdated);
    clearAllCloudSqliteDirtyTables();

    const { resetPageApiSession } = await import('@/lib/page-api-session');
    resetPageApiSession();

    return {
      ok: true,
      cloudLastUpdated,
      sqliteTables,
      sqliteRows,
      warnings,
      tablesNotInBackup,
    };
  } finally {
    endCloudSqliteDirtyIgnoreBatch();
    setSilentCloudRestoreInFlight(false);
  }
}

/** 脏表增量：将本地变更表推送到云端 */
export async function pushCloudDirtyTablesIfNeeded(): Promise<void> {
  if (isSilentCloudRestoreInFlight()) {
    scheduleCloudTablePushDebounced();
    return;
  }

  const dirtyList = peekCloudSqliteDirtyTables();
  if (dirtyList.length === 0) return;

  const token = await getCloudAuthToken();
  if (!token) return;

  const db = await getDatabase();
  if (!db) return;

  try {
    await pushLocalTablesToCloudBatch(dirtyList);
    clearCloudSqliteDirtyTables(dirtyList);
    await setLastCloudAlignAtIso(new Date().toISOString());
  } catch (e) {
    if (__DEV__) console.warn('[cloud incremental] 批量推送失败', e);
    scheduleCloudTablePushDebounced();
  }
}

/** 每 4 小时对齐：将全部本地表推送到云端 */
export async function alignAllLocalTablesToCloud(opts?: { signal?: AbortSignal }): Promise<void> {
  const token = await getCloudAuthToken();
  if (!token) return;

  const db = await getDatabase();
  if (!db) return;

  if (isSilentCloudRestoreInFlight()) return;

  try {
    const tables = await listLocalUserTables();
    await pushLocalTablesToCloudBatch(tables, { signal: opts?.signal });
    const iso = new Date().toISOString();
    await setLastCloudAlignAtIso(iso);
    clearAllCloudSqliteDirtyTables();
  } catch (e) {
    if (__DEV__) console.warn('[cloud align]', e);
  }
}
