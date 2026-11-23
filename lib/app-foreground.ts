/**
 * App 前台状态：供通知分流（前台软提示 / 后台系统通知）共用。
 */

import { AppState, type AppStateStatus } from 'react-native';

let cached: AppStateStatus = AppState.currentState;
let subscribed = false;

function ensureSubscription(): void {
  if (subscribed) return;
  subscribed = true;
  AppState.addEventListener('change', next => {
    cached = next;
  });
}

/** 当前是否前台 active（含短暂 inactive 过渡时仍视为前台由调用方决定）。 */
export function isAppInForeground(): boolean {
  ensureSubscription();
  const state = AppState.currentState;
  cached = state;
  return state === 'active';
}

/** 最近一次缓存的 AppState（不强制读 native）。 */
export function getCachedAppState(): AppStateStatus {
  ensureSubscription();
  return cached;
}
