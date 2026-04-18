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
      id, user_id, hydration, target_hydration, protein, target_protein, sodium, target_sodium, record_date,
      created_at, updated_at, deleted_at, sync_status, version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), NULL, 'pending_create', 1)`,
    [
      input.id,
      input.user_id,
      input.hydration ?? 0,
      input.target_hydration ?? 0,
      input.protein ?? 0,
      input.target_protein ?? 0,
      input.sodium ?? 0,
      input.target_sodium ?? 0,
      input.record_date,
    ]
  );
}

export async function getHealthRecordById(id: string) {
  const db = await getDatabase();
  return db.getFirstAsync<HealthRecordRow>('SELECT * FROM health_records WHERE id = ? AND deleted_at IS NULL LIMIT 1', [id]);
}

export async function getHealthRecordsByUserId(userId: string) {
  const db = await getDatabase();
  return db.getAllAsync<HealthRecordRow>(
    'SELECT * FROM health_records WHERE user_id = ? AND deleted_at IS NULL ORDER BY record_date DESC, updated_at DESC',
    [userId]
  );
}
// endDate 默认是今天
// 会查询从 endDate 往前 6 天到今天，一共 7 天的数据
// 排序是按日期升序
export async function getHealthRecordsLast7Days(userId: string, endDate: string = new Date().toISOString().slice(0, 10)) {
  const db = await getDatabase();
  return db.getAllAsync<HealthRecordRow>(
    `SELECT *
     FROM health_records
     WHERE user_id = ?
       AND deleted_at IS NULL
       AND record_date BETWEEN date(?, '-6 day') AND date(?)
     ORDER BY record_date ASC, updated_at ASC`,
    [userId, endDate, endDate]
  );
}

/** 指定日历日（YYYY-MM-DD）下，该用户最新一条健康记录（同日多条时取 updated_at 最新）。 */
export async function getLatestHealthRecordForUserOnDate(userId: string, recordDateYmd: string) {
  const db = await getDatabase();
  return db.getFirstAsync<HealthRecordRow>(
    `SELECT *
     FROM health_records
     WHERE user_id = ?
       AND deleted_at IS NULL
       AND record_date = ?
     ORDER BY updated_at DESC, created_at DESC
     LIMIT 1`,
    [userId, recordDateYmd]
  );
}

/** 指定日（YYYY-MM-DD）该用户所有未删除的 health_records，按创建时间升序（便于时间线展示）。 */
export async function getHealthRecordsForUserOnDate(userId: string, recordDateYmd: string) {
  const db = await getDatabase();
  return db.getAllAsync<HealthRecordRow>(
    `SELECT *
     FROM health_records
     WHERE user_id = ?
       AND deleted_at IS NULL
       AND record_date = ?
     ORDER BY datetime(created_at) ASC, datetime(updated_at) ASC`,
    [userId, recordDateYmd]
  );
}

/** 指定日该用户所有未删除记录的摄入汇总；当日无记录时返回 null。 */
export async function getHealthIntakeTotalsForUserOnDate(
  userId: string,
  recordDateYmd: string
): Promise<HealthIntakeDayTotals | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ cnt: number; h: number; p: number; s: number }>(
    `SELECT COUNT(*) as cnt,
            COALESCE(SUM(hydration), 0) as h,
            COALESCE(SUM(protein), 0) as p,
            COALESCE(SUM(sodium), 0) as s
     FROM health_records
     WHERE user_id = ? AND deleted_at IS NULL AND record_date = ?`,
    [userId, recordDateYmd]
  );
  if (!row || row.cnt === 0) return null;
  return {
    hydration: Number(row.h),
    protein: Number(row.p),
    sodium: Number(row.s),
  };
}

export async function updateHealthRecord(id: string, input: UpdateHealthRecordInput) {
  const db = await getDatabase();
  const current = await getHealthRecordById(id);

  if (!current) {
    return;
  }

  await db.runAsync(
    `UPDATE health_records
     SET hydration = ?, target_hydration = ?, protein = ?, target_protein = ?, sodium = ?, target_sodium = ?, record_date = ?, updated_at = datetime('now'),
         sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_update' ELSE sync_status END,
         version = version + 1
     WHERE id = ?`,
    [
      input.hydration ?? current.hydration,
      input.target_hydration ?? current.target_hydration,
      input.protein ?? current.protein,
      input.target_protein ?? current.target_protein,
      input.sodium ?? current.sodium,
      input.target_sodium ?? current.target_sodium,
      input.record_date ?? current.record_date,
      id,
    ]
  );
}

export async function deleteHealthRecord(id: string) {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE health_records
     SET deleted_at = datetime('now'), updated_at = datetime('now'),
         sync_status = CASE WHEN sync_status = 'pending_create' THEN 'pending_delete' ELSE 'pending_delete' END,
         version = version + 1
     WHERE id = ?`,
    [id]
  );
}
