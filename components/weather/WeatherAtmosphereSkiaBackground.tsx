/**
 * 主 Tab Skia 天气氛围背景。
 * 开关与选景复用原氛围 settings（原 WebP 键），auto 跟真实天气。
 */
import { WeatherBackground } from '@/features/weather-atmosphere/renderer/WeatherBackground';
import { useWeatherAtmosphereState } from '@/features/weather-atmosphere/hooks/useWeatherAtmosphereState';
import {
  useWeatherAtmosphereWebpBgEnabled,
  useWeatherAtmosphereWebpPick,
} from '@/hooks/use-weather-atmosphere-webp';
import { weatherAtmospherePickToScene } from '@/lib/weather-atmosphere-pick-to-scene';
import React, { memo, useMemo } from 'react';
import { StyleSheet } from 'react-native';

export type WeatherAtmosphereSkiaBackgroundProps = {
  /** 若传入则覆盖 settings 开关 */
  enabled?: boolean;
  gyroParallax?: boolean;
  particlesEnabled?: boolean;
};

function WeatherAtmosphereSkiaBackgroundInner({
  enabled: enabledProp,
  gyroParallax = true,
  particlesEnabled = true,
}: WeatherAtmosphereSkiaBackgroundProps) {
  const settingsEnabled = useWeatherAtmosphereWebpBgEnabled();
  const pick = useWeatherAtmosphereWebpPick();
  const enabled = enabledProp ?? settingsEnabled;

  const sceneOverride = useMemo(() => weatherAtmospherePickToScene(pick), [pick]);
  const state = useWeatherAtmosphereState({ sceneOverride, pick });

  if (!enabled) return null;

  return (
    <WeatherBackground
      style={StyleSheet.absoluteFill}
      scene={state.scene}
      period={state.period}
      isDark={state.isDark}
      windSpeed={state.windSpeed}
      rainIntensity={state.rainIntensity}
      thunderstorm={state.thunderstorm}
      celestial={state.celestial}
      showStars={state.showStars}
      mistKind={state.mistKind}
      gyroParallax={gyroParallax}
      particlesEnabled={particlesEnabled}
      readabilityMask={false}
      debugShowSize={false}
    />
  );
}

export const WeatherAtmosphereSkiaBackground = memo(WeatherAtmosphereSkiaBackgroundInner);
