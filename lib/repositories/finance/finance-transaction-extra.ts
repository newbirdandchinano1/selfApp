/**
 * 财务流水 `extra_data`（JSON）中与预算相关的字段。
 * `exclude_from_budget === true` 时，该笔支出不计入首页月度预算已用与今日可用计算。
 */
export const FINANCE_TXN_EXTRA_EXCLUDE_FROM_BUDGET = 'exclude_from_budget' as const;

/** 由「固定支出快速支付」创建的流水，值为对应 `BudgetFixedExpense.id`。 */
export const FINANCE_TXN_EXTRA_BUDGET_FIXED_EXPENSE_ID = 'budget_fixed_expense_id' as const;

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
