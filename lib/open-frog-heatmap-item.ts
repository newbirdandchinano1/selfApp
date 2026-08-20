import type { FrogCompletionDayItem, FrogCompletionSubject } from '@/lib/repositories/tasks/frog-completion-events';
import type { Router } from 'expo-router';

export type FrogHeatmapProjectHint = {
  id: string;
  name: string;
};

function normTitle(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

/** 从接口青蛙行里尽量读出「这是项目」的信号与可用 id */
export function readFrogSubjectHints(raw: Record<string, unknown>): {
  subject?: FrogCompletionSubject;
  subjectId?: string;
} {
  const taskId =
    (typeof raw.task_id === 'string' && raw.task_id.trim()) ||
    (typeof raw.taskId === 'string' && raw.taskId.trim()) ||
    '';
  const projectId =
    (typeof raw.project_id === 'string' && raw.project_id.trim()) ||
    (typeof raw.projectId === 'string' && raw.projectId.trim()) ||
    '';

  const typeRaw = raw.subject ?? raw.subject_type ?? raw.kind ?? raw.type ?? raw.entity_type;
  const type = typeof typeRaw === 'string' ? typeRaw.trim().toLowerCase() : '';
  const isProjectFlag = raw.is_project === true || raw.isProject === true;

  if (isProjectFlag || type === 'project' || type === 'projects') {
    return { subject: 'project', subjectId: projectId || taskId || undefined };
  }
  if (type === 'task' || type === 'tasks') {
    return { subject: 'task', subjectId: taskId || undefined };
  }
  if (projectId) {
    return { subject: 'project', subjectId: projectId };
  }
  if (taskId.startsWith('p_')) {
    return { subject: 'project', subjectId: taskId };
  }
  if (taskId.startsWith('tsk_') || taskId.startsWith('t_')) {
    return { subject: 'task', subjectId: taskId };
  }
  return { subjectId: taskId || undefined };
}

/**
 * 用本地项目列表纠正青蛙主体：标题或 id 能对上项目时，一律视为项目青蛙。
 */
export function resolveFrogItemAgainstProjects(
  item: FrogCompletionDayItem,
  projects: FrogHeatmapProjectHint[],
): FrogCompletionDayItem {
  const sid = item.task_id?.trim() ?? '';
  if (item.subject === 'project' || sid.startsWith('p_')) {
    return { ...item, subject: 'project', task_id: sid || item.task_id };
  }

  const byId = sid ? projects.find((p) => p.id === sid) : undefined;
  if (byId) {
    return {
      ...item,
      task_id: byId.id,
      task_title: item.task_title?.trim() || byId.name,
      subject: 'project',
    };
  }

  const title = normTitle(item.task_title);
  if (title) {
    const byName = projects.find((p) => normTitle(p.name) === title);
    if (byName) {
      return {
        ...item,
        task_id: byName.id,
        task_title: byName.name,
        subject: 'project',
      };
    }
  }

  return item;
}

/** 打开热力图青蛙条目：项目优先，避免被误开成空任务页 */
export async function openFrogHeatmapItem(
  router: Router,
  item: FrogCompletionDayItem,
  projects: FrogHeatmapProjectHint[] = [],
): Promise<void> {
  const resolved = resolveFrogItemAgainstProjects(item, projects);
  const subjectId = resolved.task_id?.trim();
  if (!subjectId && !normTitle(resolved.task_title)) return;

  const { ensureLocalRowForWrite } = await import('@/lib/api-local-row');

  const byName = projects.find((p) => normTitle(p.name) === normTitle(resolved.task_title));
  const preferProjectId =
    resolved.subject === 'project' || subjectId?.startsWith('p_')
      ? subjectId
      : byName?.id;

  // 1) 明确是项目 / 标题能对上项目名 → 只进项目详情
  if (preferProjectId) {
    await ensureLocalRowForWrite('projects', preferProjectId);
    router.push({ pathname: '/edit-project', params: { id: preferProjectId } });
    return;
  }

  if (!subjectId) return;

  // 2) 再用 REST 探：先项目后任务
  const asProject = await ensureLocalRowForWrite('projects', subjectId);
  if (asProject) {
    router.push({ pathname: '/edit-project', params: { id: subjectId } });
    return;
  }

  const asTask = await ensureLocalRowForWrite('tasks', subjectId);
  if (asTask) {
    router.push({ pathname: '/task/[id]', params: { id: subjectId } });
    return;
  }

  // 3) 实在认不出：若标题像项目名再试一次全量本地 projects（调用方列表可能未含收集箱外项）
  try {
    const { getProjects } = await import('@/lib/repositories/projects/project');
    const all = await getProjects();
    const hit = all.find((p) => normTitle(p.name) === normTitle(resolved.task_title));
    if (hit) {
      router.push({ pathname: '/edit-project', params: { id: hit.id } });
    }
  } catch {
    // ignore
  }
}
