import { deleteMemo, memoListPreviewTitle, type MemoItem } from '@/lib/memos';
import { createTask } from '@/lib/repositories/tasks/task';

/** 与 `add-standalone-todo` 标题上限一致 */
export const MEMO_TODO_TITLE_MAX = 50;

export type MemoToStandaloneTodoResult = {
  taskId: string;
  title: string;
};

function newTaskId(): string {
  return `tsk_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export function buildTodoTitleFromMemo(row: MemoItem): string {
  const raw = memoListPreviewTitle(row).trim() || '来自备忘的待办';
  if (raw.length <= MEMO_TODO_TITLE_MAX) return raw;
  return `${raw.slice(0, MEMO_TODO_TITLE_MAX - 1)}…`;
}

export function buildTodoNoteFromMemo(row: MemoItem): string | null {
  const chunks: string[] = [];
  const title = row.title.trim();
  const body = row.body.trim();

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

/** 由备忘生成一条不挂项目的待办，成功后删除原备忘。 */
export async function createStandaloneTodoFromMemo(row: MemoItem): Promise<MemoToStandaloneTodoResult> {
  const taskId = newTaskId();
  const title = buildTodoTitleFromMemo(row);
  const note = buildTodoNoteFromMemo(row);
  const now = new Date().toISOString();

  await createTask({
    id: taskId,
    project_id: null,
    category_id: null,
    parent_task_id: null,
    title,
    note,
    status: 'todo',
    priority: 0,
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
