import { useCallback, useState } from 'react';

import {
  beginPageApiRead,
  endPageApiRead,
  hasPageSyncedWithApi,
  markPageSyncedWithApi,
  resetPageApiSession,
  resolvePageApiReadOpts,
} from '@/lib/page-api-session';

/**
 * 页面数据加载：每次进入均经 REST 拉取（API_ONLY_READS）；
 * markSynced 仅表示该页本会话内已成功加载过，便于 UI 状态，不再切换为只读本地。
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
