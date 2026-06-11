import { isFinanceAccountExcludedFromAggregates } from '@/lib/repositories/finance/finance-account-extra';
import type { FinanceAccountBalanceRow, FinanceTransactionRow } from '@/lib/repositories/finance/finance.types';

function readTransferLeg(extraData: string | null): 'out' | 'in' | null {
  if (!extraData) return null;
  try {
    const raw = JSON.parse(extraData) as unknown;
    if (!raw || typeof raw !== 'object') return null;
    const leg = (raw as Record<string, unknown>).transfer_leg;
    return leg === 'out' || leg === 'in' ? leg : null;
  } catch {
    return null;
  }
}

/** 与 `getFinanceAccountsWithBalance` 汇总规则一致：收入 +、支出 -、转账按转出/转入计入。 */
export function getTxnNetWorthTotalDelta(txn: FinanceTransactionRow): number {
  if (txn.transaction_type === 'income') return Math.abs(txn.amount);
  if (txn.transaction_type === 'expense') return -Math.abs(txn.amount);
  if (txn.transaction_type === 'transfer') {
    const leg = readTransferLeg(txn.extra_data);
    const absAmount = Math.abs(txn.amount);
    if (leg === 'out') return -absAmount;
    if (leg === 'in') return absAmount;
  }
  return 0;
}

/** 排除「不计入总资产/总负债」账户后的净资产合计，与资产页、记账页 hero 一致。 */
export function computeNetWorthTotal(accounts: FinanceAccountBalanceRow[]): number {
  return accounts.reduce((sum, account) => {
    if (isFinanceAccountExcludedFromAggregates(account.extra_data)) return sum;
    return sum + (account.balance ?? 0);
  }, 0);
}

function netWorthBeforeInstant(
  currentNetWorth: number,
  sortedTxnsDesc: Array<{ ms: number; d: number }>,
  cutoffMs: number,
): number {
  let suffix = 0;
  for (const txn of sortedTxnsDesc) {
    if (txn.ms < cutoffMs) break;
    suffix += txn.d;
  }
  return currentNetWorth - suffix;
}

export type BuildSavingsForecastSeriesOptions = {
  currentNetWorth: number;
  transactions: FinanceTransactionRow[];
  freeCashFlow: number;
  now?: Date;
};

/**
 * 12 点储蓄/净资产序列：过去 6 个月为月末净资产快照，本月锚定现有净资产，
 * 之后 6 个月按现金流图页自由现金流逐月叠加。
 */
export function buildSavingsForecastSeries(options: BuildSavingsForecastSeriesOptions): number[] {
  const now = options.now ?? new Date();
  const currentNetWorth = options.currentNetWorth;
  const freeCashFlow = options.freeCashFlow;

  const sortedTxnsDesc = options.transactions
    .map((txn) => ({
      ms: new Date(txn.happened_at).getTime(),
      d: getTxnNetWorthTotalDelta(txn),
    }))
    .filter((txn) => Number.isFinite(txn.ms))
    .sort((a, b) => b.ms - a.ms);

  return Array.from({ length: 12 }, (_, idx) => {
    if (idx > 5) {
      return currentNetWorth + (idx - 5) * freeCashFlow;
    }
    if (idx === 5) {
      return currentNetWorth;
    }
    const monthStart = new Date(now.getFullYear(), now.getMonth() - 5 + idx, 1);
    const nextMonthStartMs = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1, 0, 0, 0, 0).getTime();
    return netWorthBeforeInstant(currentNetWorth, sortedTxnsDesc, nextMonthStartMs);
  });
}
