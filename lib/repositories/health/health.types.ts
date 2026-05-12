import type { SyncStatus } from '../../database.native';

export type HealthRecordRow = {
  id: string;
  user_id: string;
  hydration: number;
  target_hydration: number;
  protein: number;
  target_protein: number;
  carbohydrate: number;
  target_carbohydrate: number;
  sodium: number;
  target_sodium: number;
  record_date: string;
  quick_add_key: string | null;
  /** 列表/详情展示标题（如 AI 用户原文、拍照识别的食物名） */
  intake_display_title?: string | null;
  /** 智谱返回的口语化点评，展示在详情 */
  intake_ai_comment?: string | null;
  /** 拍照/相册识别摄入时保存的本地图片路径（file://） */
  source_image_uri?: string | null;
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
  carbohydrate?: number;
  target_carbohydrate?: number;
  sodium?: number;
  target_sodium?: number;
  record_date: string;
  quick_add_key?: string | null;
  intake_display_title?: string | null;
  intake_ai_comment?: string | null;
  source_image_uri?: string | null;
};

export type UpdateHealthRecordInput = Partial<
  Pick<
    HealthRecordRow,
    | 'hydration'
    | 'target_hydration'
    | 'protein'
    | 'target_protein'
    | 'carbohydrate'
    | 'target_carbohydrate'
    | 'sodium'
    | 'target_sodium'
    | 'record_date'
    | 'quick_add_key'
    | 'intake_display_title'
    | 'intake_ai_comment'
    | 'source_image_uri'
  >
>;

/** 某日所有健康记录汇总后的摄入量（同日多条时相加）。 */
export type HealthIntakeDayTotals = {
  hydration: number;
  protein: number;
  carbohydrate: number;
  sodium: number;
};
