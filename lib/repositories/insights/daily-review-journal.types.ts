import type { SyncStatus } from '../../database.native';

export type DailyReviewJournalRow = {
  id: string;
  record_date_ymd: string;
  body: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  sync_status: SyncStatus;
  version: number;
  extra_data: string | null;
};
