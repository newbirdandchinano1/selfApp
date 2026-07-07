import { getAppSettingRaw, removeAppSetting } from '@/lib/app-settings-store';
import { makeCompositeEntityId, makeTimestampEntityId } from '@/lib/entity-id';
import { getDatabase } from '@/lib/database';
import { markCloudSqliteTableDirty } from '@/lib/cloud-sql-dirty-track';
import { invalidateInflightApiTableFetch } from '@/lib/api-read';
import type {
  WeeklyTaskScheduleCellRow,
  WeeklyTaskScheduleData,
  WeeklyTaskScheduleSlot,
  WeeklyTaskScheduleSlotRow,
} from './weekly-task-schedule.types';

export const WEEKLY_TASK_SCHEDULE_DAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] as const;

export const WEEKLY_TASK_SCHEDULE_MIN_HOUR = 6;
export const WEEKLY_TASK_SCHEDULE_MAX_HOUR = 22;

const LEGACY_APP_SETTING_KEY = '@weekly_task_schedule_v1';
const SLOT_ID_PREFIX = 'wtss_';
const CELL_ID_PREFIX = 'wtsc_';
const MIGRATION_META_KEY = 'weekly_task_schedule_sqlite_v1';

export function formatScheduleHour(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

export function formatScheduleSlotLabel(startHour: number, endHour: number): string {
  return `${formatScheduleHour(startHour)}-${formatScheduleHour(endHour)}`;
}

export function weeklyTaskScheduleCellKey(slotId: string, dayOfWeek: number): string {
  return `${slotId}-${dayOfWeek}`;
}

function slotDurationHours(slot: Pick<WeeklyTaskScheduleSlot, 'startHour' | 'endHour'>): number {
  return slot.endHour - slot.startHour;
}

function rowToSlot(row: WeeklyTaskScheduleSlotRow): WeeklyTaskScheduleSlot {
  return {
    id: row.id,
    startHour: row.start_hour,
    endHour: row.end_hour,
    sortOrder: row.sort_order,
    label: formatScheduleSlotLabel(row.start_hour, row.end_hour),
  };
}

function defaultSlotId(startHour: number, endHour: number): string {
  return `${SLOT_ID_PREFIX}${startHour}_${endHour}`;
}

function cellEntityId(slotId: string, dayOfWeek: number): string {
  return makeCompositeEntityId(CELL_ID_PREFIX, slotId, String(dayOfWeek));
}

function markWeeklyTaskScheduleDirty(): void {
  markCloudSqliteTableDirty('weekly_task_schedule_slots');
  markCloudSqliteTableDirty('weekly_task_schedule_cells');
}

function invalidateWeeklyTaskScheduleApiCache(): void {
  invalidateInflightApiTableFetch('weekly_task_schedule_slots');
  invalidateInflightApiTableFetch('weekly_task_schedule_cells');
}

async function pushWeeklyTaskScheduleChangesToApi(opts?: { awaitSync?: boolean }): Promise<void> {
  invalidateWeeklyTaskScheduleApiCache();
  if (opts?.awaitSync) {
    const { flushApiDirtyTablesNow } = await import('@/lib/api-incremental-sync');
    await flushApiDirtyTablesNow();
    return;
  }
  const { pushLocalChangesToApi } = await import('@/lib/api-write-sync');
  void pushLocalChangesToApi();
}

async function deleteLocalRowForApiSync(
  db: NonNullable<Awaited<ReturnType<typeof getDatabase>>>,
  table: 'weekly_task_schedule_slots' | 'weekly_task_schedule_cells',
  id: string,
  syncStatus: string,
): Promise<void> {
  if (syncStatus === 'pending_create') {
    await db.runAsync(`DELETE FROM ${table} WHERE id = ?`, [id]);
    return;
  }
  const now = new Date().toISOString();
  await db.runAsync(
    `UPDATE ${table}
     SET updated_at = ?,
       sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_delete' ELSE sync_status END
     WHERE id = ?`,
    [now, id],
  );
}

async function listSlotRows(db: NonNullable<Awaited<ReturnType<typeof getDatabase>>>): Promise<WeeklyTaskScheduleSlotRow[]> {
  return db.getAllAsync<WeeklyTaskScheduleSlotRow>(
    `SELECT id, start_hour, end_hour, sort_order, created_at, updated_at, sync_status
     FROM weekly_task_schedule_slots
     WHERE sync_status != 'pending_delete'
     ORDER BY sort_order ASC, start_hour ASC`,
  );
}

async function listCellRows(db: NonNullable<Awaited<ReturnType<typeof getDatabase>>>): Promise<WeeklyTaskScheduleCellRow[]> {
  return db.getAllAsync<WeeklyTaskScheduleCellRow>(
    `SELECT id, slot_id, day_of_week, content, created_at, updated_at, sync_status
     FROM weekly_task_schedule_cells
     WHERE sync_status != 'pending_delete'
       AND TRIM(content) != ''`,
  );
}

function buildScheduleData(
  slotRows: WeeklyTaskScheduleSlotRow[],
  cellRows: WeeklyTaskScheduleCellRow[],
): WeeklyTaskScheduleData {
  const slots = slotRows.map(rowToSlot);
  const cells: Record<string, string> = {};
  for (const row of cellRows) {
    const trimmed = row.content.trim();
    if (!trimmed) continue;
    cells[weeklyTaskScheduleCellKey(row.slot_id, row.day_of_week)] = trimmed;
  }
  return { slots, cells };
}

export async function ensureWeeklyTaskScheduleDefaults(
  db: NonNullable<Awaited<ReturnType<typeof getDatabase>>>,
): Promise<void> {
  const count = await db.getFirstAsync<{ c: number }>(
    'SELECT COUNT(*) AS c FROM weekly_task_schedule_slots',
  );
  if ((count?.c ?? 0) > 0) return;

  const now = new Date().toISOString();
  for (let hour = WEEKLY_TASK_SCHEDULE_MIN_HOUR; hour < WEEKLY_TASK_SCHEDULE_MAX_HOUR; hour += 1) {
    const endHour = hour + 1;
    await db.runAsync(
      `INSERT INTO weekly_task_schedule_slots (
        id, start_hour, end_hour, sort_order, created_at, updated_at, sync_status
      ) VALUES (?, ?, ?, ?, ?, ?, 'pending_create')`,
      [defaultSlotId(hour, endHour), hour, endHour, hour * 100, now, now],
    );
  }
}

async function migrateLegacyAppSettingsSchedule(
  db: NonNullable<Awaited<ReturnType<typeof getDatabase>>>,
): Promise<void> {
  const raw = await getAppSettingRaw(LEGACY_APP_SETTING_KEY);
  if (!raw?.trim()) return;

  let parsed: { timeSlots?: unknown; cells?: unknown } | null = null;
  try {
    parsed = JSON.parse(raw) as { timeSlots?: unknown; cells?: unknown };
  } catch {
    parsed = null;
  }
  if (!parsed) return;

  const legacySlots = Array.isArray(parsed.timeSlots)
    ? parsed.timeSlots
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter(Boolean)
    : [];
  const legacyCells =
    parsed.cells && typeof parsed.cells === 'object' && !Array.isArray(parsed.cells)
      ? (parsed.cells as Record<string, string>)
      : {};

  const now = new Date().toISOString();
  const slotIdByIndex: string[] = [];

  if (legacySlots.length > 0) {
    await db.runAsync('DELETE FROM weekly_task_schedule_cells');
    await db.runAsync('DELETE FROM weekly_task_schedule_slots');

    for (let index = 0; index < legacySlots.length; index += 1) {
      const label = legacySlots[index]!;
      const match = label.match(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/);
      const startHour = match ? Number(match[1]) : WEEKLY_TASK_SCHEDULE_MIN_HOUR + index;
      const endHour = match ? Number(match[3]) : startHour + 1;
      const id = defaultSlotId(startHour, endHour);
      slotIdByIndex[index] = id;
      await db.runAsync(
        `INSERT INTO weekly_task_schedule_slots (
          id, start_hour, end_hour, sort_order, created_at, updated_at, sync_status
        ) VALUES (?, ?, ?, ?, ?, ?, 'pending_create')`,
        [id, startHour, endHour, index * 100, now, now],
      );
    }
  } else {
    await ensureWeeklyTaskScheduleDefaults(db);
    const rows = await listSlotRows(db);
    rows.forEach((row, index) => {
      slotIdByIndex[index] = row.id;
    });
  }

  for (const [key, value] of Object.entries(legacyCells)) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const [dayPart, slotPart] = key.split('-');
    const dayOfWeek = Number(dayPart);
    const slotIndex = Number(slotPart);
    const slotId = slotIdByIndex[slotIndex];
    if (!slotId || !Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) continue;
    await db.runAsync(
      `INSERT INTO weekly_task_schedule_cells (
        id, slot_id, day_of_week, content, created_at, updated_at, sync_status
      ) VALUES (?, ?, ?, ?, ?, ?, 'pending_create')
      ON CONFLICT(slot_id, day_of_week) DO UPDATE SET
        content = excluded.content,
        updated_at = excluded.updated_at,
        sync_status = CASE
          WHEN weekly_task_schedule_cells.sync_status = 'synced' THEN 'pending_update'
          ELSE weekly_task_schedule_cells.sync_status
        END`,
      [cellEntityId(slotId, dayOfWeek), slotId, dayOfWeek, trimmed, now, now],
    );
  }

  await removeAppSetting(LEGACY_APP_SETTING_KEY);
  markWeeklyTaskScheduleDirty();
}

export async function migrateWeeklyTaskScheduleToSqliteIfNeeded(
  db: NonNullable<Awaited<ReturnType<typeof getDatabase>>>,
): Promise<void> {
  const done = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM app_meta WHERE key = ? LIMIT 1',
    [MIGRATION_META_KEY],
  );
  if (done?.value === '1') {
    await ensureWeeklyTaskScheduleDefaults(db);
    return;
  }

  await ensureWeeklyTaskScheduleDefaults(db);
  await migrateLegacyAppSettingsSchedule(db);

  await db.runAsync('INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)', [
    MIGRATION_META_KEY,
    '1',
  ]);
}

export async function loadWeeklyTaskSchedule(): Promise<WeeklyTaskScheduleData> {
  const db = await getDatabase();
  if (!db) return { slots: [], cells: {} };
  await migrateWeeklyTaskScheduleToSqliteIfNeeded(db);
  const [slotRows, cellRows] = await Promise.all([listSlotRows(db), listCellRows(db)]);
  return buildScheduleData(slotRows, cellRows);
}

export function getWeeklyTaskScheduleCell(
  data: WeeklyTaskScheduleData,
  slotId: string,
  dayOfWeek: number,
): string {
  return data.cells[weeklyTaskScheduleCellKey(slotId, dayOfWeek)] ?? '';
}

export async function upsertWeeklyTaskScheduleCell(
  slotId: string,
  dayOfWeek: number,
  content: string,
): Promise<WeeklyTaskScheduleData> {
  const db = await getDatabase();
  if (!db) throw new Error('database not available');
  await migrateWeeklyTaskScheduleToSqliteIfNeeded(db);

  const trimmed = content.trim();
  const now = new Date().toISOString();
  const id = cellEntityId(slotId, dayOfWeek);

  if (!trimmed) {
    const existing = await db.getFirstAsync<{ id: string; sync_status: string }>(
      `SELECT id, sync_status FROM weekly_task_schedule_cells
       WHERE slot_id = ? AND day_of_week = ? LIMIT 1`,
      [slotId, dayOfWeek],
    );
    if (existing) {
      await deleteLocalRowForApiSync(db, 'weekly_task_schedule_cells', existing.id, existing.sync_status);
    }
  } else {
    await db.runAsync(
      `INSERT INTO weekly_task_schedule_cells (
        id, slot_id, day_of_week, content, created_at, updated_at, sync_status
      ) VALUES (?, ?, ?, ?, ?, ?, 'pending_create')
      ON CONFLICT(slot_id, day_of_week) DO UPDATE SET
        content = excluded.content,
        updated_at = excluded.updated_at,
        sync_status = CASE
          WHEN weekly_task_schedule_cells.sync_status = 'synced' THEN 'pending_update'
          ELSE weekly_task_schedule_cells.sync_status
        END`,
      [id, slotId, dayOfWeek, trimmed, now, now],
    );
  }

  markWeeklyTaskScheduleDirty();
  void pushWeeklyTaskScheduleChangesToApi({ awaitSync: true });
  return loadWeeklyTaskSchedule();
}

function joinCellContent(a: string, b: string): string {
  const left = a.trim();
  const right = b.trim();
  if (!left) return right;
  if (!right) return left;
  if (left.includes(right)) return left;
  if (right.includes(left)) return right;
  return `${left}\n${right}`;
}

async function moveCellsOnSlotMerge(
  db: NonNullable<Awaited<ReturnType<typeof getDatabase>>>,
  fromSlotId: string,
  toSlotId: string,
): Promise<void> {
  const rows = await db.getAllAsync<WeeklyTaskScheduleCellRow>(
    `SELECT id, slot_id, day_of_week, content, created_at, updated_at, sync_status
     FROM weekly_task_schedule_cells
     WHERE slot_id = ?`,
    [fromSlotId],
  );
  const now = new Date().toISOString();
  for (const row of rows) {
    const trimmed = row.content.trim();
    if (!trimmed) continue;
    const target = await db.getFirstAsync<{ content: string }>(
      `SELECT content FROM weekly_task_schedule_cells
       WHERE slot_id = ? AND day_of_week = ? LIMIT 1`,
      [toSlotId, row.day_of_week],
    );
    const merged = joinCellContent(target?.content ?? '', trimmed);
    await db.runAsync(
      `INSERT INTO weekly_task_schedule_cells (
        id, slot_id, day_of_week, content, created_at, updated_at, sync_status
      ) VALUES (?, ?, ?, ?, ?, ?, 'pending_create')
      ON CONFLICT(slot_id, day_of_week) DO UPDATE SET
        content = excluded.content,
        updated_at = excluded.updated_at,
        sync_status = CASE
          WHEN weekly_task_schedule_cells.sync_status = 'synced' THEN 'pending_update'
          ELSE weekly_task_schedule_cells.sync_status
        END`,
      [cellEntityId(toSlotId, row.day_of_week), toSlotId, row.day_of_week, merged, now, now],
    );
  }
  const sourceCells = await db.getAllAsync<{ id: string; sync_status: string }>(
    `SELECT id, sync_status FROM weekly_task_schedule_cells WHERE slot_id = ?`,
    [fromSlotId],
  );
  for (const cell of sourceCells) {
    await deleteLocalRowForApiSync(db, 'weekly_task_schedule_cells', cell.id, cell.sync_status);
  }
}

export async function mergeWeeklyTaskScheduleSlotWithNext(slotId: string): Promise<WeeklyTaskScheduleData> {
  const db = await getDatabase();
  if (!db) throw new Error('database not available');
  await migrateWeeklyTaskScheduleToSqliteIfNeeded(db);

  const slots = await listSlotRows(db);
  const index = slots.findIndex((row) => row.id === slotId);
  if (index < 0 || index >= slots.length - 1) {
    throw new Error('无法与下一时段合并');
  }
  const current = slots[index]!;
  const next = slots[index + 1]!;
  if (current.end_hour !== next.start_hour) {
    throw new Error('只能合并相邻时段');
  }

  const now = new Date().toISOString();
  await db.execAsync('BEGIN IMMEDIATE');
  try {
    await moveCellsOnSlotMerge(db, next.id, current.id);
    await db.runAsync(
      `UPDATE weekly_task_schedule_slots
       SET end_hour = ?, updated_at = ?,
         sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_update' ELSE sync_status END
       WHERE id = ?`,
      [next.end_hour, now, current.id],
    );
    await deleteLocalRowForApiSync(db, 'weekly_task_schedule_slots', next.id, next.sync_status);
    await db.execAsync('COMMIT');
  } catch (e) {
    await db.execAsync('ROLLBACK');
    throw e;
  }

  markWeeklyTaskScheduleDirty();
  void pushWeeklyTaskScheduleChangesToApi({ awaitSync: true });
  return loadWeeklyTaskSchedule();
}

export async function splitWeeklyTaskScheduleSlot(slotId: string): Promise<WeeklyTaskScheduleData> {
  const db = await getDatabase();
  if (!db) throw new Error('database not available');
  await migrateWeeklyTaskScheduleToSqliteIfNeeded(db);

  const slot = await db.getFirstAsync<WeeklyTaskScheduleSlotRow>(
    `SELECT id, start_hour, end_hour, sort_order, created_at, updated_at, sync_status
     FROM weekly_task_schedule_slots WHERE id = ? LIMIT 1`,
    [slotId],
  );
  if (!slot) throw new Error('时段不存在');
  if (slotDurationHours({ startHour: slot.start_hour, endHour: slot.end_hour }) <= 1) {
    throw new Error('该时段已是最小 1 小时，无法继续拆分');
  }

  const splitAt = slot.start_hour + 1;
  const newSlotId = makeTimestampEntityId(SLOT_ID_PREFIX);
  const now = new Date().toISOString();

  await db.execAsync('BEGIN IMMEDIATE');
  try {
    await db.runAsync(
      `UPDATE weekly_task_schedule_slots
       SET end_hour = ?, updated_at = ?,
         sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_update' ELSE sync_status END
       WHERE id = ?`,
      [splitAt, now, slot.id],
    );
    await db.runAsync(
      `INSERT INTO weekly_task_schedule_slots (
        id, start_hour, end_hour, sort_order, created_at, updated_at, sync_status
      ) VALUES (?, ?, ?, ?, ?, ?, 'pending_create')`,
      [newSlotId, splitAt, slot.end_hour, slot.sort_order + 1, now, now],
    );
    await db.execAsync('COMMIT');
  } catch (e) {
    await db.execAsync('ROLLBACK');
    throw e;
  }

  markWeeklyTaskScheduleDirty();
  void pushWeeklyTaskScheduleChangesToApi({ awaitSync: true });
  return loadWeeklyTaskSchedule();
}

export function canMergeWeeklyTaskScheduleSlot(
  data: WeeklyTaskScheduleData,
  slotId: string,
): boolean {
  const index = data.slots.findIndex((slot) => slot.id === slotId);
  if (index < 0 || index >= data.slots.length - 1) return false;
  const current = data.slots[index]!;
  const next = data.slots[index + 1]!;
  return current.endHour === next.startHour;
}

export function canSplitWeeklyTaskScheduleSlot(
  data: WeeklyTaskScheduleData,
  slotId: string,
): boolean {
  const slot = data.slots.find((item) => item.id === slotId);
  if (!slot) return false;
  return slotDurationHours(slot) > 1;
}
