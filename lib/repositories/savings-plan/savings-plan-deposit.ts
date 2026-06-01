import { readApiTable } from '@/lib/api-read';
import { getDatabase } from '../../database.native';
import { getSavingsPlanById, SAVINGS_PLAN_MAX_TARGET_AMOUNT } from './savings-plan';
import type { CreateSavingsPlanDepositInput } from './savings-plan-deposit.types';

export async function getDepositSumForPlanId(planId: string) {
  const map = await getDepositSumsByActivePlanId();
  return map[planId] ?? 0;
}

export async function createSavingsPlanDeposit(input: CreateSavingsPlanDepositInput) {
  const plan = await getSavingsPlanById(input.savings_plan_id);
  if (!plan) {
    throw new Error('savings plan not found');
  }
  if (input.amount === 0) {
    throw new Error('amount cannot be zero');
  }
  const absAmount = Math.abs(input.amount);
  if (absAmount > SAVINGS_PLAN_MAX_TARGET_AMOUNT) {
    throw new Error('deposit amount must not exceed 8 digits');
  }
  const current = await getDepositSumForPlanId(input.savings_plan_id);

  if (input.amount < 0) {
    if (current + input.amount < 0) {
      throw new Error('withdrawal exceeds saved balance');
    }
  } else if (plan.target_amount > 0 && current + input.amount > plan.target_amount) {
    throw new Error('deposit exceeds plan target');
  }

  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO savings_plan_deposits (
      id, savings_plan_id, amount, note,
      created_at, updated_at, sync_status, extra_data
    ) VALUES (?, ?, ?, ?, datetime('now'), datetime('now'), 'pending_create', ?)`,
    [input.id, input.savings_plan_id, input.amount, input.note ?? null, input.extra_data ?? null]
  );
}

/** 未删除计划下的存入总额（用于顶部「已存款」） */
export async function getTotalDepositsForActivePlans() {
  const [plans, deposits] = await Promise.all([
    readApiTable<{ id: string }>('savings_plans', { offlineFallback: true }),
    readApiTable<{ savings_plan_id: string; amount: number }>('savings_plan_deposits', { offlineFallback: true }),
  ]);
  const planIds = new Set(plans.map(p => p.id));
  return deposits
    .filter(d => planIds.has(d.savings_plan_id))
    .reduce((sum, d) => sum + Number(d.amount ?? 0), 0);
}

/** 各未删除计划的存入合计（计划无记录时为 0，由调用方补全） */
export async function getDepositSumsByActivePlanId() {
  const [plans, deposits] = await Promise.all([
    readApiTable<{ id: string }>('savings_plans', { offlineFallback: true }),
    readApiTable<{ savings_plan_id: string; amount: number }>('savings_plan_deposits', { offlineFallback: true }),
  ]);
  const planIds = new Set(plans.map(p => p.id));
  const map: Record<string, number> = {};
  for (const d of deposits) {
    if (!planIds.has(d.savings_plan_id)) continue;
    map[d.savings_plan_id] = (map[d.savings_plan_id] ?? 0) + Number(d.amount ?? 0);
  }
  return map;
}
