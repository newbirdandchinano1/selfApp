import { useCallback, useState } from 'react';
import { useFocusEffect } from "expo-router/react-navigation";

import { useRegisterApiLoadingRetry } from '@/hooks/use-register-api-loading-retry';
import { usePullToRefresh, type UsePullToRefreshResult } from '@/hooks/use-pull-to-refresh';

import { clearActivePageApiKey, setActivePageApiKey } from '@/lib/page-api-active';
import {
  clearPageLoadedInSession,
  finalizePageLoadSession,
  hasPageLoadedInSession,
  hasPageLoadedFromServer,
  markPageLoadedFromServer,
  notifyPageDataChanged,
  notifyPageDataChanged,
  resetPageApiSession,
  resolvePageApiReadOpts,
  runPageLoadBody,
} from '@/lib/page-api-session';
import { runGuardedPageApiLoad } from '@/lib/page-api-load-guard';

export type PageWrapLoadResult = {
  ok: boolean;
  restFailed: boolean;
  cacheOnly: boolean;
  fnResult: boolean | void | Record<string, unknown>;
};

/**
 * 页面数据加载：默认只读 SQLite。
 * 是否与服务器对齐由 cursor + bootstrap_done + 行字段决定，不由本 hook。
 */
export function usePageApiSync(pageKey: string) {
  const [synced, setSynced] = useState(() => hasPageLoadedFromServer(pageKey));

  useFocusEffect(
    useCallback(() => {
      setActivePageApiKey(pageKey);
      return () => clearActivePageApiKey(pageKey);
    }, [pageKey]),
  );

  const getReadOpts = useCallback(
    (forceRefresh?: boolean) => resolvePageApiReadOpts(pageKey, forceRefresh),
    [pageKey],
  );

  const wrapLoad = useCallback(
    async (fn: () => Promise<boolean | void | Record<string, unknown>>, forceRefresh = false): Promise<PageWrapLoadResult> => {
      const readOpts = resolvePageApiReadOpts(pageKey, forceRefresh);
      const needsRest = true || forceRefresh || !readOpts.cacheOnly;

      const execute = async (): Promise<PageWrapLoadResult> => {
        const { ok, restFailed } = await runPageLoadBody(pageKey, fn, readOpts, forceRefresh);
        finalizePageLoadSession(pageKey, readOpts, ok, restFailed);
        if (ok !== false && !restFailed && (true || !readOpts.cacheOnly)) {
          setSynced(true);
        }
        return {
          ok: ok !== false,
          restFailed,
          cacheOnly: readOpts.cacheOnly,
          fnResult: ok === false ? false : ok,
        };
      };

      if (needsRest) {
        return runGuardedPageApiLoad(pageKey, execute, {
          debounce: !forceRefresh && hasPageLoadedInSession(pageKey),
          force: forceRefresh,
        }) as Promise<PageWrapLoadResult>;
      }
      return execute();
    },
    [pageKey],
  );

  const markSynced = useCallback(() => {
    markPageLoadedFromServer(pageKey);
    setSynced(true);
  }, [pageKey]);

  const resetSync = useCallback(() => {
    resetPageApiSession(pageKey);
    setSynced(false);
  }, [pageKey]);

  const readOpts = resolvePageApiReadOpts(pageKey);

  return {
    cacheOnly: readOpts.cacheOnly,
    getReadOpts,
    wrapLoad,
    markSynced,
    resetSync,
    /** 手动通知祖先页面：server-authoritative 下重读本地库，否则从服务端全量重拉 */
    notifyAncestorsDataChanged: () =>
      true ? notifyPageDataChanged(pageKey) : notifyPageDataChanged(pageKey),
  };
}

/**
 * 下拉刷新：SyncManager pull / bootstrap 后重读 SQLite（不 forceRefresh 打 page REST）。
 */
export function usePagePullRefresh(
  pageKey: string,
  reload: (forceRefresh?: boolean) => Promise<void>,
): UsePullToRefreshResult {
  useRegisterApiLoadingRetry(reload);

  const refreshFromApi = useCallback(async () => {
    clearPageLoadedInSession(pageKey);
    const { refreshFromUser } = await import('@/lib/sync-manager');
    await refreshFromUser();
    await reload(false);
  }, [pageKey, reload]);

  return usePullToRefresh(refreshFromApi);
}
