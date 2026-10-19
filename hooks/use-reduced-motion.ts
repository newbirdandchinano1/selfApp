import React from 'react';
import { AccessibilityInfo } from 'react-native';

export type ReducedMotionState = {
  /** 系统「减少动态效果」是否开启。偏好未就绪时为 false，不能单独当作可以开启动画。 */
  enabled: boolean;
  /** 首次系统偏好读取已结束（成功或失败都算就绪）。 */
  ready: boolean;
};

/**
 * 跟随系统「减少动态效果 / Remove animations」。
 * `ready === false` 时调用方不得启动循环或大幅位移；读完后再按 `enabled` 决定。
 * 监听只注册一次，设置变化时更新同一份状态，避免重复订阅导致双循环。
 */
export function useReducedMotionState(): ReducedMotionState {
  const [state, setState] = React.useState<ReducedMotionState>({ enabled: false, ready: false });

  React.useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (mounted) setState({ enabled: !!enabled, ready: true });
      })
      .catch(() => {
        if (mounted) setState({ enabled: false, ready: true });
      });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (enabled) => {
      setState({ enabled: !!enabled, ready: true });
    });
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  return state;
}

/**
 * 兼容旧调用：只返回减少动态是否开启。
 * 永续循环和入场位移请改用 `useReducedMotionState`，在 `ready` 之前不要启动。
 */
export function useReducedMotion(): boolean {
  return useReducedMotionState().enabled;
}
