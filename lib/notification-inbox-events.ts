/**
 * 本地通知收件箱变更广播（角标 / 消息列表刷新）。
 * emit 做短 throttle，避免强提醒连发刷 UI。
 */

type Listener = () => void;

const listeners = new Set<Listener>();
let emitTimer: ReturnType<typeof setTimeout> | null = null;
const EMIT_THROTTLE_MS = 100;

export function subscribeNotificationInboxChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function flushEmit(): void {
  emitTimer = null;
  for (const listener of listeners) {
    try {
      listener();
    } catch (e) {
      console.warn('[notification-inbox] listener failed', e);
    }
  }
}

/** 写库成功后调用；100ms 内多次合并为一次 */
export function emitNotificationInboxChanged(): void {
  if (emitTimer != null) return;
  emitTimer = setTimeout(flushEmit, EMIT_THROTTLE_MS);
}

/** 测试用：立刻广播并清空 throttle */
export function emitNotificationInboxChangedNow(): void {
  if (emitTimer != null) {
    clearTimeout(emitTimer);
    emitTimer = null;
  }
  flushEmit();
}
