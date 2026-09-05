import { formatLocalYmdFromDate, logicalYmdToLocalDate } from '@/lib/tasks-logical-day';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';

function msUntilNextLocalMidnight(): number {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  return Math.max(1000, next.getTime() - now.getTime() + 50);
}

/**
 * 自然日历「今天」（本地 0:00 翻日）。
 * 若页面需跟随侧边栏「日界作用页面」开关，请改用 `usePageDayBoundary(page)`。
 */
export function useCalendarToday(): { calendarTodayYmd: string; calendarTodayDate: Date } {
  const [clock, setClock] = useState(0);
  const lastYmdRef = useRef<string | null>(null);

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const bump = () => setClock((c) => c + 1);

    const schedule = () => {
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(() => {
        bump();
        schedule();
      }, msUntilNextLocalMidnight());
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
      const ymd = formatLocalYmdFromDate(new Date());
      if (lastYmdRef.current != null && lastYmdRef.current !== ymd) {
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
  }, []);

  const calendarTodayYmd = useMemo(() => formatLocalYmdFromDate(new Date()), [clock]);
  const calendarTodayDate = useMemo(() => logicalYmdToLocalDate(calendarTodayYmd), [calendarTodayYmd]);

  useEffect(() => {
    lastYmdRef.current = calendarTodayYmd;
  }, [calendarTodayYmd]);

  return { calendarTodayYmd, calendarTodayDate };
}
