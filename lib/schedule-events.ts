/** 周课程表本地变更广播：设置轴 / 入格 / 移除后立即刷新 UI */

type Listener = () => void;

const listeners = new Set<Listener>();

export function notifyFrogScheduleChanged(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch (err) {
      console.warn('[frog-schedule] listener error', err);
    }
  }
}

export function subscribeFrogScheduleChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
