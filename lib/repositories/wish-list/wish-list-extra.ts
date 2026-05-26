export type WishItemExtraPayload = {
  /** ISO 时间；存在即视为已实现 */
  fulfilled_at?: string;
  /** 关联的存钱计划 id */
  savings_plan_id?: string;
};

export function parseWishItemExtra(raw: string | null | undefined): WishItemExtraPayload | null {
  if (!raw?.trim()) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    const o = v as Record<string, unknown>;
    const extra: WishItemExtraPayload = {};
    const fulfilled_at =
      typeof o.fulfilled_at === 'string' && o.fulfilled_at.trim() ? o.fulfilled_at.trim() : undefined;
    if (fulfilled_at) extra.fulfilled_at = fulfilled_at;
    const savings_plan_id =
      typeof o.savings_plan_id === 'string' && o.savings_plan_id.trim()
        ? o.savings_plan_id.trim()
        : undefined;
    if (savings_plan_id) extra.savings_plan_id = savings_plan_id;
    return Object.keys(extra).length > 0 ? extra : {};
  } catch {
    return null;
  }
}

export function serializeWishItemExtra(extra: WishItemExtraPayload | null | undefined): string | null {
  if (!extra) return null;
  const payload: Record<string, string> = {};
  if (extra.fulfilled_at?.trim()) payload.fulfilled_at = extra.fulfilled_at.trim();
  if (extra.savings_plan_id?.trim()) payload.savings_plan_id = extra.savings_plan_id.trim();
  return Object.keys(payload).length > 0 ? JSON.stringify(payload) : null;
}

export function mergeWishItemExtra(
  raw: string | null | undefined,
  patch: Partial<WishItemExtraPayload> & { savings_plan_id?: string | '' },
): string | null {
  const base = parseWishItemExtra(raw) ?? {};
  const next: WishItemExtraPayload = { ...base };
  if ('fulfilled_at' in patch) {
    if (patch.fulfilled_at?.trim()) next.fulfilled_at = patch.fulfilled_at.trim();
    else delete next.fulfilled_at;
  }
  if ('savings_plan_id' in patch) {
    const id = patch.savings_plan_id?.trim();
    if (id) next.savings_plan_id = id;
    else delete next.savings_plan_id;
  }
  return serializeWishItemExtra(next);
}

export function getWishSavingsPlanIdFromExtra(raw: string | null | undefined): string | null {
  return parseWishItemExtra(raw)?.savings_plan_id ?? null;
}

export function setWishSavingsPlanIdInExtra(raw: string | null | undefined, planId: string | null): string | null {
  return mergeWishItemExtra(raw, { savings_plan_id: planId ?? '' });
}

export function isWishItemFulfilled(row: { extra_data: string | null }): boolean {
  return Boolean(parseWishItemExtra(row.extra_data)?.fulfilled_at);
}
