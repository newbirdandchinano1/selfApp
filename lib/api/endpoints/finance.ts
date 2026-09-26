/**
 * 财务页专用接口（禁止降级 /api/app/data/* 全表 List）。
 */
import { apiRequest } from '@/lib/api/http';
import { buildQuery } from '@/lib/api/query';

export type FinancePageMeta = {
  serverTime?: string;
  tablesVersion?: Record<
    string,
    { count?: number; version?: string | null; maxUpdatedAt?: string | null } | undefined
  >;
};

/** GET /api/app/pages/finance/catalog */
export type FinanceCatalogPayload = {
  accounts: Record<string, unknown>[];
  accountTypes: Record<string, unknown>[];
  categories: Record<string, unknown>[];
  /** 定时支出规则 */
  scheduledExpenses?: Record<string, unknown>[];
  meta?: FinancePageMeta;
};

export async function apiGetFinanceCatalog(params?: {
  signal?: AbortSignal;
}): Promise<FinanceCatalogPayload> {
  return apiRequest<FinanceCatalogPayload>('/api/app/pages/finance/catalog', {
    method: 'GET',
    signal: params?.signal,
  });
}

/** GET /api/app/pages/finance/home */
export type FinanceHomePayload = {
  accounts: Record<string, unknown>[];
  categories: Record<string, unknown>[];
  /** 今日 + 预算窗 + 近 daysBack 天 + 首屏历史日的并集（去重） */
  transactions: Record<string, unknown>[];
  /** 定时支出规则 */
  scheduledExpenses?: Record<string, unknown>[];
  historyHasMore?: boolean;
  /** 服务端按 exclude_from_total_assets 汇总的净资产 */
  netWorth?: number;
  /** 自然月收入/支出（不含转账），可选 */
  monthly?: { income: number; expense: number };
  meta?: FinancePageMeta & {
    logicalToday?: string;
    daysBack?: number;
    budgetRefreshDay?: number;
  };
};

export async function apiGetFinanceHome(params?: {
  logicalToday?: string;
  dayBoundaryHour?: number;
  dayBoundaryMinute?: number;
  /** 首屏历史有流水日数（不含今天），默认 2 */
  historyDays?: number;
  /** 与预算窗取并集的回看天数，默认 90 */
  daysBack?: number;
  budgetRefreshDay?: number;
  signal?: AbortSignal;
}): Promise<FinanceHomePayload> {
  const qs = buildQuery({
    logicalToday: params?.logicalToday,
    dayBoundaryHour: params?.dayBoundaryHour,
    dayBoundaryMinute: params?.dayBoundaryMinute,
    historyDays: params?.historyDays,
    daysBack: params?.daysBack ?? 90,
    budgetRefreshDay: params?.budgetRefreshDay,
  });
  return apiRequest<FinanceHomePayload>(`/api/app/pages/finance/home${qs}`, {
    method: 'GET',
    signal: params?.signal,
  });
}

/** GET /api/app/pages/finance/recent-days — 首页触底加载更早流水 */
export type FinanceRecentDaysPayload = {
  transactions: Record<string, unknown>[];
  historyHasMore?: boolean;
  meta?: FinancePageMeta & { before?: string; days?: number };
};

export async function apiGetFinanceRecentDays(params: {
  before: string;
  days?: number;
  dayBoundaryHour?: number;
  dayBoundaryMinute?: number;
  signal?: AbortSignal;
}): Promise<FinanceRecentDaysPayload> {
  const qs = buildQuery({
    before: params.before,
    days: params.days ?? 3,
    dayBoundaryHour: params.dayBoundaryHour,
    dayBoundaryMinute: params.dayBoundaryMinute,
  });
  return apiRequest<FinanceRecentDaysPayload>(`/api/app/pages/finance/recent-days${qs}`, {
    method: 'GET',
    signal: params.signal,
  });
}

/** GET /api/app/pages/finance/transactions — 按区间/账户拉流水（统计、日历日、账户详情） */
export type FinanceTransactionsPagePayload = {
  transactions: Record<string, unknown>[];
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  meta?: FinancePageMeta & {
    start?: string;
    end?: string;
    accountId?: string;
  };
};

export async function apiGetFinanceTransactionsPage(params: {
  start?: string;
  end?: string;
  accountId?: string;
  page?: number;
  limit?: number;
  excludeCorrections?: boolean;
  signal?: AbortSignal;
}): Promise<FinanceTransactionsPagePayload> {
  const qs = buildQuery({
    start: params.start,
    end: params.end,
    accountId: params.accountId,
    page: params.page,
    limit: params.limit,
    excludeCorrections: params.excludeCorrections === true ? true : undefined,
  });
  return apiRequest<FinanceTransactionsPagePayload>(`/api/app/pages/finance/transactions${qs}`, {
    method: 'GET',
    signal: params.signal,
  });
}

/** GET /api/app/pages/finance/daily-summaries */
export type FinanceDailySummariesPayload = {
  days: Array<{ day: string; income: number; expense: number; net: number }>;
  meta?: FinancePageMeta & { start?: string; end?: string };
};

export async function apiGetFinanceDailySummaries(params: {
  start: string;
  end: string;
  signal?: AbortSignal;
}): Promise<FinanceDailySummariesPayload> {
  const qs = buildQuery({
    start: params.start,
    end: params.end,
  });
  return apiRequest<FinanceDailySummariesPayload>(`/api/app/pages/finance/daily-summaries${qs}`, {
    method: 'GET',
    signal: params.signal,
  });
}

/** GET /api/app/pages/finance/account-detail */
export type FinanceAccountDetailPayload = {
  account: Record<string, unknown> | null;
  transactions: Record<string, unknown>[];
  meta?: FinancePageMeta;
};

export async function apiGetFinanceAccountDetail(params: {
  accountId?: string;
  accountName?: string;
  signal?: AbortSignal;
}): Promise<FinanceAccountDetailPayload> {
  const qs = buildQuery({
    accountId: params.accountId,
    accountName: params.accountName,
  });
  return apiRequest<FinanceAccountDetailPayload>(`/api/app/pages/finance/account-detail${qs}`, {
    method: 'GET',
    signal: params.signal,
  });
}

/** GET /api/app/pages/finance/cash-flow */
export type FinanceCashFlowPayload = {
  profile: Record<string, unknown> | null;
  incomes: Record<string, unknown>[];
  holdings: Record<string, unknown>[];
  expenseLines: Record<string, unknown>[];
  meta?: FinancePageMeta;
};

export async function apiGetFinanceCashFlow(params?: {
  signal?: AbortSignal;
}): Promise<FinanceCashFlowPayload> {
  return apiRequest<FinanceCashFlowPayload>('/api/app/pages/finance/cash-flow', {
    method: 'GET',
    signal: params?.signal,
  });
}

/**
 * GET /api/app/pages/finance/insights
 * 现金流洞察：月汇总 / Top 分类 / 月末净值序列（勿回传 6 个月全量流水）
 */
export type FinanceInsightsPayload = {
  netWorth: number;
  monthly: Array<{
    key: string;
    income: number;
    expense: number;
    net: number;
  }>;
  categoryTop?: Array<{ categoryId: string | null; name: string; amount: number }>;
  monthEndNetWorth?: Array<{ key: string; netWorth: number }>;
  meta?: FinancePageMeta & { months?: number };
};

export async function apiGetFinanceInsights(params?: {
  months?: number;
  signal?: AbortSignal;
}): Promise<FinanceInsightsPayload> {
  const qs = buildQuery({
    months: params?.months ?? 6,
  });
  return apiRequest<FinanceInsightsPayload>(`/api/app/pages/finance/insights${qs}`, {
    method: 'GET',
    signal: params?.signal,
  });
}

/**
 * GET /api/app/pages/finance/stats
 * 财务统计页聚合（不回传全量流水；含 summary / categories / trend / billTable / ranking / sampleTransactions）
 */
export type FinanceStatsCategoryItem = {
  categoryId: string | null;
  name: string;
  amount: number;
  count: number;
  percent: number;
  iconKey?: string | null;
};

export type FinanceStatsTrendPoint = {
  key: string;
  label: string;
  income: number;
  expense: number;
  balance: number;
};

export type FinanceStatsRankItem = {
  id: string;
  name: string;
  categoryName: string | null;
  note: string | null;
  amount: number;
  happenedAt: string;
};

export type FinanceStatsSampleTxn = {
  id: string;
  name: string;
  happened_at: string;
  transaction_type: 'income' | 'expense';
  flow_category_id: string | null;
  amount: number;
  note: string | null;
  ai_comment: string | null;
  extra_data: string | null;
};

export type FinanceStatsPayload = {
  summary: {
    income: number;
    expense: number;
    balance: number;
    days: number;
    txnCount: number;
  };
  categories: {
    expense: FinanceStatsCategoryItem[];
    income: FinanceStatsCategoryItem[];
  };
  trend: {
    granularity: 'day' | 'month';
    points: FinanceStatsTrendPoint[];
  };
  billTable: {
    total: { expense: number; income: number; balance: number };
    dailyAvg: { expense: number; income: number; balance: number };
    recentDays: Array<{ day: string; expense: number; income: number; balance: number }>;
  };
  ranking: {
    expense: FinanceStatsRankItem[];
    income: FinanceStatsRankItem[];
  };
  sampleTransactions?: FinanceStatsSampleTxn[];
  meta?: FinancePageMeta & {
    start?: string;
    end?: string;
    granularity?: 'day' | 'month';
  };
};

export async function apiGetFinanceStats(params: {
  start: string;
  end: string;
  granularity?: 'day' | 'month' | 'auto';
  categoryMode?: 'expense' | 'income' | 'both';
  rankMode?: 'expense' | 'income' | 'both';
  rankLimit?: number;
  recentDaysLimit?: number;
  excludeCorrections?: boolean;
  dayBoundaryHour?: number;
  dayBoundaryMinute?: number;
  signal?: AbortSignal;
}): Promise<FinanceStatsPayload> {
  const qs = buildQuery({
    start: params.start,
    end: params.end,
    granularity: params.granularity,
    categoryMode: params.categoryMode,
    rankMode: params.rankMode,
    rankLimit: params.rankLimit,
    recentDaysLimit: params.recentDaysLimit,
    excludeCorrections: params.excludeCorrections === false ? false : true,
    dayBoundaryHour: params.dayBoundaryHour,
    dayBoundaryMinute: params.dayBoundaryMinute,
  });
  return apiRequest<FinanceStatsPayload>(`/api/app/pages/finance/stats${qs}`, {
    method: 'GET',
    signal: params.signal,
  });
}

// ---------------------------------------------------------------------------
