import { useCallback, useState } from 'react';

import { useRegisterApiLoadingRetry } from '@/hooks/use-register-api-loading-retry';
import { usePullToRefresh, type UsePullToRefreshResult } from '@/hooks/use-pull-to-refresh';
import { isApiOnlyReads, isLocalFirstReads } from '@/lib/api-data-mode';
import {
  beginPageApiRead,
  endPageApiRead,
  hasPageSyncedWithApi,
  markPageSyncedWithApi,
  resetPageApiSession,
  resolvePageApiReadOpts,
} from '@/lib/page-api-session';

/**
 * 页面数据加载：local-first 下已同步页面直接读 SQLite；
 * 首次访问先展示本地（若有），再后台 REST 拉取并覆盖本地。
 */
export function usePageApiSync(pageKey: string) {
  const [synced, setSynced] = useState(() => hasPageSyncedWithApi(pageKey));

  const getReadOpts = useCallback(
    (forceApi?: boolean) => resolvePageApiReadOpts(pageKey, forceApi),
    [pageKey],
  );

  const wrapLoad = useCallback(
    async (fn: () => Promise<boolean | void>, forceApi = false) => {
      const readOpts = resolvePageApiReadOpts(pageKey, forceApi);

      if (isLocalFirstReads() && !forceApi && !readOpts.localOnly) {
        beginPageApiRead({ localOnly: true, offlineFallback: true });
        try {
          await fn();
        } catch (e) {
          console.warn('[usePageApiSync] 本地预读失败，继续尝试 REST', pageKey, e);
        } finally {
          endPageApiRead();
        }
      }

      beginPageApiRead(readOpts);
      try {
        const ok = await fn();
        if (ok !== false && (isApiOnlyReads() || !readOpts.localOnly)) {
          markPageSyncedWithApi(pageKey);
          setSynced(true);
        }
      } finally {
        endPageApiRead();
      }
    },
    [pageKey],
  );

  const markSynced = useCallback(() => {
    markPageSyncedWithApi(pageKey);
    setSynced(true);
  }, [pageKey]);

  const resetSync = useCallback(() => {
    resetPageApiSession(pageKey);
    setSynced(false);
  }, [pageKey]);

  const readOpts = resolvePageApiReadOpts(pageKey);

  return {
    localOnly: readOpts.localOnly,
    getReadOpts,
    wrapLoad,
    markSynced,
    resetSync,
  };
}

/**
 * 页面下拉刷新：重置本会话同步标记并强制经 wrapLoad 从接口/本地库重载。
 * reload 应接受 forceApi 参数（与 wrapLoad 第二参一致）。
 */
export function usePagePullRefresh(
  pageKey: string,
  reload: (forceApi?: boolean) => Promise<void>,
): UsePullToRefreshResult {
  useRegisterApiLoadingRetry(reload);

  const refreshFromApi = useCallback(async () => {
    resetPageApiSession(pageKey);
    await reload(true);
  }, [pageKey, reload]);

  return usePullToRefresh(refreshFromApi);
}
