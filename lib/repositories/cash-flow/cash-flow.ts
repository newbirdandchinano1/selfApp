import { invalidateInflightApiTableFetch } from '@/lib/api-read';
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

type LocalSyncRow = { id: string; sync_status: string | null };

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

/** 从未上云的行可物理删除；已同步行标记 pending_delete 以便 REST DELETE */
async function softRemoveMissingRows(
  table: 'cash_flow_incomes' | 'cash_flow_holdings' | 'cash_flow_expense_lines',
  keepIds: Set<string>,
  existing: LocalSyncRow[],
) {
  const db = await getDatabase();
  for (const row of existing) {
    if (keepIds.has(row.id)) continue;
    if (row.sync_status === 'pending_create') {
      await db.runAsync(`DELETE FROM ${table} WHERE id = ?`, [row.id]);
    } else {
      await db.runAsync(
        `UPDATE ${table}
         SET updated_at = datetime('now'), sync_status = 'pending_delete'
         WHERE id = ?`,
        [row.id],
      );
    }
  }
}

export async function ensureCashFlowProfileRow() {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT OR IGNORE INTO cash_flow_profile (
      id, necessary_expenses, unnecessary_expenses, target_passive_income, target_months, seed_version,
      created_at, updated_at, sync_status, extra_data
    ) VALUES (?, 0, 0, 0, 12, 0, datetime('now'), datetime('now'), 'synced', NULL)`,
    [CASH_FLOW_PROFILE_ID]
  );
}

export async function loadCashFlowState(): Promise<CashFlowState> {
  await ensureCashFlowProfileRow();

  // 优先专用口灌库；失败只读本地，禁止 /api/data 全表 List
  try {
    const { fetchFinanceCashFlow } = await import('@/lib/finance-page-api');
    const remote = await fetchFinanceCashFlow({ offlineFallback: false });
    if (remote.fromApi) {
      /* rows already upserted */
    }
  } catch {
    /* 回退本地 */
  }

  const db = await getDatabase();
  if (!db) return CASH_FLOW_EMPTY_STATE;

  const [profiles, incomeRows, holdingRows, expenseLineRows] = await Promise.all([
    db.getAllAsync<CashFlowProfileRow>(
      `SELECT * FROM cash_flow_profile WHERE sync_status != 'pending_delete'`,
    ),
    db.getAllAsync<CashFlowIncomeRow>(
      `SELECT * FROM cash_flow_incomes WHERE sync_status != 'pending_delete'`,
    ),
    db.getAllAsync<CashFlowHoldingRow>(
      `SELECT * FROM cash_flow_holdings WHERE sync_status != 'pending_delete'`,
    ),
    db.getAllAsync<CashFlowExpenseLineRow>(
      `SELECT * FROM cash_flow_expense_lines WHERE sync_status != 'pending_delete'`,
    ),
  ]);

  const profile = (profiles ?? []).find(p => p.id === CASH_FLOW_PROFILE_ID) ?? null;
  if (!profile) {
    return CASH_FLOW_EMPTY_STATE;
  }

  const sortedIncomes = sortBySortOrderAsc(incomeRows ?? []);
  const sortedHoldings = sortBySortOrderAsc(holdingRows ?? []);
  const sortedExpenseLines = sortBySortOrderAsc(expenseLineRows ?? []);

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
           sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_update' ELSE sync_status END
       WHERE id = ?`,
      [
        state.necessaryExpenses,
        state.unnecessaryExpenses,
        state.goals.targetPassiveIncome,
        state.goals.targetMonths,
        CASH_FLOW_PROFILE_ID,
      ]
    );

    const [existingIncomes, existingHoldings, existingExpenseLines] = await Promise.all([
      db.getAllAsync<LocalSyncRow>(`SELECT id, sync_status FROM cash_flow_incomes`),
      db.getAllAsync<LocalSyncRow>(`SELECT id, sync_status FROM cash_flow_holdings`),
      db.getAllAsync<LocalSyncRow>(`SELECT id, sync_status FROM cash_flow_expense_lines`),
    ]);

    const incomeById = new Map(existingIncomes.map((r) => [r.id, r]));
    const holdingById = new Map(existingHoldings.map((r) => [r.id, r]));
    const expenseById = new Map(existingExpenseLines.map((r) => [r.id, r]));

    const keepIncomeIds = new Set(state.incomes.map((i) => i.id));
    const keepHoldingIds = new Set(state.holdings.map((h) => h.id));
    const keepExpenseIds = new Set(state.expenseLines.map((x) => x.id));

    await softRemoveMissingRows('cash_flow_incomes', keepIncomeIds, existingIncomes);
    await softRemoveMissingRows('cash_flow_holdings', keepHoldingIds, existingHoldings);
    await softRemoveMissingRows('cash_flow_expense_lines', keepExpenseIds, existingExpenseLines);

    let sort = 0;
    for (const i of state.incomes) {
      sort += 10;
      const prev = incomeById.get(i.id);
      if (!prev || prev.sync_status === 'pending_delete') {
        await db.runAsync(
          `INSERT OR REPLACE INTO cash_flow_incomes (
            id, name, amount, quadrant, sort_order,
            created_at, updated_at, sync_status, extra_data
          ) VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'), 'pending_create', NULL)`,
          [i.id, i.name, i.amount, i.quadrant, sort]
        );
      } else {
        await db.runAsync(
          `UPDATE cash_flow_incomes
           SET name = ?, amount = ?, quadrant = ?, sort_order = ?,
               updated_at = datetime('now'),
               sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_update' ELSE sync_status END
           WHERE id = ?`,
          [i.name, i.amount, i.quadrant, sort, i.id]
        );
      }
    }

    sort = 0;
    for (const h of state.holdings) {
      sort += 10;
      const extraJson =
        h.extra && Object.keys(h.extra).length > 0 ? JSON.stringify(h.extra) : null;
      const prev = holdingById.get(h.id);
      if (!prev || prev.sync_status === 'pending_delete') {
        await db.runAsync(
          `INSERT OR REPLACE INTO cash_flow_holdings (
            id, name, principal, inflow, outflow, sort_order,
            created_at, updated_at, sync_status, extra_data
          ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), 'pending_create', ?)`,
          [h.id, h.name, h.principal, h.inflow, h.outflow, sort, extraJson]
        );
      } else {
        await db.runAsync(
          `UPDATE cash_flow_holdings
           SET name = ?, principal = ?, inflow = ?, outflow = ?, sort_order = ?, extra_data = ?,
               updated_at = datetime('now'),
               sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_update' ELSE sync_status END
           WHERE id = ?`,
          [h.name, h.principal, h.inflow, h.outflow, sort, extraJson, h.id]
        );
      }
    }

    sort = 0;
    for (const x of state.expenseLines) {
      sort += 10;
      const prev = expenseById.get(x.id);
      if (!prev || prev.sync_status === 'pending_delete') {
        await db.runAsync(
          `INSERT OR REPLACE INTO cash_flow_expense_lines (
            id, name, amount, bucket, sort_order,
            created_at, updated_at, sync_status, extra_data
          ) VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'), 'pending_create', NULL)`,
          [x.id, x.name, x.amount, x.bucket, sort]
        );
      } else {
        await db.runAsync(
          `UPDATE cash_flow_expense_lines
           SET name = ?, amount = ?, bucket = ?, sort_order = ?,
               updated_at = datetime('now'),
               sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_update' ELSE sync_status END
           WHERE id = ?`,
          [x.name, x.amount, x.bucket, sort, x.id]
        );
      }
    }

    await db.execAsync('COMMIT');
  } catch (e) {
    await db.execAsync('ROLLBACK');
    throw e;
  }

  invalidateInflightApiTableFetch('cash_flow_profile');
  invalidateInflightApiTableFetch('cash_flow_incomes');
  invalidateInflightApiTableFetch('cash_flow_holdings');
  invalidateInflightApiTableFetch('cash_flow_expense_lines');
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
