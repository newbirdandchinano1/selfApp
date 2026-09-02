import { roundPoints } from '@/lib/reward-points';

type Listener = (balance: number) => void;

const listeners = new Set<Listener>();

/** 积分余额本地变更后广播，供任务页 / 心愿板等即时刷新 UI。 */
export function notifyPointsBalanceChanged(balance: number): void {
  const n = roundPoints(Number(balance) || 0);
  const value = Number.isFinite(n) ? n : 0;
  for (const listener of listeners) {
    listener(value);
  }
}

export function subscribePointsBalanceChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
