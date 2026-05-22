export type WishItemExtraPayload = {
  /** ISO 时间；存在即视为已实现 */
  fulfilled_at?: string;
};

export function parseWishItemExtra(raw: string | null | undefined): WishItemExtraPayload | null {
  if (!raw?.trim()) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    const o = v as Record<string, unknown>;
    const fulfilled_at =
      typeof o.fulfilled_at === 'string' && o.fulfilled_at.trim() ? o.fulfilled_at.trim() : undefined;
    return fulfilled_at ? { fulfilled_at } : {};
  } catch {
    return null;
  }
}

export function serializeWishItemExtra(extra: WishItemExtraPayload | null | undefined): string | null {
  if (!extra || !extra.fulfilled_at?.trim()) return null;
  return JSON.stringify({ fulfilled_at: extra.fulfilled_at.trim() });
}

export function isWishItemFulfilled(row: { extra_data: string | null }): boolean {
  return Boolean(parseWishItemExtra(row.extra_data)?.fulfilled_at);
}
