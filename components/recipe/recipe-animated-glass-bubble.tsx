import {
  BUBBLE_GLASS_H,
  BUBBLE_GLASS_R,
  BUBBLE_LIFT_EXTRA,
  BUBBLE_REST_H,
  BUBBLE_REST_R,
  type AnimatedGlassBubbleProps,
  type BubbleTheme,
} from '@/components/recipe/recipe-glass-bubble-types';
import { BlurView } from 'expo-blur';
import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import Animated, {
  interpolate,
  interpolateColor,
  useAnimatedStyle,
} from 'react-native-reanimated';

export type { BubbleTheme, AnimatedGlassBubbleProps };
export {
  BUBBLE_LIFT_EXTRA,
  BUBBLE_REST_H,
  BUBBLE_GLASS_H,
  BUBBLE_REST_R,
  BUBBLE_GLASS_R,
};

const AnimatedBlurView = Animated.createAnimatedComponent(BlurView);

/**
 * 共享动态选中指示器：凸起液态玻璃气泡（无彩虹色散）。
 * Reanimated 驱动几何 + 分层 Blur/高光模拟玻璃，非真实光学折射。
 */
export function AnimatedGlassBubble({
  barHeight,
  bubbleX,
  bubbleW,
  targetX,
  glassProgress,
  opacity,
  theme,
}: AnimatedGlassBubbleProps) {
  // —— GlassBody：位置、真实宽度拉伸、抬升高度 ——
  const bodyStyle = useAnimatedStyle(() => {
    const dist = Math.abs(targetX.value - bubbleX.value);
    // 行程拉伸：直接改 width，禁止 scaleX 冒充液态
    const stretch = Math.min(dist * 0.16, 18) * glassProgress.value;
    const w = Math.max(bubbleW.value + stretch, 40);
    const x = bubbleX.value - stretch / 2;
    const h = interpolate(glassProgress.value, [0, 1], [BUBBLE_REST_H, BUBBLE_GLASS_H]);
    const restY = (barHeight - BUBBLE_REST_H) / 2;
    const glassY = (barHeight - BUBBLE_GLASS_H) / 2 - 6;
    const y = interpolate(glassProgress.value, [0, 1], [restY, glassY]);
    const r = interpolate(glassProgress.value, [0, 1], [BUBBLE_REST_R, BUBBLE_GLASS_R]);
    const g = glassProgress.value;

    return {
      opacity: opacity.value,
      width: w,
      height: h,
      borderRadius: r,
      transform: [{ translateX: x }, { translateY: y }],
      backgroundColor: interpolateColor(g, [0, 1], [theme.settleFill, 'transparent']),
      borderColor: interpolateColor(g, [0, 1], [theme.settleBorder, 'rgba(255,255,255,0.78)']),
      // 凸起阴影：仅玻璃态明显
      shadowColor: theme.isDark ? '#000' : '#1c2430',
      shadowOpacity: 0.08 + g * 0.18,
      shadowRadius: 4 + g * 10,
      shadowOffset: { width: 0, height: 2 + g * 4 },
      elevation: g > 0.15 ? 8 : 2,
    };
  });

  // 玻璃模糊层：运动时显现，静止收敛后隐藏
  const glassLayerStyle = useAnimatedStyle(() => ({
    opacity: glassProgress.value,
    borderRadius: interpolate(glassProgress.value, [0, 1], [BUBBLE_REST_R, BUBBLE_GLASS_R]),
  }));

  const glassTintStyle = useAnimatedStyle(() => ({
    opacity: 0.55 + glassProgress.value * 0.25,
    backgroundColor: theme.glassFill,
  }));

  // EdgeHighlight：顶缘立体高光（无彩色）
  const highlightStyle = useAnimatedStyle(() => ({
    opacity: 0.2 + glassProgress.value * 0.55,
    backgroundColor: theme.highlight,
  }));

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.wrap]}>
      <Animated.View style={[styles.bubble, { borderWidth: StyleSheet.hairlineWidth * 2 }, bodyStyle]}>
        {/* 玻璃主体：独立 Blur（区别于底栏整栏 blur） */}
        <Animated.View style={[StyleSheet.absoluteFill, styles.clip, glassLayerStyle]}>
          {Platform.OS === 'web' ? (
            <View
              style={[
                StyleSheet.absoluteFill,
                {
                  backgroundColor: theme.glassFill,
                  ...({ backdropFilter: 'blur(16px) saturate(1.35)' } as object),
                },
              ]}
            />
          ) : (
            <AnimatedBlurView
              intensity={theme.isDark ? 36 : 28}
              tint={theme.isDark ? 'systemThinMaterialDark' : 'systemThinMaterialLight'}
              blurMethod={Platform.OS === 'android' ? 'dimezisBlurView' : undefined}
              style={StyleSheet.absoluteFill}
            />
          )}
          <Animated.View style={[StyleSheet.absoluteFill, glassTintStyle]} />
          <Animated.View style={[styles.highlight, highlightStyle]} />
          <View
            style={[
              styles.bevel,
              { backgroundColor: theme.isDark ? 'rgba(0,0,0,0.25)' : 'rgba(0,0,0,0.06)' },
            ]}
          />
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    zIndex: 0,
    overflow: 'visible',
  },
  bubble: {
    position: 'absolute',
    left: 0,
    top: 0,
    overflow: 'hidden',
  },
  clip: {
    overflow: 'hidden',
  },
  highlight: {
    position: 'absolute',
    top: 2,
    left: 7,
    right: 7,
    height: '36%',
    borderRadius: 999,
  },
  bevel: {
    position: 'absolute',
    bottom: 1,
    left: 10,
    right: 10,
    height: StyleSheet.hairlineWidth,
    borderRadius: 999,
    opacity: 0.7,
  },
});
