/**
 * Meteocons 动态天气图：场景 → Lottie slug / CDN URL（MIT）。
 * @see https://github.com/basmilius/meteocons
 */
import type { WeatherDayPart, WeatherSceneKey } from '@/lib/weather-scene';

const METEOCONS_LOTTIE_CDN =
  'https://cdn.jsdelivr.net/npm/@meteocons/lottie@0.1.0/fill';

/** scene × day/night → meteocons fill slug */
export function meteoconSlugForScene(
  scene: WeatherSceneKey,
  dayPart: WeatherDayPart = 'day',
): string {
  const night = dayPart === 'night';
  switch (scene) {
    case 'clear':
      return night ? 'clear-night' : 'clear-day';
    case 'cloudy':
      return night ? 'partly-cloudy-night' : 'partly-cloudy-day';
    case 'overcast':
      return night ? 'overcast-night' : 'overcast-day';
    case 'rain':
      return night ? 'partly-cloudy-night-rain' : 'partly-cloudy-day-rain';
    case 'snow':
      return 'snow';
    case 'fog':
      return night ? 'fog-night' : 'fog-day';
    default:
      return night ? 'partly-cloudy-night' : 'partly-cloudy-day';
  }
}

export function meteoconLottieUrl(
  scene: WeatherSceneKey,
  dayPart: WeatherDayPart = 'day',
): string {
  return `${METEOCONS_LOTTIE_CDN}/${meteoconSlugForScene(scene, dayPart)}.json`;
}
