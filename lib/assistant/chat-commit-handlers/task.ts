/**
 * S9.3 W1+W3：commit_task / commit_project / 分类（动态 import repository）。
 */

import type { ChatCommitHandler, ChatCommitHandlerResult } from '@/lib/assistant/chat-commit';
import { draftString, dueYmdToDueDate, fail, ok, requestPushPending } from './shared';

function asPriority(raw: unknown): 0 | 1 | 2 | 3 | 4 {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (n === 1 || n === 2 || n === 3 || n === 4) return n;
  return 0;
}

function readSubtaskTitles(draft: Record<string, unknown>): string[] {
  const titles: string[] = [];
  const breakdown = draft.breakdown;
  if (breakdown && typeof breakdown === 'object') {
    const subs = (breakdown as { subtasks?: unknown }).subtasks;
    if (Array.isArray(subs)) {
      for (const row of subs.slice(0, 12)) {
        if (!row || typeof row !== 'object') continue;
        const t = String((row as { title?: unknown }).title ?? '').trim();
        if (t) titles.push(t.slice(0, 80));
      }
    }
  }
  const plan = draft.plan;
  if (plan && typeof plan === 'object') {
    const milestones = (plan as { milestones?: unknown }).milestones;
    if (Array.isArray(milestones)) {
      for (const row of milestones.slice(0, 12)) {
        if (!row || typeof row !== 'object') continue;
        const t = String(
          (row as { title?: unknown; name?: unknown }).title ??
            (row as { name?: unknown }).name ??
            '',
        ).trim();
        if (t) titles.push(t.slice(0, 80));
      }
    }
  }
  return titles;
}

export async function commitTask(draft: Record<string, unknown>): Promise<ChatCommitHandlerResult> {
  const title = draftString(draft, 'title') || draftString(draft, 'name');
  const existingId =
    draftString(draft, 'task_id') || draftString(draft, 'id') || draftString(draft, 'taskId');

  if (!existingId && !title) {
    return fail('incomplete_draft', '缺少待办标题');
  }

  const { makeTimestampEntityId } = await import('@/lib/entity-id');
  const { createTask, updateTask, getTaskById } = await import('@/lib/repositories/tasks/task');

  const dueYmd = draftString(draft, 'due_ymd');
  const dueDate = dueYmd ? dueYmdToDueDate(dueYmd) : null;
  const note = draftString(draft, 'note') || draftString(draft, 'description') || null;

  if (existingId) {
    const current = await getTaskById(existingId);
    if (!current) return fail('task_missing', '找不到要更新的待办');
    await updateTask(existingId, {
      title: (title || current.title).slice(0, 80),
      note: note !== null && note !== '' ? note : current.note,
      priority: draft.priority !== undefined ? asPriority(draft.priority) : undefined,
      due_date: dueDate ?? undefined,
    });
    await requestPushPending();
    return ok(existingId, `已更新待办「${(title || current.title).slice(0, 40)}」`);
  }

  const taskId = makeTimestampEntityId('tsk_', 8);
  await createTask({
    id: taskId,
    title: title.slice(0, 80),
    note,
    priority: asPriority(draft.priority),
    due_date: dueDate,
    status: 'todo',
    extra_data: JSON.stringify({ source: 'assistant_chat_commit' }),
  });

  const childTitles = readSubtaskTitles(draft);
  for (const childTitle of childTitles) {
    await createTask({
      id: makeTimestampEntityId('tsk_', 8),
      title: childTitle,
      parent_task_id: taskId,
      status: 'todo',
      priority: 0,
      extra_data: JSON.stringify({ source: 'assistant_chat_commit', parent: taskId }),
    });
  }

  const suffix = childTitles.length ? `（含 ${childTitles.length} 条子任务）` : '';
  return ok(taskId, `已创建待办「${title.slice(0, 40)}」${suffix}`);
}

export async function commitProject(
  draft: Record<string, unknown>,
): Promise<ChatCommitHandlerResult> {
  const name =
    draftString(draft, 'project_name') ||
    draftString(draft, 'name') ||
    draftString(draft, 'title');
  const existingId =
    draftString(draft, 'project_id') || draftString(draft, 'id') || draftString(draft, 'projectId');

  if (!existingId && !name) {
    return fail('incomplete_draft', '缺少项目名称');
  }

  const { makeTimestampEntityId } = await import('@/lib/entity-id');
  const { INBOX_PROJECT_CATEGORY_ID } = await import('@/lib/repositories/projects/constants');
  const { createProject, updateProject, getProjectById } = await import(
    '@/lib/repositories/projects/project'
  );
  const { createTask } = await import('@/lib/repositories/tasks/task');

  const note = draftString(draft, 'note') || draftString(draft, 'description') || null;

  if (existingId) {
    const current = await getProjectById(existingId);
    if (!current) return fail('project_missing', '找不到要更新的项目');
    await updateProject(existingId, {
      name: (name || current.name).slice(0, 80),
      note: note !== null && note !== '' ? note : current.note,
      priority: draft.priority !== undefined ? asPriority(draft.priority) : undefined,
    });
    await requestPushPending();
    return ok(existingId, `已更新项目「${(name || current.name).slice(0, 40)}」`);
  }

  const projectId = makeTimestampEntityId('p_', 8);
  await createProject({
    id: projectId,
    name: name.slice(0, 80),
    category_id: INBOX_PROJECT_CATEGORY_ID,
    status: 'active',
    note,
    priority: asPriority(draft.priority),
    extra_data: JSON.stringify({ source: 'assistant_chat_commit' }),
  });
  await requestPushPending();

  const milestones = readSubtaskTitles(draft);
  for (const title of milestones) {
    await createTask({
      id: makeTimestampEntityId('tsk_', 8),
      title,
      project_id: projectId,
      status: 'todo',
      priority: 0,
      extra_data: JSON.stringify({ source: 'assistant_chat_commit', project_id: projectId }),
    });
  }

  const suffix = milestones.length ? `（含 ${milestones.length} 个里程碑待办）` : '';
  return ok(projectId, `已创建项目「${name.slice(0, 40)}」${suffix}`);
}

export async function commitTaskCategory(
  draft: Record<string, unknown>,
): Promise<ChatCommitHandlerResult> {
  const name = draftString(draft, 'name') || draftString(draft, 'title');
  if (!name) return fail('incomplete_draft', '缺少任务分类名称');
  const { makeTimestampEntityId } = await import('@/lib/entity-id');
  const { createTaskCategory } = await import('@/lib/repositories/tasks/task');
  const id = makeTimestampEntityId('tcat_', 8);
  await createTaskCategory({
    id,
    name: name.slice(0, 40),
    extra_data: JSON.stringify({ source: 'assistant_chat_commit' }),
  });
  await requestPushPending();
  return ok(id, `已创建任务分类「${name.slice(0, 40)}」`);
}

export async function commitProjectCategory(
  draft: Record<string, unknown>,
): Promise<ChatCommitHandlerResult> {
  const name = draftString(draft, 'name') || draftString(draft, 'title');
  if (!name) return fail('incomplete_draft', '缺少项目分类名称');
  const { makeTimestampEntityId } = await import('@/lib/entity-id');
  const { createProjectCategory } = await import('@/lib/repositories/projects/project');
  const id = makeTimestampEntityId('pcat_', 8);
  await createProjectCategory({
    id,
    name: name.slice(0, 40),
    extra_data: JSON.stringify({ source: 'assistant_chat_commit' }),
  });
  await requestPushPending();
  return ok(id, `已创建项目分类「${name.slice(0, 40)}」`);
}

export const taskCommitHandlers: Record<string, ChatCommitHandler> = {
  commit_task: async input => commitTask(input.draft),
  commit_project: async input => commitProject(input.draft),
  commit_task_category: async input => commitTaskCategory(input.draft),
  commit_project_category: async input => commitProjectCategory(input.draft),
};
