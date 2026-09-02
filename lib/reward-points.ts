/** 奖励积分：存于 entities.extra_data.reward_points（习惯 / 任务 / 项目共用键名） */

/** 角标渐变映射区间（含端点）；大于 MAX 统一红色 */
export const REWARD_BADGE_COLOR_MIN = 1;
export const REWARD_BADGE_COLOR_MAX = 100;

/** 积分最多保留小数位；绝对值上限 */
export const POINTS_DECIMAL_PLACES = 2;
export const POINTS_ABS_MAX = 99999;

/** 超过渐变上限后的统一红色 */
const REWARD_BADGE_OVER_MAX_LIGHT = '#dc2626';
const REWARD_BADGE_OVER_MAX_DARK = '#f87171';

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

/**
 * 积分角标色带：低→高（天空 → 青 → 绿 → 紫 → 粉 → 橙 → 红）
 * 多色停点，使 1–100 内相邻积分色差更细
 */
const REWARD_BADGE_STOPS_LIGHT = [
  '#0284c7',
  '#0891b2',
  '#0d9488',
  '#16a34a',
  '#4d7c0f',
  '#7c3aed',
  '#9333ea',
  '#be185d',
  '#e11d48',
  '#ea580c',
  '#dc2626',
].map(hexToRgb);
const REWARD_BADGE_STOPS_DARK = [
  '#38bdf8',
  '#22d3ee',
  '#2dd4bf',
  '#4ade80',
  '#a3e635',
  '#c084fc',
  '#e879f9',
  '#f472b6',
  '#fb7185',
  '#fb923c',
  '#f87171',
].map(hexToRgb);

/** 四舍五入到 POINTS_DECIMAL_PLACES，消除浮点噪声 */
export function roundPoints(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(typeof raw === 'string' ? raw.trim() : raw);
  if (!Number.isFinite(n)) return NaN;
  const f = 10 ** POINTS_DECIMAL_PLACES;
  return Math.round(n * f) / f;
}

/** 展示用：去掉多余尾零（1.50 → 1.5，2.00 → 2） */
export function formatPoints(raw: unknown): string {
  const n = roundPoints(raw);
  if (!Number.isFinite(n)) return '0';
  return String(n);
}

/**
 * 按奖励积分大小返回角标背景色（1–100 细步进渐变；小于 1 按 1；大于 100 统一红色）
 * 负数用偏冷灰红，与正数角标区分。
 */
export function getRewardBadgeBackgroundColor(points: number, isDark = false): string {
  const n = roundPoints(points);
  if (!Number.isFinite(n) || n === 0) {
    return isDark ? '#f472b6' : '#be185d';
  }
  if (n < 0) {
    return isDark ? '#fb7185' : '#e11d48';
  }
  if (n > REWARD_BADGE_COLOR_MAX) {
    return isDark ? REWARD_BADGE_OVER_MAX_DARK : REWARD_BADGE_OVER_MAX_LIGHT;
  }
  const clamped = Math.max(REWARD_BADGE_COLOR_MIN, n);
  const t =
    (clamped - REWARD_BADGE_COLOR_MIN) / (REWARD_BADGE_COLOR_MAX - REWARD_BADGE_COLOR_MIN);
  const stops = isDark ? REWARD_BADGE_STOPS_DARK : REWARD_BADGE_STOPS_LIGHT;
  const last = stops.length - 1;
  const scaled = t * last;
  const i = Math.min(last - 1, Math.floor(scaled));
  const localT = scaled - i;
  return rgbToHex(mixRgb(stops[i], stops[i + 1], localT));
}

/**
 * 奖励积分：可为负数（完成时扣除），支持小数；范围 [-99999, 99999]
 */
export function parseRewardPointsFromExtraData(extraData: string | null | undefined): number {
  if (!extraData) return 0;
  try {
    const parsed = JSON.parse(extraData) as { reward_points?: unknown };
    return normalizeRewardPoints(parsed?.reward_points);
  } catch {
    return 0;
  }
}

export function normalizeRewardPoints(raw: unknown): number {
  const n = roundPoints(raw);
  if (!Number.isFinite(n)) return 0;
  return Math.min(POINTS_ABS_MAX, Math.max(-POINTS_ABS_MAX, n));
}

/**
 * 心愿所需积分：非负小数；非法时抛错（供表单/仓库校验）
 */
export function assertNonNegativeCostPoints(raw: unknown): number {
  const n = roundPoints(raw);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error('所需积分须为非负数字（可含小数）');
  }
  return Math.min(POINTS_ABS_MAX, n);
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
