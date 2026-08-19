/**
 * 财务页专用 REST：灌入本地 SQLite 后供仓库只读。
 * 失败时只回退本地，禁止降级 `/api/data/*` 全表 List。
 */
import {
  apiGetFinanceAccountDetail,
  apiGetFinanceCashFlow,
  apiGetFinanceCatalog,
  apiGetFinanceDailySummaries,
  apiGetFinanceHome,
  apiGetFinanceInsights,
  apiGetFinanceRecentDays,
  apiGetFinanceTransactionsPage,
  type FinanceAccountDetailPayload,
  type FinanceCashFlowPayload,
  type FinanceCatalogPayload,
  type FinanceDailySummariesPayload,
  type FinanceHomePayload,
  type FinanceInsightsPayload,
  type FinanceRecentDaysPayload,
  type FinanceTransactionsPagePayload,
} from '@/lib/api-client';
import { withApiTableSyncLock } from '@/lib/api-read';
import { syncApiReadResultToLocal } from '@/lib/api-read-local-sync';
import {
  rememberFinanceAccountBalances,
  rememberFinanceNetWorth,
} from '@/lib/finance-account-balance-cache';
import type {
  FinanceAccountBalanceRow,
  FinanceAccountTypeRow,
  FinanceDailySummaryRow,
  FinanceFlowCategoryRow,
  FinanceTransactionRow,
} from '@/lib/repositories/finance/finance.types';
import type {
  CashFlowExpenseLineRow,
  CashFlowHoldingRow,
  CashFlowIncomeRow,
  CashFlowProfileRow,
} from '@/lib/repositories/cash-flow/cash-flow.types';

function asRecordArray(raw: unknown): Record<string, unknown>[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x));
}

function asBalanceRows(raw: unknown): FinanceAccountBalanceRow[] {
  return asRecordArray(raw).map((row) => {
    const balance = typeof row.balance === 'number' && Number.isFinite(row.balance) ? row.balance : 0;
    return { ...(row as FinanceAccountBalanceRow), balance };
  });
}

function asTxnRows(raw: unknown): FinanceTransactionRow[] {
  return asRecordArray(raw) as FinanceTransactionRow[];
}

async function upsertFinanceRows(table: string, rows: Record<string, unknown>[]): Promise<void> {
  if (rows.length === 0) return;
  await withApiTableSyncLock(table, async () => {
    await syncApiReadResultToLocal(table, rows);
  });
}

async function syncAccountsWithBalance(raw: unknown): Promise<FinanceAccountBalanceRow[]> {
  const accounts = asBalanceRows(raw);
  rememberFinanceAccountBalances(accounts);
  await upsertFinanceRows(
    'finance_accounts',
    accounts.map(({ balance: _b, ...rest }) => rest as Record<string, unknown>),
  );
  return accounts;
}

async function syncCategories(raw: unknown): Promise<FinanceFlowCategoryRow[]> {
  const categories = asRecordArray(raw) as FinanceFlowCategoryRow[];
  await upsertFinanceRows('finance_flow_categories', categories as Record<string, unknown>[]);
  return categories;
}

async function syncAccountTypes(raw: unknown): Promise<FinanceAccountTypeRow[]> {
  const types = asRecordArray(raw) as FinanceAccountTypeRow[];
  await upsertFinanceRows('finance_account_types', types as Record<string, unknown>[]);
  return types;
}

async function syncTransactions(raw: unknown): Promise<FinanceTransactionRow[]> {
  const txns = asTxnRows(raw);
  await upsertFinanceRows('finance_transactions', txns as Record<string, unknown>[]);
  return txns;
}

export type FinanceCatalogData = {
  accounts: FinanceAccountBalanceRow[];
  accountTypes: FinanceAccountTypeRow[];
  categories: FinanceFlowCategoryRow[];
  fromApi: boolean;
};

export async function fetchFinanceCatalog(opts?: {
  signal?: AbortSignal;
  offlineFallback?: boolean;
}): Promise<FinanceCatalogData> {
  try {
    const payload: FinanceCatalogPayload = await apiGetFinanceCatalog({ signal: opts?.signal });
    const [accounts, accountTypes, categories] = await Promise.all([
      syncAccountsWithBalance(payload.accounts),
      syncAccountTypes(payload.accountTypes),
      syncCategories(payload.categories),
    ]);
    return { accounts, accountTypes, categories, fromApi: true };
  } catch (e) {
    if (opts?.offlineFallback === false) throw e;
    console.warn('[finance-page-api] catalog 失败，回退本地', e);
    const { getFinanceAccountsWithBalance, getFinanceAccountTypes, getFinanceFlowCategories } =
      await import('@/lib/repositories/finance/finance');
    const [accounts, accountTypes, categories] = await Promise.all([
      getFinanceAccountsWithBalance({ localOnly: true }),
      getFinanceAccountTypes({ localOnly: true }),
      getFinanceFlowCategories({ localOnly: true }),
    ]);
    return { accounts, accountTypes, categories, fromApi: false };
  }
}

export type FinanceHomeData = {
  accounts: FinanceAccountBalanceRow[];
  categories: FinanceFlowCategoryRow[];
  transactions: FinanceTransactionRow[];
  historyHasMore: boolean;
  netWorth: number | null;
  monthly: { income: number; expense: number } | null;
  fromApi: boolean;
};

export async function fetchFinanceHome(opts?: {
  logicalToday?: string;
  dayBoundaryHour?: number;
  dayBoundaryMinute?: number;
  historyDays?: number;
  daysBack?: number;
  budgetRefreshDay?: number;
  signal?: AbortSignal;
  offlineFallback?: boolean;
}): Promise<FinanceHomeData> {
  try {
    const payload: FinanceHomePayload = await apiGetFinanceHome({
      logicalToday: opts?.logicalToday,
      dayBoundaryHour: opts?.dayBoundaryHour,
      dayBoundaryMinute: opts?.dayBoundaryMinute,
      historyDays: opts?.historyDays ?? 2,
      daysBack: opts?.daysBack ?? 90,
      budgetRefreshDay: opts?.budgetRefreshDay,
      signal: opts?.signal,
    });
    const [accounts, categories, transactions] = await Promise.all([
      syncAccountsWithBalance(payload.accounts),
      syncCategories(payload.categories),
      syncTransactions(payload.transactions),
    ]);
    if (typeof payload.netWorth === 'number') {
      rememberFinanceNetWorth(payload.netWorth);
    }
    return {
      accounts,
      categories,
      transactions,
      historyHasMore: payload.historyHasMore === true,
      netWorth: typeof payload.netWorth === 'number' ? payload.netWorth : null,
      monthly: payload.monthly ?? null,
      fromApi: true,
    };
  } catch (e) {
    if (opts?.offlineFallback === false) throw e;
    console.warn('[finance-page-api] home 失败，回退本地', e);
    const { getFinanceAccountsWithBalance, getFinanceFlowCategories, getFinanceTransactions } =
      await import('@/lib/repositories/finance/finance');
    const [accounts, categories, transactions] = await Promise.all([
      getFinanceAccountsWithBalance({ localOnly: true }),
      getFinanceFlowCategories({ localOnly: true }),
      getFinanceTransactions({ localOnly: true }),
    ]);
    return {
      accounts,
      categories,
      transactions,
      historyHasMore: false,
      netWorth: null,
      monthly: null,
      fromApi: false,
    };
  }
}

export type FinanceRecentDaysData = {
  transactions: FinanceTransactionRow[];
  historyHasMore: boolean;
  fromApi: boolean;
};

export async function fetchFinanceRecentDays(opts: {
  before: string;
  days?: number;
  dayBoundaryHour?: number;
  dayBoundaryMinute?: number;
  signal?: AbortSignal;
  offlineFallback?: boolean;
}): Promise<FinanceRecentDaysData> {
  try {
    const payload: FinanceRecentDaysPayload = await apiGetFinanceRecentDays({
      before: opts.before,
      days: opts.days ?? 3,
      dayBoundaryHour: opts.dayBoundaryHour,
      dayBoundaryMinute: opts.dayBoundaryMinute,
      signal: opts.signal,
    });
    const transactions = await syncTransactions(payload.transactions);
    return {
      transactions,
      historyHasMore: payload.historyHasMore === true,
      fromApi: true,
    };
  } catch (e) {
    if (opts.offlineFallback === false) throw e;
    console.warn('[finance-page-api] recent-days 失败', e);
    return { transactions: [], historyHasMore: false, fromApi: false };
  }
}

export type FinanceTransactionsRangeData = {
  transactions: FinanceTransactionRow[];
  fromApi: boolean;
};

export async function fetchFinanceTransactionsRange(opts: {
  start?: string;
  end?: string;
  accountId?: string;
  excludeCorrections?: boolean;
  signal?: AbortSignal;
  offlineFallback?: boolean;
}): Promise<FinanceTransactionsRangeData> {
  try {
    const pageLimit = 200;
    let page = 1;
    let totalPages = 1;
    const all: FinanceTransactionRow[] = [];
    do {
      const payload: FinanceTransactionsPagePayload = await apiGetFinanceTransactionsPage({
        start: opts.start,
        end: opts.end,
        accountId: opts.accountId,
        page,
        limit: pageLimit,
        excludeCorrections: opts.excludeCorrections,
        signal: opts.signal,
      });
      const batch = asTxnRows(payload.transactions);
      all.push(...batch);
      totalPages = Math.max(1, payload.pagination?.totalPages ?? 1);
      if (batch.length === 0) break;
      page += 1;
    } while (page <= totalPages && page <= 50);

    await upsertFinanceRows('finance_transactions', all as Record<string, unknown>[]);
    return { transactions: all, fromApi: true };
  } catch (e) {
    if (opts.offlineFallback === false) throw e;
    console.warn('[finance-page-api] transactions 区间失败，回退本地', e);
    const { getFinanceTransactions } = await import('@/lib/repositories/finance/finance');
    let rows = await getFinanceTransactions({ localOnly: true });
    if (opts.accountId) {
      rows = rows.filter((t) => t.account_id === opts.accountId);
    }
    if (opts.start || opts.end) {
      const { ymdFromDatetime } = await import('@/lib/api-read-helpers');
      rows = rows.filter((t) => {
        const day = ymdFromDatetime(t.happened_at);
        if (!day) return false;
        if (opts.start && day < opts.start) return false;
        if (opts.end && day > opts.end) return false;
        return true;
      });
    }
    return { transactions: rows, fromApi: false };
  }
}

export type FinanceDailySummariesData = {
  days: FinanceDailySummaryRow[];
  fromApi: boolean;
};

function toDailyYmdKey(raw: unknown): string {
  if (raw == null) return '';
  const s = String(raw).trim();
  // 兼容 "2026-08-01" / "2026-08-01T00:00:00Z" / "2026-08-01 00:00:00"
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return '';
}

function dailySummariesHaveFlow(days: FinanceDailySummaryRow[]): boolean {
  return days.some((d) => d.income !== 0 || d.expense !== 0);
}

/** 兼容后端多种返回形状，避免成功但空/字段不对导致格子全是 -- */
function normalizeDailySummaryDays(payload: unknown): FinanceDailySummaryRow[] {
  let list: unknown[] = [];
  if (Array.isArray(payload)) {
    list = payload;
  } else if (payload && typeof payload === 'object') {
    const o = payload as Record<string, unknown>;
    const candidate = o.days ?? o.items ?? o.summaries ?? o.list ?? o.data;
    if (Array.isArray(candidate)) list = candidate;
  }

  const out: FinanceDailySummaryRow[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const day = toDailyYmdKey(row.day ?? row.date ?? row.ymd ?? row.dayKey);
    if (!day) continue;
    const income = Math.abs(Number(row.income) || 0);
    const expense = Math.abs(Number(row.expense) || 0);
    const netRaw = row.net;
    const net =
      typeof netRaw === 'number' && Number.isFinite(netRaw)
        ? netRaw
        : Number(netRaw) || income - expense;
    out.push({ day, income, expense, net });
  }
  return out;
}

async function aggregateDailySummariesFromTransactionsRange(opts: {
  start: string;
  end: string;
  signal?: AbortSignal;
}): Promise<FinanceDailySummaryRow[]> {
  const { transactions } = await fetchFinanceTransactionsRange({
    start: opts.start,
    end: opts.end,
    signal: opts.signal,
    offlineFallback: false,
  });
  const { computeTransactionLedgerEffect } = await import('@/lib/repositories/finance/finance');
  const { ymdFromDatetime } = await import('@/lib/api-read-helpers');
  const byDay = new Map<string, { income: number; expense: number; net: number }>();
  for (const t of transactions) {
    const day = ymdFromDatetime(t.happened_at);
    if (!day || day < opts.start || day > opts.end) continue;
    if (t.transaction_type === 'transfer') continue;
    const effect = computeTransactionLedgerEffect(t.transaction_type, t.amount, t.extra_data);
    const agg = byDay.get(day) ?? { income: 0, expense: 0, net: 0 };
    if (effect > 0) agg.income += effect;
    else if (effect < 0) agg.expense += Math.abs(effect);
    agg.net += effect;
    byDay.set(day, agg);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, v]) => ({ day, ...v }));
}

export async function fetchFinanceDailySummaries(opts: {
  start: string;
  end: string;
  signal?: AbortSignal;
  offlineFallback?: boolean;
}): Promise<FinanceDailySummariesData> {
  let apiDays: FinanceDailySummaryRow[] | null = null;
  try {
    const payload: FinanceDailySummariesPayload = await apiGetFinanceDailySummaries({
      start: opts.start,
      end: opts.end,
      signal: opts.signal,
    });
    apiDays = normalizeDailySummaryDays(payload);
    if (dailySummariesHaveFlow(apiDays)) {
      return { days: apiDays, fromApi: true };
    }
  } catch (e) {
    if (opts.offlineFallback === false) throw e;
    console.warn('[finance-page-api] daily-summaries 失败，回退本地/流水聚合', e);
  }

  if (opts.offlineFallback === false) {
    return { days: apiDays ?? [], fromApi: true };
  }

  const { getFinanceDailySummariesByDateRange } = await import('@/lib/repositories/finance/finance');
  const localDays = await getFinanceDailySummariesByDateRange(opts.start, opts.end, { localOnly: true });
  if (dailySummariesHaveFlow(localDays)) {
    if (apiDays) {
      console.warn('[finance-page-api] daily-summaries 无有效流水，改用本地聚合');
    }
    return { days: localDays, fromApi: false };
  }

  try {
    const fromTxns = await aggregateDailySummariesFromTransactionsRange({
      start: opts.start,
      end: opts.end,
      signal: opts.signal,
    });
    if (dailySummariesHaveFlow(fromTxns)) {
      console.warn('[finance-page-api] daily-summaries 无有效流水，改用 transactions 区间聚合');
      return { days: fromTxns, fromApi: true };
    }
  } catch (e) {
    console.warn('[finance-page-api] transactions 区间聚合失败', e);
  }

  return { days: apiDays ?? localDays, fromApi: apiDays != null };
}

export type FinanceAccountDetailData = {
  account: FinanceAccountBalanceRow | null;
  transactions: FinanceTransactionRow[];
  fromApi: boolean;
};

export async function fetchFinanceAccountDetail(opts: {
  accountId?: string;
  accountName?: string;
  signal?: AbortSignal;
  offlineFallback?: boolean;
}): Promise<FinanceAccountDetailData> {
  try {
    const payload: FinanceAccountDetailPayload = await apiGetFinanceAccountDetail({
      accountId: opts.accountId,
      accountName: opts.accountName,
      signal: opts.signal,
    });
    let account: FinanceAccountBalanceRow | null = null;
    if (payload.account && typeof payload.account === 'object') {
      const rows = await syncAccountsWithBalance([payload.account]);
      account = rows[0] ?? null;
    }
    const transactions = await syncTransactions(payload.transactions);
    return { account, transactions, fromApi: true };
  } catch (e) {
    if (opts.offlineFallback === false) throw e;
    console.warn('[finance-page-api] account-detail 失败，回退本地', e);
    const { loadFinanceAccountDetail } = await import('@/lib/repositories/finance/finance');
    const local = await loadFinanceAccountDetail({
      accountId: opts.accountId,
      accountName: opts.accountName,
      localOnly: true,
    });
    return { ...local, fromApi: false };
  }
}

export type FinanceCashFlowData = {
  profile: CashFlowProfileRow | null;
  incomes: CashFlowIncomeRow[];
  holdings: CashFlowHoldingRow[];
  expenseLines: CashFlowExpenseLineRow[];
  fromApi: boolean;
};

export async function fetchFinanceCashFlow(opts?: {
  signal?: AbortSignal;
  offlineFallback?: boolean;
}): Promise<FinanceCashFlowData> {
  try {
    const payload: FinanceCashFlowPayload = await apiGetFinanceCashFlow({ signal: opts?.signal });
    const profile = payload.profile && typeof payload.profile === 'object'
      ? (payload.profile as CashFlowProfileRow)
      : null;
    const incomes = asRecordArray(payload.incomes) as CashFlowIncomeRow[];
    const holdings = asRecordArray(payload.holdings) as CashFlowHoldingRow[];
    const expenseLines = asRecordArray(payload.expenseLines) as CashFlowExpenseLineRow[];
    await Promise.all([
      profile ? upsertFinanceRows('cash_flow_profile', [profile as Record<string, unknown>]) : Promise.resolve(),
      upsertFinanceRows('cash_flow_incomes', incomes as Record<string, unknown>[]),
      upsertFinanceRows('cash_flow_holdings', holdings as Record<string, unknown>[]),
      upsertFinanceRows('cash_flow_expense_lines', expenseLines as Record<string, unknown>[]),
    ]);
    return { profile, incomes, holdings, expenseLines, fromApi: true };
  } catch (e) {
    if (opts?.offlineFallback === false) throw e;
    console.warn('[finance-page-api] cash-flow 失败，回退本地', e);
    return {
      profile: null,
      incomes: [],
      holdings: [],
      expenseLines: [],
      fromApi: false,
    };
  }
}

export type FinanceInsightsData = FinanceInsightsPayload & { fromApi: boolean };

export async function fetchFinanceInsights(opts?: {
  months?: number;
  signal?: AbortSignal;
  offlineFallback?: boolean;
}): Promise<FinanceInsightsData | null> {
  try {
    const payload = await apiGetFinanceInsights({
      months: opts?.months ?? 6,
      signal: opts?.signal,
    });
    if (typeof payload.netWorth === 'number') {
      rememberFinanceNetWorth(payload.netWorth);
    }
    return { ...payload, fromApi: true };
  } catch (e) {
    if (opts?.offlineFallback === false) throw e;
    console.warn('[finance-page-api] insights 失败', e);
    return null;
  }
}
