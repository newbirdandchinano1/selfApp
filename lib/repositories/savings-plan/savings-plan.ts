import { readLocalRowForWrite } from '@/lib/api-local-row';
import { readApiRecord, readApiTable } from '@/lib/api-read';
import { sortByUpdatedDesc } from '@/lib/api-read-helpers';
import { getDatabase } from '../../database.native';
import type { CreateSavingsPlanInput, SavingsPlanRow, UpdateSavingsPlanInput } from './savings-plan.types';

/** 目标金额整数最多 8 位（含），即 ≤ 99_999_999 */
export const SAVINGS_PLAN_MAX_TARGET_AMOUNT = 99_999_999;

function calendarDaysBetween(startIso: string, endIso: string) {
  const [ys, ms, ds] = startIso.split('-').map((x) => parseInt(x, 10));
  const [ye, me, de] = endIso.split('-').map((x) => parseInt(x, 10));
  if (!ys || !ms || !ds || !ye || !me || !de) return 0;
  const s = new Date(ys, ms - 1, ds).getTime();
  const e = new Date(ye, me - 1, de).getTime();
  return Math.round((e - s) / 86400000);
}

function assertSavingsPlanDatesAndTarget(start_date: string, end_date: string, target_amount: number) {
  if (end_date < start_date) {
    throw new Error('savings plan end_date must be >= start_date');
  }
  if (calendarDaysBetween(start_date, end_date) < 1) {
    throw new Error('savings plan date span must be at least 1 day');
  }
  if (target_amount < 0) {
    throw new Error('savings plan target_amount must be >= 0');
  }
  if (target_amount > SAVINGS_PLAN_MAX_TARGET_AMOUNT) {
    throw new Error('savings plan target_amount must not exceed 8 digits');
  }
}

export async function createSavingsPlan(input: CreateSavingsPlanInput) {
  const name = input.name.trim();
  if (!name) {
    throw new Error('savings plan name is required');
  }
  assertSavingsPlanDatesAndTarget(input.start_date, input.end_date, input.target_amount);

  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO savings_plans (
      id, name, start_date, end_date, target_amount, avatar_uri,
      created_at, updated_at, sync_status, extra_data
    ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), 'pending_create', ?)`,
    [
      input.id,
      name,
      input.start_date,
      input.end_date,
      input.target_amount,
      input.avatar_uri ?? null,
      input.extra_data ?? null,
    ]
  );
}

export async function getSavingsPlanById(id: string) {
  return readApiRecord<SavingsPlanRow>('savings_plans', id, { offlineFallback: true });
}

export async function getSavingsPlans() {
  const rows = await readApiTable<SavingsPlanRow>('savings_plans', { offlineFallback: true });
  return sortByUpdatedDesc(rows);
}

export async function updateSavingsPlan(id: string, input: UpdateSavingsPlanInput) {
  const db = await getDatabase();
  const current = await readLocalRowForWrite<SavingsPlanRow>('savings_plans', id);
  if (!current) return;

  const nextName = input.name !== undefined ? input.name.trim() : current.name;
  if (!nextName) {
    throw new Error('savings plan name is required');
  }

  const start = input.start_date ?? current.start_date;
  const end = input.end_date ?? current.end_date;
  const target = input.target_amount ?? current.target_amount;
  if (
    input.start_date !== undefined ||
    input.end_date !== undefined ||
    input.target_amount !== undefined
  ) {
    assertSavingsPlanDatesAndTarget(start, end, target);
  }

  await db.runAsync(
    `UPDATE savings_plans
     SET name = ?, start_date = ?, end_date = ?, target_amount = ?, avatar_uri = ?, extra_data = ?,
         updated_at = datetime('now'),
         sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_update' ELSE sync_status END
     WHERE id = ?`,
    [
      nextName,
      start,
      end,
      target,
      input.avatar_uri !== undefined ? input.avatar_uri : current.avatar_uri,
      input.extra_data !== undefined ? input.extra_data : current.extra_data,
      id,
    ]
  );
}

export async function deleteSavingsPlan(id: string) {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE savings_plans
     SET updated_at = datetime('now'), sync_status = 'pending_delete'
     WHERE id = ?`,
    [id]
  );
}
