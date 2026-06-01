import { setLastApiFullUploadAtIso } from '@/lib/api-backup-meta';

import { apiLogin } from '@/lib/api-client';

import { REST_SKIP_TABLES } from '@/lib/api-incremental-sync';

import {

  ApiRowUploadSkippedError,

  rowPrimaryKeyValue,

  upsertProjectCategoriesReferencedByProjects,

  upsertFinanceAccountsReferencedByTransactions,

  upsertMemoDimensionsReferencedByMemos,

  upsertHabitsReferencedByCheckIns,

  upsertProjectsReferencedByTasks,

  upsertRowToApi,

  upsertTaskCategoriesReferencedByTasks,

} from '@/lib/api-row-upsert';

import { getApiBaseUrl } from '@/lib/api-config';

import {

  beginCloudSqliteDirtyIgnoreBatch,

  endCloudSqliteDirtyIgnoreBatch,

} from '@/lib/cloud-sql-dirty-track';

import { isAbortError, throwIfAborted } from '@/lib/cloud-fetch-retry';

import {

  collectLocalTablesDataForUpload,

  ensureProjectCategoryRefsForApiUpload,

  ensureFinanceAccountRefsForApiUpload,

  ensureMemoDimensionRefsForApiUpload,

  ensureTaskCategoryMirrorForApiUpload,

  listLocalUserTablesForApiUpload,

  prepareLocalRowsForUpload,

  serializeErrorForDiagnostic,

  sortProjectCategoriesForApiUpload,

  type CloudSyncProgress,

} from '@/lib/cloud-sql-sync';

import {

  applyMysqlIdRemapToUploadBundle,

  buildMysqlIdRemapForUpload,

} from '@/lib/api-mysql-id';

import { getDatabase } from '@/lib/database';

import { dedupeRowsByPrimaryKey, readTablePrimaryKeyColumns } from '@/lib/sqlite-primary-key-dedupe';



function quoteIdent(name: string): string {

  return `"${name.replace(/"/g, '""')}"`;

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



export type ApiMigrationResult =

  | {

      ok: true;

      tableCount: number;

      rowCount: number;

      createdCount: number;

      updatedCount: number;

      skippedCount: number;

      skipWarnings: string[];

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



/** @deprecated 一次性全量上传，已由增量同步取代 */

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



  const pkColsByTable = new Map<string, string[]>();

  for (const table of insertOrder) {

    pkColsByTable.set(table, await readTablePrimaryKeyColumns(db, table));

  }

  const idRemap = buildMysqlIdRemapForUpload(rowsByTable, pkColsByTable);

  applyMysqlIdRemapToUploadBundle(rowsByTable, idRemap);
  if (idRemap.size > 0) {
    const { applyEntityIdRemapToLocalDatabase } = await import('@/lib/entity-id-migrate');
    await applyEntityIdRemapToLocalDatabase(idRemap);
  }

  ensureProjectCategoryRefsForApiUpload(rowsByTable);

  ensureTaskCategoryMirrorForApiUpload(rowsByTable);

  await ensureFinanceAccountRefsForApiUpload(rowsByTable);

  await ensureMemoDimensionRefsForApiUpload(rowsByTable);



  let rowCount = 0;

  let createdCount = 0;

  let updatedCount = 0;

  let skippedCount = 0;

  const skipWarnings: string[] = [];

  const total = insertOrder.length;

  const uploadedPkByTable = new Map<string, Set<string>>();

  const fkRefsByTable = new Map<string, Awaited<ReturnType<typeof import('@/lib/cloud-sql-sync').readLocalForeignKeyRefs>>>();

  for (const table of insertOrder) {

    const { readLocalForeignKeyRefs } = await import('@/lib/cloud-sql-sync');

    fkRefsByTable.set(table, await readLocalForeignKeyRefs(table));

  }



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

      const pkCols = pkColsByTable.get(table) ?? (await readTablePrimaryKeyColumns(db, table));

      let rows = dedupeRowsByPrimaryKey(prepared, pkCols);

      if (table === 'project_categories') {

        rows = sortProjectCategoriesForApiUpload(rows);

      }

      const uploadedRows: Record<string, unknown>[] = [];

      const uploadedPks = uploadedPkByTable.get(table) ?? new Set<string>();

      uploadedPkByTable.set(table, uploadedPks);



      if (table === 'projects') {

        await upsertProjectCategoriesReferencedByProjects(

          rows,

          rowsByTable,

          pkColsByTable,

          uploadedPkByTable,

          fkRefsByTable,

          opts?.signal,

        );

      }



      if (table === 'memos') {

        await upsertMemoDimensionsReferencedByMemos(

          rows,

          rowsByTable,

          pkColsByTable,

          uploadedPkByTable,

          fkRefsByTable,

          opts?.signal,

        );

      }



      if (table === 'finance_transactions') {

        await upsertFinanceAccountsReferencedByTransactions(

          rows,

          rowsByTable,

          pkColsByTable,

          uploadedPkByTable,

          fkRefsByTable,

          opts?.signal,

        );

      }



      if (table === 'tasks') {

        await upsertTaskCategoriesReferencedByTasks(

          rows,

          rowsByTable,

          pkColsByTable,

          uploadedPkByTable,

          fkRefsByTable,

          opts?.signal,

        );

        await upsertProjectsReferencedByTasks(

          rows,

          rowsByTable,

          pkColsByTable,

          uploadedPkByTable,

          fkRefsByTable,

          opts?.signal,

        );

      }



      if (table === 'habit_check_ins') {

        await upsertHabitsReferencedByCheckIns(

          rows,

          rowsByTable,

          pkColsByTable,

          uploadedPkByTable,

          fkRefsByTable,

          opts?.signal,

        );

      }



      for (const row of rows) {

        throwIfAborted(opts?.signal);

        try {

          const action = await upsertRowToApi(table, row, pkCols, {

            signal: opts?.signal,

            uploadedPkByTable,

            fkRefs: fkRefsByTable.get(table) ?? [],

            rowsByTable,

            pkColsByTable,

            fkRefsByTable,

          });

          if (action === 'created') createdCount += 1;

          else updatedCount += 1;

          rowCount += 1;

          uploadedRows.push(row);

          const pk = rowPrimaryKeyValue(row, pkCols);

          if (pk) uploadedPks.add(pk);

        } catch (e) {

          if (e instanceof ApiRowUploadSkippedError) {

            skippedCount += 1;

            const pk = rowPrimaryKeyValue(row, pkCols);

            const line = `[跳过] ${table}${pk ? ` id=${pk}` : ''}：${e.message}`;

            skipWarnings.push(line);

            if (__DEV__) console.warn('[api-upload]', line);

            continue;

          }

          throw e;

        }

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

    skippedCount,

    skipWarnings,

    lastUpdated,

  };

}



export { ApiRowUploadSkippedError } from '@/lib/api-row-upsert';

