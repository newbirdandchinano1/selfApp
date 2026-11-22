/**
 * S9.3 W1+W3：commit_task / commit_project / 分类（动态 import repository）。
 */

import type { ChatCommitHandler, ChatCommitHandlerResult } from '@/lib/assistant/chat-commit';
import { draftString, dueYmdToDueDate, fail, ok, requestPushPending } from './shared';

function asPriority(raw: unknown): 0 | 1 | 2 | 3 | 4 {
  if (typeof raw === 'string') {
    const s = raw.trim().toUpperCase();
    const map: Record<string, 1 | 2 | 3 | 4> = {
      P1: 4,
      P2: 3,
      P3: 2,
      P4: 1,
      紧急重要: 4,
      紧急不重要: 3,
      不紧急重要: 2,
      不紧急不重要: 1,
    };
    if (map[s] != null) return map[s];
    if (map[raw.trim()] != null) return map[raw.trim()];
  }
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (n === 1 || n === 2 || n === 3 || n === 4) return n;
  return 0;
}

function asTaskStatus(raw: unknown): 'todo' | 'doing' | 'shelved' | 'cancelled' | 'done' | undefined {
  const s = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (!s) return undefined;
  if (s === 'todo' || s === 'doing' || s === 'shelved' || s === 'cancelled' || s === 'done') return s;
  if (s === '搁置') return 'shelved';
  if (s === '取消' || s === 'canceled') return 'cancelled';
  if (s === '激活' || s === 'activate' || s === 'uncancel' || s === '恢复取消') return 'todo';
  if (s === '完成') return 'done';
  return undefined;
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
    const nextStatus = asTaskStatus(draft.status);
    // 聊天侧禁止静默完成；完成请走 App 勾选
    if (nextStatus === 'done') {
      return fail('forbidden_complete', '聊天侧不可直接完成待办，请在任务页勾选完成');
    }
    let nextExtra = current.extra_data;
    if (draft.is_long_term !== undefined || draft.acceptance !== undefined) {
      let extra: Record<string, unknown> = {};
      try {
        extra = current.extra_data ? (JSON.parse(current.extra_data) as Record<string, unknown>) : {};
      } catch {
        extra = {};
      }
      if (draft.is_long_term !== undefined) extra.is_long_term = Boolean(draft.is_long_term);
      if (typeof draft.acceptance === 'string' && draft.acceptance.trim()) {
        extra.acceptance = draft.acceptance.trim();
        extra.is_long_term = true;
      }
      nextExtra = JSON.stringify(extra);
    }
    await updateTask(existingId, {
      title: (title || current.title).slice(0, 80),
      note: note !== null && note !== '' ? note : current.note,
      priority: draft.priority !== undefined ? asPriority(draft.priority) : undefined,
      due_date: dueDate ?? undefined,
      status: nextStatus,
      extra_data: nextExtra !== current.extra_data ? nextExtra : undefined,
    });
    await requestPushPending();
    const label = (title || current.title).slice(0, 40);
    if (nextStatus === 'shelved') return ok(existingId, `已搁置待办「${label}」`);
    if (nextStatus === 'cancelled') return ok(existingId, `已取消待办「${label}」`);
    if (nextStatus === 'todo' || nextStatus === 'doing') {
      return ok(existingId, `已恢复待办「${label}」`);
    }
    return ok(existingId, `已更新待办「${label}」`);
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
    const nextStatus = asTaskStatus(draft.status);
    if (nextStatus === 'done' || nextStatus === 'cancelled') {
      return fail('forbidden_terminal', '聊天侧不可直接完成/取消项目终态，请在 App 内操作');
    }
    const categoryId =
      draftString(draft, 'category_id') || draftString(draft, 'categoryId') || undefined;
    await updateProject(existingId, {
      name: (name || current.name).slice(0, 80),
      note: note !== null && note !== '' ? note : current.note,
      priority: draft.priority !== undefined ? asPriority(draft.priority) : undefined,
      status: nextStatus === 'shelved' || nextStatus === 'todo' || nextStatus === 'doing' ? nextStatus : undefined,
      category_id: categoryId,
    });
    await requestPushPending();
    const label = (name || current.name).slice(0, 40);
    if (nextStatus === 'shelved') return ok(existingId, `已搁置项目「${label}」`);
    if (nextStatus === 'todo' || nextStatus === 'doing') return ok(existingId, `已激活项目「${label}」`);
    if (categoryId) return ok(existingId, `已更新项目「${label}」分类`);
    return ok(existingId, `已更新项目「${label}」`);
  }

  const projectId = makeTimestampEntityId('p_', 8);
  await createProject({
    id: projectId,
    name: name.slice(0, 80),
    category_id: INBOX_PROJECT_CATEGORY_ID,
    status: 'todo',
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
  const existingId =
    draftString(draft, 'category_id') || draftString(draft, 'id') || draftString(draft, 'categoryId');
  const { makeTimestampEntityId } = await import('@/lib/entity-id');
  const { createTaskCategory, updateTaskCategory } = await import('@/lib/repositories/tasks/task');
  if (existingId) {
    await updateTaskCategory(existingId, { name: name.slice(0, 40) });
    await requestPushPending();
    return ok(existingId, `已重命名任务分类「${name.slice(0, 40)}」`);
  }
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
  const existingId =
    draftString(draft, 'category_id') || draftString(draft, 'id') || draftString(draft, 'categoryId');
  const { makeTimestampEntityId } = await import('@/lib/entity-id');
  const { createProjectCategory, updateProjectCategory } = await import(
    '@/lib/repositories/projects/project'
  );
  if (existingId) {
    await updateProjectCategory(existingId, { name: name.slice(0, 40) });
    await requestPushPending();
    return ok(existingId, `已重命名项目分类「${name.slice(0, 40)}」`);
  }
  const id = makeTimestampEntityId('pcat_', 8);
  await createProjectCategory({
    id,
    name: name.slice(0, 40),
    extra_data: JSON.stringify({ source: 'assistant_chat_commit' }),
  });
  await requestPushPending();
  return ok(id, `已创建项目分类「${name.slice(0, 40)}」`);
}

/** 独立待办升为项目（结构变更，须确认卡） */
export async function commitPromoteTodoToProject(
  draft: Record<string, unknown>,
): Promise<ChatCommitHandlerResult> {
  const taskId =
    draftString(draft, 'task_id') ||
    draftString(draft, 'id') ||
    draftString(draft, 'taskId');
  if (!taskId) {
    const title = draftString(draft, 'task_title') || draftString(draft, 'title');
    if (!title) return fail('incomplete_draft', '请指定要升级的待办 id 或标题');
    const { getTasks } = await import('@/lib/repositories/tasks/task');
    const tasks = await getTasks();
    const needle = title.toLowerCase();
    const hit =
      tasks.find(t => !t.project_id && !t.parent_task_id && t.title.trim().toLowerCase() === needle) ||
      tasks.find(
        t => !t.project_id && !t.parent_task_id && t.title.trim().toLowerCase().includes(needle),
      );
    if (!hit) return fail('incomplete_draft', `找不到独立待办「${title}」`);
    const { upgradeStandaloneTodoToProject } = await import('@/lib/standalone-todo-to-project');
    const result = await upgradeStandaloneTodoToProject(hit.id);
    if (!result.ok) return fail(result.code, result.message);
    await requestPushPending();
    return ok(result.projectId, `已将「${result.projectName}」升为项目`);
  }

  const { upgradeStandaloneTodoToProject } = await import('@/lib/standalone-todo-to-project');
  const result = await upgradeStandaloneTodoToProject(taskId);
  if (!result.ok) return fail(result.code, result.message);
  await requestPushPending();
  return ok(result.projectId, `已将「${result.projectName}」升为项目`);
}

/** 设置逻辑日界（影响全模块「今天」） */
export async function commitDayBoundary(
  draft: Record<string, unknown>,
): Promise<ChatCommitHandlerResult> {
  const hourRaw = draft.hour ?? draft.day_boundary_hour;
  const minuteRaw = draft.minute ?? draft.day_boundary_minute ?? 0;
  const hour = typeof hourRaw === 'number' ? hourRaw : Number(hourRaw);
  if (!Number.isFinite(hour)) {
    return fail('incomplete_draft', '请提供日界小时（0–23）');
  }
  const minute = typeof minuteRaw === 'number' ? minuteRaw : Number(minuteRaw);
  const { saveConfiguredDayBoundary, saveDayBoundaryPages, normalizeDayBoundaryPages } =
    await import('@/lib/tasks-logical-day');
  await saveConfiguredDayBoundary({
    hour: Math.min(23, Math.max(0, Math.round(hour))),
    minute: Math.min(59, Math.max(0, Math.round(Number.isFinite(minute) ? minute : 0))),
  });
  if (Array.isArray(draft.pages)) {
    await saveDayBoundaryPages(normalizeDayBoundaryPages(draft.pages));
  }
  await requestPushPending();
  const hh = String(Math.min(23, Math.max(0, Math.round(hour)))).padStart(2, '0');
  const mm = String(
    Math.min(59, Math.max(0, Math.round(Number.isFinite(minute) ? minute : 0))),
  ).padStart(2, '0');
  return ok('day_boundary', `日界已改为 ${hh}:${mm}`);
}

export const taskCommitHandlers: Record<string, ChatCommitHandler> = {
  commit_task: async input => commitTask(input.draft),
  commit_project: async input => commitProject(input.draft),
  commit_task_category: async input => commitTaskCategory(input.draft),
  commit_project_category: async input => commitProjectCategory(input.draft),
  commit_promote_todo_to_project: async input => commitPromoteTodoToProject(input.draft),
  commit_day_boundary: async input => commitDayBoundary(input.draft),
};
