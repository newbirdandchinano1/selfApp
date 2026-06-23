import { Platform } from 'react-native';

import { API_ALLOWED_TABLES, isApiReadableTable } from '@/lib/api-allowed-tables';
import { ensureApiLoggedIn } from '@/lib/api-client';
import { REST_SKIP_TABLES } from '@/lib/api-incremental-sync';
import {
  PREFER_LOCAL_READS_META_KEY,
  REST_INITIAL_SYNC_META_KEY,
  localDbHasUserData,
  readAppMeta,
  writeAppMeta,
} from '@/lib/api-local-bootstrap';
import { fetchApiTableAll } from '@/lib/api-read';
import { syncApiReadResultToLocal } from '@/lib/api-read-local-sync';
import {
  beginCloudSqliteDirtyIgnoreBatch,
  endCloudSqliteDirtyIgnoreBatch,
} from '@/lib/cloud-sql-dirty-track';
import { isAbortError, throwIfAborted } from '@/lib/cloud-fetch-retry';
import { resolveApiPushInsertOrder } from '@/lib/cloud-sql-sync';
import { getDatabase } from '@/lib/database';
import { enablePreferLocalReads } from '@/lib/page-api-session';

export { REST_INITIAL_SYNC_META_KEY, PREFER_LOCAL_READS_META_KEY } from '@/lib/api-local-bootstrap';

export type InitialSyncProgress = {
  phase: 'preparing' | 'syncing' | 'done';
  tableIndex: number;
  tableCount: number;
  tableLabel?: string;
};

export type InitialSyncResult = {
  ran: boolean;
  ok: boolean;
  skippedReason?: 'web' | 'already_done' | 'has_local_data';
  tablesSynced?: number;
  error?: string;
};

async function yieldToUi(): Promise<void> {
  await new Promise<void>(resolve => setTimeout(resolve, 0));
}

export async function hasCompletedInitialRestSync(): Promise<boolean> {
  return (await readAppMeta(REST_INITIAL_SYNC_META_KEY)) === '1';
}

function listRestSyncTables(): string[] {
  return [...API_ALLOWED_TABLES].filter(
    table => isApiReadableTable(table) && !REST_SKIP_TABLES.has(table) && table !== 'admin_users',
  );
}

async function resolveRestSyncTableOrder(): Promise<string[]> {
  const seeds = listRestSyncTables();
  try {
    return await resolveApiPushInsertOrder(seeds);
  } catch (e) {
    console.warn('[api-initial-sync] 外键排序失败，使用默认表序', e);
    return seeds.sort();
  }
}

async function markInitialSyncCompleted(): Promise<void> {
  await writeAppMeta(REST_INITIAL_SYNC_META_KEY, '1');
  await writeAppMeta(PREFER_LOCAL_READS_META_KEY, '1');
  enablePreferLocalReads();
}

/**
 * 首启全量同步：REST 全表拉取 → 覆盖本地 SQLite。
 * 已有本地数据的升级用户、或已完成同步的用户会跳过。
 */
export async function runInitialRestSyncIfNeeded(opts?: {
  signal?: AbortSignal;
  onProgress?: (progress: InitialSyncProgress) => void;
}): Promise<InitialSyncResult> {
  const report = (progress: InitialSyncProgress) => opts?.onProgress?.(progress);

  if (Platform.OS === 'web') {
    report({ phase: 'done', tableIndex: 0, tableCount: 0 });
    return { ran: false, ok: true, skippedReason: 'web' };
  }

  const db = await getDatabase();
  if (!db) {
    report({ phase: 'done', tableIndex: 0, tableCount: 0 });
    return { ran: false, ok: true, skippedReason: 'web' };
  }

  report({ phase: 'preparing', tableIndex: 0, tableCount: 0 });

  if (await hasCompletedInitialRestSync()) {
    enablePreferLocalReads();
    report({ phase: 'done', tableIndex: 0, tableCount: 0 });
    return { ran: false, ok: true, skippedReason: 'already_done' };
  }

  if (await localDbHasUserData()) {
    await markInitialSyncCompleted();
    report({ phase: 'done', tableIndex: 0, tableCount: 0 });
    return { ran: false, ok: true, skippedReason: 'has_local_data' };
  }

  const tables = await resolveRestSyncTableOrder();
  const tableCount = tables.length;

  beginCloudSqliteDirtyIgnoreBatch();
  try {
    throwIfAborted(opts?.signal);
    await ensureApiLoggedIn({ signal: opts?.signal });

    for (let i = 0; i < tables.length; i += 1) {
      throwIfAborted(opts?.signal);
      const table = tables[i]!;
      report({
        phase: 'syncing',
        tableIndex: i + 1,
        tableCount,
        tableLabel: table,
      });
      await yieldToUi();

      try {
        const rows = await fetchApiTableAll<Record<string, unknown>>(table, {
          signal: opts?.signal,
          forceRefresh: true,
        });
        await syncApiReadResultToLocal(table, rows, { reconcileSnapshot: true });
      } catch (e) {
        if (isAbortError(e) || opts?.signal?.aborted) {
          return { ran: true, ok: false, error: '同步已取消' };
        }
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[api-initial-sync] 表 ${table} 同步失败`, e);
        return { ran: true, ok: false, error: `同步表「${table}」失败：${msg}` };
      }
    }

    await markInitialSyncCompleted();
    report({ phase: 'done', tableIndex: tableCount, tableCount });
    return { ran: true, ok: true, tablesSynced: tableCount };
  } finally {
    endCloudSqliteDirtyIgnoreBatch();
  }
}
