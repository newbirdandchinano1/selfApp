import React from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * 跟随系统「减少动态效果 / Remove animations」。
 * 用于关掉永续装饰动画与大幅位移入场。
 */
export function useReducedMotion(): boolean {
  const [reduceMotion, setReduceMotion] = React.useState(false);

  React.useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) setReduceMotion(!!enabled);
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (enabled) => {
      setReduceMotion(!!enabled);
    });
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  return reduceMotion;
}
