/**
 * 财务一眼账 · 纯规则（可单测）。
 * 口径：今日已花（全日支出）/ 预算剩余%（对齐 computeBudgetUsagePercent）/ 下一笔未入账定时支出。
 */

export type FinanceGlancePrimaryMetric = 'today_spent' | 'budget_remaining';

export type FinanceGlanceMaskMode = 'follow' | 'force_mask' | 'plain';

export type FinanceBudgetAccent = 'ok' | 'warn80' | 'over' | 'none';

export type FinanceScheduledCandidate = {
  id: string;
  name: string;
  amount: number;
  ymd: string;
  hour: number;
  minute: number;
  dueMs: number;
};

export type FinanceGlanceInput = {
  todaySpent: number;
  /** 本周期已用 %（未夹断，可 >100） */
  budgetUsagePercent: number | null;
  hasBudget: boolean;
  next: FinanceScheduledCandidate | null;
  primaryMetric: FinanceGlancePrimaryMetric;
  showNextScheduled: boolean;
  maskAmounts: boolean;
  statusLine?: string;
};

export type FinanceGlance = {
  todaySpent: number;
  budgetRemainingPercent: number | null;
  budgetUsagePercent: number | null;
  budgetAccent: FinanceBudgetAccent;
  hasBudget: boolean;
  next: FinanceScheduledCandidate | null;
  primaryMetric: FinanceGlancePrimaryMetric;
  showNextScheduled: boolean;
  maskAmounts: boolean;
  statusLine: string;
};

export type FinanceGlanceWidgetProps = {
  title: string;
  primaryLine: string;
  secondaryLine: string;
  nextLine: string;
  /** 锁屏强制脱敏后的主/副行 */
  lockPrimaryLine: string;
  lockSecondaryLine: string;
  statusLine: string;
  budgetRemainingPct: number;
  budgetAccentCode: number;
  hasBudget: number;
  hasNext: number;
  masked: number;
  /** 1=允许锁屏外露（强制脱敏）；0=锁屏仅显示已隐藏 */
  allowLockScreen: number;
  deepLink: string;
};

export function formatGlanceYuan(amount: number): string {
  const n = Number.isFinite(amount) ? amount : 0;
  const prefix = n < 0 ? '-¥' : '¥';
  return `${prefix}${Math.abs(n).toLocaleString('zh-CN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

export function pad2Glance(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function formatGlanceClock(hour: number, minute: number): string {
  return `${pad2Glance(hour)}:${pad2Glance(minute)}`;
}

/** 预算剩余 %；超支时可为负，展示侧再夹断 */
export function computeBudgetRemainingPercent(usagePercent: number | null): number | null {
  if (usagePercent == null || !Number.isFinite(usagePercent)) return null;
  return 100 - usagePercent;
}

export function resolveBudgetAccent(usagePercent: number | null, hasBudget: boolean): FinanceBudgetAccent {
  if (!hasBudget || usagePercent == null || !Number.isFinite(usagePercent)) return 'none';
  if (usagePercent >= 100) return 'over';
  if (usagePercent >= 80) return 'warn80';
  return 'ok';
}

export function resolveFinanceMaskAmounts(input: {
  maskMode: FinanceGlanceMaskMode;
  globalMaskDefault: boolean;
}): boolean {
  if (input.maskMode === 'force_mask') return true;
  if (input.maskMode === 'plain') return false;
  return !!input.globalMaskDefault;
}

export function pickEarliestScheduledExpense(
  candidates: FinanceScheduledCandidate[],
): FinanceScheduledCandidate | null {
  if (candidates.length === 0) return null;
  return [...candidates].sort(
    (a, b) => a.dueMs - b.dueMs || a.name.localeCompare(b.name, 'zh'),
  )[0]!;
}

export function buildFinanceGlance(input: FinanceGlanceInput): FinanceGlance {
  const remaining = input.hasBudget
    ? computeBudgetRemainingPercent(input.budgetUsagePercent)
    : null;
  return {
    todaySpent: Math.max(0, Number.isFinite(input.todaySpent) ? input.todaySpent : 0),
    budgetRemainingPercent: remaining,
    budgetUsagePercent: input.hasBudget ? input.budgetUsagePercent : null,
    budgetAccent: resolveBudgetAccent(input.budgetUsagePercent, input.hasBudget),
    hasBudget: input.hasBudget,
    next: input.showNextScheduled ? input.next : null,
    primaryMetric: input.primaryMetric,
    showNextScheduled: input.showNextScheduled,
    maskAmounts: input.maskAmounts,
    statusLine: (input.statusLine || '').trim() || '打开 App 后同步账本',
  };
}

function moneyLabel(amount: number, masked: boolean): string {
  return masked ? '¥***' : formatGlanceYuan(amount);
}

function remainingLabel(remaining: number | null, hasBudget: boolean): string {
  if (!hasBudget || remaining == null) return '未设预算';
  const shown = Math.max(0, Math.round(remaining));
  return `剩余 ${shown}%`;
}

function nextLineOf(next: FinanceScheduledCandidate | null, masked: boolean): string {
  if (!next) return '';
  const name = (next.name || '定时支出').trim().slice(0, 12);
  const when = `${next.ymd.slice(5).replace('-', '/')} ${formatGlanceClock(next.hour, next.minute)}`;
  return `下一笔 · ${name} · ${when} · ${moneyLabel(next.amount, masked)}`;
}

export function financeGlanceToWidgetProps(
  glance: FinanceGlance,
  opts?: { deepLink?: string; allowLockScreen?: boolean },
): FinanceGlanceWidgetProps {
  const deepLink = opts?.deepLink ?? 'zheng://finance';
  const masked = glance.maskAmounts;
  const spentLine = `今日 ${moneyLabel(glance.todaySpent, masked)}`;
  const remainLine = remainingLabel(glance.budgetRemainingPercent, glance.hasBudget);
  const primaryIsSpent = glance.primaryMetric === 'today_spent';
  const lockSpent = `今日 ${moneyLabel(glance.todaySpent, true)}`;
  const lockPrimary = primaryIsSpent ? lockSpent : remainLine;
  const lockSecondary = primaryIsSpent ? remainLine : lockSpent;

  const accentCode =
    glance.budgetAccent === 'over' ? 2 : glance.budgetAccent === 'warn80' ? 1 : 0;

  return {
    title: '财务一眼',
    primaryLine: primaryIsSpent ? spentLine : remainLine,
    secondaryLine: primaryIsSpent ? remainLine : spentLine,
    nextLine: nextLineOf(glance.next, masked),
    lockPrimaryLine: lockPrimary,
    lockSecondaryLine: lockSecondary,
    statusLine: glance.statusLine,
    budgetRemainingPct:
      glance.budgetRemainingPercent == null
        ? -1
        : Math.max(0, Math.round(glance.budgetRemainingPercent)),
    budgetAccentCode: accentCode,
    hasBudget: glance.hasBudget ? 1 : 0,
    hasNext: glance.next ? 1 : 0,
    masked: masked ? 1 : 0,
    allowLockScreen: opts?.allowLockScreen ? 1 : 0,
    deepLink,
  };
}
