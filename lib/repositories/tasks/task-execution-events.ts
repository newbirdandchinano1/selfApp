import { ensureLocalRowPresent } from '@/lib/api-local-row';
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

/** 同一任务 + 本地日只保留最新一次操作；仅当最新为 completed 时计入热力图 */
function filterNetCompletedTaskEvents<T extends EventRowLite>(events: T[]): T[] {
  const latestByKey = new Map<string, T>();
  for (const e of events) {
    const day = ymdFromDatetime(e.created_at);
    if (!day) continue;
    const groupKey = `${e.task_id}\0${day}`;
    const prev = latestByKey.get(groupKey);
    if (!prev || compareDatetimeDesc(prev.created_at, e.created_at) > 0) {
      latestByKey.set(groupKey, e);
    }
  }
  return [...latestByKey.values()].filter((e) => e.action === 'completed');
}

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
  const taskReady = await ensureLocalRowPresent('tasks', taskId);
  if (!taskReady) {
    throw new Error('任务尚未同步到本地，无法记录执行事件');
  }
  const db = await getDatabase();
  const id = makeTimestampEntityId('tevt_', 8);
  await db.runAsync(
    `INSERT INTO task_execution_events (id, task_id, action, created_at, task_title, sync_status)
     VALUES (?, ?, ?, datetime('now'), ?, 'pending_create')`,
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

/** 某一本地日内仍有效的「标记完成」记录（取消完成后再完成只计一次） */
export async function getNetCompletedTaskEventsForLocalDay(ymd: string): Promise<TaskExecutionEventWithTitle[]> {
  const events = await loadScopedExecutionEvents();
  return filterNetCompletedTaskEvents(events)
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

/** 按本地日历日返回已完成待办的 task_id 集合（与热力图口径一致，仅计 net completed） */
export async function getTaskCompletedTaskIdsByDayRange(
  startYmd: string,
  endYmd: string,
): Promise<Map<string, Set<string>>> {
  const events = await loadScopedExecutionEvents();
  const m = new Map<string, Set<string>>();
  for (const e of filterNetCompletedTaskEvents(events)) {
    const day = ymdFromDatetime(e.created_at);
    if (!day || !isYmdInRange(day, startYmd, endYmd)) continue;
    const set = m.get(day) ?? new Set<string>();
    set.add(e.task_id);
    m.set(day, set);
  }
  return m;
}

/** 按本地日历日统计「标记完成」次数 */
export async function getTaskCompletionCountsByDayRange(startYmd: string, endYmd: string): Promise<Map<string, number>> {
  const events = await loadScopedExecutionEvents();
  const m = new Map<string, number>();
  for (const e of filterNetCompletedTaskEvents(events)) {
    const day = ymdFromDatetime(e.created_at);
    if (!day || !isYmdInRange(day, startYmd, endYmd)) continue;
    m.set(day, (m.get(day) ?? 0) + 1);
  }
  return m;
}

export async function getFirstCompletedEventDayYmd(): Promise<string | null> {
  const events = await loadScopedExecutionEvents().then(filterNetCompletedTaskEvents);
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
