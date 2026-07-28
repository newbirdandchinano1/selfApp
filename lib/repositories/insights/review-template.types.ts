import type { SyncStatus } from '../../database.native';

export type ReviewTemplateScope = 'daily' | 'weekly' | 'monthly';

export type ReviewDimensionRow = {
  id: string;
  scope: ReviewTemplateScope;
  title: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
  sync_status: SyncStatus;
  extra_data: string | null;
};

export type ReviewColumnRow = {
  id: string;
  dimension_id: string;
  title: string;
  placeholder: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
  sync_status: SyncStatus;
  extra_data: string | null;
};

export type ReviewColumnTemplate = {
  id: string;
  dimensionId: string;
  title: string;
  placeholder: string;
  sortOrder: number;
};

export type ReviewDimensionTemplate = {
  id: string;
  scope: ReviewTemplateScope;
  title: string;
  sortOrder: number;
  columns: ReviewColumnTemplate[];
};

export type CreateReviewDimensionInput = {
  id: string;
  scope: ReviewTemplateScope;
  title: string;
  sort_order?: number;
};

export type UpdateReviewDimensionInput = {
  title?: string;
  sort_order?: number;
};

export type CreateReviewColumnInput = {
  id: string;
  dimension_id: string;
  title: string;
  placeholder?: string | null;
  sort_order?: number;
};

export type UpdateReviewColumnInput = {
  title?: string;
  placeholder?: string | null;
  sort_order?: number;
};
