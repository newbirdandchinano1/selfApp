import { useReducedMotionState } from '@/hooks/use-reduced-motion';
import React from 'react';
import {
  Animated,
  Easing,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

/** 对齐 `健康-动效规范` / 设计稿 `--ease` / `--spring` */
export const HEALTH_MOTION_EASE = Easing.bezier(0.22, 1, 0.36, 1);
export const HEALTH_MOTION_SPRING = Easing.bezier(0.34, 1.56, 0.64, 1);

export function useHealthMotionGate(): {
  /** 可播放入场 / 循环动效 */
  animate: boolean;
  motionReduced: boolean;
  motionReady: boolean;
} {
  const { enabled: reduceMotion, ready: motionReady } = useReducedMotionState();
  const motionReduced = reduceMotion || !motionReady;
  return { animate: motionReady && !reduceMotion, motionReduced, motionReady };
}

type RiseInProps = {
  animate: boolean;
  index?: number;
  /** 单段时长，默认 420ms（设计稿 riseIn） */
  duration?: number;
  /** 错峰步进，默认 45ms */
  staggerMs?: number;
  /** 额外起始延迟 */
  delayMs?: number;
  /** 入场位移，默认 12 */
  fromY?: number;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
};

/** 上浮淡入：opacity 0→1 + translateY */
export function HealthRiseIn({
  animate,
  index = 0,
  duration = 420,
  staggerMs = 45,
  delayMs = 0,
  fromY = 12,
  style,
  children,
}: RiseInProps) {
  const progress = React.useRef(new Animated.Value(animate ? 0 : 1)).current;
  const playedRef = React.useRef(false);

  React.useEffect(() => {
    if (!animate) {
      progress.setValue(1);
      playedRef.current = false;
      return;
    }
    // 同一次挂载内只播一次，避免拖拽排序改 index 时重入场
    if (playedRef.current) {
      progress.setValue(1);
      return;
    }
    playedRef.current = true;
    progress.setValue(0);
    const anim = Animated.timing(progress, {
      toValue: 1,
      duration,
      delay: delayMs + index * staggerMs,
      easing: HEALTH_MOTION_EASE,
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [animate, delayMs, duration, index, progress, staggerMs]);

  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [fromY, 0],
  });

  return (
    <Animated.View style={[style, { opacity: progress, transform: [{ translateY }] }]}>
      {children}
    </Animated.View>
  );
}

type PopInProps = {
  animate: boolean;
  index?: number;
  staggerMs?: number;
  delayMs?: number;
  duration?: number;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
};

/** 弹入：scale .86 → 1.03 → 1（设计稿 popIn） */
export function HealthPopIn({
  animate,
  index = 0,
  staggerMs = 40,
  delayMs = 80,
  duration = 380,
  style,
  children,
}: PopInProps) {
  const progress = React.useRef(new Animated.Value(animate ? 0 : 1)).current;
  const playedRef = React.useRef(false);

  React.useEffect(() => {
    if (!animate) {
      progress.setValue(1);
      playedRef.current = false;
      return;
    }
    if (playedRef.current) {
      progress.setValue(1);
      return;
    }
    playedRef.current = true;
    progress.setValue(0);
    const anim = Animated.timing(progress, {
      toValue: 1,
      duration,
      delay: delayMs + index * staggerMs,
      easing: HEALTH_MOTION_SPRING,
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [animate, delayMs, duration, index, progress, staggerMs]);

  const scale = progress.interpolate({
    inputRange: [0, 0.7, 1],
    outputRange: [0.86, 1.03, 1],
  });

  return (
    <Animated.View style={[style, { opacity: progress, transform: [{ scale }] }]}>
      {children}
    </Animated.View>
  );
}

type GrowBarProps = {
  animate: boolean;
  /** 0–100 */
  percent: number;
  color: string;
  trackColor: string;
  index?: number;
  staggerMs?: number;
  duration?: number;
  height?: number;
  style?: StyleProp<ViewStyle>;
};

/** 指标条自左生长（scaleX，避免布局动画） */
export function HealthGrowBar({
  animate,
  percent,
  color,
  trackColor,
  index = 0,
  staggerMs = 80,
  duration = 500,
  height = 6,
  style,
}: GrowBarProps) {
  const progress = React.useRef(new Animated.Value(animate ? 0 : 1)).current;
  const clamped = Math.max(0, Math.min(100, percent));
  const widthPct = Math.max(4, clamped);

  React.useEffect(() => {
    if (!animate) {
      progress.setValue(1);
      return;
    }
    progress.setValue(0);
    const anim = Animated.timing(progress, {
      toValue: 1,
      duration,
      delay: index * staggerMs,
      easing: HEALTH_MOTION_EASE,
      useNativeDriver: false,
    });
    anim.start();
    return () => anim.stop();
  }, [animate, duration, index, percent, progress, staggerMs]);

  const fillWidth = progress.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', `${widthPct}%`],
  });

  return (
    <View style={[{ height, borderRadius: height, backgroundColor: trackColor, overflow: 'hidden' }, style]}>
      <Animated.View
        style={{
          height: '100%',
          width: fillWidth,
          backgroundColor: color,
          borderRadius: height,
        }}
      />
    </View>
  );
}

type ShimmerProps = {
  active: boolean;
  borderRadius?: number;
  style?: StyleProp<ViewStyle>;
};

/**
 * 解析占位行 shimmer：1.3s 横向扫光（设计稿 screen 14）。
 * 覆盖在子层之上，不拦截点击。
 */
export function HealthShimmerOverlay({ active, borderRadius = 14, style }: ShimmerProps) {
  const { animate } = useHealthMotionGate();
  const sweep = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    if (!active || !animate) {
      sweep.stopAnimation();
      sweep.setValue(0);
      return;
    }
    sweep.setValue(0);
    const loop = Animated.loop(
      Animated.timing(sweep, {
        toValue: 1,
        duration: 1300,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => {
      loop.stop();
      sweep.stopAnimation();
    };
  }, [active, animate, sweep]);

  if (!active) return null;

  const translateX = sweep.interpolate({
    inputRange: [0, 1],
    outputRange: [-80, 220],
  });

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius, overflow: 'hidden' }, style]}>
      <Animated.View
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          width: 72,
          transform: [{ translateX }, { skewX: '-18deg' }],
          backgroundColor: 'rgba(255,252,245,0.55)',
        }}
      />
    </View>
  );
}

type PulseDotProps = {
  color: string;
  active: boolean;
  size?: number;
  style?: StyleProp<ViewStyle>;
};

/** 顶部状态点呼吸（解析中 1.4s） */
export function HealthPulseDot({ color, active, size = 6, style }: PulseDotProps) {
  const { animate } = useHealthMotionGate();
  const pulse = React.useRef(new Animated.Value(1)).current;

  React.useEffect(() => {
    if (!active || !animate) {
      pulse.stopAnimation();
      pulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1.35,
          duration: 700,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0.85,
          duration: 700,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => {
      loop.stop();
      pulse.stopAnimation();
    };
  }, [active, animate, pulse]);

  return (
    <Animated.View
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color,
          transform: [{ scale: pulse }],
          opacity:
            active && animate
              ? pulse.interpolate({ inputRange: [0.85, 1.35], outputRange: [0.65, 1] })
              : 1,
        },
        style,
      ]}
    />
  );
}

type CountUpProps = {
  value: number;
  animate: boolean;
  duration?: number;
  textStyle?: StyleProp<TextStyle>;
  formatter?: (n: number) => string;
};

/** 数字 count-up（评分环中心等） */
export function HealthCountUpText({
  value,
  animate,
  duration = 900,
  textStyle,
  formatter = (n) => String(Math.round(n)),
}: CountUpProps) {
  const [display, setDisplay] = React.useState(animate ? 0 : value);
  const anim = React.useRef(new Animated.Value(animate ? 0 : value)).current;

  React.useEffect(() => {
    if (!animate) {
      anim.setValue(value);
      setDisplay(value);
      return;
    }
    anim.setValue(0);
    const id = anim.addListener(({ value: v }) => setDisplay(v));
    const runner = Animated.timing(anim, {
      toValue: value,
      duration,
      easing: HEALTH_MOTION_EASE,
      useNativeDriver: false,
    });
    runner.start();
    return () => {
      anim.removeListener(id);
      runner.stop();
    };
  }, [animate, anim, duration, value]);

  return <Text style={textStyle}>{formatter(display)}</Text>;
}
