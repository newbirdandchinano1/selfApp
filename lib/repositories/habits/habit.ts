import { readLocalRowForWrite } from '@/lib/api-local-row';
import { readApiRecord, readApiTable } from '@/lib/api-read';
import { sortByUpdatedDesc } from '@/lib/api-read-helpers';
import { getDatabase } from '../../database.native';
import type { CreateHabitInput, HabitRow, UpdateHabitInput } from './habit.types';

export async function createHabit(input: CreateHabitInput) {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO habits (
      id, context, name, tag, icon, tone, note, extra_data,
      created_at, updated_at, sync_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?,
      datetime('now'), datetime('now'), 'pending_create')`,
    [
      input.id,
      input.context,
      input.name,
      input.tag ?? null,
      input.icon,
      input.tone ?? null,
      input.note ?? null,
      input.extra_data ?? null,
    ]
  );
}

export async function getHabitById(id: string) {
  return readApiRecord<HabitRow>('habits', id, { offlineFallback: true });
}

export async function getHabits() {
  const rows = await readApiTable<HabitRow>('habits', { offlineFallback: true });
  return sortByUpdatedDesc(rows);
}

export async function getHabitsByContext(context: string) {
  const rows = await readApiTable<HabitRow>('habits', { offlineFallback: true });
  return sortByUpdatedDesc(rows.filter(r => r.context === context));
}

export async function updateHabit(id: string, input: UpdateHabitInput) {
  const db = await getDatabase();
  const current = await readLocalRowForWrite<HabitRow>('habits', id);
  if (!current) return;

  await db.runAsync(
    `UPDATE habits
      SET context = ?, name = ?, tag = ?, icon = ?, tone = ?, note = ?, extra_data = ?,
          updated_at = datetime('now'),
          sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_update' ELSE sync_status END
      WHERE id = ?`,
    [
      input.context ?? current.context,
      input.name ?? current.name,
      input.tag ?? current.tag,
      input.icon ?? current.icon,
      input.tone ?? current.tone,
      input.note !== undefined ? input.note : current.note,
      input.extra_data ?? current.extra_data,
      id,
    ]
  );
}

export async function deleteHabit(id: string) {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE habits
      SET updated_at = datetime('now'),
          sync_status = 'pending_delete'
      WHERE id = ?`,
    [id]
  );
  try {
    await db.runAsync(
      `UPDATE habit_check_ins
        SET updated_at = datetime('now'),
            sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_delete' ELSE sync_status END
        WHERE habit_id = ?`,
      [id]
    );
  } catch {
    /* 旧库尚无 habit_check_ins 表 */
  }
}

