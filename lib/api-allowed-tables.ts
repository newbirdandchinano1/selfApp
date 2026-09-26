/**
 * 服务端 ALLOWED_TABLES，与后端 src/config/tables.ts 对齐。
 * 财务权威：finance_*；卫星：cash_flow_* / savings_*；遗留 accounts / account_transactions 已下线。
 */
export const API_ALLOWED_TABLES = new Set([
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
  'finance_scheduled_expenses',
  'finance_transactions',
  'frog_completion_events',
  'project_completion_logs',
  'habit_check_ins',
  'habit_contexts',
  'habits',
  'health_records',
  'memos',
  'project_categories',
  'projects',
  'recipe_categories',
  'recipe_items',
  'review_columns',
  'review_dimensions',
  'savings_plan_deposits',
  'savings_plans',
  'schedule_placements',
  'schedule_week_axis_snapshot',
  'task_categories',
  'task_execution_events',
  'task_items',
  'tasks',
  'users',
  'weekly_review_journal',
  'points_wallet',
  'points_ledger',
  'wish_board_items',
  'tags',
  'tag_links',
  'health_daily_targets',
]);

/** 非 id 主键表 */
export const API_TABLE_PRIMARY_KEY: Record<string, string> = {
  app_meta: 'key',
  app_settings: 'key',
  schedule_week_axis_snapshot: 'week_start_ymd',
};

/** 始终从本地 SQLite 读取（迁移标记等，不走 REST） */
export const API_LOCAL_READ_ONLY_TABLES = new Set(['app_meta']);

/**
 * 禁止经 `/api/data/:table` 通用写的高危表（与后端 GENERIC_WRITE_FORBIDDEN_TABLES 对齐）。
 * 写入须走专用业务接口；增量同步不得再 POST/PUT/PATCH/DELETE 这些表的通用端点。
 * 已在 APP_DOMAIN_CRUD_TABLES 中的表由专用接口适配，仍可出现在脏表集合里并由 api-app-domain 上传。
 */
export const API_GENERIC_WRITE_FORBIDDEN_TABLES = new Set([
  'points_ledger',
  'points_wallet',
  'wish_board_items',
  'memos',
  'health_records',
  'recipe_categories',
  'recipe_items',
  /** 课表：仅 frog-schedule 专用接口可写 */
  'schedule_placements',
  'schedule_week_axis_snapshot',
  'finance_transactions',
]);

export function isApiGenericWriteForbidden(table: string): boolean {
  return API_GENERIC_WRITE_FORBIDDEN_TABLES.has(table);
}

export function getApiTablePrimaryKey(table: string): string {
  return API_TABLE_PRIMARY_KEY[table] ?? 'id';
}

export function isApiReadableTable(table: string): boolean {
  return API_ALLOWED_TABLES.has(table) && !API_LOCAL_READ_ONLY_TABLES.has(table);
}
