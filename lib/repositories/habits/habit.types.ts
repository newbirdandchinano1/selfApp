import type { SyncStatus } from '../../database.native';

export type HabitRow = {
  id: string;
  context: string;
  name: string;
  tag: string | null;
  icon: string;
  tone: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  sync_status: SyncStatus;
  version: number;
  extra_data: string | null;
};

export type CreateHabitInput = {
  id: string;
  context: string;
  name: string;
  icon: string;
  tag?: string | null;
  tone?: string | null;
  extra_data?: string | null;
};

export type UpdateHabitInput = Partial<
  Pick<HabitRow, 'context' | 'name' | 'tag' | 'icon' | 'tone' | 'extra_data'>
>;

