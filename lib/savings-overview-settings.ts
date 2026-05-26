import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@selfapp/savings_overview_settings_v2';

export type SavingsOverviewSettings = {
  /** 顶部「现有存款」，与各计划存入独立 */
  savedAmount: number | null;
  /** 顶部「目标存款」，与各计划目标之和独立 */
  targetAmount: number | null;
  /** 顶部截止时间 YYYY-MM-DD */
  endDate: string | null;
};

const DEFAULT_SETTINGS: SavingsOverviewSettings = {
  savedAmount: null,
  targetAmount: null,
  endDate: null,
};

function normalizeSettings(raw: unknown): SavingsOverviewSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS };
  const o = raw as Record<string, unknown>;
  const savedAmount =
    typeof o.savedAmount === 'number' && Number.isFinite(o.savedAmount) && o.savedAmount >= 0
      ? Math.round(o.savedAmount)
      : null;
  const targetAmount =
    typeof o.targetAmount === 'number' && Number.isFinite(o.targetAmount) && o.targetAmount >= 0
      ? Math.round(o.targetAmount)
      : null;
  const endDate =
    typeof o.endDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.endDate) ? o.endDate : null;
  return { savedAmount, targetAmount, endDate };
}

export async function loadSavingsOverviewSettings(): Promise<SavingsOverviewSettings> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) return normalizeSettings(JSON.parse(raw));
    const legacyRaw = await AsyncStorage.getItem('@selfapp/savings_overview_settings_v1');
    if (legacyRaw) {
      const legacy = normalizeSettings(JSON.parse(legacyRaw));
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(legacy));
      return legacy;
    }
    return { ...DEFAULT_SETTINGS };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSavingsOverviewSettings(settings: SavingsOverviewSettings): Promise<void> {
  const normalized = normalizeSettings(settings);
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
}
