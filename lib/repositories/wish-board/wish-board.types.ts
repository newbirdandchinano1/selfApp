import type { SyncStatus } from '../../database.native';

export type WishBoardItemStatus = 'active' | 'redeemed';
/** once=一次性心愿；repeat=重复性心愿（可多次兑换） */
export type WishBoardWishType = 'once' | 'repeat';

export type PointsWalletRow = {
  id: string;
  balance: number;
  created_at: string;
  updated_at: string;
  sync_status: SyncStatus;
  extra_data: string | null;
};

export type WishBoardItemRow = {
  id: string;
  title: string;
  /** 描述（可选）；兼容旧字段 note */
  description: string | null;
  note: string | null;
  icon_key: string | null;
  wish_type: WishBoardWishType;
  cost_points: number;
  status: WishBoardItemStatus;
  redeemed_at: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
  sync_status: SyncStatus;
  extra_data: string | null;
};

export type PointsLedgerRow = {
  id: string;
  delta: number;
  balance_after: number;
  reason: string;
  ref_type: string | null;
  ref_id: string | null;
  created_at: string;
  updated_at: string;
  sync_status: SyncStatus;
  extra_data: string | null;
};

export type CreateWishBoardItemInput = {
  id?: string;
  title: string;
  description?: string | null;
  icon_key?: string | null;
  wish_type?: WishBoardWishType;
  cost_points: number;
  sort_order?: number;
};

export type UpdateWishBoardItemInput = Partial<
  Pick<
    WishBoardItemRow,
    | 'title'
    | 'description'
    | 'icon_key'
    | 'wish_type'
    | 'cost_points'
    | 'note'
    | 'sort_order'
    | 'status'
    | 'redeemed_at'
  >
>;
