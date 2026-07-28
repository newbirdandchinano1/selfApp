import type { SyncStatus } from '../../database.native';

export type MonthlyReviewJournalRow = {
  id: string;
  month_start_ymd: string;
  body: string | null;
  created_at: string;
  updated_at: string;
  sync_status: SyncStatus;
  extra_data: string | null;
};
