type ApiLoadingListener = () => void;

let pendingCount = 0;
const listeners = new Set<ApiLoadingListener>();
let focusedRetryTarget: (() => void) | null = null;

export function getApiLoadingPendingCount(): number {
  return pendingCount;
}

export function isApiLoadingActive(): boolean {
  return pendingCount > 0;
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
  try {
    return await fn();
  } finally {
    endApiLoading();
  }
}

/** 加载超时或用户重试时强制清零，避免计数与 UI 卡住 */
export function forceResetApiLoading(): void {
  if (pendingCount === 0) return;
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

/** 加载超时后重试：重置计数、作废进行中的 REST 读、清空页面同步标记并触发当前聚焦页 reload */
export async function retryStuckApiLoading(): Promise<void> {
  forceResetApiLoading();
  const { invalidateAllInflightApiTableFetches } = await import('@/lib/api-read');
  invalidateAllInflightApiTableFetches();
  const { resetPageApiSession } = await import('@/lib/page-api-session');
  resetPageApiSession();
  invokeFocusedApiLoadingRetryTarget();
}
