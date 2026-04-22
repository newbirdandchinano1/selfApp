import type { SyncStatus } from '../../database.native';

export type ProjectStatus = 'active' | 'paused' | 'completed' | 'archived';

export type ProjectRow = {
  id: string;
  category_id: string | null;
  name: string;
  status: ProjectStatus;
  note: string | null;
  due_date: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  sync_status: SyncStatus;
  version: number;
  extra_data: string | null;
};

export type CreateProjectInput = {
  id: string;
  name: string;
  category_id?: string | null;
  status?: ProjectStatus;
  note?: string | null;
  due_date?: string | null;
  extra_data?: string | null;
};

export type UpdateProjectInput = Partial<Pick<ProjectRow, 'category_id' | 'name' | 'status' | 'note' | 'due_date' | 'extra_data'>>;

export type ProjectCategoryRow = {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  sync_status: SyncStatus;
  version: number;
  extra_data: string | null;
};

export type CreateProjectCategoryInput = {
  id: string;
  name: string;
  extra_data?: string | null;
};

export type UpdateProjectCategoryInput = Partial<Pick<ProjectCategoryRow, 'name' | 'extra_data'>>;
