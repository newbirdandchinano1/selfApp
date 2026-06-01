import { readApiRecord, readApiTable } from '@/lib/api-read';
import { sortBySortOrderAsc } from '@/lib/api-read-helpers';
import { makeTimestampEntityId } from '@/lib/entity-id';
import { getDatabase } from '../../database.native';
import { CASH_FLOW_EMPTY_STATE } from './cash-flow.defaults';
import type {
  CashFlowExpenseLineRow,
  CashFlowHoldingRow,
  CashFlowIncomeRow,
  CashFlowProfileRow,
  CashFlowQuadrant,
  CashFlowState,
  ExpenseFlowLine,
  Holding,
  HoldingExtra,
  IncomeItem,
} from './cash-flow.types';

export const CASH_FLOW_PROFILE_ID = 'default';

function assertQuadrant(q: string): asserts q is CashFlowQuadrant {
  if (!['E', 'S', 'B', 'I'].includes(q)) {
    throw new Error('invalid cash flow quadrant');
  }
}

function mapIncomeRow(r: CashFlowIncomeRow): IncomeItem {
  assertQuadrant(r.quadrant);
  return {
    id: r.id,
    name: r.name,
    amount: r.amount,
    quadrant: r.quadrant,
  };
}

function mapExpenseLineRow(r: CashFlowExpenseLineRow): ExpenseFlowLine | null {
  if (r.bucket !== 'necessary' && r.bucket !== 'unnecessary') return null;
  return {
    id: r.id,
    name: r.name,
    amount: r.amount,
    bucket: r.bucket,
  };
}

function parseHoldingExtra(raw: string | null | undefined): HoldingExtra | undefined {
  if (!raw) return undefined;
  try {
    const p = JSON.parse(raw) as unknown;
    if (!p || typeof p !== 'object' || Array.isArray(p)) return undefined;
    const o = p as Record<string, unknown>;
    const out: HoldingExtra = {};
    if (typeof o.repayMonths === 'number' && Number.isFinite(o.repayMonths) && o.repayMonths >= 0) {
      out.repayMonths = Math.round(o.repayMonths);
    }
    return Object.keys(out).length ? out : undefined;
  } catch {
    return undefined;
  }
}

function mapHoldingRow(r: CashFlowHoldingRow): Holding {
  return {
    id: r.id,
    name: r.name,
    principal: r.principal,
    inflow: r.inflow,
    outflow: r.outflow,
    extra: parseHoldingExtra(r.extra_data),
  };
}

export async function ensureCashFlowProfileRow() {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT OR IGNORE INTO cash_flow_profile (
      id, necessary_expenses, unnecessary_expenses, target_passive_income, target_months, seed_version,
      created_at, updated_at, deleted_at, sync_status, version, extra_data
    ) VALUES (?, 0, 0, 0, 12, 0, datetime('now'), datetime('now'), NULL, 'synced', 1, NULL)`,
    [CASH_FLOW_PROFILE_ID]
  );
}

export async function loadCashFlowState(): Promise<CashFlowState> {
  await ensureCashFlowProfileRow();

  const [profiles, incomeRows, holdingRows, expenseLineRows] = await Promise.all([
    readApiTable<CashFlowProfileRow>('cash_flow_profile', { offlineFallback: true }),
    readApiTable<CashFlowIncomeRow>('cash_flow_incomes', { offlineFallback: true }),
    readApiTable<CashFlowHoldingRow>('cash_flow_holdings', { offlineFallback: true }),
    readApiTable<CashFlowExpenseLineRow>('cash_flow_expense_lines', { offlineFallback: true }),
  ]);

  const profile = profiles.find(p => p.id === CASH_FLOW_PROFILE_ID) ?? null;
  if (!profile) {
    return CASH_FLOW_EMPTY_STATE;
  }

  const sortedIncomes = sortBySortOrderAsc(incomeRows);
  const sortedHoldings = sortBySortOrderAsc(holdingRows);
  const sortedExpenseLines = sortBySortOrderAsc(expenseLineRows);

  let expenseLines: ExpenseFlowLine[] = sortedExpenseLines
    .map(mapExpenseLineRow)
    .filter((x): x is ExpenseFlowLine => x != null);

  /** 升级过渡：仅有 profile 汇总、尚无流水表数据时，拆成占位行，便于流出明细展示且与合计一致 */
  if (expenseLines.length === 0 && (profile.necessary_expenses > 0 || profile.unnecessary_expenses > 0)) {
    expenseLines = [];
    if (profile.necessary_expenses > 0) {
      expenseLines.push({
        id: 'cf_legacy_roll_necessary',
        name: '历史累计·必要支出',
        amount: profile.necessary_expenses,
        bucket: 'necessary',
      });
    }
    if (profile.unnecessary_expenses > 0) {
      expenseLines.push({
        id: 'cf_legacy_roll_unnecessary',
        name: '历史累计·非必要消费',
        amount: profile.unnecessary_expenses,
        bucket: 'unnecessary',
      });
    }
  }

  return {
    necessaryExpenses: profile.necessary_expenses,
    unnecessaryExpenses: profile.unnecessary_expenses,
    incomes: sortedIncomes.map(mapIncomeRow),
    holdings: sortedHoldings.map(mapHoldingRow),
    expenseLines,
    goals: {
      targetPassiveIncome: profile.target_passive_income,
      targetMonths: profile.target_months,
    },
  };
}

export async function persistCashFlowState(state: CashFlowState) {
  const db = await getDatabase();
  await ensureCashFlowProfileRow();

  await db.execAsync('BEGIN IMMEDIATE');
  try {
    await db.runAsync(
      `UPDATE cash_flow_profile
       SET necessary_expenses = ?, unnecessary_expenses = ?, target_passive_income = ?, target_months = ?,
           updated_at = datetime('now'),
           sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_update' ELSE sync_status END,
           version = version + 1
       WHERE id = ?`,
      [
        state.necessaryExpenses,
        state.unnecessaryExpenses,
        state.goals.targetPassiveIncome,
        state.goals.targetMonths,
        CASH_FLOW_PROFILE_ID,
      ]
    );

    await db.runAsync(`DELETE FROM cash_flow_incomes`);
    await db.runAsync(`DELETE FROM cash_flow_holdings`);
    await db.runAsync(`DELETE FROM cash_flow_expense_lines`);

    let sort = 0;
    for (const i of state.incomes) {
      sort += 10;
      await db.runAsync(
        `INSERT INTO cash_flow_incomes (
          id, name, amount, quadrant, sort_order,
          created_at, updated_at, deleted_at, sync_status, version, extra_data
        ) VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'), NULL, 'pending_create', 1, NULL)`,
        [i.id, i.name, i.amount, i.quadrant, sort]
      );
    }
    sort = 0;
    for (const h of state.holdings) {
      sort += 10;
      const extraJson =
        h.extra && Object.keys(h.extra).length > 0 ? JSON.stringify(h.extra) : null;
      await db.runAsync(
        `INSERT INTO cash_flow_holdings (
          id, name, principal, inflow, outflow, sort_order,
          created_at, updated_at, deleted_at, sync_status, version, extra_data
        ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), NULL, 'pending_create', 1, ?)`,
        [h.id, h.name, h.principal, h.inflow, h.outflow, sort, extraJson]
      );
    }
    sort = 0;
    for (const x of state.expenseLines) {
      sort += 10;
      await db.runAsync(
        `INSERT INTO cash_flow_expense_lines (
          id, name, amount, bucket, sort_order,
          created_at, updated_at, deleted_at, sync_status, version, extra_data
        ) VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'), NULL, 'pending_create', 1, NULL)`,
        [x.id, x.name, x.amount, x.bucket, sort]
      );
    }

    await db.execAsync('COMMIT');
  } catch (e) {
    await db.execAsync('ROLLBACK');
    throw e;
  }
}

export function newCashFlowIncomeId() {
  return makeTimestampEntityId('cfi_', 8);
}

export function newCashFlowHoldingId() {
  return makeTimestampEntityId('cfh_', 8);
}

export function newExpenseFlowLineId() {
  return makeTimestampEntityId('cfe_', 8);
}
