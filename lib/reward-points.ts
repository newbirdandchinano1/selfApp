/** 奖励积分：存于 entities.extra_data.reward_points（习惯 / 任务 / 项目共用键名） */

export function parseRewardPointsFromExtraData(extraData: string | null | undefined): number {
  if (!extraData) return 0;
  try {
    const parsed = JSON.parse(extraData) as { reward_points?: unknown };
    const n = Math.floor(Number(parsed?.reward_points));
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.min(99999, n);
  } catch {
    return 0;
  }
}

export function normalizeRewardPoints(raw: unknown): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(99999, n);
}

/** 将 reward_points 合并进 extra_data JSON 字符串 */
export function mergeRewardPointsIntoExtraData(
  extraData: string | null | undefined,
  rewardPoints: number,
): string {
  let base: Record<string, unknown> = {};
  if (extraData) {
    try {
      const parsed = JSON.parse(extraData) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        base = { ...(parsed as Record<string, unknown>) };
      }
    } catch {
      base = {};
    }
  }
  delete base.completion_reward;
  base.reward_points = normalizeRewardPoints(rewardPoints);
  return JSON.stringify(base);
}

export function mergeRewardPointsIntoExtraObject(
  extra: Record<string, unknown>,
  rewardPoints: number,
): Record<string, unknown> {
  const next = { ...extra };
  delete next.completion_reward;
  next.reward_points = normalizeRewardPoints(rewardPoints);
  return next;
}
