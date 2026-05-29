import {
  clearApiAuthToken,
  getApiAuthToken,
  getApiBaseUrl,
  getApiPassword,
  getApiUsername,
  setApiAuthToken,
} from '@/lib/api-config';
import { fetchWithTimeoutAndRetry, isAbortError, throwIfAborted } from '@/lib/cloud-fetch-retry';

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

  constructor(message: string, httpStatus: number, apiCode: number) {
    super(message);
    this.name = 'ApiRequestError';
    this.httpStatus = httpStatus;
    this.apiCode = apiCode;
  }
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

  if (!envelope || envelope.code !== 0) {
    const message = envelope?.message || `登录失败：HTTP ${res.status}`;
    throw new ApiRequestError(message, res.status, envelope?.code ?? -1);
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

    if (res.status === 401) {
      throw new ApiUnauthorizedError();
    }

    const envelope = extractEnvelope(parsed);
    if (!envelope) {
      throw new ApiRequestError(
        `接口响应格式异常：HTTP ${res.status}`,
        res.status,
        -1,
      );
    }

    if (envelope.code !== 0) {
      throw new ApiRequestError(
        envelope.message || `请求失败：HTTP ${res.status}`,
        res.status,
        envelope.code,
      );
    }

    if (__DEV__ && text && res.status >= 400) {
      console.warn('[api]', method, path, text);
    }

    return envelope.data as T;
  };

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
}

export async function apiCreateRecord<T = unknown>(
  table: string,
  row: Record<string, unknown>,
  opts?: { signal?: AbortSignal },
): Promise<T> {
  return apiRequest<T>(`/api/data/${encodeURIComponent(table)}`, {
    method: 'POST',
    body: row,
    signal: opts?.signal,
  });
}

export async function apiUpdateRecord<T = unknown>(
  table: string,
  id: string,
  row: Record<string, unknown>,
  opts?: { signal?: AbortSignal },
): Promise<T> {
  return apiRequest<T>(`/api/data/${encodeURIComponent(table)}/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: row,
    signal: opts?.signal,
  });
}

export async function apiHealthCheck(opts?: { signal?: AbortSignal }): Promise<boolean> {
  const baseUrl = await getApiBaseUrl();
  throwIfAborted(opts?.signal);
  const res = await fetchWithTimeoutAndRetry(`${baseUrl}/health`, { method: 'GET' }, { signal: opts?.signal });
  return res.ok;
}
