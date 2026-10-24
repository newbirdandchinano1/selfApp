/**
 * 任务折页开关 — 对齐设计稿 `.switch`：260ms 弹簧拇指；拒绝开启时可回弹。
 */
import { FOLD_MOTION_SPRING } from '@/components/review/fold-motion';
import { useTaskFoldTheme } from '@/constants/task-fold-theme';
import React from 'react';
import { Animated, Pressable, StyleSheet } from 'react-native';

export function TaskFoldSwitch({
  value,
  onValueChange,
  disabled,
  accessibilityLabel,
  /** 变为 true 时播放一次回弹（如自动入格前置条件不满足） */
  bounceToken = 0,
}: {
  value: boolean;
  onValueChange: (next: boolean) => void;
  disabled?: boolean;
  accessibilityLabel?: string;
  bounceToken?: number;
}) {
  const { tf, isDark } = useTaskFoldTheme();
  const progress = React.useRef(new Animated.Value(value ? 1 : 0)).current;
  const bounce = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    Animated.timing(progress, {
      toValue: value ? 1 : 0,
      duration: 260,
      easing: FOLD_MOTION_SPRING,
      useNativeDriver: false,
    }).start();
  }, [progress, value]);

  React.useEffect(() => {
    if (!bounceToken) return;
    bounce.setValue(0);
    Animated.sequence([
      Animated.timing(bounce, {
        toValue: 1,
        duration: 90,
        useNativeDriver: true,
      }),
      Animated.timing(bounce, {
        toValue: -1,
        duration: 100,
        easing: FOLD_MOTION_SPRING,
        useNativeDriver: true,
      }),
      Animated.timing(bounce, {
        toValue: 0,
        duration: 140,
        easing: FOLD_MOTION_SPRING,
        useNativeDriver: true,
      }),
    ]).start();
  }, [bounce, bounceToken]);

  const trackOff = isDark ? 'rgba(235,219,189,0.18)' : '#DDD8CC';
  const trackOn = tf.frog;
  const backgroundColor = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [trackOff, trackOn],
  });
  const translateX = progress.interpolate({ inputRange: [0, 1], outputRange: [2, 15] });
  const bounceX = bounce.interpolate({
    inputRange: [-1, 0, 1],
    outputRange: [-3, 0, 4],
  });

  return (
    <Pressable
      onPress={() => onValueChange(!value)}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled: !!disabled }}
      accessibilityLabel={accessibilityLabel}
      hitSlop={8}
      style={({ pressed }) => [{ opacity: disabled ? 0.42 : pressed ? 0.86 : 1 }]}>
      <Animated.View style={[styles.track, { backgroundColor, transform: [{ translateX: bounceX }] }]}>
        <Animated.View style={[styles.thumb, { transform: [{ translateX }] }]} />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: {
    width: 30,
    height: 17,
    borderRadius: 10,
    justifyContent: 'center',
  },
  thumb: {
    width: 13,
    height: 13,
    borderRadius: 7,
    backgroundColor: '#FFFDF8',
    shadowColor: '#282D24',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.18,
    shadowRadius: 2,
    elevation: 2,
  },
});
