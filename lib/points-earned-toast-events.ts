type Listener = (points: number | null) => void;

const listeners = new Set<Listener>();

let visiblePoints: number | null = null;
let pendingPoints = 0;
let coalesceTimer: ReturnType<typeof setTimeout> | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;

const COALESCE_MS = 80;
const TOAST_VISIBLE_MS = 1000;

function emit(points: number | null): void {
  visiblePoints = points;
  for (const listener of listeners) {
    listener(points);
  }
}

function flushPending(): void {
  coalesceTimer = null;
  const points = pendingPoints;
  pendingPoints = 0;
  if (points <= 0) return;

  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
  emit(points);
  hideTimer = setTimeout(() => {
    hideTimer = null;
    emit(null);
  }, TOAST_VISIBLE_MS);
}

/** 获得积分时调用；短时间内多次发放会合并为一次 toast。 */
export function notifyPointsEarned(delta: number): void {
  const n = Math.floor(Number(delta));
  if (!Number.isFinite(n) || n <= 0) return;

  pendingPoints += n;
  if (coalesceTimer) clearTimeout(coalesceTimer);
  coalesceTimer = setTimeout(flushPending, COALESCE_MS);
}

export function subscribePointsEarnedToast(listener: Listener): () => void {
  listeners.add(listener);
  listener(visiblePoints);
  return () => {
    listeners.delete(listener);
  };
}
