import { getDatabase } from '@/lib/database.native';
import { getProjectById, updateProject } from './project';
import type { ProjectRow, ProjectStatus } from './project.types';
import type { TaskRow, TaskStatus } from '../tasks/task.types';

export type ProjectAiReview = {
  evaluation: string;
  suggestions: string;
  review_at: string;
  task_count: number;
};

export type ProjectExtraDataWithAi = {
  schedule?: unknown;
  ai_review?: ProjectAiReview;
  [key: string]: unknown;
};

const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  active: '进行中',
  paused: '已暂停',
  completed: '已完成',
  archived: '已归档',
};

const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  todo: '待办',
  doing: '进行中',
  done: '已完成',
  blocked: '阻塞',
  cancelled: '已取消',
  shelved: '暂时搁置',
};

const TASK_PRIORITY_LABEL: Record<number, string> = {
  4: '紧急重要',
  3: '紧急不重要',
  2: '不紧急重要',
  1: '不紧急不重要',
  0: '未设置',
};

export function parseProjectExtraDataWithAi(raw: string | null): ProjectExtraDataWithAi {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as ProjectExtraDataWithAi;
    }
    return {};
  } catch {
    return {};
  }
}

export function parseProjectAiReview(extraData: string | null): ProjectAiReview | null {
  const review = parseProjectExtraDataWithAi(extraData).ai_review;
  if (!review || typeof review !== 'object') return null;
  const evaluation = typeof review.evaluation === 'string' ? review.evaluation.trim() : '';
  const suggestions = typeof review.suggestions === 'string' ? review.suggestions.trim() : '';
  const review_at = typeof review.review_at === 'string' ? review.review_at.trim() : '';
  const task_count = typeof review.task_count === 'number' ? review.task_count : 0;
  if (!evaluation && !suggestions) return null;
  return { evaluation, suggestions, review_at, task_count };
}

export async function countProjectTasks(projectId: string): Promise<number> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ cnt: number }>(
    `SELECT COUNT(1) AS cnt FROM tasks WHERE deleted_at IS NULL AND project_id = ?`,
    [projectId],
  );
  return Number(row?.cnt ?? 0);
}

export async function getAllTasksFlatByProjectId(projectId: string): Promise<TaskRow[]> {
  const db = await getDatabase();
  return db.getAllAsync<TaskRow>(
    `SELECT * FROM tasks
     WHERE deleted_at IS NULL AND project_id = ?
     ORDER BY sort_order ASC, priority DESC, due_date ASC, created_at ASC`,
    [projectId],
  );
}

function parseTaskExtraReminderRepeat(extraData: string | null): { reminder: string; repeat: string } {
  if (!extraData) return { reminder: '', repeat: '' };
  try {
    const parsed = JSON.parse(extraData) as Record<string, unknown>;
    const reminder = typeof parsed.reminder === 'string' ? parsed.reminder.trim() : '';
    const repeat = typeof parsed.repeat === 'string' ? parsed.repeat.trim() : '';
    return { reminder, repeat };
  } catch {
    return { reminder: '', repeat: '' };
  }
}

function formatTaskLine(task: TaskRow, parentTitle: string | null): string {
  const status = TASK_STATUS_LABEL[task.status] ?? task.status;
  const priority = TASK_PRIORITY_LABEL[task.priority] ?? TASK_PRIORITY_LABEL[0];
  const due = task.due_date?.trim() ? task.due_date.slice(0, 10) : '无';
  const { reminder, repeat } = parseTaskExtraReminderRepeat(task.extra_data);
  const parts = [
    `标题：${task.title.trim() || '（未命名）'}`,
    `状态：${status}`,
    `优先级：${priority}`,
    `截止：${due}`,
  ];
  if (parentTitle) parts.push(`父任务：${parentTitle}`);
  if (reminder) parts.push(`提醒：${reminder}`);
  if (repeat) parts.push(`重复：${repeat}`);
  const note = task.note?.trim();
  if (note) {
    const clipped = note.length > 200 ? `${note.slice(0, 197)}…` : note;
    parts.push(`备注：${clipped}`);
  }
  return parts.join('；');
}

/** 将项目与其全部任务（含子任务）格式化为供大模型阅读的摘要文本 */
export function buildProjectTasksAiSummaryText(project: ProjectRow, tasks: TaskRow[]): string {
  const name = project.name.trim() || '（未命名项目）';
  const status = PROJECT_STATUS_LABEL[project.status] ?? project.status;
  const lines: string[] = [
    `【项目】${name}`,
    `项目状态：${status}`,
  ];
  const due = project.due_date?.trim();
  if (due) lines.push(`项目截止：${due.slice(0, 10)}`);
  const note = project.note?.trim();
  if (note) {
    const clipped = note.length > 400 ? `${note.slice(0, 397)}…` : note;
    lines.push(`项目备注：${clipped}`);
  }
  lines.push(`任务总数：${tasks.length}`);
  lines.push('---');
  lines.push('【任务清单】');

  const byId = new Map(tasks.map(t => [t.id, t]));
  const roots = tasks.filter(t => !t.parent_task_id || !byId.has(t.parent_task_id));
  const ordered: TaskRow[] = [];
  const walk = (node: TaskRow) => {
    ordered.push(node);
    for (const child of tasks.filter(t => t.parent_task_id === node.id)) {
      walk(child);
    }
  };
  for (const root of roots) walk(root);
  for (const t of tasks) {
    if (!ordered.some(x => x.id === t.id)) ordered.push(t);
  }

  ordered.forEach((task, index) => {
    const parent = task.parent_task_id ? byId.get(task.parent_task_id) : null;
    const parentTitle = parent?.title?.trim() || null;
    lines.push(`${index + 1}. ${formatTaskLine(task, parentTitle)}`);
  });

  return lines.join('\n');
}

export async function patchProjectAiReview(
  projectId: string,
  payload: { evaluation: string; suggestions: string; task_count: number },
): Promise<ProjectRow | null> {
  const project = await getProjectById(projectId);
  if (!project) return null;

  const extra = parseProjectExtraDataWithAi(project.extra_data);
  const review_at = new Date().toISOString();
  const nextExtra: ProjectExtraDataWithAi = {
    ...extra,
    ai_review: {
      evaluation: payload.evaluation.trim(),
      suggestions: payload.suggestions.trim(),
      review_at,
      task_count: payload.task_count,
    },
  };

  await updateProject(projectId, { extra_data: JSON.stringify(nextExtra) });
  return getProjectById(projectId);
}
