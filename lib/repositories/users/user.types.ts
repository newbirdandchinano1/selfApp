import type { SyncStatus } from '../../database.native';

export type UserRow = {
  id: string;
  name: string;
  avatar_uri: string | null;
  gender: string;
  lifestyle: string;
  goal: string;
  birthday: string | null;
  height: number;
  weight: number;
  age: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  sync_status: SyncStatus;
  version: number;
};

export type UpdateDefaultUserInput = Pick<
  UserRow,
  'name' | 'avatar_uri' | 'gender' | 'lifestyle' | 'goal' | 'birthday' | 'height' | 'weight'
>;
