import { getApiTablePrimaryKey } from '@/lib/api-allowed-tables';
import { getDatabase } from '@/lib/database';

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

const LOCAL_WRITE_ENTITY_LABELS: Record<string, string> = {
  tasks: '任务',
  projects: '项目',
  task_categories: '任务分类',
  project_categories: '项目分类',
};

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
 * API_ONLY_READS 下 UI 数据来自 REST，本地 SQLite 可能尚无该行；
 * 此时从 REST 拉取、修正外键并写入本地，供后续 UPDATE/INSERT/DELETE 使用。
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

  const { seedApiRowToLocalForWrite } = await import('@/lib/api-local-row-seed');
  const seeded = await seedApiRowToLocalForWrite(table, fromApi as Record<string, unknown>);
  if (!seeded) return null;

  return readLocalRowForWrite<T>(table, pkValue);
}

/** 写入前确认本地 SQLite 中已有该行（外键 INSERT 依赖此条件）。 */
export async function ensureLocalRowPresent(table: string, pkValue: string): Promise<boolean> {
  if (!pkValue.trim()) return false;
  if (await readLocalRowForWrite(table, pkValue)) return true;
  await ensureLocalRowForWrite(table, pkValue);
  return (await readLocalRowForWrite(table, pkValue)) != null;
}

/** 写入前必须存在本地行，否则抛出可读错误。 */
export async function requireLocalRowForWrite<T extends Record<string, unknown>>(
  table: string,
  pkValue: string,
  entityLabel?: string,
): Promise<T> {
  const label = entityLabel ?? LOCAL_WRITE_ENTITY_LABELS[table] ?? '记录';
  const row = await ensureLocalRowForWrite<T>(table, pkValue);
  if (row) return row;
  throw new Error(`${label}尚未同步到本地，请返回列表刷新后重试`);
}
