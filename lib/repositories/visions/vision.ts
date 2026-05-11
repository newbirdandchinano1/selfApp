import { getDatabase } from '../../database.native';
import type { CreateVisionInput, UpdateVisionInput, VisionExtraPayload, VisionRow } from './vision.types';

export function serializeVisionExtra(extra: VisionExtraPayload | null | undefined): string | null {
  if (!extra || Object.keys(extra).length === 0) return null;
  return JSON.stringify(extra);
}

export function parseVisionExtra(raw: string | null): VisionExtraPayload | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    return v as VisionExtraPayload;
  } catch {
    return null;
  }
}

export async function createVision(input: CreateVisionInput) {
  const db = await getDatabase();
  const extraJson = serializeVisionExtra(input.extra ?? null);
  await db.runAsync(
    `INSERT INTO visions (
      id, title, description, track_kind, direction, bg_option_idx, sort_order,
      extra_data, created_at, updated_at, deleted_at, sync_status, version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?,
      datetime('now'), datetime('now'), NULL, 'pending_create', 1)`,
    [
      input.id,
      input.title,
      input.description ?? null,
      input.track_kind,
      input.direction ?? null,
      input.bg_option_idx,
      input.sort_order ?? 1000,
      extraJson,
    ]
  );
}

export async function getVisionRowById(id: string) {
  const db = await getDatabase();
  return db.getFirstAsync<VisionRow>('SELECT * FROM visions WHERE id = ? AND deleted_at IS NULL LIMIT 1', [id]);
}

export async function listVisions() {
  const db = await getDatabase();
  return db.getAllAsync<VisionRow>(
    `SELECT * FROM visions
     WHERE deleted_at IS NULL
     ORDER BY datetime(updated_at) DESC, datetime(created_at) DESC`
  );
}

export async function updateVision(id: string, input: UpdateVisionInput) {
  const db = await getDatabase();
  const current = await getVisionRowById(id);
  if (!current) return;

  const title = input.title ?? current.title;
  const description = input.description !== undefined ? input.description : current.description;
  const track_kind = input.track_kind ?? current.track_kind;
  const direction = input.direction !== undefined ? input.direction : current.direction;
  const bg_option_idx = input.bg_option_idx ?? current.bg_option_idx;
  const sort_order = input.sort_order ?? current.sort_order;
  const extra_data = input.extra_data !== undefined ? input.extra_data : current.extra_data;

  await db.runAsync(
    `UPDATE visions SET
      title = ?, description = ?, track_kind = ?, direction = ?,
      bg_option_idx = ?, sort_order = ?, extra_data = ?,
      updated_at = datetime('now'),
      sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_update' ELSE sync_status END,
      version = version + 1
    WHERE id = ?`,
    [title, description, track_kind, direction, bg_option_idx, sort_order, extra_data, id]
  );
}

export async function deleteVision(id: string) {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE visions SET
      deleted_at = datetime('now'),
      updated_at = datetime('now'),
      sync_status = 'pending_delete',
      version = version + 1
    WHERE id = ? AND deleted_at IS NULL`,
    [id]
  );
}
