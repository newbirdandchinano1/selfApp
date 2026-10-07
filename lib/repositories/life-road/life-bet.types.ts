import type { LifeBetHorizon, LifeBetStatus } from '@/lib/life-road/life-road-limits';
import type { SyncStatus } from '../../database.native';

export type LifeBetRow = {
  id: string;
  title: string;
  horizon: LifeBetHorizon;
  year: number | null;
  note: string | null;
  status: LifeBetStatus;
  sort_order: number;
  created_at: string;
  updated_at: string;
  sync_status: SyncStatus;
  extra_data: string | null;
  server_rev?: number | null;
  mutation_id?: string | null;
  last_pushed_mutation_id?: string | null;
};

export type CreateLifeBetInput = {
  id?: string;
  title: string;
  horizon: LifeBetHorizon;
  /** horizon=year 时必填；省略且 horizon=year 时默认当前公历年 */
  year?: number | null;
  note?: string | null;
  status?: LifeBetStatus;
  sort_order?: number;
  extra_data?: string | null;
};

export type UpdateLifeBetInput = Partial<
  Pick<LifeBetRow, 'title' | 'horizon' | 'year' | 'note' | 'status' | 'sort_order' | 'extra_data'>
>;
