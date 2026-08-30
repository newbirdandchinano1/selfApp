import { formatTaskAuditDatetimeLocal } from '@/lib/api-mysql-datetime';
import { ensureLocalRowPresent } from '@/lib/api-local-row';
import { invalidateInflightApiTableFetch } from '@/lib/api-read';
import { makeTimestampEntityId } from '@/lib/entity-id';
import { readApiTable } from '@/lib/api-read';
import { compareDatetimeDesc, isYmdInRange } from '@/lib/api-read-helpers';
import type { TaskPriority, TaskRow } from '@/lib/repositories/tasks/task.types';
import { getDatabase } from '../../database.native';

export type FrogCompletionEventAction = 'completed' | 'reopened';

/** 热力图聚合只读本地，避免 REST 全量拉取 reconcile 覆盖刚写入的事件 */
const HEATMAP_EVENT_READ_OPTS = { offlineFallback: true, localOnly: true as const };

export type FrogCompletionSubject = 'task' | 'project';

export type FrogCompletionDayItem = {
  id: string;
  task_id: string | null;
  assigned_ymd: string;
  task_title: string | null;
  /** 任务青蛙 / 项目青蛙；未知时由打开逻辑再分辨 */
  subject?: FrogCompletionSubject;
};

type FrogCompletionEventRow = {
  id: string;
  task_id: string | null;
  assigned_ymd: string;
  action: string;
  created_at: string;
};

/** extra_data 标记：主体已删，今日栏仅作完成快照展示 */
export const FROG_SUBJECT_DELETED_KEY = 'frogSubjectDeleted';

export function isFrogSubjectDeleted(extraData: string | null | undefined): boolean {
  if (!extraData) return false;
  try {
    const parsed = JSON.parse(extraData) as Record<string, unknown>;
    return parsed[FROG_SUBJECT_DELETED_KEY] === true;
  } catch {
    return false;
  }
}

/** 从完成事件合成今日栏卡片（主体已删时仍展示「已完成」） */
export function frogCompletionItemToSnapshotTaskRow(
  item: FrogCompletionDayItem,
  logicalToday: string,
): TaskRow {
  const subjectId = (item.task_id ?? '').trim() || item.id;
  const title = (item.task_title ?? '').trim() || '已删除的青蛙';
  const isProject =
    item.subject === 'project' || subjectId.startsWith('p_');
  const now = formatTaskAuditDatetimeLocal();
  const extra = {
    frogAssignedOn: logicalToday,
    frogAssignedDates: [logicalToday],
    frogSessionCompletedOn: logicalToday,
    [FROG_SUBJECT_DELETED_KEY]: true,
    ...(isProject ? { isLongTermProject: false } : {}),
  };
  return {
    id: subjectId,
    project_id: null,
    category_id: null,
    parent_task_id: null,
    title,
    description: null,
    note: isProject ? '今日已完成（项目已删除）' : '今日已完成（任务已删除）',
    status: 'done',
    priority: 0 as TaskPriority,
    due_date: null,
    completed_at: now,
    created_at: now,
    updated_at: now,
    sync_status: 'synced',
    extra_data: JSON.stringify(extra),
    sort_order: 0,
  };
}

/** 同一青蛙主体 + 指派日只保留最新一次操作；仅当最新为 completed 时计入热力图 */
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

/**
 * 记录青蛙完成/重开。
 * `subjectId` 可以是任务 id，也可以是「无子任务项目青蛙」的 project id。
 * 字段名仍为 task_id（历史契约），项目青蛙写入 project id。
 */
export async function insertFrogCompletionEvent(
  subjectId: string,
  assignedYmd: string,
  action: FrogCompletionEventAction,
  title: string | null,
): Promise<void> {
  const ymd = assignedYmd.trim();
  const id = subjectId.trim();
  if (!id || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return;

  const taskReady = await ensureLocalRowPresent('tasks', id);
  const projectReady = taskReady ? false : await ensureLocalRowPresent('projects', id);
  if (!taskReady && !projectReady) {
    throw new Error('任务或项目尚未同步到本地，无法记录青蛙完成事件');
  }

  const db = await getDatabase();
  const eventId = makeTimestampEntityId('fevt_', 8);
  const createdAt = formatTaskAuditDatetimeLocal();
  const params = [eventId, id, ymd, action, createdAt, title?.trim() || null] as const;
  const sql = `INSERT INTO frog_completion_events (id, task_id, assigned_ymd, action, created_at, task_title, sync_status)
     VALUES (?, ?, ?, ?, ?, ?, 'pending_create')`;

  // 本地表 FK 仅指向 tasks；项目青蛙的 subjectId 是 project id，需短暂关闭外键
  if (!taskReady && projectReady) {
    await db.execAsync('PRAGMA foreign_keys = OFF');
    try {
      await db.runAsync(sql, [...params]);
    } finally {
      await db.execAsync('PRAGMA foreign_keys = ON');
    }
  } else {
    await db.runAsync(sql, [...params]);
  }

  invalidateInflightApiTableFetch('frog_completion_events');
  const { pushLocalChangesToApi } = await import('@/lib/api-write-sync');
  await pushLocalChangesToApi({ awaitSync: true });
}

/** 按指派日返回已完成青蛙的 task_id / project_id 集合（与热力图口径一致，仅计 net completed） */
export async function getFrogCompletedTaskIdsByDayRange(
  startYmd: string,
  endYmd: string,
): Promise<Map<string, Set<string>>> {
  const rows = await readApiTable<FrogCompletionEventRow>('frog_completion_events', HEATMAP_EVENT_READ_OPTS);
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
  endYmd: string,
): Promise<Map<string, number>> {
  const rows = await readApiTable<FrogCompletionEventRow>('frog_completion_events', HEATMAP_EVENT_READ_OPTS);
  const m = new Map<string, number>();
  for (const r of filterNetCompletedFrogEvents(rows)) {
    if (!r.assigned_ymd || !isYmdInRange(r.assigned_ymd, startYmd, endYmd)) continue;
    m.set(r.assigned_ymd, (m.get(r.assigned_ymd) ?? 0) + 1);
  }
  return m;
}

/** 某一指派日内的已完成青蛙明细（含任务/项目已删时的标题快照） */
export async function getFrogCompletionsForAssignedDay(ymd: string): Promise<FrogCompletionDayItem[]> {
  const [events, tasks, projects] = await Promise.all([
    readApiTable<{
      id: string;
      task_id: string | null;
      assigned_ymd: string;
      action: string;
      task_title?: string | null;
      created_at: string;
    }>('frog_completion_events', HEATMAP_EVENT_READ_OPTS),
    readApiTable<{ id: string; title?: string | null }>('tasks', HEATMAP_EVENT_READ_OPTS),
    readApiTable<{ id: string; name?: string | null }>('projects', HEATMAP_EVENT_READ_OPTS),
  ]);
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const projectById = new Map(projects.map((p) => [p.id, p]));
  return filterNetCompletedFrogEvents(events)
    .filter((e) => e.assigned_ymd === ymd)
    .sort((a, b) => compareDatetimeDesc(a.created_at, b.created_at) * -1)
    .map((e) => {
      const sid = (e.task_id ?? '').trim();
      const project = projectById.get(sid);
      const task = taskById.get(sid);
      // 前缀优先；否则本地有项目行则认项目
      const subject: FrogCompletionSubject | undefined = sid.startsWith('p_')
        ? 'project'
        : sid.startsWith('tsk_')
          ? 'task'
          : project
            ? 'project'
            : task
              ? 'task'
              : undefined;
      return {
        id: e.id,
        task_id: e.task_id,
        assigned_ymd: e.assigned_ymd,
        task_title:
          (subject === 'project' ? project?.name?.trim() : undefined) ||
          project?.name?.trim() ||
          task?.title?.trim() ||
          e.task_title?.trim() ||
          null,
        subject,
      };
    });
}

/** 将历史「已完成且带 frogAssignedOn」的任务补写入事件表（升级后执行一次） */
export async function backfillFrogCompletionEventsFromTasks(): Promise<number> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ id: string; title: string; extra_data: string | null }>(
    `SELECT id, title, extra_data FROM tasks
     WHERE status IN ('done', 'cancelled')
        AND extra_data IS NOT NULL
        AND trim(extra_data) != ''`,
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
      [row.id, assigned],
    );
    if (Number(existing?.c ?? 0) > 0) continue;
    await insertFrogCompletionEvent(row.id, assigned, 'completed', row.title ?? null);
    inserted += 1;
  }
  return inserted;
}
