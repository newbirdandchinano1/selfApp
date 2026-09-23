/** 周课程表本地变更广播：设置轴 / 入格 / 移除后立即刷新 UI */

type Listener = (revision: number) => void;

const listeners = new Set<Listener>();
let revision = 0;

export function getFrogScheduleRevision(): number {
  return revision;
}

export function notifyFrogScheduleChanged(): void {
  revision += 1;
  const rev = revision;
  for (const listener of listeners) {
    try {
      listener(rev);
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
