import { useFocusEffect } from "expo-router/react-navigation";
import { useCallback, useEffect, useRef } from 'react';
import { AppState, InteractionManager, type AppStateStatus } from 'react-native';

import { shouldSkipPageFocusApiRefresh } from '@/lib/page-api-session';

/** 极短后台（切多任务预览等）不触发重载，避免无意义抢主线程 */
const SHORT_BACKGROUND_SKIP_MS = 2_500;
/**
 * 较长后台才 forceApi 做多端增量对齐。
 * Tab 内 focus / 写后重进页：只走 local-first 本地重读，禁止「写一次 → 全局 REST」。
 */
const FORCE_API_AFTER_BACKGROUND_MS = 30_000;

/**
 * 挂载时必定 reload 一次（冷启动首次进 Tab 触发同步/读库）。
 * 热会话内同 Tab 再次聚焦：按策略跳过，或仅本地重读（forceApi=false）。
 * 仅从较长后台回前台时 forceApi，避免写操作被误升级成全局重新拉网。
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
        // 写后脏标清会话 → 这里只重读本地，不打全局 REST
        void reloadRef.current?.(false);
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

    const tryReload = (forceApi: boolean) => {
      if (cancelled) return;
      if (!isFocusedRef.current) return;
      if (!forceApi && shouldSkipPageFocusApiRefresh(pageKey)) return;
      void reloadRef.current?.(forceApi);
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

      const backgroundMs =
        backgroundedAt != null ? Date.now() - backgroundedAt : 0;
      if (backgroundMs > 0 && backgroundMs < SHORT_BACKGROUND_SKIP_MS) {
        return;
      }

      const forceApi = backgroundMs >= FORCE_API_AFTER_BACKGROUND_MS;

      // 回前台先让首帧画完，再拉数
      cancelAfterInteractions?.cancel();
      clearRetry();
      cancelAfterInteractions = InteractionManager.runAfterInteractions(() => {
        cancelAfterInteractions = null;
        clearRetry();
        retryTimer = setTimeout(() => tryReload(forceApi), 120);
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
