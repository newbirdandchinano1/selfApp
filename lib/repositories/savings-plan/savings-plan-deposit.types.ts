import type { SyncStatus } from '../../database.native';

export type SavingsPlanDepositRow = {
  id: string;
  savings_plan_id: string;
  amount: number;
  note: string | null;
  created_at: string;
  updated_at: string;
  sync_status: SyncStatus;
  extra_data: string | null;
};

export type CreateSavingsPlanDepositInput = {
  id: string;
  savings_plan_id: string;
  amount: number;
  note?: string | null;
  extra_data?: string | null;
};
