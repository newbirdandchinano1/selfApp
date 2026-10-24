/**
 * 折页 · 财务开关：对齐设计稿「定时支出开关」260ms 弹簧拇指。
 */
import { FOLD_MOTION_SPRING } from '@/components/review/fold-motion';
import { useFinanceFoldTheme } from '@/constants/finance-fold-theme';
import React from 'react';
import { Animated, Pressable, StyleSheet } from 'react-native';

export function FinanceFoldSwitch({
  value,
  onValueChange,
  disabled,
  accessibilityLabel,
}: {
  value: boolean;
  onValueChange: (next: boolean) => void;
  disabled?: boolean;
  accessibilityLabel?: string;
}) {
  const { ff, isDark } = useFinanceFoldTheme();
  const progress = React.useRef(new Animated.Value(value ? 1 : 0)).current;

  React.useEffect(() => {
    Animated.timing(progress, {
      toValue: value ? 1 : 0,
      duration: 260,
      easing: FOLD_MOTION_SPRING,
      useNativeDriver: false,
    }).start();
  }, [progress, value]);

  const trackOff = isDark ? 'rgba(235,219,189,0.18)' : '#E5E0D4';
  const trackOn = ff.pine;
  const backgroundColor = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [trackOff, trackOn],
  });
  const translateX = progress.interpolate({ inputRange: [0, 1], outputRange: [2, 22] });

  return (
    <Pressable
      onPress={() => onValueChange(!value)}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled: !!disabled }}
      accessibilityLabel={accessibilityLabel}
      hitSlop={8}
      style={({ pressed }) => [{ opacity: disabled ? 0.45 : pressed ? 0.86 : 1 }]}>
      <Animated.View style={[styles.track, { backgroundColor }]}>
        <Animated.View style={[styles.thumb, { transform: [{ translateX }] }]} />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: {
    width: 46,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
  },
  thumb: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.18,
    shadowRadius: 2,
    elevation: 2,
  },
});
