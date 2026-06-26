import { AppSettingKey, getAppSetting, setAppSetting } from '@/lib/app-settings-store';

/** 全应用「日界」：新一天的统计从该时刻起算（默认 0:00 即自然日） */
export type TasksDayBoundary = { hour: number; minute: number };

/** @deprecated 使用 `TasksDayBoundary` */
export type AppDayBoundary = TasksDayBoundary;

export const DEFAULT_TASKS_DAY_BOUNDARY: TasksDayBoundary = { hour: 0, minute: 0 };

let cachedBoundary: TasksDayBoundary | null = null;
const listeners = new Set<() => void>();

export function getDayBoundarySync(): TasksDayBoundary {
  return cachedBoundary ? { ...cachedBoundary } : { ...DEFAULT_TASKS_DAY_BOUNDARY };
}

export function subscribeDayBoundary(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notifyDayBoundaryListeners() {
  listeners.forEach((l) => l());
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function normalizeTasksDayBoundary(raw: unknown): TasksDayBoundary {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...DEFAULT_TASKS_DAY_BOUNDARY };
  const o = raw as Record<string, unknown>;
  const hour = typeof o.hour === 'number' && Number.isFinite(o.hour) ? Math.round(o.hour) : DEFAULT_TASKS_DAY_BOUNDARY.hour;
  const minute = typeof o.minute === 'number' && Number.isFinite(o.minute) ? Math.round(o.minute) : DEFAULT_TASKS_DAY_BOUNDARY.minute;
  const h = Math.min(23, Math.max(0, hour));
  const m = Math.min(59, Math.max(0, minute));
  return { hour: h, minute: m };
}

/** 与 `formatLocalYmd` 一致：本地日历日的 YYYY-MM-DD */
export function formatLocalYmdFromDate(date: Date): string {
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${mo}-${d}`;
}

/**
 * 给定当前时刻与「日界」时刻，返回逻辑上的「今天」YMD。
 * 若当前本地时间早于日界，则仍算作前一自然日的逻辑日。
 */
export function getLogicalLocalYmd(now: Date, boundary: TasksDayBoundary): string {
  const { hour: bh, minute: bm } = boundary;
  const y = now.getFullYear();
  const mo = now.getMonth();
  const d = now.getDate();
  const mins = now.getHours() * 60 + now.getMinutes();
  const startMins = bh * 60 + bm;
  let logical = new Date(y, mo, d);
  if (mins < startMins) {
    logical.setDate(logical.getDate() - 1);
  }
  return formatLocalYmdFromDate(logical);
}

export function formatTasksDayBoundaryLabel(b: TasksDayBoundary): string {
  const x = normalizeTasksDayBoundary(b);
  return `${pad2(x.hour)}:${pad2(x.minute)}`;
}

/** 逻辑日 YMD → 本地日历日中午，便于展示星期与月日标签 */
export function logicalYmdToLocalDate(ymd: string): Date {
  const [y, mo, d] = ymd.split('-').map((x) => parseInt(x, 10));
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) {
    return new Date();
  }
  return new Date(y, mo - 1, d, 12, 0, 0, 0);
}

export function addDaysToLogicalYmd(ymd: string, deltaDays: number): string {
  const d = logicalYmdToLocalDate(ymd);
  d.setDate(d.getDate() + deltaDays);
  return formatLocalYmdFromDate(d);
}

export function getLogicalDayKeyFromDate(at: Date, boundary?: TasksDayBoundary): string {
  return getLogicalLocalYmd(at, boundary ?? getDayBoundarySync());
}

/**
 * 逻辑日翻页后同步锚定日期/时间：若仍停留在旧「今天 / 昨天」视图，则跳到新逻辑日的当前时刻。
 */
export function refreshAnchorAfterLogicalDayChange(
  value: Date,
  boundary: TasksDayBoundary,
  logicalTodayYmd: string,
  previousLogicalTodayYmd: string,
): Date {
  if (previousLogicalTodayYmd === logicalTodayYmd) return value;
  const valueYmd = getLogicalLocalYmd(value, boundary);
  const staleFromYmd = addDaysToLogicalYmd(previousLogicalTodayYmd, -1);
  if (valueYmd >= staleFromYmd) {
    return new Date();
  }
  return value;
}

/** 逻辑日 YMD 翻页后：若选中的是旧「今天 / 昨天」，则切到新逻辑日 */
export function refreshYmdFocusAfterLogicalDayChange(
  focusYmd: string,
  logicalTodayYmd: string,
  previousLogicalTodayYmd: string,
): string {
  if (previousLogicalTodayYmd === logicalTodayYmd) return focusYmd;
  const staleFromYmd = addDaysToLogicalYmd(previousLogicalTodayYmd, -1);
  if (focusYmd >= staleFromYmd) {
    return logicalTodayYmd;
  }
  return focusYmd;
}

export async function loadTasksDayBoundary(): Promise<TasksDayBoundary> {
  try {
    const parsed = await getAppSetting<unknown>(AppSettingKey.tasksCompletionDayStart);
    if (parsed == null) {
      cachedBoundary = { ...DEFAULT_TASKS_DAY_BOUNDARY };
      return { ...DEFAULT_TASKS_DAY_BOUNDARY };
    }
    const b = normalizeTasksDayBoundary(parsed);
    cachedBoundary = b;
    return b;
  } catch {
    cachedBoundary = { ...DEFAULT_TASKS_DAY_BOUNDARY };
    return { ...DEFAULT_TASKS_DAY_BOUNDARY };
  }
}

/** 与 `loadTasksDayBoundary` 相同，语义为全应用日界 */
export const loadAppDayBoundary = loadTasksDayBoundary;

export async function saveTasksDayBoundary(boundary: TasksDayBoundary): Promise<void> {
  const x = normalizeTasksDayBoundary(boundary);
  cachedBoundary = x;
  await setAppSetting(AppSettingKey.tasksCompletionDayStart, x);
  notifyDayBoundaryListeners();
}

/** 与 `saveTasksDayBoundary` 相同，语义为全应用日界 */
export const saveAppDayBoundary = saveTasksDayBoundary;
