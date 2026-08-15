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

/** 心愿兑换记录（来自 points_ledger.reason = wish_redeem；含一次性与重复性每次兑换） */
export type WishRedeemRecord = {
  ledger_id: string;
  wish_id: string;
  title: string;
  description: string | null;
  icon_key: string | null;
  wish_type: WishBoardWishType;
  cost_points: number;
  redeemed_at: string;
  /** 关联心愿是否仍存在于 wish_board_items */
  item_exists: boolean;
  /** 无真实流水、由已归档 once 兜底生成的展示行 */
  is_fallback: boolean;
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
