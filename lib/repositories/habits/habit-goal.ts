import { type HabitKind, parseHabitKind } from './habit-kind';

export type BuildHabitExpectedGoalType = 'days' | 'times' | 'consecutive_days';

export type BuildHabitExpectedGoal = {
  type: BuildHabitExpectedGoalType;
  value: number;
};

export type HabitQuantifyMeta = {
  /** 养成：null 表示不限；戒除：必为 0–99 的整数阈值 */
  dailyGoal: number | null;
  /** 戒除习惯：连续满足目标的天数目标 */
  consecutiveTargetDays: number | null;
  /** 养成习惯：预期总目标（天数或总次数），null 表示不设上限 */
  expectedGoal: BuildHabitExpectedGoal | null;
};

function parseQuantifyRaw(extraData: string | null): {
  dailyGoal?: unknown;
  consecutiveTargetDays?: unknown;
  expectedGoal?: unknown;
} | null {
  if (!extraData) return null;
  try {
    const p = JSON.parse(extraData) as { quantify?: unknown };
    const q = p?.quantify;
    if (!q || typeof q !== 'object' || Array.isArray(q)) return null;
    return q as {
      dailyGoal?: unknown;
      consecutiveTargetDays?: unknown;
      expectedGoal?: unknown;
    };
  } catch {
    return null;
  }
}

/** 养成习惯预期目标：按累计达标天数或累计打卡次数 */
export function parseBuildHabitExpectedGoal(extraData: string | null): BuildHabitExpectedGoal | null {
  const q = parseQuantifyRaw(extraData);
  const raw = q?.expectedGoal;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as { type?: unknown; value?: unknown };
  const type = obj.type;
  if (type !== 'days' && type !== 'times' && type !== 'consecutive_days') return null;
  if (typeof obj.value !== 'number' || !Number.isFinite(obj.value)) return null;
  const value = Math.round(obj.value);
  if (value < 1) return null;
  return normalizeBuildHabitExpectedGoal({ type, value });
}

/** 养成习惯：规范化预期目标数值 */
export function normalizeBuildHabitExpectedGoal(goal: {
  type: BuildHabitExpectedGoalType;
  value: number;
}): BuildHabitExpectedGoal {
  const max = goal.type === 'times' ? 9999 : 999;
  const value = Math.min(max, Math.max(1, Math.round(goal.value)));
  return { type: goal.type, value };
}

export function formatBuildExpectedGoalProgressUnit(type: BuildHabitExpectedGoalType): string {
  return type === 'times' ? '次' : '天';
}

export function formatBuildExpectedGoalShort(goal: BuildHabitExpectedGoal): string {
  if (goal.type === 'times') return `${goal.value} 次`;
  if (goal.type === 'consecutive_days') return `连续 ${goal.value} 天`;
  return `${goal.value} 天`;
}

/** 累计达标天数（每日目标达成计 1 天；不限每日目标时 count > 0 计 1 天） */
export function countBuildAchievedDays(
  checkIns: Record<string, number>,
  dailyGoal: number | null
): number {
  return Object.values(checkIns).filter((c) =>
    isHabitDayGoalMet({ kind: 'build', todayCount: c, dailyGoal })
  ).length;
}

/** 累计打卡总次数 */
export function computeTotalCheckInCount(checkIns: Record<string, number>): number {
  return Object.values(checkIns).reduce((sum, c) => sum + Math.max(0, Math.floor(c)), 0);
}

/** 养成习惯预期目标当前进度 */
export function computeBuildExpectedGoalProgress(params: {
  expectedGoal: BuildHabitExpectedGoal;
  checkIns: Record<string, number>;
  dailyGoal?: number | null;
  /** 连续天数统计截止日（默认取 checkIns 中最晚日期） */
  endYmd?: string;
  kind?: HabitKind;
}): number {
  const { expectedGoal, checkIns } = params;
  const dailyGoal = params.dailyGoal ?? null;
  const kind = params.kind ?? 'build';
  if (expectedGoal.type === 'days') {
    return countBuildAchievedDays(checkIns, dailyGoal);
  }
  if (expectedGoal.type === 'consecutive_days') {
    let endYmd = params.endYmd?.trim() ?? '';
    if (!endYmd) {
      endYmd = Object.keys(checkIns).sort().at(-1) ?? '';
    }
    if (!endYmd) return 0;
    return computeConsecutiveGoalMetDays({
      checkIns,
      endYmd,
      kind,
      dailyGoal,
    });
  }
  return computeTotalCheckInCount(checkIns);
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
  if ((resolvedKind === 'build' || resolvedKind === 'task') && rounded <= 0) return null;
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
    expectedGoal:
      resolvedKind === 'task'
        ? parseBuildHabitExpectedGoal(extraData)
        : resolvedKind === 'build'
          ? parseBuildHabitExpectedGoal(extraData)
          : null,
  };
}

export type BreakHabitDayContext = {
  todayCount: number;
  dailyGoal?: number | null;
  /** 当日是否有打卡记录（含 count=0 的「保持戒除」确认） */
  hasDayRecord?: boolean;
  /** 逻辑日 YMD；配合 logicalTodayYmd 区分今日待确认与历史未确认失败 */
  ymd?: string;
  logicalTodayYmd?: string;
};

function isBreakHabitCountGoalMet(count: number, dailyGoal: number | null | undefined): boolean {
  const threshold = dailyGoal ?? 0;
  if (threshold <= 0) return count === 0;
  return count < threshold;
}

function isBreakHabitDayPending(ctx: BreakHabitDayContext): boolean {
  if (ctx.hasDayRecord) return false;
  const ymd = ctx.ymd?.trim();
  const logicalTodayYmd = ctx.logicalTodayYmd?.trim();
  if (!ymd || !logicalTodayYmd) return false;
  return ymd === logicalTodayYmd;
}

/**
 * 当日是否达成目标。
 * 养成：次数 ≥ 每日目标（不限时 > 0 即达成）。
 * 戒除：须用户确认；无记录时今日为未确认、历史日为失败；有记录时次数低于阈值即达成。
 */
export function isHabitDayGoalMet(params: {
  kind: HabitKind;
  todayCount: number;
  dailyGoal?: number | null;
  hasDayRecord?: boolean;
  ymd?: string;
  logicalTodayYmd?: string;
}): boolean {
  const { kind, todayCount } = params;
  const count = Math.max(0, Math.floor(todayCount));
  const dailyGoal = params.dailyGoal ?? (kind === 'break' ? 0 : null);

  if (kind === 'break') {
    if (!params.hasDayRecord) {
      return false;
    }
    return isBreakHabitCountGoalMet(count, dailyGoal);
  }

  if (dailyGoal != null) return count >= dailyGoal;
  return count > 0;
}

/** 戒除习惯任务页四态：待确认 / 未破戒 / 破戒未超限 / 已破戒未达标 */
export type BreakHabitDayUiState = 'pending' | 'clean' | 'slipping' | 'failed';

/** 戒除习惯当日 UI / 完成态（须用户确认；超日界未确认视为失败） */
export function resolveBreakHabitDayUiState(ctx: BreakHabitDayContext): BreakHabitDayUiState {
  const count = Math.max(0, Math.floor(ctx.todayCount));
  const dailyGoal = ctx.dailyGoal ?? 0;
  if (isBreakHabitDayPending(ctx)) return 'pending';
  if (!ctx.hasDayRecord) return 'failed';
  if (!isBreakHabitCountGoalMet(count, dailyGoal)) return 'failed';
  if (count > 0) return 'slipping';
  return 'clean';
}

/** 戒除习惯当日是否视为完成：须用户确认保持戒除，破戒则未完成 */
export function isBreakHabitDayCompleted(ctx: BreakHabitDayContext): boolean {
  return resolveBreakHabitDayUiState(ctx) === 'clean';
}

/** 任务页展示 / 习惯绑定：养成/完成任务看达标，戒除看已确认且未破戒 */
export function isHabitDayDisplayCompleted(params: {
  kind: HabitKind;
  todayCount: number;
  dailyGoal?: number | null;
  hasDayRecord?: boolean;
  ymd?: string;
  logicalTodayYmd?: string;
}): boolean {
  if (params.kind === 'break') {
    return isBreakHabitDayCompleted({
      todayCount: params.todayCount,
      dailyGoal: params.dailyGoal,
      hasDayRecord: params.hasDayRecord,
      ymd: params.ymd,
      logicalTodayYmd: params.logicalTodayYmd,
    });
  }
  return isHabitDayGoalMet(params);
}

export function getBreakHabitDayUiState(
  todayCount: number,
  dailyGoal: number | null,
  opts?: Pick<BreakHabitDayContext, 'hasDayRecord' | 'ymd' | 'logicalTodayYmd'>,
): BreakHabitDayUiState {
  return resolveBreakHabitDayUiState({
    todayCount,
    dailyGoal,
    hasDayRecord: opts?.hasDayRecord,
    ymd: opts?.ymd,
    logicalTodayYmd: opts?.logicalTodayYmd,
  });
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

/** 养成/完成任务打卡递增上限；戒除习惯不设上限（记录每次破戒） */
export function parseHabitIncrementCap(extraData: string | null, kind?: HabitKind): number | null {
  const resolvedKind = kind ?? parseHabitKind(extraData);
  if (resolvedKind === 'break') return null;
  const goal = parseHabitDailyGoal(extraData, resolvedKind);
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
  /** 戒除：用于区分今日待确认与历史未确认失败 */
  logicalTodayYmd?: string;
}): number {
  const { checkIns, endYmd, kind, dailyGoal, maxLookback = 999, minYmd, logicalTodayYmd } = params;
  let streak = 0;
  let cursor = endYmd;
  for (let i = 0; i < maxLookback; i++) {
    if (minYmd && cursor < minYmd) break;
    const hasDayRecord = Object.prototype.hasOwnProperty.call(checkIns, cursor);
    const cnt = checkIns[cursor] ?? 0;
    if (
      !isHabitDayGoalMet({
        kind,
        todayCount: cnt,
        dailyGoal,
        hasDayRecord: kind === 'break' ? hasDayRecord : undefined,
        ymd: kind === 'break' ? cursor : undefined,
        logicalTodayYmd: kind === 'break' ? logicalTodayYmd : undefined,
      })
    ) {
      break;
    }
    streak++;
    cursor = addDaysToYmd(cursor, -1);
  }
  return streak;
}

/** @deprecated 使用 parseHabitIncrementCap；保留兼容旧调用 */
export function parseHabitDailyGoalMax(extraData: string | null): number | null {
  return parseHabitIncrementCap(extraData);
}
