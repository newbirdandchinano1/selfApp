import { ApiRequestError } from '@/lib/api-client';
import { getApiLoadingError, reportApiLoadingError } from '@/lib/api-loading-tracker';
import { syncPageScopeFromApi } from '@/lib/api-page-sync';
import { collectAncestorPageKeys } from '@/lib/page-api-ancestry';
import { runGuardedPageApiLoad } from '@/lib/page-api-load-guard';
import {
  TAB_PAGE_KEYS,
  TABLE_CHILD_PAGE_DIRTY_MAP,
  TABLE_TAB_DIRTY_MAP,
  listPageScopeTables,
} from '@/lib/page-api-scope';
import { PAGE_SYNC_META_KEY, readAppMeta, writeAppMeta } from '@/lib/api-local-bootstrap';

export { TAB_PAGE_KEYS } from '@/lib/page-api-scope';

/** 本会话内已完成首次渲染加载的页面（切 Tab 避免重复重渲染；≠ 数据有效） */
const sessionLoadedPages = new Set<string>();

/**
 * 进程是否为「热会话」：至少有一次页面 REST 加载成功后为 true。
 * 冷启动（新进程）为 false，Tab 二次聚焦必须走接口；热会话内同 Tab 可跳过。
 */
let warmProcessSession = false;

/** 新进程 / 冷启动：清空本会话加载标记，下次进 Tab 必须拉接口 */
export function markProcessColdStart(): void {
  warmProcessSession = false;
  clearPageLoadedInSession();
}

/** 本地库被清空后，任务页首次加载须强制全量 REST（catalog / projects 列表） */
let forceFullApiRefreshAfterLocalClear = false;

export function markForceFullApiRefreshAfterLocalClear(): void {
  forceFullApiRefreshAfterLocalClear = true;
}

/** 消费并清除「清库后须全量拉取」标记（仅生效一次） */
export function consumeForceFullApiRefreshAfterLocalClear(): boolean {
  const next = forceFullApiRefreshAfterLocalClear;
  forceFullApiRefreshAfterLocalClear = false;
  return next;
}

export function markProcessWarmSession(): void {
  warmProcessSession = true;
}

export function isWarmProcessSession(): boolean {
  return warmProcessSession;
}

// 新 JS 进程 / Web 刷新视为冷启动
markProcessColdStart();

/** REST 读取失败但已回退本地（wrapLoad 不应标记 synced） */
let pageLoadRestFailed = false;

export function markPageLoadRestFailed(): void {
  pageLoadRestFailed = true;
}

export function consumePageLoadRestFailed(): boolean {
  const failed = pageLoadRestFailed;
  pageLoadRestFailed = false;
  return failed;
}

export function markPageLoadedInSession(pageKey: string): void {
  const key = pageKey.trim();
  if (!key) return;
  sessionLoadedPages.add(key);
}

export function clearPageLoadedInSession(
  pageKey?: string,
  _opts?: { preserveFocusCooldown?: boolean },
): void {
  if (pageKey?.trim()) {
    sessionLoadedPages.delete(pageKey.trim());
    return;
  }
  sessionLoadedPages.clear();
}

export function hasPageLoadedInSession(pageKey: string): boolean {
  return sessionLoadedPages.has(pageKey.trim());
}

/**
 * server-authoritative：子页面写入后仅通知祖先页下次聚焦重读本地 SQLite，不触发 REST 全量同步。
 */
export function notifyPageDataChanged(pageKey: string): void {
  const ancestors = collectAncestorPageKeys(pageKey);
  if (__DEV__ && ancestors.length > 0) {
    console.log('[page-api-session] 本地数据变更', pageKey, '→', ancestors);
  }
  for (const ancestor of ancestors) {
    clearPageLoadedInSession(ancestor, { preserveFocusCooldown: true });
  }
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;

function schedulePersistSyncedPages(): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void persistSyncedPagesNow();
  }, 300);
}

async function persistSyncedPagesNow(): Promise<void> {
  try {
    await writeAppMeta(PAGE_SYNC_META_KEY, JSON.stringify([...syncedPages].sort()));
  } catch (e) {
    console.warn('[page-api-session] 持久化页面同步状态失败', e);
  }
}

function loadSyncedPagesFromJson(raw: string | null): void {
  if (!raw?.trim()) return;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return;
    for (const item of parsed) {
      if (typeof item === 'string' && item.trim()) syncedPages.add(item.trim());
    }
  } catch {
    /* ignore corrupt meta */
  }
}

/** 启动时恢复页面会话标记；是否打网由本次请求决定，不靠持久化跳过。 */
export async function hydratePageApiSession(): Promise<void> {
  loadSyncedPagesFromJson(await readAppMeta(PAGE_SYNC_META_KEY));
  try {
    const { hydrateBootstrapDoneCache } = await import('@/lib/sync-bootstrap');
    await hydrateBootstrapDoneCache();
  } catch {
    /* bootstrap cache 非关键 */
  }
}

export function hasPageLoadedFromServer(pageKey: string): boolean {
  return syncedPages.has(pageKey.trim());
}

/** 页面 focus 时是否跳过 UI 重载（本会话已渲染；与 REST / bootstrap 无关） */
export function shouldSkipPageFocusApiRefresh(pageKey: string): boolean {
  return hasPageLoadedInSession(pageKey);
}

/** 已完成「接口 → 本地」同步的页面（跨重启持久化；不决定是否打网） */
const syncedPages = new Set<string>();

export function markPageLoadedFromServer(pageKey: string): void {
  const key = pageKey.trim();
  if (!key) return;
  syncedPages.add(key);
  schedulePersistSyncedPages();
}

export function resetPageApiSession(pageKey?: string, _opts?: { force?: boolean }): void {
  if (pageKey) {
    syncedPages.delete(pageKey);
    clearPageLoadedInSession(pageKey);
    schedulePersistSyncedPages();
    return;
  }
  syncedPages.clear();
  clearPageLoadedInSession();
  schedulePersistSyncedPages();
}

/** 显式标记某个 Tab 主页面需在下次聚焦时重载 */
export function markTabPageDirty(tab: keyof typeof TAB_PAGE_KEYS): void {
  resetPageApiSession(TAB_PAGE_KEYS[tab]);
}

/** 本地表写入后，按映射标记相关 Tab 主页面为 dirty */
export function markTabPagesDirtyForTable(table: string): void {
  const pages = TABLE_TAB_DIRTY_MAP[table.trim()];
  const childPages = TABLE_CHILD_PAGE_DIRTY_MAP[table.trim()];
  if (!pages?.length && !childPages?.length) return;
  for (const key of pages ?? []) {
    clearPageLoadedInSession(key, { preserveFocusCooldown: true });
  }
  for (const key of childPages ?? []) {
    const trimmed = key.trim();
    if (trimmed) clearPageLoadedInSession(trimmed, { preserveFocusCooldown: true });
  }
}

export type PageApiReadOpts = {
  forceRefresh?: boolean;
};

/**
 * 是否应只读本地。bootstrap_done 之后（及之前的首屏）默认 SQLite；
 * 禁止用 hasSynced / sessionLoaded / RestRefresh 决定打网。
 */
export function shouldReadPageFromServer(input: {
  forceRefresh?: boolean;
  isApiOnly?: boolean;
  needsRestRefresh?: boolean;
  hasSynced?: boolean;
  isPageApiOnly?: boolean;
  scopeTableCount?: number;
}): boolean {
  if (input.isApiOnly) return false;
  if (input.forceRefresh) return false;
  return true;
}

/** wrapLoad 一律打网；forceRefresh 仅表示忽略 inflight 重新请求 */
export function resolvePageApiReadOpts(_pageKey: string, _forceRefresh?: boolean): { forceRefresh: boolean } {
  return { forceRefresh: Boolean(_forceRefresh) };
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
  return activePageReadStack[activePageReadStack.length - 1];
}

export function resolveReadCacheOnly(): boolean {
  return false;
}

/** 历史兼容：仓库层不再做离线回退，恒为不回退 */
export function resolveReadServerFallback(): boolean {
  return false;
}

export async function runPageLoadBody(
  pageKey: string,
  fn: () => Promise<boolean | void | Record<string, unknown>>,
  readOpts: { forceRefresh?: boolean },
  _forceRefresh: boolean,
): Promise<{ ok: boolean | void | Record<string, unknown>; restFailed: boolean }> {
  const invokeLoadFn = async (): Promise<boolean | void | Record<string, unknown>> => {
    try {
      return await fn();
    } catch (e) {
      if (!getApiLoadingError()) {
        reportApiLoadingError(e);
      }
      return false;
    }
  };

  beginPageApiRead(readOpts);
  try {
    const scopeTables = listPageScopeTables(pageKey);
    if (scopeTables.length > 0) {
      const sync = await syncPageScopeFromApi(pageKey);
      if (!sync.ok) {
        markPageLoadRestFailed();
        if (!getApiLoadingError()) {
          reportApiLoadingError(
            new ApiRequestError(sync.error ?? '页面数据加载失败', 0, -1, { retryable: true }),
          );
        }
        return { ok: false, restFailed: true };
      }
    }
    const ok = await invokeLoadFn();
    const restFailed = consumePageLoadRestFailed();
    return { ok, restFailed };
  } finally {
    endPageApiRead();
  }
}

export function finalizePageLoadSession(
  pageKey: string,
  _readOpts: { forceRefresh?: boolean },
  ok: boolean | void,
  restFailed: boolean,
): void {
  if (ok === false) {
    if (!getApiLoadingError()) {
      reportApiLoadingError(
        new ApiRequestError('页面数据加载失败', 0, -1, { retryable: true }),
      );
    }
    resetPageApiSession(pageKey, { force: true });
    return;
  }

  if (restFailed) {
    if (!getApiLoadingError()) {
      reportApiLoadingError(
        new ApiRequestError('无法连接服务器，请检查网络后重试', 0, -1, { retryable: true }),
      );
    }
    resetPageApiSession(pageKey, { force: true });
    return;
  }

  markPageLoadedFromServer(pageKey);
  markPageLoadedInSession(pageKey);
  markProcessWarmSession();
}

/** 非 React 组件内执行与 wrapLoad 等价的页面级读库策略：一律打网 */
export async function runPageApiLoad(
  pageKey: string,
  fn: () => Promise<boolean | void>,
  forceRefresh = false,
): Promise<void> {
  const readOpts = resolvePageApiReadOpts(pageKey, forceRefresh);

  const execute = async () => {
    const { ok, restFailed } = await runPageLoadBody(pageKey, fn, readOpts, forceRefresh);
    finalizePageLoadSession(pageKey, readOpts, ok, restFailed);
  };

  await runGuardedPageApiLoad(pageKey, execute, {
    debounce: !forceRefresh && hasPageLoadedInSession(pageKey),
    force: forceRefresh,
  });
}







