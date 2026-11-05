/**
 * 桌面组件推送门闩：等本地库迁移完成后再读表 / 写 App Group。
 * 避免启动竞态把 INITIAL「打开 App 后同步…」永远留在主屏。
 */
import { Platform } from 'react-native';

type ReadyListener = () => void;

let dbReady = false;
const waiters: Array<() => void> = [];
const readyListeners = new Set<ReadyListener>();

export function markHomeWidgetsDbReady(): void {
  if (dbReady) return;
  dbReady = true;
  const pending = waiters.splice(0, waiters.length);
  for (const resolve of pending) resolve();
  for (const listener of readyListeners) {
    try {
      listener();
    } catch (e) {
      if (__DEV__) console.warn('[widgets] ready listener error', e);
    }
  }
}

export function isHomeWidgetsDbReady(): boolean {
  return dbReady;
}

/** 非 iOS 立即放行；iOS 等到 markHomeWidgetsDbReady */
export function whenHomeWidgetsDbReady(): Promise<void> {
  if (Platform.OS !== 'ios' || dbReady) return Promise.resolve();
  return new Promise((resolve) => {
    waiters.push(resolve);
  });
}

export function subscribeHomeWidgetsDbReady(listener: ReadyListener): () => void {
  readyListeners.add(listener);
  if (dbReady) {
    try {
      listener();
    } catch {
      /* ignore */
    }
  }
  return () => {
    readyListeners.delete(listener);
  };
}
