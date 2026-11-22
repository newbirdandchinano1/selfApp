/**
 * 把真实天气 summary + App 主题接到氛围引擎输入。
 */
import type { AtmospherePeriod } from '@/features/weather-atmosphere/config/sky-palette';
import { resolveAtmospherePeriod } from '@/features/weather-atmosphere/config/sky-palette';
import { useAppTheme } from '@/hooks/use-app-theme';
import { useWeatherSummary } from '@/hooks/use-weather-summary';
import {
  resolveAtmosphereFx,
  type AtmosphereFx,
  type CelestialKind,
  type RainIntensity,
} from '@/lib/weather-atmosphere-effects';
import type { WeatherAtmosphereWebpPick } from '@/lib/weather-atmosphere-webp-assets';
import {
  resolveWeatherDayPart,
  type WeatherSceneKey,
} from '@/lib/weather-scene';
import { useMemo } from 'react';

export type WeatherAtmosphereState = {
  scene: WeatherSceneKey;
  period: AtmospherePeriod;
  isDark: boolean;
  /** 约 px/s，供粒子水平偏移 */
  windSpeed: number;
  rainIntensity: RainIntensity | null;
  thunderstorm: boolean;
  celestial: CelestialKind;
  showStars: boolean;
  mistKind: AtmosphereFx['mistKind'];
  temp: number | null;
  cityLabel: string | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
};

/**
 * windSpeed(m/s 或 API 原值) → 粒子水平 px/s。
 * 缺省时用 windScale 粗估。
 */
function mapWindToPxPerSec(input: {
  windSpeed?: number | null;
  windScale?: number | null;
}): number {
  const speed = input.windSpeed;
  if (speed != null && Number.isFinite(speed)) {
    return Math.max(-80, Math.min(80, speed * 6));
  }
  const scale = input.windScale;
  if (scale != null && Number.isFinite(scale)) {
    return Math.max(-80, Math.min(80, scale * 8));
  }
  return 0;
}

export function useWeatherAtmosphereState(options?: {
  /** 覆盖自动场景（调试） */
  sceneOverride?: WeatherSceneKey | null;
  /** 覆盖时段；默认仅 day/night 跟主题 */
  periodOverride?: AtmospherePeriod | null;
  /** 设置面板选景（含雨强/雷暴） */
  pick?: WeatherAtmosphereWebpPick | null;
}): WeatherAtmosphereState {
  const { isDark, scheme } = useAppTheme();
  const { summary, scene, location, status } = useWeatherSummary();

  return useMemo(() => {
    const resolvedScene: WeatherSceneKey =
      options?.sceneOverride ?? scene ?? 'cloudy';
    const dayPart = resolveWeatherDayPart(scheme === 'dark' ? 'dark' : 'light');
    const period = resolveAtmospherePeriod(
      dayPart === 'night' ? 'dark' : 'light',
      options?.periodOverride,
    );
    const windSpeed = mapWindToPxPerSec({
      windSpeed: summary?.now?.windSpeed,
      windScale: summary?.now?.windScale,
    });

    const fx = resolveAtmosphereFx({
      scene: resolvedScene,
      pick: options?.pick,
      text: summary?.now?.text,
      icon: summary?.now?.icon,
      precipMm: summary?.now?.precipMm,
      period,
    });

    return {
      scene: resolvedScene,
      period,
      isDark,
      windSpeed,
      rainIntensity: fx.rainIntensity,
      thunderstorm: fx.thunderstorm,
      celestial: fx.celestial,
      showStars: fx.showStars,
      mistKind: fx.mistKind,
      temp: summary?.now?.temp ?? null,
      cityLabel: location?.label ?? summary?.location?.label ?? null,
      status,
    };
  }, [
    options?.sceneOverride,
    options?.periodOverride,
    options?.pick,
    scene,
    scheme,
    isDark,
    summary?.now?.windSpeed,
    summary?.now?.windScale,
    summary?.now?.temp,
    summary?.now?.text,
    summary?.now?.icon,
    summary?.now?.precipMm,
    summary?.location?.label,
    location?.label,
    status,
  ]);
}
