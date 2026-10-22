/**
 * 折页 · FOLD 复盘动效：对齐 `复盘页动效规范.html`
 * riseIn 420ms / stagger 55ms · popIn 弹簧 · count-up 800ms
 * 尊重系统「减少动态效果」。
 *
 * 注意：不要用 playedRef 跳过二次 effect——React Strict Mode 会先 cleanup 再重跑，
 * 跳过会导致入场动画被「瞬切到结束态」，看起来像完全没有动画。
 */
import { useReducedMotionState } from '@/hooks/use-reduced-motion';
import React from 'react';
import {
  Animated,
  Easing,
  StyleSheet,
  Text,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

/** 设计稿 `--ease` / `--spring` */
export const FOLD_MOTION_EASE = Easing.bezier(0.22, 1, 0.36, 1);
export const FOLD_MOTION_SPRING = Easing.bezier(0.34, 1.56, 0.64, 1);

export function useFoldMotionGate(): {
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
  /** 错峰步进，默认 55ms（Hub 列表级联） */
  staggerMs?: number;
  delayMs?: number;
  fromY?: number;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
};

/** 上浮淡入：opacity 0→1 + translateY */
export function FoldRiseIn({
  animate,
  index = 0,
  duration = 420,
  staggerMs = 55,
  delayMs = 0,
  fromY = 12,
  style,
  children,
}: RiseInProps) {
  const progress = React.useRef(new Animated.Value(animate ? 0 : 1)).current;

  React.useEffect(() => {
    if (!animate) {
      progress.setValue(1);
      return;
    }
    progress.setValue(0);
    const anim = Animated.timing(progress, {
      toValue: 1,
      duration,
      delay: delayMs + index * staggerMs,
      easing: FOLD_MOTION_EASE,
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

/** 弹入：scale .86 → 1.03 → 1（设计稿 popIn / 时间线节点） */
export function FoldPopIn({
  animate,
  index = 0,
  staggerMs = 65,
  delayMs = 150,
  duration = 380,
  style,
  children,
}: PopInProps) {
  const progress = React.useRef(new Animated.Value(animate ? 0 : 1)).current;

  React.useEffect(() => {
    if (!animate) {
      progress.setValue(1);
      return;
    }
    progress.setValue(0);
    const anim = Animated.timing(progress, {
      toValue: 1,
      duration,
      delay: delayMs + index * staggerMs,
      easing: FOLD_MOTION_SPRING,
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

type GrowXProps = {
  animate: boolean;
  delayMs?: number;
  duration?: number;
  color: string;
  style?: StyleProp<ViewStyle>;
};

/** 时间线横线自左生长（设计稿 growX；布局宽动画，不用 native driver） */
export function FoldGrowX({
  animate,
  delayMs = 80,
  duration = 520,
  color,
  style,
}: GrowXProps) {
  const progress = React.useRef(new Animated.Value(animate ? 0 : 1)).current;

  React.useEffect(() => {
    if (!animate) {
      progress.setValue(1);
      return;
    }
    progress.setValue(0);
    const anim = Animated.timing(progress, {
      toValue: 1,
      duration,
      delay: delayMs,
      easing: FOLD_MOTION_EASE,
      useNativeDriver: false,
    });
    anim.start();
    return () => anim.stop();
  }, [animate, delayMs, duration, progress]);

  const width = progress.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  return (
    <Animated.View
      style={[
        {
          height: StyleSheet.hairlineWidth,
          width,
          backgroundColor: color,
          alignSelf: 'flex-start',
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
  delayMs?: number;
  textStyle?: StyleProp<TextStyle>;
  formatter?: (n: number) => string;
};

/** 数字 count-up（设计稿 800ms ease-out） */
export function FoldCountUpText({
  value,
  animate,
  duration = 800,
  delayMs = 0,
  textStyle,
  formatter = n => String(Math.round(n)),
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
    setDisplay(0);
    const id = anim.addListener(({ value: v }) => setDisplay(v));
    const runner = Animated.timing(anim, {
      toValue: value,
      duration,
      delay: delayMs,
      easing: FOLD_MOTION_EASE,
      useNativeDriver: false,
    });
    runner.start();
    return () => {
      anim.removeListener(id);
      runner.stop();
    };
  }, [animate, anim, delayMs, duration, value]);

  return <Text style={textStyle}>{formatter(display)}</Text>;
}

type StreamTextProps = {
  text: string;
  animate: boolean;
  /** 设计稿 AI 面板：28ms/字 */
  msPerChar?: number;
  delayMs?: number;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
  maxFontSizeMultiplier?: number;
  onDone?: () => void;
};

/** 正文按字流式出现（设计稿 AI 面板 shimmer → stream） */
export function FoldStreamText({
  text,
  animate,
  msPerChar = 28,
  delayMs = 0,
  style,
  numberOfLines,
  maxFontSizeMultiplier,
  onDone,
}: StreamTextProps) {
  const [shown, setShown] = React.useState(animate ? '' : text);
  const doneRef = React.useRef(onDone);
  doneRef.current = onDone;

  React.useEffect(() => {
    if (!animate || !text) {
      setShown(text);
      doneRef.current?.();
      return;
    }
    setShown('');
    let i = 0;
    let tickTimer: ReturnType<typeof setTimeout> | undefined;
    const startTimer = setTimeout(() => {
      const tick = () => {
        i += 1;
        setShown(text.slice(0, i));
        if (i < text.length) {
          tickTimer = setTimeout(tick, msPerChar);
        } else {
          doneRef.current?.();
        }
      };
      tick();
    }, delayMs);
    return () => {
      clearTimeout(startTimer);
      if (tickTimer) clearTimeout(tickTimer);
    };
  }, [animate, delayMs, msPerChar, text]);

  return (
    <Text style={style} numberOfLines={numberOfLines} maxFontSizeMultiplier={maxFontSizeMultiplier}>
      {shown}
    </Text>
  );
}
