import { type HabitKind, parseHabitKind } from './habit-kind';

export type HabitQuantifyMeta = {
  /** 养成：null 表示不限；戒除：必为 0–99 的整数阈值 */
  dailyGoal: number | null;
  /** 戒除习惯：连续满足目标的天数目标 */
  consecutiveTargetDays: number | null;
};

function parseQuantifyRaw(extraData: string | null): {
  dailyGoal?: unknown;
  consecutiveTargetDays?: unknown;
} | null {
  if (!extraData) return null;
  try {
    const p = JSON.parse(extraData) as { quantify?: unknown };
    const q = p?.quantify;
    if (!q || typeof q !== 'object' || Array.isArray(q)) return null;
    return q as { dailyGoal?: unknown; consecutiveTargetDays?: unknown };
  } catch {
    return null;
  }
}

/** 解析每日目标：戒除习惯允许 0；养成习惯 null 表示不限 */
export function parseHabitDailyGoal(extraData: string | null, kind?: HabitKind): number | null {
  const resolvedKind = kind ?? parseHabitKind(extraData);
  const q = parseQuantifyRaw(extraData);
  const g = q?.dailyGoal;
  if (g === null || g === undefined) {
    return resolvedKind === 'break' ? 0 : null;
  }
  if (typeof g !== 'number' || !Number.isFinite(g)) {
    return resolvedKind === 'break' ? 0 : null;
  }
  const rounded = Math.min(99, Math.max(0, Math.round(g)));
  if (resolvedKind === 'build' && rounded <= 0) return null;
  return rounded;
}

export function parseHabitConsecutiveTargetDays(extraData: string | null): number | null {
  const q = parseQuantifyRaw(extraData);
  const v = q?.consecutiveTargetDays;
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const rounded = Math.round(v);
  if (rounded < 1) return null;
  return Math.min(999, rounded);
}

export function parseHabitQuantifyMeta(extraData: string | null, kind?: HabitKind): HabitQuantifyMeta {
  const resolvedKind = kind ?? parseHabitKind(extraData);
  return {
    dailyGoal: parseHabitDailyGoal(extraData, resolvedKind),
    consecutiveTargetDays:
      resolvedKind === 'break' ? parseHabitConsecutiveTargetDays(extraData) : null,
  };
}

/**
 * 当日是否达成目标。
 * 养成：次数 ≥ 每日目标（不限时 > 0 即达成）。
 * 戒除：次数低于每日目标阈值即达成（阈值为 0 时须为 0 次）。
 */
export function isHabitDayGoalMet(params: {
  kind: HabitKind;
  todayCount: number;
  dailyGoal?: number | null;
}): boolean {
  const { kind, todayCount } = params;
  const count = Math.max(0, Math.floor(todayCount));
  const dailyGoal = params.dailyGoal ?? (kind === 'break' ? 0 : null);

  if (kind === 'break') {
    const threshold = dailyGoal ?? 0;
    if (threshold <= 0) return count === 0;
    return count < threshold;
  }

  if (dailyGoal != null) return count >= dailyGoal;
  return count > 0;
}

/** 戒除习惯任务页三态：未破戒 / 破戒未超限 / 已破戒未达标 */
export type BreakHabitDayUiState = 'clean' | 'slipping' | 'failed';

export function getBreakHabitDayUiState(todayCount: number, dailyGoal: number | null): BreakHabitDayUiState {
  const count = Math.max(0, Math.floor(todayCount));
  const threshold = dailyGoal ?? 0;
  if (!isHabitDayGoalMet({ kind: 'break', todayCount: count, dailyGoal: threshold })) {
    return 'failed';
  }
  if (count > 0) return 'slipping';
  return 'clean';
}

/** 破戒未超限时边框红色强度（0–1），次数越接近阈值越深 */
export function breakSlipBorderStrength(todayCount: number, dailyGoal: number | null): number {
  const count = Math.max(0, Math.floor(todayCount));
  if (count <= 0) return 0;
  const threshold = dailyGoal ?? 0;
  if (threshold <= 0) return Math.min(0.55, 0.28 + count * 0.12);
  return Math.min(0.92, 0.22 + (count / threshold) * 0.7);
}

export function breakSlipBorderColor(
  todayCount: number,
  dailyGoal: number | null,
  isDark: boolean
): string {
  const strength = breakSlipBorderStrength(todayCount, dailyGoal);
  if (isDark) return `rgba(248,113,113,${strength})`;
  return `rgba(220,38,38,${strength})`;
}

export function breakSlipBadgeColor(todayCount: number, dailyGoal: number | null, isDark: boolean): string {
  const strength = breakSlipBorderStrength(todayCount, dailyGoal);
  if (isDark) return `rgba(220,38,38,${0.55 + strength * 0.4})`;
  return `rgba(194,65,12,${0.6 + strength * 0.35})`;
}

/** 养成习惯：完成次数越接近每日目标，边框绿色越深（0–1） */
export function buildProgressBorderStrength(todayCount: number, dailyGoal: number | null): number {
  const count = Math.max(0, Math.floor(todayCount));
  if (count <= 0 || dailyGoal == null || dailyGoal <= 0) return 0;
  if (count >= dailyGoal) return 1;
  return Math.min(0.92, 0.22 + (count / dailyGoal) * 0.7);
}

export function buildProgressBorderColor(
  todayCount: number,
  dailyGoal: number | null,
  isDark: boolean
): string | null {
  const strength = buildProgressBorderStrength(todayCount, dailyGoal);
  if (strength <= 0) return null;
  if (isDark) return `rgba(52,211,153,${strength})`;
  return `rgba(0,108,73,${strength})`;
}

export function buildProgressBadgeColor(todayCount: number, dailyGoal: number | null, isDark: boolean): string {
  const strength = buildProgressBorderStrength(todayCount, dailyGoal);
  if (isDark) return `rgba(52,211,153,${0.55 + strength * 0.4})`;
  return `rgba(0,108,73,${0.6 + strength * 0.35})`;
}

/** 养成习惯打卡递增上限；戒除习惯不设上限（记录每次破戒） */
export function parseHabitIncrementCap(extraData: string | null, kind?: HabitKind): number | null {
  const resolvedKind = kind ?? parseHabitKind(extraData);
  if (resolvedKind === 'break') return null;
  const goal = parseHabitDailyGoal(extraData, 'build');
  return goal != null && goal > 0 ? goal : null;
}

function addDaysToYmd(ymd: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return ymd;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${day}`;
}

/** 自 endYmd 起向前连续达成目标的天数（含 endYmd）；minYmd 为当前挑战周期起点（不含更早日期） */
export function computeConsecutiveGoalMetDays(params: {
  checkIns: Record<string, number>;
  endYmd: string;
  kind: HabitKind;
  dailyGoal?: number | null;
  maxLookback?: number;
  minYmd?: string | null;
}): number {
  const { checkIns, endYmd, kind, dailyGoal, maxLookback = 999, minYmd } = params;
  let streak = 0;
  let cursor = endYmd;
  for (let i = 0; i < maxLookback; i++) {
    if (minYmd && cursor < minYmd) break;
    const cnt = checkIns[cursor] ?? 0;
    if (!isHabitDayGoalMet({ kind, todayCount: cnt, dailyGoal })) break;
    streak++;
    cursor = addDaysToYmd(cursor, -1);
  }
  return streak;
}

/** @deprecated 使用 parseHabitIncrementCap；保留兼容旧调用 */
export function parseHabitDailyGoalMax(extraData: string | null): number | null {
  return parseHabitIncrementCap(extraData);
}
