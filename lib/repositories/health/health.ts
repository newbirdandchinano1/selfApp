import { File } from 'expo-file-system';

import { readApiRecord, readApiTable } from '@/lib/api-read';
import { addDaysToYmd, compareDatetimeDesc, isYmdInRange, sortByUpdatedDesc } from '@/lib/api-read-helpers';
import { getDatabase } from '../../database.native';
import type {
  CreateHealthRecordInput,
  HealthIntakeDayTotals,
  HealthRecordRow,
  UpdateHealthRecordInput,
} from './health.types';

export async function createHealthRecord(input: CreateHealthRecordInput) {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO health_records (
      id, user_id, hydration, target_hydration, protein, target_protein, carbohydrate, target_carbohydrate, sodium, target_sodium, record_date, quick_add_key, intake_display_title, intake_ai_comment, source_image_uri,
      created_at, updated_at, sync_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), 'pending_create')`,
    [
      input.id,
      input.user_id,
      input.hydration ?? 0,
      input.target_hydration ?? 0,
      input.protein ?? 0,
      input.target_protein ?? 0,
      input.carbohydrate ?? 0,
      input.target_carbohydrate ?? 0,
      input.sodium ?? 0,
      input.target_sodium ?? 0,
      input.record_date,
      input.quick_add_key ?? null,
      input.intake_display_title ?? null,
      input.intake_ai_comment ?? null,
      input.source_image_uri ?? null,
    ]
  );
}

export async function getHealthRecordById(id: string) {
  return readApiRecord<HealthRecordRow>('health_records', id, { offlineFallback: true });
}

export async function getHealthRecordsByUserId(userId: string) {
  const rows = await readApiTable<HealthRecordRow>('health_records', { offlineFallback: true });
  return sortByUpdatedDesc(rows.filter(r => r.user_id === userId));
}

export async function getHealthRecordsLast7Days(userId: string, endDate: string = new Date().toISOString().slice(0, 10)) {
  const startDate = addDaysToYmd(endDate, -6);
  const rows = await readApiTable<HealthRecordRow>('health_records', { offlineFallback: true });
  return rows
    .filter(r => r.user_id === userId && isYmdInRange(r.record_date, startDate, endDate))
    .sort((a, b) => {
      const d = a.record_date.localeCompare(b.record_date);
      if (d !== 0) return d;
      return compareDatetimeDesc(a.updated_at, b.updated_at) * -1;
    });
}

export async function getLatestHealthRecordForUserOnDate(userId: string, recordDateYmd: string) {
  const rows = await readApiTable<HealthRecordRow>('health_records', { offlineFallback: true });
  const dayRows = rows.filter(r => r.user_id === userId && r.record_date === recordDateYmd);
  if (dayRows.length === 0) return null;
  return [...dayRows].sort((a, b) => compareDatetimeDesc(a.updated_at, b.updated_at))[0] ?? null;
}

export async function getHealthRecordsForUserOnDate(userId: string, recordDateYmd: string) {
  const rows = await readApiTable<HealthRecordRow>('health_records', { offlineFallback: true });
  return rows
    .filter(r => r.user_id === userId && r.record_date === recordDateYmd)
    .sort((a, b) => compareDatetimeDesc(a.created_at, b.created_at) * -1);
}

export async function getHealthIntakeTotalsForUserOnDate(
  userId: string,
  recordDateYmd: string
): Promise<HealthIntakeDayTotals | null> {
  const rows = await readApiTable<HealthRecordRow>('health_records', { offlineFallback: true });
  const dayRows = rows.filter(r => r.user_id === userId && r.record_date === recordDateYmd);
  if (dayRows.length === 0) return null;
  let hydration = 0;
  let protein = 0;
  let carbohydrate = 0;
  let sodium = 0;
  for (const r of dayRows) {
    hydration += Number(r.hydration ?? 0);
    protein += Number(r.protein ?? 0);
    carbohydrate += Number(r.carbohydrate ?? 0);
    sodium += Number(r.sodium ?? 0);
  }
  return { hydration, protein, carbohydrate, sodium };
}

export async function updateHealthRecord(id: string, input: UpdateHealthRecordInput) {
  const db = await getDatabase();
  const current = await getHealthRecordById(id);

  if (!current) {
    return;
  }

  await db.runAsync(
    `UPDATE health_records
     SET hydration = ?, target_hydration = ?, protein = ?, target_protein = ?, carbohydrate = ?, target_carbohydrate = ?, sodium = ?, target_sodium = ?, record_date = ?, quick_add_key = ?, intake_display_title = ?, intake_ai_comment = ?, source_image_uri = ?, updated_at = datetime('now'),
         sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_update' ELSE sync_status END
     WHERE id = ?`,
    [
      input.hydration ?? current.hydration,
      input.target_hydration ?? current.target_hydration,
      input.protein ?? current.protein,
      input.target_protein ?? current.target_protein,
      input.carbohydrate ?? current.carbohydrate,
      input.target_carbohydrate ?? current.target_carbohydrate,
      input.sodium ?? current.sodium,
      input.target_sodium ?? current.target_sodium,
      input.record_date ?? current.record_date,
      input.quick_add_key !== undefined ? input.quick_add_key : current.quick_add_key,
      input.intake_display_title !== undefined ? input.intake_display_title : current.intake_display_title ?? null,
      input.intake_ai_comment !== undefined ? input.intake_ai_comment : current.intake_ai_comment ?? null,
      input.source_image_uri !== undefined ? input.source_image_uri : current.source_image_uri ?? null,
      id,
    ]
  );
}

export async function deleteHealthRecord(id: string) {
  const db = await getDatabase();
  const existing = await getHealthRecordById(id);
  const img = existing?.source_image_uri?.trim();
  if (img) {
    try {
      const f = new File(img);
      if (f.exists) {
        f.delete();
      }
    } catch {
      /* 忽略本地文件删除失败 */
    }
  }
  await db.runAsync(
    `UPDATE health_records
     SET updated_at = datetime('now'),
         sync_status = CASE WHEN sync_status = 'pending_create' THEN 'pending_delete' ELSE 'pending_delete' END
     WHERE id = ?`,
    [id]
  );
}
