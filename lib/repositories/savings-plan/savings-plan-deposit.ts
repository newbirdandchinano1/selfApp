import { getDatabase } from '../../database.native';
import { getSavingsPlanById, SAVINGS_PLAN_MAX_TARGET_AMOUNT } from './savings-plan';
import type { CreateSavingsPlanDepositInput } from './savings-plan-deposit.types';

export async function createSavingsPlanDeposit(input: CreateSavingsPlanDepositInput) {
  const plan = await getSavingsPlanById(input.savings_plan_id);
  if (!plan) {
    throw new Error('savings plan not found');
  }
  if (input.amount <= 0) {
    throw new Error('deposit amount must be positive');
  }
  if (input.amount > SAVINGS_PLAN_MAX_TARGET_AMOUNT) {
    throw new Error('deposit amount must not exceed 8 digits');
  }

  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO savings_plan_deposits (
      id, savings_plan_id, amount, note,
      created_at, updated_at, deleted_at, sync_status, version, extra_data
    ) VALUES (?, ?, ?, ?, datetime('now'), datetime('now'), NULL, 'pending_create', 1, ?)`,
    [input.id, input.savings_plan_id, input.amount, input.note ?? null, input.extra_data ?? null]
  );
}

/** 未删除计划下的存入总额（用于顶部「已存款」） */
export async function getTotalDepositsForActivePlans() {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ total: number }>(
    `
    SELECT COALESCE(SUM(d.amount), 0) AS total
    FROM savings_plan_deposits d
    INNER JOIN savings_plans p ON p.id = d.savings_plan_id AND p.deleted_at IS NULL
    WHERE d.deleted_at IS NULL
    `
  );
  return row?.total ?? 0;
}

/** 各未删除计划的存入合计（计划无记录时为 0，由调用方补全） */
export async function getDepositSumsByActivePlanId() {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ savings_plan_id: string; total: number }>(
    `
    SELECT d.savings_plan_id, COALESCE(SUM(d.amount), 0) AS total
    FROM savings_plan_deposits d
    INNER JOIN savings_plans p ON p.id = d.savings_plan_id AND p.deleted_at IS NULL
    WHERE d.deleted_at IS NULL
    GROUP BY d.savings_plan_id
    `
  );
  const map: Record<string, number> = {};
  for (const r of rows) {
    map[r.savings_plan_id] = r.total;
  }
  return map;
}
