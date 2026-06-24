import {
  formatApiErrorMessage,
  isApiErrorRetryable,
} from '@/lib/api-client';

type ApiLoadingListener = () => void;

export type ApiLoadingErrorState = {
  message: string;
  retryable: boolean;
};

let pendingCount = 0;
let loadingError: ApiLoadingErrorState | null = null;
const listeners = new Set<ApiLoadingListener>();
let focusedRetryTarget: (() => void) | null = null;

export function getApiLoadingPendingCount(): number {
  return pendingCount;
}

export function isApiLoadingActive(): boolean {
  return pendingCount > 0;
}

export function getApiLoadingError(): ApiLoadingErrorState | null {
  return loadingError;
}

export function subscribeApiLoading(listener: ApiLoadingListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notifyApiLoadingListeners(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function clearApiLoadingError(): void {
  if (!loadingError) return;
  loadingError = null;
  notifyApiLoadingListeners();
}

export function reportApiLoadingError(err: unknown): void {
  loadingError = {
    message: formatApiErrorMessage(err),
    retryable: isApiErrorRetryable(err),
  };
  notifyApiLoadingListeners();
}

export function beginApiLoading(): void {
  pendingCount += 1;
  notifyApiLoadingListeners();
}

export function endApiLoading(): void {
  pendingCount = Math.max(0, pendingCount - 1);
  notifyApiLoadingListeners();
}

export async function withApiLoading<T>(fn: () => Promise<T>): Promise<T> {
  beginApiLoading();
  clearApiLoadingError();
  try {
    const result = await fn();
    clearApiLoadingError();
    return result;
  } catch (e) {
    reportApiLoadingError(e);
    throw e;
  } finally {
    endApiLoading();
  }
}

/** 增删改等写请求：与读请求共用全局蒙层与错误提示 */
export async function withApiWriteLoading<T>(fn: () => Promise<T>): Promise<T> {
  return withApiLoading(fn);
}

/** 加载超时或用户重试时强制清零，避免计数与 UI 卡住 */
export function forceResetApiLoading(): void {
  if (pendingCount === 0 && !loadingError) return;
  pendingCount = 0;
  notifyApiLoadingListeners();
}

export function registerApiLoadingRetryTarget(target: () => void): () => void {
  focusedRetryTarget = target;
  return () => {
    if (focusedRetryTarget === target) focusedRetryTarget = null;
  };
}

function invokeFocusedApiLoadingRetryTarget(): void {
  if (!focusedRetryTarget) return;
  try {
    focusedRetryTarget();
  } catch (e) {
    if (__DEV__) console.warn('[api-loading] focused retry target failed', e);
  }
}

/** 加载失败或超时后重试：重置计数、作废进行中的 REST 读、清空页面同步标记并触发当前聚焦页 reload */
export async function retryStuckApiLoading(): Promise<void> {
  clearApiLoadingError();
  forceResetApiLoading();
  const { invalidateAllInflightApiTableFetches } = await import('@/lib/api-read');
  invalidateAllInflightApiTableFetches();
  const { resetPageApiSession, clearPageLoadedInSession } = await import('@/lib/page-api-session');
  clearPageLoadedInSession();
  resetPageApiSession(undefined, { force: true });
  invokeFocusedApiLoadingRetryTarget();
}
