export const DB_NAME = 'self_manage_sys.db';
export const DB_VERSION = 1;

export type SyncStatus = 'synced' | 'pending_create' | 'pending_update' | 'pending_delete' | 'conflict';

export interface BaseRecord {
  id: string;
  created_at: string;
  updated_at: string;
  sync_status: SyncStatus;
}

export type UserRow = {
  id: string;
  name: string;
  avatar_uri: string | null;
  height: number;
  weight: number;
  age: number;
  created_at: string;
  updated_at: string;
  sync_status: SyncStatus;
};


export async function getDatabase() {
  return null;
}

export async function initDatabase() {
  return null;
}


export async function getSchemaVersion() {
  return null;
}

export type RepairLocalDatabaseResult = {
  ok: true;
  dedupedTables: string[];
  remainingFkIssues: number;
};

export async function repairLocalDatabase(): Promise<RepairLocalDatabaseResult> {
  throw new Error('当前环境无本地 SQLite，无法修复数据库');
}
