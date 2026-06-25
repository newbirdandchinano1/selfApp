import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect, useRef } from 'react';

import { shouldSkipPageFocusApiRefresh } from '@/lib/page-api-session';

/**
 * 挂载时必定 reload 一次（冷启动首次进 Tab 触发同步/读库）。
 * 热会话内同 Tab 再次聚焦时跳过重载，避免全屏加载蒙层；冷启动进程内首次聚焦不跳过。
 */
export function usePageFocusReload(
  pageKey: string,
  reload: (forceApi?: boolean) => void | Promise<void>,
) {
  const reloadRef = useRef(reload);
  reloadRef.current = reload;

  const skipNextFocusReloadRef = useRef(true);

  useEffect(() => {
    void reloadRef.current?.();
  }, [pageKey]);

  useFocusEffect(
    useCallback(() => {
      if (skipNextFocusReloadRef.current) {
        skipNextFocusReloadRef.current = false;
        return;
      }
      if (shouldSkipPageFocusApiRefresh(pageKey)) return;
      void reloadRef.current?.();
    }, [pageKey]),
  );
}
