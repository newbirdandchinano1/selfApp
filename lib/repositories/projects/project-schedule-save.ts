import type { ScheduleMetaLike } from '@/lib/schedule-inherit';

/** 保存项目前：从截止日期文案补全 schedule.range（防止选择器回传未写入 state） */
export function ensureProjectScheduleMetaForSave(
  scheduleMeta: ScheduleMetaLike | null,
  deadlineText: string,
): ScheduleMetaLike | null {
  const trimmed = deadlineText.trim();
  const dates = trimmed.match(/\d{4}-\d{2}-\d{2}/g);
  const hasRangeInMeta = !!(scheduleMeta?.range?.start?.trim() && scheduleMeta?.range?.end?.trim());

  if (hasRangeInMeta) {
    return {
      ...scheduleMeta,
      mode: scheduleMeta?.mode ?? 'time',
    };
  }

  if (!dates || dates.length < 2) return scheduleMeta;

  const start = dates[0]!;
  const end = dates[dates.length - 1]!;
  if (start === end) return scheduleMeta;

  return {
    mode: 'time',
    allDay: scheduleMeta?.allDay ?? true,
    hasExactTime: scheduleMeta?.hasExactTime ?? false,
    reminderOption: scheduleMeta?.reminderOption ?? '不提前',
    repeatOption: scheduleMeta?.repeatOption ?? '不重复',
    repeatSummary: scheduleMeta?.repeatSummary ?? '',
    weeklyDays: scheduleMeta?.weeklyDays ?? [],
    monthlyDays: scheduleMeta?.monthlyDays ?? [],
    yearlyDate: scheduleMeta?.yearlyDate ?? '',
    ...scheduleMeta,
    range: { start, end },
  };
}
