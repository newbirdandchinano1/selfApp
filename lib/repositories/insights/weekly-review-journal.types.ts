import type { SyncStatus } from '../../database.native';

export type WeeklyReviewJournalRow = {
  id: string;
  week_start_ymd: string;
  section_summary: string | null;
  section_plans: string | null;
  section_reflect: string | null;
  section_learnings: string | null;
  section_next_week: string | null;
  execution_score: number;
  ai_coaching: string | null;
  adjust_tasks: number;
  adjust_savings: number;
  adjust_plans: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  sync_status: SyncStatus;
  version: number;
  extra_data: string | null;
};

export type UpsertWeeklyReviewJournalInput = {
  week_start_ymd: string;
  section_summary: string;
  section_plans: string;
  section_reflect: string;
  section_learnings: string;
  section_next_week: string;
  execution_score: number;
  ai_coaching?: string | null;
  adjust_tasks?: boolean;
  adjust_savings?: boolean;
  adjust_plans?: boolean;
};
