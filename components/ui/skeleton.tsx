import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useAppTheme } from '@/hooks/use-app-theme';

export type SkeletonProps = {
  width?: number | `${number}%`;
  height?: number;
  borderRadius?: number;
  style?: StyleProp<ViewStyle>;
};

/** 带脉冲动画的占位块，用于骨架屏 */
export function Skeleton({ width = '100%', height = 14, borderRadius = 8, style }: SkeletonProps) {
  const { isDark } = useAppTheme();
  const pulse = useRef(new Animated.Value(0)).current;
  const baseColor = isDark ? 'rgba(148,163,184,0.16)' : 'rgba(148,163,184,0.24)';
  const highlightColor = isDark ? 'rgba(148,163,184,0.32)' : 'rgba(148,163,184,0.42)';

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 850,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 850,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const overlayOpacity = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.35, 0.85],
  });

  return (
    <View
      style={[
        {
          width,
          height,
          borderRadius,
          overflow: 'hidden',
          backgroundColor: baseColor,
        },
        style,
      ]}
    >
      <Animated.View
        style={[StyleSheet.absoluteFillObject, { backgroundColor: highlightColor, opacity: overlayOpacity }]}
      />
    </View>
  );
}
