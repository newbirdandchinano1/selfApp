import type { SyncStatus } from '../../database.native';

export type WishItemRow = {
  id: string;
  name: string;
  price: number;
  category_id: string | null;
  category_label: string | null;
  desire_level: number;
  reason: string | null;
  reference_image_uri: string | null;
  ai_comment: string | null;
  ai_review_at: string | null;
  created_at: string;
  updated_at: string;
  sync_status: SyncStatus;
  extra_data: string | null;
};

export type CreateWishItemInput = {
  /** 可选；未传时由仓库自动生成 */
  id?: string;
  name: string;
  price: number;
  category_id: string | null;
  category_label: string | null;
  desire_level: number;
  reason: string | null;
  reference_image_uri: string | null;
  extra_data?: string | null;
};

export type UpdateWishItemInput = Partial<
  Pick<
    WishItemRow,
    'name' | 'price' | 'category_id' | 'category_label' | 'desire_level' | 'reason' | 'reference_image_uri' | 'extra_data'
  >
>;
