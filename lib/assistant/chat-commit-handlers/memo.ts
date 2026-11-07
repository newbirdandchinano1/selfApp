/**
 * S9.3 W1+W3：commit_memo（创建/更新/置顶，动态 import）。
 */

import type { ChatCommitHandler, ChatCommitHandlerResult } from '@/lib/assistant/chat-commit';
import { draftString, fail, ok } from './shared';

function wantsPin(draft: Record<string, unknown>): boolean | null {
  if (typeof draft.is_pinned === 'boolean') return draft.is_pinned;
  if (typeof draft.pinned === 'boolean') return draft.pinned;
  if (typeof draft.pin === 'boolean') return draft.pin;
  const action = draftString(draft, 'action').toLowerCase();
  if (action === 'pin' || action === 'unpin') return action === 'pin';
  if ('is_pinned' in draft || 'pinned' in draft || 'pin' in draft) {
    const raw = draft.is_pinned ?? draft.pinned ?? draft.pin;
    if (raw === 1 || raw === '1' || raw === 'true') return true;
    if (raw === 0 || raw === '0' || raw === 'false') return false;
  }
  return null;
}

export async function commitMemo(draft: Record<string, unknown>): Promise<ChatCommitHandlerResult> {
  const pinFlag = wantsPin(draft);
  const existingId =
    draftString(draft, 'memo_id') || draftString(draft, 'id') || draftString(draft, 'memoId');
  const titleHint = draftString(draft, 'title');

  if (pinFlag !== null) {
    const { setMemoPinned, listMemos } = await import('@/lib/memos');
    let memoId = existingId;
    if (!memoId && titleHint) {
      const memos = await listMemos();
      const needle = titleHint.toLowerCase();
      const hit =
        memos.find(m => m.title.trim().toLowerCase() === needle) ||
        memos.find(m => m.title.trim().toLowerCase().includes(needle));
      memoId = hit?.id || '';
    }
    if (!memoId) {
      return fail('incomplete_draft', '置顶需要备忘 id 或可匹配的标题');
    }
    const updated = await setMemoPinned(memoId, pinFlag);
    if (!updated) return fail('memo_missing', '找不到要置顶的备忘');
    return ok(
      updated.id,
      pinFlag ? `已置顶备忘「${updated.title.slice(0, 40)}」` : `已取消置顶「${updated.title.slice(0, 40)}」`,
    );
  }

  const titleRaw = titleHint;
  const body =
    draftString(draft, 'body_plain') ||
    draftString(draft, 'body') ||
    draftString(draft, 'content') ||
    '';
  if (!titleRaw && !body) {
    return fail('incomplete_draft', '备忘标题与正文不能都为空');
  }
  const title = titleRaw || '新备忘';

  const { createMemo, updateMemo } = await import('@/lib/memos');

  if (existingId) {
    const updated = await updateMemo(existingId, {
      title: title.slice(0, 80) || '备忘',
      body,
    });
    if (!updated) {
      return fail('memo_missing', '找不到要更新的备忘，请改为新建或打开备忘页');
    }
    return ok(updated.id, `已更新备忘「${updated.title.slice(0, 40)}」`);
  }

  const item = await createMemo({
    title: title.slice(0, 80) || '新备忘',
    body,
  });
  return ok(item.id, `已保存备忘「${item.title.slice(0, 40)}」`);
}

export const memoCommitHandlers: Record<string, ChatCommitHandler> = {
  commit_memo: async input => commitMemo(input.draft),
};
