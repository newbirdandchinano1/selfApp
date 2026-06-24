import { persistTaskPatchToApi } from '@/lib/task-api-write';
import { ensureLocalRowForWrite, ensureLocalRowPresent, readLocalRowForWrite, requireLocalRowForWrite } from '@/lib/api-local-row';
import { invalidateInflightApiTableFetch, readApiRecord, readApiTable } from '@/lib/api-read';
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
import { ensureTaskCategoryMirrorLocally } from './task-category-mirror';
import { isTaskShelvedStatus, isTaskTerminalStatus } from './task.types';

export type TaskTreeNode = TaskRow & { children: TaskTreeNode[] };

async function loadAllTasks(opts?: { forceRefresh?: boolean }): Promise<TaskRow[]> {
  return readApiTable<TaskRow>('tasks', { offlineFallback: true, forceRefresh: opts?.forceRefresh });
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
    await requireLocalRowForWrite('tasks', id);
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

export type ParentTaskCascadeChange = Pick<TaskRow, 'id' | 'status' | 'completed_at' | 'title' | 'extra_data'>;

function areAllDirectChildrenTerminal(rows: TaskRow[], parentId: string): boolean {
  const children = rows.filter(t => t.parent_task_id === parentId);
  if (children.length === 0) return false;
  return children.every(t => isTaskTerminalStatus(t.status));
}

/**
 * 子任务勾选完成/恢复后，沿父链自动完成或恢复父任务（仅看直接子任务）。
 */
export async function cascadeParentTaskStatusAfterChildChange(
  childTaskId: string,
  childMarkedDone: boolean,
): Promise<ParentTaskCascadeChange[]> {
  const all = await loadAllTasks();
  const byId = new Map(all.map(t => [t.id, t]));
  const child = byId.get(childTaskId);
  if (!child?.parent_task_id) return [];

  const changes: ParentTaskCascadeChange[] = [];
  let parentId: string | null = child.parent_task_id;

  while (parentId) {
    const parent = byId.get(parentId);
    if (!parent) break;

    if (childMarkedDone) {
      if (isTaskShelvedStatus(parent.status)) break;
      if (isTaskTerminalStatus(parent.status)) {
        parentId = parent.parent_task_id;
        continue;
      }
      if (!areAllDirectChildrenTerminal(all, parentId)) break;

      const completedAt = new Date().toISOString();
      await persistTaskPatchToApi(
        parentId,
        { status: 'done', completed_at: completedAt },
        parent as Record<string, unknown>,
      );
      const nextParent = { ...parent, status: 'done' as const, completed_at: completedAt };
      byId.set(parentId, nextParent);
      const idx = all.findIndex(t => t.id === parentId);
      if (idx >= 0) all[idx] = nextParent;
      changes.push({
        id: parentId,
        status: 'done',
        completed_at: completedAt,
        title: parent.title,
        extra_data: parent.extra_data,
      });
      parentId = parent.parent_task_id;
      continue;
    }

    if (!isTaskTerminalStatus(parent.status)) break;

    await persistTaskPatchToApi(
      parentId,
      { status: 'todo', completed_at: null },
      parent as Record<string, unknown>,
    );
    const nextParent = { ...parent, status: 'todo' as const, completed_at: null };
    byId.set(parentId, nextParent);
    const idx = all.findIndex(t => t.id === parentId);
    if (idx >= 0) all[idx] = nextParent;
    changes.push({
      id: parentId,
      status: 'todo',
      completed_at: null,
      title: parent.title,
      extra_data: parent.extra_data,
    });
    parentId = parent.parent_task_id;
  }

  return changes;
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

async function resolveTaskForeignKeys(
  fields: {
    project_id?: string | null;
    category_id?: string | null;
    parent_task_id?: string | null;
  },
  opts?: { preserveCategoryId?: string | null },
): Promise<{
  project_id: string | null;
  category_id: string | null;
  parent_task_id: string | null;
}> {
  let projectId = fields.project_id ?? null;
  let categoryId = fields.category_id ?? null;
  const parentTaskId = fields.parent_task_id ?? null;

  if (parentTaskId) {
    const parentReady = await ensureLocalRowPresent('tasks', parentTaskId);
    if (!parentReady) {
      throw new Error('父任务尚未同步到本地，请返回任务列表刷新后重试');
    }
  }

  if (projectId) {
    const projectReady = await ensureLocalRowPresent('projects', projectId);
    if (!projectReady) {
      throw new Error('所属项目尚未同步到本地，请返回任务列表刷新后重试');
    }
  }

  if (categoryId) {
    let categoryReady = await ensureLocalRowPresent('task_categories', categoryId);
    if (!categoryReady) {
      categoryReady = await ensureTaskCategoryMirrorLocally(categoryId);
    }
    if (!categoryReady) {
      // 与 updateProject 一致：分类尚未同步到本地时不应静默清空
      categoryId = opts?.preserveCategoryId ?? categoryId;
    }
  }

  return {
    project_id: projectId,
    category_id: categoryId,
    parent_task_id: parentTaskId,
  };
}

async function resolveCreateTaskForeignKeys(input: CreateTaskInput): Promise<CreateTaskInput> {
  const foreignKeys = await resolveTaskForeignKeys(input);
  return { ...input, ...foreignKeys };
}

export async function createTask(input: CreateTaskInput) {
  const db = await getDatabase();
  const resolved = await resolveCreateTaskForeignKeys(input);

  const existing = await readLocalRowForWrite<TaskRow>('tasks', resolved.id);
  if (existing) return;

  const sortOrder = await getNextTaskSortOrderForSiblings(
    db,
    resolved.project_id ?? null,
    resolved.parent_task_id ?? null,
  );
  await db.runAsync(
    `INSERT INTO tasks (
      id, project_id, category_id, parent_task_id, title, description, note, status, priority, due_date, completed_at,
      sort_order, created_at, updated_at, sync_status, extra_data
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, datetime('now'), datetime('now'), 'pending_create', ?)`,
    [
      resolved.id,
      resolved.project_id ?? null,
      resolved.category_id ?? null,
      resolved.parent_task_id ?? null,
      resolved.title,
      resolved.description ?? null,
      resolved.note ?? null,
      resolved.status ?? 'todo',
      resolved.priority ?? 0,
      resolved.due_date ?? null,
      sortOrder,
      resolved.extra_data ?? null,
    ]
  );
  const { pushLocalChangesToApi } = await import('@/lib/api-write-sync');
  await pushLocalChangesToApi({ awaitSync: true });
}

export async function getTaskById(id: string) {
  return readApiRecord<TaskRow>('tasks', id, { offlineFallback: true });
}

export async function getTasks(opts?: { forceRefresh?: boolean }) {
  const rows = await loadAllTasks(opts);
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

function buildProjectTaskTree(rows: TaskRow[]): TaskTreeNode[] {
  return buildTaskTree(sortTasksForProjectList(rows));
}

function normalizeTaskProjectId(projectId: string | null | undefined): string {
  return typeof projectId === 'string' ? projectId.trim() : '';
}

/** 含 project_id 直接归属 + 父链挂接的子任务（接口子行可能缺 project_id） */
function collectTasksForProject(all: TaskRow[], projectId: string): TaskRow[] {
  const pid = projectId.trim();
  if (!pid) return [];

  const included = new Set<string>();
  for (const t of all) {
    if (normalizeTaskProjectId(t.project_id) === pid) {
      included.add(String(t.id));
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const t of all) {
      const id = String(t.id);
      if (included.has(id)) continue;
      const parentId = t.parent_task_id ? String(t.parent_task_id).trim() : '';
      if (parentId && included.has(parentId)) {
        included.add(id);
        changed = true;
      }
    }
  }

  return all.filter(t => included.has(String(t.id)));
}

export async function getTasksByProjectId(projectId: string, opts?: { forceRefresh?: boolean }) {
  const all = await loadAllTasks(opts);
  return buildProjectTaskTree(collectTasksForProject(all, projectId));
}

/** 一次拉取全表任务，再按项目 id 批量构建任务树（避免 N 次并发全量读导致 reconcile 竞态） */
export async function getProjectTaskTreeMap(
  projectIds: string[],
  opts?: { forceRefresh?: boolean },
): Promise<Record<string, TaskTreeNode[]>> {
  const uniqueIds = [...new Set(projectIds.map(id => id.trim()).filter(Boolean))];
  if (uniqueIds.length === 0) return {};

  const all = await loadAllTasks(opts);
  const map: Record<string, TaskTreeNode[]> = {};
  for (const id of uniqueIds) {
    map[id] = buildProjectTaskTree(collectTasksForProject(all, id));
  }
  return map;
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
  if (!db) {
    throw new Error('本地数据库不可用，无法保存任务');
  }
  const current = await requireLocalRowForWrite<TaskRow>('tasks', id);
  const foreignKeys = await resolveTaskForeignKeys(
    {
      project_id: input.project_id ?? current.project_id,
      category_id: input.category_id ?? current.category_id,
      parent_task_id: input.parent_task_id ?? current.parent_task_id,
    },
    { preserveCategoryId: current.category_id },
  );
  const result = await db.runAsync(
    `UPDATE tasks
     SET project_id = ?, category_id = ?, parent_task_id = ?, title = ?, description = ?, note = ?, status = ?, priority = ?, due_date = ?,
         completed_at = ?, extra_data = ?, sort_order = ?, updated_at = datetime('now'),
         sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_update' ELSE sync_status END
     WHERE id = ?`,
    [
      foreignKeys.project_id,
      foreignKeys.category_id,
      foreignKeys.parent_task_id,
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
  if ((result.changes ?? 0) === 0) {
    throw new Error('任务保存失败，请返回列表刷新后重试');
  }
  const { pushLocalChangesToApi } = await import('@/lib/api-write-sync');
  await pushLocalChangesToApi({ awaitSync: true });
}

/** 将根任务及其所有子任务挂到同一项目（用于待办升级为项目等场景） */
export async function assignProjectIdToTaskSubtree(rootTaskId: string, projectId: string): Promise<void> {
  await requireLocalRowForWrite('tasks', rootTaskId);
  const projectReady = await ensureLocalRowPresent('projects', projectId);
  if (!projectReady) {
    throw new Error('所属项目尚未同步到本地，请返回任务列表刷新后重试');
  }
  const db = await getDatabase();
  const result = await db.runAsync(
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
  if ((result.changes ?? 0) === 0) {
    throw new Error('任务尚未同步到本地，请返回列表刷新后重试');
  }
}

export async function deleteTask(id: string) {
  await requireLocalRowForWrite('tasks', id);

  const all = await loadAllTasks();
  const subtreeIds = collectSubtreeIds(all, id);
  for (const tid of subtreeIds) {
    if (tid === id) continue;
    await ensureLocalRowForWrite('tasks', tid);
  }

  const db = await getDatabase();
  const result = await db.runAsync(
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
  if ((result.changes ?? 0) === 0) {
    throw new Error('任务尚未同步到本地，请返回列表刷新后重试');
  }
  invalidateInflightApiTableFetch('tasks');
  const { pushLocalChangesToApi } = await import('@/lib/api-write-sync');
  await pushLocalChangesToApi({ awaitSync: true });
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
    await requireLocalRowForWrite('task_categories', id);
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
  const current = await requireLocalRowForWrite<TaskCategoryRow>('task_categories', id);
  const result = await db.runAsync(
    `UPDATE task_categories
     SET name = ?, extra_data = ?, updated_at = datetime('now'),
         sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_update' ELSE sync_status END
     WHERE id = ?`,
    [input.name ?? current.name, input.extra_data ?? current.extra_data, id]
  );
  if ((result.changes ?? 0) === 0) {
    throw new Error('分类保存失败，请返回列表刷新后重试');
  }
}

export async function deleteTaskCategory(id: string) {
  await requireLocalRowForWrite('task_categories', id);
  const db = await getDatabase();
  const result = await db.runAsync(
    `UPDATE task_categories
     SET updated_at = datetime('now'), sync_status = 'pending_delete'
     WHERE id = ?`,
    [id]
  );
  if ((result.changes ?? 0) === 0) {
    throw new Error('分类删除失败，请返回列表刷新后重试');
  }
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
