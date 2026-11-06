/**
 * 财务页本地提醒排期：
 * - P0 定时支出应记 / 傍晚收口
 * - P1 预算阈值（即时）+ 储蓄目标周轻催
 * - P2 当日未记账收口
 */

import { parseStoredDatetime, ymdFromDatetime } from '@/lib/api-mysql-datetime';
import { formatYmd } from '@/lib/date';
import {
  budgetThresholdCopy,
  computeBudgetUsagePercent,
  findNextLedgerWrapFireAt,
  findNextWeekdayFireAt,
  formatClockLabel,
  formatYuan,
  markBudgetThresholdNotified,
  pad2,
  pickNextScheduledExpenseReminder,
  resolveBudgetThresholdToNotify,
  type FinanceBudgetThresholdKind,
} from '@/lib/finance-reminder-logic';
import {
  addDaysToYmd,
  collectPaidScheduledExpenseSlots,
  isScheduledExpenseSlotPaid,
  isScheduledFinanceExpenseDueOnDay,
  loadScheduledFinanceExpenses,
  sumScheduledExpensesInRange,
  type ScheduledFinanceExpense,
} from '@/lib/finance-scheduled-expense';
import {
  getBudgetMonthKeyForDate,
  getBudgetPeriodStartForDate,
  getNextBudgetPeriodStart,
  getPreviousBudgetPeriodStart,
  loadBudgetRefreshDay,
  loadMonthBudgetSettings,
} from '@/lib/finance-monthly-budget';
import {
  computeFinanceSavingsGoalProgress,
  loadFinanceSavingsGoal,
} from '@/lib/finance-savings-goal';
import { computeNetWorthTotal } from '@/lib/finance-net-worth';
import { buildNotificationIdentifier, getNotificationCategoryMeta } from '@/lib/notification-catalog';
import {
  getNotificationCenterSettings,
  patchNotificationCenterSettings,
  type FinanceReminderPrefs,
  type NotificationCenterSettings,
} from '@/lib/notification-center-settings';
import {
  cancelScheduledByCategory,
  cancelScheduledByIdentifier,
  isLocalNotificationSchedulingUnavailable,
  scheduleDateReminder,
} from '@/lib/notification-scheduler';
import { prefetchFinanceNotificationWrapupCopy } from '@/lib/notification-ai-copy';
import {
  getFinanceAccountsWithBalance,
  getFinanceTransactions,
} from '@/lib/repositories/finance/finance';
import { isFinanceTransactionExcludedFromBudget } from '@/lib/repositories/finance/finance-transaction-extra';
import type { FinanceTransactionRow } from '@/lib/repositories/finance/finance.types';
import { getLogicalLocalYmd, resolveDayBoundaryForPage } from '@/lib/tasks-logical-day';
import { Platform } from 'react-native';
import { canScheduleAppNotification } from '@/lib/notification-center-settings';
import { isExpoSandboxNotificationDisabled } from '@/lib/notification-policy';
import { upsertInboxFromNotification } from '@/lib/repositories/notifications/notification-inbox';

const SCHEDULED_CHANNEL = {
  id: 'finance-scheduled-expense-reminders',
  name: '定时支出提醒',
  importance: 'default' as const,
  vibrationPattern: [0, 200, 120, 200],
};

const BUDGET_CHANNEL = {
  id: 'finance-budget-threshold-reminders',
  name: '预算阈值提醒',
  importance: 'high' as const,
  vibrationPattern: [0, 250, 120, 250],
};

const SAVINGS_CHANNEL = {
  id: 'finance-savings-nudge-reminders',
  name: '储蓄目标轻催',
  importance: 'default' as const,
  vibrationPattern: [0, 180, 100, 180],
};

const LEDGER_WRAP_CHANNEL = {
  id: 'finance-ledger-wrap-reminders',
  name: '未记账收口',
  importance: 'default' as const,
  vibrationPattern: [0, 180, 100, 180],
};

const LOOKAHEAD_DAYS = 60;

export function financeScheduledExpenseReminderIdentifier(expenseId: string): string {
  return (
    buildNotificationIdentifier('finance-scheduled-expense-reminder', expenseId) ??
    `selfapp-finance-scheduled-expense:${expenseId}`
  );
}

export function financeBudgetThresholdIdentifier(
  periodKey: string,
  kind: FinanceBudgetThresholdKind,
): string {
  return (
    buildNotificationIdentifier('finance-budget-threshold-reminder', `${periodKey}:${kind}`) ??
    `selfapp-finance-budget-threshold:${periodKey}:${kind}`
  );
}

export function financeSavingsNudgeIdentifier(): string {
  return (
    getNotificationCategoryMeta('finance-savings-nudge-reminder').identifierPrefix ??
    'selfapp-finance-savings-nudge'
  );
}

export function financeLedgerWrapIdentifier(): string {
  return (
    getNotificationCategoryMeta('finance-ledger-wrap-reminder').identifierPrefix ??
    'selfapp-finance-ledger-wrap'
  );
}

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

function sumPrevPeriodRemaining(txns: FinanceTransactionRow[], start: Date, endExclusive: Date): number {
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

function itemStillNeedsReminder(
  item: ScheduledFinanceExpense,
  ymd: string,
  paidSlots: Set<string>,
): boolean {
  for (let slot = 0; slot < item.timesPerDay; slot += 1) {
    if (!isScheduledExpenseSlotPaid(paidSlots, item.id, ymd, slot)) return true;
  }
  return false;
}

/** P0：按规则重登记每条启用中的定时支出提醒。 */
export async function syncFinanceScheduledExpenseReminders(
  settings?: NotificationCenterSettings,
): Promise<void> {
  if (isLocalNotificationSchedulingUnavailable()) return;
  const resolved = settings ?? (await getNotificationCenterSettings());
  if (!resolved.masterEnabled || resolved.categories['finance-scheduled-expense-reminder'] === false) {
    await cancelScheduledByCategory('finance-scheduled-expense-reminder');
    return;
  }

  const prefs = resolved.finance;
  const [items, transactions, boundary] = await Promise.all([
    loadScheduledFinanceExpenses(),
    getFinanceTransactions({ cacheOnly: true }).catch(() => [] as FinanceTransactionRow[]),
    resolveDayBoundaryForPage('finance'),
  ]);
  const paidSlots = collectPaidScheduledExpenseSlots(transactions);
  const now = new Date();
  const todayYmd = getLogicalLocalYmd(now, boundary);
  const enabledIds = new Set(items.filter((i) => i.enabled).map((i) => i.id));

  // 先清掉已关闭/删除项
  for (const item of items) {
    if (!item.enabled) {
      await cancelScheduledByIdentifier(financeScheduledExpenseReminderIdentifier(item.id));
    }
  }

  for (const item of items) {
    if (!item.enabled) continue;
    const id = financeScheduledExpenseReminderIdentifier(item.id);
    await cancelScheduledByIdentifier(id);

    const dueYmds = collectDueYmds(item, todayYmd, LOOKAHEAD_DAYS);
    const candidate = pickNextScheduledExpenseReminder({
      dueYmds,
      hour: item.hour,
      minute: item.minute,
      advanceMinutes: prefs.scheduledAdvanceMinutes,
      eveningWrapEnabled: prefs.scheduledEveningWrapEnabled,
      eveningWrapHour: prefs.scheduledEveningWrapHour,
      eveningWrapMinute: prefs.scheduledEveningWrapMinute,
      now,
      needsReminderOnYmd: (ymd) => itemStillNeedsReminder(item, ymd, paidSlots),
    });
    if (!candidate) continue;

    const amountLabel = formatYuan(item.amount);
    const timeLabel = formatClockLabel(
      new Date(
        2000,
        0,
        1,
        item.hour,
        item.minute,
      ),
    );
    const title =
      candidate.kind === 'evening_wrap' ? `定时支出未入账 · ${item.name}` : `定时支出提醒 · ${item.name}`;
    const body =
      candidate.kind === 'evening_wrap'
        ? `今日 ${amountLabel} 尚未入账，记得确认。`
        : `应记 ${candidate.dueYmd} ${timeLabel} · ${amountLabel}`;

    await scheduleDateReminder({
      category: 'finance-scheduled-expense-reminder',
      identifier: id,
      fireAt: candidate.fireAt,
      channel: SCHEDULED_CHANNEL,
      strong: false,
      data: {
        type: 'finance-scheduled-expense-reminder',
        expenseId: item.id,
        dueYmd: candidate.dueYmd,
        slotKind: candidate.kind,
      },
      fallback: { title, body },
      fingerprint: `fse|${item.id}|${candidate.kind}|${candidate.fireAt.toISOString().slice(0, 16)}`,
      contextBlock: `定时支出「${item.name}」${candidate.kind === 'evening_wrap' ? '傍晚收口' : '应记前提醒'}`,
    });
  }

  // 兜底：库里已删但本地可能残留的预约，靠 category cancel 太狠；上面已按 id cancel。
  void enabledIds;
}

async function presentImmediateFinanceNotification(params: {
  category:
    | 'finance-budget-threshold-reminder'
    | 'finance-savings-nudge-reminder'
    | 'finance-ledger-wrap-reminder';
  identifier: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  channel: typeof BUDGET_CHANNEL;
}): Promise<boolean> {
  if (Platform.OS === 'web' || isExpoSandboxNotificationDisabled()) return false;
  if (!(await canScheduleAppNotification({ category: params.category, identifier: params.identifier }))) {
    return false;
  }
  try {
    const Notifications = await import('expo-notifications');
    const perm = await Notifications.getPermissionsAsync();
    let granted = perm.status === 'granted';
    if (!granted && perm.canAskAgain) {
      const req = await Notifications.requestPermissionsAsync();
      granted = req.status === 'granted';
    }
    if (!granted) return false;

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(params.channel.id, {
        name: params.channel.name,
        importance: Notifications.AndroidImportance.DEFAULT,
        vibrationPattern: params.channel.vibrationPattern,
      });
    }

    await Notifications.scheduleNotificationAsync({
      identifier: params.identifier,
      content: {
        title: params.title,
        body: params.body,
        data: params.data,
        ...(Platform.OS === 'android' ? { channelId: params.channel.id } : {}),
      },
      trigger: null,
    });
    try {
      await upsertInboxFromNotification({
        dedupeKey: params.identifier,
        category: params.category,
        title: params.title,
        body: params.body,
        data: params.data,
        source: 'local',
      });
    } catch (e) {
      console.warn('[finance-reminder] inbox upsert failed', e);
    }
    return true;
  } catch (e) {
    console.warn('[finance-reminder] present failed', e);
    return false;
  }
}

/** P1：检查预算阈值并即时推送（每档每周期最多一次）。 */
export async function syncFinanceBudgetThresholdReminders(
  settings?: NotificationCenterSettings,
): Promise<void> {
  if (isLocalNotificationSchedulingUnavailable()) return;
  const resolved = settings ?? (await getNotificationCenterSettings());
  if (!resolved.masterEnabled || resolved.categories['finance-budget-threshold-reminder'] === false) {
    return;
  }

  const prefs = resolved.finance;
  const now = new Date();
  const [refreshDay, monthSettings, transactions, scheduled] = await Promise.all([
    loadBudgetRefreshDay(),
    loadMonthBudgetSettings(),
    getFinanceTransactions({ cacheOnly: true }).catch(() => [] as FinanceTransactionRow[]),
    loadScheduledFinanceExpenses(),
  ]);

  const periodStart = getBudgetPeriodStartForDate(now, refreshDay);
  const periodEnd = getNextBudgetPeriodStart(periodStart, refreshDay);
  const periodKey = getBudgetMonthKeyForDate(now, refreshDay);
  const setting = monthSettings[periodKey];
  const baseAmount = setting?.baseAmount ?? 0;
  if (!(baseAmount > 0) && !(setting?.includeLastBalance)) {
    // 未设预算则不催
    return;
  }

  const prevStart = getPreviousBudgetPeriodStart(periodStart, refreshDay);
  const lastRemaining = sumPrevPeriodRemaining(transactions, prevStart, periodStart);
  const { expense, income } = sumPeriodBudgetExpense(transactions, periodStart, periodEnd);
  const scheduledDeduction = sumScheduledExpensesInRange(scheduled, periodStart, periodEnd);
  const usage = computeBudgetUsagePercent({
    baseAmount,
    includeLastBalance: setting?.includeLastBalance ?? false,
    lastPeriodRemaining: lastRemaining,
    scheduledDeduction,
    periodIncome: income,
    periodExpense: expense,
  });
  if (usage.totalBudget <= 0) return;

  const already = prefs.budgetNotifiedByPeriod[periodKey] ?? {};
  const kind = resolveBudgetThresholdToNotify({
    percent: usage.percent,
    notify50: prefs.budgetNotify50,
    notify80: prefs.budgetNotify80,
    notifyOver: prefs.budgetNotifyOver,
    already,
  });
  if (!kind) return;

  const fallback = budgetThresholdCopy(kind, usage.percent, usage.usedExpense, usage.totalBudget);
  const identifier = financeBudgetThresholdIdentifier(periodKey, kind);
  const fingerprint = `fbt|${periodKey}|${kind}|${Math.round(usage.percent)}`;
  const copy = await prefetchFinanceNotificationWrapupCopy({
    identifier,
    fingerprint,
    period: 'daily',
    fallback,
    summaryText: [
      `提醒类型：预算阈值 ${kind}`,
      `本周期预算用量：${Math.round(usage.percent)}%`,
      `已用支出：${formatYuan(usage.usedExpense)} / 总预算 ${formatYuan(usage.totalBudget)}`,
      `规则兜底标题：${fallback.title}`,
      `规则兜底正文：${fallback.body}`,
    ].join('\n'),
  });
  const ok = await presentImmediateFinanceNotification({
    category: 'finance-budget-threshold-reminder',
    identifier,
    title: copy.title,
    body: copy.body,
    data: {
      type: 'finance-budget-threshold-reminder',
      periodKey,
      thresholdKind: kind,
      percent: usage.percent,
    },
    channel: BUDGET_CHANNEL,
  });
  if (!ok) return;

  const nextFlags = markBudgetThresholdNotified(already, kind);
  await patchNotificationCenterSettings({
    finance: {
      budgetNotifiedByPeriod: {
        ...prefs.budgetNotifiedByPeriod,
        [periodKey]: nextFlags,
      },
    },
  });
}

/** P1：储蓄目标周轻催。 */
export async function syncFinanceSavingsNudgeReminders(
  settings?: NotificationCenterSettings,
): Promise<void> {
  if (isLocalNotificationSchedulingUnavailable()) return;
  const resolved = settings ?? (await getNotificationCenterSettings());
  const id = financeSavingsNudgeIdentifier();
  await cancelScheduledByIdentifier(id);

  if (!resolved.masterEnabled || resolved.categories['finance-savings-nudge-reminder'] === false) {
    return;
  }

  const goal = await loadFinanceSavingsGoal();
  if (!goal) return;

  const accounts = await getFinanceAccountsWithBalance().catch(() => []);
  const net = computeNetWorthTotal(accounts);
  const now = new Date();
  const progress = computeFinanceSavingsGoalProgress(goal, net, now);
  if (progress.achieved) return;

  const prefs = resolved.finance;
  const fireAt = findNextWeekdayFireAt({
    weekday: prefs.savingsNudgeWeekday,
    hour: prefs.savingsNudgeHour,
    minute: prefs.savingsNudgeMinute,
    now,
  });
  if (!fireAt) return;

  const daily = formatYuan(progress.dailyTarget);
  const gap = formatYuan(progress.gap);
  await scheduleDateReminder({
    category: 'finance-savings-nudge-reminder',
    identifier: id,
    fireAt,
    channel: SAVINGS_CHANNEL,
    strong: false,
    data: { type: 'finance-savings-nudge-reminder' },
    fallback: {
      title: '储蓄目标轻催',
      body: `距目标还差 ${gap} · 建议每日存 ${daily}`,
    },
    fingerprint: `fsn|${goal.targetDate}|${fireAt.toISOString().slice(0, 16)}`,
    contextBlock: `储蓄目标缺口 ${gap}`,
  });
}

/** P2：当日未记账傍晚收口。 */
export async function syncFinanceLedgerWrapReminders(
  settings?: NotificationCenterSettings,
): Promise<void> {
  if (isLocalNotificationSchedulingUnavailable()) return;
  const resolved = settings ?? (await getNotificationCenterSettings());
  const id = financeLedgerWrapIdentifier();
  await cancelScheduledByIdentifier(id);

  if (!resolved.masterEnabled || resolved.categories['finance-ledger-wrap-reminder'] === false) {
    return;
  }

  const prefs = resolved.finance;
  const [transactions, boundary] = await Promise.all([
    getFinanceTransactions({ cacheOnly: true }).catch(() => [] as FinanceTransactionRow[]),
    resolveDayBoundaryForPage('finance'),
  ]);
  const ymdsWithTxn = new Set<string>();
  for (const txn of transactions) {
    const ymd = ymdFromDatetime(txn.happened_at);
    if (ymd) ymdsWithTxn.add(ymd);
  }

  const now = new Date();
  const fireAt = findNextLedgerWrapFireAt({
    hour: prefs.ledgerWrapHour,
    minute: prefs.ledgerWrapMinute,
    now,
    muteYmd: prefs.ledgerWrapMuteYmd,
    hasTxnOnYmd: (ymd) => ymdsWithTxn.has(ymd),
    ymdOf: (d) => getLogicalLocalYmd(d, boundary),
  });
  if (!fireAt) return;

  const fingerprint = `flw|${fireAt.toISOString().slice(0, 16)}`;
  const fallback = {
    title: '今天还没记账',
    body: '花半分钟记一笔，预算与复盘会更准。',
  };
  const fireYmd = getLogicalLocalYmd(fireAt, boundary);
  // 排期前低频预取 AI 收口文案；失败仍走规则兜底（schedule 只读缓存）
  await prefetchFinanceNotificationWrapupCopy({
    identifier: id,
    fingerprint,
    period: 'daily',
    fallback,
    summaryText: [
      '提醒类型：当日未记账傍晚收口',
      `计划提醒日：${fireYmd}`,
      `当日是否已有流水：否（否则不会排期）`,
      `近几日有流水的日期数：${ymdsWithTxn.size}`,
      `规则兜底标题：${fallback.title}`,
      `规则兜底正文：${fallback.body}`,
    ].join('\n'),
  });

  await scheduleDateReminder({
    category: 'finance-ledger-wrap-reminder',
    identifier: id,
    fireAt,
    channel: LEDGER_WRAP_CHANNEL,
    strong: false,
    data: { type: 'finance-ledger-wrap-reminder' },
    fallback,
    fingerprint,
    contextBlock: '财务未记账收口',
  });
}

/** 财务四类提醒统一重同步（偏好变更 / 财务页聚焦 / 定时支出变更后调用）。 */
export async function syncAllFinanceReminders(
  settings?: NotificationCenterSettings,
): Promise<void> {
  const resolved = settings ?? (await getNotificationCenterSettings());
  await Promise.all([
    syncFinanceScheduledExpenseReminders(resolved).catch((e) =>
      console.warn('同步定时支出提醒失败', e),
    ),
    syncFinanceBudgetThresholdReminders(resolved).catch((e) =>
      console.warn('同步预算阈值提醒失败', e),
    ),
    syncFinanceSavingsNudgeReminders(resolved).catch((e) =>
      console.warn('同步储蓄轻催失败', e),
    ),
    syncFinanceLedgerWrapReminders(resolved).catch((e) =>
      console.warn('同步未记账收口失败', e),
    ),
  ]);
}

export async function cancelAllFinanceReminders(): Promise<void> {
  await Promise.all([
    cancelScheduledByCategory('finance-scheduled-expense-reminder'),
    cancelScheduledByCategory('finance-budget-threshold-reminder'),
    cancelScheduledByIdentifier(financeSavingsNudgeIdentifier()),
    cancelScheduledByIdentifier(financeLedgerWrapIdentifier()),
  ]);
}

export async function muteFinanceLedgerWrapForToday(): Promise<void> {
  const boundary = await resolveDayBoundaryForPage('finance');
  const ymd = getLogicalLocalYmd(new Date(), boundary);
  await patchNotificationCenterSettings({ finance: { ledgerWrapMuteYmd: ymd } });
  await syncFinanceLedgerWrapReminders();
}

export type FinanceReminderStatusSummary = {
  kind: 'off' | 'scheduled' | 'none';
  line: string;
  nextFireAt: Date | null;
};

/** 财务页状态行：优先展示最近一条预约提醒。 */
export async function getFinanceReminderStatusSummary(
  now: Date = new Date(),
): Promise<FinanceReminderStatusSummary> {
  try {
    const settings = await getNotificationCenterSettings();
    if (!settings.masterEnabled) {
      return { kind: 'off', line: '财务提醒已关闭', nextFireAt: null };
    }

    const anyOn =
      settings.categories['finance-scheduled-expense-reminder'] !== false ||
      settings.categories['finance-budget-threshold-reminder'] !== false ||
      settings.categories['finance-savings-nudge-reminder'] !== false ||
      settings.categories['finance-ledger-wrap-reminder'] !== false;
    if (!anyOn) {
      return { kind: 'off', line: '财务提醒已关闭', nextFireAt: null };
    }

    if (isLocalNotificationSchedulingUnavailable()) {
      return { kind: 'none', line: '本端暂不支持预约提醒', nextFireAt: null };
    }

    const Notifications = await import('expo-notifications');
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    const financePrefixes = [
      'selfapp-finance-scheduled-expense:',
      'selfapp-finance-savings-nudge',
      'selfapp-finance-ledger-wrap',
    ];
    let next: { at: Date; title: string } | null = null;
    for (const item of scheduled) {
      const id = String(item.identifier ?? '');
      if (!financePrefixes.some((p) => id === p || id.startsWith(p))) continue;
      const trigger = item.trigger as { type?: string; date?: Date | number; value?: number } | null;
      let atMs = 0;
      if (trigger && typeof trigger === 'object') {
        if (trigger.date instanceof Date) atMs = trigger.date.getTime();
        else if (typeof trigger.date === 'number') atMs = trigger.date;
        else if (typeof trigger.value === 'number') atMs = trigger.value;
      }
      if (!Number.isFinite(atMs) || atMs <= now.getTime()) continue;
      const title = String(item.content?.title ?? '财务提醒');
      if (!next || atMs < next.at.getTime()) {
        next = { at: new Date(atMs), title };
      }
    }

    if (!next) {
      const budgetOn = settings.categories['finance-budget-threshold-reminder'] !== false;
      if (budgetOn) {
        return { kind: 'none', line: '预算阈值待命 · 点此设置', nextFireAt: null };
      }
      return { kind: 'none', line: '暂无财务预约提醒', nextFireAt: null };
    }

    const shortTitle = next.title.replace(/^定时支出提醒 · /, '').replace(/^定时支出未入账 · /, '');
    return {
      kind: 'scheduled',
      line: `下次提醒 · ${pad2(next.at.getHours())}:${pad2(next.at.getMinutes())} · ${shortTitle}`,
      nextFireAt: next.at,
    };
  } catch (e) {
    console.warn('读取财务提醒状态失败', e);
    return { kind: 'none', line: '财务提醒状态暂不可用', nextFireAt: null };
  }
}

export type { FinanceReminderPrefs };
