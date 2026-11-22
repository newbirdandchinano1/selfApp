/**
 * 天气氛围 WebP 动图背景：总开关 + 跟随天气 / 手动选图。
 */
import { AppSettingKey, getAppSettingRaw, setAppSetting } from '@/lib/app-settings-store';
import {
  isWeatherAtmosphereWebpPick,
  type WeatherAtmosphereWebpPick,
} from '@/lib/weather-atmosphere-webp-assets';

const listeners = new Set<() => void>();

let cachedEnabled = false;
let cachedPick: WeatherAtmosphereWebpPick = 'auto';
let hydrated = false;

function notify(): void {
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      /* ignore */
    }
  }
}

function parseEnabled(raw: string | null): boolean {
  if (raw == null || raw === '') return false;
  const trimmed = raw.trim();
  if (trimmed === '1' || trimmed === 'true') return true;
  if (trimmed === '0' || trimmed === 'false') return false;
  try {
    return JSON.parse(trimmed) === true;
  } catch {
    return false;
  }
}

function parsePick(raw: string | null): WeatherAtmosphereWebpPick {
  if (raw == null || raw === '') return 'auto';
  const trimmed = raw.trim();
  if (isWeatherAtmosphereWebpPick(trimmed)) return trimmed;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (isWeatherAtmosphereWebpPick(parsed)) return parsed;
  } catch {
    /* ignore */
  }
  return 'auto';
}

export function getWeatherAtmosphereWebpBgEnabledSync(): boolean {
  return cachedEnabled;
}

export function getWeatherAtmosphereWebpPickSync(): WeatherAtmosphereWebpPick {
  return cachedPick;
}

export function subscribeWeatherAtmosphereWebpBg(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export async function loadWeatherAtmosphereWebpBgSettings(): Promise<{
  enabled: boolean;
  pick: WeatherAtmosphereWebpPick;
}> {
  try {
    const [enabledRaw, pickRaw] = await Promise.all([
      getAppSettingRaw(AppSettingKey.weatherAtmosphereWebpBg),
      getAppSettingRaw(AppSettingKey.weatherAtmosphereWebpPick),
    ]);
    cachedEnabled = parseEnabled(enabledRaw);
    cachedPick = parsePick(pickRaw);
  } catch {
    cachedEnabled = false;
    cachedPick = 'auto';
  }
  hydrated = true;
  notify();
  return { enabled: cachedEnabled, pick: cachedPick };
}

/** @deprecated 用 loadWeatherAtmosphereWebpBgSettings */
export async function loadWeatherAtmosphereWebpBgEnabled(): Promise<boolean> {
  const { enabled } = await loadWeatherAtmosphereWebpBgSettings();
  return enabled;
}

export async function saveWeatherAtmosphereWebpBgEnabled(enabled: boolean): Promise<void> {
  cachedEnabled = enabled;
  hydrated = true;
  await setAppSetting(AppSettingKey.weatherAtmosphereWebpBg, enabled);
  notify();
}

export async function saveWeatherAtmosphereWebpPick(pick: WeatherAtmosphereWebpPick): Promise<void> {
  const next = isWeatherAtmosphereWebpPick(pick) ? pick : 'auto';
  cachedPick = next;
  hydrated = true;
  await setAppSetting(AppSettingKey.weatherAtmosphereWebpPick, next);
  notify();
}

export async function ensureWeatherAtmosphereWebpBgHydrated(): Promise<boolean> {
  if (hydrated) return cachedEnabled;
  const { enabled } = await loadWeatherAtmosphereWebpBgSettings();
  return enabled;
}
