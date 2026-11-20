/**
 * S9.3 W3：commit_tag / commit_tag_delete（动态 import）。
 * 覆盖：新建、改名/改色/权重、备忘绑定、删除标签。
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

function draftNumber(draft: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const raw = draft[key];
    if (typeof raw === 'number' && Number.isFinite(raw)) return Math.round(raw);
    if (typeof raw === 'string' && raw.trim()) {
      const n = Number(raw.trim());
      if (Number.isFinite(n)) return Math.round(n);
    }
  }
  return undefined;
}

function isDeleteAction(draft: Record<string, unknown>): boolean {
  const action = draftString(draft, 'action').toLowerCase();
  return action === 'delete' || action === 'remove';
}

async function resolveMemoTagId(
  draft: Record<string, unknown>,
): Promise<{ id: string; name: string } | { error: string }> {
  const tagId = draftString(draft, 'tag_id') || draftString(draft, 'id');
  const nameHint =
    draftString(draft, 'old_name') ||
    draftString(draft, 'tag_name') ||
    draftString(draft, 'name');
  const { getTags } = await import('@/lib/repositories/tags/tag');
  const existing = await getTags('memo');

  if (tagId) {
    const hit = existing.find(t => t.id === tagId);
    if (hit) return { id: hit.id, name: hit.name };
    // Agent 偶发把中文名塞进 tag_id
    const byName = existing.find(
      t => t.name.trim().toLowerCase() === tagId.trim().toLowerCase(),
    );
    if (byName) return { id: byName.id, name: byName.name };
  }
  if (nameHint) {
    const needle = nameHint.trim().toLowerCase();
    const hit = existing.find(t => t.name.trim().toLowerCase() === needle);
    if (hit) return { id: hit.id, name: hit.name };
  }
  return { error: '找不到要操作的备忘标签' };
}

export async function commitTag(
  draft: Record<string, unknown>,
): Promise<ChatCommitHandlerResult> {
  if (isDeleteAction(draft)) {
    return commitTagDelete(draft);
  }

  const name = draftString(draft, 'name');
  const tagId = draftString(draft, 'tag_id') || draftString(draft, 'id');
  const entityType = draftString(draft, 'entity_type');
  const entityId = draftString(draft, 'entity_id');
  const newNames = draftNameList(draft, 'new_tag_names', 'newTagNames');
  const action = draftString(draft, 'action').toLowerCase();
  const color = draftString(draft, 'color');
  const note = draftString(draft, 'note') || draftString(draft, 'description');
  const weight = draftNumber(draft, 'weight');
  const wantsUpdate =
    action === 'update' ||
    Boolean(tagId && (name || color || note || weight !== undefined));

  if (entityType && entityType !== 'memo') {
    return fail('incomplete_draft', 'entity_type 仅支持 memo（任务侧标签已下线）');
  }

  const { makeTimestampEntityId } = await import('@/lib/entity-id');
  const { createTag, getTags, setEntityTagIds, updateTag, isTagNameDuplicate } =
    await import('@/lib/repositories/tags/tag');
  const { DEFAULT_TAG_COLOR } = await import('@/lib/repositories/tags/tag.types');

  // —— 更新已有标签（改名 / 色 / 权重 / 简介）——
  if (wantsUpdate && tagId && !entityId) {
    const resolved = await resolveMemoTagId(draft);
    if ('error' in resolved) return fail('tag_missing', resolved.error);
    if (name) {
      const dup = await isTagNameDuplicate(name, resolved.id, 'memo');
      if (dup) return fail('duplicate_name', `标签名「${name.slice(0, 40)}」已存在`);
    }
    const patch: {
      name?: string;
      color?: string;
      description?: string | null;
      weight?: number;
      domain: 'memo';
    } = { domain: 'memo' };
    if (name) patch.name = name.slice(0, 40);
    if (color) patch.color = color;
    if ('note' in draft || 'description' in draft) patch.description = note || null;
    if (weight !== undefined) patch.weight = weight;
    await updateTag(resolved.id, patch);
    await requestPushPending();
    const label = name || resolved.name;
    return ok(resolved.id, `已更新标签「${label.slice(0, 40)}」`);
  }

  if (!tagId && !name && !newNames.length) {
    return fail('incomplete_draft', '缺少标签名称');
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
      color: color || DEFAULT_TAG_COLOR,
      description: note || null,
      weight: weight ?? 0,
      domain: 'memo',
      extra_data: JSON.stringify({ source: 'assistant_chat_commit' }),
    });
    byName.set(key, id);
    createdIds.push(id);
    return id;
  }

  let resolvedTagId = tagId;
  if (resolvedTagId) {
    const hit = existing.find(t => t.id === resolvedTagId);
    if (!hit) {
      // 名称误作 id
      const byN = byName.get(resolvedTagId.trim().toLowerCase());
      if (byN) resolvedTagId = byN;
    }
  }
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

export async function commitTagDelete(
  draft: Record<string, unknown>,
): Promise<ChatCommitHandlerResult> {
  const resolved = await resolveMemoTagId(draft);
  if ('error' in resolved) return fail('tag_missing', resolved.error);

  const { deleteTag } = await import('@/lib/repositories/tags/tag');
  await deleteTag(resolved.id);
  await requestPushPending();
  return ok(resolved.id, `已删除标签「${resolved.name.slice(0, 40)}」`);
}

export const tagCommitHandlers: Record<string, ChatCommitHandler> = {
  commit_tag: async input => commitTag(input.draft),
  commit_tag_delete: async input => commitTagDelete(input.draft),
};
