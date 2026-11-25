import React, { ReactNode, useRef } from 'react';
import {
  Animated,
  Pressable,
  StyleProp,
  ViewStyle,
} from 'react-native';
import * as Haptics from 'expo-haptics';

interface Props {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  haptic?: boolean;
  hitSlop?: number;
  accessibilityLabel?: string;
}

/** 按压缩放微交互（配合 iOS 触觉反馈） */
export function PressableScale({
  children,
  style,
  onPress,
  onLongPress,
  disabled,
  haptic = false,
  hitSlop,
  accessibilityLabel,
}: Props) {
  const scale = useRef(new Animated.Value(1)).current;

  const pressIn = () => {
    if (haptic) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
    Animated.spring(scale, {
      toValue: 0.96,
      useNativeDriver: true,
      speed: 40,
      bounciness: 0,
    }).start();
  };

  const pressOut = () => {
    Animated.spring(scale, {
      toValue: 1,
      useNativeDriver: true,
      speed: 22,
      bounciness: 8,
    }).start();
  };

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      onPressIn={pressIn}
      onPressOut={pressOut}
      disabled={disabled}
      hitSlop={hitSlop}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      <Animated.View style={[style, { transform: [{ scale }] }]}>
        {children}
      </Animated.View>
    </Pressable>
  );
}
