import { apiGetTasksCalendar } from '@/lib/api-client';
import { fetchApiTableAll } from '@/lib/api-read';
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
  daysRecordToSummariesMap,
  enrichTasksCalendarFrogDayStatus,
  enrichTasksCalendarStandaloneTodos,
  filterTasksCalendarHabitsBeforeCreation,
  type TasksCalendarDaySummary,
} from '@/lib/tasks-calendar-data';
import { getLogicalLocalYmd, type TasksDayBoundary } from '@/lib/tasks-logical-day';

type LocalAggregateBase = {
  tasks: TaskRow[];
  habits: HabitRow[];
  projects: ProjectRow[];
};

let localAggregateBaseCache: LocalAggregateBase | null = null;
let localAggregateBaseInflight: Promise<LocalAggregateBase> | null = null;

/** 下拉刷新或强制 API 时清掉本地全表缓存，避免脏数据 */
export function invalidateTasksCalendarLocalBaseCache(): void {
  localAggregateBaseCache = null;
  localAggregateBaseInflight = null;
}

async function loadLocalAggregateBase(): Promise<LocalAggregateBase> {
  if (localAggregateBaseCache) return localAggregateBaseCache;
  if (localAggregateBaseInflight) return localAggregateBaseInflight;

  localAggregateBaseInflight = (async () => {
    const skipNetwork = Boolean(getActivePageApiReadOpts()?.localOnly);
    if (!skipNetwork) {
      try {
        const [tasks, habits, projects] = await Promise.all([
          fetchApiTableAll<TaskRow>('tasks', {
            calendarRelevant: true,
            startDate: '1970-01-01',
            endDate: '2099-12-31',
            fields: 'id,title,status,priority,project_id,parent_task_id,due_date,extra_data,completed_at,updated_at',
            limit: 200,
          }),
          fetchApiTableAll<HabitRow>('habits', {
            fields: 'id,context,name,tag,icon,tone,note,extra_data,created_at,updated_at',
            limit: 200,
          }),
          fetchApiTableAll<ProjectRow>('projects', {
            dueDateGte: '1970-01-01',
            dueDateLte: '2099-12-31',
            fields: 'id,name,status,due_date,category_id,note,extra_data',
            limit: 200,
          }),
        ]);
        localAggregateBaseCache = { tasks, habits, projects };
        return localAggregateBaseCache;
      } catch {
        /* 范围拉取失败时回退全表本地读 */
      }
    }

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

/** 拉取任务日历汇总：优先聚合接口，失败或仅本地时回退客户端聚合 */
export async function fetchTasksCalendarSummaries(params: {
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
  const skipNetwork = !forceApi && (forceLocal || Boolean(getActivePageApiReadOpts()?.localOnly));

  if (!skipNetwork) {
    try {
      const data = await apiGetTasksCalendar({
        start: startYmd,
        end: endYmd,
        dayBoundaryHour: dayBoundary.hour,
        dayBoundaryMinute: dayBoundary.minute,
      });
      const map = daysRecordToSummariesMap(data.days);
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
