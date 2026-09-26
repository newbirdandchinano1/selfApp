import {
  dueDateFromScheduleMeta,
  type DateLimitYmd,
  type ScheduleMetaLike,
} from '@/lib/schedule-inherit';
import {
  consumeSchedulePickerResult,
  type PickedScheduleMeta,
  type SchedulePickerInitPayload,
  type SchedulePickerResult,
} from '@/lib/schedule-picker-bridge';
import { useFocusEffect, useRouter } from 'expo-router';
import React from 'react';

import {
  EMPTY_COMPOSER_SCHEDULE_LABELS,
  labelsFromPickerResult,
  labelsFromScheduleMeta,
  type ComposerScheduleLabels,
} from './schedule-labels';
import { extractDueDateFromDeadlineText } from './validation';

export type UseComposerScheduleOptions = {
  source: string;
  dateLimit?: DateLimitYmd | null;
  /** 继承父级日程时禁用打开选择器与消费结果 */
  locked?: boolean;
  /**
   * 消费选择器结果后的副作用（如独立待办「今天」自动提优先级）。
   * 在状态已写入后调用。
   */
  onPicked?: (picked: SchedulePickerResult, labels: ComposerScheduleLabels) => void;
  /** 默认 true：mount / focus 时自动 consume */
  autoConsume?: boolean;
};

export type ComposerScheduleApi = ComposerScheduleLabels & {
  setDeadlineText: React.Dispatch<React.SetStateAction<string>>;
  setReminderText: React.Dispatch<React.SetStateAction<string>>;
  setRepeatText: React.Dispatch<React.SetStateAction<string>>;
  setScheduleMeta: React.Dispatch<React.SetStateAction<PickedScheduleMeta | null>>;
  /** 用已有 meta / 继承默认值灌入表单（会按 dateLimit 钳制） */
  applySchedule: (schedule: ScheduleMetaLike | null | undefined) => void;
  clearSchedule: () => void;
  /** @returns 是否消费到了选择器结果 */
  readScheduleResult: () => boolean;
  openSchedulePicker: () => void;
  /** due_date 候选：优先 meta，否则从 deadlineText 抽日期 */
  resolveDueDate: () => string | null;
};

/**
 * Composer 族表单共用的日程字段状态 + 选择器读写。
 */
export function useComposerSchedule(options: UseComposerScheduleOptions): ComposerScheduleApi {
  const { source, dateLimit = null, locked = false, onPicked, autoConsume = true } = options;
  const router = useRouter();

  const [deadlineText, setDeadlineText] = React.useState('');
  const [reminderText, setReminderText] = React.useState('');
  const [repeatText, setRepeatText] = React.useState('');
  const [scheduleMeta, setScheduleMeta] = React.useState<PickedScheduleMeta | null>(null);

  const onPickedRef = React.useRef(onPicked);
  onPickedRef.current = onPicked;

  const applyLabels = React.useCallback((labels: ComposerScheduleLabels) => {
    setDeadlineText(labels.deadlineText);
    setReminderText(labels.reminderText);
    setRepeatText(labels.repeatText);
    setScheduleMeta(labels.scheduleMeta);
  }, []);

  const applySchedule = React.useCallback(
    (schedule: ScheduleMetaLike | null | undefined) => {
      applyLabels(labelsFromScheduleMeta(schedule, dateLimit));
    },
    [applyLabels, dateLimit],
  );

  const clearSchedule = React.useCallback(() => {
    applyLabels(EMPTY_COMPOSER_SCHEDULE_LABELS);
  }, [applyLabels]);

  const readScheduleResult = React.useCallback((): boolean => {
    if (locked) return false;
    const picked = consumeSchedulePickerResult(source);
    if (!picked) return false;
    const labels = labelsFromPickerResult(picked, dateLimit);
    applyLabels(labels);
    onPickedRef.current?.(picked, labels);
    return true;
  }, [applyLabels, dateLimit, locked, source]);

  const openSchedulePicker = React.useCallback(() => {
    if (locked) return;
    const scheduleInit: SchedulePickerInitPayload | undefined = scheduleMeta
      ? {
          mode: scheduleMeta.mode,
          quickChip: '',
          allDay: scheduleMeta.allDay,
          hasExactTime: scheduleMeta.hasExactTime,
          reminderOption: scheduleMeta.reminderOption,
          reminderHour: scheduleMeta.reminderHour,
          reminderMinute: scheduleMeta.reminderMinute,
          repeatOption: scheduleMeta.repeatOption,
          repeatSummary: scheduleMeta.repeatSummary,
          weeklyDays: scheduleMeta.weeklyDays,
          monthlyDays: scheduleMeta.monthlyDays,
          yearlyDate: scheduleMeta.yearlyDate,
          date: scheduleMeta.date,
          range: scheduleMeta.range,
          startTime: scheduleMeta.startTime,
          endTime: scheduleMeta.endTime,
        }
      : undefined;
    router.push({
      pathname: '/schedule-picker',
      params: {
        source,
        initial: scheduleInit ? JSON.stringify(scheduleInit) : '',
        dateLimit: dateLimit ? JSON.stringify(dateLimit) : '',
      },
    });
  }, [dateLimit, locked, router, scheduleMeta, source]);

  const resolveDueDate = React.useCallback(
    () => dueDateFromScheduleMeta(scheduleMeta, extractDueDateFromDeadlineText(deadlineText)),
    [deadlineText, scheduleMeta],
  );

  React.useEffect(() => {
    if (!autoConsume) return;
    readScheduleResult();
  }, [autoConsume, readScheduleResult]);

  useFocusEffect(
    React.useCallback(() => {
      if (!autoConsume) return;
      readScheduleResult();
    }, [autoConsume, readScheduleResult]),
  );

  return {
    deadlineText,
    reminderText,
    repeatText,
    scheduleMeta,
    setDeadlineText,
    setReminderText,
    setRepeatText,
    setScheduleMeta,
    applySchedule,
    clearSchedule,
    readScheduleResult,
    openSchedulePicker,
    resolveDueDate,
  };
}
