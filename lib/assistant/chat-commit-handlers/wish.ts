/**
 * S9.3 W2：commit_wish（动态 import）。禁止兑换。
 */

import type { ChatCommitHandler, ChatCommitHandlerResult } from '@/lib/assistant/chat-commit';
import { draftNumber, draftString, fail, ok, requestPushPending } from './shared';

function asWishType(raw: unknown): 'once' | 'repeat' {
  const s = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (s === 'repeat' || s === '重复' || s === 'repeated') return 'repeat';
  return 'once';
}

export async function commitWish(
  draft: Record<string, unknown>,
): Promise<ChatCommitHandlerResult> {
  const title = draftString(draft, 'title') || draftString(draft, 'name');
  if (!title) {
    return fail('incomplete_draft', '缺少心愿标题');
  }

  // 红线：任何兑换意图直接拒绝
  const actionHint = draftString(draft, 'action') || draftString(draft, 'intent');
  if (/redeem|兑换|兑奖/.test(actionHint)) {
    return fail('forbidden', '心愿兑换不能由助手执行，请打开心愿板手动操作');
  }

  const { createWishBoardItem, updateWishBoardItem } = await import(
    '@/lib/repositories/wish-board/wish-board'
  );

  const existingId =
    draftString(draft, 'wish_id') ||
    draftString(draft, 'id') ||
    draftString(draft, 'item_id');
  const description =
    draftString(draft, 'description') ||
    draftString(draft, 'description_text') ||
    draftString(draft, 'note') ||
    null;
  const costRaw = draftNumber(draft, 'cost_points') ?? draftNumber(draft, 'cost');
  const cost_points = costRaw != null && costRaw >= 0 ? Math.floor(costRaw) : 0;
  const icon_key = draftString(draft, 'icon_key') || null;
  const wish_type = asWishType(draft.wish_type ?? draft.type);

  if (existingId) {
    await updateWishBoardItem(existingId, {
      title: title.slice(0, 80),
      description,
      cost_points,
      ...(icon_key ? { icon_key } : {}),
      wish_type,
    });
    await requestPushPending();
    return ok(existingId, `已更新心愿「${title.slice(0, 40)}」`);
  }

  const id = await createWishBoardItem({
    title: title.slice(0, 80),
    description,
    cost_points,
    icon_key,
    wish_type,
  });
  await requestPushPending();
  return ok(id, `已保存心愿「${title.slice(0, 40)}」`);
}

export const wishCommitHandlers: Record<string, ChatCommitHandler> = {
  commit_wish: async input => commitWish(input.draft),
};
