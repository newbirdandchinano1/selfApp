/**
 * Toast / Dialog 描边图标 — 对齐设计稿 SVG path。
 */
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

type IconProps = {
  size?: number;
  color: string;
};

const STROKE = {
  fill: 'none' as const,
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export function FeedbackCheckIcon({ size = 11, color }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M5 12l4 4 10-10" stroke={color} {...STROKE} />
    </Svg>
  );
}

export function FeedbackInfoIcon({ size = 11, color }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx="12" cy="12" r="9" stroke={color} {...STROKE} />
      <Path d="M12 8v.01M11 12h2v4h-2" stroke={color} {...STROKE} />
    </Svg>
  );
}

export function FeedbackWarnIcon({ size = 11, color }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M12 9v4M12 17h.01M10.3 3.8L2.5 17a2 2 0 0 0 1.7 3h15.6a2 2 0 0 0 1.7-3L13.7 3.8a2 2 0 0 0-3.4 0z"
        stroke={color}
        {...STROKE}
      />
    </Svg>
  );
}

export function FeedbackErrorIcon({ size = 11, color }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M18 6L6 18M6 6l12 12" stroke={color} {...STROKE} />
    </Svg>
  );
}

export function FeedbackLoadingIcon({ size = 11, color }: IconProps) {
  const spin = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 900,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    anim.start();
    return () => anim.stop();
  }, [spin]);

  const rotate = spin.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  return (
    <Animated.View style={{ width: size, height: size, transform: [{ rotate }] }}>
      <Svg width={size} height={size} viewBox="0 0 24 24">
        <Path
          d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"
          stroke={color}
          {...STROKE}
        />
      </Svg>
    </Animated.View>
  );
}

export type FeedbackTone = 'success' | 'info' | 'warn' | 'error' | 'loading';

export function FeedbackToastGlyph({
  tone,
  color,
  size = 11,
}: {
  tone: FeedbackTone;
  color: string;
  size?: number;
}) {
  switch (tone) {
    case 'success':
      return <FeedbackCheckIcon size={size} color={color} />;
    case 'info':
      return <FeedbackInfoIcon size={size} color={color} />;
    case 'warn':
      return <FeedbackWarnIcon size={size} color={color} />;
    case 'error':
      return <FeedbackErrorIcon size={size} color={color} />;
    case 'loading':
      return <FeedbackLoadingIcon size={size} color={color} />;
    default:
      return <FeedbackInfoIcon size={size} color={color} />;
  }
}

export function FeedbackDialogGlyph({
  kind,
  color,
  size = 18,
}: {
  kind: 'success' | 'warning' | 'danger';
  color: string;
  size?: number;
}) {
  if (kind === 'success') return <FeedbackCheckIcon size={size} color={color} />;
  if (kind === 'danger') return <FeedbackErrorIcon size={size} color={color} />;
  return <FeedbackWarnIcon size={size} color={color} />;
}

/** 圆形 / 圆角图标槽 */
export function FeedbackIconSlot({
  size,
  radius,
  backgroundColor,
  children,
  style,
}: {
  size: number;
  radius: number;
  backgroundColor: string;
  children: React.ReactNode;
  style?: object;
}) {
  return (
    <View
      style={[
        styles.slot,
        {
          width: size,
          height: size,
          borderRadius: radius,
          backgroundColor,
        },
        style,
      ]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  slot: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
