/**
 * 氛围动画总闸：确认减弱动效开启时才停；偏好未就绪时先允许播放，避免粒子一直静止。
 */
import { useReducedMotionState } from '@/hooks/use-reduced-motion';
import { useEffect, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

export function useAtmosphereAnimGate(): boolean {
  const { enabled: reduceMotion, ready: motionReady } = useReducedMotionState();
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');

  useEffect(() => {
    const onChange = (next: AppStateStatus) => {
      setAppActive(next === 'active');
    };
    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
  }, []);

  // 仅在「已就绪且开启减弱动效」时关闭；未就绪默认开启动画
  const blockedByReduceMotion = motionReady && reduceMotion;
  return appActive && !blockedByReduceMotion;
}
