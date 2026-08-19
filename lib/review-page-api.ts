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
  type ReviewCatalogPayload,
  type ReviewDailyPayload,
  type ReviewHomePayload,
  type ReviewMonthlyPayload,
  type ReviewWeekMetricsPayload,
  type ReviewWeeklyPayload,
} from '@/lib/api-client';
import { withApiTableSyncLock } from '@/lib/api-read';
import { syncApiReadResultToLocal } from '@/lib/api-read-local-sync';
import { getActivePageApiReadOpts } from '@/lib/page-api-session';
import type { DailyReviewJournalRow } from '@/lib/repositories/insights/daily-review-journal.types';
import type { MonthlyReviewJournalRow } from '@/lib/repositories/insights/monthly-review-journal.types';
import type { ReviewColumnRow, ReviewDimensionRow } from '@/lib/repositories/insights/review-template.types';
import type { WeeklyReviewJournalRow } from '@/lib/repositories/insights/weekly-review-journal.types';

function asRecordArray(raw: unknown): Record<string, unknown>[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x));
}

/** wrapLoad 上下文为 localOnly 时跳过 REST，只读本地 */
export function shouldFetchReviewFromApi(): boolean {
  return getActivePageApiReadOpts()?.localOnly !== true;
}

async function upsertReviewRows(table: string, rows: Record<string, unknown>[]): Promise<void> {
  if (rows.length === 0) return;
  await withApiTableSyncLock(table, async () => {
    await syncApiReadResultToLocal(table, rows);
  });
}

async function syncCatalogParts(payload: {
  dimensions?: unknown;
  columns?: unknown;
}): Promise<{ dimensions: ReviewDimensionRow[]; columns: ReviewColumnRow[] }> {
  const dimensions = asRecordArray(payload.dimensions) as ReviewDimensionRow[];
  const columns = asRecordArray(payload.columns) as ReviewColumnRow[];
  await Promise.all([
    upsertReviewRows('review_dimensions', dimensions as Record<string, unknown>[]),
    upsertReviewRows('review_columns', columns as Record<string, unknown>[]),
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
  try {
    const payload: ReviewCatalogPayload = await apiGetReviewCatalog({
      scope: opts?.scope,
      signal: opts?.signal,
    });
    const { dimensions, columns } = await syncCatalogParts(payload);
    return { dimensions, columns, fromApi: true };
  } catch (e) {
    if (opts?.offlineFallback === false) throw e;
    console.warn('[review-page-api] catalog 失败，回退本地', e);
    return { dimensions: [], columns: [], fromApi: false };
  }
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
  try {
    const payload: ReviewHomePayload = await apiGetReviewHome({
      logicalToday: opts.logicalToday,
      dailyStart: opts.dailyStart,
      dailyEnd: opts.dailyEnd,
      weekStart: opts.weekStart,
      monthStart: opts.monthStart,
      signal: opts.signal,
    });
    const { dimensions, columns } = await syncCatalogParts(payload);
    const dailyJournals = asRecordArray(payload.dailyJournals) as DailyReviewJournalRow[];
    await upsertReviewRows('daily_review_journal', dailyJournals as Record<string, unknown>[]);

    const weeklyRaw =
      payload.weeklyJournal && typeof payload.weeklyJournal === 'object'
        ? (payload.weeklyJournal as WeeklyReviewJournalRow)
        : null;
    if (weeklyRaw) {
      await upsertReviewRows('weekly_review_journal', [weeklyRaw as Record<string, unknown>]);
    }

    const monthlyRaw =
      payload.monthlyJournal && typeof payload.monthlyJournal === 'object'
        ? (payload.monthlyJournal as MonthlyReviewJournalRow)
        : null;
    if (monthlyRaw) {
      await upsertReviewRows('monthly_review_journal', [monthlyRaw as Record<string, unknown>]);
    }

    return {
      dimensions,
      columns,
      dailyJournals,
      weeklyJournal: weeklyRaw,
      monthlyJournal: monthlyRaw,
      fromApi: true,
    };
  } catch (e) {
    if (opts.offlineFallback === false) throw e;
    console.warn('[review-page-api] home 失败，回退本地', e);
    return {
      dimensions: [],
      columns: [],
      dailyJournals: [],
      weeklyJournal: null,
      monthlyJournal: null,
      fromApi: false,
    };
  }
}

export type ReviewDailyData = {
  journals: DailyReviewJournalRow[];
  fromApi: boolean;
};

export async function fetchReviewDaily(opts: {
  start: string;
  end: string;
  signal?: AbortSignal;
  offlineFallback?: boolean;
}): Promise<ReviewDailyData> {
  try {
    const payload: ReviewDailyPayload = await apiGetReviewDaily({
      start: opts.start,
      end: opts.end,
      signal: opts.signal,
    });
    const journals = asRecordArray(payload.journals) as DailyReviewJournalRow[];
    await upsertReviewRows('daily_review_journal', journals as Record<string, unknown>[]);
    return { journals, fromApi: true };
  } catch (e) {
    if (opts.offlineFallback === false) throw e;
    console.warn('[review-page-api] daily 失败，回退本地', e);
    return { journals: [], fromApi: false };
  }
}

export type ReviewWeeklyData = {
  journals: WeeklyReviewJournalRow[];
  fromApi: boolean;
};

export async function fetchReviewWeekly(opts: {
  weekStart?: string;
  start?: string;
  end?: string;
  signal?: AbortSignal;
  offlineFallback?: boolean;
}): Promise<ReviewWeeklyData> {
  try {
    const payload: ReviewWeeklyPayload = await apiGetReviewWeekly({
      weekStart: opts.weekStart,
      start: opts.start,
      end: opts.end,
      signal: opts.signal,
    });
    const journals = asRecordArray(payload.journals) as WeeklyReviewJournalRow[];
    await upsertReviewRows('weekly_review_journal', journals as Record<string, unknown>[]);
    return { journals, fromApi: true };
  } catch (e) {
    if (opts.offlineFallback === false) throw e;
    console.warn('[review-page-api] weekly 失败，回退本地', e);
    return { journals: [], fromApi: false };
  }
}

export type ReviewMonthlyData = {
  journals: MonthlyReviewJournalRow[];
  fromApi: boolean;
};

export async function fetchReviewMonthly(opts: {
  monthStart?: string;
  start?: string;
  end?: string;
  signal?: AbortSignal;
  offlineFallback?: boolean;
}): Promise<ReviewMonthlyData> {
  try {
    const payload: ReviewMonthlyPayload = await apiGetReviewMonthly({
      monthStart: opts.monthStart,
      start: opts.start,
      end: opts.end,
      signal: opts.signal,
    });
    const journals = asRecordArray(payload.journals) as MonthlyReviewJournalRow[];
    await upsertReviewRows('monthly_review_journal', journals as Record<string, unknown>[]);
    return { journals, fromApi: true };
  } catch (e) {
    if (opts.offlineFallback === false) throw e;
    console.warn('[review-page-api] monthly 失败，回退本地', e);
    return { journals: [], fromApi: false };
  }
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
    wishUpdates: 0,
  };
}

export async function fetchReviewWeekMetrics(opts: {
  start: string;
  end: string;
  rangeKind?: 'rolling-7' | 'calendar-week';
  signal?: AbortSignal;
  offlineFallback?: boolean;
}): Promise<ReviewWeekMetricsPayload & { fromApi: boolean }> {
  const rangeKind = opts.rangeKind ?? 'rolling-7';
  try {
    const payload: ReviewWeekMetricsPayload = await apiGetReviewWeekMetrics({
      start: opts.start,
      end: opts.end,
      rangeKind,
      signal: opts.signal,
    });
    return {
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
      wishUpdates: Number(payload.wishUpdates) || 0,
      fromApi: true,
    };
  } catch (e) {
    if (opts.offlineFallback === false) throw e;
    console.warn('[review-page-api] week-metrics 失败，回退空指标（不 List 全表）', e);
    return { ...emptyWeekMetrics(opts.start, opts.end, rangeKind), fromApi: false };
  }
}
