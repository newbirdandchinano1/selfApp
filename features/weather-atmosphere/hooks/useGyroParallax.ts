/**
 * 陀螺仪 / DeviceMotion → 缓动视差偏移（SharedValue，单位约 -1～1）。
 * 无权限、模拟器或减弱动效时保持 0。
 */
import { useAtmosphereAnimGate } from '@/features/weather-atmosphere/hooks/useAtmosphereAnimGate';
import { useReducedMotionState } from '@/hooks/use-reduced-motion';
import { DeviceMotion } from 'expo-sensors';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import {
  useSharedValue,
  withSpring,
  type SharedValue,
} from 'react-native-reanimated';

export type GyroParallax = {
  x: SharedValue<number>;
  y: SharedValue<number>;
  active: boolean;
};

const SPRING = { damping: 18, stiffness: 90, mass: 0.7 };

export function useGyroParallax(enabled = true): GyroParallax {
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const gate = useAtmosphereAnimGate();
  const { enabled: reduceMotion, ready } = useReducedMotionState();
  const [sensorOk, setSensorOk] = useState(false);

  const want = enabled && gate && ready && !reduceMotion && Platform.OS !== 'web';

  useEffect(() => {
    if (!want) {
      setSensorOk(false);
      x.value = withSpring(0, SPRING);
      y.value = withSpring(0, SPRING);
      return;
    }

    let mounted = true;
    let sub: { remove: () => void } | null = null;

    void (async () => {
      try {
        const available = await DeviceMotion.isAvailableAsync();
        if (!mounted || !available) {
          setSensorOk(false);
          return;
        }
        if (typeof DeviceMotion.requestPermissionsAsync === 'function') {
          const perm = await DeviceMotion.requestPermissionsAsync();
          if (!mounted || perm.status !== 'granted') {
            setSensorOk(false);
            return;
          }
        }
        setSensorOk(true);
        DeviceMotion.setUpdateInterval(48);
        sub = DeviceMotion.addListener((evt) => {
          if (!mounted) return;
          const gamma = evt.rotation?.gamma ?? 0;
          const beta = evt.rotation?.beta ?? 0;
          const nx = Math.max(-1, Math.min(1, gamma / (Math.PI / 4)));
          const ny = Math.max(-1, Math.min(1, (beta - Math.PI / 4) / (Math.PI / 4)));
          x.value = withSpring(nx, SPRING);
          y.value = withSpring(ny, SPRING);
        });
      } catch {
        if (mounted) setSensorOk(false);
      }
    })();

    return () => {
      mounted = false;
      sub?.remove();
      x.value = withSpring(0, SPRING);
      y.value = withSpring(0, SPRING);
    };
  }, [want, x, y]);

  return { x, y, active: want && sensorOk };
}
