import { getApiTablePrimaryKey, isApiReadableTable } from '@/lib/api-allowed-tables';
import {
    isLocalParentRowStillReferenced,
    preserveLocalForeignKeysOnEmptyApi,
    readReferencedParentIdsForReconcile,
} from '@/lib/api-fk-preserve';
import { sanitizeRowForLocalSeed } from '@/lib/api-local-row-seed';
import { parseStoredDatetime } from '@/lib/api-mysql-datetime';
import { rowPrimaryKeyValue } from '@/lib/api-row-upsert';
import {
    beginCloudSqliteDirtyIgnoreBatch,
    endCloudSqliteDirtyIgnoreBatch,
} from '@/lib/cloud-sql-dirty-track';
import { getDatabase } from '@/lib/database';
import { mergeFinanceTxnExtraOnApiSync } from '@/lib/repositories/finance/finance-transaction-extra';
import { dedupeRowsByPrimaryKey, readTablePrimaryKeyColumns } from '@/lib/sqlite-primary-key-dedupe';

/** LWW：按解析后的时刻比较，避免 ISO 与 MySQL DATETIME 字符串直接比大小误判 */
function isApiUpdatedAtNewer(apiUpdated: string, localUpdated: string): boolean {
  if (!apiUpdated) return false;
  if (!localUpdated) return true;
  const apiMs = parseStoredDatetime(apiUpdated).getTime();
  const localMs = parseStoredDatetime(localUpdated).getTime();
  if (Number.isFinite(apiMs) && Number.isFinite(localMs)) {
    return apiMs > localMs;
  }
  return apiUpdated > localUpdated;
}

export type ApplyApiReadToLocalOptions = {
  /**
   * 全表列表读：将本地 `sync_status = 'synced'` 且不在本次 API 结果中的行与服务器对齐（物理删除）。
   */
  reconcileSnapshot?: boolean;
  /** 写入失败时向上抛出，供 catalog 等路径检测并触发重试 */
  throwOnError?: boolean;
};

/**
 * 财务账户/流水不做「快照差量物理删除」：后端若尚未收到初始余额等流水，
 * reconcile 会把本地已 synced 的流水删掉，导致账本余额归零。
 */
const API_RECONCILE_SKIP_TABLES = new Set([
  'finance_accounts',
  'finance_transactions',
  /** 打卡增量上传后 REST 列表可能尚未包含新行，reconcile 会误删本地已 synced 记录 */
  'habit_check_ins',
  /** 完成事件增量写入后 REST 列表/聚合可能滞后，避免 reconcile 误删本地记录 */
  'task_execution_events',
  'frog_completion_events',
]);

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
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

function normalizeApiRowForLocal(
  row: Record<string, unknown>,
  colNames: string[],
  table?: string,
): Record<string, unknown> {
  const out = { ...row };
  delete out.deleted_at;
  delete out.version;
  if (table === 'memo_dimensions' && colNames.includes('name')) {
    let name = String(out.name ?? '').trim();
    if (!name && typeof out.title === 'string') {
      name = out.title.trim();
    }
    if (!name) {
      name = '未命名维度';
    }
    out.name = name;
  }
  if (colNames.includes('sync_status')) {
    out.sync_status = 'synced';
  }
  if (table === 'finance_accounts') {
    out.sign_rule = normalizeFinanceSignRuleForApiRow(out.sign_rule, out.account_type);
    if (out.account_type == null || out.account_type === '') {
      out.account_type = out.sign_rule < 0 ? 'liability' : 'asset';
    }
  }
  return out;
}

function normalizeFinanceSignRuleForApiRow(signRule: unknown, accountType: unknown): -1 | 1 {
  const n = typeof signRule === 'number' ? signRule : Number(signRule);
  if (n < 0) return -1;
  if (n > 0) return 1;
  return accountType === 'liability' ? -1 : 1;
}

async function readLocalColumnNames(table: string): Promise<string[]> {
  const db = await getDatabase();
  if (!db) return [];
  const cols = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${quoteIdent(table)})`);
  return cols.map(c => c.name).filter(Boolean);
}

async function upsertRowsToLocalTable(
  table: string,
  rows: Record<string, unknown>[],
  colNames: string[],
  pkCols: string[],
): Promise<void> {
  const db = await getDatabase();
  if (!db || rows.length === 0) return;

  const safe = quoteIdent(table);
  const normalized = dedupeRowsByPrimaryKey(
    rows.map(r => normalizeApiRowForLocal(r, colNames, table)),
    pkCols,
  );

  const pkCol = pkCols[0];
  const hasSyncStatus = colNames.includes('sync_status');

  for (const obj of normalized) {
    if (hasSyncStatus && pkCol) {
      const pk = rowPrimaryKeyValue(obj, pkCols);
      if (pk) {
        const existing = await db.getFirstAsync<Record<string, unknown>>(
          `SELECT * FROM ${safe} WHERE ${quoteIdent(pkCol)} = ? LIMIT 1`,
          [pk],
        );
        if (existing && existing.sync_status !== 'synced') {
          // 本地未推送完成时默认保留 pending，避免覆盖尚未上传的本地编辑。
          // 若服务端 updated_at 更新（另一端已写入），按 LWW 采用服务端行，避免多端状态永久卡住。
          if (existing.sync_status === 'pending_delete') {
            continue;
          }
          const localUpdated = String(existing.updated_at ?? '').trim();
          const apiUpdated = String(obj.updated_at ?? '').trim();
          if (!isApiUpdatedAtNewer(apiUpdated, localUpdated)) {
            continue;
          }
        }
        if (existing) {
          if (table === 'memo_dimensions' && colNames.includes('name')) {
            const apiName = typeof obj.name === 'string' ? obj.name.trim() : '';
            const localName = typeof existing.name === 'string' ? existing.name.trim() : '';
            if (localName && (!apiName || apiName === '未命名维度')) {
              obj.name = localName;
            }
          }
          if (table === 'finance_transactions' && colNames.includes('extra_data')) {
            obj.extra_data = mergeFinanceTxnExtraOnApiSync(
              typeof obj.extra_data === 'string' ? obj.extra_data : null,
              typeof existing.extra_data === 'string' ? existing.extra_data : null,
            );
          }
          preserveLocalForeignKeysOnEmptyApi(table, obj, existing, colNames);
          if (table === 'tasks') {
            const apiStatus = obj.status;
            const apiCompletedAt = obj.completed_at;
            const isTerminal = apiStatus === 'done' || apiStatus === 'cancelled';
            const apiCompletedEmpty =
              apiCompletedAt == null || (typeof apiCompletedAt === 'string' && !apiCompletedAt.trim());
            if (isTerminal && apiCompletedEmpty) {
              const localCompletedAt = existing.completed_at;
              if (localCompletedAt != null && String(localCompletedAt).trim() !== '') {
                obj.completed_at = localCompletedAt;
              }
            }
          }
          for (const col of colNames) {
            if (Object.prototype.hasOwnProperty.call(obj, col)) continue;
            const prev = existing[col];
            if (prev != null && prev !== '') {
              obj[col] = prev;
            }
          }
        }
      }
    }

    const keys = colNames.filter(c => Object.prototype.hasOwnProperty.call(obj, c));
    if (keys.length === 0) continue;

    const qCols = keys.map(c => quoteIdent(c)).join(', ');
    const placeholders = keys.map(() => '?').join(', ');
    const vals = keys.map(k => sqliteBindingFromJson(obj[k]));
    await db.runAsync(`INSERT OR REPLACE INTO ${safe} (${qCols}) VALUES (${placeholders})`, vals);
  }
}

async function reconcileSyncedRowsNotInSnapshot(
  table: string,
  pkCol: string,
  apiPkSet: Set<string>,
): Promise<void> {
  const db = await getDatabase();
  if (!db) return;

  const safe = quoteIdent(table);
  const pkQ = quoteIdent(pkCol);
  const referencedCategoryIds = await readReferencedParentIdsForReconcile(db, table);

  const localRows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT ${pkQ} AS __pk, sync_status FROM ${safe} WHERE sync_status = 'synced'`,
  );

  for (const row of localRows) {
    const pk = row.__pk == null || row.__pk === '' ? '' : String(row.__pk);
    if (!pk || apiPkSet.has(pk)) continue;
    if (referencedCategoryIds?.has(pk)) continue;
    await db.runAsync(`DELETE FROM ${safe} WHERE ${pkQ} = ?`, [pk]);
  }
}

/**
 * 将 REST 读到的行写入本地 SQLite（不触发脏表 / 增量上传）。
 */
export async function applyApiRowsToLocalTable(
  table: string,
  rows: Record<string, unknown>[],
  opts?: ApplyApiReadToLocalOptions,
): Promise<void> {
  if (!isApiReadableTable(table)) return;

  const db = await getDatabase();
  if (!db) return;

  const colNames = await readLocalColumnNames(table);
  if (colNames.length === 0) return;

  const pkCols = await readTablePrimaryKeyColumns(db, table);
  const pkCol = getApiTablePrimaryKey(table);

  const normalizedInput: Record<string, unknown>[] = [];
  for (const row of rows) {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) continue;
    normalizedInput.push(await sanitizeRowForLocalSeed(table, row));
  }

  beginCloudSqliteDirtyIgnoreBatch();
  try {
    await upsertRowsToLocalTable(table, normalizedInput, colNames, pkCols);

    if (opts?.reconcileSnapshot && !API_RECONCILE_SKIP_TABLES.has(table)) {
      const apiPkSet = new Set<string>();
      for (const row of dedupeRowsByPrimaryKey(normalizedInput, pkCols)) {
        const pk = rowPrimaryKeyValue(row, pkCols);
        if (pk) apiPkSet.add(pk);
      }
      await reconcileSyncedRowsNotInSnapshot(table, pkCol, apiPkSet);
    }
  } finally {
    endCloudSqliteDirtyIgnoreBatch();
  }
}

/** GET 单条 404：本地已 synced 的行与服务器对齐（物理删除） */
export async function applyApiRecordMissingToLocal(table: string, pkValue: string): Promise<void> {
  if (!isApiReadableTable(table) || !pkValue.trim()) return;
  // 本地单例默认用户：服务端尚未建档案时 GET 404，不应清空本地资料
  if (table === 'users' && pkValue === 'default') return;

  const db = await getDatabase();
  if (!db) return;

  const colNames = await readLocalColumnNames(table);
  if (colNames.length === 0) return;

  const pkCol = getApiTablePrimaryKey(table);
  const local = await db.getFirstAsync<Record<string, unknown>>(
    `SELECT * FROM ${quoteIdent(table)} WHERE ${quoteIdent(pkCol)} = ? LIMIT 1`,
    [pkValue],
  );
  if (!local) return;
  if (colNames.includes('sync_status') && local.sync_status !== 'synced') return;
  if (await isLocalParentRowStillReferenced(db, table, pkValue)) return;

  beginCloudSqliteDirtyIgnoreBatch();
  try {
    await db.runAsync(`DELETE FROM ${quoteIdent(table)} WHERE ${quoteIdent(pkCol)} = ?`, [pkValue]);
  } finally {
    endCloudSqliteDirtyIgnoreBatch();
  }
}

export async function syncApiReadResultToLocal(
  table: string,
  rows: Record<string, unknown>[] | Record<string, unknown> | null,
  opts?: ApplyApiReadToLocalOptions,
): Promise<void> {
  try {
    if (rows === null) {
      return;
    }
    if (Array.isArray(rows)) {
      await applyApiRowsToLocalTable(table, rows, opts);
      return;
    }
    await applyApiRowsToLocalTable(table, [rows], opts);
  } catch (e) {
    console.warn('[api-read-local-sync] 写入本地失败', table, e);
    if (opts?.throwOnError) throw e;
  }
}
