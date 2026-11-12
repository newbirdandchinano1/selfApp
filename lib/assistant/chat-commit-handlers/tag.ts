/**
 * S9.3 W3：commit_tag（动态 import）。
 */

import type { ChatCommitHandler, ChatCommitHandlerResult } from '@/lib/assistant/chat-commit';
import { draftString, fail, ok, requestPushPending } from './shared';

export async function commitTag(
  draft: Record<string, unknown>,
): Promise<ChatCommitHandlerResult> {
  const name = draftString(draft, 'name');
  const tagId =
    draftString(draft, 'tag_id') || draftString(draft, 'id');
  const entityType = draftString(draft, 'entity_type');
  const entityId = draftString(draft, 'entity_id');

  if (!tagId && !name) {
    return fail('incomplete_draft', '缺少标签名称');
  }

  const { makeTimestampEntityId } = await import('@/lib/entity-id');
  const { createTag, setEntityTagIds } = await import('@/lib/repositories/tags/tag');
  const { DEFAULT_TAG_COLOR } = await import('@/lib/repositories/tags/tag.types');

  if (entityType && entityType !== 'memo') {
    return fail('incomplete_draft', 'entity_type 仅支持 memo（任务侧标签已下线）');
  }

  let resolvedTagId = tagId;
  if (!resolvedTagId) {
    resolvedTagId = makeTimestampEntityId('tag_', 8);
    await createTag({
      id: resolvedTagId,
      name: name.slice(0, 40),
      color: draftString(draft, 'color') || DEFAULT_TAG_COLOR,
      description: draftString(draft, 'note') || null,
      domain: 'memo',
      extra_data: JSON.stringify({ source: 'assistant_chat_commit' }),
    });
  }

  if (entityType && entityId) {
    const extraIds = Array.isArray(draft.tag_ids)
      ? draft.tag_ids.filter((x): x is string => typeof x === 'string' && !!x.trim())
      : [];
    const ids = Array.from(new Set([resolvedTagId, ...extraIds]));
    await setEntityTagIds('memo', entityId, ids);
    await requestPushPending();
    return ok(resolvedTagId, `已为 memo 绑定标签`);
  }

  await requestPushPending();
  return ok(resolvedTagId, name ? `已创建标签「${name.slice(0, 40)}」` : '已保存标签');
}

export const tagCommitHandlers: Record<string, ChatCommitHandler> = {
  commit_tag: async input => commitTag(input.draft),
};
