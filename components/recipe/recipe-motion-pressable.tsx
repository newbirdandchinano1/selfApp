import { useReducedMotion } from '@/hooks/use-reduced-motion';
import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

type Props = {
  children: React.ReactNode;
  onPress?: PressableProps['onPress'];
  onLongPress?: PressableProps['onLongPress'];
  style?: StyleProp<ViewStyle>;
  /** 入场错峰 ms */
  enterDelay?: number;
  disabled?: boolean;
  accessibilityLabel?: string;
};

/**
 * 菜谱卡片：按下微缩 + 可选错峰淡入上浮。
 */
export function RecipeMotionPressable({
  children,
  onPress,
  onLongPress,
  style,
  enterDelay = 0,
  disabled,
  accessibilityLabel,
}: Props) {
  const reduceMotion = useReducedMotion();
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(reduceMotion || enterDelay <= 0 ? 1 : 0)).current;
  const translateY = useRef(new Animated.Value(reduceMotion || enterDelay <= 0 ? 0 : 14)).current;

  useEffect(() => {
    if (reduceMotion || enterDelay <= 0) {
      opacity.setValue(1);
      translateY.setValue(0);
      return;
    }
    opacity.setValue(0);
    translateY.setValue(14);
    const t = setTimeout(() => {
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 320,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(translateY, {
          toValue: 0,
          duration: 360,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start();
    }, enterDelay);
    return () => clearTimeout(t);
  }, [enterDelay, opacity, reduceMotion, translateY]);

  const onPressIn = () => {
    if (reduceMotion) return;
    Animated.spring(scale, {
      toValue: 0.96,
      friction: 7,
      tension: 220,
      useNativeDriver: true,
    }).start();
  };

  const onPressOut = () => {
    if (reduceMotion) return;
    Animated.spring(scale, {
      toValue: 1,
      friction: 6,
      tension: 180,
      useNativeDriver: true,
    }).start();
  };

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      disabled={disabled}
      accessibilityLabel={accessibilityLabel}
    >
      <Animated.View style={[style, { opacity, transform: [{ scale }, { translateY }] }]}>
        {children}
      </Animated.View>
    </Pressable>
  );
}
