/**
 * 财务流水 `extra_data`（JSON）中与预算相关的字段。
 * `exclude_from_budget === true` 时，该笔支出不计入首页月度预算已用与今日可用计算。
 */
export const FINANCE_TXN_EXTRA_EXCLUDE_FROM_BUDGET = 'exclude_from_budget' as const;

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
