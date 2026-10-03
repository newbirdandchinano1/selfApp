import { newMutationId } from '@/lib/sync-write-meta';

/**
 * 本地 SQL 写入 → API Outbox（markApiTableDirty）+ Tab 缓存失效。
 * Worker / D1 不再由脏表驱动增量推送（周期全量备份见 cloud-sync-scheduler）。
 */

const LEGACY_DIRTY_KEYS = [
  'selfapp:cloud-sql-dirty-tables-v1',
  'selfapp:github-cloud-dirty-state-v1',
  'selfapp:github-sqlite-dirty-tables-v1',
] as const;

let ignoreMutationDepth = 0;

export function beginCloudSqliteDirtyIgnoreBatch(): void {
  ignoreMutationDepth += 1;
}

export function endCloudSqliteDirtyIgnoreBatch(): void {
  ignoreMutationDepth = Math.max(0, ignoreMutationDepth - 1);
}

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
  void import('@/lib/page-api-session').then(m => m.markTabPagesDirtyForTable(t));
  void import('@/lib/api-incremental-sync').then(m => m.markApiTableDirty(t));
}

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

/** 启动时把历史 Worker 脏表迁进 API Outbox，并清掉旧存储键。 */
export async function hydrateCloudDirtyFromStorage(): Promise<void> {
  try {
    const migrated = new Set<string>();
    for (const key of LEGACY_DIRTY_KEYS) {
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

/** 清库 / D1 全量备份后丢掉残留脏表键（不调度 Worker 增量）。 */
export function clearAllCloudSqliteDirtyTables(): void {
  void AsyncStorage.multiRemove([...LEGACY_DIRTY_KEYS]).catch(() => {});
}

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

function flattenRunParams(params: unknown[]): unknown[] {
  if (params.length === 1 && Array.isArray(params[0])) return params[0] as unknown[];
  return params;
}

async function stampPendingMutationId(
  origRun: SqliteDbWithTracking['runAsync'],
  source: string,
  params: unknown[],
  result: unknown,
): Promise<void> {
  // 忽略脏标只跳过 requestPush，不能跳过 mutation_id：否则会沿用他端/上次写入的 id，
  // 桌面端会把 APP 改名当成「本机回声」丢掉。
  if (/\blast_pushed_mutation_id\b/i.test(source)) return;
  if (/\bmutation_id\b/i.test(source)) return;
  if (
    /^(pragma|begin|commit|rollback|savepoint|release|vacuum|analyze|reindex|attach|detach|create\s|drop\s|alter\s)/i.test(
      source.replace(/\s+/g, ' ').trim(),
    )
  ) {
    return;
  }
  const tables = extractMutationTablesFromSql(source);
  if (tables.length === 0) return;
  const mid = newMutationId();
  const isInsert = /^\s*(insert|replace)\b/i.test(source);
  const binds = flattenRunParams(params);
  for (const table of tables) {
    if (!isSafeTableName(table) || table.startsWith('sqlite_') || table === 'app_meta') continue;
    try {
      if (isInsert) {
        const rowid = Number((result as { lastInsertRowId?: number } | null)?.lastInsertRowId);
        if (rowid > 0) {
          await origRun(
            `UPDATE \`${table}\` SET mutation_id = ? WHERE rowid = ? AND sync_status IN ('pending_create','pending_update','pending_delete')`,
            mid,
            rowid,
          );
        }
        continue;
      }
      const whereCol = /\bwhere\s+`?([A-Za-z_][A-Za-z0-9_]*)`?\s*=\s*\?/i.exec(source);
      if (whereCol?.[1] && binds.length > 0) {
        await origRun(
          `UPDATE \`${table}\` SET mutation_id = ? WHERE \`${whereCol[1]}\` = ? AND sync_status IN ('pending_create','pending_update','pending_delete')`,
          mid,
          binds[binds.length - 1],
        );
      }
    } catch {
      /* 无 mutation_id 列或表不存在 */
    }
  }
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
    const result = await origRun(source, ...params);
    try {
      await stampPendingMutationId(origRun, source, params, result);
    } catch {
      /* ignore */
    }
    return result;
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
