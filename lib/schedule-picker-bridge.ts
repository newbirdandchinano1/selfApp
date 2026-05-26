/** 日程选择器回传：用模块内 pending 传递，避免 globalThis 在路由切换时丢失 */

import type { TaskReminderOption } from '@/lib/task-reminder-schedule';

export type SchedulePickerReminderOption = TaskReminderOption;
export type SchedulePickerRepeatOption = '不重复' | '每天' | '每周' | '每月' | '每年';

export type SchedulePickerResult = {
  mode: 'date' | 'time';
  source: string;
  quickChip: string;
  allDay: boolean;
  hasExactTime: boolean;
  reminderOption: SchedulePickerReminderOption;
  /** 提醒触发的本地时刻；仅当 reminderOption !== '不提前' 时有效 */
  reminderHour?: number;
  reminderMinute?: number;
  repeatOption: SchedulePickerRepeatOption;
  repeatSummary: string;
  weeklyDays: number[];
  monthlyDays: number[];
  yearlyDate: string;
  date?: string;
  range?: { start: string; end: string };
  startTime: string;
  endTime: string;
};

let pending: SchedulePickerResult | null = null;

export function normalizeRouteParam(value: string | string[] | undefined | null): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return '';
}

export function setSchedulePickerResult(result: SchedulePickerResult) {
  pending = { ...result, source: normalizeRouteParam(result.source) };
}

export function consumeSchedulePickerResult(expectedSource: string): SchedulePickerResult | null {
  if (!pending) return null;
  const expected = normalizeRouteParam(expectedSource);
  if (pending.source !== expected) return null;
  const next = pending;
  pending = null;
  return next;
}
