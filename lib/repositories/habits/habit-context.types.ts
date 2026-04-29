export type HabitContextRow = {
  id: string;
  name: string;
  sort_order: number | null;
  is_builtin: number | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  sync_status: string;
  version: number;
  extra_data: string | null;
};

