import { ensureApiLoggedIn } from '@/lib/api-client';
import { withApiLoading } from '@/lib/api-loading-tracker';
import { fetchApiTableAll } from '@/lib/api-read';
import { syncApiReadResultToLocal } from '@/lib/api-read-local-sync';
import {
  beginCloudSqliteDirtyIgnoreBatch,
  endCloudSqliteDirtyIgnoreBatch,
} from '@/lib/cloud-sql-dirty-track';
import { isAbortError, throwIfAborted } from '@/lib/cloud-fetch-retry';
import { resolveApiPushInsertOrder } from '@/lib/cloud-sql-sync';
import { listPageScopeTables } from '@/lib/page-api-scope';

export { listAllTabPageKeys, listPageScopeTables } from '@/lib/page-api-scope';

async function resolvePageTableOrder(tables: string[]): Promise<string[]> {
  if (tables.length <= 1) return tables;
  try {
    return await resolveApiPushInsertOrder(tables);
  } catch (e) {
    console.warn('[api-page-sync] 外键排序失败，使用默认表序', e);
    return [...tables].sort();
  }
}

/**
 * 页面首次访问：按页面范围从 REST 全量拉取并覆盖本地 SQLite。
 */
export async function syncPageScopeFromApi(
  pageKey: string,
  opts?: { signal?: AbortSignal },
): Promise<{ ok: boolean; tablesSynced: number; error?: string }> {
  const tables = listPageScopeTables(pageKey);
  if (tables.length === 0) {
    return { ok: true, tablesSynced: 0 };
  }

  const ordered = await resolvePageTableOrder(tables);

  beginCloudSqliteDirtyIgnoreBatch();
  try {
    throwIfAborted(opts?.signal);
    try {
      await withApiLoading(async () => {
        await ensureApiLoggedIn({ signal: opts?.signal });

        for (const table of ordered) {
          throwIfAborted(opts?.signal);
          const rows = await fetchApiTableAll<Record<string, unknown>>(table, {
            signal: opts?.signal,
            forceRefresh: true,
          });
          await syncApiReadResultToLocal(table, rows, { reconcileSnapshot: true });
        }
      });
    } catch (e) {
      if (isAbortError(e) || opts?.signal?.aborted) {
        return { ok: false, tablesSynced: 0, error: '同步已取消' };
      }
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[api-page-sync] 页面 ${pageKey} 同步失败`, e);
      return { ok: false, tablesSynced: 0, error: msg };
    }

    return { ok: true, tablesSynced: ordered.length };
  } finally {
    endCloudSqliteDirtyIgnoreBatch();
  }
}
