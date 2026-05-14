import { getDatabase } from '@/lib/database.native';

import type { WishItemRow } from './wish-list.types';

const META_KEY = 'wish_list_rational_ai_v1';

export type WishListRationalAiCachePayload = {
  fingerprint: string;
  headline: string;
  review: string;
};

/** 用于判断「清单是否变化需重新请求理性评审」的稳定指纹（含条目内容与更新时间）。 */
export function computeWishListRationalFingerprint(rows: WishItemRow[]): string {
  if (rows.length === 0) return '__empty__';
  const sorted = [...rows].sort((a, b) => a.id.localeCompare(b.id));
  return JSON.stringify(
    sorted.map(r => ({
      id: r.id,
      name: r.name,
      price: r.price,
      desire_level: r.desire_level,
      category_id: r.category_id,
      category_label: r.category_label,
      reason: r.reason,
      updated_at: r.updated_at,
    })),
  );
}

export async function getWishListRationalAiCache(): Promise<WishListRationalAiCachePayload | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM app_meta WHERE key = ? LIMIT 1', [META_KEY]);
  if (!row?.value?.trim()) return null;
  try {
    const p = JSON.parse(row.value) as unknown;
    if (!p || typeof p !== 'object') return null;
    const o = p as Record<string, unknown>;
    const fingerprint = typeof o.fingerprint === 'string' ? o.fingerprint : '';
    const headline = typeof o.headline === 'string' ? o.headline.trim() : '';
    const review = typeof o.review === 'string' ? o.review.trim() : '';
    if (!fingerprint || (!headline && !review)) return null;
    return { fingerprint, headline, review };
  } catch {
    return null;
  }
}

export async function saveWishListRationalAiCache(payload: WishListRationalAiCachePayload): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)', [
    META_KEY,
    JSON.stringify({
      fingerprint: payload.fingerprint,
      headline: payload.headline.trim(),
      review: payload.review.trim(),
    }),
  ]);
}

export async function clearWishListRationalAiCache(): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM app_meta WHERE key = ?', [META_KEY]);
}
