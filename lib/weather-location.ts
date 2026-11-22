/**
 * 天气位置解析：手动经纬度优先，否则 GPS，再回落成都。
 */
import * as Location from 'expo-location';
import { AppSettingKey, getAppSetting, setAppSetting } from '@/lib/app-settings-store';

export type WeatherLocationMode = 'auto' | 'manual';

export type WeatherLocationSettings = {
  mode: WeatherLocationMode;
  /** 展示用城市名（可选） */
  label: string;
  lat: number | null;
  lng: number | null;
};

export type ResolvedWeatherLocation = {
  lat: number;
  lng: number;
  label: string;
  source: 'manual' | 'gps' | 'default';
};

/** 与后端默认一致 */
export const DEFAULT_WEATHER_LOCATION: ResolvedWeatherLocation = {
  lat: 30.57,
  lng: 104.07,
  label: '成都',
  source: 'default',
};

export const WEATHER_CITY_PRESETS: Array<{ label: string; lat: number; lng: number }> = [
  { label: '成都', lat: 30.57, lng: 104.07 },
  { label: '北京', lat: 39.9, lng: 116.4 },
  { label: '上海', lat: 31.23, lng: 121.47 },
  { label: '广州', lat: 23.13, lng: 113.26 },
  { label: '深圳', lat: 22.54, lng: 114.06 },
  { label: '杭州', lat: 30.27, lng: 120.15 },
  { label: '重庆', lat: 29.56, lng: 106.55 },
  { label: '西安', lat: 34.26, lng: 108.94 },
];

const listeners = new Set<() => void>();

export function subscribeWeatherLocationSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notifyWeatherLocationListeners(): void {
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      /* ignore */
    }
  }
}

function isFiniteCoord(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

function clampCoord(lat: number, lng: number): { lat: number; lng: number } | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return {
    lat: Math.round(lat * 100) / 100,
    lng: Math.round(lng * 100) / 100,
  };
}

export function defaultWeatherLocationSettings(): WeatherLocationSettings {
  return { mode: 'auto', label: '', lat: null, lng: null };
}

export async function loadWeatherLocationSettings(): Promise<WeatherLocationSettings> {
  const raw = await getAppSetting<unknown>(AppSettingKey.weatherLocation);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return defaultWeatherLocationSettings();
  }
  const o = raw as Record<string, unknown>;
  const mode: WeatherLocationMode = o.mode === 'manual' ? 'manual' : 'auto';
  const label = typeof o.label === 'string' ? o.label.trim() : '';
  const lat = isFiniteCoord(o.lat) ? o.lat : null;
  const lng = isFiniteCoord(o.lng) ? o.lng : null;
  return { mode, label, lat, lng };
}

export async function saveWeatherLocationSettings(
  next: WeatherLocationSettings,
): Promise<WeatherLocationSettings> {
  const mode: WeatherLocationMode = next.mode === 'manual' ? 'manual' : 'auto';
  const label = next.label.trim();
  const coords =
    next.lat != null && next.lng != null ? clampCoord(next.lat, next.lng) : null;
  const saved: WeatherLocationSettings = {
    mode,
    label,
    lat: coords?.lat ?? null,
    lng: coords?.lng ?? null,
  };
  await setAppSetting(AppSettingKey.weatherLocation, saved);
  notifyWeatherLocationListeners();
  return saved;
}

async function tryGpsLocation(): Promise<ResolvedWeatherLocation | null> {
  try {
    const current = await Location.getForegroundPermissionsAsync();
    let status = current.status;
    if (status !== 'granted') {
      const req = await Location.requestForegroundPermissionsAsync();
      status = req.status;
    }
    if (status !== 'granted') return null;

    const pos = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    const coords = clampCoord(pos.coords.latitude, pos.coords.longitude);
    if (!coords) return null;

    let label = '当前位置';
    try {
      const places = await Location.reverseGeocodeAsync({
        latitude: coords.lat,
        longitude: coords.lng,
      });
      const p = places[0];
      const city = p?.city || p?.subregion || p?.region || '';
      const district = p?.district || p?.street || '';
      const composed = [city, district].filter(Boolean).join(' · ');
      if (composed) label = composed;
    } catch {
      /* reverse geocode optional */
    }

    return { ...coords, label, source: 'gps' };
  } catch {
    return null;
  }
}

/**
 * 解析最终天气查询坐标。
 * manual（且经纬度有效）→ GPS → 成都默认。
 */
export async function resolveWeatherLocation(): Promise<ResolvedWeatherLocation> {
  const settings = await loadWeatherLocationSettings();
  if (settings.mode === 'manual' && settings.lat != null && settings.lng != null) {
    const coords = clampCoord(settings.lat, settings.lng);
    if (coords) {
      return {
        ...coords,
        label: settings.label || `${coords.lat}, ${coords.lng}`,
        source: 'manual',
      };
    }
  }

  const gps = await tryGpsLocation();
  if (gps) return gps;

  return { ...DEFAULT_WEATHER_LOCATION };
}
