import { ExtensionStorage } from '@bacons/apple-targets';
import { Platform } from 'react-native';

import { createFinanceTransaction, getFinanceAccountsWithBalance, validateFinanceLedgerBalanceAfterChange } from '@/lib/repositories/finance/finance';

/** 与 targets/zheng-ledger-intent/LedgerSharedStore.swift 保持一致 */
export const LEDGER_APP_GROUP = 'group.com.myselfManage.appdemo.ledger';
const DEFAULT_ACCOUNT_KEY = 'ledger_default_account_id';
const PENDING_TXN_KEY = 'pending_finance_transaction';

export type PendingLedgerTransaction = {
  id: string;
  name: string;
  happenedAt: string;
  accountId: string;
  transactionType: 'expense' | 'income';
  amount: number;
  note?: string | null;
  categoryKey?: string | null;
  categoryLabel?: string | null;
  imageDataUri?: string | null;
};

function getStorage(): ExtensionStorage | null {
  if (Platform.OS !== 'ios') return null;
  return new ExtensionStorage(LEDGER_APP_GROUP);
}

/** 将默认记账账户同步给 App Intents Extension（确认记账时使用）。 */
export function syncLedgerDefaultAccountId(accountId: string | null | undefined) {
  const storage = getStorage();
  if (!storage) return;
  if (accountId?.trim()) {
    storage.set(DEFAULT_ACCOUNT_KEY, accountId.trim());
  } else {
    storage.remove(DEFAULT_ACCOUNT_KEY);
  }
}

function readPendingTransaction(): PendingLedgerTransaction | null {
  const storage = getStorage();
  if (!storage) return null;
  const raw = storage.get(PENDING_TXN_KEY);
  if (!raw || typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw) as PendingLedgerTransaction;
    if (!parsed?.id || !parsed.accountId || !parsed.name) return null;
    return parsed;
  } catch {
    return null;
  }
}

function clearPendingTransaction() {
  getStorage()?.remove(PENDING_TXN_KEY);
}

/**
 * 消费 Extension「确认记账」写入的待同步流水，落入 SQLite。
 * @returns 是否成功写入一笔
 */
export async function consumePendingLedgerFromAppGroup(): Promise<boolean> {
  if (Platform.OS !== 'ios') return false;

  const pending = readPendingTransaction();
  if (!pending) return false;

  try {
    const accounts = await getFinanceAccountsWithBalance();
    const account = accounts.find((a) => a.id === pending.accountId);
    if (!account) {
      clearPendingTransaction();
      return false;
    }

    const amountAbs = Math.abs(pending.amount);
    const signedAmount = account.sign_rule > 0 ? amountAbs : -amountAbs;

    const boundsErr = validateFinanceLedgerBalanceAfterChange(
      account.sign_rule,
      account.balance ?? 0,
      pending.transactionType,
      signedAmount,
      null,
    );
    if (boundsErr) {
      clearPendingTransaction();
      return false;
    }

    await createFinanceTransaction({
      id: pending.id,
      name: pending.name,
      happened_at: pending.happenedAt,
      account_id: pending.accountId,
      transaction_type: pending.transactionType,
      amount: signedAmount,
      note: pending.note ?? null,
      extra_data: JSON.stringify({
        manual: true,
        sentence: true,
        parse_source: 'ai',
        from_clipboard_screenshot: true,
        from_app_intent_snippet: true,
        category_key: pending.categoryKey ?? null,
        category_label: pending.categoryLabel ?? null,
        attachments: pending.imageDataUri
          ? [{ type: 'image', uri: pending.imageDataUri }]
          : null,
      }),
    });

    clearPendingTransaction();
    return true;
  } catch (e) {
    console.warn('consumePendingLedgerFromAppGroup failed:', e);
    clearPendingTransaction();
    return false;
  }
}
