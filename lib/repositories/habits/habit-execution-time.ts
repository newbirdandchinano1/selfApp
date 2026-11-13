/**
 * 习惯执行时间段（日程入格用，与 reminder 解耦）。
 * - 默认全天：不入日程表
 * - 指定时间段：按起止入格；可跨自然日午夜，但须落在任务日界的同一逻辑日内
 * - 旧数据：仅有 hour/minute、或曾开提醒无字段 → 回退为「开始 + 默认 30 分钟」
 */

import {
  SCHEDULE_DAY_END_MAX_MINUTES,
  formatScheduleAxisTimeLabel,
  scheduleDayStartMinutesFromDayBoundary,
  scheduleEndMinutesFromDayBoundary,
} from '@/lib/schedule/axis';
import {
  DEFAULT_TASKS_DAY_BOUNDARY,
  getDayBoundarySync,
  type TasksDayBoundary,
} from '@/lib/tasks-logical-day';

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

function resolveBoundary(boundary?: TasksDayBoundary): TasksDayBoundary {
  if (boundary) {
    return {
      hour: Math.max(0, Math.min(23, Math.round(boundary.hour))),
      minute: Math.max(0, Math.min(59, Math.round(boundary.minute))),
    };
  }
  return getDayBoundarySync() ?? { ...DEFAULT_TASKS_DAY_BOUNDARY };
}

/**
 * 墙钟时分 → 逻辑日轴分钟（可 ≥1440）。
 * 日界 H:MM 时，墙钟 < 日界视为逻辑日「次日」尾段。
 */
export function wallHmToHabitLogicalMinutes(
  hour: number,
  minute: number,
  boundary: TasksDayBoundary = getDayBoundarySync(),
): number {
  const h = clampHour(hour);
  const m = clampMinute(minute);
  const wall = h * 60 + m;
  const boundaryMins = scheduleDayStartMinutesFromDayBoundary(boundary);
  if (boundaryMins > 0 && wall < boundaryMins) {
    return wall + SCHEDULE_DAY_END_MAX_MINUTES;
  }
  return wall;
}

/** 逻辑日轴分钟 → 墙钟时分（用于存库；>1440 仍还原为 0–23 点） */
export function habitLogicalMinutesToWallHm(totalMinutes: number): {
  hour: number;
  minute: number;
} {
  const dayEndCap = SCHEDULE_DAY_END_MAX_MINUTES + 23 * 60;
  const capped = Math.max(0, Math.min(dayEndCap, Math.round(totalMinutes)));
  const wall =
    ((capped % SCHEDULE_DAY_END_MAX_MINUTES) + SCHEDULE_DAY_END_MAX_MINUTES) %
    SCHEDULE_DAY_END_MAX_MINUTES;
  return { hour: Math.floor(wall / 60), minute: wall % 60 };
}

/**
 * 保证逻辑日轴分钟 end > start；允许跨自然日午夜，终点不超过日界上限。
 * 例：日界 04:00 时 22:00–02:00 合法；日界 00:00 时仍禁止跨午夜。
 */
export function normalizeHabitExecutionRange(
  input: {
    startHour: number;
    startMinute: number;
    endHour: number;
    endMinute: number;
  },
  boundary?: TasksDayBoundary,
): Extract<HabitExecutionTime, { allDay: false }> {
  const b = resolveBoundary(boundary);
  const startHour = clampHour(input.startHour);
  const startMinute = clampMinute(input.startMinute);
  const endHourIn = clampHour(input.endHour);
  const endMinuteIn = clampMinute(input.endMinute);

  const start = wallHmToHabitLogicalMinutes(startHour, startMinute, b);
  let end = wallHmToHabitLogicalMinutes(endHourIn, endMinuteIn, b);
  const dayEnd = scheduleEndMinutesFromDayBoundary(b);

  // 同日墙钟 end≤start，且日界允许跨午夜：尝试把 end 解为次日晨
  if (!(end > start) && dayEnd > SCHEDULE_DAY_END_MAX_MINUTES) {
    const endWall = endHourIn * 60 + endMinuteIn;
    const asNext = endWall + SCHEDULE_DAY_END_MAX_MINUTES;
    if (asNext > start && asNext <= dayEnd) {
      end = asNext;
    }
  }

  if (end > dayEnd) end = dayEnd;

  if (!(end > start)) {
    end = Math.min(start + DEFAULT_SPAN_MINUTES, dayEnd);
    if (!(end > start)) {
      end = Math.min(start + 1, dayEnd);
    }
    // 贴近逻辑日尽头仍无法抬高结束：回退同日墙钟 +30min（日界 0:00 的 23:xx）
    if (!(end > start)) {
      const fallbackTotal = Math.min(start + DEFAULT_SPAN_MINUTES, 23 * 60 + 59);
      const fb = habitLogicalMinutesToWallHm(fallbackTotal);
      return {
        allDay: false,
        startHour,
        startMinute,
        endHour: fb.hour,
        endMinute: fb.minute,
      };
    }
  }

  const startWall = habitLogicalMinutesToWallHm(start);
  const endWall = habitLogicalMinutesToWallHm(end);
  return {
    allDay: false,
    startHour: startWall.hour,
    startMinute: startWall.minute,
    endHour: endWall.hour,
    endMinute: endWall.minute,
  };
}

function rangeFromStart(
  hour: number,
  minute: number,
  boundary?: TasksDayBoundary,
): Extract<HabitExecutionTime, { allDay: false }> {
  const b = resolveBoundary(boundary);
  const startHour = clampHour(hour);
  const startMinute = clampMinute(minute);
  const start = wallHmToHabitLogicalMinutes(startHour, startMinute, b);
  const dayEnd = scheduleEndMinutesFromDayBoundary(b);
  const end = Math.min(start + DEFAULT_SPAN_MINUTES, dayEnd);
  const endWall = habitLogicalMinutesToWallHm(end > start ? end : Math.min(start + 1, dayEnd));
  return normalizeHabitExecutionRange(
    {
      startHour,
      startMinute,
      endHour: endWall.hour,
      endMinute: endWall.minute,
    },
    b,
  );
}

function parseLegacyFromReminder(
  extraData: string,
  boundary?: TasksDayBoundary,
): HabitExecutionTime | null {
  try {
    const p = JSON.parse(extraData) as { reminder?: unknown };
    const r = p?.reminder;
    if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
    if ((r as { enabled?: unknown }).enabled !== true) return null;
    return rangeFromStart(
      clampHour((r as { hour?: unknown }).hour),
      clampMinute((r as { minute?: unknown }).minute),
      boundary,
    );
  } catch {
    return null;
  }
}

/** 读 `extra_data.executionTime`；缺省全天（不入格）。 */
export function parseHabitExecutionTime(
  extraData: string | null,
  boundary?: TasksDayBoundary,
): HabitExecutionTime {
  const b = resolveBoundary(boundary);
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
          return normalizeHabitExecutionRange(
            {
              startHour: clampHour((et as { startHour?: unknown }).startHour),
              startMinute: clampMinute((et as { startMinute?: unknown }).startMinute),
              endHour: clampHour((et as { endHour?: unknown }).endHour, DEFAULT_START_HOUR),
              endMinute: clampMinute((et as { endMinute?: unknown }).endMinute, DEFAULT_SPAN_MINUTES),
            },
            b,
          );
        }
        // 短暂过渡：仅 hour/minute 的旧定点写法 → 时间段
        if ('hour' in (et as object) || 'minute' in (et as object)) {
          return rangeFromStart(
            clampHour((et as { hour?: unknown }).hour),
            clampMinute((et as { minute?: unknown }).minute),
            b,
          );
        }
      }
    }
  } catch {
    /* fall through */
  }
  return parseLegacyFromReminder(extraData, b) ?? { allDay: true };
}

/** 是否指定了时间段（非全天）——仅此类才入日程表。 */
export function habitHasTimedExecution(extraData: string | null): boolean {
  return !parseHabitExecutionTime(extraData).allDay;
}

export function formatHabitExecutionTimeLabel(
  meta: HabitExecutionTime,
  boundary?: TasksDayBoundary,
): string {
  if (meta.allDay) return '全天';
  const b = resolveBoundary(boundary);
  const start = wallHmToHabitLogicalMinutes(meta.startHour, meta.startMinute, b);
  let endAxis = wallHmToHabitLogicalMinutes(meta.endHour, meta.endMinute, b);
  // 存库墙钟在 end<start 且允许跨午夜时，format 前应已 normalize；此处再兜底次日
  if (!(endAxis > start)) {
    const dayEnd = scheduleEndMinutesFromDayBoundary(b);
    const asNext = meta.endHour * 60 + meta.endMinute + SCHEDULE_DAY_END_MAX_MINUTES;
    if (dayEnd > SCHEDULE_DAY_END_MAX_MINUTES && asNext > start && asNext <= dayEnd) {
      endAxis = asNext;
    }
  }
  return `${formatScheduleAxisTimeLabel(start)}–${formatScheduleAxisTimeLabel(endAxis)}`;
}

/** 墙钟时刻展示（开始/结束行）；落在日界「次日」尾段时带次日前缀 */
export function formatHabitExecutionHmLabel(
  hour: number,
  minute: number,
  boundary?: TasksDayBoundary,
): string {
  const b = resolveBoundary(boundary);
  return formatScheduleAxisTimeLabel(wallHmToHabitLogicalMinutes(hour, minute, b));
}

/** 写回习惯 `extra_data.executionTime`。 */
export function mergeHabitExecutionTimeIntoExtraData(
  extraData: string | null,
  executionTime: HabitExecutionTimeWrite,
  boundary?: TasksDayBoundary,
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
    const range = normalizeHabitExecutionRange(executionTime, boundary);
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
