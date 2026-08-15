/** 服务端 ALLOWED_TABLES，与后端 src/config/tables.ts 对齐 */
export const API_ALLOWED_TABLES = new Set([
  'account_transactions',
  'accounts',
  'admin_users',
  'app_meta',
  'app_settings',
  'cash_flow_expense_lines',
  'cash_flow_holdings',
  'cash_flow_incomes',
  'cash_flow_profile',
  'daily_review_journal',
  'monthly_review_journal',
  'finance_account_types',
  'finance_accounts',
  'finance_flow_categories',
  'finance_transactions',
  'frog_completion_events',
  'goal_dimensions',
  'habit_check_ins',
  'habit_contexts',
  'habits',
  'health_records',
  'memo_dimensions',
  'memos',
  'project_categories',
  'projects',
  'recipe_categories',
  'recipe_items',
  'review_columns',
  'review_dimensions',
  'savings_plan_deposits',
  'savings_plans',
  'task_categories',
  'task_execution_events',
  'task_items',
  'tasks',
  'users',
  'visions',
  'weekly_review_journal',
  'wish_items',
  'points_wallet',
  'wish_board_items',
  'points_ledger',
]);

/** 非 id 主键表 */
export const API_TABLE_PRIMARY_KEY: Record<string, string> = {
  app_meta: 'key',
  app_settings: 'key',
};

/** 始终从本地 SQLite 读取（迁移标记等，不走 REST） */
export const API_LOCAL_READ_ONLY_TABLES = new Set(['app_meta']);

export function getApiTablePrimaryKey(table: string): string {
  return API_TABLE_PRIMARY_KEY[table] ?? 'id';
}

export function isApiReadableTable(table: string): boolean {
  return API_ALLOWED_TABLES.has(table) && !API_LOCAL_READ_ONLY_TABLES.has(table);
}
