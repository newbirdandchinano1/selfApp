import { AppSettingKey, getAppSetting, getAppSettingRaw, setAppSetting } from '@/lib/app-settings-store';

export type SavingsOverviewSettings = {
  savedAmount: number | null;
  targetAmount: number | null;
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
    const parsed = await getAppSetting<unknown>(AppSettingKey.savingsOverview);
    if (parsed) return normalizeSettings(parsed);

    const legacyRaw = await getAppSettingRaw(AppSettingKey.savingsOverviewLegacy);
    if (legacyRaw) {
      const legacy = normalizeSettings(JSON.parse(legacyRaw));
      await setAppSetting(AppSettingKey.savingsOverview, legacy);
      return legacy;
    }
    return { ...DEFAULT_SETTINGS };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSavingsOverviewSettings(settings: SavingsOverviewSettings): Promise<void> {
  const normalized = normalizeSettings(settings);
  await setAppSetting(AppSettingKey.savingsOverview, normalized);
}
