import {
  clearApiAuthToken,
  getApiAuthToken,
  getApiBaseUrl,
  getApiPassword,
  getApiUsername,
  setApiAuthToken,
} from '@/lib/api-config';
import { normalizeRecordForMysqlApi } from '@/lib/api-mysql-datetime';
import { mapTableRowForMysqlApiUpload } from '@/lib/api-mysql-column-map';
import {
  type ApiUploadSlimOptions,
  slimRecordForMysqlApi,
} from '@/lib/api-mysql-payload';
import { fetchWithTimeoutAndRetry, isAbortError, throwIfAborted } from '@/lib/cloud-fetch-retry';
import { enqueueApiRequest } from '@/lib/api-request-queue';

export function prepareRowBodyForApi(
  table: string,
  row: Record<string, unknown>,
  opts?: ApiUploadSlimOptions,
): Record<string, unknown> {
  const mapped = mapTableRowForMysqlApiUpload(table, row);
  return slimRecordForMysqlApi(normalizeRecordForMysqlApi(mapped), opts);
}

/** 上传失败时依次尝试更小 payload（避免网关 413） */
function buildApiUploadBodies(table: string, row: Record<string, unknown>): Record<string, unknown>[] {
  return [
    prepareRowBodyForApi(table, row),
    prepareRowBodyForApi(table, row, { aggressive: true, maxBytes: 24_000 }),
    prepareRowBodyForApi(table, row, { aggressive: true, ultra: true, maxBytes: 8_000 }),
  ];
}

function isEntityTooLargeError(err: unknown): boolean {
  return (
    err instanceof ApiRequestError &&
    (err.httpStatus === 413 || /entity too large/i.test(err.message))
  );
}

type ApiEnvelope<T> = {
  code: number;
  message: string;
  data: T | null;
};

export class ApiUnauthorizedError extends Error {
  constructor(message = '未登录或 Token 已过期') {
    super(message);
    this.name = 'ApiUnauthorizedError';
  }
}

export class ApiRequestError extends Error {
  readonly httpStatus: number;
  readonly apiCode: number;
  readonly retryable: boolean;
  readonly retryAfterSec?: number;

  constructor(
    message: string,
    httpStatus: number,
    apiCode: number,
    opts?: { retryable?: boolean; retryAfterSec?: number },
  ) {
    super(message);
    this.name = 'ApiRequestError';
    this.httpStatus = httpStatus;
    this.apiCode = apiCode;
    this.retryable = opts?.retryable ?? false;
    this.retryAfterSec = opts?.retryAfterSec;
  }
}

/** 按规范：HTTP 200 且 body.code === 0 为成功 */
export function isApiResponseSuccess(httpStatus: number, apiCode: number): boolean {
  return httpStatus === 200 && apiCode === 0;
}

export function formatApiErrorMessage(err: unknown): string {
  if (err instanceof ApiRequestError || err instanceof ApiUnauthorizedError) {
    return err.message;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

export function isApiErrorRetryable(err: unknown): boolean {
  if (err instanceof ApiRequestError) return err.retryable;
  if (err instanceof ApiUnauthorizedError) return true;
  if (isAbortError(err)) return true;
  return true;
}

function serializeUnknownError(err: unknown): string {
  if (err instanceof Error) {
    const lines = [`${err.name}: ${err.message}`];
    if (typeof err.stack === 'string' && err.stack.trim()) lines.push(err.stack);
    return lines.join('\n');
  }
  try {
    return JSON.stringify(err, null, 2);
  } catch {
    return String(err);
  }
}

export function serializeApiErrorForDiagnostic(err: unknown): string {
  return serializeUnknownError(err);
}

async function parseResponseBody(res: Response): Promise<{ parsed: unknown; text: string }> {
  const text = await res.text().catch(() => '');
  if (!text.trim()) return { parsed: null, text: '' };
  try {
    return { parsed: JSON.parse(text) as unknown, text };
  } catch {
    return { parsed: { raw: text }, text };
  }
}

function extractEnvelope(parsed: unknown): ApiEnvelope<unknown> | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const o = parsed as Record<string, unknown>;
  if (typeof o.code !== 'number') return null;
  return {
    code: o.code,
    message: typeof o.message === 'string' ? o.message : '',
    data: (o.data ?? null) as unknown,
  };
}

export async function apiLogin(opts?: {
  signal?: AbortSignal;
  username?: string;
  password?: string;
}): Promise<string> {
  const baseUrl = await getApiBaseUrl();
  const username = opts?.username ?? (await getApiUsername());
  const password = opts?.password ?? (await getApiPassword());

  throwIfAborted(opts?.signal);

  const res = await fetchWithTimeoutAndRetry(
    `${baseUrl}/api/auth/login`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    },
    { signal: opts?.signal },
  );

  const { parsed, text } = await parseResponseBody(res);
  const envelope = extractEnvelope(parsed);

  if (!envelope || !isApiResponseSuccess(res.status, envelope.code)) {
    const message = envelope?.message || `登录失败：HTTP ${res.status}`;
    throw new ApiRequestError(message, res.status, envelope?.code ?? -1, {
      retryable: res.status >= 500,
    });
  }

  const token = (envelope.data as { token?: string } | null)?.token;
  if (!token) {
    throw new ApiRequestError('登录响应缺少 token', res.status, envelope.code);
  }

  await setApiAuthToken(token);
  return token;
}

export async function ensureApiLoggedIn(opts?: { signal?: AbortSignal }): Promise<string> {
  const existing = await getApiAuthToken();
  if (existing) return existing;
  return apiLogin(opts);
}

type ApiRequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  skipAuth?: boolean;
  retryOnUnauthorized?: boolean;
};

export async function apiRequest<T = unknown>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const baseUrl = await getApiBaseUrl();
  const url = path.startsWith('http') ? path : `${baseUrl}${path.startsWith('/') ? '' : '/'}${path}`;
  const method = options.method ?? 'GET';
  const retryOnUnauthorized = options.retryOnUnauthorized ?? true;

  const runOnce = async (token: string | null): Promise<T> => {
    throwIfAborted(options.signal);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (!options.skipAuth && token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const res = await fetchWithTimeoutAndRetry(
      url,
      {
        method,
        headers,
        ...(options.body != null ? { body: JSON.stringify(options.body) } : {}),
      },
      { signal: options.signal },
    );

    const { parsed, text } = await parseResponseBody(res);

    const envelope = extractEnvelope(parsed);

    if (res.status === 401) {
      await clearApiAuthToken();
      const message = envelope?.message?.trim() || '请先登录';
      throw new ApiUnauthorizedError(message);
    }

    if (res.status === 413 || /entity too large/i.test(text)) {
      throw new ApiRequestError(
        envelope?.message?.trim() || 'request entity too large',
        413,
        envelope?.code ?? -1,
      );
    }

    if (!envelope) {
      throw new ApiRequestError(
        `接口响应格式异常：HTTP ${res.status}`,
        res.status,
        -1,
        { retryable: res.status >= 500 },
      );
    }

    if (!isApiResponseSuccess(res.status, envelope.code)) {
      const retryable = res.status === 500 || res.status === 502 || res.status === 503;
      let retryAfterSec: number | undefined;
      if (res.status === 503) {
        const ra = res.headers.get('Retry-After');
        if (ra != null && /^\d+$/.test(ra.trim())) {
          retryAfterSec = parseInt(ra.trim(), 10);
        }
      }
      throw new ApiRequestError(
        envelope.message || `请求失败：HTTP ${res.status}`,
        res.status,
        envelope.code,
        { retryable, retryAfterSec },
      );
    }

    if (__DEV__ && text && res.status >= 400) {
      console.warn('[api]', method, path, text);
    }

    return envelope.data as T;
  };

  const execute = async (): Promise<T> => {
    const runAuth = async (): Promise<T> => {
      try {
        const token = options.skipAuth ? null : await ensureApiLoggedIn({ signal: options.signal });
        return await runOnce(token);
      } catch (e) {
        if (retryOnUnauthorized && e instanceof ApiUnauthorizedError && !options.skipAuth) {
          await clearApiAuthToken();
          const token = await apiLogin({ signal: options.signal });
          return runOnce(token);
        }
        if (isAbortError(e)) throw e;
        throw e;
      }
    };

    if (method !== 'GET') {
      const { withApiWriteLoading } = await import('@/lib/api-loading-tracker');
      return withApiWriteLoading(runAuth);
    }
    return runAuth();
  };

  return enqueueApiRequest(execute);
}

export async function apiCreateRecord<T = unknown>(
  table: string,
  row: Record<string, unknown>,
  opts?: { signal?: AbortSignal },
): Promise<T> {
  const bodies = buildApiUploadBodies(table, row);

  let lastError: unknown;
  for (let i = 0; i < bodies.length; i++) {
    try {
      return await apiRequest<T>(`/api/data/${encodeURIComponent(table)}`, {
        method: 'POST',
        body: bodies[i],
        signal: opts?.signal,
      });
    } catch (e) {
      lastError = e;
      if (i < bodies.length - 1 && isEntityTooLargeError(e)) continue;
      throw e;
    }
  }
  throw lastError;
}

export async function apiUpdateRecord<T = unknown>(
  table: string,
  id: string,
  row: Record<string, unknown>,
  opts?: { signal?: AbortSignal },
): Promise<T> {
  const bodies = buildApiUploadBodies(table, row);

  let lastError: unknown;
  for (let i = 0; i < bodies.length; i++) {
    try {
      return await apiRequest<T>(`/api/data/${encodeURIComponent(table)}/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: bodies[i],
        signal: opts?.signal,
      });
    } catch (e) {
      lastError = e;
      if (i < bodies.length - 1 && isEntityTooLargeError(e)) continue;
      throw e;
    }
  }
  throw lastError;
}

export async function apiPatchRecord<T = unknown>(
  table: string,
  id: string,
  row: Record<string, unknown>,
  opts?: { signal?: AbortSignal },
): Promise<T> {
  return apiRequest<T>(`/api/data/${encodeURIComponent(table)}/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: prepareRowBodyForApi(table, row),
    signal: opts?.signal,
  });
}

export async function apiDeleteRecord(
  table: string,
  id: string,
  opts?: { signal?: AbortSignal },
): Promise<void> {
  await apiRequest<null>(`/api/data/${encodeURIComponent(table)}/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    signal: opts?.signal,
  });
}

export type ApiListPagination = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

export type ApiListResponse<T> = {
  list: T[];
  pagination: ApiListPagination;
};

function buildListQuery(opts?: {
  page?: number;
  limit?: number;
  includeDeleted?: boolean;
}): string {
  const params = new URLSearchParams();
  if (opts?.page != null) params.set('page', String(opts.page));
  if (opts?.limit != null) params.set('limit', String(opts.limit));
  if (opts?.includeDeleted === true) params.set('includeDeleted', 'true');
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export async function apiListRecords<T extends Record<string, unknown>>(
  table: string,
  opts?: {
    page?: number;
    limit?: number;
    includeDeleted?: boolean;
    signal?: AbortSignal;
  },
): Promise<ApiListResponse<T>> {
  const data = await apiRequest<ApiListResponse<T>>(
    `/api/data/${encodeURIComponent(table)}${buildListQuery(opts)}`,
    { method: 'GET', signal: opts?.signal },
  );
  return {
    list: Array.isArray(data?.list) ? data.list : [],
    pagination: data?.pagination ?? {
      page: opts?.page ?? 1,
      limit: opts?.limit ?? 50,
      total: 0,
      totalPages: 0,
    },
  };
}

export async function apiGetRecord<T extends Record<string, unknown>>(
  table: string,
  id: string,
  opts?: { signal?: AbortSignal },
): Promise<T> {
  return apiRequest<T>(`/api/data/${encodeURIComponent(table)}/${encodeURIComponent(id)}`, {
    method: 'GET',
    signal: opts?.signal,
  });
}

export type ApiTableMetaRow = {
  name?: string;
  table?: string;
  primaryKey?: string;
  primary_key?: string;
  hasDeletedAt?: boolean;
  has_deleted_at?: boolean;
  columns?: string[];
};

export async function apiGetTablesMeta(signal?: AbortSignal): Promise<ApiTableMetaRow[]> {
  const data = await apiRequest<ApiTableMetaRow[] | { tables?: ApiTableMetaRow[] }>('/api/tables', {
    method: 'GET',
    signal,
  });
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object' && Array.isArray((data as { tables?: ApiTableMetaRow[] }).tables)) {
    return (data as { tables: ApiTableMetaRow[] }).tables;
  }
  return [];
}

export async function apiHealthCheck(opts?: { signal?: AbortSignal }): Promise<boolean> {
  const baseUrl = await getApiBaseUrl();
  throwIfAborted(opts?.signal);
  const res = await fetchWithTimeoutAndRetry(`${baseUrl}/health`, { method: 'GET' }, { signal: opts?.signal });
  const { parsed } = await parseResponseBody(res);
  const envelope = extractEnvelope(parsed);
  return isApiResponseSuccess(res.status, envelope?.code ?? -1);
}
