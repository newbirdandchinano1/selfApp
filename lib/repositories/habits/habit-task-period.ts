import { addDaysToLogicalYmd } from '@/lib/tasks-logical-day';
import { startOfWeekMonday } from '@/lib/tasks-global-heatmap';
import {
  computeBuildExpectedGoalProgress,
  parseBuildHabitExpectedGoal,
  parseHabitDailyGoal,
  type BuildHabitExpectedGoal,
  type BuildHabitExpectedGoalType,
} from './habit-goal';
import { parseHabitKind } from './habit-kind';

/** 完成任务类型的重复周期（存于 schedule.activeTab） */
export type TaskRepeatPeriod = '每日' | '每周' | '每月' | '每年';

export const TASK_REPEAT_PERIODS: TaskRepeatPeriod[] = ['每日', '每周', '每月', '每年'];

export const DEFAULT_TASK_REPEAT_PERIOD: TaskRepeatPeriod = '每月';

function parseExtraSchedule(extraData: string | null): { activeTab?: unknown } | null {
  if (!extraData) return null;
  try {
    const p = JSON.parse(extraData) as { schedule?: unknown };
    const s = p?.schedule;
    if (!s || typeof s !== 'object' || Array.isArray(s)) return null;
    return s as { activeTab?: unknown };
  } catch {
    return null;
  }
}

export function parseTaskRepeatPeriod(extraData: string | null): TaskRepeatPeriod {
  const tab = parseExtraSchedule(extraData)?.activeTab;
  if (typeof tab === 'string' && (TASK_REPEAT_PERIODS as string[]).includes(tab)) {
    return tab as TaskRepeatPeriod;
  }
  return DEFAULT_TASK_REPEAT_PERIOD;
}

function ymdFromDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function logicalYmdToLocalDate(ymd: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return new Date();
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0);
}

/** 逻辑日所在重复周期的起止 YMD（含首尾） */
export function getTaskPeriodRange(
  logicalYmd: string,
  period: TaskRepeatPeriod
): { startYmd: string; endYmd: string } {
  const d = logicalYmdToLocalDate(logicalYmd);
  if (period === '每日') {
    return { startYmd: logicalYmd, endYmd: logicalYmd };
  }
  if (period === '每周') {
    const monday = startOfWeekMonday(d);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return { startYmd: ymdFromDate(monday), endYmd: ymdFromDate(sunday) };
  }
  if (period === '每月') {
    const start = new Date(d.getFullYear(), d.getMonth(), 1, 12, 0, 0, 0);
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 12, 0, 0, 0);
    return { startYmd: ymdFromDate(start), endYmd: ymdFromDate(end) };
  }
  const start = new Date(d.getFullYear(), 0, 1, 12, 0, 0, 0);
  const end = new Date(d.getFullYear(), 11, 31, 12, 0, 0, 0);
  return { startYmd: ymdFromDate(start), endYmd: ymdFromDate(end) };
}

function filterCheckInsInRange(
  checkIns: Record<string, number>,
  startYmd: string,
  endYmd: string,
  asOfYmd?: string
): Record<string, number> {
  const effectiveEnd = asOfYmd && asOfYmd < endYmd ? asOfYmd : endYmd;
  const out: Record<string, number> = {};
  for (const [ymd, count] of Object.entries(checkIns)) {
    if (ymd >= startYmd && ymd <= effectiveEnd) out[ymd] = count;
  }
  return out;
}

/** 完成任务类型：当前周期内的预期目标进度 */
export function computeTaskPeriodGoalProgress(params: {
  expectedGoal: BuildHabitExpectedGoal;
  checkIns: Record<string, number>;
  dailyGoal?: number | null;
  logicalYmd: string;
  period: TaskRepeatPeriod;
  /** 仅统计该日及之前的打卡（日历历史日展示用） */
  asOfYmd?: string;
}): number {
  const { expectedGoal, checkIns, logicalYmd, period, asOfYmd } = params;
  const dailyGoal = params.dailyGoal ?? null;
  const { startYmd, endYmd } = getTaskPeriodRange(logicalYmd, period);
  const periodCheckIns = filterCheckInsInRange(checkIns, startYmd, endYmd, asOfYmd);
  return computeBuildExpectedGoalProgress({ expectedGoal, checkIns: periodCheckIns, dailyGoal });
}

export function parseTaskHabitExpectedGoal(extraData: string | null): BuildHabitExpectedGoal | null {
  if (parseHabitKind(extraData) !== 'task') return null;
  return parseBuildHabitExpectedGoal(extraData);
}

/** 当前周期内是否已达成预期目标（达成后任务页隐藏至下一周期） */
export function isTaskHabitPeriodGoalMet(params: {
  extraData: string | null;
  checkIns: Record<string, number>;
  logicalYmd: string;
  asOfYmd?: string;
}): boolean {
  if (parseHabitKind(params.extraData) !== 'task') return false;
  const expectedGoal = parseTaskHabitExpectedGoal(params.extraData);
  if (expectedGoal == null) return false;
  const period = parseTaskRepeatPeriod(params.extraData);
  const dailyGoal = parseHabitDailyGoal(params.extraData, 'task');
  const progress = computeTaskPeriodGoalProgress({
    expectedGoal,
    checkIns: params.checkIns,
    dailyGoal,
    logicalYmd: params.logicalYmd,
    period,
    asOfYmd: params.asOfYmd,
  });
  return progress >= expectedGoal.value;
}

export type TaskHabitTasksViewState = {
  periodProgress: number;
  periodGoal: number;
  /** 周期目标在「查看日」当天达成（展示打钩，次日隐藏） */
  showPeriodCheckOnViewDay: boolean;
  /** 周期目标在查看日之前已达成（任务页/日历不再展示） */
  hiddenOnViewDay: boolean;
};

/** 任务页 / 日历：周期型完成任务在指定逻辑日的展示与隐藏状态 */
export function getTaskHabitTasksViewState(params: {
  extraData: string | null;
  checkIns: Record<string, number>;
  logicalYmd: string;
}): TaskHabitTasksViewState | null {
  if (parseHabitKind(params.extraData) !== 'task') return null;
  const expectedGoal = parseTaskHabitExpectedGoal(params.extraData);
  if (expectedGoal == null) return null;
  const period = parseTaskRepeatPeriod(params.extraData);
  const dailyGoal = parseHabitDailyGoal(params.extraData, 'task');
  const periodProgress = computeTaskPeriodGoalProgress({
    expectedGoal,
    checkIns: params.checkIns,
    dailyGoal,
    logicalYmd: params.logicalYmd,
    period,
    asOfYmd: params.logicalYmd,
  });
  const { startYmd } = getTaskPeriodRange(params.logicalYmd, period);
  const yesterday = addDaysToLogicalYmd(params.logicalYmd, -1);
  const progressAsOfYesterday =
    yesterday >= startYmd
      ? computeTaskPeriodGoalProgress({
          expectedGoal,
          checkIns: params.checkIns,
          dailyGoal,
          logicalYmd: params.logicalYmd,
          period,
          asOfYmd: yesterday,
        })
      : 0;
  const goalValue = expectedGoal.value;
  const periodGoalMet = periodProgress >= goalValue;
  const wasMetBeforeViewDay = progressAsOfYesterday >= goalValue;
  return {
    periodProgress,
    periodGoal: goalValue,
    showPeriodCheckOnViewDay: periodGoalMet && !wasMetBeforeViewDay,
    hiddenOnViewDay: wasMetBeforeViewDay,
  };
}

export function formatTaskPeriodGoalLabel(period: TaskRepeatPeriod, goal: BuildHabitExpectedGoal): string {
  const unit = goal.type === 'days' ? '天' : '次';
  return `本${period.replace('每', '')} ${goal.value} ${unit}`;
}

/** 下一重复周期的起始日（当前周期 endYmd 的次日） */
function nextTaskPeriodStartYmd(periodStartYmd: string, period: TaskRepeatPeriod): string {
  const { endYmd } = getTaskPeriodRange(periodStartYmd, period);
  return addDaysToLogicalYmd(endYmd, 1);
}

/**
 * 任务类小习惯：历史各重复周期内「进度达标」的次数（每周期最多计 1）。
 * 本周期进度未满不计入；本周期刚达标则计入。
 */
export function countTaskHabitPeriodCompletions(params: {
  extraData: string | null;
  checkIns: Record<string, number>;
  logicalYmd: string;
}): number {
  if (parseHabitKind(params.extraData) !== 'task') return 0;
  const expectedGoal = parseTaskHabitExpectedGoal(params.extraData);
  if (expectedGoal == null) return 0;
  const period = parseTaskRepeatPeriod(params.extraData);
  const dailyGoal = parseHabitDailyGoal(params.extraData, 'task');
  const dates = Object.keys(params.checkIns)
    .filter((ymd) => ymd <= params.logicalYmd)
    .sort();
  if (dates.length === 0) return 0;

  let cursor = getTaskPeriodRange(dates[0]!, period).startYmd;
  const lastPeriodStart = getTaskPeriodRange(params.logicalYmd, period).startYmd;
  let count = 0;
  let guard = 0;
  while (cursor <= lastPeriodStart && guard < 10000) {
    guard += 1;
    const progress = computeTaskPeriodGoalProgress({
      expectedGoal,
      checkIns: params.checkIns,
      dailyGoal,
      logicalYmd: cursor,
      period,
      asOfYmd: params.logicalYmd,
    });
    if (progress >= expectedGoal.value) count += 1;
    cursor = nextTaskPeriodStartYmd(cursor, period);
  }
  return count;
}

/** 完成任务：当前重复周期允许的预期目标类型 */
export function getTaskExpectedGoalTypeOptions(period: TaskRepeatPeriod): BuildHabitExpectedGoalType[] {
  if (period === '每日') return ['times'];
  return ['days', 'times'];
}

function daysInMonth(year: number, month0: number): number {
  return new Date(year, month0 + 1, 0).getDate();
}

function daysInYear(year: number): number {
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  return isLeap ? 366 : 365;
}

/** 完成任务：预期目标数值上限（按天数受周期天数约束） */
export function getTaskExpectedGoalMaxValue(
  period: TaskRepeatPeriod,
  type: BuildHabitExpectedGoalType,
  referenceDate: Date = new Date()
): number {
  if (type === 'times') return 9999;
  switch (period) {
    case '每日':
      return 1;
    case '每周':
      return 7;
    case '每月':
      return daysInMonth(referenceDate.getFullYear(), referenceDate.getMonth());
    case '每年':
      return daysInYear(referenceDate.getFullYear());
    default:
      return 999;
  }
}

/** 按重复周期规范化预期目标（类型与数值） */
export function normalizeTaskExpectedGoal(
  period: TaskRepeatPeriod,
  goal: { type: BuildHabitExpectedGoalType; value: number },
  referenceDate: Date = new Date()
): BuildHabitExpectedGoal {
  const allowed = getTaskExpectedGoalTypeOptions(period);
  const type = allowed.includes(goal.type) ? goal.type : allowed[0];
  const max = getTaskExpectedGoalMaxValue(period, type, referenceDate);
  const value = Math.min(max, Math.max(1, Math.round(goal.value)));
  return { type, value };
}

export function describeTaskExpectedGoalConstraints(period: TaskRepeatPeriod): string {
  if (period === '每日') return '每日重复仅支持按次数';
  if (period === '每周') return '每周按天数最多 7 天';
  if (period === '每月') {
    const n = daysInMonth(new Date().getFullYear(), new Date().getMonth());
    return `每月按天数最多 ${n} 天`;
  }
  const y = daysInYear(new Date().getFullYear());
  return `每年按天数最多 ${y} 天`;
}
