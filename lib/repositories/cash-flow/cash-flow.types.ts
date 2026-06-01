import type { SyncStatus } from '../../database.native';

export type CashFlowQuadrant = 'E' | 'S' | 'B' | 'I';

/** ESBI 象限（界面沿用原名 Quadrant） */
export type Quadrant = CashFlowQuadrant;

/** 现金流页「去向」四类 */
export type CashFlowExpenseBucket = 'necessary' | 'unnecessary' | 'asset' | 'liability';

export type IncomeItem = {
  id: string;
  name: string;
  amount: number;
  quadrant: CashFlowQuadrant;
};

/** 存于 cash_flow_holdings.extra_data 的 JSON */
export type HoldingExtra = {
  /** 负债：剩余还款月数 */
  repayMonths?: number;
};

export type Holding = {
  id: string;
  name: string;
  principal: number;
  inflow: number;
  outflow: number;
  extra?: HoldingExtra | null;
};

/** 记一笔·必要/非必要：每条流水一行，用于流出明细 */
export type ExpenseFlowLine = {
  id: string;
  name: string;
  amount: number;
  bucket: 'necessary' | 'unnecessary';
};

export type CashFlowState = {
  necessaryExpenses: number;
  unnecessaryExpenses: number;
  incomes: IncomeItem[];
  holdings: Holding[];
  /** 必要/非必要支出流水（与 profile 汇总同步增减） */
  expenseLines: ExpenseFlowLine[];
  goals: { targetPassiveIncome: number; targetMonths: number };
};

export type CashFlowProfileRow = {
  id: string;
  necessary_expenses: number;
  unnecessary_expenses: number;
  target_passive_income: number;
  target_months: number;
  seed_version: number;
  created_at: string;
  updated_at: string;
  sync_status: SyncStatus;
  extra_data: string | null;
};

export type CashFlowIncomeRow = {
  id: string;
  name: string;
  amount: number;
  quadrant: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
  sync_status: SyncStatus;
  extra_data: string | null;
};

export type CashFlowHoldingRow = {
  id: string;
  name: string;
  principal: number;
  inflow: number;
  outflow: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
  sync_status: SyncStatus;
  extra_data: string | null;
};

export type CashFlowExpenseLineRow = {
  id: string;
  name: string;
  amount: number;
  bucket: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
  sync_status: SyncStatus;
  extra_data: string | null;
};
