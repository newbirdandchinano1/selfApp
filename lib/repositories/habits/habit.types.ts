import type { SyncStatus } from '../../database.native';

export type HabitRow = {
  id: string;
  context: string;
  name: string;
  tag: string | null;
  icon: string;
  tone: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
  sync_status: SyncStatus;
  extra_data: string | null;
};

export type CreateHabitInput = {
  id: string;
  context: string;
  name: string;
  icon: string;
  tag?: string | null;
  tone?: string | null;
  note?: string | null;
  extra_data?: string | null;
};

export type UpdateHabitInput = Partial<
  Pick<HabitRow, 'context' | 'name' | 'tag' | 'icon' | 'tone' | 'note' | 'extra_data'>
>;

