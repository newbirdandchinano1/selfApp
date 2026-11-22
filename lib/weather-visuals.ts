/**
 * 天气卡视觉：icon CDN、场景色板、Material 回退图标。
 */
import type { AppIconName } from '@/components/ui/app-icon';
import {
  resolveWeatherSceneKey,
  type WeatherDayPart,
  type WeatherSceneKey,
} from '@/lib/weather-scene';

/**
 * 和风旧版彩色 PNG（S1 color）——现网开源库是单色 SVG，卡面用彩色更直观。
 * @see https://github.com/qwd/WeatherIcon/tree/master/weather-icon-S1
 */
const QWEATHER_COLOR_PNG_CDN =
  'https://cdn.jsdelivr.net/gh/qwd/WeatherIcon@master/weather-icon-S1/color-256';

/** 单色 SVG 兜底（新图标码在 S1 彩色集里可能缺失） */
const QWEATHER_MONO_SVG_CDN =
  'https://cdn.jsdelivr.net/npm/qweather-icons@1.8.0/icons';

/** 场景 → 默认和风图标码（无 icon 字段时） */
const SCENE_DEFAULT_ICON: Record<WeatherSceneKey, string> = {
  clear: '100',
  cloudy: '101',
  overcast: '104',
  rain: '305',
  snow: '400',
  fog: '501',
};

function normalizeWeatherIconCode(icon: string | null | undefined): string | null {
  const code = (icon ?? '').trim();
  if (/^\d{3}$/.test(code)) return code;
  // WeatherAPI 等 4 位码：尽量映射到和风常见码，否则交给场景回退
  if (code === '1000') return '100';
  if (code === '1003' || code === '1006') return '101';
  if (code === '1009') return '104';
  return null;
}

/** 彩色 PNG 主图标 URL */
export function qweatherColorIconUrl(
  icon: string | null | undefined,
  text?: string | null,
): string | null {
  const code =
    normalizeWeatherIconCode(icon) ??
    SCENE_DEFAULT_ICON[resolveWeatherSceneKey({ text, icon })];
  if (!code) return null;
  return `${QWEATHER_COLOR_PNG_CDN}/${code}.png`;
}

/** 单色 SVG 兜底 */
export function qweatherMonoIconUrl(icon: string | null | undefined, filled = true): string | null {
  const code =
    normalizeWeatherIconCode(icon) ??
    SCENE_DEFAULT_ICON[resolveWeatherSceneKey({ text: null, icon })];
  if (!code) return null;
  return `${QWEATHER_MONO_SVG_CDN}/${code}${filled ? '-fill' : ''}.svg`;
}

/** @deprecated 用 qweatherColorIconUrl；保留别名避免旧引用断裂 */
export function qweatherIconUrl(icon: string | null | undefined, _filled = true): string | null {
  return qweatherColorIconUrl(icon);
}

export function weatherSceneFromNow(input: {
  text?: string | null;
  icon?: string | null;
}): WeatherSceneKey {
  return resolveWeatherSceneKey(input);
}

export type WeatherSceneVisual = {
  scene: WeatherSceneKey;
  /** 主插画区底色 */
  wash: string;
  washDeep: string;
  accent: string;
  fallbackIcon: AppIconName;
  label: string;
};

const DAY_VISUAL: Record<WeatherSceneKey, Omit<WeatherSceneVisual, 'scene'>> = {
  clear: {
    wash: '#D8EAF8',
    washDeep: '#F3E2B8',
    accent: '#E8A84A',
    fallbackIcon: 'wb-sunny',
    label: '晴',
  },
  cloudy: {
    wash: '#D5DFEA',
    washDeep: '#E8EEF3',
    accent: '#7A92A8',
    fallbackIcon: 'wb-cloudy',
    label: '多云',
  },
  overcast: {
    wash: '#C9D2D6',
    washDeep: '#DEE4E6',
    accent: '#6E7F86',
    fallbackIcon: 'cloud',
    label: '阴',
  },
  rain: {
    wash: '#C5D7E0',
    washDeep: '#A8C4D2',
    accent: '#4A7C96',
    fallbackIcon: 'umbrella',
    label: '雨',
  },
  snow: {
    wash: '#DCE8F2',
    washDeep: '#EEF4FA',
    accent: '#7FA8C9',
    fallbackIcon: 'ac-unit',
    label: '雪',
  },
  fog: {
    wash: '#D8D6D0',
    washDeep: '#E8E6E0',
    accent: '#8A877C',
    fallbackIcon: 'blur-on',
    label: '雾',
  },
};

const NIGHT_VISUAL: Record<WeatherSceneKey, Omit<WeatherSceneVisual, 'scene'>> = {
  clear: {
    wash: '#1A2740',
    washDeep: '#2A3A58',
    accent: '#E2C07A',
    fallbackIcon: 'nights-stay',
    label: '晴夜',
  },
  cloudy: {
    wash: '#222C38',
    washDeep: '#314050',
    accent: '#8AA0B5',
    fallbackIcon: 'wb-cloudy',
    label: '多云夜',
  },
  overcast: {
    wash: '#1E262B',
    washDeep: '#2C363C',
    accent: '#7A8A92',
    fallbackIcon: 'cloud',
    label: '阴夜',
  },
  rain: {
    wash: '#17252E',
    washDeep: '#243846',
    accent: '#6A9BB0',
    fallbackIcon: 'umbrella',
    label: '雨夜',
  },
  snow: {
    wash: '#1A2433',
    washDeep: '#2A3A4E',
    accent: '#A8C5DE',
    fallbackIcon: 'ac-unit',
    label: '雪夜',
  },
  fog: {
    wash: '#242422',
    washDeep: '#343430',
    accent: '#A09C90',
    fallbackIcon: 'blur-on',
    label: '雾夜',
  },
};

export function weatherSceneVisual(
  scene: WeatherSceneKey,
  dayPart: WeatherDayPart = 'day',
): WeatherSceneVisual {
  const base = dayPart === 'night' ? NIGHT_VISUAL[scene] : DAY_VISUAL[scene];
  return { scene, ...base };
}

/** 无 icon code 时按场景回退 Material 图标 */
export function weatherFallbackIcon(
  text?: string | null,
  icon?: string | null,
): AppIconName {
  return weatherSceneVisual(weatherSceneFromNow({ text, icon })).fallbackIcon;
}
