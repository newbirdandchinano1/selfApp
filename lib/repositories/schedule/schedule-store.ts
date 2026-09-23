import { makeTimestampEntityId } from '@/lib/entity-id';
import { getDatabase, type SyncStatus } from '@/lib/database.native';
import { markCloudSqliteTableDirty } from '@/lib/cloud-sql-dirty-track';
import {
  DEFAULT_SCHEDULE_AXIS,
  SCHEDULE_AXIS_SETTING_KEY,
  type ScheduleAxisSettings,
  type SchedulePlacementInput,
  type SchedulePlacementRow,
  type ScheduleSlotHours,
  type ScheduleSubjectKind,
  type ScheduleWeekAxisSnapshot,
} from '@/lib/schedule/types';
import { clampSlotHours, normalizeAxisSettings } from '@/lib/schedule/axis';
import { getAppSetting, setAppSetting } from '@/lib/app-settings-store';

export function createSchedulePlacementId(): string {
  return makeTimestampEntityId('scp_', 8);
}

function sqlNow(): string {
  return new Date().toISOString();
}

function markScheduleDirty(): void {
  markCloudSqliteTableDirty('schedule_placements');
  markCloudSqliteTableDirty('schedule_week_axis_snapshot');
}

type PlacementDbRow = {
  id: string;
  week_start_ymd: string;
  weekday: number;
  start_slot_index: number | null;
  span_slots: number;
  subject_kind: string;
  subject_id: string;
  orphaned: number;
  created_at: string;
  updated_at: string;
  sync_status: SyncStatus;
};

function mapPlacement(row: PlacementDbRow): SchedulePlacementRow {
  return {
    id: row.id,
    weekStartYmd: row.week_start_ymd,
    weekday: row.weekday,
    startSlotIndex: row.start_slot_index,
    spanSlots: row.span_slots,
    subjectKind: (row.subject_kind === 'project' ? 'project' : 'task') as ScheduleSubjectKind,
    subjectId: row.subject_id,
    orphaned: row.orphaned ? 1 : 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    syncStatus: row.sync_status,
  };
}

export async function getScheduleAxisSettings(): Promise<ScheduleAxisSettings> {
  const raw = await getAppSetting<unknown>(SCHEDULE_AXIS_SETTING_KEY);
  const normalized = normalizeAxisSettings(
    raw && typeof raw === 'object' ? (raw as Partial<ScheduleAxisSettings>) : null,
  );
  const updatedAt =
    raw && typeof raw === 'object' && typeof (raw as ScheduleAxisSettings).updatedAt === 'string'
      ? (raw as ScheduleAxisSettings).updatedAt
      : sqlNow();
  return { ...normalized, updatedAt };
}

export async function saveScheduleAxisSettingsLocal(
  next: Omit<ScheduleAxisSettings, 'updatedAt'>,
): Promise<ScheduleAxisSettings> {
  const normalized = normalizeAxisSettings(next);
  const payload: ScheduleAxisSettings = { ...normalized, updatedAt: sqlNow() };
  await setAppSetting(SCHEDULE_AXIS_SETTING_KEY, payload);
  return payload;
}

export async function getWeekAxisSnapshot(weekStartYmd: string): Promise<ScheduleWeekAxisSnapshot | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{
    week_start_ymd: string;
    start_minutes: number;
    end_minutes: number;
    slot_hours: number;
    created_at: string;
  }>('SELECT * FROM schedule_week_axis_snapshot WHERE week_start_ymd = ? LIMIT 1', [weekStartYmd]);
  if (!row) return null;
  return {
    weekStartYmd: row.week_start_ymd,
    startMinutes: row.start_minutes,
    endMinutes: row.end_minutes,
    slotHours: clampSlotHours(row.slot_hours),
    createdAt: row.created_at,
  };
}

export async function upsertWeekAxisSnapshot(
  weekStartYmd: string,
  axis: { startMinutes: number; endMinutes: number; slotHours: ScheduleSlotHours },
): Promise<ScheduleWeekAxisSnapshot> {
  const db = await getDatabase();
  const existing = await getWeekAxisSnapshot(weekStartYmd);
  if (existing) return existing;
  const createdAt = sqlNow();
  await db.runAsync(
    `INSERT INTO schedule_week_axis_snapshot
      (week_start_ymd, start_minutes, end_minutes, slot_hours, created_at, sync_status)
     VALUES (?, ?, ?, ?, ?, 'pending_create')`,
    [weekStartYmd, axis.startMinutes, axis.endMinutes, axis.slotHours, createdAt],
  );
  markCloudSqliteTableDirty('schedule_week_axis_snapshot');
  return {
    weekStartYmd,
    startMinutes: axis.startMinutes,
    endMinutes: axis.endMinutes,
    slotHours: axis.slotHours,
    createdAt,
  };
}

export async function listPlacementsForWeek(weekStartYmd: string): Promise<SchedulePlacementRow[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<PlacementDbRow>(
    `SELECT * FROM schedule_placements
     WHERE week_start_ymd = ? AND sync_status != 'pending_delete'
     ORDER BY weekday ASC, orphaned ASC, start_slot_index ASC, created_at ASC`,
    [weekStartYmd],
  );
  return rows.map(mapPlacement);
}

export async function listPlacementsForEditableWeeks(
  thisWeekStartYmd: string,
): Promise<SchedulePlacementRow[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<PlacementDbRow>(
    `SELECT * FROM schedule_placements
     WHERE week_start_ymd >= ? AND sync_status != 'pending_delete'`,
    [thisWeekStartYmd],
  );
  return rows.map(mapPlacement);
}

export async function listOrphanedPlacements(): Promise<SchedulePlacementRow[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<PlacementDbRow>(
    `SELECT * FROM schedule_placements
     WHERE orphaned = 1 AND sync_status != 'pending_delete'
     ORDER BY updated_at DESC`,
  );
  return rows.map(mapPlacement);
}

export async function getPlacementById(id: string): Promise<SchedulePlacementRow | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<PlacementDbRow>(
    `SELECT * FROM schedule_placements WHERE id = ? AND sync_status != 'pending_delete' LIMIT 1`,
    [id],
  );
  return row ? mapPlacement(row) : null;
}

export async function insertPlacement(input: SchedulePlacementInput): Promise<SchedulePlacementRow> {
  const db = await getDatabase();
  const id = createSchedulePlacementId();
  const now = sqlNow();
  await db.runAsync(
    `INSERT INTO schedule_placements (
      id, week_start_ymd, weekday, start_slot_index, span_slots,
      subject_kind, subject_id, orphaned, created_at, updated_at, sync_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 'pending_create')`,
    [
      id,
      input.weekStartYmd,
      input.weekday,
      input.startSlotIndex,
      Math.max(1, input.spanSlots),
      input.subjectKind,
      input.subjectId,
      now,
      now,
    ],
  );
  markScheduleDirty();
  return {
    id,
    weekStartYmd: input.weekStartYmd,
    weekday: input.weekday,
    startSlotIndex: input.startSlotIndex,
    spanSlots: Math.max(1, input.spanSlots),
    subjectKind: input.subjectKind,
    subjectId: input.subjectId,
    orphaned: 0,
    createdAt: now,
    updatedAt: now,
    syncStatus: 'pending_create',
  };
}

export async function updatePlacementSlots(
  id: string,
  patch: { startSlotIndex: number | null; spanSlots?: number; orphaned: boolean },
): Promise<void> {
  const db = await getDatabase();
  const now = sqlNow();
  await db.runAsync(
    `UPDATE schedule_placements SET
      start_slot_index = ?,
      span_slots = COALESCE(?, span_slots),
      orphaned = ?,
      updated_at = ?,
      sync_status = CASE
        WHEN sync_status = 'pending_create' THEN 'pending_create'
        WHEN sync_status = 'pending_delete' THEN 'pending_delete'
        ELSE 'pending_update'
      END
     WHERE id = ?`,
    [
      patch.startSlotIndex,
      patch.spanSlots ?? null,
      patch.orphaned ? 1 : 0,
      now,
      id,
    ],
  );
  markScheduleDirty();
}

export async function softDeletePlacement(id: string): Promise<void> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ sync_status: SyncStatus }>(
    'SELECT sync_status FROM schedule_placements WHERE id = ?',
    [id],
  );
  if (!row) return;
  if (row.sync_status === 'pending_create') {
    await db.runAsync('DELETE FROM schedule_placements WHERE id = ?', [id]);
  } else {
    await db.runAsync(
      `UPDATE schedule_placements SET
        sync_status = 'pending_delete',
        updated_at = ?
       WHERE id = ?`,
      [sqlNow(), id],
    );
  }
  markScheduleDirty();
}

export async function softDeletePlacementsForWeek(weekStartYmd: string): Promise<number> {
  const rows = await listPlacementsForWeek(weekStartYmd);
  for (const r of rows) {
    await softDeletePlacement(r.id);
  }
  return rows.length;
}

export async function countSubjectPlacementsOnDay(
  weekStartYmd: string,
  weekday: number,
  subjectKind: ScheduleSubjectKind,
  subjectId: string,
  excludeId?: string,
): Promise<number> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ c: number }>(
    `SELECT COUNT(*) as c FROM schedule_placements
     WHERE week_start_ymd = ? AND weekday = ?
       AND subject_kind = ? AND subject_id = ?
       AND sync_status != 'pending_delete'
       AND orphaned = 0
       AND (? IS NULL OR id != ?)`,
    [weekStartYmd, weekday, subjectKind, subjectId, excludeId ?? null, excludeId ?? null],
  );
  return row?.c ?? 0;
}

export async function listSubjectPlacementsOnDay(
  weekStartYmd: string,
  weekday: number,
  subjectKind: ScheduleSubjectKind,
  subjectId: string,
): Promise<SchedulePlacementRow[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<PlacementDbRow>(
    `SELECT * FROM schedule_placements
     WHERE week_start_ymd = ? AND weekday = ?
       AND subject_kind = ? AND subject_id = ?
       AND sync_status != 'pending_delete'`,
    [weekStartYmd, weekday, subjectKind, subjectId],
  );
  return rows.map(mapPlacement);
}

/** 确保表存在（与 database.native 迁移双保险） */
export async function ensureScheduleTables(): Promise<void> {
  const db = await getDatabase();
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS schedule_week_axis_snapshot (
      week_start_ymd TEXT PRIMARY KEY NOT NULL,
      start_minutes INTEGER NOT NULL,
      end_minutes INTEGER NOT NULL,
      slot_hours INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      sync_status TEXT NOT NULL DEFAULT 'pending_create'
    );
    CREATE TABLE IF NOT EXISTS schedule_placements (
      id TEXT PRIMARY KEY NOT NULL,
      week_start_ymd TEXT NOT NULL,
      weekday INTEGER NOT NULL,
      start_slot_index INTEGER,
      span_slots INTEGER NOT NULL DEFAULT 1,
      subject_kind TEXT NOT NULL,
      subject_id TEXT NOT NULL,
      orphaned INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      sync_status TEXT NOT NULL DEFAULT 'pending_create'
    );
    CREATE INDEX IF NOT EXISTS idx_schedule_placements_week
      ON schedule_placements(week_start_ymd, weekday);
  `);
}

export { DEFAULT_SCHEDULE_AXIS };
