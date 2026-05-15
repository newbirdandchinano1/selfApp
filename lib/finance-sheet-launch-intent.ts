export type FinanceSheetLaunchIntent =
  | {
      kind: 'manual';
      tab: 'expense' | 'income' | 'sentence';
      accountId: string | null;
    }
  | {
      kind: 'transfer';
      fromAccountId: string | null;
    }
  /** 剪贴板截图（如 zheng://screenshot）：财务页消费后自动 AI 识别并落账 */
  | {
      kind: 'auto_ledger_clipboard_image';
      imageDataUri: string;
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
