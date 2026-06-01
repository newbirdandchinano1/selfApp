import type { SyncStatus } from '../../database.native';

export type DailyReviewJournalRow = {
  id: string;
  record_date_ymd: string;
  body: string | null;
  created_at: string;
  updated_at: string;
  sync_status: SyncStatus;
  extra_data: string | null;
};
