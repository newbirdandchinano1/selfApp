import type { SyncStatus } from '../../database.native';

export type GoalDimensionRow = {
  id: string;
  title: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  sync_status: SyncStatus;
  version: number;
  extra_data: string | null;
};

export type CreateGoalDimensionInput = {
  id: string;
  title: string;
  sort_order?: number;
};
