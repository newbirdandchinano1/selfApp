/**
 * 订阅天气氛围 WebP 背景开关与选图。
 */
import type { WeatherAtmosphereWebpPick } from '@/lib/weather-atmosphere-webp-assets';
import {
  ensureWeatherAtmosphereWebpBgHydrated,
  getWeatherAtmosphereWebpBgEnabledSync,
  getWeatherAtmosphereWebpPickSync,
  saveWeatherAtmosphereWebpBgEnabled,
  saveWeatherAtmosphereWebpPick,
  subscribeWeatherAtmosphereWebpBg,
} from '@/lib/weather-atmosphere-webp-settings';
import { useCallback, useEffect, useSyncExternalStore } from 'react';

function useWeatherAtmosphereWebpStore(): {
  enabled: boolean;
  pick: WeatherAtmosphereWebpPick;
} {
  useEffect(() => {
    void ensureWeatherAtmosphereWebpBgHydrated();
  }, []);

  const enabled = useSyncExternalStore(
    subscribeWeatherAtmosphereWebpBg,
    getWeatherAtmosphereWebpBgEnabledSync,
    getWeatherAtmosphereWebpBgEnabledSync,
  );
  const pick = useSyncExternalStore(
    subscribeWeatherAtmosphereWebpBg,
    getWeatherAtmosphereWebpPickSync,
    getWeatherAtmosphereWebpPickSync,
  );
  return { enabled, pick };
}

export function useWeatherAtmosphereWebpBgEnabled(): boolean {
  return useWeatherAtmosphereWebpStore().enabled;
}

export function useWeatherAtmosphereWebpPick(): WeatherAtmosphereWebpPick {
  return useWeatherAtmosphereWebpStore().pick;
}

export function useWeatherAtmosphereWebpBgSetting(): {
  enabled: boolean;
  pick: WeatherAtmosphereWebpPick;
  setEnabled: (next: boolean) => Promise<void>;
  setPick: (next: WeatherAtmosphereWebpPick) => Promise<void>;
} {
  const { enabled, pick } = useWeatherAtmosphereWebpStore();
  const setEnabled = useCallback(async (next: boolean) => {
    await saveWeatherAtmosphereWebpBgEnabled(next);
  }, []);
  const setPick = useCallback(async (next: WeatherAtmosphereWebpPick) => {
    await saveWeatherAtmosphereWebpPick(next);
  }, []);
  return { enabled, pick, setEnabled, setPick };
}
