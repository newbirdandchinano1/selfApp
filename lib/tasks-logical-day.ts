import { AppSettingKey, getAppSetting, setAppSetting } from '@/lib/app-settings-store';

/**
 * 自定义日界时刻：对「已勾选」的页面，打卡/完成/日期归属从该时刻起算新一天。
 * 未勾选的页面始终按本地 0:00 自然日。
 */
export type TasksDayBoundary = { hour: number; minute: number };

/** @deprecated 使用 `TasksDayBoundary` */
export type AppDayBoundary = TasksDayBoundary;

export const DEFAULT_TASKS_DAY_BOUNDARY: TasksDayBoundary = { hour: 0, minute: 0 };

/** 可独立开关日界影响的页面（与底部 Tab 对齐） */
export type DayBoundaryPageId = 'health' | 'tasks' | 'finance' | 'review';

export const DAY_BOUNDARY_PAGE_OPTIONS: ReadonlyArray<{
  id: DayBoundaryPageId;
  label: string;
  hint: string;
}> = [
  { id: 'tasks', label: '任务与习惯', hint: '完成统计、打卡、青蛙与热力图' },
  { id: 'review', label: '复盘', hint: '日/周/月复盘「今天」与提醒归属日' },
  { id: 'health', label: '健康', hint: '首页日期与摄入统计归属日' },
  { id: 'finance', label: '财务', hint: '记账列表与流水日期归属日' },
];

/**
 * 默认仅任务与复盘受自定义日界影响（与此前行为一致）；
 * 健康 / 财务默认自然日 0:00。
 */
export const DEFAULT_DAY_BOUNDARY_PAGES: readonly DayBoundaryPageId[] = ['tasks', 'review'];

let cachedConfiguredBoundary: TasksDayBoundary | null = null;
let cachedPages: DayBoundaryPageId[] | null = null;
const listeners = new Set<() => void>();

export function getConfiguredDayBoundarySync(): TasksDayBoundary {
  return cachedConfiguredBoundary
    ? { ...cachedConfiguredBoundary }
    : { ...DEFAULT_TASKS_DAY_BOUNDARY };
}

/** 任务域有效日界（未勾选任务页时为 0:00） */
export function getDayBoundarySync(): TasksDayBoundary {
  return getDayBoundaryForPageSync('tasks');
}

export function getDayBoundaryPagesSync(): DayBoundaryPageId[] {
  return cachedPages ? [...cachedPages] : [...DEFAULT_DAY_BOUNDARY_PAGES];
}

export function isDayBoundaryPageEnabledSync(page: DayBoundaryPageId): boolean {
  return getDayBoundaryPagesSync().includes(page);
}

export function getDayBoundaryForPageSync(page: DayBoundaryPageId): TasksDayBoundary {
  if (!isDayBoundaryPageEnabledSync(page)) {
    return { ...DEFAULT_TASKS_DAY_BOUNDARY };
  }
  return getConfiguredDayBoundarySync();
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

const PAGE_ID_SET = new Set<DayBoundaryPageId>(DAY_BOUNDARY_PAGE_OPTIONS.map((o) => o.id));

export function normalizeDayBoundaryPages(raw: unknown): DayBoundaryPageId[] {
  if (!Array.isArray(raw)) return [...DEFAULT_DAY_BOUNDARY_PAGES];
  const seen = new Set<DayBoundaryPageId>();
  const out: DayBoundaryPageId[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    if (!PAGE_ID_SET.has(item as DayBoundaryPageId)) continue;
    const id = item as DayBoundaryPageId;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
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

export async function loadConfiguredDayBoundary(): Promise<TasksDayBoundary> {
  try {
    const parsed = await getAppSetting<unknown>(AppSettingKey.tasksCompletionDayStart);
    if (parsed == null) {
      cachedConfiguredBoundary = { ...DEFAULT_TASKS_DAY_BOUNDARY };
      return { ...DEFAULT_TASKS_DAY_BOUNDARY };
    }
    const b = normalizeTasksDayBoundary(parsed);
    cachedConfiguredBoundary = b;
    return b;
  } catch {
    cachedConfiguredBoundary = { ...DEFAULT_TASKS_DAY_BOUNDARY };
    return { ...DEFAULT_TASKS_DAY_BOUNDARY };
  }
}

export async function loadDayBoundaryPages(): Promise<DayBoundaryPageId[]> {
  try {
    const parsed = await getAppSetting<unknown>(AppSettingKey.dayBoundaryPages);
    if (parsed == null) {
      cachedPages = [...DEFAULT_DAY_BOUNDARY_PAGES];
      return [...DEFAULT_DAY_BOUNDARY_PAGES];
    }
    const pages = normalizeDayBoundaryPages(parsed);
    cachedPages = pages;
    return [...pages];
  } catch {
    cachedPages = [...DEFAULT_DAY_BOUNDARY_PAGES];
    return [...DEFAULT_DAY_BOUNDARY_PAGES];
  }
}

/** 某页面的有效日界：勾选则用配置时刻，否则 0:00 */
export async function resolveDayBoundaryForPage(page: DayBoundaryPageId): Promise<TasksDayBoundary> {
  const [configured, pages] = await Promise.all([loadConfiguredDayBoundary(), loadDayBoundaryPages()]);
  if (!pages.includes(page)) return { ...DEFAULT_TASKS_DAY_BOUNDARY };
  return configured;
}

/**
 * 任务域有效日界。未勾选「任务与习惯」时返回 0:00。
 * 需要读取「设置里配置的时刻」时请用 `loadConfiguredDayBoundary`。
 */
export async function loadTasksDayBoundary(): Promise<TasksDayBoundary> {
  return resolveDayBoundaryForPage('tasks');
}

/** @deprecated 使用 `loadConfiguredDayBoundary` / `resolveDayBoundaryForPage` */
export const loadAppDayBoundary = loadConfiguredDayBoundary;

export async function saveConfiguredDayBoundary(boundary: TasksDayBoundary): Promise<void> {
  const x = normalizeTasksDayBoundary(boundary);
  cachedConfiguredBoundary = x;
  await setAppSetting(AppSettingKey.tasksCompletionDayStart, x);
  notifyDayBoundaryListeners();
}

export async function saveTasksDayBoundary(boundary: TasksDayBoundary): Promise<void> {
  await saveConfiguredDayBoundary(boundary);
}

/** @deprecated 使用 `saveConfiguredDayBoundary` */
export const saveAppDayBoundary = saveConfiguredDayBoundary;

export async function saveDayBoundaryPages(pages: readonly DayBoundaryPageId[]): Promise<void> {
  const next = normalizeDayBoundaryPages(pages);
  cachedPages = next;
  await setAppSetting(AppSettingKey.dayBoundaryPages, next);
  notifyDayBoundaryListeners();
}
