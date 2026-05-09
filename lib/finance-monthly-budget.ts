import AsyncStorage from '@react-native-async-storage/async-storage';

const LEGACY_OVERRIDE_KEY = '@finance_monthly_budget_override_v1';
const STORAGE_KEY_V2 = '@finance_monthly_budget_settings_v2';

export function getMonthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export type MonthBudgetSetting = {
  baseAmount: number;
  includeLastBalance: boolean;
};

function normalizeSettings(parsed: unknown): Record<string, MonthBudgetSetting> {
  const out: Record<string, MonthBudgetSetting> = {};
  if (!parsed || typeof parsed !== 'object') return out;
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const o = v as Record<string, unknown>;
      const base = o.baseAmount;
      const inc = o.includeLastBalance;
      if (typeof base === 'number' && Number.isFinite(base) && base >= 0 && typeof inc === 'boolean') {
        out[k] = { baseAmount: base, includeLastBalance: inc };
      }
    }
  }
  return out;
}

/** 读取按月预算设置；会自动迁移旧版「仅总额数字」存储。 */
export async function loadMonthBudgetSettings(): Promise<Record<string, MonthBudgetSetting>> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY_V2);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      const normalized = normalizeSettings(parsed);
      if (Object.keys(normalized).length > 0) return normalized;
    } catch {
      /* fallthrough */
    }
  }

  const legacyRaw = await AsyncStorage.getItem(LEGACY_OVERRIDE_KEY);
  if (!legacyRaw) return {};
  try {
    const parsed = JSON.parse(legacyRaw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Record<string, MonthBudgetSetting> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
        out[k] = { baseAmount: v, includeLastBalance: false };
      }
    }
    if (Object.keys(out).length > 0) {
      await AsyncStorage.setItem(STORAGE_KEY_V2, JSON.stringify(out));
    }
    return out;
  } catch {
    return {};
  }
}

export async function persistMonthBudgetSettings(map: Record<string, MonthBudgetSetting>): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY_V2, JSON.stringify(map));
}
