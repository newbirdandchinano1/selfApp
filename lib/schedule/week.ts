import { addDaysToLogicalYmd, formatLocalYmdFromDate, logicalYmdToLocalDate } from '@/lib/tasks-logical-day';
import { isValidYmd } from '@/lib/schedule/ymd';

export { isValidYmd };

export const WEEKDAY_SHORT_LABELS = ['一', '二', '三', '四', '五', '六', '日'] as const;

/** 给定任意 YMD，返回该自然周周一（本地日历） */
export function getWeekStartMondayYmd(ymd: string): string {
  const d = logicalYmdToLocalDate(ymd);
  const day = d.getDay(); // 0=日 … 6=六
  const diffToMonday = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diffToMonday);
  return formatLocalYmdFromDate(d);
}

/** weekday 1=周一 … 7=周日 → 该周对应 YMD */
export function ymdForWeekday(weekStartYmd: string, weekday: number): string {
  const w = Math.min(7, Math.max(1, Math.round(weekday)));
  return addDaysToLogicalYmd(weekStartYmd, w - 1);
}

/** YMD → weekday 1–7（周一=1） */
export function weekdayFromYmd(ymd: string): number {
  const d = logicalYmdToLocalDate(ymd);
  const day = d.getDay();
  return day === 0 ? 7 : day;
}

export function addWeeksToWeekStart(weekStartYmd: string, deltaWeeks: number): string {
  return addDaysToLogicalYmd(weekStartYmd, deltaWeeks * 7);
}

export function formatWeekRangeLabel(weekStartYmd: string): string {
  const end = addDaysToLogicalYmd(weekStartYmd, 6);
  const a = logicalYmdToLocalDate(weekStartYmd);
  const b = logicalYmdToLocalDate(end);
  return `${a.getMonth() + 1}/${a.getDate()} – ${b.getMonth() + 1}/${b.getDate()}`;
}

/** @deprecated 日程表已改为单日课表；保留给旧调用方 */
export function threeDayWindow(centerYmd: string): [string, string, string] {
  return [
    addDaysToLogicalYmd(centerYmd, -1),
    centerYmd,
    addDaysToLogicalYmd(centerYmd, 1),
  ];
}

/** 日偏移 0 = 今天；每 ±1 翻一天 */
export function centerYmdForPeriod(logicalTodayYmd: string, periodIndex: number): string {
  return addDaysToLogicalYmd(logicalTodayYmd, periodIndex);
}

/** 选中日相对今天的整日偏移（本地日历） */
export function dayOffsetFromToday(ymd: string, logicalTodayYmd: string): number {
  return Math.round(
    (logicalYmdToLocalDate(ymd).getTime() - logicalYmdToLocalDate(logicalTodayYmd).getTime()) /
      (24 * 60 * 60 * 1000),
  );
}

export function formatDayScheduleLabel(ymd: string): string {
  const d = logicalYmdToLocalDate(ymd);
  const wd = WEEKDAY_SHORT_LABELS[weekdayFromYmd(ymd) - 1];
  return `${d.getMonth() + 1}/${d.getDate()} 周${wd}`;
}

/** @deprecated 使用 formatDayScheduleLabel */
export function formatThreeDayRangeLabel(centerYmd: string): string {
  return formatDayScheduleLabel(centerYmd);
}

/** 历史周：周一早于本周周一 */
export function isHistoricalWeek(weekStartYmd: string, logicalTodayYmd: string): boolean {
  const thisMonday = getWeekStartMondayYmd(logicalTodayYmd);
  return weekStartYmd < thisMonday;
}

export function isEditableWeek(weekStartYmd: string, logicalTodayYmd: string): boolean {
  return !isHistoricalWeek(weekStartYmd, logicalTodayYmd);
}

/** 日程可编辑日：今天及未来；过去日仅可见不可改 */
export function isEditableScheduleDay(ymd: string, logicalTodayYmd: string): boolean {
  return ymd >= logicalTodayYmd;
}
