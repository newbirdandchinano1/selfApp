import React from 'react';
import {
  Animated,
  Pressable,
  type GestureResponderEvent,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { Motion } from '@/constants/design-tokens';
import { useReducedMotionState } from '@/hooks/use-reduced-motion';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export type MotionPressableProps = Omit<PressableProps, 'style'> & {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** 按下目标缩放；传 `1` 关闭缩放 */
  pressScale?: number;
  /** 按下目标透明度；传 `1` 关闭透明度反馈 */
  pressOpacity?: number;
};

/**
 * 基础按压反馈：按下 timing、抬起 spring；组合而非覆盖调用方手势回调。
 * 不自动触发 haptic。减少动态时只做瞬时透明度，不做 scale。
 */
export function MotionPressable({
  children,
  style,
  disabled,
  pressScale = Motion.pressScaleButton,
  pressOpacity = Motion.pressOpacityButton,
  onPressIn,
  onPressOut,
  onPress,
  onLongPress,
  ...rest
}: MotionPressableProps) {
  const { enabled: reduceMotion, ready: motionReady } = useReducedMotionState();
  /** 偏好未就绪时按「减少动态」处理：第一下按压不缩放，也不先播再停 */
  const motionReduced = reduceMotion || !motionReady;
  // Animated.Value 是可变句柄，放 state 只为避开渲染期读 ref（React Compiler）
  const [scale] = React.useState(() => new Animated.Value(1));
  const [opacity] = React.useState(() => new Animated.Value(1));

  const stopAll = React.useCallback(() => {
    scale.stopAnimation();
    opacity.stopAnimation();
  }, [opacity, scale]);

  const resetToRest = React.useCallback(
    (animated: boolean) => {
      stopAll();
      if (!animated || motionReduced) {
        scale.setValue(1);
        opacity.setValue(1);
        return;
      }
      Animated.parallel([
        Animated.spring(scale, {
          toValue: 1,
          speed: Motion.pressOutSpring.speed,
          bounciness: Motion.pressOutSpring.bounciness,
          useNativeDriver: true,
        }),
        Animated.spring(opacity, {
          toValue: 1,
          speed: Motion.pressOutSpring.speed,
          bounciness: Motion.pressOutSpring.bounciness,
          useNativeDriver: true,
        }),
      ]).start();
    },
    [motionReduced, opacity, scale, stopAll],
  );

  React.useEffect(() => {
    if (disabled) {
      resetToRest(false);
    }
  }, [disabled, resetToRest]);

  React.useEffect(() => {
    return () => {
      stopAll();
    };
  }, [stopAll]);

  const handlePressIn = (event: GestureResponderEvent) => {
    if (!disabled) {
      stopAll();
      const targetScale = motionReduced ? 1 : pressScale;
      const targetOpacity = pressOpacity;
      if (motionReduced) {
        scale.setValue(1);
        opacity.setValue(targetOpacity);
      } else {
        Animated.parallel([
          Animated.timing(scale, {
            toValue: targetScale,
            duration: Motion.pressInMs,
            useNativeDriver: true,
          }),
          Animated.timing(opacity, {
            toValue: targetOpacity,
            duration: Motion.pressInMs,
            useNativeDriver: true,
          }),
        ]).start();
      }
    }
    onPressIn?.(event);
  };

  const handlePressOut = (event: GestureResponderEvent) => {
    if (!disabled) {
      resetToRest(true);
    }
    onPressOut?.(event);
  };

  return (
    <AnimatedPressable
      disabled={disabled}
      onPress={onPress}
      onLongPress={onLongPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={[style, { opacity, transform: [{ scale }] }]}
      {...rest}>
      {children}
    </AnimatedPressable>
  );
}
