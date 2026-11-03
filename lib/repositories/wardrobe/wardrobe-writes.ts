/**
 * 衣橱写路径：专用 API → 回写本地 SQLite。
 */
import {
  apiWardrobeCreateCategory,
  apiWardrobeCreateCloset,
  apiWardrobeCreateItem,
  apiWardrobeCreateOccasion,
  apiWardrobeCreateOption,
  apiWardrobeCreateOutfit,
  apiWardrobeDeleteCategory,
  apiWardrobeDeleteCloset,
  apiWardrobeDeleteItem,
  apiWardrobeDeleteOccasion,
  apiWardrobeDeleteOption,
  apiWardrobeDeleteOutfit,
  apiWardrobeGetOutfit,
  apiWardrobeItemWearHistory,
  apiWardrobeListClosets,
  apiWardrobeUpdateCategory,
  apiWardrobeUpdateCloset,
  apiWardrobeUpdateItem,
  apiWardrobeUpdateOccasion,
  apiWardrobeUpdateOutfit,
  apiWardrobeUpsertBodyProfile,
} from '@/lib/api/endpoints/wardrobe';
import { makeTimestampEntityId } from '@/lib/entity-id';
import { getDatabase } from '@/lib/database';
import { upsertPageRows } from '@/lib/page-api-fetch';
import {
  normalizeWardrobeRowForLocal,
  WARDROBE_DEFAULT_CLOSET_ID,
} from '@/lib/repositories/wardrobe/wardrobe';

function asRecord(row: unknown): Record<string, unknown> {
  if (row && typeof row === 'object') return row as Record<string, unknown>;
  return {};
}

function asRecordList(data: unknown): Record<string, unknown>[] {
  if (!Array.isArray(data)) return [];
  return data.map(asRecord);
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function upsert(table: string, row: unknown) {
  if (!row) return;
  await upsertPageRows(table, [normalizeWardrobeRowForLocal(table, asRecord(row))]);
}

async function upsertMany(table: string, rows: unknown[]) {
  if (!rows.length) return;
  await upsertPageRows(
    table,
    rows.map((r) => normalizeWardrobeRowForLocal(table, asRecord(r))),
  );
}

export type WardrobeWriteResult = { ok: boolean; id?: string; error?: string };

export type CreateWardrobeItemInput = {
  closet_id?: string;
  category_id: string;
  name: string;
  brand?: string;
  color?: string;
  season?: string;
  /** 元；内部转分 */
  price_yuan?: number | null;
  fit?: string;
  warmth?: string;
  sku_code?: string;
  art_key?: string;
  tint?: string;
  tint2?: string;
  line?: string;
  tags?: string[];
  image_uri?: string;
  cutout_uri?: string;
  purchased_on?: string | null;
  note?: string;
  /** 写入 extra_data.storage_location */
  storage_location?: string;
  /** 写入 extra_data.product_url */
  product_url?: string;
  /** 写入 extra_data.note_image_uri */
  note_image_uri?: string;
};

function buildItemExtraData(input: {
  storage_location?: string;
  product_url?: string;
  note_image_uri?: string;
}): Record<string, string> | null {
  const storage = input.storage_location?.trim() || '';
  const url = input.product_url?.trim() || '';
  const noteImg = input.note_image_uri?.trim() || '';
  if (!storage && !url && !noteImg) return null;
  return {
    ...(storage ? { storage_location: storage } : {}),
    ...(url ? { product_url: url } : {}),
    ...(noteImg ? { note_image_uri: noteImg } : {}),
  };
}

function yuanToCents(yuan: number | null | undefined): number | null {
  if (yuan == null || !Number.isFinite(yuan)) return null;
  return Math.round(yuan * 100);
}

const CATEGORY_ART: Record<string, string> = {
  未分类: 'hoodie',
  上衣: 'shirt',
  下装: 'pants',
  连衣裙: 'dress',
  外套: 'coat',
  运动装: 'hoodie',
  正装: 'suit',
  鞋履: 'sneaker',
  配饰: 'bag',
};

export async function createWardrobeItem(input: CreateWardrobeItemInput): Promise<WardrobeWriteResult> {
  const name = input.name.trim();
  if (!name) return { ok: false, error: '请填写单品名称' };
  if (!input.category_id.trim()) return { ok: false, error: '请选择分类' };
  const id = makeTimestampEntityId('witem_', 8);
  try {
    const row = await apiWardrobeCreateItem({
      id,
      closet_id: input.closet_id || WARDROBE_DEFAULT_CLOSET_ID,
      category_id: input.category_id,
      name,
      brand: input.brand?.trim() || null,
      color: input.color?.trim() || null,
      season: input.season?.trim() || null,
      price_cents: yuanToCents(input.price_yuan),
      currency: 'CNY',
      fit: input.fit?.trim() || null,
      warmth: input.warmth?.trim() || null,
      sku_code: input.sku_code?.trim() || null,
      art_key: input.art_key?.trim() || null,
      tint: input.tint?.trim() || null,
      tint2: input.tint2?.trim() || null,
      line: input.line?.trim() || null,
      tags_json: input.tags ?? [],
      image_uri: input.image_uri?.trim() || null,
      cutout_uri: input.cutout_uri?.trim() || null,
      purchased_on: input.purchased_on?.trim() || null,
      note: input.note?.trim() || null,
      extra_data: buildItemExtraData(input),
      status: 'active',
    });
    await upsert('wardrobe_items', row);
    return { ok: true, id: String(asRecord(row).id ?? id) };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

export async function updateWardrobeItem(
  id: string,
  input: Partial<CreateWardrobeItemInput>,
): Promise<WardrobeWriteResult> {
  const itemId = id.trim();
  if (!itemId) return { ok: false, error: '缺少单品 id' };
  try {
    const body: Record<string, unknown> = {};
    if (input.name != null) body.name = input.name.trim();
    if (input.category_id != null) body.category_id = input.category_id;
    if (input.brand != null) body.brand = input.brand.trim() || null;
    if (input.color != null) body.color = input.color.trim() || null;
    if (input.season != null) body.season = input.season.trim() || null;
    if (input.price_yuan !== undefined) body.price_cents = yuanToCents(input.price_yuan);
    if (input.fit != null) body.fit = input.fit.trim() || null;
    if (input.warmth != null) body.warmth = input.warmth.trim() || null;
    if (input.sku_code != null) body.sku_code = input.sku_code.trim() || null;
    if (input.art_key != null) body.art_key = input.art_key.trim() || null;
    if (input.tint != null) body.tint = input.tint.trim() || null;
    if (input.tint2 != null) body.tint2 = input.tint2.trim() || null;
    if (input.line != null) body.line = input.line.trim() || null;
    if (input.tags != null) body.tags_json = input.tags;
    if (input.image_uri != null) body.image_uri = input.image_uri.trim() || null;
    if (input.cutout_uri != null) body.cutout_uri = input.cutout_uri.trim() || null;
    if (input.purchased_on !== undefined) body.purchased_on = input.purchased_on?.trim() || null;
    if (input.note != null) body.note = input.note.trim() || null;
    if (
      input.storage_location !== undefined ||
      input.product_url !== undefined ||
      input.note_image_uri !== undefined
    ) {
      body.extra_data = buildItemExtraData({
        storage_location: input.storage_location,
        product_url: input.product_url,
        note_image_uri: input.note_image_uri,
      });
    }
    const row = await apiWardrobeUpdateItem(itemId, body, { method: 'PATCH' });
    await upsert('wardrobe_items', row);
    return { ok: true, id: itemId };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

export async function deleteWardrobeItem(id: string): Promise<WardrobeWriteResult> {
  const itemId = id.trim();
  if (!itemId) return { ok: false, error: '缺少单品 id' };
  try {
    await apiWardrobeDeleteItem(itemId);
    const db = await getDatabase();
    await db.runAsync(
      `UPDATE wardrobe_items SET sync_status = 'pending_delete', updated_at = datetime('now') WHERE id = ?`,
      [itemId],
    );
    await db.runAsync(
      `UPDATE wardrobe_outfit_items SET sync_status = 'pending_delete', updated_at = datetime('now') WHERE item_id = ?`,
      [itemId],
    );
    return { ok: true, id: itemId };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

export async function createWardrobeCategory(input: {
  closet_id?: string;
  name: string;
  tint?: string;
  tint2?: string;
  tone?: string;
}): Promise<WardrobeWriteResult> {
  const name = input.name.trim();
  if (!name) return { ok: false, error: '请填写分类名称' };
  const id = makeTimestampEntityId('wcat_', 8);
  try {
    const row = await apiWardrobeCreateCategory({
      id,
      closet_id: input.closet_id || WARDROBE_DEFAULT_CLOSET_ID,
      name,
      sort_order: 1000,
      tint: input.tint ?? '#DCE8E5',
      tint2: input.tint2 ?? '#C3D6D0',
      tone: input.tone ?? '#36584F',
    });
    await upsert('wardrobe_categories', row);
    return { ok: true, id: String(asRecord(row).id ?? id) };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

export async function renameWardrobeCategory(
  id: string,
  name: string,
): Promise<WardrobeWriteResult> {
  const catId = id.trim();
  const next = name.trim();
  if (!catId) return { ok: false, error: '缺少分类 id' };
  if (!next) return { ok: false, error: '请填写分类名称' };
  if (catId === 'wcat_uncategorized') return { ok: false, error: '「未分类」不可编辑' };
  try {
    const row = await apiWardrobeUpdateCategory(catId, { name: next });
    await upsert('wardrobe_categories', row);
    return { ok: true, id: catId };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

export async function deleteWardrobeCategory(id: string): Promise<WardrobeWriteResult> {
  const catId = id.trim();
  if (!catId) return { ok: false, error: '缺少分类 id' };
  if (catId === 'wcat_uncategorized') return { ok: false, error: '「未分类」不可编辑' };
  try {
    await apiWardrobeDeleteCategory(catId);
    const db = await getDatabase();
    await db.runAsync(
      `UPDATE wardrobe_categories SET sync_status = 'pending_delete', updated_at = datetime('now') WHERE id = ?`,
      [catId],
    );
    return { ok: true, id: catId };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

export async function createWardrobeOutfit(input: {
  closet_id?: string;
  name: string;
  occasion_id?: string | null;
  note?: string;
  item_ids: string[];
  extra_data?: Record<string, unknown> | null;
}): Promise<WardrobeWriteResult> {
  const name = input.name.trim();
  if (!name) return { ok: false, error: '请填写搭配名称' };
  if (!input.item_ids.length) return { ok: false, error: '请至少选择一件单品' };
  const id = makeTimestampEntityId('wout_', 8);
  try {
    const row = await apiWardrobeCreateOutfit({
      id,
      closet_id: input.closet_id || WARDROBE_DEFAULT_CLOSET_ID,
      name,
      occasion_id: input.occasion_id || null,
      note: input.note?.trim() || null,
      item_ids: input.item_ids,
      status: 'active',
      extra_data: input.extra_data ?? null,
    });
    await upsert('wardrobe_outfits', row);
    const detail = await apiWardrobeGetOutfit(String(asRecord(row).id ?? id));
    await upsertMany('wardrobe_outfit_items', asRecordList(detail.outfit_items));
    return { ok: true, id: String(asRecord(row).id ?? id) };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

export async function updateWardrobeOutfit(
  id: string,
  input: {
    name?: string;
    occasion_id?: string | null;
    note?: string;
    item_ids?: string[];
    extra_data?: Record<string, unknown> | null;
  },
): Promise<WardrobeWriteResult> {
  const outfitId = id.trim();
  if (!outfitId) return { ok: false, error: '缺少搭配 id' };
  try {
    const body: Record<string, unknown> = {};
    if (input.name != null) body.name = input.name.trim();
    if (input.occasion_id !== undefined) body.occasion_id = input.occasion_id;
    if (input.note != null) body.note = input.note.trim() || null;
    if (input.item_ids) body.item_ids = input.item_ids;
    if (input.extra_data !== undefined) body.extra_data = input.extra_data;
    const row = await apiWardrobeUpdateOutfit(outfitId, body, { method: 'PATCH' });
    await upsert('wardrobe_outfits', row);
    const detail = await apiWardrobeGetOutfit(outfitId);
    const links = asRecordList(detail.outfit_items);
    const db = await getDatabase();
    await db.runAsync(
      `UPDATE wardrobe_outfit_items SET sync_status = 'pending_delete', updated_at = datetime('now') WHERE outfit_id = ?`,
      [outfitId],
    );
    await upsertMany('wardrobe_outfit_items', links);
    return { ok: true, id: outfitId };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

export async function deleteWardrobeOutfit(id: string): Promise<WardrobeWriteResult> {
  const outfitId = id.trim();
  if (!outfitId) return { ok: false, error: '缺少搭配 id' };
  try {
    await apiWardrobeDeleteOutfit(outfitId);
    const db = await getDatabase();
    await db.runAsync(
      `UPDATE wardrobe_outfits SET sync_status = 'pending_delete', updated_at = datetime('now') WHERE id = ?`,
      [outfitId],
    );
    await db.runAsync(
      `UPDATE wardrobe_outfit_items SET sync_status = 'pending_delete', updated_at = datetime('now') WHERE outfit_id = ?`,
      [outfitId],
    );
    return { ok: true, id: outfitId };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

export async function createWardrobeOccasion(name: string): Promise<WardrobeWriteResult> {
  const n = name.trim();
  if (!n) return { ok: false, error: '请填写场合名称' };
  const id = makeTimestampEntityId('wocc_', 8);
  try {
    const row = await apiWardrobeCreateOccasion({ id, name: n, sort_order: 1000 });
    await upsert('wardrobe_occasions', row);
    return { ok: true, id: String(asRecord(row).id ?? id) };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

export async function renameWardrobeOccasion(id: string, name: string): Promise<WardrobeWriteResult> {
  const occId = id.trim();
  const n = name.trim();
  if (!occId) return { ok: false, error: '缺少场合 id' };
  if (!n) return { ok: false, error: '请填写场合名称' };
  try {
    const row = await apiWardrobeUpdateOccasion(occId, { name: n });
    await upsert('wardrobe_occasions', row);
    return { ok: true, id: occId };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

export async function deleteWardrobeOccasion(id: string): Promise<WardrobeWriteResult> {
  const occId = id.trim();
  if (!occId) return { ok: false, error: '缺少场合 id' };
  try {
    await apiWardrobeDeleteOccasion(occId);
    const db = await getDatabase();
    await db.runAsync(
      `UPDATE wardrobe_occasions SET sync_status = 'pending_delete', updated_at = datetime('now') WHERE id = ?`,
      [occId],
    );
    return { ok: true, id: occId };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

export async function createWardrobeCloset(name: string): Promise<WardrobeWriteResult> {
  const n = name.trim();
  if (!n) return { ok: false, error: '请填写衣橱名称' };
  const id = makeTimestampEntityId('wcl_', 8);
  try {
    const row = await apiWardrobeCreateCloset({
      id,
      name: n,
      sort_order: 1000,
      is_default: 0,
    });
    await upsert('wardrobe_closets', row);
    return { ok: true, id: String(asRecord(row).id ?? id) };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

export async function setDefaultWardrobeCloset(id: string): Promise<WardrobeWriteResult> {
  const closetId = id.trim();
  if (!closetId) return { ok: false, error: '缺少衣橱 id' };
  try {
    const row = await apiWardrobeUpdateCloset(closetId, { is_default: 1 });
    await upsert('wardrobe_closets', row);
    try {
      const list = await apiWardrobeListClosets();
      await upsertMany('wardrobe_closets', asRecordList(list));
    } catch {
      /* ignore */
    }
    return { ok: true, id: closetId };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

export async function deleteWardrobeCloset(id: string): Promise<WardrobeWriteResult> {
  const closetId = id.trim();
  if (!closetId) return { ok: false, error: '缺少衣橱 id' };
  try {
    await apiWardrobeDeleteCloset(closetId);
    const db = await getDatabase();
    await db.runAsync(
      `UPDATE wardrobe_closets SET sync_status = 'pending_delete', updated_at = datetime('now') WHERE id = ?`,
      [closetId],
    );
    return { ok: true, id: closetId };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

export async function createWardrobeOption(input: {
  closet_id?: string | null;
  kind: 'color' | 'brand' | 'season' | 'fit';
  value: string;
}): Promise<WardrobeWriteResult> {
  const value = input.value.trim();
  if (!value) return { ok: false, error: '请填写词条' };
  const id = makeTimestampEntityId('wopt_', 8);
  try {
    const row = await apiWardrobeCreateOption({
      id,
      closet_id: input.closet_id ?? null,
      kind: input.kind,
      value,
      sort_order: 1000,
    });
    await upsert('wardrobe_option_values', row);
    return { ok: true, id: String(asRecord(row).id ?? id) };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

export async function deleteWardrobeOption(id: string): Promise<WardrobeWriteResult> {
  const optId = id.trim();
  if (!optId) return { ok: false, error: '缺少选项 id' };
  try {
    await apiWardrobeDeleteOption(optId);
    const db = await getDatabase();
    await db.runAsync(
      `UPDATE wardrobe_option_values SET sync_status = 'pending_delete', updated_at = datetime('now') WHERE id = ?`,
      [optId],
    );
    return { ok: true, id: optId };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

export type BodyProfileInput = {
  closet_id?: string | null;
  height_cm?: number | null;
  weight_kg?: number | null;
  shoulder_cm?: number | null;
  bust_cm?: number | null;
  waist_cm?: number | null;
  hip_cm?: number | null;
  inseam_cm?: number | null;
  foot_mm?: number | null;
  size_top?: string | null;
  size_bottom?: string | null;
  size_shoe?: string | null;
  note?: string | null;
};

export async function saveWardrobeBodyProfile(input: BodyProfileInput): Promise<WardrobeWriteResult> {
  try {
    const row = await apiWardrobeUpsertBodyProfile({
      closet_id: input.closet_id ?? null,
      height_cm: input.height_cm ?? null,
      weight_kg: input.weight_kg ?? null,
      shoulder_cm: input.shoulder_cm ?? null,
      bust_cm: input.bust_cm ?? null,
      waist_cm: input.waist_cm ?? null,
      hip_cm: input.hip_cm ?? null,
      inseam_cm: input.inseam_cm ?? null,
      foot_mm: input.foot_mm ?? null,
      size_top: input.size_top ?? null,
      size_bottom: input.size_bottom ?? null,
      size_shoe: input.size_shoe ?? null,
      note: input.note ?? null,
    });
    await upsert('wardrobe_body_profile', row);
    return { ok: true, id: String(asRecord(row).id ?? '') };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

export async function resolveCategoryIdByName(
  closetId: string,
  name: string,
): Promise<string | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ id: string }>(
    `SELECT id FROM wardrobe_categories
     WHERE closet_id = ? AND name = ? AND sync_status != 'pending_delete' LIMIT 1`,
    [closetId, name.trim()],
  );
  return row?.id ?? null;
}

export async function listLocalCategoryMeta(closetId: string): Promise<
  { id: string; name: string; is_builtin: number; tint: string | null; tint2: string | null; tone: string | null }[]
> {
  const db = await getDatabase();
  return (
    (await db.getAllAsync(
      `SELECT id, name, is_builtin, tint, tint2, tone FROM wardrobe_categories
       WHERE closet_id = ? AND sync_status != 'pending_delete'
       ORDER BY sort_order ASC, name ASC`,
      [closetId],
    )) ?? []
  );
}

export async function listLocalOccasionMeta(): Promise<{ id: string; name: string; is_builtin: number }[]> {
  const db = await getDatabase();
  return (
    (await db.getAllAsync(
      `SELECT id, name, is_builtin FROM wardrobe_occasions
       WHERE sync_status != 'pending_delete'
       ORDER BY sort_order ASC, name ASC`,
    )) ?? []
  );
}

export async function listLocalClosetMeta(): Promise<
  { id: string; name: string; is_default: number; created_at: string | null; item_count: number }[]
> {
  const db = await getDatabase();
  const rows =
    (await db.getAllAsync<{
      id: string;
      name: string;
      is_default: number;
      created_at: string | null;
      item_count: number | null;
    }>(
      `SELECT c.id, c.name, c.is_default, c.created_at,
              (SELECT COUNT(*) FROM wardrobe_items i
               WHERE i.closet_id = c.id
                 AND i.status = 'active'
                 AND i.sync_status != 'pending_delete') AS item_count
       FROM wardrobe_closets c
       WHERE c.sync_status != 'pending_delete'
       ORDER BY c.is_default DESC, c.sort_order ASC, c.name ASC`,
    )) ?? [];
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    is_default: r.is_default,
    created_at: r.created_at ?? null,
    item_count: Math.max(0, Math.floor(Number(r.item_count) || 0)),
  }));
}

export async function listLocalOptions(kind?: string): Promise<
  { id: string; kind: string; value: string }[]
> {
  const db = await getDatabase();
  if (kind) {
    return (
      (await db.getAllAsync(
        `SELECT id, kind, value FROM wardrobe_option_values
         WHERE kind = ? AND sync_status != 'pending_delete'
         ORDER BY sort_order ASC, value ASC`,
        [kind],
      )) ?? []
    );
  }
  return (
    (await db.getAllAsync(
      `SELECT id, kind, value FROM wardrobe_option_values
       WHERE sync_status != 'pending_delete'
       ORDER BY kind ASC, sort_order ASC, value ASC`,
    )) ?? []
  );
}

export async function loadLocalBodyProfile(closetId?: string): Promise<Record<string, unknown> | null> {
  const db = await getDatabase();
  if (closetId) {
    const byCloset = await db.getFirstAsync<Record<string, unknown>>(
      `SELECT * FROM wardrobe_body_profile
       WHERE closet_id = ? AND sync_status != 'pending_delete' LIMIT 1`,
      [closetId],
    );
    if (byCloset) return byCloset;
  }
  return (
    (await db.getFirstAsync<Record<string, unknown>>(
      `SELECT * FROM wardrobe_body_profile
       WHERE sync_status != 'pending_delete'
       ORDER BY updated_at DESC LIMIT 1`,
    )) ?? null
  );
}

export async function fetchItemWearHistory28(itemId: string): Promise<boolean[]> {
  try {
    const data = await apiWardrobeItemWearHistory(itemId);
    if (Array.isArray(data.sequence)) {
      return data.sequence.map(Boolean);
    }
  } catch {
    /* fall through to local */
  }
  const db = await getDatabase();
  const end = new Date();
  const dates: string[] = [];
  for (let i = 27; i >= 0; i -= 1) {
    const d = new Date(end);
    d.setDate(end.getDate() - i);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    dates.push(`${y}-${m}-${day}`);
  }
  const start = dates[0];
  const rows =
    (await db.getAllAsync<{ worn_on: string }>(
      `SELECT worn_on FROM wardrobe_wear_logs
       WHERE item_id = ? AND source = 'item'
         AND worn_on >= ? AND worn_on <= ?
         AND sync_status != 'pending_delete'`,
      [itemId, start, dates[dates.length - 1]],
    )) ?? [];
  const worn = new Set(rows.map((r) => r.worn_on));
  return dates.map((ymd) => worn.has(ymd));
}

export function defaultArtKeyForCategoryName(name: string): string {
  return CATEGORY_ART[name] ?? 'hoodie';
}
