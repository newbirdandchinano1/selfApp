type Listener = (balance: number) => void;

const listeners = new Set<Listener>();

/** 积分余额本地变更后广播，供任务页 / 心愿板等即时刷新 UI。 */
export function notifyPointsBalanceChanged(balance: number): void {
  const n = Math.max(0, Math.floor(Number(balance) || 0));
  for (const listener of listeners) {
    listener(n);
  }
}

export function subscribePointsBalanceChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
