/**
 * S9.3 W1：finance commit_* → 现有 repository（动态 import，避免单测拉 RN）。
 */

import type { ChatCommitHandler, ChatCommitHandlerResult } from '@/lib/assistant/chat-commit';
import { mergeCashFlowDraft } from './cash-flow-draft';
import { draftNumber, draftString, fail, ok, requestPushPending } from './shared';

function asTxnType(raw: unknown): 'expense' | 'income' {
  return raw === 'income' ? 'income' : 'expense';
}

export async function commitFinanceTxn(
  draft: Record<string, unknown>,
): Promise<ChatCommitHandlerResult> {
  const amountAbs = draftNumber(draft, 'amount');
  const name = draftString(draft, 'name') || '未命名';
  if (amountAbs == null || amountAbs <= 0) {
    return fail('incomplete_draft', '缺少有效金额，请补充后再确认');
  }

  const { formatWallClockDatetimeLocal } = await import('@/lib/api-mysql-datetime');
  const { makeTimestampEntityId } = await import('@/lib/entity-id');
  const { resolveFinanceAccountForAutoLedgerWithDefaults } = await import(
    '@/lib/finance-account-match'
  );
  const {
    buildExpenseCategories,
    buildIncomeCategories,
    pickSheetCategoryForParsed,
  } = await import('@/lib/finance-transaction-sheet/helpers');
  const { loadFinanceLastUsedAccountId, sanitizeFinanceLastUsedAccountId } = await import(
    '@/lib/finance-last-used-account'
  );
  const {
    createFinanceTransaction,
    financeSignedAmountForSave,
    getFinanceAccountsWithBalance,
    validateFinanceTransactionBeforeSave,
  } = await import('@/lib/repositories/finance/finance');

  const accounts = await getFinanceAccountsWithBalance();
  if (!accounts.length) {
    return fail('no_account', '请先添加至少一个账户后再记账');
  }

  const transactionType = asTxnType(draft.transaction_type);
  const lastUsedAccountId = sanitizeFinanceLastUsedAccountId(
    await loadFinanceLastUsedAccountId(),
    accounts,
  );
  const candidates = accounts.map(a => ({ id: a.id, name: a.name, account_no: a.account_no }));
  const matched = resolveFinanceAccountForAutoLedgerWithDefaults(candidates, {
    transactionType,
    accountName: draftString(draft, 'account_name') || null,
    paymentAccountLabel: draftString(draft, 'payment_account_label') || null,
    lastUsedAccountId,
  });
  const account = matched
    ? accounts.find(a => a.id === matched.id) ?? accounts[0]
    : accounts[0];
  if (!account) {
    return fail('no_account', '请先添加至少一个账户后再记账');
  }

  const expenseCats = buildExpenseCategories('#0f766e', '#14b8a6', '#2dd4bf', '#94a3b8');
  const incomeCats = buildIncomeCategories('#0f766e', '#14b8a6', '#2dd4bf', '#94a3b8');
  const cat = pickSheetCategoryForParsed(
    transactionType,
    draftString(draft, 'category_label') || null,
    expenseCats,
    incomeCats,
  );

  const signedAmount = financeSignedAmountForSave(
    account.sign_rule,
    account.account_type,
    Math.abs(amountAbs),
  );
  const boundsErr = await validateFinanceTransactionBeforeSave({
    accountId: account.id,
    transactionType,
    amount: signedAmount,
    extraData: null,
    accountName: account.name,
    uiLedgerBalance: account.balance,
  });
  if (boundsErr) {
    return fail('balance_rule', boundsErr);
  }

  const txnId = makeTimestampEntityId('ft_', 8);
  await createFinanceTransaction({
    id: txnId,
    name,
    happened_at: formatWallClockDatetimeLocal(new Date()),
    account_id: account.id,
    transaction_type: transactionType,
    amount: signedAmount,
    note: draftString(draft, 'note') || null,
    extra_data: JSON.stringify({
      manual: true,
      sentence: true,
      parse_source: 'assistant_chat_commit',
      category_key: cat.key,
      category_label: cat.label,
      matched_account_name: account.name,
    }),
  });

  const typeLabel = transactionType === 'income' ? '收入' : '支出';
  return ok(txnId, `已记${typeLabel}「${name}」¥${Math.abs(amountAbs)}`);
}

export async function commitFinanceTransfer(
  draft: Record<string, unknown>,
): Promise<ChatCommitHandlerResult> {
  const amountAbs = draftNumber(draft, 'amount');
  if (amountAbs == null || amountAbs <= 0) {
    return fail('incomplete_draft', '缺少有效转账金额');
  }

  const { formatWallClockDatetimeLocal } = await import('@/lib/api-mysql-datetime');
  const { makeTimestampEntityId } = await import('@/lib/entity-id');
  const { resolveFinanceAccountForAutoLedger } = await import('@/lib/finance-account-match');
  const { createFinanceTransferTransactions, getFinanceAccountsWithBalance } = await import(
    '@/lib/repositories/finance/finance'
  );

  const accounts = await getFinanceAccountsWithBalance();
  if (accounts.length < 2) {
    return fail('no_account', '转账需要至少两个账户，请先添加账户');
  }
  const candidates = accounts.map(a => ({ id: a.id, name: a.name, account_no: a.account_no }));
  const fromHint = draftString(draft, 'from_account_hint');
  const toHint = draftString(draft, 'to_account_hint');
  const fromMatched = resolveFinanceAccountForAutoLedger(candidates, {
    accountName: fromHint || null,
    paymentAccountLabel: fromHint || null,
  });
  const toMatched = resolveFinanceAccountForAutoLedger(candidates, {
    accountName: toHint || null,
    paymentAccountLabel: toHint || null,
  });
  if (!fromMatched || !toMatched) {
    return fail(
      'account_unresolved',
      '无法匹配转出/转入账户，请在草稿中写明账户名称后再确认',
    );
  }
  if (fromMatched.id === toMatched.id) {
    return fail('same_account', '转出与转入不能是同一账户');
  }

  const fromAccount = accounts.find(a => a.id === fromMatched.id)!;
  const toAccount = accounts.find(a => a.id === toMatched.id)!;
  const feeRaw = draftNumber(draft, 'fee_amount');
  const feeAmount = feeRaw != null && feeRaw > 0 ? Math.abs(feeRaw) : 0;
  const groupId = makeTimestampEntityId('ftg_', 8);

  await createFinanceTransferTransactions({
    idOut: makeTimestampEntityId('ft_', 8),
    idIn: makeTimestampEntityId('ft_', 8),
    groupId,
    fromAccountId: fromAccount.id,
    toAccountId: toAccount.id,
    fromAccountName: fromAccount.name,
    toAccountName: toAccount.name,
    amount: Math.abs(amountAbs),
    happenedAt: formatWallClockDatetimeLocal(new Date()),
    note: draftString(draft, 'name') || draftString(draft, 'note') || null,
    feeAmount: feeAmount > 0 ? feeAmount : undefined,
    idFee: feeAmount > 0 ? makeTimestampEntityId('ft_', 8) : undefined,
  });

  return ok(
    groupId,
    `已转账 ¥${Math.abs(amountAbs)}：${fromAccount.name} → ${toAccount.name}`,
  );
}

export async function commitFinanceScheduled(
  draft: Record<string, unknown>,
): Promise<ChatCommitHandlerResult> {
  const amountAbs = draftNumber(draft, 'amount');
  const name = draftString(draft, 'name');
  if (amountAbs == null || amountAbs <= 0 || !name) {
    return fail('incomplete_draft', '定时支出需要名称与金额');
  }

  const { resolveFinanceAccountForAutoLedgerWithDefaults } = await import(
    '@/lib/finance-account-match'
  );
  const { loadFinanceLastUsedAccountId, sanitizeFinanceLastUsedAccountId } = await import(
    '@/lib/finance-last-used-account'
  );
  const { upsertScheduledFinanceExpense } = await import('@/lib/finance-scheduled-expense');
  const { getFinanceAccountsWithBalance } = await import('@/lib/repositories/finance/finance');
  const { normalizeScheduledExpenseRepeatStorage } = await import('@/lib/schedule/repeat');

  const accounts = await getFinanceAccountsWithBalance();
  if (!accounts.length) {
    return fail('no_account', '请先添加至少一个账户');
  }
  const lastUsedAccountId = sanitizeFinanceLastUsedAccountId(
    await loadFinanceLastUsedAccountId(),
    accounts,
  );
  const candidates = accounts.map(a => ({ id: a.id, name: a.name, account_no: a.account_no }));
  const matched = resolveFinanceAccountForAutoLedgerWithDefaults(candidates, {
    transactionType: 'expense',
    accountName: draftString(draft, 'account_name') || null,
    paymentAccountLabel: draftString(draft, 'payment_account_label') || null,
    lastUsedAccountId,
  });
  const account = matched
    ? accounts.find(a => a.id === matched.id) ?? accounts[0]
    : accounts[0];
  if (!account) {
    return fail('no_account', '请先添加至少一个账户');
  }

  const repeat = normalizeScheduledExpenseRepeatStorage(
    draftString(draft, 'repeat_hint') || draft.repeat_option || 'monthly',
  );
  const daysRaw = draft.days;
  const days: number[] = Array.isArray(daysRaw)
    ? daysRaw.map(d => Number(d)).filter(n => Number.isFinite(n) && n >= 1 && n <= 31)
    : [];
  const hour = draftNumber(draft, 'hour') ?? 9;
  const minute = draftNumber(draft, 'minute') ?? 0;

  const saved = await upsertScheduledFinanceExpense({
    name,
    amount: Math.abs(amountAbs),
    accountId: account.id,
    repeatOption: repeat,
    weeklyDays: repeat === 'weekly' ? (days.length ? days : [1]) : [],
    monthlyDays: repeat === 'monthly' ? (days.length ? days : [1]) : [],
    hour: Math.min(23, Math.max(0, Math.floor(hour))),
    minute: Math.min(59, Math.max(0, Math.floor(minute))),
    timesPerDay: 1,
    categoryLabel: draftString(draft, 'category_label') || null,
    includeInBudget: true,
    enabled: true,
  });

  return ok(saved.id, `已保存定时支出「${name}」¥${Math.abs(amountAbs)}`);
}

export async function commitFinanceCashFlow(
  draft: Record<string, unknown>,
): Promise<ChatCommitHandlerResult> {
  const { loadCashFlowState, persistCashFlowState } = await import(
    '@/lib/repositories/cash-flow/cash-flow'
  );
  const prev = await loadCashFlowState();
  const applied = mergeCashFlowDraft(prev, draft);
  if ('error' in applied) {
    return fail('incomplete_draft', applied.error);
  }
  await persistCashFlowState(applied.state);
  await requestPushPending();
  const title = draftString(draft, 'name_hint') || draftString(draft, 'name') || '现金流条目';
  return ok(applied.entityId, `已记入现金流「${title}」`);
}

export async function commitFinanceBudget(
  draft: Record<string, unknown>,
): Promise<ChatCommitHandlerResult> {
  const amount = draftNumber(draft, 'suggested_base_amount') ?? draftNumber(draft, 'base_amount');
  if (amount == null || amount <= 0) {
    return fail('incomplete_draft', '缺少有效预算基数');
  }
  const { getMonthKey, loadMonthBudgetSettings, persistMonthBudgetSettings } = await import(
    '@/lib/finance-monthly-budget'
  );
  const monthKey = draftString(draft, 'month_key') || getMonthKey(new Date());
  const map = await loadMonthBudgetSettings();
  const prev = map[monthKey] ?? { baseAmount: 0, includeLastBalance: false };
  map[monthKey] = {
    ...prev,
    baseAmount: Math.abs(amount),
  };
  await persistMonthBudgetSettings(map);
  return ok(monthKey, `已将 ${monthKey} 预算基数设为 ¥${Math.abs(amount)}`);
}

function ymdPlusDays(ymd: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return ymd;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  d.setDate(d.getDate() + days);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export async function commitFinanceAccount(
  draft: Record<string, unknown>,
): Promise<ChatCommitHandlerResult> {
  const name = draftString(draft, 'name');
  if (!name) return fail('incomplete_draft', '缺少账户名称');

  const { makeTimestampEntityId } = await import('@/lib/entity-id');
  const { createFinanceAccount, updateFinanceAccount } = await import(
    '@/lib/repositories/finance/finance'
  );

  const existingId =
    draftString(draft, 'account_id') || draftString(draft, 'id');
  const accountTypeRaw = draftString(draft, 'account_type') || 'asset';
  const isLiability =
    accountTypeRaw === 'liability' ||
    accountTypeRaw === '负债' ||
    draft.sign_rule === -1;
  const account_type = isLiability ? 'liability' : accountTypeRaw || 'asset';
  const sign_rule: -1 | 1 = isLiability ? -1 : 1;
  const account_no = draftString(draft, 'account_no') || null;
  const note = draftString(draft, 'note') || null;

  if (existingId) {
    await updateFinanceAccount(existingId, {
      name: name.slice(0, 40),
      account_no,
      account_type,
      sign_rule,
      note,
    });
    await requestPushPending();
    return ok(existingId, `已更新账户「${name.slice(0, 40)}」`);
  }

  const id = makeTimestampEntityId('fa_', 8);
  await createFinanceAccount({
    id,
    name: name.slice(0, 40),
    account_no,
    account_type,
    sign_rule,
    note,
    extra_data: JSON.stringify({ source: 'assistant_chat_commit' }),
  });
  await requestPushPending();
  return ok(id, `已创建账户「${name.slice(0, 40)}」`);
}

export async function commitFinanceFlowCategory(
  draft: Record<string, unknown>,
): Promise<ChatCommitHandlerResult> {
  const name = draftString(draft, 'name');
  if (!name) return fail('incomplete_draft', '缺少分类名称');

  const sheetRaw = draft.sheet;
  const useSheet =
    sheetRaw === true ||
    sheetRaw === 1 ||
    String(sheetRaw ?? '')
      .trim()
      .toLowerCase() === 'true' ||
    draftString(draft, 'sheet') === 'sheet' ||
    draftString(draft, 'action') === 'sheet';

  if (useSheet) {
    const txn =
      draftString(draft, 'transaction_type') === 'income' ? 'income' : 'expense';
    const { createFinanceSheetCustomCategory } = await import(
      '@/lib/repositories/finance/finance-sheet-category'
    );
    const id = await createFinanceSheetCustomCategory(name.slice(0, 20), txn);
    await requestPushPending();
    return ok(id, `已创建记账分类「${name.slice(0, 20)}」`);
  }

  const { makeTimestampEntityId } = await import('@/lib/entity-id');
  const { createFinanceFlowCategory, updateFinanceFlowCategory } = await import(
    '@/lib/repositories/finance/finance'
  );
  const existingId =
    draftString(draft, 'category_id') || draftString(draft, 'id');
  if (existingId) {
    await updateFinanceFlowCategory(existingId, { name: name.slice(0, 40) });
    await requestPushPending();
    return ok(existingId, `已更新流水分类「${name.slice(0, 40)}」`);
  }
  const id = makeTimestampEntityId('ffc_', 8);
  await createFinanceFlowCategory({
    id,
    name: name.slice(0, 40),
    extra_data: JSON.stringify({ source: 'assistant_chat_commit' }),
  });
  await requestPushPending();
  return ok(id, `已创建流水分类「${name.slice(0, 40)}」`);
}

export async function commitFinanceAccountType(
  draft: Record<string, unknown>,
): Promise<ChatCommitHandlerResult> {
  const name = draftString(draft, 'name');
  if (!name) return fail('incomplete_draft', '缺少账户类型名称');

  const { upsertFinanceAccountType } = await import(
    '@/lib/repositories/finance/finance'
  );
  const kind = draftString(draft, 'kind').toLowerCase();
  const is_liability =
    kind === 'liability' || kind === '负债' || draft.is_liability === true || draft.is_liability === 1
      ? 1
      : 0;
  const id = await upsertFinanceAccountType({
    name: name.slice(0, 40),
    is_liability,
    icon_key: draftString(draft, 'icon') || 'savings',
  });
  await requestPushPending();
  return ok(id, `已保存账户类型「${name.slice(0, 40)}」`);
}

export async function commitSavingsPlan(
  draft: Record<string, unknown>,
): Promise<ChatCommitHandlerResult> {
  const name = draftString(draft, 'name');
  const target = draftNumber(draft, 'target_amount') ?? draftNumber(draft, 'amount');
  if (!name) return fail('incomplete_draft', '缺少储蓄计划名称');
  if (target == null || target < 0) {
    return fail('incomplete_draft', '缺少有效目标金额');
  }

  const { formatYmd } = await import('@/lib/date');
  const { makeTimestampEntityId } = await import('@/lib/entity-id');
  const { createSavingsPlan, updateSavingsPlan } = await import(
    '@/lib/repositories/savings-plan/savings-plan'
  );

  const today = formatYmd(new Date());
  const start =
    draftString(draft, 'start_date') ||
    draftString(draft, 'start_ymd') ||
    today;
  const end =
    draftString(draft, 'end_date') ||
    draftString(draft, 'end_ymd') ||
    ymdPlusDays(start, 90);
  const existingId =
    draftString(draft, 'plan_id') || draftString(draft, 'id');

  if (existingId) {
    await updateSavingsPlan(existingId, {
      name: name.slice(0, 40),
      target_amount: Math.abs(target),
      start_date: start,
      end_date: end,
    });
    await requestPushPending();
    return ok(existingId, `已更新储蓄计划「${name.slice(0, 40)}」`);
  }

  const id = makeTimestampEntityId('sp_', 8);
  await createSavingsPlan({
    id,
    name: name.slice(0, 40),
    start_date: start,
    end_date: end,
    target_amount: Math.abs(target),
    extra_data: JSON.stringify({ source: 'assistant_chat_commit' }),
  });
  await requestPushPending();
  return ok(id, `已创建储蓄计划「${name.slice(0, 40)}」`);
}

export async function commitSavingsDeposit(
  draft: Record<string, unknown>,
): Promise<ChatCommitHandlerResult> {
  const amount = draftNumber(draft, 'amount');
  if (amount == null || amount === 0) {
    return fail('incomplete_draft', '缺少有效存款金额');
  }

  const { makeTimestampEntityId } = await import('@/lib/entity-id');
  const { getSavingsPlans } = await import(
    '@/lib/repositories/savings-plan/savings-plan'
  );
  const { createSavingsPlanDeposit } = await import(
    '@/lib/repositories/savings-plan/savings-plan-deposit'
  );

  let planId = draftString(draft, 'plan_id') || draftString(draft, 'savings_plan_id');
  const planName = draftString(draft, 'plan_name') || draftString(draft, 'name');
  if (!planId) {
    const plans = await getSavingsPlans();
    if (!plans.length) {
      return fail('no_plan', '请先创建储蓄计划后再存入');
    }
    if (planName) {
      const needle = planName.toLowerCase();
      const hit =
        plans.find(p => p.name.trim().toLowerCase() === needle) ||
        plans.find(p => p.name.trim().toLowerCase().includes(needle));
      planId = hit?.id || '';
    }
    if (!planId) planId = plans[0]?.id || '';
  }
  if (!planId) {
    return fail('incomplete_draft', '无法解析储蓄计划，请补充计划名称');
  }

  const id = makeTimestampEntityId('spd_', 8);
  await createSavingsPlanDeposit({
    id,
    savings_plan_id: planId,
    amount,
    note: draftString(draft, 'note') || null,
    extra_data: JSON.stringify({ source: 'assistant_chat_commit' }),
  });
  await requestPushPending();
  return ok(id, `已存入 ¥${Math.abs(amount)}`);
}

export const financeCommitHandlers: Record<string, ChatCommitHandler> = {
  commit_finance_txn: async input => commitFinanceTxn(input.draft),
  commit_finance_transfer: async input => commitFinanceTransfer(input.draft),
  commit_finance_scheduled: async input => commitFinanceScheduled(input.draft),
  commit_finance_cash_flow: async input => commitFinanceCashFlow(input.draft),
  commit_finance_budget: async input => commitFinanceBudget(input.draft),
  commit_finance_account: async input => commitFinanceAccount(input.draft),
  commit_finance_flow_category: async input => commitFinanceFlowCategory(input.draft),
  commit_finance_account_type: async input => commitFinanceAccountType(input.draft),
  commit_savings_plan: async input => commitSavingsPlan(input.draft),
  commit_savings_deposit: async input => commitSavingsDeposit(input.draft),
};
