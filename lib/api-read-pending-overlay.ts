import { getApiTablePrimaryKey } from '@/lib/api-allowed-tables';
import { getDatabase } from '@/lib/database';

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

async function tableHasSyncStatusColumn(table: string): Promise<boolean> {
  const db = await getDatabase();
  if (!db) return false;
  const cols = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${quoteIdent(table)})`);
  return cols.some(c => c.name === 'sync_status');
}

/** 本地尚未同步到 REST 的行（含 pending_create / pending_update / pending_delete） */
async function readLocalPendingRows(table: string): Promise<Record<string, unknown>[]> {
  const db = await getDatabase();
  if (!db) return [];
  if (!(await tableHasSyncStatusColumn(table))) return [];
  const rows = await db.getAllAsync(
    `SELECT * FROM ${quoteIdent(table)} WHERE sync_status != 'synced'`,
  );
  return (rows as Record<string, unknown>[]) ?? [];
}

async function readLocalPendingRowByPk(
  table: string,
  pkValue: string,
): Promise<Record<string, unknown> | null> {
  const db = await getDatabase();
  if (!db || !pkValue.trim()) return null;
  if (!(await tableHasSyncStatusColumn(table))) return null;
  const pkCol = getApiTablePrimaryKey(table);
  const row = await db.getFirstAsync<Record<string, unknown>>(
    `SELECT * FROM ${quoteIdent(table)} WHERE ${quoteIdent(pkCol)} = ? AND sync_status != 'synced' LIMIT 1`,
    [pkValue],
  );
  return row ?? null;
}

/**
 * API_ONLY_READS 下：用本地待同步行覆盖 REST 结果，使写入后 UI 立即可见。
 * pending_delete 会从列表中移除；pending_create/update 覆盖同主键的 API 行。
 */
export async function overlayLocalPendingOnApiTableRows<T extends Record<string, unknown>>(
  table: string,
  apiRows: T[],
): Promise<T[]> {
  const pending = await readLocalPendingRows(table);
  if (pending.length === 0) return apiRows;

  const pkCol = getApiTablePrimaryKey(table);
  const byPk = new Map<string, T>();
  for (const row of apiRows) {
    const pk = String(row[pkCol] ?? '').trim();
    if (pk) byPk.set(pk, row);
  }

  for (const local of pending) {
    const pk = String(local[pkCol] ?? '').trim();
    if (!pk) continue;
    if (local.sync_status === 'pending_delete') {
      byPk.delete(pk);
    } else {
      byPk.set(pk, local as T);
    }
  }

  return [...byPk.values()];
}

/** 单条记录：若本地有待同步版本则优先返回；pending_delete 视为不存在 */
export async function overlayLocalPendingOnApiRecord<T extends Record<string, unknown>>(
  table: string,
  pkValue: string,
  apiRow: T | null,
): Promise<T | null> {
  const local = await readLocalPendingRowByPk(table, pkValue);
  if (!local) return apiRow;
  if (local.sync_status === 'pending_delete') return null;
  return local as T;
}
