import type { SyncStatus } from '../../database.native';

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

export type UpdateDefaultUserInput = Pick<UserRow, 'name' | 'avatar_uri' | 'height' | 'weight' | 'age'>;
