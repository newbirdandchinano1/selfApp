/**
 * 衣橱本地仓库：SQLite 镜像 + bootstrap 灌库 + UI 映射。
 * 写入走专用 /api/app/wardrobe/*；穿着计数以 wear_logs 为准。
 */
import { parseOutfitCollage } from '@/components/wardrobe/collage-model';
import {
  CLOSET_ORDER,
  type WardrobeArt,
  type WardrobeCategory,
  type WardrobeItem,
  type WardrobeOutfit,
} from '@/components/wardrobe/data';
import {
  apiWardrobeBootstrap,
  apiWardrobeGetOutfit,
  apiWardrobeListItems,
  apiWardrobeListOutfits,
  apiWardrobeWearItem,
  apiWardrobeWearOutfit,
  apiWardrobeWearWeek,
} from '@/lib/api/endpoints/wardrobe';
import { addDaysToYmd, formatYmd, parseYmd } from '@/lib/date';
import { upsertPageRows } from '@/lib/page-api-fetch';
import { getDatabase } from '@/lib/database';

const ART_KEYS = new Set<WardrobeArt>([
  'hoodie',
  'knit',
  'shirt',
  'pants',
  'jeans',
  'skirt',
  'coat',
  'jacket',
  'dress',
  'suit',
  'sneaker',
  'bag',
]);

const DEFAULT_TINT = '#DCE8E5';
const DEFAULT_TINT2 = '#C3D6D0';
const DEFAULT_LINE = '#36584F';

export const WARDROBE_DEFAULT_CLOSET_ID = 'wcloset_default';

type ItemRow = {
  id: string;
  closet_id: string;
  category_id: string;
  name: string;
  brand: string | null;
  color: string | null;
  season: string | null;
  price_cents: number | null;
  currency: string | null;
  fit: string | null;
  warmth: string | null;
  sku_code: string | null;
  art_key: string | null;
  tint: string | null;
  tint2: string | null;
  line: string | null;
  tags_json: string | null;
  image_uri: string | null;
  cutout_uri: string | null;
  purchased_on: string | null;
  status: string;
  wear_count: number | null;
  last_worn_on: string | null;
  note: string | null;
  extra_data: string | null;
  created_at: string;
  updated_at: string;
};

type CategoryRow = {
  id: string;
  closet_id: string;
  name: string;
  sort_order: number | null;
  tint: string | null;
  tint2: string | null;
  tone: string | null;
  is_builtin: number | null;
};

type OutfitRow = {
  id: string;
  closet_id: string;
  name: string;
  occasion_id: string | null;
  note: string | null;
  wear_count: number | null;
  last_worn_on: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  extra_data: string | null;
};

type OccasionRow = {
  id: string;
  name: string;
  sort_order: number | null;
};

type OutfitItemRow = {
  outfit_id: string;
  item_id: string;
  sort_order: number | null;
};

function asRecord(row: unknown): Record<string, unknown> {
  if (row && typeof row === 'object') return row as Record<string, unknown>;
  return {};
}

function asRecordList(data: unknown): Record<string, unknown>[] {
  if (!Array.isArray(data)) return [];
  return data.map(asRecord);
}

function normalizeJsonText(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

/** 服务端行灌入本地前：JSON 字段统一成字符串 */
export function normalizeWardrobeRowForLocal(
  table: string,
  row: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...row };
  if (table === 'wardrobe_items') {
    if ('tags_json' in out) out.tags_json = normalizeJsonText(out.tags_json);
    if ('extra_data' in out) out.extra_data = normalizeJsonText(out.extra_data);
  }
  if (
    table === 'wardrobe_closets' ||
    table === 'wardrobe_categories' ||
    table === 'wardrobe_occasions' ||
    table === 'wardrobe_outfits' ||
    table === 'wardrobe_outfit_items' ||
    table === 'wardrobe_wear_logs' ||
    table === 'wardrobe_option_values' ||
    table === 'wardrobe_body_profile'
  ) {
    if ('extra_data' in out) out.extra_data = normalizeJsonText(out.extra_data);
  }
  delete out.version;
  delete out.deleted_at;
  delete out.category;
  delete out.occasion;
  delete out.outfit_items;
  delete out.items;
  delete out.wear_history_28d;
  return out;
}

function parseTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) return [];
    return v.map((x) => String(x ?? '').trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function parseItemExtra(raw: string | null | undefined): {
  storage_location?: string;
  product_url?: string;
  note_image_uri?: string;
} {
  if (!raw) return {};
  try {
    const v = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Record<string, unknown>;
    if (!v || typeof v !== 'object') return {};
    const storage = String(v.storage_location ?? '').trim();
    const url = String(v.product_url ?? '').trim();
    const noteImg = String(v.note_image_uri ?? '').trim();
    return {
      ...(storage ? { storage_location: storage } : {}),
      ...(url ? { product_url: url } : {}),
      ...(noteImg ? { note_image_uri: noteImg } : {}),
    };
  } catch {
    return {};
  }
}

function formatPriceCents(cents: number | null | undefined, currency = 'CNY'): string {
  if (cents == null || !Number.isFinite(Number(cents))) return '—';
  const yuan = Math.round(Number(cents)) / 100;
  const text = yuan.toLocaleString('zh-CN', {
    minimumFractionDigits: Number.isInteger(yuan) ? 0 : 2,
    maximumFractionDigits: 2,
  });
  if (currency === 'CNY' || !currency) return `¥ ${text}`;
  return `${currency} ${text}`;
}

function formatSeasonDisplay(season: string | null | undefined): string {
  if (!season) return '四季';
  const s = season.trim();
  if (!s) return '四季';
  if (s.includes(' / ')) return s;
  return s.replace(/\//g, ' / ').replace(/\s+\/\s+/g, ' / ');
}

function formatPurchasedDate(raw: string | null | undefined, fallback: string): string {
  const s = (raw ?? fallback ?? '').trim();
  if (!s) return '';
  const ymd = s.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd.replace(/-/g, '.');
  return s;
}

function formatOutfitDate(updatedAt: string, lastWornOn: string | null): string {
  const src = (lastWornOn || updatedAt || '').trim();
  const ymd = src.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
    const [, m, d] = ymd.split('-');
    return `${Number(m)}.${d}`;
  }
  return '—';
}

function resolveArt(artKey: string | null | undefined, categoryName: string): WardrobeArt {
  const key = String(artKey ?? '').trim() as WardrobeArt;
  if (ART_KEYS.has(key)) return key;
  const map: Record<string, WardrobeArt> = {
    上衣: 'shirt',
    下装: 'pants',
    连衣裙: 'dress',
    外套: 'coat',
    运动装: 'hoodie',
    正装: 'suit',
    鞋履: 'sneaker',
    配饰: 'bag',
    未分类: 'hoodie',
  };
  return map[categoryName] ?? 'hoodie';
}

function mapItemToUi(row: ItemRow, categoryName: string): WardrobeItem {
  const extra = parseItemExtra(row.extra_data);
  const purchasedOn = (row.purchased_on ?? '').trim().slice(0, 10);
  return {
    id: row.id,
    name: row.name || '未命名',
    category: categoryName || '未分类',
    price: formatPriceCents(row.price_cents, row.currency ?? 'CNY'),
    season: formatSeasonDisplay(row.season),
    color: row.color?.trim() || '—',
    brand: row.brand?.trim() || '—',
    wear: Math.max(0, Math.floor(Number(row.wear_count) || 0)),
    warmth: row.warmth?.trim() || '—',
    code: row.sku_code?.trim() || '—',
    fit: row.fit?.trim() || '—',
    art: resolveArt(row.art_key, categoryName),
    tint: row.tint?.trim() || DEFAULT_TINT,
    tint2: row.tint2?.trim() || DEFAULT_TINT2,
    line: row.line?.trim() || DEFAULT_LINE,
    tags: parseTags(row.tags_json),
    date: formatPurchasedDate(row.purchased_on, row.created_at),
    image_uri: row.image_uri?.trim() || undefined,
    cutout_uri: row.cutout_uri?.trim() || undefined,
    purchased_on: /^\d{4}-\d{2}-\d{2}$/.test(purchasedOn) ? purchasedOn : undefined,
    note: row.note?.trim() || undefined,
    storage_location: extra.storage_location,
    product_url: extra.product_url,
    note_image_uri: extra.note_image_uri,
  };
}

export type WardrobeScreenData = {
  closetId: string;
  items: WardrobeItem[];
  categories: WardrobeCategory[];
  outfits: WardrobeOutfit[];
  occasionNames: string[];
  itemCount: number;
  outfitCount: number;
};

export type WardrobeWearDay = {
  ymd: string;
  worn: boolean;
};

/** 对齐 GET /wardrobe/wear/week；prevWornDays 用于「比上周」文案 */
export type WardrobeWearWeek = {
  closetId: string;
  anchor: string;
  weekStart: string;
  weekEnd: string;
  days: WardrobeWearDay[];
  wornDaysThisWeek: number;
  streakDays: number;
  prevWornDays: number;
};

/** 本地日历周一（与后端 mondayOf 一致，不用任务逻辑日） */
function mondayOfYmd(ymd: string): string {
  const d = parseYmd(ymd);
  if (!d) return ymd;
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return formatYmd(d);
}

function emptyWearWeek(closetId: string, anchor: string): WardrobeWearWeek {
  const weekStart = mondayOfYmd(anchor);
  const days: WardrobeWearDay[] = Array.from({ length: 7 }, (_, i) => ({
    ymd: addDaysToYmd(weekStart, i),
    worn: false,
  }));
  return {
    closetId,
    anchor,
    weekStart,
    weekEnd: addDaysToYmd(weekStart, 6),
    days,
    wornDaysThisWeek: 0,
    streakDays: 0,
    prevWornDays: 0,
  };
}

function parseWearWeekPayload(
  raw: Record<string, unknown> | null | undefined,
  fallbackClosetId: string,
  prevWornDays = 0,
): WardrobeWearWeek | null {
  if (!raw) return null;
  const anchor = String(raw.anchor ?? '').trim() || formatYmd(new Date());
  const closetId = String(raw.closet_id ?? fallbackClosetId).trim() || fallbackClosetId;
  const weekStart =
    String(raw.week_start ?? '').trim() || mondayOfYmd(anchor);
  const weekEnd = String(raw.week_end ?? '').trim() || addDaysToYmd(weekStart, 6);
  const rawDays = Array.isArray(raw.days) ? raw.days : [];
  const days: WardrobeWearDay[] = Array.from({ length: 7 }, (_, i) => {
    const row = rawDays[i] as Record<string, unknown> | undefined;
    const ymd =
      (row && String(row.ymd ?? '').trim()) || addDaysToYmd(weekStart, i);
    return { ymd, worn: Boolean(row?.worn) };
  });
  const wornDaysThisWeek = Number.isFinite(Number(raw.worn_days_this_week))
    ? Math.max(0, Math.floor(Number(raw.worn_days_this_week)))
    : days.filter((d) => d.worn).length;
  const streakDays = Number.isFinite(Number(raw.streak_days))
    ? Math.max(0, Math.floor(Number(raw.streak_days)))
    : 0;
  return {
    closetId,
    anchor,
    weekStart,
    weekEnd,
    days,
    wornDaysThisWeek,
    streakDays,
    prevWornDays,
  };
}

async function countWornDaysLocal(
  db: NonNullable<Awaited<ReturnType<typeof getDatabase>>>,
  closetId: string,
  startYmd: string,
  endYmd: string,
): Promise<number> {
  const rows =
    (await db.getAllAsync<{ worn_on: string }>(
      `SELECT DISTINCT worn_on FROM wardrobe_wear_logs
       WHERE closet_id = ?
         AND worn_on >= ? AND worn_on <= ?
         AND sync_status != 'pending_delete'`,
      [closetId, startYmd, endYmd],
    )) ?? [];
  return rows.length;
}

async function loadLocalWearWeek(
  closetId: string,
  anchorRaw?: string,
): Promise<WardrobeWearWeek> {
  const anchor = (anchorRaw ?? formatYmd(new Date())).trim() || formatYmd(new Date());
  const base = emptyWearWeek(closetId, anchor);
  const db = await getDatabase();
  if (!db) return base;

  const weekRows =
    (await db.getAllAsync<{ worn_on: string }>(
      `SELECT DISTINCT worn_on FROM wardrobe_wear_logs
       WHERE closet_id = ?
         AND worn_on >= ? AND worn_on <= ?
         AND sync_status != 'pending_delete'`,
      [closetId, base.weekStart, base.weekEnd],
    )) ?? [];
  const wornSet = new Set(weekRows.map((r) => String(r.worn_on).slice(0, 10)));
  const days = base.days.map((d) => ({ ...d, worn: wornSet.has(d.ymd) }));
  const wornDaysThisWeek = days.filter((d) => d.worn).length;

  const prevStart = addDaysToYmd(base.weekStart, -7);
  const prevEnd = addDaysToYmd(base.weekStart, -1);
  const prevWornDays = await countWornDaysLocal(db, closetId, prevStart, prevEnd);

  const today = formatYmd(new Date());
  let streakDays = 0;
  let cursor = today;
  for (let i = 0; i < 400; i += 1) {
    const hit = await db.getFirstAsync<{ ok: number }>(
      `SELECT 1 AS ok FROM wardrobe_wear_logs
       WHERE closet_id = ? AND worn_on = ? AND sync_status != 'pending_delete'
       LIMIT 1`,
      [closetId, cursor],
    );
    if (!hit) break;
    streakDays += 1;
    cursor = addDaysToYmd(cursor, -1);
  }

  return {
    ...base,
    days,
    wornDaysThisWeek,
    streakDays,
    prevWornDays,
  };
}

export type WardrobeMineWearExtras = {
  /** 本月有穿着日志的不重复单品数 */
  wornThisMonth: number;
  /** 近 8 日每日穿着日志条数（旧→新），供迷你柱图 */
  sparkDayCounts: number[];
};

/** 「我的」页穿着补充：本月穿过件数 + 近 8 日柱图，读本地 wear_logs */
export async function loadWardrobeMineWearExtras(
  closetId: string,
): Promise<WardrobeMineWearExtras> {
  const empty: WardrobeMineWearExtras = {
    wornThisMonth: 0,
    sparkDayCounts: Array.from({ length: 8 }, () => 0),
  };
  const db = await getDatabase();
  if (!db) return empty;

  const today = formatYmd(new Date());
  const todayDate = parseYmd(today) ?? new Date();
  const monthStart = `${todayDate.getFullYear()}-${String(todayDate.getMonth() + 1).padStart(2, '0')}-01`;

  const monthRow = await db.getFirstAsync<{ c: number }>(
    `SELECT COUNT(DISTINCT item_id) AS c FROM wardrobe_wear_logs
     WHERE closet_id = ?
       AND item_id IS NOT NULL AND TRIM(item_id) != ''
       AND worn_on >= ? AND worn_on <= ?
       AND sync_status != 'pending_delete'`,
    [closetId, monthStart, today],
  );

  const sparkStart = addDaysToYmd(today, -7);
  const sparkRows =
    (await db.getAllAsync<{ worn_on: string; c: number }>(
      `SELECT worn_on, COUNT(*) AS c FROM wardrobe_wear_logs
       WHERE closet_id = ?
         AND worn_on >= ? AND worn_on <= ?
         AND sync_status != 'pending_delete'
       GROUP BY worn_on`,
      [closetId, sparkStart, today],
    )) ?? [];
  const byDay = new Map(sparkRows.map((r) => [String(r.worn_on).slice(0, 10), Number(r.c) || 0]));
  const sparkDayCounts = Array.from({ length: 8 }, (_, i) => {
    const ymd = addDaysToYmd(sparkStart, i);
    return byDay.get(ymd) ?? 0;
  });

  return {
    wornThisMonth: Math.max(0, Math.floor(Number(monthRow?.c) || 0)),
    sparkDayCounts,
  };
}

/** 拉本周穿搭周历；失败回退本地 wear_logs */
export async function fetchWardrobeWearWeek(opts?: {
  closet_id?: string;
  anchor?: string;
  signal?: AbortSignal;
}): Promise<WardrobeWearWeek> {
  const closetId = opts?.closet_id?.trim() || WARDROBE_DEFAULT_CLOSET_ID;
  const anchor = opts?.anchor?.trim() || formatYmd(new Date());
  try {
    const payload = await apiWardrobeWearWeek({
      closet_id: closetId,
      anchor,
      signal: opts?.signal,
    });
    const parsed = parseWearWeekPayload(asRecord(payload), closetId);
    if (!parsed) return loadLocalWearWeek(closetId, anchor);

    let prevWornDays = 0;
    try {
      const prevAnchor = addDaysToYmd(parsed.weekStart, -1);
      const prevPayload = await apiWardrobeWearWeek({
        closet_id: parsed.closetId,
        anchor: prevAnchor,
        signal: opts?.signal,
      });
      const prev = parseWearWeekPayload(asRecord(prevPayload), parsed.closetId);
      prevWornDays = prev?.wornDaysThisWeek ?? 0;
    } catch {
      const local = await loadLocalWearWeek(parsed.closetId, anchor);
      prevWornDays = local.prevWornDays;
    }
    return { ...parsed, prevWornDays };
  } catch (e) {
    if (__DEV__) console.warn('[wardrobe] wear/week failed, use local', e);
    return loadLocalWearWeek(closetId, anchor);
  }
}

async function readActiveClosetId(db: Awaited<ReturnType<typeof getDatabase>>): Promise<string> {
  const def = await db.getFirstAsync<{ id: string }>(
    `SELECT id FROM wardrobe_closets
     WHERE is_default = 1 AND sync_status != 'pending_delete'
     ORDER BY sort_order ASC, created_at ASC LIMIT 1`,
  );
  if (def?.id) return def.id;
  const any = await db.getFirstAsync<{ id: string }>(
    `SELECT id FROM wardrobe_closets
     WHERE sync_status != 'pending_delete'
     ORDER BY sort_order ASC, created_at ASC LIMIT 1`,
  );
  return any?.id ?? WARDROBE_DEFAULT_CLOSET_ID;
}

/** 从本地 SQLite 组装衣橱页数据（无演示灌库） */
export async function loadWardrobeScreenData(closetIdRaw?: string): Promise<WardrobeScreenData> {
  const db = await getDatabase();
  if (!db) {
    return {
      closetId: WARDROBE_DEFAULT_CLOSET_ID,
      items: [],
      categories: [],
      outfits: [],
      occasionNames: ['全部'],
      itemCount: 0,
      outfitCount: 0,
    };
  }

  const closetId = closetIdRaw?.trim() || (await readActiveClosetId(db));

  const categoryRows =
    (await db.getAllAsync<CategoryRow>(
      `SELECT id, closet_id, name, sort_order, tint, tint2, tone, is_builtin
       FROM wardrobe_categories
       WHERE closet_id = ? AND sync_status != 'pending_delete'
       ORDER BY sort_order ASC, name ASC`,
      [closetId],
    )) ?? [];

  const catNameById = new Map(categoryRows.map((c) => [c.id, c.name]));

  const itemRows =
    (await db.getAllAsync<ItemRow>(
      `SELECT *
       FROM wardrobe_items
       WHERE closet_id = ? AND status = 'active' AND sync_status != 'pending_delete'
       ORDER BY updated_at DESC, created_at DESC`,
      [closetId],
    )) ?? [];

  const items = itemRows.map((row) =>
    mapItemToUi(row, catNameById.get(row.category_id) ?? '未分类'),
  );

  const idsByCategory = new Map<string, string[]>();
  for (const row of itemRows) {
    const list = idsByCategory.get(row.category_id) ?? [];
    list.push(row.id);
    idsByCategory.set(row.category_id, list);
  }

  const categories: WardrobeCategory[] = categoryRows
    .slice()
    .sort((a, b) => {
      const ai = CLOSET_ORDER.indexOf(a.name as (typeof CLOSET_ORDER)[number]);
      const bi = CLOSET_ORDER.indexOf(b.name as (typeof CLOSET_ORDER)[number]);
      const aOrd = ai >= 0 ? ai : 999;
      const bOrd = bi >= 0 ? bi : 999;
      if (aOrd !== bOrd) return aOrd - bOrd;
      return (a.sort_order ?? 0) - (b.sort_order ?? 0);
    })
    .map((c) => ({
      name: c.name,
      ids: idsByCategory.get(c.id) ?? [],
      tint: c.tint?.trim() || DEFAULT_TINT,
      tint2: c.tint2?.trim() || DEFAULT_TINT2,
      tone: c.tone?.trim() || DEFAULT_LINE,
    }));

  const occasionRows =
    (await db.getAllAsync<OccasionRow>(
      `SELECT id, name, sort_order FROM wardrobe_occasions
       WHERE sync_status != 'pending_delete'
       ORDER BY sort_order ASC, name ASC`,
    )) ?? [];
  const occasionNameById = new Map(occasionRows.map((o) => [o.id, o.name]));

  const outfitRows =
    (await db.getAllAsync<OutfitRow>(
      `SELECT * FROM wardrobe_outfits
       WHERE closet_id = ? AND status = 'active' AND sync_status != 'pending_delete'
       ORDER BY updated_at DESC, created_at DESC`,
      [closetId],
    )) ?? [];

  const linkRows =
    (await db.getAllAsync<OutfitItemRow>(
      `SELECT outfit_id, item_id, sort_order FROM wardrobe_outfit_items
       WHERE sync_status != 'pending_delete'
       ORDER BY sort_order ASC, created_at ASC`,
    )) ?? [];
  const linksByOutfit = new Map<string, string[]>();
  for (const link of linkRows) {
    const list = linksByOutfit.get(link.outfit_id) ?? [];
    list.push(link.item_id);
    linksByOutfit.set(link.outfit_id, list);
  }

  const outfits: WardrobeOutfit[] = outfitRows.map((o) => {
    let extra: unknown = null;
    if (o.extra_data) {
      try {
        extra = typeof o.extra_data === 'string' ? JSON.parse(o.extra_data) : o.extra_data;
      } catch {
        extra = null;
      }
    }
    return {
      id: o.id,
      name: o.name || '未命名搭配',
      occasion: (o.occasion_id && occasionNameById.get(o.occasion_id)) || '休闲',
      date: formatOutfitDate(o.updated_at, o.last_worn_on),
      wear: Math.max(0, Math.floor(Number(o.wear_count) || 0)),
      items: linksByOutfit.get(o.id) ?? [],
      note: o.note?.trim() || '',
      collage: parseOutfitCollage(extra),
    };
  });

  return {
    closetId,
    items,
    categories,
    outfits,
    occasionNames: ['全部', ...occasionRows.map((o) => o.name)],
    itemCount: items.length,
    outfitCount: outfits.length,
  };
}

async function hydrateOutfitLinks(
  outfits: Record<string, unknown>[],
  signal?: AbortSignal,
): Promise<Record<string, unknown>[]> {
  const links: Record<string, unknown>[] = [];
  for (const outfit of outfits) {
    const id = String(outfit.id ?? '').trim();
    if (!id) continue;
    try {
      const detail = await apiWardrobeGetOutfit(id, { signal });
      const outfitItems = asRecordList(detail.outfit_items);
      for (const row of outfitItems) {
        links.push(normalizeWardrobeRowForLocal('wardrobe_outfit_items', row));
      }
    } catch {
      /* 单条失败不阻断首屏 */
    }
  }
  return links;
}

/** 拉 bootstrap（+ 搭配关联）并灌本地；失败时仍可读本地缓存 */
export async function fetchAndCacheWardrobe(opts?: {
  closet_id?: string;
  signal?: AbortSignal;
}): Promise<{ fromApi: boolean; closetId: string; wearWeek: WardrobeWearWeek | null }> {
  try {
    const payload = await apiWardrobeBootstrap({
      closet_id: opts?.closet_id,
      signal: opts?.signal,
    });
    const closet = payload.closet ? asRecord(payload.closet) : null;
    const closetId =
      String(closet?.id ?? opts?.closet_id ?? '').trim() || WARDROBE_DEFAULT_CLOSET_ID;
    const wearWeek = parseWearWeekPayload(
      payload.wear_week ? asRecord(payload.wear_week) : null,
      closetId,
    );

    const outfitsRaw = asRecordList(payload.outfits);
    let fullOutfits = outfitsRaw;
    try {
      const listed = await apiWardrobeListOutfits({
        closet_id: closetId,
        status: 'active',
        signal: opts?.signal,
      });
      if (Array.isArray(listed) && listed.length > 0) {
        fullOutfits = asRecordList(listed);
      }
    } catch {
      /* bootstrap 子集可暂用 */
    }

    const linkRows = await hydrateOutfitLinks(fullOutfits.slice(0, 40), opts?.signal);

    await Promise.all([
      closet
        ? upsertPageRows('wardrobe_closets', [
            normalizeWardrobeRowForLocal('wardrobe_closets', closet),
          ])
        : Promise.resolve(),
      upsertPageRows(
        'wardrobe_categories',
        asRecordList(payload.categories).map((r) =>
          normalizeWardrobeRowForLocal('wardrobe_categories', r),
        ),
      ),
      upsertPageRows(
        'wardrobe_occasions',
        asRecordList(payload.occasions).map((r) =>
          normalizeWardrobeRowForLocal('wardrobe_occasions', r),
        ),
      ),
      upsertPageRows(
        'wardrobe_items',
        asRecordList(payload.items).map((r) => normalizeWardrobeRowForLocal('wardrobe_items', r)),
      ),
      upsertPageRows(
        'wardrobe_outfits',
        fullOutfits.map((r) => normalizeWardrobeRowForLocal('wardrobe_outfits', r)),
      ),
      upsertPageRows('wardrobe_outfit_items', linkRows, { reconcileSnapshot: false }),
      upsertPageRows(
        'wardrobe_option_values',
        asRecordList(payload.options).map((r) =>
          normalizeWardrobeRowForLocal('wardrobe_option_values', r),
        ),
      ),
      payload.body_profile
        ? upsertPageRows('wardrobe_body_profile', [
            normalizeWardrobeRowForLocal('wardrobe_body_profile', asRecord(payload.body_profile)),
          ])
        : Promise.resolve(),
    ]);

    return { fromApi: true, closetId, wearWeek };
  } catch (e) {
    if (__DEV__) console.warn('[wardrobe] bootstrap failed, use local', e);
    const db = await getDatabase();
    const closetId = opts?.closet_id?.trim() || (db ? await readActiveClosetId(db) : WARDROBE_DEFAULT_CLOSET_ID);
    return { fromApi: false, closetId, wearWeek: null };
  }
}

async function upsertLocalSyncedRow(table: string, row: Record<string, unknown> | null | undefined) {
  if (!row) return;
  await upsertPageRows(table, [normalizeWardrobeRowForLocal(table, asRecord(row))]);
}

/** 穿单品：专用接口 + 回写本地计数 / 日志 */
export async function recordWardrobeItemWear(
  itemId: string,
  opts?: { note?: string },
): Promise<{
  ok: boolean;
  created: boolean;
  item?: WardrobeItem;
  error?: string;
}> {
  const id = itemId.trim();
  if (!id) return { ok: false, created: false, error: '缺少单品 id' };
  try {
    const note = opts?.note?.trim() || undefined;
    const res = await apiWardrobeWearItem({ item_id: id, note });
    await upsertLocalSyncedRow('wardrobe_wear_logs', res.log ?? undefined);
    await upsertLocalSyncedRow('wardrobe_items', res.item ?? undefined);
    const data = await loadWardrobeScreenData();
    const item = data.items.find((x) => x.id === id);
    return { ok: true, created: Boolean(res.created), item };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, created: false, error: msg };
  }
}

/** 穿搭配：专用接口展开单品日志 */
export async function recordWardrobeOutfitWear(
  outfitId: string,
  opts?: { note?: string },
): Promise<{
  ok: boolean;
  created: boolean;
  error?: string;
}> {
  const id = outfitId.trim();
  if (!id) return { ok: false, created: false, error: '缺少搭配 id' };
  try {
    const note = opts?.note?.trim() || undefined;
    const res = await apiWardrobeWearOutfit({ outfit_id: id, note });
    await upsertLocalSyncedRow('wardrobe_wear_logs', res.log ?? undefined);
    await upsertLocalSyncedRow('wardrobe_outfits', res.outfit ?? undefined);
    for (const log of res.item_logs ?? []) {
      await upsertLocalSyncedRow('wardrobe_wear_logs', log);
    }
    // 穿搭配会抬高关联单品 wear_count，补拉当前衣橱单品摘要
    try {
      const closetId =
        typeof res.outfit?.closet_id === 'string' ? res.outfit.closet_id : undefined;
      const page = await apiWardrobeListItems({
        closet_id: closetId,
        status: 'active',
        limit: 500,
      });
      await upsertPageRows(
        'wardrobe_items',
        asRecordList(page.items).map((r) => normalizeWardrobeRowForLocal('wardrobe_items', r)),
      );
    } catch {
      /* 非致命：下次 bootstrap / 增量会校准 */
    }
    return { ok: true, created: Boolean(res.created) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, created: false, error: msg };
  }
}

/** 供增量上传：从本地组装搭配 item_ids */
export async function listLocalOutfitItemIds(outfitId: string): Promise<string[]> {
  const db = await getDatabase();
  if (!db) return [];
  const rows =
    (await db.getAllAsync<{ item_id: string }>(
      `SELECT item_id FROM wardrobe_outfit_items
       WHERE outfit_id = ? AND sync_status != 'pending_delete'
       ORDER BY sort_order ASC, created_at ASC`,
      [outfitId],
    )) ?? [];
  return rows.map((r) => r.item_id);
}
