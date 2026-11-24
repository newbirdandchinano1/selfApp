/**
 * 阶段 D3：page API 错误分类。
 * 区分 timeout / abort / 429 / 503 / 离线 / 业务 4xx，供骨架与重试策略使用。
 */
import { ApiRequestError } from '@/lib/api/http';
import { isAbortError } from '@/lib/cloud-fetch-retry';

export type PageApiErrorKind =
  | 'abort'
  | 'timeout'
  | 'rate_limit'
  | 'server_busy'
  | 'offline'
  | 'business_4xx'
  | 'unauthorized'
  | 'unknown';

function getHttpStatus(err: unknown): number | null {
  if (err instanceof ApiRequestError) return err.httpStatus;
  if (err && typeof err === 'object' && 'httpStatus' in err) {
    const n = Number((err as { httpStatus?: unknown }).httpStatus);
    return Number.isFinite(n) ? n : null;
  }
  if (err && typeof err === 'object' && 'status' in err) {
    const n = Number((err as { status?: unknown }).status);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err ?? '');
}

/** 用户主动取消（AbortSignal）——不报错、不 toast */
export function isPageApiAbortError(err: unknown): boolean {
  return isAbortError(err);
}

export function classifyPageApiError(err: unknown): PageApiErrorKind {
  if (isAbortError(err)) {
    // 单次请求超时在 fetchWithTimeoutAndRetry 里也会以 AbortError 抛出；
    // 外层 signal 未 abort 时视为 timeout。
    const msg = messageOf(err).toLowerCase();
    if (msg.includes('timeout') || msg.includes('timed out')) return 'timeout';
    return 'abort';
  }

  const status = getHttpStatus(err);
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 429) return 'rate_limit';
  if (status === 503) return 'server_busy';
  if (status === 408 || status === 504) return 'timeout';
  if (status != null && status >= 400 && status < 500) return 'business_4xx';

  const msg = messageOf(err).toLowerCase();
  if (
    msg.includes('network request failed') ||
    msg.includes('failed to fetch') ||
    msg.includes('network error') ||
    msg.includes('offline') ||
    msg.includes('enotfound') ||
    msg.includes('econnrefused')
  ) {
    return 'offline';
  }
  if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('etimedout')) {
    return 'timeout';
  }
  if (/服务器繁忙|同步繁忙/.test(messageOf(err))) return 'server_busy';

  return 'unknown';
}

/** abort 不提示；429/503 由 fetch 层短退避；业务 4xx 保留缓存可重试 */
export function shouldReportPageApiError(err: unknown): boolean {
  const kind = classifyPageApiError(err);
  return kind !== 'abort' && kind !== 'rate_limit' && kind !== 'server_busy';
}

export function isPageApiErrorRetryableKind(kind: PageApiErrorKind): boolean {
  return (
    kind === 'timeout' ||
    kind === 'rate_limit' ||
    kind === 'server_busy' ||
    kind === 'offline' ||
    kind === 'unknown'
  );
}
