export type HabitContextRow = {
  id: string;
  name: string;
  sort_order: number | null;
  is_builtin: number | null;
  created_at: string;
  updated_at: string;
  sync_status: string;
  extra_data: string | null;
};

