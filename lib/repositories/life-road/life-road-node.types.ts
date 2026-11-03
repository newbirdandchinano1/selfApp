import type {
  LifeRoadNodeKind,
  LifeRoadNodeStatus,
} from '@/lib/life-road/life-road-node-model';
import type { SyncStatus } from '../../database.native';

export type LifeRoadNodeRow = {
  id: string;
  kind: LifeRoadNodeKind;
  title: string;
  note: string | null;
  calendar_year: number | null;
  quarter: number | null;
  month: number | null;
  parent_id: string | null;
  status: LifeRoadNodeStatus;
  sort_order: number;
  created_at: string;
  updated_at: string;
  sync_status: SyncStatus;
  extra_data: string | null;
  server_rev?: number | null;
  mutation_id?: string | null;
  last_pushed_mutation_id?: string | null;
};

export type CreateLifeRoadNodeInput = {
  id?: string;
  kind: LifeRoadNodeKind;
  title: string;
  note?: string | null;
  calendar_year?: number | null;
  quarter?: number | null;
  month?: number | null;
  parent_id?: string | null;
  status?: LifeRoadNodeStatus;
  sort_order?: number;
  extra_data?: string | null;
};

export type UpdateLifeRoadNodeInput = Partial<
  Pick<
    LifeRoadNodeRow,
    | 'title'
    | 'note'
    | 'calendar_year'
    | 'quarter'
    | 'month'
    | 'parent_id'
    | 'status'
    | 'sort_order'
    | 'extra_data'
  >
>;
