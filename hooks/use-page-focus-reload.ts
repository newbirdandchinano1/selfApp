import { useFocusEffect } from "expo-router/react-navigation";
import { useCallback, useEffect, useRef } from 'react';
import { AppState, InteractionManager, type AppStateStatus } from 'react-native';

import { shouldSkipPageFocusApiRefresh, pageNeedsRestRefresh } from '@/lib/page-api-session';
import { pageKeyAffectedByDirtyTables } from '@/lib/page-api-scope';
import { pullAndApplySyncChanges, subscribeSyncDirty } from '@/lib/sync-pull';

/** 极短后台（切多任务预览等）不触发重载，避免无意义抢主线程 */
const SHORT_BACKGROUND_SKIP_MS = 2_500;
/**
 * 较长后台才 forceApi 做多端增量对齐。
 * Tab 内 focus / 写后重进页：只走 local-first 本地重读，禁止「写一次 → 全局 REST」。
 * Change Log pull 成功且脏表命中当前页时，仍会 forceApi。
 */
const FORCE_API_AFTER_BACKGROUND_MS = 30_000;

/**
 * 挂载时必定 reload 一次（冷启动首次进 Tab 触发同步/读库）。
 * 热会话内同 Tab 再次聚焦：按策略跳过，或仅本地重读（forceApi=false）。
 * 从后台回前台：先 sync pull，再按脏表 / 后台时长决定是否 forceApi。
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
    // 挂载：先追 Change Log，再交给 resolvePageApiReadOpts
    void (async () => {
      await pullAndApplySyncChanges();
      void reloadRef.current?.();
    })();
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
      void (async () => {
        const pull = await pullAndApplySyncChanges();
        if (!isFocusedRef.current) return;
        if (
          pageNeedsRestRefresh(pageKey) ||
          pageKeyAffectedByDirtyTables(pageKey, pull.dirtyTables) ||
          pull.needFullSync
        ) {
          void reloadRef.current?.(true);
          return;
        }
        if (!shouldSkipPageFocusApiRefresh(pageKey)) {
          void reloadRef.current?.(false);
        }
      })();
      return () => {
        isFocusedRef.current = false;
      };
    }, [pageKey]),
  );

  // 前台停留时：SSE / pull 脏表命中当前页则立刻 forceApi，不必切 Tab
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsub = subscribeSyncDirty((tables, needFullSync) => {
      if (!isFocusedRef.current) return;
      if (!(needFullSync || pageKeyAffectedByDirtyTables(pageKey, tables) || pageNeedsRestRefresh(pageKey))) {
        return;
      }
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        if (!isFocusedRef.current) return;
        void reloadRef.current?.(true);
      }, 280);
    });
    return () => {
      if (timer) clearTimeout(timer);
      unsub();
    };
  }, [pageKey]);

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

      const longBackground = backgroundMs >= FORCE_API_AFTER_BACKGROUND_MS;

      cancelAfterInteractions?.cancel();
      clearRetry();
      cancelAfterInteractions = InteractionManager.runAfterInteractions(() => {
        cancelAfterInteractions = null;
        clearRetry();
        retryTimer = setTimeout(() => {
          void (async () => {
            const pull = await pullAndApplySyncChanges();
            if (cancelled || !isFocusedRef.current) return;
            const forceApi =
              longBackground ||
              pageNeedsRestRefresh(pageKey) ||
              pull.applied ||
              pull.needFullSync;
            tryReload(forceApi);
          })();
        }, 120);
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
