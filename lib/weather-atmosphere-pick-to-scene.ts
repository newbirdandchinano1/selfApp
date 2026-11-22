/**
 * 设置面板「氛围选景」→ Skia WeatherSceneKey。
 * 沿用原 WebP pick id，避免改设置存储。
 */
import type { WeatherAtmosphereWebpPick } from '@/lib/weather-atmosphere-webp-assets';
import type { WeatherSceneKey } from '@/lib/weather-scene';

export function weatherAtmospherePickToScene(
  pick: WeatherAtmosphereWebpPick,
): WeatherSceneKey | null {
  if (pick === 'auto') return null;
  switch (pick) {
    case 'sunny':
      return 'clear';
    case 'cloudy':
      return 'cloudy';
    case 'overcast':
      return 'overcast';
    case 'fog':
      return 'fog';
    case 'rain-light':
    case 'rain':
    case 'rain-heavy':
    case 'thunderstorm':
      return 'rain';
    case 'snow':
      return 'snow';
    default:
      return null;
  }
}
