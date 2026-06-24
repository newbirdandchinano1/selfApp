import { usePagePullRefresh } from '@/hooks/use-page-api-sync';
import { usePageFocusReload } from '@/hooks/use-page-focus-reload';
import { fetchTasksCalendarSummaries, invalidateTasksCalendarLocalBaseCache } from '@/lib/tasks-calendar-api';
import {
  calendarRangeKey,
  monthGridBounds,
  type TasksCalendarDaySummary,
} from '@/lib/tasks-calendar-data';
import type { TasksDayBoundary } from '@/lib/tasks-logical-day';
import React from 'react';

function addMonths(monthStart: Date, delta: number): Date {
  return new Date(monthStart.getFullYear(), monthStart.getMonth() + delta, 1);
}

const PREFETCH_OFFSETS = [-1, 0, 1] as const;

export function useTasksCalendarSummaries(params: {
  pageKey: string;
  monthOffset: number;
  todayMonthStart: Date;
  boundary: TasksDayBoundary;
  wrapLoad: (fn: () => Promise<boolean | void>, forceApi?: boolean) => Promise<void>;
}) {
  const { pageKey, monthOffset, todayMonthStart, boundary, wrapLoad } = params;

  const [summaries, setSummaries] = React.useState<Map<string, TasksCalendarDaySummary>>(() => new Map());
  const [detailLoading, setDetailLoading] = React.useState(true);
  const [cacheVersion, setCacheVersion] = React.useState(0);
  const [loadingRanges, setLoadingRanges] = React.useState<Set<string>>(() => new Set());

  const summariesCacheRef = React.useRef(new Map<string, Map<string, TasksCalendarDaySummary>>());
  const rangeInflightRef = React.useRef(new Map<string, Promise<void>>());
  const reloadInflightRef = React.useRef<Promise<void> | null>(null);
  const detailRangeKeyRef = React.useRef('');
  const boundaryRef = React.useRef(boundary);
  boundaryRef.current = boundary;

  const visibleMonth = React.useMemo(
    () => addMonths(todayMonthStart, monthOffset),
    [todayMonthStart, monthOffset],
  );

  const { startYmd: detailStartYmd, endYmd: detailEndYmd } = React.useMemo(() => {
    const monthBounds = monthGridBounds(visibleMonth);
    return { startYmd: monthBounds.gridStartYmd, endYmd: monthBounds.gridEndYmd };
  }, [visibleMonth]);

  const detailRangeKey = calendarRangeKey(detailStartYmd, detailEndYmd);

  const bumpCache = React.useCallback(() => {
    setCacheVersion((v) => v + 1);
  }, []);

  const applyDetailFromCache = React.useCallback((rangeKey: string) => {
    const cached = summariesCacheRef.current.get(rangeKey);
    if (cached) {
      setSummaries(cached);
      setDetailLoading(false);
      return true;
    }
    setDetailLoading(true);
    return false;
  }, []);

  const ensureRangeLoaded = React.useCallback(
    async (startYmd: string, endYmd: string, opts?: { forceApi?: boolean; viaWrapLoad?: boolean }) => {
      const rangeKey = calendarRangeKey(startYmd, endYmd);
      if (!opts?.forceApi && summariesCacheRef.current.has(rangeKey)) {
        if (rangeKey === detailRangeKeyRef.current) {
          applyDetailFromCache(rangeKey);
        }
        return;
      }

      const existing = rangeInflightRef.current.get(rangeKey);
      if (existing && !opts?.forceApi) {
        await existing;
        return;
      }

      const run = (async () => {
        if (!summariesCacheRef.current.has(rangeKey)) {
          setLoadingRanges((prev) => new Set(prev).add(rangeKey));
        }
        try {
          const loadBody = async () => {
            const map = await fetchTasksCalendarSummaries({
              startYmd,
              endYmd,
              dayBoundary: boundaryRef.current,
              offlineFallback: true,
              forceApi: opts?.forceApi,
            });
            summariesCacheRef.current.set(rangeKey, map);
            if (rangeKey === detailRangeKeyRef.current) {
              setSummaries(map);
              setDetailLoading(false);
            }
            bumpCache();
          };

          if (opts?.viaWrapLoad) {
            await wrapLoad(async () => {
              await loadBody();
            }, opts?.forceApi);
          } else {
            await loadBody();
          }
        } catch (e) {
          console.warn('加载任务日历月份失败', e);
        } finally {
          setLoadingRanges((prev) => {
            const next = new Set(prev);
            next.delete(rangeKey);
            return next;
          });
        }
      })();

      rangeInflightRef.current.set(rangeKey, run);
      try {
        await run;
      } finally {
        if (rangeInflightRef.current.get(rangeKey) === run) {
          rangeInflightRef.current.delete(rangeKey);
        }
      }
    },
    [applyDetailFromCache, bumpCache, wrapLoad],
  );

  const prefetchVisibleMonths = React.useCallback(
    (opts?: { forceApi?: boolean; viaWrapLoad?: boolean }) => {
      for (const off of PREFETCH_OFFSETS) {
        const bounds = monthGridBounds(addMonths(todayMonthStart, monthOffset + off));
        void ensureRangeLoaded(bounds.gridStartYmd, bounds.gridEndYmd, opts);
      }
    },
    [ensureRangeLoaded, monthOffset, todayMonthStart],
  );

  const reload = React.useCallback(
    async (forceApi = false) => {
      if (reloadInflightRef.current && !forceApi) {
        return reloadInflightRef.current;
      }

      const run = (async () => {
        detailRangeKeyRef.current = detailRangeKey;
        if (!forceApi && applyDetailFromCache(detailRangeKey)) {
          return;
        }
        if (forceApi) {
          invalidateTasksCalendarLocalBaseCache();
          summariesCacheRef.current.delete(detailRangeKey);
        }
        try {
          await ensureRangeLoaded(detailStartYmd, detailEndYmd, { forceApi, viaWrapLoad: true });
        } catch (e) {
          console.warn('加载任务日历失败', e);
          if (!summariesCacheRef.current.has(detailRangeKey)) {
            setSummaries(new Map());
          }
        }
      })();

      reloadInflightRef.current = run;
      try {
        await run;
      } finally {
        if (reloadInflightRef.current === run) {
          reloadInflightRef.current = null;
        }
      }
    },
    [applyDetailFromCache, detailRangeKey, detailStartYmd, detailEndYmd, ensureRangeLoaded],
  );

  const { refreshControl } = usePagePullRefresh(pageKey, reload);

  usePageFocusReload(pageKey, reload);

  React.useEffect(() => {
    detailRangeKeyRef.current = detailRangeKey;
    if (!applyDetailFromCache(detailRangeKey)) {
      void ensureRangeLoaded(detailStartYmd, detailEndYmd, { viaWrapLoad: true });
    }
  }, [detailRangeKey, detailStartYmd, detailEndYmd, applyDetailFromCache, ensureRangeLoaded]);

  React.useEffect(() => {
    prefetchVisibleMonths();
  }, [monthOffset, todayMonthStart, prefetchVisibleMonths]);

  const getMonthPageData = React.useCallback(
    (offset: number) => {
      const bounds = monthGridBounds(addMonths(todayMonthStart, offset));
      const rangeKey = calendarRangeKey(bounds.gridStartYmd, bounds.gridEndYmd);
      return {
        summaries: summariesCacheRef.current.get(rangeKey),
        loading: loadingRanges.has(rangeKey) && !summariesCacheRef.current.has(rangeKey),
      };
    },
    [todayMonthStart, loadingRanges, cacheVersion],
  );

  return {
    summaries,
    detailLoading,
    cacheVersion,
    getMonthPageData,
    reload,
    refreshControl,
  };
}
