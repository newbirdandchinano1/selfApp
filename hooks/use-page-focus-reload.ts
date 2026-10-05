import { useFocusEffect } from "expo-router/react-navigation";
import { useCallback, useEffect, useRef } from 'react';

import { shouldSkipPageFocusApiRefresh } from '@/lib/page-api-session';
import { pageKeyAffectedByDirtyTables } from '@/lib/page-api-scope';
import { subscribeLocalDataChanged } from '@/lib/sync-pull';

const LOCAL_RELOAD_DEBOUNCE_MS = 280;

export type UsePageFocusReloadOpts = {
  /**
   * 为 false 时不订阅本地表变更（由 useLocalQuery 负责）。
   * 默认 true，避免子页漏刷新。
   */
  observeLocal?: boolean;
};

/**
 * 页面 UI 重载：挂载 / 聚焦时读 SQLite。
 * 禁止 pull / forceRefresh；启动与回前台由 SyncManager 做一次。
 */
export function usePageFocusReload(
  pageKey: string,
  reload: (forceRefresh?: boolean) => void | Promise<void>,
  opts?: UsePageFocusReloadOpts,
) {
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  const observeLocal = opts?.observeLocal !== false;

  const skipNextFocusReloadRef = useRef(true);
  const isFocusedRef = useRef(false);

  useEffect(() => {
    void reloadRef.current?.(false);
  }, [pageKey]);

  useFocusEffect(
    useCallback(() => {
      isFocusedRef.current = true;
      if (skipNextFocusReloadRef.current) {
        skipNextFocusReloadRef.current = false;
        return () => {
          isFocusedRef.current = false;
        };
      }
      if (!shouldSkipPageFocusApiRefresh(pageKey)) {
        void reloadRef.current?.(false);
      }
      return () => {
        isFocusedRef.current = false;
      };
    }, [pageKey]),
  );

  useEffect(() => {
    if (!observeLocal) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsub = subscribeLocalDataChanged((tables, needFullSync) => {
      if (!isFocusedRef.current) return;
      if (!(needFullSync || pageKeyAffectedByDirtyTables(pageKey, tables))) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        if (!isFocusedRef.current) return;
        void reloadRef.current?.(false);
      }, LOCAL_RELOAD_DEBOUNCE_MS);
    });
    return () => {
      if (timer) clearTimeout(timer);
      unsub();
    };
  }, [pageKey, observeLocal]);
}
