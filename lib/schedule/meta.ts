/**
 * 统一 ScheduleMeta：任务/项目 extra_data.schedule 的权威形状与解析。
 * 课表 placement 不走此结构（见 types.ts / schedule-service）。
 */

import type { TaskReminderOption } from '@/lib/task-reminder-schedule';
import type { TaskRepeatOption } from '@/lib/task-repeat-rollover';
import {
  isLogicalDayInYmdRange,
  scheduleDateToYmd,
  toYmd,
} from '@/lib/schedule/ymd';

export type ScheduleMeta = {
  mode?: 'date' | 'time';
  allDay?: boolean;
  hasExactTime?: boolean;
  reminderOption?: TaskReminderOption;
  reminderHour?: number;
  reminderMinute?: number;
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
