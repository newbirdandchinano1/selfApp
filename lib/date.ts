/**
 * 本地日历日（YYYY-MM-DD）唯一工具源。
 *
 * - 一律按**设备墙上时钟**取年/月/日，禁止 `toISOString().slice(0, 10)` / `new Date('YYYY-MM-DD')`（后者按 UTC 午夜解析，东八区会错一天）。
 * - MySQL DATETIME ↔ Date 的读写规范化见 `@/lib/api-mysql-datetime`；从 DATETIME 取日历日用那里的 `ymdFromDatetime`。
 * - 任务「逻辑日」（自定义日界）见 `@/lib/tasks-logical-day`，其底层日历日仍应调用本模块。
 */

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidYmd(value: string): boolean {
  return YMD_RE.test(value.trim());
}

/** Date → 本地日历 YYYY-MM-DD */
export function formatYmd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** @deprecated 使用 formatYmd */
export const formatLocalYmd = formatYmd;

/**
 * YYYY-MM-DD → 本地 00:00:00 Date；非法返回 null。
 * 勿用 `new Date(ymd)`（会被当成 UTC）。
 */
export function parseYmd(ymd: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
  return new Date(y, mo, d);
}

/** @alias parseYmd — 课表/任务日程历史命名 */
export const ymdToLocalDate = parseYmd;

/** 在 Date 上加减整天（本地日历，保留时分秒） */
export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function addDaysToYmd(ymd: string, days: number): string {
  const d = parseYmd(ymd);
  if (!d) return ymd;
  return formatYmd(addDays(d, days));
}

export function compareYmd(a: string, b: string): number {
  const da = parseYmd(a);
  const db = parseYmd(b);
  if (!da || !db) return a.localeCompare(b);
  return da.getTime() - db.getTime();
}

export function isYmdInRange(ymd: string, startYmd: string, endYmd: string): boolean {
  return ymd >= startYmd && ymd <= endYmd;
}

/** 逻辑日展示用：本地中午，避免 DST 边界翻日 */
export function ymdToLocalNoon(ymd: string): Date {
  const d = parseYmd(ymd);
  if (!d) return new Date();
  d.setHours(12, 0, 0, 0);
  return d;
}

/**
 * 已是纯 YMD 则原样返回；否则尝试取字符串前缀 `YYYY-MM-DD`。
 * 含时刻的 MySQL/ISO 字符串请用 `ymdFromDatetime`（api-mysql-datetime），避免 `Date.parse` 时区歧义。
 */
export function ymdPrefix(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.trim();
  if (YMD_RE.test(v)) return v;
  const m = v.match(/^(\d{4}-\d{2}-\d{2})/);
  return m?.[1] ?? null;
}

/** 展示用：2026年9月26日 */
export function formatYmdCN(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return ymd;
  return `${Number(m[1])}年${Number(m[2])}月${Number(m[3])}日`;
}
