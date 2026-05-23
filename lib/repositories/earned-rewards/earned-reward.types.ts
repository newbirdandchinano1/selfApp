import type { SyncStatus } from '../../database.native';

export type EarnedRewardSourceType = 'task' | 'project';
export type EarnedRewardKind = 'wish' | 'custom';

export type EarnedRewardRow = {
  id: string;
  source_type: EarnedRewardSourceType;
  source_id: string;
  source_title: string;
  reward_kind: EarnedRewardKind;
  wish_item_id: string | null;
  label: string;
  earned_at: string;
  redeemed_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  sync_status: SyncStatus;
  version: number;
  extra_data: string | null;
};
