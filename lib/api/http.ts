/**
 * HTTP 底层：鉴权、信封解析、apiRequest、上传 body 准备。
 * 业务 endpoints / CRUD 由此调用；领域接口请放 api/endpoints/*。
 */

import {
    clearApiAuthToken,
    getApiAuthToken,
    getApiBaseUrl,
    getApiPassword,
    getApiUsername,
    setApiAuthToken,
} from '@/lib/api-config';
import { mapTableRowForMysqlApiUpload } from '@/lib/api-mysql-column-map';
import { formatWallClockDatetimeLocal, normalizeRecordForMysqlApi } from '@/lib/api-mysql-datetime';
import {
    type ApiUploadSlimOptions,
    slimRecordForMysqlApi,
} from '@/lib/api-mysql-payload';
import { enqueueApiRequest } from '@/lib/api-request-queue';
import { fetchWithTimeoutAndRetry, isAbortError, throwIfAborted } from '@/lib/cloud-fetch-retry';

export function prepareRowBodyForApi(
  table: string,
  row: Record<string, unknown>,
  opts?: ApiUploadSlimOptions,
): Record<string, unknown> {
  const mapped = mapTableRowForMysqlApiUpload(table, row);
  const normalized = normalizeRecordForMysqlApi(mapped, table) as Record<string, unknown>;
  /**
   * 积分钱包服务端用 updated_at 乐观锁，库内多为会话时区墙上时钟。
   * 通用 normalize 会把时间收成 UTC，东八区下会固定「旧 8 小时」而被永久拒绝。
   */
  if (table === 'points_wallet') {
    normalized.updated_at = formatWallClockDatetimeLocal(new Date());
  }
  return slimRecordForMysqlApi(normalized, opts);
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

/** upsert 流程中 POST 409 / 唯一约束冲突，上层会改走 PUT，不应弹全局错误 */
export function isDuplicateRecordApiError(err: unknown): boolean {
  return (
    err instanceof ApiRequestError &&
    (err.httpStatus === 409 || /已存在|duplicate|冲突|unique/i.test(err.message))
  );
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

export async function parseResponseBody(res: Response): Promise<{ parsed: unknown; text: string }> {
  const text = await res.text().catch(() => '');
  if (!text.trim()) return { parsed: null, text: '' };

  // 诊断日志：记录大响应的大小，帮助排查截断问题
  if (text.length > 50_000) {
    const contentLength = res.headers.get('Content-Length');
    console.log(
      `[api] 响应体大小: ${text.length} 字符` +
      (contentLength != null ? ` (Content-Length: ${contentLength})` : '') +
      ` ${res.url?.slice(-60)}`,
    );
  }

  try {
    return { parsed: JSON.parse(text) as unknown, text };
  } catch {
    // 首字符非 JSON（HTML/网关页/明文）或响应被截断
    const contentLength = res.headers.get('Content-Length');
    const head = text.trim().slice(0, 80).replace(/\s+/g, ' ');
    console.warn('[api] JSON 解析失败', {
      status: res.status,
      textLength: text.length,
      contentLength: contentLength ?? 'unknown',
      textHead: head,
      textTail: text.slice(-200),
    });
    const looksHtml = /^\s*</.test(text);
    throw new ApiRequestError(
      looksHtml
        ? `接口返回了非 JSON（疑似 HTML/网关错误，HTTP ${res.status}）`
        : `JSON 解析失败（HTTP ${res.status}，${text.length} 字符）：${head || '(空)'}`,
      res.status,
      -1,
      { retryable: true },
    );
  }
}

export function extractEnvelope(parsed: unknown): ApiEnvelope<unknown> | null {
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
  /**
   * 已在 apiRequest 队列内时跳过再入队，避免写队列重入死锁。
   * 独立调用登录仍走 write 队列。
   */
  skipQueue?: boolean;
}): Promise<string> {
  const run = async (): Promise<string> => {
    const baseUrl = await getApiBaseUrl();
    const username = opts?.username ?? (await getApiUsername());
    const password = opts?.password ?? (await getApiPassword());

    throwIfAborted(opts?.signal);

    const res = await fetchWithTimeoutAndRetry(
      `${baseUrl}/api/app/auth/login`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      },
      { signal: opts?.signal, perAttemptTimeoutMs: 8_000, maxAttempts: 2 },
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
  };

  if (opts?.skipQueue) return run();
  return enqueueApiRequest(run, { kind: 'write' });
}

export async function ensureApiLoggedIn(opts?: {
  signal?: AbortSignal;
  skipQueue?: boolean;
}): Promise<string> {
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
  /** 单次请求超时毫秒数，bootstrap 等大响应用更大的值 */
  perAttemptTimeoutMs?: number;
  /**
   * 不触发全局「正在同步数据…」全屏蒙层（后台任务、页面内自有 loading 时使用）。
   * `/api/app/ai/*` 默认视为耗时长的非阻塞请求，也会跳过蒙层。
   */
  skipGlobalLoading?: boolean;
};

/** App API 正式前缀。遗留 `/api/*`（非 `/api/admin`）在请求前改写到此前缀。 */
export const APP_API_PREFIX = '/api/app';

/**
 * 将遗留 App 路径 `/api/...` 规范为 `/api/app/...`。
 * 已是 `/api/app` / `/api/admin` 或绝对 URL 时原样返回。
 */
export function normalizeAppApiPath(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const q = path.indexOf('?');
  const pathname = q >= 0 ? path.slice(0, q) : path;
  const query = q >= 0 ? path.slice(q) : '';
  if (pathname === '/api/app' || pathname.startsWith('/api/app/')) return path;
  if (pathname === '/api/admin' || pathname.startsWith('/api/admin/')) return path;
  if (pathname === '/api' || pathname.startsWith('/api/')) {
    const rest = pathname === '/api' ? '' : pathname.slice('/api'.length);
    return `${APP_API_PREFIX}${rest}${query}`;
  }
  return path;
}

export async function apiRequest<T = unknown>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const baseUrl = await getApiBaseUrl();
  const normalizedPath = normalizeAppApiPath(path);
  const url = normalizedPath.startsWith('http')
    ? normalizedPath
    : `${baseUrl}${normalizedPath.startsWith('/') ? '' : '/'}${normalizedPath}`;
  const method = options.method ?? 'GET';
  const retryOnUnauthorized = options.retryOnUnauthorized ?? true;
  // 长耗时推理类 POST：不占 CRUD 写槽、不挂同步蒙层
  const isLongAiStylePost =
    /\/api(?:\/app)?\/ai(?:\/|$)/.test(normalizedPath) ||
    /\/memos\/[^/]+\/ai-review(?:\?|$)/.test(normalizedPath);
  const queueKind: 'read' | 'write' =
    method === 'GET' || isLongAiStylePost ? 'read' : 'write';

  const runOnce = async (token: string | null): Promise<T> => {
    throwIfAborted(options.signal);

    const headers: Record<string, string> = {};
    if (!options.skipAuth && token) {
      headers.Authorization = `Bearer ${token}`;
    }

    let requestBody: string | undefined;
    if (options.body !== undefined && options.body !== null) {
      // 已是 JSON 文本则不再二次 stringify（否则服务端收到的是字符串而非对象）
      requestBody =
        typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
      headers['Content-Type'] = 'application/json';
    }

    const res = await fetchWithTimeoutAndRetry(
      url,
      {
        method,
        headers,
        ...(requestBody !== undefined ? { body: requestBody } : {}),
      },
      { signal: options.signal, perAttemptTimeoutMs: options.perAttemptTimeoutMs },
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
      console.warn('[api]', method, normalizedPath, text);
    }

    return envelope.data as T;
  };

  const execute = async (): Promise<T> => {
    const runAuth = async (): Promise<T> => {
      try {
        // 已在外层队列内：登录不再入队，避免写队列重入死锁
        const token = options.skipAuth
          ? null
          : await ensureApiLoggedIn({ signal: options.signal, skipQueue: true });
        return await runOnce(token);
      } catch (e) {
        if (retryOnUnauthorized && e instanceof ApiUnauthorizedError && !options.skipAuth) {
          await clearApiAuthToken();
          const token = await apiLogin({ signal: options.signal, skipQueue: true });
          return runOnce(token);
        }
        if (isAbortError(e)) throw e;
        throw e;
      }
    };

    const skipOverlay =
      options.skipGlobalLoading === true || isLongAiStylePost;
    if (method !== 'GET' && !skipOverlay) {
      const { withApiWriteLoading, isApiWriteOverlaySuppressed } = await import(
        '@/lib/api-loading-tracker'
      );
      if (!isApiWriteOverlaySuppressed()) {
        return withApiWriteLoading(runAuth);
      }
    }
    return runAuth();
  };

  return enqueueApiRequest(execute, { kind: queueKind });
}
