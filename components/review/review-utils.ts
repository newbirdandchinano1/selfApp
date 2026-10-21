import {
  aggregateBuiltinFieldsFromChildren,
  collectColumnIds,
  emptyFieldValues,
  fillEmptyFieldsFromRollup,
  parseDailyReviewBody,
  parseWeeklyReviewFields,
  type ReviewFieldValues,
} from '@/lib/repositories/insights/review-journal-body';
import { listDailyReviewsBetween } from '@/lib/repositories/insights/daily-review-journal';
import { listWeeklyReviewsBetween } from '@/lib/repositories/insights/weekly-review-journal';
import {
  ensureBuiltinCascadeReviewModules,
  ensureBuiltinDailyReviewModules,
  listReviewTemplate,
} from '@/lib/repositories/insights/review-template';
import type { ReviewDimensionTemplate } from '@/lib/repositories/insights/review-template.types';
import { getRollingSevenDayRange, getRollingSevenDayRangeEndingOnNextReviewDay } from '@/lib/repositories/insights/weekly-review';
import { fetchReviewHome, shouldFetchReviewFromApi } from '@/lib/review-page-api';
import { addDaysToYmd, formatYmd, parseYmd } from '@/lib/date';
import { formatStoredDatetimeHm } from '@/lib/api-mysql-datetime';
import {
  getWeeklyReviewConfiguredWeekday,
  isDailyReviewSkippedOnWeeklyReviewDay,
  isTodayConfiguredWeeklyReviewDay,
  WEEKLY_REVIEW_WEEKDAY_LABELS,
} from '@/lib/weekly-review-settings';

export { WEEKLY_REVIEW_WEEKDAY_LABELS };

export type DailyEntry = {
  ymd: string;
  label: string;
  fields: ReviewFieldValues;
  /** 最近一次落笔时间（数据库时间戳原样），用于列表右侧「4 维 · 18:40」 */
  updatedAt?: string | null;
};

const HEADER_WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'] as const;

export function toYmdLocal(d: Date): string {
  return formatYmd(d);
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

/** 自然月月末 YYYY-MM-DD */
export function monthEndYmdFromMonthStart(monthStartYmd: string): string {
  const start = parseYmd(monthStartYmdFromYmd(monthStartYmd));
  if (!start) return monthStartYmd;
  const end = new Date(start.getFullYear(), start.getMonth() + 1, 0);
  return formatYmd(end);
}

/** 从近六天（跳过周复盘日）日复盘汇总到周复盘空栏 */
export function rollupWeeklyFieldsFromDailyEntries(
  fields: ReviewFieldValues,
  dailyEntries: DailyEntry[],
  reviewCycleEndYmd: string,
  configuredDow: number | null,
): ReviewFieldValues {
  const children = dailyEntries
    .filter(
      e => !isDailyReviewSkippedOnWeeklyReviewDay(e.ymd, reviewCycleEndYmd, configuredDow),
    )
    .map(e => ({ label: e.label, fields: e.fields }));
  const rollup = aggregateBuiltinFieldsFromChildren({
    children,
    childScope: 'daily',
    parentScope: 'weekly',
  });
  return fillEmptyFieldsFromRollup(fields, rollup);
}

/** 从本月各周复盘汇总到月复盘空栏 */
export async function rollupMonthlyFieldsFromWeeklyJournals(
  fields: ReviewFieldValues,
  monthStartYmd: string,
): Promise<ReviewFieldValues> {
  const monthEnd = monthEndYmdFromMonthStart(monthStartYmd);
  const weeklyTpl = await listReviewTemplate('weekly');
  const wColIds = collectColumnIds(weeklyTpl);
  const rows = await listWeeklyReviewsBetween(monthStartYmd, monthEnd);
  const children = rows.map(row => {
    const start = parseYmd(row.week_start_ymd);
    const end = start ? addDaysToYmd(row.week_start_ymd, 6) : row.week_start_ymd;
    const startLabel = start
      ? `${start.getMonth() + 1}月${start.getDate()}日`
      : row.week_start_ymd;
    const endDate = parseYmd(end);
    const endLabel = endDate ? `${endDate.getMonth() + 1}月${endDate.getDate()}日` : end;
    return {
      label: `${startLabel}–${endLabel}`,
      fields: parseWeeklyReviewFields(row, wColIds),
    };
  });
  const rollup = aggregateBuiltinFieldsFromChildren({
    children,
    childScope: 'weekly',
    parentScope: 'monthly',
  });
  return fillEmptyFieldsFromRollup(fields, rollup);
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
  return addDaysToYmd(ymd, deltaDays);
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
    });
  }

  await ensureBuiltinCascadeReviewModules().catch(() => ensureBuiltinDailyReviewModules());
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
  const updatedByYmd = new Map(
    dailyRows.map(r => [r.record_date_ymd, r.updated_at ?? r.created_at ?? null]),
  );
  const dailyEntries: DailyEntry[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(rolling.start);
    d.setDate(rolling.start.getDate() + i);
    const ymd = toYmdLocal(d);
    dailyEntries.push({
      ymd,
      label: `${d.getMonth() + 1}月${d.getDate()}日 ${WEEKLY_REVIEW_WEEKDAY_LABELS[d.getDay()]}`,
      fields: byYmd.get(ymd) ?? emptyFieldValues(dColIds),
      updatedAt: updatedByYmd.get(ymd) ?? null,
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
 * 以 endYmd 为终点的连续复盘天数（跳过周复盘日）。
 * endYmd 本身未填或为周复盘日时返回 0。
 */
export function countDailyReviewStreakEndingAt(
  entries: DailyEntry[],
  configuredDow: number | null,
  endYmd: string,
): number {
  if (!endYmd || isDailyReviewSkippedForYmd(endYmd, configuredDow)) return 0;
  const byYmd = new Map(entries.map(e => [e.ymd, e]));
  const endEntry = byYmd.get(endYmd);
  if (!endEntry || !isDailyReviewDoneLight(endEntry.fields)) return 0;

  let streak = 0;
  let cursor = endYmd;
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
  const todaySkipped = isDailyReviewSkippedForYmd(todayYmd, configuredDow);
  const byYmd = new Map(entries.map(e => [e.ymd, e]));
  const todayEntry = byYmd.get(todayYmd);
  const todayDone =
    !todaySkipped && todayEntry != null && isDailyReviewDoneLight(todayEntry.fields);
  const endYmd = !todayDone && !todaySkipped ? getYesterdayYmd(todayYmd) : todayYmd;
  return countDailyReviewStreakEndingAt(entries, configuredDow, endYmd);
}

export function formatWeekReviewProgressLabel(filled: number, editable: number): string {
  const total = Math.max(0, editable);
  const n = Math.min(Math.max(0, filled), total || filled);
  if (total <= 0) return `本周已复盘 ${n}`;
  return `本周 ${n}/${total}`;
}

/** Hub 连续记录：近 46 天日复盘，用于「连续 12 天」 */
export async function loadDailyStreakEntries(todayYmd: string, days = 46): Promise<DailyEntry[]> {
  const start = shiftYmd(todayYmd, -(days - 1));
  const [rows, tpl] = await Promise.all([
    listDailyReviewsBetween(start, todayYmd),
    listReviewTemplate('daily'),
  ]);
  const colIds = collectColumnIds(tpl);
  const byYmd = new Map(rows.map(r => [r.record_date_ymd, parseDailyReviewBody(r.body ?? '', colIds)]));
  const out: DailyEntry[] = [];
  for (let i = 0; i < days; i++) {
    const ymd = shiftYmd(start, i);
    out.push({ ymd, label: ymd, fields: byYmd.get(ymd) ?? emptyFieldValues(colIds) });
  }
  return out;
}

/** 数据库时间戳（MySQL DATETIME / ISO）→ HH:MM；无效返回 null */
export function formatClockFromDatetime(value: string | null | undefined): string | null {
  if (!value) return null;
  const hm = formatStoredDatetimeHm(value);
  return hm || null;
}

/** ISO 周序号（周一起算），用于「第 18 周」 */
export function isoWeekNumber(ymd: string): number {
  const date = parseYmd(ymd);
  if (!date) return 1;
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayNr = (target.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNr + 3);
  const firstThursday = new Date(target.getFullYear(), 0, 4);
  const firstDayNr = (firstThursday.getDay() + 6) % 7;
  firstThursday.setDate(firstThursday.getDate() - firstDayNr + 3);
  const diff = target.getTime() - firstThursday.getTime();
  return 1 + Math.round(diff / (7 * 24 * 3600 * 1000));
}

/** 年内第几天，用于「DAY 124」 */
export function dayOfYear(ymd: string): number {
  const date = parseYmd(ymd);
  if (!date) return 1;
  const start = new Date(date.getFullYear(), 0, 1);
  return Math.floor((date.getTime() - start.getTime()) / 86400000) + 1;
}

/** 拆出「5/3」「周一」这类列表用短标签 */
export function splitEntryLabel(label: string, ymd: string): { date: string; weekday: string } {
  const m = /(\d+)月(\d+)日\s*周?(.)/.exec(label);
  if (m) return { date: `${Number(m[1])}/${Number(m[2])}`, weekday: `周${m[3]}` };
  const date = parseYmd(ymd);
  if (!date) return { date: ymd, weekday: '' };
  return {
    date: `${date.getMonth() + 1}/${date.getDate()}`,
    weekday: `周${HEADER_WEEKDAY_LABELS[date.getDay()]}`,
  };
}
