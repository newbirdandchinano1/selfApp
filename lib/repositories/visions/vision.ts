import { ensureLocalRowForWrite } from '@/lib/api-local-row';
import { readApiRecord, readApiTable } from '@/lib/api-read';
import { sortByUpdatedDesc } from '@/lib/api-read-helpers';
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
      extra_data, created_at, updated_at, sync_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?,
      datetime('now'), datetime('now'), 'pending_create')`,
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
  return readApiRecord<VisionRow>('visions', id, { offlineFallback: true });
}

export async function listVisions() {
  const rows = await readApiTable<VisionRow>('visions', { offlineFallback: true });
  return sortByUpdatedDesc(rows);
}

export async function updateVision(id: string, input: UpdateVisionInput) {
  const db = await getDatabase();
  const current = await ensureLocalRowForWrite<VisionRow>('visions', id);
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
      sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_update' ELSE sync_status END
    WHERE id = ?`,
    [title, description, track_kind, direction, bg_option_idx, sort_order, extra_data, id]
  );
}

export async function deleteVision(id: string) {
  await ensureLocalRowForWrite('visions', id);
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE visions SET
      updated_at = datetime('now'),
      sync_status = 'pending_delete'
    WHERE id = ?`,
    [id]
  );
}
