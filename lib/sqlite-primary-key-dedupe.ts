import type * as SQLite from 'expo-sqlite';
import { getDatabase } from '@/lib/database';
import { markCloudSqliteTableDirty } from '@/lib/cloud-sql-dirty-track';

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function isAppUserTableName(name: string): boolean {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return false;
  const lower = name.toLowerCase();
  if (lower.startsWith('sqlite_')) return false;
  if (lower.startsWith('_cf_')) return false;
  return true;
}

export async function readTableColumnNames(
  db: SQLite.SQLiteDatabase,
  table: string,
): Promise<string[]> {
  const safe = quoteIdent(table);
  const cols = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${safe})`);
  return cols.map(c => c.name).filter(Boolean);
}

export async function readTablePrimaryKeyColumns(
  db: SQLite.SQLiteDatabase,
  table: string,
): Promise<string[]> {
  const safe = quoteIdent(table);
  const cols = await db.getAllAsync<{ name: string; pk: number }>(`PRAGMA table_info(${safe})`);
  const pks = cols
    .filter(c => c.pk > 0)
    .sort((a, b) => a.pk - b.pk)
    .map(c => c.name)
    .filter(Boolean);
  return pks.length > 0 ? pks : ['id'];
}

function pickRowTieBreakerColumn(columnNames: string[]): 'updated_at' | 'created_at' | null {
  if (columnNames.includes('updated_at')) return 'updated_at';
  if (columnNames.includes('created_at')) return 'created_at';
  return null;
}

/** 内存去重：上传/恢复前使用，保留时间戳较新的一条 */
export function dedupeRowsByPrimaryKey(
  rows: Record<string, unknown>[],
  pkCols: string[],
): Record<string, unknown>[] {
  if (pkCols.length === 0) return rows;

  let ordered = rows;
  if (rows.length > 1) {
    if (rows.some(r => r.updated_at != null && r.updated_at !== '')) {
      ordered = [...rows].sort((a, b) =>
        String(a.updated_at ?? '').localeCompare(String(b.updated_at ?? '')),
      );
    } else if (rows.some(r => r.created_at != null && r.created_at !== '')) {
      ordered = [...rows].sort((a, b) =>
        String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')),
      );
    }
  }

  const map = new Map<string, Record<string, unknown>>();
  const noKey: Record<string, unknown>[] = [];
  for (const row of ordered) {
    const parts = pkCols.map(c => row[c]);
    if (parts.some(v => v == null || v === '')) {
      noKey.push(row);
      continue;
    }
    const key = parts.map(v => String(v)).join('\0');
    map.set(key, row);
  }
  return [...map.values(), ...noKey];
}

function buildPkEqualitySql(pkCols: string[]): string {
  return pkCols.map(c => `b.${quoteIdent(c)} = a.${quoteIdent(c)}`).join(' AND ');
}

function buildBetterRowSql(tieBreaker: 'updated_at' | 'created_at' | null): string {
  if (!tieBreaker) return 'b.rowid > a.rowid';
  const col = quoteIdent(tieBreaker);
  return `(
    b.${col} > a.${col}
    OR (b.${col} IS NOT NULL AND a.${col} IS NULL)
    OR (b.${col} = a.${col} AND b.rowid > a.rowid)
    OR (b.${col} IS NULL AND a.${col} IS NULL AND b.rowid > a.rowid)
  )`;
}

async function countDuplicatePrimaryKeyRows(
  db: SQLite.SQLiteDatabase,
  table: string,
  pkCols: string[],
): Promise<number> {
  const safe = quoteIdent(table);
  if (pkCols.length === 1) {
    const col = quoteIdent(pkCols[0]!);
    const row = await db.getFirstAsync<{ extra: number }>(
      `SELECT COUNT(*) - COUNT(DISTINCT ${col}) AS extra FROM ${safe}`,
    );
    return row?.extra && row.extra > 0 ? row.extra : 0;
  }
  const distinctCols = pkCols.map(c => quoteIdent(c)).join(', ');
  const row = await db.getFirstAsync<{ total: number; distinct: number }>(
    `SELECT
       (SELECT COUNT(*) FROM ${safe}) AS total,
       (SELECT COUNT(*) FROM (SELECT DISTINCT ${distinctCols} FROM ${safe})) AS distinct`,
  );
  if (!row) return 0;
  const extra = row.total - row.distinct;
  return extra > 0 ? extra : 0;
}

/** 删除本地表中主键重复行，保留较新的一条 */
export async function dedupeLocalTableByPrimaryKeyIfNeeded(
  db: SQLite.SQLiteDatabase,
  table: string,
  opts?: { markDirty?: boolean },
): Promise<boolean> {
  if (!isAppUserTableName(table)) return false;

  const pkCols = await readTablePrimaryKeyColumns(db, table);
  const extra = await countDuplicatePrimaryKeyRows(db, table, pkCols);
  if (extra <= 0) return false;

  const colNames = await readTableColumnNames(db, table);
  const tieBreaker = pickRowTieBreakerColumn(colNames);
  const safe = quoteIdent(table);
  const pkMatch = buildPkEqualitySql(pkCols);
  const betterRow = buildBetterRowSql(tieBreaker);

  await db.runAsync(
    `DELETE FROM ${safe} AS a
     WHERE EXISTS (
       SELECT 1 FROM ${safe} AS b
       WHERE ${pkMatch}
         AND (${betterRow})
     )`,
  );
  if (opts?.markDirty !== false) markCloudSqliteTableDirty(table);
  return true;
}

/** 仅清理指定表的主键重复行（云端同步前使用） */
export async function dedupeLocalTablesByPrimaryKeyIfNeeded(
  tableNames: string[],
  opts?: { markDirty?: boolean },
): Promise<string[]> {
  const db = await getDatabase();
  const fixed: string[] = [];
  for (const table of tableNames) {
    if (await dedupeLocalTableByPrimaryKeyIfNeeded(db, table, opts)) fixed.push(table);
  }
  return fixed;
}

/** 扫描并清理所有用户表的主键重复行 */
export async function dedupeAllLocalUserTablesByPrimaryKeyIfNeeded(): Promise<string[]> {
  const db = await getDatabase();
  const meta = await db.getAllAsync<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type='table' AND substr(name,1,7) != 'sqlite_' ORDER BY name`,
  );
  const fixed: string[] = [];
  for (const { name } of meta) {
    if (!isAppUserTableName(name)) continue;
    if (await dedupeLocalTableByPrimaryKeyIfNeeded(db, name)) fixed.push(name);
  }
  return fixed;
}
