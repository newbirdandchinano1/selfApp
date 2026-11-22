/**
 * 外部 API 网关：天气 / 星座运势
 * 对齐 self_app_back routes/app/external.ts
 */
import { APP_API_PREFIX, apiRequest } from '@/lib/api/http';

function buildQuery(params: Record<string, string | number | boolean | null | undefined>): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === '') continue;
    if (typeof value === 'boolean') {
      qs.set(key, value ? 'true' : 'false');
      continue;
    }
    qs.set(key, String(value));
  }
  const text = qs.toString();
  return text ? `?${text}` : '';
}

export type ExternalWeatherLocation = {
  lat: number;
  lng: number;
  label: string | null;
};

export type ExternalWeatherNow = {
  time: string | null;
  text: string | null;
  icon: string | null;
  temp: number | null;
  feelsLike: number | null;
  humidityPct: number | null;
  windDir: string | null;
  windScale: number | null;
  windSpeed: number | null;
  precipMm: number | null;
  pressure: number | null;
  visibilityKm: number | null;
  uvIndex: number | null;
  cloudCoverPct: number | null;
};

export type ExternalWeatherDailyItem = {
  date: string | null;
  sunrise: string | null;
  sunset: string | null;
  tempMax: number | null;
  tempMin: number | null;
  textDay: string | null;
  iconDay: string | null;
  textNight: string | null;
  iconNight: string | null;
  precipMm: number | null;
  precipProb: number | null;
  uvIndexMax: number | null;
  humidityPct: number | null;
  windDir: string | null;
  windScale: number | null;
};

export type ExternalWeatherHourlyItem = {
  time: string | null;
  text: string | null;
  icon: string | null;
  temp: number | null;
  feelsLike: number | null;
  humidityPct: number | null;
  windDir: string | null;
  windScale: number | null;
  precipMm: number | null;
  precipProb: number | null;
  uvIndex: number | null;
};

export type ExternalWeatherAir = {
  aqi: number | null;
  aqiDisplay: string | null;
  level: string | null;
  category: string | null;
  primaryPollutant: string | null;
  healthEffect: string | null;
  adviceGeneral: string | null;
  adviceSensitive: string | null;
  pollutants: Array<{
    code: string;
    name: string;
    value: number | null;
    unit: string | null;
  }>;
};

export type ExternalWeatherSummary = {
  location: ExternalWeatherLocation;
  now: ExternalWeatherNow;
  daily: ExternalWeatherDailyItem[];
  hourly: ExternalWeatherHourlyItem[];
  air: ExternalWeatherAir;
};

export type ExternalHoroscopeSign = {
  code: string;
  name: string;
};

export type ExternalHoroscopeDayLike = {
  time: string | null;
  summaryStar: number | null;
  loveStar: number | null;
  workStar: number | null;
  moneyStar: number | null;
  luckyNum: string | null;
  luckyColor: string | null;
  luckyDirection: string | null;
  luckyTime: string | null;
  notice: string | null;
  nobleSign: string | null;
  general: string | null;
  love: string | null;
  work: string | null;
  money: string | null;
};

export type ExternalHoroscopeWeek = ExternalHoroscopeDayLike & {
  luckyDay: string | null;
  rivalSign: string | null;
  weekNotice: string | null;
  health: string | null;
};

export type ExternalHoroscopeMonth = ExternalHoroscopeDayLike & {
  matchSign: string | null;
  rivalSign: string | null;
  advantage: string | null;
  weakness: string | null;
};

export type ExternalHoroscopeYear = {
  time: string | null;
  oneword: string | null;
  generalIndex: number | null;
  loveIndex: number | null;
  workIndex: number | null;
  moneyIndex: number | null;
  general: string | null;
  love: string | null;
  work: string | null;
  money: string | null;
  health: string | null;
};

export type ExternalHoroscopeResult = {
  sign: ExternalHoroscopeSign;
  day: ExternalHoroscopeDayLike | null;
  tomorrow: ExternalHoroscopeDayLike | null;
  week: ExternalHoroscopeWeek | null;
  month: ExternalHoroscopeMonth | null;
  year: ExternalHoroscopeYear | null;
};

/** GET /api/app/external/weather — 实时 + 逐日 + 逐时 + 空气 */
export async function apiExternalWeatherSummary(params?: {
  lat?: number;
  lng?: number;
  label?: string;
  days?: number;
  hours?: number;
  signal?: AbortSignal;
}): Promise<ExternalWeatherSummary> {
  return apiRequest<ExternalWeatherSummary>(
    `${APP_API_PREFIX}/external/weather${buildQuery({
      lat: params?.lat,
      lng: params?.lng,
      label: params?.label,
      days: params?.days ?? 7,
      hours: params?.hours ?? 24,
    })}`,
    {
      method: 'GET',
      signal: params?.signal,
      skipGlobalLoading: true,
      /** 附属通道：不与页面主数据抢并发槽 */
      skipQueue: true,
    },
  );
}

/** GET /api/app/external/horoscope — scopes 默认 day,tomorrow */
export async function apiExternalHoroscope(params: {
  star: string;
  scopes?: string;
  signal?: AbortSignal;
}): Promise<ExternalHoroscopeResult> {
  return apiRequest<ExternalHoroscopeResult>(
    `${APP_API_PREFIX}/external/horoscope${buildQuery({
      star: params.star,
      scopes: params.scopes ?? 'day,tomorrow',
    })}`,
    {
      method: 'GET',
      signal: params.signal,
      skipGlobalLoading: true,
      /** 附属通道：不与页面主数据抢并发槽 */
      skipQueue: true,
    },
  );
}
