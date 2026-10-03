import {
  apiGetFrogCandidates,
  apiPostFrogAssign,
  type FrogCandidateApiItem,
} from '@/lib/api-client';
import { applyServerFrogExtraLocally, assignFrogToApi, assignProjectFrogToApi } from '@/lib/frog-assignment';
import { getProjects } from '@/lib/repositories/projects/project';
import { getTaskById } from '@/lib/repositories/tasks/task';
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
 */
export async function assignFrogForDay(params: {
  kind: 'task' | 'project';
  id: string;
  assignYmd: string;
}): Promise<void> {
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
    return;
  } catch (err) {
    console.warn('[frog-assign] 服务端指派失败，回退本地写入', err);
  }

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
    return;
  }

  const task = await getTaskById(params.id);
  if (!task) throw new Error('任务不存在');
  await assignFrogToApi(
    params.id,
    task.extra_data,
    params.assignYmd,
    task as unknown as Record<string, unknown>,
  );
}

/** 优先走服务端 frog-assign 取消；失败回退 PATCH extra_data */
export async function unassignFrogForDay(params: {
  kind: 'task' | 'project';
  id: string;
  assignYmd: string;
}): Promise<void> {
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
    return;
  } catch (err) {
    console.warn('[frog-assign] 服务端取消指派失败，回退本地写入', err);
  }

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
    return;
  }

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
