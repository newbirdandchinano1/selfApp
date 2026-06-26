import {
  apiGetTasksOverview,
  type TasksOverviewEvent,
  type TasksOverviewInsightCounts,
  type TasksOverviewPayload,
  type TasksOverviewStatKey,
} from '@/lib/api-client';
import { throwIfAborted } from '@/lib/cloud-fetch-retry';
import { getTasksForOverviewList } from '@/lib/repositories/tasks/task';
import type { TaskRow } from '@/lib/repositories/tasks/task.types';
import {
  countTaskExecutionEventsByAction,
  countTaskExecutionEventsInScope,
  getFirstCompletedEventDayYmd,
  getNetCompletedTaskEventsForLocalDay,
  getRecentTaskExecutionEventsPage,
  getTaskCompletionCountsByDayRange,
  getTaskExecutionEventsByActionPage,
  getTaskGlobalInsightCounts,
  type TaskExecutionEventWithTitle,
} from '@/lib/repositories/tasks/task-execution-events';
import { getLogicalLocalYmd, loadTasksDayBoundary, type TasksDayBoundary } from '@/lib/tasks-logical-day';

export const TASKS_OVERVIEW_FILTERS_VERSION = 'tasks-overview-v1';

export type { TasksOverviewInsightCounts, TasksOverviewStatKey } from '@/lib/api-client';

export type TasksOverviewPagedEvents = {
  list: TaskExecutionEventWithTitle[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

export type TasksOverviewPagedTasks = {
  list: TaskRow[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

export type TasksOverviewData = {
  meta: {
    logicalToday?: string;
    heatmapStart?: string;
    heatmapEnd?: string;
    firstCompletedDay: string | null;
    filtersVersion?: string | null;
  };
  insightCounts: TasksOverviewInsightCounts;
  countsByDay: Map<string, number>;
  recentEvents: TasksOverviewPagedEvents;
  statDetail?: {
    statKey: TasksOverviewStatKey;
    mode: 'tasks' | 'events';
    tasks?: TasksOverviewPagedTasks;
    events?: TasksOverviewPagedEvents;
  };
  dayDetail?: {
    ymd: string;
    netCompletedCount: number;
    events: TaskExecutionEventWithTitle[];
  };
  fromLocal: boolean;
};

export type FetchTasksOverviewOpts = {
  boundary?: TasksDayBoundary;
  logicalToday?: string;
  heatmapStart: string;
  heatmapEnd: string;
  eventsPage?: number;
  eventsLimit?: number;
  statKey?: TasksOverviewStatKey;
  statPage?: number;
  statLimit?: number;
  day?: string;
  includeDayDetail?: boolean;
  offlineFallback?: boolean;
  forceLocal?: boolean;
  signal?: AbortSignal;
};

function normalizeEvent(row: TasksOverviewEvent): TaskExecutionEventWithTitle {
  return {
    id: row.id,
    task_id: row.task_id?.trim() || '',
    action: row.action,
    created_at: row.created_at,
    task_title: row.task_title?.trim() || null,
  };
}

function countsRecordToMap(countsByDay: Record<string, number> | undefined): Map<string, number> {
  const map = new Map<string, number>();
  for (const [ymd, count] of Object.entries(countsByDay ?? {})) {
    if (!ymd) continue;
    map.set(ymd, typeof count === 'number' && Number.isFinite(count) ? count : 0);
  }
  return map;
}

function normalizePagedEvents(
  block: TasksOverviewPayload['recentEvents'] | undefined,
  fallbackPage: number,
  fallbackLimit: number,
): TasksOverviewPagedEvents {
  const list = Array.isArray(block?.list) ? block.list.map(normalizeEvent) : [];
  const page = typeof block?.page === 'number' ? block.page : fallbackPage;
  const limit = typeof block?.limit === 'number' ? block.limit : fallbackLimit;
  const total = typeof block?.total === 'number' ? block.total : list.length;
  const totalPages =
    typeof block?.totalPages === 'number'
      ? block.totalPages
      : Math.max(1, Math.ceil(total / Math.max(1, limit)));
  return { list, page, limit, total, totalPages };
}

function normalizeTaskRow(row: Record<string, unknown>): TaskRow {
  return row as unknown as TaskRow;
}

function normalizePayload(payload: TasksOverviewPayload, eventsLimit: number, eventsPage: number): TasksOverviewData {
  const statKey = payload.statDetail?.statKey as TasksOverviewStatKey | undefined;
  const data: TasksOverviewData = {
    meta: {
      logicalToday: payload.meta?.logicalToday,
      heatmapStart: payload.meta?.heatmapStart,
      heatmapEnd: payload.meta?.heatmapEnd,
      firstCompletedDay: payload.meta?.firstCompletedDay ?? null,
      filtersVersion: payload.meta?.filtersVersion ?? null,
    },
    insightCounts: payload.insightCounts ?? {
      open: 0,
      doneOrCancelled: 0,
      totalActive: 0,
      completedEvents: 0,
      reopenedEvents: 0,
    },
    countsByDay: countsRecordToMap(payload.countsByDay),
    recentEvents: normalizePagedEvents(payload.recentEvents, eventsPage, eventsLimit),
    fromLocal: false,
  };

  if (payload.statDetail && statKey) {
    const mode = payload.statDetail.mode;
    data.statDetail = { statKey, mode };
    if (mode === 'tasks' && payload.statDetail.tasks) {
      const block = payload.statDetail.tasks;
      data.statDetail.tasks = {
        list: (block.list ?? []).map(normalizeTaskRow),
        page: block.page ?? 1,
        limit: block.limit ?? 25,
        total: block.total ?? 0,
        totalPages: block.totalPages ?? 1,
      };
    }
    if (mode === 'events' && payload.statDetail.events) {
      data.statDetail.events = normalizePagedEvents(payload.statDetail.events, 1, 25);
    }
  }

  if (payload.dayDetail) {
    data.dayDetail = {
      ymd: payload.dayDetail.ymd,
      netCompletedCount: payload.dayDetail.netCompletedCount ?? 0,
      events: (payload.dayDetail.events ?? []).map(normalizeEvent),
    };
  }

  return data;
}

function taskFilterForStatKey(statKey: TasksOverviewStatKey): 'open' | 'doneOrCancelled' | 'totalActive' | null {
  if (statKey === 'open') return 'open';
  if (statKey === 'doneOrCancelled') return 'doneOrCancelled';
  if (statKey === 'totalActive') return 'totalActive';
  return null;
}

function eventActionForStatKey(statKey: TasksOverviewStatKey): 'completed' | 'reopened' | null {
  if (statKey === 'completedEvents') return 'completed';
  if (statKey === 'reopenedEvents') return 'reopened';
  return null;
}

async function readTasksOverviewFromLocal(opts: FetchTasksOverviewOpts): Promise<TasksOverviewData> {
  const eventsPage = opts.eventsPage ?? 1;
  const eventsLimit = opts.eventsLimit ?? 25;
  const statPage = opts.statPage ?? 1;
  const statLimit = opts.statLimit ?? 25;
  const eventsOffset = (eventsPage - 1) * eventsLimit;
  const statOffset = (statPage - 1) * statLimit;

  const [insightCounts, dayMap, firstDay, eventsTotal, eventsList] = await Promise.all([
    getTaskGlobalInsightCounts(),
    getTaskCompletionCountsByDayRange(opts.heatmapStart, opts.heatmapEnd),
    getFirstCompletedEventDayYmd(),
    countTaskExecutionEventsInScope(),
    getRecentTaskExecutionEventsPage(eventsLimit, eventsOffset),
  ]);

  const data: TasksOverviewData = {
    meta: {
      heatmapStart: opts.heatmapStart,
      heatmapEnd: opts.heatmapEnd,
      firstCompletedDay: firstDay,
      filtersVersion: null,
    },
    insightCounts,
    countsByDay: dayMap,
    recentEvents: {
      list: eventsList,
      page: eventsPage,
      limit: eventsLimit,
      total: eventsTotal,
      totalPages: Math.max(1, Math.ceil(eventsTotal / eventsLimit)),
    },
    fromLocal: true,
  };

  if (opts.statKey) {
    const taskFilter = taskFilterForStatKey(opts.statKey);
    const eventAction = eventActionForStatKey(opts.statKey);
    if (taskFilter) {
      const rows = await getTasksForOverviewList(taskFilter);
      const pageRows = rows.slice(statOffset, statOffset + statLimit);
      data.statDetail = {
        statKey: opts.statKey,
        mode: 'tasks',
        tasks: {
          list: pageRows,
          page: statPage,
          limit: statLimit,
          total: rows.length,
          totalPages: Math.max(1, Math.ceil(rows.length / statLimit)),
        },
      };
    } else if (eventAction) {
      const [total, list] = await Promise.all([
        countTaskExecutionEventsByAction(eventAction),
        getTaskExecutionEventsByActionPage(eventAction, statLimit, statOffset),
      ]);
      data.statDetail = {
        statKey: opts.statKey,
        mode: 'events',
        events: {
          list,
          page: statPage,
          limit: statLimit,
          total,
          totalPages: Math.max(1, Math.ceil(total / statLimit)),
        },
      };
    }
  }

  if (opts.day?.trim() && opts.includeDayDetail) {
    const ymd = opts.day.trim();
    const events = await getNetCompletedTaskEventsForLocalDay(ymd);
    data.dayDetail = {
      ymd,
      netCompletedCount: dayMap.get(ymd) ?? 0,
      events,
    };
  }

  return data;
}

async function pullTasksOverviewFromApi(opts: FetchTasksOverviewOpts): Promise<TasksOverviewData> {
  const boundary = opts.boundary ?? (await loadTasksDayBoundary());
  const logicalToday = opts.logicalToday ?? getLogicalLocalYmd(new Date(), boundary);
  const eventsPage = opts.eventsPage ?? 1;
  const eventsLimit = opts.eventsLimit ?? 25;

  throwIfAborted(opts.signal);
  const payload = await apiGetTasksOverview({
    dayBoundaryHour: boundary.hour,
    dayBoundaryMinute: boundary.minute,
    logicalToday,
    heatmapStart: opts.heatmapStart,
    heatmapEnd: opts.heatmapEnd,
    eventsPage,
    eventsLimit,
    statKey: opts.statKey,
    statPage: opts.statPage,
    statLimit: opts.statLimit,
    day: opts.day,
    includeDayDetail: opts.includeDayDetail,
    signal: opts.signal,
  });

  return normalizePayload(payload, eventsLimit, eventsPage);
}

/** 待办总览：`GET /api/pages/tasks/tasks-overview` */
export async function fetchTasksOverview(opts: FetchTasksOverviewOpts): Promise<TasksOverviewData> {
  if (!opts.forceLocal) {
    try {
      return await pullTasksOverviewFromApi(opts);
    } catch (e) {
      if (!opts.offlineFallback) throw e;
      console.warn('[tasks-overview-api] 接口失败，回退本地 SQLite', e);
    }
  }

  return readTasksOverviewFromLocal(opts);
}
