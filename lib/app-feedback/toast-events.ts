export type AppToastKind = 'success' | 'error' | 'info' | 'warn';

export type AppToastPayload = {
  id: number;
  message: string;
  kind: AppToastKind;
  durationMs: number;
};

type Listener = (payload: AppToastPayload | null) => void;

const listeners = new Set<Listener>();

let current: AppToastPayload | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;
let toastSeq = 0;

const DEFAULT_DURATION: Record<AppToastKind, number> = {
  success: 2000,
  error: 2600,
  info: 2200,
  warn: 2400,
};

function emit(payload: AppToastPayload | null): void {
  current = payload;
  for (const listener of listeners) {
    listener(payload);
  }
}

function show(message: string, kind: AppToastKind, durationMs?: number): void {
  const trimmed = message.trim();
  if (!trimmed) return;

  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }

  const holdMs = durationMs ?? DEFAULT_DURATION[kind];
  const payload: AppToastPayload = {
    id: ++toastSeq,
    message: trimmed,
    kind,
    durationMs: holdMs,
  };
  emit(payload);

  hideTimer = setTimeout(() => {
    hideTimer = null;
    emit(null);
  }, holdMs);
}

/** 命令式全局 Toast（需根布局挂载 AppToastHost） */
export const toast = {
  success(message: string, durationMs?: number): void {
    show(message, 'success', durationMs);
  },
  error(message: string, durationMs?: number): void {
    show(message, 'error', durationMs);
  },
  info(message: string, durationMs?: number): void {
    show(message, 'info', durationMs);
  },
  warn(message: string, durationMs?: number): void {
    show(message, 'warn', durationMs);
  },
};

export function subscribeAppToast(listener: Listener): () => void {
  listeners.add(listener);
  listener(current);
  return () => {
    listeners.delete(listener);
  };
}
