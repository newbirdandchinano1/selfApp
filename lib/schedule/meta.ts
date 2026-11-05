/**
 * 统一 ScheduleMeta：任务/项目 extra_data.schedule 的权威形状与解析。
 * 课表 placement 不走此结构（见 types.ts / schedule-service）。
 */

import { formatStoredDatetimeHm, parseStoredDatetime } from '@/lib/api-mysql-datetime';
import type { TaskReminderOption } from '@/lib/task-reminder-schedule';
import type { TaskRepeatOption } from '@/lib/task-repeat-rollover';
import {
  isLogicalDayInYmdRange,
  scheduleDateToYmd,
  toYmd,
} from '@/lib/schedule/ymd';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * 日程起止时刻 → 本地墙钟 ISO 形（无 Z）。
 * 禁止 toISOString()：东八区 12:00 会写成 04:00Z，同步后再读就变成 4 点。
 */
export function formatScheduleLocalDateTime(date: Date): string {
  const y = date.getFullYear();
  const mo = pad2(date.getMonth() + 1);
  const d = pad2(date.getDate());
  const h = pad2(date.getHours());
  const mi = pad2(date.getMinutes());
  const s = pad2(date.getSeconds());
  return `${y}-${mo}-${d}T${h}:${mi}:${s}`;
}

/** 展示用 HH:mm；兼容旧 Z/UTC 串与 naive 墙钟 */
export function formatScheduleTimeHm(value: string | null | undefined): string {
  const raw = (value ?? '').trim();
  if (!raw) return '';
  return formatStoredDatetimeHm(raw);
}

/** 从 schedule.startTime / endTime 解析本地时分 */
export function parseScheduleTimeHm(
  value: string | null | undefined,
): { hour: number; minute: number } | null {
  const raw = (value ?? '').trim();
  if (!raw) return null;
  const d = parseStoredDatetime(raw);
  if (Number.isNaN(d.getTime())) return null;
  return { hour: d.getHours(), minute: d.getMinutes() };
}

export type ScheduleMeta = {
  mode?: 'date' | 'time';
  allDay?: boolean;
  hasExactTime?: boolean;
  reminderOption?: TaskReminderOption;
  reminderHour?: number;
  reminderMinute?: number;
  /**
   * 入格开始前提前量覆盖（分钟，5–60）。
   * 缺省用通知中心分类型默认（待办/项目）。
   */
  advanceMinutesOverride?: number;
  repeatOption?: TaskRepeatOption;
  repeatSummary?: string;
  weeklyDays?: number[];
  monthlyDays?: number[];
  yearlyDate?: string;
  date?: string;
  range?: { start: string; end: string };
  startTime?: string;
  endTime?: string;
};

/** @deprecated 使用 ScheduleMeta；保留别名以免大面积改导入 */
export type ScheduleMetaLike = ScheduleMeta;

/** 仅日期边界（过期/可见性判断用，不要求完整提醒字段） */
export type ScheduleDateBounds = {
  mode?: 'date' | 'time';
  date?: string;
  range?: { start: string; end: string };
};

export type ScheduleYmdBounds = {
  startYmd: string | null;
  endYmd: string | null;
  isRange: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** 从 extra_data JSON 解析 schedule 对象；非法则 null */
export function parseScheduleMetaFromExtra(extraData: string | null | undefined): ScheduleMeta | null {
  if (!extraData) return null;
  try {
    const parsed = JSON.parse(extraData) as unknown;
    if (!isRecord(parsed)) return null;
    const schedule = parsed.schedule;
    if (!isRecord(schedule)) return null;
    return schedule as ScheduleMeta;
  } catch {
    return null;
  }
}

/** @deprecated 使用 parseScheduleMetaFromExtra */
export const parseProjectSchedule = parseScheduleMetaFromExtra;

export function hasScheduleRange(
  schedule: ScheduleDateBounds | null | undefined,
): schedule is ScheduleDateBounds & { range: { start: string; end: string } } {
  return !!(schedule?.range?.start?.trim() && schedule?.range?.end?.trim());
}

export function scheduleMetaToYmdBounds(
  schedule: ScheduleDateBounds | null | undefined,
  fallbackDue?: string | null,
): ScheduleYmdBounds {
  if (hasScheduleRange(schedule)) {
    return {
      startYmd: scheduleDateToYmd(schedule.range.start),
      endYmd: scheduleDateToYmd(schedule.range.end),
      isRange: true,
    };
  }
  if (schedule?.date) {
    const d = scheduleDateToYmd(schedule.date);
    return { startYmd: d, endYmd: d, isRange: false };
  }
  const due = fallbackDue?.trim() ? scheduleDateToYmd(fallbackDue) : null;
  if (due) return { startYmd: due, endYmd: due, isRange: false };
  return { startYmd: null, endYmd: null, isRange: false };
}

export function scheduleMetaHasConcreteDates(
  schedule: ScheduleMeta | null | undefined,
): boolean {
  if (!schedule) return false;
  if (schedule.mode === 'time' && schedule.range?.start?.trim() && schedule.range?.end?.trim()) {
    return true;
  }
  return !!schedule.date?.trim();
}

/** 日程区间是否覆盖逻辑日（与独立待办可见性一致） */
export function isLogicalDayCoveredBySchedule(
  logicalYmd: string,
  schedule: ScheduleDateBounds | null | undefined,
): boolean {
  if (!schedule) return true;
  if (hasScheduleRange(schedule)) {
    return isLogicalDayInYmdRange(
      logicalYmd,
      scheduleDateToYmd(schedule.range.start),
      scheduleDateToYmd(schedule.range.end),
    );
  }
  if (schedule.date) {
    return logicalYmd === scheduleDateToYmd(schedule.date);
  }
  return true;
}

export function dueDateFromScheduleMeta(
  schedule: ScheduleMeta | null | undefined,
  fallbackDue: string | null | undefined,
): string | null {
  if (schedule?.mode === 'time' && schedule.range?.end) return toYmd(schedule.range.end);
  if (schedule?.date) return toYmd(schedule.date);
  if (fallbackDue) return toYmd(fallbackDue);
  return null;
}
