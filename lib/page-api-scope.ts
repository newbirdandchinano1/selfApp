/**
 * 页面 API 范围与脏标记映射的唯一来源。
 * page-api-session / ancestry / page-sync 均从此处引用，勿再各维护一份。
 */

/** 底部 Tab 主页面 pageKey，与 app/(tabs) 中 PAGE_API_KEY 一致 */
export const TAB_PAGE_KEYS = {
  health: 'tabs/index',
  tasks: 'tabs/tasks',
  finance: 'tabs/finance',
  review: 'tabs/review',
  profile: 'tabs/profile',
} as const;

export type TabPageKey = (typeof TAB_PAGE_KEYS)[keyof typeof TAB_PAGE_KEYS];

/**
 * 本地表变更后需标记刷新的 Tab 主页面。
 * local-first 下仅用于清会话加载标记、重读 SQLite；
 * 任务 / 财务 / 复盘 / 我的 REST 走专用 page API，禁止由本映射触发通用 List。
 */
export const TABLE_TAB_DIRTY_MAP: Record<string, TabPageKey[]> = {
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
  project_completion_logs: [TAB_PAGE_KEYS.tasks],
  finance_accounts: [TAB_PAGE_KEYS.finance],
  finance_account_types: [TAB_PAGE_KEYS.finance],
  finance_flow_categories: [TAB_PAGE_KEYS.finance],
  finance_scheduled_expenses: [TAB_PAGE_KEYS.finance],
  finance_transactions: [TAB_PAGE_KEYS.finance],
  cash_flow_profile: [TAB_PAGE_KEYS.finance],
  cash_flow_incomes: [TAB_PAGE_KEYS.finance],
  cash_flow_holdings: [TAB_PAGE_KEYS.finance],
  cash_flow_expense_lines: [TAB_PAGE_KEYS.finance],
  savings_plans: [TAB_PAGE_KEYS.profile],
  savings_plan_deposits: [TAB_PAGE_KEYS.profile],
  points_wallet: [TAB_PAGE_KEYS.profile, TAB_PAGE_KEYS.tasks],
  points_ledger: [TAB_PAGE_KEYS.profile],
  wish_board_items: [TAB_PAGE_KEYS.profile],
  weekly_review_journal: [TAB_PAGE_KEYS.review],
  daily_review_journal: [TAB_PAGE_KEYS.review],
  monthly_review_journal: [TAB_PAGE_KEYS.review],
  memos: [TAB_PAGE_KEYS.profile],
  review_dimensions: [TAB_PAGE_KEYS.review],
  review_columns: [TAB_PAGE_KEYS.review],
  recipe_categories: [TAB_PAGE_KEYS.profile],
  recipe_items: [TAB_PAGE_KEYS.profile],
};

/** 本地表写入后需刷新的子页面（非 Tab 主页面） */
export const TABLE_CHILD_PAGE_DIRTY_MAP: Record<string, string[]> = {
  habit_check_ins: ['habit-detail', 'habit-manage', 'tasks-calendar'],
  habits: ['habit-detail', 'habit-manage'],
  points_wallet: ['points-ledger', 'wish-board'],
  points_ledger: ['points-ledger', 'wish-board'],
  wish_board_items: ['wish-board'],
  memos: ['memo-list', 'memo-view', 'memo-edit'],
  tags: ['memo-list', 'memo-view', 'memo-edit'],
  tag_links: ['memo-list', 'memo-view', 'memo-edit'],
};

/** 走专用 page API、禁止通用 List 全表同步的 Tab */
const PAGE_API_ONLY_TABS: ReadonlySet<string> = new Set([
  TAB_PAGE_KEYS.tasks,
  TAB_PAGE_KEYS.finance,
  TAB_PAGE_KEYS.review,
  TAB_PAGE_KEYS.profile,
]);

export function isPageApiOnlyTab(pageKey: string): boolean {
  return PAGE_API_ONLY_TABS.has(pageKey.trim());
}

const PAGE_SCOPE_TABLES: Record<string, string[]> = (() => {
  const map = new Map<string, Set<string>>();
  for (const [table, pages] of Object.entries(TABLE_TAB_DIRTY_MAP)) {
    for (const pageKey of pages) {
      if (isPageApiOnlyTab(pageKey)) continue;
      if (!map.has(pageKey)) map.set(pageKey, new Set());
      map.get(pageKey)!.add(table);
    }
  }
  const out: Record<string, string[]> = {};
  for (const [pageKey, tables] of map.entries()) {
    out[pageKey] = [...tables];
  }
  return out;
})();

export function listPageScopeTables(pageKey: string): string[] {
  const key = pageKey.trim();
  if (!key || isPageApiOnlyTab(key)) return [];
  return PAGE_SCOPE_TABLES[key] ? [...PAGE_SCOPE_TABLES[key]!] : [];
}

export function listAllTabPageKeys(): string[] {
  return Object.values(TAB_PAGE_KEYS);
}
