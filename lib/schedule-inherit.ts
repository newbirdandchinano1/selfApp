import { formatTaskReminderLabel, type TaskReminderOption } from '@/lib/task-reminder-schedule';

/** 父任务 / 项目 → 子任务的时间继承与 dateLimit 计算 */

export type DateLimitYmd = {
  start?: string;
  end?: string;
};

export type ScheduleMetaLike = {
  mode?: 'date' | 'time';
  allDay?: boolean;
  hasExactTime?: boolean;
  reminderOption?: TaskReminderOption;
  reminderHour?: number;
  reminderMinute?: number;
  repeatOption?: '不重复' | '每天' | '每周' | '每月' | '每年';
  repeatSummary?: string;
  weeklyDays?: number[];
  monthlyDays?: number[];
  yearlyDate?: string;
  date?: string;
  range?: { start: string; end: string };
  startTime?: string;
  endTime?: string;
};

export function toYmd(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** 取父级与项目限制的交集（更紧的窗口） */
export function mergeDateLimit(base: DateLimitYmd, incoming: DateLimitYmd): DateLimitYmd {
  const next: DateLimitYmd = { ...base };
  if (incoming.start) {
    next.start = next.start ? (incoming.start > next.start ? incoming.start : next.start) : incoming.start;
  }
  if (incoming.end) {
    next.end = next.end ? (incoming.end < next.end ? incoming.end : next.end) : incoming.end;
  }
  if (next.start && next.end && next.start > next.end) {
    return { start: next.start, end: next.start };
  }
  return next;
}

export function scheduleMetaToDateLimit(schedule: ScheduleMetaLike | null | undefined): DateLimitYmd {
  if (!schedule) return {};
  if (schedule.mode === 'time' && schedule.range?.start && schedule.range?.end) {
    const start = toYmd(schedule.range.start);
    const end = toYmd(schedule.range.end);
    return {
      start: start ?? undefined,
      end: end ?? undefined,
    };
  }
  if (schedule.date) {
    const date = toYmd(schedule.date);
    return {
      start: date ?? undefined,
      end: date ?? undefined,
    };
  }
  return {};
}

export function extractScheduleLimitFromExtra(
  extraDataRaw: string | null,
  dueDate?: string | null,
): DateLimitYmd {
  let schedule: ScheduleMetaLike | null = null;
  if (extraDataRaw) {
    try {
      const parsed = JSON.parse(extraDataRaw) as { schedule?: ScheduleMetaLike };
      if (parsed?.schedule && typeof parsed.schedule === 'object') {
        schedule = parsed.schedule;
      }
    } catch {
      /* ignore */
    }
  }
  return mergeDateLimit(scheduleMetaToDateLimit(schedule), {
    end: dueDate ? (toYmd(dueDate) ?? undefined) : undefined,
  });
}

export function parseDateLimitParam(raw: string | undefined): DateLimitYmd | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as DateLimitYmd;
    if (!parsed || typeof parsed !== 'object') return null;
    const next: DateLimitYmd = {};
    if (typeof parsed.start === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsed.start)) next.start = parsed.start;
    if (typeof parsed.end === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsed.end)) next.end = parsed.end;
    return next.start || next.end ? next : null;
  } catch {
    return null;
  }
}

export function parseDefaultScheduleParam(raw: string | undefined): ScheduleMetaLike | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ScheduleMetaLike;
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.mode === 'time' && parsed.range?.start && parsed.range?.end) return parsed;
    if (parsed.date) return parsed;
    return null;
  } catch {
    return null;
  }
}

/** 仅有 dateLimit、无完整 schedule 时，合成可传给子级的默认日程 */
export function scheduleMetaFromDateLimit(limit: DateLimitYmd | null): ScheduleMetaLike | null {
  if (!limit) return null;
  const start = limit.start;
  const end = limit.end;
  if (start && end && start !== end) {
    return {
      mode: 'time',
      allDay: true,
      hasExactTime: false,
      reminderOption: '不提前',
      repeatOption: '不重复',
      repeatSummary: '不重复',
      weeklyDays: [],
      monthlyDays: [],
      yearlyDate: '',
      range: { start: `${start}T00:00:00`, end: `${end}T23:59:59` },
      startTime: `${start}T09:00:00`,
      endTime: `${end}T18:00:00`,
    };
  }
  const date = end ?? start;
  if (!date) return null;
  return {
    mode: 'date',
    allDay: true,
    hasExactTime: false,
    reminderOption: '不提前',
    repeatOption: '不重复',
    repeatSummary: '不重复',
    weeklyDays: [],
    monthlyDays: [],
    yearlyDate: '',
    date: `${date}T12:00:00`,
    startTime: `${date}T09:00:00`,
    endTime: `${date}T18:00:00`,
  };
}

export function formatDate(value: string): string {
  const v = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(11, 16);
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${hour}:${minute}`;
}

export function buildDeadlineTextFromSchedule(schedule: ScheduleMetaLike | null | undefined): string {
  if (!schedule) return '';
  if (schedule.mode === 'time' && schedule.range) {
    const rangeStart = formatDate(schedule.range.start);
    const rangeEnd = formatDate(schedule.range.end);
    const rangeLabel = rangeStart === rangeEnd ? rangeStart : `${rangeStart} ~ ${rangeEnd}`;
    const timeLabel = schedule.allDay ? '全天' : `${formatTime(schedule.startTime ?? '')} - ${formatTime(schedule.endTime ?? '')}`;
    return `${rangeLabel} ${timeLabel}`;
  }
  if (schedule.date) {
    const dateLabel = formatDate(schedule.date);
    const timeLabel = schedule.allDay ? '全天' : schedule.hasExactTime ? formatTime(schedule.startTime ?? '') : '';
    return timeLabel ? `${dateLabel} ${timeLabel}` : dateLabel;
  }
  return '';
}

export function applyScheduleMetaToLabels(schedule: ScheduleMetaLike): {
  deadlineText: string;
  reminderText: string;
  repeatText: string;
  scheduleMeta: ScheduleMetaLike;
} {
  const deadlineText =
    schedule.repeatOption !== '不重复' ? '' : buildDeadlineTextFromSchedule(schedule);
  const reminderText = formatTaskReminderLabel(schedule);
  const repeatText = schedule.repeatOption === '不重复' ? '' : (schedule.repeatSummary ?? '');
  return { deadlineText, reminderText, repeatText, scheduleMeta: schedule };
}

export function resolveInheritedDefaultSchedule(
  schedule: ScheduleMetaLike | null | undefined,
  dateLimit: DateLimitYmd | null,
): ScheduleMetaLike | null {
  if (schedule && (schedule.date || schedule.range)) return schedule;
  return scheduleMetaFromDateLimit(dateLimit);
}

export function hasDateLimitBounds(frame: DateLimitYmd | null | undefined): boolean {
  return !!(frame?.start || frame?.end);
}

function clampYmdToLimit(ymd: string, frame: DateLimitYmd): string {
  let next = ymd;
  if (frame.start && next < frame.start) next = frame.start;
  if (frame.end && next > frame.end) next = frame.end;
  return next;
}

function replaceDatePart(isoLike: string, newYmd: string): string {
  if (/^\d{4}-\d{2}-\d{2}T/.test(isoLike)) return `${newYmd}${isoLike.slice(10)}`;
  return `${newYmd}T12:00:00`;
}

/** 从日程元数据推导 due_date（YYYY-MM-DD） */
export function dueDateFromScheduleMeta(
  schedule: ScheduleMetaLike | null | undefined,
  fallbackDue: string | null | undefined,
): string | null {
  if (schedule?.mode === 'time' && schedule.range?.end) return toYmd(schedule.range.end);
  if (schedule?.date) return toYmd(schedule.date);
  if (fallbackDue) return toYmd(fallbackDue);
  return null;
}

/**
 * 将任务日程收紧到 frame 内；若已在范围内则不变。
 * 用于父任务/项目时间缩短后，仅收紧超出框架的子任务。
 */
export function clampScheduleMetaToDateLimit(
  schedule: ScheduleMetaLike | null | undefined,
  dueDate: string | null | undefined,
  frame: DateLimitYmd,
): { schedule: ScheduleMetaLike | null; dueDate: string | null; changed: boolean } {
  if (!hasDateLimitBounds(frame)) {
    return { schedule: schedule ?? null, dueDate: dueDate ?? null, changed: false };
  }

  const beforeLimit = mergeDateLimit(scheduleMetaToDateLimit(schedule), {
    end: toYmd(dueDate ?? undefined) ?? undefined,
  });
  if (!beforeLimit.start && !beforeLimit.end) {
    return { schedule: schedule ?? null, dueDate: dueDate ?? null, changed: false };
  }

  let nextSchedule = schedule ?? null;
  let nextDue = dueDate ?? null;

  if (schedule?.mode === 'time' && schedule.range?.start && schedule.range?.end) {
    const startYmd = toYmd(schedule.range.start)!;
    const endYmd = toYmd(schedule.range.end)!;
    let newStart = clampYmdToLimit(startYmd, frame);
    let newEnd = clampYmdToLimit(endYmd, frame);
    if (newStart > newEnd) {
      const collapsed = frame.end ?? frame.start ?? newEnd;
      newStart = collapsed;
      newEnd = collapsed;
    }
    if (newStart !== startYmd || newEnd !== endYmd) {
      nextSchedule = {
        ...schedule,
        range: {
          start: replaceDatePart(schedule.range.start, newStart),
          end: replaceDatePart(schedule.range.end, newEnd),
        },
        startTime: schedule.startTime
          ? replaceDatePart(schedule.startTime, newStart)
          : replaceDatePart(schedule.range.start, newStart),
        endTime: schedule.endTime
          ? replaceDatePart(schedule.endTime, newEnd)
          : replaceDatePart(schedule.range.end, newEnd),
      };
    }
  } else if (schedule?.date) {
    const dateYmd = toYmd(schedule.date)!;
    const newDate = clampYmdToLimit(dateYmd, frame);
    if (newDate !== dateYmd) {
      nextSchedule = {
        ...schedule,
        date: replaceDatePart(schedule.date, newDate),
        startTime: schedule.startTime ? replaceDatePart(schedule.startTime, newDate) : undefined,
        endTime: schedule.endTime ? replaceDatePart(schedule.endTime, newDate) : undefined,
      };
    }
  }

  if (nextDue) {
    const dueYmd = toYmd(nextDue);
    if (dueYmd) {
      const clamped = clampYmdToLimit(dueYmd, frame);
      if (clamped !== dueYmd) nextDue = clamped;
    }
  }

  const afterLimit = mergeDateLimit(scheduleMetaToDateLimit(nextSchedule), {
    end: toYmd(nextDue ?? undefined) ?? undefined,
  });
  const changed =
    beforeLimit.start !== afterLimit.start ||
    beforeLimit.end !== afterLimit.end;

  return { schedule: nextSchedule, dueDate: nextDue, changed };
}
