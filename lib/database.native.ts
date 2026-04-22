import * as SQLite from 'expo-sqlite';

export const DB_NAME = 'self_manage_sys.db';
export const DB_VERSION = 3;

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

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL DEFAULT '默认用户',
      avatar_uri TEXT,
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
      sodium REAL NOT NULL DEFAULT 0,
      target_sodium REAL NOT NULL DEFAULT 0,
      record_date TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      sync_status TEXT NOT NULL DEFAULT 'pending_create',
      version INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

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
    CREATE INDEX IF NOT EXISTS idx_users_updated_at ON users(updated_at);
    CREATE INDEX IF NOT EXISTS idx_health_records_user_id ON health_records(user_id);
    CREATE INDEX IF NOT EXISTS idx_health_records_record_date ON health_records(record_date);
  `);

  await db.runAsync('INSERT OR IGNORE INTO app_meta (key, value) VALUES (?, ?)', ['schema_version', String(DB_VERSION)]);
  await ensureColumn(db, 'users', 'avatar_uri', 'TEXT');
  await ensureColumn(db, 'projects', 'category_id', 'TEXT');
  await ensureColumn(db, 'projects', 'note', 'TEXT');
  await ensureColumn(db, 'projects', 'extra_data', 'TEXT');
  await ensureColumn(db, 'tasks', 'project_id', 'TEXT');
  await ensureColumn(db, 'tasks', 'category_id', 'TEXT');
  await ensureColumn(db, 'tasks', 'parent_task_id', 'TEXT');
  await ensureColumn(db, 'tasks', 'note', 'TEXT');
  await ensureColumn(db, 'tasks', 'extra_data', 'TEXT');
  await db.runAsync(
    'INSERT OR IGNORE INTO users (id, height, weight, age, created_at, updated_at) VALUES (?, 0, 0, 0, datetime("now"), datetime("now"))',
    ['default']
  );

  return db;
}

export async function resetDatabase() {
  const db = await getDatabase();

  await db.execAsync(`
    DROP TABLE IF EXISTS health_records;
    DROP TABLE IF EXISTS account_transactions;
    DROP TABLE IF EXISTS accounts;
    DROP TABLE IF EXISTS task_items;
    DROP TABLE IF EXISTS tasks;
    DROP TABLE IF EXISTS projects;
    DROP TABLE IF EXISTS task_categories;
    DROP TABLE IF EXISTS project_categories;
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
