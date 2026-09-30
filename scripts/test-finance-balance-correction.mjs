/**
 * 余额校正流水纯函数单测（与 finance.ts 内 buildFinanceBalanceCorrectionTxnInput 同逻辑）。
 * 用法：node scripts/test-finance-balance-correction.mjs
 */

const FINANCE_BALANCE_ADJUST_EPS = 1e-4;
const FINANCE_TXN_EXTRA_BALANCE_CORRECTION_REASON = 'balance_correction';
const FINANCE_TXN_EXTRA_EXCLUDE_FROM_BUDGET = 'exclude_from_budget';

function buildBalanceCorrectionExtra(transactionType) {
  return JSON.stringify({
    reason: FINANCE_TXN_EXTRA_BALANCE_CORRECTION_REASON,
    ...(transactionType === 'expense' ? { [FINANCE_TXN_EXTRA_EXCLUDE_FROM_BUDGET]: true } : {}),
  });
}

function buildFinanceBalanceCorrectionTxnInput(input) {
  const delta = input.delta;
  if (!Number.isFinite(delta) || Math.abs(delta) < FINANCE_BALANCE_ADJUST_EPS) return null;

  const note = input.note ?? null;
  const base = {
    id: input.id,
    name: '余额校正',
    happened_at: input.happenedAt,
    account_id: input.accountId,
    note,
  };

  if (input.signRule > 0) {
    return delta > 0
      ? {
          ...base,
          transaction_type: 'income',
          amount: delta,
          extra_data: buildBalanceCorrectionExtra('income'),
        }
      : {
          ...base,
          transaction_type: 'expense',
          amount: -delta,
          extra_data: buildBalanceCorrectionExtra('expense'),
        };
  }

  return delta > 0
    ? {
        ...base,
        transaction_type: 'income',
        amount: -delta,
        extra_data: buildBalanceCorrectionExtra('income'),
      }
    : {
        ...base,
        transaction_type: 'expense',
        amount: delta,
        extra_data: buildBalanceCorrectionExtra('expense'),
      };
}

function computeTransactionLedgerEffect(transactionType, amount, extraData) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return 0;
  if (transactionType === 'income') return Math.abs(n);
  if (transactionType === 'expense') return -Math.abs(n);
  if (transactionType === 'transfer') {
    let leg;
    try {
      if (extraData) {
        const raw = JSON.parse(extraData);
        if (raw && typeof raw === 'object') {
          const v = raw.transfer_leg;
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

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    passed += 1;
    return;
  }
  failed += 1;
  console.error('FAIL:', msg);
}

assert(
  buildFinanceBalanceCorrectionTxnInput({
    id: 'ft_1',
    accountId: 'fa_x',
    signRule: 1,
    delta: 0,
    happenedAt: '2026-09-30 10:00:00',
  }) === null,
  '资产账户 delta≈0 应跳过',
);

assert(
  buildFinanceBalanceCorrectionTxnInput({
    id: 'ft_1',
    accountId: 'fa_x',
    signRule: 1,
    delta: 1e-5,
    happenedAt: '2026-09-30 10:00:00',
  }) === null,
  '低于 EPS 的差额应跳过',
);

{
  const txn = buildFinanceBalanceCorrectionTxnInput({
    id: 'ft_up',
    accountId: 'fa_asset',
    signRule: 1,
    delta: 100,
    happenedAt: '2026-09-30 10:00:00',
  });
  assert(txn?.transaction_type === 'income', '资产上调应为 income');
  assert(txn?.amount === 100, '资产上调 amount=delta');
  assert(
    computeTransactionLedgerEffect(txn.transaction_type, txn.amount, txn.extra_data) === 100,
    '资产上调 ledger+100',
  );
  assert(!JSON.parse(txn.extra_data).exclude_from_budget, '收入校正不带 exclude_from_budget');
}

{
  const txn = buildFinanceBalanceCorrectionTxnInput({
    id: 'ft_down',
    accountId: 'fa_asset',
    signRule: 1,
    delta: -50,
    happenedAt: '2026-09-30 10:00:00',
  });
  assert(txn?.transaction_type === 'expense', '资产下调应为 expense');
  assert(txn?.amount === 50, '资产下调 amount=|delta|');
  assert(
    computeTransactionLedgerEffect(txn.transaction_type, txn.amount, txn.extra_data) === -50,
    '资产下调 ledger-50',
  );
  assert(JSON.parse(txn.extra_data).exclude_from_budget === true, '支出校正排除预算');
  assert(JSON.parse(txn.extra_data).reason === 'balance_correction', 'reason=balance_correction');
}

{
  const txn = buildFinanceBalanceCorrectionTxnInput({
    id: 'ft_liab_up',
    accountId: 'fa_liab',
    signRule: -1,
    delta: 80,
    happenedAt: '2026-09-30 10:00:00',
  });
  // 负债账本向 0 靠近（delta>0）：income + 负 amount
  assert(txn?.transaction_type === 'income', '负债账本增加(趋近0)为 income');
  assert(txn?.amount === -80, '负债 income 金额为负');
  assert(
    computeTransactionLedgerEffect(txn.transaction_type, txn.amount, txn.extra_data) === 80,
    '负债上调 ledger+80',
  );
}

{
  const txn = buildFinanceBalanceCorrectionTxnInput({
    id: 'ft_liab_down',
    accountId: 'fa_liab',
    signRule: -1,
    delta: -120,
    happenedAt: '2026-09-30 10:00:00',
    note: '核对',
  });
  assert(txn?.transaction_type === 'expense', '负债账本减少(欠更多)为 expense');
  assert(txn?.amount === -120, '负债 expense 金额为负');
  assert(txn?.note === '核对', 'note 透传');
  assert(
    computeTransactionLedgerEffect(txn.transaction_type, txn.amount, txn.extra_data) === -120,
    '负债下调 ledger-120',
  );
}

assert(
  buildFinanceBalanceCorrectionTxnInput({
    id: 'ft_nan',
    accountId: 'fa_x',
    signRule: 1,
    delta: Number.NaN,
    happenedAt: '2026-09-30 10:00:00',
  }) === null,
  'NaN delta 应跳过',
);

console.log(`finance-balance-correction: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
