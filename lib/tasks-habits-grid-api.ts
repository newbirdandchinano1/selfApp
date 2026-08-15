import { apiGetTasksHabitsGrid, type HabitsGridPayload, type HabitsGridSection } from '@/lib/api-client';
import { throwIfAborted } from '@/lib/cloud-fetch-retry';
import { getHabitById, getHabits } from '@/lib/repositories/habits/habit';
import { parseHabitIncrementCap } from '@/lib/repositories/habits/habit-goal';
import { parseHabitKind, type HabitKind } from '@/lib/repositories/habits/habit-kind';
import { parseHabitRewardPoints } from '@/lib/repositories/habits/habit-reward-points';
import {
  countSubHabitsCompletedForYmd,
  hasActiveSubHabits,
  parseHabitSubHabitsMeta,
  type HabitSubItem,
} from '@/lib/repositories/habits/habit-sub';
import { getLogicalLocalYmd, loadTasksDayBoundary, type TasksDayBoundary } from '@/lib/tasks-logical-day';

export const TASKS_HABITS_GRID_FILTERS_VERSION = 'tasks-page-v1';

export type TasksHabitGridItem = {
  id: string;
  icon: string;
  name: string;
  note: string | null;
  rewardPoints: number;
  todayCount: number;
  dailyGoal: number | null;
  incrementCap: number | null;
  kind: HabitKind;
  extraData: string | null;
  periodProgress: number | null;
  periodGoal: number | null;
  taskShowPeriodCheck: boolean;
  /** 服务端计算的今日完成态（养成/戒除/任务型） */
  displayCompleted: boolean;
  /** 子习惯模式：首页点击改弹窗而非直接打卡 */
  hasSubHabits: boolean;
  subHabits: HabitSubItem[];
  subHabitCompletedCount: number;
};

export type TasksHabitGridSection = {
  id: string;
  title: string;
  items: TasksHabitGridItem[];
};

export type TasksHabitsGridData = {
  logicalToday: string;
  sections: TasksHabitGridSection[];
  serverFiltered: boolean;
  filtersVersion: string | null;
};

function isServerFilteredHabitsGrid(meta: HabitsGridPayload['meta']): boolean {
  return meta?.serverFiltered === true && meta?.filtersVersion === TASKS_HABITS_GRID_FILTERS_VERSION;
}

async function mergeHabitGridExtraFields(
  sections: HabitsGridSection[],
  logicalToday: string,
): Promise<TasksHabitGridSection[]> {
  const localRows = await getHabits();
  const localById = new Map(localRows.map((r) => [r.id, r]));

  return sections.map((section) => ({
    id: section.id,
    title: section.title,
    items: (Array.isArray(section.items) ? section.items : []).map((item) => {
      const local = localById.get(item.id);
      const extraData = local?.extra_data ?? null;
      const kind = (item.kind ?? (local ? parseHabitKind(local.extra_data) : 'build')) as HabitKind;
      const resolvedKind: HabitKind = ['build', 'break', 'task'].includes(String(kind))
        ? (kind as HabitKind)
        : parseHabitKind(extraData);
      const subActive = hasActiveSubHabits(extraData);
      const subMeta = parseHabitSubHabitsMeta(extraData);
      const subCompleted = subActive ? countSubHabitsCompletedForYmd(extraData, logicalToday) : 0;
      const subTotal = subActive ? subMeta.items.length : 0;
      const serverTodayCount = typeof item.todayCount === 'number' ? item.todayCount : 0;
      const serverDailyGoal = item.dailyGoal ?? null;
      // 子习惯模式：用子项完成数驱动进度环；父习惯打卡仅在全完成时记 1 次
      const todayCount = subActive ? subCompleted : serverTodayCount;
      const dailyGoal = subActive ? subTotal : serverDailyGoal;
      const periodProgress = item.periodProgress ?? null;
      const periodGoal = item.periodGoal ?? null;
      // 完成任务：打勾只看本周期预期目标进度，不能用当日 displayCompleted
      // （当日有 1 次打卡时 displayCompleted 常为 true，会误显示为已完成）
      const taskShowPeriodCheck =
        resolvedKind === 'task' &&
        typeof periodProgress === 'number' &&
        typeof periodGoal === 'number' &&
        periodGoal > 0 &&
        periodProgress >= periodGoal &&
        !Boolean(item.hiddenOnViewDay);
      const displayCompleted = subActive
        ? subTotal > 0 && subCompleted >= subTotal
        : resolvedKind === 'task'
          ? taskShowPeriodCheck
          : Boolean(item.displayCompleted);
      return {
        id: item.id,
        icon: item.icon ?? local?.icon ?? '✓',
        name: item.name ?? local?.name ?? '',
        note: local?.note?.trim() ? local.note.trim() : null,
        rewardPoints: parseHabitRewardPoints(extraData),
        todayCount,
        dailyGoal,
        incrementCap: subActive ? subTotal : parseHabitIncrementCap(extraData, resolvedKind),
        kind: resolvedKind,
        extraData,
        periodProgress,
        periodGoal,
        taskShowPeriodCheck,
        displayCompleted,
        hasSubHabits: subActive,
        subHabits: subActive ? subMeta.items : [],
        subHabitCompletedCount: subCompleted,
      };
    }),
  }));
}

async function pullHabitsGridFromApi(opts: {
  boundary: TasksDayBoundary;
  logicalToday: string;
  signal?: AbortSignal;
}): Promise<TasksHabitsGridData> {
  throwIfAborted(opts.signal);
  const payload = await apiGetTasksHabitsGrid({
    dayBoundaryHour: opts.boundary.hour,
    dayBoundaryMinute: opts.boundary.minute,
    logicalToday: opts.logicalToday,
    signal: opts.signal,
  });
  const logicalToday = payload.logicalToday?.trim() || opts.logicalToday;
  const sections = await mergeHabitGridExtraFields(
    Array.isArray(payload.sections) ? payload.sections : [],
    logicalToday,
  );
  return {
    logicalToday,
    sections,
    serverFiltered: isServerFilteredHabitsGrid(payload.meta),
    filtersVersion: typeof payload.meta?.filtersVersion === 'string' ? payload.meta.filtersVersion : null,
  };
}

/** 习惯网格：`GET /api/pages/tasks/habits-grid` */
export async function fetchTasksHabitsGrid(opts?: {
  boundary?: TasksDayBoundary;
  offlineFallback?: boolean;
  forceLocal?: boolean;
  signal?: AbortSignal;
}): Promise<TasksHabitsGridData> {
  const boundary = opts?.boundary ?? (await loadTasksDayBoundary());
  const logicalToday = getLogicalLocalYmd(new Date(), boundary);

  if (!opts?.forceLocal) {
    try {
      return await pullHabitsGridFromApi({ boundary, logicalToday, signal: opts?.signal });
    } catch (e) {
      if (!opts?.offlineFallback) throw e;
      console.warn('[tasks-habits-grid-api] 接口失败，回退空列表', e);
    }
  }

  return {
    logicalToday: '',
    sections: [],
    serverFiltered: false,
    filtersVersion: null,
  };
}

/** 打卡写操作后刷新单条 incrementCap（本地 habits 表） */
export async function resolveHabitIncrementCap(habitId: string): Promise<number | null> {
  const row = await getHabitById(habitId);
  if (!row) return null;
  return parseHabitIncrementCap(row.extra_data, parseHabitKind(row.extra_data));
}
