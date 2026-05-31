import type * as SQLite from 'expo-sqlite';
import {
  beginCloudSqliteDirtyIgnoreBatch,
  endCloudSqliteDirtyIgnoreBatch,
} from '@/lib/cloud-sql-dirty-track';
import { ENTITY_ID_MAX_LEN, shortStableEntityId } from '@/lib/entity-id';
import { habitCheckInRowId } from '@/lib/repositories/habits/habit-check-in';

const MIGRATION_META_KEY = 'entity_ids_mysql_compat_v30';

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function isUserTable(name: string): boolean {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return false;
  const lower = name.toLowerCase();
  return !lower.startsWith('sqlite_') && !lower.startsWith('_cf_');
}

function looksLikeJsonString(value: string): boolean {
  const t = value.trim();
  return (t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'));
}

function applyRemapToString(value: string, remap: Map<string, string>): string {
  if (remap.has(value)) return remap.get(value)!;
  if (looksLikeJsonString(value)) {
    try {
      const parsed = JSON.parse(value) as unknown;
      const next = applyRemapDeep(parsed, remap);
      return JSON.stringify(next);
    } catch {
      return value;
    }
  }
  return value;
}

function applyRemapDeep(value: unknown, remap: Map<string, string>): unknown {
  if (remap.size === 0) return value;
  if (typeof value === 'string') return applyRemapToString(value, remap);
  if (Array.isArray(value)) return value.map(item => applyRemapDeep(item, remap));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = applyRemapDeep(v, remap);
    }
    return out;
  }
  return value;
}

async function listUserTables(db: SQLite.SQLiteDatabase): Promise<string[]> {
  const meta = await db.getAllAsync<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type='table' AND substr(name,1,7) != 'sqlite_' ORDER BY name`,
  );
  return meta.map(r => r.name).filter(isUserTable);
}

async function readTableColumns(db: SQLite.SQLiteDatabase, table: string): Promise<string[]> {
  const cols = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${quoteIdent(table)})`);
  return cols.map(c => c.name).filter(Boolean);
}

function reserveRemap(remap: Map<string, string>, oldId: string, preferred?: string): void {
  if (!oldId || oldId.length <= ENTITY_ID_MAX_LEN) return;
  if (remap.has(oldId)) return;
  let next = preferred ?? shortStableEntityId(oldId);
  let n = 0;
  while ([...remap.values()].includes(next) && n < 8) {
    next = shortStableEntityId(`${oldId}#${n}`);
    n += 1;
  }
  remap.set(oldId, next);
}

async function collectLongIdRemap(db: SQLite.SQLiteDatabase): Promise<Map<string, string>> {
  const remap = new Map<string, string>();
  const tables = await listUserTables(db);

  for (const table of tables) {
    const cols = await readTableColumns(db, table);
    if (!cols.includes('id')) continue;

    if (table === 'habit_check_ins') {
      const rows = await db.getAllAsync<{ id: string; habit_id: string; record_date: string }>(
        `SELECT id, habit_id, record_date FROM ${quoteIdent(table)}`,
      );
      for (const row of rows) {
        const canonical = habitCheckInRowId(row.habit_id, row.record_date);
        if (row.id !== canonical) remap.set(row.id, canonical);
      }
      continue;
    }

    const longRows = await db.getAllAsync<{ id: string }>(
      `SELECT id FROM ${quoteIdent(table)} WHERE typeof(id) = 'text' AND length(id) > ?`,
      [ENTITY_ID_MAX_LEN],
    );
    for (const row of longRows) reserveRemap(remap, row.id);
  }

  return remap;
}

async function applyRemapToSqliteDb(db: SQLite.SQLiteDatabase, remap: Map<string, string>): Promise<void> {
  if (remap.size === 0) return;
  const tables = await listUserTables(db);

  for (const table of tables) {
    const cols = await readTableColumns(db, table);
    const safe = quoteIdent(table);

    for (const col of cols) {
      if (col === 'id' || col.endsWith('_id') || col.endsWith('Id')) {
        for (const [oldId, newId] of remap) {
          await db.runAsync(
            `UPDATE ${safe} SET ${quoteIdent(col)} = ? WHERE ${quoteIdent(col)} = ?`,
            [newId, oldId],
          );
        }
      }
    }

    if (cols.includes('extra_data')) {
      const rows = await db.getAllAsync<{ id: string; extra_data: string | null }>(
        `SELECT id, extra_data FROM ${safe} WHERE extra_data IS NOT NULL AND extra_data != ''`,
      );
      for (const row of rows) {
        const raw = row.extra_data!;
        const next = applyRemapToString(raw, remap);
        if (next !== raw) {
          await db.runAsync(`UPDATE ${safe} SET extra_data = ? WHERE id = ?`, [next, row.id]);
        }
      }
    }
  }
}

/** 将本地库中超过 MySQL 长度的 id（含 habit_check_ins 组合 id）统一缩短 */
export async function migrateLocalEntityIdsForMysqlCompatIfNeeded(
  db: SQLite.SQLiteDatabase,
): Promise<void> {
  const flag = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM app_meta WHERE key = ?',
    [MIGRATION_META_KEY],
  );
  if (flag?.value === '1') return;

  beginCloudSqliteDirtyIgnoreBatch();
  try {
    await db.execAsync('PRAGMA foreign_keys = OFF');
    const remap = await collectLongIdRemap(db);
    await applyRemapToSqliteDb(db, remap);
    await db.runAsync('INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)', [
      MIGRATION_META_KEY,
      '1',
    ]);
  } finally {
    try {
      await db.execAsync('PRAGMA foreign_keys = ON');
    } catch {
      /* ignore */
    }
    endCloudSqliteDirtyIgnoreBatch();
  }
}
