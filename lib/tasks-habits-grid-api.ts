import { apiGetTasksHabitsGrid, type HabitsGridPayload, type HabitsGridSection } from '@/lib/api-client';
import { throwIfAborted } from '@/lib/cloud-fetch-retry';
import { getHabitById, getHabits } from '@/lib/repositories/habits/habit';
import { parseHabitIncrementCap } from '@/lib/repositories/habits/habit-goal';
import { parseHabitKind, type HabitKind } from '@/lib/repositories/habits/habit-kind';
import { getLogicalLocalYmd, loadTasksDayBoundary, type TasksDayBoundary } from '@/lib/tasks-logical-day';

export const TASKS_HABITS_GRID_FILTERS_VERSION = 'tasks-page-v1';

export type TasksHabitGridItem = {
  id: string;
  icon: string;
  name: string;
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
      return {
        id: item.id,
        icon: item.icon ?? local?.icon ?? '✓',
        name: item.name ?? local?.name ?? '',
        todayCount: typeof item.todayCount === 'number' ? item.todayCount : 0,
        dailyGoal: item.dailyGoal ?? null,
        incrementCap: parseHabitIncrementCap(extraData, resolvedKind),
        kind: resolvedKind,
        extraData,
        periodProgress: item.periodProgress ?? null,
        periodGoal: item.periodGoal ?? null,
        taskShowPeriodCheck: resolvedKind === 'task' ? Boolean(item.displayCompleted) : false,
        displayCompleted: Boolean(item.displayCompleted),
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
  const sections = await mergeHabitGridExtraFields(Array.isArray(payload.sections) ? payload.sections : []);
  return {
    logicalToday: payload.logicalToday?.trim() || opts.logicalToday,
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
