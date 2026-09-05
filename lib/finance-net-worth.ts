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

function readUiLiabilityHints(extraData: string | null): { uiType?: string; uiIsLiability?: boolean } {
  if (!extraData?.trim()) return {};
  try {
    const raw = JSON.parse(extraData) as unknown;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const obj = raw as Record<string, unknown>;
    const uiType = typeof obj.ui_account_type === 'string' ? obj.ui_account_type.trim().toLowerCase() : undefined;
    const rawFlag = obj.ui_is_liability;
    const uiIsLiability =
      rawFlag === true || rawFlag === 1 || rawFlag === '1' || rawFlag === 'true';
    return { uiType, uiIsLiability };
  } catch {
    return {};
  }
}

/**
 * 负债账户判定：
 * account_type / sign_rule，以及 extra_data 里的 ui 标记。
 */
export function isFinanceLiabilityAccount(
  account: Pick<FinanceAccountBalanceRow, 'sign_rule' | 'account_type'> & {
    extra_data?: string | null;
  },
): boolean {
  const type = String(account.account_type ?? '')
    .trim()
    .toLowerCase();
  if (type === 'liability') return true;
  const n = typeof account.sign_rule === 'number' ? account.sign_rule : Number(account.sign_rule);
  if (Number.isFinite(n) && n < 0) return true;
  const hints = readUiLiabilityHints(account.extra_data ?? null);
  return hints.uiType === 'liability' || hints.uiIsLiability === true;
}

/**
 * 汇总时是否按负债处理：类型判定为负债，或账本余额为负（漏标类型的负债）。
 */
export function countsAsLiabilityInAggregates(
  account: Pick<FinanceAccountBalanceRow, 'sign_rule' | 'account_type' | 'balance'> & {
    extra_data?: string | null;
  },
): boolean {
  if (isFinanceLiabilityAccount(account)) return true;
  const b = account.balance;
  return typeof b === 'number' && Number.isFinite(b) && b < -1e-6;
}

/**
 * 负债债务额度（始终 ≥0）。
 * 兼容账本误存为正数的历史数据：负债不论正负余额都按绝对值计入总负债。
 */
export function financeLiabilityDebtMagnitude(balance: number | null | undefined): number {
  const n = typeof balance === 'number' && Number.isFinite(balance) ? balance : 0;
  return Math.abs(n);
}

/**
 * 将账户余额规范为账本约定：资产 ≥0，负债 ≤0。
 * 负债若误存为正数额度，转为对应负数；负余额一律保留为负债账本。
 */
export function normalizeFinanceAccountLedgerBalance(
  account: Pick<FinanceAccountBalanceRow, 'sign_rule' | 'account_type'> & {
    extra_data?: string | null;
  },
  balance: number | null | undefined,
): number {
  const n = typeof balance === 'number' && Number.isFinite(balance) ? balance : 0;
  if (isFinanceLiabilityAccount(account) || n < 0) return -Math.abs(n);
  return Math.max(0, n);
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

/** 总资产：非负债、未排除账户的余额（≥0）。 */
export function computeTotalAssets(accounts: FinanceAccountBalanceRow[]): number {
  return accounts.reduce((sum, account) => {
    if (countsAsLiabilityInAggregates(account)) return sum;
    if (isFinanceAccountExcludedFromAggregates(account.extra_data)) return sum;
    return sum + Math.max(0, account.balance ?? 0);
  }, 0);
}

/**
 * 总负债绝对值。
 * 负债账户一律计入（「不计入总资产」只对资产账户生效，避免负债被误剔导致净资产=总资产）。
 */
export function computeTotalLiabilitiesAbs(accounts: FinanceAccountBalanceRow[]): number {
  return accounts.reduce((sum, account) => {
    if (!countsAsLiabilityInAggregates(account)) return sum;
    return sum + financeLiabilityDebtMagnitude(account.balance);
  }, 0);
}

/** 净资产 = 总资产 − 总负债。 */
export function computeNetWorthTotal(accounts: FinanceAccountBalanceRow[]): number {
  return computeTotalAssets(accounts) - computeTotalLiabilitiesAbs(accounts);
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
