import type { MemoConvertDraftJson } from '@/lib/ai-types';
import { makeTimestampEntityId } from '@/lib/entity-id';
import { plainTextFromBody } from '@/lib/memo-richdoc';
import { deleteMemo, memoListPreviewTitle, type MemoItem } from '@/lib/memos';
import { createTask } from '@/lib/repositories/tasks/task';

/** 与 `add-standalone-todo` 标题上限一致 */
export const MEMO_TODO_TITLE_MAX = 50;
/** 与 `add-project` / memo-to-project 名称上限一致 */
const MEMO_PROJECT_NAME_MAX = 80;

export type MemoToStandaloneTodoResult = {
  taskId: string;
  title: string;
};

function newTaskId(): string {
  return makeTimestampEntityId('tsk_', 8);
}

export function buildTodoTitleFromMemo(row: MemoItem): string {
  const raw = memoListPreviewTitle(row).trim() || '来自备忘的待办';
  if (raw.length <= MEMO_TODO_TITLE_MAX) return raw;
  return `${raw.slice(0, MEMO_TODO_TITLE_MAX - 1)}…`;
}

export function buildTodoNoteFromMemo(row: MemoItem): string | null {
  const chunks: string[] = [];
  const title = row.title.trim();
  const body = plainTextFromBody(row.body).trim();

  if (body) {
    if (!title) {
      const lines = body.split(/\n/);
      const rest = lines.slice(1).join('\n').trim();
      if (rest) chunks.push(rest);
    } else {
      chunks.push(body);
    }
  } else if (title) {
    const preview = memoListPreviewTitle(row);
    if (title !== preview) chunks.push(title);
  }

  const aiEval = row.ai_evaluation?.trim();
  const aiSuggest = row.ai_suggestions?.trim();
  if (aiEval) chunks.push(`【AI 评价】\n${aiEval}`);
  if (aiSuggest) chunks.push(`【AI 建议】\n${aiSuggest}`);

  const joined = chunks.join('\n\n').trim();
  return joined || null;
}

/**
 * 智能转换草稿预填：备忘标题 → 待办标题/项目名，备忘正文 → 备注。
 * 保留 AI 的 mode / rationale / due_hint；不覆盖 split 各条标题。
 */
export function seedConvertDraftFromMemo(
  row: MemoItem,
  draft: MemoConvertDraftJson,
): MemoConvertDraftJson {
  const mappedTitle = buildTodoTitleFromMemo(row);
  const mappedNote = buildTodoNoteFromMemo(row) ?? '';
  const nameRaw = memoListPreviewTitle(row).trim() || '来自备忘的项目';
  const mappedName =
    nameRaw.length <= MEMO_PROJECT_NAME_MAX
      ? nameRaw
      : `${nameRaw.slice(0, MEMO_PROJECT_NAME_MAX - 1)}…`;

  const next: MemoConvertDraftJson = {
    mode: draft.mode,
    rationale: draft.rationale,
  };

  if (draft.mode === 'todo' || draft.todo) {
    next.todo = {
      title: mappedTitle,
      note: mappedNote,
      priority: draft.todo?.priority ?? 0,
      ...(draft.todo?.due_hint ? { due_hint: draft.todo.due_hint } : {}),
    };
  }
  if (draft.mode === 'project' || draft.project) {
    next.project = {
      name: mappedName,
      note: mappedNote,
    };
  }
  if (draft.mode === 'split_todos' && Array.isArray(draft.split_todos)) {
    next.split_todos = draft.split_todos.map(t => ({
      ...t,
      note: t.note?.trim() ? t.note : mappedNote,
    }));
  }
  return next;
}

export type MemoTodoDraftOverride = {
  title?: string;
  note?: string | null;
  priority?: number;
};

function clampTodoTitle(raw: string): string {
  const t = raw.trim() || '来自备忘的待办';
  if (t.length <= MEMO_TODO_TITLE_MAX) return t;
  return `${t.slice(0, MEMO_TODO_TITLE_MAX - 1)}…`;
}

/** 由备忘生成一条不挂项目的待办，成功后删除原备忘。可传入 AI 草稿覆盖标题/备注/优先级。 */
export async function createStandaloneTodoFromMemo(
  row: MemoItem,
  override?: MemoTodoDraftOverride,
): Promise<MemoToStandaloneTodoResult> {
  const taskId = newTaskId();
  const title = override?.title?.trim()
    ? clampTodoTitle(override.title)
    : buildTodoTitleFromMemo(row);
  const note =
    override && 'note' in override
      ? override.note?.trim()
        ? override.note.trim()
        : null
      : buildTodoNoteFromMemo(row);
  const priority =
    typeof override?.priority === 'number' && Number.isFinite(override.priority)
      ? Math.max(0, Math.min(3, Math.trunc(override.priority)))
      : 0;
  const now = new Date().toISOString();

  await createTask({
    id: taskId,
    project_id: null,
    category_id: null,
    parent_task_id: null,
    title,
    note,
    status: 'todo',
    priority,
    due_date: null,
    extra_data: JSON.stringify({
      source: 'memo',
      memo_id: row.id,
      converted_at: now,
    }),
  });

  const deleted = await deleteMemo(row.id);
  if (!deleted) {
    throw new Error('memo_delete_failed');
  }
  return { taskId, title };
}

/** 由备忘拆成多条独立待办，全部创建成功后删除原备忘。 */
export async function createStandaloneTodosFromMemo(
  row: MemoItem,
  drafts: MemoTodoDraftOverride[],
): Promise<{ taskIds: string[]; titles: string[] }> {
  const list = drafts
    .map(d => ({
      title: clampTodoTitle(d.title?.trim() || buildTodoTitleFromMemo(row)),
      note: d.note?.trim() ? d.note.trim() : null,
      priority:
        typeof d.priority === 'number' && Number.isFinite(d.priority)
          ? Math.max(0, Math.min(3, Math.trunc(d.priority)))
          : 0,
    }))
    .filter(d => d.title);
  if (list.length === 0) throw new Error('empty_drafts');

  const now = new Date().toISOString();
  const taskIds: string[] = [];
  const titles: string[] = [];
  for (const d of list) {
    const taskId = newTaskId();
    await createTask({
      id: taskId,
      project_id: null,
      category_id: null,
      parent_task_id: null,
      title: d.title,
      note: d.note,
      status: 'todo',
      priority: d.priority,
      due_date: null,
      extra_data: JSON.stringify({
        source: 'memo',
        memo_id: row.id,
        converted_at: now,
        split: true,
      }),
    });
    taskIds.push(taskId);
    titles.push(d.title);
  }

  const deleted = await deleteMemo(row.id);
  if (!deleted) {
    throw new Error('memo_delete_failed');
  }
  return { taskIds, titles };
}
