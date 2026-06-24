import { getDatabase } from '@/lib/database';

export const REST_INITIAL_SYNC_META_KEY = 'rest_initial_sync_completed_v1';
export const PREFER_LOCAL_READS_META_KEY = 'prefer_local_reads_v1';
export const PAGE_SYNC_META_KEY = 'page_api_synced_keys_v1';

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

export async function readAppMeta(key: string): Promise<string | null> {
  const db = await getDatabase();
  if (!db) return null;
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM app_meta WHERE key = ? LIMIT 1',
    [key],
  );
  return row?.value ?? null;
}

export async function writeAppMeta(key: string, value: string): Promise<void> {
  const db = await getDatabase();
  if (!db) return;
  await db.runAsync('INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)', [key, value]);
}

const USER_DATA_PROBE_TABLES = ['tasks', 'users', 'finance_accounts', 'projects', 'health_records'] as const;

/** 探测本机是否已有业务数据（含默认用户种子行） */
export async function localDbHasUserData(): Promise<boolean> {
  const db = await getDatabase();
  if (!db) return false;

  for (const table of USER_DATA_PROBE_TABLES) {
    try {
      const row = await db.getFirstAsync<{ c: number }>(
        `SELECT COUNT(*) AS c FROM ${quoteIdent(table)}`,
      );
      if ((row?.c ?? 0) > 0) return true;
    } catch {
      /* 表可能尚未创建 */
    }
  }
  return false;
}

/** 是否已有可展示的业务数据（不含仅 default 用户种子行） */
export async function localDbHasSubstantialUserData(): Promise<boolean> {
  const db = await getDatabase();
  if (!db) return false;

  const probeTables = ['tasks', 'finance_accounts', 'projects', 'health_records'];
  for (const table of probeTables) {
    try {
      const row = await db.getFirstAsync<{ c: number }>(
        `SELECT COUNT(*) AS c FROM ${quoteIdent(table)}`,
      );
      if ((row?.c ?? 0) > 0) return true;
    } catch {
      /* 表可能尚未创建 */
    }
  }

  try {
    const row = await db.getFirstAsync<{ c: number }>(
      `SELECT COUNT(*) AS c FROM ${quoteIdent('users')} WHERE id != 'default'`,
    );
    if ((row?.c ?? 0) > 0) return true;
  } catch {
    /* ignore */
  }

  return false;
}

export async function clearPageSyncMeta(): Promise<void> {
  await writeAppMeta(PAGE_SYNC_META_KEY, '[]');
}
