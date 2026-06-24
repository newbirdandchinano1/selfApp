/** 当前聚焦屏幕的 PAGE_API_KEY，供写入后向祖先页面传递刷新通知 */

let activePageApiKey: string | null = null;

export function setActivePageApiKey(pageKey: string | null): void {
  activePageApiKey = pageKey?.trim() || null;
}

export function clearActivePageApiKey(pageKey: string): void {
  if (activePageApiKey === pageKey.trim()) {
    activePageApiKey = null;
  }
}

export function getActivePageApiKey(): string | null {
  return activePageApiKey;
}
