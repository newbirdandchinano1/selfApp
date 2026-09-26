import { addDays, formatYmd, parseYmd } from '@/lib/date';

export function toIsoDate(d: Date) {
  return formatYmd(d);
}

/** 本地日历解析 YYYY-MM-DD，避免 UTC 偏移导致日期错一天 */
export function parseIsoDateLocal(iso: string) {
  return parseYmd(iso) ?? new Date();
}

export function addCalendarDays(d: Date, days: number) {
  return addDays(d, days);
}

export function daysBetweenIso(startIso: string, endIso: string) {
  const s = parseIsoDateLocal(startIso);
  const e = parseIsoDateLocal(endIso);
  return Math.max(0, Math.round((e.getTime() - s.getTime()) / 86400000));
}
