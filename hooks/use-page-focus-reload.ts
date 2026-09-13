import { useFocusEffect } from "expo-router/react-navigation";
import { useCallback, useEffect, useRef } from 'react';
import { AppState, InteractionManager, type AppStateStatus } from 'react-native';

import { isDayBoundaryClearInProgress } from '@/lib/api-local-clear';
import { shouldSkipPageFocusApiRefresh } from '@/lib/page-api-session';

/**
 * 挂载时必定 reload 一次（冷启动首次进 Tab 触发同步/读库）。
 * 热会话内同 Tab 再次聚焦时按页面策略跳过重载；从后台回前台且当前页仍聚焦时也会尝试刷新（多端对齐）。
 */
export function usePageFocusReload(
  pageKey: string,
  reload: (forceApi?: boolean) => void | Promise<void>,
) {
  const reloadRef = useRef(reload);
  reloadRef.current = reload;

  const skipNextFocusReloadRef = useRef(true);
  const isFocusedRef = useRef(false);

  useEffect(() => {
    void reloadRef.current?.();
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
        void reloadRef.current?.();
      }
      return () => {
        isFocusedRef.current = false;
      };
    }, [pageKey]),
  );

  useEffect(() => {
    let cancelAfterInteractions: { cancel: () => void } | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const clearRetry = () => {
      if (retryTimer != null) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
    };

    const tryReload = (attempt = 0) => {
      if (cancelled) return;
      if (!isFocusedRef.current) return;
      // 跨日界清库进行中：稍后重试，避免读空库/锁竞争卡死
      if (isDayBoundaryClearInProgress()) {
        if (attempt >= 40) return;
        clearRetry();
        retryTimer = setTimeout(() => tryReload(attempt + 1), 250);
        return;
      }
      if (shouldSkipPageFocusApiRefresh(pageKey)) return;
      void reloadRef.current?.();
    };

    const onChange = (next: AppStateStatus) => {
      if (next !== 'active') return;
      if (!isFocusedRef.current) return;
      // 回前台先让首帧画完，再拉数，减轻「切回来卡死」
      cancelAfterInteractions?.cancel();
      clearRetry();
      cancelAfterInteractions = InteractionManager.runAfterInteractions(() => {
        cancelAfterInteractions = null;
        // 略晚于日界 gate/清库调度，降低同拍竞态
        clearRetry();
        retryTimer = setTimeout(() => tryReload(0), 120);
      });
    };
    const sub = AppState.addEventListener('change', onChange);
    return () => {
      cancelled = true;
      cancelAfterInteractions?.cancel();
      clearRetry();
      sub.remove();
    };
  }, [pageKey]);
}
