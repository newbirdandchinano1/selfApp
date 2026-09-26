import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * P0-03：本地写入的统一入口。
 * - 在线权威：仅 MySQL `/api/*` Outbox（markApiTableDirty）
 * - Tab 缓存失效：markTabPagesDirtyForTable
 * - Worker / cloud-sql：不再由脏表驱动增量推送（仅保留周期全量备份）
 */

const CLOUD_DIRTY_STATE_KEY = 'selfapp:cloud-sql-dirty-tables-v1';
const LEGACY_GITHUB_DIRTY_KEY = 'selfapp:github-cloud-dirty-state-v1';
const LEGACY_SQLITE_DIRTY_KEY = 'selfapp:github-sqlite-dirty-tables-v1';

let ignoreMutationDepth = 0;

export function beginCloudSqliteDirtyIgnoreBatch(): void {
  ignoreMutationDepth += 1;
}

export function endCloudSqliteDirtyIgnoreBatch(): void {
  ignoreMutationDepth = Math.max(0, ignoreMutationDepth - 1);
}

/** @deprecated 使用 beginCloudSqliteDirtyIgnoreBatch */
export const beginGithubSqliteDirtyIgnoreBatch = beginCloudSqliteDirtyIgnoreBatch;
/** @deprecated 使用 endCloudSqliteDirtyIgnoreBatch */
export const endGithubSqliteDirtyIgnoreBatch = endCloudSqliteDirtyIgnoreBatch;

const SQLITE_RESERVED_TABLE_NAMES = new Set(['on', 'off', 'begin', 'end', 'commit', 'rollback']);

function isSafeTableName(name: string): boolean {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return false;
  if (SQLITE_RESERVED_TABLE_NAMES.has(name.toLowerCase())) return false;
  return true;
}

/**
 * 本地表变更 → 单一 Outbox（API）+ Tab 缓存失效。
 * 不再写入 Worker 脏表队列，也不再调度 cloud-sql 增量推送。
 */
export function markCloudSqliteTableDirty(table: string): void {
  const t = table.trim();
  if (!t || !isSafeTableName(t)) return;
  if (ignoreMutationDepth > 0) return;
  if (t.startsWith('sqlite_')) return;
  void import('@/lib/page-api-session').then(m => m.markTabPagesDirtyForTable(t));
  void import('@/lib/api-incremental-sync').then(m => m.markApiTableDirty(t));
}

/** @deprecated 使用 markCloudSqliteTableDirty */
export const markGithubSqliteTableDirty = markCloudSqliteTableDirty;

function parseDirtyTableNames(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    const arr = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === 'object'
        ? (parsed as { sqlite?: unknown }).sqlite
        : null;
    if (!Array.isArray(arr)) return [];
    const out: string[] = [];
    for (const x of arr) {
      if (typeof x === 'string' && isSafeTableName(x) && !x.startsWith('sqlite_')) {
        if (x === 'ON' || x === 'on') continue;
        out.push(x);
      }
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * 启动时：将历史 Worker 脏表迁移进 API Outbox，并清除旧存储。
 * 不再调度 Worker 增量推送。
 */
export async function hydrateCloudDirtyFromStorage(): Promise<void> {
  try {
    const migrated = new Set<string>();
    for (const key of [CLOUD_DIRTY_STATE_KEY, LEGACY_GITHUB_DIRTY_KEY, LEGACY_SQLITE_DIRTY_KEY]) {
      const raw = await AsyncStorage.getItem(key);
      for (const t of parseDirtyTableNames(raw)) migrated.add(t);
      if (raw != null) await AsyncStorage.removeItem(key);
    }
    if (migrated.size === 0) return;
    const { markApiTableDirty } = await import('@/lib/api-incremental-sync');
    for (const t of migrated) markApiTableDirty(t);
  } catch {
    /* ignore */
  }
}

/** @deprecated 使用 hydrateCloudDirtyFromStorage */
export const hydrateGithubCloudDirtyFromStorage = hydrateCloudDirtyFromStorage;

/** @deprecated Worker 脏表队列已退役；恒为空 */
export function peekCloudSqliteDirtyTables(): string[] {
  return [];
}

/** @deprecated */
export const peekGithubSqliteDirtyTables = peekCloudSqliteDirtyTables;

/** @deprecated Worker 脏表队列已退役；无操作 */
export function clearCloudSqliteDirtyTables(_tables: Iterable<string>): void {
  /* no-op */
}

/** @deprecated */
export const clearGithubSqliteDirtyTables = clearCloudSqliteDirtyTables;

/** @deprecated Worker 脏表队列已退役；顺带清掉残留存储 */
export function clearAllCloudSqliteDirtyTables(): void {
  void AsyncStorage.multiRemove([
    CLOUD_DIRTY_STATE_KEY,
    LEGACY_GITHUB_DIRTY_KEY,
    LEGACY_SQLITE_DIRTY_KEY,
  ]).catch(() => {});
}

/** @deprecated */
export const clearAllGithubSqliteDirtyTables = clearAllCloudSqliteDirtyTables;

/**
 * @deprecated Worker 增量推送已退役（P0-03）。备份仅走周期全量 / 手动全量。
 */
export function scheduleCloudTablePushDebounced(): void {
  /* no-op */
}

/** @deprecated */
export const scheduleGithubIncrementalCloudPushDebounced = scheduleCloudTablePushDebounced;

function extractMutationTablesFromSql(sql: string): string[] {
  const norm = sql.replace(/\s+/g, ' ').trim();
  if (!norm) return [];
  if (
    /^(pragma|begin|commit|rollback|savepoint|release|vacuum|analyze|reindex|attach|detach|create\s+(?:unique\s+)?(?:table|index|trigger)|drop\s+(?:table|index|trigger)|alter\s+table|after\s+(?:insert|update|delete))/i.test(
      norm,
    )
  ) {
    return [];
  }
  const tables = new Set<string>();
  const patterns: RegExp[] = [
    /\b(?:insert\s+or\s+\w+\s+into|insert\s+into|replace\s+into)\s+[`"]?([A-Za-z_][A-Za-z0-9_]*)[`"]?/gi,
    /\bupdate\s+[`"]?([A-Za-z_][A-Za-z0-9_]*)[`"]?\s+set\b/gi,
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

const CLOUD_SQLITE_TRACKING = Symbol('selfappCloudSqliteMutationTracking');

type SqliteDbWithTracking = {
  [CLOUD_SQLITE_TRACKING]?: true;
  runAsync: (source: string, ...params: unknown[]) => Promise<unknown>;
  execAsync: (source: string) => Promise<void>;
};

export function enableCloudSqliteMutationTrackingOnDatabase(db: SqliteDbWithTracking): void {
  if (db[CLOUD_SQLITE_TRACKING]) return;
  db[CLOUD_SQLITE_TRACKING] = true;

  const origRun = db.runAsync.bind(db);
  const origExec = db.execAsync.bind(db);

  db.runAsync = async (source: string, ...params: unknown[]) => {
    try {
      for (const t of extractMutationTablesFromSql(source)) {
        markCloudSqliteTableDirty(t);
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
          markCloudSqliteTableDirty(t);
        }
      }
    } catch {
      /* ignore */
    }
    return origExec(source);
  };
}

/** @deprecated 使用 enableCloudSqliteMutationTrackingOnDatabase */
export const enableGithubSqliteMutationTrackingOnDatabase = enableCloudSqliteMutationTrackingOnDatabase;
