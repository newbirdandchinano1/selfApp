import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';

import { useRegisterApiLoadingRetry } from '@/hooks/use-register-api-loading-retry';
import { usePullToRefresh, type UsePullToRefreshResult } from '@/hooks/use-pull-to-refresh';
import { isApiOnlyReads, isLocalFirstReads } from '@/lib/api-data-mode';
import { clearActivePageApiKey, setActivePageApiKey } from '@/lib/page-api-active';
import {
  beginPageApiRead,
  clearPageLoadedInSession,
  consumePageLoadRestFailed,
  endPageApiRead,
  hasPageSyncedWithApi,
  markPageLoadedInSession,
  markPageRestRefreshCompleted,
  markPageSyncedWithApi,
  notifyPageDataChanged,
  resetPageApiSession,
  resolvePageApiReadOpts,
} from '@/lib/page-api-session';
import { runGuardedPageApiLoad } from '@/lib/page-api-load-guard';

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
    async (fn: () => Promise<boolean | void>, forceApi = false) => {
      const readOpts = resolvePageApiReadOpts(pageKey, forceApi);
      const needsRest = isApiOnlyReads() || forceApi || !readOpts.localOnly;

      const execute = async () => {
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
          const restFailed = consumePageLoadRestFailed();
          if (
            ok !== false &&
            !restFailed &&
            (isApiOnlyReads() || !readOpts.localOnly)
          ) {
            markPageSyncedWithApi(pageKey);
            setSynced(true);
          }
          if (ok !== false && !restFailed) {
            markPageLoadedInSession(pageKey);
          }
          if (ok !== false && !restFailed && !readOpts.localOnly) {
            markPageRestRefreshCompleted(pageKey);
          }
        } finally {
          endPageApiRead();
        }
      };

      if (needsRest) {
        return runGuardedPageApiLoad(pageKey, execute, {
          debounce: !forceApi,
          force: forceApi,
        });
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
    /** 手动通知祖先页面：下次聚焦时从服务端全量重拉 */
    notifyAncestorsDataChanged: () => notifyPageDataChanged(pageKey),
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
