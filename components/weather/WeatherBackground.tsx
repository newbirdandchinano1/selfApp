/**
 * 薄封装：对外挂载入口，实现落在 features/weather-atmosphere。
 */
export {
  WeatherBackground,
  type WeatherBackgroundProps,
} from '@/features/weather-atmosphere/renderer/WeatherBackground';

export {
  getSkyPalette,
  resolveAtmospherePeriod,
  type AtmospherePeriod,
} from '@/features/weather-atmosphere/config/sky-palette';

export { useWeatherAtmosphereState } from '@/features/weather-atmosphere/hooks/useWeatherAtmosphereState';
export { WeatherAtmosphereSkiaBackground } from '@/components/weather/WeatherAtmosphereSkiaBackground';
