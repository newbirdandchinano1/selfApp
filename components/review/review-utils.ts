import {
  collectColumnIds,
  emptyFieldValues,
  parseDailyReviewBody,
  type ReviewFieldValues,
} from '@/lib/repositories/insights/review-journal-body';
import { listDailyReviewsBetween } from '@/lib/repositories/insights/daily-review-journal';
import { listReviewTemplate } from '@/lib/repositories/insights/review-template';
import type { ReviewDimensionTemplate } from '@/lib/repositories/insights/review-template.types';
import { getRollingSevenDayRange, getRollingSevenDayRangeEndingOnNextReviewDay } from '@/lib/repositories/insights/weekly-review';
import { fetchReviewHome, shouldFetchReviewFromApi } from '@/lib/review-page-api';
import {
  getWeeklyReviewConfiguredWeekday,
  isDailyReviewSkippedOnWeeklyReviewDay,
  isTodayConfiguredWeeklyReviewDay,
  WEEKLY_REVIEW_WEEKDAY_LABELS,
} from '@/lib/weekly-review-settings';

export { WEEKLY_REVIEW_WEEKDAY_LABELS };

export type DailyEntry = { ymd: string; label: string; fields: ReviewFieldValues };

const HEADER_WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'] as const;

export function toYmdLocal(d: Date): string {
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${d.getFullYear()}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function formatReviewHeaderDate(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return ymd;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return `${d.getMonth() + 1}月${d.getDate()}日 周${HEADER_WEEKDAY_LABELS[d.getDay()]}`;
}

/** 取自然月月初 YYYY-MM-01 */
export function monthStartYmdFromYmd(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return ymd;
  return `${m[1]}-${m[2]}-01`;
}

export function formatReviewMonthLabel(monthStartYmd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(monthStartYmd.trim());
  if (!m) return monthStartYmd;
  return `${m[1]}年${Number(m[2])}月`;
}

export function shiftMonthStartYmd(monthStartYmd: string, deltaMonths: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(monthStartYmd.trim());
  if (!m) return monthStartYmd;
  const d = new Date(Number(m[1]), Number(m[2]) - 1 + deltaMonths, 1);
  return toYmdLocal(d);
}

/** 月复盘：过去与当前自然月可填；未来月不可填 */
export function isMonthlyReviewEditable(monthStartYmd: string, todayYmd: string): boolean {
  return monthStartYmdFromYmd(monthStartYmd) <= monthStartYmdFromYmd(todayYmd);
}

export function formatRangeLabel(start: Date, end: Date): string {
  return `${start.getMonth() + 1}月${start.getDate()}日 – ${end.getMonth() + 1}月${end.getDate()}日`;
}

export function getYesterdayYmd(todayYmd: string): string {
  return shiftYmd(todayYmd, -1);
}

export function shiftYmd(ymd: string, deltaDays: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return ymd;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  d.setDate(d.getDate() + deltaDays);
  return toYmdLocal(d);
}

/** 当前复盘周期（7 天区间） */
export function resolveReviewPeriodRolling(today: Date, configuredDow: number | null) {
  return configuredDow !== null
    ? getRollingSevenDayRangeEndingOnNextReviewDay(today, configuredDow)
    : getRollingSevenDayRange(today);
}

/** 每日复盘：过去与自然日「今天」可填；未来日期不可填。 */
export function isDailyReviewEditableYmd(ymd: string, todayYmd: string): boolean {
  return ymd <= todayYmd;
}

export function isFutureYmd(ymd: string, todayYmd: string): boolean {
  return ymd > todayYmd;
}

/** 任意日期是否落在其所在周期的「周复盘日」（该日不做日复盘）。 */
export function isDailyReviewSkippedForYmd(ymd: string, configuredDow: number | null): boolean {
  if (configuredDow === null) return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return false;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const { endYmd } = getRollingSevenDayRangeEndingOnNextReviewDay(d, configuredDow);
  return ymd === endYmd;
}

export function dailyEntryHasContent(fields: ReviewFieldValues): boolean {
  return Object.values(fields).some(v => (v ?? '').trim().length > 0);
}

export function formatMetricMoney(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '¥0';
  return `¥${Math.round(n).toLocaleString('zh-CN')}`;
}

export function formatMetricInt(n: number): string {
  if (!Number.isFinite(n)) return '0';
  return String(Math.round(n));
}

export type ReviewPeriodSnapshot = {
  configuredDow: number | null;
  dailyTemplate: ReviewDimensionTemplate[];
  dailyEntries: DailyEntry[];
  dailyPeriodLabel: string;
  reviewCycleEndYmd: string;
  canEditWeekly: boolean;
  weekRangeLabel: string;
  periodStartYmd: string;
};

export async function loadReviewPeriodSnapshot(todayYmd: string): Promise<ReviewPeriodSnapshot> {
  const dow = await getWeeklyReviewConfiguredWeekday();
  const today = new Date();
  const rolling =
    dow !== null ? getRollingSevenDayRangeEndingOnNextReviewDay(today, dow) : getRollingSevenDayRange(today);
  const monthStart = monthStartYmdFromYmd(todayYmd);

  if (shouldFetchReviewFromApi()) {
    await fetchReviewHome({
      logicalToday: todayYmd,
      dailyStart: rolling.startYmd,
      dailyEnd: rolling.endYmd,
      weekStart: rolling.startYmd,
      monthStart,
      offlineFallback: true,
    });
  }

  const dailyTpl = await listReviewTemplate('daily');
  const dColIds = collectColumnIds(dailyTpl);

  const dailyPeriodLabel =
    dow !== null
      ? `${formatRangeLabel(rolling.start, rolling.end)} · 周期终点：${rolling.end.getMonth() + 1}月${rolling.end.getDate()}日（${
          WEEKLY_REVIEW_WEEKDAY_LABELS[dow]
        }）`
      : `${formatRangeLabel(rolling.start, rolling.end)}（尚未设置复盘日时，暂以今日为终点倒推 7 天）`;

  const dailyRows = await listDailyReviewsBetween(rolling.startYmd, rolling.endYmd);
  const byYmd = new Map(dailyRows.map(r => [r.record_date_ymd, parseDailyReviewBody(r.body ?? '', dColIds)]));
  const dailyEntries: DailyEntry[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(rolling.start);
    d.setDate(rolling.start.getDate() + i);
    const ymd = toYmdLocal(d);
    dailyEntries.push({
      ymd,
      label: `${d.getMonth() + 1}月${d.getDate()}日 ${WEEKLY_REVIEW_WEEKDAY_LABELS[d.getDay()]}`,
      fields: byYmd.get(ymd) ?? emptyFieldValues(dColIds),
    });
  }

  const canEditWeekly = dow !== null && isTodayConfiguredWeeklyReviewDay(dow, today);

  return {
    configuredDow: dow,
    dailyTemplate: dailyTpl,
    dailyEntries,
    dailyPeriodLabel,
    reviewCycleEndYmd: dow !== null ? rolling.endYmd : '',
    canEditWeekly,
    weekRangeLabel: formatRangeLabel(rolling.start, rolling.end),
    periodStartYmd: canEditWeekly ? rolling.startYmd : '',
  };
}

export function countFilledDailyEntries(
  entries: DailyEntry[],
  reviewCycleEndYmd: string,
  configuredDow: number | null,
): number {
  return entries.filter(
    e => !isDailyReviewSkippedOnWeeklyReviewDay(e.ymd, reviewCycleEndYmd, configuredDow) && dailyEntryHasContent(e.fields),
  ).length;
}

export function countEditableDailyEntries(
  entries: DailyEntry[],
  reviewCycleEndYmd: string,
  configuredDow: number | null,
  todayYmd: string,
): number {
  return entries.filter(
    e =>
      !isDailyReviewSkippedOnWeeklyReviewDay(e.ymd, reviewCycleEndYmd, configuredDow) &&
      isDailyReviewEditableYmd(e.ymd, todayYmd),
  ).length;
}

export function isDailySkipped(
  ymd: string,
  reviewCycleEndYmd: string,
  configuredDow: number | null,
): boolean {
  return isDailyReviewSkippedOnWeeklyReviewDay(ymd, reviewCycleEndYmd, configuredDow);
}

/** 任一栏目非空即视为「今日已复盘」（轻量完成定义） */
export function isDailyReviewDoneLight(fields: ReviewFieldValues): boolean {
  return dailyEntryHasContent(fields);
}

/**
 * 连续复盘天数：从 todayYmd 往前数（跳过周复盘日），遇到未填即停。
 * 若今天尚未填写，则从昨天起算（已养成的连续仍可见）。
 */
export function countDailyReviewStreak(
  entries: DailyEntry[],
  _reviewCycleEndYmd: string,
  configuredDow: number | null,
  todayYmd: string,
): number {
  const byYmd = new Map(entries.map(e => [e.ymd, e]));
  let cursor = todayYmd;
  const todaySkipped = isDailyReviewSkippedForYmd(todayYmd, configuredDow);
  const todayEntry = byYmd.get(todayYmd);
  const todayDone =
    !todaySkipped && todayEntry != null && isDailyReviewDoneLight(todayEntry.fields);
  if (!todayDone && !todaySkipped) {
    cursor = getYesterdayYmd(todayYmd);
  }

  let streak = 0;
  for (let i = 0; i < 366; i++) {
    if (isDailyReviewSkippedForYmd(cursor, configuredDow)) {
      cursor = getYesterdayYmd(cursor);
      continue;
    }
    const entry = byYmd.get(cursor);
    if (!entry) break;
    if (!isDailyReviewDoneLight(entry.fields)) break;
    streak += 1;
    cursor = getYesterdayYmd(cursor);
  }
  return streak;
}

export function formatWeekReviewProgressLabel(filled: number, editable: number): string {
  const total = Math.max(0, editable);
  const n = Math.min(Math.max(0, filled), total || filled);
  if (total <= 0) return `本周已复盘 ${n}`;
  return `本周 ${n}/${total}`;
}
