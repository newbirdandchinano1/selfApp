import React, { useEffect, useRef } from 'react';
import { Animated, View, ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeContext';

interface Props {
  style?: ViewStyle;
  radius?: number;
}

/** 呼吸式骨架块 */
export function SkeletonBlock({ style, radius = 10 }: Props) {
  const { colors } = useTheme();
  const opacity = useRef(new Animated.Value(0.45)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 750,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.45,
          duration: 750,
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return (
    <Animated.View
      style={[
        { backgroundColor: colors.surface2, borderRadius: radius, opacity },
        style,
      ]}
    />
  );
}

export function FeedSkeleton() {
  const { colors } = useTheme();
  return (
    <View>
      {[0, 1].map((i) => (
        <View
          key={i}
          style={{
            backgroundColor: colors.surface,
            borderRadius: 22,
            borderWidth: 1,
            borderColor: colors.border,
            overflow: 'hidden',
            marginBottom: 16,
          }}
        >
          <SkeletonBlock style={{ height: 170 }} radius={0} />
          <View style={{ padding: 16, gap: 10 }}>
            <SkeletonBlock style={{ height: 12, width: '30%' }} />
            <SkeletonBlock style={{ height: 18, width: '88%' }} />
            <SkeletonBlock style={{ height: 12, width: '70%' }} />
            <SkeletonBlock style={{ height: 12, width: '55%' }} />
            <SkeletonBlock style={{ height: 32, marginTop: 6 }} />
          </View>
        </View>
      ))}
    </View>
  );
}

export function MomentSkeleton() {
  const { colors } = useTheme();
  return (
    <View>
      {[0, 1].map((i) => (
        <View
          key={i}
          style={{
            backgroundColor: colors.surface,
            borderRadius: 22,
            borderWidth: 1,
            borderColor: colors.border,
            padding: 16,
            marginBottom: 14,
            gap: 12,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}>
            <SkeletonBlock style={{ width: 40, height: 40 }} radius={14} />
            <View style={{ gap: 6, flex: 1 }}>
              <SkeletonBlock style={{ height: 12, width: '40%' }} />
              <SkeletonBlock style={{ height: 10, width: '25%' }} />
            </View>
          </View>
          <SkeletonBlock style={{ height: 13, width: '92%' }} />
          <SkeletonBlock style={{ height: 13, width: '75%' }} />
        </View>
      ))}
    </View>
  );
}
