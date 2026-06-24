import { ensureLocalRowPresent } from '@/lib/api-local-row';
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

type FrogCompletionEventRow = {
  id: string;
  task_id: string | null;
  assigned_ymd: string;
  action: string;
  created_at: string;
};

/** 同一青蛙任务 + 指派日只保留最新一次操作；仅当最新为 completed 时计入热力图 */
function filterNetCompletedFrogEvents<T extends FrogCompletionEventRow>(events: T[]): T[] {
  const latestByKey = new Map<string, T>();
  for (const e of events) {
    const groupKey = e.task_id ? `${e.task_id}\0${e.assigned_ymd}` : `${e.id}\0${e.assigned_ymd}`;
    const prev = latestByKey.get(groupKey);
    if (!prev || compareDatetimeDesc(prev.created_at, e.created_at) > 0) {
      latestByKey.set(groupKey, e);
    }
  }
  return [...latestByKey.values()].filter((e) => e.action === 'completed');
}

export async function insertFrogCompletionEvent(
  taskId: string,
  assignedYmd: string,
  action: FrogCompletionEventAction,
  taskTitle: string | null
): Promise<void> {
  const ymd = assignedYmd.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return;
  const taskReady = await ensureLocalRowPresent('tasks', taskId);
  if (!taskReady) {
    throw new Error('任务尚未同步到本地，无法记录青蛙完成事件');
  }
  const db = await getDatabase();
  const id = makeTimestampEntityId('fevt_', 8);
  await db.runAsync(
    `INSERT INTO frog_completion_events (id, task_id, assigned_ymd, action, created_at, task_title, sync_status)
     VALUES (?, ?, ?, ?, datetime('now'), ?, 'pending_create')`,
    [id, taskId, ymd, action, taskTitle?.trim() || null]
  );
}

/** 按指派日返回已完成青蛙的 task_id 集合（与热力图口径一致，仅计 net completed） */
export async function getFrogCompletedTaskIdsByDayRange(
  startYmd: string,
  endYmd: string,
): Promise<Map<string, Set<string>>> {
  const rows = await readApiTable<FrogCompletionEventRow>('frog_completion_events', {
    offlineFallback: true,
  });
  const m = new Map<string, Set<string>>();
  for (const r of filterNetCompletedFrogEvents(rows)) {
    if (!r.assigned_ymd || !isYmdInRange(r.assigned_ymd, startYmd, endYmd)) continue;
    if (!r.task_id) continue;
    const set = m.get(r.assigned_ymd) ?? new Set<string>();
    set.add(r.task_id);
    m.set(r.assigned_ymd, set);
  }
  return m;
}

/** 按青蛙指派日统计「标记完成」次数（与待办总览热力图口径一致，仅计 completed） */
export async function getFrogCompletionCountsByDayRange(
  startYmd: string,
  endYmd: string
): Promise<Map<string, number>> {
  const rows = await readApiTable<FrogCompletionEventRow>('frog_completion_events', {
    offlineFallback: true,
  });
  const m = new Map<string, number>();
  for (const r of filterNetCompletedFrogEvents(rows)) {
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
  return filterNetCompletedFrogEvents(events)
    .filter(e => e.assigned_ymd === ymd)
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
