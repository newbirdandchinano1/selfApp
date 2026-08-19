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
  app_settings: [TAB_PAGE_KEYS.health],
  health_records: [TAB_PAGE_KEYS.health],
  users: [TAB_PAGE_KEYS.health, TAB_PAGE_KEYS.profile],
  habits: [TAB_PAGE_KEYS.tasks],
  habit_contexts: [TAB_PAGE_KEYS.tasks],
  habit_check_ins: [TAB_PAGE_KEYS.tasks],
  task_execution_events: [TAB_PAGE_KEYS.tasks],
  frog_completion_events: [TAB_PAGE_KEYS.tasks],
  // 财务表：dirty 仅用于 local-first 重读 SQLite；REST 走 /api/pages/finance/*，禁止 List
  finance_accounts: [TAB_PAGE_KEYS.finance],
  finance_account_types: [TAB_PAGE_KEYS.finance],
  finance_flow_categories: [TAB_PAGE_KEYS.finance],
  finance_transactions: [TAB_PAGE_KEYS.finance],
  cash_flow_profile: [TAB_PAGE_KEYS.finance],
  cash_flow_incomes: [TAB_PAGE_KEYS.finance],
  cash_flow_holdings: [TAB_PAGE_KEYS.finance],
  cash_flow_expense_lines: [TAB_PAGE_KEYS.finance],
  // 画像子页走 /api/pages/profile/*；dirty 仅用于 local-first 重读 SQLite
  visions: [TAB_PAGE_KEYS.profile],
  wish_items: [TAB_PAGE_KEYS.profile],
  points_wallet: [TAB_PAGE_KEYS.tasks],
  // 复盘表：dirty 仅用于 local-first 重读 SQLite；REST 走 /api/pages/review/*，禁止 List
  weekly_review_journal: [TAB_PAGE_KEYS.review],
  daily_review_journal: [TAB_PAGE_KEYS.review],
  monthly_review_journal: [TAB_PAGE_KEYS.review],
  review_dimensions: [TAB_PAGE_KEYS.review],
  review_columns: [TAB_PAGE_KEYS.review],
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

export function listPageScopeTables(pageKey: string): string[] {
  const key = pageKey.trim();
  if (!key) return [];
  // 任务 / 财务 / 复盘 / 我的 Tab 只走专用 page API，禁止通用 List 全表同步
  if (
    key === TAB_PAGE_KEYS.tasks ||
    key === TAB_PAGE_KEYS.finance ||
    key === TAB_PAGE_KEYS.review ||
    key === TAB_PAGE_KEYS.profile
  ) {
    return [];
  }
  return PAGE_SCOPE_TABLES[key] ? [...PAGE_SCOPE_TABLES[key]!] : [];
}

export function listAllTabPageKeys(): string[] {
  return Object.values(TAB_PAGE_KEYS);
}
