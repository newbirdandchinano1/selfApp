import { isHabitScheduledOnLogicalYmd } from '@/lib/habit-schedule';
import { isBreakHabitSucceeded } from '@/lib/repositories/habits/habit-break-success';
import { isBuildHabitSucceeded } from '@/lib/repositories/habits/habit-build-success';
import { isHabitDayGoalMet, parseHabitDailyGoal } from '@/lib/repositories/habits/habit-goal';
import { parseHabitKind, type HabitKind } from '@/lib/repositories/habits/habit-kind';
import { isTaskRepeatDueOnLogicalDay, parseTaskRepeatSchedule } from '@/lib/task-repeat-rollover';
import type { TasksDayBoundary } from '@/lib/tasks-logical-day';
import { getLogicalLocalYmd } from '@/lib/tasks-logical-day';
import type { HabitRow } from '@/lib/repositories/habits/habit.types';
import type { ProjectRow } from '@/lib/repositories/projects/project.types';
import { isTaskActiveStatus, type TaskRow } from '@/lib/repositories/tasks/task.types';

export type TasksCalendarTaskItem = {
  id: string;
  title: string;
  status: string;
  priority: number;
  kind: 'frog' | 'standalone' | 'matrix' | 'due';
  projectId: string | null;
};

export type TasksCalendarHabitItem = {
  id: string;
  name: string;
  icon: string;
  todayCount: number;
  dailyGoal: number | null;
  kind: HabitKind;
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

type ProjectScheduleMeta = {
  mode?: 'date' | 'time';
  date?: string;
  range?: { start: string; end: string };
};

type TaskMetaExtra = { frogAssignedOn?: string };

function formatYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDaysToYmd(ymd: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return ymd;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  d.setDate(d.getDate() + days);
  return formatYmd(d);
}

function formatScheduleDateToYMD(value: string): string {
  const t = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return t.slice(0, 10);
  return formatYmd(d);
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

function parseTaskMeta(extraData: string | null): TaskMetaExtra {
  if (!extraData) return {};
  try {
    const parsed = JSON.parse(extraData) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as TaskMetaExtra;
    }
  } catch {
    /* ignore */
  }
  return {};
}

function isLogicalDayInYmdRange(todayYmd: string, startYmd: string, endYmd: string): boolean {
  if (!startYmd || !endYmd) return true;
  if (todayYmd < startYmd) return false;
  if (startYmd === endYmd) return todayYmd === startYmd;
  if (endYmd === addDaysToYmd(startYmd, 1)) return todayYmd < endYmd;
  return todayYmd <= endYmd;
}

function standaloneTodoPassesDayBoundaryFilter(
  task: TaskRow,
  boundary: TasksDayBoundary,
  logicalViewYmd: string
): boolean {
  if (task.status !== 'done' && task.status !== 'cancelled') return true;
  const raw = task.completed_at?.trim() || task.updated_at?.trim();
  if (!raw) return true;
  const ms = Date.parse(raw);
  if (Number.isNaN(ms)) return true;
  const doneLogicalYmd = getLogicalLocalYmd(new Date(ms), boundary);
  return doneLogicalYmd >= logicalViewYmd;
}

function isStandaloneTodoOpen(task: TaskRow): boolean {
  return isTaskActiveStatus(task.status);
}

function isStandaloneTodoScheduleExpired(task: TaskRow, logicalViewYmd: string): boolean {
  if (!isStandaloneTodoOpen(task)) return false;
  if (parseTaskRepeatSchedule(task.extra_data)) return false;
  const schedule = parseProjectSchedule(task.extra_data);
  if (!schedule) return false;
  if (schedule.mode === 'time' && schedule.range?.start && schedule.range?.end) {
    const start = formatScheduleDateToYMD(schedule.range.start);
    const end = formatScheduleDateToYMD(schedule.range.end);
    return !isLogicalDayInYmdRange(logicalViewYmd, start, end);
  }
  if (schedule.date) {
    return logicalViewYmd > formatScheduleDateToYMD(schedule.date);
  }
  return false;
}

function standaloneTodoPassesRepeatDayFilter(task: TaskRow, logicalViewYmd: string): boolean {
  if (task.status === 'shelved') return true;
  const schedule = parseTaskRepeatSchedule(task.extra_data);
  if (!schedule) return true;
  if (isTaskRepeatDueOnLogicalDay(logicalViewYmd, schedule)) return true;
  if (!isStandaloneTodoOpen(task)) return false;
  const dueYmd = task.due_date?.trim().slice(0, 10) ?? '';
  const dueOverdue =
    !!dueYmd &&
    logicalViewYmd > dueYmd &&
    task.status !== 'done' &&
    task.status !== 'cancelled';
  return dueOverdue || isStandaloneTodoScheduleExpired(task, logicalViewYmd);
}

function standaloneTodoPassesScheduleWindowFilter(task: TaskRow, logicalViewYmd: string): boolean {
  if (task.status === 'shelved') return true;
  if (parseTaskRepeatSchedule(task.extra_data)) return true;
  const schedule = parseProjectSchedule(task.extra_data);
  if (schedule?.mode === 'time' && schedule.range?.start && schedule.range?.end) {
    const start = formatScheduleDateToYMD(schedule.range.start);
    const end = formatScheduleDateToYMD(schedule.range.end);
    if (isLogicalDayInYmdRange(logicalViewYmd, start, end)) return true;
    return isStandaloneTodoOpen(task) && isStandaloneTodoScheduleExpired(task, logicalViewYmd);
  }
  if (schedule?.date) {
    const schedYmd = formatScheduleDateToYMD(schedule.date);
    if (logicalViewYmd === schedYmd) return true;
    return isStandaloneTodoOpen(task) && logicalViewYmd > schedYmd;
  }
  return true;
}

function isStandaloneTodoVisibleOnDay(task: TaskRow, logicalViewYmd: string, boundary: TasksDayBoundary): boolean {
  if (task.project_id || task.parent_task_id) return false;
  return (
    standaloneTodoPassesDayBoundaryFilter(task, boundary, logicalViewYmd) &&
    standaloneTodoPassesRepeatDayFilter(task, logicalViewYmd) &&
    standaloneTodoPassesScheduleWindowFilter(task, logicalViewYmd)
  );
}

function isMatrixTask(task: TaskRow): boolean {
  return !!(task.project_id || task.parent_task_id);
}

function taskDueYmd(task: TaskRow): string {
  return task.due_date?.trim().slice(0, 10) ?? '';
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
export function getTasksCalendarCellLevel(summary: TasksCalendarDaySummary | undefined): 0 | 1 | 2 | 3 | 4 {
  if (!summary) return 0;
  const openTasks =
    summary.frogs.filter((t) => isTaskActiveStatus(t.status)).length +
    summary.standaloneTodos.filter((t) => isTaskActiveStatus(t.status)).length +
    summary.matrixTasks.filter((t) => isTaskActiveStatus(t.status)).length;
  const dueOpen = summary.dueTasks.filter((t) => isTaskActiveStatus(t.status)).length;
  const habitDue = summary.habits.length;
  const habitDone = summary.habits.filter((h) =>
    isHabitDayGoalMet({ kind: h.kind, todayCount: h.todayCount, dailyGoal: h.dailyGoal })
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

    const frogOn = (parseTaskMeta(task.extra_data).frogAssignedOn ?? '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(frogOn) && frogOn >= startYmd && frogOn <= endYmd) {
      const day = map.get(frogOn)!;
      const item = toTaskItem(task, 'frog');
      if (!day.frogs.some((x) => x.id === item.id)) day.frogs.push(item);
    }
  }

  for (let ymd = startYmd; ymd <= endYmd; ymd = addDaysToYmd(ymd, 1)) {
    const day = map.get(ymd)!;
    const checkMap = habitCheckInsByDay.get(ymd) ?? new Map<string, number>();

    for (const habit of habits) {
      if (parseHabitKind(habit.extra_data) === 'break' && isBreakHabitSucceeded(habit.extra_data)) continue;
      if (parseHabitKind(habit.extra_data) === 'build' && isBuildHabitSucceeded(habit.extra_data)) continue;
      if (!isHabitScheduledOnLogicalYmd(habit.extra_data, ymd)) continue;
      const count = checkMap.get(habit.id) ?? 0;
      const kind = parseHabitKind(habit.extra_data);
      const dailyGoal = parseHabitDailyGoal(habit.extra_data, kind);
      day.habits.push({
        id: habit.id,
        name: habit.name,
        icon: habit.icon,
        todayCount: count,
        dailyGoal,
        kind,
      });
    }

    for (const task of tasks) {
      if (isStandaloneTodoVisibleOnDay(task, ymd, dayBoundary)) {
        const item = toTaskItem(task, 'standalone');
        if (!day.standaloneTodos.some((x) => x.id === item.id)) day.standaloneTodos.push(item);
      }
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
