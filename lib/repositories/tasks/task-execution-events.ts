import { getDatabase } from '../../database.native';

export type TaskExecutionEventAction = 'completed' | 'reopened';

export async function insertTaskExecutionEvent(
  taskId: string,
  action: TaskExecutionEventAction,
  taskTitle: string | null
): Promise<void> {
  const db = await getDatabase();
  const id = `tevt_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  await db.runAsync(
    `INSERT INTO task_execution_events (id, task_id, action, created_at, task_title) VALUES (?, ?, ?, datetime('now'), ?)`,
    [id, taskId, action, taskTitle?.trim() || null]
  );
}

export type TaskExecutionEventWithTitle = {
  id: string;
  task_id: string;
  action: string;
  created_at: string;
  task_title: string | null;
};

/** 某一本地日内的全部执行事件（含完成与恢复），按时间正序 */
export async function getTaskExecutionEventsForLocalDay(ymd: string): Promise<TaskExecutionEventWithTitle[]> {
  const db = await getDatabase();
  return db.getAllAsync<TaskExecutionEventWithTitle>(
    `SELECT e.id, e.task_id, e.action, e.created_at,
            COALESCE(NULLIF(trim(t.title), ''), NULLIF(trim(e.task_title), '')) AS task_title
       FROM task_execution_events e
       LEFT JOIN tasks t ON t.id = e.task_id
      WHERE date(e.created_at) = date(?)
      ORDER BY datetime(e.created_at) ASC`,
    [ymd]
  );
}

export async function getRecentTaskExecutionEvents(limit: number): Promise<TaskExecutionEventWithTitle[]> {
  const db = await getDatabase();
  return db.getAllAsync<TaskExecutionEventWithTitle>(
    `SELECT e.id, e.task_id, e.action, e.created_at,
            COALESCE(NULLIF(trim(t.title), ''), NULLIF(trim(e.task_title), '')) AS task_title
       FROM task_execution_events e
       LEFT JOIN tasks t ON t.id = e.task_id
      ORDER BY datetime(e.created_at) DESC
      LIMIT ?`,
    [limit]
  );
}

/** 按本地日历日统计「标记完成」次数 */
export async function getTaskCompletionCountsByDayRange(startYmd: string, endYmd: string): Promise<Map<string, number>> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ day: string; cnt: number }>(
    `SELECT date(created_at) AS day, COUNT(*) AS cnt
       FROM task_execution_events
      WHERE action = 'completed'
        AND date(created_at) >= date(?)
        AND date(created_at) <= date(?)
      GROUP BY date(created_at)`,
    [startYmd, endYmd]
  );
  const m = new Map<string, number>();
  for (const r of rows) {
    if (r.day) m.set(r.day, Number(r.cnt));
  }
  return m;
}

export async function getFirstCompletedEventDayYmd(): Promise<string | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ d: string | null }>(
    `SELECT date(MIN(created_at)) AS d FROM task_execution_events WHERE action = 'completed'`
  );
  const d = row?.d?.trim();
  return d || null;
}

export async function getTaskGlobalInsightCounts(): Promise<{
  totalActive: number;
  open: number;
  doneOrCancelled: number;
  completedEvents: number;
  reopenedEvents: number;
}> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{
    totalActive: number | null;
    open: number | null;
    donecc: number | null;
    comp: number | null;
    reop: number | null;
  }>(
    `SELECT
       (SELECT COUNT(1) FROM tasks WHERE deleted_at IS NULL) AS totalActive,
       (SELECT COUNT(1) FROM tasks WHERE deleted_at IS NULL AND status NOT IN ('done','cancelled')) AS open,
       (SELECT COUNT(1) FROM tasks WHERE deleted_at IS NULL AND status IN ('done','cancelled')) AS donecc,
       (SELECT COUNT(1) FROM task_execution_events WHERE action = 'completed') AS comp,
       (SELECT COUNT(1) FROM task_execution_events WHERE action = 'reopened') AS reop`
  );
  return {
    totalActive: Number(row?.totalActive ?? 0),
    open: Number(row?.open ?? 0),
    doneOrCancelled: Number(row?.donecc ?? 0),
    completedEvents: Number(row?.comp ?? 0),
    reopenedEvents: Number(row?.reop ?? 0),
  };
}
