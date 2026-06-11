import { makeTimestampEntityId } from '@/lib/entity-id';
import {
  addDaysToYmd,
  buildScheduledExpenseSlotKey,
  compareYmd,
  isScheduledFinanceExpenseDueOnDay,
  loadScheduledFinanceExpenses,
  scheduledExpenseHappenedAtIso,
  type ScheduledFinanceExpense,
  ymdFromIso,
} from '@/lib/finance-scheduled-expense';
import {
  budgetExtraPatchForTransaction,
  FINANCE_TXN_EXTRA_SCHEDULED_EXPENSE_AUTO,
  FINANCE_TXN_EXTRA_SCHEDULED_EXPENSE_ID,
  FINANCE_TXN_EXTRA_SCHEDULED_EXPENSE_SLOT,
  getScheduledExpenseSlotFromTxnExtra,
} from '@/lib/repositories/finance/finance-transaction-extra';
import {
  createFinanceTransaction,
  financeSignedAmountForSave,
  getFinanceAccountsWithBalance,
  validateFinanceTransactionBeforeSave,
} from '@/lib/repositories/finance/finance';
import type { FinanceAccountBalanceRow, FinanceTransactionRow } from '@/lib/repositories/finance/finance.types';
import { DEFAULT_TASKS_DAY_BOUNDARY, getLogicalLocalYmd, loadTasksDayBoundary } from '@/lib/tasks-logical-day';

const BACKFILL_DAYS = 14;

let runnerChain: Promise<void> = Promise.resolve();

function buildExistingScheduledSlots(transactions: FinanceTransactionRow[]): Set<string> {
  const slots = new Set<string>();
  for (const txn of transactions) {
    const slot = getScheduledExpenseSlotFromTxnExtra(txn.extra_data);
    if (slot) slots.add(slot);
  }
  return slots;
}

function resolveCatchUpStartYmd(item: ScheduledFinanceExpense, todayYmd: string): string {
  const createdYmd = ymdFromIso(item.createdAt);
  const backfillStart = addDaysToYmd(todayYmd, -BACKFILL_DAYS) ?? todayYmd;
  if (!createdYmd) return backfillStart;
  return compareYmd(createdYmd, backfillStart) >= 0 ? createdYmd : backfillStart;
}

function isScheduledTimeReached(ymd: string, hour: number, minute: number, now: Date): boolean {
  const happenedAt = scheduledExpenseHappenedAtIso(ymd, hour, minute, 0);
  return now.getTime() >= new Date(happenedAt).getTime();
}

async function createScheduledExpenseTransaction(input: {
  item: ScheduledFinanceExpense;
  account: FinanceAccountBalanceRow;
  ymd: string;
  slotIndex: number;
}): Promise<boolean> {
  const { item, account, ymd, slotIndex } = input;
  const amountAbs = item.amount;
  const signedAmount = financeSignedAmountForSave(account.sign_rule, account.account_type, amountAbs);
  const extraData = JSON.stringify({
    [FINANCE_TXN_EXTRA_SCHEDULED_EXPENSE_AUTO]: true,
    [FINANCE_TXN_EXTRA_SCHEDULED_EXPENSE_ID]: item.id,
    [FINANCE_TXN_EXTRA_SCHEDULED_EXPENSE_SLOT]: buildScheduledExpenseSlotKey(ymd, slotIndex),
    category_key: item.categoryKey ?? null,
    category_label: item.categoryLabel ?? null,
    ...budgetExtraPatchForTransaction('expense', item.includeInBudget),
  });

  const boundsErr = await validateFinanceTransactionBeforeSave({
    accountId: account.id,
    transactionType: 'expense',
    amount: signedAmount,
    extraData,
    accountName: account.name,
    uiLedgerBalance: account.balance,
  });
  if (boundsErr) {
    if (__DEV__) console.warn('[scheduled-expense] skip due to balance', item.name, boundsErr);
    return false;
  }

  await createFinanceTransaction(
    {
      id: makeTimestampEntityId('ft_', 8),
      name: item.name,
      happened_at: scheduledExpenseHappenedAtIso(ymd, item.hour, item.minute, slotIndex),
      account_id: account.id,
      transaction_type: 'expense',
      flow_category_id: item.flowCategoryId ?? null,
      amount: signedAmount,
      note: '定时支出自动记账',
      extra_data: extraData,
    },
    { skipBalanceRecheck: true },
  );
  return true;
}

export type RunScheduledFinanceExpensesResult = {
  createdCount: number;
  skippedCount: number;
};

export async function runScheduledFinanceExpenses(opts?: {
  logicalTodayYmd?: string;
  now?: Date;
}): Promise<RunScheduledFinanceExpensesResult> {
  const now = opts?.now ?? new Date();
  let boundary = DEFAULT_TASKS_DAY_BOUNDARY;
  try {
    boundary = await loadTasksDayBoundary();
  } catch {
    /* use default */
  }
  const todayYmd = opts?.logicalTodayYmd ?? getLogicalLocalYmd(now, boundary);

  const [items, accounts] = await Promise.all([loadScheduledFinanceExpenses(), getFinanceAccountsWithBalance()]);
  if (!items.length) return { createdCount: 0, skippedCount: 0 };

  const { getFinanceTransactions } = await import('@/lib/repositories/finance/finance');
  const transactions = await getFinanceTransactions();
  const existingSlots = buildExistingScheduledSlots(transactions);
  const accountById = new Map(accounts.map((a) => [a.id, a]));

  let createdCount = 0;
  let skippedCount = 0;

  for (const item of items) {
    if (!item.enabled) continue;
    const account = accountById.get(item.accountId);
    if (!account) {
      skippedCount += 1;
      continue;
    }

    const startYmd = resolveCatchUpStartYmd(item, todayYmd);
    let cursor = startYmd;
    while (cursor && compareYmd(cursor, todayYmd) <= 0) {
      if (isScheduledFinanceExpenseDueOnDay(item, cursor)) {
        const isToday = cursor === todayYmd;
        if (!isToday || isScheduledTimeReached(cursor, item.hour, item.minute, now)) {
          for (let slot = 0; slot < item.timesPerDay; slot += 1) {
            const slotKey = buildScheduledExpenseSlotKey(cursor, slot);
            if (existingSlots.has(slotKey)) continue;
            const ok = await createScheduledExpenseTransaction({ item, account, ymd: cursor, slotIndex: slot });
            if (ok) {
              existingSlots.add(slotKey);
              createdCount += 1;
            } else {
              skippedCount += 1;
            }
          }
        }
      }
      const next = addDaysToYmd(cursor, 1);
      if (!next || next === cursor) break;
      cursor = next;
    }
  }

  return { createdCount, skippedCount };
}

export function scheduleRunScheduledFinanceExpenses(reason: string): void {
  const task = runnerChain.then(async () => {
    try {
      const result = await runScheduledFinanceExpenses();
      if (__DEV__ && (result.createdCount > 0 || result.skippedCount > 0)) {
        console.log('[scheduled-expense]', reason, result);
      }
    } catch (e) {
      if (__DEV__) console.warn('[scheduled-expense] run failed', reason, e);
    }
  });
  runnerChain = task.catch(() => {});
  void task;
}
