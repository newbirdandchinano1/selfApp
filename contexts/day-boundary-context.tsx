import {
  DEFAULT_TASKS_DAY_BOUNDARY,
  getLogicalLocalYmd,
  loadTasksDayBoundary,
  logicalYmdToLocalDate,
  saveTasksDayBoundary,
  subscribeDayBoundary,
  type TasksDayBoundary,
} from '@/lib/tasks-logical-day';
import { clearPageLoadedInSession } from '@/lib/page-api-session';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
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
  const lastEmittedYmdRef = useRef<string | null>(null);

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

  /**
   * 逻辑日时钟：定时跨日界 + 回到前台时强制重算。
   * 后台过夜后 setTimeout 常被系统挂起/丢弃，必须在 active 时 bump 并重新 schedule。
   */
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const bump = () => setLogicalTodayClock((c) => c + 1);

    const schedule = () => {
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(() => {
        bump();
        schedule();
      }, msUntilNextBoundaryCrossing(boundary));
    };

    const onForeground = () => {
      bump();
      schedule();
    };

    schedule();

    const appStateSub = AppState.addEventListener('change', (next) => {
      // 每次进入前台都重算并重新 schedule（后台过夜后 timer 不可靠）
      if (next === 'active') onForeground();
    });

    // 兜底：部分机型恢复前台时可能漏发 AppState；冻结解除后 interval 会补上跨日
    const pollId = setInterval(() => {
      const ymd = getLogicalLocalYmd(new Date(), boundary);
      if (lastEmittedYmdRef.current != null && lastEmittedYmdRef.current !== ymd) {
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

  const logicalTodayYmd = useMemo(
    () => getLogicalLocalYmd(new Date(), boundary),
    [boundary, logicalTodayClock],
  );

  const logicalTodayDate = useMemo(() => logicalYmdToLocalDate(logicalTodayYmd), [logicalTodayYmd]);

  /** 进程内跨逻辑日：清会话加载标记，使各 Tab 下次聚焦会重读数据 */
  useEffect(() => {
    if (lastEmittedYmdRef.current === null) {
      lastEmittedYmdRef.current = logicalTodayYmd;
      return;
    }
    if (lastEmittedYmdRef.current === logicalTodayYmd) return;
    lastEmittedYmdRef.current = logicalTodayYmd;
    clearPageLoadedInSession();
  }, [logicalTodayYmd]);

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
