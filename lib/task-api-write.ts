import { apiPatchRecord, ensureApiLoggedIn } from '@/lib/api-client';
import { mergePreservedForeignKeysIntoPatch } from '@/lib/api-fk-preserve';
import { fetchApiRecordByPk, invalidateInflightApiTableFetch } from '@/lib/api-read';
import { syncApiReadResultToLocal } from '@/lib/api-read-local-sync';
import { readLocalRowForWrite } from '@/lib/api-local-row';
import { ensureTaskCategoryMirrorLocally } from '@/lib/repositories/tasks/task-category-mirror';

export type TaskApiPatch = {
  extra_data?: string | null;
  status?: string;
  completed_at?: string | null;
  project_id?: string | null;
  category_id?: string | null;
  parent_task_id?: string | null;
};

function nonEmptyId(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** 子任务可能仅挂 parent_task_id；PATCH 前补齐 project_id 以免服务端清空归属 */
async function resolveTaskForeignKeysForApiPatch(
  taskId: string,
  taskRowSnapshot?: Record<string, unknown> | null,
): Promise<Record<string, unknown>> {
  const local = await readLocalRowForWrite<Record<string, unknown>>('tasks', taskId);
  const parentTaskId = [taskRowSnapshot, local]
    .map(row => nonEmptyId(row?.parent_task_id))
    .find(Boolean);
  let parentRow: Record<string, unknown> | null = null;
  if (parentTaskId) {
    parentRow = await readLocalRowForWrite<Record<string, unknown>>('tasks', parentTaskId);
  }
  return { local, parentRow };
}

async function ensureTaskCategoryMirrorFromSnapshot(
  taskRowSnapshot?: Record<string, unknown> | null,
): Promise<void> {
  const categoryId =
    typeof taskRowSnapshot?.category_id === 'string' ? taskRowSnapshot.category_id.trim() : '';
  if (!categoryId) return;
  try {
    await ensureTaskCategoryMirrorLocally(categoryId);
  } catch (e) {
    if (__DEV__) console.warn('[task-api-write] 补齐任务分类镜像失败', e);
  }
}

/** PATCH 前补齐所属项目及其分类，避免同步链路误清空 project.category_id */
async function ensureProjectRefsFromTaskSnapshot(
  taskRowSnapshot?: Record<string, unknown> | null,
  parentRow?: Record<string, unknown> | null,
): Promise<void> {
  const projectId =
    nonEmptyId(taskRowSnapshot?.project_id) || nonEmptyId(parentRow?.project_id);
  if (!projectId) return;
  try {
    const { ensureLocalRowPresent, readLocalRowForWrite } = await import('@/lib/api-local-row');
    await ensureLocalRowPresent('projects', projectId);
    const project = await readLocalRowForWrite<Record<string, unknown>>('projects', projectId);
    const categoryId =
      typeof project?.category_id === 'string' ? project.category_id.trim() : '';
    if (!categoryId) return;
    await ensureLocalRowPresent('project_categories', categoryId);
    await ensureTaskCategoryMirrorLocally(categoryId);
  } catch (e) {
    if (__DEV__) console.warn('[task-api-write] 补齐项目分类引用失败', e);
  }
}

/**
 * API 写入成功后对齐本地 SQLite（不抛错、不阻断 UI）。
 * 优先拉服务端最新行；失败则用页面快照 seed；再失败则仅更新已有行的 PATCH 字段。
 */
async function bestEffortSyncTaskPatchToLocal(
  taskId: string,
  patch: TaskApiPatch,
  taskRowSnapshot?: Record<string, unknown> | null,
): Promise<void> {
  try {
    await fetchApiRecordByPk('tasks', taskId);
    return;
  } catch (e) {
    if (__DEV__) console.warn('[task-api-write] 拉取服务端任务同步本地失败，尝试快照', e);
  }

  if (taskRowSnapshot) {
    try {
      const { children: _children, ...snapshotRow } = taskRowSnapshot;
      const merged = { ...snapshotRow, id: taskId, ...patch };
      const existing = await readLocalRowForWrite<Record<string, unknown>>('tasks', taskId);
      if (existing) {
        await syncApiReadResultToLocal('tasks', merged);
        return;
      }
      const { seedApiRowToLocalForWrite } = await import('@/lib/api-local-row-seed');
      const seeded = await seedApiRowToLocalForWrite('tasks', merged);
      if (!seeded) {
        await syncApiReadResultToLocal('tasks', merged);
      }
      return;
    } catch (e) {
      if (__DEV__) console.warn('[task-api-write] 快照写入本地失败', e);
    }
  }

  try {
    const { getDatabase } = await import('@/lib/database');
    const db = await getDatabase();
    if (!db) return;
    const sets: string[] = ["updated_at = datetime('now')", "sync_status = 'synced'"];
    const vals: unknown[] = [];
    if ('extra_data' in patch) {
      sets.push('extra_data = ?');
      vals.push(patch.extra_data ?? null);
    }
    if ('status' in patch) {
      sets.push('status = ?');
      vals.push(patch.status);
    }
    if ('completed_at' in patch) {
      sets.push('completed_at = ?');
      vals.push(patch.completed_at ?? null);
    }
    if (sets.length <= 2) return;
    vals.push(taskId);
    await db.runAsync(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`, vals);
  } catch (e) {
    if (__DEV__) console.warn('[task-api-write] 本地任务对齐失败', e);
  }
}

/** 直接 PATCH 后端更新任务字段；成功后 best-effort 同步本地库 */
export async function persistTaskPatchToApi(
  taskId: string,
  patch: TaskApiPatch,
  taskRowSnapshot?: Record<string, unknown> | null,
): Promise<void> {
  const { local, parentRow } = await resolveTaskForeignKeysForApiPatch(taskId, taskRowSnapshot);
  const apiPatch = mergePreservedForeignKeysIntoPatch('tasks', patch, [
    taskRowSnapshot,
    local,
    parentRow,
  ]) as TaskApiPatch;

  await ensureTaskCategoryMirrorFromSnapshot(apiPatch);
  await ensureProjectRefsFromTaskSnapshot(apiPatch, parentRow);
  await ensureApiLoggedIn();
  await apiPatchRecord('tasks', taskId, apiPatch);
  invalidateInflightApiTableFetch('tasks');
  await bestEffortSyncTaskPatchToLocal(taskId, patch, taskRowSnapshot);
}
