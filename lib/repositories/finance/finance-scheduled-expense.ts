import { ensureLocalRowForWrite } from '@/lib/api-local-row';
import { getDatabase } from '../../database.native';
import type {
  CreateFinanceScheduledExpenseInput,
  FinanceScheduledExpenseRow,
  UpdateFinanceScheduledExpenseInput,
} from './finance-scheduled-expense.types';

const TABLE = 'finance_scheduled_expenses';

export async function listFinanceScheduledExpensesLocal(): Promise<FinanceScheduledExpenseRow[]> {
  const db = await getDatabase();
  if (!db) return [];
  const rows = await db.getAllAsync<FinanceScheduledExpenseRow>(
    `SELECT * FROM ${TABLE} WHERE sync_status != 'pending_delete' ORDER BY created_at ASC, id ASC`,
  );
  return rows ?? [];
}

export async function getFinanceScheduledExpenseByIdLocal(
  id: string,
): Promise<FinanceScheduledExpenseRow | null> {
  const pk = id.trim();
  if (!pk) return null;
  const db = await getDatabase();
  if (!db) return null;
  const row = await db.getFirstAsync<FinanceScheduledExpenseRow>(
    `SELECT * FROM ${TABLE} WHERE id = ? AND sync_status != 'pending_delete' LIMIT 1`,
    [pk],
  );
  return row ?? null;
}

export async function createFinanceScheduledExpense(
  input: CreateFinanceScheduledExpenseInput,
): Promise<void> {
  const name = input.name.trim();
  if (!name) throw new Error('定时支出名称不能为空');
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new Error('定时支出金额无效');
  }
  const accountId = input.account_id.trim();
  if (!accountId) throw new Error('定时支出账户无效');

  const db = await getDatabase();
  if (!db) throw new Error('数据库未就绪');

  const createdAt = input.created_at?.trim() || null;
  await db.runAsync(
    `INSERT INTO ${TABLE} (
      id, name, amount, account_id, repeat_option, weekly_days, monthly_days,
      hour, minute, times_per_day, flow_category_id, category_key, category_label,
      include_in_budget, enabled, created_at, updated_at, sync_status, extra_data
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?, COALESCE(?, datetime('now')), datetime('now'), 'pending_create', ?
    )`,
    [
      input.id,
      name,
      input.amount,
      accountId,
      input.repeat_option || 'daily',
      input.weekly_days ?? null,
      input.monthly_days ?? null,
      input.hour ?? 8,
      input.minute ?? 0,
      input.times_per_day ?? 1,
      input.flow_category_id ?? null,
      input.category_key ?? null,
      input.category_label ?? null,
      input.include_in_budget ?? 1,
      input.enabled ?? 1,
      createdAt,
      input.extra_data ?? null,
    ],
  );
}

export async function updateFinanceScheduledExpense(
  id: string,
  input: UpdateFinanceScheduledExpenseInput,
): Promise<void> {
  const db = await getDatabase();
  if (!db) throw new Error('数据库未就绪');
  const current = await ensureLocalRowForWrite<FinanceScheduledExpenseRow>(TABLE, id);
  if (!current) throw new Error('未找到定时支出');

  const nextName = input.name !== undefined ? input.name.trim() : current.name;
  if (!nextName) throw new Error('定时支出名称不能为空');

  const nextAmount = input.amount !== undefined ? input.amount : current.amount;
  if (!Number.isFinite(nextAmount) || nextAmount <= 0) {
    throw new Error('定时支出金额无效');
  }

  const nextAccountId =
    input.account_id !== undefined ? input.account_id.trim() : current.account_id;
  if (!nextAccountId) throw new Error('定时支出账户无效');

  await db.runAsync(
    `UPDATE ${TABLE}
     SET name = ?,
         amount = ?,
         account_id = ?,
         repeat_option = ?,
         weekly_days = ?,
         monthly_days = ?,
         hour = ?,
         minute = ?,
         times_per_day = ?,
         flow_category_id = ?,
         category_key = ?,
         category_label = ?,
         include_in_budget = ?,
         enabled = ?,
         extra_data = ?,
         updated_at = datetime('now'),
         sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_update' ELSE sync_status END
     WHERE id = ?`,
    [
      nextName,
      nextAmount,
      nextAccountId,
      input.repeat_option !== undefined ? input.repeat_option : current.repeat_option,
      input.weekly_days !== undefined ? input.weekly_days : current.weekly_days,
      input.monthly_days !== undefined ? input.monthly_days : current.monthly_days,
      input.hour !== undefined ? input.hour : current.hour,
      input.minute !== undefined ? input.minute : current.minute,
      input.times_per_day !== undefined ? input.times_per_day : current.times_per_day,
      input.flow_category_id !== undefined ? input.flow_category_id : current.flow_category_id,
      input.category_key !== undefined ? input.category_key : current.category_key,
      input.category_label !== undefined ? input.category_label : current.category_label,
      input.include_in_budget !== undefined ? input.include_in_budget : current.include_in_budget,
      input.enabled !== undefined ? input.enabled : current.enabled,
      input.extra_data !== undefined ? input.extra_data : current.extra_data,
      id,
    ],
  );
}

export async function deleteFinanceScheduledExpense(id: string): Promise<void> {
  await ensureLocalRowForWrite(TABLE, id);
  const db = await getDatabase();
  if (!db) return;
  await db.runAsync(
    `UPDATE ${TABLE}
     SET updated_at = datetime('now'), sync_status = 'pending_delete'
     WHERE id = ?`,
    [id],
  );
}
