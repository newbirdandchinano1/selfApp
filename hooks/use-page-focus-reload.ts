import { useFocusEffect } from "expo-router/react-navigation";
import { useCallback, useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

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
    const onChange = (next: AppStateStatus) => {
      if (next !== 'active') return;
      if (!isFocusedRef.current) return;
      if (shouldSkipPageFocusApiRefresh(pageKey)) return;
      void reloadRef.current?.();
    };
    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
  }, [pageKey]);
}
