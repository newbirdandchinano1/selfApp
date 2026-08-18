import { ApiRequestError, apiGetTasksCalendar, apiGetTasksCalendarDay, apiGetTasksCalendarGrid } from '@/lib/api-client';
import { getHabitCheckInCountsByDateRange } from '@/lib/repositories/habits/habit-check-in';
import { getHabits } from '@/lib/repositories/habits/habit';
import { getProjects } from '@/lib/repositories/projects/project';
import { getFrogCompletedTaskIdsByDayRange } from '@/lib/repositories/tasks/frog-completion-events';
import { getTaskCompletedTaskIdsByDayRange } from '@/lib/repositories/tasks/task-execution-events';
import { getTasks } from '@/lib/repositories/tasks/task';
import type { HabitRow } from '@/lib/repositories/habits/habit.types';
import type { ProjectRow } from '@/lib/repositories/projects/project.types';
import type { TaskRow } from '@/lib/repositories/tasks/task.types';
import { getActivePageApiReadOpts } from '@/lib/page-api-session';
import {
  buildTasksCalendarSummaries,
  daysRecordToGridMap,
  daysRecordToSummariesMap,
  enrichTasksCalendarFrogDayStatus,
  enrichTasksCalendarStandaloneTodos,
  filterTasksCalendarHabitsBeforeCreation,
  isTasksCalendarRenderReady,
  parseTasksCalendarDayPayload,
  summariesToGridMap,
  type TasksCalendarDaySummary,
  type TasksCalendarGridDay,
} from '@/lib/tasks-calendar-data';
import { getLogicalLocalYmd, type TasksDayBoundary } from '@/lib/tasks-logical-day';

type LocalAggregateBase = {
  tasks: TaskRow[];
  habits: HabitRow[];
  projects: ProjectRow[];
};

type CalendarFetchOpts = {
  dayBoundary: TasksDayBoundary;
  offlineFallback?: boolean;
  forceLocal?: boolean;
  forceApi?: boolean;
};

export type TasksCalendarMonthPayload = {
  grid: Map<string, TasksCalendarGridDay>;
  /** 回退整月详情时带上，避免再打 /day */
  summaries?: Map<string, TasksCalendarDaySummary>;
};

let localAggregateBaseCache: LocalAggregateBase | null = null;
let localAggregateBaseInflight: Promise<LocalAggregateBase> | null = null;

/** unknown：尚未探测；supported：P1 可用；unsupported：404 后本会话不再打 */
let calendarSplitSupport: 'unknown' | 'supported' | 'unsupported' = 'unknown';

function isCalendarEndpointMissing(e: unknown): boolean {
  return e instanceof ApiRequestError && (e.httpStatus === 404 || e.httpStatus === 405);
}

function shouldSkipNetwork(opts: CalendarFetchOpts): boolean {
  return !opts.forceApi && (Boolean(opts.forceLocal) || Boolean(getActivePageApiReadOpts()?.localOnly));
}

/** 下拉刷新或强制 API 时清掉本地全表缓存，避免脏数据 */
export function invalidateTasksCalendarLocalBaseCache(): void {
  localAggregateBaseCache = null;
  localAggregateBaseInflight = null;
}

/** 下拉刷新时重新探测 P1，便于后端中途部署后立刻切到 grid/day */
export function resetTasksCalendarApiCapabilities(): void {
  calendarSplitSupport = 'unknown';
}

export function getTasksCalendarSplitSupport(): 'unknown' | 'supported' | 'unsupported' {
  return calendarSplitSupport;
}

async function loadLocalAggregateBase(): Promise<LocalAggregateBase> {
  if (localAggregateBaseCache) return localAggregateBaseCache;
  if (localAggregateBaseInflight) return localAggregateBaseInflight;

  localAggregateBaseInflight = (async () => {
    const [tasks, habits, projects] = await Promise.all([getTasks(), getHabits(), getProjects()]);
    localAggregateBaseCache = { tasks, habits, projects };
    return localAggregateBaseCache;
  })();

  try {
    return await localAggregateBaseInflight;
  } finally {
    localAggregateBaseInflight = null;
  }
}

async function fetchTasksCalendarSummariesLocal(params: {
  startYmd: string;
  endYmd: string;
  dayBoundary: TasksDayBoundary;
}): Promise<Map<string, TasksCalendarDaySummary>> {
  const { startYmd, endYmd, dayBoundary } = params;
  const base = await loadLocalAggregateBase();
  const habitIds = new Set(base.habits.map((h) => h.id));
  const habitCheckInsByDay = await getHabitCheckInCountsByDateRange(startYmd, endYmd, { habitIds });
  const map = buildTasksCalendarSummaries({
    startYmd,
    endYmd,
    tasks: base.tasks,
    habits: base.habits,
    projects: base.projects,
    habitCheckInsByDay,
    dayBoundary,
  });
  await enrichCalendarSummaries(map, {
    startYmd,
    endYmd,
    dayBoundary,
    tasks: base.tasks,
    habits: base.habits,
  });
  return map;
}

async function enrichCalendarSummaries(
  map: Map<string, TasksCalendarDaySummary>,
  params: {
    startYmd: string;
    endYmd: string;
    dayBoundary: TasksDayBoundary;
    tasks: TaskRow[];
    habits: HabitRow[];
  },
): Promise<void> {
  const { startYmd, endYmd, dayBoundary, tasks, habits } = params;
  const logicalTodayYmd = getLogicalLocalYmd(new Date(), dayBoundary);
  const [frogCompletedTaskIdsByDay, todoCompletedTaskIdsByDay] = await Promise.all([
    getFrogCompletedTaskIdsByDayRange(startYmd, endYmd),
    getTaskCompletedTaskIdsByDayRange(startYmd, endYmd),
  ]);
  const taskMetaById = new Map(tasks.map((t) => [t.id, { status: t.status, extra_data: t.extra_data }]));
  filterTasksCalendarHabitsBeforeCreation(map, habits, dayBoundary);
  enrichTasksCalendarFrogDayStatus(map, {
    logicalTodayYmd,
    frogCompletedTaskIdsByDay,
    taskMetaById,
  });
  enrichTasksCalendarStandaloneTodos(map, {
    tasks,
    dayBoundary,
    completedTaskIdsByDay: todoCompletedTaskIdsByDay,
  });
}

function summariesInflightKey(params: {
  startYmd: string;
  endYmd: string;
  forceApi?: boolean;
  forceLocal?: boolean;
}): string {
  const skip = shouldSkipNetwork({
    dayBoundary: { hour: 0, minute: 0 },
    forceApi: params.forceApi,
    forceLocal: params.forceLocal,
  });
  return `${params.startYmd}:${params.endYmd}:${params.forceApi ? 1 : 0}:${skip ? 1 : 0}`;
}

const summariesInflight = new Map<string, Promise<Map<string, TasksCalendarDaySummary>>>();

function monthPayloadFromSummaries(
  summaries: Map<string, TasksCalendarDaySummary>,
  dayBoundary: TasksDayBoundary,
): TasksCalendarMonthPayload {
  const logicalTodayYmd = getLogicalLocalYmd(new Date(), dayBoundary);
  return {
    grid: summariesToGridMap(summaries, logicalTodayYmd),
    summaries,
  };
}

/** 拉取任务日历汇总：优先聚合接口，失败或仅本地时回退客户端聚合 */
export async function fetchTasksCalendarSummaries(params: {
  startYmd: string;
  endYmd: string;
  dayBoundary: TasksDayBoundary;
  offlineFallback?: boolean;
  forceLocal?: boolean;
  forceApi?: boolean;
}): Promise<Map<string, TasksCalendarDaySummary>> {
  const key = summariesInflightKey(params);
  const existing = summariesInflight.get(key);
  if (existing) return existing;

  const run = fetchTasksCalendarSummariesUncoalesced(params);
  summariesInflight.set(key, run);
  try {
    return await run;
  } finally {
    if (summariesInflight.get(key) === run) summariesInflight.delete(key);
  }
}

async function fetchTasksCalendarSummariesUncoalesced(params: {
  startYmd: string;
  endYmd: string;
  dayBoundary: TasksDayBoundary;
  offlineFallback?: boolean;
  forceLocal?: boolean;
  forceApi?: boolean;
}): Promise<Map<string, TasksCalendarDaySummary>> {
  const {
    startYmd,
    endYmd,
    dayBoundary,
    offlineFallback = true,
    forceLocal = false,
    forceApi = false,
  } = params;
  const skipNetwork = shouldSkipNetwork({ dayBoundary, offlineFallback, forceLocal, forceApi });

  if (!skipNetwork) {
    try {
      const data = await apiGetTasksCalendar({
        start: startYmd,
        end: endYmd,
        dayBoundaryHour: dayBoundary.hour,
        dayBoundaryMinute: dayBoundary.minute,
      });
      const map = daysRecordToSummariesMap(data.days);
      if (isTasksCalendarRenderReady(data)) {
        return map;
      }
      const base = await loadLocalAggregateBase();
      await enrichCalendarSummaries(map, {
        startYmd,
        endYmd,
        dayBoundary,
        tasks: base.tasks,
        habits: base.habits,
      });
      return map;
    } catch (e) {
      if (!offlineFallback) throw e;
      console.warn('[tasks-calendar] 聚合接口失败，回退本地聚合', e);
    }
  }

  return fetchTasksCalendarSummariesLocal({ startYmd, endYmd, dayBoundary });
}

/** 月格：优先 P1 grid，未部署则回退整月详情并投影 counts */
export async function fetchTasksCalendarMonth(params: {
  startYmd: string;
  endYmd: string;
} & CalendarFetchOpts): Promise<TasksCalendarMonthPayload> {
  const { startYmd, endYmd, dayBoundary, offlineFallback = true, forceApi = false } = params;
  const skipNetwork = shouldSkipNetwork(params);

  if (!skipNetwork && calendarSplitSupport !== 'unsupported') {
    try {
      const data = await apiGetTasksCalendarGrid({
        start: startYmd,
        end: endYmd,
        dayBoundaryHour: dayBoundary.hour,
        dayBoundaryMinute: dayBoundary.minute,
      });
      calendarSplitSupport = 'supported';
      return { grid: daysRecordToGridMap(data.days) };
    } catch (e) {
      if (isCalendarEndpointMissing(e)) {
        calendarSplitSupport = 'unsupported';
      } else if (!offlineFallback) {
        throw e;
      } else {
        console.warn('[tasks-calendar] grid 接口失败，回退整月聚合', e);
      }
    }
  }

  const summaries = await fetchTasksCalendarSummaries({
    startYmd,
    endYmd,
    dayBoundary,
    offlineFallback,
    forceLocal: params.forceLocal,
    forceApi,
  });
  return monthPayloadFromSummaries(summaries, dayBoundary);
}

/** 选中日详情：优先 P1 /day，否则从整月 summaries 或本地聚合取 */
export async function fetchTasksCalendarDay(params: {
  ymd: string;
  startYmd?: string;
  endYmd?: string;
} & CalendarFetchOpts): Promise<TasksCalendarDaySummary | null> {
  const { ymd, dayBoundary, offlineFallback = true, forceApi = false } = params;
  const skipNetwork = shouldSkipNetwork(params);

  if (!skipNetwork && calendarSplitSupport !== 'unsupported') {
    try {
      const data = await apiGetTasksCalendarDay({
        ymd,
        dayBoundaryHour: dayBoundary.hour,
        dayBoundaryMinute: dayBoundary.minute,
      });
      calendarSplitSupport = 'supported';
      return parseTasksCalendarDayPayload(data, ymd);
    } catch (e) {
      if (isCalendarEndpointMissing(e)) {
        calendarSplitSupport = 'unsupported';
      } else if (!offlineFallback) {
        throw e;
      } else {
        console.warn('[tasks-calendar] day 接口失败，回退整月聚合', e);
      }
    }
  }

  const startYmd = params.startYmd ?? ymd;
  const endYmd = params.endYmd ?? ymd;
  const summaries = await fetchTasksCalendarSummaries({
    startYmd,
    endYmd,
    dayBoundary,
    offlineFallback,
    forceLocal: params.forceLocal,
    forceApi,
  });
  return summaries.get(ymd) ?? null;
}
