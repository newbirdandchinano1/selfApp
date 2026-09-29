import { AppSettingKey, getAppSetting, setAppSetting } from '@/lib/app-settings-store';
import { normalizeRewardPoints } from '@/lib/reward-points';

export type ReviewPointsSettings = {
  /** 是否启用复盘积分奖励 */
  enabled: boolean;
  /** 完成一次日复盘的奖励积分 */
  dailyRewardPoints: number;
  /** 连续完成 7 次日复盘时的额外总奖励 */
  streak7BonusPoints: number;
};

export const DEFAULT_REVIEW_POINTS_SETTINGS: ReviewPointsSettings = {
  enabled: false,
  dailyRewardPoints: 5,
  streak7BonusPoints: 30,
};

/** 连续坚持复盘天数门槛（与 UI 文案「七天」一致） */
export const REVIEW_STREAK_BONUS_DAYS = 7;

export function normalizeReviewPointsSettings(raw: unknown): ReviewPointsSettings {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...DEFAULT_REVIEW_POINTS_SETTINGS };
  }
  const o = raw as Record<string, unknown>;
  return {
    enabled: o.enabled === true,
    dailyRewardPoints: normalizeRewardPoints(o.dailyRewardPoints),
    streak7BonusPoints: normalizeRewardPoints(o.streak7BonusPoints),
  };
}

export async function loadReviewPointsSettings(): Promise<ReviewPointsSettings> {
  const parsed = await getAppSetting<unknown>(AppSettingKey.reviewPoints);
  return normalizeReviewPointsSettings(parsed);
}

export async function saveReviewPointsSettings(
  next: ReviewPointsSettings,
): Promise<ReviewPointsSettings> {
  const normalized = normalizeReviewPointsSettings(next);
  await setAppSetting(AppSettingKey.reviewPoints, normalized);
  return normalized;
}
