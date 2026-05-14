import { getDatabase } from '../../database.native';
import type { CreateGoalDimensionInput, GoalDimensionRow } from './goal-dimension.types';

export async function listGoalDimensions() {
  const db = await getDatabase();
  return db.getAllAsync<GoalDimensionRow>(
    `SELECT * FROM goal_dimensions
     WHERE deleted_at IS NULL
     ORDER BY sort_order ASC, datetime(created_at) ASC`
  );
}

export async function createGoalDimension(input: CreateGoalDimensionInput) {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO goal_dimensions (
      id, title, sort_order, created_at, updated_at, deleted_at, sync_status, version, extra_data
    ) VALUES (?, ?, ?, datetime('now'), datetime('now'), NULL, 'pending_create', 1, NULL)`,
    [input.id, input.title.trim(), input.sort_order ?? 1000]
  );
}

export async function deleteGoalDimension(id: string) {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE goal_dimensions SET
      deleted_at = datetime('now'),
      updated_at = datetime('now'),
      sync_status = 'pending_delete',
      version = version + 1
    WHERE id = ? AND deleted_at IS NULL`,
    [id]
  );
}
