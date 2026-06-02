import { useCallback, useState } from 'react';

import { usePullToRefresh, type UsePullToRefreshResult } from '@/hooks/use-pull-to-refresh';
import {
  beginPageApiRead,
  endPageApiRead,
  hasPageSyncedWithApi,
  markPageSyncedWithApi,
  resetPageApiSession,
  resolvePageApiReadOpts,
} from '@/lib/page-api-session';

/**
 * 页面数据加载：每次进入均经 REST 拉取（API_ONLY_READS），结果已含本地 pending 覆盖。
 * markSynced 仅表示该页本会话内已成功加载过，便于 UI 状态。
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
      beginPageApiRead(readOpts);
      try {
        const ok = await fn();
        if (!readOpts.localOnly && ok !== false) {
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

  return {
    localOnly: false,
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
  const refreshFromApi = useCallback(async () => {
    resetPageApiSession(pageKey);
    await reload(true);
  }, [pageKey, reload]);

  return usePullToRefresh(refreshFromApi);
}
