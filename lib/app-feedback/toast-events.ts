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
let gapTimer: ReturnType<typeof setTimeout> | null = null;
let toastSeq = 0;

/** 出队间隔：等 Host 淡出再播下一条 */
const QUEUE_GAP_MS = 240;
/** 同 kind 短窗合并 */
const MERGE_WINDOW_MS = 700;
/** 相同 success 文案去抖 */
const SUCCESS_DEBOUNCE_MS = 1600;

const DEFAULT_DURATION: Record<AppToastKind, number> = {
  success: 2000,
  error: 4200,
  info: 2200,
  warn: 3200,
  loading: 0,
};

type QueueItem = {
  message: string;
  kind: AppToastKind;
  durationMs: number;
};

const queue: QueueItem[] = [];
let lastSuccessMessage = '';
let lastSuccessAt = 0;
let lastEnqueuedAt = 0;
let lastEnqueuedKind: AppToastKind | null = null;

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

function clearGapTimer(): void {
  if (gapTimer) {
    clearTimeout(gapTimer);
    gapTimer = null;
  }
}

function isTransientServerBusyMessage(message: string): boolean {
  return /服务器繁忙|同步繁忙/.test(message);
}

function isShowing(): boolean {
  return current != null;
}

function present(item: QueueItem): void {
  clearHideTimer();
  clearGapTimer();

  const payload: AppToastPayload = {
    id: ++toastSeq,
    message: item.message,
    kind: item.kind,
    durationMs: item.durationMs,
  };
  emit(payload);

  if (item.durationMs > 0) {
    hideTimer = setTimeout(() => {
      hideTimer = null;
      emit(null);
      // 淡出后再播下一条
      gapTimer = setTimeout(() => {
        gapTimer = null;
        pumpQueue();
      }, QUEUE_GAP_MS);
    }, item.durationMs);
  }
}

function pumpQueue(): void {
  if (isShowing()) return;
  const next = queue.shift();
  if (!next) return;
  present(next);
}

/**
 * loading 插队：立刻替换当前并清空排队（加载态优先）。
 * 其它 kind：入队；同 kind 短窗合并；success 同文案去抖。
 */
function enqueue(message: string, kind: AppToastKind, durationMs?: number): number {
  const trimmed = message.trim();
  if (!trimmed) return current?.id ?? 0;

  if ((kind === 'error' || kind === 'warn') && isTransientServerBusyMessage(trimmed)) {
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.warn('[toast] suppressed server-busy:', trimmed);
    }
    return current?.id ?? 0;
  }

  const holdMs = durationMs ?? DEFAULT_DURATION[kind];
  const now = Date.now();

  // loading：打断队列，立即展示
  if (kind === 'loading') {
    clearHideTimer();
    clearGapTimer();
    queue.length = 0;
    present({ message: trimmed, kind, durationMs: holdMs });
    lastEnqueuedAt = now;
    lastEnqueuedKind = kind;
    return current?.id ?? 0;
  }

  // success 同文案去抖
  if (
    kind === 'success' &&
    trimmed === lastSuccessMessage &&
    now - lastSuccessAt < SUCCESS_DEBOUNCE_MS
  ) {
    return current?.id ?? 0;
  }

  // 同 kind 短窗：合并进队尾（或当前若队列空且正在展示同 kind）
  if (
    lastEnqueuedKind === kind &&
    now - lastEnqueuedAt < MERGE_WINDOW_MS &&
    kind !== 'error'
  ) {
    const mergeTarget =
      queue.length > 0 && queue[queue.length - 1]!.kind === kind
        ? queue[queue.length - 1]!
        : current?.kind === kind && queue.length === 0
          ? null
          : null;

    if (mergeTarget) {
      if (!mergeTarget.message.includes(trimmed)) {
        mergeTarget.message = `${mergeTarget.message} · ${trimmed}`;
        // 合并后略延长阅读时间
        mergeTarget.durationMs = Math.min(
          mergeTarget.durationMs + 600,
          kind === 'success' ? 3200 : 4500,
        );
      }
      lastEnqueuedAt = now;
      if (kind === 'success') {
        lastSuccessMessage = trimmed;
        lastSuccessAt = now;
      }
      return current?.id ?? 0;
    }

    // 正在展示同 kind：改写当前文案并续期（避免连闪）
    if (current?.kind === kind && queue.length === 0) {
      if (!current.message.includes(trimmed)) {
        const merged = `${current.message} · ${trimmed}`;
        const nextDuration = Math.min(
          (current.durationMs || holdMs) + 600,
          kind === 'success' ? 3200 : 4500,
        );
        clearHideTimer();
        const payload: AppToastPayload = {
          id: ++toastSeq,
          message: merged,
          kind,
          durationMs: nextDuration,
        };
        emit(payload);
        hideTimer = setTimeout(() => {
          hideTimer = null;
          emit(null);
          gapTimer = setTimeout(() => {
            gapTimer = null;
            pumpQueue();
          }, QUEUE_GAP_MS);
        }, nextDuration);
      }
      lastEnqueuedAt = now;
      if (kind === 'success') {
        lastSuccessMessage = trimmed;
        lastSuccessAt = now;
      }
      return current?.id ?? 0;
    }
  }

  if (kind === 'success') {
    lastSuccessMessage = trimmed;
    lastSuccessAt = now;
  }
  lastEnqueuedAt = now;
  lastEnqueuedKind = kind;

  queue.push({ message: trimmed, kind, durationMs: holdMs });
  if (!isShowing()) {
    pumpQueue();
  }

  return current?.id ?? toastSeq;
}

/** 命令式全局 Toast（需根布局挂载 AppToastHost） */
export const toast = {
  success(message: string, durationMs?: number): number {
    return enqueue(message, 'success', durationMs);
  },
  error(message: string, durationMs?: number): number {
    return enqueue(message, 'error', durationMs);
  },
  info(message: string, durationMs?: number): number {
    return enqueue(message, 'info', durationMs);
  },
  warn(message: string, durationMs?: number): number {
    return enqueue(message, 'warn', durationMs);
  },
  /** 常驻加载提示；用 toast.hide() 或下一条 Toast 结束 */
  loading(message: string): number {
    return enqueue(message, 'loading', 0);
  },
  /** 关闭当前 Toast（含 loading）并清空排队 */
  hide(): void {
    clearHideTimer();
    clearGapTimer();
    queue.length = 0;
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
