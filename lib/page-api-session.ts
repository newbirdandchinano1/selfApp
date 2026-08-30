import { isApiOnlyReads, isLocalFirstReads } from '@/lib/api-data-mode';
import { ApiRequestError } from '@/lib/api-client';
import { getApiLoadingError, reportApiLoadingError } from '@/lib/api-loading-tracker';
import { syncPageScopeFromApi } from '@/lib/api-page-sync';
import { isSkeletonLoadingTabPageKey } from '@/lib/page-api-health-ui';
import { collectAncestorPageKeys } from '@/lib/page-api-ancestry';
import { runGuardedPageApiLoad } from '@/lib/page-api-load-guard';
import { listPageScopeTables } from '@/lib/page-api-scope';
import {
  PAGE_SYNC_META_KEY,
  PREFER_LOCAL_READS_META_KEY,
  localDbHasUserData,
  readAppMeta,
  writeAppMeta,
} from '@/lib/api-local-bootstrap';

/** 底部 Tab 主页面 pageKey，与 app/(tabs) 中 PAGE_API_KEY 一致 */
export const TAB_PAGE_KEYS = {
  health: 'tabs/index',
  tasks: 'tabs/tasks',
  finance: 'tabs/finance',
  review: 'tabs/review',
  profile: 'tabs/profile',
} as const;

type TabPageKey = (typeof TAB_PAGE_KEYS)[keyof typeof TAB_PAGE_KEYS];

/**
 * 本地表变更后需标记刷新的 Tab 主页面。
 * local-first 模式下本地写入已即时可见，不再重置页面同步状态强制重拉 REST。
 */
const TABLE_TAB_DIRTY_MAP: Record<string, TabPageKey[]> = {
  app_settings: [TAB_PAGE_KEYS.health, TAB_PAGE_KEYS.profile],
  health_records: [TAB_PAGE_KEYS.health, TAB_PAGE_KEYS.profile],
  users: [TAB_PAGE_KEYS.health, TAB_PAGE_KEYS.profile],
  projects: [TAB_PAGE_KEYS.tasks],
  project_categories: [TAB_PAGE_KEYS.tasks],
  tasks: [TAB_PAGE_KEYS.tasks],
  task_categories: [TAB_PAGE_KEYS.tasks],
  habits: [TAB_PAGE_KEYS.tasks],
  habit_contexts: [TAB_PAGE_KEYS.tasks],
  habit_check_ins: [TAB_PAGE_KEYS.tasks],
  task_execution_events: [TAB_PAGE_KEYS.tasks],
  frog_completion_events: [TAB_PAGE_KEYS.tasks],
  // 财务 dirty → local-first 重读；REST 走 /api/pages/finance/*（已从 page scope 移除 List）
  finance_accounts: [TAB_PAGE_KEYS.finance],
  finance_account_types: [TAB_PAGE_KEYS.finance],
  finance_flow_categories: [TAB_PAGE_KEYS.finance],
  finance_transactions: [TAB_PAGE_KEYS.finance],
  cash_flow_profile: [TAB_PAGE_KEYS.finance],
  cash_flow_incomes: [TAB_PAGE_KEYS.finance],
  cash_flow_holdings: [TAB_PAGE_KEYS.finance],
  cash_flow_expense_lines: [TAB_PAGE_KEYS.finance],
  savings_plans: [TAB_PAGE_KEYS.profile],
  savings_plan_deposits: [TAB_PAGE_KEYS.profile],
  visions: [TAB_PAGE_KEYS.profile],
  goal_dimensions: [TAB_PAGE_KEYS.profile],
  wish_items: [TAB_PAGE_KEYS.profile],
  points_wallet: [TAB_PAGE_KEYS.profile, TAB_PAGE_KEYS.tasks],
  wish_board_items: [TAB_PAGE_KEYS.profile],
  points_ledger: [TAB_PAGE_KEYS.profile],
  // 复盘 dirty → local-first 重读；REST 走 /api/pages/review/*（已从 page scope 移除 List）
  weekly_review_journal: [TAB_PAGE_KEYS.review],
  daily_review_journal: [TAB_PAGE_KEYS.review],
  monthly_review_journal: [TAB_PAGE_KEYS.review],
  memo_dimensions: [TAB_PAGE_KEYS.profile],
  memos: [TAB_PAGE_KEYS.profile],
  review_dimensions: [TAB_PAGE_KEYS.review],
  review_columns: [TAB_PAGE_KEYS.review],
  recipe_categories: [TAB_PAGE_KEYS.profile],
  recipe_items: [TAB_PAGE_KEYS.profile],
};

/** 本地表写入后需刷新的子页面（非 Tab 主页面） */
const TABLE_CHILD_PAGE_DIRTY_MAP: Record<string, string[]> = {
  habit_check_ins: ['habit-detail', 'habit-manage', 'tasks-calendar'],
  habits: ['habit-detail', 'habit-manage'],
  points_wallet: ['wish-board', 'edit-wish-board-item', 'points-ledger'],
  wish_board_items: ['wish-board', 'edit-wish-board-item'],
  points_ledger: ['wish-board', 'points-ledger'],
  memos: ['memo-list', 'memo-view'],
  memo_dimensions: ['memo-list'],
};

function markChildPagesDirtyForTable(table: string): void {
  const childPages = TABLE_CHILD_PAGE_DIRTY_MAP[table.trim()];
  if (!childPages?.length) return;
  for (const key of childPages) {
    const trimmed = key.trim();
    if (!trimmed) continue;
    clearPageLoadedInSession(trimmed);
    pagesNeedingRestRefresh.add(trimmed);
    resetPageApiSession(trimmed, { force: true });
  }
}

/** 本会话内已完成首次加载的页面（切换 Tab 不再重复全量 REST/重载） */
const sessionLoadedPages = new Set<string>();

/** 热会话内任务页 focus 最短重拉间隔，兼顾多端同步与频繁切 Tab */
const TASKS_FOCUS_REFRESH_COOLDOWN_MS = 8_000;
const pageLastFocusRefreshAtMs = new Map<string, number>();

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

/** 子页面写入后标记需从服务端全量重拉的页面（含祖先链） */
const pagesNeedingRestRefresh = new Set<string>();

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
  if (key === TAB_PAGE_KEYS.tasks) {
    pageLastFocusRefreshAtMs.set(key, Date.now());
  }
}

export function clearPageLoadedInSession(pageKey?: string): void {
  if (pageKey?.trim()) {
    const key = pageKey.trim();
    sessionLoadedPages.delete(key);
    pageLastFocusRefreshAtMs.delete(key);
    return;
  }
  sessionLoadedPages.clear();
  pageLastFocusRefreshAtMs.clear();
}

export function hasPageLoadedInSession(pageKey: string): boolean {
  return sessionLoadedPages.has(pageKey.trim());
}

export function pageNeedsRestRefresh(pageKey: string): boolean {
  return pagesNeedingRestRefresh.has(pageKey.trim());
}

/** 子页面数据变更：向所有祖先页面传递「下次聚焦需 REST 全量拉取」 */
export function notifyPageDataChanged(pageKey: string): void {
  const ancestors = collectAncestorPageKeys(pageKey);
  if (__DEV__ && ancestors.length > 0) {
    console.log('[page-api-session] 数据变更传递', pageKey, '→', ancestors);
  }
  for (const ancestor of ancestors) {
    const key = ancestor.trim();
    if (!key) continue;
    pagesNeedingRestRefresh.add(key);
    clearPageLoadedInSession(key);
    resetPageApiSession(key, { force: true });
  }
}

/**
 * local-first：子页面写入后仅通知祖先页下次聚焦重读本地 SQLite，不触发 REST 全量同步。
 */
export function notifyAncestorPagesLocalReload(pageKey: string): void {
  const ancestors = collectAncestorPageKeys(pageKey);
  if (__DEV__ && ancestors.length > 0) {
    console.log('[page-api-session] 本地数据变更', pageKey, '→', ancestors);
  }
  for (const ancestor of ancestors) {
    clearPageLoadedInSession(ancestor);
  }
}

export function markPageRestRefreshCompleted(pageKey: string): void {
  pagesNeedingRestRefresh.delete(pageKey.trim());
}

/** 首启全量同步完成或升级用户引导后，所有页面直接读本地 */
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

/** 启动时从 app_meta 恢复页面同步状态与本地优先读模式 */
export async function hydratePageApiSession(): Promise<void> {
  preferLocalReads = (await readAppMeta(PREFER_LOCAL_READS_META_KEY)) === '1';
  loadSyncedPagesFromJson(await readAppMeta(PAGE_SYNC_META_KEY));

  if (preferLocalReads || isApiOnlyReads()) return;

  if (await localDbHasUserData()) {
    preferLocalReads = true;
    await writeAppMeta(PREFER_LOCAL_READS_META_KEY, '1');
  }
}

export function enablePreferLocalReads(): void {
  preferLocalReads = true;
}

export function isPreferLocalReads(): boolean {
  return preferLocalReads;
}

export function hasPageSyncedWithApi(pageKey: string): boolean {
  return syncedPages.has(pageKey.trim());
}

/** 页面 focus 时是否可跳过数据重载（热会话 + 本会话已加载过；冷启动或待 REST 刷新则不跳过） */
export function shouldSkipPageFocusApiRefresh(pageKey: string): boolean {
  if (!warmProcessSession) return false;
  if (pageNeedsRestRefresh(pageKey)) return false;
  const key = pageKey.trim();
  // 任务页：多端完成/编辑需在再次聚焦时增量拉齐，不能整会话永久跳过
  if (key === TAB_PAGE_KEYS.tasks) {
    const last = pageLastFocusRefreshAtMs.get(key) ?? 0;
    return Date.now() - last < TASKS_FOCUS_REFRESH_COOLDOWN_MS;
  }
  if (isLocalFirstReads()) {
    return hasPageLoadedInSession(pageKey);
  }
  return hasPageSyncedWithApi(pageKey);
}

/** 已完成「接口 → 本地」同步的页面（跨重启持久化） */
const syncedPages = new Set<string>();

export function markPageSyncedWithApi(pageKey: string): void {
  const key = pageKey.trim();
  if (!key) return;
  syncedPages.add(key);
  if (isLocalFirstReads()) schedulePersistSyncedPages();
}

export function resetPageApiSession(pageKey?: string, opts?: { force?: boolean }): void {
  if (isLocalFirstReads() && !opts?.force) {
    return;
  }
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

/** 本地表写入后，按映射标记相关 Tab 主页面为 dirty */
export function markTabPagesDirtyForTable(table: string): void {
  const pages = TABLE_TAB_DIRTY_MAP[table.trim()];
  const childPages = TABLE_CHILD_PAGE_DIRTY_MAP[table.trim()];
  if (!pages?.length && !childPages?.length) return;
  if (isLocalFirstReads()) {
    // local-first：本地写入已即时可见，只清会话加载标记以便下次聚焦重读 SQLite。
    // 切勿对子页 force REST，否则会用服务端旧快照盖掉刚写入的 pending（如重置积分）。
    for (const key of pages ?? []) {
      clearPageLoadedInSession(key);
    }
    for (const key of childPages ?? []) {
      const trimmed = key.trim();
      if (trimmed) clearPageLoadedInSession(trimmed);
    }
    return;
  }
  for (const key of pages ?? []) {
    resetPageApiSession(key);
  }
  markChildPagesDirtyForTable(table);
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
  if (forceApi || pageNeedsRestRefresh(pageKey)) {
    return { localOnly: false, offlineFallback: false };
  }
  if (hasPageSyncedWithApi(pageKey)) {
    return { localOnly: true, offlineFallback: true };
  }
  return { localOnly: false, offlineFallback: false };
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

export function resolveReadLocalOnly(explicit?: {
  localOnly?: boolean;
  forceRefresh?: boolean;
}): boolean {
  if (isApiOnlyReads()) return false;
  if (explicit?.forceRefresh) return false;
  if (explicit?.localOnly) return true;
  return Boolean(getActivePageApiReadOpts()?.localOnly);
}

/** 页面级读库上下文禁止离线回退时，覆盖仓库层显式 offlineFallback: true */
export function resolveReadOfflineFallback(explicit?: boolean): boolean {
  const pageOpts = getActivePageApiReadOpts();
  if (pageOpts?.offlineFallback === false) return false;
  if (explicit === true) return true;
  if (explicit === false) return false;
  return pageOpts?.offlineFallback ?? false;
}

export async function runPageLoadBody(
  pageKey: string,
  fn: () => Promise<boolean | void | Record<string, unknown>>,
  readOpts: { localOnly: boolean; offlineFallback: boolean },
  forceApi: boolean,
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
    let ok: boolean | void;
    const scopeTables = listPageScopeTables(pageKey);

    if (!readOpts.localOnly && scopeTables.length > 0 && isLocalFirstReads()) {
      const sync = await syncPageScopeFromApi(pageKey);
      if (!sync.ok) {
        markPageLoadRestFailed();
        if (!getApiLoadingError() && !isSkeletonLoadingTabPageKey(pageKey)) {
          reportApiLoadingError(
            new ApiRequestError(sync.error ?? '页面数据同步失败', 0, -1, { retryable: true }),
          );
        }
        // 后端不可用时回退读本地缓存，避免骨架屏/启动态长时间阻塞
        beginPageApiRead({ localOnly: true, offlineFallback: true });
        try {
          ok = await invokeLoadFn();
        } finally {
          endPageApiRead();
        }
      } else {
        beginPageApiRead({ localOnly: true, offlineFallback: true });
        try {
          ok = await invokeLoadFn();
        } finally {
          endPageApiRead();
        }
      }
    } else {
      ok = await invokeLoadFn();
    }

    const restFailed = consumePageLoadRestFailed();
    return { ok, restFailed };
  } finally {
    endPageApiRead();
  }
}

export function finalizePageLoadSession(
  pageKey: string,
  readOpts: { localOnly: boolean },
  ok: boolean | void,
  restFailed: boolean,
): void {
  if (ok === false) {
    if (!getApiLoadingError() && !isSkeletonLoadingTabPageKey(pageKey)) {
      reportApiLoadingError(
        new ApiRequestError('页面数据加载失败', 0, -1, { retryable: true }),
      );
    }
    resetPageApiSession(pageKey, { force: true });
    return;
  }

  if (restFailed) {
    if (!getApiLoadingError() && !isSkeletonLoadingTabPageKey(pageKey)) {
      reportApiLoadingError(
        new ApiRequestError('无法连接服务器，当前显示本地数据', 0, -1, { retryable: true }),
      );
    }
    markPageLoadedInSession(pageKey);
    return;
  }

  if (isApiOnlyReads() || !readOpts.localOnly) {
    markPageSyncedWithApi(pageKey);
  }
  markPageLoadedInSession(pageKey);
  if (!readOpts.localOnly) {
    markPageRestRefreshCompleted(pageKey);
    markProcessWarmSession();
  }
}

/** 非 React 组件内执行与 wrapLoad 等价的页面级读库策略 */
export async function runPageApiLoad(
  pageKey: string,
  fn: () => Promise<boolean | void>,
  forceApi = false,
): Promise<void> {
  const readOpts = resolvePageApiReadOpts(pageKey, forceApi);
  const needsRest = isApiOnlyReads() || forceApi || !readOpts.localOnly;

  const execute = async () => {
    const { ok, restFailed } = await runPageLoadBody(pageKey, fn, readOpts, forceApi);
    finalizePageLoadSession(pageKey, readOpts, ok, restFailed);
  };

  if (needsRest) {
    await runGuardedPageApiLoad(pageKey, execute, {
      debounce: !forceApi && hasPageLoadedInSession(pageKey),
      force: forceApi,
    });
    return;
  }
  await execute();
}
