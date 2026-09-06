import {
  DEFAULT_DAY_BOUNDARY_PAGES,
  DEFAULT_TASKS_DAY_BOUNDARY,
  getLogicalLocalYmd,
  loadConfiguredDayBoundary,
  loadDayBoundaryPages,
  logicalYmdToLocalDate,
  saveConfiguredDayBoundary,
  saveDayBoundaryPages,
  subscribeDayBoundary,
  type DayBoundaryPageId,
  type TasksDayBoundary,
} from '@/lib/tasks-logical-day';
import { clearPageLoadedInSession } from '@/lib/page-api-session';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';

type DayBoundaryContextValue = {
  /** 设置里配置的日界时刻（未必对所有页面生效） */
  boundary: TasksDayBoundary;
  /** 勾选后采用自定义日界的页面；未勾选则该页为 0:00 */
  pages: DayBoundaryPageId[];
  /** 任务域有效「今天」（兼容旧调用；等价于 usePageDayBoundary('tasks')） */
  logicalTodayYmd: string;
  /** 逻辑「今天」对应的本地日历日（正午），用于 UI 月日/星期 */
  logicalTodayDate: Date;
  isReady: boolean;
  setBoundary: (boundary: TasksDayBoundary) => Promise<void>;
  setPages: (pages: readonly DayBoundaryPageId[]) => Promise<void>;
  /** 内部时钟：跨日界 / 回前台时递增，供 usePageDayBoundary 重算 */
  dayClock: number;
};

const DayBoundaryContext = createContext<DayBoundaryContextValue | null>(null);

function msUntilNextBoundaryCrossing(boundary: TasksDayBoundary): number {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), boundary.hour, boundary.minute, 0, 0);
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }
  return Math.max(1000, next.getTime() - now.getTime() + 50);
}

/** 同时照顾自定义日界与自然日 0:00，取更近的一次跨界 */
function msUntilNextRelevantCrossing(configured: TasksDayBoundary): number {
  const toConfigured = msUntilNextBoundaryCrossing(configured);
  const toMidnight = msUntilNextBoundaryCrossing(DEFAULT_TASKS_DAY_BOUNDARY);
  const isMidnight =
    configured.hour === DEFAULT_TASKS_DAY_BOUNDARY.hour &&
    configured.minute === DEFAULT_TASKS_DAY_BOUNDARY.minute;
  return isMidnight ? toMidnight : Math.min(toConfigured, toMidnight);
}

export function DayBoundaryProvider({ children }: { children: React.ReactNode }) {
  const [boundary, setBoundaryState] = useState<TasksDayBoundary>(() => ({ ...DEFAULT_TASKS_DAY_BOUNDARY }));
  const [pages, setPagesState] = useState<DayBoundaryPageId[]>(() => [...DEFAULT_DAY_BOUNDARY_PAGES]);
  const [isReady, setIsReady] = useState(false);
  const [dayClock, setDayClock] = useState(0);
  const lastEmittedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    let mounted = true;
    void Promise.all([loadConfiguredDayBoundary(), loadDayBoundaryPages()]).then(([b, p]) => {
      if (mounted) {
        setBoundaryState(b);
        setPagesState(p);
        setIsReady(true);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    return subscribeDayBoundary(() => {
      void Promise.all([loadConfiguredDayBoundary(), loadDayBoundaryPages()]).then(([b, p]) => {
        setBoundaryState(b);
        setPagesState(p);
      });
    });
  }, []);

  /**
   * 逻辑日时钟：定时跨日界 + 回到前台时强制重算。
   * 后台过夜后 setTimeout 常被系统挂起/丢弃，必须在 active 时 bump 并重新 schedule。
   */
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const bump = () => setDayClock((c) => c + 1);

    const schedule = () => {
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(() => {
        bump();
        schedule();
      }, msUntilNextRelevantCrossing(boundary));
    };

    const onForeground = () => {
      bump();
      schedule();
    };

    schedule();

    const appStateSub = AppState.addEventListener('change', (next) => {
      if (next === 'active') onForeground();
    });

    const pollId = setInterval(() => {
      const now = new Date();
      const configuredYmd = getLogicalLocalYmd(now, boundary);
      const midnightYmd = getLogicalLocalYmd(now, DEFAULT_TASKS_DAY_BOUNDARY);
      const key = `${configuredYmd}|${midnightYmd}`;
      if (lastEmittedKeyRef.current != null && lastEmittedKeyRef.current !== key) {
        onForeground();
      }
    }, 30_000);

    const onVisibilityChange = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        onForeground();
      }
    };
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibilityChange);
      window.addEventListener('focus', onForeground);
    }

    return () => {
      if (timeout) clearTimeout(timeout);
      clearInterval(pollId);
      appStateSub.remove();
      if (Platform.OS === 'web' && typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibilityChange);
        window.removeEventListener('focus', onForeground);
      }
    };
  }, [boundary.hour, boundary.minute]);

  const tasksBoundary = useMemo(
    () => (pages.includes('tasks') ? boundary : { ...DEFAULT_TASKS_DAY_BOUNDARY }),
    [boundary, pages],
  );

  const logicalTodayYmd = useMemo(
    () => getLogicalLocalYmd(new Date(), tasksBoundary),
    [tasksBoundary, dayClock],
  );

  const logicalTodayDate = useMemo(() => logicalYmdToLocalDate(logicalTodayYmd), [logicalTodayYmd]);

  /** 进程内任一有效「今天」变化：清会话加载标记，使各 Tab 下次聚焦会重读数据 */
  useEffect(() => {
    const now = new Date();
    const configuredYmd = getLogicalLocalYmd(now, boundary);
    const midnightYmd = getLogicalLocalYmd(now, DEFAULT_TASKS_DAY_BOUNDARY);
    const key = `${configuredYmd}|${midnightYmd}`;
    if (lastEmittedKeyRef.current === null) {
      lastEmittedKeyRef.current = key;
      return;
    }
    if (lastEmittedKeyRef.current === key) return;
    lastEmittedKeyRef.current = key;
    clearPageLoadedInSession();
    // 跨日界：仅对「昨天」未操作的戒除习惯自动保持戒除并发放未破戒加分
    void import('@/lib/repositories/habits/habit-break-success')
      .then(({ syncBreakHabitCompletions }) => syncBreakHabitCompletions())
      .catch((err) => {
        if (__DEV__) console.warn('[day-boundary] syncBreakHabitCompletions', err);
      });
  }, [boundary, dayClock]);

  const setBoundary = useCallback(async (next: TasksDayBoundary) => {
    await saveConfiguredDayBoundary(next);
    setBoundaryState(next);
    setDayClock((c) => c + 1);
  }, []);

  const setPages = useCallback(async (next: readonly DayBoundaryPageId[]) => {
    await saveDayBoundaryPages(next);
    setPagesState([...next]);
    setDayClock((c) => c + 1);
  }, []);

  const value = useMemo(
    () => ({
      boundary,
      pages,
      logicalTodayYmd,
      logicalTodayDate,
      isReady,
      setBoundary,
      setPages,
      dayClock,
    }),
    [boundary, pages, logicalTodayYmd, logicalTodayDate, isReady, setBoundary, setPages, dayClock],
  );

  return <DayBoundaryContext.Provider value={value}>{children}</DayBoundaryContext.Provider>;
}

function fallbackContext(): DayBoundaryContextValue {
  const boundary = { ...DEFAULT_TASKS_DAY_BOUNDARY };
  const logicalTodayYmd = getLogicalLocalYmd(new Date(), boundary);
  return {
    boundary,
    pages: [...DEFAULT_DAY_BOUNDARY_PAGES],
    logicalTodayYmd,
    logicalTodayDate: logicalYmdToLocalDate(logicalTodayYmd),
    isReady: true,
    setBoundary: async () => {},
    setPages: async () => {},
    dayClock: 0,
  };
}

export function useDayBoundary(): DayBoundaryContextValue {
  const ctx = useContext(DayBoundaryContext);
  return ctx ?? fallbackContext();
}

/** 按页面解析有效日界与逻辑「今天」：未勾选该页则始终 0:00 */
export function usePageDayBoundary(page: DayBoundaryPageId): {
  boundary: TasksDayBoundary;
  logicalTodayYmd: string;
  logicalTodayDate: Date;
  usesCustomBoundary: boolean;
  isReady: boolean;
} {
  const ctx = useDayBoundary();
  const usesCustomBoundary = ctx.pages.includes(page);
  const boundary = useMemo(
    () => (usesCustomBoundary ? ctx.boundary : { ...DEFAULT_TASKS_DAY_BOUNDARY }),
    [usesCustomBoundary, ctx.boundary],
  );
  const logicalTodayYmd = useMemo(
    () => getLogicalLocalYmd(new Date(), boundary),
    [boundary, ctx.dayClock],
  );
  const logicalTodayDate = useMemo(() => logicalYmdToLocalDate(logicalTodayYmd), [logicalTodayYmd]);
  return {
    boundary,
    logicalTodayYmd,
    logicalTodayDate,
    usesCustomBoundary,
    isReady: ctx.isReady,
  };
}
