import { ApiRequestError, apiGetRecord, apiListRecords } from '@/lib/api-client';
import { addDaysToYmd } from '@/lib/api-read-helpers';
import { withApiTableSyncLock } from '@/lib/api-read';
import { syncApiReadResultToLocal } from '@/lib/api-read-local-sync';
import { fetchTasksHabitsGrid } from '@/lib/tasks-habits-grid-api';
import { getHabitById } from '@/lib/repositories/habits/habit';
import type { HabitRow } from '@/lib/repositories/habits/habit.types';
import { getLogicalLocalYmd, loadTasksDayBoundary, type TasksDayBoundary } from '@/lib/tasks-logical-day';

/** 习惯详情打卡同步窗口（与旧 bootstrap habitCheckInMonths 对齐） */
export const HABIT_DETAIL_CHECK_IN_MONTHS = 24;
const HABIT_DETAIL_CHECK_IN_DAYS = HABIT_DETAIL_CHECK_IN_MONTHS * 31;
const HABIT_DETAIL_CHECK_IN_PAGE_LIMIT = 200;
const HABIT_DETAIL_CHECK_IN_MAX_PAGES = 100;

/**
 * 仅拉取指定习惯的打卡（带 habitId + 日期窗），写入本地；不做全表 reconcile。
 * 避免详情页再走 `fetchApiTableAll('habit_check_ins')` 拉全用户近 24 个月（易超时/网关 HTML → JSON 解析失败）。
 */
export async function syncHabitDetailCheckInsFromApi(
  habitId: string,
  opts?: { boundary?: TasksDayBoundary; signal?: AbortSignal },
): Promise<void> {
  const id = habitId.trim();
  if (!id) return;

  const boundary = opts?.boundary ?? (await loadTasksDayBoundary());
  const endYmd = getLogicalLocalYmd(new Date(), boundary);
  const startYmd = addDaysToYmd(endYmd, -HABIT_DETAIL_CHECK_IN_DAYS);

  const all: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  let backendFiltersByHabitId: boolean | null = null;

  for (let page = 1; page <= HABIT_DETAIL_CHECK_IN_MAX_PAGES; page += 1) {
    const { list, pagination } = await apiListRecords<Record<string, unknown>>('habit_check_ins', {
      habitId: id,
      startDate: startYmd,
      endDate: endYmd,
      page,
      limit: HABIT_DETAIL_CHECK_IN_PAGE_LIMIT,
      signal: opts?.signal,
    });

    const forHabit = list.filter((r) => String(r.habit_id ?? '').trim() === id);

    if (backendFiltersByHabitId == null && list.length > 0) {
      backendFiltersByHabitId = forHabit.length === list.length;
      if (!backendFiltersByHabitId) {
        // 旧后端忽略 habitId 时不要翻页拉全表（易超时/非 JSON 响应）
        console.warn('[habit-detail-api] 服务端未按 habitId 过滤，跳过打卡 REST 同步，沿用本地');
        return;
      }
    }

    let newCount = 0;
    for (const row of forHabit) {
      const pk = String(row.id ?? '').trim();
      if (!pk || seen.has(pk)) continue;
      seen.add(pk);
      all.push(row);
      newCount += 1;
    }

    const total = Number(pagination?.total) || 0;
    const totalPages = Number(pagination?.totalPages) || 0;
    const reachedTotal = total > 0 && seen.size >= total;
    const reachedLastPage = totalPages > 0 && page >= totalPages;
    const emptyOrNoNew = list.length === 0 || newCount === 0;
    if (reachedTotal || reachedLastPage || emptyOrNoNew) break;
  }

  if (all.length === 0) return;

  await withApiTableSyncLock('habit_check_ins', async () => {
    await syncApiReadResultToLocal('habit_check_ins', all, { reconcileSnapshot: false });
  });
}

/** 确保习惯详情所需的习惯行已在本地（优先本地，再单条 REST，再 habits-grid） */
export async function ensureHabitDetailRowFromApi(
  habitId: string,
  opts?: { boundary?: TasksDayBoundary; signal?: AbortSignal },
): Promise<HabitRow | null> {
  const id = habitId.trim();
  if (!id) return null;

  // 任务页长按进详情时本地通常已有该行，先展示再软同步，避免 REST 失败挡住页面
  let local = await getHabitById(id);

  try {
    const apiRow = await apiGetRecord<Record<string, unknown>>('habits', id, { signal: opts?.signal });
    if (apiRow && typeof apiRow === 'object') {
      await withApiTableSyncLock('habits', async () => {
        await syncApiReadResultToLocal('habits', apiRow, { reconcileSnapshot: false });
      });
      local = (await getHabitById(id)) ?? local;
      if (local) return local;
    }
  } catch (e) {
    if (!(e instanceof ApiRequestError && (e.httpStatus === 404 || e.httpStatus === 405))) {
      console.warn('[habit-detail-api] 拉取习惯单条失败，回退本地/habits-grid', e);
    }
  }

  if (!local) {
    try {
      await fetchTasksHabitsGrid({
        boundary: opts?.boundary,
        offlineFallback: true,
        signal: opts?.signal,
      });
    } catch (e) {
      console.warn('[habit-detail-api] habits-grid 回退失败', e);
    }
    local = await getHabitById(id);
  }
  return local ?? null;
}

/** 习惯详情页：同步习惯行 + 近 N 月该习惯打卡记录（失败不抛，由页面读本地） */
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
