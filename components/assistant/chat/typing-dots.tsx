/**
 * ChatGPT 风格三点呼吸 Typing Indicator。
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { useReducedMotionState } from '@/hooks/use-reduced-motion';

type Props = {
  color: string;
  size?: number;
};

function Dot({
  color,
  size,
  delayMs,
  reduceMotion,
}: {
  color: string;
  size: number;
  delayMs: number;
  reduceMotion: boolean;
}) {
  const t = useSharedValue(0);

  React.useEffect(() => {
    if (reduceMotion) {
      cancelAnimation(t);
      t.value = 0.5;
      return;
    }
    t.value = 0;
    t.value = withDelay(
      delayMs,
      withRepeat(
        withSequence(
          withTiming(1, { duration: 420, easing: Easing.inOut(Easing.sin) }),
          withTiming(0, { duration: 420, easing: Easing.inOut(Easing.sin) }),
        ),
        -1,
        false,
      ),
    );
    return () => cancelAnimation(t);
  }, [delayMs, reduceMotion, t]);

  const style = useAnimatedStyle(() => ({
    opacity: interpolate(t.value, [0, 1], [0.28, 1]),
    transform: [{ translateY: interpolate(t.value, [0, 1], [0, -2.5]) }],
  }));

  return (
    <Animated.View
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color,
        },
        style,
      ]}
    />
  );
}

export function TypingDots({ color, size = 7 }: Props) {
  const { enabled: reduceMotion, ready } = useReducedMotionState();
  const motionOff = !ready || reduceMotion;

  return (
    <View style={styles.row} accessibilityElementsHidden>
      <Dot color={color} size={size} delayMs={0} reduceMotion={motionOff} />
      <Dot color={color} size={size} delayMs={140} reduceMotion={motionOff} />
      <Dot color={color} size={size} delayMs={280} reduceMotion={motionOff} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 18,
  },
});
