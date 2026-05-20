import { getDatabase } from '../../database.native';

export type FrogCompletionEventAction = 'completed' | 'reopened';

export type FrogCompletionDayItem = {
  id: string;
  task_id: string | null;
  assigned_ymd: string;
  task_title: string | null;
};

export async function insertFrogCompletionEvent(
  taskId: string,
  assignedYmd: string,
  action: FrogCompletionEventAction,
  taskTitle: string | null
): Promise<void> {
  const ymd = assignedYmd.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return;
  const db = await getDatabase();
  const id = `fevt_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  await db.runAsync(
    `INSERT INTO frog_completion_events (id, task_id, assigned_ymd, action, created_at, task_title)
     VALUES (?, ?, ?, ?, datetime('now'), ?)`,
    [id, taskId, ymd, action, taskTitle?.trim() || null]
  );
}

/** 按青蛙指派日统计「标记完成」次数（与待办总览热力图口径一致，仅计 completed） */
export async function getFrogCompletionCountsByDayRange(
  startYmd: string,
  endYmd: string
): Promise<Map<string, number>> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ day: string; cnt: number }>(
    `SELECT assigned_ymd AS day, COUNT(*) AS cnt
       FROM frog_completion_events
      WHERE action = 'completed'
        AND assigned_ymd >= ?
        AND assigned_ymd <= ?
      GROUP BY assigned_ymd`,
    [startYmd, endYmd]
  );
  const m = new Map<string, number>();
  for (const r of rows) {
    if (r.day) m.set(r.day, Number(r.cnt));
  }
  return m;
}

/** 某一指派日内的已完成青蛙明细（含任务已删时的标题快照） */
export async function getFrogCompletionsForAssignedDay(ymd: string): Promise<FrogCompletionDayItem[]> {
  const db = await getDatabase();
  return db.getAllAsync<FrogCompletionDayItem>(
    `SELECT e.id, e.task_id, e.assigned_ymd,
            COALESCE(NULLIF(trim(t.title), ''), NULLIF(trim(e.task_title), '')) AS task_title
       FROM frog_completion_events e
       LEFT JOIN tasks t ON t.id = e.task_id AND t.deleted_at IS NULL
      WHERE e.action = 'completed'
        AND e.assigned_ymd = ?
      ORDER BY datetime(e.created_at) ASC`,
    [ymd]
  );
}

/** 将历史「已完成且带 frogAssignedOn」的任务补写入事件表（升级后执行一次） */
export async function backfillFrogCompletionEventsFromTasks(): Promise<number> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ id: string; title: string; extra_data: string | null }>(
    `SELECT id, title, extra_data FROM tasks
      WHERE deleted_at IS NULL
        AND status IN ('done', 'cancelled')
        AND extra_data IS NOT NULL
        AND trim(extra_data) != ''`
  );
  let inserted = 0;
  for (const row of rows) {
    let assigned = '';
    try {
      const parsed = JSON.parse(row.extra_data ?? '{}') as { frogAssignedOn?: unknown };
      assigned = typeof parsed.frogAssignedOn === 'string' ? parsed.frogAssignedOn.trim() : '';
    } catch {
      continue;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(assigned)) continue;
    const existing = await db.getFirstAsync<{ c: number }>(
      `SELECT COUNT(*) AS c FROM frog_completion_events
        WHERE task_id = ? AND assigned_ymd = ? AND action = 'completed'`,
      [row.id, assigned]
    );
    if (Number(existing?.c ?? 0) > 0) continue;
    await insertFrogCompletionEvent(row.id, assigned, 'completed', row.title ?? null);
    inserted += 1;
  }
  return inserted;
}
