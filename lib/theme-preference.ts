import { Appearance } from 'react-native';

import { AppSettingKey, getAppSettingRaw, setAppSetting } from '@/lib/app-settings-store';

export type ThemePreference = 'light' | 'dark' | 'system';

let cachedPreference: ThemePreference | null = null;
const listeners = new Set<() => void>();

function normalizePreference(raw: unknown): ThemePreference {
  if (raw === 'light' || raw === 'dark' || raw === 'system') return raw;
  return 'system';
}

export function getThemePreferenceSync(): ThemePreference {
  return cachedPreference ?? 'system';
}

export function resolveColorScheme(preference: ThemePreference): 'light' | 'dark' {
  if (preference === 'system') {
    return Appearance.getColorScheme() === 'dark' ? 'dark' : 'light';
  }
  return preference;
}

export function subscribeThemePreference(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notifyListeners() {
  listeners.forEach(l => l());
}

export async function loadThemePreference(): Promise<ThemePreference> {
  try {
    const raw = await getAppSettingRaw(AppSettingKey.theme);
    const pref = raw ? normalizePreference(raw) : 'system';
    cachedPreference = pref;
    return pref;
  } catch {
    cachedPreference = 'system';
    return 'system';
  }
}

export async function saveThemePreference(preference: ThemePreference): Promise<void> {
  const pref = normalizePreference(preference);
  cachedPreference = pref;
  await setAppSetting(AppSettingKey.theme, pref);
  notifyListeners();
}
