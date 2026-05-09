import { getDatabase } from '../../database.native';
import type { CreateHabitInput, HabitRow, UpdateHabitInput } from './habit.types';

export async function createHabit(input: CreateHabitInput) {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO habits (
      id, context, name, tag, icon, tone, note, extra_data,
      created_at, updated_at, deleted_at, sync_status, version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?,
      datetime('now'), datetime('now'), NULL, 'pending_create', 1)`,
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
  const db = await getDatabase();
  return db.getFirstAsync<HabitRow>('SELECT * FROM habits WHERE id = ? AND deleted_at IS NULL LIMIT 1', [id]);
}

export async function getHabits() {
  const db = await getDatabase();
  return db.getAllAsync<HabitRow>(
    'SELECT * FROM habits WHERE deleted_at IS NULL ORDER BY datetime(updated_at) DESC, datetime(created_at) DESC'
  );
}

export async function getHabitsByContext(context: string) {
  const db = await getDatabase();
  return db.getAllAsync<HabitRow>(
    `SELECT * FROM habits
      WHERE deleted_at IS NULL AND context = ?
      ORDER BY datetime(updated_at) DESC, datetime(created_at) DESC`,
    [context]
  );
}

export async function updateHabit(id: string, input: UpdateHabitInput) {
  const db = await getDatabase();
  const current = await getHabitById(id);
  if (!current) return;

  await db.runAsync(
    `UPDATE habits
      SET context = ?, name = ?, tag = ?, icon = ?, tone = ?, note = ?, extra_data = ?,
          updated_at = datetime('now'),
          sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_update' ELSE sync_status END,
          version = version + 1
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
      SET deleted_at = datetime('now'),
          updated_at = datetime('now'),
          sync_status = 'pending_delete',
          version = version + 1
      WHERE id = ? AND deleted_at IS NULL`,
    [id]
  );
  try {
    await db.runAsync(
      `UPDATE habit_check_ins
        SET deleted_at = datetime('now'),
            updated_at = datetime('now'),
            sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_delete' ELSE sync_status END,
            version = version + 1
        WHERE habit_id = ? AND deleted_at IS NULL`,
      [id]
    );
  } catch {
    /* 旧库尚无 habit_check_ins 表 */
  }
}

