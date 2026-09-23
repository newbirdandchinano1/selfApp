import { getAppSetting, setAppSetting } from '@/lib/app-settings-store';

/** 课表左侧时段备注：按「格起点分钟」索引，与轴起止无关时仍可复用同刻度 */
export const SCHEDULE_SLOT_NOTES_KEY = '@selfapp/frog_schedule_slot_notes_v1';

export const SCHEDULE_SLOT_NOTE_MAX_LEN = 6;

export type ScheduleSlotNotesMap = Record<string, string>;

function minutesKey(startMinutes: number): string {
  return String(Math.round(startMinutes));
}

export function normalizeSlotNote(raw: string): string {
  return raw.replace(/\s+/g, '').slice(0, SCHEDULE_SLOT_NOTE_MAX_LEN);
}

export async function loadScheduleSlotNotes(): Promise<ScheduleSlotNotesMap> {
  try {
    const raw = await getAppSetting<unknown>(SCHEDULE_SLOT_NOTES_KEY);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out: ScheduleSlotNotesMap = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (!/^\d+$/.test(k)) continue;
      if (typeof v !== 'string') continue;
      const note = normalizeSlotNote(v);
      if (note) out[k] = note;
    }
    return out;
  } catch {
    return {};
  }
}

export async function saveScheduleSlotNote(
  startMinutes: number,
  note: string,
): Promise<ScheduleSlotNotesMap> {
  const current = await loadScheduleSlotNotes();
  const key = minutesKey(startMinutes);
  const next = normalizeSlotNote(note);
  if (next) current[key] = next;
  else delete current[key];
  await setAppSetting(SCHEDULE_SLOT_NOTES_KEY, current);
  return current;
}

export function getSlotNote(
  notes: ScheduleSlotNotesMap,
  startMinutes: number,
): string {
  return notes[minutesKey(startMinutes)] ?? '';
}
