/**
 * S9.3 W2：commit_wardrobe_item（动态 import）。
 */

import type { ChatCommitHandler, ChatCommitHandlerResult } from '@/lib/assistant/chat-commit';
import { draftNumber, draftString, fail, ok } from './shared';

async function resolveWardrobeCategoryId(
  closetId: string,
  hint: string,
): Promise<{ id: string } | { error: string }> {
  const {
    resolveCategoryIdByName,
    listLocalCategoryMeta,
    createWardrobeCategory,
  } = await import('@/lib/repositories/wardrobe/wardrobe-writes');

  const needle = hint.trim();
  if (needle) {
    const exact = await resolveCategoryIdByName(closetId, needle);
    if (exact) return { id: exact };
    const meta = await listLocalCategoryMeta(closetId);
    const lower = needle.toLowerCase();
    const fuzzy = meta.find(c => c.name.trim().toLowerCase().includes(lower));
    if (fuzzy) return { id: fuzzy.id };
    const created = await createWardrobeCategory({ closet_id: closetId, name: needle.slice(0, 40) });
    if (created.ok && created.id) return { id: created.id };
  }

  const meta = await listLocalCategoryMeta(closetId);
  const uncategorized =
    meta.find(c => c.name.trim() === '未分类') ??
    meta.find(c => c.id === 'wcat_uncategorized') ??
    meta[0];
  if (uncategorized) return { id: uncategorized.id };

  const created = await createWardrobeCategory({ closet_id: closetId, name: '未分类' });
  if (created.ok && created.id) return { id: created.id };
  return { error: created.error || '无法解析衣橱分类，请先在衣橱页添加分类' };
}

export async function commitWardrobeItem(
  draft: Record<string, unknown>,
): Promise<ChatCommitHandlerResult> {
  const name =
    draftString(draft, 'name') ||
    draftString(draft, 'title') ||
    draftString(draft, 'item_name');
  if (!name) {
    return fail('incomplete_draft', '缺少单品名称');
  }

  const { WARDROBE_DEFAULT_CLOSET_ID } = await import('@/lib/repositories/wardrobe/wardrobe');
  const { createWardrobeItem, updateWardrobeItem } = await import(
    '@/lib/repositories/wardrobe/wardrobe-writes'
  );

  const closetId =
    draftString(draft, 'closet_id') || WARDROBE_DEFAULT_CLOSET_ID;
  const categoryHint =
    draftString(draft, 'category_hint') ||
    draftString(draft, 'category_name') ||
    draftString(draft, 'category');
  const categoryIdExplicit = draftString(draft, 'category_id');
  const categoryResolved = categoryIdExplicit
    ? { id: categoryIdExplicit }
    : await resolveWardrobeCategoryId(closetId, categoryHint);
  if ('error' in categoryResolved) {
    return fail('category_missing', categoryResolved.error);
  }

  const existingId =
    draftString(draft, 'item_id') ||
    draftString(draft, 'id') ||
    draftString(draft, 'itemId');

  const payload = {
    closet_id: closetId,
    category_id: categoryResolved.id,
    name: name.slice(0, 80),
    brand: draftString(draft, 'brand') || undefined,
    color: draftString(draft, 'color') || undefined,
    season: draftString(draft, 'season') || undefined,
    price_yuan: draftNumber(draft, 'price_yuan') ?? draftNumber(draft, 'price'),
    fit: draftString(draft, 'fit') || undefined,
    warmth: draftString(draft, 'warmth') || undefined,
    note: draftString(draft, 'note') || undefined,
    image_uri:
      draftString(draft, 'image_uri') ||
      draftString(draft, 'source_image_uri') ||
      undefined,
    art_key: draftString(draft, 'art_key') || undefined,
    tags: Array.isArray(draft.tags)
      ? draft.tags.filter((t): t is string => typeof t === 'string' && !!t.trim()).slice(0, 20)
      : undefined,
  };

  if (existingId) {
    const updated = await updateWardrobeItem(existingId, payload);
    if (!updated.ok) {
      return fail('wardrobe_write_failed', updated.error || '更新单品失败');
    }
    return ok(updated.id || existingId, `已更新单品「${name.slice(0, 40)}」`);
  }

  const created = await createWardrobeItem(payload);
  if (!created.ok || !created.id) {
    return fail('wardrobe_write_failed', created.error || '创建单品失败');
  }
  return ok(created.id, `已保存单品「${name.slice(0, 40)}」`);
}

async function resolveMetaIdByName(
  kind: string,
  nameHint: string,
): Promise<string | null> {
  const needle = nameHint.trim().toLowerCase();
  if (!needle) return null;
  const writes = await import('@/lib/repositories/wardrobe/wardrobe-writes');
  if (kind === 'occasion') {
    const rows = await writes.listLocalOccasionMeta();
    const hit =
      rows.find(r => r.name.trim().toLowerCase() === needle) ||
      rows.find(r => r.name.trim().toLowerCase().includes(needle));
    return hit?.id || null;
  }
  const { WARDROBE_DEFAULT_CLOSET_ID } = await import(
    '@/lib/repositories/wardrobe/wardrobe'
  );
  const meta = await writes.listLocalCategoryMeta(WARDROBE_DEFAULT_CLOSET_ID);
  const hit =
    meta.find(c => c.name.trim().toLowerCase() === needle) ||
    meta.find(c => c.name.trim().toLowerCase().includes(needle));
  return hit?.id || null;
}

export async function commitWardrobeMeta(
  draft: Record<string, unknown>,
): Promise<ChatCommitHandlerResult> {
  const action = (
    draftString(draft, 'action') ||
    draftString(draft, 'meta_action') ||
    'create'
  ).toLowerCase();
  const kind = (draftString(draft, 'kind') || draftString(draft, 'meta_kind') || 'category').toLowerCase();
  const metaId = draftString(draft, 'meta_id') || draftString(draft, 'id');
  const name = draftString(draft, 'name');
  const newName = draftString(draft, 'new_name');

  if (kind === 'closet' || action === 'set_default') {
    return fail('unsupported_action', '助手不支持新建/切换/删除衣橱，请在衣橱页操作');
  }

  const writes = await import('@/lib/repositories/wardrobe/wardrobe-writes');

  if (action === 'rename') {
    if (!newName) return fail('incomplete_draft', '缺少新名称');
    if (!metaId && !name) return fail('incomplete_draft', '缺少要重命名的目标');
    let id = metaId;
    if (!id && name) {
      id = (await resolveMetaIdByName(kind, name)) || '';
    }
    if (!id) return fail('incomplete_draft', '缺少目标 id');
    if (kind === 'occasion') {
      const r = await writes.renameWardrobeOccasion(id, newName.slice(0, 40));
      if (!r.ok) return fail('wardrobe_write_failed', r.error || '重命名场合失败');
      return ok(id, `已将场合重命名为「${newName.slice(0, 40)}」`);
    }
    const r = await writes.renameWardrobeCategory(id, newName.slice(0, 40));
    if (!r.ok) return fail('wardrobe_write_failed', r.error || '重命名分类失败');
    return ok(id, `已将分类重命名为「${newName.slice(0, 40)}」`);
  }

  if (action === 'delete') {
    let id = metaId;
    if (!id && name) {
      id = (await resolveMetaIdByName(kind, name)) || '';
    }
    if (!id) return fail('incomplete_draft', '缺少要删除的目标 id');
    if (kind === 'occasion') {
      const r = await writes.deleteWardrobeOccasion(id);
      if (!r.ok) return fail('wardrobe_write_failed', r.error || '删除场合失败');
      return ok(id, `已删除场合「${(name || id).slice(0, 40)}」`);
    }
    const r = await writes.deleteWardrobeCategory(id);
    if (!r.ok) return fail('wardrobe_write_failed', r.error || '删除分类失败');
    return ok(id, `已删除分类「${(name || id).slice(0, 40)}」`);
  }

  if (!name) return fail('incomplete_draft', '缺少名称');
  if (kind === 'occasion') {
    const r = await writes.createWardrobeOccasion(name.slice(0, 40));
    if (!r.ok || !r.id) return fail('wardrobe_write_failed', r.error || '创建场合失败');
    return ok(r.id, `已创建场合「${name.slice(0, 40)}」`);
  }
  const r = await writes.createWardrobeCategory({ name: name.slice(0, 40) });
  if (!r.ok || !r.id) return fail('wardrobe_write_failed', r.error || '创建分类失败');
  return ok(r.id, `已创建衣橱分类「${name.slice(0, 40)}」`);
}

export async function commitWardrobeItemDelete(
  draft: Record<string, unknown>,
): Promise<ChatCommitHandlerResult> {
  let itemId =
    draftString(draft, 'item_id') || draftString(draft, 'id') || draftString(draft, 'itemId');
  const itemName = draftString(draft, 'item_name') || draftString(draft, 'name');
  if (!itemId && itemName) {
    const { loadWardrobeScreenData } = await import('@/lib/repositories/wardrobe/wardrobe');
    const data = await loadWardrobeScreenData();
    const needle = itemName.toLowerCase();
    const hit =
      data.items.find(i => i.name.trim().toLowerCase() === needle) ||
      data.items.find(i => i.name.trim().toLowerCase().includes(needle));
    itemId = hit?.id || '';
  }
  if (!itemId) return fail('incomplete_draft', '请指定要删除的单品');
  const { deleteWardrobeItem } = await import('@/lib/repositories/wardrobe/wardrobe-writes');
  const r = await deleteWardrobeItem(itemId);
  if (!r.ok) return fail('wardrobe_write_failed', r.error || '删除单品失败');
  return ok(itemId, `已删除单品「${(itemName || itemId).slice(0, 40)}」`);
}

export async function commitWardrobeOption(
  draft: Record<string, unknown>,
): Promise<ChatCommitHandlerResult> {
  const action = (draftString(draft, 'action') || 'create').toLowerCase();
  const {
    createWardrobeOption,
    deleteWardrobeOption,
  } = await import('@/lib/repositories/wardrobe/wardrobe-writes');

  if (action === 'delete') {
    let optionId = draftString(draft, 'option_id') || draftString(draft, 'id');
    const kind = draftString(draft, 'kind');
    const value = draftString(draft, 'value');
    if (!optionId && (kind || value)) {
      const rows = await (await import('@/lib/repositories/wardrobe/wardrobe-writes')).listLocalOptions(
        kind || undefined,
      );
      const hit = rows.find(o => {
        if (kind && o.kind !== kind) return false;
        if (value && o.value.trim().toLowerCase() !== value.toLowerCase()) return false;
        return Boolean(kind || value);
      });
      optionId = hit?.id || '';
    }
    if (!optionId) return fail('incomplete_draft', '请指定选项 id 或 kind+value');
    const r = await deleteWardrobeOption(optionId);
    if (!r.ok) return fail('wardrobe_write_failed', r.error || '删除选项失败');
    return ok(optionId, `已删除选项「${(value || optionId).slice(0, 40)}」`);
  }

  const kind = (draftString(draft, 'kind') || 'color').toLowerCase();
  const value = draftString(draft, 'value') || draftString(draft, 'name');
  if (!value) return fail('incomplete_draft', '缺少词条');
  if (!['color', 'brand', 'season', 'fit'].includes(kind)) {
    return fail('incomplete_draft', 'kind 须为 color/brand/season/fit');
  }
  const r = await createWardrobeOption({
    kind: kind as 'color' | 'brand' | 'season' | 'fit',
    value: value.slice(0, 40),
  });
  if (!r.ok || !r.id) return fail('wardrobe_write_failed', r.error || '创建选项失败');
  return ok(r.id, `已添加${kind}词条「${value.slice(0, 40)}」`);
}

export async function commitWardrobeBody(
  draft: Record<string, unknown>,
): Promise<ChatCommitHandlerResult> {
  const height = draftNumber(draft, 'height_cm') ?? draftNumber(draft, 'height');
  const weight = draftNumber(draft, 'weight_kg') ?? draftNumber(draft, 'weight');
  const meas =
    draft.measurements && typeof draft.measurements === 'object'
      ? (draft.measurements as Record<string, unknown>)
      : {};
  const note = draftString(draft, 'note') || draftString(draft, 'body_type') || null;

  if (
    height == null &&
    weight == null &&
    !Object.keys(meas).length &&
    !note
  ) {
    return fail('incomplete_draft', '请至少提供身高、体重或其它身材字段');
  }

  const { saveWardrobeBodyProfile } = await import(
    '@/lib/repositories/wardrobe/wardrobe-writes'
  );
  const num = (v: unknown) =>
    typeof v === 'number' && Number.isFinite(v) ? v : null;
  const result = await saveWardrobeBodyProfile({
    height_cm: height,
    weight_kg: weight,
    shoulder_cm: num(meas.shoulder_cm),
    bust_cm: num(meas.bust_cm),
    waist_cm: num(meas.waist_cm),
    hip_cm: num(meas.hip_cm),
    inseam_cm: num(meas.inseam_cm),
    foot_mm: num(meas.foot_mm),
    size_top: typeof meas.size_top === 'string' ? meas.size_top : null,
    size_bottom: typeof meas.size_bottom === 'string' ? meas.size_bottom : null,
    size_shoe: typeof meas.size_shoe === 'string' ? meas.size_shoe : null,
    note,
  });
  if (!result.ok) return fail('wardrobe_write_failed', result.error || '保存身材档案失败');
  return ok(result.id || 'body_profile', '已保存身材档案');
}

export const wardrobeCommitHandlers: Record<string, ChatCommitHandler> = {
  commit_wardrobe_item: async input => commitWardrobeItem(input.draft),
  commit_wardrobe_meta: async input => commitWardrobeMeta(input.draft),
  commit_wardrobe_body: async input => commitWardrobeBody(input.draft),
  commit_wardrobe_item_delete: async input => commitWardrobeItemDelete(input.draft),
  commit_wardrobe_option: async input => commitWardrobeOption(input.draft),
};
