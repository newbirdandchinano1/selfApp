/**
 * 订阅天气 summary store；首次调用会 ensure 启动拉取。
 */
import {
  ensureWeatherSummaryStarted,
  getWeatherSummaryState,
  refreshWeatherSummary,
  subscribeWeatherSummary,
  type WeatherSummaryState,
} from '@/lib/weather-summary-store';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

export function useWeatherSummary(): WeatherSummaryState & {
  refresh: (force?: boolean) => Promise<void>;
} {
  const state = useSyncExternalStore(
    subscribeWeatherSummary,
    getWeatherSummaryState,
    getWeatherSummaryState,
  );

  useEffect(() => {
    ensureWeatherSummaryStarted();
  }, []);

  const refresh = useCallback(async (force = true) => {
    await refreshWeatherSummary({ force });
  }, []);

  return { ...state, refresh };
}

/** 仅在需要强制重拉时用（如下拉 refreshToken） */
export function useWeatherSummaryRefreshOnToken(refreshToken: number): void {
  const [prev, setPrev] = useState(refreshToken);
  useEffect(() => {
    if (refreshToken === prev) return;
    setPrev(refreshToken);
    void refreshWeatherSummary({ force: true });
  }, [prev, refreshToken]);
}
