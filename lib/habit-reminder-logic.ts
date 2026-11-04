/**
 * 习惯提醒纯规则（强度档 / 傍晚收口），供 notifications 与单测共用。
 */

export type HabitReminderIntensity = 'soft' | 'normal' | 'strong';

export function habitReminderNeedsEveningWrap(intensity: HabitReminderIntensity): boolean {
  return intensity === 'normal' || intensity === 'strong';
}

/** 同一逻辑日的傍晚收口：须晚于主提醒，且尚未过去 */
export function buildHabitEveningWrapFireAt(params: {
  primaryFireAt: Date;
  wrapHour: number;
  wrapMinute: number;
  now?: Date;
}): Date | null {
  const now = params.now ?? new Date();
  const wrap = new Date(
    params.primaryFireAt.getFullYear(),
    params.primaryFireAt.getMonth(),
    params.primaryFireAt.getDate(),
    Math.max(0, Math.min(23, params.wrapHour)),
    Math.max(0, Math.min(59, params.wrapMinute)),
    0,
    0,
  );
  if (wrap.getTime() <= params.primaryFireAt.getTime() + 60_000) return null;
  if (wrap.getTime() <= now.getTime() + 2000) return null;
  return wrap;
}
