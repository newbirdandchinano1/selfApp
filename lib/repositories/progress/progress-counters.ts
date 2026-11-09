/**
 * 项目/任务进度计数轨（进度燃料之一）。
 * 存于 extra_data.progress_counters。
 *
 * - 累计：current / target
 * - 周期 week：按周一 periodKey；periodReset=auto 跨周清零，manual 保留
 * - 打卡写 logs（有上限），支持撤销最近一次
 * - 满进度只作门闩/提醒，不自动归档或完成
 */
import { formatTaskAuditDatetimeLocal } from '@/lib/api-mysql-datetime';
import { isValidYmd } from '@/lib/date';
import { makeTimestampEntityId } from '@/lib/entity-id';
import { getWeekStartMondayYmd } from '@/lib/schedule/week';

export const PROGRESS_COUNTERS_KEY = 'progress_counters';

export const PROGRESS_COUNTER_TARGET_MIN = 1;
/** 不卡 4 位数；上限取安全整数，避免 JS Number 精度问题 */
export const PROGRESS_COUNTER_TARGET_MAX = Number.MAX_SAFE_INTEGER;
export const PROGRESS_COUNTER_CURRENT_MAX = Number.MAX_SAFE_INTEGER;
export const PROGRESS_COUNTER_TITLE_MAX = 40;
export const PROGRESS_COUNTER_UNIT_MAX = 4;
export const PROGRESS_COUNTER_LOGS_MAX = 40;

export type ProgressCounterPeriod = 'none' | 'week';
export type ProgressCounterPeriodReset = 'auto' | 'manual';

export type ProgressCounterLogEntry = {
  at: string;
  ymd: string;
  delta: number;
  from: number;
  to: number;
};

export type ProgressCounter = {
  id: string;
  title: string;
  target: number;
  current: number;
  unit: string;
  period: ProgressCounterPeriod;
  periodReset: ProgressCounterPeriodReset;
  /** 周周期锚点（周一 YMD） */
  periodKey?: string;
  sinceYmd?: string;
  logs: ProgressCounterLogEntry[];
};

export type ProgressCounterCheck = {
  id: string;
  title: string;
  unit: string;
  target: number;
  current: number;
  period: ProgressCounterPeriod;
  progressCaption: string;
  ratio: number;
  full: boolean;
};

export type ProgressCountersEvaluation = {
  counters: ProgressCounter[];
  checks: ProgressCounterCheck[];
  /** 无计数轨时为 null */
  ratio: number | null;
  full: boolean;
};

type ExtraBag = Record<string, unknown>;

function parseExtraObject(extraData: string | null | undefined): ExtraBag {
  if (!extraData?.trim()) return {};
  try {
    const parsed = JSON.parse(extraData) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as ExtraBag;
    }
  } catch {
    /* ignore */
  }
  return {};
}

function clampInt(raw: unknown, min: number, max: number): number | null {
  let n: number | null = null;
  if (typeof raw === 'number' && Number.isFinite(raw)) n = raw;
  else if (typeof raw === 'string' && raw.trim() !== '') {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) n = parsed;
  }
  if (n == null) return null;
  const rounded = Math.round(n);
  if (rounded < min || rounded > max) return null;
  return rounded;
}

function clampCurrent(raw: unknown): number {
  let n = 0;
  if (typeof raw === 'number' && Number.isFinite(raw)) n = raw;
  else if (typeof raw === 'string' && raw.trim() !== '') {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) n = parsed;
  }
  return Math.min(PROGRESS_COUNTER_CURRENT_MAX, Math.max(0, Math.round(n)));
}

function parsePeriod(raw: unknown): ProgressCounterPeriod {
  return raw === 'week' ? 'week' : 'none';
}

function parsePeriodReset(raw: unknown): ProgressCounterPeriodReset {
  return raw === 'manual' ? 'manual' : 'auto';
}

function parseSinceYmd(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const t = raw.trim();
  return isValidYmd(t) ? t : undefined;
}

function parseLogs(raw: unknown): ProgressCounterLogEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: ProgressCounterLogEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const at = typeof row.at === 'string' ? row.at.trim() : '';
    const ymd = typeof row.ymd === 'string' ? row.ymd.trim() : '';
    if (!at || !isValidYmd(ymd)) continue;
    const from = clampCurrent(row.from);
    const to = clampCurrent(row.to);
    const delta =
      typeof row.delta === 'number' && Number.isFinite(row.delta)
        ? Math.round(row.delta)
        : to - from;
    out.push({ at, ymd, delta, from, to });
    if (out.length >= PROGRESS_COUNTER_LOGS_MAX) break;
  }
  return out;
}

function normalizeUnit(raw: unknown): string {
  if (typeof raw !== 'string') return '次';
  const t = raw.trim().slice(0, PROGRESS_COUNTER_UNIT_MAX);
  return t || '次';
}

function normalizeTitle(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.trim().slice(0, PROGRESS_COUNTER_TITLE_MAX);
}

function serializeCounter(c: ProgressCounter): Record<string, unknown> {
  return {
    id: c.id,
    title: c.title,
    target: c.target,
    current: c.current,
    unit: c.unit,
    period: c.period,
    period_reset: c.periodReset,
    ...(c.periodKey ? { period_key: c.periodKey } : {}),
    ...(c.sinceYmd ? { since_ymd: c.sinceYmd } : {}),
    ...(c.logs.length > 0
      ? {
          logs: c.logs.map((l) => ({
            at: l.at,
            ymd: l.ymd,
            delta: l.delta,
            from: l.from,
            to: l.to,
          })),
        }
      : {}),
  };
}

function normalizeCounterList(raw: unknown): ProgressCounter[] {
  if (!Array.isArray(raw)) return [];
  const byId = new Map<string, ProgressCounter>();
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const idRaw = row.id;
    const id =
      typeof idRaw === 'string' && idRaw.trim()
        ? idRaw.trim()
        : makeTimestampEntityId('pc_', 6);
    const title = normalizeTitle(row.title) || '计数目标';
    const target = clampInt(
      row.target,
      PROGRESS_COUNTER_TARGET_MIN,
      PROGRESS_COUNTER_TARGET_MAX,
    );
    if (target == null) continue;
    const period = parsePeriod(row.period);
    const periodReset = parsePeriodReset(row.period_reset ?? row.periodReset);
    const periodKey = parseSinceYmd(row.period_key ?? row.periodKey);
    const sinceYmd = parseSinceYmd(row.since_ymd ?? row.sinceYmd);
    byId.set(id, {
      id,
      title,
      target,
      current: clampCurrent(row.current),
      unit: normalizeUnit(row.unit),
      period,
      periodReset,
      ...(periodKey ? { periodKey } : {}),
      ...(sinceYmd ? { sinceYmd } : {}),
      logs: parseLogs(row.logs),
    });
  }
  return [...byId.values()];
}

export function createProgressCounterId(): string {
  return makeTimestampEntityId('pc_', 6);
}

export function createEmptyProgressCounter(opts?: {
  title?: string;
  target?: number;
  unit?: string;
  period?: ProgressCounterPeriod;
  periodReset?: ProgressCounterPeriodReset;
  sinceYmd?: string;
}): ProgressCounter {
  const target =
    clampInt(opts?.target ?? 3, PROGRESS_COUNTER_TARGET_MIN, PROGRESS_COUNTER_TARGET_MAX) ?? 3;
  return {
    id: createProgressCounterId(),
    title: normalizeTitle(opts?.title ?? '') || '计数目标',
    target,
    current: 0,
    unit: normalizeUnit(opts?.unit ?? '次'),
    period: opts?.period === 'week' ? 'week' : 'none',
    periodReset: opts?.periodReset === 'manual' ? 'manual' : 'auto',
    ...(opts?.sinceYmd && isValidYmd(opts.sinceYmd) ? { sinceYmd: opts.sinceYmd } : {}),
    logs: [],
  };
}

export function parseProgressCounters(
  extraData: string | null | undefined,
): ProgressCounter[] {
  const extra = parseExtraObject(extraData);
  return normalizeCounterList(extra[PROGRESS_COUNTERS_KEY]);
}

export function mergeProgressCountersIntoExtraData(
  extra: ExtraBag | string | null | undefined,
  counters: readonly ProgressCounter[] | null | undefined,
): ExtraBag {
  const base: ExtraBag =
    typeof extra === 'string' || extra == null
      ? parseExtraObject(typeof extra === 'string' ? extra : null)
      : { ...extra };
  const normalized = normalizeCounterList(
    (counters ?? []).map((c) => serializeCounter(c)),
  );
  if (normalized.length === 0) {
    delete base[PROGRESS_COUNTERS_KEY];
  } else {
    base[PROGRESS_COUNTERS_KEY] = normalized.map(serializeCounter);
  }
  return base;
}

export function mergeProgressCountersIntoExtraDataString(
  extraData: string | null | undefined,
  counters: readonly ProgressCounter[] | null | undefined,
): string | null {
  const next = mergeProgressCountersIntoExtraData(extraData, counters);
  if (Object.keys(next).length === 0) return null;
  return JSON.stringify(next);
}

/** 首次写入 sinceYmd；已有保留 */
export function stampProgressCountersSinceYmd(
  counters: readonly ProgressCounter[],
  sinceYmd: string,
  previous?: readonly ProgressCounter[] | null,
): ProgressCounter[] {
  const anchor = parseSinceYmd(sinceYmd);
  const prevById = new Map((previous ?? []).map((c) => [c.id, c]));
  return counters.map((c) => {
    const prev = prevById.get(c.id);
    const kept = prev?.sinceYmd || c.sinceYmd || anchor;
    return kept ? { ...c, sinceYmd: kept } : { ...c };
  });
}

export type ProgressCountersSaveValidation =
  | { ok: true; counters: ProgressCounter[] }
  | { ok: false; message: string };

export function validateProgressCountersForSave(
  counters: readonly ProgressCounter[],
): ProgressCountersSaveValidation {
  if (counters.length === 0) return { ok: true, counters: [] };
  const seen = new Set<string>();
  const next: ProgressCounter[] = [];
  for (const row of counters) {
    const title = normalizeTitle(row.title) || '计数目标';
    const target = clampInt(
      row.target,
      PROGRESS_COUNTER_TARGET_MIN,
      PROGRESS_COUNTER_TARGET_MAX,
    );
    if (target == null) {
      return {
        ok: false,
        message: `计数目标须为不少于 ${PROGRESS_COUNTER_TARGET_MIN} 的整数。`,
      };
    }
    const id =
      typeof row.id === 'string' && row.id.trim()
        ? row.id.trim()
        : createProgressCounterId();
    if (seen.has(id)) continue;
    seen.add(id);
    next.push({
      id,
      title,
      target,
      current: clampCurrent(row.current),
      unit: normalizeUnit(row.unit),
      period: row.period === 'week' ? 'week' : 'none',
      periodReset: row.periodReset === 'manual' ? 'manual' : 'auto',
      ...(row.periodKey && isValidYmd(row.periodKey) ? { periodKey: row.periodKey } : {}),
      ...(row.sinceYmd && isValidYmd(row.sinceYmd) ? { sinceYmd: row.sinceYmd } : {}),
      logs: Array.isArray(row.logs) ? row.logs.slice(0, PROGRESS_COUNTER_LOGS_MAX) : [],
    });
  }
  return { ok: true, counters: next };
}

/**
 * 按逻辑日解析有效 current（周周期自动跨周清零仅影响返回值，不写库）。
 */
export function resolveCounterForYmd(
  counter: ProgressCounter,
  logicalTodayYmd: string,
): ProgressCounter {
  if (counter.period !== 'week' || !isValidYmd(logicalTodayYmd)) return counter;
  const weekKey = getWeekStartMondayYmd(logicalTodayYmd);
  if (counter.periodKey === weekKey) return counter;
  if (counter.periodReset === 'manual') {
    return { ...counter, periodKey: weekKey };
  }
  return { ...counter, current: 0, periodKey: weekKey, logs: [] };
}

function appendLog(
  logs: ProgressCounterLogEntry[],
  entry: ProgressCounterLogEntry,
): ProgressCounterLogEntry[] {
  const next = [...logs, entry];
  if (next.length <= PROGRESS_COUNTER_LOGS_MAX) return next;
  return next.slice(next.length - PROGRESS_COUNTER_LOGS_MAX);
}

export type ProgressCounterMutateResult = {
  counters: ProgressCounter[];
  changed: ProgressCounter | null;
  /** 是否刚达到满进度 */
  becameFull: boolean;
};

function mutateOne(
  counters: readonly ProgressCounter[],
  counterId: string,
  logicalTodayYmd: string,
  apply: (resolved: ProgressCounter) => { nextCurrent: number; wasFull: boolean },
): ProgressCounterMutateResult {
  const id = counterId.trim();
  let changed: ProgressCounter | null = null;
  let becameFull = false;
  const next = counters.map((c) => {
    if (c.id !== id) return c;
    const resolved = resolveCounterForYmd(c, logicalTodayYmd);
    const beforeFull = resolved.current >= resolved.target && resolved.target > 0;
    const { nextCurrent, wasFull } = apply(resolved);
    const from = resolved.current;
    const to = clampCurrent(nextCurrent);
    if (to === from && resolved.periodKey === c.periodKey) {
      changed = resolved;
      return resolved;
    }
    const entry: ProgressCounterLogEntry = {
      at: formatTaskAuditDatetimeLocal(),
      ymd: logicalTodayYmd,
      delta: to - from,
      from,
      to,
    };
    const updated: ProgressCounter = {
      ...resolved,
      current: to,
      logs: to === from ? resolved.logs : appendLog(resolved.logs, entry),
    };
    changed = updated;
    becameFull = !beforeFull && !wasFull && to >= updated.target && updated.target > 0;
    return updated;
  });
  return { counters: next, changed, becameFull };
}

/** +delta 打卡（可为负，撤销一步也可用） */
export function bumpProgressCounter(
  counters: readonly ProgressCounter[],
  counterId: string,
  delta: number,
  logicalTodayYmd: string,
): ProgressCounterMutateResult {
  const step = Math.round(delta);
  if (!Number.isFinite(step) || step === 0) {
    return { counters: [...counters], changed: null, becameFull: false };
  }
  return mutateOne(counters, counterId, logicalTodayYmd, (resolved) => ({
    nextCurrent: resolved.current + step,
    wasFull: false,
  }));
}

/** 列表快捷：优先给第一条未满的计数 +1；都满则给第一条 +1 */
export function bumpFirstIncompleteProgressCounter(
  counters: readonly ProgressCounter[],
  logicalTodayYmd: string,
  delta = 1,
): ProgressCounterMutateResult {
  if (counters.length === 0) {
    return { counters: [...counters], changed: null, becameFull: false };
  }
  const resolved = counters.map((c) => resolveCounterForYmd(c, logicalTodayYmd));
  const target =
    resolved.find((c) => c.target > 0 && c.current < c.target) ?? resolved[0];
  return bumpProgressCounter(counters, target.id, delta, logicalTodayYmd);
}

/** 快捷设置当前完成量 */
export function setProgressCounterCurrent(
  counters: readonly ProgressCounter[],
  counterId: string,
  nextCurrent: number,
  logicalTodayYmd: string,
): ProgressCounterMutateResult {
  return mutateOne(counters, counterId, logicalTodayYmd, () => ({
    nextCurrent: clampCurrent(nextCurrent),
    wasFull: false,
  }));
}

/** 撤销最近一次变更（按 logs 末条回滚） */
export function undoLastProgressCounterChange(
  counters: readonly ProgressCounter[],
  counterId: string,
  logicalTodayYmd: string,
): ProgressCounterMutateResult {
  const id = counterId.trim();
  let changed: ProgressCounter | null = null;
  const next = counters.map((c) => {
    if (c.id !== id) return c;
    const resolved = resolveCounterForYmd(c, logicalTodayYmd);
    const last = resolved.logs[resolved.logs.length - 1];
    if (!last) {
      changed = resolved;
      return resolved;
    }
    const updated: ProgressCounter = {
      ...resolved,
      current: clampCurrent(last.from),
      logs: resolved.logs.slice(0, -1),
    };
    changed = updated;
    return updated;
  });
  return { counters: next, changed, becameFull: false };
}

function formatCaption(check: {
  current: number;
  target: number;
  unit: string;
  period: ProgressCounterPeriod;
}): string {
  const base = `${check.current}/${check.target} ${check.unit}`;
  if (check.period === 'week') return `${base} · 本周`;
  return base;
}

export function evaluateProgressCounters(
  extraData: string | null | undefined,
  opts?: { logicalTodayYmd?: string },
): ProgressCountersEvaluation {
  const raw = parseProgressCounters(extraData);
  if (raw.length === 0) {
    return { counters: [], checks: [], ratio: null, full: false };
  }
  const ymd = opts?.logicalTodayYmd && isValidYmd(opts.logicalTodayYmd) ? opts.logicalTodayYmd : null;
  const counters = ymd ? raw.map((c) => resolveCounterForYmd(c, ymd)) : raw;
  const checks: ProgressCounterCheck[] = counters.map((c) => {
    const ratio = c.target > 0 ? Math.min(1, c.current / c.target) : 0;
    const full = c.target > 0 && c.current >= c.target;
    return {
      id: c.id,
      title: c.title,
      unit: c.unit,
      target: c.target,
      current: c.current,
      period: c.period,
      progressCaption: formatCaption(c),
      ratio,
      full,
    };
  });
  const usable = checks.filter((c) => c.target > 0);
  if (usable.length === 0) {
    return { counters, checks, ratio: null, full: false };
  }
  const ratio = usable.reduce((s, c) => s + c.ratio, 0) / usable.length;
  const full = usable.every((c) => c.full);
  return {
    counters,
    checks,
    ratio: Math.min(1, ratio),
    full,
  };
}

export function buildProgressCountersPlaceholderEvaluation(
  extraData: string | null | undefined,
): ProgressCountersEvaluation | null {
  const counters = parseProgressCounters(extraData);
  if (counters.length === 0) return null;
  const checks: ProgressCounterCheck[] = counters.map((c) => ({
    id: c.id,
    title: c.title,
    unit: c.unit,
    target: c.target,
    current: 0,
    period: c.period,
    progressCaption: formatCaption({
      current: 0,
      target: c.target,
      unit: c.unit,
      period: c.period,
    }),
    ratio: 0,
    full: false,
  }));
  return { counters, checks, ratio: 0, full: false };
}

export function formatProgressCountersRemainMessage(
  evaluation: ProgressCountersEvaluation,
): string {
  if (evaluation.ratio == null || evaluation.full) return '';
  const parts = evaluation.checks
    .filter((c) => !c.full && c.target > 0)
    .map((c) => {
      const remain = Math.max(0, c.target - c.current);
      const periodHint = c.period === 'week' ? '本周' : '';
      return `${c.title}${periodHint ? `（${periodHint}）` : ''} ${remain}${c.unit}`;
    });
  if (parts.length === 0) return '';
  return `任务已齐，推进进度还差：${parts.join('、')}`;
}

export function formatProgressCountersFullMessage(names: string[]): string {
  const cleaned = names.map((n) => n.trim()).filter(Boolean);
  if (cleaned.length === 0) return '';
  if (cleaned.length === 1) return `「${cleaned[0]}」计数进度已满，可考虑结案`;
  return `${cleaned.map((n) => `「${n}」`).join('、')}计数进度已满，可考虑结案`;
}

/** 习惯轨 + 计数轨合并剩余文案 */
export function formatCombinedProgressRemainMessage(
  habitRemain: string,
  counterRemain: string,
): string {
  const h = habitRemain.trim();
  const c = counterRemain.trim();
  if (!h && !c) return '';
  if (!h) return c;
  if (!c) return h;
  const strip = (s: string) => s.replace(/^任务已齐，推进进度还差：/, '');
  return `任务已齐，推进进度还差：${strip(h)}、${strip(c)}`;
}

/** 习惯轨 + 计数轨是否都满（无轨视为满，不拦截） */
export function isProgressFuelFull(opts: {
  habitRatio: number | null;
  habitFull: boolean;
  counterRatio: number | null;
  counterFull: boolean;
}): boolean {
  const habitOk = opts.habitRatio == null || opts.habitFull;
  const counterOk = opts.counterRatio == null || opts.counterFull;
  return habitOk && counterOk;
}

export function formatTaskCounterIncompleteConfirmMessage(
  evaluation: ProgressCountersEvaluation,
): string {
  if (evaluation.ratio == null || evaluation.full) return '';
  const parts = evaluation.checks
    .filter((c) => !c.full && c.target > 0)
    .map((c) => `${c.title} ${c.current}/${c.target}${c.unit}`);
  if (parts.length === 0) return '';
  return `计数目标尚未完成（${parts.join('、')}）。仍要标记完成吗？`;
}
