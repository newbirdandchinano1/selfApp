import { AppSettingKey, getAppSetting, setAppSetting } from '@/lib/app-settings-store';
import { normalizeRewardPoints } from '@/lib/reward-points';

export type HealthMetricKey = 'hydration' | 'protein' | 'carbohydrate' | 'calories';

export type HealthMetricPointsSettings = {
  /** 是否启用「达标加分 / 超额扣分」 */
  enabled: boolean;
  /** 阈值百分比（1–100）：摄入项达标线；热量超额线 */
  thresholdPercent: number;
  /** 单项积分：摄入达标加分；热量超过阈值扣同等分 */
  rewardPoints: number;
};

export const DEFAULT_HEALTH_METRIC_POINTS_SETTINGS: HealthMetricPointsSettings = {
  enabled: false,
  thresholdPercent: 100,
  rewardPoints: 5,
};

const INTAKE_REWARD_METRIC_KEYS: HealthMetricKey[] = ['hydration', 'protein', 'carbohydrate'];

export function listIntakeRewardMetricKeys(): HealthMetricKey[] {
  return [...INTAKE_REWARD_METRIC_KEYS];
}

export function clampHealthThresholdPercent(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(typeof raw === 'string' ? raw.trim() : raw);
  if (!Number.isFinite(n)) return DEFAULT_HEALTH_METRIC_POINTS_SETTINGS.thresholdPercent;
  return Math.min(100, Math.max(1, Math.round(n)));
}

export function normalizeHealthMetricPointsSettings(
  raw: unknown,
): HealthMetricPointsSettings {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...DEFAULT_HEALTH_METRIC_POINTS_SETTINGS };
  }
  const o = raw as Record<string, unknown>;
  return {
    enabled: o.enabled === true,
    thresholdPercent: clampHealthThresholdPercent(o.thresholdPercent),
    rewardPoints: normalizeRewardPoints(o.rewardPoints),
  };
}

export async function loadHealthMetricPointsSettings(): Promise<HealthMetricPointsSettings> {
  const parsed = await getAppSetting<unknown>(AppSettingKey.healthMetricPoints);
  return normalizeHealthMetricPointsSettings(parsed);
}

export async function saveHealthMetricPointsSettings(
  next: HealthMetricPointsSettings,
): Promise<HealthMetricPointsSettings> {
  const normalized = normalizeHealthMetricPointsSettings(next);
  await setAppSetting(AppSettingKey.healthMetricPoints, normalized);
  return normalized;
}

/** 阈值百分比对应的目标绝对值（用于进度条标注） */
export function healthMetricThresholdAbsolute(
  target: number,
  thresholdPercent: number,
): number {
  const t = Number(target);
  if (!Number.isFinite(t) || t <= 0) return 0;
  const pct = clampHealthThresholdPercent(thresholdPercent);
  return Math.round((t * pct) / 100);
}

/** 水分 / 蛋白 / 碳水：进度达到阈值即可加分 */
export function isIntakeMetricRewardEligible(
  percent: number,
  settings: HealthMetricPointsSettings,
): boolean {
  if (!settings.enabled) return false;
  if (settings.rewardPoints === 0) return false;
  return percent >= settings.thresholdPercent;
}

/**
 * 热量：进度超过阈值则扣分。
 * 请传入未封顶百分比（可 >100），以便在阈值为 100% 时仍能识别超额。
 */
export function isCaloriesPenaltyEligible(
  uncappedPercent: number,
  settings: HealthMetricPointsSettings,
): boolean {
  if (!settings.enabled) return false;
  if (settings.rewardPoints === 0) return false;
  return uncappedPercent > settings.thresholdPercent;
}
