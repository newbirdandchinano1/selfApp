import type { SyncStatus } from '../../database.native';

export type LifeDirectionRow = {
  id: string;
  body: string;
  year_theme: string | null;
  created_at: string;
  updated_at: string;
  sync_status: SyncStatus;
  extra_data: string | null;
  server_rev?: number | null;
  mutation_id?: string | null;
  last_pushed_mutation_id?: string | null;
};

export type UpsertLifeDirectionInput = {
  /** 省略则更新最新一条或新建 */
  id?: string;
  body: string;
  year_theme?: string | null;
  extra_data?: string | null;
};

export type UpdateLifeDirectionInput = {
  body?: string;
  year_theme?: string | null;
  extra_data?: string | null;
};
