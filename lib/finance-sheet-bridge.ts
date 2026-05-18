import type { FinanceSheetLaunchIntent } from '@/lib/finance-sheet-launch-intent';

export type FinanceSheetBridge = {
  open: (intent: FinanceSheetLaunchIntent) => void;
};

let bridge: FinanceSheetBridge | null = null;

export function setFinanceSheetBridge(next: FinanceSheetBridge | null) {
  bridge = next;
}

export function getFinanceSheetBridge(): FinanceSheetBridge | null {
  return bridge;
}
