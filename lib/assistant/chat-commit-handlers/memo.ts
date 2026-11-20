/**
 * S9.3 W1+W3：commit_memo（创建/更新/置顶）/ commit_memo_delete（软删，动态 import）。
 */

import type { ChatCommitHandler, ChatCommitHandlerResult } from '@/lib/assistant/chat-commit';
import { draftString, fail, ok, requestPushPending } from './shared';

function wantsPin(draft: Record<string, unknown>): boolean | null {
  if (typeof draft.is_pinned === 'boolean') return draft.is_pinned;
  if (typeof draft.pinned === 'boolean') return draft.pinned;
  if (typeof draft.pin === 'boolean') return draft.pin;
  const action = draftString(draft, 'action').toLowerCase();
  if (action === 'pin' || action === 'unpin') return action === 'pin';
  if ('is_pinned' in draft || 'pinned' in draft || 'pin' in draft) {
    const raw = draft.is_pinned ?? draft.pinned ?? draft.pin;
    if (raw === 1 || raw === '1' || raw === 'true' || raw === '是' || raw === 'yes') return true;
    if (raw === 0 || raw === '0' || raw === 'false' || raw === '否' || raw === 'no') return false;
  }
  return null;
}

/** draft 里 id 可能被序列化成非 string，统一收成非空字符串。 */
function draftId(draft: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const v = draft[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  }
  return '';
}

function findMemoIdByTitle(
  memos: Array<{ id: string; title: string }>,
  title: string,
): string {
  const needle = title.trim().toLowerCase();
  if (!needle || looksLikeMemoId(needle)) return '';
  const exact = memos.find(m => m.title.trim().toLowerCase() === needle);
  if (exact?.id) return exact.id;
  const soft = memos.find(m => m.title.trim().toLowerCase().includes(needle));
  return soft?.id || '';
}

function draftNameList(draft: Record<string, unknown>, ...keys: string[]): string[] {
  for (const key of keys) {
    const raw = draft[key];
    if (Array.isArray(raw)) {
      return raw
        .filter((x): x is string => typeof x === 'string' && !!x.trim())
        .map(x => x.trim());
    }
    if (typeof raw === 'string' && raw.trim()) {
      return raw
        .split(/[,，、]/)
        .map(s => s.trim())
        .filter(Boolean);
    }
  }
  return [];
}

function draftIdList(draft: Record<string, unknown>, ...keys: string[]): string[] {
  for (const key of keys) {
    const raw = draft[key];
    if (Array.isArray(raw)) {
      return raw
        .map(x => (typeof x === 'string' ? x.trim() : String(x ?? '').trim()))
        .filter(Boolean);
    }
    if (typeof raw === 'string' && raw.trim()) {
      return raw
        .split(/[,，]/)
        .map(s => s.trim())
        .filter(Boolean);
    }
  }
  return [];
}

/** 解析标签：已有 id 优先；名称匹配或新建 memo 域标签 */
async function resolveMemoTagIds(draft: Record<string, unknown>): Promise<string[] | undefined> {
  const explicit = draftIdList(draft, 'tagIds', 'tag_ids');
  const names = draftNameList(draft, 'tag_names', 'tags', 'tag_name', 'new_tag_names');
  if (!explicit.length && !names.length) {
    // 草稿明确带了空标签字段 → 清空；未带则不改标签
    if ('tag_names' in draft || 'tags' in draft || 'tagIds' in draft || 'tag_ids' in draft) {
      return [];
    }
    return undefined;
  }

  const { makeTimestampEntityId } = await import('@/lib/entity-id');
  const { createTag, getTags } = await import('@/lib/repositories/tags/tag');
  const { DEFAULT_TAG_COLOR } = await import('@/lib/repositories/tags/tag.types');
  const existing = await getTags('memo');
  const byId = new Set(existing.map(t => t.id));
  const byName = new Map(existing.map(t => [t.name.trim().toLowerCase(), t.id]));
  const out: string[] = [];

  for (const id of explicit) {
    if (byId.has(id) && !out.includes(id)) out.push(id);
  }
  for (const name of names) {
    const key = name.toLowerCase();
    let id = byName.get(key);
    if (!id) {
      id = makeTimestampEntityId('tag_', 8);
      await createTag({
        id,
        name: name.slice(0, 40),
        color: DEFAULT_TAG_COLOR,
        description: null,
        weight: 0,
        domain: 'memo',
        extra_data: JSON.stringify({ source: 'assistant_chat_commit_memo' }),
      });
      byName.set(key, id);
      byId.add(id);
    }
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

/** 标题位误传实体 id /「备忘 #id」时识别，勿当标题去匹配。 */
function looksLikeMemoId(s: string): boolean {
  const t = s.trim();
  if (!t) return false;
  if (t.startsWith('备忘 #')) return true;
  const low = t.toLowerCase();
  if (low.startsWith('memo_') || low.startsWith('memo-')) return true;
  if (/\s/.test(t) || /[^\x00-\x7f]/.test(t)) return false;
  if (t.length >= 16 && /\d/.test(t) && /^[a-zA-Z0-9_-]+$/.test(t)) return true;
  return false;
}

function stripMemoIdLabel(s: string): string {
  const t = s.trim();
  return t.startsWith('备忘 #') ? t.slice('备忘 #'.length).trim() : t;
}

export async function commitMemo(draft: Record<string, unknown>): Promise<ChatCommitHandlerResult> {
  const pinFlag = wantsPin(draft);
  const existingId = draftId(draft, 'memo_id', 'id', 'memoId');
  const titleHint = draftString(draft, 'title');
  const locateTitleHint =
    draftString(draft, 'original_title') || draftString(draft, 'locate_title') || '';

  if (pinFlag !== null && !draftString(draft, 'body_plain') && !draftString(draft, 'body')) {
    const { setMemoPinned, listMemos } = await import('@/lib/memos');
    let memoId = existingId;
    // 旧卡/模型把 id 塞进 title 时，按 id 定位，勿用 id 字符串去匹配标题
    if (!memoId && titleHint && looksLikeMemoId(titleHint)) {
      memoId = stripMemoIdLabel(titleHint);
    }
    const titleNeedle =
      locateTitleHint || (titleHint && !looksLikeMemoId(titleHint) ? titleHint : '');

    const resolveByTitle = async (): Promise<string> => {
      if (!titleNeedle) return '';
      let memos = await listMemos();
      let hit = findMemoIdByTitle(memos, titleNeedle);
      if (hit) return hit;
      // 本地尚未灌库时，先拉 memo-list 拼盘再按标题匹配
      try {
        const { fetchProfileMemoList } = await import('@/lib/profile-page-api');
        await fetchProfileMemoList({ forceRefresh: true });
      } catch {
        /* 网络失败时仍用当前本地列表 */
      }
      memos = await listMemos();
      hit = findMemoIdByTitle(memos, titleNeedle);
      return hit;
    };

    if (!memoId && titleNeedle) {
      memoId = await resolveByTitle();
    }
    if (!memoId) {
      return fail('incomplete_draft', '置顶需要备忘 id 或可匹配的标题');
    }

    let updated = await setMemoPinned(memoId, pinFlag);
    // 本地尚未灌入该行：先拉 memo-list 再按同一 id 重试
    if (!updated) {
      try {
        const { fetchProfileMemoList } = await import('@/lib/profile-page-api');
        await fetchProfileMemoList({ forceRefresh: true });
      } catch {
        /* ignore */
      }
      updated = await setMemoPinned(memoId, pinFlag);
    }
    // Agent 带回的 memo_id 可能与本地不一致：用标题回退再试一次
    if (!updated && titleNeedle) {
      const byTitle = await resolveByTitle();
      if (byTitle && byTitle !== memoId) {
        updated = await setMemoPinned(byTitle, pinFlag);
      }
    }
    if (!updated) return fail('memo_missing', '找不到要置顶的备忘');
    return ok(
      updated.id,
      pinFlag ? `已置顶备忘「${updated.title.slice(0, 40)}」` : `已取消置顶「${updated.title.slice(0, 40)}」`,
    );
  }

  const titleRaw = titleHint;
  // 确认卡模板主键是 body_plain；用户改「正文」会写回 body_plain / body
  const body =
    draftString(draft, 'body_plain') ||
    draftString(draft, 'body') ||
    draftString(draft, 'content') ||
    '';
  if (!titleRaw && !body) {
    return fail('incomplete_draft', '备忘标题与正文不能都为空');
  }
  const title = titleRaw || '新备忘';
  const tagIds = await resolveMemoTagIds(draft);

  const { createMemo, updateMemo, listMemos } = await import('@/lib/memos');

  // 更新定位：只认 memo_id；缺 id 时才用「定位时标题」original_title/locate_title。
  // 禁止用可编辑的 title（用户改名后）反查，否则会找不到原备忘。
  const locateTitle =
    draftString(draft, 'original_title') ||
    draftString(draft, 'locate_title') ||
    '';
  let updateId = existingId;
  if (!updateId && titleHint && looksLikeMemoId(titleHint)) {
    updateId = stripMemoIdLabel(titleHint);
  }
  if (!updateId && locateTitle) {
    const memos = await listMemos();
    updateId = findMemoIdByTitle(memos, locateTitle);
  }

  if (updateId) {
    let updated = await updateMemo(updateId, {
      title: title.slice(0, 80) || '备忘',
      body,
      ...(tagIds !== undefined ? { tagIds } : {}),
      ...(pinFlag !== null ? { is_pinned: pinFlag } : {}),
    });
    if (!updated && locateTitle) {
      const memos = await listMemos();
      const byTitle = findMemoIdByTitle(memos, locateTitle);
      if (byTitle && byTitle !== updateId) {
        updated = await updateMemo(byTitle, {
          title: title.slice(0, 80) || '备忘',
          body,
          ...(tagIds !== undefined ? { tagIds } : {}),
          ...(pinFlag !== null ? { is_pinned: pinFlag } : {}),
        });
      }
    }
    if (!updated) {
      return fail('memo_missing', '找不到要更新的备忘，请改为新建或打开备忘页');
    }
    if (tagIds !== undefined) await requestPushPending();
    return ok(updated.id, `已更新备忘「${updated.title.slice(0, 40)}」`);
  }

  const item = await createMemo({
    title: title.slice(0, 80) || '新备忘',
    body,
    ...(tagIds !== undefined && tagIds.length ? { tagIds } : {}),
    ...(pinFlag !== null ? { is_pinned: pinFlag } : {}),
  });
  if (tagIds !== undefined && tagIds.length) await requestPushPending();
  return ok(item.id, `已保存备忘「${item.title.slice(0, 40)}」`);
}

async function resolveMemoRef(
  draft: Record<string, unknown>,
): Promise<{ id: string; title: string } | { error: string }> {
  let explicit = draftId(draft, 'memo_id', 'id', 'memoId');
  const titleHint = draftString(draft, 'title') || draftString(draft, 'name');
  if (!explicit && titleHint && looksLikeMemoId(titleHint)) {
    explicit = stripMemoIdLabel(titleHint);
  }
  if (!explicit && !titleHint) {
    return { error: '请指定要删除的备忘（id 或标题）' };
  }

  const { getMemo, listMemos } = await import('@/lib/memos');
  if (explicit) {
    const row = await getMemo(explicit);
    if (row) return { id: row.id, title: row.title };
  }

  if (titleHint && !looksLikeMemoId(titleHint)) {
    const memos = await listMemos();
    const byTitle = findMemoIdByTitle(memos, titleHint);
    if (byTitle) {
      const row = await getMemo(byTitle);
      if (row) return { id: row.id, title: row.title };
      return { id: byTitle, title: titleHint };
    }
  }

  if (explicit) return { error: '找不到该备忘' };
  return { error: `找不到备忘「${titleHint}」` };
}

export async function commitMemoDelete(
  draft: Record<string, unknown>,
): Promise<ChatCommitHandlerResult> {
  const ref = await resolveMemoRef(draft);
  if ('error' in ref) return fail('incomplete_draft', ref.error);

  const { deleteMemo } = await import('@/lib/memos');
  const deleted = await deleteMemo(ref.id);
  if (!deleted) return fail('memo_missing', '找不到要删除的备忘');
  await requestPushPending();
  return ok(ref.id, `已删除备忘「${ref.title.slice(0, 40)}」`);
}

export const memoCommitHandlers: Record<string, ChatCommitHandler> = {
  commit_memo: async input => commitMemo(input.draft),
  commit_memo_delete: async input => commitMemoDelete(input.draft),
};
