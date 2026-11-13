import { isProjectInInboxCategory, INBOX_PROJECT_CATEGORY_ID } from '@/lib/repositories/projects/constants';
import { buildProjectLockMap } from '@/lib/repositories/projects/project-prerequisites';
import {
  createProject,
  getProjectById,
  getProjects,
  updateProject,
} from '@/lib/repositories/projects/project';
import {
  normalizeProjectStatus,
  type ProjectRow,
} from '@/lib/repositories/projects/project.types';
import type { TaskTreeNode } from '@/lib/repositories/tasks/task';
import {
  deleteTask,
  getTaskById,
  getTasks,
  updateTask,
} from '@/lib/repositories/tasks/task';
import type { TaskRow } from '@/lib/repositories/tasks/task.types';
import {
  clearCancelledAt,
  deriveProjectStatusAfterWorkflow,
  deriveTaskStatusAfterWorkflow,
  hasFrogAssignment,
  mergeCancelledAt,
  shouldArchiveCancelledEntity,
} from '@/lib/repositories/workflow-status';
import { makeTimestampEntityId } from '@/lib/entity-id';

/** 按指派/前置锁重算活跃项目与任务的 todo/doing/blocked */
export async function syncDerivedWorkflowStatuses(params: {
  projects?: ProjectRow[];
  treeMap?: Record<string, TaskTreeNode[]>;
  standaloneTasks?: TaskRow[];
  todayYmd?: string;
}): Promise<{ projectsChanged: number; tasksChanged: number }> {
  const projects = params.projects ?? (await getProjects());
  const treeMap = params.treeMap ?? {};
  const lockMap = buildProjectLockMap(projects, treeMap, params.todayYmd);
  let projectsChanged = 0;
  let tasksChanged = 0;

  for (const project of projects) {
    if (isProjectInInboxCategory(project.category_id)) continue;
    const currentStatus = normalizeProjectStatus(project.status);
    // 终态 / 搁置由用户手控，不自动改写
    if (currentStatus === 'shelved' || currentStatus === 'done' || currentStatus === 'cancelled') {
      continue;
    }
    const locked = lockMap.get(project.id)?.locked === true;
    const next = deriveProjectStatusAfterWorkflow({
      current: project.status,
      assigned: hasFrogAssignment(project.extra_data),
      blocked: locked,
    });
    if (next !== currentStatus) {
      await updateProject(project.id, { status: next });
      projectsChanged += 1;
    }

    const walk = async (nodes: TaskTreeNode[]) => {
      for (const node of nodes) {
        const nextTask = deriveTaskStatusAfterWorkflow({
          current: node.status,
          assigned: hasFrogAssignment(node.extra_data),
          blocked: locked,
        });
        if (nextTask !== node.status) {
          await updateTask(node.id, { status: nextTask });
          tasksChanged += 1;
        }
        if (node.children?.length) await walk(node.children);
      }
    };
    await walk(treeMap[project.id] ?? []);
  }

  const standalone = params.standaloneTasks ?? (await getTasks()).filter((t) => !t.project_id);
  for (const task of standalone) {
    const nextTask = deriveTaskStatusAfterWorkflow({
      current: task.status,
      assigned: hasFrogAssignment(task.extra_data),
      blocked: false,
    });
    if (nextTask !== task.status) {
      await updateTask(task.id, { status: nextTask });
      tasksChanged += 1;
    }
  }

  return { projectsChanged, tasksChanged };
}

/** 指派/取消指派后同步单条 status */
export async function syncSubjectWorkflowStatusAfterAssign(params: {
  kind: 'task' | 'project';
  id: string;
  blocked?: boolean;
}): Promise<void> {
  if (params.kind === 'project') {
    const project = await getProjectById(params.id);
    if (!project) return;
    const next = deriveProjectStatusAfterWorkflow({
      current: project.status,
      assigned: hasFrogAssignment(project.extra_data),
      blocked: params.blocked === true,
    });
    if (next !== normalizeProjectStatus(project.status)) {
      await updateProject(project.id, { status: next });
    }
    return;
  }
  const task = await getTaskById(params.id);
  if (!task) return;
  const next = deriveTaskStatusAfterWorkflow({
    current: task.status,
    assigned: hasFrogAssignment(task.extra_data),
    blocked: params.blocked === true,
  });
  if (next !== task.status) {
    await updateTask(task.id, { status: next });
  }
}

export async function markProjectCancelled(projectId: string, todayYmd: string): Promise<void> {
  const project = await getProjectById(projectId);
  if (!project) return;
  const extra = mergeCancelledAt(project.extra_data, todayYmd);
  await updateProject(projectId, { status: 'cancelled', extra_data: extra });
}

export async function markProjectShelved(projectId: string): Promise<void> {
  await updateProject(projectId, { status: 'shelved' });
}

export async function activateShelvedOrCancelledProject(
  projectId: string,
  opts?: { blocked?: boolean },
): Promise<void> {
  const project = await getProjectById(projectId);
  if (!project) return;
  const extra = clearCancelledAt(project.extra_data);
  const next = deriveProjectStatusAfterWorkflow({
    current: 'todo',
    assigned: hasFrogAssignment(extra),
    blocked: opts?.blocked === true,
  });
  await updateProject(projectId, { status: next, extra_data: extra });
}

export async function markTaskCancelled(taskId: string, todayYmd: string): Promise<void> {
  const task = await getTaskById(taskId);
  if (!task) return;
  const extra = mergeCancelledAt(task.extra_data, todayYmd);
  await updateTask(taskId, { status: 'cancelled', completed_at: null, extra_data: extra });
}

export async function uncancelTask(taskId: string, opts?: { blocked?: boolean }): Promise<void> {
  const task = await getTaskById(taskId);
  if (!task) return;
  const extra = clearCancelledAt(task.extra_data);
  const next = deriveTaskStatusAfterWorkflow({
    current: 'todo',
    assigned: hasFrogAssignment(extra),
    blocked: opts?.blocked === true,
  });
  await updateTask(taskId, { status: next, completed_at: null, extra_data: extra });
}

/**
 * 已取消且设了时间的项目/独立待办：次日或过期后收入收集箱。
 * 独立待办会转为收集箱内的同名项目后删除原待办。
 */
export async function archiveCancelledEntitiesDueForInbox(todayYmd: string): Promise<{
  projects: number;
  tasks: number;
}> {
  let projectsArchived = 0;
  let tasksArchived = 0;

  const projects = await getProjects();
  for (const project of projects) {
    if (isProjectInInboxCategory(project.category_id)) continue;
    if (
      !shouldArchiveCancelledEntity({
        status: project.status,
        due_date: project.due_date,
        extra_data: project.extra_data,
        todayYmd,
        project,
      })
    ) {
      continue;
    }
    await updateProject(project.id, {
      category_id: INBOX_PROJECT_CATEGORY_ID,
      status: 'cancelled',
    });
    projectsArchived += 1;
  }

  const standalone = (await getTasks()).filter((t) => !t.project_id && t.status === 'cancelled');
  for (const task of standalone) {
    if (
      !shouldArchiveCancelledEntity({
        status: task.status,
        due_date: task.due_date,
        extra_data: task.extra_data,
        todayYmd,
      })
    ) {
      continue;
    }
    const baseName = task.title?.trim() || '已取消待办';
    const projectId = makeTimestampEntityId('p_', 8);
    await createProject({
      id: projectId,
      name: `${baseName}（已取消）`,
      category_id: INBOX_PROJECT_CATEGORY_ID,
      status: 'cancelled',
      priority: task.priority,
      note: task.note ?? task.description,
      due_date: task.due_date,
      extra_data: task.extra_data,
    });
    await deleteTask(task.id);
    tasksArchived += 1;
  }

  return { projects: projectsArchived, tasks: tasksArchived };
}
