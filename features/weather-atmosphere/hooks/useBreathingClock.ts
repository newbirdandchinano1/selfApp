/**
 * 氛围帧时钟（秒），与 Skia Canvas 同拍。
 */
import { useAtmosphereAnimGate } from '@/features/weather-atmosphere/hooks/useAtmosphereAnimGate';
import { useClock } from '@shopify/react-native-skia';
import { useEffect } from 'react';
import {
  useDerivedValue,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';

export function useBreathingClock(): SharedValue<number> {
  const animate = useAtmosphereAnimGate();
  const skiaMs = useClock();
  const animateSV = useSharedValue(animate ? 1 : 0);
  const frozenSec = useSharedValue(0);

  useEffect(() => {
    animateSV.value = animate ? 1 : 0;
  }, [animate, animateSV]);

  return useDerivedValue(() => {
    if (animateSV.value < 0.5) {
      return frozenSec.value;
    }
    const sec = skiaMs.value / 1000;
    frozenSec.value = sec;
    return sec;
  });
}
