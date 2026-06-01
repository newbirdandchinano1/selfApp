import type { SyncStatus } from '../../database.native';

export type UserRow = {
  id: string;
  name: string;
  avatar_uri: string | null;
  gender: string;
  lifestyle: string;
  goal: string;
  /** JSON 数组，如 `["周一","周三"]` */
  workout_days: string | null;
  /** JSON 数组，如 `["周二","周日"]` */
  rest_days: string | null;
  birthday: string | null;
  height: number;
  weight: number;
  age: number;
  created_at: string;
  updated_at: string;
  sync_status: SyncStatus;
};

export type UpdateDefaultUserInput = Pick<
  UserRow,
  | 'name'
  | 'avatar_uri'
  | 'gender'
  | 'lifestyle'
  | 'goal'
  | 'workout_days'
  | 'birthday'
  | 'height'
  | 'weight'
>;
