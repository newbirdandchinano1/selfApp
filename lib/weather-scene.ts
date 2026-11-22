/**
 * 天气文案 / icon → 场景 key（纯函数，供天气卡视觉映射）。
 */

export type WeatherSceneKey =
  | 'clear'
  | 'cloudy'
  | 'overcast'
  | 'rain'
  | 'snow'
  | 'fog';

/** light → day，dark → night（跟 App 主题，不跟日出日落） */
export type WeatherDayPart = 'day' | 'night';

export const WEATHER_SCENE_KEYS: readonly WeatherSceneKey[] = [
  'clear',
  'cloudy',
  'overcast',
  'rain',
  'snow',
  'fog',
] as const;

export function isWeatherSceneKey(value: unknown): value is WeatherSceneKey {
  return typeof value === 'string' && (WEATHER_SCENE_KEYS as readonly string[]).includes(value);
}

export function resolveWeatherDayPart(scheme: 'light' | 'dark'): WeatherDayPart {
  return scheme === 'dark' ? 'night' : 'day';
}

/** 和风图标码（常见区间）→ 场景 */
const QWEATHER_ICON_SCENE: Record<string, WeatherSceneKey> = {
  '100': 'clear',
  '150': 'clear',
  '101': 'cloudy',
  '102': 'cloudy',
  '103': 'cloudy',
  '151': 'cloudy',
  '152': 'cloudy',
  '153': 'cloudy',
  '104': 'overcast',
};

/** WeatherAPI / 部分网关 condition.code */
const WEATHERAPI_CODE_SCENE: Record<string, WeatherSceneKey> = {
  '1000': 'clear',
  '1003': 'cloudy',
  '1006': 'cloudy',
  '1009': 'overcast',
  '1030': 'fog',
  '1135': 'fog',
  '1147': 'fog',
  '1063': 'rain',
  '1066': 'snow',
  '1069': 'snow',
  '1072': 'rain',
  '1087': 'rain',
  '1114': 'snow',
  '1117': 'snow',
  '1150': 'rain',
  '1153': 'rain',
  '1168': 'rain',
  '1171': 'rain',
  '1180': 'rain',
  '1183': 'rain',
  '1186': 'rain',
  '1189': 'rain',
  '1192': 'rain',
  '1195': 'rain',
  '1198': 'rain',
  '1201': 'rain',
  '1204': 'snow',
  '1207': 'snow',
  '1210': 'snow',
  '1213': 'snow',
  '1216': 'snow',
  '1219': 'snow',
  '1222': 'snow',
  '1225': 'snow',
  '1237': 'snow',
  '1240': 'rain',
  '1243': 'rain',
  '1246': 'rain',
  '1249': 'snow',
  '1252': 'snow',
  '1255': 'snow',
  '1258': 'snow',
  '1261': 'snow',
  '1264': 'snow',
  '1273': 'rain',
  '1276': 'rain',
  '1279': 'snow',
  '1282': 'snow',
};

function normalizeText(raw: string | null | undefined): string {
  return (raw ?? '').trim().toLowerCase();
}

function normalizeIcon(raw: string | null | undefined): string {
  return (raw ?? '').trim();
}

/**
 * 优先匹配 `text` 中英关键词，其次 `icon`（和风 / WeatherAPI code）。
 * 未识别 → `cloudy`（中性），不抛错。
 */
export function resolveWeatherSceneKey(input: {
  text?: string | null;
  icon?: string | null;
}): WeatherSceneKey {
  const text = normalizeText(input.text);
  if (text) {
    // 雪优先于雨（雨夹雪 / sleet）
    if (
      /雪|冰雹|雨夹雪|sleet|snow|blizzard|ice\s*pellet|freezing\s*drizzle/.test(text)
    ) {
      return 'snow';
    }
    if (
      /雷|雨|阵雨|冻雨|drizzle|rain|shower|thunder|storm/.test(text) &&
      !/无雨|无降水/.test(text)
    ) {
      return 'rain';
    }
    if (/雾|霾|沙|尘|烟|mist|fog|haze|sand|dust|smoke/.test(text)) {
      return 'fog';
    }
    if (/阴|overcast/.test(text)) {
      return 'overcast';
    }
    if (/多云|少云|晴间多云|partly\s*cloud|mostly\s*cloud|cloud/.test(text)) {
      return 'cloudy';
    }
    if (/晴|热|clear|sunny|hot|fair/.test(text)) {
      return 'clear';
    }
  }

  const icon = normalizeIcon(input.icon);
  if (icon) {
    if (QWEATHER_ICON_SCENE[icon]) return QWEATHER_ICON_SCENE[icon];
    if (WEATHERAPI_CODE_SCENE[icon]) return WEATHERAPI_CODE_SCENE[icon];

    const n = Number(icon);
    if (Number.isFinite(n)) {
      // 和风：300–399 雨/雷，400–499 雪，500–515 雾霾沙尘
      if (n >= 300 && n < 400) return 'rain';
      if (n >= 400 && n < 500) return 'snow';
      if (n >= 500 && n <= 515) return 'fog';
    }
  }

  return 'cloudy';
}
