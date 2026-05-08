import type { SyncStatus } from '../../database.native';

export type SavingsPlanRow = {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  target_amount: number;
  avatar_uri: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  sync_status: SyncStatus;
  version: number;
  extra_data: string | null;
};

export type CreateSavingsPlanInput = {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  target_amount: number;
  avatar_uri?: string | null;
  extra_data?: string | null;
};

export type UpdateSavingsPlanInput = Partial<
  Pick<SavingsPlanRow, 'name' | 'start_date' | 'end_date' | 'target_amount' | 'avatar_uri' | 'extra_data'>
>;
