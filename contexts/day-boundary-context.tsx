import {
  DEFAULT_TASKS_DAY_BOUNDARY,
  getLogicalLocalYmd,
  loadTasksDayBoundary,
  logicalYmdToLocalDate,
  saveTasksDayBoundary,
  subscribeDayBoundary,
  type TasksDayBoundary,
} from '@/lib/tasks-logical-day';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AppState, Platform } from 'react-native';

type DayBoundaryContextValue = {
  boundary: TasksDayBoundary;
  logicalTodayYmd: string;
  /** 逻辑「今天」对应的本地日历日（正午），用于 UI 月日/星期 */
  logicalTodayDate: Date;
  isReady: boolean;
  setBoundary: (boundary: TasksDayBoundary) => Promise<void>;
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

export function DayBoundaryProvider({ children }: { children: React.ReactNode }) {
  const [boundary, setBoundaryState] = useState<TasksDayBoundary>(() => ({ ...DEFAULT_TASKS_DAY_BOUNDARY }));
  const [isReady, setIsReady] = useState(false);
  const [logicalTodayClock, setLogicalTodayClock] = useState(0);

  useEffect(() => {
    let mounted = true;
    void loadTasksDayBoundary().then((b) => {
      if (mounted) {
        setBoundaryState(b);
        setIsReady(true);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    return subscribeDayBoundary(() => {
      void loadTasksDayBoundary().then(setBoundaryState);
    });
  }, []);

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const tick = () => setLogicalTodayClock((c) => c + 1);
    const schedule = () => {
      timeout = setTimeout(() => {
        tick();
        schedule();
      }, msUntilNextBoundaryCrossing(boundary));
    };
    schedule();
    return () => {
      if (timeout) clearTimeout(timeout);
    };
  }, [boundary.hour, boundary.minute]);

  /** 后台过夜后 setTimeout 常被挂起，回到前台时需重新计算逻辑日 */
  useEffect(() => {
    const tick = () => setLogicalTodayClock((c) => c + 1);
    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') tick();
    });
    const onVisibilityChange = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') tick();
    };
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibilityChange);
    }
    return () => {
      appStateSub.remove();
      if (Platform.OS === 'web' && typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibilityChange);
      }
    };
  }, []);

  const logicalTodayYmd = useMemo(
    () => getLogicalLocalYmd(new Date(), boundary),
    [boundary, logicalTodayClock],
  );

  const logicalTodayDate = useMemo(() => logicalYmdToLocalDate(logicalTodayYmd), [logicalTodayYmd]);

  const setBoundary = useCallback(async (next: TasksDayBoundary) => {
    await saveTasksDayBoundary(next);
    setBoundaryState(next);
    setLogicalTodayClock((c) => c + 1);
  }, []);

  const value = useMemo(
    () => ({
      boundary,
      logicalTodayYmd,
      logicalTodayDate,
      isReady,
      setBoundary,
    }),
    [boundary, logicalTodayYmd, logicalTodayDate, isReady, setBoundary],
  );

  return <DayBoundaryContext.Provider value={value}>{children}</DayBoundaryContext.Provider>;
}

export function useDayBoundary(): DayBoundaryContextValue {
  const ctx = useContext(DayBoundaryContext);
  if (!ctx) {
    const boundary = { ...DEFAULT_TASKS_DAY_BOUNDARY };
    const logicalTodayYmd = getLogicalLocalYmd(new Date(), boundary);
    return {
      boundary,
      logicalTodayYmd,
      logicalTodayDate: logicalYmdToLocalDate(logicalTodayYmd),
      isReady: true,
      setBoundary: async () => {},
    };
  }
  return ctx;
}
