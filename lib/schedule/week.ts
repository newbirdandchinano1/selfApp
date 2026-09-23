import { addDaysToLogicalYmd, formatLocalYmdFromDate, logicalYmdToLocalDate } from '@/lib/tasks-logical-day';

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidYmd(ymd: string): boolean {
  return YMD_RE.test(ymd.trim());
}

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

/** 历史周：周一早于本周周一 */
export function isHistoricalWeek(weekStartYmd: string, logicalTodayYmd: string): boolean {
  const thisMonday = getWeekStartMondayYmd(logicalTodayYmd);
  return weekStartYmd < thisMonday;
}

export function isEditableWeek(weekStartYmd: string, logicalTodayYmd: string): boolean {
  return !isHistoricalWeek(weekStartYmd, logicalTodayYmd);
}

export const WEEKDAY_SHORT_LABELS = ['一', '二', '三', '四', '五', '六', '日'] as const;
