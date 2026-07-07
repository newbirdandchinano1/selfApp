import type { SyncStatus } from '@/lib/database';

export type WeeklyTaskScheduleSlotRow = {
  id: string;
  start_hour: number;
  end_hour: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
  sync_status: SyncStatus;
};

export type WeeklyTaskScheduleCellRow = {
  id: string;
  slot_id: string;
  day_of_week: number;
  content: string;
  created_at: string;
  updated_at: string;
  sync_status: SyncStatus;
};

export type WeeklyTaskScheduleSlot = {
  id: string;
  startHour: number;
  endHour: number;
  sortOrder: number;
  label: string;
};

export type WeeklyTaskScheduleData = {
  slots: WeeklyTaskScheduleSlot[];
  /** key: `${slotId}-${dayOfWeek}` */
  cells: Record<string, string>;
};
