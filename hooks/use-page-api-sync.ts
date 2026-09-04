import { useCallback, useState } from 'react';
import { useFocusEffect } from "expo-router/react-navigation";

import { useRegisterApiLoadingRetry } from '@/hooks/use-register-api-loading-retry';
import { usePullToRefresh, type UsePullToRefreshResult } from '@/hooks/use-pull-to-refresh';
import { isApiOnlyReads, isLocalFirstReads } from '@/lib/api-data-mode';
import { clearActivePageApiKey, setActivePageApiKey } from '@/lib/page-api-active';
import {
  clearPageLoadedInSession,
  finalizePageLoadSession,
  hasPageLoadedInSession,
  hasPageSyncedWithApi,
  markPageSyncedWithApi,
  notifyAncestorPagesLocalReload,
  notifyPageDataChanged,
  resetPageApiSession,
  resolvePageApiReadOpts,
  runPageLoadBody,
} from '@/lib/page-api-session';
import { runGuardedPageApiLoad } from '@/lib/page-api-load-guard';

export type PageWrapLoadResult = {
  ok: boolean;
  restFailed: boolean;
  localOnly: boolean;
  fnResult: boolean | void | Record<string, unknown>;
};

/**
 * 页面数据加载：local-first 下已同步页面直接读 SQLite；
 * 首次访问先展示本地（若有），再后台 REST 拉取并覆盖本地。
 */
export function usePageApiSync(pageKey: string) {
  const [synced, setSynced] = useState(() => hasPageSyncedWithApi(pageKey));

  useFocusEffect(
    useCallback(() => {
      setActivePageApiKey(pageKey);
      return () => clearActivePageApiKey(pageKey);
    }, [pageKey]),
  );

  const getReadOpts = useCallback(
    (forceApi?: boolean) => resolvePageApiReadOpts(pageKey, forceApi),
    [pageKey],
  );

  const wrapLoad = useCallback(
    async (fn: () => Promise<boolean | void | Record<string, unknown>>, forceApi = false): Promise<PageWrapLoadResult> => {
      const readOpts = resolvePageApiReadOpts(pageKey, forceApi);
      const needsRest = isApiOnlyReads() || forceApi || !readOpts.localOnly;

      const execute = async (): Promise<PageWrapLoadResult> => {
        const { ok, restFailed } = await runPageLoadBody(pageKey, fn, readOpts, forceApi);
        finalizePageLoadSession(pageKey, readOpts, ok, restFailed);
        if (ok !== false && !restFailed && (isApiOnlyReads() || !readOpts.localOnly)) {
          setSynced(true);
        }
        return {
          ok: ok !== false,
          restFailed,
          localOnly: readOpts.localOnly,
          fnResult: ok === false ? false : ok,
        };
      };

      if (needsRest) {
        return runGuardedPageApiLoad(pageKey, execute, {
          debounce: !forceApi && hasPageLoadedInSession(pageKey),
          force: forceApi,
        }) as Promise<PageWrapLoadResult>;
      }
      return execute();
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
    /** 手动通知祖先页面：local-first 下重读本地库，否则从服务端全量重拉 */
    notifyAncestorsDataChanged: () =>
      isLocalFirstReads() ? notifyAncestorPagesLocalReload(pageKey) : notifyPageDataChanged(pageKey),
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
    clearPageLoadedInSession(pageKey);
    resetPageApiSession(pageKey, { force: true });
    await reload(true);
  }, [pageKey, reload, resetPageApiSession]);

  return usePullToRefresh(refreshFromApi);
}
