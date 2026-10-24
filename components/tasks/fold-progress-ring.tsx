/**
 * 项目进度环 — 对齐设计稿 `.pcring`；进度只从旧值补间，不重播入场。
 */
import {
  FOLD_MOTION_EASE,
  useFoldMotionGate,
} from '@/components/review/fold-motion';
import { TaskFoldMotion, useTaskFoldTheme } from '@/constants/task-fold-theme';
import React from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export function FoldProgressRing({
  ratio,
  size = 25,
  strokeWidth = 2.4,
  color,
  trackColor,
}: {
  ratio: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
  trackColor?: string;
}) {
  const { tf, fonts } = useTaskFoldTheme();
  const { animate } = useFoldMotionGate();
  const r = (size - strokeWidth) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(1, ratio));
  const progress = React.useRef(new Animated.Value(p)).current;
  const drawnOnce = React.useRef(false);

  React.useEffect(() => {
    if (!animate) {
      progress.setValue(p);
      drawnOnce.current = true;
      return;
    }
    const first = !drawnOnce.current;
    if (first) {
      drawnOnce.current = true;
      progress.setValue(0);
    }
    const anim = Animated.timing(progress, {
      toValue: p,
      duration: first ? TaskFoldMotion.treeExpand : TaskFoldMotion.progressTween,
      delay: first ? 40 : 0,
      easing: FOLD_MOTION_EASE,
      useNativeDriver: false,
    });
    anim.start();
    return () => anim.stop();
  }, [animate, p, progress]);

  const pct = Math.round(p * 100);
  const stroke = color ?? tf.frog;
  const track = trackColor ?? (tf.line2 || '#E7E2D5');

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={track}
          strokeWidth={strokeWidth}
          fill="none"
        />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={stroke}
          strokeWidth={strokeWidth}
          fill="none"
          strokeDasharray={`${c}`}
          strokeDashoffset={progress.interpolate({
            inputRange: [0, 1],
            outputRange: [c, 0],
          })}
          strokeLinecap="round"
        />
      </Svg>
      <Text style={[styles.pct, { color: tf.ink2, fontFamily: fonts.mono, fontSize: size * 0.23 }]}>
        {pct}%
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pct: { fontWeight: '700' },
});
