export type AppToastKind = 'success' | 'error' | 'info' | 'warn' | 'loading';

export type AppToastPayload = {
  id: number;
  message: string;
  kind: AppToastKind;
  /** loading 为 0 表示常驻，直至 hide / 被下一条替换 */
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
  loading: 0,
};

function emit(payload: AppToastPayload | null): void {
  current = payload;
  for (const listener of listeners) {
    listener(payload);
  }
}

function clearHideTimer(): void {
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
}

function show(message: string, kind: AppToastKind, durationMs?: number): number {
  const trimmed = message.trim();
  if (!trimmed) return current?.id ?? 0;

  clearHideTimer();

  const holdMs = durationMs ?? DEFAULT_DURATION[kind];
  const payload: AppToastPayload = {
    id: ++toastSeq,
    message: trimmed,
    kind,
    durationMs: holdMs,
  };
  emit(payload);

  if (holdMs > 0) {
    hideTimer = setTimeout(() => {
      hideTimer = null;
      emit(null);
    }, holdMs);
  }

  return payload.id;
}

/** 命令式全局 Toast（需根布局挂载 AppToastHost） */
export const toast = {
  success(message: string, durationMs?: number): number {
    return show(message, 'success', durationMs);
  },
  error(message: string, durationMs?: number): number {
    return show(message, 'error', durationMs);
  },
  info(message: string, durationMs?: number): number {
    return show(message, 'info', durationMs);
  },
  warn(message: string, durationMs?: number): number {
    return show(message, 'warn', durationMs);
  },
  /** 常驻加载提示；用 toast.hide() 或下一条 Toast 结束 */
  loading(message: string): number {
    return show(message, 'loading', 0);
  },
  /** 关闭当前 Toast（含 loading） */
  hide(): void {
    clearHideTimer();
    emit(null);
  },
};

export function subscribeAppToast(listener: Listener): () => void {
  listeners.add(listener);
  listener(current);
  return () => {
    listeners.delete(listener);
  };
}
