/**
 * 积分变动 Toast — 底部胶囊，视觉对齐全局 Toast 设计稿。
 */
import React from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { FeedbackIconSlot } from '@/components/feedback/feedback-icons';
import {
  formatPointsToastAmount,
  subscribePointsEarnedToast,
} from '@/lib/points-earned-toast-events';

const SLIDE_DISTANCE = 48;
const HOLD_MS = 900;
const SLIDE_MS = 700;
const FADE_MS = 650;

function StarGlyph({ color }: { color: string }) {
  return (
    <Svg width={11} height={11} viewBox="0 0 24 24">
      <Path
        d="M12 3l2.4 6.6H21l-5.2 4 2 6.4L12 16.4 6.2 20l2-6.4L3 9.6h6.6L12 3z"
        fill={color}
      />
    </Svg>
  );
}

function MinusGlyph({ color }: { color: string }) {
  return (
    <Svg width={11} height={11} viewBox="0 0 24 24">
      <Path
        d="M5 12h14"
        fill="none"
        stroke={color}
        strokeWidth={1.7}
        strokeLinecap="round"
      />
    </Svg>
  );
}

/** 根级挂载：积分变动时底部提示（加分 / 扣分），上滑一段距离后渐隐。 */
export function PointsEarnedToastHost() {
  const insets = useSafeAreaInsets();
  const [points, setPoints] = React.useState<number | null>(null);
  const opacity = React.useRef(new Animated.Value(0)).current;
  const translateY = React.useRef(new Animated.Value(0)).current;
  const animRef = React.useRef<Animated.CompositeAnimation | null>(null);

  React.useEffect(() => {
    return subscribePointsEarnedToast(next => {
      if (next == null || next === 0) return;

      animRef.current?.stop();
      setPoints(next);
      opacity.setValue(1);
      translateY.setValue(0);

      const anim = Animated.sequence([
        Animated.delay(HOLD_MS),
        Animated.timing(translateY, {
          toValue: -SLIDE_DISTANCE,
          duration: SLIDE_MS,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0,
          duration: FADE_MS,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
      ]);
      animRef.current = anim;
      anim.start(({ finished }) => {
        if (!finished) return;
        animRef.current = null;
        setPoints(null);
      });
    });
  }, [opacity, translateY]);

  if (points == null || points === 0) return null;

  const gained = points > 0;

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.wrap,
        {
          // 略高于全局 Toast，避免叠在一起
          bottom: Math.max(insets.bottom, 12) + 118,
          opacity,
          transform: [{ translateY }],
        },
      ]}>
      <View
        style={[
          styles.toast,
          {
            backgroundColor: gained
              ? 'rgba(32,48,40,0.94)'
              : 'rgba(160,60,45,0.95)',
          },
        ]}>
        <FeedbackIconSlot
          size={20}
          radius={10}
          backgroundColor={
            gained ? 'rgba(127,166,149,0.22)' : 'rgba(255,255,255,0.18)'
          }>
          {gained ? (
            <StarGlyph color="#F4D9A8" />
          ) : (
            <MinusGlyph color="#FFD6CF" />
          )}
        </FeedbackIconSlot>
        <Text style={styles.text}>
          {gained
            ? `获得 +${formatPointsToastAmount(points)} 积分`
            : `扣除 ${formatPointsToastAmount(points)} 积分`}
        </Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 200,
    elevation: 200,
    paddingHorizontal: 20,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderRadius: 18,
    paddingLeft: 9,
    paddingRight: 13,
    paddingVertical: 8,
    maxWidth: '88%',
    shadowColor: 'rgba(20,30,24,1)',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 24,
    elevation: 10,
  },
  text: {
    color: '#F8F3E8',
    fontSize: 12.5,
    fontWeight: '600',
  },
});
