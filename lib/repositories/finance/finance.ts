import { makeTimestampEntityId } from '@/lib/entity-id';
import { readApiRecord, readApiTable } from '@/lib/api-read';
import { compareDatetimeDesc, sortBySortOrderAsc, ymdFromDatetime } from '@/lib/api-read-helpers';
import { getDatabase } from '../../database.native';
import type {
  CreateFinanceAccountInput,
  CreateFinanceFlowCategoryInput,
  CreateFinanceTransactionInput,
  FinanceAccountTypeRow,
  FinanceDailySummaryRow,
  FinanceAccountBalanceRow,
  FinanceAccountRow,
  FinanceFlowCategoryRow,
  FinanceTransactionRow,
  UpsertFinanceAccountTypeInput,
  UpdateFinanceAccountInput,
  UpdateFinanceFlowCategoryInput,
  UpdateFinanceTransactionInput,
} from './finance.types';

async function getFinanceAccountById(id: string) {
  const db = await getDatabase();
  return db.getFirstAsync<FinanceAccountRow>('SELECT * FROM finance_accounts WHERE id = ? AND deleted_at IS NULL LIMIT 1', [id]);
}

async function assertTransactionAmountSign(accountId: string, amount: number) {
  const account = await getFinanceAccountById(accountId);
  if (!account) {
    throw new Error('finance account not found');
  }
  if (amount === 0) {
    throw new Error('finance transaction amount must not be 0');
  }
  if (account.sign_rule > 0 && amount < 0) {
    throw new Error('asset-like account only supports positive amount');
  }
  if (account.sign_rule < 0 && amount > 0) {
    throw new Error('liability-like account only supports negative amount');
  }
}

/** 与 `getFinanceAccountsWithBalance` 中按账户汇总 balance 的规则一致（收入 +、支出 -、转账按 leg）。 */
export function computeTransactionLedgerEffect(
  transactionType: string,
  amount: number,
  extraData: string | null | undefined
): number {
  if (transactionType === 'income') return Math.abs(amount);
  if (transactionType === 'expense') return -Math.abs(amount);
  if (transactionType === 'transfer') {
    let leg: string | undefined;
    try {
      if (extraData) {
        const raw = JSON.parse(extraData) as unknown;
        if (raw && typeof raw === 'object') {
          const v = (raw as Record<string, unknown>).transfer_leg;
          leg = typeof v === 'string' ? v : undefined;
        }
      }
    } catch {
      // ignore
    }
    if (leg === 'out') return -Math.abs(amount);
    if (leg === 'in') return Math.abs(amount);
    return 0;
  }
  return -Math.abs(amount);
}

const FINANCE_BALANCE_EPS = 1e-4;

function assertFinanceBalanceWithinSignRule(signRule: number, balance: number): void {
  if (signRule > 0 && balance < -FINANCE_BALANCE_EPS) {
    throw new Error('资产类账户余额不能为负数。');
  }
  if (signRule < 0 && balance > FINANCE_BALANCE_EPS) {
    throw new Error('负债类账户余额不能为正数。');
  }
}

/** 保存后余额是否满足「资产 ≥0、负债 ≤0」；返回 `null` 表示通过，否则为中文错误说明。 */
export function validateFinanceLedgerBalanceAfterChange(
  signRule: number,
  currentBalance: number,
  transactionType: string,
  amount: number,
  extraData: string | null | undefined
): string | null {
  try {
    const delta = computeTransactionLedgerEffect(transactionType, amount, extraData);
    assertFinanceBalanceWithinSignRule(signRule, currentBalance + delta);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : '余额不符合账户类型约束。';
  }
}

async function getFinanceAccountComputedBalance(accountId: string): Promise<number> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ balance: number }>(
    `
    SELECT COALESCE(SUM(
      CASE
        WHEN t.transaction_type = 'income' THEN ABS(t.amount)
        WHEN t.transaction_type = 'expense' THEN -ABS(t.amount)
        WHEN t.transaction_type = 'transfer' THEN
          CASE json_extract(t.extra_data, '$.transfer_leg')
            WHEN 'out' THEN -ABS(t.amount)
            WHEN 'in' THEN ABS(t.amount)
            ELSE 0
          END
        ELSE -ABS(t.amount)
      END
    ), 0) AS balance
    FROM finance_transactions t
    WHERE t.deleted_at IS NULL AND t.account_id = ?
    `,
    [accountId]
  );
  return row?.balance ?? 0;
}

/**
 * 将用户在表单中输入的金额转为「账本余额」目标值（与 `getFinanceAccountsWithBalance` 一致）。
 * 负债：正数表示负债规模，对应账本 ≤0；资产：非负。
 */
export function financeTargetLedgerFromUserBalanceInput(input: {
  userNumeric: number;
  signRule: number;
  accountType: string;
}): number {
  const isLiability = input.signRule < 0 || input.accountType === 'liability';
  if (isLiability) return -Math.abs(input.userNumeric);
  return Math.max(0, input.userNumeric);
}

/** 输入框预填：负债为正数，资产为非负 */
export function financeBalanceInputTextFromLedger(ledger: number, signRule: number, accountType: string): string {
  const isLiability = signRule < 0 || accountType === 'liability';
  if (isLiability) return Math.abs(Math.min(0, ledger)).toFixed(2);
  return Math.max(0, ledger).toFixed(2);
}

export async function createFinanceAccount(input: CreateFinanceAccountInput) {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO finance_accounts (
      id, name, account_no, account_type, sign_rule, note,
      created_at, updated_at, deleted_at, sync_status, version, extra_data
    ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), NULL, 'pending_create', 1, ?)`,
    [
      input.id,
      input.name,
      input.account_no ?? null,
      input.account_type ?? 'asset',
      input.sign_rule ?? 1,
      input.note ?? null,
      input.extra_data ?? null,
    ]
  );
}

async function loadFinanceAccounts(): Promise<FinanceAccountRow[]> {
  const rows = await readApiTable<FinanceAccountRow>('finance_accounts', { offlineFallback: true });
  return [...rows].sort((a, b) => {
    const c = compareDatetimeDesc(a.created_at, b.created_at) * -1;
    if (c !== 0) return c;
    return compareDatetimeDesc(a.updated_at, b.updated_at);
  });
}

async function loadFinanceTransactionsForActiveAccounts(): Promise<FinanceTransactionRow[]> {
  const [accounts, transactions] = await Promise.all([
    loadFinanceAccounts(),
    readApiTable<FinanceTransactionRow>('finance_transactions', { offlineFallback: true }),
  ]);
  const accountIds = new Set(accounts.map(a => a.id));
  return transactions
    .filter(t => accountIds.has(t.account_id))
    .sort((a, b) => {
      const h = compareDatetimeDesc(a.happened_at, b.happened_at);
      if (h !== 0) return h;
      return compareDatetimeDesc(a.updated_at, b.updated_at);
    });
}

export async function getFinanceAccounts() {
  return loadFinanceAccounts();
}

export async function getFinanceAccountsWithBalance() {
  const accounts = await loadFinanceAccounts();
  const transactions = await loadFinanceTransactionsForActiveAccounts();
  return accounts.map(a => {
    const balance = transactions
      .filter(t => t.account_id === a.id)
      .reduce(
        (sum, t) =>
          sum +
          computeTransactionLedgerEffect(t.transaction_type, t.amount, t.extra_data),
        0,
      );
    return { ...a, balance } satisfies FinanceAccountBalanceRow;
  });
}

export async function getFinanceAccountTypes() {
  const rows = await readApiTable<FinanceAccountTypeRow>('finance_account_types', { offlineFallback: true });
  return sortBySortOrderAsc(rows);
}

export async function upsertFinanceAccountType(input: UpsertFinanceAccountTypeInput) {
  const db = await getDatabase();
  const name = input.name.trim();
  if (!name) {
    throw new Error('finance account type name is required');
  }

  const existing = await db.getFirstAsync<FinanceAccountTypeRow>(
    `SELECT * FROM finance_account_types
     WHERE name = ?
     ORDER BY datetime(updated_at) DESC
     LIMIT 1`,
    [name]
  );

  if (existing) {
    await db.runAsync(
      `UPDATE finance_account_types
       SET is_liability = ?, icon_key = ?, deleted_at = NULL,
           updated_at = datetime('now'),
           sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_update' ELSE sync_status END,
           version = version + 1
       WHERE id = ?`,
      [input.is_liability ? 1 : 0, input.icon_key || 'savings', existing.id]
    );
    return existing.id;
  }

  const id = makeTimestampEntityId('fat_', 8);
  const sortRow = await db.getFirstAsync<{ max_sort: number | null }>(
    `SELECT MAX(sort_order) AS max_sort FROM finance_account_types WHERE deleted_at IS NULL`
  );
  const nextSort = (sortRow?.max_sort ?? 0) + 1;
  await db.runAsync(
    `INSERT INTO finance_account_types (
      id, name, is_liability, icon_key, sort_order,
      created_at, updated_at, deleted_at, sync_status, version, extra_data
    ) VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'), NULL, 'pending_create', 1, NULL)`,
    [id, name, input.is_liability ? 1 : 0, input.icon_key || 'savings', nextSort]
  );
  return id;
}

export async function deleteFinanceAccountTypeByName(name: string) {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE finance_account_types
     SET deleted_at = datetime('now'),
         updated_at = datetime('now'),
         sync_status = 'pending_delete',
         version = version + 1
     WHERE name = ? AND deleted_at IS NULL`,
    [name.trim()]
  );
}

export async function updateFinanceAccount(id: string, input: UpdateFinanceAccountInput) {
  const db = await getDatabase();
  const current = await getFinanceAccountById(id);
  if (!current) return;

  await db.runAsync(
    `UPDATE finance_accounts
     SET name = ?, account_no = ?, account_type = ?, sign_rule = ?, note = ?, extra_data = ?,
         updated_at = datetime('now'),
         sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_update' ELSE sync_status END,
         version = version + 1
     WHERE id = ?`,
    [
      input.name ?? current.name,
      input.account_no ?? current.account_no,
      input.account_type ?? current.account_type,
      input.sign_rule ?? current.sign_rule,
      input.note ?? current.note,
      input.extra_data ?? current.extra_data,
      id,
    ]
  );
}

export async function deleteFinanceAccount(id: string) {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE finance_transactions
     SET deleted_at = datetime('now'),
         updated_at = datetime('now'),
         sync_status = 'pending_delete',
         version = version + 1
     WHERE account_id = ? AND deleted_at IS NULL`,
    [id]
  );
  await db.runAsync(
    `UPDATE finance_accounts
     SET deleted_at = datetime('now'), updated_at = datetime('now'), sync_status = 'pending_delete', version = version + 1
     WHERE id = ?`,
    [id]
  );
}

export async function createFinanceFlowCategory(input: CreateFinanceFlowCategoryInput) {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO finance_flow_categories (
      id, name, parent_id, sort_order, is_builtin, created_at, updated_at, deleted_at, sync_status, version, extra_data
    ) VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'), NULL, 'pending_create', 1, ?)`,
    [
      input.id,
      input.name,
      input.parent_id ?? null,
      input.sort_order ?? 1000,
      input.is_builtin ?? 0,
      input.extra_data ?? null,
    ]
  );
}

export async function getFinanceFlowCategories() {
  const rows = await readApiTable<FinanceFlowCategoryRow>('finance_flow_categories', { offlineFallback: true });
  return sortBySortOrderAsc(rows);
}

export async function updateFinanceFlowCategory(id: string, input: UpdateFinanceFlowCategoryInput) {
  const db = await getDatabase();
  const current = await db.getFirstAsync<FinanceFlowCategoryRow>(
    'SELECT * FROM finance_flow_categories WHERE id = ? AND deleted_at IS NULL LIMIT 1',
    [id]
  );
  if (!current) return;

  await db.runAsync(
    `UPDATE finance_flow_categories
     SET name = ?, parent_id = ?, sort_order = ?, is_builtin = ?, extra_data = ?,
         updated_at = datetime('now'),
         sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_update' ELSE sync_status END,
         version = version + 1
     WHERE id = ?`,
    [
      input.name ?? current.name,
      input.parent_id ?? current.parent_id,
      input.sort_order ?? current.sort_order,
      input.is_builtin ?? current.is_builtin,
      input.extra_data ?? current.extra_data,
      id,
    ]
  );
}

export async function deleteFinanceFlowCategory(id: string) {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE finance_flow_categories
     SET deleted_at = datetime('now'), updated_at = datetime('now'), sync_status = 'pending_delete', version = version + 1
     WHERE id = ?`,
    [id]
  );
}

export async function createFinanceTransaction(input: CreateFinanceTransactionInput) {
  await assertTransactionAmountSign(input.account_id, input.amount);
  const account = await getFinanceAccountById(input.account_id);
  if (!account) {
    throw new Error('finance account not found');
  }
  const curBalance = await getFinanceAccountComputedBalance(input.account_id);
  const delta = computeTransactionLedgerEffect(
    input.transaction_type ?? 'expense',
    input.amount,
    input.extra_data ?? null
  );
  assertFinanceBalanceWithinSignRule(account.sign_rule, curBalance + delta);

  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO finance_transactions (
      id, name, happened_at, account_id, ai_comment, transaction_type, flow_category_id, amount, note,
      created_at, updated_at, deleted_at, sync_status, version, extra_data
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), NULL, 'pending_create', 1, ?)`,
    [
      input.id,
      input.name,
      input.happened_at,
      input.account_id,
      input.ai_comment ?? null,
      input.transaction_type ?? 'expense',
      input.flow_category_id ?? null,
      input.amount,
      input.note ?? null,
      input.extra_data ?? null,
    ]
  );
}

const FINANCE_BALANCE_ADJUST_EPS = 1e-4;

/**
 * 通过一笔「余额校正」流水把账户账本余额对齐到目标值（不改变账户元数据）。
 */
export async function applyFinanceAccountBalanceCorrection(input: {
  accountId: string;
  targetLedgerBalance: number;
  note?: string | null;
}): Promise<void> {
  const account = await getFinanceAccountById(input.accountId);
  if (!account) {
    throw new Error('finance account not found');
  }

  let target = input.targetLedgerBalance;
  if (account.sign_rule > 0 && target < 0) target = 0;
  if (account.sign_rule < 0 && target > 0) target = 0;

  const current = await getFinanceAccountComputedBalance(input.accountId);
  const delta = target - current;
  if (Math.abs(delta) < FINANCE_BALANCE_ADJUST_EPS) return;

  const id = makeTimestampEntityId('ft_badj_', 6);
  const happened_at = new Date().toISOString();
  const extra = JSON.stringify({ reason: 'balance_correction' });
  const note = input.note ?? null;

  if (account.sign_rule > 0) {
    if (delta > 0) {
      await createFinanceTransaction({
        id,
        name: '余额校正',
        happened_at,
        account_id: input.accountId,
        transaction_type: 'income',
        amount: delta,
        note,
        extra_data: extra,
      });
    } else {
      await createFinanceTransaction({
        id,
        name: '余额校正',
        happened_at,
        account_id: input.accountId,
        transaction_type: 'expense',
        amount: -delta,
        note,
        extra_data: extra,
      });
    }
    return;
  }

  if (delta > 0) {
    await createFinanceTransaction({
      id,
      name: '余额校正',
      happened_at,
      account_id: input.accountId,
      transaction_type: 'income',
      amount: -delta,
      note,
      extra_data: extra,
    });
  } else {
    await createFinanceTransaction({
      id,
      name: '余额校正',
      happened_at,
      account_id: input.accountId,
      transaction_type: 'expense',
      amount: delta,
      note,
      extra_data: extra,
    });
  }
}

export async function getFinanceTransactionById(id: string) {
  return readApiRecord<FinanceTransactionRow>('finance_transactions', id, { offlineFallback: true });
}

export async function getFinanceTransactions() {
  return loadFinanceTransactionsForActiveAccounts();
}

export async function getFinanceTransactionsByAccountId(accountId: string) {
  const rows = await loadFinanceTransactionsForActiveAccounts();
  return rows.filter(t => t.account_id === accountId);
}

export async function getFinanceTransactionsByYmd(ymd: string) {
  const rows = await loadFinanceTransactionsForActiveAccounts();
  return rows.filter(t => ymdFromDatetime(t.happened_at) === ymd);
}

export async function getFinanceDailySummariesByDateRange(startYmd: string, endYmd: string) {
  const rows = await loadFinanceTransactionsForActiveAccounts();
  const byDay = new Map<string, { income: number; expense: number; net: number }>();
  for (const t of rows) {
    const day = ymdFromDatetime(t.happened_at);
    if (!day || day < startYmd || day > endYmd) continue;
    const effect = computeTransactionLedgerEffect(t.transaction_type, t.amount, t.extra_data);
    const agg = byDay.get(day) ?? { income: 0, expense: 0, net: 0 };
    if (effect > 0) agg.income += effect;
    else if (effect < 0) agg.expense += Math.abs(effect);
    agg.net += effect;
    byDay.set(day, agg);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, v]) => ({ day, ...v })) satisfies FinanceDailySummaryRow[];
}

export async function updateFinanceTransaction(id: string, input: UpdateFinanceTransactionInput) {
  const db = await getDatabase();
  const current = await db.getFirstAsync<FinanceTransactionRow>(
    'SELECT * FROM finance_transactions WHERE id = ? AND deleted_at IS NULL LIMIT 1',
    [id]
  );
  if (!current) return;

  const nextAccountId = input.account_id ?? current.account_id;
  const nextAmount = input.amount ?? current.amount;
  const nextType = input.transaction_type ?? current.transaction_type;
  const nextExtra = input.extra_data ?? current.extra_data;
  await assertTransactionAmountSign(nextAccountId, nextAmount);

  const oldEffect = computeTransactionLedgerEffect(current.transaction_type, current.amount, current.extra_data);
  const newEffect = computeTransactionLedgerEffect(nextType, nextAmount, nextExtra);

  if (current.account_id === nextAccountId) {
    const acct = await getFinanceAccountById(nextAccountId);
    if (acct) {
      const cur = await getFinanceAccountComputedBalance(nextAccountId);
      assertFinanceBalanceWithinSignRule(acct.sign_rule, cur - oldEffect + newEffect);
    }
  } else {
    const oldAcct = await getFinanceAccountById(current.account_id);
    const newAcct = await getFinanceAccountById(nextAccountId);
    if (oldAcct) {
      const curOld = await getFinanceAccountComputedBalance(current.account_id);
      assertFinanceBalanceWithinSignRule(oldAcct.sign_rule, curOld - oldEffect);
    }
    if (newAcct) {
      const curNew = await getFinanceAccountComputedBalance(nextAccountId);
      assertFinanceBalanceWithinSignRule(newAcct.sign_rule, curNew + newEffect);
    }
  }

  await db.runAsync(
    `UPDATE finance_transactions
     SET name = ?, happened_at = ?, account_id = ?, ai_comment = ?, transaction_type = ?, flow_category_id = ?, amount = ?, note = ?, extra_data = ?,
         updated_at = datetime('now'),
         sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_update' ELSE sync_status END,
         version = version + 1
     WHERE id = ?`,
    [
      input.name ?? current.name,
      input.happened_at ?? current.happened_at,
      nextAccountId,
      input.ai_comment ?? current.ai_comment,
      nextType,
      input.flow_category_id ?? current.flow_category_id,
      nextAmount,
      input.note ?? current.note,
      nextExtra,
      id,
    ]
  );
}

export async function deleteFinanceTransaction(id: string) {
  const db = await getDatabase();
  const current = await db.getFirstAsync<FinanceTransactionRow>(
    'SELECT * FROM finance_transactions WHERE id = ? AND deleted_at IS NULL LIMIT 1',
    [id]
  );
  if (current) {
    const acct = await getFinanceAccountById(current.account_id);
    if (acct) {
      const cur = await getFinanceAccountComputedBalance(current.account_id);
      const oldEffect = computeTransactionLedgerEffect(current.transaction_type, current.amount, current.extra_data);
      assertFinanceBalanceWithinSignRule(acct.sign_rule, cur - oldEffect);
    }
  }
  await db.runAsync(
    `UPDATE finance_transactions
     SET deleted_at = datetime('now'), updated_at = datetime('now'), sync_status = 'pending_delete', version = version + 1
     WHERE id = ?`,
    [id]
  );
}
