import { makeCompositeEntityId } from '@/lib/entity-id';
import { invalidateInflightApiTableFetch, readApiTable } from '@/lib/api-read';
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
  const habits = await readApiTable<{ id: string }>('habits', { offlineFallback: true });
  return new Set(habits.map(h => h.id));
}

async function loadActiveCheckIns(): Promise<
  { habit_id: string; record_date: string; count: number }[]
> {
  const [habitIds, checkIns] = await Promise.all([
    loadActiveHabitIds(),
    readApiTable<{ habit_id: string; record_date: string; count: number }>('habit_check_ins', {
      offlineFallback: true,
    }),
  ]);
  return checkIns.filter(c => habitIds.has(c.habit_id) && (c.count ?? 0) >= 0);
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
  for (const r of rows) {
    if (r.sync_status === 'pending_delete') {
      delete out[r.record_date];
      continue;
    }
    const count = r.count ?? 0;
    if (count >= 0) out[r.record_date] = count;
  }
  return out;
}

/** 当前习惯所有有效打卡日 → YYYY-MM-DD → 次数（REST + 本地 pending 合并，本地优先） */
export async function getCheckInsMapByHabitId(habitId: string): Promise<Record<string, number>> {
  const [checkIns, fromLocal] = await Promise.all([loadActiveCheckIns(), readLocalCheckInsForHabit(habitId)]);
  const out: Record<string, number> = {};
  for (const r of checkIns.filter(c => c.habit_id === habitId)) {
    out[r.record_date] = r.count;
  }
  for (const [ymd, count] of Object.entries(fromLocal)) {
    out[ymd] = count;
  }
  return out;
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
    const existing = await db.getFirstAsync<{ id: string; sync_status: string }>(
      `SELECT id, sync_status FROM habit_check_ins WHERE habit_id = ? AND record_date = ?`,
      [habitId, recordDateYmd],
    );
    if (!existing) return;
    if (existing.sync_status === 'pending_create') {
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
    invalidateInflightApiTableFetch('habit_check_ins');
    await pushHabitCheckInChangesToApi({ awaitSync: true });
    return;
  }

  const existing = await db.getFirstAsync<{ id: string }>(
    `SELECT id FROM habit_check_ins WHERE habit_id = ? AND record_date = ?`,
    [habitId, recordDateYmd],
  );

  if (existing) {
    await db.runAsync(
      `UPDATE habit_check_ins
        SET count = ?,
            updated_at = datetime('now'),
            sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_update' ELSE sync_status END
        WHERE id = ?`,
      [count, existing.id]
    );
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

/** 戒除习惯：确认当日保持戒除（写入 count=0 记录） */
export async function confirmBreakHabitDayClean(habitId: string, recordDateYmd: string): Promise<void> {
  await upsertHabitDayCount(habitId, recordDateYmd, 0, { keepZeroRecord: true });
}

/** 指定日是否有打卡记录（含 count=0 的戒除确认） */
export async function hasHabitCheckInRecordForDay(habitId: string, recordDateYmd: string): Promise<boolean> {
  const map = await getCheckInsMapByHabitId(habitId);
  return Object.prototype.hasOwnProperty.call(map, recordDateYmd);
}

/** 批量查询指定逻辑日各习惯是否有打卡记录 */
export async function getHabitDayRecordFlagsForYmd(recordDateYmd: string): Promise<Map<string, boolean>> {
  const checkIns = await loadActiveCheckIns();
  const map = new Map<string, boolean>();
  for (const r of checkIns) {
    if (r.record_date === recordDateYmd) {
      map.set(r.habit_id, true);
    }
  }
  const db = await getDatabase();
  if (db) {
    const rows = await db.getAllAsync<{ habit_id: string; sync_status: string }>(
      `SELECT habit_id, sync_status FROM habit_check_ins WHERE record_date = ?`,
      [recordDateYmd],
    );
    for (const r of rows) {
      if (r.sync_status === 'pending_delete') {
        map.delete(r.habit_id);
      } else {
        map.set(r.habit_id, true);
      }
    }
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
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ count: number }>(
    `SELECT count FROM habit_check_ins WHERE habit_id = ? AND record_date = ?`,
    [habitId, today]
  );
  const cur = row?.count ?? 0;
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
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ count: number }>(
    `SELECT count FROM habit_check_ins WHERE habit_id = ? AND record_date = ?`,
    [habitId, recordDateYmd]
  );
  const cur = row?.count ?? 0;
  if (maxDaily !== null && cur >= maxDaily) return { nextCount: cur, increased: false };
  const next = cur + 1;
  await upsertHabitDayCount(habitId, recordDateYmd, next);
  return { nextCount: next, increased: true };
}

/** 仅数据库中该日有效打卡次数（不含 extra_data 旧字段合并） */
export async function getHabitCheckInDbCountForDay(habitId: string, recordDateYmd: string): Promise<number> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ count: number }>(
    `SELECT count FROM habit_check_ins WHERE habit_id = ? AND record_date = ?`,
    [habitId, recordDateYmd]
  );
  return row?.count ?? 0;
}

/** 指定日次数 -1；戒除习惯减至 0 时清除记录（回到待确认）。返回新的当日合计次数 */
export async function decrementHabitCheckInForDay(
  habitId: string,
  recordDateYmd: string,
  opts?: { breakHabit?: boolean },
): Promise<number> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ count: number }>(
    `SELECT count FROM habit_check_ins WHERE habit_id = ? AND record_date = ?`,
    [habitId, recordDateYmd]
  );
  const cur = row?.count ?? 0;
  if (!row) return 0;
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
    const prevMap = checkInsMaps.get(r.habit_id) ?? {};
    prevMap[r.record_date] = r.count;
    checkInsMaps.set(r.habit_id, prevMap);

    const prevStat = checkStats.get(r.habit_id);
    if (prevStat) {
      prevStat.achievedDays += 1;
    } else {
      checkStats.set(r.habit_id, { habitId: r.habit_id, achievedDays: 1, todayCount: 0 });
    }
    if (r.record_date === today) {
      checkStats.get(r.habit_id)!.todayCount = r.count;
    }
  }

  return { checkInsMaps, checkStats };
}

/** 各习惯在指定逻辑日的打卡次数（单次全表扫描） */
export async function getTodayHabitCountsMap(logicalTodayYmd?: string): Promise<Map<string, number>> {
  const boundary = await loadTasksDayBoundary();
  const today = logicalTodayYmd ?? getLogicalLocalYmd(new Date(), boundary);
  const checkIns = await loadActiveCheckIns();
  const map = new Map<string, number>();
  for (const r of checkIns) {
    if (r.record_date === today) {
      map.set(r.habit_id, r.count);
    }
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

/** 日期区间内各习惯每日打卡次数（record_date → habitId → count） */
export async function getHabitCheckInCountsByDateRange(
  startYmd: string,
  endYmd: string,
  opts?: { habitIds?: Set<string> },
): Promise<Map<string, Map<string, number>>> {
  const habitIds = opts?.habitIds ?? (await loadActiveHabitIds());
  const checkIns = await readApiTable<{ habit_id: string; record_date: string; count: number }>(
    'habit_check_ins',
    {
      offlineFallback: true,
      startDate: startYmd,
      endDate: endYmd,
    },
  );
  const rows = checkIns.filter(
    c => habitIds.has(c.habit_id) && (c.count ?? 0) >= 0 && isYmdInRange(c.record_date, startYmd, endYmd),
  );
  const out = new Map<string, Map<string, number>>();
  for (const r of rows) {
    let day = out.get(r.record_date);
    if (!day) {
      day = new Map();
      out.set(r.record_date, day);
    }
    day.set(r.habit_id, r.count);
  }
  return out;
}
