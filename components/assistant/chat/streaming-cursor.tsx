import React from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { useReducedMotionState } from '@/hooks/use-reduced-motion';

export function StreamingCursor({ color }: { color: string }) {
  const { enabled: reduceMotion, ready } = useReducedMotionState();
  const opacity = useSharedValue(1);
  const motionOff = !ready || reduceMotion;

  React.useEffect(() => {
    if (motionOff) {
      cancelAnimation(opacity);
      opacity.value = 1;
      return;
    }
    opacity.value = withRepeat(
      withSequence(
        withTiming(0.15, { duration: 480, easing: Easing.inOut(Easing.quad) }),
        withTiming(1, { duration: 480, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      false,
    );
    return () => cancelAnimation(opacity);
  }, [motionOff, opacity]);

  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.Text style={[styles.cursor, { color }, style]} accessibilityElementsHidden>
      ▍
    </Animated.Text>
  );
}

const styles = StyleSheet.create({
  cursor: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '400',
  },
});
