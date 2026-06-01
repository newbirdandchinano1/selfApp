import type { SyncStatus } from '../../database.native';
import type { GoalDimensionExtraPayload } from './goal-dimension-extra';

export type GoalDimensionRow = {
  id: string;
  title: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
  sync_status: SyncStatus;
  extra_data: string | null;
};

export type CreateGoalDimensionInput = {
  id: string;
  title: string;
  sort_order?: number;
  extra?: GoalDimensionExtraPayload | null;
};

export type UpdateGoalDimensionInput = {
  title?: string;
  sort_order?: number;
  extra?: GoalDimensionExtraPayload | null;
};
