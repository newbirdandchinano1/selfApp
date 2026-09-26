/** 创建/编辑表单族共用的标题与日程校验 */

export const ENTITY_TITLE_MAX = {
  project: 80,
  projectTask: 80,
  standaloneTodo: 50,
  subtask: 30,
  habit: 80,
  wish: 80,
} as const;

export type EntityTitleKind = keyof typeof ENTITY_TITLE_MAX;

export function clampTitle(text: string, maxLength: number): string {
  return text.slice(0, maxLength);
}

export function validateRequiredTitle(
  title: string,
  options?: { emptyMessage?: string },
): { ok: true; title: string } | { ok: false; message: string } {
  const trimmed = title.trim();
  if (!trimmed) {
    return { ok: false, message: options?.emptyMessage ?? '请先填写标题。' };
  }
  return { ok: true, title: trimmed };
}

/** 从截止日期展示文案中取出最后一个 YYYY-MM-DD */
export function extractDueDateFromDeadlineText(deadlineText: string): string | null {
  const all = deadlineText.match(/\d{4}-\d{2}-\d{2}/g);
  if (!all?.length) return null;
  return all[all.length - 1] ?? null;
}
