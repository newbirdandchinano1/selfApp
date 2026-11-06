/** 备忘列表摘要：喂给 dedupe / collection-insights，控制 token。 */
import type { MemoAiSummaryItem } from '@/lib/ai-types';
import { plainTextFromBody } from '@/lib/memo-richdoc';
import { memoListPreviewTitle, type MemoItem } from '@/lib/memos';
import type { TagRow } from '@/lib/repositories/tags/tag.types';

export function buildMemoAiSummaryItem(
  row: MemoItem,
  tags?: TagRow[] | { name: string }[],
): MemoAiSummaryItem {
  const title = memoListPreviewTitle(row);
  const body = plainTextFromBody(row.body).trim();
  const body_preview = body.length > 200 ? `${body.slice(0, 200)}…` : body;
  const tag_names = (tags ?? [])
    .map(t => ('name' in t ? String(t.name) : ''))
    .filter(Boolean)
    .slice(0, 6);
  return {
    id: row.id,
    title_preview: title.length > 48 ? `${title.slice(0, 48)}…` : title,
    ...(tag_names.length ? { tag_names } : {}),
    updated_at: row.updated_at,
    ...(body_preview ? { body_preview } : {}),
  };
}

/** 近 N 天内备忘，按 updated_at 降序，最多 maxN 条。 */
export function pickRecentMemosForInsights(
  items: MemoItem[],
  opts?: { days?: number; maxN?: number },
): MemoItem[] {
  const days = opts?.days ?? 7;
  const maxN = opts?.maxN ?? 60;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return [...items]
    .filter(m => {
      const t = new Date(m.updated_at).getTime();
      return Number.isFinite(t) && t >= cutoff;
    })
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .slice(0, maxN);
}

export function pickCandidatesForDedupe(
  items: MemoItem[],
  currentId: string,
  maxN = 80,
): MemoItem[] {
  return [...items]
    .filter(m => m.id !== currentId)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .slice(0, maxN);
}
