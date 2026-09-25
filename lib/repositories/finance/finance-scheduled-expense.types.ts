import type { SyncStatus } from '../../database.native';

export type FinanceScheduledExpenseRow = {
  id: string;
  name: string;
  amount: number;
  account_id: string;
  repeat_option: string;
  weekly_days: string | null;
  monthly_days: string | null;
  hour: number;
  minute: number;
  times_per_day: number;
  flow_category_id: string | null;
  category_key: string | null;
  category_label: string | null;
  include_in_budget: number;
  enabled: number;
  created_at: string;
  updated_at: string;
  sync_status: SyncStatus;
  extra_data: string | null;
};

export type CreateFinanceScheduledExpenseInput = {
  id: string;
  name: string;
  amount: number;
  account_id: string;
  repeat_option: string;
  weekly_days?: string | null;
  monthly_days?: string | null;
  hour?: number;
  minute?: number;
  times_per_day?: number;
  flow_category_id?: string | null;
  category_key?: string | null;
  category_label?: string | null;
  include_in_budget?: number;
  enabled?: number;
  created_at?: string;
  extra_data?: string | null;
};

export type UpdateFinanceScheduledExpenseInput = Partial<
  Pick<
    FinanceScheduledExpenseRow,
    | 'name'
    | 'amount'
    | 'account_id'
    | 'repeat_option'
    | 'weekly_days'
    | 'monthly_days'
    | 'hour'
    | 'minute'
    | 'times_per_day'
    | 'flow_category_id'
    | 'category_key'
    | 'category_label'
    | 'include_in_budget'
    | 'enabled'
    | 'extra_data'
  >
>;
