export type FinanceSheetLaunchIntent =
  | {
      kind: 'manual';
      tab: 'expense' | 'income' | 'sentence';
      accountId: string | null;
    }
  | {
      kind: 'transfer';
      fromAccountId: string | null;
    };

let pending: FinanceSheetLaunchIntent | null = null;

export function setFinanceSheetLaunchIntent(intent: FinanceSheetLaunchIntent) {
  pending = intent;
}

export function consumeFinanceSheetLaunchIntent(): FinanceSheetLaunchIntent | null {
  const next = pending;
  pending = null;
  return next;
}
