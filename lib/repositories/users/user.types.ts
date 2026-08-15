import type { SyncStatus } from '../../database.native';

export type UserRow = {
  id: string;
  name: string;
  avatar_uri: string | null;
  /** 人物画像 / 自我介绍，最多 500 字 */
  persona_portrait: string | null;
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
  | 'persona_portrait'
  | 'gender'
  | 'lifestyle'
  | 'goal'
  | 'workout_days'
  | 'birthday'
  | 'height'
  | 'weight'
> & {
  /** 可选；未传时不改写本地 avatar_uri */
  avatar_uri?: string | null;
};
