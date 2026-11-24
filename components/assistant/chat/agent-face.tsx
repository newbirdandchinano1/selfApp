/**
 * Agent Space 角色头像 — 完整复刻 preview：有机 halo、双轨道、core、眨眼与星芒。
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { useAppTheme } from '@/hooks/use-app-theme';
import { useReducedMotionState } from '@/hooks/use-reduced-motion';

type Props = {
  /** 外框边长；设计稿桌面 174、窄屏 138/94。手机主态默认 132 */
  size?: number;
};

export function AgentFace({ size = 132 }: Props) {
  const { colors, isDark } = useAppTheme();
  const { enabled: reduceMotion, ready } = useReducedMotionState();
  const motionOff = !ready || reduceMotion;

  const driftT = useSharedValue(0);
  const floatT = useSharedValue(0);
  const spinT = useSharedValue(0);
  const spinRevT = useSharedValue(0);
  const blinkT = useSharedValue(1);
  const pulseT = useSharedValue(0);
  const twinkleT = useSharedValue(0);

  React.useEffect(() => {
    if (motionOff) {
      cancelAnimation(driftT);
      cancelAnimation(floatT);
      cancelAnimation(spinT);
      cancelAnimation(spinRevT);
      cancelAnimation(blinkT);
      cancelAnimation(pulseT);
      cancelAnimation(twinkleT);
      driftT.value = 0.5;
      floatT.value = 0;
      spinT.value = 0;
      spinRevT.value = 0;
      blinkT.value = 1;
      pulseT.value = 0.5;
      twinkleT.value = 0.5;
      return;
    }

    // halo drift 7s
    driftT.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 3500, easing: Easing.inOut(Easing.sin) }),
        withTiming(0, { duration: 3500, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
      false,
    );
    // core float 4.5s
    floatT.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 2250, easing: Easing.inOut(Easing.sin) }),
        withTiming(0, { duration: 2250, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
      false,
    );
    spinT.value = withRepeat(withTiming(1, { duration: 18000, easing: Easing.linear }), -1, false);
    spinRevT.value = withRepeat(
      withTiming(1, { duration: 25000, easing: Easing.linear }),
      -1,
      false,
    );
    pulseT.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1250, easing: Easing.inOut(Easing.sin) }),
        withTiming(0, { duration: 1250, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
      false,
    );
    twinkleT.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.sin) }),
        withTiming(0, { duration: 1100, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
      false,
    );
    // blink ~5s cycle
    blinkT.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 2250 }),
        withTiming(0.12, { duration: 70 }),
        withTiming(1, { duration: 90 }),
        withTiming(1, { duration: 2590 }),
      ),
      -1,
      false,
    );

    return () => {
      cancelAnimation(driftT);
      cancelAnimation(floatT);
      cancelAnimation(spinT);
      cancelAnimation(spinRevT);
      cancelAnimation(blinkT);
      cancelAnimation(pulseT);
      cancelAnimation(twinkleT);
    };
  }, [blinkT, driftT, floatT, motionOff, pulseT, spinRevT, spinT, twinkleT]);

  // 设计比例：face 174 → core 122 → ring 74；eye 12×17 gap 21
  const s = size / 174;
  const coreSize = 122 * s;
  const ringSize = 74 * s;
  const eyeW = 12 * s;
  const eyeH = 17 * s;
  const eyeGap = 21 * s;
  const orbitInset = 14 * s;
  const outerPad = -8 * s;

  const haloStyle = useAnimatedStyle(() => ({
    transform: [
      { rotate: `${interpolate(driftT.value, [0, 1], [-5, 5])}deg` },
      { scale: interpolate(driftT.value, [0, 1], [0.98, 1.03]) },
    ],
  }));

  const spinStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${spinT.value * 360}deg` }],
  }));

  const spinRevStyle = useAnimatedStyle(() => ({
    opacity: 0.45,
    transform: [{ rotate: `${-spinRevT.value * 360}deg` }],
  }));

  const coreStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: interpolate(floatT.value, [0, 1], [0, -8 * s]) },
      { rotate: `${interpolate(floatT.value, [0, 1], [-2, 2])}deg` },
    ],
  }));

  const ringStyle = useAnimatedStyle(() => ({
    opacity: interpolate(pulseT.value, [0, 1], [0.4, 1]),
    transform: [{ scale: interpolate(pulseT.value, [0, 1], [0.85, 1.08]) }],
  }));

  const eyeStyle = useAnimatedStyle(() => ({
    transform: [{ scaleY: blinkT.value }],
  }));

  const sparkA = useAnimatedStyle(() => ({
    opacity: interpolate(twinkleT.value, [0, 1], [0.35, 1]),
    transform: [{ scale: interpolate(twinkleT.value, [0, 1], [0.8, 1.2]) }],
  }));

  const sparkB = useAnimatedStyle(() => ({
    opacity: interpolate(twinkleT.value, [0, 1], [1, 0.35]),
    transform: [{ scale: interpolate(twinkleT.value, [0, 1], [1.15, 0.85]) }],
  }));

  const pine = colors.primary;
  const gold = colors.tertiary;
  const eyeColor = isDark ? '#dce9dd' : '#dce9dd';

  return (
    <View style={[styles.wrap, { width: size, height: size }]} accessibilityElementsHidden>
      {/* 有机光晕框 */}
      <Animated.View
        style={[
          styles.halo,
          {
            borderColor: 'rgba(95,138,110,0.36)',
            borderTopLeftRadius: size * 0.48,
            borderTopRightRadius: size * 0.52,
            borderBottomRightRadius: size * 0.43,
            borderBottomLeftRadius: size * 0.57,
          },
          haloStyle,
        ]}
      />

      {/* 内轨道（实线，顺时针） */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.orbit,
          {
            top: orbitInset,
            right: orbitInset,
            bottom: orbitInset,
            left: orbitInset,
            borderColor: 'rgba(224,179,90,0.4)',
            borderStyle: 'solid',
          },
          spinStyle,
        ]}
      />

      {/* 外轨道（虚线，逆时针） */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.orbit,
          {
            top: outerPad,
            right: outerPad,
            bottom: outerPad,
            left: outerPad,
            borderColor: 'rgba(224,179,90,0.4)',
            borderStyle: 'dashed',
            borderWidth: StyleSheet.hairlineWidth + 0.5,
          },
          spinRevStyle,
        ]}
      />

      <Animated.View
        style={[
          styles.core,
          {
            width: coreSize,
            height: coreSize,
            // 44% 56% 52% 48%
            borderTopLeftRadius: coreSize * 0.44,
            borderTopRightRadius: coreSize * 0.56,
            borderBottomRightRadius: coreSize * 0.52,
            borderBottomLeftRadius: coreSize * 0.48,
            backgroundColor: pine,
            shadowColor: pine,
            borderWidth: 7 * s,
            borderColor: 'rgba(255,255,255,0.05)',
          },
          coreStyle,
        ]}>
        <Animated.View
          style={[
            styles.innerRing,
            {
              width: ringSize,
              height: ringSize,
              borderRadius: ringSize / 2,
              borderColor: 'rgba(169,199,185,0.44)',
            },
            ringStyle,
          ]}
        />
        <View style={[styles.eyes, { gap: eyeGap, marginTop: -3 * s }]}>
          <Animated.View
            style={[
              styles.eye,
              {
                width: eyeW,
                height: eyeH,
                borderRadius: eyeW,
                backgroundColor: eyeColor,
                shadowColor: eyeColor,
              },
              eyeStyle,
            ]}
          />
          <Animated.View
            style={[
              styles.eye,
              {
                width: eyeW,
                height: eyeH,
                borderRadius: eyeW,
                backgroundColor: eyeColor,
                shadowColor: eyeColor,
              },
              eyeStyle,
            ]}
          />
        </View>
        <Animated.Text
          style={[
            styles.spark,
            {
              top: 15 * s,
              right: 10 * s,
              fontSize: 16 * s,
              color: gold,
            },
            sparkA,
          ]}>
          ✦
        </Animated.Text>
        <Animated.Text
          style={[
            styles.spark,
            {
              bottom: 22 * s,
              left: 4 * s,
              fontSize: 16 * s,
              color: gold,
            },
            sparkB,
          ]}>
          ·
        </Animated.Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  halo: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: 1,
  },
  orbit: {
    position: 'absolute',
    borderWidth: 1,
    borderRadius: 999,
  },
  core: {
    alignItems: 'center',
    justifyContent: 'center',
    shadowOpacity: 0.2,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 12 },
    elevation: 6,
  },
  innerRing: {
    position: 'absolute',
    borderWidth: 1,
  },
  eyes: {
    flexDirection: 'row',
    zIndex: 1,
  },
  eye: {
    shadowOpacity: 0.7,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  spark: {
    position: 'absolute',
    fontWeight: '700',
    zIndex: 2,
  },
});
