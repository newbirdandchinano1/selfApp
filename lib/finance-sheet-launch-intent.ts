export type FinanceSheetLaunchIntent =
  | {
      kind: 'manual';
      tab: 'expense' | 'income' | 'sentence';
      accountId: string | null;
    }
  | {
      kind: 'transfer';
      /** 扣款账户；负债还款场景可留空，由弹窗默认选资产账户 */
      fromAccountId: string | null;
      /** 入账/还款账户；从负债详情发起还款时传入 */
      toAccountId?: string | null;
    }
  /** 剪贴板截图（如 zheng://screenshot，旧流程）：财务页消费后自动 AI 识别并落账 */
  | {
      kind: 'auto_ledger_clipboard_image';
      imageDataUri: string;
    }
  /** 深链 zheng://screenshot：在财务页弹窗内读取剪贴板并记账 */
  | {
      kind: 'auto_ledger_clipboard_pending';
    };

let pending: FinanceSheetLaunchIntent | null = null;

export function setFinanceSheetLaunchIntent(intent: FinanceSheetLaunchIntent) {
  pending = intent;
}

export function peekFinanceSheetLaunchIntent(): FinanceSheetLaunchIntent | null {
  return pending;
}

export function consumeFinanceSheetLaunchIntent(): FinanceSheetLaunchIntent | null {
  const next = pending;
  pending = null;
  return next;
}
