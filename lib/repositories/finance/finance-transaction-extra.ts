/**
 * 财务流水 `extra_data`（JSON）中与预算相关的字段。
 * `exclude_from_budget === true` 时，该笔支出不计入首页月度预算已用与今日可用计算。
 * 含 `budget_fixed_expense_id` 的固定支出快速支付流水亦不计入（该金额已在月预算中预扣）。
 */
export const FINANCE_TXN_EXTRA_EXCLUDE_FROM_BUDGET = 'exclude_from_budget' as const;

/** 由「固定支出快速支付」创建的流水，值为对应 `BudgetFixedExpense.id`。 */
export const FINANCE_TXN_EXTRA_BUDGET_FIXED_EXPENSE_ID = 'budget_fixed_expense_id' as const;

/** 标记流水由固定支出快速支付创建（与 `budget_fixed_expense_id` 成对出现）。 */
export const FINANCE_TXN_EXTRA_BUDGET_FIXED_EXPENSE_PAY = 'budget_fixed_expense_pay' as const;

export function getBudgetFixedExpenseIdFromTxnExtra(extraData: string | null): string | null {
  if (!extraData) return null;
  try {
    const raw = JSON.parse(extraData) as unknown;
    if (!raw || typeof raw !== 'object') return null;
    const id = (raw as Record<string, unknown>)[FINANCE_TXN_EXTRA_BUDGET_FIXED_EXPENSE_ID];
    return typeof id === 'string' && id.trim() ? id.trim() : null;
  } catch {
    return null;
  }
}

export function isFinanceTransactionExcludedFromBudget(extraData: string | null): boolean {
  if (getBudgetFixedExpenseIdFromTxnExtra(extraData) !== null) return true;
  if (!extraData) return false;
  try {
    const raw = JSON.parse(extraData) as unknown;
    if (raw && typeof raw === 'object' && FINANCE_TXN_EXTRA_EXCLUDE_FROM_BUDGET in raw) {
      return Boolean((raw as Record<string, unknown>)[FINANCE_TXN_EXTRA_EXCLUDE_FROM_BUDGET]);
    }
  } catch {
    // ignore
  }
  return false;
}

export type FinanceTransactionExtra = {
  reason?: string;
  category_key?: string | null;
  category_label?: string | null;
};

export function parseFinanceTransactionExtra(extraData: string | null): FinanceTransactionExtra {
  if (!extraData) return {};
  try {
    const raw = JSON.parse(extraData) as unknown;
    if (!raw || typeof raw !== 'object') return {};
    const o = raw as Record<string, unknown>;
    return {
      reason: typeof o.reason === 'string' ? o.reason : undefined,
      category_key: typeof o.category_key === 'string' ? o.category_key : o.category_key === null ? null : undefined,
      category_label: typeof o.category_label === 'string' ? o.category_label : o.category_label === null ? null : undefined,
    };
  } catch {
    return {};
  }
}

export function isInitialBalanceFinanceTransaction(
  txn: Pick<{ name: string; extra_data: string | null }, 'name' | 'extra_data'>,
): boolean {
  if (parseFinanceTransactionExtra(txn.extra_data).reason === 'initial_balance') return true;
  return txn.name.trim() === '初始余额';
}

export const BUILTIN_SHEET_CATEGORY_LABELS: Record<string, string> = {
  food: '餐饮',
  snack: '零食',
  fruit: '水果',
  drink: '饮品',
  cook: '做饭食材',
  traffic: '交通',
  home: '居住',
  cloth: '服饰',
  play: '娱乐',
  other: '其他',
  salary: '工资',
  bonus: '奖金',
  refund: '报销',
  invest: '理财',
  sideline: '副业',
  allowance: '补贴',
  redpack: '红包',
  gift: '礼金',
  rent: '租金',
  'other-income': '其他',
};

export function getFinanceTransactionCategoryLabel(
  txn: Pick<{ flow_category_id: string | null; extra_data: string | null }, 'flow_category_id' | 'extra_data'>,
  categoryNameById: Map<string, string>,
): string | null {
  if (txn.flow_category_id) {
    const name = categoryNameById.get(txn.flow_category_id);
    if (name) return name;
  }
  const extra = parseFinanceTransactionExtra(txn.extra_data);
  const label = extra.category_label?.trim();
  if (label) return label;
  if (extra.category_key) {
    const builtin = BUILTIN_SHEET_CATEGORY_LABELS[extra.category_key];
    if (builtin) return builtin;
  }
  return null;
}
