/**
 * Cloud API 调用的网络层：超时、指数退避重试、AbortSignal（进入后台中止）。
 */

const DEFAULT_MAX_ATTEMPTS = 4;
const DEFAULT_BASE_DELAY_MS = 500;
const DEFAULT_MAX_DELAY_MS = 12_000;
const DEFAULT_PER_ATTEMPT_TIMEOUT_MS = 90_000;

export function isAbortError(e: unknown): boolean {
  if (typeof DOMException !== 'undefined' && e instanceof DOMException && e.name === 'AbortError') return true;
  if (e instanceof Error && e.name === 'AbortError') return true;
  return false;
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(t);
      if (signal) signal.removeEventListener('abort', onAbort);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const t = setTimeout(() => {
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    if (signal) {
      if (signal.aborted) {
        clearTimeout(t);
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

function clampDelay(base: number, attempt: number, maxDelay: number): number {
  const raw = base * 2 ** Math.max(0, attempt - 1);
  const jitter = 0.85 + Math.random() * 0.3;
  return Math.min(Math.round(raw * jitter), maxDelay);
}

function isRetryableHttpStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function isTransientNetworkFailure(e: unknown): boolean {
  if (isAbortError(e)) return false;
  if (e instanceof TypeError) return true;
  if (e instanceof Error) {
    const m = `${e.message} ${e.cause ?? ''}`.toLowerCase();
    if (
      m.includes('network') ||
      m.includes('failed to fetch') ||
      m.includes('network request failed') ||
      m.includes('timeout') ||
      m.includes('econnreset') ||
      m.includes('enotfound') ||
      m.includes('etimedout') ||
      m.includes('eai_again') ||
      m.includes('tls') ||
      m.includes('ssl')
    ) {
      return true;
    }
  }
  return false;
}

export type CloudFetchRetryOptions = {
  signal?: AbortSignal;
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  perAttemptTimeoutMs?: number;
};

/**
 * 带单次请求超时与可重试状态/网络错误的 fetch。
 * 不重试 4xx（除 408/429 等）与 2xx；429 会尊重 `Retry-After`（秒）上限 120s。
 */
export async function fetchWithTimeoutAndRetry(
  url: string,
  init: RequestInit,
  options: CloudFetchRetryOptions = {},
): Promise<Response> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const perAttemptTimeoutMs = options.perAttemptTimeoutMs ?? DEFAULT_PER_ATTEMPT_TIMEOUT_MS;
  const outerSignal = options.signal;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    throwIfAborted(outerSignal);

    const combined = new AbortController();
    const onOuterAbort = () => combined.abort();
    if (outerSignal) {
      if (outerSignal.aborted) throw new DOMException('Aborted', 'AbortError');
      outerSignal.addEventListener('abort', onOuterAbort);
    }
    const timeoutId = setTimeout(() => combined.abort(), perAttemptTimeoutMs);

    try {
      const res = await fetch(url, {
        ...init,
        signal: combined.signal,
      });
      clearTimeout(timeoutId);
      if (outerSignal) outerSignal.removeEventListener('abort', onOuterAbort);

      if (isRetryableHttpStatus(res.status) && attempt < maxAttempts) {
        let retryAfterMs = 0;
        if (res.status === 429) {
          const ra = res.headers.get('Retry-After');
          if (ra != null && /^\d+$/.test(ra.trim())) {
            retryAfterMs = Math.min(120_000, Number(ra.trim()) * 1000);
          }
        }
        await res.text().catch(() => '');
        const wait = Math.max(retryAfterMs, clampDelay(baseDelayMs, attempt, maxDelayMs));
        await sleep(wait, outerSignal);
        continue;
      }

      return res;
    } catch (e) {
      clearTimeout(timeoutId);
      if (outerSignal) outerSignal.removeEventListener('abort', onOuterAbort);

      if (isAbortError(e)) {
        if (outerSignal?.aborted) throw new DOMException('Aborted', 'AbortError');
        /* 单次超时：视为可重试 */
        lastError = e;
        if (attempt >= maxAttempts) throw e;
        const wait = clampDelay(baseDelayMs, attempt, maxDelayMs);
        await sleep(wait, outerSignal);
        continue;
      }

      if (isTransientNetworkFailure(e) && attempt < maxAttempts) {
        lastError = e;
        const wait = clampDelay(baseDelayMs, attempt, maxDelayMs);
        await sleep(wait, outerSignal);
        continue;
      }

      throw e;
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
