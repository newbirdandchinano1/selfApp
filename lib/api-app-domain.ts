/**
 * App 专用业务接口（/api/app/*），对齐后端菜谱 / 备忘录 / 健康摄入 / 心愿板文档。
 * 供 api-client 表级 CRUD 路由，以及心愿板动作直接调用。
 */

import { apiRequest, type ApiListQueryOpts, type ApiListResponse } from '@/lib/api-client';

export const APP_API_PREFIX = '/api/app';

/** 走专用业务接口的表（写入/读取由本模块适配） */
export const APP_DOMAIN_CRUD_TABLES = new Set([
  'recipe_categories',
  'recipe_items',
  'memo_dimensions',
  'memos',
  'health_records',
  'wish_board_items',
]);

function asRecord(row: unknown): Record<string, unknown> {
  if (row && typeof row === 'object') return row as Record<string, unknown>;
  return {};
}

function asRecordList(data: unknown): Record<string, unknown>[] {
  if (!Array.isArray(data)) return [];
  return data.map(asRecord);
}

/** 单用户 APP 本地 users.id；专用健康接口不返回 user_id */
const DEFAULT_HEALTH_USER_ID = 'default';

function extractHealthIntakeItems(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return asRecordList(data);
  const rec = asRecord(data);
  return asRecordList(rec.items ?? rec.list ?? rec.records);
}

function wrapList<T extends Record<string, unknown>>(list: T[]): ApiListResponse<T> {
  return {
    list,
    pagination: {
      page: 1,
      limit: Math.max(list.length, 1),
      total: list.length,
      totalPages: 1,
    },
  };
}

function parseJsonField(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const t = value.trim();
  if (!t) return value;
  try {
    return JSON.parse(t) as unknown;
  } catch {
    return value;
  }
}

/** 去掉本地同步字段，保留业务字段 */
function stripSyncFields(row: Record<string, unknown>): Record<string, unknown> {
  const out = { ...row };
  delete out.sync_status;
  delete out.deleted_at;
  delete out.version;
  return out;
}

function prepareRecipeItemBody(row: Record<string, unknown>): Record<string, unknown> {
  const out = stripSyncFields(row);
  if ('ingredients_json' in out) out.ingredients_json = parseJsonField(out.ingredients_json);
  if ('steps_json' in out) out.steps_json = parseJsonField(out.steps_json);
  return out;
}

function prepareMemoDimensionBody(row: Record<string, unknown>): Record<string, unknown> {
  const out = stripSyncFields(row);
  const name =
    (typeof out.name === 'string' ? out.name.trim() : '') ||
    (typeof out.title === 'string' ? out.title.trim() : '');
  if (name) out.name = name;
  delete out.title;
  return out;
}

function prepareMemoBody(row: Record<string, unknown>): Record<string, unknown> {
  return stripSyncFields(row);
}

function prepareHealthIntakeBody(row: Record<string, unknown>): Record<string, unknown> {
  const out = stripSyncFields(row);
  // 目标字段已拆到 health_daily_targets，专用新增接口不接收 target_*
  delete out.target_hydration;
  delete out.target_protein;
  delete out.target_sodium;
  delete out.target_carbohydrate;
  delete out.target_calories;
  return out;
}

function prepareWishBoardItemBody(row: Record<string, unknown>): Record<string, unknown> {
  return stripSyncFields(row);
}

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

export function isAppDomainCrudTable(table: string): boolean {
  return APP_DOMAIN_CRUD_TABLES.has(table);
}

export async function appDomainCreateRecord<T = unknown>(
  table: string,
  row: Record<string, unknown>,
  opts?: { signal?: AbortSignal },
): Promise<T> {
  const signal = opts?.signal;
  switch (table) {
    case 'recipe_categories':
      return apiRequest<T>(`${APP_API_PREFIX}/recipes/categories`, {
        method: 'POST',
        body: stripSyncFields(row),
        signal,
      });
    case 'recipe_items':
      return apiRequest<T>(`${APP_API_PREFIX}/recipes`, {
        method: 'POST',
        body: prepareRecipeItemBody(row),
        signal,
      });
    case 'memo_dimensions':
      return apiRequest<T>(`${APP_API_PREFIX}/memos/dimensions`, {
        method: 'POST',
        body: prepareMemoDimensionBody(row),
        signal,
      });
    case 'memos':
      return apiRequest<T>(`${APP_API_PREFIX}/memos`, {
        method: 'POST',
        body: prepareMemoBody(row),
        signal,
      });
    case 'health_records':
      return apiRequest<T>(`${APP_API_PREFIX}/health/intakes`, {
        method: 'POST',
        body: prepareHealthIntakeBody(row),
        signal,
      });
    case 'wish_board_items':
      return apiRequest<T>(`${APP_API_PREFIX}/wish-board/items`, {
        method: 'POST',
        body: prepareWishBoardItemBody(row),
        signal,
      });
    default:
      throw new Error(`表「${table}」无 App 专用创建接口`);
  }
}

export async function appDomainUpdateRecord<T = unknown>(
  table: string,
  id: string,
  row: Record<string, unknown>,
  opts?: { signal?: AbortSignal; method?: 'PUT' | 'PATCH' },
): Promise<T> {
  const signal = opts?.signal;
  const enc = encodeURIComponent(id);
  switch (table) {
    case 'recipe_categories':
      return apiRequest<T>(`${APP_API_PREFIX}/recipes/categories/${enc}`, {
        method: 'PATCH',
        body: stripSyncFields(row),
        signal,
      });
    case 'recipe_items':
      return apiRequest<T>(`${APP_API_PREFIX}/recipes/${enc}`, {
        method: 'PUT',
        body: prepareRecipeItemBody(row),
        signal,
      });
    case 'memo_dimensions':
      return apiRequest<T>(`${APP_API_PREFIX}/memos/dimensions/${enc}`, {
        method: 'PATCH',
        body: prepareMemoDimensionBody(row),
        signal,
      });
    case 'memos':
      return apiRequest<T>(`${APP_API_PREFIX}/memos/${enc}`, {
        method: 'PUT',
        body: prepareMemoBody(row),
        signal,
      });
    case 'wish_board_items':
      // 专用文档暂无编辑接口；保留通用 CRUD 由调用方回退
      throw new AppDomainFallbackError(table, 'update');
    case 'health_records':
      throw new AppDomainFallbackError(table, 'update');
    default:
      throw new Error(`表「${table}」无 App 专用更新接口`);
  }
}

export async function appDomainDeleteRecord(
  table: string,
  id: string,
  opts?: { signal?: AbortSignal },
): Promise<void> {
  const signal = opts?.signal;
  const enc = encodeURIComponent(id);
  switch (table) {
    case 'recipe_categories':
      await apiRequest(`${APP_API_PREFIX}/recipes/categories/${enc}`, { method: 'DELETE', signal });
      return;
    case 'recipe_items':
      await apiRequest(`${APP_API_PREFIX}/recipes/${enc}`, { method: 'DELETE', signal });
      return;
    case 'memo_dimensions':
      await apiRequest(`${APP_API_PREFIX}/memos/dimensions/${enc}`, { method: 'DELETE', signal });
      return;
    case 'memos':
      await apiRequest(`${APP_API_PREFIX}/memos/${enc}`, { method: 'DELETE', signal });
      return;
    case 'wish_board_items':
      await apiRequest(`${APP_API_PREFIX}/wish-board/items/${enc}`, { method: 'DELETE', signal });
      return;
    case 'health_records':
      throw new AppDomainFallbackError(table, 'delete');
    default:
      throw new Error(`表「${table}」无 App 专用删除接口`);
  }
}

export async function appDomainGetRecord<T extends Record<string, unknown>>(
  table: string,
  id: string,
  opts?: { signal?: AbortSignal },
): Promise<T> {
  const signal = opts?.signal;
  const enc = encodeURIComponent(id);
  switch (table) {
    case 'recipe_items': {
      const data = await apiRequest<T>(`${APP_API_PREFIX}/recipes/${enc}`, { method: 'GET', signal });
      return normalizeRecipeItemRow(asRecord(data)) as T;
    }
    case 'memos': {
      const data = await apiRequest<Record<string, unknown>>(`${APP_API_PREFIX}/memos/${enc}`, {
        method: 'GET',
        signal,
      });
      return normalizeMemoRow(data) as T;
    }
    case 'recipe_categories':
    case 'memo_dimensions':
    case 'health_records':
    case 'wish_board_items':
      throw new AppDomainFallbackError(table, 'get');
    default:
      throw new Error(`表「${table}」无 App 专用详情接口`);
  }
}

export async function appDomainListRecords<T extends Record<string, unknown>>(
  table: string,
  opts?: ApiListQueryOpts & { signal?: AbortSignal },
): Promise<ApiListResponse<T> | null> {
  const signal = opts?.signal;
  switch (table) {
    case 'recipe_categories': {
      const data = await apiRequest<unknown>(`${APP_API_PREFIX}/recipes/categories`, {
        method: 'GET',
        signal,
      });
      return wrapList(asRecordList(data) as T[]);
    }
    case 'recipe_items': {
      const groups = await apiRequest<unknown>(`${APP_API_PREFIX}/recipes/categories/with-items`, {
        method: 'GET',
        signal,
      });
      const items: Record<string, unknown>[] = [];
      for (const g of asRecordList(groups)) {
        const groupItems = Array.isArray(g.items) ? g.items : [];
        for (const it of groupItems) {
          items.push(normalizeRecipeItemRow(asRecord(it)));
        }
      }
      return wrapList(items as T[]);
    }
    case 'memo_dimensions': {
      const data = await apiRequest<unknown>(`${APP_API_PREFIX}/memos/dimensions`, {
        method: 'GET',
        signal,
      });
      return wrapList(asRecordList(data).map(normalizeMemoDimensionRow) as T[]);
    }
    case 'memos': {
      const data = await apiRequest<unknown>(`${APP_API_PREFIX}/memos`, { method: 'GET', signal });
      return wrapList(asRecordList(data).map(normalizeMemoRow) as T[]);
    }
    case 'health_records': {
      const data = await apiRequest<unknown>(`${APP_API_PREFIX}/health/intakes/last-30-days`, {
        method: 'GET',
        signal,
      });
      return wrapList(extractHealthIntakeItems(data).map(normalizeHealthRecordRow) as T[]);
    }
    case 'wish_board_items': {
      const data = await apiRequest<{ items?: unknown[] }>(`${APP_API_PREFIX}/wish-board/items`, {
        method: 'GET',
        signal,
      });
      const items = Array.isArray(data?.items) ? data.items.map(asRecord) : [];
      return wrapList(items as T[]);
    }
    default:
      return null;
  }
}

function normalizeRecipeItemRow(row: Record<string, unknown>): Record<string, unknown> {
  const out = { ...row };
  // 本地 SQLite 存 JSON 字符串
  if (out.ingredients_json != null && typeof out.ingredients_json !== 'string') {
    try {
      out.ingredients_json = JSON.stringify(out.ingredients_json);
    } catch {
      out.ingredients_json = '[]';
    }
  }
  if (out.steps_json != null && typeof out.steps_json !== 'string') {
    try {
      out.steps_json = JSON.stringify(out.steps_json);
    } catch {
      out.steps_json = '[]';
    }
  }
  return out;
}

function normalizeMemoDimensionRow(row: Record<string, unknown>): Record<string, unknown> {
  const out = { ...row };
  if (typeof out.name !== 'string' || !out.name.trim()) {
    if (typeof out.title === 'string' && out.title.trim()) {
      out.name = out.title.trim();
    }
  }
  return out;
}

function normalizeMemoRow(row: Record<string, unknown>): Record<string, unknown> {
  const out = { ...row };
  delete out.dimension_detail;
  return out;
}

function normalizeHealthRecordRow(row: Record<string, unknown>): Record<string, unknown> {
  const out = { ...row };
  // record_date 本地多为 YYYY-MM-DD；接口可能返回 ISO（日期在前 10 位）
  if (typeof out.record_date === 'string' && out.record_date.length >= 10) {
    const ymd = out.record_date.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
      out.record_date = ymd;
    }
  }
  // 专用接口 / 通用 List 都不下发 user_id，缺省会触发 SQLite NOT NULL + FK，整表灌库失败
  const userId = typeof out.user_id === 'string' ? out.user_id.trim() : '';
  if (!userId) out.user_id = DEFAULT_HEALTH_USER_ID;
  for (const col of [
    'hydration',
    'protein',
    'carbohydrate',
    'calories',
    'target_hydration',
    'target_protein',
    'target_carbohydrate',
    'target_calories',
  ] as const) {
    if (out[col] == null || out[col] === '') out[col] = 0;
  }
  return out;
}

/** 专用接口未覆盖的操作，回退到 /api/data */
export class AppDomainFallbackError extends Error {
  readonly table: string;
  readonly op: string;

  constructor(table: string, op: string) {
    super(`App domain fallback: ${table}.${op}`);
    this.name = 'AppDomainFallbackError';
    this.table = table;
    this.op = op;
  }
}

// —— 心愿板专用动作 ——

export async function appWishBoardGetBalance(opts?: { signal?: AbortSignal }): Promise<number> {
  const data = await apiRequest<{ balance?: number }>(`${APP_API_PREFIX}/wish-board/points/balance`, {
    method: 'GET',
    signal: opts?.signal,
  });
  return Math.max(0, Math.floor(Number(data?.balance) || 0));
}

export async function appWishBoardRedeem(
  id: string,
  opts?: { signal?: AbortSignal },
): Promise<{ balance?: number; item?: Record<string, unknown> }> {
  return apiRequest(`${APP_API_PREFIX}/wish-board/redeem`, {
    method: 'POST',
    body: { id },
    signal: opts?.signal,
  });
}

export async function appWishBoardAdjustPoints(
  input: {
    delta: number;
    reason: string;
    ref_type?: string | null;
    ref_id?: string | null;
    note?: string | null;
  },
  opts?: { signal?: AbortSignal },
): Promise<{ balance?: number; delta?: number; ledger_id?: string | null }> {
  return apiRequest(`${APP_API_PREFIX}/wish-board/points/adjust`, {
    method: 'POST',
    body: {
      delta: input.delta,
      reason: input.reason,
      ...(input.ref_type != null ? { ref_type: input.ref_type } : {}),
      ...(input.ref_id != null ? { ref_id: input.ref_id } : {}),
      ...(input.note != null ? { note: input.note } : {}),
    },
    signal: opts?.signal,
  });
}

export async function appWishBoardResetPoints(opts?: {
  signal?: AbortSignal;
}): Promise<{ balance?: number; delta?: number; ledger_id?: string | null }> {
  return apiRequest(`${APP_API_PREFIX}/wish-board/points/reset`, {
    method: 'POST',
    signal: opts?.signal,
  });
}

export type AppPointsLedgerItem = {
  id: string;
  delta: number;
  balance_after: number;
  reason: string;
  reason_label: string;
  ref_type?: string | null;
  ref_id?: string | null;
  ref_title?: string | null;
  note?: string | null;
  created_at: string;
};

export type AppPointsLedgerResult = {
  items: AppPointsLedgerItem[];
  balance: number;
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

/** GET /api/app/wish-board/points/ledger — 积分流水（全部来源） */
export async function appWishBoardListPointsLedger(
  params?: { page?: number; limit?: number },
  opts?: { signal?: AbortSignal },
): Promise<AppPointsLedgerResult> {
  const page = Math.max(1, Math.floor(Number(params?.page) || 1));
  const limit = Math.min(200, Math.max(1, Math.floor(Number(params?.limit) || 50)));
  const qs = `?page=${page}&limit=${limit}`;
  const data = await apiRequest<{
    items?: AppPointsLedgerItem[];
    balance?: number;
    pagination?: Partial<AppPointsLedgerResult['pagination']>;
    total?: number;
  }>(`${APP_API_PREFIX}/wish-board/points/ledger${qs}`, {
    method: 'GET',
    signal: opts?.signal,
  });

  const items = Array.isArray(data?.items)
    ? data.items.map(row => ({
        id: String(row.id),
        delta: Math.floor(Number(row.delta) || 0),
        balance_after: Math.max(0, Math.floor(Number(row.balance_after) || 0)),
        reason: String(row.reason ?? ''),
        reason_label: String(row.reason_label ?? row.reason ?? '积分变动'),
        ref_type: row.ref_type ?? null,
        ref_id: row.ref_id ?? null,
        ref_title: row.ref_title ?? null,
        note: row.note ?? null,
        created_at: String(row.created_at ?? ''),
      }))
    : [];

  const total = Math.max(
    0,
    Math.floor(Number(data?.pagination?.total ?? data?.total) || items.length),
  );
  const pageOut = Math.max(1, Math.floor(Number(data?.pagination?.page) || page));
  const limitOut = Math.max(1, Math.floor(Number(data?.pagination?.limit) || limit));
  const totalPages = Math.max(
    0,
    Math.floor(Number(data?.pagination?.totalPages) || (total > 0 ? Math.ceil(total / limitOut) : 0)),
  );

  return {
    items,
    balance: Math.max(0, Math.floor(Number(data?.balance) || 0)),
    pagination: { page: pageOut, limit: limitOut, total, totalPages },
  };
}

/** DELETE /api/app/wish-board/points/ledger/:id — 删除流水并回退积分 */
export async function appWishBoardDeletePointsLedger(
  id: string,
  opts?: { signal?: AbortSignal },
): Promise<{
  deleted: boolean;
  id: string;
  delta: number;
  rollback_delta: number;
  balance: number;
  reason: string;
  ref_type: string | null;
  ref_id: string | null;
}> {
  const ledgerId = String(id ?? '').trim();
  if (!ledgerId) throw new Error('缺少流水 id');
  const data = await apiRequest<{
    deleted?: boolean;
    id?: string;
    delta?: number;
    rollback_delta?: number;
    balance?: number;
    reason?: string;
    ref_type?: string | null;
    ref_id?: string | null;
  }>(`${APP_API_PREFIX}/wish-board/points/ledger/${encodeURIComponent(ledgerId)}`, {
    method: 'DELETE',
    signal: opts?.signal,
  });
  return {
    deleted: Boolean(data?.deleted ?? true),
    id: String(data?.id ?? ledgerId),
    delta: Math.floor(Number(data?.delta) || 0),
    rollback_delta: Math.floor(Number(data?.rollback_delta) || 0),
    balance: Math.max(0, Math.floor(Number(data?.balance) || 0)),
    reason: String(data?.reason ?? ''),
    ref_type: data?.ref_type == null ? null : String(data.ref_type),
    ref_id: data?.ref_id == null ? null : String(data.ref_id),
  };
}

export type AppWishRedeemedItem = {
  ledger_id: string;
  wish_id: string;
  delta: number;
  balance_after?: number;
  redeemed_at: string;
  title?: string | null;
  description?: string | null;
  cost_points?: number | null;
  note?: string | null;
  icon_key?: string | null;
  wish_type?: string | null;
  status?: string | null;
};

export async function appWishBoardListRedeemed(opts?: {
  signal?: AbortSignal;
}): Promise<AppWishRedeemedItem[]> {
  const data = await apiRequest<{ items?: AppWishRedeemedItem[] }>(
    `${APP_API_PREFIX}/wish-board/redeemed`,
    { method: 'GET', signal: opts?.signal },
  );
  return Array.isArray(data?.items) ? data.items : [];
}

export async function appWishBoardDeleteRedeemed(opts?: {
  id?: string;
  signal?: AbortSignal;
}): Promise<{ deleted?: number; ids?: string[] }> {
  const qs = opts?.id ? `?id=${encodeURIComponent(opts.id)}` : '';
  return apiRequest(`${APP_API_PREFIX}/wish-board/redeemed${qs}`, {
    method: 'DELETE',
    signal: opts?.signal,
  });
}

// —— 备忘录 AI ——

export async function appMemoAiReview(
  id: string,
  opts?: { signal?: AbortSignal },
): Promise<Record<string, unknown>> {
  return apiRequest(`${APP_API_PREFIX}/memos/${encodeURIComponent(id)}/ai-review`, {
    method: 'POST',
    signal: opts?.signal,
    skipGlobalLoading: true,
    perAttemptTimeoutMs: 60_000,
  });
}

// —— 健康摄入查询 ——

export async function appHealthGetMetrics(params: {
  date: string;
  user_id?: string;
  signal?: AbortSignal;
}): Promise<Record<string, unknown>> {
  const qs = buildQuery({ date: params.date, user_id: params.user_id });
  return apiRequest(`${APP_API_PREFIX}/health/metrics${qs}`, {
    method: 'GET',
    signal: params.signal,
  });
}

export async function appHealthListIntakesByDate(params: {
  date: string;
  user_id?: string;
  signal?: AbortSignal;
}): Promise<{ day_ymd?: string; user_id?: string; total?: number; items: Record<string, unknown>[] }> {
  const qs = buildQuery({ date: params.date, user_id: params.user_id });
  const data = await apiRequest<unknown>(`${APP_API_PREFIX}/health/intakes${qs}`, {
    method: 'GET',
    signal: params.signal,
  });
  return {
    ...asRecord(data),
    items: extractHealthIntakeItems(data).map(normalizeHealthRecordRow),
  };
}

export async function appHealthListIntakesLastDays(params: {
  days: 7 | 30;
  user_id?: string;
  signal?: AbortSignal;
}): Promise<Record<string, unknown>[]> {
  const path =
    params.days === 7
      ? `${APP_API_PREFIX}/health/intakes/last-7-days`
      : `${APP_API_PREFIX}/health/intakes/last-30-days`;
  const qs = buildQuery({ user_id: params.user_id });
  const data = await apiRequest<unknown>(`${path}${qs}`, {
    method: 'GET',
    signal: params.signal,
  });
  return extractHealthIntakeItems(data).map(normalizeHealthRecordRow);
}
