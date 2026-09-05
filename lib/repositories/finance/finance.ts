import { makeTimestampEntityId } from '@/lib/entity-id';
import { ensureLocalRowForWrite, readLocalRowForWrite } from '@/lib/api-local-row';
import { invalidateInflightApiTableFetch, readApiRecord } from '@/lib/api-read';
import { compareDatetimeDesc, sortBySortOrderAsc, ymdFromDatetime } from '@/lib/api-read-helpers';
import { formatFinanceHappenedAt } from '@/lib/api-mysql-datetime';
import {
  applyFinanceAccountBalanceDelta,
  getRememberedFinanceAccountBalance,
} from '@/lib/finance-account-balance-cache';
import {
  isFinanceLiabilityAccount,
  normalizeFinanceAccountLedgerBalance,
} from '@/lib/finance-net-worth';
import {
  isFinanceAccountExcludedFromAggregates,
  mergeFinanceAccountExcludeFromTotalAssets,
} from '@/lib/repositories/finance/finance-account-extra';
import { rememberFinanceLastUsedAccount } from '@/lib/finance-last-used-account';
import { dedupeRowsByPrimaryKey } from '@/lib/sqlite-primary-key-dedupe';
import { getDatabase } from '../../database.native';
import {
  buildFinanceTransferFeeTxnExtra,
  buildFinanceTransferTxnExtra,
  FINANCE_TXN_EXTRA_BALANCE_CORRECTION_REASON,
  FINANCE_TXN_EXTRA_EXCLUDE_FROM_BUDGET,
} from './finance-transaction-extra';
import type {
  CreateFinanceAccountInput,
  CreateFinanceFlowCategoryInput,
  CreateFinanceTransactionInput,
  CreateFinanceTransferInput,
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

/** 记账/校验优先读本地 SQLite（与资产列表同源），避免 API_ONLY 下单条 REST 404 导致写入失败。 */
async function getFinanceAccountById(id: string) {
  const pk = id.trim();
  if (!pk) return null;
  const local = await readLocalRowForWrite<FinanceAccountRow>('finance_accounts', pk);
  if (local) return local;
  return readApiRecord<FinanceAccountRow>('finance_accounts', pk, { offlineFallback: true });
}

/**
 * 读路径已改走 `/api/pages/finance/*`；仓库层只读 SQLite。
 * 禁止再 `readApiTable` 全表 List。
 */
async function ensureFinanceTablesSyncedFromApi(_opts?: {
  forceRefresh?: boolean;
  localOnly?: boolean;
}): Promise<void> {
  /* no-op：专用 page API 负责 REST → 本地 */
}

/** 读本地可见账户（排除 pending_delete） */
async function readFinanceAccountsLocalVisible(): Promise<FinanceAccountRow[]> {
  const db = await getDatabase();
  if (!db) return [];
  const rows = await db.getAllAsync<FinanceAccountRow>(
    `SELECT * FROM finance_accounts WHERE sync_status != 'pending_delete'`,
  );
  return rows ?? [];
}

/** 读本地可见流水（排除 pending_delete） */
async function readFinanceTransactionsLocalVisible(): Promise<FinanceTransactionRow[]> {
  const db = await getDatabase();
  if (!db) return [];
  const rows = await db.getAllAsync<FinanceTransactionRow>(
    `SELECT * FROM finance_transactions WHERE sync_status != 'pending_delete'`,
  );
  if (!rows || rows.length <= 1) return rows ?? [];
  return dedupeRowsByPrimaryKey(rows as Record<string, unknown>[], ['id']) as FinanceTransactionRow[];
}

function sortFinanceTransactionsDesc(rows: FinanceTransactionRow[]): FinanceTransactionRow[] {
  return [...rows].sort((a, b) => {
    const u = compareDatetimeDesc(a.updated_at, b.updated_at);
    if (u !== 0) return u;
    return compareDatetimeDesc(a.happened_at, b.happened_at);
  });
}

function isFinanceTransactionVisible(t: FinanceTransactionRow): boolean {
  const syncStatus = (t as FinanceTransactionRow & { sync_status?: string }).sync_status;
  return syncStatus !== 'pending_delete';
}

/** 与 SQLite SUM 规则一致，基于 REST 流水列表计算账本余额 */
export function computeLedgerBalanceFromTransactions(
  accountId: string,
  transactions: FinanceTransactionRow[],
): number {
  let balance = 0;
  for (const t of transactions) {
    if (t.account_id !== accountId || !isFinanceTransactionVisible(t)) continue;
    balance += computeTransactionLedgerEffect(t.transaction_type, t.amount, t.extra_data);
  }
  return balance;
}

function countLedgerTransactionsFromList(
  accountId: string,
  transactions: FinanceTransactionRow[],
): number {
  return transactions.filter(t => t.account_id === accountId && isFinanceTransactionVisible(t)).length;
}

let financeApiSyncChain: Promise<void> = Promise.resolve();

/** 本地写入后推送到 REST；默认后台执行，不阻塞记账 UI */
async function pushFinanceChangesToApi(opts?: { awaitSync?: boolean }): Promise<void> {
  const run = async () => {
    const { flushApiDirtyTablesNow, markApiTableDirty } = await import('@/lib/api-incremental-sync');
    markApiTableDirty('finance_accounts');
    markApiTableDirty('finance_transactions');
    await flushApiDirtyTablesNow({ rethrow: true });
  };

  const task = financeApiSyncChain.then(run);
  financeApiSyncChain = task.catch(() => {});

  if (opts?.awaitSync) {
    try {
      await task;
    } catch (e) {
      const detail = e instanceof Error && e.message.trim() ? e.message : '未知错误';
      throw new Error(`本地已保存，但同步到服务器失败：${detail}\n请检查网络或 API 登录状态后重试。`);
    }
    return;
  }

  void task.catch(e => {
    if (__DEV__) console.warn('[finance] 后台同步到服务器失败', e);
  });
}

async function assertTransactionAmountSign(accountId: string, amount: number) {
  const account = await getFinanceAccountById(accountId);
  if (!account) {
    throw new Error('finance account not found');
  }
  const signRule = normalizeFinanceSignRule(account.sign_rule, account.account_type);
  if (amount === 0) {
    throw new Error('finance transaction amount must not be 0');
  }
  if (signRule > 0 && amount < 0) {
    throw new Error('asset-like account only supports positive amount');
  }
  if (signRule < 0 && amount > 0) {
    throw new Error('liability-like account only supports negative amount');
  }
}

/** 与 `getFinanceAccountsWithBalance` 中按账户汇总 balance 的规则一致（收入 +、支出 -、转账按 leg）。 */
export function computeTransactionLedgerEffect(
  transactionType: string,
  amount: number,
  extraData: string | null | undefined
): number {
  const n = Number(amount);
  if (!Number.isFinite(n)) return 0;
  if (transactionType === 'income') return Math.abs(n);
  if (transactionType === 'expense') return -Math.abs(n);
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
    if (leg === 'out') return -Math.abs(n);
    if (leg === 'in') return Math.abs(n);
    return 0;
  }
  return -Math.abs(n);
}

const FINANCE_BALANCE_EPS = 1e-4;

/** 与 SQLite / API 读入的 sign_rule 对齐为 -1 | 1；account_type=liability 优先于错误的正 sign_rule */
export function normalizeFinanceSignRule(
  signRule: unknown,
  accountType?: string | null,
): -1 | 1 {
  if (accountType === 'liability') return -1;
  const n = typeof signRule === 'number' ? signRule : Number(signRule);
  if (n < 0) return -1;
  if (n > 0) return 1;
  return 1;
}

function formatFinanceBalanceConstraintError(
  signRule: -1 | 1,
  balanceAfter: number,
  ctx?: { accountName?: string; delta?: number; ledgerBalance?: number; txnCount?: number },
): string {
  const label = ctx?.accountName?.trim() ? `「${ctx.accountName.trim()}」` : '该账户';
  if (signRule > 0 && balanceAfter < -FINANCE_BALANCE_EPS) {
    const available = Math.max(0, ctx?.ledgerBalance ?? balanceAfter - (ctx?.delta ?? 0));
    const need = ctx?.delta != null && ctx.delta < 0 ? Math.abs(ctx.delta) : undefined;
    const ledgerHint =
      ctx?.txnCount === 0
        ? '（账本内尚无流水；若创建账户时填过余额，可能被后端同步覆盖，请到账户详情重新校正余额）'
        : ctx?.txnCount != null && ctx?.txnCount > 0 && available < FINANCE_BALANCE_EPS
          ? '（账本流水汇总为 ¥0.00，与真实支付宝余额无关；请到账户详情校正期初余额）'
          : '';
    if (need != null && Number.isFinite(available)) {
      return `${label}账本可用余额 ¥${available.toFixed(2)}，不足以支付 ¥${need.toFixed(2)}。请确认所选支付账户，或在资产页进入该账户后校正余额。${ledgerHint}`;
    }
    return `${label}余额不能为负数，请确认所选账户或在资产页校正余额。${ledgerHint}`;
  }
  if (signRule < 0 && balanceAfter > FINANCE_BALANCE_EPS) {
    return `${label}为负债类账户，余额不能为正数。`;
  }
  return '余额不符合账户类型约束。';
}

function assertFinanceBalanceWithinSignRule(
  signRule: number,
  balance: number,
  ctx?: { accountName?: string; delta?: number; ledgerBalance?: number; txnCount?: number },
): void {
  const rule = normalizeFinanceSignRule(signRule);
  if (rule > 0 && balance < -FINANCE_BALANCE_EPS) {
    throw new Error(formatFinanceBalanceConstraintError(rule, balance, ctx));
  }
  if (rule < 0 && balance > FINANCE_BALANCE_EPS) {
    throw new Error(formatFinanceBalanceConstraintError(rule, balance, ctx));
  }
}

/** 保存后余额是否满足「资产 ≥0、负债 ≤0」；返回 `null` 表示通过，否则为中文错误说明。 */
export function validateFinanceLedgerBalanceAfterChange(
  signRule: number,
  currentBalance: number,
  transactionType: string,
  amount: number,
  extraData: string | null | undefined,
  ctx?: { accountName?: string },
): string | null {
  try {
    const delta = computeTransactionLedgerEffect(transactionType, amount, extraData);
    const rule = normalizeFinanceSignRule(signRule);
    assertFinanceBalanceWithinSignRule(rule, currentBalance + delta, {
      accountName: ctx?.accountName,
      delta,
    });
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : '余额不符合账户类型约束。';
  }
}

/** 记账入库时按账户符号规则写入 amount（资产为正、负债为负）。 */
export function financeSignedAmountForSave(
  signRule: unknown,
  accountType: string | null | undefined,
  amountAbs: number,
): number {
  const rule = normalizeFinanceSignRule(signRule, accountType);
  return rule > 0 ? amountAbs : -amountAbs;
}

/** 保存前从 SQLite 读取最新账本余额并校验（与落库逻辑一致，避免 UI 缓存余额与库内不一致）。 */
export async function validateFinanceTransactionBeforeSave(input: {
  accountId: string;
  transactionType: string;
  amount: number;
  extraData?: string | null;
  accountName?: string;
  /** 界面展示的账本余额；若与 SQLite 汇总不一致则先刷新本地再校验 */
  uiLedgerBalance?: number;
}): Promise<string | null> {
  const account = await getFinanceAccountById(input.accountId);
  if (!account) return '未找到账户，请刷新后重试。';
  const signRule = normalizeFinanceSignRule(account.sign_rule, account.account_type);

  let currentBalance = await getFinanceAccountLedgerBalance(input.accountId);
  let txnCount = await countFinanceAccountLedgerTransactions(input.accountId);

  const uiBal = input.uiLedgerBalance;
  if (uiBal != null && Number.isFinite(uiBal)) {
    return validateFinanceLedgerBalanceAfterChange(
      signRule,
      uiBal,
      input.transactionType,
      input.amount,
      input.extraData,
      { accountName: input.accountName ?? account.name },
    );
  }

  if (
    Math.abs(currentBalance) < FINANCE_BALANCE_EPS &&
    Math.abs(uiBal ?? 0) > FINANCE_BALANCE_EPS
  ) {
    await ensureFinanceTablesSyncedFromApi();
    currentBalance = await getFinanceAccountLedgerBalance(input.accountId);
    txnCount = await countFinanceAccountLedgerTransactions(input.accountId);
  }

  const delta = computeTransactionLedgerEffect(
    input.transactionType,
    input.amount,
    input.extraData ?? null,
  );
  try {
    assertFinanceBalanceWithinSignRule(signRule, currentBalance + delta, {
      accountName: input.accountName ?? account.name,
      delta,
      ledgerBalance: currentBalance,
      txnCount,
    });
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : '余额不符合账户类型约束。';
  }
}

async function countFinanceAccountLedgerTransactions(accountId: string): Promise<number> {
  await ensureFinanceTablesSyncedFromApi({ localOnly: true });
  const transactions = await readFinanceTransactionsLocalVisible();
  return countLedgerTransactionsFromList(accountId, transactions);
}

/**
 * 与资产页 / 记账弹窗展示的余额一致（`getFinanceAccountsWithBalance` 同源）。
 * 直接按 account_id 汇总 SQLite 流水，不依赖账户列表过滤。
 */
export async function resolveFinanceAccountLedgerBalance(accountId: string): Promise<number> {
  return getFinanceAccountLedgerBalance(accountId);
}

/** 与 `getFinanceAccountsWithBalance` 一致：优先服务端余额缓存，否则本地流水汇总。 */
export async function getFinanceAccountLedgerBalance(accountId: string): Promise<number> {
  const remembered = getRememberedFinanceAccountBalance(accountId);
  if (remembered != null) return remembered;
  await ensureFinanceTablesSyncedFromApi({ localOnly: true });
  const transactions = await readFinanceTransactionsLocalVisible();
  return computeLedgerBalanceFromTransactions(accountId, transactions);
}

async function getFinanceAccountComputedBalance(accountId: string): Promise<number> {
  return resolveFinanceAccountLedgerBalance(accountId);
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
      created_at, updated_at, sync_status, extra_data
    ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), 'pending_create', ?)`,
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
  try {
    const { markApiTableDirty } = await import('@/lib/api-incremental-sync');
    markApiTableDirty('finance_accounts');
  } catch {
    // ignore
  }
}

async function loadFinanceAccounts(): Promise<FinanceAccountRow[]> {
  const rows = await readFinanceAccountsLocalVisible();
  return [...rows].sort((a, b) => {
    const c = compareDatetimeDesc(a.created_at, b.created_at) * -1;
    if (c !== 0) return c;
    return compareDatetimeDesc(a.updated_at, b.updated_at);
  });
}

async function loadFinanceTransactionsForActiveAccounts(_opts?: {
  forceRefresh?: boolean;
  localOnly?: boolean;
}): Promise<FinanceTransactionRow[]> {
  await ensureFinanceTablesSyncedFromApi(_opts);
  const [accounts, transactions] = await Promise.all([
    readFinanceAccountsLocalVisible(),
    readFinanceTransactionsLocalVisible(),
  ]);
  const accountIds = new Set(accounts.map(a => a.id));
  return sortFinanceTransactionsDesc(transactions.filter(t => accountIds.has(t.account_id)));
}

export async function getFinanceAccounts() {
  return loadFinanceAccounts();
}

export async function getFinanceAccountsWithBalance(_opts?: { localOnly?: boolean }) {
  await ensureFinanceTablesSyncedFromApi({ localOnly: true });
  const [accounts, transactions] = await Promise.all([
    readFinanceAccountsLocalVisible(),
    readFinanceTransactionsLocalVisible(),
  ]);

  const db = await getDatabase();
  const result: FinanceAccountBalanceRow[] = [];
  for (const a of accounts) {
    const normalizedSign = normalizeFinanceSignRule(a.sign_rule, a.account_type);
    let liability = isFinanceLiabilityAccount({
      sign_rule: normalizedSign,
      account_type: a.account_type,
      extra_data: a.extra_data,
    });

    const remembered = getRememberedFinanceAccountBalance(a.id);
    const ledger = computeLedgerBalanceFromTransactions(a.id, transactions);
    let meta = {
      sign_rule: (liability ? -1 : normalizedSign) as -1 | 1,
      account_type: liability ? 'liability' : a.account_type,
      extra_data: a.extra_data,
    };

    let rawBalance = ledger;
    if (remembered != null && Number.isFinite(remembered)) {
      const rem = normalizeFinanceAccountLedgerBalance(meta, remembered);
      const led = normalizeFinanceAccountLedgerBalance(meta, ledger);
      if (Math.abs(rem) < FINANCE_BALANCE_EPS && Math.abs(led) > FINANCE_BALANCE_EPS) {
        rawBalance = led;
      } else if (liability) {
        rawBalance = Math.abs(rem) >= Math.abs(led) ? rem : led;
      } else {
        rawBalance = rem;
      }
    }

    let balance = normalizeFinanceAccountLedgerBalance(meta, rawBalance);
    // 负余额但未标负债：按负债处理，避免被夹成 0 后从净资产消失
    if (!liability && balance < -FINANCE_BALANCE_EPS) {
      liability = true;
      meta = { sign_rule: -1, account_type: 'liability', extra_data: a.extra_data };
      balance = -Math.abs(balance);
    }

    let extraData = a.extra_data;
    // 负债上的「不计入总资产」会导致总负债漏计；清除该标记
    if (liability && isFinanceAccountExcludedFromAggregates(extraData)) {
      extraData = mergeFinanceAccountExcludeFromTotalAssets(extraData, false);
    }

    const needsHeal =
      liability &&
      (a.account_type !== 'liability' ||
        normalizeFinanceSignRule(a.sign_rule, a.account_type) !== -1 ||
        extraData !== a.extra_data);

    if (needsHeal && db) {
      try {
        await db.runAsync(
          `UPDATE finance_accounts
           SET account_type = 'liability',
               sign_rule = -1,
               extra_data = ?,
               updated_at = datetime('now'),
               sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_update' ELSE sync_status END
           WHERE id = ?`,
          [extraData, a.id],
        );
      } catch (e) {
        if (__DEV__) console.warn('[finance] heal liability account columns failed', a.id, e);
      }
    }

    result.push({
      ...a,
      account_type: liability ? 'liability' : a.account_type,
      sign_rule: liability ? -1 : normalizedSign,
      extra_data: extraData,
      balance,
    });
  }
  return result;
}

export async function getFinanceAccountTypes(_opts?: { localOnly?: boolean }) {
  const db = await getDatabase();
  if (!db) return [];
  const rows = await db.getAllAsync<FinanceAccountTypeRow>(
    `SELECT * FROM finance_account_types WHERE sync_status != 'pending_delete'`,
  );
  return sortBySortOrderAsc(rows ?? []);
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
       SET is_liability = ?, icon_key = ?, updated_at = datetime('now'),
           sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_update' ELSE sync_status END
       WHERE id = ?`,
      [input.is_liability ? 1 : 0, input.icon_key || 'savings', existing.id]
    );
    return existing.id;
  }

  const id = makeTimestampEntityId('fat_', 8);
  const sortRow = await db.getFirstAsync<{ max_sort: number | null }>(
    `SELECT MAX(sort_order) AS max_sort FROM finance_account_types`
  );
  const nextSort = (sortRow?.max_sort ?? 0) + 1;
  await db.runAsync(
    `INSERT INTO finance_account_types (
      id, name, is_liability, icon_key, sort_order,
      created_at, updated_at, sync_status, extra_data
    ) VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'), 'pending_create', NULL)`,
    [id, name, input.is_liability ? 1 : 0, input.icon_key || 'savings', nextSort]
  );
  return id;
}

export async function deleteFinanceAccountTypeByName(name: string) {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE finance_account_types
     SET updated_at = datetime('now'),
         sync_status = 'pending_delete'
     WHERE name = ?`,
    [name.trim()]
  );
}

export async function updateFinanceAccount(id: string, input: UpdateFinanceAccountInput) {
  const db = await getDatabase();
  const current = await ensureLocalRowForWrite<FinanceAccountRow>('finance_accounts', id);
  if (!current) return;

  await db.runAsync(
    `UPDATE finance_accounts
     SET name = ?, account_no = ?, account_type = ?, sign_rule = ?, note = ?, extra_data = ?,
         updated_at = datetime('now'),
         sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_update' ELSE sync_status END
     WHERE id = ?`,
    [
      input.name ?? current.name,
      input.account_no !== undefined ? input.account_no : current.account_no,
      input.account_type ?? current.account_type,
      input.sign_rule ?? current.sign_rule,
      input.note !== undefined ? input.note : current.note,
      input.extra_data ?? current.extra_data,
      id,
    ]
  );
  try {
    const { markApiTableDirty } = await import('@/lib/api-incremental-sync');
    markApiTableDirty('finance_accounts');
  } catch {
    // ignore
  }
}

export async function deleteFinanceAccount(id: string) {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE finance_transactions
     SET updated_at = datetime('now'),
         sync_status = 'pending_delete'
     WHERE account_id = ?`,
    [id]
  );
  await db.runAsync(
    `UPDATE finance_accounts
     SET updated_at = datetime('now'), sync_status = 'pending_delete'
     WHERE id = ?`,
    [id]
  );
}

export async function createFinanceFlowCategory(input: CreateFinanceFlowCategoryInput) {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO finance_flow_categories (
      id, name, parent_id, sort_order, is_builtin, created_at, updated_at, sync_status, extra_data
    ) VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'), 'pending_create', ?)`,
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

export async function getFinanceFlowCategories(_opts?: { localOnly?: boolean }) {
  const db = await getDatabase();
  if (!db) return [];
  const rows = await db.getAllAsync<FinanceFlowCategoryRow>(
    `SELECT * FROM finance_flow_categories WHERE sync_status != 'pending_delete'`,
  );
  return sortBySortOrderAsc(rows ?? []);
}

export async function updateFinanceFlowCategory(id: string, input: UpdateFinanceFlowCategoryInput) {
  const db = await getDatabase();
  const current = await ensureLocalRowForWrite<FinanceFlowCategoryRow>('finance_flow_categories', id);
  if (!current) return;

  await db.runAsync(
    `UPDATE finance_flow_categories
     SET name = ?, parent_id = ?, sort_order = ?, is_builtin = ?, extra_data = ?,
         updated_at = datetime('now'),
         sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_update' ELSE sync_status END
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
     SET updated_at = datetime('now'), sync_status = 'pending_delete'
     WHERE id = ?`,
    [id]
  );
}

export async function createFinanceTransaction(
  input: CreateFinanceTransactionInput,
  opts?: { skipBalanceRecheck?: boolean },
) {
  await assertTransactionAmountSign(input.account_id, input.amount);
  if (!opts?.skipBalanceRecheck) {
    const account = await getFinanceAccountById(input.account_id);
    if (!account) {
      throw new Error('finance account not found');
    }
    const signRule = normalizeFinanceSignRule(account.sign_rule, account.account_type);
    const [curBalance, txnCount] = await Promise.all([
      resolveFinanceAccountLedgerBalance(input.account_id),
      countFinanceAccountLedgerTransactions(input.account_id),
    ]);
    const delta = computeTransactionLedgerEffect(
      input.transaction_type ?? 'expense',
      input.amount,
      input.extra_data ?? null,
    );
    assertFinanceBalanceWithinSignRule(signRule, curBalance + delta, {
      accountName: account.name,
      delta,
      ledgerBalance: curBalance,
      txnCount,
    });
  }

  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO finance_transactions (
      id, name, happened_at, account_id, ai_comment, transaction_type, flow_category_id, amount, note,
      created_at, updated_at, sync_status, extra_data
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), 'pending_create', ?)`,
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
  invalidateInflightApiTableFetch('finance_transactions');
  applyFinanceAccountBalanceDelta(
    input.account_id,
    computeTransactionLedgerEffect(
      input.transaction_type ?? 'expense',
      input.amount,
      input.extra_data ?? null,
    ),
  );
  void pushFinanceChangesToApi();

  const txnType = input.transaction_type ?? 'expense';
  if (txnType === 'expense' || txnType === 'income') {
    let skipRemember = false;
    if (input.extra_data) {
      try {
        const extra = JSON.parse(input.extra_data) as unknown;
        if (extra && typeof extra === 'object' && (extra as { reason?: unknown }).reason === 'initial_balance') {
          skipRemember = true;
        }
      } catch {
        /* ignore */
      }
    }
    if (!skipRemember) {
      void rememberFinanceLastUsedAccount(input.account_id);
    }
  }
}

/**
 * 原子创建转账双流水（转出 leg=out + 转入 leg=in）。
 * 可选手续费从转账金额中扣除：双腿记净额，手续费另记扣款账户支出。
 * 例：转 2、手续费 1 → 扣款 -2（转出 1 + 支出 1），入账 +1。
 */
export async function createFinanceTransferTransactions(input: CreateFinanceTransferInput): Promise<void> {
  const absAmount = Math.abs(input.amount);
  if (!Number.isFinite(absAmount) || absAmount <= 0) {
    throw new Error('finance transfer amount must be greater than 0');
  }

  const feeRaw = input.feeAmount ?? 0;
  const absFee = Number.isFinite(feeRaw) ? Math.abs(feeRaw) : 0;
  const hasFee = absFee > 0;
  if (hasFee && !input.idFee) {
    throw new Error('finance transfer fee id is required when feeAmount > 0');
  }
  if (hasFee && absFee >= absAmount) {
    throw new Error('finance transfer fee must be less than transfer amount');
  }
  const netAmount = absAmount - absFee;

  const extraOut = buildFinanceTransferTxnExtra({
    groupId: input.groupId,
    leg: 'out',
    counterpartyAccountId: input.toAccountId,
    counterpartyAccountName: input.toAccountName,
  });
  const extraIn = buildFinanceTransferTxnExtra({
    groupId: input.groupId,
    leg: 'in',
    counterpartyAccountId: input.fromAccountId,
    counterpartyAccountName: input.fromAccountName,
  });
  const extraFee = hasFee
    ? buildFinanceTransferFeeTxnExtra({
        groupId: input.groupId,
        counterpartyAccountId: input.toAccountId,
        counterpartyAccountName: input.toAccountName,
      })
    : null;

  await assertTransactionAmountSign(input.fromAccountId, netAmount);
  await assertTransactionAmountSign(input.toAccountId, netAmount);
  if (hasFee) {
    await assertTransactionAmountSign(input.fromAccountId, absFee);
  }

  const db = await getDatabase();
  const note = input.note ?? null;
  const insertSql = `INSERT INTO finance_transactions (
      id, name, happened_at, account_id, ai_comment, transaction_type, flow_category_id, amount, note,
      created_at, updated_at, sync_status, extra_data
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), 'pending_create', ?)`;

  await db.execAsync('BEGIN IMMEDIATE');
  try {
    await db.runAsync(insertSql, [
      input.idOut,
      `转至「${input.toAccountName}」`,
      input.happenedAt,
      input.fromAccountId,
      null,
      'transfer',
      null,
      netAmount,
      note,
      extraOut,
    ]);
    await db.runAsync(insertSql, [
      input.idIn,
      `转自「${input.fromAccountName}」`,
      input.happenedAt,
      input.toAccountId,
      null,
      'transfer',
      null,
      netAmount,
      note,
      extraIn,
    ]);
    if (hasFee && input.idFee && extraFee) {
      await db.runAsync(insertSql, [
        input.idFee,
        '转账手续费',
        input.happenedAt,
        input.fromAccountId,
        null,
        'expense',
        null,
        absFee,
        note,
        extraFee,
      ]);
    }
    await db.execAsync('COMMIT');
  } catch (e) {
    await db.execAsync('ROLLBACK');
    throw e;
  }

  invalidateInflightApiTableFetch('finance_transactions');
  // 扣款合计减少 absAmount（净转出 + 手续费）；入账仅增加净额
  applyFinanceAccountBalanceDelta(input.fromAccountId, -absAmount);
  applyFinanceAccountBalanceDelta(input.toAccountId, netAmount);
  void pushFinanceChangesToApi();
}

const FINANCE_BALANCE_ADJUST_EPS = 1e-4;

/**
 * 通过一笔「余额校正」流水把账户账本余额对齐到目标值（不改变账户元数据）。
 * 支出类校正默认写入 `exclude_from_budget`，不计入月度/今日预算。
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
  const happened_at = formatFinanceHappenedAt(new Date());
  const note = input.note ?? null;

  /** @param transactionType 流水类型，支出默认写入不计入预算标记 */
  const buildBalanceCorrectionExtra = (transactionType: 'income' | 'expense') =>
    JSON.stringify({
      reason: FINANCE_TXN_EXTRA_BALANCE_CORRECTION_REASON,
      ...(transactionType === 'expense' ? { [FINANCE_TXN_EXTRA_EXCLUDE_FROM_BUDGET]: true } : {}),
    });

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
        extra_data: buildBalanceCorrectionExtra('income'),
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
        extra_data: buildBalanceCorrectionExtra('expense'),
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
      extra_data: buildBalanceCorrectionExtra('income'),
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
      extra_data: buildBalanceCorrectionExtra('expense'),
    });
  }
}

export async function getFinanceTransactionById(id: string) {
  const db = await getDatabase();
  if (db && id.trim()) {
    const local = await db.getFirstAsync<FinanceTransactionRow>(
      `SELECT * FROM finance_transactions WHERE id = ? AND sync_status != 'pending_delete' LIMIT 1`,
      [id],
    );
    if (local) return local;
  }
  return readApiRecord<FinanceTransactionRow>('finance_transactions', id, { offlineFallback: true });
}

export async function getFinanceTransactions(opts?: { forceRefresh?: boolean; localOnly?: boolean }) {
  return loadFinanceTransactionsForActiveAccounts(opts);
}

export async function getFinanceTransactionsByAccountId(accountId: string) {
  const rows = await loadFinanceTransactionsForActiveAccounts({ localOnly: true });
  return rows.filter(t => t.account_id === accountId);
}

/** 账户详情：只读本地；网络由 `fetchFinanceAccountDetail` 灌库 */
export async function loadFinanceAccountDetail(input: {
  accountId?: string;
  accountName?: string;
  forceRefresh?: boolean;
  localOnly?: boolean;
}): Promise<{ account: FinanceAccountBalanceRow | null; transactions: FinanceTransactionRow[] }> {
  await ensureFinanceTablesSyncedFromApi({ forceRefresh: input.forceRefresh, localOnly: true });

  const accounts = await readFinanceAccountsLocalVisible();
  const allTransactions = await readFinanceTransactionsLocalVisible();
  const accountName = input.accountName?.trim() ?? '';

  const target =
    (input.accountId ? accounts.find((item) => item.id === input.accountId) : null) ??
    (accountName ? accounts.find((item) => item.name === accountName) : null) ??
    null;

  if (!target) {
    return { account: null, transactions: [] };
  }

  const remembered = getRememberedFinanceAccountBalance(target.id);
  const rawBalance =
    remembered != null ? remembered : computeLedgerBalanceFromTransactions(target.id, allTransactions);
  const normalizedSign = normalizeFinanceSignRule(target.sign_rule, target.account_type);
  const liability = isFinanceLiabilityAccount({
    sign_rule: normalizedSign,
    account_type: target.account_type,
    extra_data: target.extra_data,
  });
  const sign_rule: -1 | 1 = liability ? -1 : normalizedSign;
  const account_type = liability ? 'liability' : target.account_type;
  const account: FinanceAccountBalanceRow = {
    ...target,
    account_type,
    sign_rule,
    balance: normalizeFinanceAccountLedgerBalance(
      { sign_rule, account_type, extra_data: target.extra_data },
      rawBalance,
    ),
  };

  const transactions = sortFinanceTransactionsDesc(
    allTransactions.filter((t) => t.account_id === target.id),
  );

  return { account, transactions };
}

export async function getFinanceTransactionsByYmd(ymd: string, opts?: { localOnly?: boolean }) {
  const rows = await loadFinanceTransactionsForActiveAccounts({ localOnly: opts?.localOnly ?? true });
  return rows.filter(t => ymdFromDatetime(t.happened_at) === ymd);
}

export async function getFinanceDailySummariesByDateRange(
  startYmd: string,
  endYmd: string,
  opts?: { localOnly?: boolean },
) {
  const rows = await loadFinanceTransactionsForActiveAccounts({ localOnly: opts?.localOnly ?? true });
  const byDay = new Map<string, { income: number; expense: number; net: number }>();
  for (const t of rows) {
    const day = ymdFromDatetime(t.happened_at);
    if (!day || day < startYmd || day > endYmd) continue;
    // 转账只影响账户余额，不计入收入/支出/结余统计
    if (t.transaction_type === 'transfer') continue;
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
  const current = await ensureLocalRowForWrite<FinanceTransactionRow>('finance_transactions', id);
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
      const signRule = normalizeFinanceSignRule(acct.sign_rule, acct.account_type);
      const cur = await getFinanceAccountComputedBalance(nextAccountId);
      assertFinanceBalanceWithinSignRule(signRule, cur - oldEffect + newEffect, {
        accountName: acct.name,
        delta: newEffect - oldEffect,
      });
    }
  } else {
    const oldAcct = await getFinanceAccountById(current.account_id);
    const newAcct = await getFinanceAccountById(nextAccountId);
    if (oldAcct) {
      const signRule = normalizeFinanceSignRule(oldAcct.sign_rule, oldAcct.account_type);
      const curOld = await getFinanceAccountComputedBalance(current.account_id);
      assertFinanceBalanceWithinSignRule(signRule, curOld - oldEffect, {
        accountName: oldAcct.name,
        delta: -oldEffect,
      });
    }
    if (newAcct) {
      const signRule = normalizeFinanceSignRule(newAcct.sign_rule, newAcct.account_type);
      const curNew = await getFinanceAccountComputedBalance(nextAccountId);
      assertFinanceBalanceWithinSignRule(signRule, curNew + newEffect, {
        accountName: newAcct.name,
        delta: newEffect,
      });
    }
  }

  await db.runAsync(
    `UPDATE finance_transactions
     SET name = ?, happened_at = ?, account_id = ?, ai_comment = ?, transaction_type = ?, flow_category_id = ?, amount = ?, note = ?, extra_data = ?,
         updated_at = datetime('now'),
         sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_update' ELSE sync_status END
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
  invalidateInflightApiTableFetch('finance_transactions');
  if (current.account_id === nextAccountId) {
    applyFinanceAccountBalanceDelta(nextAccountId, newEffect - oldEffect);
  } else {
    applyFinanceAccountBalanceDelta(current.account_id, -oldEffect);
    applyFinanceAccountBalanceDelta(nextAccountId, newEffect);
  }
  await pushFinanceChangesToApi();
}

export async function deleteFinanceTransaction(id: string) {
  const db = await getDatabase();
  const current = await db.getFirstAsync<FinanceTransactionRow>(
    'SELECT * FROM finance_transactions WHERE id = ? LIMIT 1',
    [id]
  );
  if (current) {
    const acct = await getFinanceAccountById(current.account_id);
    if (acct) {
      const signRule = normalizeFinanceSignRule(acct.sign_rule, acct.account_type);
      const cur = await getFinanceAccountComputedBalance(current.account_id);
      const oldEffect = computeTransactionLedgerEffect(current.transaction_type, current.amount, current.extra_data);
      assertFinanceBalanceWithinSignRule(signRule, cur - oldEffect, {
        accountName: acct.name,
        delta: -oldEffect,
      });
    }
  }
  await db.runAsync(
    `UPDATE finance_transactions
     SET updated_at = datetime('now'), sync_status = 'pending_delete'
     WHERE id = ?`,
    [id]
  );
  if (current) {
    applyFinanceAccountBalanceDelta(
      current.account_id,
      -computeTransactionLedgerEffect(current.transaction_type, current.amount, current.extra_data),
    );
  }
  await pushFinanceChangesToApi();
}
