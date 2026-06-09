import { isApiOnlyReads } from '@/lib/api-data-mode';

/**
 * 本次 App 启动内：某页面是否已完成「接口 → 本地」首次同步（API_ONLY_READS 下仅用于标记已拉取过）。
 * 重启 App 后集合清空，各页再次首次打开时会重新请求接口。
 */
const syncedPages = new Set<string>();

export function hasPageSyncedWithApi(pageKey: string): boolean {
  return syncedPages.has(pageKey);
}

/** 页面 focus 时是否可跳过 REST 全量刷新（本会话已成功加载且未被 reset） */
export function shouldSkipPageFocusApiRefresh(pageKey: string): boolean {
  return hasPageSyncedWithApi(pageKey);
}

export function markPageSyncedWithApi(pageKey: string): void {
  if (!pageKey.trim()) return;
  syncedPages.add(pageKey);
}

export function resetPageApiSession(pageKey?: string): void {
  if (pageKey) {
    syncedPages.delete(pageKey);
    return;
  }
  syncedPages.clear();
}

export type PageApiReadOpts = {
  /** @deprecated API_ONLY_READS 下始终为 false */
  localOnly?: boolean;
  offlineFallback?: boolean;
};

/** 根据页面是否已同步，决定本次是否只读本地 */
export function resolvePageApiReadOpts(
  pageKey: string,
  forceApi?: boolean,
): { localOnly: boolean; offlineFallback: boolean } {
  if (isApiOnlyReads()) {
    return { localOnly: false, offlineFallback: false };
  }
  const localOnly = !forceApi && hasPageSyncedWithApi(pageKey);
  return { localOnly, offlineFallback: true };
}

const activePageReadStack: PageApiReadOpts[] = [];

/** 页面 load 期间设置，供 readApiTable / readApiRecord 隐式继承（支持并发嵌套） */
export function beginPageApiRead(opts: PageApiReadOpts): void {
  activePageReadStack.push(opts);
}

export function endPageApiRead(): void {
  activePageReadStack.pop();
}

export function getActivePageApiReadOpts(): PageApiReadOpts | undefined {
  if (activePageReadStack.length === 0) return undefined;
  const localOnly = activePageReadStack.every(entry => entry.localOnly === true);
  const offlineFallback = activePageReadStack.some(entry => entry.offlineFallback !== false);
  return { localOnly, offlineFallback };
}

export function resolveReadLocalOnly(explicit?: {
  localOnly?: boolean;
  forceRefresh?: boolean;
}): boolean {
  if (isApiOnlyReads()) return false;
  if (explicit?.forceRefresh) return false;
  if (explicit?.localOnly) return true;
  return Boolean(getActivePageApiReadOpts()?.localOnly);
}

/** 非 React 组件（子组件、useEffect）内执行与 wrapLoad 等价的页面级读库策略 */
export async function runPageApiLoad(
  pageKey: string,
  fn: () => Promise<boolean | void>,
  forceApi = false,
): Promise<void> {
  const readOpts = resolvePageApiReadOpts(pageKey, forceApi);
  beginPageApiRead(readOpts);
  try {
    const ok = await fn();
    if (ok !== false && (isApiOnlyReads() || !readOpts.localOnly)) markPageSyncedWithApi(pageKey);
  } finally {
    endPageApiRead();
  }
}
