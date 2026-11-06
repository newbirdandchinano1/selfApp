/**
 * 财务一眼账 → iOS 主屏 / 锁屏小组件。
 * 预算与定时支出口径对齐 finance-reminder；不重新发明排期。
 */
import { Platform } from 'react-native';

import { parseStoredDatetime } from '@/lib/api-mysql-datetime';
import {
  getBudgetMonthKeyForDate,
  getBudgetPeriodStartForDate,
  getNextBudgetPeriodStart,
  getPreviousBudgetPeriodStart,
  loadBudgetRefreshDay,
  loadMonthBudgetSettings,
} from '@/lib/finance-monthly-budget';
import { computeBudgetUsagePercent } from '@/lib/finance-reminder-logic';
import { getFinanceReminderStatusSummary } from '@/lib/finance-reminder-notifications';
import {
  collectPaidScheduledExpenseSlots,
  isScheduledExpenseSlotPaid,
  isScheduledFinanceExpenseDueOnDay,
  loadScheduledFinanceExpenses,
  scheduledExpenseHappenedAtIso,
  sumScheduledExpensesInRange,
  addDaysToYmd,
  dateToFinanceYmd,
  type ScheduledFinanceExpense,
} from '@/lib/finance-scheduled-expense';
import { getFinanceTransactions } from '@/lib/repositories/finance/finance';
import { isFinanceTransactionExcludedFromBudget } from '@/lib/repositories/finance/finance-transaction-extra';
import type { FinanceTransactionRow } from '@/lib/repositories/finance/finance.types';
import { getLogicalLocalYmd, resolveDayBoundaryForPage } from '@/lib/tasks-logical-day';
import {
  buildFinanceGlance,
  financeGlanceToWidgetProps,
  pickEarliestScheduledExpense,
  resolveFinanceMaskAmounts,
  type FinanceScheduledCandidate,
  type FinanceGlanceWidgetProps,
} from '@/lib/widgets/finance-glance';
import { isExpoWidgetsNativeAvailable } from '@/lib/widgets/expo-widgets-compat';
import {
  ensureHomeWidgetsRegistered,
  pushWidgetSnapshotVerified,
} from '@/lib/widgets/widget-bridge';
import {
  getWidgetsSettings,
  shouldPushFinanceGlanceWidget,
} from '@/lib/widgets/widgets-settings';

let syncChain: Promise<void> = Promise.resolve();
let lastFingerprint = '';

function sumPeriodBudgetExpense(
  txns: FinanceTransactionRow[],
  start: Date,
  endExclusive: Date,
): { expense: number; income: number } {
  let expense = 0;
  let income = 0;
  for (const txn of txns) {
    const at = parseStoredDatetime(txn.happened_at);
    if (at < start || at >= endExclusive) continue;
    if (isFinanceTransactionExcludedFromBudget(txn.extra_data, txn.transaction_type)) continue;
    if (txn.transaction_type === 'expense') expense += Math.abs(txn.amount);
    else if (txn.transaction_type === 'income') income += Math.abs(txn.amount);
  }
  return { expense, income };
}

function sumPrevPeriodRemaining(
  txns: FinanceTransactionRow[],
  start: Date,
  endExclusive: Date,
): number {
  let income = 0;
  let expense = 0;
  for (const txn of txns) {
    const at = parseStoredDatetime(txn.happened_at);
    if (at < start || at >= endExclusive) continue;
    if (txn.transaction_type === 'income') income += Math.abs(txn.amount);
    else if (txn.transaction_type === 'expense') expense += Math.abs(txn.amount);
  }
  return Math.max(0, income - expense);
}

function collectDueYmds(item: ScheduledFinanceExpense, fromYmd: string, days: number): string[] {
  const out: string[] = [];
  let cursor = fromYmd;
  for (let i = 0; i < days; i += 1) {
    if (isScheduledFinanceExpenseDueOnDay(item, cursor)) out.push(cursor);
    const next = addDaysToYmd(cursor, 1);
    if (!next || next === cursor) break;
    cursor = next;
  }
  return out;
}

function collectUnpaidScheduledCandidates(
  items: ScheduledFinanceExpense[],
  paidSlots: Set<string>,
  now: Date,
  horizonDays = 60,
): FinanceScheduledCandidate[] {
  const fromYmd = dateToFinanceYmd(now);
  const nowMs = now.getTime();
  const out: FinanceScheduledCandidate[] = [];

  for (const item of items) {
    if (!item.enabled) continue;
    const dues = collectDueYmds(item, fromYmd, horizonDays);
    for (const ymd of dues) {
      for (let slot = 0; slot < item.timesPerDay; slot += 1) {
        if (isScheduledExpenseSlotPaid(paidSlots, item.id, ymd, slot)) continue;
        const iso = scheduledExpenseHappenedAtIso(ymd, item.hour, item.minute, slot);
        const dueMs = parseStoredDatetime(iso).getTime();
        if (!Number.isFinite(dueMs) || dueMs <= nowMs) continue;
        const totalMinutes = item.hour * 60 + item.minute + slot;
        out.push({
          id: item.id,
          name: item.name?.trim() || '定时支出',
          amount: item.amount,
          ymd,
          hour: Math.floor(totalMinutes / 60) % 24,
          minute: totalMinutes % 60,
          dueMs,
        });
      }
    }
  }
  return out;
}

function pausedProps(): FinanceGlanceWidgetProps {
  return {
    ...financeGlanceToWidgetProps(
      buildFinanceGlance({
        todaySpent: 0,
        budgetUsagePercent: null,
        hasBudget: false,
        next: null,
        primaryMetric: 'today_spent',
        showNextScheduled: false,
        maskAmounts: true,
        statusLine: '组件已暂停',
      }),
      { allowLockScreen: false },
    ),
    primaryLine: '—',
    secondaryLine: '组件已暂停',
    nextLine: '',
    statusLine: '组件已暂停',
  };
}

export async function buildTodayFinanceGlance(now = new Date()) {
  const settings = await getWidgetsSettings();
  const maskAmounts = resolveFinanceMaskAmounts({
    maskMode: settings.financeGlance.maskMode,
    globalMaskDefault: settings.privacy.financeMaskDefault,
  });

  const boundary = await resolveDayBoundaryForPage('finance');
  const todayYmd = getLogicalLocalYmd(now, boundary);

  const [txns, scheduled, refreshDay, monthSettings, reminderSummary] = await Promise.all([
    getFinanceTransactions({ cacheOnly: true }).catch(() => [] as FinanceTransactionRow[]),
    loadScheduledFinanceExpenses().catch(() => [] as ScheduledFinanceExpense[]),
    loadBudgetRefreshDay(),
    loadMonthBudgetSettings(),
    getFinanceReminderStatusSummary(now).catch(() => ({
      kind: 'none' as const,
      line: '打开 App 后同步账本',
      nextFireAt: null,
    })),
  ]);

  let todaySpent = 0;
  for (const txn of txns) {
    if (txn.transaction_type !== 'expense') continue;
    const at = parseStoredDatetime(txn.happened_at);
    if (getLogicalLocalYmd(at, boundary) !== todayYmd) continue;
    todaySpent += Math.abs(txn.amount);
  }

  const periodStart = getBudgetPeriodStartForDate(now, refreshDay);
  const periodEnd = getNextBudgetPeriodStart(periodStart, refreshDay);
  const periodKey = getBudgetMonthKeyForDate(now, refreshDay);
  const setting = monthSettings[periodKey];
  const baseAmount = setting?.baseAmount ?? 0;
  const includeLast = setting?.includeLastBalance ?? false;
  const hasBudget = baseAmount > 0 || includeLast;

  let budgetUsagePercent: number | null = null;
  if (hasBudget) {
    const prevStart = getPreviousBudgetPeriodStart(periodStart, refreshDay);
    const lastRemaining = sumPrevPeriodRemaining(txns, prevStart, periodStart);
    const { expense, income } = sumPeriodBudgetExpense(txns, periodStart, periodEnd);
    const scheduledDeduction = sumScheduledExpensesInRange(scheduled, periodStart, periodEnd);
    const usage = computeBudgetUsagePercent({
      baseAmount,
      includeLastBalance: includeLast,
      lastPeriodRemaining: lastRemaining,
      scheduledDeduction,
      periodIncome: income,
      periodExpense: expense,
    });
    budgetUsagePercent = usage.totalBudget > 0 ? usage.percent : null;
  }

  const paidSlots = collectPaidScheduledExpenseSlots(txns);
  const next = settings.financeGlance.showNextScheduled
    ? pickEarliestScheduledExpense(
        collectUnpaidScheduledCandidates(scheduled, paidSlots, now),
      )
    : null;

  return buildFinanceGlance({
    todaySpent,
    budgetUsagePercent: hasBudget ? budgetUsagePercent : null,
    hasBudget: hasBudget && budgetUsagePercent != null,
    next,
    primaryMetric: settings.financeGlance.primaryMetric,
    showNextScheduled: settings.financeGlance.showNextScheduled,
    maskAmounts,
    statusLine: reminderSummary.line,
  });
}

async function syncFinanceGlanceWidgetNow(reason: string): Promise<void> {
  if (Platform.OS !== 'ios') return;
  const { whenHomeWidgetsDbReady } = await import('@/lib/widgets/widget-sync-ready');
  await whenHomeWidgetsDbReady();
  await ensureHomeWidgetsRegistered();
  const settings = await getWidgetsSettings();
  const FinanceGlanceWidget = (await import('@/widgets/FinanceGlanceWidget')).default;

  if (!shouldPushFinanceGlanceWidget(settings)) {
    try {
      await pushWidgetSnapshotVerified(FinanceGlanceWidget as never, pausedProps() as never);
    } catch (e) {
      console.warn('[widgets] finance pause failed', e);
    }
    return;
  }

  const glance = await buildTodayFinanceGlance();
  const allowLock =
    settings.financeGlance.allowLockScreen && !settings.privacy.lockScreenStrict;
  const props = financeGlanceToWidgetProps(glance, {
    allowLockScreen: allowLock,
  });
  const fp = [
    props.primaryLine,
    props.secondaryLine,
    props.nextLine,
    props.statusLine,
    props.budgetAccentCode,
    props.masked,
    props.allowLockScreen,
  ].join('|');
  if (fp === lastFingerprint && reason === 'debounce') return;

  try {
    await pushWidgetSnapshotVerified(FinanceGlanceWidget as never, props as never);
    lastFingerprint = fp;
  } catch (e) {
    console.warn('[widgets] finance snapshot failed', reason, e);
  }

  if (__DEV__) {
    console.log('[widgets] finance-glance synced', reason, {
      primary: props.primaryLine,
      next: props.hasNext,
    });
  }
}

export function scheduleFinanceGlanceWidgetSync(reason: string): void {
  if (Platform.OS !== 'ios') return;
  if (!isExpoWidgetsNativeAvailable()) return;
  const task = syncChain.then(() => syncFinanceGlanceWidgetNow(reason));
  syncChain = task.catch((e) => {
    if (__DEV__) console.warn('[widgets] finance sync chain error', reason, e);
  });
  void task;
}

export async function previewFinanceGlanceWidgetProps(): Promise<FinanceGlanceWidgetProps> {
  try {
    const settings = await getWidgetsSettings();
    const allowLock =
      settings.financeGlance.allowLockScreen && !settings.privacy.lockScreenStrict;
    if (!settings.privacy.previewUseRealData) {
      return financeGlanceToWidgetProps(
        buildFinanceGlance({
          todaySpent: 128.5,
          budgetUsagePercent: 42,
          hasBudget: true,
          next: {
            id: 'demo',
            name: '房租',
            amount: 3200,
            ymd: '2026-11-08',
            hour: 9,
            minute: 0,
            dueMs: Date.now() + 86400000,
          },
          primaryMetric: settings.financeGlance.primaryMetric,
          showNextScheduled: settings.financeGlance.showNextScheduled,
          maskAmounts: resolveFinanceMaskAmounts({
            maskMode: settings.financeGlance.maskMode,
            globalMaskDefault: settings.privacy.financeMaskDefault,
          }),
          statusLine: '演示预览',
        }),
        { allowLockScreen: allowLock },
      );
    }
    const glance = await buildTodayFinanceGlance();
    return financeGlanceToWidgetProps(glance, {
      allowLockScreen: allowLock,
    });
  } catch {
    return {
      ...pausedProps(),
      statusLine: '暂无账本摘要',
      secondaryLine: '暂无账本摘要',
    };
  }
}
