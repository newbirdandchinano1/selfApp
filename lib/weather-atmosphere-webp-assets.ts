/**
 * 天气场景 → weather-atmosphere/*.webp 动图资源（设置面板选景 id 沿用）。
 */
import type { WeatherSceneKey } from '@/lib/weather-scene';

export type WeatherAtmosphereWebpId =
  | 'sunny'
  | 'cloudy'
  | 'overcast'
  | 'fog'
  | 'rain-light'
  | 'rain'
  | 'rain-heavy'
  | 'snow'
  | 'thunderstorm';

/** 手动选择 / 跟随天气 */
export type WeatherAtmosphereWebpPick = 'auto' | WeatherAtmosphereWebpId;

export const WEATHER_ATMOSPHERE_WEBP_IDS: readonly WeatherAtmosphereWebpId[] = [
  'sunny',
  'cloudy',
  'overcast',
  'fog',
  'rain-light',
  'rain',
  'rain-heavy',
  'snow',
  'thunderstorm',
] as const;

export const WEATHER_ATMOSPHERE_WEBP_LABELS: Record<WeatherAtmosphereWebpId, string> = {
  sunny: '晴',
  cloudy: '多云',
  overcast: '阴',
  fog: '雾',
  'rain-light': '小雨',
  rain: '中雨',
  'rain-heavy': '暴雨',
  snow: '雪',
  thunderstorm: '雷暴',
};

export function isWeatherAtmosphereWebpId(value: unknown): value is WeatherAtmosphereWebpId {
  return (
    typeof value === 'string' &&
    (WEATHER_ATMOSPHERE_WEBP_IDS as readonly string[]).includes(value)
  );
}

export function isWeatherAtmosphereWebpPick(value: unknown): value is WeatherAtmosphereWebpPick {
  return value === 'auto' || isWeatherAtmosphereWebpId(value);
}

const WEBP_SOURCES: Record<WeatherAtmosphereWebpId, number> = {
  sunny: require('../assets/weather-atmosphere/sunny.webp'),
  cloudy: require('../assets/weather-atmosphere/cloudy.webp'),
  overcast: require('../assets/weather-atmosphere/overcast.webp'),
  fog: require('../assets/weather-atmosphere/fog.webp'),
  'rain-light': require('../assets/weather-atmosphere/rain-light.webp'),
  rain: require('../assets/weather-atmosphere/rain.webp'),
  // 暂无独立暴雨素材，复用 rain 动图（主路径已切 Skia）
  'rain-heavy': require('../assets/weather-atmosphere/rain.webp'),
  snow: require('../assets/weather-atmosphere/snow.webp'),
  thunderstorm: require('../assets/weather-atmosphere/thunderstorm.webp'),
};

export function weatherAtmosphereWebpSource(id: WeatherAtmosphereWebpId): number {
  return WEBP_SOURCES[id];
}

function isThunderstorm(input: { text?: string | null; icon?: string | null }): boolean {
  const text = (input.text ?? '').trim().toLowerCase();
  if (/雷|thunder|storm/.test(text)) return true;
  const icon = (input.icon ?? '').trim();
  const n = Number(icon);
  // 和风：302–304 雷阵雨 / 雷暴常见码
  if (Number.isFinite(n) && n >= 302 && n <= 304) return true;
  if (icon === '1087' || icon === '1273' || icon === '1276') return true;
  return false;
}

/**
 * 按当前天气文案 / 图标 / 降水量选择 WebP。
 * 未识别场景时回退 cloudy。
 */
export function resolveWeatherAtmosphereWebpId(input: {
  scene?: WeatherSceneKey | null;
  text?: string | null;
  icon?: string | null;
  precipMm?: number | null;
}): WeatherAtmosphereWebpId {
  const scene = input.scene ?? 'cloudy';

  if (scene === 'clear') return 'sunny';
  if (scene === 'cloudy') return 'cloudy';
  if (scene === 'overcast') return 'overcast';
  if (scene === 'fog') return 'fog';
  if (scene === 'snow') return 'snow';

  if (scene === 'rain') {
    if (isThunderstorm({ text: input.text, icon: input.icon })) return 'thunderstorm';
    const text = (input.text ?? '').trim().toLowerCase();
    if (/暴雨|大暴雨|特大暴雨|倾盆|torrential|heavy\s*rain|downpour/.test(text)) {
      return 'rain-heavy';
    }
    if (/中雨|moderate\s*rain/.test(text)) return 'rain';
    if (/小雨|毛毛雨|细雨|drizzle|light\s*rain/.test(text)) return 'rain-light';

    const precip = input.precipMm;
    if (precip != null && Number.isFinite(precip)) {
      if (precip >= 8) return 'rain-heavy';
      if (precip >= 2.5) return 'rain';
      return 'rain-light';
    }
    return 'rain';
  }

  return 'cloudy';
}
