import { getDatabase } from '../../database.native';

export function habitCheckInRowId(habitId: string, recordDateYmd: string): string {
  return `hci_${habitId}_${recordDateYmd.replace(/-/g, '')}`;
}

/** 当前习惯所有有效打卡日 → YYYY-MM-DD → 次数（不含已软删） */
export async function getCheckInsMapByHabitId(habitId: string): Promise<Record<string, number>> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ record_date: string; count: number }>(
    `SELECT hci.record_date AS record_date, hci.count AS count
      FROM habit_check_ins hci
      INNER JOIN habits h ON h.id = hci.habit_id AND h.deleted_at IS NULL
      WHERE hci.habit_id = ? AND hci.deleted_at IS NULL AND hci.count >= 1
      ORDER BY hci.record_date`,
    [habitId]
  );
  const out: Record<string, number> = {};
  for (const r of rows) {
    out[r.record_date] = r.count;
  }
  return out;
}

/**
 * 写入某日次数：count<=0 时软删该日记录。
 */
export async function upsertHabitDayCount(habitId: string, recordDateYmd: string, count: number): Promise<void> {
  const db = await getDatabase();
  if (count <= 0) {
    await db.runAsync(
      `UPDATE habit_check_ins
        SET deleted_at = datetime('now'),
            updated_at = datetime('now'),
            sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_delete' ELSE sync_status END,
            version = version + 1
        WHERE habit_id = ? AND record_date = ? AND deleted_at IS NULL`,
      [habitId, recordDateYmd]
    );
    return;
  }

  const existing = await db.getFirstAsync<{ id: string; deleted_at: string | null }>(
    `SELECT id, deleted_at FROM habit_check_ins WHERE habit_id = ? AND record_date = ?`,
    [habitId, recordDateYmd]
  );

  if (existing) {
    await db.runAsync(
      `UPDATE habit_check_ins
        SET count = ?,
            updated_at = datetime('now'),
            deleted_at = NULL,
            sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_update' ELSE sync_status END,
            version = version + 1
        WHERE id = ?`,
      [count, existing.id]
    );
    return;
  }

  const id = habitCheckInRowId(habitId, recordDateYmd);
  await db.runAsync(
    `INSERT INTO habit_check_ins (
      id, habit_id, record_date, count,
      created_at, updated_at, deleted_at, sync_status, version
    ) VALUES (?, ?, ?, ?, datetime('now'), datetime('now'), NULL, 'pending_create', 1)`,
    [id, habitId, recordDateYmd, count]
  );
}

export type IncrementTodayHabitCheckInResult = {
  nextCount: number;
  /** 本次调用是否实际增加了次数（未触顶时为 true） */
  increased: boolean;
};

/** 本地「今天」该习惯打卡次数 +1；若传入 maxDaily 则不超过当日上限 */
export async function incrementTodayHabitCheckIn(
  habitId: string,
  maxDaily: number | null
): Promise<IncrementTodayHabitCheckInResult> {
  const today = localTodayYmd();
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ count: number }>(
    `SELECT count FROM habit_check_ins WHERE habit_id = ? AND record_date = ? AND deleted_at IS NULL`,
    [habitId, today]
  );
  const cur = row?.count ?? 0;
  if (maxDaily !== null && cur >= maxDaily) return { nextCount: cur, increased: false };
  const next = cur + 1;
  await upsertHabitDayCount(habitId, today, next);
  return { nextCount: next, increased: true };
}

/** 本地「今天」该习惯打卡次数 -1（不低于 0），返回新的当日合计次数 */
export async function decrementTodayHabitCheckIn(habitId: string): Promise<number> {
  const today = localTodayYmd();
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ count: number }>(
    `SELECT count FROM habit_check_ins WHERE habit_id = ? AND record_date = ? AND deleted_at IS NULL`,
    [habitId, today]
  );
  const cur = row?.count ?? 0;
  if (cur <= 0) return 0;
  const next = cur - 1;
  await upsertHabitDayCount(habitId, today, next);
  return next;
}

export type HabitCheckInListStat = {
  habitId: string;
  /** 有记录的天数（count>=1） */
  achievedDays: number;
  /** 本地「今天」该习惯合计次数 */
  todayCount: number;
};

function localTodayYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 列表页批量统计：累计打卡天数、今日次数 */
export async function getHabitCheckInListStats(): Promise<Map<string, HabitCheckInListStat>> {
  const db = await getDatabase();
  const today = localTodayYmd();

  const dayRows = await db.getAllAsync<{ habit_id: string; c: number }>(
    `SELECT hci.habit_id AS habit_id, COUNT(*) AS c
      FROM habit_check_ins hci
      INNER JOIN habits h ON h.id = hci.habit_id AND h.deleted_at IS NULL
      WHERE hci.deleted_at IS NULL AND hci.count >= 1
      GROUP BY hci.habit_id`
  );

  const todayRows = await db.getAllAsync<{ habit_id: string; count: number }>(
    `SELECT hci.habit_id AS habit_id, hci.count AS count
      FROM habit_check_ins hci
      INNER JOIN habits h ON h.id = hci.habit_id AND h.deleted_at IS NULL
      WHERE hci.deleted_at IS NULL AND hci.record_date = ? AND hci.count >= 1`,
    [today]
  );

  const map = new Map<string, HabitCheckInListStat>();
  for (const r of dayRows) {
    map.set(r.habit_id, {
      habitId: r.habit_id,
      achievedDays: r.c,
      todayCount: 0,
    });
  }
  for (const r of todayRows) {
    const prev = map.get(r.habit_id);
    if (prev) {
      prev.todayCount = r.count;
    } else {
      map.set(r.habit_id, {
        habitId: r.habit_id,
        achievedDays: 0,
        todayCount: r.count,
      });
    }
  }
  return map;
}
