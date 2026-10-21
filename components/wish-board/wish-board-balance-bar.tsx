import { Layout } from '@/constants/design-tokens';
import {
  formatWishBoxPoints,
  type WishBoxGradientSet,
  type WishBoxPalette,
  type WishBoxShadowSet,
} from '@/constants/wish-box-ui';
import { useWishBoxTheme, useWishStyles } from '@/hooks/use-wish-box-theme';
import { useReducedMotionState } from '@/hooks/use-reduced-motion';
import React from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

type Props = {
  balance: number;
  /** 本月已攒积分（设计稿「本月已攒 +X」） */
  monthEarned?: number;
  /** waiting 分区：展示「再攒 X 可解锁全部心愿」 */
  unlockShortfall?: number;
  redeemCount: number;
  onFootprints: () => void;
};

export function WishBoardBalanceBar({
  balance,
  monthEarned,
  unlockShortfall,
  redeemCount,
  onFootprints,
}: Props) {
  const { enabled: reduceMotion, ready: motionReady } = useReducedMotionState();
  const { shadows } = useWishBoxTheme();
  const styles = useWishStyles(makeStyles);
  const motionOn = motionReady && !reduceMotion;

  const [cardWidth, setCardWidth] = React.useState(0);
  const shine = React.useState(() => new Animated.Value(0))[0];
  const float = React.useState(() => new Animated.Value(0))[0];

  // 光带扫过：走完一段后停顿，再循环（对应设计稿 shineSweep 4.4s）
  React.useEffect(() => {
    if (!motionOn || cardWidth <= 0) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(shine, {
          toValue: 1,
          duration: 2400,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.delay(2000),
        Animated.timing(shine, {
          toValue: 0,
          duration: 0,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => {
      loop.stop();
      shine.setValue(0);
    };
  }, [motionOn, cardWidth, shine]);

  // 星星徽章上下浮动（对应设计稿 floatY 3.4s）
  React.useEffect(() => {
    if (!motionOn) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(float, {
          toValue: 1,
          duration: 1700,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(float, {
          toValue: 0,
          duration: 1700,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => {
      loop.stop();
      float.setValue(0);
    };
  }, [motionOn, float]);

  const shineTranslate = shine.interpolate({
    inputRange: [0, 1],
    outputRange: [-140, cardWidth + 140],
  });
  const starTranslateY = float.interpolate({ inputRange: [0, 1], outputRange: [0, -5] });

  const showUnlock =
    typeof unlockShortfall === 'number' && Number.isFinite(unlockShortfall) && unlockShortfall > 0;
  const showMonth =
    !showUnlock && typeof monthEarned === 'number' && Number.isFinite(monthEarned) && monthEarned > 0;

  return (
    <View
      style={[styles.wrap, shadows.balance]}
      onLayout={e => setCardWidth(e.nativeEvent.layout.width)}>
      <BalanceBackground />
      <View style={styles.decorA} pointerEvents="none" />
      <View style={styles.decorB} pointerEvents="none" />
      {motionOn ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.shine,
            { transform: [{ translateX: shineTranslate }, { rotate: '-16deg' }] },
          ]}
        />
      ) : null}

      <View style={styles.top}>
        <View style={styles.topLeft}>
          <Text style={styles.label}>✨ 当前积分</Text>
          <View style={styles.numRow}>
            <BalanceNumber value={balance} animate={motionOn} />
            <Text style={styles.unit}>分</Text>
          </View>
        </View>
        <Animated.View style={[styles.badge, { transform: [{ translateY: starTranslateY }] }]}>
          <Text style={styles.badgeEmoji}>⭐</Text>
        </Animated.View>
      </View>

      <View style={styles.bottom}>
        <View style={styles.meta}>
          {showUnlock ? (
            <Text style={styles.metaText}>
              再攒{' '}
              <Text style={styles.metaStrong}>{formatWishBoxPoints(unlockShortfall)}</Text>{' '}
              可解锁全部心愿
            </Text>
          ) : (
            <>
              {showMonth ? (
                <Text style={styles.metaText}>
                  本月已攒{' '}
                  <Text style={styles.metaStrong}>
                    +{formatWishBoxPoints(Math.max(0, monthEarned))}
                  </Text>
                </Text>
              ) : null}
              {showMonth ? <Text style={styles.metaDot}>·</Text> : null}
              <Text style={styles.metaText}>历史兑换 {formatWishBoxPoints(redeemCount)} 次</Text>
            </>
          )}
        </View>
        <Pressable
          onPress={onFootprints}
          style={({ pressed }) => [styles.pill, { opacity: pressed ? 0.88 : 1 }]}
          accessibilityRole="button"
          accessibilityLabel="兑换足迹">
          <Text style={styles.pillText}>兑换足迹 ›</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** 积分卡渐变底（135° 对角，对应设计稿 linear-gradient） */
function BalanceBackground() {
  const rawId = React.useId();
  const { gradients } = useWishBoxTheme();
  const gradientId = `wishBalance${rawId.replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
      <Defs>
        <LinearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={gradients.balance[0]} />
          <Stop offset="0.55" stopColor={gradients.balance[1]} />
          <Stop offset="1" stopColor={gradients.balance[2]} />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${gradientId})`} />
    </Svg>
  );
}

/** 设计稿 count-up：0 → 目标值，900ms easeOutCubic；减少动态/未就绪时直接显示终值 */
function BalanceNumber({ value, animate }: { value: number; animate: boolean }) {
  const styles = useWishStyles(makeStyles);
  const [display, setDisplay] = React.useState(0);

  React.useEffect(() => {
    if (!animate) return;
    let raf = 0;
    let start = 0;
    const duration = 900;
    const tick = (now: number) => {
      if (!start) start = now;
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(value * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, animate]);

  const shown = animate ? display : value;
  const rounded = Math.round(shown);
  return (
    <Text style={styles.num} numberOfLines={1}>
      {formatWishBoxPoints(rounded)}
    </Text>
  );
}

function makeStyles(c: WishBoxPalette, _shadows: WishBoxShadowSet, gradients: WishBoxGradientSet) {
  return StyleSheet.create({
  wrap: {
    marginHorizontal: Layout.pagePaddingX,
    borderRadius: 26,
    paddingTop: 15,
    paddingHorizontal: 18,
    paddingBottom: 13,
    backgroundColor: c.balance,
    overflow: 'hidden',
    position: 'relative',
  },
  shine: {
    position: 'absolute',
    top: -40,
    bottom: -40,
    left: 0,
    width: 76,
    backgroundColor: gradients.balanceShine,
    zIndex: 3,
  },
  decorA: {
    position: 'absolute',
    right: -46,
    top: -64,
    width: 180,
    height: 180,
    borderRadius: 99,
    backgroundColor: 'rgba(255,255,255,0.13)',
  },
  decorB: {
    position: 'absolute',
    right: 38,
    bottom: -58,
    width: 120,
    height: 120,
    borderRadius: 99,
    backgroundColor: 'rgba(255,214,150,0.18)',
  },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: 2,
  },
  topLeft: {
    flex: 1,
    minWidth: 0,
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.82)',
    letterSpacing: 0.5,
  },
  numRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginTop: 2,
  },
  num: {
    fontSize: 40,
    fontWeight: '800',
    lineHeight: 46,
    letterSpacing: -0.5,
    color: '#fff',
    fontVariant: ['tabular-nums'],
  },
  unit: {
    fontSize: 15,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.9)',
    letterSpacing: 1,
    marginLeft: 3,
  },
  badge: {
    width: 46,
    height: 46,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeEmoji: {
    fontSize: 27,
  },
  bottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
    gap: 8,
    zIndex: 2,
  },
  meta: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    minWidth: 0,
  },
  metaText: {
    fontSize: 11.5,
    color: 'rgba(255,255,255,0.85)',
    fontWeight: '600',
  },
  metaStrong: {
    color: '#fff',
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  metaDot: {
    fontSize: 11.5,
    color: 'rgba(255,255,255,0.55)',
  },
  pill: {
    backgroundColor: '#FFF6E6',
    borderRadius: 99,
    paddingVertical: 6,
    paddingHorizontal: 12,
    shadowColor: '#6E230F',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.18,
    shadowRadius: 6,
    elevation: 3,
  },
  pillText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#D64B2B',
  },
  });
}
