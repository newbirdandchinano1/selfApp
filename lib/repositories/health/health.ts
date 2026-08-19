import { File } from 'expo-file-system';

import { ensureLocalRowForWrite } from '@/lib/api-local-row';
import { formatWallClockDatetimeLocal } from '@/lib/api-mysql-datetime';
import { readApiRecord, readApiTable } from '@/lib/api-read';
import { addDaysToYmd, compareDatetimeDesc, isYmdInRange, sortByUpdatedDesc } from '@/lib/api-read-helpers';
import { getDatabase } from '../../database.native';
import type {
  CreateHealthRecordInput,
  HealthIntakeDayTotals,
  HealthRecordRow,
  UpdateHealthRecordInput,
} from './health.types';

/** 接口常省略 user_id；空值视为当前默认用户 */
function healthRecordBelongsToUser(row: HealthRecordRow, userId: string): boolean {
  const rid = typeof row.user_id === 'string' ? row.user_id.trim() : '';
  return !rid || rid === userId;
}

/** 本地/接口 record_date 可能是 YYYY-MM-DD 或 ISO */
function healthRecordYmd(row: HealthRecordRow): string {
  const raw = typeof row.record_date === 'string' ? row.record_date.trim() : '';
  return /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : raw;
}

export async function createHealthRecord(input: CreateHealthRecordInput) {
  const db = await getDatabase();
  const now = formatWallClockDatetimeLocal(new Date());
  await db.runAsync(
    `INSERT INTO health_records (
      id, user_id, hydration, target_hydration, protein, target_protein, carbohydrate, target_carbohydrate, calories, target_calories, record_date, quick_add_key, intake_display_title, intake_ai_comment, source_image_uri,
      created_at, updated_at, sync_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_create')`,
    [
      input.id,
      input.user_id,
      input.hydration ?? 0,
      input.target_hydration ?? 0,
      input.protein ?? 0,
      input.target_protein ?? 0,
      input.carbohydrate ?? 0,
      input.target_carbohydrate ?? 0,
      input.calories ?? 0,
      input.target_calories ?? 0,
      input.record_date,
      input.quick_add_key ?? null,
      input.intake_display_title ?? null,
      input.intake_ai_comment ?? null,
      input.source_image_uri ?? null,
      now,
      now,
    ]
  );
  const { pushLocalChangesToApi } = await import('@/lib/api-write-sync');
  await pushLocalChangesToApi({ awaitSync: true });
}

export async function getHealthRecordById(id: string) {
  return readApiRecord<HealthRecordRow>('health_records', id, { offlineFallback: true });
}

export async function getHealthRecordsByUserId(userId: string) {
  const rows = await readApiTable<HealthRecordRow>('health_records', { offlineFallback: true });
  return sortByUpdatedDesc(rows.filter(r => healthRecordBelongsToUser(r, userId)));
}

export async function getHealthRecordsLast7Days(
  userId: string,
  endDate: string = new Date().toISOString().slice(0, 10),
  opts?: { localOnly?: boolean },
) {
  const startDate = addDaysToYmd(endDate, -6);
  const rows = await readApiTable<HealthRecordRow>('health_records', {
    offlineFallback: true,
    localOnly: opts?.localOnly,
  });
  return rows
    .filter(r => healthRecordBelongsToUser(r, userId) && isYmdInRange(healthRecordYmd(r), startDate, endDate))
    .sort((a, b) => {
      const d = a.record_date.localeCompare(b.record_date);
      if (d !== 0) return d;
      return compareDatetimeDesc(a.updated_at, b.updated_at) * -1;
    });
}

export async function getLatestHealthRecordForUserOnDate(userId: string, recordDateYmd: string) {
  const rows = await readApiTable<HealthRecordRow>('health_records', { offlineFallback: true });
  const dayRows = rows.filter(r => healthRecordBelongsToUser(r, userId) && healthRecordYmd(r) === recordDateYmd);
  if (dayRows.length === 0) return null;
  return [...dayRows].sort((a, b) => compareDatetimeDesc(a.updated_at, b.updated_at))[0] ?? null;
}

export async function getHealthRecordsForUserOnDate(userId: string, recordDateYmd: string) {
  const rows = await readApiTable<HealthRecordRow>('health_records', { offlineFallback: true });
  return rows
    .filter(r => healthRecordBelongsToUser(r, userId) && healthRecordYmd(r) === recordDateYmd)
    .sort((a, b) => compareDatetimeDesc(a.created_at, b.created_at) * -1);
}

export async function getHealthDayMetricsForUser(
  userId: string,
  recordDateYmd: string,
  opts?: { localOnly?: boolean },
): Promise<{ totals: HealthIntakeDayTotals; latest: HealthRecordRow } | null> {
  const rows = await readApiTable<HealthRecordRow>('health_records', {
    offlineFallback: true,
    localOnly: opts?.localOnly,
  });
  const dayRows = rows.filter(r => healthRecordBelongsToUser(r, userId) && healthRecordYmd(r) === recordDateYmd);
  if (dayRows.length === 0) return null;
  const latest = [...dayRows].sort((a, b) => compareDatetimeDesc(a.updated_at, b.updated_at))[0]!;
  return { totals: sumHealthIntakeDayTotals(dayRows), latest };
}

function sumHealthIntakeDayTotals(dayRows: HealthRecordRow[]): HealthIntakeDayTotals {
  let hydration = 0;
  let protein = 0;
  let carbohydrate = 0;
  let calories = 0;
  for (const r of dayRows) {
    hydration += Number(r.hydration ?? 0);
    protein += Number(r.protein ?? 0);
    carbohydrate += Number(r.carbohydrate ?? 0);
    calories += Number(r.calories ?? 0);
  }
  return { hydration, protein, carbohydrate, calories };
}

export async function getHealthIntakeTotalsForUserOnDate(
  userId: string,
  recordDateYmd: string
): Promise<HealthIntakeDayTotals | null> {
  const rows = await readApiTable<HealthRecordRow>('health_records', { offlineFallback: true });
  const dayRows = rows.filter(r => healthRecordBelongsToUser(r, userId) && healthRecordYmd(r) === recordDateYmd);
  if (dayRows.length === 0) return null;
  return sumHealthIntakeDayTotals(dayRows);
}

export type HomeHealthSlice = {
  week: HealthRecordRow[];
  prevWeek: HealthRecordRow[];
  dayTotals: HealthIntakeDayTotals | null;
  dayRecords: HealthRecordRow[];
};

/** 单次读表，避免首页并行多次 readApiTable 互相抢占读库上下文 */
export async function fetchUserHomeHealthSlice(
  userId: string,
  weekAnchorEndYmd: string,
  selectedYmd: string,
  opts?: { localOnly?: boolean },
): Promise<HomeHealthSlice> {
  const prevEndYmd = addDaysToYmd(weekAnchorEndYmd, -7);
  const weekStart = addDaysToYmd(weekAnchorEndYmd, -6);
  const prevWeekStart = addDaysToYmd(prevEndYmd, -6);

  const allRows = await readApiTable<HealthRecordRow>('health_records', {
    offlineFallback: true,
    localOnly: opts?.localOnly,
  });
  const userRows = allRows.filter(r => healthRecordBelongsToUser(r, userId));

  const sortWeekRows = (a: HealthRecordRow, b: HealthRecordRow) => {
    const d = a.record_date.localeCompare(b.record_date);
    if (d !== 0) return d;
    return compareDatetimeDesc(a.updated_at, b.updated_at) * -1;
  };

  const week = userRows
    .filter(r => isYmdInRange(healthRecordYmd(r), weekStart, weekAnchorEndYmd))
    .sort(sortWeekRows);
  const prevWeek = userRows
    .filter(r => isYmdInRange(healthRecordYmd(r), prevWeekStart, prevEndYmd))
    .sort(sortWeekRows);
  const dayRecords = userRows
    .filter(r => healthRecordYmd(r) === selectedYmd)
    .sort((a, b) => compareDatetimeDesc(a.created_at, b.created_at) * -1);
  const dayRows = userRows.filter(r => healthRecordYmd(r) === selectedYmd);
  const dayTotals = dayRows.length > 0 ? sumHealthIntakeDayTotals(dayRows) : null;

  return { week, prevWeek, dayTotals, dayRecords };
}

/** 健康日历：单次读表后计算时间轴与完成度 */
export async function buildUserHealthCalendarSnapshot(
  userId: string,
  today: Date,
  opts?: { localOnly?: boolean },
): Promise<{
  records: HealthRecordRow[];
  completionMap: Map<string, 'full' | 'partial'>;
  startDate: Date;
}> {
  const allRows = await readApiTable<HealthRecordRow>('health_records', {
    offlineFallback: true,
    localOnly: opts?.localOnly,
  });
  const records = sortByUpdatedDesc(allRows.filter(r => healthRecordBelongsToUser(r, userId)));
  const completionMap = new Map<string, 'full' | 'partial'>();
  const datesByDay = new Map<string, HealthRecordRow[]>();

  for (const row of records) {
    const ymd = healthRecordYmd(row);
    const bucket = datesByDay.get(ymd);
    if (bucket) bucket.push(row);
    else datesByDay.set(ymd, [row]);
  }

  for (const [ymd, dayRows] of datesByDay) {
    const totals = sumHealthIntakeDayTotals(dayRows);
    const latest = [...dayRows].sort((a, b) => compareDatetimeDesc(a.updated_at, b.updated_at))[0] ?? null;
    if (!latest) continue;
    const level = getDayCompletionLevelFromTotals(totals, latest);
    completionMap.set(ymd, level === 'full' ? 'full' : 'partial');
  }

  const earliestYmd =
    records.length > 0
      ? records.reduce((min, row) => {
          const ymd = healthRecordYmd(row);
          return ymd < min ? ymd : min;
        }, healthRecordYmd(records[0]!))
      : addDaysToYmd(formatHealthCalendarYmd(today), -29);
  const earliestDate = normalizeHealthCalendarDate(new Date(earliestYmd));
  const startDate = earliestDate > today ? today : earliestDate;
  return { records, completionMap, startDate };
}

function formatHealthCalendarYmd(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function normalizeHealthCalendarDate(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function getDayCompletionLevelFromTotals(
  totals: HealthIntakeDayTotals,
  latest: HealthRecordRow,
): 'full' | 'partial' | 'empty' {
  const hMet = latest.target_hydration > 0 ? totals.hydration >= latest.target_hydration : false;
  const pMet = latest.target_protein > 0 ? totals.protein >= latest.target_protein : false;
  const cMet = latest.target_carbohydrate > 0 ? totals.carbohydrate >= latest.target_carbohydrate : false;
  const calMet = latest.target_calories > 0 ? totals.calories <= latest.target_calories : false;
  const metCount = [hMet, pMet, cMet, calMet].filter(Boolean).length;
  if (metCount >= 4) return 'full';
  if (metCount > 0 || totals.hydration > 0 || totals.protein > 0 || totals.carbohydrate > 0 || totals.calories > 0) {
    return 'partial';
  }
  return 'empty';
}

export async function updateHealthRecord(id: string, input: UpdateHealthRecordInput) {
  const db = await getDatabase();
  const current = await ensureLocalRowForWrite<HealthRecordRow>('health_records', id);

  if (!current) {
    return;
  }

  const now = formatWallClockDatetimeLocal(new Date());
  await db.runAsync(
    `UPDATE health_records
     SET hydration = ?, target_hydration = ?, protein = ?, target_protein = ?, carbohydrate = ?, target_carbohydrate = ?, calories = ?, target_calories = ?, record_date = ?, quick_add_key = ?, intake_display_title = ?, intake_ai_comment = ?, source_image_uri = ?, updated_at = ?,
         sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_update' ELSE sync_status END
     WHERE id = ?`,
    [
      input.hydration ?? current.hydration,
      input.target_hydration ?? current.target_hydration,
      input.protein ?? current.protein,
      input.target_protein ?? current.target_protein,
      input.carbohydrate ?? current.carbohydrate,
      input.target_carbohydrate ?? current.target_carbohydrate,
      input.calories ?? current.calories,
      input.target_calories ?? current.target_calories,
      input.record_date ?? current.record_date,
      input.quick_add_key !== undefined ? input.quick_add_key : current.quick_add_key,
      input.intake_display_title !== undefined ? input.intake_display_title : current.intake_display_title ?? null,
      input.intake_ai_comment !== undefined ? input.intake_ai_comment : current.intake_ai_comment ?? null,
      input.source_image_uri !== undefined ? input.source_image_uri : current.source_image_uri ?? null,
      now,
      id,
    ]
  );
  const { pushLocalChangesToApi } = await import('@/lib/api-write-sync');
  await pushLocalChangesToApi({ awaitSync: true });
}

export async function deleteHealthRecord(id: string) {
  const db = await getDatabase();
  const existing = await ensureLocalRowForWrite<HealthRecordRow>('health_records', id);
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
     SET updated_at = ?,
         sync_status = CASE WHEN sync_status = 'pending_create' THEN 'pending_delete' ELSE 'pending_delete' END
     WHERE id = ?`,
    [formatWallClockDatetimeLocal(new Date()), id],
  );
  const { pushLocalChangesToApi } = await import('@/lib/api-write-sync');
  await pushLocalChangesToApi({ awaitSync: true });
}
