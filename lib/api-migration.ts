import { setLastApiFullUploadAtIso } from '@/lib/api-backup-meta';
import { apiCreateRecord, apiLogin, apiUpdateRecord, ApiRequestError } from '@/lib/api-client';
import { getApiBaseUrl } from '@/lib/api-config';
import {
  beginCloudSqliteDirtyIgnoreBatch,
  endCloudSqliteDirtyIgnoreBatch,
} from '@/lib/cloud-sql-dirty-track';
import { isAbortError, throwIfAborted } from '@/lib/cloud-fetch-retry';
import {
  collectLocalTablesDataForUpload,
  listLocalUserTablesForApiUpload,
  prepareLocalRowsForUpload,
  serializeErrorForDiagnostic,
  type CloudSyncProgress,
} from '@/lib/cloud-sql-sync';
import { getDatabase } from '@/lib/database';
import { dedupeRowsByPrimaryKey, readTablePrimaryKeyColumns } from '@/lib/sqlite-primary-key-dedupe';

const REST_SKIP_TABLES = new Set(['admin_users']);

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function rowPrimaryKeyValue(row: Record<string, unknown>, pkCols: string[]): string | null {
  if (pkCols.length === 0) {
    const id = row.id;
    return id == null || id === '' ? null : String(id);
  }
  const parts = pkCols.map(col => row[col]);
  if (parts.some(v => v == null || v === '')) return null;
  return String(parts[0]);
}

async function tableHasSyncStatusColumn(table: string): Promise<boolean> {
  const db = await getDatabase();
  if (!db) return false;
  const cols = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${quoteIdent(table)})`);
  return cols.some(c => c.name === 'sync_status');
}

async function markLocalRowsSynced(table: string, pkCols: string[], rows: Record<string, unknown>[]): Promise<void> {
  if (rows.length === 0) return;
  if (!(await tableHasSyncStatusColumn(table))) return;

  const db = await getDatabase();
  if (!db) return;

  const pkCol = pkCols[0] ?? 'id';
  beginCloudSqliteDirtyIgnoreBatch();
  try {
    for (const row of rows) {
      const pk = rowPrimaryKeyValue(row, pkCols);
      if (!pk) continue;
      await db.runAsync(
        `UPDATE ${quoteIdent(table)} SET sync_status = 'synced' WHERE ${quoteIdent(pkCol)} = ?`,
        [pk],
      );
    }
  } finally {
    endCloudSqliteDirtyIgnoreBatch();
  }
}

async function upsertRowToApi(
  table: string,
  row: Record<string, unknown>,
  pkCols: string[],
  signal?: AbortSignal,
): Promise<'created' | 'updated'> {
  const pk = rowPrimaryKeyValue(row, pkCols);

  try {
    await apiCreateRecord(table, row, { signal });
    return 'created';
  } catch (e) {
    if (e instanceof ApiRequestError && (e.httpStatus === 409 || /已存在|duplicate|冲突/i.test(e.message))) {
      if (!pk) throw e;
      await apiUpdateRecord(table, pk, row, { signal });
      return 'updated';
    }
    throw e;
  }
}

export type ApiMigrationResult =
  | {
      ok: true;
      tableCount: number;
      rowCount: number;
      createdCount: number;
      updatedCount: number;
      lastUpdated: string;
    }
  | {
      ok: false;
      reason:
        | 'no_config'
        | 'collect_failed'
        | 'login_failed'
        | 'upload_failed'
        | 'aborted'
        | 'unsupported_platform';
      message: string;
      diagnosticText: string;
    };

async function yieldToUi(): Promise<void> {
  await new Promise<void>(resolve => setTimeout(resolve, 0));
}

function enrichLoginNetworkErrorMessage(msg: string, baseUrl: string): string {
  if (!/network request failed|failed to fetch/i.test(msg)) return msg;
  const hints: string[] = ['请确认手机能访问互联网且服务器地址正确'];
  if (/^http:\/\//i.test(baseUrl)) {
    hints.push('当前为 HTTP 地址：若刚更新应用，需重新安装/构建原生包以启用明文网络');
  }
  return `${msg}（${hints.join('；')}）`;
}

/** 将本地 SQLite 全量上传到 REST 后端（保留本地 id 与外键关系） */
export async function triggerApiFullUpload(opts?: {
  signal?: AbortSignal;
  onProgress?: (p: CloudSyncProgress) => void;
}): Promise<ApiMigrationResult> {
  const report = (p: CloudSyncProgress) => opts?.onProgress?.(p);

  const dbProbe = await getDatabase();
  if (!dbProbe) {
    const message = '当前环境无本地 SQLite（例如 Web），无法执行服务器上传。';
    return { ok: false, reason: 'unsupported_platform', message, diagnosticText: message };
  }

  report({ phase: 'preparing' });

  try {
    await apiLogin({ signal: opts?.signal });
  } catch (e) {
    const baseUrl = await getApiBaseUrl();
    const raw = e instanceof Error ? e.message : String(e);
    const msg = enrichLoginNetworkErrorMessage(raw, baseUrl);
    const message = `登录服务器失败：${msg}`;
    return {
      ok: false,
      reason: 'login_failed',
      message,
      diagnosticText: [message, `服务器：${baseUrl}`, '', serializeErrorForDiagnostic(e)].join('\n'),
    };
  }

  let insertOrder: string[];
  let rowsByTable: Map<string, Record<string, unknown>[]>;
  try {
    report({ phase: 'collecting' });
    const tables = (await listLocalUserTablesForApiUpload()).filter(t => !REST_SKIP_TABLES.has(t));
    const bundle = await collectLocalTablesDataForUpload(tables, {
      signal: opts?.signal,
      onProgress: report,
    });
    insertOrder = bundle.insertOrder.filter(t => !REST_SKIP_TABLES.has(t));
    rowsByTable = bundle.rowsByTable;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const message = `读取本地数据失败：${msg}`;
    return {
      ok: false,
      reason: 'collect_failed',
      message,
      diagnosticText: [message, '', serializeErrorForDiagnostic(e)].join('\n'),
    };
  }

  const db = await getDatabase();
  if (!db) {
    const message = '当前环境无本地 SQLite（例如 Web），无法执行服务器上传。';
    return { ok: false, reason: 'unsupported_platform', message, diagnosticText: message };
  }

  let rowCount = 0;
  let createdCount = 0;
  let updatedCount = 0;
  const total = insertOrder.length;

  try {
    for (let i = 0; i < insertOrder.length; i++) {
      const table = insertOrder[i]!;
      throwIfAborted(opts?.signal);
      report({
        phase: 'uploading',
        tableIndex: i + 1,
        tableCount: total,
        tableLabel: table,
      });
      await yieldToUi();

      const rawRows = rowsByTable.get(table) ?? [];
      const prepared = await prepareLocalRowsForUpload(table, rawRows, rowsByTable);
      const pkCols = await readTablePrimaryKeyColumns(db, table);
      const rows = dedupeRowsByPrimaryKey(prepared, pkCols);
      const uploadedRows: Record<string, unknown>[] = [];

      for (const row of rows) {
        throwIfAborted(opts?.signal);
        const action = await upsertRowToApi(table, row, pkCols, opts?.signal);
        if (action === 'created') createdCount += 1;
        else updatedCount += 1;
        rowCount += 1;
        uploadedRows.push(row);
      }

      await markLocalRowsSynced(table, pkCols, uploadedRows);
    }
  } catch (e) {
    if (isAbortError(e) || opts?.signal?.aborted) {
      const message = '服务器上传已中止';
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

  const lastUpdated = new Date().toISOString();
  await setLastApiFullUploadAtIso(lastUpdated);

  return {
    ok: true,
    tableCount: insertOrder.length,
    rowCount,
    createdCount,
    updatedCount,
    lastUpdated,
  };
}
