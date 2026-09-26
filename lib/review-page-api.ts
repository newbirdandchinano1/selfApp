/**
 * 复盘页专用 REST：灌入本地 SQLite 后供仓库只读。
 * 失败时只回退本地，禁止降级 `/api/data/*` 全表 List。
 */
import {
  apiGetReviewCatalog,
  apiGetReviewDaily,
  apiGetReviewHome,
  apiGetReviewMonthly,
  apiGetReviewWeekMetrics,
  apiGetReviewWeekly,
  type ReviewWeekMetricsPayload,
} from '@/lib/api-client';
import {
  asRecordArray,
  fetchPage,
  shouldFetchPageFromApi,
  upsertPageRows,
} from '@/lib/page-api-fetch';
import type { DailyReviewJournalRow } from '@/lib/repositories/insights/daily-review-journal.types';
import type { MonthlyReviewJournalRow } from '@/lib/repositories/insights/monthly-review-journal.types';
import type { ReviewJournalScope } from '@/lib/repositories/insights/review-journal-store';
import { REVIEW_JOURNAL_SCOPE } from '@/lib/repositories/insights/review-journal-store';
import type { ReviewColumnRow, ReviewDimensionRow } from '@/lib/repositories/insights/review-template.types';
import type { WeeklyReviewJournalRow } from '@/lib/repositories/insights/weekly-review-journal.types';

/** @deprecated 使用 shouldFetchPageFromApi */
export function shouldFetchReviewFromApi(): boolean {
  return shouldFetchPageFromApi();
}

async function syncCatalogParts(payload: {
  dimensions?: unknown;
  columns?: unknown;
}): Promise<{ dimensions: ReviewDimensionRow[]; columns: ReviewColumnRow[] }> {
  const dimensions = asRecordArray(payload.dimensions) as ReviewDimensionRow[];
  const columns = asRecordArray(payload.columns) as ReviewColumnRow[];
  await Promise.all([
    upsertPageRows('review_dimensions', dimensions as Record<string, unknown>[]),
    upsertPageRows('review_columns', columns as Record<string, unknown>[]),
  ]);
  return { dimensions, columns };
}

export type ReviewCatalogData = {
  dimensions: ReviewDimensionRow[];
  columns: ReviewColumnRow[];
  fromApi: boolean;
};

export async function fetchReviewCatalog(opts?: {
  scope?: 'daily' | 'weekly' | 'monthly' | 'all';
  signal?: AbortSignal;
  offlineFallback?: boolean;
}): Promise<ReviewCatalogData> {
  return fetchPage<
    { dimensions?: unknown; columns?: unknown },
    ReviewCatalogData
  >({
    domain: 'review',
    op: 'catalog',
    opts,
    respectLocalOnly: false,
    fetch: (signal) => apiGetReviewCatalog({ scope: opts?.scope, signal }),
    apply: async (payload) => {
      const { dimensions, columns } = await syncCatalogParts(payload);
      return { dimensions, columns, fromApi: true };
    },
    fallback: (): ReviewCatalogData => ({ dimensions: [], columns: [], fromApi: false }),
  });
}

export type ReviewHomeData = {
  dimensions: ReviewDimensionRow[];
  columns: ReviewColumnRow[];
  dailyJournals: DailyReviewJournalRow[];
  weeklyJournal: WeeklyReviewJournalRow | null;
  monthlyJournal: MonthlyReviewJournalRow | null;
  fromApi: boolean;
};

export async function fetchReviewHome(opts: {
  logicalToday: string;
  dailyStart: string;
  dailyEnd: string;
  weekStart?: string;
  monthStart?: string;
  signal?: AbortSignal;
  offlineFallback?: boolean;
}): Promise<ReviewHomeData> {
  return fetchPage<
    {
      dimensions?: unknown;
      columns?: unknown;
      dailyJournals?: unknown;
      weeklyJournal?: unknown;
      monthlyJournal?: unknown;
    },
    ReviewHomeData
  >({
    domain: 'review',
    op: 'home',
    opts,
    respectLocalOnly: false,
    fetch: (signal) =>
      apiGetReviewHome({
        logicalToday: opts.logicalToday,
        dailyStart: opts.dailyStart,
        dailyEnd: opts.dailyEnd,
        weekStart: opts.weekStart,
        monthStart: opts.monthStart,
        signal,
      }),
    apply: async (payload) => {
      const { dimensions, columns } = await syncCatalogParts(payload);
      const dailyJournals = asRecordArray(payload.dailyJournals) as DailyReviewJournalRow[];
      await upsertPageRows('daily_review_journal', dailyJournals as Record<string, unknown>[]);

      const weeklyRaw =
        payload.weeklyJournal && typeof payload.weeklyJournal === 'object'
          ? (payload.weeklyJournal as WeeklyReviewJournalRow)
          : null;
      if (weeklyRaw) {
        await upsertPageRows('weekly_review_journal', [weeklyRaw as Record<string, unknown>]);
      }

      const monthlyRaw =
        payload.monthlyJournal && typeof payload.monthlyJournal === 'object'
          ? (payload.monthlyJournal as MonthlyReviewJournalRow)
          : null;
      if (monthlyRaw) {
        await upsertPageRows('monthly_review_journal', [monthlyRaw as Record<string, unknown>]);
      }

      return {
        dimensions,
        columns,
        dailyJournals,
        weeklyJournal: weeklyRaw,
        monthlyJournal: monthlyRaw,
        fromApi: true,
      };
    },
    fallback: (): ReviewHomeData => ({
      dimensions: [],
      columns: [],
      dailyJournals: [],
      weeklyJournal: null,
      monthlyJournal: null,
      fromApi: false,
    }),
  });
}

export type ReviewJournalRow = DailyReviewJournalRow | WeeklyReviewJournalRow | MonthlyReviewJournalRow;

export type ReviewJournalData = {
  journals: ReviewJournalRow[];
  fromApi: boolean;
};

export type ReviewDailyData = {
  journals: DailyReviewJournalRow[];
  fromApi: boolean;
};

export type ReviewWeeklyData = {
  journals: WeeklyReviewJournalRow[];
  fromApi: boolean;
};

export type ReviewMonthlyData = {
  journals: MonthlyReviewJournalRow[];
  fromApi: boolean;
};

/**
 * 日 / 周 / 月 journal 同构拉取：按 scope 选表与 REST，灌入本地后返回。
 * 日刊要求 start+end；周/月可用 weekStart / monthStart 或 start/end。
 */
export async function fetchReviewJournal(opts: {
  scope: ReviewJournalScope;
  start?: string;
  end?: string;
  weekStart?: string;
  monthStart?: string;
  signal?: AbortSignal;
  offlineFallback?: boolean;
}): Promise<ReviewJournalData> {
  const { scope } = opts;
  const table = REVIEW_JOURNAL_SCOPE[scope].table;

  return fetchPage<{ journals?: unknown }, ReviewJournalData>({
    domain: 'review',
    op: scope,
    opts,
    respectLocalOnly: false,
    fetch: async (signal) => {
      if (scope === 'daily') {
        if (!opts.start || !opts.end) {
          throw new Error('fetchReviewJournal(daily) 需要 start 与 end');
        }
        return apiGetReviewDaily({ start: opts.start, end: opts.end, signal });
      }
      if (scope === 'weekly') {
        return apiGetReviewWeekly({
          weekStart: opts.weekStart,
          start: opts.start,
          end: opts.end,
          signal,
        });
      }
      return apiGetReviewMonthly({
        monthStart: opts.monthStart,
        start: opts.start,
        end: opts.end,
        signal,
      });
    },
    apply: async (payload) => {
      const journals = asRecordArray(payload.journals) as ReviewJournalRow[];
      await upsertPageRows(table, journals as Record<string, unknown>[]);
      return { journals, fromApi: true };
    },
    fallback: (): ReviewJournalData => ({ journals: [], fromApi: false }),
  });
}

export async function fetchReviewDaily(opts: {
  start: string;
  end: string;
  signal?: AbortSignal;
  offlineFallback?: boolean;
}): Promise<ReviewDailyData> {
  const result = await fetchReviewJournal({ scope: 'daily', ...opts });
  return { journals: result.journals as DailyReviewJournalRow[], fromApi: result.fromApi };
}

export async function fetchReviewWeekly(opts: {
  weekStart?: string;
  start?: string;
  end?: string;
  signal?: AbortSignal;
  offlineFallback?: boolean;
}): Promise<ReviewWeeklyData> {
  const result = await fetchReviewJournal({ scope: 'weekly', ...opts });
  return { journals: result.journals as WeeklyReviewJournalRow[], fromApi: result.fromApi };
}

export async function fetchReviewMonthly(opts: {
  monthStart?: string;
  start?: string;
  end?: string;
  signal?: AbortSignal;
  offlineFallback?: boolean;
}): Promise<ReviewMonthlyData> {
  const result = await fetchReviewJournal({ scope: 'monthly', ...opts });
  return { journals: result.journals as MonthlyReviewJournalRow[], fromApi: result.fromApi };
}

function emptyWeekMetrics(
  startYmd: string,
  endYmd: string,
  rangeKind: 'rolling-7' | 'calendar-week',
): ReviewWeekMetricsPayload {
  return {
    rangeKind,
    weekStartYmd: startYmd,
    weekEndYmd: endYmd,
    rangeDisplay: '',
    weekTitle: '',
    tasksCompleted: 0,
    tasksCreated: 0,
    habitCheckInTotal: 0,
    savingsWeekTotal: 0,
    financeIncome: 0,
    financeExpense: 0,
  };
}

export async function fetchReviewWeekMetrics(opts: {
  start: string;
  end: string;
  rangeKind?: 'rolling-7' | 'calendar-week';
  signal?: AbortSignal;
  offlineFallback?: boolean;
}): Promise<ReviewWeekMetricsPayload & { fromApi: boolean }> {
  type WeekMetricsResult = ReviewWeekMetricsPayload & { fromApi: boolean };
  const rangeKind = opts.rangeKind ?? 'rolling-7';
  return fetchPage<ReviewWeekMetricsPayload, WeekMetricsResult>({
    domain: 'review',
    op: 'week-metrics',
    opts,
    respectLocalOnly: false,
    fetch: (signal) =>
      apiGetReviewWeekMetrics({
        start: opts.start,
        end: opts.end,
        rangeKind,
        signal,
      }),
    apply: (payload): WeekMetricsResult => ({
      rangeKind: payload.rangeKind ?? rangeKind,
      weekStartYmd: payload.weekStartYmd || opts.start,
      weekEndYmd: payload.weekEndYmd || opts.end,
      rangeDisplay: payload.rangeDisplay ?? '',
      weekTitle: payload.weekTitle ?? '',
      tasksCompleted: Number(payload.tasksCompleted) || 0,
      tasksCreated: Number(payload.tasksCreated) || 0,
      habitCheckInTotal: Number(payload.habitCheckInTotal) || 0,
      savingsWeekTotal: Math.round(Number(payload.savingsWeekTotal) || 0),
      financeIncome: Math.round(Number(payload.financeIncome) || 0),
      financeExpense: Math.round(Number(payload.financeExpense) || 0),
      fromApi: true,
    }),
    fallback: (): WeekMetricsResult => ({ ...emptyWeekMetrics(opts.start, opts.end, rangeKind), fromApi: false }),
  });
}
