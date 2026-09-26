/**
 * 日程选择器结果 → 展示文案 + meta。
 * 各 add/edit 页原先各自抄一份 formatDate / setDeadlineText 逻辑，统一走这里。
 */

import {
  applyScheduleMetaToLabels,
  clampScheduleMetaToDateLimit,
  dueDateFromScheduleMeta,
  hasDateLimitBounds,
  type DateLimitYmd,
  type ScheduleMetaLike,
} from '@/lib/schedule-inherit';
import {
  pickedScheduleToMeta,
  type PickedScheduleMeta,
  type SchedulePickerResult,
} from '@/lib/schedule-picker-bridge';

export type ComposerScheduleLabels = {
  deadlineText: string;
  reminderText: string;
  repeatText: string;
  scheduleMeta: PickedScheduleMeta | null;
};

export const EMPTY_COMPOSER_SCHEDULE_LABELS: ComposerScheduleLabels = {
  deadlineText: '',
  reminderText: '',
  repeatText: '',
  scheduleMeta: null,
};

function toPickedMeta(schedule: ScheduleMetaLike): PickedScheduleMeta {
  return {
    mode: schedule.mode === 'time' ? 'time' : 'date',
    allDay: schedule.allDay ?? true,
    hasExactTime: schedule.hasExactTime ?? false,
    reminderOption: schedule.reminderOption ?? '不提前',
    reminderHour: schedule.reminderHour,
    reminderMinute: schedule.reminderMinute,
    repeatOption: (schedule.repeatOption as PickedScheduleMeta['repeatOption']) ?? '不重复',
    repeatSummary: schedule.repeatSummary ?? '不重复',
    weeklyDays: schedule.weeklyDays ?? [],
    monthlyDays: schedule.monthlyDays ?? [],
    yearlyDate: schedule.yearlyDate ?? '',
    date: schedule.date,
    range: schedule.range,
    startTime: schedule.startTime ?? '',
    endTime: schedule.endTime ?? '',
  };
}

/** 可选：将日程钳制到 dateLimit 后再生成标签 */
export function labelsFromScheduleMeta(
  schedule: ScheduleMetaLike | null | undefined,
  dateLimit?: DateLimitYmd | null,
): ComposerScheduleLabels {
  if (!schedule) return EMPTY_COMPOSER_SCHEDULE_LABELS;

  let next: ScheduleMetaLike = schedule;
  if (dateLimit && hasDateLimitBounds(dateLimit)) {
    const fallbackDue = dueDateFromScheduleMeta(schedule, null);
    const clamped = clampScheduleMetaToDateLimit(schedule, fallbackDue, dateLimit);
    if (clamped.schedule) next = clamped.schedule;
  }

  const applied = applyScheduleMetaToLabels(next);
  return {
    deadlineText: applied.deadlineText,
    reminderText: applied.reminderText,
    repeatText: applied.repeatText,
    scheduleMeta: toPickedMeta(applied.scheduleMeta),
  };
}

export function labelsFromPickerResult(
  picked: SchedulePickerResult,
  dateLimit?: DateLimitYmd | null,
): ComposerScheduleLabels {
  return labelsFromScheduleMeta(pickedScheduleToMeta(picked), dateLimit);
}
