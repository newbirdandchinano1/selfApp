import { setLastCloudAlignAtIso, setLastFullCloudBackupAtIso } from '@/lib/cloud-backup-meta';
import { CLOUD_BACKUP_NOT_CONFIGURED_MSG, getCloudAuthToken } from '@/lib/cloud-backup-config';
import { executeCloudSql } from '@/lib/cloud-sql-client';
import {
  beginCloudSqliteDirtyIgnoreBatch,
  clearAllCloudSqliteDirtyTables,
  clearCloudSqliteDirtyTables,
  endCloudSqliteDirtyIgnoreBatch,
  peekCloudSqliteDirtyTables,
  scheduleCloudTablePushDebounced,
} from '@/lib/cloud-sql-dirty-track';
import { isSilentCloudRestoreInFlight, setSilentCloudRestoreInFlight } from '@/lib/cloud-sync-flags';
import { getDatabase, initDatabase } from '@/lib/database';
import { throwIfAborted, isAbortError } from '@/lib/cloud-fetch-retry';

const INSERT_BATCH_SIZE = 40;

export function serializeErrorForDiagnostic(err: unknown): string {
  if (err instanceof Error) {
    const anyErr = err as Error & { cause?: unknown };
    const parts = [`${anyErr.name}: ${anyErr.message}`];
    if (typeof anyErr.stack === 'string' && anyErr.stack.trim()) parts.push(anyErr.stack);
    if (anyErr.cause != null) parts.push('', 'cause:', serializeErrorForDiagnostic(anyErr.cause));
    return parts.join('\n');
  }
  try {
    return JSON.stringify(err, null, 2);
  } catch {
    return String(err);
  }
}

export type CloudSyncProgress = {
  phase: 'preparing' | 'collecting' | 'uploading' | 'downloading' | 'applying';
  tableIndex?: number;
  tableCount?: number;
  tableLabel?: string;
};

export type CloudSyncResult =
  | {
      ok: true;
      tableCount: number;
      rowCount: number;
      lastUpdated: string;
    }
  | {
      ok: false;
      reason: 'no_config' | 'collect_failed' | 'upload_failed' | 'download_failed' | 'apply_failed' | 'aborted' | 'unsupported_platform';
      message: string;
      diagnosticText: string;
    };

export type CloudRestoreResult =
  | {
      ok: true;
      cloudLastUpdated: string;
      sqliteTables: number;
      sqliteRows: number;
      warnings: string[];
      tablesNotInBackup: string[];
    }
  | {
      ok: false;
      reason: 'no_config' | 'fetch_failed' | 'apply_failed' | 'unsupported_platform' | 'aborted';
      message: string;
      diagnosticText: string;
    };

function isSafeSqliteTableName(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function toCreateTableIfNotExists(sql: string): string {
  if (/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS/i.test(sql)) return sql;
  return sql.replace(/^CREATE\s+TABLE\s+/i, 'CREATE TABLE IF NOT EXISTS ');
}

function sqliteBindingFromJson(v: unknown): string | number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return null;
    return v;
  }
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

async function listLocalUserTables(): Promise<string[]> {
  const db = await getDatabase();
  const meta = await db.getAllAsync<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type='table' AND substr(name,1,7) != 'sqlite_' ORDER BY name`,
  );
  return meta.map(r => r.name).filter(n => isSafeSqliteTableName(n));
}

async function listCloudUserTables(signal?: AbortSignal): Promise<string[]> {
  const r = await executeCloudSql<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type='table' AND substr(name,1,7) != 'sqlite_' ORDER BY name`,
    undefined,
    { signal },
  );
  if (!r.ok) throw new Error(r.message);
  return r.data.map(row => row.name).filter(n => isSafeSqliteTableName(n));
}

async function getLocalCreateTableSql(table: string): Promise<string | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ sql: string }>(
    `SELECT sql FROM sqlite_master WHERE type='table' AND name=?`,
    [table],
  );
  return row?.sql ?? null;
}

async function getCloudCreateTableSql(table: string, signal?: AbortSignal): Promise<string | null> {
  const r = await executeCloudSql<{ sql: string }>(
    `SELECT sql FROM sqlite_master WHERE type='table' AND name=?`,
    [table],
    { signal },
  );
  if (!r.ok) return null;
  return r.data[0]?.sql ?? null;
}

async function ensureCloudTableFromLocal(table: string, signal?: AbortSignal): Promise<void> {
  const createSql = await getLocalCreateTableSql(table);
  if (!createSql) throw new Error(`本地不存在表 ${table} 的建表语句`);
  const r = await executeCloudSql(toCreateTableIfNotExists(createSql), undefined, { signal });
  if (!r.ok) throw new Error(`云端建表 ${table} 失败：${r.message}`);
}

async function readLocalTableRows(table: string): Promise<Record<string, unknown>[]> {
  const db = await getDatabase();
  const safe = quoteIdent(table);
  const rows = await db.getAllAsync(`SELECT * FROM ${safe}`);
  return (rows as Record<string, unknown>[]) ?? [];
}

async function readLocalTableColumns(table: string): Promise<string[]> {
  const db = await getDatabase();
  const safe = quoteIdent(table);
  const cols = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${safe})`);
  return cols.map(c => c.name).filter(Boolean);
}

async function replaceCloudTableData(
  table: string,
  rows: Record<string, unknown>[],
  signal?: AbortSignal,
): Promise<number> {
  await ensureCloudTableFromLocal(table, signal);

  const del = await executeCloudSql(`DELETE FROM ${quoteIdent(table)}`, undefined, { signal });
  if (!del.ok) throw new Error(`清空云端表 ${table} 失败：${del.message}`);
  if (rows.length === 0) return 0;

  const colNames = await readLocalTableColumns(table);
  if (colNames.length === 0) return 0;

  const qCols = colNames.map(c => quoteIdent(c)).join(', ');
  let inserted = 0;

  for (let i = 0; i < rows.length; i += INSERT_BATCH_SIZE) {
    throwIfAborted(signal);
    const batch = rows.slice(i, i + INSERT_BATCH_SIZE);
    const placeholders = batch.map(() => `(${colNames.map(() => '?').join(', ')})`).join(', ');
    const params: (string | number | null)[] = [];
    for (const row of batch) {
      for (const col of colNames) {
        params.push(sqliteBindingFromJson(row[col]));
      }
    }
    const sql = `INSERT INTO ${quoteIdent(table)} (${qCols}) VALUES ${placeholders}`;
    const ins = await executeCloudSql(sql, params, { signal });
    if (!ins.ok) throw new Error(`写入云端表 ${table} 失败：${ins.message}`);
    inserted += batch.length;
  }

  return inserted;
}

/** 将单张本地表全量推送到云端（建表 + 覆盖数据） */
export async function pushLocalTableToCloud(table: string, opts?: { signal?: AbortSignal }): Promise<number> {
  if (!isSafeSqliteTableName(table)) throw new Error(`非法表名：${table}`);
  const rows = await readLocalTableRows(table);
  return replaceCloudTableData(table, rows, opts?.signal);
}

/** 一键全量备份：本地所有 SQLite 表 → 云端 */
export async function triggerCloudFullBackup(opts?: {
  signal?: AbortSignal;
  onProgress?: (p: CloudSyncProgress) => void;
}): Promise<CloudSyncResult> {
  const report = (p: CloudSyncProgress) => opts?.onProgress?.(p);
  const token = await getCloudAuthToken();
  if (!token) {
    return {
      ok: false,
      reason: 'no_config',
      message: CLOUD_BACKUP_NOT_CONFIGURED_MSG,
      diagnosticText: CLOUD_BACKUP_NOT_CONFIGURED_MSG,
    };
  }

  const dbProbe = await getDatabase();
  if (!dbProbe) {
    const message = '当前环境无本地 SQLite（例如 Web），无法执行全量备份。';
    return { ok: false, reason: 'unsupported_platform', message, diagnosticText: message };
  }

  report({ phase: 'preparing' });
  let tables: string[];
  try {
    report({ phase: 'collecting' });
    tables = await listLocalUserTables();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const message = `读取本地表列表失败：${msg}`;
    return {
      ok: false,
      reason: 'collect_failed',
      message,
      diagnosticText: [message, '', serializeErrorForDiagnostic(e)].join('\n'),
    };
  }

  const lastUpdated = new Date().toISOString();
  let rowCount = 0;

  try {
    for (let i = 0; i < tables.length; i++) {
      throwIfAborted(opts?.signal);
      const table = tables[i]!;
      report({
        phase: 'uploading',
        tableIndex: i + 1,
        tableCount: tables.length,
        tableLabel: table,
      });
      rowCount += await pushLocalTableToCloud(table, { signal: opts?.signal });
    }
  } catch (e) {
    if (isAbortError(e) || opts?.signal?.aborted) {
      const message = '全量备份已中止';
      return { ok: false, reason: 'aborted', message, diagnosticText: message };
    }
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      reason: 'upload_failed',
      message: msg,
      diagnosticText: [msg, '', serializeErrorForDiagnostic(e)].join('\n'),
    };
  }

  await setLastFullCloudBackupAtIso(lastUpdated);
  await setLastCloudAlignAtIso(lastUpdated);
  clearAllCloudSqliteDirtyTables();
  return { ok: true, tableCount: tables.length, rowCount, lastUpdated };
}

async function applyCloudRowsToLocalTable(table: string, rows: unknown[], signal?: AbortSignal): Promise<number> {
  const db = await getDatabase();
  const safe = quoteIdent(table);
  const cols = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${safe})`);
  const colNames = cols.map(c => c.name).filter(Boolean);
  if (colNames.length === 0) throw new Error(`本机不存在表 ${table}`);

  await db.runAsync(`DELETE FROM ${safe}`);
  let count = 0;
  for (const row of rows) {
    throwIfAborted(signal);
    if (row === null || typeof row !== 'object' || Array.isArray(row)) continue;
    const obj = row as Record<string, unknown>;
    const keys = colNames.filter(c => Object.prototype.hasOwnProperty.call(obj, c));
    if (keys.length === 0) continue;
    const qCols = keys.map(c => quoteIdent(c)).join(', ');
    const placeholders = keys.map(() => '?').join(', ');
    const vals = keys.map(k => sqliteBindingFromJson(obj[k]));
    await db.runAsync(`INSERT INTO ${safe} (${qCols}) VALUES (${placeholders})`, vals);
    count += 1;
  }
  return count;
}

/** 从云同步：云端所有表 → 覆盖本地 */
export async function triggerCloudFullRestore(opts?: {
  signal?: AbortSignal;
  onProgress?: (p: CloudSyncProgress) => void;
}): Promise<CloudRestoreResult> {
  const report = (p: CloudSyncProgress) => opts?.onProgress?.(p);
  const token = await getCloudAuthToken();
  if (!token) {
    const message = CLOUD_BACKUP_NOT_CONFIGURED_MSG;
    return { ok: false, reason: 'no_config', message, diagnosticText: message };
  }

  const db = await getDatabase();
  if (!db) {
    const message = '当前运行环境无本地 SQLite（例如 Web），无法执行全量同步。';
    return { ok: false, reason: 'unsupported_platform', message, diagnosticText: message };
  }

  setSilentCloudRestoreInFlight(true);
  beginCloudSqliteDirtyIgnoreBatch();
  try {
    report({ phase: 'preparing' });
    let cloudTables: string[];
    try {
      throwIfAborted(opts?.signal);
      cloudTables = await listCloudUserTables(opts?.signal);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        ok: false,
        reason: 'fetch_failed',
        message: `拉取云端表列表失败：${msg}`,
        diagnosticText: [msg, '', serializeErrorForDiagnostic(e)].join('\n'),
      };
    }

    const localTables = await listLocalUserTables();
    const localSet = new Set(localTables);
    const tablesNotInBackup = localTables.filter(t => !cloudTables.includes(t));
    const warnings: string[] = [];
    if (tablesNotInBackup.length > 0) {
      const preview = tablesNotInBackup.slice(0, 12).join('、');
      const more = tablesNotInBackup.length > 12 ? ` 等共 ${tablesNotInBackup.length} 张` : '';
      warnings.push(`以下本机表未出现在云端，未覆盖：${preview}${more}`);
    }

    const snapshots: { table: string; rows: unknown[] }[] = [];

    try {
      for (let i = 0; i < cloudTables.length; i++) {
        throwIfAborted(opts?.signal);
        const table = cloudTables[i]!;
        report({
          phase: 'downloading',
          tableIndex: i + 1,
          tableCount: cloudTables.length,
          tableLabel: table,
        });
        const r = await executeCloudSql(`SELECT * FROM ${quoteIdent(table)}`, undefined, {
          signal: opts?.signal,
        });
        if (!r.ok) throw new Error(`拉取云端表 ${table} 失败：${r.message}`);
        snapshots.push({ table, rows: r.data });
      }
    } catch (e) {
      if (isAbortError(e) || opts?.signal?.aborted) {
        return {
          ok: false,
          reason: 'aborted',
          message: '从云同步已中止',
          diagnosticText: serializeErrorForDiagnostic(e),
        };
      }
      const msg = e instanceof Error ? e.message : String(e);
      return {
        ok: false,
        reason: 'fetch_failed',
        message: msg,
        diagnosticText: [msg, '', serializeErrorForDiagnostic(e)].join('\n'),
      };
    }

    let sqliteRows = 0;
    let sqliteTables = 0;

    report({ phase: 'applying' });
    try {
      throwIfAborted(opts?.signal);
      await db.execAsync('PRAGMA foreign_keys = OFF');
      await db.execAsync('BEGIN IMMEDIATE');
      try {
        for (const snap of snapshots) {
          throwIfAborted(opts?.signal);
          if (!localSet.has(snap.table)) {
            const createSql =
              (await getLocalCreateTableSql(snap.table)) ??
              (await getCloudCreateTableSql(snap.table, opts?.signal));
            if (!createSql) {
              warnings.push(`云端表 ${snap.table} 在本机无法建表，已跳过`);
              continue;
            }
            await db.execAsync(createSql);
            localSet.add(snap.table);
          }
          sqliteRows += await applyCloudRowsToLocalTable(snap.table, snap.rows, opts?.signal);
          sqliteTables += 1;
        }
        const fkViolations = await db.getAllAsync<{ table: string; rowid: number }>(
          'PRAGMA foreign_key_check',
        );
        if (fkViolations.length > 0) {
          throw new Error(`外键检查失败（${fkViolations.length} 条）`);
        }
        await db.execAsync('COMMIT');
      } catch (inner) {
        try {
          await db.execAsync('ROLLBACK');
        } catch {
          /* ignore */
        }
        throw inner;
      }
    } catch (e) {
      if (isAbortError(e) || opts?.signal?.aborted) {
        return {
          ok: false,
          reason: 'aborted',
          message: '写入本地数据库时已中止',
          diagnosticText: serializeErrorForDiagnostic(e),
        };
      }
      const msg = e instanceof Error ? e.message : String(e);
      return {
        ok: false,
        reason: 'apply_failed',
        message: `写入 SQLite 失败：${msg}`,
        diagnosticText: [msg, '', serializeErrorForDiagnostic(e)].join('\n'),
      };
    } finally {
      try {
        await db.execAsync('PRAGMA foreign_keys = ON');
      } catch {
        /* ignore */
      }
    }

    try {
      await initDatabase();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        ok: false,
        reason: 'apply_failed',
        message: `同步后数据库迁移失败：${msg}`,
        diagnosticText: [msg, '', serializeErrorForDiagnostic(e)].join('\n'),
      };
    }

    const cloudLastUpdated = new Date().toISOString();
    await setLastFullCloudBackupAtIso(cloudLastUpdated);
    await setLastCloudAlignAtIso(cloudLastUpdated);

    return {
      ok: true,
      cloudLastUpdated,
      sqliteTables,
      sqliteRows,
      warnings,
      tablesNotInBackup,
    };
  } finally {
    endCloudSqliteDirtyIgnoreBatch();
    setSilentCloudRestoreInFlight(false);
  }
}

/** 脏表增量：将本地变更表推送到云端 */
export async function pushCloudDirtyTablesIfNeeded(): Promise<void> {
  if (isSilentCloudRestoreInFlight()) {
    scheduleCloudTablePushDebounced();
    return;
  }

  const dirtyList = peekCloudSqliteDirtyTables();
  if (dirtyList.length === 0) return;

  const token = await getCloudAuthToken();
  if (!token) return;

  const db = await getDatabase();
  if (!db) return;

  const pushed = new Set<string>();
  for (const table of dirtyList) {
    try {
      await pushLocalTableToCloud(table);
      pushed.add(table);
    } catch (e) {
      if (__DEV__) console.warn(`[cloud incremental] 表 ${table} 推送失败`, e);
    }
  }

  if (pushed.size > 0) {
    clearCloudSqliteDirtyTables(pushed);
    await setLastCloudAlignAtIso(new Date().toISOString());
  } else {
    scheduleCloudTablePushDebounced();
  }
}

/** 每 4 小时对齐：将全部本地表推送到云端 */
export async function alignAllLocalTablesToCloud(opts?: { signal?: AbortSignal }): Promise<void> {
  const token = await getCloudAuthToken();
  if (!token) return;

  const db = await getDatabase();
  if (!db) return;

  if (isSilentCloudRestoreInFlight()) return;

  try {
    const tables = await listLocalUserTables();
    for (const table of tables) {
      throwIfAborted(opts?.signal);
      await pushLocalTableToCloud(table, { signal: opts?.signal });
    }
    const iso = new Date().toISOString();
    await setLastCloudAlignAtIso(iso);
    clearAllCloudSqliteDirtyTables();
  } catch (e) {
    if (__DEV__) console.warn('[cloud align]', e);
  }
}
