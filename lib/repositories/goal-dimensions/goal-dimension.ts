import { readLocalRowForWrite } from '@/lib/api-local-row';
import { readApiRecord, readApiTable } from '@/lib/api-read';
import { sortBySortOrderAsc } from '@/lib/api-read-helpers';
import { getDatabase } from '../../database.native';
import { listVisions, parseVisionExtra, serializeVisionExtra, updateVision } from '../visions/vision';
import { serializeGoalDimensionExtra } from './goal-dimension-extra';
import type { CreateGoalDimensionInput, GoalDimensionRow, UpdateGoalDimensionInput } from './goal-dimension.types';

export async function listGoalDimensions() {
  const rows = await readApiTable<GoalDimensionRow>('goal_dimensions', { offlineFallback: true });
  return sortBySortOrderAsc(rows);
}

export async function createGoalDimension(input: CreateGoalDimensionInput) {
  const db = await getDatabase();
  const extraJson = serializeGoalDimensionExtra(input.extra ?? null);
  await db.runAsync(
    `INSERT INTO goal_dimensions (
      id, title, sort_order, created_at, updated_at, sync_status, extra_data
    ) VALUES (?, ?, ?, datetime('now'), datetime('now'), 'pending_create', ?)`,
    [input.id, input.title.trim(), input.sort_order ?? 1000, extraJson],
  );
}

export async function getGoalDimensionById(id: string) {
  return readApiRecord<GoalDimensionRow>('goal_dimensions', id, { offlineFallback: true });
}

async function syncVisionDimensionNames(dimensionId: string, newTitle: string) {
  const rows = await listVisions();
  for (const row of rows) {
    const extra = parseVisionExtra(row.extra_data);
    if (extra?.dimensionId?.trim() !== dimensionId) continue;
    await updateVision(row.id, {
      extra_data: serializeVisionExtra({ ...extra, dimensionName: newTitle }),
    });
  }
}

export async function updateGoalDimension(id: string, input: UpdateGoalDimensionInput) {
  const current = await readLocalRowForWrite<GoalDimensionRow>('goal_dimensions', id);
  if (!current) return false;

  const title = input.title !== undefined ? input.title.trim() : current.title;
  const sort_order = input.sort_order ?? current.sort_order;
  const extra_data =
    input.extra !== undefined ? serializeGoalDimensionExtra(input.extra) : current.extra_data;

  const db = await getDatabase();
  await db.runAsync(
    `UPDATE goal_dimensions SET
      title = ?, sort_order = ?, extra_data = ?,
      updated_at = datetime('now'),
      sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_update' ELSE sync_status END
    WHERE id = ?`,
    [title, sort_order, extra_data, id],
  );

  if (input.title !== undefined && title !== current.title) {
    await syncVisionDimensionNames(id, title);
  }
  return true;
}

export async function deleteGoalDimension(id: string) {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE goal_dimensions SET
      updated_at = datetime('now'),
      sync_status = 'pending_delete'
    WHERE id = ?`,
    [id]
  );
}
