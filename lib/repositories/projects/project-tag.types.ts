import type { SyncStatus } from '../../database.native';

export type ProjectTagRow = {
  id: string;
  name: string;
  color: string;
  description: string | null;
  /** 权重：数值越大越靠前 */
  weight: number;
  created_at: string;
  updated_at: string;
  sync_status: SyncStatus;
  extra_data: string | null;
};

export type CreateProjectTagInput = {
  id: string;
  name: string;
  color: string;
  description?: string | null;
  weight?: number;
  extra_data?: string | null;
};

export type UpdateProjectTagInput = Partial<
  Pick<ProjectTagRow, 'name' | 'color' | 'description' | 'weight' | 'extra_data'>
>;

export type ProjectTagLinkRow = {
  id: string;
  project_id: string;
  tag_id: string;
  created_at: string;
  updated_at: string;
  sync_status: SyncStatus;
};

/** 预设标签色 */
export const PROJECT_TAG_COLOR_PRESETS = [
  '#EF4444',
  '#F97316',
  '#EAB308',
  '#22C55E',
  '#14B8A6',
  '#3B82F6',
  '#8B5CF6',
  '#EC4899',
  '#64748B',
] as const;

export const DEFAULT_PROJECT_TAG_COLOR = PROJECT_TAG_COLOR_PRESETS[8];
