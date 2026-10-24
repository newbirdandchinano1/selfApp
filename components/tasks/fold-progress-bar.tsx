/**
 * 项目进度条 — 对齐设计稿 `.pcprog`；仅从旧宽度补间。
 */
import {
  FOLD_MOTION_EASE,
  useFoldMotionGate,
} from '@/components/review/fold-motion';
import { TaskFoldMotion, useTaskFoldTheme } from '@/constants/task-fold-theme';
import React from 'react';
import { Animated, StyleSheet, View } from 'react-native';

export function FoldProgressBar({
  ratio,
  height = 3,
  colorFrom,
  colorTo,
}: {
  ratio: number;
  height?: number;
  colorFrom?: string;
  colorTo?: string;
}) {
  const { tf } = useTaskFoldTheme();
  const { animate } = useFoldMotionGate();
  const p = Math.max(0, Math.min(1, ratio));
  const width = React.useRef(new Animated.Value(p)).current;
  const drawnOnce = React.useRef(false);

  React.useEffect(() => {
    if (!animate) {
      width.setValue(p);
      drawnOnce.current = true;
      return;
    }
    const first = !drawnOnce.current;
    if (first) {
      drawnOnce.current = true;
      width.setValue(0);
    }
    const anim = Animated.timing(width, {
      toValue: p,
      duration: first ? TaskFoldMotion.treeExpand : TaskFoldMotion.progressTween,
      easing: FOLD_MOTION_EASE,
      useNativeDriver: false,
    });
    anim.start();
    return () => anim.stop();
  }, [animate, p, width]);

  const from = colorFrom ?? '#A9C184';
  const to = colorTo ?? tf.frog;

  return (
    <View style={[styles.track, { height, backgroundColor: tf.track }]}>
      <Animated.View
        style={[
          styles.fill,
          {
            height,
            backgroundColor: to,
            // 渐变近似：用终点色；RN 无纯 CSS 渐变时保持简洁
            width: width.interpolate({
              inputRange: [0, 1],
              outputRange: ['0%', '100%'],
            }),
            // 用 from 作轻微叠色感
            borderColor: from,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    borderRadius: 3,
    overflow: 'hidden',
    alignSelf: 'stretch',
  },
  fill: {
    borderRadius: 3,
  },
});
