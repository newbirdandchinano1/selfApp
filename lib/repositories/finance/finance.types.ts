import type { SyncStatus } from '../../database.native';

export const DEFAULT_FINANCE_ACCOUNT_TYPES = ['asset', 'liability'] as const;
export const DEFAULT_FINANCE_TRANSACTION_TYPES = ['income', 'expense', 'transfer'] as const;
export const DEFAULT_FINANCE_FLOW_CATEGORIES = ['零食', '饮品', '餐饮'] as const;

export type FinanceAccountRow = {
  id: string;
  name: string;
  account_no: string | null;
  account_type: string;
  sign_rule: -1 | 1;
  note: string | null;
  created_at: string;
  updated_at: string;
  sync_status: SyncStatus;
  extra_data: string | null;
};

export type FinanceAccountBalanceRow = FinanceAccountRow & {
  balance: number;
};

export type FinanceAccountTypeRow = {
  id: string;
  name: string;
  is_liability: number;
  icon_key: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
  sync_status: SyncStatus;
  extra_data: string | null;
};

export type UpsertFinanceAccountTypeInput = {
  name: string;
  is_liability: number;
  icon_key: string;
};

export type CreateFinanceAccountInput = {
  id: string;
  name: string;
  account_no?: string | null;
  account_type?: string;
  sign_rule?: -1 | 1;
  note?: string | null;
  extra_data?: string | null;
};

export type UpdateFinanceAccountInput = Partial<
  Pick<FinanceAccountRow, 'name' | 'account_no' | 'account_type' | 'sign_rule' | 'note' | 'extra_data'>
>;

export type FinanceFlowCategoryRow = {
  id: string;
  name: string;
  parent_id: string | null;
  sort_order: number;
  is_builtin: number;
  created_at: string;
  updated_at: string;
  sync_status: SyncStatus;
  extra_data: string | null;
};

export type CreateFinanceFlowCategoryInput = {
  id: string;
  name: string;
  parent_id?: string | null;
  sort_order?: number;
  is_builtin?: number;
  extra_data?: string | null;
};

export type UpdateFinanceFlowCategoryInput = Partial<
  Pick<FinanceFlowCategoryRow, 'name' | 'parent_id' | 'sort_order' | 'is_builtin' | 'extra_data'>
>;

export type FinanceTransactionRow = {
  id: string;
  name: string;
  happened_at: string;
  account_id: string;
  ai_comment: string | null;
  transaction_type: string;
  flow_category_id: string | null;
  amount: number;
  note: string | null;
  created_at: string;
  updated_at: string;
  sync_status: SyncStatus;
  extra_data: string | null;
};

export type FinanceDailySummaryRow = {
  day: string; // YYYY-MM-DD
  income: number; // absolute sum of income amounts
  expense: number; // absolute sum of expense amounts
  net: number; // income - expense
};

export type CreateFinanceTransactionInput = {
  id: string;
  name: string;
  happened_at: string;
  account_id: string;
  ai_comment?: string | null;
  transaction_type?: string;
  flow_category_id?: string | null;
  amount: number;
  note?: string | null;
  extra_data?: string | null;
};

/** 转账双流水（同一 `groupId` 下转出/转入各一条）；可选手续费从转账金额中扣除。 */
export type CreateFinanceTransferInput = {
  idOut: string;
  idIn: string;
  groupId: string;
  fromAccountId: string;
  toAccountId: string;
  fromAccountName: string;
  toAccountName: string;
  /** 转账总额（扣款账户合计减少额）；有手续费时对方实收 = amount - feeAmount。 */
  amount: number;
  happenedAt: string;
  note?: string | null;
  /**
   * 可选手续费：从 `amount` 中扣减。
   * >0 时转账双腿金额为 `amount - feeAmount`，另写一笔扣款账户 `expense`（计入消费）。
   */
  feeAmount?: number;
  idFee?: string;
};

export type UpdateFinanceTransactionInput = Partial<
  Pick<
    FinanceTransactionRow,
    'name' | 'happened_at' | 'account_id' | 'ai_comment' | 'transaction_type' | 'flow_category_id' | 'amount' | 'note' | 'extra_data'
  >
>;
