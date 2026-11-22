/**
 * S9.3 W1：finance commit_* → 现有 repository（动态 import，避免单测拉 RN）。
 */

import type { ChatCommitHandler, ChatCommitHandlerResult } from '@/lib/assistant/chat-commit';
import { mergeCashFlowDraft } from './cash-flow-draft';
import { draftNumber, draftString, fail, ok, requestPushPending } from './shared';

function asTxnType(raw: unknown): 'expense' | 'income' {
  return raw === 'income' ? 'income' : 'expense';
}

function hasOwn(draft: Record<string, unknown>, ...keys: string[]): boolean {
  return keys.some(k => Object.prototype.hasOwnProperty.call(draft, k));
}

function asBudgetExclude(draft: Record<string, unknown>): boolean | undefined {
  if (hasOwn(draft, 'exclude_from_budget')) {
    const v = draft.exclude_from_budget;
    if (typeof v === 'boolean') return v;
    if (v === 1 || v === '1' || v === 'true') return true;
    if (v === 0 || v === '0' || v === 'false') return false;
  }
  if (hasOwn(draft, 'include_in_budget')) {
    const v = draft.include_in_budget;
    if (typeof v === 'boolean') return !v;
    if (v === 1 || v === '1' || v === 'true') return false;
    if (v === 0 || v === '0' || v === 'false') return true;
  }
  return undefined;
}

async function resolveFinanceTxnRef(
  draft: Record<string, unknown>,
): Promise<{ id: string; name: string } | { error: string }> {
  let txnId =
    draftString(draft, 'transaction_id') ||
    draftString(draft, 'id') ||
    draftString(draft, 'txn_id');
  const nameHint =
    draftString(draft, 'locate_name') ||
    draftString(draft, 'original_name') ||
    draftString(draft, 'name');

  if (!txnId && nameHint) {
    const { getFinanceTransactions } = await import('@/lib/repositories/finance/finance');
    const rows = await getFinanceTransactions({ cacheOnly: true });
    const needle = nameHint.toLowerCase();
    const exact = rows.filter(r => r.name.trim().toLowerCase() === needle);
    const partial =
      exact.length > 0
        ? exact
        : rows.filter(r => r.name.trim().toLowerCase().includes(needle));
    if (partial.length === 1) {
      return { id: partial[0]!.id, name: partial[0]!.name || nameHint };
    }
    if (partial.length > 1) {
      return { error: `找到多笔「${nameHint}」相关流水，请先选定一笔` };
    }
    return { error: `找不到流水「${nameHint}」` };
  }

  if (!txnId) return { error: '请指定要操作的流水' };

  const { getFinanceTransactionById } = await import('@/lib/repositories/finance/finance');
  const row = await getFinanceTransactionById(txnId);
  if (!row) return { error: nameHint ? `找不到流水「${nameHint}」` : '找不到该流水' };
  return { id: row.id, name: row.name || nameHint || txnId };
}

async function resolveFinanceAccountRef(
  draft: Record<string, unknown>,
): Promise<{ id: string; name: string } | { error: string }> {
  let accountId =
    draftString(draft, 'account_id') ||
    draftString(draft, 'id');
  const nameHint =
    draftString(draft, 'account_name') ||
    draftString(draft, 'name') ||
    draftString(draft, 'locate_name');

  const { getFinanceAccountsWithBalance } = await import('@/lib/repositories/finance/finance');
  const accounts = await getFinanceAccountsWithBalance();

  if (!accountId && nameHint) {
    const needle = nameHint.toLowerCase();
    const exact = accounts.filter(a => a.name.trim().toLowerCase() === needle);
    const partial =
      exact.length > 0
        ? exact
        : accounts.filter(a => a.name.trim().toLowerCase().includes(needle));
    if (partial.length === 1) {
      return { id: partial[0]!.id, name: partial[0]!.name || nameHint };
    }
    if (partial.length > 1) {
      return { error: `找到多个「${nameHint}」相关账户，请先选定一个` };
    }
    return { error: `找不到账户「${nameHint}」` };
  }

  if (!accountId) return { error: '请指定要操作的账户' };
  const hit = accounts.find(a => a.id === accountId);
  if (!hit) return { error: nameHint ? `找不到账户「${nameHint}」` : '找不到该账户' };
  return { id: hit.id, name: hit.name || nameHint || accountId };
}

export async function commitFinanceTxn(
  draft: Record<string, unknown>,
): Promise<ChatCommitHandlerResult> {
  const existingId =
    draftString(draft, 'transaction_id') ||
    (draftString(draft, 'id')?.startsWith('ft_') ? draftString(draft, 'id') : '');

  if (existingId || draftString(draft, 'locate_name') || draftString(draft, 'original_name')) {
    const ref = await resolveFinanceTxnRef(draft);
    if ('error' in ref) return fail('incomplete_draft', ref.error);

    const {
      financeSignedAmountForSave,
      getFinanceAccountsWithBalance,
      getFinanceTransactionById,
      updateFinanceTransaction,
    } = await import('@/lib/repositories/finance/finance');
    const { budgetExtraPatchForTransaction } = await import(
      '@/lib/repositories/finance/finance-transaction-extra'
    );

    const current = await getFinanceTransactionById(ref.id);
    if (!current) return fail('incomplete_draft', '找不到该流水');

    const accounts = await getFinanceAccountsWithBalance();
    const transactionType = hasOwn(draft, 'transaction_type')
      ? asTxnType(draft.transaction_type)
      : asTxnType(current.transaction_type);

    let nextAccountId = current.account_id;
    const accountHint =
      draftString(draft, 'account_name') || draftString(draft, 'payment_account_label');
    if (accountHint) {
      const { resolveFinanceAccountForAutoLedgerWithDefaults } = await import(
        '@/lib/finance-account-match'
      );
      const candidates = accounts.map(a => ({ id: a.id, name: a.name, account_no: a.account_no }));
      const matched = resolveFinanceAccountForAutoLedgerWithDefaults(candidates, {
        transactionType,
        accountName: accountHint,
        paymentAccountLabel: accountHint,
        lastUsedAccountId: current.account_id,
      });
      if (matched) nextAccountId = matched.id;
    }
    const account = accounts.find(a => a.id === nextAccountId);
    if (!account) return fail('no_account', '找不到目标账户');

    const amountAbs =
      draftNumber(draft, 'amount') ??
      (Number.isFinite(Number(current.amount)) ? Math.abs(Number(current.amount)) : null);
    if (amountAbs == null || amountAbs <= 0) {
      return fail('incomplete_draft', '缺少有效金额');
    }

    const signedAmount = financeSignedAmountForSave(
      account.sign_rule,
      account.account_type,
      Math.abs(amountAbs),
    );

    let nextExtra = current.extra_data;
    const excl = asBudgetExclude(draft);
    if (excl !== undefined) {
      let extraObj: Record<string, unknown> = {};
      try {
        const raw = current.extra_data ? JSON.parse(current.extra_data) : {};
        if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
          extraObj = { ...(raw as Record<string, unknown>) };
        }
      } catch {
        extraObj = {};
      }
      Object.assign(extraObj, budgetExtraPatchForTransaction(transactionType, !excl));
      nextExtra = JSON.stringify(extraObj);
    }

    const nextName =
      (hasOwn(draft, 'name') ? draftString(draft, 'name') : '') ||
      current.name ||
      '未命名';

    try {
      await updateFinanceTransaction(ref.id, {
        name: nextName.slice(0, 80),
        account_id: nextAccountId,
        transaction_type: transactionType,
        amount: signedAmount,
        note: hasOwn(draft, 'note') ? draftString(draft, 'note') || null : undefined,
        extra_data: nextExtra,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : '更新流水失败';
      return fail('txn_update_failed', msg);
    }
    await requestPushPending();
    return ok(ref.id, `已更新流水「${nextName.slice(0, 40)}」¥${Math.abs(amountAbs)}`);
  }

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
  const excl = asBudgetExclude(draft);
  const extraObj: Record<string, unknown> = {
    manual: true,
    sentence: true,
    parse_source: 'assistant_chat_commit',
    category_key: cat.key,
    category_label: cat.label,
    matched_account_name: account.name,
  };
  if (excl !== undefined) {
    const { budgetExtraPatchForTransaction } = await import(
      '@/lib/repositories/finance/finance-transaction-extra'
    );
    Object.assign(extraObj, budgetExtraPatchForTransaction(transactionType, !excl));
  }
  const extraData = JSON.stringify(extraObj);

  const boundsErr = await validateFinanceTransactionBeforeSave({
    accountId: account.id,
    transactionType,
    amount: signedAmount,
    extraData,
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
    extra_data: extraData,
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
  const existingId =
    draftString(draft, 'scheduled_id') ||
    (draftString(draft, 'id')?.startsWith('fse_') || draftString(draft, 'id')?.startsWith('sfe_')
      ? draftString(draft, 'id')
      : '');

  const { resolveFinanceAccountForAutoLedgerWithDefaults } = await import(
    '@/lib/finance-account-match'
  );
  const { loadFinanceLastUsedAccountId, sanitizeFinanceLastUsedAccountId } = await import(
    '@/lib/finance-last-used-account'
  );
  const {
    getScheduledFinanceExpenseById,
    loadScheduledFinanceExpenses,
    upsertScheduledFinanceExpense,
  } = await import('@/lib/finance-scheduled-expense');
  const { getFinanceAccountsWithBalance } = await import('@/lib/repositories/finance/finance');
  const { normalizeScheduledExpenseRepeatStorage } = await import('@/lib/schedule/repeat');

  let current = existingId ? await getScheduledFinanceExpenseById(existingId) : null;
  if (!current) {
    const locate =
      draftString(draft, 'locate_name') ||
      (existingId ? '' : draftString(draft, 'name'));
    if (locate) {
      const rows = await loadScheduledFinanceExpenses();
      const needle = locate.toLowerCase();
      const exact = rows.filter(r => r.name.trim().toLowerCase() === needle);
      const partial =
        exact.length > 0
          ? exact
          : rows.filter(r => r.name.trim().toLowerCase().includes(needle));
      if (partial.length === 1) current = partial[0]!;
      else if (partial.length > 1) {
        return fail('incomplete_draft', `找到多条「${locate}」相关定时支出，请先选定一条`);
      }
    }
  }

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
    lastUsedAccountId: current?.accountId || lastUsedAccountId,
  });
  const account = matched
    ? accounts.find(a => a.id === matched.id) ?? accounts[0]
    : accounts.find(a => a.id === current?.accountId) ?? accounts[0];
  if (!account) {
    return fail('no_account', '请先添加至少一个账户');
  }

  const name =
    draftString(draft, 'name') || current?.name || '';
  const amountAbs =
    draftNumber(draft, 'amount') ??
    (current ? Math.abs(current.amount) : null);
  if (!current && (amountAbs == null || amountAbs <= 0 || !name)) {
    return fail('incomplete_draft', '定时支出需要名称与金额');
  }
  if (current && !name) {
    return fail('incomplete_draft', '定时支出缺少名称');
  }

  const repeat = normalizeScheduledExpenseRepeatStorage(
    draftString(draft, 'repeat_hint') ||
      draft.repeat_option ||
      current?.repeatOption ||
      'monthly',
  );
  const daysRaw = draft.days;
  const days: number[] = Array.isArray(daysRaw)
    ? daysRaw.map(d => Number(d)).filter(n => Number.isFinite(n) && n >= 1 && n <= 31)
    : current
      ? repeat === 'weekly'
        ? [...current.weeklyDays]
        : [...current.monthlyDays]
      : [];
  const dayOfMonth = draftNumber(draft, 'day_of_month');
  if (dayOfMonth != null && dayOfMonth >= 1 && dayOfMonth <= 31 && days.length === 0) {
    days.push(Math.floor(dayOfMonth));
  }
  const hour = draftNumber(draft, 'hour') ?? current?.hour ?? 9;
  const minute = draftNumber(draft, 'minute') ?? current?.minute ?? 0;
  const enabled =
    typeof draft.enabled === 'boolean'
      ? draft.enabled
      : draft.enabled === 0 || draft.enabled === '0' || draft.enabled === 'false'
        ? false
        : draft.enabled === 1 || draft.enabled === '1' || draft.enabled === 'true'
          ? true
          : (current?.enabled ?? true);
  const includeInBudget =
    typeof draft.include_in_budget === 'boolean'
      ? draft.include_in_budget
      : (current?.includeInBudget ?? true);

  const saved = await upsertScheduledFinanceExpense({
    id: current?.id,
    name: name.slice(0, 40),
    amount: Math.abs(amountAbs ?? current?.amount ?? 0),
    accountId: account.id,
    repeatOption: repeat,
    weeklyDays: repeat === 'weekly' ? (days.length ? days : current?.weeklyDays?.length ? current.weeklyDays : [1]) : [],
    monthlyDays: repeat === 'monthly' ? (days.length ? days : current?.monthlyDays?.length ? current.monthlyDays : [1]) : [],
    hour: Math.min(23, Math.max(0, Math.floor(hour))),
    minute: Math.min(59, Math.max(0, Math.floor(minute))),
    timesPerDay: current?.timesPerDay ?? 1,
    categoryLabel:
      draftString(draft, 'category_label') || current?.categoryLabel || null,
    includeInBudget,
    enabled,
    createdAt: current?.createdAt,
  });

  const actionLabel = current
    ? enabled !== current.enabled
      ? enabled
        ? '已启用'
        : '已暂停'
      : '已更新'
    : '已保存';
  return ok(saved.id, `${actionLabel}定时支出「${name.slice(0, 40)}」¥${Math.abs(saved.amount)}`);
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
  const {
    clampBudgetRefreshDay,
    getBudgetMonthKeyForDate,
    loadBudgetRefreshDay,
    loadMonthBudgetSettings,
    persistBudgetRefreshDay,
    persistMonthBudgetSettings,
  } = await import('@/lib/finance-monthly-budget');

  const clearMonth =
    draft.clear === true ||
    draft.clear_month === true ||
    draft.action === 'clear' ||
    draftString(draft, 'action') === 'clear';

  const refreshDayRaw =
    draftNumber(draft, 'refresh_day') ?? draftNumber(draft, 'budget_refresh_day');
  if (refreshDayRaw != null && !clearMonth) {
    const onlyRefresh =
      draftNumber(draft, 'suggested_base_amount') == null &&
      draftNumber(draft, 'base_amount') == null &&
      draftNumber(draft, 'budget_amount') == null &&
      draft.include_last_balance == null &&
      draft.includeLastBalance == null &&
      draft.period_surplus_override == null &&
      draft.periodSurplusOverride == null;
    if (onlyRefresh || draft.action === 'set_refresh_day') {
      const day = clampBudgetRefreshDay(refreshDayRaw);
      await persistBudgetRefreshDay(day);
      return ok(String(day), `已将预算刷新日设为每月 ${day} 日`);
    }
  }

  const refreshDay = await loadBudgetRefreshDay();
  const monthKey =
    draftString(draft, 'month_key') ||
    draftString(draft, 'month') ||
    getBudgetMonthKeyForDate(new Date(), refreshDay);

  if (clearMonth) {
    const map = await loadMonthBudgetSettings();
    if (!(monthKey in map)) {
      return ok(monthKey, `${monthKey} 无预算配置`);
    }
    delete map[monthKey];
    await persistMonthBudgetSettings(map);
    return ok(monthKey, `已清除 ${monthKey} 预算设置`);
  }

  const amount =
    draftNumber(draft, 'suggested_base_amount') ??
    draftNumber(draft, 'base_amount') ??
    draftNumber(draft, 'budget_amount');
  const includeRaw = draft.include_last_balance ?? draft.includeLastBalance;
  const hasInclude = typeof includeRaw === 'boolean';
  const surplusRaw = draft.period_surplus_override ?? draft.periodSurplusOverride;
  const clearSurplus =
    draft.clear_surplus_override === true ||
    surplusRaw === null ||
    draftString(draft, 'clear_surplus_override') === '1';

  if (amount == null && !hasInclude && surplusRaw === undefined && !clearSurplus && refreshDayRaw == null) {
    return fail('incomplete_draft', '缺少预算基数、结余开关或刷新日等可写字段');
  }

  const map = await loadMonthBudgetSettings();
  const prev = map[monthKey] ?? { baseAmount: 0, includeLastBalance: false };
  const next = { ...prev };
  if (amount != null && amount >= 0) {
    next.baseAmount = Math.abs(amount);
  }
  if (hasInclude) {
    next.includeLastBalance = includeRaw as boolean;
  }
  if (clearSurplus) {
    delete next.periodSurplusOverride;
  } else if (typeof surplusRaw === 'number' && Number.isFinite(surplusRaw)) {
    next.periodSurplusOverride = surplusRaw;
  }
  map[monthKey] = next;
  await persistMonthBudgetSettings(map);

  if (refreshDayRaw != null) {
    await persistBudgetRefreshDay(clampBudgetRefreshDay(refreshDayRaw));
  }

  const parts: string[] = [];
  if (amount != null) parts.push(`基数 ¥${Math.abs(amount)}`);
  if (hasInclude) parts.push(includeRaw ? '含上周期结余' : '不含上周期结余');
  if (clearSurplus) parts.push('已清除结余校正');
  else if (typeof surplusRaw === 'number') parts.push(`结余校正 ¥${surplusRaw}`);
  if (refreshDayRaw != null) parts.push(`刷新日 ${clampBudgetRefreshDay(refreshDayRaw)} 日`);
  return ok(monthKey, `已更新 ${monthKey} 预算：${parts.join(' · ') || '已保存'}`);
}

export async function commitFinanceSavingsGoal(
  draft: Record<string, unknown>,
): Promise<ChatCommitHandlerResult> {
  const {
    clearFinanceSavingsGoal,
    persistFinanceSavingsGoal,
    FINANCE_SAVINGS_GOAL_MAX_AMOUNT,
  } = await import('@/lib/finance-savings-goal');

  const clear =
    draft.clear === true ||
    draft.action === 'clear' ||
    draftString(draft, 'action') === 'clear';
  if (clear) {
    await clearFinanceSavingsGoal();
    return ok('savings_goal', '已清除储蓄目标');
  }

  const amount =
    draftNumber(draft, 'target_amount') ?? draftNumber(draft, 'amount');
  const targetDate =
    draftString(draft, 'target_date') || draftString(draft, 'date');
  if (amount == null || amount <= 0) {
    return fail('incomplete_draft', '缺少有效目标金额');
  }
  if (!targetDate || !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
    return fail('incomplete_draft', '缺少有效目标日期（YYYY-MM-DD）');
  }
  if (amount > FINANCE_SAVINGS_GOAL_MAX_AMOUNT) {
    return fail('incomplete_draft', `目标金额不得超过 ${FINANCE_SAVINGS_GOAL_MAX_AMOUNT}`);
  }

  await persistFinanceSavingsGoal({
    targetAmount: Math.round(amount * 100) / 100,
    targetDate,
  });
  return ok(
    'savings_goal',
    `已设置储蓄目标 ¥${Math.round(amount * 100) / 100}（截止 ${targetDate}）`,
  );
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
  const { makeTimestampEntityId } = await import('@/lib/entity-id');
  const {
    createFinanceAccount,
    getFinanceAccountsWithBalance,
    updateFinanceAccount,
  } = await import('@/lib/repositories/finance/finance');
  const {
    mergeFinanceAccountExcludeFromTotalAssets,
    mergeFinanceAccountHideFromHome,
  } = await import('@/lib/repositories/finance/finance-account-extra');

  let existingId =
    draftString(draft, 'account_id') ||
    (draftString(draft, 'id')?.startsWith('fa_') ? draftString(draft, 'id') : '');
  const nameHint = draftString(draft, 'name');
  let currentExtra: string | null = null;
  let currentName = nameHint;

  if (!existingId && nameHint) {
    const accounts = await getFinanceAccountsWithBalance();
    const needle = nameHint.toLowerCase();
    const hit =
      accounts.find(a => a.name.trim().toLowerCase() === needle) ||
      accounts.find(a => a.name.trim().toLowerCase().includes(needle));
    if (hit) {
      existingId = hit.id;
      currentExtra = hit.extra_data;
      currentName = hit.name;
    }
  } else if (existingId) {
    const accounts = await getFinanceAccountsWithBalance();
    const hit = accounts.find(a => a.id === existingId);
    currentExtra = hit?.extra_data ?? null;
    currentName = hit?.name || nameHint;
  }

  const name = draftString(draft, 'name') || currentName;
  if (!name) return fail('incomplete_draft', '缺少账户名称');

  const accountTypeRaw = draftString(draft, 'account_type') || 'asset';
  const isLiability =
    accountTypeRaw === 'liability' ||
    accountTypeRaw === '负债' ||
    draft.sign_rule === -1;
  const account_type = isLiability ? 'liability' : accountTypeRaw || 'asset';
  const sign_rule: -1 | 1 = isLiability ? -1 : 1;
  const account_no = hasOwn(draft, 'account_no')
    ? draftString(draft, 'account_no') || null
    : undefined;
  const note = hasOwn(draft, 'note') ? draftString(draft, 'note') || null : undefined;

  let extra_data: string | undefined;
  const hasExclude = hasOwn(draft, 'exclude_from_total_assets');
  const hasHide = hasOwn(draft, 'hide_from_home');
  if (hasExclude || hasHide) {
    let next = currentExtra;
    if (hasExclude) {
      const excluded =
        draft.exclude_from_total_assets === true ||
        draft.exclude_from_total_assets === 1 ||
        draft.exclude_from_total_assets === '1' ||
        draft.exclude_from_total_assets === 'true';
      next = mergeFinanceAccountExcludeFromTotalAssets(next, excluded);
    }
    if (hasHide) {
      const hidden =
        draft.hide_from_home === true ||
        draft.hide_from_home === 1 ||
        draft.hide_from_home === '1' ||
        draft.hide_from_home === 'true';
      next = mergeFinanceAccountHideFromHome(next, hidden);
    }
    extra_data = next ?? undefined;
  }

  if (existingId) {
    await updateFinanceAccount(existingId, {
      name: name.slice(0, 40),
      ...(account_no !== undefined ? { account_no } : {}),
      ...(draftString(draft, 'account_type') || draft.sign_rule != null
        ? { account_type, sign_rule }
        : {}),
      ...(note !== undefined ? { note } : {}),
      ...(extra_data !== undefined ? { extra_data } : {}),
    });
    await requestPushPending();
    const bits: string[] = [];
    if (hasExclude) {
      bits.push(
        draft.exclude_from_total_assets === true ||
          draft.exclude_from_total_assets === 1 ||
          draft.exclude_from_total_assets === 'true'
          ? '不计入总资产'
          : '计入总资产',
      );
    }
    if (hasHide) {
      bits.push(
        draft.hide_from_home === true ||
          draft.hide_from_home === 1 ||
          draft.hide_from_home === 'true'
          ? '首页隐藏'
          : '首页显示',
      );
    }
    return ok(
      existingId,
      `已更新账户「${name.slice(0, 40)}」${bits.length ? `（${bits.join(' · ')}）` : ''}`,
    );
  }

  const id = makeTimestampEntityId('fa_', 8);
  const createExtra = extra_data
    ? (() => {
        try {
          const o = JSON.parse(extra_data) as Record<string, unknown>;
          return JSON.stringify({ ...o, source: 'assistant_chat_commit' });
        } catch {
          return JSON.stringify({ source: 'assistant_chat_commit' });
        }
      })()
    : JSON.stringify({ source: 'assistant_chat_commit' });
  await createFinanceAccount({
    id,
    name: name.slice(0, 40),
    account_no: account_no ?? null,
    account_type,
    sign_rule,
    note: note ?? null,
    extra_data: createExtra,
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

export async function commitFinanceTxnDelete(
  draft: Record<string, unknown>,
): Promise<ChatCommitHandlerResult> {
  const ref = await resolveFinanceTxnRef(draft);
  if ('error' in ref) return fail('incomplete_draft', ref.error);
  const { deleteFinanceTransaction } = await import('@/lib/repositories/finance/finance');
  try {
    await deleteFinanceTransaction(ref.id);
  } catch (e) {
    const msg = e instanceof Error ? e.message : '删除流水失败';
    return fail('txn_delete_failed', msg);
  }
  await requestPushPending();
  return ok(ref.id, `已删除流水「${ref.name.slice(0, 40)}」`);
}

export async function commitFinanceAccountDelete(
  draft: Record<string, unknown>,
): Promise<ChatCommitHandlerResult> {
  const ref = await resolveFinanceAccountRef(draft);
  if ('error' in ref) return fail('incomplete_draft', ref.error);
  const { deleteFinanceAccount } = await import('@/lib/repositories/finance/finance');
  try {
    await deleteFinanceAccount(ref.id);
  } catch (e) {
    const msg = e instanceof Error ? e.message : '删除账户失败';
    return fail('account_delete_failed', msg);
  }
  await requestPushPending();
  return ok(ref.id, `已删除账户「${ref.name.slice(0, 40)}」及其下流水`);
}

export async function commitFinanceScheduledDelete(
  draft: Record<string, unknown>,
): Promise<ChatCommitHandlerResult> {
  let sid =
    draftString(draft, 'scheduled_id') ||
    draftString(draft, 'id');
  const nameHint =
    draftString(draft, 'name') || draftString(draft, 'locate_name');
  const {
    deleteScheduledFinanceExpense,
    getScheduledFinanceExpenseById,
    loadScheduledFinanceExpenses,
  } = await import('@/lib/finance-scheduled-expense');

  let label = nameHint;
  if (!sid && nameHint) {
    const rows = await loadScheduledFinanceExpenses();
    const needle = nameHint.toLowerCase();
    const exact = rows.filter(r => r.name.trim().toLowerCase() === needle);
    const partial =
      exact.length > 0
        ? exact
        : rows.filter(r => r.name.trim().toLowerCase().includes(needle));
    if (partial.length === 1) {
      sid = partial[0]!.id;
      label = partial[0]!.name;
    } else if (partial.length > 1) {
      return fail('incomplete_draft', `找到多条「${nameHint}」相关定时支出，请先选定一条`);
    } else {
      return fail('incomplete_draft', `找不到定时支出「${nameHint}」`);
    }
  }
  if (!sid) return fail('incomplete_draft', '请指定要删除的定时支出');
  const row = await getScheduledFinanceExpenseById(sid);
  if (!row) return fail('incomplete_draft', label ? `找不到定时支出「${label}」` : '找不到该定时支出');
  label = row.name || label || sid;

  try {
    await deleteScheduledFinanceExpense(sid);
  } catch (e) {
    const msg = e instanceof Error ? e.message : '删除定时支出失败';
    return fail('scheduled_delete_failed', msg);
  }
  await requestPushPending();
  return ok(sid, `已删除定时支出「${String(label).slice(0, 40)}」（已记账流水保留）`);
}

export async function commitFinanceFlowCategoryDelete(
  draft: Record<string, unknown>,
): Promise<ChatCommitHandlerResult> {
  let cid =
    draftString(draft, 'category_id') ||
    draftString(draft, 'id');
  const nameHint = draftString(draft, 'name');
  const {
    deleteFinanceFlowCategory,
    getFinanceFlowCategories,
  } = await import('@/lib/repositories/finance/finance');

  let label = nameHint;
  if (!cid && nameHint) {
    const rows = await getFinanceFlowCategories({ cacheOnly: true });
    const needle = nameHint.toLowerCase();
    const exact = rows.filter(r => r.name.trim().toLowerCase() === needle);
    const partial =
      exact.length > 0
        ? exact
        : rows.filter(r => r.name.trim().toLowerCase().includes(needle));
    if (partial.length === 1) {
      cid = partial[0]!.id;
      label = partial[0]!.name;
    } else if (partial.length > 1) {
      return fail('incomplete_draft', `找到多个「${nameHint}」相关分类，请先选定一个`);
    } else {
      return fail('incomplete_draft', `找不到分类「${nameHint}」`);
    }
  }
  if (!cid) return fail('incomplete_draft', '请指定要删除的流水分类');

  try {
    await deleteFinanceFlowCategory(cid);
  } catch (e) {
    const msg = e instanceof Error ? e.message : '删除分类失败';
    return fail('category_delete_failed', msg);
  }
  await requestPushPending();
  return ok(cid, `已删除流水分类「${String(label || cid).slice(0, 40)}」`);
}

export async function commitFinanceAccountTypeDelete(
  draft: Record<string, unknown>,
): Promise<ChatCommitHandlerResult> {
  const name = draftString(draft, 'name');
  if (!name) return fail('incomplete_draft', '缺少账户类型名称');
  const { deleteFinanceAccountTypeByName } = await import(
    '@/lib/repositories/finance/finance'
  );
  try {
    await deleteFinanceAccountTypeByName(name);
  } catch (e) {
    const msg = e instanceof Error ? e.message : '删除账户类型失败';
    return fail('account_type_delete_failed', msg);
  }
  await requestPushPending();
  return ok(name, `已删除账户类型「${name.slice(0, 40)}」`);
}

export async function commitFinanceBalanceCorrection(
  draft: Record<string, unknown>,
): Promise<ChatCommitHandlerResult> {
  const target =
    draftNumber(draft, 'target_balance') ??
    draftNumber(draft, 'targetLedgerBalance') ??
    draftNumber(draft, 'balance');
  if (target == null || !Number.isFinite(target)) {
    return fail('incomplete_draft', '缺少有效目标余额');
  }

  const ref = await resolveFinanceAccountRef(draft);
  if ('error' in ref) return fail('incomplete_draft', ref.error);

  const {
    applyFinanceAccountBalanceCorrection,
    getFinanceAccountsWithBalance,
  } = await import('@/lib/repositories/finance/finance');
  const accounts = await getFinanceAccountsWithBalance();
  const account = accounts.find(a => a.id === ref.id);
  if (!account) return fail('no_account', `找不到账户「${ref.name}」`);

  try {
    await applyFinanceAccountBalanceCorrection({
      accountId: account.id,
      targetLedgerBalance: target,
      note: draftString(draft, 'note') || '余额校正',
      signRule: account.sign_rule,
      accountType: account.account_type,
      currentLedgerBalance: account.balance,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '余额校正失败';
    return fail('balance_correction_failed', msg);
  }
  await requestPushPending();
  return ok(account.id, `已将「${account.name}」余额校正为 ¥${Math.abs(target)}`);
}

export const financeCommitHandlers: Record<string, ChatCommitHandler> = {
  commit_finance_txn: async input => commitFinanceTxn(input.draft),
  commit_finance_txn_delete: async input => commitFinanceTxnDelete(input.draft),
  commit_finance_transfer: async input => commitFinanceTransfer(input.draft),
  commit_finance_scheduled: async input => commitFinanceScheduled(input.draft),
  commit_finance_scheduled_delete: async input => commitFinanceScheduledDelete(input.draft),
  commit_finance_cash_flow: async input => commitFinanceCashFlow(input.draft),
  commit_finance_budget: async input => commitFinanceBudget(input.draft),
  commit_finance_savings_goal: async input => commitFinanceSavingsGoal(input.draft),
  commit_finance_account: async input => commitFinanceAccount(input.draft),
  commit_finance_account_delete: async input => commitFinanceAccountDelete(input.draft),
  commit_finance_flow_category: async input => commitFinanceFlowCategory(input.draft),
  commit_finance_flow_category_delete: async input =>
    commitFinanceFlowCategoryDelete(input.draft),
  commit_finance_account_type: async input => commitFinanceAccountType(input.draft),
  commit_finance_account_type_delete: async input =>
    commitFinanceAccountTypeDelete(input.draft),
  commit_finance_balance_correction: async input =>
    commitFinanceBalanceCorrection(input.draft),
  commit_savings_plan: async input => commitSavingsPlan(input.draft),
  commit_savings_deposit: async input => commitSavingsDeposit(input.draft),
};
