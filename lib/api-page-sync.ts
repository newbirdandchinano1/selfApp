import {

  apiGetTasksBootstrap,

  apiGetTasksBootstrapSummary,

  ensureApiLoggedIn,

  type TasksBootstrapPayload,

  type TasksBootstrapSummaryMeta,

} from '@/lib/api-client';

import { readAppMeta, writeAppMeta } from '@/lib/api-local-bootstrap';

import { withApiLoading } from '@/lib/api-loading-tracker';

import { fetchApiTableAll, type ApiListOptions, withApiTableSyncLock } from '@/lib/api-read';

import { syncApiReadResultToLocal } from '@/lib/api-read-local-sync';

import {

  beginCloudSqliteDirtyIgnoreBatch,

  endCloudSqliteDirtyIgnoreBatch,

} from '@/lib/cloud-sql-dirty-track';

import { isAbortError, throwIfAborted } from '@/lib/cloud-fetch-retry';

import { resolveApiPushInsertOrder } from '@/lib/cloud-sql-sync';

import { listPageScopeTables, TAB_PAGE_KEYS } from '@/lib/page-api-scope';

import { loadTasksDayBoundary } from '@/lib/tasks-logical-day';



export { listAllTabPageKeys, listPageScopeTables } from '@/lib/page-api-scope';



const TASKS_BOOTSTRAP_VERSIONS_META_KEY = 'tasks_bootstrap_table_versions_v1';

/** 单页首次 REST 同步上限，避免后端不可用时骨架屏长时间阻塞 */
const PAGE_SYNC_TIMEOUT_MS = 20_000;

function mergeAbortSignals(...signals: (AbortSignal | undefined)[]): AbortSignal {
  const controller = new AbortController();
  for (const source of signals) {
    if (!source) continue;
    if (source.aborted) {
      controller.abort();
      return controller.signal;
    }
    source.addEventListener('abort', () => controller.abort(), { once: true });
  }
  return controller.signal;
}



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

  ['habits', 'habits'],

  ['habitContexts', 'habit_contexts'],

  ['habitCheckIns', 'habit_check_ins'],

  ['taskExecutionEvents', 'task_execution_events'],

  ['frogCompletionEvents', 'frog_completion_events'],

  ['weeklyTaskScheduleSlots', 'weekly_task_schedule_slots'],

  ['weeklyTaskScheduleCells', 'weekly_task_schedule_cells'],

];



export async function clearTasksBootstrapVersionCache(): Promise<void> {

  await writeAppMeta(TASKS_BOOTSTRAP_VERSIONS_META_KEY, '{}');

}



type BootstrapTablesVersionMeta = Record<string, { count?: number } | undefined>;



function readBootstrapExpectedRowCount(

  meta: BootstrapTablesVersionMeta | undefined,

  tableName: string,

): number | undefined {

  const entry = meta?.[tableName];

  const count = entry?.count;

  return typeof count === 'number' && Number.isFinite(count) && count >= 0 ? count : undefined;

}



async function readTasksBootstrapVersionCache(): Promise<Record<string, string | null>> {

  const raw = await readAppMeta(TASKS_BOOTSTRAP_VERSIONS_META_KEY);

  if (!raw) return {};

  try {

    const parsed = JSON.parse(raw) as Record<string, string | null>;

    return parsed && typeof parsed === 'object' ? parsed : {};

  } catch {

    return {};

  }

}



async function writeTasksBootstrapVersionCache(

  tableName: string,

  version: string | null,

): Promise<void> {

  const cache = await readTasksBootstrapVersionCache();

  cache[tableName] = version;

  await writeAppMeta(TASKS_BOOTSTRAP_VERSIONS_META_KEY, JSON.stringify(cache));

}



function buildTasksBootstrapListOpts(

  tableName: string,

  meta: TasksBootstrapSummaryMeta,

): Pick<

  ApiListOptions,

  | 'startDate'

  | 'endDate'

  | 'createdAtGte'

  | 'createdAtLte'

  | 'assignedYmdGte'

  | 'assignedYmdLte'

> {

  switch (tableName) {

    case 'habit_check_ins':

      return {

        startDate: meta.habitCheckInStart,

        endDate: meta.habitCheckInEnd,

      };

    case 'task_execution_events':

      return {

        createdAtGte: meta.heatmapStart,

        createdAtLte: meta.heatmapEnd,

      };

    case 'frog_completion_events':

      return {

        assignedYmdGte: meta.heatmapStart,

        assignedYmdLte: meta.heatmapEnd,

      };

    default:

      return {};

  }

}



async function syncTasksPageViaSummary(

  boundary: { hour: number; minute: number },

  opts?: { signal?: AbortSignal },

): Promise<number> {

  const summary = await apiGetTasksBootstrapSummary({

    dayBoundaryHour: boundary.hour,

    dayBoundaryMinute: boundary.minute,

    signal: opts?.signal,

  });



  const versionCache = await readTasksBootstrapVersionCache();

  let tablesSynced = 0;



  for (const [, tableName] of TASKS_BOOTSTRAP_TABLE_MAP) {

    throwIfAborted(opts?.signal);

    const tableSummary = summary.tables?.[tableName];

    const expectedCount =

      typeof tableSummary?.count === 'number' && Number.isFinite(tableSummary.count) && tableSummary.count >= 0

        ? tableSummary.count

        : undefined;

    const version = tableSummary?.version ?? null;



    if (expectedCount == null) {

      console.warn(`[api-page-sync] summary 表「${tableName}」缺少 count，降级逐表分页拉取`);

      await fetchApiTableAll<Record<string, unknown>>(tableName, {

        ...buildTasksBootstrapListOpts(tableName, summary.meta ?? {}),

        signal: opts?.signal,

        forceRefresh: true,

      });

      tablesSynced += 1;

      continue;

    }



    const cachedVersion = versionCache[tableName];

    if (version != null && cachedVersion === version) {

      tablesSynced += 1;

      continue;

    }



    await fetchApiTableAll<Record<string, unknown>>(tableName, {

      ...buildTasksBootstrapListOpts(tableName, summary.meta ?? {}),

      signal: opts?.signal,

      forceRefresh: true,

      expectedTotal: expectedCount,

    });

    await writeTasksBootstrapVersionCache(tableName, version);

    tablesSynced += 1;

  }



  return tablesSynced;

}



async function syncTasksPageLegacyBootstrapFromApi(

  boundary: { hour: number; minute: number },

  opts?: { signal?: AbortSignal },

): Promise<number> {

  const payload = await apiGetTasksBootstrap({

    dayBoundaryHour: boundary.hour,

    dayBoundaryMinute: boundary.minute,

    signal: opts?.signal,

  });



  const tablesVersion = (payload?.meta as { tablesVersion?: BootstrapTablesVersionMeta } | undefined)

    ?.tablesVersion;



  const hasTablesVersionMeta = tablesVersion != null && typeof tablesVersion === 'object'

    && TASKS_BOOTSTRAP_TABLE_MAP.some(([, t]) => tablesVersion[t]?.count != null);



  if (!hasTablesVersionMeta) {

    console.warn(

      `[api-page-sync] 旧版 bootstrap 缺少 tablesVersion 元数据，降级为逐表分页拉取`,

    );

    let fallbackSynced = 0;

    for (const [, tableName] of TASKS_BOOTSTRAP_TABLE_MAP) {

      throwIfAborted(opts?.signal);

      await fetchApiTableAll<Record<string, unknown>>(tableName, {

        signal: opts?.signal,

        forceRefresh: true,

      });

      fallbackSynced += 1;

    }

    return fallbackSynced;

  }



  let tablesSynced = 0;

  for (const [responseKey, tableName] of TASKS_BOOTSTRAP_TABLE_MAP) {

    throwIfAborted(opts?.signal);

    const rows = payload?.[responseKey];

    if (!Array.isArray(rows)) continue;



    await withApiTableSyncLock(tableName, async () => {

      const expectedCount = readBootstrapExpectedRowCount(tablesVersion, tableName);

      if (expectedCount != null && rows.length < expectedCount) {

        console.warn(

          `[api-page-sync] 旧版 bootstrap 表「${tableName}」行数不足（${rows.length}/${expectedCount}），降级逐表分页拉取`,

        );

        await fetchApiTableAll<Record<string, unknown>>(tableName, {

          signal: opts?.signal,

          forceRefresh: true,

        });

        return;

      }

      if (expectedCount == null) {

        console.warn(

          `[api-page-sync] 旧版 bootstrap 表「${tableName}」缺少 count 元数据，降级逐表分页拉取`,

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



async function syncTasksPageBootstrapFromApi(opts?: { signal?: AbortSignal }): Promise<number> {

  throwIfAborted(opts?.signal);

  const boundary = await loadTasksDayBoundary();

  throwIfAborted(opts?.signal);

  let tablesSynced = 0;

  try {

    tablesSynced += await syncTasksPageViaSummary(boundary, opts);

  } catch (e) {

    if (isAbortError(e) || opts?.signal?.aborted) throw e;

    console.warn('[api-page-sync] summary bootstrap 失败，尝试旧版全量 bootstrap', e);

    tablesSynced += await syncTasksPageLegacyBootstrapFromApi(boundary, opts);

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

  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), PAGE_SYNC_TIMEOUT_MS);
  const signal = mergeAbortSignals(opts?.signal, timeoutController.signal);

  beginCloudSqliteDirtyIgnoreBatch();

  try {

    throwIfAborted(signal);

    try {

      const runPageSync = withApiLoading;

      const tablesSynced = await runPageSync(async () => {

        await ensureApiLoggedIn({ signal });



        if (pageKey === 'tabs/tasks') {

          try {

            return await syncTasksPageBootstrapFromApi({ signal });

          } catch (e) {

            if (isAbortError(e) || signal.aborted) throw e;

            console.warn('[api-page-sync] 任务页 bootstrap 同步失败，降级为逐表 List', e);

          }

        }



        for (const table of ordered) {

          throwIfAborted(signal);

          await fetchApiTableAll<Record<string, unknown>>(table, {

            signal,

            forceRefresh: true,

          });

        }

        return ordered.length;

      });

      return { ok: true, tablesSynced };

    } catch (e) {

      if (isAbortError(e) || signal.aborted) {

        return {
          ok: false,
          tablesSynced: 0,
          error: timeoutController.signal.aborted ? '同步超时，请检查网络' : '同步已取消',
        };

      }

      const msg = e instanceof Error ? e.message : String(e);

      console.warn(`[api-page-sync] 页面 ${pageKey} 同步失败`, e);

      return { ok: false, tablesSynced: 0, error: msg };

    }

  } finally {

    clearTimeout(timeoutId);

    endCloudSqliteDirtyIgnoreBatch();

  }

}

