import { isApiOnlyReads, isLocalFirstReads } from '@/lib/api-data-mode';
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
  health_records: [TAB_PAGE_KEYS.health, TAB_PAGE_KEYS.profile],
  users: [TAB_PAGE_KEYS.health, TAB_PAGE_KEYS.profile],
  tasks: [TAB_PAGE_KEYS.tasks],
  projects: [TAB_PAGE_KEYS.tasks],
  project_categories: [TAB_PAGE_KEYS.tasks],
  task_categories: [TAB_PAGE_KEYS.tasks],
  task_items: [TAB_PAGE_KEYS.tasks],
  task_execution_events: [TAB_PAGE_KEYS.tasks],
  frog_completion_events: [TAB_PAGE_KEYS.tasks],
  habits: [TAB_PAGE_KEYS.tasks],
  habit_contexts: [TAB_PAGE_KEYS.tasks],
  habit_check_ins: [TAB_PAGE_KEYS.tasks],
  accounts: [TAB_PAGE_KEYS.finance],
  account_transactions: [TAB_PAGE_KEYS.finance],
  finance_accounts: [TAB_PAGE_KEYS.finance],
  finance_account_types: [TAB_PAGE_KEYS.finance],
  finance_flow_categories: [TAB_PAGE_KEYS.finance],
  finance_transactions: [TAB_PAGE_KEYS.finance],
  savings_plans: [TAB_PAGE_KEYS.finance],
  savings_plan_deposits: [TAB_PAGE_KEYS.finance],
  cash_flow_profile: [TAB_PAGE_KEYS.finance],
  cash_flow_incomes: [TAB_PAGE_KEYS.finance],
  cash_flow_holdings: [TAB_PAGE_KEYS.finance],
  cash_flow_expense_lines: [TAB_PAGE_KEYS.finance],
  visions: [TAB_PAGE_KEYS.profile],
  goal_dimensions: [TAB_PAGE_KEYS.profile],
  wish_items: [TAB_PAGE_KEYS.profile],
  weekly_review_journal: [TAB_PAGE_KEYS.review],
  daily_review_journal: [TAB_PAGE_KEYS.review],
  earned_rewards: [TAB_PAGE_KEYS.profile],
  memo_dimensions: [TAB_PAGE_KEYS.profile],
  memos: [TAB_PAGE_KEYS.profile],
  user_weaknesses: [TAB_PAGE_KEYS.profile],
  user_skill_items: [TAB_PAGE_KEYS.profile],
  user_desired_skills: [TAB_PAGE_KEYS.profile],
  user_skills_meta: [TAB_PAGE_KEYS.profile],
  review_dimensions: [TAB_PAGE_KEYS.review],
  review_columns: [TAB_PAGE_KEYS.review],
  recipe_categories: [TAB_PAGE_KEYS.profile],
  recipe_items: [TAB_PAGE_KEYS.profile],
};

/** 已完成「接口 → 本地」同步的页面（跨重启持久化） */
const syncedPages = new Set<string>();

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
  if (preferLocalReads) return true;
  return syncedPages.has(pageKey);
}

/** 页面 focus 时是否可跳过数据重载（local-first 下仍会从本地 SQLite 重载，仅跳过 REST） */
export function shouldSkipPageFocusApiRefresh(pageKey: string): boolean {
  if (isLocalFirstReads()) return false;
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

/** 本地表写入后，按映射标记相关 Tab 主页面为 dirty（local-first 下跳过） */
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
  if (preferLocalReads || hasPageSyncedWithApi(pageKey)) {
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
  if (explicit?.localOnly) return true;
  return Boolean(getActivePageApiReadOpts()?.localOnly);
}

/** 非 React 组件内执行与 wrapLoad 等价的页面级读库策略 */
export async function runPageApiLoad(
  pageKey: string,
  fn: () => Promise<boolean | void>,
  forceApi = false,
): Promise<void> {
  const readOpts = resolvePageApiReadOpts(pageKey, forceApi);

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
