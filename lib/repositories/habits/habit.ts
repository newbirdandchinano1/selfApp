import { requireLocalRowForWrite } from '@/lib/api-local-row';
import { invalidateInflightApiTableFetch, readApiRecord, readApiTable } from '@/lib/api-read';
import { sortByUpdatedDesc } from '@/lib/api-read-helpers';
import { getDatabase } from '../../database.native';
import type { CreateHabitInput, HabitRow, UpdateHabitInput } from './habit.types';

async function pushHabitChangesToApi(): Promise<void> {
  const { pushLocalChangesToApi } = await import('@/lib/api-write-sync');
  await pushLocalChangesToApi({ awaitSync: true });
}

export async function createHabit(input: CreateHabitInput) {
  const db = await getDatabase();
  if (!db) {
    throw new Error('本地数据库不可用，无法保存习惯');
  }
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
  invalidateInflightApiTableFetch('habits');
  await pushHabitChangesToApi();
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
  if (!db) {
    throw new Error('本地数据库不可用，无法保存习惯');
  }
  const current = await requireLocalRowForWrite<HabitRow>('habits', id, '习惯');

  const result = await db.runAsync(
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
  if ((result.changes ?? 0) === 0) {
    throw new Error('习惯保存失败，请返回列表刷新后重试');
  }
  invalidateInflightApiTableFetch('habits');
  await pushHabitChangesToApi();
}

export async function deleteHabit(id: string) {
  await requireLocalRowForWrite('habits', id, '习惯');
  const db = await getDatabase();
  if (!db) {
    throw new Error('本地数据库不可用，无法删除习惯');
  }
  const result = await db.runAsync(
    `UPDATE habits
      SET updated_at = datetime('now'),
          sync_status = 'pending_delete'
      WHERE id = ?`,
    [id]
  );
  if ((result.changes ?? 0) === 0) {
    throw new Error('习惯尚未同步到本地，请返回列表刷新后重试');
  }
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
  invalidateInflightApiTableFetch('habits');
  invalidateInflightApiTableFetch('habit_check_ins');
  await pushHabitChangesToApi();
}

