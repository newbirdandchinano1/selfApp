import AsyncStorage from '@react-native-async-storage/async-storage';

/** 本地「日界」：新一天的统计从该时刻起算（默认 0:00 即自然日） */
export type TasksDayBoundary = { hour: number; minute: number };

export const DEFAULT_TASKS_DAY_BOUNDARY: TasksDayBoundary = { hour: 0, minute: 0 };

const STORAGE_KEY = '@tasks_completion_day_start_v1';

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

export async function loadTasksDayBoundary(): Promise<TasksDayBoundary> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_TASKS_DAY_BOUNDARY };
    const parsed: unknown = JSON.parse(raw);
    return normalizeTasksDayBoundary(parsed);
  } catch {
    return { ...DEFAULT_TASKS_DAY_BOUNDARY };
  }
}

export async function saveTasksDayBoundary(boundary: TasksDayBoundary): Promise<void> {
  const x = normalizeTasksDayBoundary(boundary);
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(x));
}
