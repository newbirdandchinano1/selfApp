import * as SQLite from 'expo-sqlite';
import { INBOX_PROJECT_CATEGORY_ID, INBOX_PROJECT_CATEGORY_NAME } from './repositories/projects/constants';

export const DB_NAME = 'self_manage_sys.db';
export const DB_VERSION = 20;

let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;

export type SyncStatus = 'synced' | 'pending_create' | 'pending_update' | 'pending_delete' | 'conflict';

export interface BaseRecord {
  id: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  sync_status: SyncStatus;
  version: number;
}

export async function getDatabase() {
  if (!databasePromise) {
    databasePromise = SQLite.openDatabaseAsync(DB_NAME);
  }

  return databasePromise;
}

async function ensureColumn(db: SQLite.SQLiteDatabase, table: string, column: string, definition: string) {
  const columns = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
  if (!columns.some(c => c.name === column)) {
    await db.execAsync(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export async function initDatabase() {
  const db = await getDatabase();

  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS project_categories (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 1000,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      sync_status TEXT NOT NULL DEFAULT 'pending_create',
      version INTEGER NOT NULL DEFAULT 1,
      extra_data TEXT
    );

    CREATE TABLE IF NOT EXISTS task_categories (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 1000,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      sync_status TEXT NOT NULL DEFAULT 'pending_create',
      version INTEGER NOT NULL DEFAULT 1,
      extra_data TEXT
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY NOT NULL,
      category_id TEXT,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      note TEXT,
      due_date TEXT,
      inbox_entered_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      sync_status TEXT NOT NULL DEFAULT 'pending_create',
      version INTEGER NOT NULL DEFAULT 1,
      extra_data TEXT,
      FOREIGN KEY (category_id) REFERENCES project_categories(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT,
      category_id TEXT,
      parent_task_id TEXT,
      title TEXT NOT NULL,
      description TEXT,
      note TEXT,
      status TEXT NOT NULL DEFAULT 'todo',
      priority INTEGER NOT NULL DEFAULT 0,
      due_date TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      sync_status TEXT NOT NULL DEFAULT 'pending_create',
      version INTEGER NOT NULL DEFAULT 1,
      extra_data TEXT,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (category_id) REFERENCES task_categories(id) ON DELETE SET NULL,
      FOREIGN KEY (parent_task_id) REFERENCES tasks(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS task_items (
      id TEXT PRIMARY KEY NOT NULL,
      task_id TEXT NOT NULL,
      title TEXT NOT NULL,
      is_done INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      sync_status TEXT NOT NULL DEFAULT 'pending_create',
      version INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      balance REAL NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'CNY',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      sync_status TEXT NOT NULL DEFAULT 'pending_create',
      version INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS account_transactions (
      id TEXT PRIMARY KEY NOT NULL,
      account_id TEXT NOT NULL,
      amount REAL NOT NULL,
      category TEXT,
      note TEXT,
      happened_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      sync_status TEXT NOT NULL DEFAULT 'pending_create',
      version INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS finance_accounts (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      account_no TEXT,
      account_type TEXT NOT NULL DEFAULT 'asset',
      sign_rule INTEGER NOT NULL DEFAULT 1 CHECK (sign_rule IN (-1, 1)),
      note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      sync_status TEXT NOT NULL DEFAULT 'pending_create',
      version INTEGER NOT NULL DEFAULT 1,
      extra_data TEXT
    );

    CREATE TABLE IF NOT EXISTS finance_account_types (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      is_liability INTEGER NOT NULL DEFAULT 0,
      icon_key TEXT NOT NULL DEFAULT 'savings',
      sort_order INTEGER NOT NULL DEFAULT 1000,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      sync_status TEXT NOT NULL DEFAULT 'pending_create',
      version INTEGER NOT NULL DEFAULT 1,
      extra_data TEXT
    );

    CREATE TABLE IF NOT EXISTS finance_flow_categories (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      parent_id TEXT,
      sort_order INTEGER NOT NULL DEFAULT 1000,
      is_builtin INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      sync_status TEXT NOT NULL DEFAULT 'pending_create',
      version INTEGER NOT NULL DEFAULT 1,
      extra_data TEXT,
      FOREIGN KEY (parent_id) REFERENCES finance_flow_categories(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS finance_transactions (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      happened_at TEXT NOT NULL,
      account_id TEXT NOT NULL,
      ai_comment TEXT,
      transaction_type TEXT NOT NULL DEFAULT 'expense',
      flow_category_id TEXT,
      amount REAL NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      sync_status TEXT NOT NULL DEFAULT 'pending_create',
      version INTEGER NOT NULL DEFAULT 1,
      extra_data TEXT,
      FOREIGN KEY (account_id) REFERENCES finance_accounts(id) ON DELETE CASCADE,
      FOREIGN KEY (flow_category_id) REFERENCES finance_flow_categories(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL DEFAULT '默认用户',
      avatar_uri TEXT,
      gender TEXT NOT NULL DEFAULT '男',
      lifestyle TEXT NOT NULL DEFAULT '长期静坐不运动',
      goal TEXT NOT NULL DEFAULT '无',
      birthday TEXT,
      height REAL NOT NULL DEFAULT 0,
      weight REAL NOT NULL DEFAULT 0,
      age INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      sync_status TEXT NOT NULL DEFAULT 'pending_create',
      version INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS health_records (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      hydration REAL NOT NULL DEFAULT 0,
      target_hydration REAL NOT NULL DEFAULT 0,
      protein REAL NOT NULL DEFAULT 0,
      target_protein REAL NOT NULL DEFAULT 0,
      carbohydrate REAL NOT NULL DEFAULT 0,
      target_carbohydrate REAL NOT NULL DEFAULT 0,
      sodium REAL NOT NULL DEFAULT 0,
      target_sodium REAL NOT NULL DEFAULT 0,
      record_date TEXT NOT NULL,
      quick_add_key TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      sync_status TEXT NOT NULL DEFAULT 'pending_create',
      version INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS habits (
      id TEXT PRIMARY KEY NOT NULL,
      context TEXT NOT NULL,
      name TEXT NOT NULL,
      tag TEXT,
      icon TEXT NOT NULL,
      tone TEXT,
      note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      sync_status TEXT NOT NULL DEFAULT 'pending_create',
      version INTEGER NOT NULL DEFAULT 1,
      extra_data TEXT
    );

    CREATE TABLE IF NOT EXISTS habit_contexts (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 1000,
      is_builtin INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      sync_status TEXT NOT NULL DEFAULT 'pending_create',
      version INTEGER NOT NULL DEFAULT 1,
      extra_data TEXT
    );

    CREATE TABLE IF NOT EXISTS habit_check_ins (
      id TEXT PRIMARY KEY NOT NULL,
      habit_id TEXT NOT NULL,
      record_date TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 1 CHECK (count >= 1),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      sync_status TEXT NOT NULL DEFAULT 'pending_create',
      version INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (habit_id) REFERENCES habits(id) ON DELETE CASCADE,
      UNIQUE(habit_id, record_date)
    );

    CREATE TABLE IF NOT EXISTS savings_plans (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      target_amount REAL NOT NULL,
      avatar_uri TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      sync_status TEXT NOT NULL DEFAULT 'pending_create',
      version INTEGER NOT NULL DEFAULT 1,
      extra_data TEXT
    );

    CREATE TABLE IF NOT EXISTS savings_plan_deposits (
      id TEXT PRIMARY KEY NOT NULL,
      savings_plan_id TEXT NOT NULL,
      amount REAL NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      sync_status TEXT NOT NULL DEFAULT 'pending_create',
      version INTEGER NOT NULL DEFAULT 1,
      extra_data TEXT,
      FOREIGN KEY (savings_plan_id) REFERENCES savings_plans(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS cash_flow_profile (
      id TEXT PRIMARY KEY NOT NULL,
      necessary_expenses REAL NOT NULL DEFAULT 0,
      unnecessary_expenses REAL NOT NULL DEFAULT 0,
      target_passive_income REAL NOT NULL DEFAULT 0,
      target_months INTEGER NOT NULL DEFAULT 12,
      seed_version INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      sync_status TEXT NOT NULL DEFAULT 'pending_create',
      version INTEGER NOT NULL DEFAULT 1,
      extra_data TEXT
    );

    CREATE TABLE IF NOT EXISTS cash_flow_incomes (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      amount REAL NOT NULL,
      quadrant TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 1000,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      sync_status TEXT NOT NULL DEFAULT 'pending_create',
      version INTEGER NOT NULL DEFAULT 1,
      extra_data TEXT
    );

    CREATE TABLE IF NOT EXISTS cash_flow_holdings (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      principal REAL NOT NULL DEFAULT 0,
      inflow REAL NOT NULL DEFAULT 0,
      outflow REAL NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 1000,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      sync_status TEXT NOT NULL DEFAULT 'pending_create',
      version INTEGER NOT NULL DEFAULT 1,
      extra_data TEXT
    );

    CREATE TABLE IF NOT EXISTS cash_flow_expense_lines (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      amount REAL NOT NULL,
      bucket TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 1000,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      sync_status TEXT NOT NULL DEFAULT 'pending_create',
      version INTEGER NOT NULL DEFAULT 1,
      extra_data TEXT
    );

    CREATE TABLE IF NOT EXISTS visions (
      id TEXT PRIMARY KEY NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      track_kind TEXT NOT NULL,
      direction TEXT,
      bg_option_idx INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 1000,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      sync_status TEXT NOT NULL DEFAULT 'pending_create',
      version INTEGER NOT NULL DEFAULT 1,
      extra_data TEXT
    );

    CREATE TABLE IF NOT EXISTS wish_items (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      price REAL NOT NULL,
      category_id TEXT,
      category_label TEXT,
      desire_level INTEGER NOT NULL DEFAULT 3 CHECK (desire_level >= 1 AND desire_level <= 5),
      reason TEXT,
      reference_image_uri TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      sync_status TEXT NOT NULL DEFAULT 'pending_create',
      version INTEGER NOT NULL DEFAULT 1,
      extra_data TEXT
    );

    CREATE TABLE IF NOT EXISTS weekly_review_journal (
      id TEXT PRIMARY KEY NOT NULL,
      week_start_ymd TEXT NOT NULL UNIQUE,
      section_summary TEXT,
      section_plans TEXT,
      section_reflect TEXT,
      section_learnings TEXT,
      section_next_week TEXT,
      execution_score INTEGER NOT NULL DEFAULT 0 CHECK (execution_score >= 0 AND execution_score <= 5),
      ai_coaching TEXT,
      adjust_tasks INTEGER NOT NULL DEFAULT 0,
      adjust_savings INTEGER NOT NULL DEFAULT 0,
      adjust_plans INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      sync_status TEXT NOT NULL DEFAULT 'pending_create',
      version INTEGER NOT NULL DEFAULT 1,
      extra_data TEXT
    );

    CREATE TABLE IF NOT EXISTS daily_review_journal (
      id TEXT PRIMARY KEY NOT NULL,
      record_date_ymd TEXT NOT NULL UNIQUE,
      body TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      sync_status TEXT NOT NULL DEFAULT 'pending_create',
      version INTEGER NOT NULL DEFAULT 1,
      extra_data TEXT
    );

    CREATE TABLE IF NOT EXISTS persona_portrait_cache (
      slug TEXT PRIMARY KEY NOT NULL,
      cache_date_ymd TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  await db.runAsync('INSERT OR IGNORE INTO app_meta (key, value) VALUES (?, ?)', ['schema_version', String(DB_VERSION)]);
  await db.runAsync(
    `INSERT OR IGNORE INTO project_categories (
      id, name, created_at, updated_at, deleted_at, sync_status, version, extra_data
    ) VALUES (?, ?, datetime('now'), datetime('now'), NULL, 'synced', 1, NULL)`,
    [INBOX_PROJECT_CATEGORY_ID, INBOX_PROJECT_CATEGORY_NAME]
  );
  await db.runAsync(
    `UPDATE project_categories
     SET name = ?, deleted_at = NULL, updated_at = datetime('now')
     WHERE id = ?`,
    [INBOX_PROJECT_CATEGORY_NAME, INBOX_PROJECT_CATEGORY_ID]
  );
  await db.execAsync(`
    INSERT OR IGNORE INTO finance_flow_categories (
      id, name, parent_id, sort_order, is_builtin, created_at, updated_at, deleted_at, sync_status, version, extra_data
    ) VALUES
      ('finance-category-snack', '零食', NULL, 1, 1, datetime('now'), datetime('now'), NULL, 'synced', 1, NULL),
      ('finance-category-drink', '饮品', NULL, 2, 1, datetime('now'), datetime('now'), NULL, 'synced', 1, NULL),
      ('finance-category-dining', '餐饮', NULL, 3, 1, datetime('now'), datetime('now'), NULL, 'synced', 1, NULL);
  `);

  await db.execAsync(`
    INSERT OR IGNORE INTO habit_contexts (
      id, name, sort_order, is_builtin, created_at, updated_at, deleted_at, sync_status, version, extra_data
    ) VALUES
      ('起床', '起床', 10, 1, datetime('now'), datetime('now'), NULL, 'synced', 1, NULL),
      ('晨间', '晨间', 20, 1, datetime('now'), datetime('now'), NULL, 'synced', 1, NULL),
      ('中午', '中午', 30, 1, datetime('now'), datetime('now'), NULL, 'synced', 1, NULL),
      ('午间', '午间', 40, 1, datetime('now'), datetime('now'), NULL, 'synced', 1, NULL),
      ('晚间', '晚间', 50, 1, datetime('now'), datetime('now'), NULL, 'synced', 1, NULL),
      ('睡前', '睡前', 60, 1, datetime('now'), datetime('now'), NULL, 'synced', 1, NULL),
      ('全天', '全天', 70, 1, datetime('now'), datetime('now'), NULL, 'synced', 1, NULL);
  `);
  await ensureColumn(db, 'users', 'avatar_uri', 'TEXT');
  await ensureColumn(db, 'users', 'gender', 'TEXT');
  await ensureColumn(db, 'users', 'lifestyle', 'TEXT');
  await ensureColumn(db, 'users', 'goal', 'TEXT');
  await ensureColumn(db, 'users', 'birthday', 'TEXT');
  // Some SQLite builds don't allow adding a NOT NULL column via ALTER TABLE reliably.
  // Keep it nullable on migration and treat NULL as "unsorted" in queries.
  await ensureColumn(db, 'project_categories', 'sort_order', 'INTEGER');
  await ensureColumn(db, 'task_categories', 'sort_order', 'INTEGER');
  await ensureColumn(db, 'projects', 'category_id', 'TEXT');
  await ensureColumn(db, 'projects', 'note', 'TEXT');
  await ensureColumn(db, 'projects', 'extra_data', 'TEXT');
  await ensureColumn(db, 'projects', 'inbox_entered_at', 'TEXT');
  await db.runAsync(
    `UPDATE projects
     SET inbox_entered_at = COALESCE(updated_at, created_at)
     WHERE deleted_at IS NULL
       AND category_id = ?
       AND inbox_entered_at IS NULL`,
    [INBOX_PROJECT_CATEGORY_ID]
  );
  await ensureColumn(db, 'tasks', 'project_id', 'TEXT');
  await ensureColumn(db, 'tasks', 'category_id', 'TEXT');
  await ensureColumn(db, 'tasks', 'parent_task_id', 'TEXT');
  await ensureColumn(db, 'tasks', 'note', 'TEXT');
  await ensureColumn(db, 'tasks', 'extra_data', 'TEXT');
  await ensureColumn(db, 'habits', 'note', 'TEXT');
  await ensureColumn(db, 'finance_accounts', 'account_no', 'TEXT');
  await ensureColumn(db, 'finance_accounts', 'account_type', 'TEXT');
  await ensureColumn(db, 'finance_accounts', 'sign_rule', 'INTEGER');
  await ensureColumn(db, 'finance_accounts', 'note', 'TEXT');
  await ensureColumn(db, 'finance_accounts', 'extra_data', 'TEXT');
  await ensureColumn(db, 'finance_account_types', 'is_liability', 'INTEGER');
  await ensureColumn(db, 'finance_account_types', 'icon_key', 'TEXT');
  await ensureColumn(db, 'finance_account_types', 'sort_order', 'INTEGER');
  await ensureColumn(db, 'finance_account_types', 'extra_data', 'TEXT');
  await ensureColumn(db, 'finance_flow_categories', 'parent_id', 'TEXT');
  await ensureColumn(db, 'finance_flow_categories', 'sort_order', 'INTEGER');
  await ensureColumn(db, 'finance_flow_categories', 'is_builtin', 'INTEGER');
  await ensureColumn(db, 'health_records', 'quick_add_key', 'TEXT');
  await ensureColumn(db, 'health_records', 'carbohydrate', 'REAL NOT NULL DEFAULT 0');
  await ensureColumn(db, 'health_records', 'target_carbohydrate', 'REAL NOT NULL DEFAULT 0');
  await ensureColumn(db, 'health_records', 'source_image_uri', 'TEXT');
  await ensureColumn(db, 'health_records', 'intake_display_title', 'TEXT');
  await ensureColumn(db, 'health_records', 'intake_ai_comment', 'TEXT');
  await ensureColumn(db, 'finance_flow_categories', 'extra_data', 'TEXT');
  await ensureColumn(db, 'finance_transactions', 'name', 'TEXT');
  await ensureColumn(db, 'finance_transactions', 'happened_at', 'TEXT');
  await ensureColumn(db, 'finance_transactions', 'ai_comment', 'TEXT');
  await ensureColumn(db, 'finance_transactions', 'transaction_type', 'TEXT');
  await ensureColumn(db, 'finance_transactions', 'flow_category_id', 'TEXT');
  await ensureColumn(db, 'finance_transactions', 'amount', 'REAL');
  await ensureColumn(db, 'finance_transactions', 'note', 'TEXT');
  await ensureColumn(db, 'finance_transactions', 'extra_data', 'TEXT');

  // Ensure legacy rows have a default category_id once column exists
  await db.runAsync(
    `UPDATE projects
     SET category_id = ?, updated_at = datetime('now')
     WHERE deleted_at IS NULL AND category_id IS NULL`,
    [INBOX_PROJECT_CATEGORY_ID]
  );

  // backfill sort_order for existing rows (portable across SQLite builds)
  await db.execAsync(
    `
    UPDATE project_categories
    SET sort_order = CASE
      WHEN id = '${INBOX_PROJECT_CATEGORY_ID}' THEN 0
      ELSE COALESCE(sort_order, 1000)
    END
    WHERE deleted_at IS NULL;
    `
  );
  await db.execAsync(
    `
    UPDATE task_categories
    SET sort_order = COALESCE(sort_order, 1000)
    WHERE deleted_at IS NULL;
    `
  );

  // Unify category source of truth:
  // App UI uses project_categories only. We keep task_categories as an internal mirror
  // to satisfy the existing tasks(category_id) foreign key on older DBs.
  await db.execAsync(`
    INSERT OR REPLACE INTO task_categories (
      id, name, sort_order, created_at, updated_at, deleted_at, sync_status, version, extra_data
    )
    SELECT
      id, name, sort_order, created_at, updated_at, deleted_at, sync_status, version, extra_data
    FROM project_categories;

    CREATE TRIGGER IF NOT EXISTS trg_project_categories_ai_to_task
    AFTER INSERT ON project_categories
    BEGIN
      INSERT OR REPLACE INTO task_categories (
        id, name, sort_order, created_at, updated_at, deleted_at, sync_status, version, extra_data
      ) VALUES (
        NEW.id, NEW.name, NEW.sort_order, NEW.created_at, NEW.updated_at, NEW.deleted_at, NEW.sync_status, NEW.version, NEW.extra_data
      );
    END;

    CREATE TRIGGER IF NOT EXISTS trg_project_categories_au_to_task
    AFTER UPDATE ON project_categories
    BEGIN
      INSERT OR REPLACE INTO task_categories (
        id, name, sort_order, created_at, updated_at, deleted_at, sync_status, version, extra_data
      ) VALUES (
        NEW.id, NEW.name, NEW.sort_order, NEW.created_at, NEW.updated_at, NEW.deleted_at, NEW.sync_status, NEW.version, NEW.extra_data
      );
    END;
  `);

  // Create indexes after ensureColumn migrations (old DBs might miss columns)
  await db.execAsync(`
    CREATE INDEX IF NOT EXISTS idx_project_categories_updated_at ON project_categories(updated_at);
    CREATE INDEX IF NOT EXISTS idx_task_categories_updated_at ON task_categories(updated_at);
    CREATE INDEX IF NOT EXISTS idx_projects_category_id ON projects(category_id);
    CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
    CREATE INDEX IF NOT EXISTS idx_projects_due_date ON projects(due_date);
    CREATE INDEX IF NOT EXISTS idx_projects_updated_at ON projects(updated_at);
    CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks(project_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_category_id ON tasks(category_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_parent_task_id ON tasks(parent_task_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date);
    CREATE INDEX IF NOT EXISTS idx_tasks_updated_at ON tasks(updated_at);
    CREATE INDEX IF NOT EXISTS idx_task_items_task_id ON task_items(task_id);
    CREATE INDEX IF NOT EXISTS idx_accounts_updated_at ON accounts(updated_at);
    CREATE INDEX IF NOT EXISTS idx_account_transactions_account_id ON account_transactions(account_id);
    CREATE INDEX IF NOT EXISTS idx_finance_accounts_updated_at ON finance_accounts(updated_at);
    CREATE INDEX IF NOT EXISTS idx_finance_account_types_sort_order ON finance_account_types(sort_order);
    CREATE INDEX IF NOT EXISTS idx_finance_account_types_updated_at ON finance_account_types(updated_at);
    CREATE INDEX IF NOT EXISTS idx_finance_flow_categories_parent_id ON finance_flow_categories(parent_id);
    CREATE INDEX IF NOT EXISTS idx_finance_flow_categories_sort_order ON finance_flow_categories(sort_order);
    CREATE INDEX IF NOT EXISTS idx_finance_transactions_account_id ON finance_transactions(account_id);
    CREATE INDEX IF NOT EXISTS idx_finance_transactions_flow_category_id ON finance_transactions(flow_category_id);
    CREATE INDEX IF NOT EXISTS idx_finance_transactions_happened_at ON finance_transactions(happened_at);
    CREATE INDEX IF NOT EXISTS idx_users_updated_at ON users(updated_at);
    CREATE INDEX IF NOT EXISTS idx_health_records_user_id ON health_records(user_id);
    CREATE INDEX IF NOT EXISTS idx_health_records_record_date ON health_records(record_date);

    CREATE INDEX IF NOT EXISTS idx_habits_context ON habits(context);
    CREATE INDEX IF NOT EXISTS idx_habits_updated_at ON habits(updated_at);
    CREATE INDEX IF NOT EXISTS idx_habit_check_ins_habit_id ON habit_check_ins(habit_id);
    CREATE INDEX IF NOT EXISTS idx_habit_check_ins_record_date ON habit_check_ins(record_date);
    CREATE INDEX IF NOT EXISTS idx_habit_check_ins_deleted_at ON habit_check_ins(deleted_at);
    CREATE INDEX IF NOT EXISTS idx_savings_plans_updated_at ON savings_plans(updated_at);
    CREATE INDEX IF NOT EXISTS idx_savings_plan_deposits_plan_id ON savings_plan_deposits(savings_plan_id);
    CREATE INDEX IF NOT EXISTS idx_savings_plan_deposits_updated_at ON savings_plan_deposits(updated_at);

    CREATE INDEX IF NOT EXISTS idx_cash_flow_profile_updated_at ON cash_flow_profile(updated_at);
    CREATE INDEX IF NOT EXISTS idx_cash_flow_incomes_sort_order ON cash_flow_incomes(sort_order);
    CREATE INDEX IF NOT EXISTS idx_cash_flow_incomes_updated_at ON cash_flow_incomes(updated_at);
    CREATE INDEX IF NOT EXISTS idx_cash_flow_holdings_sort_order ON cash_flow_holdings(sort_order);
    CREATE INDEX IF NOT EXISTS idx_cash_flow_holdings_updated_at ON cash_flow_holdings(updated_at);

    CREATE INDEX IF NOT EXISTS idx_visions_updated_at ON visions(updated_at);
    CREATE INDEX IF NOT EXISTS idx_visions_sort_order ON visions(sort_order);

    CREATE INDEX IF NOT EXISTS idx_wish_items_updated_at ON wish_items(updated_at);
    CREATE INDEX IF NOT EXISTS idx_wish_items_category_id ON wish_items(category_id);

    CREATE INDEX IF NOT EXISTS idx_weekly_review_journal_week ON weekly_review_journal(week_start_ymd);
    CREATE INDEX IF NOT EXISTS idx_weekly_review_journal_updated ON weekly_review_journal(updated_at);

    CREATE INDEX IF NOT EXISTS idx_daily_review_journal_record_date ON daily_review_journal(record_date_ymd);
    CREATE INDEX IF NOT EXISTS idx_daily_review_journal_updated ON daily_review_journal(updated_at);
  `);
  await db.runAsync(
    'INSERT OR IGNORE INTO users (id, height, weight, age, created_at, updated_at) VALUES (?, 0, 0, 0, datetime("now"), datetime("now"))',
    ['default']
  );
  await db.runAsync(
    `UPDATE users
     SET gender = COALESCE(NULLIF(gender, ''), '男'),
         lifestyle = COALESCE(NULLIF(lifestyle, ''), '长期静坐不运动'),
         goal = COALESCE(NULLIF(goal, ''), '无')
     WHERE id = ?`,
    ['default']
  );

  /** 将 habits.extra_data.checkIns 迁入 habit_check_ins，并去掉 JSON 中的 checkIns（一次性） */
  const hciBackfill = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM app_meta WHERE key = ?',
    ['habit_check_ins_extra_backfill_v12']
  );
  if (!hciBackfill) {
    try {
      await db.execAsync('BEGIN IMMEDIATE');
      const habitRows = await db.getAllAsync<{ id: string; extra_data: string | null }>(
        'SELECT id, extra_data FROM habits WHERE deleted_at IS NULL'
      );
      for (const h of habitRows) {
        if (!h.extra_data) continue;
        let parsed: Record<string, unknown>;
        try {
          const raw = JSON.parse(h.extra_data) as unknown;
          if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
          parsed = raw as Record<string, unknown>;
        } catch {
          continue;
        }
        if (!('checkIns' in parsed)) continue;
        const ci = parsed.checkIns;
        if (ci && typeof ci === 'object' && !Array.isArray(ci)) {
          for (const [ymd, v] of Object.entries(ci as Record<string, unknown>)) {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) continue;
            let cnt = 0;
            if (typeof v === 'number' && Number.isFinite(v)) cnt = Math.max(0, Math.floor(v));
            else if (v === true) cnt = 1;
            if (cnt < 1) continue;
            const rid = `hci_${h.id}_${ymd.replace(/-/g, '')}`;
            await db.runAsync(
              `INSERT INTO habit_check_ins (
                id, habit_id, record_date, count,
                created_at, updated_at, deleted_at, sync_status, version
              ) VALUES (?, ?, ?, ?, datetime('now'), datetime('now'), NULL, 'pending_create', 1)
              ON CONFLICT(habit_id, record_date) DO UPDATE SET
                id = excluded.id,
                count = excluded.count,
                deleted_at = NULL,
                updated_at = datetime('now'),
                sync_status = CASE WHEN habit_check_ins.sync_status = 'synced' THEN 'pending_update' ELSE habit_check_ins.sync_status END,
                version = habit_check_ins.version + 1`,
              [rid, h.id, ymd, cnt]
            );
          }
        }
        delete parsed.checkIns;
        const nextExtra = JSON.stringify(parsed);
        await db.runAsync(
          `UPDATE habits SET extra_data = ?, updated_at = datetime('now'),
            sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_update' ELSE sync_status END,
            version = version + 1
          WHERE id = ?`,
          [nextExtra === '{}' ? null : nextExtra, h.id]
        );
      }
      await db.runAsync('INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)', [
        'habit_check_ins_extra_backfill_v12',
        '1',
      ]);
      await db.execAsync('COMMIT');
    } catch (e) {
      console.warn('habit_check_ins 从 extra_data 迁移失败', e);
      try {
        await db.execAsync('ROLLBACK');
      } catch {
        /* ignore */
      }
    }
  }

  /** 一次性清除旧版自动写入的现金流演示数据（cf-seed-*），并复位未改动的演示型 profile */
  const cfDemoPurged = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM app_meta WHERE key = ?',
    ['cash_flow_legacy_demo_purged_v10']
  );
  if (!cfDemoPurged) {
    try {
      await db.execAsync(`
        DELETE FROM cash_flow_incomes WHERE id LIKE 'cf-seed-%';
        DELETE FROM cash_flow_holdings WHERE id LIKE 'cf-seed-%';
      `);
      await db.runAsync(
        `UPDATE cash_flow_profile
         SET necessary_expenses = 0, unnecessary_expenses = 0, target_passive_income = 0,
             updated_at = datetime('now'),
             sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_update' ELSE sync_status END,
             version = version + 1
         WHERE id = 'default'
           AND necessary_expenses = 4000
           AND unnecessary_expenses = 1500
           AND target_passive_income = 20000
           AND target_months = 60`
      );
      await db.runAsync('INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)', [
        'cash_flow_legacy_demo_purged_v10',
        '1',
      ]);
    } catch {
      /* 旧库可能尚无 cash_flow 表；忽略 */
    }
  }

  return db;
}

export async function resetDatabase() {
  const db = await getDatabase();

  await db.execAsync(`
    DROP TABLE IF EXISTS health_records;
    DROP TABLE IF EXISTS finance_transactions;
    DROP TABLE IF EXISTS finance_flow_categories;
    DROP TABLE IF EXISTS finance_account_types;
    DROP TABLE IF EXISTS finance_accounts;
    DROP TABLE IF EXISTS account_transactions;
    DROP TABLE IF EXISTS accounts;
    DROP TABLE IF EXISTS task_items;
    DROP TABLE IF EXISTS tasks;
    DROP TABLE IF EXISTS projects;
    DROP TABLE IF EXISTS task_categories;
    DROP TABLE IF EXISTS project_categories;
    DROP TABLE IF EXISTS habit_check_ins;
    DROP TABLE IF EXISTS habits;
    DROP TABLE IF EXISTS savings_plan_deposits;
    DROP TABLE IF EXISTS savings_plans;
    DROP TABLE IF EXISTS cash_flow_expense_lines;
    DROP TABLE IF EXISTS cash_flow_incomes;
    DROP TABLE IF EXISTS cash_flow_holdings;
    DROP TABLE IF EXISTS cash_flow_profile;
    DROP TABLE IF EXISTS wish_items;
    DROP TABLE IF EXISTS visions;
    DROP TABLE IF EXISTS users;
    DROP TABLE IF EXISTS app_meta;
  `);

  databasePromise = null;
  return initDatabase();
}

export async function getSchemaVersion() {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM app_meta WHERE key = ?', ['schema_version']);
  return row ? Number(row.value) : null;
}
