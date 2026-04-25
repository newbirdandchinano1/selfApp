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

export async function countIncompleteDescendantTasks(rootTaskId: string): Promise<number> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ cnt: number }>(
    `WITH RECURSIVE subtree(id) AS (
        SELECT id FROM tasks WHERE id = ? AND deleted_at IS NULL
        UNION ALL
        SELECT t.id
          FROM tasks t
          JOIN subtree s ON t.parent_task_id = s.id
         WHERE t.deleted_at IS NULL
     )
     SELECT COUNT(1) AS cnt
       FROM tasks
      WHERE id IN (SELECT id FROM subtree WHERE id != ?)
        AND status NOT IN ('done', 'cancelled')`,
    [rootTaskId, rootTaskId],
  );
  return Number(row?.cnt ?? 0);
}

export async function countIncompleteTasksByProjectId(projectId: string): Promise<number> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ cnt: number }>(
    `SELECT COUNT(1) AS cnt
       FROM tasks
      WHERE deleted_at IS NULL
        AND project_id = ?
        AND status NOT IN ('done', 'cancelled')`,
    [projectId],
  );
  return Number(row?.cnt ?? 0);
}

export async function deleteTasksByProjectId(projectId: string) {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE tasks
     SET deleted_at = datetime('now'), updated_at = datetime('now'), sync_status = 'pending_delete', version = version + 1
     WHERE deleted_at IS NULL AND project_id = ?`,
    [projectId],
  );
}

export async function createTask(input: CreateTaskInput) {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO tasks (
      id, project_id, category_id, parent_task_id, title, description, note, status, priority, due_date, completed_at,
      created_at, updated_at, deleted_at, sync_status, version, extra_data
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, datetime('now'), datetime('now'), NULL, 'pending_create', 1, ?)`,
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
      input.extra_data ?? null,
    ]
  );
}

export async function getTaskById(id: string) {
  const db = await getDatabase();
  return db.getFirstAsync<TaskRow>('SELECT * FROM tasks WHERE id = ? AND deleted_at IS NULL LIMIT 1', [id]);
}

export async function getTasks() {
  const db = await getDatabase();
  return db.getAllAsync<TaskRow>('SELECT * FROM tasks WHERE deleted_at IS NULL ORDER BY updated_at DESC, created_at DESC');
}

export async function getTasksByProjectId(projectId: string) {
  const db = await getDatabase();
  const rows = await db.getAllAsync<TaskRow>(
    'SELECT * FROM tasks WHERE deleted_at IS NULL AND project_id = ? ORDER BY priority DESC, due_date ASC, updated_at DESC',
    [projectId]
  );
  return buildTaskTree(rows);
}

export async function getChildTasksByParentTaskId(parentTaskId: string): Promise<TaskTreeNode[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<TaskRow>(
    'SELECT * FROM tasks WHERE deleted_at IS NULL AND parent_task_id = ? ORDER BY priority DESC, due_date ASC, updated_at DESC',
    [parentTaskId]
  );
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
         completed_at = ?, extra_data = ?, updated_at = datetime('now'),
         sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_update' ELSE sync_status END,
         version = version + 1
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
      input.due_date ?? current.due_date,
      input.completed_at ?? current.completed_at,
      input.extra_data ?? current.extra_data,
      id,
    ]
  );
}

export async function deleteTask(id: string) {
  const db = await getDatabase();
  await db.runAsync(
    `WITH RECURSIVE subtree(id) AS (
        SELECT id FROM tasks WHERE id = ? AND deleted_at IS NULL
        UNION ALL
        SELECT t.id
          FROM tasks t
          JOIN subtree s ON t.parent_task_id = s.id
         WHERE t.deleted_at IS NULL
     )
     UPDATE tasks
        SET deleted_at = datetime('now'),
            updated_at = datetime('now'),
            sync_status = 'pending_delete',
            version = version + 1
      WHERE id IN (SELECT id FROM subtree)`,
    [id],
  );
}

export async function createTaskCategory(input: CreateTaskCategoryInput) {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO task_categories (
      id, name, sort_order, created_at, updated_at, deleted_at, sync_status, version, extra_data
    ) VALUES (
      ?, ?,
      (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM task_categories WHERE deleted_at IS NULL),
      datetime('now'), datetime('now'), NULL, 'pending_create', 1, ?
    )`,
    [input.id, input.name, input.extra_data ?? null]
  );
}

export async function getTaskCategories() {
  const db = await getDatabase();
  return db.getAllAsync<TaskCategoryRow>(
    'SELECT * FROM task_categories WHERE deleted_at IS NULL ORDER BY COALESCE(sort_order, 1000000) ASC, datetime(created_at) ASC'
  );
}

export async function reorderTaskCategories(orderedIds: string[]) {
  const db = await getDatabase();
  const ids = orderedIds.filter(Boolean);
  for (let i = 0; i < ids.length; i += 1) {
    const id = ids[i];
    await db.runAsync(
      `UPDATE task_categories
       SET sort_order = ?, updated_at = datetime('now'),
           sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_update' ELSE sync_status END,
           version = version + 1
       WHERE id = ? AND deleted_at IS NULL`,
      [i + 1, id]
    );
  }
}

export async function updateTaskCategory(id: string, input: UpdateTaskCategoryInput) {
  const db = await getDatabase();
  const current = await db.getFirstAsync<TaskCategoryRow>('SELECT * FROM task_categories WHERE id = ? AND deleted_at IS NULL LIMIT 1', [id]);
  if (!current) return;
  await db.runAsync(
    `UPDATE task_categories
     SET name = ?, extra_data = ?, updated_at = datetime('now'),
         sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_update' ELSE sync_status END,
         version = version + 1
     WHERE id = ?`,
    [input.name ?? current.name, input.extra_data ?? current.extra_data, id]
  );
}

export async function deleteTaskCategory(id: string) {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE task_categories
     SET deleted_at = datetime('now'), updated_at = datetime('now'), sync_status = 'pending_delete', version = version + 1
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
