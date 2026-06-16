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

/** 由定时支出自动创建的流水，值为对应 `ScheduledFinanceExpense.id`。 */
export const FINANCE_TXN_EXTRA_SCHEDULED_EXPENSE_ID = 'scheduled_expense_id' as const;

/** 定时支出槽位：`YYYY-MM-DD:slotIndex`，用于去重。 */
export const FINANCE_TXN_EXTRA_SCHEDULED_EXPENSE_SLOT = 'scheduled_expense_slot' as const;

/** 标记流水由定时支出自动创建。 */
export const FINANCE_TXN_EXTRA_SCHEDULED_EXPENSE_AUTO = 'scheduled_expense_auto' as const;

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

export function getScheduledExpenseSlotFromTxnExtra(extraData: string | null): string | null {
  if (!extraData) return null;
  try {
    const raw = JSON.parse(extraData) as unknown;
    if (!raw || typeof raw !== 'object') return null;
    const slot = (raw as Record<string, unknown>)[FINANCE_TXN_EXTRA_SCHEDULED_EXPENSE_SLOT];
    return typeof slot === 'string' && slot.trim() ? slot.trim() : null;
  } catch {
    return null;
  }
}

export function getScheduledExpenseIdFromTxnExtra(extraData: string | null): string | null {
  if (!extraData) return null;
  try {
    const raw = JSON.parse(extraData) as unknown;
    if (!raw || typeof raw !== 'object') return null;
    const id = (raw as Record<string, unknown>)[FINANCE_TXN_EXTRA_SCHEDULED_EXPENSE_ID];
    return typeof id === 'string' && id.trim() ? id.trim() : null;
  } catch {
    return null;
  }
}

function parseFinanceTxnExtraObject(extraData: string | null): Record<string, unknown> {
  if (!extraData) return {};
  try {
    const raw = JSON.parse(extraData) as unknown;
    if (raw && typeof raw === 'object') return raw as Record<string, unknown>;
  } catch {
    // ignore
  }
  return {};
}

/** 解析 extra_data 中的 exclude_from_budget（兼容布尔、数字与字符串）。 */
export function readExcludeFromBudgetFromExtraObject(raw: Record<string, unknown>): boolean {
  if (!(FINANCE_TXN_EXTRA_EXCLUDE_FROM_BUDGET in raw)) return false;
  const v = raw[FINANCE_TXN_EXTRA_EXCLUDE_FROM_BUDGET];
  if (v === true || v === 1) return true;
  if (v === false || v === 0 || v === null) return false;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (s === 'true' || s === '1') return true;
    if (s === 'false' || s === '0' || s === '') return false;
  }
  return Boolean(v);
}

/** 新建/更新流水时写入 extra_data 的预算标记（仅支出有效）。 */
export function budgetExtraPatchForTransaction(
  transactionType: string,
  includeInBudget: boolean,
): Record<string, boolean> {
  if (transactionType !== 'expense') return {};
  return { [FINANCE_TXN_EXTRA_EXCLUDE_FROM_BUDGET]: !includeInBudget };
}

/** 支出是否计入预算（收入/转账恒为 true）。 */
export function isExpenseIncludedInBudget(extraData: string | null): boolean {
  return !readExcludeFromBudgetFromExtraObject(parseFinanceTxnExtraObject(extraData));
}

const FINANCE_TXN_EXTRA_TRANSFER_FIELDS = [
  'manual',
  'transfer_group_id',
  'transfer_leg',
  'counterparty_account_id',
  'counterparty_account_name',
] as const;

/**
 * 构建转账流水 `extra_data`（转出/转入各一条，靠 `transfer_leg` 区分方向）。
 */
export function buildFinanceTransferTxnExtra(input: {
  groupId: string;
  leg: 'out' | 'in';
  counterpartyAccountId: string;
  counterpartyAccountName: string;
}): string {
  return JSON.stringify({
    manual: true,
    transfer_group_id: input.groupId,
    transfer_leg: input.leg,
    counterparty_account_id: input.counterpartyAccountId,
    counterparty_account_name: input.counterpartyAccountName,
  });
}

/**
 * REST 回写本地时合并 extra_data：预算标记以本地为准（服务端可能未持久化或回传默认值）。
 */
export function mergeFinanceTxnExtraOnApiSync(
  apiExtraData: string | null | undefined,
  localExtraData: string | null | undefined,
): string | null {
  const api = parseFinanceTxnExtraObject(apiExtraData ?? null);
  const local = parseFinanceTxnExtraObject(localExtraData ?? null);
  const merged: Record<string, unknown> = { ...api };

  // 本地已写入时以本地为准：服务端可能未持久化该字段，或回传默认 false 覆盖用户标记
  if (FINANCE_TXN_EXTRA_EXCLUDE_FROM_BUDGET in local) {
    merged[FINANCE_TXN_EXTRA_EXCLUDE_FROM_BUDGET] = local[FINANCE_TXN_EXTRA_EXCLUDE_FROM_BUDGET];
  }
  if (
    FINANCE_TXN_EXTRA_BUDGET_FIXED_EXPENSE_ID in local &&
    !(FINANCE_TXN_EXTRA_BUDGET_FIXED_EXPENSE_ID in api)
  ) {
    merged[FINANCE_TXN_EXTRA_BUDGET_FIXED_EXPENSE_ID] = local[FINANCE_TXN_EXTRA_BUDGET_FIXED_EXPENSE_ID];
  }

  const localLeg = local.transfer_leg;
  if (localLeg === 'out' || localLeg === 'in') {
    for (const key of FINANCE_TXN_EXTRA_TRANSFER_FIELDS) {
      if (key in local) {
        merged[key] = local[key];
      }
    }
  }

  if (Object.keys(merged).length === 0) return null;
  return JSON.stringify(merged);
}

export function isFinanceTransactionExcludedFromBudget(extraData: string | null): boolean {
  if (getBudgetFixedExpenseIdFromTxnExtra(extraData) !== null) return true;
  return readExcludeFromBudgetFromExtraObject(parseFinanceTxnExtraObject(extraData));
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
