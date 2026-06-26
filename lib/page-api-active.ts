/** 当前聚焦屏幕的 PAGE_API_KEY，供写入后向祖先页面传递刷新通知 */

type ActivePageListener = () => void;

let activePageApiKey: string | null = null;
const listeners = new Set<ActivePageListener>();

function notifyActivePageApiKeyListeners(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function subscribeActivePageApiKey(listener: ActivePageListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setActivePageApiKey(pageKey: string | null): void {
  const next = pageKey?.trim() || null;
  if (activePageApiKey === next) return;
  activePageApiKey = next;
  notifyActivePageApiKeyListeners();
}

export function clearActivePageApiKey(pageKey: string): void {
  const key = pageKey.trim();
  if (activePageApiKey === key) {
    activePageApiKey = null;
    notifyActivePageApiKeyListeners();
  }
}

export function getActivePageApiKey(): string | null {
  return activePageApiKey;
}
