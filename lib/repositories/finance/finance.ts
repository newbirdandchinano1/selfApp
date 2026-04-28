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

export async function getFinanceAccounts() {
  const db = await getDatabase();
  return db.getAllAsync<FinanceAccountRow>(
    'SELECT * FROM finance_accounts WHERE deleted_at IS NULL ORDER BY datetime(created_at) ASC, datetime(updated_at) DESC'
  );
}

export async function getFinanceAccountsWithBalance() {
  const db = await getDatabase();
  return db.getAllAsync<FinanceAccountBalanceRow>(
    `
    SELECT
      a.*,
      COALESCE(SUM(
        CASE
          WHEN t.id IS NULL THEN 0
          WHEN t.transaction_type = 'income' THEN ABS(t.amount)
          WHEN t.transaction_type = 'expense' THEN -ABS(t.amount)
          WHEN t.transaction_type = 'transfer' THEN 0
          ELSE -ABS(t.amount)
        END
      ), 0) AS balance
    FROM finance_accounts a
    LEFT JOIN finance_transactions t
      ON t.account_id = a.id
     AND t.deleted_at IS NULL
    WHERE a.deleted_at IS NULL
    GROUP BY a.id
    ORDER BY datetime(a.created_at) ASC, datetime(a.updated_at) DESC
    `
  );
}

export async function getFinanceAccountTypes() {
  const db = await getDatabase();
  return db.getAllAsync<FinanceAccountTypeRow>(
    `SELECT * FROM finance_account_types
     WHERE deleted_at IS NULL
     ORDER BY sort_order ASC, datetime(created_at) ASC, datetime(updated_at) DESC`
  );
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

  const id = `fat_${Date.now()}_${Math.random().toString(16).slice(2)}`;
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
  const db = await getDatabase();
  return db.getAllAsync<FinanceFlowCategoryRow>(
    'SELECT * FROM finance_flow_categories WHERE deleted_at IS NULL ORDER BY sort_order ASC, datetime(created_at) ASC'
  );
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

export async function getFinanceTransactions() {
  const db = await getDatabase();
  return db.getAllAsync<FinanceTransactionRow>(
    `SELECT t.*
     FROM finance_transactions t
     INNER JOIN finance_accounts a
       ON a.id = t.account_id
      AND a.deleted_at IS NULL
     WHERE t.deleted_at IS NULL
     ORDER BY datetime(t.happened_at) DESC, datetime(t.updated_at) DESC`
  );
}

export async function getFinanceTransactionsByAccountId(accountId: string) {
  const db = await getDatabase();
  return db.getAllAsync<FinanceTransactionRow>(
    `SELECT t.*
     FROM finance_transactions t
     INNER JOIN finance_accounts a
       ON a.id = t.account_id
      AND a.deleted_at IS NULL
     WHERE t.deleted_at IS NULL AND t.account_id = ?
     ORDER BY datetime(t.happened_at) DESC, datetime(t.updated_at) DESC`,
    [accountId]
  );
}

export async function getFinanceTransactionsByYmd(ymd: string) {
  const db = await getDatabase();
  return db.getAllAsync<FinanceTransactionRow>(
    `SELECT t.*
     FROM finance_transactions t
     INNER JOIN finance_accounts a
       ON a.id = t.account_id
      AND a.deleted_at IS NULL
     WHERE t.deleted_at IS NULL AND date(t.happened_at) = date(?)
     ORDER BY datetime(t.happened_at) DESC, datetime(t.updated_at) DESC`,
    [ymd]
  );
}

export async function getFinanceDailySummariesByDateRange(startYmd: string, endYmd: string) {
  const db = await getDatabase();
  return db.getAllAsync<FinanceDailySummaryRow>(
    `
    WITH tx_effect AS (
      SELECT
        date(t.happened_at) AS day,
        CASE
          WHEN t.transaction_type = 'income' THEN ABS(t.amount)
          WHEN t.transaction_type = 'expense' THEN -ABS(t.amount)
          WHEN t.transaction_type = 'transfer' THEN 0
          ELSE -ABS(t.amount)
        END AS effect_amount
      FROM finance_transactions t
      INNER JOIN finance_accounts a
        ON a.id = t.account_id
       AND a.deleted_at IS NULL
      WHERE t.deleted_at IS NULL
        AND date(t.happened_at) >= date(?)
        AND date(t.happened_at) <= date(?)
    )
    SELECT
      day,
      COALESCE(SUM(CASE WHEN effect_amount > 0 THEN effect_amount ELSE 0 END), 0) AS income,
      COALESCE(SUM(CASE WHEN effect_amount < 0 THEN ABS(effect_amount) ELSE 0 END), 0) AS expense,
      COALESCE(SUM(effect_amount), 0) AS net
    FROM tx_effect
    GROUP BY day
    ORDER BY day ASC
    `,
    [startYmd, endYmd]
  );
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
  await assertTransactionAmountSign(nextAccountId, nextAmount);

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
      input.transaction_type ?? current.transaction_type,
      input.flow_category_id ?? current.flow_category_id,
      nextAmount,
      input.note ?? current.note,
      input.extra_data ?? current.extra_data,
      id,
    ]
  );
}

export async function deleteFinanceTransaction(id: string) {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE finance_transactions
     SET deleted_at = datetime('now'), updated_at = datetime('now'), sync_status = 'pending_delete', version = version + 1
     WHERE id = ?`,
    [id]
  );
}
