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
