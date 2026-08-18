import { usePagePullRefresh } from '@/hooks/use-page-api-sync';
import { usePageFocusReload } from '@/hooks/use-page-focus-reload';
import {
  fetchTasksCalendarDay,
  fetchTasksCalendarMonth,
  invalidateTasksCalendarLocalBaseCache,
  resetTasksCalendarApiCapabilities,
  type TasksCalendarMonthPayload,
} from '@/lib/tasks-calendar-api';
import {
  calendarRangeKey,
  emptyCalendarDay,
  monthGridBounds,
  type TasksCalendarDaySummary,
  type TasksCalendarGridDay,
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
  selectedYmd: string;
  boundary: TasksDayBoundary;
  wrapLoad: (fn: () => Promise<boolean | void>, forceApi?: boolean) => Promise<void>;
}) {
  const { pageKey, monthOffset, todayMonthStart, selectedYmd, boundary, wrapLoad } = params;

  const [monthGrid, setMonthGrid] = React.useState<Map<string, TasksCalendarGridDay>>(() => new Map());
  const [selectedSummary, setSelectedSummary] = React.useState<TasksCalendarDaySummary | null>(null);
  const [detailLoading, setDetailLoading] = React.useState(true);
  const [cacheVersion, setCacheVersion] = React.useState(0);
  const [loadingRanges, setLoadingRanges] = React.useState<Set<string>>(() => new Set());

  const monthCacheRef = React.useRef(new Map<string, TasksCalendarMonthPayload>());
  const dayCacheRef = React.useRef(new Map<string, TasksCalendarDaySummary>());
  const rangeInflightRef = React.useRef(new Map<string, Promise<void>>());
  const dayInflightRef = React.useRef(new Map<string, Promise<void>>());
  const reloadInflightRef = React.useRef<Promise<void> | null>(null);
  const detailRangeKeyRef = React.useRef('');
  const selectedYmdRef = React.useRef(selectedYmd);
  selectedYmdRef.current = selectedYmd;
  const boundaryRef = React.useRef(boundary);
  boundaryRef.current = boundary;

  const visibleMonth = React.useMemo(
    () => addMonths(todayMonthStart, monthOffset),
    [monthOffset, todayMonthStart],
  );

  const { startYmd: detailStartYmd, endYmd: detailEndYmd } = React.useMemo(() => {
    const monthBounds = monthGridBounds(visibleMonth);
    return { startYmd: monthBounds.gridStartYmd, endYmd: monthBounds.gridEndYmd };
  }, [visibleMonth]);

  const detailRangeKey = calendarRangeKey(detailStartYmd, detailEndYmd);

  const bumpCache = React.useCallback(() => {
    setCacheVersion((v) => v + 1);
  }, []);

  const rememberDaysFromSummaries = React.useCallback((summaries: Map<string, TasksCalendarDaySummary>) => {
    for (const [ymd, summary] of summaries) {
      dayCacheRef.current.set(ymd, summary);
    }
  }, []);

  const applyMonthFromCache = React.useCallback((rangeKey: string) => {
    const cached = monthCacheRef.current.get(rangeKey);
    if (!cached) return false;
    if (rangeKey === detailRangeKeyRef.current) {
      setMonthGrid(cached.grid);
    }
    if (cached.summaries) rememberDaysFromSummaries(cached.summaries);
    return true;
  }, [rememberDaysFromSummaries]);

  const applySelectedFromCache = React.useCallback((ymd: string) => {
    const cached = dayCacheRef.current.get(ymd);
    if (!cached) return false;
    if (ymd === selectedYmdRef.current) {
      setSelectedSummary(cached);
      setDetailLoading(false);
    }
    return true;
  }, []);

  const ensureRangeLoaded = React.useCallback(
    async (startYmd: string, endYmd: string, opts?: { forceApi?: boolean; viaWrapLoad?: boolean }) => {
      const rangeKey = calendarRangeKey(startYmd, endYmd);
      if (!opts?.forceApi && monthCacheRef.current.has(rangeKey)) {
        applyMonthFromCache(rangeKey);
        return;
      }

      const existing = rangeInflightRef.current.get(rangeKey);
      if (existing && !opts?.forceApi) {
        await existing;
        return;
      }

      const run = (async () => {
        if (!monthCacheRef.current.has(rangeKey)) {
          setLoadingRanges((prev) => new Set(prev).add(rangeKey));
        }
        try {
          const loadBody = async () => {
            const payload = await fetchTasksCalendarMonth({
              startYmd,
              endYmd,
              dayBoundary: boundaryRef.current,
              offlineFallback: true,
              forceApi: opts?.forceApi,
            });
            monthCacheRef.current.set(rangeKey, payload);
            if (payload.summaries) rememberDaysFromSummaries(payload.summaries);
            if (rangeKey === detailRangeKeyRef.current) {
              setMonthGrid(payload.grid);
            }
            const selected = selectedYmdRef.current;
            if (payload.summaries?.has(selected) && selected) {
              applySelectedFromCache(selected);
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
    [applyMonthFromCache, applySelectedFromCache, bumpCache, rememberDaysFromSummaries, wrapLoad],
  );

  const ensureDayLoaded = React.useCallback(
    async (ymd: string, opts?: { forceApi?: boolean; viaWrapLoad?: boolean }) => {
      if (!ymd) return;
      if (!opts?.forceApi && applySelectedFromCache(ymd)) return;

      const existing = dayInflightRef.current.get(ymd);
      if (existing && !opts?.forceApi) {
        await existing;
        return;
      }

      const run = (async () => {
        if (ymd === selectedYmdRef.current) setDetailLoading(true);
        try {
          const loadBody = async () => {
            const summary = await fetchTasksCalendarDay({
              ymd,
              startYmd: detailStartYmd,
              endYmd: detailEndYmd,
              dayBoundary: boundaryRef.current,
              offlineFallback: true,
              forceApi: opts?.forceApi,
            });
            const next = summary ?? emptyCalendarDay(ymd);
            dayCacheRef.current.set(ymd, next);
            if (ymd === selectedYmdRef.current) {
              setSelectedSummary(next);
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
          console.warn('加载任务日历选中日失败', e);
          if (ymd === selectedYmdRef.current && !dayCacheRef.current.has(ymd)) {
            setSelectedSummary(emptyCalendarDay(ymd));
            setDetailLoading(false);
          }
        }
      })();

      dayInflightRef.current.set(ymd, run);
      try {
        await run;
      } finally {
        if (dayInflightRef.current.get(ymd) === run) {
          dayInflightRef.current.delete(ymd);
        }
      }
    },
    [applySelectedFromCache, bumpCache, detailEndYmd, detailStartYmd, wrapLoad],
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
        if (forceApi) {
          invalidateTasksCalendarLocalBaseCache();
          resetTasksCalendarApiCapabilities();
          monthCacheRef.current.clear();
          dayCacheRef.current.clear();
          setMonthGrid(new Map());
          setSelectedSummary(null);
          setDetailLoading(true);
        } else if (applyMonthFromCache(detailRangeKey) && applySelectedFromCache(selectedYmdRef.current)) {
          return;
        }
        try {
          await ensureRangeLoaded(detailStartYmd, detailEndYmd, { forceApi, viaWrapLoad: true });
          await ensureDayLoaded(selectedYmdRef.current, { forceApi, viaWrapLoad: false });
          if (forceApi) prefetchVisibleMonths();
        } catch (e) {
          console.warn('加载任务日历失败', e);
          if (!monthCacheRef.current.has(detailRangeKey)) {
            setMonthGrid(new Map());
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
    [
      applyMonthFromCache,
      applySelectedFromCache,
      detailEndYmd,
      detailRangeKey,
      detailStartYmd,
      ensureDayLoaded,
      ensureRangeLoaded,
      prefetchVisibleMonths,
    ],
  );

  const { refreshControl } = usePagePullRefresh(pageKey, reload);

  usePageFocusReload(pageKey, reload);

  React.useEffect(() => {
    detailRangeKeyRef.current = detailRangeKey;
    if (!applyMonthFromCache(detailRangeKey)) {
      void ensureRangeLoaded(detailStartYmd, detailEndYmd, { viaWrapLoad: true });
    }
  }, [applyMonthFromCache, detailEndYmd, detailRangeKey, detailStartYmd, ensureRangeLoaded]);

  React.useEffect(() => {
    prefetchVisibleMonths();
  }, [monthOffset, prefetchVisibleMonths, todayMonthStart]);

  React.useEffect(() => {
    if (!applySelectedFromCache(selectedYmd)) {
      void ensureDayLoaded(selectedYmd);
    }
  }, [applySelectedFromCache, ensureDayLoaded, selectedYmd]);

  const getMonthPageData = React.useCallback(
    (offset: number) => {
      const bounds = monthGridBounds(addMonths(todayMonthStart, offset));
      const rangeKey = calendarRangeKey(bounds.gridStartYmd, bounds.gridEndYmd);
      return {
        grid: monthCacheRef.current.get(rangeKey)?.grid,
        loading: loadingRanges.has(rangeKey) && !monthCacheRef.current.has(rangeKey),
      };
    },
    [loadingRanges, cacheVersion, todayMonthStart],
  );

  return {
    monthGrid,
    selectedSummary,
    detailLoading,
    cacheVersion,
    getMonthPageData,
    reload,
    refreshControl,
  };
}
