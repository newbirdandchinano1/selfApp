/**
 * 养成习惯「每周N天 / 每月N天」：周期内达标天数进度，及入格隐藏判断。
 * 与任务型 getTaskHabitTasksViewState.hiddenOnViewDay 对齐：
 * 本周期目标在查看日之前已达成 → 当日及之后本周期格子不再显示；下周期刷新再入格。
 */
import { addDaysToLogicalYmd } from '@/lib/tasks-logical-day';
import { startOfWeekMonday } from '@/lib/tasks-global-heatmap';
import { isHabitDayGoalMet, parseHabitDailyGoal } from './habit-goal';
import { parseHabitKind } from './habit-kind';

export type BuildNDaysTab = '每周N天' | '每月N天';

type HabitScheduleNDaysMeta = {
  activeTab?: unknown;
  weeklyNDays?: unknown;
  monthlyNDays?: unknown;
};

function parseExtraSchedule(extraData: string | null): HabitScheduleNDaysMeta | null {
  if (!extraData) return null;
  try {
    const p = JSON.parse(extraData) as { schedule?: unknown };
    const s = p?.schedule;
    if (!s || typeof s !== 'object' || Array.isArray(s)) return null;
    return s as HabitScheduleNDaysMeta;
  } catch {
    return null;
  }
}

function logicalYmdToLocalDate(ymd: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return new Date();
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0);
}

function ymdFromDate(d: Date): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${day}`;
}

function coercePositiveInt(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const n = Math.round(value);
  if (n < min || n > max) return null;
  return n;
}

/** 解析养成「每周N天 / 每月N天」配额；非该循环则 null */
export function parseBuildNDaysQuota(
  extraData: string | null,
): { tab: BuildNDaysTab; n: number } | null {
  if (parseHabitKind(extraData) !== 'build') return null;
  const schedule = parseExtraSchedule(extraData);
  const tab = schedule?.activeTab;
  if (tab === '每周N天') {
    const n = coercePositiveInt(schedule?.weeklyNDays, 1, 7) ?? 1;
    return { tab, n };
  }
  if (tab === '每月N天') {
    const n = coercePositiveInt(schedule?.monthlyNDays, 1, 31) ?? 1;
    return { tab, n };
  }
  return null;
}

/** 逻辑日所在「周 / 月」周期起止（周一～周日 / 月初～月末） */
export function getBuildNDaysPeriodRange(
  logicalYmd: string,
  tab: BuildNDaysTab,
): { startYmd: string; endYmd: string } {
  const d = logicalYmdToLocalDate(logicalYmd);
  if (tab === '每周N天') {
    const monday = startOfWeekMonday(d);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return { startYmd: ymdFromDate(monday), endYmd: ymdFromDate(sunday) };
  }
  const start = new Date(d.getFullYear(), d.getMonth(), 1, 12, 0, 0, 0);
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 12, 0, 0, 0);
  return { startYmd: ymdFromDate(start), endYmd: ymdFromDate(end) };
}

/** 本周期内已达标天数（每日目标达成计 1；不限每日目标时 count>0 计 1） */
export function computeBuildNDaysPeriodProgress(params: {
  extraData: string | null;
  checkIns: Record<string, number>;
  logicalYmd: string;
  /** 仅统计该日及之前的打卡 */
  asOfYmd?: string;
}): number {
  const quota = parseBuildNDaysQuota(params.extraData);
  if (!quota) return 0;
  const dailyGoal = parseHabitDailyGoal(params.extraData, 'build');
  const { startYmd, endYmd } = getBuildNDaysPeriodRange(params.logicalYmd, quota.tab);
  const effectiveEnd =
    params.asOfYmd && params.asOfYmd < endYmd ? params.asOfYmd : endYmd;
  let progress = 0;
  for (const [ymd, count] of Object.entries(params.checkIns)) {
    if (ymd < startYmd || ymd > effectiveEnd) continue;
    if (
      isHabitDayGoalMet({
        kind: 'build',
        todayCount: count,
        dailyGoal,
      })
    ) {
      progress += 1;
    }
  }
  return progress;
}

/**
 * 本周期 N 天目标在查看日之前已达成 → 日程入格应隐藏。
 * 达成当日仍显示（可打钩）；次日起至周期结束不再入格；下周期刷新。
 */
export function isBuildNDaysPeriodHiddenOnViewDay(params: {
  extraData: string | null;
  checkIns: Record<string, number>;
  viewYmd: string;
}): boolean {
  const quota = parseBuildNDaysQuota(params.extraData);
  if (!quota) return false;
  const { startYmd } = getBuildNDaysPeriodRange(params.viewYmd, quota.tab);
  const yesterday = addDaysToLogicalYmd(params.viewYmd, -1);
  if (yesterday < startYmd) return false;
  const progressAsOfYesterday = computeBuildNDaysPeriodProgress({
    extraData: params.extraData,
    checkIns: params.checkIns,
    logicalYmd: params.viewYmd,
    asOfYmd: yesterday,
  });
  return progressAsOfYesterday >= quota.n;
}
