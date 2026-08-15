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
 */
export const TABLE_TAB_DIRTY_MAP: Record<string, TabPageKey[]> = {
  app_settings: [TAB_PAGE_KEYS.health, TAB_PAGE_KEYS.profile],
  health_records: [TAB_PAGE_KEYS.health, TAB_PAGE_KEYS.profile],
  users: [TAB_PAGE_KEYS.health, TAB_PAGE_KEYS.profile],
  habits: [TAB_PAGE_KEYS.tasks],
  habit_contexts: [TAB_PAGE_KEYS.tasks],
  habit_check_ins: [TAB_PAGE_KEYS.tasks],
  task_execution_events: [TAB_PAGE_KEYS.tasks],
  frog_completion_events: [TAB_PAGE_KEYS.tasks],
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
  points_wallet: [TAB_PAGE_KEYS.profile, TAB_PAGE_KEYS.tasks],
  wish_board_items: [TAB_PAGE_KEYS.profile],
  points_ledger: [TAB_PAGE_KEYS.profile],
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

const PAGE_SCOPE_TABLES: Record<string, string[]> = (() => {
  const map = new Map<string, Set<string>>();
  for (const [table, pages] of Object.entries(TABLE_TAB_DIRTY_MAP)) {
    for (const pageKey of pages) {
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

/** 非 Tab 子页面需单独拉取的表 scope */
const CHILD_PAGE_SCOPE_TABLES: Record<string, string[]> = {
  'wish-board': ['points_wallet', 'wish_board_items', 'points_ledger'],
  'add-wish-board-item': ['wish_board_items'],
  'edit-wish-board-item': ['wish_board_items', 'points_wallet'],
};

export function listPageScopeTables(pageKey: string): string[] {
  const key = pageKey.trim();
  if (!key) return [];
  const child = CHILD_PAGE_SCOPE_TABLES[key];
  if (child) return [...child];
  return PAGE_SCOPE_TABLES[key] ? [...PAGE_SCOPE_TABLES[key]!] : [];
}

export function listAllTabPageKeys(): string[] {
  return Object.values(TAB_PAGE_KEYS);
}
