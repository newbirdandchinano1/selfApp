/** 奖励积分：存于 entities.extra_data.reward_points（习惯 / 任务 / 项目共用键名） */

/** 角标渐变映射区间（含端点）；超出按端点钳制 */
export const REWARD_BADGE_COLOR_MIN = 1;
export const REWARD_BADGE_COLOR_MAX = 10000;

type Rgb = { r: number; g: number; b: number };

function hexToRgb(hex: string): Rgb {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function rgbToHex({ r, g, b }: Rgb): string {
  const to = (n: number) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  const u = Math.min(1, Math.max(0, t));
  return {
    r: a.r + (b.r - a.r) * u,
    g: a.g + (b.g - a.g) * u,
    b: a.b + (b.b - a.b) * u,
  };
}

/** 积分角标色带：低→高（天空 → 绿 → 紫 → 粉 → 橙） */
const REWARD_BADGE_STOPS_LIGHT = ['#0284c7', '#16a34a', '#7c3aed', '#be185d', '#c2410c'].map(hexToRgb);
const REWARD_BADGE_STOPS_DARK = ['#38bdf8', '#4ade80', '#c084fc', '#f472b6', '#fb923c'].map(hexToRgb);

/**
 * 按奖励积分大小返回角标背景色（1–10000 渐变；小于 1 按 1，大于 10000 按 10000）
 */
export function getRewardBadgeBackgroundColor(points: number, isDark = false): string {
  const n = Math.floor(Number(points));
  if (!Number.isFinite(n) || n <= 0) {
    return isDark ? '#f472b6' : '#be185d';
  }
  const clamped = Math.min(REWARD_BADGE_COLOR_MAX, Math.max(REWARD_BADGE_COLOR_MIN, n));
  const t =
    (clamped - REWARD_BADGE_COLOR_MIN) / (REWARD_BADGE_COLOR_MAX - REWARD_BADGE_COLOR_MIN);
  const stops = isDark ? REWARD_BADGE_STOPS_DARK : REWARD_BADGE_STOPS_LIGHT;
  const last = stops.length - 1;
  const scaled = t * last;
  const i = Math.min(last - 1, Math.floor(scaled));
  const localT = scaled - i;
  return rgbToHex(mixRgb(stops[i], stops[i + 1], localT));
}

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
