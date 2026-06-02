import { makeTimestampEntityId } from '@/lib/entity-id';
import { readLocalRowForWrite } from '@/lib/api-local-row';
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
  return readApiRecord<FinanceAccountRow>('finance_accounts', id, { offlineFallback: false });
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
    const { flushApiDirtyTablesNow } = await import('@/lib/api-incremental-sync');
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

/** 与 SQLite / API 读入的 sign_rule 对齐为 -1 | 1 */
export function normalizeFinanceSignRule(
  signRule: unknown,
  accountType?: string | null,
): -1 | 1 {
  const n = typeof signRule === 'number' ? signRule : Number(signRule);
  if (n < 0) return -1;
  if (n > 0) return 1;
  return accountType === 'liability' ? -1 : 1;
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
    await Promise.all([
      readApiTable<FinanceAccountRow>('finance_accounts', { offlineFallback: false }),
      readApiTable<FinanceTransactionRow>('finance_transactions', { offlineFallback: false }),
    ]);
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
  const transactions = await readApiTable<FinanceTransactionRow>('finance_transactions', {
    offlineFallback: false,
  });
  return countLedgerTransactionsFromList(accountId, transactions);
}

/**
 * 与资产页 / 记账弹窗展示的余额一致（`getFinanceAccountsWithBalance` 同源）。
 * 直接按 account_id 汇总 SQLite 流水，不依赖账户列表过滤。
 */
export async function resolveFinanceAccountLedgerBalance(accountId: string): Promise<number> {
  return getFinanceAccountLedgerBalance(accountId);
}

/** 与 `getFinanceAccountsWithBalance` 一致：基于 REST 流水汇总，排除待删除行。 */
export async function getFinanceAccountLedgerBalance(accountId: string): Promise<number> {
  const transactions = await readApiTable<FinanceTransactionRow>('finance_transactions', {
    offlineFallback: false,
  });
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
  const readOpts = { offlineFallback: false as const };
  const [accounts, transactions] = await Promise.all([
    readApiTable<FinanceAccountRow>('finance_accounts', readOpts),
    readApiTable<FinanceTransactionRow>('finance_transactions', readOpts),
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

export async function getFinanceAccountsWithBalance(_opts?: { localOnly?: boolean }) {
  const readOpts = { offlineFallback: false as const };
  const [accounts, transactions] = await Promise.all([
    loadFinanceAccounts(),
    readApiTable<FinanceTransactionRow>('finance_transactions', readOpts),
  ]);

  const result: FinanceAccountBalanceRow[] = [];
  for (const a of accounts) {
    const balance = computeLedgerBalanceFromTransactions(a.id, transactions);
    result.push({
      ...a,
      sign_rule: normalizeFinanceSignRule(a.sign_rule, a.account_type),
      balance,
    });
  }
  return result;
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
  const current = await readLocalRowForWrite<FinanceAccountRow>('finance_accounts', id);
  if (!current) return;

  await db.runAsync(
    `UPDATE finance_accounts
     SET name = ?, account_no = ?, account_type = ?, sign_rule = ?, note = ?, extra_data = ?,
         updated_at = datetime('now'),
         sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_update' ELSE sync_status END
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

export async function getFinanceFlowCategories() {
  const rows = await readApiTable<FinanceFlowCategoryRow>('finance_flow_categories', { offlineFallback: true });
  return sortBySortOrderAsc(rows);
}

export async function updateFinanceFlowCategory(id: string, input: UpdateFinanceFlowCategoryInput) {
  const db = await getDatabase();
  const current = await db.getFirstAsync<FinanceFlowCategoryRow>(
    'SELECT * FROM finance_flow_categories WHERE id = ? LIMIT 1',
    [id]
  );
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
  void pushFinanceChangesToApi();
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

export async function getFinanceTransactions(_opts?: { localOnly?: boolean }) {
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
    'SELECT * FROM finance_transactions WHERE id = ? LIMIT 1',
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
  await pushFinanceChangesToApi();
}
