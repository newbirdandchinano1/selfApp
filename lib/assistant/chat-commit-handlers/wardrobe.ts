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

export async function commitWardrobeOutfit(
  draft: Record<string, unknown>,
): Promise<ChatCommitHandlerResult> {
  const existingId =
    draftString(draft, 'outfit_id') || draftString(draft, 'id') || draftString(draft, 'outfitId');
  const name = draftString(draft, 'name') || draftString(draft, 'title');
  const itemIds = Array.isArray(draft.item_ids)
    ? draft.item_ids.filter((x): x is string => typeof x === 'string' && !!x.trim()).map(s => s.trim())
    : [];

  if (!existingId) {
    if (!name) return fail('incomplete_draft', '缺少搭配名称');
    if (!itemIds.length) return fail('incomplete_draft', '请至少提供一件搭配单品');
  }

  const { createWardrobeOutfit, updateWardrobeOutfit } = await import(
    '@/lib/repositories/wardrobe/wardrobe-writes'
  );

  if (existingId) {
    const updated = await updateWardrobeOutfit(existingId, {
      ...(name ? { name: name.slice(0, 80) } : {}),
      ...(itemIds.length ? { item_ids: itemIds } : {}),
      note: draftString(draft, 'note') || undefined,
      occasion_id: draftString(draft, 'occasion_id') || undefined,
    });
    if (!updated.ok) return fail('wardrobe_write_failed', updated.error || '更新搭配失败');
    return ok(updated.id || existingId, `已更新搭配「${(name || existingId).slice(0, 40)}」`);
  }

  const created = await createWardrobeOutfit({
    name: name.slice(0, 80),
    item_ids: itemIds,
    note: draftString(draft, 'note') || undefined,
    occasion_id: draftString(draft, 'occasion_id') || undefined,
  });
  if (!created.ok || !created.id) {
    return fail('wardrobe_write_failed', created.error || '创建搭配失败');
  }
  return ok(created.id, `已保存搭配「${name.slice(0, 40)}」`);
}

export async function commitWardrobeWear(
  draft: Record<string, unknown>,
): Promise<ChatCommitHandlerResult> {
  const kind = (
    draftString(draft, 'subject_kind') ||
    draftString(draft, 'kind') ||
    (draftString(draft, 'outfit_id') || draftString(draft, 'outfit_name') ? 'outfit' : 'item')
  ).toLowerCase();
  const note = draftString(draft, 'note') || undefined;

  if (kind === 'outfit') {
    let outfitId =
      draftString(draft, 'outfit_id') || draftString(draft, 'id') || draftString(draft, 'outfitId');
    const outfitName = draftString(draft, 'outfit_name') || draftString(draft, 'name');
    if (!outfitId && !outfitName) {
      return fail('incomplete_draft', '请指定搭配 id 或名称');
    }
    const { recordWardrobeOutfitWear, loadWardrobeScreenData } = await import(
      '@/lib/repositories/wardrobe/wardrobe'
    );
    if (!outfitId && outfitName) {
      const data = await loadWardrobeScreenData();
      const needle = outfitName.toLowerCase();
      const hit =
        data.outfits.find(o => o.name.trim().toLowerCase() === needle) ||
        data.outfits.find(o => o.name.trim().toLowerCase().includes(needle));
      outfitId = hit?.id || '';
    }
    if (!outfitId) return fail('incomplete_draft', '请指定搭配 id 或名称');
    const result = await recordWardrobeOutfitWear(outfitId, { note });
    if (!result.ok) return fail('wardrobe_write_failed', result.error || '记录搭配穿着失败');
    return ok(outfitId, '已记录搭配穿着');
  }

  let itemId =
    draftString(draft, 'item_id') || draftString(draft, 'id') || draftString(draft, 'itemId');
  const itemName = draftString(draft, 'item_name') || draftString(draft, 'name');
  if (!itemId && !itemName) {
    return fail('incomplete_draft', '请指定单品 id 或名称');
  }
  const { recordWardrobeItemWear, loadWardrobeScreenData } = await import(
    '@/lib/repositories/wardrobe/wardrobe'
  );
  if (!itemId && itemName) {
    const data = await loadWardrobeScreenData();
    const needle = itemName.toLowerCase();
    const hit =
      data.items.find(i => i.name.trim().toLowerCase() === needle) ||
      data.items.find(i => i.name.trim().toLowerCase().includes(needle));
    itemId = hit?.id || '';
  }
  if (!itemId) return fail('incomplete_draft', '请指定单品 id 或名称');
  const result = await recordWardrobeItemWear(itemId, { note });
  if (!result.ok) return fail('wardrobe_write_failed', result.error || '记录单品穿着失败');
  return ok(itemId, `已记录「${(result.item?.name || itemName || itemId).slice(0, 40)}」穿着`);
}

export async function commitWardrobeMeta(
  draft: Record<string, unknown>,
): Promise<ChatCommitHandlerResult> {
  const name = draftString(draft, 'name');
  if (!name) return fail('incomplete_draft', '缺少名称');
  const kind = (draftString(draft, 'kind') || draftString(draft, 'meta_kind') || 'category').toLowerCase();
  const {
    createWardrobeCategory,
    createWardrobeOccasion,
    createWardrobeCloset,
  } = await import('@/lib/repositories/wardrobe/wardrobe-writes');

  if (kind === 'occasion') {
    const r = await createWardrobeOccasion(name.slice(0, 40));
    if (!r.ok || !r.id) return fail('wardrobe_write_failed', r.error || '创建场合失败');
    return ok(r.id, `已创建场合「${name.slice(0, 40)}」`);
  }
  if (kind === 'closet') {
    const r = await createWardrobeCloset(name.slice(0, 40));
    if (!r.ok || !r.id) return fail('wardrobe_write_failed', r.error || '创建衣柜失败');
    return ok(r.id, `已创建衣柜「${name.slice(0, 40)}」`);
  }
  const r = await createWardrobeCategory({ name: name.slice(0, 40) });
  if (!r.ok || !r.id) return fail('wardrobe_write_failed', r.error || '创建分类失败');
  return ok(r.id, `已创建衣橱分类「${name.slice(0, 40)}」`);
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
  commit_wardrobe_outfit: async input => commitWardrobeOutfit(input.draft),
  commit_wardrobe_wear: async input => commitWardrobeWear(input.draft),
  commit_wardrobe_meta: async input => commitWardrobeMeta(input.draft),
  commit_wardrobe_body: async input => commitWardrobeBody(input.draft),
};
