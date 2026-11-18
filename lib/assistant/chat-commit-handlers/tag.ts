/**
 * S9.3 W3：commit_tag（动态 import）。
 */

import type { ChatCommitHandler, ChatCommitHandlerResult } from '@/lib/assistant/chat-commit';
import { draftString, fail, ok, requestPushPending } from './shared';

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
        .split(/[,，]/)
        .map(s => s.trim())
        .filter(Boolean);
    }
  }
  return [];
}

export async function commitTag(
  draft: Record<string, unknown>,
): Promise<ChatCommitHandlerResult> {
  const name = draftString(draft, 'name');
  const tagId =
    draftString(draft, 'tag_id') || draftString(draft, 'id');
  const entityType = draftString(draft, 'entity_type');
  const entityId = draftString(draft, 'entity_id');
  const newNames = draftNameList(draft, 'new_tag_names', 'newTagNames');

  if (!tagId && !name && !newNames.length) {
    return fail('incomplete_draft', '缺少标签名称');
  }

  const { makeTimestampEntityId } = await import('@/lib/entity-id');
  const { createTag, getTags, setEntityTagIds } = await import('@/lib/repositories/tags/tag');
  const { DEFAULT_TAG_COLOR } = await import('@/lib/repositories/tags/tag.types');

  if (entityType && entityType !== 'memo') {
    return fail('incomplete_draft', 'entity_type 仅支持 memo（任务侧标签已下线）');
  }

  const existing = await getTags('memo');
  const byName = new Map(existing.map(t => [t.name.trim().toLowerCase(), t.id]));
  const createdIds: string[] = [];

  async function ensureNamed(tagName: string): Promise<string> {
    const key = tagName.toLowerCase();
    const hit = byName.get(key);
    if (hit) return hit;
    const id = makeTimestampEntityId('tag_', 8);
    await createTag({
      id,
      name: tagName.slice(0, 40),
      color: draftString(draft, 'color') || DEFAULT_TAG_COLOR,
      description: draftString(draft, 'note') || null,
      domain: 'memo',
      extra_data: JSON.stringify({ source: 'assistant_chat_commit' }),
    });
    byName.set(key, id);
    createdIds.push(id);
    return id;
  }

  let resolvedTagId = tagId;
  if (!resolvedTagId && name) {
    resolvedTagId = await ensureNamed(name);
  }
  for (const n of newNames) {
    const id = await ensureNamed(n);
    if (!resolvedTagId) resolvedTagId = id;
  }
  if (!resolvedTagId) {
    return fail('incomplete_draft', '缺少标签名称');
  }

  if (entityType && entityId) {
    const extraIds = Array.isArray(draft.tag_ids)
      ? draft.tag_ids.filter((x): x is string => typeof x === 'string' && !!x.trim())
      : [];
    const ids = Array.from(new Set([resolvedTagId, ...extraIds, ...createdIds]));
    await setEntityTagIds('memo', entityId, ids);
    await requestPushPending();
    const label = name || newNames[0] || resolvedTagId;
    return ok(resolvedTagId, `已为备忘绑定标签「${label.slice(0, 40)}」`);
  }

  await requestPushPending();
  return ok(resolvedTagId, name ? `已创建标签「${name.slice(0, 40)}」` : '已保存标签');
}

export const tagCommitHandlers: Record<string, ChatCommitHandler> = {
  commit_tag: async input => commitTag(input.draft),
};
