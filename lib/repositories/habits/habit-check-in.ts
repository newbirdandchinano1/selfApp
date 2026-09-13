import { makeCompositeEntityId } from '@/lib/entity-id';
import { invalidateInflightApiTableFetch } from '@/lib/api-read';
import { isYmdInRange } from '@/lib/api-read-helpers';
import { getDatabase } from '../../database.native';
import { getLogicalLocalYmd, loadTasksDayBoundary } from '../../tasks-logical-day';

/** 打卡行 id：用 habitId 摘要避免 hci_{完整habitId}_{日期} 超过 MySQL VARCHAR(36) */
export function habitCheckInRowId(habitId: string, recordDateYmd: string): string {
  return makeCompositeEntityId('hci_', habitId, recordDateYmd.replace(/-/g, ''));
}

let habitCheckInApiSyncChain: Promise<void> = Promise.resolve();

/** 将 habit_check_ins 待同步行推送到 REST；补卡/撤销后应 `awaitSync: true` 再 reload */
export async function pushHabitCheckInChangesToApi(opts?: { awaitSync?: boolean }): Promise<void> {
  const { markApiTableDirty } = await import('@/lib/api-incremental-sync');
  markApiTableDirty('habit_check_ins');

  const run = async () => {
    const { flushApiDirtyTablesNow } = await import('@/lib/api-incremental-sync');
    // 只推送打卡相关表，避免 points_wallet 等无关脏表的乐观锁冲突拖垮打卡
    await flushApiDirtyTablesNow({ rethrow: true, onlyTables: ['habit_check_ins', 'habits'] });
    // 其余脏表（含积分钱包）后台继续推，不阻塞打卡成功路径
    void import('@/lib/api-write-sync').then(m => m.pushLocalChangesToApi());
  };

  const isNonBlockingSyncNoise = (e: unknown): boolean => {
    const msg = e instanceof Error ? e.message : String(e);
    return /积分钱包|已有更新版本|过期数据覆盖|points_wallet/i.test(msg);
  };

  const task = habitCheckInApiSyncChain.then(run);
  habitCheckInApiSyncChain = task.catch(() => {});

  if (opts?.awaitSync) {
    try {
      await task;
    } catch (e) {
      // 打卡本地已落库；积分钱包 OCC 等无关失败不得阻断打卡/撤销
      if (isNonBlockingSyncNoise(e)) {
        if (__DEV__) console.warn('[habit-check-in] 忽略无关同步失败（本地打卡已保存）', e);
        void import('@/lib/api-write-sync').then(m => m.pushLocalChangesToApi());
        return;
      }
      const detail = e instanceof Error && e.message.trim() ? e.message : '未知错误';
      throw new Error(`本地已保存，但同步到服务器失败：${detail}\n请检查网络或登录状态后重试。`);
    }
    return;
  }

  void task.catch(e => {
    if (__DEV__) console.warn('[habit-check-in] 后台同步到服务器失败', e);
  });
}

async function loadActiveHabitIds(): Promise<Set<string>> {
  const db = await getDatabase();
  if (!db) return new Set();
  const rows = await db.getAllAsync<{ id: string }>(
    `SELECT id FROM habits WHERE sync_status != 'pending_delete'`,
  );
  return new Set((rows ?? []).map((h) => h.id));
}

/** 仅读本地 SQLite，禁止 `/api/data/habit_check_ins` 全表 */
async function loadActiveCheckIns(): Promise<
  { habit_id: string; record_date: string; count: number }[]
> {
  const db = await getDatabase();
  if (!db) return [];
  const [habitIds, checkIns] = await Promise.all([
    loadActiveHabitIds(),
    db.getAllAsync<{ habit_id: string; record_date: string; count: number }>(
      `SELECT habit_id, record_date, count FROM habit_check_ins WHERE sync_status != 'pending_delete'`,
    ),
  ]);
  return (checkIns ?? []).filter((c) => habitIds.has(c.habit_id) && (c.count ?? 0) >= 0);
}

/** 本地 SQLite 中该习惯的打卡次数（pending 覆盖 synced；pending_delete 视为无记录） */
async function readLocalCheckInsForHabit(habitId: string): Promise<Record<string, number>> {
  const db = await getDatabase();
  if (!db) return {};
  const rows = await db.getAllAsync<{ record_date: string; count: number; sync_status: string }>(
    `SELECT record_date, count, sync_status FROM habit_check_ins WHERE habit_id = ?`,
    [habitId],
  );
  const out: Record<string, number> = {};
  const deletedDates = new Set<string>();
  for (const r of rows) {
    if (r.sync_status === 'pending_delete') {
      if (!Object.prototype.hasOwnProperty.call(out, r.record_date)) {
        deletedDates.add(r.record_date);
      }
      continue;
    }
    deletedDates.delete(r.record_date);
    const count = Math.max(0, Math.floor(Number(r.count) || 0));
    const prev = out[r.record_date];
    // 同日重复行取较大 count，避免 sync 对齐期间读到旧行把次数打回 1
    out[r.record_date] = prev == null ? count : Math.max(prev, count);
  }
  for (const ymd of deletedDates) {
    delete out[ymd];
  }
  return out;
}

/** 当前习惯所有有效打卡日 → YYYY-MM-DD → 次数（仅本地，不打打卡全表 List） */
export async function getCheckInsMapByHabitId(habitId: string): Promise<Record<string, number>> {
  return readLocalCheckInsForHabit(habitId);
}

/**
 * 写入某日次数：count<=0 时删除该日记录（未同步过的行直接物理删除）。
 * `keepZeroRecord` 为 true 时写入 count=0（戒除习惯「保持戒除」确认）。
 */
export async function upsertHabitDayCount(
  habitId: string,
  recordDateYmd: string,
  count: number,
  opts?: { keepZeroRecord?: boolean },
): Promise<void> {
  const db = await getDatabase();
  if (!db) {
    throw new Error('本地数据库不可用，无法保存打卡');
  }
  if (count <= 0 && !opts?.keepZeroRecord) {
    const existingRows = await db.getAllAsync<{ id: string; sync_status: string }>(
      `SELECT id, sync_status FROM habit_check_ins WHERE habit_id = ? AND record_date = ?`,
      [habitId, recordDateYmd],
    );
    if (!existingRows?.length) return;
    for (const existing of existingRows) {
      if (existing.sync_status === 'pending_create' || existing.sync_status === 'pending_delete') {
        await db.runAsync(`DELETE FROM habit_check_ins WHERE id = ?`, [existing.id]);
      } else {
        await db.runAsync(
          `UPDATE habit_check_ins
            SET updated_at = datetime('now'),
                sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_delete' ELSE sync_status END
            WHERE id = ?`,
          [existing.id],
        );
      }
    }
    invalidateInflightApiTableFetch('habit_check_ins');
    await pushHabitCheckInChangesToApi({ awaitSync: true });
    return;
  }

  const existingRows = await db.getAllAsync<{ id: string; sync_status: string; count: number }>(
    `SELECT id, sync_status, count FROM habit_check_ins WHERE habit_id = ? AND record_date = ?`,
    [habitId, recordDateYmd],
  );
  const activeRows = (existingRows ?? []).filter((r) => r.sync_status !== 'pending_delete');
  const deletedRows = (existingRows ?? []).filter((r) => r.sync_status === 'pending_delete');

  if (activeRows.length > 0 || deletedRows.length > 0) {
    // 优先复用有效行中次数最高的，减少对齐期间误删高 count 行
    const keep =
      activeRows.slice().sort(
        (a, b) =>
          Math.max(0, Math.floor(Number(b.count) || 0)) -
          Math.max(0, Math.floor(Number(a.count) || 0)),
      )[0] ?? deletedRows[0];
    if (!keep) return;
    const nextStatus =
      keep.sync_status === 'pending_delete' || keep.sync_status === 'synced'
        ? 'pending_update'
        : keep.sync_status;
    await db.runAsync(
      `UPDATE habit_check_ins
        SET count = ?,
            updated_at = datetime('now'),
            sync_status = ?
        WHERE id = ?`,
      [count, nextStatus, keep.id]
    );
    // 同日重复行清掉，避免后续读到旧 count
    for (const extra of [...activeRows, ...deletedRows].filter((r) => r.id !== keep.id)) {
      if (extra.sync_status === 'pending_create') {
        await db.runAsync(`DELETE FROM habit_check_ins WHERE id = ?`, [extra.id]);
      } else {
        await db.runAsync(
          `UPDATE habit_check_ins
            SET updated_at = datetime('now'),
                sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_delete' ELSE sync_status END
            WHERE id = ? AND sync_status != 'pending_delete'`,
          [extra.id],
        );
        // 已是 pending_delete 的多余行直接删掉，减少干扰
        if (extra.sync_status === 'pending_delete') {
          await db.runAsync(`DELETE FROM habit_check_ins WHERE id = ?`, [extra.id]);
        }
      }
    }
    invalidateInflightApiTableFetch('habit_check_ins');
    await pushHabitCheckInChangesToApi({ awaitSync: true });
    return;
  }

  const id = habitCheckInRowId(habitId, recordDateYmd);
  await db.runAsync(
    `INSERT INTO habit_check_ins (
      id, habit_id, record_date, count,
      created_at, updated_at, sync_status
    ) VALUES (?, ?, ?, ?, datetime('now'), datetime('now'), 'pending_create')`,
    [id, habitId, recordDateYmd, count]
  );
  invalidateInflightApiTableFetch('habit_check_ins');
  await pushHabitCheckInChangesToApi({ awaitSync: true });
}

/**
 * 戒除习惯：确认当日保持戒除（写入 count=0 记录）。
 * @returns 是否新建立有效记录（原先无有效打卡时为 true，供发奖幂等）
 */
export async function confirmBreakHabitDayClean(
  habitId: string,
  recordDateYmd: string,
): Promise<boolean> {
  const hadActive = await hasHabitCheckInRecordForDay(habitId, recordDateYmd);
  await upsertHabitDayCount(habitId, recordDateYmd, 0, { keepZeroRecord: true });
  return !hadActive;
}

/** 指定日是否有打卡记录（含 count=0 的戒除确认） */
export async function hasHabitCheckInRecordForDay(habitId: string, recordDateYmd: string): Promise<boolean> {
  const map = await getCheckInsMapByHabitId(habitId);
  return Object.prototype.hasOwnProperty.call(map, recordDateYmd);
}

/** 批量查询指定逻辑日各习惯是否有打卡记录（仅本地当日行） */
export async function getHabitDayRecordFlagsForYmd(recordDateYmd: string): Promise<Map<string, boolean>> {
  const map = new Map<string, boolean>();
  const db = await getDatabase();
  if (!db) return map;
  const rows = await db.getAllAsync<{ habit_id: string; sync_status: string }>(
    `SELECT habit_id, sync_status FROM habit_check_ins WHERE record_date = ?`,
    [recordDateYmd],
  );
  for (const r of rows ?? []) {
    if (r.sync_status === 'pending_delete') {
      // 若同日另有有效行，不因 pending_delete 清掉 flag
      if (!map.has(r.habit_id)) map.set(r.habit_id, false);
    } else {
      map.set(r.habit_id, true);
    }
  }
  for (const [habitId, flag] of [...map.entries()]) {
    if (!flag) map.delete(habitId);
  }
  return map;
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
  const boundary = await loadTasksDayBoundary();
  const today = getLogicalLocalYmd(new Date(), boundary);
  const cur = await getHabitCheckInDbCountForDay(habitId, today);
  if (maxDaily !== null && cur >= maxDaily) return { nextCount: cur, increased: false };
  const next = cur + 1;
  await upsertHabitDayCount(habitId, today, next);
  return { nextCount: next, increased: true };
}

/** 指定 `recordDateYmd`（YYYY-MM-DD）当日次数 +1；若传入 `maxDaily` 则不超过当日上限 */
export async function incrementHabitCheckInForDay(
  habitId: string,
  recordDateYmd: string,
  maxDaily: number | null
): Promise<IncrementTodayHabitCheckInResult> {
  const cur = await getHabitCheckInDbCountForDay(habitId, recordDateYmd);
  if (maxDaily !== null && cur >= maxDaily) return { nextCount: cur, increased: false };
  const next = cur + 1;
  await upsertHabitDayCount(habitId, recordDateYmd, next);
  return { nextCount: next, increased: true };
}

/** 仅数据库中该日有效打卡次数（不含 extra_data 旧字段合并）；重复行取最大有效 count */
export async function getHabitCheckInDbCountForDay(habitId: string, recordDateYmd: string): Promise<number> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ count: number; sync_status: string }>(
    `SELECT count, sync_status FROM habit_check_ins WHERE habit_id = ? AND record_date = ?`,
    [habitId, recordDateYmd]
  );
  let max = 0;
  let hasActive = false;
  for (const r of rows ?? []) {
    if (r.sync_status === 'pending_delete') continue;
    hasActive = true;
    max = Math.max(max, Math.max(0, Math.floor(Number(r.count) || 0)));
  }
  return hasActive ? max : 0;
}

/** 指定日次数 -1；戒除习惯减至 0 时清除记录（回到待确认）。返回新的当日合计次数 */
export async function decrementHabitCheckInForDay(
  habitId: string,
  recordDateYmd: string,
  opts?: { breakHabit?: boolean },
): Promise<number> {
  const hasRecord = await hasHabitCheckInRecordForDay(habitId, recordDateYmd);
  if (!hasRecord) return 0;
  const cur = await getHabitCheckInDbCountForDay(habitId, recordDateYmd);
  if (cur <= 0) {
    await upsertHabitDayCount(habitId, recordDateYmd, 0);
    return 0;
  }
  const next = cur - 1;
  if (opts?.breakHabit && next <= 0) {
    await upsertHabitDayCount(habitId, recordDateYmd, 0);
    return 0;
  }
  await upsertHabitDayCount(habitId, recordDateYmd, next);
  return next;
}

/** 本地「今天」该习惯打卡次数 -1，返回新的当日合计次数 */
export async function decrementTodayHabitCheckIn(
  habitId: string,
  opts?: { breakHabit?: boolean },
): Promise<number> {
  const boundary = await loadTasksDayBoundary();
  const today = getLogicalLocalYmd(new Date(), boundary);
  return decrementHabitCheckInForDay(habitId, today, opts);
}

export type HabitCheckInListStat = {
  habitId: string;
  /** 有记录的天数（count>=1） */
  achievedDays: number;
  /** 本地「今天」该习惯合计次数 */
  todayCount: number;
};

/** 一次读取打卡表，同时构建列表页所需的 maps 与 stats */
export async function loadHabitCheckInPageData(): Promise<{
  checkInsMaps: Map<string, Record<string, number>>;
  checkStats: Map<string, HabitCheckInListStat>;
}> {
  const boundary = await loadTasksDayBoundary();
  const today = getLogicalLocalYmd(new Date(), boundary);
  const checkIns = await loadActiveCheckIns();
  const checkInsMaps = new Map<string, Record<string, number>>();
  const checkStats = new Map<string, HabitCheckInListStat>();

  for (const r of checkIns) {
    const count = Math.max(0, Math.floor(Number(r.count) || 0));
    const prevMap = checkInsMaps.get(r.habit_id) ?? {};
    const prevDay = prevMap[r.record_date];
    const isNewDay = prevDay == null;
    prevMap[r.record_date] = prevDay == null ? count : Math.max(prevDay, count);
    checkInsMaps.set(r.habit_id, prevMap);

    const prevStat = checkStats.get(r.habit_id);
    if (prevStat) {
      if (isNewDay) prevStat.achievedDays += 1;
    } else {
      checkStats.set(r.habit_id, { habitId: r.habit_id, achievedDays: 1, todayCount: 0 });
    }
    if (r.record_date === today) {
      const stat = checkStats.get(r.habit_id)!;
      stat.todayCount = Math.max(stat.todayCount, count);
    }
  }

  return { checkInsMaps, checkStats };
}

/** 各习惯在指定逻辑日的打卡次数（仅本地当日行） */
export async function getTodayHabitCountsMap(logicalTodayYmd?: string): Promise<Map<string, number>> {
  const boundary = await loadTasksDayBoundary();
  const today = logicalTodayYmd ?? getLogicalLocalYmd(new Date(), boundary);
  const map = new Map<string, number>();
  const deletedOnly = new Set<string>();
  const db = await getDatabase();
  if (!db) return map;
  const rows = await db.getAllAsync<{ habit_id: string; count: number; sync_status: string }>(
    `SELECT habit_id, count, sync_status FROM habit_check_ins WHERE record_date = ?`,
    [today],
  );
  for (const r of rows ?? []) {
    // 本地刚撤销、尚未推完删除时，按 0 次处理，避免任务页重拉仍信服务端旧完成态
    if (r.sync_status === 'pending_delete') {
      if (!map.has(r.habit_id)) deletedOnly.add(r.habit_id);
      continue;
    }
    deletedOnly.delete(r.habit_id);
    const count = Math.max(0, Math.floor(Number(r.count) || 0));
    const prev = map.get(r.habit_id);
    // 同日重复行取较大 count，避免 sync 对齐期间读到旧行
    map.set(r.habit_id, prev == null ? count : Math.max(prev, count));
  }
  for (const habitId of deletedOnly) {
    if (!map.has(habitId)) map.set(habitId, 0);
  }
  return map;
}

/** 批量加载各习惯打卡记录（YMD → 次数） */
export async function getAllHabitCheckInsMaps(): Promise<Map<string, Record<string, number>>> {
  const { checkInsMaps } = await loadHabitCheckInPageData();
  return checkInsMaps;
}

/** 列表页批量统计：累计打卡天数、今日次数 */
export async function getHabitCheckInListStats(): Promise<Map<string, HabitCheckInListStat>> {
  const { checkStats } = await loadHabitCheckInPageData();
  return checkStats;
}

/** 日期区间内各习惯每日打卡次数（仅本地，禁止打卡全表 List） */
export async function getHabitCheckInCountsByDateRange(
  startYmd: string,
  endYmd: string,
  opts?: { habitIds?: Set<string> },
): Promise<Map<string, Map<string, number>>> {
  const habitIds = opts?.habitIds ?? (await loadActiveHabitIds());
  const out = new Map<string, Map<string, number>>();
  const db = await getDatabase();
  if (!db) return out;
  const checkIns = await db.getAllAsync<{
    habit_id: string;
    record_date: string;
    count: number;
    sync_status: string;
  }>(
    `SELECT habit_id, record_date, count, sync_status FROM habit_check_ins
      WHERE record_date >= ? AND record_date <= ?`,
    [startYmd, endYmd],
  );
  for (const r of checkIns ?? []) {
    if (r.sync_status === 'pending_delete') continue;
    const count = Math.max(0, Math.floor(Number(r.count) || 0));
    if (!habitIds.has(r.habit_id) || count < 0) continue;
    if (!isYmdInRange(r.record_date, startYmd, endYmd)) continue;
    let day = out.get(r.record_date);
    if (!day) {
      day = new Map();
      out.set(r.record_date, day);
    }
    const prev = day.get(r.habit_id);
    day.set(r.habit_id, prev == null ? count : Math.max(prev, count));
  }
  return out;
}
