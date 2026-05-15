import AsyncStorage from '@react-native-async-storage/async-storage';

const LEGACY_OVERRIDE_KEY = '@finance_monthly_budget_override_v1';
const STORAGE_KEY_V2 = '@finance_monthly_budget_settings_v2';
const BUDGET_REFRESH_DAY_KEY = '@finance_budget_refresh_day_v1';

/** 每月预算重新起算日（1–31），默认 1 日即自然月。 */
export const DEFAULT_BUDGET_REFRESH_DAY = 1;

export function getMonthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function clampBudgetRefreshDay(raw: unknown): number {
  const n =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string'
        ? parseInt(raw, 10)
        : NaN;
  if (!Number.isFinite(n)) return DEFAULT_BUDGET_REFRESH_DAY;
  return Math.min(31, Math.max(1, Math.floor(n)));
}

/** 将「日」限制在指定年月的有效日历日内（处理 2 月及 30 天月）。 */
export function clampDayInCalendarMonth(year: number, monthIndex0: number, day: number): number {
  const last = new Date(year, monthIndex0 + 1, 0).getDate();
  return Math.min(Math.max(1, day), last);
}

/**
 * 当前日期所在预算周期起点（本地 0 点）。
 * 周期为 [起点, 下一周期起点)，例如刷新日为 15 则通常为上月 15 日～本月 14 日。
 */
export function getBudgetPeriodStartForDate(d: Date, refreshDay: number): Date {
  const r = clampBudgetRefreshDay(refreshDay);
  const y = d.getFullYear();
  const m = d.getMonth();
  const dom = d.getDate();
  const rThis = clampDayInCalendarMonth(y, m, r);
  if (dom >= rThis) return new Date(y, m, rThis, 0, 0, 0, 0);
  const py = m === 0 ? y - 1 : y;
  const pm = m === 0 ? 11 : m - 1;
  const rPrev = clampDayInCalendarMonth(py, pm, r);
  return new Date(py, pm, rPrev, 0, 0, 0, 0);
}

/** 紧接在 `periodStart` 之后的下一预算周期起点。 */
export function getNextBudgetPeriodStart(periodStart: Date, refreshDay: number): Date {
  const r = clampBudgetRefreshDay(refreshDay);
  const y = periodStart.getFullYear();
  const m = periodStart.getMonth();
  const cursor = new Date(y, m + 1, 1);
  const ny = cursor.getFullYear();
  const nm = cursor.getMonth();
  const rd = clampDayInCalendarMonth(ny, nm, r);
  return new Date(ny, nm, rd, 0, 0, 0, 0);
}

/** 当前周期起点的前一个预算周期起点。 */
export function getPreviousBudgetPeriodStart(periodStart: Date, refreshDay: number): Date {
  const probe = new Date(periodStart);
  probe.setDate(probe.getDate() - 1);
  return getBudgetPeriodStartForDate(probe, refreshDay);
}

/** 与按月预算存储键一致：取周期起点所在自然月的 YYYY-MM。 */
export function getBudgetMonthKeyForDate(d: Date, refreshDay: number): string {
  return getMonthKey(getBudgetPeriodStartForDate(d, refreshDay));
}

export function budgetPeriodLengthDays(periodStart: Date, periodEndExclusive: Date): number {
  const s = new Date(periodStart.getFullYear(), periodStart.getMonth(), periodStart.getDate()).getTime();
  const e = new Date(
    periodEndExclusive.getFullYear(),
    periodEndExclusive.getMonth(),
    periodEndExclusive.getDate(),
  ).getTime();
  const n = Math.round((e - s) / 86400000);
  return Math.max(1, n);
}

/** 从今日（含）到本预算周期末日（含）的天数，至少为 1。 */
export function budgetDaysLeftIncludingToday(today: Date, periodEndExclusive: Date): number {
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const last = new Date(periodEndExclusive);
  last.setDate(last.getDate() - 1);
  const last0 = new Date(last.getFullYear(), last.getMonth(), last.getDate()).getTime();
  const diff = Math.round((last0 - t0) / 86400000) + 1;
  return Math.max(1, diff);
}

export async function loadBudgetRefreshDay(): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(BUDGET_REFRESH_DAY_KEY);
    if (raw == null) return DEFAULT_BUDGET_REFRESH_DAY;
    const parsed = JSON.parse(raw) as unknown;
    return clampBudgetRefreshDay(parsed);
  } catch {
    return DEFAULT_BUDGET_REFRESH_DAY;
  }
}

export async function persistBudgetRefreshDay(day: number): Promise<void> {
  await AsyncStorage.setItem(BUDGET_REFRESH_DAY_KEY, JSON.stringify(clampBudgetRefreshDay(day)));
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
