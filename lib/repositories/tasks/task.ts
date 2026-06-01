import { readApiRecord, readApiTable } from '@/lib/api-read';
import {
  compareDatetimeDesc,
  matchesOverviewScope,
  sortBySortOrderAsc,
  sortByUpdatedDesc,
  ymdFromDatetime,
} from '@/lib/api-read-helpers';
import { getDatabase } from '../../database.native';
import type {
  CreateTaskCategoryInput,
  CreateTaskInput,
  TaskCategoryRow,
  TaskRow,
  UpdateTaskCategoryInput,
  UpdateTaskInput,
} from './task.types';

export type TaskTreeNode = TaskRow & { children: TaskTreeNode[] };

async function loadAllTasks(): Promise<TaskRow[]> {
  return readApiTable<TaskRow>('tasks', { offlineFallback: true });
}

function sortTasksForProjectList(rows: TaskRow[]): TaskRow[] {
  return [...rows].sort((a, b) => {
    const sa = a.sort_order ?? 0;
    const sb = b.sort_order ?? 0;
    if (sa !== sb) return sa - sb;
    const pa = a.priority ?? 0;
    const pb = b.priority ?? 0;
    if (pa !== pb) return pb - pa;
    const da = a.due_date ? Date.parse(a.due_date) : Number.POSITIVE_INFINITY;
    const db = b.due_date ? Date.parse(b.due_date) : Number.POSITIVE_INFINITY;
    if (da !== db) return da - db;
    return compareDatetimeDesc(a.updated_at, b.updated_at);
  });
}

function collectSubtreeIds(all: TaskRow[], rootId: string): Set<string> {
  const ids = new Set<string>([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of all) {
      const parent = row.parent_task_id;
      if (parent && ids.has(String(parent)) && !ids.has(String(row.id))) {
        ids.add(String(row.id));
        changed = true;
      }
    }
  }
  return ids;
}

async function getNextTaskSortOrderForSiblings(
  db: Awaited<ReturnType<typeof getDatabase>>,
  projectId: string | null,
  parentTaskId: string | null
): Promise<number> {
  const row = await db.getFirstAsync<{ m: number | null }>(
    `SELECT COALESCE(MAX(sort_order), 0) + 1 AS m
       FROM tasks
       WHERE IFNULL(project_id, '') = IFNULL(?, '')
        AND IFNULL(parent_task_id, '') = IFNULL(?, '')`,
    [projectId ?? '', parentTaskId ?? '']
  );
  return Number(row?.m ?? 1);
}

/** 同一项目、同一父任务下的同级任务按给定 id 顺序写入 sort_order（从 1 递增） */
export async function reorderProjectTaskSiblings(
  projectId: string,
  parentTaskId: string | null,
  orderedTaskIds: string[]
): Promise<void> {
  const db = await getDatabase();
  const pKey = parentTaskId ?? '';
  for (let i = 0; i < orderedTaskIds.length; i += 1) {
    const id = orderedTaskIds[i];
    const found = await db.getFirstAsync<{ id: string }>(
      `SELECT id FROM tasks
        WHERE id = ?
         
          AND project_id = ?
          AND IFNULL(parent_task_id, '') = ?`,
      [id, projectId, pKey]
    );
    if (!found) {
      throw new Error(`任务 ${id} 不属于该项目下的该层级，无法调整顺序`);
    }
    await db.runAsync(
      `UPDATE tasks
          SET sort_order = ?,
              updated_at = datetime('now'),
              sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_update' ELSE sync_status END
        WHERE id = ?`,
      [i + 1, id]
    );
  }
}

export async function countIncompleteDescendantTasks(rootTaskId: string): Promise<number> {
  const all = await loadAllTasks();
  const subtree = collectSubtreeIds(all, rootTaskId);
  subtree.delete(rootTaskId);
  return all.filter(
    t => subtree.has(String(t.id)) && t.status !== 'done' && t.status !== 'cancelled',
  ).length;
}

export async function countIncompleteTasksByProjectId(projectId: string): Promise<number> {
  const all = await loadAllTasks();
  return all.filter(
    t => t.project_id === projectId && t.status !== 'done' && t.status !== 'cancelled',
  ).length;
}

/** 统计项目下任务完成度（不含已取消）；用于愿景「目标」关联项目进度 */
export async function getTaskCompletionStatsByProjectId(
  projectId: string
): Promise<{ total: number; completed: number }> {
  const all = await loadAllTasks().then(rows => rows.filter(t => t.project_id === projectId));
  let total = 0;
  let completed = 0;
  for (const t of all) {
    if (t.status === 'cancelled') continue;
    total += 1;
    if (t.status === 'done') completed += 1;
  }
  return { total, completed };
}

/** 多个项目任务完成度汇总（愿景「目标」多项目关联） */
export async function getTaskCompletionStatsByProjectIds(
  projectIds: string[]
): Promise<{ total: number; completed: number }> {
  const unique = [...new Set(projectIds.map(id => id.trim()).filter(Boolean))];
  if (unique.length === 0) return { total: 0, completed: 0 };
  const stats = await Promise.all(unique.map(id => getTaskCompletionStatsByProjectId(id)));
  return stats.reduce(
    (acc, s) => ({ total: acc.total + s.total, completed: acc.completed + s.completed }),
    { total: 0, completed: 0 },
  );
}

export async function deleteTasksByProjectId(projectId: string) {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE tasks
     SET updated_at = datetime('now'), sync_status = 'pending_delete'
     WHERE project_id = ?`,
    [projectId],
  );
}

export async function createTask(input: CreateTaskInput) {
  const db = await getDatabase();
  const sortOrder = await getNextTaskSortOrderForSiblings(db, input.project_id ?? null, input.parent_task_id ?? null);
  await db.runAsync(
    `INSERT INTO tasks (
      id, project_id, category_id, parent_task_id, title, description, note, status, priority, due_date, completed_at,
      sort_order, created_at, updated_at, sync_status, extra_data
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, datetime('now'), datetime('now'), 'pending_create', ?)`,
    [
      input.id,
      input.project_id ?? null,
      input.category_id ?? null,
      input.parent_task_id ?? null,
      input.title,
      input.description ?? null,
      input.note ?? null,
      input.status ?? 'todo',
      input.priority ?? 0,
      input.due_date ?? null,
      sortOrder,
      input.extra_data ?? null,
    ]
  );
}

export async function getTaskById(id: string) {
  return readApiRecord<TaskRow>('tasks', id, { offlineFallback: true });
}

export async function getTasks() {
  const rows = await loadAllTasks();
  return sortByUpdatedDesc(rows);
}

export type TaskOverviewListFilter = 'open' | 'doneOrCancelled' | 'totalActive';

/** 待办总览概况卡片：按统计维度列出当前任务（与 getTaskGlobalInsightCounts 口径一致） */
export async function getTasksForOverviewList(filter: TaskOverviewListFilter): Promise<TaskRow[]> {
  const scoped = (await loadAllTasks()).filter(matchesOverviewScope);
  let filtered = scoped;
  if (filter === 'open') {
    filtered = scoped.filter(t => t.status !== 'done' && t.status !== 'cancelled');
  } else if (filter === 'doneOrCancelled') {
    filtered = scoped.filter(t => t.status === 'done' || t.status === 'cancelled');
  }
  return sortByUpdatedDesc(filtered);
}

/** 截止日为指定本地日（YYYY-MM-DD）的任务，含子任务，按优先级与截止时间排序。 */
export async function getTasksDueOnDate(ymd: string) {
  const rows = await loadAllTasks();
  return rows
    .filter(t => {
      const day = ymdFromDatetime(t.due_date);
      return day === ymd;
    })
    .sort((a, b) => {
      const pa = a.priority ?? 0;
      const pb = b.priority ?? 0;
      if (pa !== pb) return pb - pa;
      const da = a.due_date ? Date.parse(a.due_date) : 0;
      const db = b.due_date ? Date.parse(b.due_date) : 0;
      if (da !== db) return da - db;
      return compareDatetimeDesc(a.updated_at, b.updated_at);
    });
}

export type TaskDueDayAggregateRow = {
  day: string;
  total: number;
  done: number;
};

/** 区间内每日截止任务数与已完成数（done/cancelled 视为 done），用于日历热力统计。 */
export async function getTaskDueDayAggregatesForRange(startYmd: string, endYmd: string): Promise<TaskDueDayAggregateRow[]> {
  const rows = await loadAllTasks();
  const byDay = new Map<string, { total: number; done: number }>();
  for (const t of rows) {
    const day = ymdFromDatetime(t.due_date);
    if (!day || day < startYmd || day > endYmd) continue;
    const agg = byDay.get(day) ?? { total: 0, done: 0 };
    agg.total += 1;
    if (t.status === 'done' || t.status === 'cancelled') agg.done += 1;
    byDay.set(day, agg);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, v]) => ({ day, total: v.total, done: v.done }));
}

export async function getTasksByProjectId(projectId: string) {
  const rows = sortTasksForProjectList(
    (await loadAllTasks()).filter(t => t.project_id === projectId),
  );
  return buildTaskTree(rows);
}

export async function getChildTasksByParentTaskId(parentTaskId: string): Promise<TaskTreeNode[]> {
  const all = await loadAllTasks();
  const rows = sortTasksForProjectList(all.filter(t => t.parent_task_id === parentTaskId));
  const children = await Promise.all(
    rows.map(async row => ({ ...row, children: await getChildTasksByParentTaskId(row.id) }))
  );
  return children;
}

export async function getTaskTreeByRootTaskId(rootTaskId: string): Promise<TaskTreeNode | null> {
  const root = await getTaskById(rootTaskId);
  if (!root) return null;
  return { ...root, children: await getChildTasksByParentTaskId(root.id) };
}

export async function updateTask(id: string, input: UpdateTaskInput) {
  const db = await getDatabase();
  const current = await getTaskById(id);
  if (!current) return;
  await db.runAsync(
    `UPDATE tasks
     SET project_id = ?, category_id = ?, parent_task_id = ?, title = ?, description = ?, note = ?, status = ?, priority = ?, due_date = ?,
         completed_at = ?, extra_data = ?, sort_order = ?, updated_at = datetime('now'),
         sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_update' ELSE sync_status END
     WHERE id = ?`,
    [
      input.project_id ?? current.project_id,
      input.category_id ?? current.category_id,
      input.parent_task_id ?? current.parent_task_id,
      input.title ?? current.title,
      input.description ?? current.description,
      input.note ?? current.note,
      input.status ?? current.status,
      input.priority ?? current.priority,
      input.due_date !== undefined ? input.due_date : current.due_date,
      input.completed_at !== undefined ? input.completed_at : current.completed_at,
      input.extra_data !== undefined ? input.extra_data : current.extra_data,
      input.sort_order ?? current.sort_order ?? 1000,
      id,
    ]
  );
}

/** 将根任务及其所有子任务挂到同一项目（用于待办升级为项目等场景） */
export async function assignProjectIdToTaskSubtree(rootTaskId: string, projectId: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `WITH RECURSIVE subtree(id) AS (
        SELECT id FROM tasks WHERE id = ?
        UNION ALL
        SELECT t.id
          FROM tasks t
          JOIN subtree s ON t.parent_task_id = s.id
     )
     UPDATE tasks
        SET project_id = ?,
            updated_at = datetime('now'),
            sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_update' ELSE sync_status END
      WHERE id IN (SELECT id FROM subtree)`,
    [rootTaskId, projectId],
  );
}

export async function deleteTask(id: string) {
  const db = await getDatabase();
  await db.runAsync(
    `WITH RECURSIVE subtree(id) AS (
        SELECT id FROM tasks WHERE id = ?
        UNION ALL
        SELECT t.id
          FROM tasks t
          JOIN subtree s ON t.parent_task_id = s.id
     )
     UPDATE tasks
        SET updated_at = datetime('now'),
            sync_status = 'pending_delete'
      WHERE id IN (SELECT id FROM subtree)`,
    [id],
  );
}

export async function createTaskCategory(input: CreateTaskCategoryInput) {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO task_categories (
      id, name, sort_order, created_at, updated_at, sync_status, extra_data
    ) VALUES (
      ?, ?,
      (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM task_categories),
      datetime('now'), datetime('now'), 'pending_create', ?
    )`,
    [input.id, input.name, input.extra_data ?? null]
  );
}

export async function getTaskCategories() {
  const rows = await readApiTable<TaskCategoryRow>('task_categories', { offlineFallback: true });
  return sortBySortOrderAsc(rows);
}

export async function reorderTaskCategories(orderedIds: string[]) {
  const db = await getDatabase();
  const ids = orderedIds.filter(Boolean);
  for (let i = 0; i < ids.length; i += 1) {
    const id = ids[i];
    await db.runAsync(
      `UPDATE task_categories
       SET sort_order = ?, updated_at = datetime('now'),
           sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_update' ELSE sync_status END
       WHERE id = ?`,
      [i + 1, id]
    );
  }
}

export async function updateTaskCategory(id: string, input: UpdateTaskCategoryInput) {
  const db = await getDatabase();
  const current = await db.getFirstAsync<TaskCategoryRow>('SELECT * FROM task_categories WHERE id = ? LIMIT 1', [id]);
  if (!current) return;
  await db.runAsync(
    `UPDATE task_categories
     SET name = ?, extra_data = ?, updated_at = datetime('now'),
         sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_update' ELSE sync_status END
     WHERE id = ?`,
    [input.name ?? current.name, input.extra_data ?? current.extra_data, id]
  );
}

export async function deleteTaskCategory(id: string) {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE task_categories
     SET updated_at = datetime('now'), sync_status = 'pending_delete'
     WHERE id = ?`,
    [id]
  );
}

function buildTaskTree(rows: TaskRow[]) {
  const map = new Map<string, TaskTreeNode>();
  const roots: TaskTreeNode[] = [];

  rows.forEach(row => map.set(row.id, { ...row, children: [] }));

  rows.forEach(row => {
    const node = map.get(row.id)!;
    if (row.parent_task_id && map.has(row.parent_task_id)) {
      map.get(row.parent_task_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  });

  return roots;
}
