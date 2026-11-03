/**
 * 衣橱专用业务接口：/api/app/wardrobe/*
 * 对齐 self_app_back routes/app/wardrobe.ts
 */
import { APP_API_PREFIX, apiRequest } from '@/lib/api/http';

function buildQuery(params: Record<string, string | number | boolean | null | undefined>): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === '') continue;
    if (typeof value === 'boolean') {
      qs.set(key, value ? 'true' : 'false');
      continue;
    }
    qs.set(key, String(value));
  }
  const text = qs.toString();
  return text ? `?${text}` : '';
}

export type WardrobeBootstrapPayload = {
  closet?: Record<string, unknown> | null;
  categories?: Record<string, unknown>[];
  occasions?: Record<string, unknown>[];
  items?: Record<string, unknown>[];
  item_count?: number;
  outfits?: Record<string, unknown>[];
  outfit_count?: number;
  wear_week?: Record<string, unknown> | null;
  options?: Record<string, unknown>[];
  body_profile?: Record<string, unknown> | null;
};

export async function apiWardrobeBootstrap(params?: {
  closet_id?: string;
  signal?: AbortSignal;
}): Promise<WardrobeBootstrapPayload> {
  const qs = buildQuery({ closet_id: params?.closet_id });
  return apiRequest<WardrobeBootstrapPayload>(`${APP_API_PREFIX}/wardrobe/bootstrap${qs}`, {
    method: 'GET',
    signal: params?.signal,
  });
}

export async function apiWardrobeListClosets(opts?: { signal?: AbortSignal }) {
  return apiRequest<Record<string, unknown>[]>(`${APP_API_PREFIX}/wardrobe/closets`, {
    method: 'GET',
    signal: opts?.signal,
  });
}

export async function apiWardrobeCreateCloset(
  body: Record<string, unknown>,
  opts?: { signal?: AbortSignal },
) {
  return apiRequest(`${APP_API_PREFIX}/wardrobe/closets`, {
    method: 'POST',
    body,
    signal: opts?.signal,
  });
}

export async function apiWardrobeUpdateCloset(
  id: string,
  body: Record<string, unknown>,
  opts?: { signal?: AbortSignal },
) {
  return apiRequest(`${APP_API_PREFIX}/wardrobe/closets/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body,
    signal: opts?.signal,
  });
}

export async function apiWardrobeDeleteCloset(id: string, opts?: { signal?: AbortSignal }) {
  return apiRequest(`${APP_API_PREFIX}/wardrobe/closets/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    signal: opts?.signal,
  });
}

export async function apiWardrobeListCategories(params?: {
  closet_id?: string;
  signal?: AbortSignal;
}) {
  const qs = buildQuery({ closet_id: params?.closet_id });
  return apiRequest<Record<string, unknown>[]>(`${APP_API_PREFIX}/wardrobe/categories${qs}`, {
    method: 'GET',
    signal: params?.signal,
  });
}

export async function apiWardrobeCategoriesWithItems(params?: {
  closet_id?: string;
  signal?: AbortSignal;
}) {
  const qs = buildQuery({ closet_id: params?.closet_id });
  return apiRequest<Record<string, unknown>[]>(
    `${APP_API_PREFIX}/wardrobe/categories/with-items${qs}`,
    { method: 'GET', signal: params?.signal },
  );
}

export async function apiWardrobeCreateCategory(
  body: Record<string, unknown>,
  opts?: { signal?: AbortSignal },
) {
  return apiRequest(`${APP_API_PREFIX}/wardrobe/categories`, {
    method: 'POST',
    body,
    signal: opts?.signal,
  });
}

export async function apiWardrobeUpdateCategory(
  id: string,
  body: Record<string, unknown>,
  opts?: { signal?: AbortSignal },
) {
  return apiRequest(`${APP_API_PREFIX}/wardrobe/categories/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body,
    signal: opts?.signal,
  });
}

export async function apiWardrobeDeleteCategory(id: string, opts?: { signal?: AbortSignal }) {
  return apiRequest(`${APP_API_PREFIX}/wardrobe/categories/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    signal: opts?.signal,
  });
}

export async function apiWardrobeListItems(params?: {
  closet_id?: string;
  category_id?: string;
  season?: string;
  status?: string;
  limit?: number;
  offset?: number;
  signal?: AbortSignal;
}) {
  const qs = buildQuery({
    closet_id: params?.closet_id,
    category_id: params?.category_id,
    season: params?.season,
    status: params?.status,
    limit: params?.limit,
    offset: params?.offset,
  });
  return apiRequest<{ items?: Record<string, unknown>[]; total?: number }>(
    `${APP_API_PREFIX}/wardrobe/items${qs}`,
    { method: 'GET', signal: params?.signal },
  );
}

export async function apiWardrobeGetItem(id: string, opts?: { signal?: AbortSignal }) {
  return apiRequest<Record<string, unknown>>(
    `${APP_API_PREFIX}/wardrobe/items/${encodeURIComponent(id)}`,
    { method: 'GET', signal: opts?.signal },
  );
}

export async function apiWardrobeCreateItem(
  body: Record<string, unknown>,
  opts?: { signal?: AbortSignal },
) {
  return apiRequest(`${APP_API_PREFIX}/wardrobe/items`, {
    method: 'POST',
    body,
    signal: opts?.signal,
  });
}

export async function apiWardrobeUpdateItem(
  id: string,
  body: Record<string, unknown>,
  opts?: { signal?: AbortSignal; method?: 'PUT' | 'PATCH' },
) {
  return apiRequest(`${APP_API_PREFIX}/wardrobe/items/${encodeURIComponent(id)}`, {
    method: opts?.method === 'PATCH' ? 'PATCH' : 'PUT',
    body,
    signal: opts?.signal,
  });
}

export async function apiWardrobeDeleteItem(id: string, opts?: { signal?: AbortSignal }) {
  return apiRequest(`${APP_API_PREFIX}/wardrobe/items/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    signal: opts?.signal,
  });
}

export async function apiWardrobeListOccasions(opts?: { signal?: AbortSignal }) {
  return apiRequest<Record<string, unknown>[]>(`${APP_API_PREFIX}/wardrobe/occasions`, {
    method: 'GET',
    signal: opts?.signal,
  });
}

export async function apiWardrobeCreateOccasion(
  body: Record<string, unknown>,
  opts?: { signal?: AbortSignal },
) {
  return apiRequest(`${APP_API_PREFIX}/wardrobe/occasions`, {
    method: 'POST',
    body,
    signal: opts?.signal,
  });
}

export async function apiWardrobeUpdateOccasion(
  id: string,
  body: Record<string, unknown>,
  opts?: { signal?: AbortSignal },
) {
  return apiRequest(`${APP_API_PREFIX}/wardrobe/occasions/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body,
    signal: opts?.signal,
  });
}

export async function apiWardrobeDeleteOccasion(id: string, opts?: { signal?: AbortSignal }) {
  return apiRequest(`${APP_API_PREFIX}/wardrobe/occasions/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    signal: opts?.signal,
  });
}

export async function apiWardrobeListOutfits(params?: {
  closet_id?: string;
  occasion_id?: string;
  status?: string;
  signal?: AbortSignal;
}) {
  const qs = buildQuery({
    closet_id: params?.closet_id,
    occasion_id: params?.occasion_id,
    status: params?.status,
  });
  return apiRequest<Record<string, unknown>[]>(`${APP_API_PREFIX}/wardrobe/outfits${qs}`, {
    method: 'GET',
    signal: params?.signal,
  });
}

export async function apiWardrobeGetOutfit(id: string, opts?: { signal?: AbortSignal }) {
  return apiRequest<Record<string, unknown>>(
    `${APP_API_PREFIX}/wardrobe/outfits/${encodeURIComponent(id)}`,
    { method: 'GET', signal: opts?.signal },
  );
}

export async function apiWardrobeCreateOutfit(
  body: Record<string, unknown>,
  opts?: { signal?: AbortSignal },
) {
  return apiRequest(`${APP_API_PREFIX}/wardrobe/outfits`, {
    method: 'POST',
    body,
    signal: opts?.signal,
  });
}

export async function apiWardrobeUpdateOutfit(
  id: string,
  body: Record<string, unknown>,
  opts?: { signal?: AbortSignal; method?: 'PUT' | 'PATCH' },
) {
  return apiRequest(`${APP_API_PREFIX}/wardrobe/outfits/${encodeURIComponent(id)}`, {
    method: opts?.method === 'PATCH' ? 'PATCH' : 'PUT',
    body,
    signal: opts?.signal,
  });
}

export async function apiWardrobeDeleteOutfit(id: string, opts?: { signal?: AbortSignal }) {
  return apiRequest(`${APP_API_PREFIX}/wardrobe/outfits/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    signal: opts?.signal,
  });
}

export async function apiWardrobeWearItem(
  body: { item_id: string; worn_on?: string; note?: string },
  opts?: { signal?: AbortSignal },
) {
  return apiRequest<{
    created?: boolean;
    log?: Record<string, unknown> | null;
    item?: Record<string, unknown> | null;
  }>(`${APP_API_PREFIX}/wardrobe/wear/item`, {
    method: 'POST',
    body,
    signal: opts?.signal,
  });
}

export async function apiWardrobeWearOutfit(
  body: { outfit_id: string; worn_on?: string; note?: string },
  opts?: { signal?: AbortSignal },
) {
  return apiRequest<{
    created?: boolean;
    log?: Record<string, unknown> | null;
    outfit?: Record<string, unknown> | null;
    item_logs?: Record<string, unknown>[];
  }>(`${APP_API_PREFIX}/wardrobe/wear/outfit`, {
    method: 'POST',
    body,
    signal: opts?.signal,
  });
}

export async function apiWardrobeDeleteWearLog(id: string, opts?: { signal?: AbortSignal }) {
  return apiRequest(`${APP_API_PREFIX}/wardrobe/wear/logs/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    signal: opts?.signal,
  });
}

export async function apiWardrobeWearWeek(params?: {
  closet_id?: string;
  anchor?: string;
  signal?: AbortSignal;
}) {
  const qs = buildQuery({ closet_id: params?.closet_id, anchor: params?.anchor });
  return apiRequest<Record<string, unknown>>(`${APP_API_PREFIX}/wardrobe/wear/week${qs}`, {
    method: 'GET',
    signal: params?.signal,
  });
}

export async function apiWardrobeItemWearHistory(
  id: string,
  opts?: { signal?: AbortSignal },
) {
  return apiRequest<Record<string, unknown>>(
    `${APP_API_PREFIX}/wardrobe/wear/item/${encodeURIComponent(id)}/history`,
    { method: 'GET', signal: opts?.signal },
  );
}

export async function apiWardrobeListOptions(params?: {
  closet_id?: string;
  kind?: string;
  signal?: AbortSignal;
}) {
  const qs = buildQuery({ closet_id: params?.closet_id, kind: params?.kind });
  return apiRequest<Record<string, unknown>[]>(`${APP_API_PREFIX}/wardrobe/options${qs}`, {
    method: 'GET',
    signal: params?.signal,
  });
}

export async function apiWardrobeCreateOption(
  body: Record<string, unknown>,
  opts?: { signal?: AbortSignal },
) {
  return apiRequest(`${APP_API_PREFIX}/wardrobe/options`, {
    method: 'POST',
    body,
    signal: opts?.signal,
  });
}

export async function apiWardrobeUpdateOption(
  id: string,
  body: Record<string, unknown>,
  opts?: { signal?: AbortSignal },
) {
  return apiRequest(`${APP_API_PREFIX}/wardrobe/options/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body,
    signal: opts?.signal,
  });
}

export async function apiWardrobeDeleteOption(id: string, opts?: { signal?: AbortSignal }) {
  return apiRequest(`${APP_API_PREFIX}/wardrobe/options/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    signal: opts?.signal,
  });
}

export async function apiWardrobeGetBodyProfile(params?: {
  closet_id?: string;
  signal?: AbortSignal;
}) {
  const qs = buildQuery({ closet_id: params?.closet_id });
  return apiRequest<Record<string, unknown> | null>(
    `${APP_API_PREFIX}/wardrobe/body-profile${qs}`,
    { method: 'GET', signal: params?.signal },
  );
}

export async function apiWardrobeUpsertBodyProfile(
  body: Record<string, unknown>,
  opts?: { signal?: AbortSignal },
) {
  return apiRequest(`${APP_API_PREFIX}/wardrobe/body-profile`, {
    method: 'PUT',
    body,
    signal: opts?.signal,
  });
}

export async function apiWardrobeStatsSummary(params?: {
  closet_id?: string;
  signal?: AbortSignal;
}) {
  const qs = buildQuery({ closet_id: params?.closet_id });
  return apiRequest<Record<string, unknown>>(`${APP_API_PREFIX}/wardrobe/stats/summary${qs}`, {
    method: 'GET',
    signal: params?.signal,
  });
}
