import { ApiRequestError, apiGetRecord } from '@/lib/api-client';
import { addDaysToYmd } from '@/lib/api-read-helpers';
import { fetchApiTableAll, withApiTableSyncLock } from '@/lib/api-read';
import { syncApiReadResultToLocal } from '@/lib/api-read-local-sync';
import { fetchTasksHabitsGrid } from '@/lib/tasks-habits-grid-api';
import { getHabitById } from '@/lib/repositories/habits/habit';
import type { HabitRow } from '@/lib/repositories/habits/habit.types';
import { getLogicalLocalYmd, loadTasksDayBoundary, type TasksDayBoundary } from '@/lib/tasks-logical-day';

/** 习惯详情打卡同步窗口（与旧 bootstrap habitCheckInMonths 对齐） */
export const HABIT_DETAIL_CHECK_IN_MONTHS = 24;
const HABIT_DETAIL_CHECK_IN_DAYS = HABIT_DETAIL_CHECK_IN_MONTHS * 31;

/** 从 REST 拉取指定习惯的打卡记录并写入本地 SQLite（不做快照 reconcile） */
export async function syncHabitDetailCheckInsFromApi(
  habitId: string,
  opts?: { boundary?: TasksDayBoundary; signal?: AbortSignal },
): Promise<void> {
  const id = habitId.trim();
  if (!id) return;

  const boundary = opts?.boundary ?? (await loadTasksDayBoundary());
  const endYmd = getLogicalLocalYmd(new Date(), boundary);
  const startYmd = addDaysToYmd(endYmd, -HABIT_DETAIL_CHECK_IN_DAYS);

  const rows = await fetchApiTableAll<Record<string, unknown>>('habit_check_ins', {
    startDate: startYmd,
    endDate: endYmd,
    forceRefresh: true,
    signal: opts?.signal,
  });

  const forHabit = rows.filter((r) => String(r.habit_id ?? '').trim() === id);
  if (forHabit.length === 0) return;

  await withApiTableSyncLock('habit_check_ins', async () => {
    await syncApiReadResultToLocal('habit_check_ins', forHabit, { reconcileSnapshot: false });
  });
}

/** 确保习惯详情所需的习惯行已在本地（优先单条 REST，失败回退 habits-grid） */
export async function ensureHabitDetailRowFromApi(
  habitId: string,
  opts?: { boundary?: TasksDayBoundary; signal?: AbortSignal },
): Promise<HabitRow | null> {
  const id = habitId.trim();
  if (!id) return null;

  try {
    const apiRow = await apiGetRecord<Record<string, unknown>>('habits', id, { signal: opts?.signal });
    if (apiRow && typeof apiRow === 'object') {
      await withApiTableSyncLock('habits', async () => {
        await syncApiReadResultToLocal('habits', apiRow, { reconcileSnapshot: false });
      });
      return (await getHabitById(id)) ?? null;
    }
  } catch (e) {
    if (!(e instanceof ApiRequestError && (e.httpStatus === 404 || e.httpStatus === 405))) {
      console.warn('[habit-detail-api] 拉取习惯单条失败，回退 habits-grid', e);
    }
  }

  let local = await getHabitById(id);
  if (!local) {
    await fetchTasksHabitsGrid({
      boundary: opts?.boundary,
      offlineFallback: false,
      signal: opts?.signal,
    });
    local = await getHabitById(id);
  }
  return local ?? null;
}

/** 习惯详情页：同步习惯行 + 近 N 月打卡记录 */
export async function syncHabitDetailDataFromApi(
  habitId: string,
  opts?: { boundary?: TasksDayBoundary; signal?: AbortSignal },
): Promise<HabitRow | null> {
  const row = await ensureHabitDetailRowFromApi(habitId, opts);
  try {
    await syncHabitDetailCheckInsFromApi(habitId, opts);
  } catch (e) {
    console.warn('[habit-detail-api] 同步打卡记录失败', e);
  }
  return row ?? (await getHabitById(habitId));
}
