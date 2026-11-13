import {
  apiGetFrogCandidates,
  apiPostFrogAssign,
  type FrogCandidateApiItem,
} from '@/lib/api-client';
import { applyServerFrogExtraLocally, assignFrogToApi, assignProjectFrogToApi } from '@/lib/frog-assignment';
import { getProjects } from '@/lib/repositories/projects/project';
import { getTaskById } from '@/lib/repositories/tasks/task';
import type { StandaloneAssignScheduleTime } from '@/lib/standalone-todo-assign-sync';
import {
  getLogicalLocalYmd,
  loadTasksDayBoundary,
  type TasksDayBoundary,
} from '@/lib/tasks-logical-day';

export type FrogCandidate = FrogCandidateApiItem;

export async function fetchFrogCandidates(opts: {
  assignYmd: string;
  boundary?: TasksDayBoundary;
  signal?: AbortSignal;
}): Promise<{ assignYmd: string; logicalToday: string; items: FrogCandidate[] }> {
  const boundary = opts.boundary ?? (await loadTasksDayBoundary());
  try {
    const data = await apiGetFrogCandidates({
      assignYmd: opts.assignYmd,
      dayBoundaryHour: boundary.hour,
      dayBoundaryMinute: boundary.minute,
      signal: opts.signal,
    });
    return {
      assignYmd: data.assignYmd || opts.assignYmd,
      logicalToday: data.logicalToday || getLogicalLocalYmd(new Date(), boundary),
      items: Array.isArray(data.items) ? data.items : [],
    };
  } catch (err) {
    console.warn('[frog-candidates] API 失败，返回空列表', err);
    return {
      assignYmd: opts.assignYmd,
      logicalToday: getLogicalLocalYmd(new Date(), boundary),
      items: [],
    };
  }
}

/**
 * 优先走服务端 frog-assign，成功后回写本地；失败则回退原 PATCH 写入链路。
 * 仅写入指派日（frog 字段），不改动截止日期 due_date / schedule。
 */
export async function assignFrogForDay(params: {
  kind: 'task' | 'project';
  id: string;
  assignYmd: string;
  /** 入格时段提示（占位兼容；不再回写 due/schedule） */
  scheduleTime?: StandaloneAssignScheduleTime;
}): Promise<void> {
  const { assertCanAssignSubjectOnDay } = await import('@/lib/schedule/daily-assign-quota');
  await assertCanAssignSubjectOnDay({
    kind: params.kind,
    id: params.id,
    assignYmd: params.assignYmd,
  });

  let assigned = false;
  try {
    const result = await apiPostFrogAssign({
      kind: params.kind,
      id: params.id,
      assignYmd: params.assignYmd,
      action: 'assign',
    });
    await applyServerFrogExtraLocally(
      params.kind,
      params.id,
      result.extra_data,
      result.updated_at,
    );
    assigned = true;
  } catch (err) {
    console.warn('[frog-assign] 服务端指派失败，回退本地写入', err);
  }

  if (!assigned) {
    if (params.kind === 'project') {
      const projects = await getProjects();
      const project = projects.find((p) => p.id === params.id);
      if (!project) throw new Error('项目不存在');
      await assignProjectFrogToApi(
        params.id,
        project.extra_data,
        params.assignYmd,
        project as unknown as Record<string, unknown>,
      );
    } else {
      const task = await getTaskById(params.id);
      if (!task) throw new Error('任务不存在');
      await assignFrogToApi(
        params.id,
        task.extra_data,
        params.assignYmd,
        task as unknown as Record<string, unknown>,
      );
    }
  }

  try {
    const { syncSubjectWorkflowStatusAfterAssign } = await import(
      '@/lib/repositories/projects/sync-workflow-status'
    );
    await syncSubjectWorkflowStatusAfterAssign({ kind: params.kind, id: params.id });
  } catch (err) {
    console.warn('[frog-assign] 同步进行中状态失败', err);
  }
}

/** 优先走服务端 frog-assign 取消；失败回退 PATCH extra_data */
export async function unassignFrogForDay(params: {
  kind: 'task' | 'project';
  id: string;
  assignYmd: string;
}): Promise<void> {
  let unassigned = false;
  try {
    const result = await apiPostFrogAssign({
      kind: params.kind,
      id: params.id,
      assignYmd: params.assignYmd,
      action: 'unassign',
    });
    await applyServerFrogExtraLocally(
      params.kind,
      params.id,
      result.extra_data,
      result.updated_at,
    );
    unassigned = true;
  } catch (err) {
    console.warn('[frog-assign] 服务端取消指派失败，回退本地写入', err);
  }

  if (!unassigned) {
    if (params.kind === 'project') {
      const { getProjectById } = await import('@/lib/repositories/projects/project');
      const { unassignProjectFrogFromApi } = await import('@/lib/frog-assignment');
      const project = await getProjectById(params.id);
      if (!project) return;
      await unassignProjectFrogFromApi(
        params.id,
        project.extra_data,
        project as unknown as Record<string, unknown>,
        params.assignYmd,
      );
    } else {
      const { unassignFrogFromApi } = await import('@/lib/frog-assignment');
      const task = await getTaskById(params.id);
      if (!task) return;
      await unassignFrogFromApi(
        params.id,
        task.extra_data,
        task as unknown as Record<string, unknown>,
        params.assignYmd,
      );
    }
  }

  try {
    const { syncSubjectWorkflowStatusAfterAssign } = await import(
      '@/lib/repositories/projects/sync-workflow-status'
    );
    await syncSubjectWorkflowStatusAfterAssign({ kind: params.kind, id: params.id });
  } catch (err) {
    console.warn('[frog-assign] 同步待办状态失败', err);
  }
}
