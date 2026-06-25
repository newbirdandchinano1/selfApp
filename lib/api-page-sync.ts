import { apiGetTasksBootstrap, ensureApiLoggedIn, type TasksBootstrapPayload } from '@/lib/api-client';
import { withApiLoading } from '@/lib/api-loading-tracker';
import { fetchApiTableAll, withApiTableSyncLock } from '@/lib/api-read';
import { syncApiReadResultToLocal } from '@/lib/api-read-local-sync';
import {
  beginCloudSqliteDirtyIgnoreBatch,
  endCloudSqliteDirtyIgnoreBatch,
} from '@/lib/cloud-sql-dirty-track';
import { isAbortError, throwIfAborted } from '@/lib/cloud-fetch-retry';
import { resolveApiPushInsertOrder } from '@/lib/cloud-sql-sync';
import { listPageScopeTables } from '@/lib/page-api-scope';
import { loadTasksDayBoundary } from '@/lib/tasks-logical-day';

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

const TASKS_BOOTSTRAP_TABLE_MAP: [keyof TasksBootstrapPayload, string][] = [
  ['projects', 'projects'],
  ['projectCategories', 'project_categories'],
  ['tasks', 'tasks'],
  ['taskCategories', 'task_categories'],
  ['taskItems', 'task_items'],
  ['habits', 'habits'],
  ['habitContexts', 'habit_contexts'],
  ['habitCheckIns', 'habit_check_ins'],
  ['taskExecutionEvents', 'task_execution_events'],
  ['frogCompletionEvents', 'frog_completion_events'],
];

type BootstrapTablesVersionMeta = Record<string, { count?: number } | undefined>;

function readBootstrapExpectedRowCount(
  meta: BootstrapTablesVersionMeta | undefined,
  tableName: string,
): number | undefined {
  const entry = meta?.[tableName];
  const count = entry?.count;
  return typeof count === 'number' && Number.isFinite(count) && count >= 0 ? count : undefined;
}

async function syncTasksPageBootstrapFromApi(opts?: { signal?: AbortSignal }): Promise<number> {
  throwIfAborted(opts?.signal);
  const boundary = await loadTasksDayBoundary();
  throwIfAborted(opts?.signal);
  const payload = await apiGetTasksBootstrap({
    dayBoundaryHour: boundary.hour,
    dayBoundaryMinute: boundary.minute,
    signal: opts?.signal,
  });

  const tablesVersion = (payload?.meta as { tablesVersion?: BootstrapTablesVersionMeta } | undefined)
    ?.tablesVersion;

  let tablesSynced = 0;
  for (const [responseKey, tableName] of TASKS_BOOTSTRAP_TABLE_MAP) {
    throwIfAborted(opts?.signal);
    const rows = payload?.[responseKey];
    if (!Array.isArray(rows)) continue;

    await withApiTableSyncLock(tableName, async () => {
      const expectedCount = readBootstrapExpectedRowCount(tablesVersion, tableName);
      if (expectedCount != null && rows.length < expectedCount) {
        console.warn(
          `[api-page-sync] bootstrap 表「${tableName}」行数不足（${rows.length}/${expectedCount}），降级逐表分页拉取`,
        );
        await fetchApiTableAll<Record<string, unknown>>(tableName, {
          signal: opts?.signal,
          forceRefresh: true,
        });
        return;
      }
      await syncApiReadResultToLocal(tableName, rows, { reconcileSnapshot: true });
    });
    tablesSynced += 1;
  }
  return tablesSynced;
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
      const tablesSynced = await withApiLoading(async () => {
        await ensureApiLoggedIn({ signal: opts?.signal });

        if (pageKey === 'tabs/tasks') {
          try {
            return await syncTasksPageBootstrapFromApi({ signal: opts?.signal });
          } catch (e) {
            if (isAbortError(e) || opts?.signal?.aborted) throw e;
            console.warn('[api-page-sync] 任务页 bootstrap 同步失败，降级为逐表 List', e);
          }
        }

        for (const table of ordered) {
          throwIfAborted(opts?.signal);
          await fetchApiTableAll<Record<string, unknown>>(table, {
            signal: opts?.signal,
            forceRefresh: true,
          });
        }
        return ordered.length;
      });
      return { ok: true, tablesSynced };
    } catch (e) {
      if (isAbortError(e) || opts?.signal?.aborted) {
        return { ok: false, tablesSynced: 0, error: '同步已取消' };
      }
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[api-page-sync] 页面 ${pageKey} 同步失败`, e);
      return { ok: false, tablesSynced: 0, error: msg };
    }
  } finally {
    endCloudSqliteDirtyIgnoreBatch();
  }
}
