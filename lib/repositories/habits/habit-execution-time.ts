/**
 * 习惯执行时间段（日程入格用，与 reminder 解耦）。
 * - 默认全天：不入日程表
 * - 指定时间段：按起止入格
 * - 旧数据：仅有 hour/minute、或曾开提醒无字段 → 回退为「开始 + 默认 30 分钟」
 */

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export type HabitExecutionTime =
  | { allDay: true }
  | {
      allDay: false;
      startHour: number;
      startMinute: number;
      endHour: number;
      endMinute: number;
    };

export type HabitExecutionTimeWrite = HabitExecutionTime;

const DEFAULT_START_HOUR = 8;
const DEFAULT_START_MINUTE = 0;
const DEFAULT_SPAN_MINUTES = 30;

function clampHour(raw: unknown, fallback = DEFAULT_START_HOUR): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return Math.max(0, Math.min(23, Math.round(raw)));
  }
  return fallback;
}

function clampMinute(raw: unknown, fallback = DEFAULT_START_MINUTE): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return Math.max(0, Math.min(59, Math.round(raw)));
  }
  return fallback;
}

function toMinutes(hour: number, minute: number): number {
  return hour * 60 + minute;
}

function fromMinutes(total: number): { hour: number; minute: number } {
  const capped = Math.max(0, Math.min(23 * 60 + 59, Math.round(total)));
  return { hour: Math.floor(capped / 60), minute: capped % 60 };
}

/** 保证 end > start；跨日不允许，最多推到 23:59。 */
export function normalizeHabitExecutionRange(input: {
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
}): Extract<HabitExecutionTime, { allDay: false }> {
  const startHour = clampHour(input.startHour);
  const startMinute = clampMinute(input.startMinute);
  let endHour = clampHour(input.endHour);
  let endMinute = clampMinute(input.endMinute);
  const start = toMinutes(startHour, startMinute);
  let end = toMinutes(endHour, endMinute);
  if (!(end > start)) {
    const bumped = fromMinutes(Math.min(start + DEFAULT_SPAN_MINUTES, 23 * 60 + 59));
    endHour = bumped.hour;
    endMinute = bumped.minute;
    end = toMinutes(endHour, endMinute);
    if (!(end > start)) {
      const last = fromMinutes(Math.min(start + 1, 23 * 60 + 59));
      endHour = last.hour;
      endMinute = last.minute;
    }
  }
  return { allDay: false, startHour, startMinute, endHour, endMinute };
}

function rangeFromStart(hour: number, minute: number): Extract<HabitExecutionTime, { allDay: false }> {
  const start = toMinutes(clampHour(hour), clampMinute(minute));
  const end = fromMinutes(Math.min(start + DEFAULT_SPAN_MINUTES, 23 * 60 + 59));
  return normalizeHabitExecutionRange({
    startHour: clampHour(hour),
    startMinute: clampMinute(minute),
    endHour: end.hour,
    endMinute: end.minute,
  });
}

function parseLegacyFromReminder(extraData: string): HabitExecutionTime | null {
  try {
    const p = JSON.parse(extraData) as { reminder?: unknown };
    const r = p?.reminder;
    if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
    if ((r as { enabled?: unknown }).enabled !== true) return null;
    return rangeFromStart(
      clampHour((r as { hour?: unknown }).hour),
      clampMinute((r as { minute?: unknown }).minute),
    );
  } catch {
    return null;
  }
}

/** 读 `extra_data.executionTime`；缺省全天（不入格）。 */
export function parseHabitExecutionTime(extraData: string | null): HabitExecutionTime {
  if (!extraData) return { allDay: true };
  try {
    const p = JSON.parse(extraData) as { executionTime?: unknown };
    const et = p?.executionTime;
    if (et && typeof et === 'object' && !Array.isArray(et)) {
      const allDay = (et as { allDay?: unknown }).allDay;
      if (allDay === true || allDay === 1 || allDay === 'true') {
        return { allDay: true };
      }
      if (allDay === false || allDay === 0 || allDay === 'false') {
        const hasRange =
          'startHour' in (et as object) ||
          'endHour' in (et as object) ||
          'startMinute' in (et as object) ||
          'endMinute' in (et as object);
        if (hasRange) {
          return normalizeHabitExecutionRange({
            startHour: clampHour((et as { startHour?: unknown }).startHour),
            startMinute: clampMinute((et as { startMinute?: unknown }).startMinute),
            endHour: clampHour((et as { endHour?: unknown }).endHour, DEFAULT_START_HOUR),
            endMinute: clampMinute((et as { endMinute?: unknown }).endMinute, DEFAULT_SPAN_MINUTES),
          });
        }
        // 短暂过渡：仅 hour/minute 的旧定点写法 → 时间段
        if ('hour' in (et as object) || 'minute' in (et as object)) {
          return rangeFromStart(
            clampHour((et as { hour?: unknown }).hour),
            clampMinute((et as { minute?: unknown }).minute),
          );
        }
      }
    }
  } catch {
    /* fall through */
  }
  return parseLegacyFromReminder(extraData) ?? { allDay: true };
}

/** 是否指定了时间段（非全天）——仅此类才入日程表。 */
export function habitHasTimedExecution(extraData: string | null): boolean {
  return !parseHabitExecutionTime(extraData).allDay;
}

export function formatHabitExecutionTimeLabel(meta: HabitExecutionTime): string {
  if (meta.allDay) return '全天';
  return `${pad2(meta.startHour)}:${pad2(meta.startMinute)}–${pad2(meta.endHour)}:${pad2(meta.endMinute)}`;
}

/** 写回习惯 `extra_data.executionTime`。 */
export function mergeHabitExecutionTimeIntoExtraData(
  extraData: string | null,
  executionTime: HabitExecutionTimeWrite,
): string {
  let base: Record<string, unknown> = {};
  if (extraData) {
    try {
      const p = JSON.parse(extraData) as unknown;
      if (p && typeof p === 'object' && !Array.isArray(p)) {
        base = { ...(p as Record<string, unknown>) };
      }
    } catch {
      base = {};
    }
  }
  if (executionTime.allDay) {
    base.executionTime = { allDay: true };
  } else {
    const range = normalizeHabitExecutionRange(executionTime);
    base.executionTime = {
      allDay: false,
      startHour: range.startHour,
      startMinute: range.startMinute,
      endHour: range.endHour,
      endMinute: range.endMinute,
    };
  }
  return JSON.stringify(base);
}
