import { makeTimestampEntityId } from '@/lib/entity-id';
import { createProject, isProjectNameDuplicate } from '@/lib/repositories/projects/project';
import { assignProjectIdToTaskSubtree, getTaskById } from '@/lib/repositories/tasks/task';
import type { TaskRow } from '@/lib/repositories/tasks/task.types';

export type UpgradeStandaloneTodoErrorCode =
  | 'not_found'
  | 'not_standalone'
  | 'empty_title'
  | 'duplicate_name';

export type UpgradeStandaloneTodoResult =
  | { ok: true; projectId: string; projectName: string }
  | { ok: false; code: UpgradeStandaloneTodoErrorCode; message: string };

function buildProjectId(): string {
  return makeTimestampEntityId('p_', 8);
}

function buildProjectExtraDataFromTask(task: TaskRow): string | null {
  if (!task.extra_data) return null;
  try {
    const parsed = JSON.parse(task.extra_data) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const schedule = (parsed as { schedule?: unknown }).schedule;
      if (schedule && typeof schedule === 'object') {
        return JSON.stringify({ schedule });
      }
    }
  } catch {
    /* ignore malformed extra_data */
  }
  return null;
}

/** 将无项目顶层待办升级为项目：新建项目并挂接该待办及其子任务。 */
export async function upgradeStandaloneTodoToProject(taskId: string): Promise<UpgradeStandaloneTodoResult> {
  const task = await getTaskById(taskId);
  if (!task) {
    return { ok: false, code: 'not_found', message: '待办不存在或已删除。' };
  }
  if (task.project_id || task.parent_task_id) {
    return { ok: false, code: 'not_standalone', message: '仅支持将未挂项目的顶层待办升级为项目。' };
  }

  const projectName = task.title.trim();
  if (!projectName) {
    return { ok: false, code: 'empty_title', message: '待办标题为空，无法创建项目。' };
  }

  if (await isProjectNameDuplicate(projectName)) {
    return {
      ok: false,
      code: 'duplicate_name',
      message: '已有同名项目，请修改待办标题后再升级。',
    };
  }

  const projectId = buildProjectId();
  await createProject({
    id: projectId,
    name: projectName,
    category_id: null,
    status: 'active',
    note: task.note?.trim() || null,
    due_date: task.due_date,
    extra_data: buildProjectExtraDataFromTask(task),
  });
  await assignProjectIdToTaskSubtree(taskId, projectId);

  return { ok: true, projectId, projectName };
}
