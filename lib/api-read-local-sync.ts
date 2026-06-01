import { getApiTablePrimaryKey, isApiReadableTable } from '@/lib/api-allowed-tables';
import { rowPrimaryKeyValue } from '@/lib/api-row-upsert';
import {
  beginCloudSqliteDirtyIgnoreBatch,
  endCloudSqliteDirtyIgnoreBatch,
} from '@/lib/cloud-sql-dirty-track';
import { getDatabase } from '@/lib/database';
import { dedupeRowsByPrimaryKey, readTablePrimaryKeyColumns } from '@/lib/sqlite-primary-key-dedupe';

export type ApplyApiReadToLocalOptions = {
  /**
   * 全表列表读：将本地 `sync_status = 'synced'` 且不在本次 API 结果中的行与服务器对齐（物理删除）。
   */
  reconcileSnapshot?: boolean;
};

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
): Record<string, unknown> {
  const out = { ...row };
  delete out.deleted_at;
  delete out.version;
  if (colNames.includes('sync_status')) {
    out.sync_status = 'synced';
  }
  return out;
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
    rows.map(r => normalizeApiRowForLocal(r, colNames)),
    pkCols,
  );

  for (const obj of normalized) {
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

  const localRows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT ${pkQ} AS __pk, sync_status FROM ${safe} WHERE sync_status = 'synced'`,
  );

  for (const row of localRows) {
    const pk = row.__pk == null || row.__pk === '' ? '' : String(row.__pk);
    if (!pk || apiPkSet.has(pk)) continue;
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
    normalizedInput.push(row);
  }

  beginCloudSqliteDirtyIgnoreBatch();
  try {
    await upsertRowsToLocalTable(table, normalizedInput, colNames, pkCols);

    if (opts?.reconcileSnapshot) {
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
    if (__DEV__) {
      console.warn('[api-read-local-sync] 写入本地失败', table, e);
    }
  }
}
