export const DEFAULT_REMINDER_HOUR = 9;
export const DEFAULT_REMINDER_MINUTE = 0;

export type TaskExtraScheduleReminder = {
  reminderOption?: string;
  reminderHour?: number;
  reminderMinute?: number;
};

/** 用户是否配置了待办提醒（提前 N 天，非默认「不提前」） */
export function isTaskReminderConfigured(
  reminderOption: string | undefined,
  reminderText: string | undefined,
): boolean {
  const opt = (reminderOption ?? '').trim();
  if (opt && opt !== '不提前') return true;
  const text = (reminderText ?? '').trim();
  if (!text || text === '不提前') return false;
  return /^提前\d+天/.test(text);
}

export function resolveReminderHourMinute(schedule: TaskExtraScheduleReminder | null | undefined): {
  hour: number;
  minute: number;
} {
  const h = schedule?.reminderHour;
  const m = schedule?.reminderMinute;
  if (typeof h === 'number' && h >= 0 && h <= 23 && typeof m === 'number' && m >= 0 && m <= 59) {
    return { hour: h, minute: m };
  }
  return { hour: DEFAULT_REMINDER_HOUR, minute: DEFAULT_REMINDER_MINUTE };
}

/** 在截止日 anchorYmd 基础上，按提前天数与自定义时刻计算本地推送触发时间 */
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
      }
    | null
    | undefined,
): string {
  if (!schedule) return '';
  const opt = (schedule.reminderOption ?? '').trim();
  if (!opt || opt === '不提前') return '';
  const { hour, minute } = resolveReminderHourMinute(schedule);
  const time =
    typeof schedule.reminderHour === 'number' && typeof schedule.reminderMinute === 'number'
      ? ` ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
      : '';
  return `${opt}${time}`;
}
