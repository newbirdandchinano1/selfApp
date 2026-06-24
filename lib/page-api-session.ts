import { isApiOnlyReads, isLocalFirstReads } from '@/lib/api-data-mode';
import {
  PAGE_SYNC_META_KEY,
  PREFER_LOCAL_READS_META_KEY,
  REST_INITIAL_SYNC_META_KEY,
  clearPageSyncMeta,
  localDbHasSubstantialUserData,
  readAppMeta,
  writeAppMeta,
} from '@/lib/api-local-bootstrap';
import { TAB_PAGE_KEYS } from '@/lib/page-api-scope';

export { TAB_PAGE_KEYS, TABLE_TAB_DIRTY_MAP } from '@/lib/page-api-scope';

/** 已完成「接口 → 本地」同步的页面（跨重启持久化） */
const syncedPages = new Set<string>();

/** 首启引导完成后，读操作默认走本地（各页仍按 syncedPages 决定是否跳过 REST） */
let preferLocalReads = false;

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

const LEGACY_ALL_PAGES_SYNCED_META_KEY = 'legacy_all_pages_synced_v1';

async function migrateLegacyAllPagesSyncedIfNeeded(): Promise<void> {
  if ((await readAppMeta(LEGACY_ALL_PAGES_SYNCED_META_KEY)) === '1') return;
  if (syncedPages.size > 0) {
    await writeAppMeta(LEGACY_ALL_PAGES_SYNCED_META_KEY, '1');
    return;
  }
  if ((await readAppMeta(REST_INITIAL_SYNC_META_KEY)) !== '1') return;
  if (!(await localDbHasSubstantialUserData())) return;

  for (const pageKey of Object.values(TAB_PAGE_KEYS)) {
    syncedPages.add(pageKey);
  }
  schedulePersistSyncedPages();
  await writeAppMeta(LEGACY_ALL_PAGES_SYNCED_META_KEY, '1');
}

/** 启动时从 app_meta 恢复页面同步状态与本地优先读模式 */
export async function hydratePageApiSession(): Promise<void> {
  preferLocalReads = (await readAppMeta(PREFER_LOCAL_READS_META_KEY)) === '1';
  loadSyncedPagesFromJson(await readAppMeta(PAGE_SYNC_META_KEY));

  const hasSubstantialData = await localDbHasSubstantialUserData();
  if (!hasSubstantialData && syncedPages.size > 0) {
    syncedPages.clear();
    await clearPageSyncMeta();
  }

  await migrateLegacyAllPagesSyncedIfNeeded();
}

export function enablePreferLocalReads(): void {
  preferLocalReads = true;
}

export function isPreferLocalReads(): boolean {
  return preferLocalReads;
}

export function hasPageSyncedWithApi(pageKey: string): boolean {
  return syncedPages.has(pageKey);
}

/** 页面 focus 时是否可跳过数据重载（已同步页面保留内存状态，冷启动由 usePageFocusReload 补一次本地读） */
export function shouldSkipPageFocusApiRefresh(pageKey: string): boolean {
  return hasPageSyncedWithApi(pageKey);
}

export function markPageSyncedWithApi(pageKey: string): void {
  const key = pageKey.trim();
  if (!key) return;
  syncedPages.add(key);
  if (isLocalFirstReads()) schedulePersistSyncedPages();
}

export function resetPageApiSession(pageKey?: string): void {
  if (pageKey) {
    syncedPages.delete(pageKey);
    if (isLocalFirstReads()) schedulePersistSyncedPages();
    return;
  }
  syncedPages.clear();
  if (isLocalFirstReads()) schedulePersistSyncedPages();
}

/** 显式标记某个 Tab 主页面需在下次聚焦时从后端拉取 */
export function markTabPageDirty(tab: keyof typeof TAB_PAGE_KEYS): void {
  if (isLocalFirstReads()) return;
  resetPageApiSession(TAB_PAGE_KEYS[tab]);
}

/** 本地表写入后，按映射标记相关 Tab 主页面为 dirty（local-first 下保持已同步，避免重拉覆盖本地修改） */
export function markTabPagesDirtyForTable(table: string): void {
  if (isLocalFirstReads()) return;
  const pages = TABLE_TAB_DIRTY_MAP[table.trim()];
  if (!pages?.length) return;
  for (const key of pages) {
    resetPageApiSession(key);
  }
}

export type PageApiReadOpts = {
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
  if (forceApi) {
    return { localOnly: false, offlineFallback: true };
  }
  if (hasPageSyncedWithApi(pageKey)) {
    return { localOnly: true, offlineFallback: true };
  }
  return { localOnly: false, offlineFallback: true };
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
  if (explicit?.localOnly === true) return true;
  if (explicit?.localOnly === false) return false;

  const active = getActivePageApiReadOpts();
  if (active?.localOnly === true) return true;
  if (active?.localOnly === false) return false;

  // local-first：无显式 REST 上下文时默认读本地，避免 Tab 切换/辅助读表误触发全屏加载
  if (isLocalFirstReads()) return true;

  return false;
}

/** 非 React 组件内执行与 wrapLoad 等价的页面级读库策略 */
export async function runPageApiLoad(
  pageKey: string,
  fn: () => Promise<boolean | void>,
  forceApi = false,
): Promise<void> {
  let readOpts = resolvePageApiReadOpts(pageKey, forceApi);

  if (isLocalFirstReads() && !forceApi && !readOpts.localOnly) {
    const { listPageScopeTables } = await import('@/lib/page-api-scope');
    if (listPageScopeTables(pageKey).length > 0) {
      beginPageApiRead({ localOnly: false, offlineFallback: true });
      try {
        const { syncPageScopeFromApi } = await import('@/lib/api-page-sync');
        const scopeResult = await syncPageScopeFromApi(pageKey);
        if (scopeResult.ok) {
          markPageSyncedWithApi(pageKey);
          readOpts = resolvePageApiReadOpts(pageKey, forceApi);
        }
      } catch (e) {
        console.warn('[page-api-session] 页面范围同步失败，继续尝试读库', pageKey, e);
      } finally {
        endPageApiRead();
      }
    }
  }

  if (isLocalFirstReads() && !forceApi && !readOpts.localOnly) {
    beginPageApiRead({ localOnly: true, offlineFallback: true });
    try {
      await fn();
    } catch (e) {
      console.warn('[page-api-session] 本地预读失败，继续尝试 REST', pageKey, e);
    } finally {
      endPageApiRead();
    }
  }

  beginPageApiRead(readOpts);
  try {
    const ok = await fn();
    if (ok !== false && (isApiOnlyReads() || !readOpts.localOnly)) {
      markPageSyncedWithApi(pageKey);
    }
  } finally {
    endPageApiRead();
  }
}
