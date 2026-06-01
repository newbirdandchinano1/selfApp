import AsyncStorage from '@react-native-async-storage/async-storage';

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

const dirtyTables = new Set<string>();
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let pushDebounceTimer: ReturnType<typeof setTimeout> | null = null;

const SQLITE_RESERVED_TABLE_NAMES = new Set(['on', 'off', 'begin', 'end', 'commit', 'rollback']);

function isSafeTableName(name: string): boolean {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return false;
  if (SQLITE_RESERVED_TABLE_NAMES.has(name.toLowerCase())) return false;
  return true;
}

export function markCloudSqliteTableDirty(table: string): void {
  const t = table.trim();
  if (!t || !isSafeTableName(t)) return;
  if (ignoreMutationDepth > 0) return;
  if (t.startsWith('sqlite_')) return;
  dirtyTables.add(t);
  schedulePersistCloudDirty();
  scheduleCloudTablePushDebounced();
  void import('@/lib/api-incremental-sync').then(m => m.markApiTableDirty(t));
}

/** @deprecated 使用 markCloudSqliteTableDirty */
export const markGithubSqliteTableDirty = markCloudSqliteTableDirty;

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
    if (sqlite.length === 0) {
      await AsyncStorage.removeItem(CLOUD_DIRTY_STATE_KEY);
      return;
    }
    await AsyncStorage.setItem(CLOUD_DIRTY_STATE_KEY, JSON.stringify({ sqlite }));
  } catch {
    /* 非致命 */
  }
}

export async function hydrateCloudDirtyFromStorage(): Promise<void> {
  try {
    const rawNew = await AsyncStorage.getItem(CLOUD_DIRTY_STATE_KEY);
    if (rawNew) {
      const o = JSON.parse(rawNew) as unknown;
      if (o && typeof o === 'object' && !Array.isArray(o)) {
        const sqliteRaw = (o as Record<string, unknown>).sqlite;
        if (Array.isArray(sqliteRaw)) {
          for (const x of sqliteRaw) {
            if (typeof x === 'string' && isSafeTableName(x)) dirtyTables.add(x);
          }
        }
        dirtyTables.delete('ON');
        dirtyTables.delete('on');
      }
    } else {
      for (const legacyKey of [LEGACY_GITHUB_DIRTY_KEY, LEGACY_SQLITE_DIRTY_KEY]) {
        const rawLegacy = await AsyncStorage.getItem(legacyKey);
        if (!rawLegacy) continue;
        const parsed = JSON.parse(rawLegacy) as unknown;
        const arr = Array.isArray(parsed)
          ? parsed
          : parsed && typeof parsed === 'object'
            ? (parsed as { sqlite?: unknown }).sqlite
            : null;
        if (Array.isArray(arr)) {
          for (const x of arr) {
            if (typeof x === 'string' && isSafeTableName(x)) dirtyTables.add(x);
          }
        }
        await AsyncStorage.removeItem(legacyKey);
      }
      await persistCloudDirtyNow();
    }
    if (dirtyTables.size > 0) scheduleCloudTablePushDebounced();
  } catch {
    /* ignore */
  }
}

/** @deprecated 使用 hydrateCloudDirtyFromStorage */
export const hydrateGithubCloudDirtyFromStorage = hydrateCloudDirtyFromStorage;

export function peekCloudSqliteDirtyTables(): string[] {
  return [...dirtyTables].sort();
}

/** @deprecated */
export const peekGithubSqliteDirtyTables = peekCloudSqliteDirtyTables;

export function clearCloudSqliteDirtyTables(tables: Iterable<string>): void {
  for (const t of tables) dirtyTables.delete(t);
  void persistCloudDirtyNow();
}

/** @deprecated */
export const clearGithubSqliteDirtyTables = clearCloudSqliteDirtyTables;

export function clearAllCloudSqliteDirtyTables(): void {
  dirtyTables.clear();
  void persistCloudDirtyNow();
}

/** @deprecated */
export const clearAllGithubSqliteDirtyTables = clearAllCloudSqliteDirtyTables;

const INCREMENTAL_PUSH_DELAY_MS = 4500;

export function scheduleCloudTablePushDebounced(): void {
  if (pushDebounceTimer) clearTimeout(pushDebounceTimer);
  pushDebounceTimer = setTimeout(() => {
    pushDebounceTimer = null;
    void import('@/lib/cloud-sql-sync').then(m => {
      void m.pushCloudDirtyTablesIfNeeded();
    });
  }, INCREMENTAL_PUSH_DELAY_MS);
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
