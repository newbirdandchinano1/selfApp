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
  apiGetFinanceStats,
  apiGetFinanceTransactionsPage,
  type FinanceAccountDetailPayload,
  type FinanceCashFlowPayload,
  type FinanceCatalogPayload,
  type FinanceDailySummariesPayload,
  type FinanceHomePayload,
  type FinanceInsightsPayload,
  type FinanceRecentDaysPayload,
  type FinanceStatsCategoryItem,
  type FinanceStatsPayload,
  type FinanceStatsRankItem,
  type FinanceStatsSampleTxn,
  type FinanceStatsTrendPoint,
  type FinanceTransactionsPagePayload,
} from '@/lib/api-client';
import { withApiTableSyncLock } from '@/lib/api-read';
import { syncApiReadResultToLocal } from '@/lib/api-read-local-sync';
import {
  rememberFinanceAccountBalances,
  rememberFinanceNetWorth,
} from '@/lib/finance-account-balance-cache';
import {
  isFinanceLiabilityAccount,
  normalizeFinanceAccountLedgerBalance,
} from '@/lib/finance-net-worth';
import { normalizeFinanceSignRule } from '@/lib/repositories/finance/finance';
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
    const rawBalance = typeof row.balance === 'number' && Number.isFinite(row.balance) ? row.balance : 0;
    const base = row as FinanceAccountBalanceRow;
    const liability = isFinanceLiabilityAccount(base);
    const sign_rule: -1 | 1 = liability ? -1 : normalizeFinanceSignRule(base.sign_rule, base.account_type);
    const account_type = liability ? 'liability' : base.account_type;
    return {
      ...base,
      account_type,
      sign_rule,
      balance: normalizeFinanceAccountLedgerBalance(
        { sign_rule, account_type, extra_data: base.extra_data },
        rawBalance,
      ),
    };
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
  const apiAccounts = asBalanceRows(raw);
  // 先写入服务端余额缓存，再灌库；最终以本地全量账户+规范化负债余额为准返回
  rememberFinanceAccountBalances(apiAccounts);
  await upsertFinanceRows(
    'finance_accounts',
    asRecordArray(raw).map((row) => {
      const copy = { ...row };
      delete copy.balance;
      return copy;
    }),
  );
  const { getFinanceAccountsWithBalance } = await import('@/lib/repositories/finance/finance');
  const localAccounts = await getFinanceAccountsWithBalance({ localOnly: true });
  rememberFinanceAccountBalances(localAccounts);
  return localAccounts;
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
      await syncAccountsWithBalance([payload.account]);
    }
    const transactions = await syncTransactions(payload.transactions);
    // 以本地行展示：pending_update 时 upsert 会保留本地 extra_data，但 API 返回体仍是旧值
    const { loadFinanceAccountDetail } = await import('@/lib/repositories/finance/finance');
    const local = await loadFinanceAccountDetail({
      accountId: opts.accountId,
      accountName: opts.accountName,
      localOnly: true,
    });
    account = local.account;
    return {
      account,
      transactions: local.account ? local.transactions : transactions,
      fromApi: true,
    };
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

export type FinanceStatsData = FinanceStatsPayload & { fromApi: boolean };

function roundStatsMoney(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function ymdParts(ymd: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

function listYmdInclusive(start: string, end: string): string[] {
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

function listMonthKeysInclusive(start: string, end: string): string[] {
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

function resolveStatsGranularity(
  requested: 'day' | 'month' | 'auto' | undefined,
  start: string,
  end: string,
): 'day' | 'month' {
  if (requested === 'day' || requested === 'month') return requested;
  const days = listYmdInclusive(start, end).length;
  if (days > 90 || start.slice(0, 4) !== end.slice(0, 4)) return 'month';
  return 'day';
}

async function buildFinanceStatsLocally(opts: {
  start: string;
  end: string;
  granularity?: 'day' | 'month' | 'auto';
  rankLimit?: number;
  recentDaysLimit?: number;
}): Promise<FinanceStatsPayload> {
  const {
    isBalanceCorrectionFinanceTransaction,
    isInitialBalanceFinanceTransaction,
    parseFinanceTransactionExtra,
    BUILTIN_SHEET_CATEGORY_LABELS,
    getFinanceTransactionCategoryLabel,
  } = await import('@/lib/repositories/finance/finance-transaction-extra');
  const { getFinanceTransactions, getFinanceFlowCategories } = await import(
    '@/lib/repositories/finance/finance'
  );

  const granularity = resolveStatsGranularity(opts.granularity, opts.start, opts.end);
  const rankLimit = Math.min(20, Math.max(1, opts.rankLimit ?? 5));
  const recentDaysLimit = Math.min(31, Math.max(1, opts.recentDaysLimit ?? 6));
  const dayList = listYmdInclusive(opts.start, opts.end);
  const days = Math.max(1, dayList.length);

  const [allTxns, categories] = await Promise.all([
    getFinanceTransactions({ localOnly: true }),
    getFinanceFlowCategories({ localOnly: true }),
  ]);
  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const categoryByName = new Map(categories.map((c) => [c.name, c]));
  const categoryNameById = new Map(categories.map((c) => [c.id, c.name]));

  type LocalTxn = {
    id: string;
    name: string;
    happenedAt: string;
    type: 'income' | 'expense';
    amount: number;
    note: string | null;
    aiComment: string | null;
    extraData: string | null;
    flowCategoryId: string | null;
    logicalDay: string;
    isInitialBalance: boolean;
    categoryName: string;
    iconKey: string | null;
  };

  const txns: LocalTxn[] = [];
  for (const row of allTxns) {
    const day = String(row.happened_at ?? '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}/.test(day)) continue;
    const ymd = day.slice(0, 10);
    if (ymd < opts.start || ymd > opts.end) continue;
    if (row.transaction_type === 'transfer') continue;
    if (row.transaction_type !== 'income' && row.transaction_type !== 'expense') continue;
    if (isBalanceCorrectionFinanceTransaction(row)) continue;

    let iconKey: string | null = null;
    let categoryName =
      getFinanceTransactionCategoryLabel(row, categoryNameById) ?? '未分类';
    if (row.flow_category_id) {
      const cat = categoryById.get(row.flow_category_id);
      if (cat) {
        categoryName = cat.name;
        try {
          const extra = cat.extra_data ? (JSON.parse(cat.extra_data) as { icon?: string; icon_key?: string }) : null;
          iconKey = extra?.icon ?? extra?.icon_key ?? null;
        } catch {
          iconKey = null;
        }
      }
    } else {
      const extra = parseFinanceTransactionExtra(row.extra_data);
      const label =
        extra.category_label?.trim() ||
        (extra.category_key ? BUILTIN_SHEET_CATEGORY_LABELS[extra.category_key] : undefined);
      if (label) {
        const byName = categoryByName.get(label);
        if (byName) {
          categoryName = byName.name;
          try {
            const e = byName.extra_data
              ? (JSON.parse(byName.extra_data) as { icon?: string; icon_key?: string })
              : null;
            iconKey = e?.icon ?? e?.icon_key ?? null;
          } catch {
            iconKey = null;
          }
        } else {
          categoryName = label;
        }
      }
    }

    txns.push({
      id: row.id,
      name: row.name,
      happenedAt: row.happened_at,
      type: row.transaction_type,
      amount: Math.abs(Number(row.amount) || 0),
      note: row.note,
      aiComment: row.ai_comment,
      extraData: row.extra_data,
      flowCategoryId: row.flow_category_id,
      logicalDay: ymd,
      isInitialBalance: isInitialBalanceFinanceTransaction(row),
      categoryName,
      iconKey,
    });
  }

  let income = 0;
  let expense = 0;
  const expenseCats = new Map<string, FinanceStatsCategoryItem & { key: string }>();
  const incomeCats = new Map<string, FinanceStatsCategoryItem & { key: string }>();
  const dayBuckets = new Map<string, { income: number; expense: number }>();
  const monthBuckets = new Map<string, { income: number; expense: number }>();

  for (const txn of txns) {
    if (txn.type === 'income') income += txn.amount;
    else expense += txn.amount;

    const dayBucket = dayBuckets.get(txn.logicalDay) ?? { income: 0, expense: 0 };
    if (txn.type === 'income') dayBucket.income += txn.amount;
    else dayBucket.expense += txn.amount;
    dayBuckets.set(txn.logicalDay, dayBucket);

    const mk = txn.logicalDay.slice(0, 7);
    const monthBucket = monthBuckets.get(mk) ?? { income: 0, expense: 0 };
    if (txn.type === 'income') monthBucket.income += txn.amount;
    else monthBucket.expense += txn.amount;
    monthBuckets.set(mk, monthBucket);

    const side = txn.type === 'income' ? incomeCats : expenseCats;
    const key = txn.flowCategoryId ? `id:${txn.flowCategoryId}` : `name:${txn.categoryName}`;
    const cur = side.get(key) ?? {
      key,
      categoryId: txn.flowCategoryId,
      name: txn.categoryName,
      amount: 0,
      count: 0,
      percent: 0,
      iconKey: txn.iconKey,
    };
    cur.amount += txn.amount;
    cur.count += 1;
    if (!cur.iconKey && txn.iconKey) cur.iconKey = txn.iconKey;
    side.set(key, cur);
  }

  income = roundStatsMoney(income);
  expense = roundStatsMoney(expense);
  const balance = roundStatsMoney(income - expense);

  const toSide = (map: Map<string, FinanceStatsCategoryItem & { key: string }>, total: number) =>
    Array.from(map.values())
      .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name, 'zh-CN'))
      .map(({ key: _k, ...item }) => ({
        ...item,
        amount: roundStatsMoney(item.amount),
        percent: total > 0 ? roundStatsMoney((item.amount / total) * 100) : 0,
      }));

  const trendSource = granularity === 'month' ? monthBuckets : dayBuckets;
  const trendKeys =
    granularity === 'month' ? listMonthKeysInclusive(opts.start, opts.end) : dayList;
  const points: FinanceStatsTrendPoint[] = trendKeys.map((key) => {
    const found = trendSource.get(key) ?? { income: 0, expense: 0 };
    const pointIncome = roundStatsMoney(found.income);
    const pointExpense = roundStatsMoney(found.expense);
    const label =
      granularity === 'month'
        ? `${Number(key.slice(5, 7))}月`
        : `${Number(key.slice(5, 7))}.${Number(key.slice(8, 10))}`;
    return {
      key,
      label,
      income: pointIncome,
      expense: pointExpense,
      balance: roundStatsMoney(pointIncome - pointExpense),
    };
  });

  const recentDays = Array.from(dayBuckets.entries())
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .slice(0, recentDaysLimit)
    .map(([day, item]) => {
      const dayIncome = roundStatsMoney(item.income);
      const dayExpense = roundStatsMoney(item.expense);
      return {
        day,
        expense: dayExpense,
        income: dayIncome,
        balance: roundStatsMoney(dayIncome - dayExpense),
      };
    });

  const buildRank = (side: 'income' | 'expense'): FinanceStatsRankItem[] =>
    txns
      .filter((t) => !t.isInitialBalance && t.type === side)
      .sort((a, b) => b.amount - a.amount)
      .slice(0, rankLimit)
      .map((t) => ({
        id: t.id,
        name: t.categoryName === '未分类' ? t.name : `${t.categoryName}-${t.name}`,
        categoryName: t.categoryName === '未分类' ? null : t.categoryName,
        note: t.note ?? t.aiComment,
        amount: roundStatsMoney(t.amount),
        happenedAt: t.happenedAt,
      }));

  const sampleTransactions: FinanceStatsSampleTxn[] = [...txns]
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 50)
    .map((t) => ({
      id: t.id,
      name: t.name,
      happened_at: t.happenedAt,
      transaction_type: t.type,
      flow_category_id: t.flowCategoryId,
      amount: roundStatsMoney(t.amount),
      note: t.note,
      ai_comment: t.aiComment,
      extra_data: t.extraData,
    }));

  return {
    summary: { income, expense, balance, days, txnCount: txns.length },
    categories: {
      expense: toSide(expenseCats, expense),
      income: toSide(incomeCats, income),
    },
    trend: { granularity, points },
    billTable: {
      total: { expense, income, balance },
      dailyAvg: {
        expense: roundStatsMoney(expense / days),
        income: roundStatsMoney(income / days),
        balance: roundStatsMoney(balance / days),
      },
      recentDays,
    },
    ranking: {
      expense: buildRank('expense'),
      income: buildRank('income'),
    },
    sampleTransactions,
    meta: { start: opts.start, end: opts.end, granularity },
  };
}

export async function fetchFinanceStats(opts: {
  start: string;
  end: string;
  granularity?: 'day' | 'month' | 'auto';
  categoryMode?: 'expense' | 'income' | 'both';
  rankMode?: 'expense' | 'income' | 'both';
  rankLimit?: number;
  recentDaysLimit?: number;
  excludeCorrections?: boolean;
  signal?: AbortSignal;
  offlineFallback?: boolean;
}): Promise<FinanceStatsData> {
  const normalize = (payload: FinanceStatsPayload, fromApi: boolean): FinanceStatsData => ({
    summary: payload.summary ?? { income: 0, expense: 0, balance: 0, days: 1, txnCount: 0 },
    categories: {
      expense: Array.isArray(payload.categories?.expense) ? payload.categories.expense : [],
      income: Array.isArray(payload.categories?.income) ? payload.categories.income : [],
    },
    trend: {
      granularity: payload.trend?.granularity === 'month' ? 'month' : 'day',
      points: Array.isArray(payload.trend?.points) ? payload.trend.points : [],
    },
    billTable: {
      total: payload.billTable?.total ?? { expense: 0, income: 0, balance: 0 },
      dailyAvg: payload.billTable?.dailyAvg ?? { expense: 0, income: 0, balance: 0 },
      recentDays: Array.isArray(payload.billTable?.recentDays) ? payload.billTable.recentDays : [],
    },
    ranking: {
      expense: Array.isArray(payload.ranking?.expense) ? payload.ranking.expense : [],
      income: Array.isArray(payload.ranking?.income) ? payload.ranking.income : [],
    },
    sampleTransactions: Array.isArray(payload.sampleTransactions) ? payload.sampleTransactions : [],
    meta: payload.meta,
    fromApi,
  });

  try {
    const wantExclude = opts.excludeCorrections !== false;
    const payload = await apiGetFinanceStats({
      start: opts.start,
      end: opts.end,
      granularity: opts.granularity ?? 'auto',
      categoryMode: opts.categoryMode ?? 'both',
      rankMode: opts.rankMode ?? 'both',
      rankLimit: opts.rankLimit ?? 5,
      recentDaysLimit: opts.recentDaysLimit ?? 6,
      excludeCorrections: wantExclude,
      signal: opts.signal,
    });
    const normalized = normalize(payload, true);
    const empty =
      (normalized.summary.txnCount ?? 0) === 0 &&
      (normalized.summary.income ?? 0) === 0 &&
      (normalized.summary.expense ?? 0) === 0;

    // 兼容后端 balanceCorrectionSql 的 MySQL NULL 三值逻辑 bug：
    // excludeCorrections=true 时会把普通流水也滤光。若专口为空，改拉流水并本地聚合。
    if (empty && wantExclude) {
      try {
        await fetchFinanceTransactionsRange({
          start: opts.start,
          end: opts.end,
          excludeCorrections: false,
          signal: opts.signal,
          offlineFallback: true,
        });
        const local = await buildFinanceStatsLocally({
          start: opts.start,
          end: opts.end,
          granularity: opts.granularity,
          rankLimit: opts.rankLimit,
          recentDaysLimit: opts.recentDaysLimit,
        });
        if ((local.summary.txnCount ?? 0) > 0) {
          console.warn('[finance-page-api] stats 专口为空，已用流水本地聚合兜底');
          return { ...local, fromApi: false };
        }
      } catch (fallbackErr) {
        console.warn('[finance-page-api] stats 空结果兜底失败', fallbackErr);
      }
    }

    return normalized;
  } catch (e) {
    if (opts.offlineFallback === false) throw e;
    console.warn('[finance-page-api] stats 失败，回退本地聚合', e);
    const local = await buildFinanceStatsLocally({
      start: opts.start,
      end: opts.end,
      granularity: opts.granularity,
      rankLimit: opts.rankLimit,
      recentDaysLimit: opts.recentDaysLimit,
    });
    return { ...local, fromApi: false };
  }
}
