export const DB_NAME = 'self_manage_sys.db';
export const DB_VERSION = 1;

export type SyncStatus = 'synced' | 'pending_create' | 'pending_update' | 'pending_delete' | 'conflict';

export interface BaseRecord {
  id: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  sync_status: SyncStatus;
  version: number;
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
  deleted_at: string | null;
  sync_status: SyncStatus;
  version: number;
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
  remainingFkIssues: number;
};

export async function repairLocalDatabase(): Promise<RepairLocalDatabaseResult> {
  throw new Error('当前环境无本地 SQLite，无法修复数据库');
}
