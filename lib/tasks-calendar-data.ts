import { isHabitScheduledOnLogicalYmd } from '@/lib/habit-schedule';
import { isBreakHabitSucceeded } from '@/lib/repositories/habits/habit-break-success';
import { isBuildHabitSucceeded } from '@/lib/repositories/habits/habit-build-success';
import { isHabitDayGoalMet, parseHabitDailyGoal } from '@/lib/repositories/habits/habit-goal';
import { parseHabitKind, type HabitKind } from '@/lib/repositories/habits/habit-kind';
import { getTaskHabitTasksViewState } from '@/lib/repositories/habits/habit-task-period';
import {
  addDaysToYmd,
  formatScheduleDateToYMD,
  isLogicalDayInYmdRange,
} from '@/lib/standalone-todo-visibility';

export { addDaysToYmd } from '@/lib/standalone-todo-visibility';
import { getLogicalLocalYmd, type TasksDayBoundary } from '@/lib/tasks-logical-day';
import { parseTaskAuditDatetimeForLogicalDay } from '@/lib/api-mysql-datetime';
import type { HabitRow } from '@/lib/repositories/habits/habit.types';
import type { ProjectRow } from '@/lib/repositories/projects/project.types';
import { getFrogAssignedDates } from '@/lib/frog-assignment';
import { getFrogSessionCompletedOn } from '@/lib/long-term-task';
import { isTaskActiveStatus, isTaskTerminalStatus, type TaskRow } from '@/lib/repositories/tasks/task.types';

/** 日历详情中某日青蛙的完成态（相对 logicalTodayYmd） */
export type FrogCalendarDayStatus = 'pending' | 'completed' | 'partial' | 'incomplete';

/** 日历待办栏展示原因 */
export type TodoCalendarDayReason = 'completed' | 'due' | 'completed-and-due';

export type TasksCalendarTaskItem = {
  id: string;
  title: string;
  status: string;
  priority: number;
  kind: 'frog' | 'standalone' | 'matrix' | 'due';
  projectId: string | null;
  frogDayStatus?: FrogCalendarDayStatus;
  todoDayReason?: TodoCalendarDayReason;
};

export type TasksCalendarHabitItem = {
  id: string;
  name: string;
  icon: string;
  todayCount: number;
  dailyGoal: number | null;
  kind: HabitKind;
  periodProgress?: number | null;
  periodGoal?: number | null;
  taskShowPeriodCheck?: boolean;
  /** 戒除：当日是否有打卡记录（含 count=0 确认） */
  hasDayRecord?: boolean;
};

export type TasksCalendarProjectItem = {
  id: string;
  name: string;
  status: string;
};

export type TasksCalendarDaySummary = {
  ymd: string;
  frogs: TasksCalendarTaskItem[];
  standaloneTodos: TasksCalendarTaskItem[];
  matrixTasks: TasksCalendarTaskItem[];
  dueTasks: TasksCalendarTaskItem[];
  habits: TasksCalendarHabitItem[];
  projectsDue: TasksCalendarProjectItem[];
};

/** 聚合接口 `GET /api/calendar/tasks` 响应体（见 CALENDAR_API_FOR_APP.md） */
export type TasksCalendarResponse = {
  start: string;
  end: string;
  days: Record<string, TasksCalendarDaySummary>;
};

export function daysRecordToSummariesMap(
  days: Record<string, TasksCalendarDaySummary>,
): Map<string, TasksCalendarDaySummary> {
  return new Map(Object.entries(days));
}

export function calendarRangeKey(startYmd: string, endYmd: string): string {
  return `${startYmd}:${endYmd}`;
}

type ProjectScheduleMeta = {
  mode?: 'date' | 'time';
  date?: string;
  range?: { start: string; end: string };
};

function formatYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseProjectSchedule(extraData: string | null): ProjectScheduleMeta | null {
  if (!extraData) return null;
  try {
    const parsed = JSON.parse(extraData) as { schedule?: ProjectScheduleMeta };
    return parsed?.schedule ?? null;
  } catch {
    return null;
  }
}

function isMatrixTask(task: TaskRow): boolean {
  return !!(task.project_id || task.parent_task_id);
}

function taskDueYmd(task: TaskRow): string {
  return task.due_date?.trim().slice(0, 10) ?? '';
}

/** 习惯创建时刻对应的逻辑日（早于该日不应出现在任务日历） */
export function getHabitCreatedLogicalYmd(
  createdAt: string | null | undefined,
  boundary: TasksDayBoundary,
): string | null {
  if (!createdAt?.trim()) return null;
  const ms = Date.parse(createdAt);
  if (Number.isNaN(ms)) return null;
  return getLogicalLocalYmd(new Date(ms), boundary);
}

export function isHabitVisibleOnCalendarDay(
  habitCreatedAt: string | null | undefined,
  viewYmd: string,
  boundary: TasksDayBoundary,
): boolean {
  const createdYmd = getHabitCreatedLogicalYmd(habitCreatedAt, boundary);
  if (!createdYmd) return true;
  return viewYmd >= createdYmd;
}

/** API 聚合结果补滤：移除创建日之前的习惯展示 */
export function filterTasksCalendarHabitsBeforeCreation(
  summaries: Map<string, TasksCalendarDaySummary>,
  habits: HabitRow[],
  dayBoundary: TasksDayBoundary,
): void {
  const createdYmdById = new Map<string, string>();
  for (const habit of habits) {
    const createdYmd = getHabitCreatedLogicalYmd(habit.created_at, dayBoundary);
    if (createdYmd) createdYmdById.set(habit.id, createdYmd);
  }
  for (const [ymd, summary] of summaries) {
    summary.habits = summary.habits.filter((item) => {
      const createdYmd = createdYmdById.get(item.id);
      if (!createdYmd) return true;
      return ymd >= createdYmd;
    });
  }
}

function toTaskItem(task: TaskRow, kind: TasksCalendarTaskItem['kind']): TasksCalendarTaskItem {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    priority: task.priority,
    kind,
    projectId: task.project_id,
  };
}

export function resolveFrogCalendarDayStatus(params: {
  taskStatus: string;
  viewYmd: string;
  logicalTodayYmd: string;
  hasCompletionEvent: boolean;
  frogSessionCompletedOn: string;
}): FrogCalendarDayStatus {
  if (isTaskTerminalStatus(params.taskStatus)) return 'completed';
  if (params.hasCompletionEvent) return 'partial';
  if (
    params.viewYmd === params.logicalTodayYmd &&
    params.frogSessionCompletedOn === params.viewYmd
  ) {
    return 'partial';
  }
  if (params.viewYmd < params.logicalTodayYmd) return 'incomplete';
  return 'pending';
}

export function enrichTasksCalendarFrogDayStatus(
  summaries: Map<string, TasksCalendarDaySummary>,
  params: {
    logicalTodayYmd: string;
    frogCompletedTaskIdsByDay: Map<string, Set<string>>;
    taskMetaById: Map<string, { status: string; extra_data: string | null }>;
  },
): void {
  const { logicalTodayYmd, frogCompletedTaskIdsByDay, taskMetaById } = params;
  for (const [ymd, summary] of summaries) {
    const completedIds = frogCompletedTaskIdsByDay.get(ymd) ?? new Set<string>();
    summary.frogs = summary.frogs.map((frog) => {
      const meta = taskMetaById.get(frog.id);
      const status = meta?.status ?? frog.status;
      const extra = meta?.extra_data ?? null;
      const frogDayStatus = resolveFrogCalendarDayStatus({
        taskStatus: status,
        viewYmd: ymd,
        logicalTodayYmd,
        hasCompletionEvent: completedIds.has(frog.id),
        frogSessionCompletedOn: getFrogSessionCompletedOn(extra),
      });
      return { ...frog, status, frogDayStatus };
    });
  }
}

function isStandaloneCalendarTask(task: TaskRow): boolean {
  return !task.project_id && !task.parent_task_id;
}

function taskCompletedOnLogicalDay(task: TaskRow, ymd: string, boundary: TasksDayBoundary): boolean {
  if (!isTaskTerminalStatus(task.status)) return false;
  const raw = task.completed_at?.trim() || task.updated_at?.trim();
  if (!raw) return false;
  const doneAt = parseTaskAuditDatetimeForLogicalDay(raw);
  if (Number.isNaN(doneAt.getTime())) return false;
  return getLogicalLocalYmd(doneAt, boundary) === ymd;
}

function todoCalendarSortRank(reason: TodoCalendarDayReason | undefined): number {
  if (reason === 'due') return 0;
  if (reason === 'completed-and-due') return 1;
  return 2;
}

export function formatTasksCalendarPriority(priority: number): string {
  if (priority >= 4) return '紧急重要';
  if (priority === 3) return '紧急不重要';
  if (priority === 2) return '不紧急重要';
  if (priority === 1) return '不紧急不重要';
  return '';
}

/** 与任务 Tab 待办优先级色一致 */
export function getTasksCalendarPriorityColor(priority: number, isDark: boolean): string {
  if (priority >= 4) return isDark ? '#f87171' : '#ba1a1a';
  if (priority === 3) return isDark ? '#fbbf24' : '#9a5b00';
  if (priority === 2) return isDark ? '#60a5fa' : '#0058be';
  if (priority === 1) return isDark ? '#94a3b8' : '#727785';
  return isDark ? '#94a3b8' : '#727785';
}

export function enrichTasksCalendarStandaloneTodos(
  summaries: Map<string, TasksCalendarDaySummary>,
  params: {
    tasks: TaskRow[];
    dayBoundary: TasksDayBoundary;
    completedTaskIdsByDay: Map<string, Set<string>>;
  },
): void {
  const { tasks, dayBoundary, completedTaskIdsByDay } = params;
  const standaloneTasks = tasks.filter(isStandaloneCalendarTask);

  for (const [ymd, summary] of summaries) {
    const frogIds = new Set(summary.frogs.map((f) => f.id));
    const completedIds = completedTaskIdsByDay.get(ymd) ?? new Set<string>();
    const items: TasksCalendarTaskItem[] = [];

    for (const task of standaloneTasks) {
      if (frogIds.has(task.id)) continue;
      const dueOnDay = taskDueYmd(task) === ymd;
      const completedOnDay = completedIds.has(task.id) || taskCompletedOnLogicalDay(task, ymd, dayBoundary);
      if (!completedOnDay && !dueOnDay) continue;

      let todoDayReason: TodoCalendarDayReason;
      if (completedOnDay && dueOnDay) todoDayReason = 'completed-and-due';
      else if (completedOnDay) todoDayReason = 'completed';
      else todoDayReason = 'due';

      items.push({ ...toTaskItem(task, 'standalone'), todoDayReason });
    }

    items.sort((a, b) => {
      const rankDiff = todoCalendarSortRank(a.todoDayReason) - todoCalendarSortRank(b.todoDayReason);
      if (rankDiff !== 0) return rankDiff;
      return b.priority - a.priority;
    });

    summary.standaloneTodos = items;
  }
}

function emptyDay(ymd: string): TasksCalendarDaySummary {
  return {
    ymd,
    frogs: [],
    standaloneTodos: [],
    matrixTasks: [],
    dueTasks: [],
    habits: [],
    projectsDue: [],
  };
}

/** 日历格热力等级 0–4（与任务页信息密度对应） */
export function getTasksCalendarCellLevel(
  summary: TasksCalendarDaySummary | undefined,
  logicalTodayYmd?: string,
): 0 | 1 | 2 | 3 | 4 {
  if (!summary) return 0;
  const openTasks =
    summary.frogs.filter((t) => isTaskActiveStatus(t.status)).length +
    summary.standaloneTodos.filter((t) => isTaskActiveStatus(t.status)).length +
    summary.matrixTasks.filter((t) => isTaskActiveStatus(t.status)).length;
  const dueOpen = summary.dueTasks.filter((t) => isTaskActiveStatus(t.status)).length;
  const habitDue = summary.habits.length;
  const habitDone = summary.habits.filter((h) =>
    isHabitDayGoalMet({
      kind: h.kind,
      todayCount: h.todayCount,
      dailyGoal: h.dailyGoal,
      hasDayRecord: h.kind === 'break' ? h.hasDayRecord : undefined,
      ymd: summary.ymd,
      logicalTodayYmd,
    }),
  ).length;
  const frogDone = summary.frogs.filter((t) => t.status === 'done').length;
  const score = openTasks + dueOpen + habitDue + frogDone + habitDone + summary.projectsDue.length;
  if (score <= 0) return 0;
  if (score === 1) return 1;
  if (score <= 3) return 2;
  if (score <= 6) return 3;
  return 4;
}

export function buildTasksCalendarSummaries(params: {
  startYmd: string;
  endYmd: string;
  tasks: TaskRow[];
  habits: HabitRow[];
  projects: ProjectRow[];
  habitCheckInsByDay: Map<string, Map<string, number>>;
  dayBoundary: TasksDayBoundary;
}): Map<string, TasksCalendarDaySummary> {
  const { startYmd, endYmd, tasks, habits, projects, habitCheckInsByDay, dayBoundary } = params;
  const map = new Map<string, TasksCalendarDaySummary>();

  let cursor = startYmd;
  while (cursor <= endYmd) {
    map.set(cursor, emptyDay(cursor));
    cursor = addDaysToYmd(cursor, 1);
  }

  for (const task of tasks) {
    const due = taskDueYmd(task);
    if (due && due >= startYmd && due <= endYmd) {
      const day = map.get(due)!;
      const item = toTaskItem(task, 'due');
      if (!day.dueTasks.some((x) => x.id === item.id)) day.dueTasks.push(item);
      if (isMatrixTask(task) && !day.matrixTasks.some((x) => x.id === item.id)) {
        day.matrixTasks.push({ ...item, kind: 'matrix' });
      }
    }

    for (const frogOn of getFrogAssignedDates(task.extra_data)) {
      if (frogOn >= startYmd && frogOn <= endYmd) {
        const day = map.get(frogOn)!;
        const item = toTaskItem(task, 'frog');
        if (!day.frogs.some((x) => x.id === item.id)) day.frogs.push(item);
      }
    }
  }

  const preparedHabits = habits
    .map((habit) => {
      const kind = parseHabitKind(habit.extra_data);
      if (kind === 'break' && isBreakHabitSucceeded(habit.extra_data)) return null;
      if (kind === 'build' && isBuildHabitSucceeded(habit.extra_data)) return null;
      return {
        habit,
        kind,
        dailyGoal: parseHabitDailyGoal(habit.extra_data, kind),
      };
    })
    .filter((row): row is NonNullable<typeof row> => row != null);

  const habitCheckInsByHabit = new Map<string, Record<string, number>>();
  for (const [dayYmd, dayMap] of habitCheckInsByDay) {
    for (const [habitId, count] of dayMap) {
      const prev = habitCheckInsByHabit.get(habitId) ?? {};
      prev[dayYmd] = count;
      habitCheckInsByHabit.set(habitId, prev);
    }
  }

  for (let ymd = startYmd; ymd <= endYmd; ymd = addDaysToYmd(ymd, 1)) {
    const day = map.get(ymd)!;
    const checkMap = habitCheckInsByDay.get(ymd) ?? new Map<string, number>();

    for (const { habit, kind, dailyGoal } of preparedHabits) {
      const checkIns = habitCheckInsByHabit.get(habit.id) ?? {};
      const taskViewState =
        kind === 'task'
          ? getTaskHabitTasksViewState({
              extraData: habit.extra_data,
              checkIns,
              logicalYmd: ymd,
            })
          : null;
      if (taskViewState?.hiddenOnViewDay) continue;
      if (!isHabitVisibleOnCalendarDay(habit.created_at, ymd, dayBoundary)) continue;
      if (!isHabitScheduledOnLogicalYmd(habit.extra_data, ymd)) continue;
      const habitRecord = habitCheckInsByHabit.get(habit.id) ?? {};
      const hasDayRecord =
        kind === 'break' ? Object.prototype.hasOwnProperty.call(habitRecord, ymd) : undefined;
      const count = hasDayRecord ? (habitRecord[ymd] ?? 0) : (checkMap.get(habit.id) ?? 0);
      day.habits.push({
        id: habit.id,
        name: habit.name,
        icon: habit.icon,
        todayCount: count,
        dailyGoal,
        kind,
        hasDayRecord,
        periodProgress: taskViewState?.periodProgress ?? null,
        periodGoal: taskViewState?.periodGoal ?? null,
        taskShowPeriodCheck: taskViewState?.showPeriodCheckOnViewDay ?? false,
      });
    }

    for (const task of tasks) {
      if (isMatrixTask(task) && task.status !== 'done' && task.status !== 'cancelled') {
        const due = taskDueYmd(task);
        if (due === ymd) continue;
        const schedule = parseProjectSchedule(task.extra_data);
        let onDay = false;
        if (schedule?.mode === 'time' && schedule.range?.start && schedule.range?.end) {
          const start = formatScheduleDateToYMD(schedule.range.start);
          const end = formatScheduleDateToYMD(schedule.range.end);
          onDay = isLogicalDayInYmdRange(ymd, start, end);
        } else if (schedule?.date) {
          onDay = ymd === formatScheduleDateToYMD(schedule.date);
        }
        if (onDay) {
          const item = toTaskItem(task, 'matrix');
          if (!day.matrixTasks.some((x) => x.id === item.id)) day.matrixTasks.push(item);
        }
      }
    }

    for (const project of projects) {
      const due = project.due_date?.trim().slice(0, 10) ?? '';
      if (due === ymd && project.status !== 'archived') {
        day.projectsDue.push({ id: project.id, name: project.name, status: project.status });
      }
    }
  }

  return map;
}

export function listYmdRange(startYmd: string, endYmd: string): string[] {
  const out: string[] = [];
  let cursor = startYmd;
  while (cursor <= endYmd) {
    out.push(cursor);
    cursor = addDaysToYmd(cursor, 1);
  }
  return out;
}

export function monthGridBounds(targetMonth: Date): { gridStartYmd: string; gridEndYmd: string } {
  const first = new Date(targetMonth.getFullYear(), targetMonth.getMonth(), 1);
  const mondayOffset = (first.getDay() + 6) % 7;
  const gridStart = new Date(first);
  gridStart.setDate(first.getDate() - mondayOffset);
  const gridEnd = new Date(gridStart);
  gridEnd.setDate(gridStart.getDate() + 41);
  return { gridStartYmd: formatYmd(gridStart), gridEndYmd: formatYmd(gridEnd) };
}
