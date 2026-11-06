/**
 * 衣橱 AI 请求上下文：裁剪单品/搭配摘要，控制 token。
 */
import type { WardrobeItem, WardrobeOutfit } from '@/components/wardrobe/data';
import type {
  WardrobeAiItemSummary,
  WardrobeAiOutfitSummary,
  WardrobeOptionHints,
} from '@/lib/ai-api-client';
import { formatYmd } from '@/lib/date';

const DASH = '—';

function cleanField(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim();
  if (!s || s === DASH) return null;
  return s;
}

/** 从衣橱设置 optionRows 抽出枚举词条 */
export function buildWardrobeOptionHints(
  options: { kind: string; value: string }[] | null | undefined,
): WardrobeOptionHints {
  const bucket = (kind: string): string[] => {
    const seen: string[] = [];
    for (const row of options ?? []) {
      if (row.kind !== kind) continue;
      const v = row.value.trim();
      if (!v || seen.includes(v)) continue;
      seen.push(v);
      if (seen.length >= 40) break;
    }
    return seen;
  };
  return {
    colors: bucket('color'),
    seasons: bucket('season'),
    brands: bucket('brand'),
    fits: bucket('fit'),
    warmth: bucket('warmth'),
  };
}

export function buildWardrobeItemAiSummaries(
  items: WardrobeItem[],
  max = 80,
): WardrobeAiItemSummary[] {
  const out: WardrobeAiItemSummary[] = [];
  for (const it of items) {
    if (!it.id?.trim() || !it.name?.trim()) continue;
    out.push({
      id: it.id,
      name: it.name.trim().slice(0, 80),
      category: cleanField(it.category),
      color: cleanField(it.color),
      season: cleanField(it.season)?.replace(/\s+/g, '') ?? null,
      brand: cleanField(it.brand),
      warmth: cleanField(it.warmth),
      wear_count: typeof it.wear === 'number' ? it.wear : 0,
      last_worn_on: null,
      tags: (it.tags ?? []).map(t => t.trim()).filter(Boolean).slice(0, 8),
    });
    if (out.length >= max) break;
  }
  return out;
}

export function buildWardrobeOutfitAiSummaries(
  outfits: WardrobeOutfit[],
  max = 40,
): WardrobeAiOutfitSummary[] {
  const out: WardrobeAiOutfitSummary[] = [];
  for (const o of outfits) {
    if (!o.id?.trim() || !o.name?.trim()) continue;
    out.push({
      id: o.id,
      name: o.name.trim().slice(0, 80),
      occasion: cleanField(o.occasion),
      itemIds: (o.items ?? []).filter(Boolean).slice(0, 20),
      wear_count: typeof o.wear === 'number' ? o.wear : 0,
      last_worn_on: null,
    });
    if (out.length >= max) break;
  }
  return out;
}

/** 近 N 天「本周周历」里已标记穿着的日期 → 对应单品/搭配需由调用方另拼；这里给季节 hint */
export function seasonHintFromFilter(season: 'all' | 'ss' | 'aw' | string): string | undefined {
  if (season === 'ss') return '春夏';
  if (season === 'aw') return '秋冬';
  const m = new Date().getMonth() + 1;
  if (m >= 3 && m <= 8) return '春夏';
  return '秋冬';
}

export function todayYmdLocal(): string {
  return formatYmd(new Date());
}

/**
 * 从单品 wear / date 粗估近期已穿：date 形如 2026.10.28 且 wear>0 时纳入 id（弱信号）。
 * 更准的 recently_worn_* 应由 wear_logs 提供；此处作兜底。
 */
export function guessRecentlyWornItemIds(items: WardrobeItem[], days = 14): string[] {
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - days);
  const out: string[] = [];
  for (const it of items) {
    if (!it.id || !(it.wear > 0)) continue;
    const raw = (it.date ?? '').trim().replace(/\./g, '-');
    const m = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (!m) continue;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (Number.isNaN(d.getTime()) || d < cutoff) continue;
    out.push(it.id);
    if (out.length >= 40) break;
  }
  return out;
}
