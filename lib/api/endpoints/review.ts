/**
 * 复盘页专用接口。
 */
import { apiRequest } from '@/lib/api/http';
import { buildQuery } from '@/lib/api/query';

// 复盘页专用接口（禁止降级 /api/app/data/* 全表 List；字段形状对齐 review_* / *_review_journal 行）
// ---------------------------------------------------------------------------

export type ReviewPageMeta = {
  serverTime?: string;
  logicalToday?: string;
  dailyStart?: string;
  dailyEnd?: string;
  weekStart?: string;
  monthStart?: string;
  catalogComplete?: boolean;
};

/** GET /api/app/pages/review/catalog */
export type ReviewCatalogPayload = {
  dimensions: Record<string, unknown>[];
  columns: Record<string, unknown>[];
  meta?: ReviewPageMeta;
};

export async function apiGetReviewCatalog(params?: {
  scope?: 'daily' | 'weekly' | 'monthly' | 'all';
  signal?: AbortSignal;
}): Promise<ReviewCatalogPayload> {
  const qs = buildQuery({
    scope: params?.scope && params.scope !== 'all' ? params.scope : undefined,
  });
  return apiRequest<ReviewCatalogPayload>(`/api/app/pages/review/catalog${qs}`, {
    method: 'GET',
    signal: params?.signal,
  });
}

/** GET /api/app/pages/review/home — Tab 冷启动 / 下拉主口 */
export type ReviewHomePayload = {
  dimensions: Record<string, unknown>[];
  columns: Record<string, unknown>[];
  dailyJournals: Record<string, unknown>[];
  weeklyJournal?: Record<string, unknown> | null;
  monthlyJournal?: Record<string, unknown> | null;
  meta?: ReviewPageMeta;
};

export async function apiGetReviewHome(params: {
  logicalToday: string;
  dailyStart: string;
  dailyEnd: string;
  weekStart?: string;
  monthStart?: string;
  signal?: AbortSignal;
}): Promise<ReviewHomePayload> {
  const qs = buildQuery({
    logicalToday: params.logicalToday,
    dailyStart: params.dailyStart,
    dailyEnd: params.dailyEnd,
    weekStart: params.weekStart,
    monthStart: params.monthStart,
  });
  return apiRequest<ReviewHomePayload>(`/api/app/pages/review/home${qs}`, {
    method: 'GET',
    signal: params.signal,
  });
}

/** GET /api/app/pages/review/daily — 按日期区间拉日刊（日历 / 换日） */
export type ReviewDailyPayload = {
  journals: Record<string, unknown>[];
  meta?: ReviewPageMeta & { start?: string; end?: string };
};

export async function apiGetReviewDaily(params: {
  start: string;
  end: string;
  signal?: AbortSignal;
}): Promise<ReviewDailyPayload> {
  const qs = buildQuery({
    start: params.start,
    end: params.end,
  });
  return apiRequest<ReviewDailyPayload>(`/api/app/pages/review/daily${qs}`, {
    method: 'GET',
    signal: params.signal,
  });
}

/** GET /api/app/pages/review/weekly — 按周起点拉周刊（可多周） */
export type ReviewWeeklyPayload = {
  journals: Record<string, unknown>[];
  meta?: ReviewPageMeta;
};

export async function apiGetReviewWeekly(params: {
  weekStart?: string;
  start?: string;
  end?: string;
  signal?: AbortSignal;
}): Promise<ReviewWeeklyPayload> {
  const qs = buildQuery({
    weekStart: params.weekStart,
    start: params.start,
    end: params.end,
  });
  return apiRequest<ReviewWeeklyPayload>(`/api/app/pages/review/weekly${qs}`, {
    method: 'GET',
    signal: params.signal,
  });
}

/** GET /api/app/pages/review/monthly — 按月初拉月刊 */
export type ReviewMonthlyPayload = {
  journals: Record<string, unknown>[];
  meta?: ReviewPageMeta;
};

export async function apiGetReviewMonthly(params: {
  monthStart?: string;
  start?: string;
  end?: string;
  signal?: AbortSignal;
}): Promise<ReviewMonthlyPayload> {
  const qs = buildQuery({
    monthStart: params.monthStart,
    start: params.start,
    end: params.end,
  });
  return apiRequest<ReviewMonthlyPayload>(`/api/app/pages/review/monthly${qs}`, {
    method: 'GET',
    signal: params.signal,
  });
}

/**
 * GET /api/app/pages/review/week-metrics
 * 周复盘旧表单指标：服务端按区间聚合，禁止 APP 再 List tasks/habits/finance 全表
 */
export type ReviewWeekMetricsPayload = {
  rangeKind?: 'rolling-7' | 'calendar-week';
  weekStartYmd: string;
  weekEndYmd: string;
  rangeDisplay?: string;
  weekTitle?: string;
  tasksCompleted: number;
  tasksCreated: number;
  habitCheckInTotal: number;
  savingsWeekTotal: number;
  financeIncome: number;
  financeExpense: number;
  meta?: ReviewPageMeta;
};

export async function apiGetReviewWeekMetrics(params: {
  start: string;
  end: string;
  rangeKind?: 'rolling-7' | 'calendar-week';
  signal?: AbortSignal;
}): Promise<ReviewWeekMetricsPayload> {
  const qs = buildQuery({
    start: params.start,
    end: params.end,
    rangeKind: params.rangeKind,
  });
  return apiRequest<ReviewWeekMetricsPayload>(`/api/app/pages/review/week-metrics${qs}`, {
    method: 'GET',
    signal: params.signal,
  });
}

