/**
 * 氛围特效解析：雨强 / 雷暴 / 天体 / 星空（独立于 WeatherSceneKey 天空色板）。
 */
import type { WeatherAtmosphereWebpPick } from '@/lib/weather-atmosphere-webp-assets';
import type { WeatherSceneKey } from '@/lib/weather-scene';

export type RainIntensity = 'light' | 'moderate' | 'heavy';

/** sun=白天太阳；moon=夜间晴月；null=无日月 */
export type CelestialKind = 'sun' | 'moon' | null;

export type AtmosphereFx = {
  rainIntensity: RainIntensity | null;
  thunderstorm: boolean;
  celestial: CelestialKind;
  /** 夜间星空（晴夜+多云/阴夜） */
  showStars: boolean;
  mistKind: 'cloud' | 'fog' | null;
};

function isThunderstorm(input: { text?: string | null; icon?: string | null }): boolean {
  const text = (input.text ?? '').trim().toLowerCase();
  if (/雷|thunder|storm/.test(text)) return true;
  const icon = (input.icon ?? '').trim();
  const n = Number(icon);
  if (Number.isFinite(n) && n >= 302 && n <= 304) return true;
  if (icon === '1087' || icon === '1273' || icon === '1276') return true;
  return false;
}

/** 文案优先，其次降水量 */
export function resolveRainIntensity(input: {
  text?: string | null;
  precipMm?: number | null;
}): RainIntensity {
  const text = (input.text ?? '').trim().toLowerCase();
  if (/暴雨|大暴雨|特大暴雨|倾盆|torrential|violent\s*rain|heavy\s*rain|downpour/.test(text)) {
    return 'heavy';
  }
  if (/中雨|moderate\s*rain/.test(text)) return 'moderate';
  if (/小雨|毛毛雨|细雨|drizzle|light\s*rain|light\s*drizzle/.test(text)) {
    return 'light';
  }

  const precip = input.precipMm;
  if (precip != null && Number.isFinite(precip)) {
    if (precip >= 8) return 'heavy';
    if (precip >= 2.5) return 'moderate';
    return 'light';
  }
  return 'moderate';
}

/**
 * periodHint：'night' 时晴天出月亮+星，多云出星无月；
 * 白天晴天出太阳。未传时按 scene 给默认（晴=太阳，星由调用方按时段再开）。
 */
export function resolveAtmosphereFx(input: {
  scene: WeatherSceneKey;
  pick?: WeatherAtmosphereWebpPick | null;
  text?: string | null;
  icon?: string | null;
  precipMm?: number | null;
  /** day / night / dusk */
  period?: 'day' | 'dusk' | 'night' | null;
}): AtmosphereFx {
  const pick = input.pick ?? 'auto';
  const isNight = input.period === 'night';

  const fxForScene = (scene: WeatherSceneKey): AtmosphereFx => {
    if (scene === 'clear') {
      return {
        rainIntensity: null,
        thunderstorm: false,
        celestial: isNight ? 'moon' : 'sun',
        showStars: isNight,
        mistKind: null,
      };
    }
    if (scene === 'cloudy') {
      return {
        rainIntensity: null,
        thunderstorm: false,
        // 白天多云：太阳 + 云；夜间多云：只有星 + 云（无月）
        celestial: isNight ? null : 'sun',
        showStars: isNight,
        mistKind: 'cloud',
      };
    }
    if (scene === 'overcast') {
      return {
        rainIntensity: null,
        thunderstorm: false,
        celestial: null,
        showStars: isNight,
        mistKind: 'cloud',
      };
    }
    if (scene === 'fog') {
      return {
        rainIntensity: null,
        thunderstorm: false,
        celestial: null,
        showStars: false,
        mistKind: 'fog',
      };
    }
    if (scene === 'rain') {
      const thunder = isThunderstorm({ text: input.text, icon: input.icon });
      return {
        rainIntensity: thunder ? 'heavy' : resolveRainIntensity(input),
        thunderstorm: thunder,
        celestial: null,
        showStars: false,
        mistKind: 'cloud',
      };
    }
    if (scene === 'snow') {
      return {
        rainIntensity: null,
        thunderstorm: false,
        celestial: null,
        showStars: false,
        mistKind: null,
      };
    }
    return {
      rainIntensity: null,
      thunderstorm: false,
      celestial: null,
      showStars: isNight,
      mistKind: 'cloud',
    };
  };

  if (pick !== 'auto') {
    switch (pick) {
      case 'sunny':
        return fxForScene('clear');
      case 'cloudy':
        return fxForScene('cloudy');
      case 'overcast':
        return fxForScene('overcast');
      case 'fog':
        return fxForScene('fog');
      case 'rain-light':
        return {
          rainIntensity: 'light',
          thunderstorm: false,
          celestial: null,
          showStars: false,
          mistKind: 'cloud',
        };
      case 'rain':
        return {
          rainIntensity: 'moderate',
          thunderstorm: false,
          celestial: null,
          showStars: false,
          mistKind: 'cloud',
        };
      case 'rain-heavy':
        return {
          rainIntensity: 'heavy',
          thunderstorm: false,
          celestial: null,
          showStars: false,
          mistKind: 'cloud',
        };
      case 'thunderstorm':
        return {
          rainIntensity: 'heavy',
          thunderstorm: true,
          celestial: null,
          showStars: false,
          mistKind: 'cloud',
        };
      case 'snow':
        return fxForScene('snow');
      default:
        break;
    }
  }

  return fxForScene(input.scene);
}
