function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export type ParsedHabitReminder =
  | { enabled: false }
  | { enabled: true; hour: number; minute: number };

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
    return { enabled: true, hour, minute };
  } catch {
    return { enabled: false };
  }
}

export function formatHabitReminderClock(meta: ParsedHabitReminder): string | null {
  if (!meta.enabled) return null;
  return `${pad2(meta.hour)}:${pad2(meta.minute)}`;
}
