import { useEffect, useMemo, useRef } from 'react';

import { subscribeLocalDataChanged } from '@/lib/sync-pull';

const LOCAL_RELOAD_DEBOUNCE_MS = 280;

/**
 * 订阅 SQLite 相关表变更后重跑 loader。不 pull、不 forceRefresh。
 */
export function useLocalQuery(
  tables: readonly string[],
  loader: () => void | Promise<void>,
) {
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const tableSet = useMemo(() => {
    const next = new Set<string>();
    for (const raw of tables) {
      const t = raw.trim();
      if (t) next.add(t);
    }
    return next;
  }, [tables]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsub = subscribeLocalDataChanged((changed, needFullSync) => {
      const hit =
        needFullSync === true ||
        (tableSet.size > 0 && changed.some((t) => tableSet.has(t.trim())));
      if (!hit) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void loaderRef.current?.();
      }, LOCAL_RELOAD_DEBOUNCE_MS);
    });
    return () => {
      if (timer) clearTimeout(timer);
      unsub();
    };
  }, [tableSet]);
}
