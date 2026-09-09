import { AppSettingKey, getAppSetting, removeAppSetting, setAppSetting } from '@/lib/app-settings-store';
import { parseIsoDateLocal, toIsoDate } from '@/lib/wish-savings-form-utils';

export type FinanceSavingsGoal = {
  /** 目标净资产金额 */
  targetAmount: number;
  /** 截止日期 YYYY-MM-DD（本地日历） */
  targetDate: string;
};

/** 与心愿存款计划一致的金额上限 */
export const FINANCE_SAVINGS_GOAL_MAX_AMOUNT = 99_999_999;

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function normalizeFinanceSavingsGoal(raw: unknown): FinanceSavingsGoal | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const amount =
    typeof o.targetAmount === 'number'
      ? o.targetAmount
      : typeof o.targetAmount === 'string'
        ? parseFloat(o.targetAmount)
        : NaN;
  if (!Number.isFinite(amount) || amount <= 0) return null;
  if (!isIsoDate(o.targetDate)) return null;
  return {
    targetAmount: Math.min(FINANCE_SAVINGS_GOAL_MAX_AMOUNT, Math.round(amount * 100) / 100),
    targetDate: o.targetDate,
  };
}

export async function loadFinanceSavingsGoal(): Promise<FinanceSavingsGoal | null> {
  try {
    const parsed = await getAppSetting<unknown>(AppSettingKey.financeSavingsGoal);
    return normalizeFinanceSavingsGoal(parsed);
  } catch {
    return null;
  }
}

export async function persistFinanceSavingsGoal(goal: FinanceSavingsGoal): Promise<void> {
  const normalized = normalizeFinanceSavingsGoal(goal);
  if (!normalized) {
    throw new Error('无效的存款目标');
  }
  await setAppSetting(AppSettingKey.financeSavingsGoal, normalized);
}

export async function clearFinanceSavingsGoal(): Promise<void> {
  await removeAppSetting(AppSettingKey.financeSavingsGoal);
}

/** 从今日（含）到目标日（含）的天数，至少为 1。目标日早于今日时仍返回 1（按当天补齐剩余）。 */
export function savingsGoalDaysLeftIncludingToday(today: Date, targetDateIso: string): number {
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const target = parseIsoDateLocal(targetDateIso);
  const end0 = new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime();
  const diff = Math.round((end0 - t0) / 86400000) + 1;
  return Math.max(1, diff);
}

export function formatSavingsGoalDateLabel(targetDateIso: string): string {
  const d = parseIsoDateLocal(targetDateIso);
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const weekday = weekdays[d.getDay()] ?? '';
  const yearNow = new Date().getFullYear();
  if (d.getFullYear() === yearNow) {
    return `${d.getMonth() + 1}月${d.getDate()}日 ${weekday}`;
  }
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${weekday}`;
}

export function formatSavingsGoalCountdownLabel(daysLeftIncludingToday: number, targetDateIso: string, today: Date): string {
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const target = parseIsoDateLocal(targetDateIso);
  const end0 = new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime();
  if (end0 < t0) return '已过期';
  if (daysLeftIncludingToday <= 1) return '今天截止';
  return `还剩 ${daysLeftIncludingToday} 天`;
}

export type FinanceSavingsGoalProgress = {
  gap: number;
  daysLeft: number;
  dailyTarget: number;
  achieved: boolean;
  overdue: boolean;
};

/** 相对当前净资产计算缺口与每日需存金额。 */
export function computeFinanceSavingsGoalProgress(
  goal: FinanceSavingsGoal,
  currentNetWorth: number,
  today: Date,
): FinanceSavingsGoalProgress {
  const net = Number.isFinite(currentNetWorth) ? currentNetWorth : 0;
  const gap = Math.max(0, goal.targetAmount - net);
  const achieved = gap <= 1e-6;
  const daysLeft = savingsGoalDaysLeftIncludingToday(today, goal.targetDate);
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const target = parseIsoDateLocal(goal.targetDate);
  const end0 = new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime();
  const overdue = end0 < t0 && !achieved;
  const dailyTarget = achieved ? 0 : gap / daysLeft;
  return { gap, daysLeft, dailyTarget, achieved, overdue };
}

export function defaultFinanceSavingsGoalDate(today: Date = new Date()): Date {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  d.setMonth(d.getMonth() + 3);
  return d;
}

export { toIsoDate as financeSavingsGoalToIsoDate, parseIsoDateLocal as financeSavingsGoalParseIsoDate };
