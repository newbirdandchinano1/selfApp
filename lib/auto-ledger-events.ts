export type AutoLedgerPendingRow = {
  id: string;
  source: 'clipboard' | 'shortcut_intent' | 'picker';
  retryAttempt?: number;
  maxAttempts?: number;
};

export type AutoLedgerUiState = {
  pending: AutoLedgerPendingRow[];
  toastVisible: boolean;
  toastMessage: string;
};

type Listener = (state: AutoLedgerUiState) => void;

let pending: AutoLedgerPendingRow[] = [];
let toastVisible = false;
let toastMessage = '正在识别截图并记账…';
const listeners = new Set<Listener>();

function snapshot(): AutoLedgerUiState {
  return {
    pending: [...pending],
    toastVisible,
    toastMessage,
  };
}

function emit(): void {
  const state = snapshot();
  for (const listener of listeners) {
    listener(state);
  }
}

export function subscribeAutoLedgerUiState(listener: Listener): () => void {
  listeners.add(listener);
  listener(snapshot());
  return () => {
    listeners.delete(listener);
  };
}

export function setAutoLedgerPendingRows(rows: AutoLedgerPendingRow[]): void {
  pending = rows;
  emit();
}

export function patchAutoLedgerPendingRow(
  id: string,
  patch: Partial<Pick<AutoLedgerPendingRow, 'retryAttempt' | 'maxAttempts'>>,
): void {
  pending = pending.map((row) => (row.id === id ? { ...row, ...patch } : row));
  emit();
}

export function removeAutoLedgerPendingRow(id: string): void {
  pending = pending.filter((row) => row.id !== id);
  emit();
}

export function showAutoLedgerToast(message: string): void {
  toastMessage = message;
  toastVisible = true;
  emit();
}

export function hideAutoLedgerToast(): void {
  toastVisible = false;
  emit();
}

export function getAutoLedgerPendingRows(): AutoLedgerPendingRow[] {
  return [...pending];
}

type CompletionListener = () => void;
const completionListeners = new Set<CompletionListener>();

/** 自动记账成功落库后通知财务页刷新列表 */
export function subscribeAutoLedgerCompleted(listener: CompletionListener): () => void {
  completionListeners.add(listener);
  return () => {
    completionListeners.delete(listener);
  };
}

export function notifyAutoLedgerCompleted(): void {
  for (const listener of completionListeners) {
    listener();
  }
}
