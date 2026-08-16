/** 自动记账时用于匹配截图/AI 识别的付款账户 */
export type FinanceAccountMatchCandidate = {
  id: string;
  name: string;
  account_no?: string | null;
};

function normalizeAccountText(input: string): string {
  return input
    .replace(/\s/g, '')
    .replace(/[（）()]/g, '')
    .toLowerCase();
}

function scoreNameOverlap(labelNorm: string, accountNameNorm: string): number {
  if (!labelNorm || !accountNameNorm) return 0;
  if (labelNorm === accountNameNorm) return 100;
  if (labelNorm.includes(accountNameNorm) || accountNameNorm.includes(labelNorm)) {
    return 60 + Math.min(labelNorm.length, accountNameNorm.length);
  }
  return 0;
}

function scoreAccountNoInLabel(labelNorm: string, accountNo: string | null | undefined): number {
  const digits = (accountNo ?? '').replace(/\D/g, '');
  if (digits.length < 4) return 0;
  const tail4 = digits.slice(-4);
  if (labelNorm.includes(tail4)) return 55;
  return 0;
}

function pickBestAccountByLabel(
  accounts: FinanceAccountMatchCandidate[],
  rawLabel: string | null | undefined,
): FinanceAccountMatchCandidate | null {
  const label = typeof rawLabel === 'string' ? rawLabel.trim() : '';
  if (!label) return null;
  const labelNorm = normalizeAccountText(label);

  let best: { account: FinanceAccountMatchCandidate; score: number } | null = null;
  for (const account of accounts) {
    const nameNorm = normalizeAccountText(account.name);
    let score = scoreNameOverlap(labelNorm, nameNorm);
    score = Math.max(score, scoreAccountNoInLabel(labelNorm, account.account_no));
    if (!best || score > best.score) {
      best = { account, score };
    }
  }
  return best && best.score >= 50 ? best.account : null;
}

/**
 * 根据 AI 从用户账户列表中选择的名称，或截图上的付款方式文案，解析应记账的账户。
 * 无法匹配时返回 `null`（由调用方决定是否回退到上次记账账户）。
 */
export function resolveFinanceAccountForAutoLedger(
  accounts: FinanceAccountMatchCandidate[],
  options: {
    accountName?: string | null;
    paymentAccountLabel?: string | null;
  },
): FinanceAccountMatchCandidate | null {
  if (!accounts.length) return null;

  const aiName = typeof options.accountName === 'string' ? options.accountName.trim() : '';
  if (aiName) {
    const exact = accounts.find((a) => a.name.trim() === aiName);
    if (exact) return exact;
    const fromAi = pickBestAccountByLabel(accounts, aiName);
    if (fromAi) return fromAi;
  }

  return pickBestAccountByLabel(accounts, options.paymentAccountLabel);
}

/**
 * 自动记账账户解析：先 AI/文案匹配，再取上次记账账户，最后回退列表首项。
 */
export function resolveFinanceAccountForAutoLedgerWithDefaults(
  accounts: FinanceAccountMatchCandidate[],
  options: {
    transactionType: 'expense' | 'income';
    accountName?: string | null;
    paymentAccountLabel?: string | null;
    lastUsedAccountId?: string | null;
  },
): FinanceAccountMatchCandidate | null {
  if (!accounts.length) return null;

  const matched = resolveFinanceAccountForAutoLedger(accounts, {
    accountName: options.accountName,
    paymentAccountLabel: options.paymentAccountLabel,
  });
  if (matched) return matched;

  const lastUsedId = options.lastUsedAccountId;
  if (lastUsedId) {
    const fromLastUsed = accounts.find((a) => a.id === lastUsedId);
    if (fromLastUsed) return fromLastUsed;
  }

  return accounts[0] ?? null;
}
