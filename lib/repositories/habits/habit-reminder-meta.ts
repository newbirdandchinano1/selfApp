import type { HabitReminderIntensity } from '@/lib/habit-reminder-logic';

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export const DEFAULT_HABIT_EVENING_WRAP_HOUR = 20;
export const DEFAULT_HABIT_EVENING_WRAP_MINUTE = 0;

export type { HabitReminderIntensity };

export type ParsedHabitReminder =
  | { enabled: false }
  | {
      enabled: true;
      hour: number;
      minute: number;
      /** 默认 normal：到点 + 未完成傍晚收口 */
      intensity: HabitReminderIntensity;
      eveningWrapHour: number;
      eveningWrapMinute: number;
    };

function normalizeIntensity(raw: unknown): HabitReminderIntensity {
  if (raw === 'soft' || raw === 'normal' || raw === 'strong') return raw;
  return 'normal';
}

/** 与 `app/add-habit.tsx` 写入的 `extra_data.reminder` 一致 */
export function parseHabitReminder(extraData: string | null): ParsedHabitReminder {
  if (!extraData) return { enabled: false };
  try {
    const p = JSON.parse(extraData) as { reminder?: unknown };
    const r = p?.reminder;
    if (!r || typeof r !== 'object' || Array.isArray(r)) return { enabled: false };
    if ((r as { enabled?: unknown }).enabled !== true) return { enabled: false };
    const rawH = (r as { hour?: unknown }).hour;
    const rawM = (r as { minute?: unknown }).minute;
    const hour =
      typeof rawH === 'number' && Number.isFinite(rawH)
        ? Math.max(0, Math.min(23, Math.round(rawH)))
        : 20;
    const minute =
      typeof rawM === 'number' && Number.isFinite(rawM)
        ? Math.max(0, Math.min(59, Math.round(rawM)))
        : 0;
    const wrapH = (r as { eveningWrapHour?: unknown }).eveningWrapHour;
    const wrapM = (r as { eveningWrapMinute?: unknown }).eveningWrapMinute;
    return {
      enabled: true,
      hour,
      minute,
      intensity: normalizeIntensity((r as { intensity?: unknown }).intensity),
      eveningWrapHour:
        typeof wrapH === 'number' && Number.isFinite(wrapH)
          ? Math.max(0, Math.min(23, Math.round(wrapH)))
          : DEFAULT_HABIT_EVENING_WRAP_HOUR,
      eveningWrapMinute:
        typeof wrapM === 'number' && Number.isFinite(wrapM)
          ? Math.max(0, Math.min(59, Math.round(wrapM)))
          : DEFAULT_HABIT_EVENING_WRAP_MINUTE,
    };
  } catch {
    return { enabled: false };
  }
}

export function formatHabitReminderClock(meta: ParsedHabitReminder): string | null {
  if (!meta.enabled) return null;
  return `${pad2(meta.hour)}:${pad2(meta.minute)}`;
}

export function habitReminderIntensityLabel(intensity: HabitReminderIntensity): string {
  switch (intensity) {
    case 'soft':
      return '轻';
    case 'strong':
      return '强';
    default:
      return '标准';
  }
}

export type HabitReminderWrite =
  | { enabled: false }
  | {
      enabled: true;
      hour: number;
      minute: number;
      intensity?: HabitReminderIntensity;
      eveningWrapHour?: number;
      eveningWrapMinute?: number;
    };

/** 写回习惯 `extra_data.reminder`（与 add-habit / habit-detail 同源）。 */
export function mergeHabitReminderIntoExtraData(
  extraData: string | null,
  reminder: HabitReminderWrite,
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
  if (!reminder.enabled) {
    base.reminder = { enabled: false };
  } else {
    base.reminder = {
      enabled: true,
      hour: Math.max(0, Math.min(23, Math.round(reminder.hour))),
      minute: Math.max(0, Math.min(59, Math.round(reminder.minute))),
      intensity: normalizeIntensity(reminder.intensity),
      eveningWrapHour: Math.max(
        0,
        Math.min(23, Math.round(reminder.eveningWrapHour ?? DEFAULT_HABIT_EVENING_WRAP_HOUR)),
      ),
      eveningWrapMinute: Math.max(
        0,
        Math.min(59, Math.round(reminder.eveningWrapMinute ?? DEFAULT_HABIT_EVENING_WRAP_MINUTE)),
      ),
    };
  }
  return JSON.stringify(base);
}
