import type { FinanceSheetLaunchIntent } from '@/lib/finance-sheet-launch-intent';

type OpenListener = (intent: FinanceSheetLaunchIntent) => void;
type SavedListener = () => void;

const openListeners = new Set<OpenListener>();
const savedListeners = new Set<SavedListener>();

export function subscribeFinanceSheetOpen(listener: OpenListener): () => void {
  openListeners.add(listener);
  return () => openListeners.delete(listener);
}

export function subscribeFinanceSheetSaved(listener: SavedListener): () => void {
  savedListeners.add(listener);
  return () => savedListeners.delete(listener);
}

export function notifyFinanceSheetSaved(): void {
  for (const listener of savedListeners) {
    listener();
  }
}

/** 任意页面打开记账/转账底部弹窗（财务 Tab 或全局 FinanceSheetHost 渲染） */
export function openFinanceSheet(intent: FinanceSheetLaunchIntent): void {
  for (const listener of openListeners) {
    listener(intent);
  }
}
