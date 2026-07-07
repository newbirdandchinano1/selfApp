import { makeTimestampEntityId } from '@/lib/entity-id';
import { deleteMemo, memoListPreviewTitle, type MemoItem } from '@/lib/memos';
import { buildTodoNoteFromMemo } from '@/lib/memo-to-task';
import { INBOX_PROJECT_CATEGORY_ID } from '@/lib/repositories/projects/constants';
import { createProject, isProjectNameDuplicate } from '@/lib/repositories/projects/project';

/** 与 `add-project` 项目名称上限一致 */
export const MEMO_PROJECT_NAME_MAX = 80;

export type MemoToProjectResult = {
  projectId: string;
  name: string;
};

function newProjectId(): string {
  return makeTimestampEntityId('p_', 8);
}

export function buildProjectNameFromMemo(row: MemoItem): string {
  const raw = memoListPreviewTitle(row).trim() || '来自备忘的项目';
  if (raw.length <= MEMO_PROJECT_NAME_MAX) return raw;
  return `${raw.slice(0, MEMO_PROJECT_NAME_MAX - 1)}…`;
}

/** 由备忘生成一条项目并放入收集箱，成功后删除原备忘。 */
export async function createProjectFromMemoInInbox(row: MemoItem): Promise<MemoToProjectResult> {
  const projectId = newProjectId();
  const name = buildProjectNameFromMemo(row);

  if (await isProjectNameDuplicate(name)) {
    throw new Error('duplicate_name');
  }

  const note = buildTodoNoteFromMemo(row);
  const now = new Date().toISOString();

  await createProject({
    id: projectId,
    name,
    category_id: INBOX_PROJECT_CATEGORY_ID,
    status: 'active',
    note,
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
  return { projectId, name };
}
