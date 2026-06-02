import { getApiTablePrimaryKey } from '@/lib/api-allowed-tables';
import { getDatabase } from '@/lib/database';

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * 写入/更新前读取本地行（含 pending_*），避免 merge 时用 REST 旧数据覆盖本地修改。
 */
export async function readLocalRowForWrite<T extends Record<string, unknown>>(
  table: string,
  pkValue: string,
): Promise<T | null> {
  const db = await getDatabase();
  if (!db || !pkValue.trim()) return null;
  const pkCol = getApiTablePrimaryKey(table);
  const row = await db.getFirstAsync<T>(
    `SELECT * FROM ${quoteIdent(table)} WHERE ${quoteIdent(pkCol)} = ? LIMIT 1`,
    [pkValue],
  );
  if (!row) return null;
  const syncStatus = (row as Record<string, unknown>).sync_status;
  if (syncStatus === 'pending_delete') return null;
  return row;
}

/**
 * 写入/更新/删除前确保本地有对应行。
 * 正式包首次安装时本地库为空，REST 只读不回填会导致 update 直接 return。
 * 本地无行时从 REST 拉取并写入 SQLite（synced），不覆盖 pending_* 行。
 */
export async function ensureLocalRowForWrite<T extends Record<string, unknown>>(
  table: string,
  pkValue: string,
): Promise<T | null> {
  const local = await readLocalRowForWrite<T>(table, pkValue);
  if (local) return local;

  const { fetchApiRecordByPk } = await import('@/lib/api-read');
  const fromApi = await fetchApiRecordByPk<T>(table, pkValue);
  if (!fromApi) return null;

  return readLocalRowForWrite<T>(table, pkValue);
}
