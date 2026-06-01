import { makeTimestampEntityId } from '@/lib/entity-id';
import { readApiTable } from '@/lib/api-read';
import { compareDatetimeDesc, isYmdInRange, matchesOverviewScope, ymdFromDatetime } from '@/lib/api-read-helpers';
import { getDatabase } from '../../database.native';

export type TaskExecutionEventAction = 'completed' | 'reopened';

type TaskRowLite = {
  id: string;
  title?: string | null;
  project_id?: string | null;
  parent_task_id?: string | null;
  status?: string;
};

type EventRowLite = {
  id: string;
  task_id: string;
  action: string;
  created_at: string;
  task_title?: string | null;
};

export type TaskExecutionEventWithTitle = {
  id: string;
  task_id: string;
  action: string;
  created_at: string;
  task_title: string | null;
};

async function loadScopedExecutionEvents(): Promise<TaskExecutionEventWithTitle[]> {
  const [events, tasks] = await Promise.all([
    readApiTable<EventRowLite>('task_execution_events', { offlineFallback: true }),
    readApiTable<TaskRowLite>('tasks', { offlineFallback: true }),
  ]);
  const taskById = new Map(tasks.map(t => [t.id, t]));
  return events
    .filter(e => {
      const t = taskById.get(e.task_id);
      return t && matchesOverviewScope(t);
    })
    .map(e => {
      const t = taskById.get(e.task_id);
      const title = t?.title?.trim() || e.task_title?.trim() || null;
      return { id: e.id, task_id: e.task_id, action: e.action, created_at: e.created_at, task_title: title };
    });
}

export async function insertTaskExecutionEvent(
  taskId: string,
  action: TaskExecutionEventAction,
  taskTitle: string | null
): Promise<void> {
  const db = await getDatabase();
  const id = makeTimestampEntityId('tevt_', 8);
  await db.runAsync(
    `INSERT INTO task_execution_events (id, task_id, action, created_at, task_title) VALUES (?, ?, ?, datetime('now'), ?)`,
    [id, taskId, action, taskTitle?.trim() || null]
  );
}

/** 某一本地日内的全部执行事件（含完成与恢复），按时间正序 */
export async function getTaskExecutionEventsForLocalDay(ymd: string): Promise<TaskExecutionEventWithTitle[]> {
  const events = await loadScopedExecutionEvents();
  return events
    .filter(e => ymdFromDatetime(e.created_at) === ymd)
    .sort((a, b) => compareDatetimeDesc(a.created_at, b.created_at) * -1);
}

export async function getTaskExecutionEventsByAction(
  action: TaskExecutionEventAction,
  limit = 500
): Promise<TaskExecutionEventWithTitle[]> {
  return getTaskExecutionEventsByActionPage(action, limit, 0);
}

export async function getTaskExecutionEventsByActionPage(
  action: TaskExecutionEventAction,
  limit: number,
  offset: number
): Promise<TaskExecutionEventWithTitle[]> {
  const events = await loadScopedExecutionEvents();
  return events
    .filter(e => e.action === action)
    .sort((a, b) => compareDatetimeDesc(a.created_at, b.created_at))
    .slice(offset, offset + limit);
}

export async function countTaskExecutionEventsInScope(): Promise<number> {
  return (await loadScopedExecutionEvents()).length;
}

export async function countTaskExecutionEventsByAction(action: TaskExecutionEventAction): Promise<number> {
  return (await loadScopedExecutionEvents()).filter(e => e.action === action).length;
}

export async function getRecentTaskExecutionEvents(limit: number): Promise<TaskExecutionEventWithTitle[]> {
  return getRecentTaskExecutionEventsPage(limit, 0);
}

export async function getRecentTaskExecutionEventsPage(
  limit: number,
  offset: number
): Promise<TaskExecutionEventWithTitle[]> {
  const events = await loadScopedExecutionEvents();
  return events
    .sort((a, b) => compareDatetimeDesc(a.created_at, b.created_at))
    .slice(offset, offset + limit);
}

/** 按本地日历日统计「标记完成」次数 */
export async function getTaskCompletionCountsByDayRange(startYmd: string, endYmd: string): Promise<Map<string, number>> {
  const events = await loadScopedExecutionEvents();
  const m = new Map<string, number>();
  for (const e of events) {
    if (e.action !== 'completed') continue;
    const day = ymdFromDatetime(e.created_at);
    if (!day || !isYmdInRange(day, startYmd, endYmd)) continue;
    m.set(day, (m.get(day) ?? 0) + 1);
  }
  return m;
}

export async function getFirstCompletedEventDayYmd(): Promise<string | null> {
  const events = await loadScopedExecutionEvents().then(rows =>
    rows.filter(e => e.action === 'completed'),
  );
  if (events.length === 0) return null;
  const days = events
    .map(e => ymdFromDatetime(e.created_at))
    .filter((d): d is string => Boolean(d))
    .sort();
  return days[0] ?? null;
}

export async function getTaskGlobalInsightCounts(): Promise<{
  totalActive: number;
  open: number;
  doneOrCancelled: number;
  completedEvents: number;
  reopenedEvents: number;
}> {
  const [tasks, events] = await Promise.all([
    readApiTable<TaskRowLite>('tasks', { offlineFallback: true }),
    loadScopedExecutionEvents(),
  ]);
  const scoped = tasks.filter(matchesOverviewScope);
  const open = scoped.filter(t => t.status !== 'done' && t.status !== 'cancelled').length;
  const doneOrCancelled = scoped.filter(t => t.status === 'done' || t.status === 'cancelled').length;
  return {
    totalActive: scoped.length,
    open,
    doneOrCancelled,
    completedEvents: events.filter(e => e.action === 'completed').length,
    reopenedEvents: events.filter(e => e.action === 'reopened').length,
  };
}
