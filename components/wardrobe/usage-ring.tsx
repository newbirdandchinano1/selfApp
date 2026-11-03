import { FOLD_MOTION_EASE, useFoldMotionGate } from '@/components/review/fold-motion';
import {
  useWardrobeTheme,
  wardrobeEm,
  wardrobeFonts,
  type WardrobePalette,
} from '@/constants/wardrobe-theme';
import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';

type UsageRingProps = {
  percent: number;
  size?: number;
  /** 渐变描边（周卡）或纯琥珀（我的） */
  gradient?: boolean;
  animate?: boolean;
};

/**
 * 使用率圆环 + 设计稿 `.orbit` 琥珀小球绕轨（13s 匀速）。
 */
export const UsageRing = memo(function UsageRing({
  percent,
  size = 78,
  gradient = true,
  animate: animateProp,
}: UsageRingProps) {
  const { w } = useWardrobeTheme();
  const styles = useMemo(() => createStyles(w), [w]);
  const gate = useFoldMotionGate();
  const animate = animateProp ?? gate.animate;
  const r = 42;
  const c = 2 * Math.PI * r;
  const offset = useRef(new Animated.Value(c)).current;
  const spin = useRef(new Animated.Value(0)).current;
  const [label, setLabel] = useState(animate ? 0 : percent);
  const AnimatedCircle = Animated.createAnimatedComponent(Circle);

  useEffect(() => {
    const target = c * (1 - percent / 100);
    if (!animate) {
      offset.setValue(target);
      setLabel(percent);
      return;
    }
    offset.setValue(c);
    Animated.timing(offset, {
      toValue: target,
      duration: 1600,
      easing: FOLD_MOTION_EASE,
      useNativeDriver: false,
    }).start();
    const start = Date.now();
    const tick = () => {
      const t = Math.min(1, (Date.now() - start) / 1150);
      const eased = 1 - Math.pow(1 - t, 3);
      setLabel(Math.round(percent * eased));
      if (t < 1) requestAnimationFrame(tick);
    };
    const id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [animate, c, offset, percent]);

  useEffect(() => {
    if (!animate) {
      spin.setValue(0);
      return;
    }
    spin.setValue(0);
    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 13000,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [animate, spin]);

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const orbitSize = size + 10;
  const pctSize = size >= 74 ? 17 : 15;
  const hintSize = size >= 74 ? 5.5 : 5;

  return (
    <View style={{ width: size, height: size }}>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.orbit,
          {
            width: orbitSize,
            height: orbitSize,
            transform: [{ rotate }],
          },
        ]}>
        <View style={styles.orbitDot} />
      </Animated.View>
      <Svg
        width={size}
        height={size}
        viewBox="0 0 100 100"
        style={styles.ringSvg}>
        {gradient ? (
          <Defs>
            <LinearGradient id="wardrobeRingGrad" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0%" stopColor="#F4DAB0" />
              <Stop offset="50%" stopColor="#DCA768" />
              <Stop offset="100%" stopColor="#BC7C3F" />
            </LinearGradient>
          </Defs>
        ) : null}
        <Circle cx={50} cy={50} r={r} stroke="rgba(255,255,255,0.12)" strokeWidth={7} fill="none" />
        <AnimatedCircle
          cx={50}
          cy={50}
          r={r}
          stroke={gradient ? 'url(#wardrobeRingGrad)' : w.amber3}
          strokeWidth={7}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${c} ${c}`}
          strokeDashoffset={offset}
        />
      </Svg>
      <View pointerEvents="none" style={styles.ringLabel}>
        <Text style={[styles.ringPct, { fontSize: pctSize, lineHeight: pctSize + 2 }]}>{label}</Text>
        <Text style={[styles.ringHint, { fontSize: hintSize }]}>USAGE</Text>
      </View>
    </View>
  );
});

function createStyles(w: WardrobePalette) {
  return StyleSheet.create({
    orbit: {
      position: 'absolute',
      left: -5,
      top: -5,
      borderRadius: 999,
      zIndex: 1,
    },
    orbitDot: {
      position: 'absolute',
      top: 1,
      left: '50%',
      marginLeft: -2.5,
      width: 5,
      height: 5,
      borderRadius: 2.5,
      backgroundColor: w.amber3,
      shadowColor: '#E6B878',
      shadowOpacity: 0.85,
      shadowRadius: 4.5,
      shadowOffset: { width: 0, height: 0 },
      elevation: 4,
    },
    ringSvg: {
      position: 'absolute',
      left: 0,
      top: 0,
      transform: [{ rotate: '-90deg' }],
    },
    ringLabel: {
      position: 'absolute',
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 3,
    },
    ringPct: {
      fontFamily: wardrobeFonts.monoBold,
      color: '#FFF9EA',
      textAlign: 'center',
    },
    ringHint: {
      fontFamily: wardrobeFonts.mono,
      letterSpacing: wardrobeEm(0.15, 5.5),
      color: 'rgba(245,240,227,0.45)',
      marginTop: 3,
      textAlign: 'center',
    },
  });
}
