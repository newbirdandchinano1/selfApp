import { ensureApiLoggedIn } from '@/lib/api-client';
import { writeAppMeta } from '@/lib/api-local-bootstrap';
import { withApiLoading } from '@/lib/api-loading-tracker';
import { fetchApiTableAll } from '@/lib/api-read';
import {
  beginCloudSqliteDirtyIgnoreBatch,
  endCloudSqliteDirtyIgnoreBatch,
} from '@/lib/cloud-sql-dirty-track';
import { isAbortError, throwIfAborted } from '@/lib/cloud-fetch-retry';
import { resolveApiPushInsertOrder } from '@/lib/cloud-sql-sync';
import { listPageScopeTables, TAB_PAGE_KEYS } from '@/lib/page-api-scope';

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

export async function clearTasksBootstrapVersionCache(): Promise<void> {
  await writeAppMeta(TASKS_BOOTSTRAP_VERSIONS_META_KEY, '{}');
}

/**
 * 页面首次访问：按页面范围从 REST 全量拉取并覆盖本地 SQLite。
 * 任务 / 财务 / 复盘 / 我的 Tab 不走通用 List，由专用 page API 负责读数。
 */
export async function syncPageScopeFromApi(
  pageKey: string,
  opts?: { signal?: AbortSignal },
): Promise<{ ok: boolean; tablesSynced: number; error?: string }> {
  if (
    pageKey === TAB_PAGE_KEYS.tasks ||
    pageKey === TAB_PAGE_KEYS.finance ||
    pageKey === TAB_PAGE_KEYS.review ||
    pageKey === TAB_PAGE_KEYS.profile
  ) {
    return { ok: true, tablesSynced: 0 };
  }

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
      const tablesSynced = await withApiLoading(async () => {
        await ensureApiLoggedIn({ signal });
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
