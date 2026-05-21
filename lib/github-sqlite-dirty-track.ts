import AsyncStorage from '@react-native-async-storage/async-storage';

/** 与全量备份 `manifest` 中 `kv/*.json` 的 `name` 一致 */
export const GITHUB_CLOUD_KV_MANIFEST_SLICES = [
  'memos',
  'user_weaknesses',
  'user_skills',
  'weekly_review',
  'ai_llm_provider',
] as const;

export type GithubCloudKvManifestSlice = (typeof GITHUB_CLOUD_KV_MANIFEST_SLICES)[number];

const KV_SLICE_SET = new Set<string>(GITHUB_CLOUD_KV_MANIFEST_SLICES);

const CLOUD_DIRTY_STATE_KEY = 'selfapp:github-cloud-dirty-state-v1';
/** 旧版仅 SQLite 表名数组，启动时迁移 */
const LEGACY_SQLITE_DIRTY_KEY = 'selfapp:github-sqlite-dirty-tables-v1';

/** 账单相关表由 `scheduleGithubFinanceCloudSyncDebounced` 单独上传单文件 JSON，避免与增量 sqlite/ 重复 PUT */
const FINANCE_TABLES_EXCLUDED_FROM_INCREMENTAL = new Set([
  'finance_transactions',
  'finance_accounts',
  'finance_flow_categories',
  'finance_account_types',
]);

let ignoreMutationDepth = 0;

/** 全量恢复等场景：期间 SQLite 写入与 KV 写入均不计入「待增量上传」 */
export function beginGithubSqliteDirtyIgnoreBatch(): void {
  ignoreMutationDepth += 1;
}

export function endGithubSqliteDirtyIgnoreBatch(): void {
  ignoreMutationDepth = Math.max(0, ignoreMutationDepth - 1);
}

const dirtyTables = new Set<string>();
const dirtyKvSlices = new Set<string>();
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let pushDebounceTimer: ReturnType<typeof setTimeout> | null = null;

function isSafeTableName(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}

export function markGithubSqliteTableDirty(table: string): void {
  const t = table.trim();
  if (!t || !isSafeTableName(t)) return;
  if (ignoreMutationDepth > 0) return;
  if (t.startsWith('sqlite_')) return;
  if (FINANCE_TABLES_EXCLUDED_FROM_INCREMENTAL.has(t)) return;
  dirtyTables.add(t);
  schedulePersistCloudDirty();
  scheduleGithubIncrementalCloudPushDebounced();
}

/**
 * 在写入与云端全量备份 manifest 中 `kv/` 对应的 AsyncStorage 数据后调用，
 * 触发防抖增量上传该 `kv/{slice}.json`。
 */
export function markGithubKvSliceDirty(slice: GithubCloudKvManifestSlice | string): void {
  const k = typeof slice === 'string' ? slice.trim() : slice;
  if (!k || !KV_SLICE_SET.has(k)) return;
  if (ignoreMutationDepth > 0) return;
  dirtyKvSlices.add(k);
  schedulePersistCloudDirty();
  scheduleGithubIncrementalCloudPushDebounced();
}

function schedulePersistCloudDirty(): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void persistCloudDirtyNow();
  }, 400);
}

async function persistCloudDirtyNow(): Promise<void> {
  try {
    const sqlite = [...dirtyTables].sort();
    const kv = [...dirtyKvSlices].sort();
    if (sqlite.length === 0 && kv.length === 0) {
      await AsyncStorage.removeItem(CLOUD_DIRTY_STATE_KEY);
      return;
    }
    await AsyncStorage.setItem(CLOUD_DIRTY_STATE_KEY, JSON.stringify({ sqlite, kv }));
  } catch {
    /* 非致命 */
  }
}

/** 启动时恢复脏表 / 脏 KV（含旧版仅 sqlite 持久化键的迁移） */
export async function hydrateGithubCloudDirtyFromStorage(): Promise<void> {
  try {
    const rawNew = await AsyncStorage.getItem(CLOUD_DIRTY_STATE_KEY);
    if (rawNew) {
      const o = JSON.parse(rawNew) as unknown;
      if (o && typeof o === 'object' && !Array.isArray(o)) {
        const rec = o as Record<string, unknown>;
        const sqliteRaw = rec.sqlite;
        const kvRaw = rec.kv;
        if (Array.isArray(sqliteRaw)) {
          for (const x of sqliteRaw) {
            if (typeof x === 'string' && isSafeTableName(x) && !FINANCE_TABLES_EXCLUDED_FROM_INCREMENTAL.has(x)) {
              dirtyTables.add(x);
            }
          }
        }
        if (Array.isArray(kvRaw)) {
          for (const x of kvRaw) {
            if (typeof x === 'string' && KV_SLICE_SET.has(x)) dirtyKvSlices.add(x);
          }
        }
      }
    } else {
      const rawLegacy = await AsyncStorage.getItem(LEGACY_SQLITE_DIRTY_KEY);
      if (rawLegacy) {
        const arr = JSON.parse(rawLegacy) as unknown;
        if (Array.isArray(arr)) {
          for (const x of arr) {
            if (typeof x === 'string' && isSafeTableName(x) && !FINANCE_TABLES_EXCLUDED_FROM_INCREMENTAL.has(x)) {
              dirtyTables.add(x);
            }
          }
        }
        await AsyncStorage.removeItem(LEGACY_SQLITE_DIRTY_KEY);
        await persistCloudDirtyNow();
      }
    }
    if (dirtyTables.size > 0 || dirtyKvSlices.size > 0) {
      scheduleGithubIncrementalCloudPushDebounced();
    }
  } catch {
    /* ignore */
  }
}

/** @deprecated 使用 {@link hydrateGithubCloudDirtyFromStorage} */
export async function hydrateGithubSqliteDirtyTablesFromStorage(): Promise<void> {
  await hydrateGithubCloudDirtyFromStorage();
}

export function peekGithubSqliteDirtyTables(): string[] {
  return [...dirtyTables].sort();
}

export function peekGithubKvDirtySlices(): string[] {
  return [...dirtyKvSlices].sort();
}

export function clearGithubSqliteDirtyTables(tables: Iterable<string>): void {
  for (const t of tables) dirtyTables.delete(t);
  void persistCloudDirtyNow();
}

export function clearGithubKvDirtySlices(keys: Iterable<string>): void {
  for (const k of keys) dirtyKvSlices.delete(k);
  void persistCloudDirtyNow();
}

/** 全量备份成功后清空所有云增量脏标记 */
export function clearAllGithubSqliteDirtyTables(): void {
  dirtyTables.clear();
  dirtyKvSlices.clear();
  void persistCloudDirtyNow();
}

const INCREMENTAL_PUSH_DELAY_MS = 4500;

export function scheduleGithubIncrementalCloudPushDebounced(): void {
  if (pushDebounceTimer) clearTimeout(pushDebounceTimer);
  pushDebounceTimer = setTimeout(() => {
    pushDebounceTimer = null;
    void import('@/lib/github-cloud-sync').then(m => {
      void m.pushGithubIncrementalCloudDirtyToCloudIfNeeded();
    });
  }, INCREMENTAL_PUSH_DELAY_MS);
}

function extractMutationTablesFromSql(sql: string): string[] {
  const norm = sql.replace(/\s+/g, ' ').trim();
  if (!norm) return [];
  if (
    /^(pragma|begin|commit|rollback|savepoint|release|vacuum|analyze|reindex|attach|detach|create\s+table|create\s+index|create\s+unique\s+index|drop\s+table|drop\s+index|alter\s+table)/i.test(
      norm,
    )
  ) {
    return [];
  }
  const tables = new Set<string>();
  const patterns: RegExp[] = [
    /\b(?:insert\s+or\s+\w+\s+into|insert\s+into|replace\s+into)\s+[`"]?([A-Za-z_][A-Za-z0-9_]*)[`"]?/gi,
    /\bupdate\s+[`"]?([A-Za-z_][A-Za-z0-9_]*)[`"]?/gi,
    /\bdelete\s+from\s+[`"]?([A-Za-z_][A-Za-z0-9_]*)[`"]?/gi,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    const r = new RegExp(re.source, re.flags);
    while ((m = r.exec(norm)) !== null) {
      const name = m[1];
      if (name) tables.add(name);
    }
  }
  return [...tables];
}

function splitSqlStatementsRough(sql: string): string[] {
  return sql
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));
}

const GITHUB_SQLITE_TRACKING = Symbol('selfappGithubSqliteMutationTracking');

type SqliteDbWithTracking = {
  [GITHUB_SQLITE_TRACKING]?: true;
  runAsync: (source: string, ...params: unknown[]) => Promise<unknown>;
  execAsync: (source: string) => Promise<void>;
};

/** 在 `initDatabase` 全部迁移完成后调用，包装同一连接上的写操作 */
export function enableGithubSqliteMutationTrackingOnDatabase(db: SqliteDbWithTracking): void {
  if (db[GITHUB_SQLITE_TRACKING]) return;
  db[GITHUB_SQLITE_TRACKING] = true;

  const origRun = db.runAsync.bind(db);
  const origExec = db.execAsync.bind(db);

  db.runAsync = async (source: string, ...params: unknown[]) => {
    try {
      for (const t of extractMutationTablesFromSql(source)) {
        markGithubSqliteTableDirty(t);
      }
    } catch {
      /* ignore */
    }
    return origRun(source, ...params);
  };

  db.execAsync = async (source: string) => {
    try {
      for (const stmt of splitSqlStatementsRough(source)) {
        for (const t of extractMutationTablesFromSql(stmt)) {
          markGithubSqliteTableDirty(t);
        }
      }
    } catch {
      /* ignore */
    }
    return origExec(source);
  };
}
