/**
 * 财务流水本地聚合（Page API 兜底唯一口径）。
 * 与后端 `getFinanceDailySummaries` / `getFinanceStats` 对齐：
 * - 仅 `income` / `expense`
 * - 默认排除余额校正
 * - 转账不计入收支
 */
import { ymdFromDatetime } from '@/lib/api-read-helpers';
import { isBalanceCorrectionFinanceTransaction } from '@/lib/repositories/finance/finance-transaction-extra';
import type { FinanceDailySummaryRow } from '@/lib/repositories/finance/finance.types';

export type AggregateTxnLike = {
  happened_at: string;
  transaction_type: string;
  amount: number;
  name?: string;
  extra_data?: string | null;
};

export type AggregateTransactionsOpts = {
  /** YYYY-MM-DD inclusive */
  start?: string;
  /** YYYY-MM-DD inclusive */
  end?: string;
  /** 默认 true，与服务端 stats/daily-summaries 一致 */
  excludeCorrections?: boolean;
};

export type AggregateDayBucket = {
  income: number;
  expense: number;
  net: number;
};

export type AggregateTransactionsResult = {
  days: FinanceDailySummaryRow[];
  byDay: Map<string, AggregateDayBucket>;
  byMonth: Map<string, AggregateDayBucket>;
  income: number;
  expense: number;
  net: number;
  txnCount: number;
};

export function roundFinanceMoney(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function ymdParts(ymd: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

/** 闭区间日期列表（趋势补齐用） */
export function listYmdInclusive(start: string, end: string): string[] {
  const a = ymdParts(start);
  const b = ymdParts(end);
  if (!a || !b || start > end) return [];
  const out: string[] = [];
  const cursor = new Date(a.y, a.m - 1, a.d);
  const last = new Date(b.y, b.m - 1, b.d);
  while (cursor <= last) {
    const y = cursor.getFullYear();
    const mo = String(cursor.getMonth() + 1).padStart(2, '0');
    const d = String(cursor.getDate()).padStart(2, '0');
    out.push(`${y}-${mo}-${d}`);
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

export function listMonthKeysInclusive(start: string, end: string): string[] {
  const a = ymdParts(start);
  const b = ymdParts(end);
  if (!a || !b || start > end) return [];
  const out: string[] = [];
  let y = a.y;
  let m = a.m;
  while (y < b.y || (y === b.y && m <= b.m)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

export function resolveStatsGranularity(
  requested: 'day' | 'month' | 'auto' | undefined,
  start: string,
  end: string,
): 'day' | 'month' {
  if (requested === 'day' || requested === 'month') return requested;
  const days = listYmdInclusive(start, end).length;
  if (days > 90 || start.slice(0, 4) !== end.slice(0, 4)) return 'month';
  return 'day';
}

function emptyBucket(): AggregateDayBucket {
  return { income: 0, expense: 0, net: 0 };
}

function addToBucket(bucket: AggregateDayBucket, type: 'income' | 'expense', amount: number): void {
  if (type === 'income') {
    bucket.income += amount;
    bucket.net += amount;
  } else {
    bucket.expense += amount;
    bucket.net -= amount;
  }
}

/** 是否计入收支统计（与服务端 IN ('income','expense') + NOT balance_correction 对齐） */
export function isAggregatableFinanceTxn(
  txn: AggregateTxnLike,
  opts?: { excludeCorrections?: boolean },
): boolean {
  const type = String(txn.transaction_type ?? '').trim();
  if (type !== 'income' && type !== 'expense') return false;
  if (opts?.excludeCorrections === false) return true;
  return !isBalanceCorrectionFinanceTransaction({
    name: txn.name ?? '',
    extra_data: txn.extra_data ?? null,
  });
}

/**
 * 本地流水聚合兜底。服务端专口可用时不应调用此函数作为主路径。
 */
export function aggregateTransactions(
  transactions: AggregateTxnLike[],
  opts?: AggregateTransactionsOpts,
): AggregateTransactionsResult {
  const excludeCorrections = opts?.excludeCorrections !== false;
  const byDay = new Map<string, AggregateDayBucket>();
  const byMonth = new Map<string, AggregateDayBucket>();
  let income = 0;
  let expense = 0;
  let txnCount = 0;

  for (const txn of transactions) {
    if (!isAggregatableFinanceTxn(txn, { excludeCorrections })) continue;
    const day = ymdFromDatetime(txn.happened_at);
    if (!day) continue;
    if (opts?.start && day < opts.start) continue;
    if (opts?.end && day > opts.end) continue;

    const amount = Math.abs(Number(txn.amount) || 0);
    if (amount === 0) continue;
    const type = txn.transaction_type === 'income' ? 'income' : 'expense';

    if (type === 'income') income += amount;
    else expense += amount;
    txnCount += 1;

    const dayBucket = byDay.get(day) ?? emptyBucket();
    addToBucket(dayBucket, type, amount);
    byDay.set(day, dayBucket);

    const mk = day.slice(0, 7);
    const monthBucket = byMonth.get(mk) ?? emptyBucket();
    addToBucket(monthBucket, type, amount);
    byMonth.set(mk, monthBucket);
  }

  income = roundFinanceMoney(income);
  expense = roundFinanceMoney(expense);

  const days: FinanceDailySummaryRow[] = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, v]) => ({
      day,
      income: roundFinanceMoney(v.income),
      expense: roundFinanceMoney(v.expense),
      net: roundFinanceMoney(v.net),
    }));

  return {
    days,
    byDay,
    byMonth,
    income,
    expense,
    net: roundFinanceMoney(income - expense),
    txnCount,
  };
}
