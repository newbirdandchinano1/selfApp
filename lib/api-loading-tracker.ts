type ApiLoadingListener = () => void;

let pendingCount = 0;
const listeners = new Set<ApiLoadingListener>();

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
