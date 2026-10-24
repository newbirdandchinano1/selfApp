import { loadTasksPreferReduceMotion } from '@/lib/tasks-ui-settings';
import React from 'react';
import { AccessibilityInfo, AppState } from 'react-native';

export type ReducedMotionState = {
  /** 系统「减少动态效果」或应用内「减弱动效」任一开启。偏好未就绪时为 false，不能单独当作可以开启动画。 */
  enabled: boolean;
  /** 首次系统偏好 + 应用偏好读取已结束（成功或失败都算就绪）。 */
  ready: boolean;
};

let appPreferReduceMotion = false;
const appPreferListeners = new Set<() => void>();

/** 设置页写入后立刻通知本 hook 的订阅者 */
export function notifyTasksPreferReduceMotionChanged(enabled: boolean): void {
  appPreferReduceMotion = enabled;
  appPreferListeners.forEach((l) => l());
}

/**
 * 跟随系统「减少动态效果 / Remove animations」以及任务设置中的「减弱动效」。
 * `ready === false` 时调用方不得启动循环或大幅位移；读完后再按 `enabled` 决定。
 */
export function useReducedMotionState(): ReducedMotionState {
  const [systemEnabled, setSystemEnabled] = React.useState(false);
  const [appEnabled, setAppEnabled] = React.useState(appPreferReduceMotion);
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    let mounted = true;
    void Promise.all([
      AccessibilityInfo.isReduceMotionEnabled().catch(() => false),
      loadTasksPreferReduceMotion().catch(() => false),
    ]).then(([sys, app]) => {
      if (!mounted) return;
      appPreferReduceMotion = !!app;
      setSystemEnabled(!!sys);
      setAppEnabled(!!app);
      setReady(true);
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (enabled) => {
      setSystemEnabled(!!enabled);
      setReady(true);
    });
    const onAppPrefer = () => setAppEnabled(appPreferReduceMotion);
    appPreferListeners.add(onAppPrefer);
    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      void loadTasksPreferReduceMotion()
        .then((v) => {
          appPreferReduceMotion = !!v;
          setAppEnabled(!!v);
        })
        .catch(() => {});
    });
    return () => {
      mounted = false;
      sub.remove();
      appPreferListeners.delete(onAppPrefer);
      appStateSub.remove();
    };
  }, []);

  return { enabled: systemEnabled || appEnabled, ready };
}

/**
 * 兼容旧调用：只返回减少动态是否开启。
 * 永续循环和入场位移请改用 `useReducedMotionState`，在 `ready` 之前不要启动。
 */
export function useReducedMotion(): boolean {
  return useReducedMotionState().enabled;
}
