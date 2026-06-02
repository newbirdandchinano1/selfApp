import { makeTimestampEntityId } from '@/lib/entity-id';
import { readApiTable } from '@/lib/api-read';
import { compareDatetimeDesc, isYmdInRange } from '@/lib/api-read-helpers';
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
  const id = makeTimestampEntityId('fevt_', 8);
  await db.runAsync(
    `INSERT INTO frog_completion_events (id, task_id, assigned_ymd, action, created_at, task_title, sync_status)
     VALUES (?, ?, ?, ?, datetime('now'), ?, 'pending_create')`,
    [id, taskId, ymd, action, taskTitle?.trim() || null]
  );
}

/** 按青蛙指派日统计「标记完成」次数（与待办总览热力图口径一致，仅计 completed） */
export async function getFrogCompletionCountsByDayRange(
  startYmd: string,
  endYmd: string
): Promise<Map<string, number>> {
  const rows = await readApiTable<{ assigned_ymd: string; action: string }>('frog_completion_events', {
    offlineFallback: true,
  });
  const m = new Map<string, number>();
  for (const r of rows) {
    if (r.action !== 'completed') continue;
    if (!r.assigned_ymd || !isYmdInRange(r.assigned_ymd, startYmd, endYmd)) continue;
    m.set(r.assigned_ymd, (m.get(r.assigned_ymd) ?? 0) + 1);
  }
  return m;
}

/** 某一指派日内的已完成青蛙明细（含任务已删时的标题快照） */
export async function getFrogCompletionsForAssignedDay(ymd: string): Promise<FrogCompletionDayItem[]> {
  const [events, tasks] = await Promise.all([
    readApiTable<{ id: string; task_id: string | null; assigned_ymd: string; action: string; task_title?: string | null; created_at: string }>(
      'frog_completion_events',
      { offlineFallback: true },
    ),
    readApiTable<{ id: string; title?: string | null }>('tasks', { offlineFallback: true }),
  ]);
  const taskById = new Map(tasks.map(t => [t.id, t]));
  return events
    .filter(e => e.action === 'completed' && e.assigned_ymd === ymd)
    .sort((a, b) => compareDatetimeDesc(a.created_at, b.created_at) * -1)
    .map(e => ({
      id: e.id,
      task_id: e.task_id,
      assigned_ymd: e.assigned_ymd,
      task_title: taskById.get(e.task_id ?? '')?.title?.trim() || e.task_title?.trim() || null,
    }));
}

/** 将历史「已完成且带 frogAssignedOn」的任务补写入事件表（升级后执行一次） */
export async function backfillFrogCompletionEventsFromTasks(): Promise<number> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ id: string; title: string; extra_data: string | null }>(
    `SELECT id, title, extra_data FROM tasks
     WHERE status IN ('done', 'cancelled')
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
