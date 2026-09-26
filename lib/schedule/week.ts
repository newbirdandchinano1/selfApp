import { addDaysToLogicalYmd, formatLocalYmdFromDate, logicalYmdToLocalDate } from '@/lib/tasks-logical-day';
import { isValidYmd } from '@/lib/schedule/ymd';

export { isValidYmd };

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

/** 以 center 为中日的三天窗口：[前一天, 中日, 后一天] */
export function threeDayWindow(centerYmd: string): [string, string, string] {
  return [
    addDaysToLogicalYmd(centerYmd, -1),
    centerYmd,
    addDaysToLogicalYmd(centerYmd, 1),
  ];
}

/** 周期索引 0 = 今天居中；每 ±1 周期平移 3 天 */
export function centerYmdForPeriod(logicalTodayYmd: string, periodIndex: number): string {
  return addDaysToLogicalYmd(logicalTodayYmd, periodIndex * 3);
}

export function formatThreeDayRangeLabel(centerYmd: string): string {
  const [aYmd, , cYmd] = threeDayWindow(centerYmd);
  const a = logicalYmdToLocalDate(aYmd);
  const c = logicalYmdToLocalDate(cYmd);
  return `${a.getMonth() + 1}/${a.getDate()} – ${c.getMonth() + 1}/${c.getDate()}`;
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

export const WEEKDAY_SHORT_LABELS = ['一', '二', '三', '四', '五', '六', '日'] as const;
