import { useFocusEffect } from "expo-router/react-navigation";
import { useCallback, useEffect, useRef } from 'react';
import { AppState, InteractionManager, type AppStateStatus } from 'react-native';

import {
  shouldForceApiOnFocusRefresh,
  shouldSkipPageFocusApiRefresh,
} from '@/lib/page-api-session';

/** 极短后台（切多任务预览等）不触发重载，避免无意义抢主线程 */
const SHORT_BACKGROUND_SKIP_MS = 2_500;

/**
 * 挂载时必定 reload 一次（冷启动首次进 Tab 触发同步/读库）。
 * 热会话内同 Tab 再次聚焦时按页面策略跳过重载；从后台回前台且当前页仍聚焦时也会尝试刷新（多端对齐）。
 * 任务页在冷却外的 focus 会带 forceApi，以便多端增量拉齐且不绕过 localOnly 上下文。
 */
export function usePageFocusReload(
  pageKey: string,
  reload: (forceApi?: boolean) => void | Promise<void>,
) {
  const reloadRef = useRef(reload);
  reloadRef.current = reload;

  const skipNextFocusReloadRef = useRef(true);
  const isFocusedRef = useRef(false);
  const backgroundedAtMsRef = useRef<number | null>(null);

  const invokeReload = useCallback((forceApi?: boolean) => {
    const force = forceApi === true || shouldForceApiOnFocusRefresh(pageKey);
    void reloadRef.current?.(force);
  }, [pageKey]);

  useEffect(() => {
    // 挂载首次：不强制 forceApi，交给 resolvePageApiReadOpts（未同步则 REST，已同步则本地）
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
        invokeReload();
      }
      return () => {
        isFocusedRef.current = false;
      };
    }, [pageKey, invokeReload]),
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

    const tryReload = () => {
      if (cancelled) return;
      if (!isFocusedRef.current) return;
      if (shouldSkipPageFocusApiRefresh(pageKey)) return;
      invokeReload();
    };

    const onChange = (next: AppStateStatus) => {
      if (next !== 'active') {
        if (backgroundedAtMsRef.current == null) {
          backgroundedAtMsRef.current = Date.now();
        }
        return;
      }

      const backgroundedAt = backgroundedAtMsRef.current;
      backgroundedAtMsRef.current = null;
      if (!isFocusedRef.current) return;

      if (
        backgroundedAt != null &&
        Date.now() - backgroundedAt < SHORT_BACKGROUND_SKIP_MS
      ) {
        return;
      }

      // 回前台先让首帧画完，再拉数
      cancelAfterInteractions?.cancel();
      clearRetry();
      cancelAfterInteractions = InteractionManager.runAfterInteractions(() => {
        cancelAfterInteractions = null;
        clearRetry();
        retryTimer = setTimeout(() => tryReload(), 120);
      });
    };
    const sub = AppState.addEventListener('change', onChange);
    return () => {
      cancelled = true;
      cancelAfterInteractions?.cancel();
      clearRetry();
      sub.remove();
    };
  }, [pageKey, invokeReload]);
}
