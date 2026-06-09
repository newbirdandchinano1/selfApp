import { isApiOnlyReads } from '@/lib/api-data-mode';

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
 * 子页面/深层页写入 SQLite 时经 markCloudSqliteTableDirty 触发，返回 Tab 时 useFocusEffect 会重新拉取。
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

/** 显式标记某个 Tab 主页面需在下次聚焦时从后端拉取 */
export function markTabPageDirty(tab: keyof typeof TAB_PAGE_KEYS): void {
  resetPageApiSession(TAB_PAGE_KEYS[tab]);
}

/** 本地表写入后，按映射标记相关 Tab 主页面为 dirty */
export function markTabPagesDirtyForTable(table: string): void {
  const pages = TABLE_TAB_DIRTY_MAP[table.trim()];
  if (!pages?.length) return;
  for (const key of pages) {
    resetPageApiSession(key);
  }
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
