export const DEFAULT_REMINDER_HOUR = 9;
export const DEFAULT_REMINDER_MINUTE = 0;

export type TaskReminderOption = '不提前' | '当天' | '提前1天' | '提前2天' | '提前3天' | '提前7天';

export const TASK_REMINDER_OPTIONS: TaskReminderOption[] = [
  '不提前',
  '当天',
  '提前1天',
  '提前2天',
  '提前3天',
  '提前7天',
];

export type TaskExtraScheduleReminder = {
  reminderOption?: string;
  reminderHour?: number;
  reminderMinute?: number;
  hasExactTime?: boolean;
  startTime?: string;
};

function parseHourMinuteFromIso(iso: string | undefined): { hour: number; minute: number } | null {
  if (!iso?.trim()) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return { hour: date.getHours(), minute: date.getMinutes() };
}

/** 从提醒选项解析提前天数；「当天」为 0 天 */
export function parseTaskReminderAdvanceDays(reminderOption: string): number {
  const t = reminderOption.trim();
  if (!t || t === '不提前') return 0;
  if (t === '当天') return 0;
  const m = /^提前(\d+)天/.exec(t);
  if (m) return Math.min(30, Math.max(0, parseInt(m[1], 10) || 0));
  return 0;
}

/** 用户是否配置了待办提醒（含「当天」与提前 N 天，不含「不提前」） */
export function isTaskReminderConfigured(
  reminderOption: string | undefined,
  reminderText: string | undefined,
): boolean {
  const opt = (reminderOption ?? '').trim();
  if (opt === '当天') return true;
  if (opt && opt !== '不提前') return true;
  const text = (reminderText ?? '').trim();
  if (!text || text === '不提前') return false;
  if (text === '当天' || text.startsWith('当天 ')) return true;
  return /^提前\d+天/.test(text);
}

/**
 * 提醒触发的时刻：
 * 1. 用户在日程页设置了「提醒时间」→ 使用该时刻
 * 2. 否则若截止日启用了「具体时间」→ 使用截止时刻
 * 3. 否则默认 09:00
 */
export function resolveReminderHourMinute(schedule: TaskExtraScheduleReminder | null | undefined): {
  hour: number;
  minute: number;
} {
  const h = schedule?.reminderHour;
  const m = schedule?.reminderMinute;
  if (typeof h === 'number' && h >= 0 && h <= 23 && typeof m === 'number' && m >= 0 && m <= 59) {
    return { hour: h, minute: m };
  }
  if (schedule?.hasExactTime) {
    const fromStart = parseHourMinuteFromIso(schedule.startTime);
    if (fromStart) return fromStart;
  }
  return { hour: DEFAULT_REMINDER_HOUR, minute: DEFAULT_REMINDER_MINUTE };
}

/** 在截止日 anchorYmd 基础上，按提前天数与时刻计算本地推送触发时间 */
export function buildTaskReminderFireAt(
  anchorYmd: string,
  advanceDays: number,
  schedule: TaskExtraScheduleReminder | null | undefined,
): Date | null {
  const m = anchorYmd.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  const d = parseInt(m[3], 10);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;

  const { hour, minute } = resolveReminderHourMinute(schedule);
  const fire = new Date(y, mo - 1, d);
  fire.setDate(fire.getDate() - Math.max(0, advanceDays));
  fire.setHours(hour, minute, 0, 0);
  return fire;
}

export function formatTaskReminderLabel(
  schedule:
    | {
        reminderOption?: string;
        reminderHour?: number;
        reminderMinute?: number;
        hasExactTime?: boolean;
        startTime?: string;
      }
    | null
    | undefined,
): string {
  if (!schedule) return '';
  const opt = (schedule.reminderOption ?? '').trim();
  if (!opt || opt === '不提前') return '';
  const { hour, minute } = resolveReminderHourMinute(schedule);
  const hasExplicitReminderTime =
    typeof schedule.reminderHour === 'number' && typeof schedule.reminderMinute === 'number';
  const hasDueExactTime = !!schedule.hasExactTime && !!schedule.startTime?.trim();
  const time =
    hasExplicitReminderTime || hasDueExactTime
      ? ` ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
      : '';
  return `${opt}${time}`;
}
