/**
 * 课表 / 任务日程专用的日历日辅助；基础 formatYmd / parseYmd / addDays 见 `@/lib/date`。
 */

import { addDaysToYmd, compareYmd, isValidYmd, ymdPrefix } from '@/lib/date';
import { ymdFromDatetime } from '@/lib/api-mysql-datetime';

export {
  addDaysToYmd,
  compareYmd,
  formatLocalYmd,
  formatYmd,
  formatYmdCN,
  isValidYmd,
  parseYmd,
  ymdToLocalDate,
  ymdToLocalNoon,
} from '@/lib/date';

/**
 * 任意日期字符串 → YYYY-MM-DD。
 * 已是 YMD 则原样返回；含时刻则按墙上时钟 DATETIME 解析；失败返回 null。
 */
export function toYmd(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.trim();
  if (isValidYmd(v)) return v;
  return ymdFromDatetime(v) ?? ymdPrefix(v);
}

/**
 * schedule.date / range ISO 片段 → YYYY-MM-DD。
 * 解析失败时退回前 10 字符（兼容脏数据展示）。
 */
export function scheduleDateToYmd(value: string): string {
  const t = value.trim();
  if (isValidYmd(t)) return t;
  return ymdFromDatetime(t) ?? t.slice(0, 10);
}

/**
 * 逻辑日是否落在日程区间内。
 * 单日：相等；「时刻」半开区间 [start, start+1day)：小于 end；多日闭区间：≤ end。
 */
export function isLogicalDayInYmdRange(todayYmd: string, startYmd: string, endYmd: string): boolean {
  if (!startYmd || !endYmd) return true;
  if (compareYmd(todayYmd, startYmd) < 0) return false;
  if (startYmd === endYmd) return compareYmd(todayYmd, startYmd) === 0;
  if (endYmd === addDaysToYmd(startYmd, 1)) return compareYmd(todayYmd, endYmd) < 0;
  return compareYmd(todayYmd, endYmd) <= 0;
}

export function dueDateYmd(value: string | null | undefined): string {
  return value?.trim().slice(0, 10) ?? '';
}
