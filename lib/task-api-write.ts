import { isLocalFirstReads } from '@/lib/api-data-mode';
import { mergePreservedForeignKeysIntoPatch } from '@/lib/api-fk-preserve';
import { invalidateInflightApiTableFetch } from '@/lib/api-read';
import { readLocalRowForWrite } from '@/lib/api-local-row';
import { updateTask } from '@/lib/repositories/tasks/task';
import type { UpdateTaskInput } from '@/lib/repositories/tasks/task.types';
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

/** local-first：先写本地 SQLite（即时 UI），再由脏表队列推送后端 */
export async function persistTaskPatchToApi(
  taskId: string,
  patch: TaskApiPatch,
  taskRowSnapshot?: Record<string, unknown> | null,
): Promise<void> {
  const { local, parentRow } = await resolveTaskForeignKeysForApiPatch(taskId, taskRowSnapshot);
  const merged = mergePreservedForeignKeysIntoPatch('tasks', patch, [
    taskRowSnapshot,
    local,
    parentRow,
  ]) as TaskApiPatch;

  await ensureTaskCategoryMirrorFromSnapshot(merged);
  await ensureProjectRefsFromTaskSnapshot(merged, parentRow);

  if (isLocalFirstReads()) {
    await updateTask(taskId, merged as UpdateTaskInput);
    invalidateInflightApiTableFetch('tasks');
    return;
  }

  const { apiPatchRecord, ensureApiLoggedIn } = await import('@/lib/api-client');
  const { fetchApiRecordByPk } = await import('@/lib/api-read');
  const { syncApiReadResultToLocal } = await import('@/lib/api-read-local-sync');

  await ensureApiLoggedIn();
  await apiPatchRecord('tasks', taskId, merged);
  invalidateInflightApiTableFetch('tasks');

  try {
    await fetchApiRecordByPk('tasks', taskId);
  } catch (e) {
    if (__DEV__) console.warn('[task-api-write] 拉取服务端任务同步本地失败，尝试快照', e);
    if (taskRowSnapshot) {
      const { children: _children, ...snapshotRow } = taskRowSnapshot;
      const row = { ...snapshotRow, id: taskId, ...merged };
      await syncApiReadResultToLocal('tasks', row);
    }
  }
}
