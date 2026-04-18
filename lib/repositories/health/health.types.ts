import type { SyncStatus } from '../../database.native';

export type HealthRecordRow = {
  id: string;
  user_id: string;
  hydration: number;
  target_hydration: number;
  protein: number;
  target_protein: number;
  sodium: number;
  target_sodium: number;
  record_date: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  sync_status: SyncStatus;
  version: number;
};

export type CreateHealthRecordInput = {
  id: string;
  user_id: string;
  hydration?: number;
  target_hydration?: number;
  protein?: number;
  target_protein?: number;
  sodium?: number;
  target_sodium?: number;
  record_date: string;
};

export type UpdateHealthRecordInput = Partial<Pick<HealthRecordRow, 'hydration' | 'target_hydration' | 'protein' | 'target_protein' | 'sodium' | 'target_sodium' | 'record_date'>>;
