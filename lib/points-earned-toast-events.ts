import { formatPoints, roundPoints } from '@/lib/reward-points';

type Listener = (points: number | null) => void;

const listeners = new Set<Listener>();

let visiblePoints: number | null = null;
let pendingPoints = 0;
let coalesceTimer: ReturnType<typeof setTimeout> | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;

const COALESCE_MS = 80;
/** 与 host 停留 + 上滑 + 渐隐总时长对齐，供晚订阅者清状态。 */
const TOAST_VISIBLE_MS = 2250;

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
  if (points === 0) return;

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

/**
 * 积分变动 toast：正数加分、负数扣分；短时间内多次变动会合并为一次。
 */
export function notifyPointsEarned(delta: number): void {
  const n = roundPoints(delta);
  if (!Number.isFinite(n) || n === 0) return;

  pendingPoints = roundPoints(pendingPoints + n);
  if (coalesceTimer) clearTimeout(coalesceTimer);
  coalesceTimer = setTimeout(flushPending, COALESCE_MS);
}

/** @deprecated 使用 notifyPointsEarned（已支持正负） */
export const notifyPointsDelta = notifyPointsEarned;

export function subscribePointsEarnedToast(listener: Listener): () => void {
  listeners.add(listener);
  listener(visiblePoints);
  return () => {
    listeners.delete(listener);
  };
}

/** toast 展示用绝对值文案 */
export function formatPointsToastAmount(points: number): string {
  return formatPoints(Math.abs(points));
}
