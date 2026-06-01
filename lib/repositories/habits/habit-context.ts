import { readApiTable } from '@/lib/api-read';
import { sortBySortOrderAsc } from '@/lib/api-read-helpers';
import { getDatabase } from '../../database.native';
import type { HabitContextRow } from './habit-context.types';

export async function getHabitContexts() {
  const rows = await readApiTable<HabitContextRow>('habit_contexts', { offlineFallback: true });
  return sortBySortOrderAsc(rows);
}

export async function createHabitContext(name: string) {
  const db = await getDatabase();
  const trimmed = name.trim();
  if (!trimmed) throw new Error('情境名称不能为空');

  const existing = await db.getFirstAsync<{ id: string }>(
    `SELECT id FROM habit_contexts WHERE deleted_at IS NULL AND name = ? LIMIT 1`,
    [trimmed]
  );
  if (existing) throw new Error('该情境已存在');

  const maxRow = await db.getFirstAsync<{ max_sort: number | null }>(
    `SELECT MAX(COALESCE(sort_order, 1000)) AS max_sort FROM habit_contexts WHERE deleted_at IS NULL`
  );
  const nextSort = (maxRow?.max_sort ?? 1000) + 10;
  // Keep id stable & readable; fall back if collision.
  const id = trimmed;

  const tombstone = await db.getFirstAsync<{ id: string }>(
    `SELECT id FROM habit_contexts WHERE id = ? LIMIT 1`,
    [id]
  );

  if (tombstone) {
    await db.runAsync(
      `UPDATE habit_contexts
       SET name = ?,
           sort_order = ?,
           is_builtin = 0,
           deleted_at = NULL,
           updated_at = datetime('now'),
           sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_update' ELSE sync_status END,
           version = version + 1
       WHERE id = ?`,
      [trimmed, nextSort, id]
    );
    return;
  }

  await db.runAsync(
    `INSERT INTO habit_contexts (
       id, name, sort_order, is_builtin, extra_data,
       created_at, updated_at, deleted_at, sync_status, version
     ) VALUES (?, ?, ?, 0, NULL,
       datetime('now'), datetime('now'), NULL, 'pending_create', 1)`,
    [id, trimmed, nextSort]
  );
}

/** 删除情境后，仍引用该名称的习惯归入此前情境（与内置默认一致，避免界面「删了又出现」） */
const HABIT_CONTEXT_FALLBACK_NAME = '全天';

export async function deleteHabitContexts(ids: string[]) {
  if (ids.length === 0) return;
  const db = await getDatabase();
  const placeholders = ids.map(() => '?').join(', ');

  const resolved = await db.getAllAsync<{ name: string }>(
    `SELECT name FROM habit_contexts WHERE deleted_at IS NULL AND id IN (${placeholders})`,
    ids
  );
  const names = Array.from(new Set(resolved.map((r) => r.name).filter((n): n is string => Boolean(n?.trim()))));
  if (names.length > 0) {
    const inPh = names.map(() => '?').join(', ');
    await db.runAsync(
      `UPDATE habits
       SET context = ?,
           updated_at = datetime('now'),
           sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_update' ELSE sync_status END,
           version = version + 1
       WHERE deleted_at IS NULL AND context IN (${inPh})`,
      [HABIT_CONTEXT_FALLBACK_NAME, ...names]
    );
  }

  await db.runAsync(
    `UPDATE habit_contexts
     SET deleted_at = datetime('now'),
         updated_at = datetime('now'),
         sync_status = 'pending_delete',
         version = version + 1
     WHERE deleted_at IS NULL AND id IN (${placeholders})`,
    ids
  );
}

export async function updateHabitContextsSortOrder(contextIdsInOrder: string[]) {
  const db = await getDatabase();
  // Keep gaps so manual inserts can be placed between without a full renumber.
  const GAP = 10;
  for (let i = 0; i < contextIdsInOrder.length; i++) {
    const id = contextIdsInOrder[i];
    const sortOrder = (i + 1) * GAP;
    await db.runAsync(
      `UPDATE habit_contexts
       SET sort_order = ?,
           updated_at = datetime('now'),
           sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_update' ELSE sync_status END,
           version = version + 1
       WHERE id = ? AND deleted_at IS NULL`,
      [sortOrder, id]
    );
  }
}

