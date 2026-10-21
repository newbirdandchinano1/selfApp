import {
  formatWishBoxPoints,
  wishBoxTintWash,
  type WishBoxPalette,
  type WishBoxShadowSet,
} from '@/constants/wish-box-ui';
import { useWishBoxTheme, useWishStyles } from '@/hooks/use-wish-box-theme';
import { useReducedMotionState } from '@/hooks/use-reduced-motion';
import { resolveWishBoardIconOption } from '@/lib/constants/wish-board-icons';
import type { WishBoardRedeemEligibility } from '@/lib/repositories/wish-board/wish-board-redeem-conditions';
import type { WishBoardItemRow } from '@/lib/repositories/wish-board/wish-board.types';
import React from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

export type WishShelfVariant = 'ready' | 'waiting';

type Props = {
  variant: WishShelfVariant;
  item: WishBoardItemRow;
  balance: number;
  eligibility?: WishBoardRedeemEligibility;
  onPress: () => void;
};

function pointsShortfall(cost: number, balance: number): number {
  return Math.max(0, cost - balance);
}

function progressRatio(cost: number, balance: number): number {
  if (cost <= 0) return 1;
  return Math.max(0, Math.min(1, balance / cost));
}

export function WishBoardShelfTile({ variant, item, balance, eligibility, onPress }: Props) {
  const icon = resolveWishBoardIconOption(item.icon_key);
  const isReady = variant === 'ready';
  const typeLabel = item.wish_type === 'repeat' ? '可重复' : '一次性';
  const cost = eligibility?.costPoints ?? item.cost_points;
  const bal = eligibility?.balance ?? balance;
  const shortfall = pointsShortfall(cost, bal);
  const ratio = progressRatio(cost, bal);
  const locked = !isReady;
  // 锁因标签：条件确实未达成时沿用设计稿文案；只差积分时避免误报「条件未达成」
  const lockLabel = !eligibility || !eligibility.conditionsOk ? '条件未达成' : '积分不足';

  const { isDark, c, shadows } = useWishBoxTheme();
  const styles = useWishStyles(makeStyles);
  const { enabled: reduceMotion, ready: motionReady } = useReducedMotionState();
  const tileColors = isDark
    ? {
        card: c.card,
        lockedCard: c.cardLocked,
        border: c.lineStrong,
        ink: c.ink,
        muted: c.muted,
        lockBg: c.card,
        veil: 'rgba(71,61,54,0.35)',
        coin: c.coin,
        coinBg: c.coinSoft,
        track: c.progressTrack,
      }
    : {
        card: c.card,
        lockedCard: c.cardLocked,
        border: c.line,
        ink: c.ink,
        muted: c.muted,
        lockBg: c.card,
        veil: 'c.cardLocked',
        coin: c.coin,
        coinBg: c.coinSoft,
        track: c.progressTrack,
      };
  const motionOn = motionReady && !reduceMotion;

  // 进度条生长（设计稿 barGrow 850ms，延迟 320ms）
  const [barGrow] = React.useState(() => new Animated.Value(motionOn ? 0 : 1));
  React.useEffect(() => {
    if (!locked || !motionOn) {
      barGrow.setValue(1);
      return;
    }
    barGrow.setValue(0);
    const anim = Animated.timing(barGrow, {
      toValue: 1,
      duration: 850,
      delay: 320,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    });
    anim.start();
    return () => {
      anim.stop();
    };
  }, [locked, motionOn, barGrow]);

  const barWidth = barGrow.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', `${Math.round(ratio * 100)}%`],
  });

  // 锁定轻摆（设计稿 lockWiggle 4.2s 循环，中途 ±8° 抖动）
  const [wiggle] = React.useState(() => new Animated.Value(0));
  React.useEffect(() => {
    if (!locked || !motionOn) {
      wiggle.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(3600),
        Animated.timing(wiggle, { toValue: 1, duration: 140, useNativeDriver: true }),
        Animated.timing(wiggle, { toValue: -0.75, duration: 140, useNativeDriver: true }),
        Animated.timing(wiggle, { toValue: 0, duration: 140, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => {
      loop.stop();
      wiggle.setValue(0);
    };
  }, [locked, motionOn, wiggle]);

  const lockRotate = wiggle.interpolate({ inputRange: [-1, 1], outputRange: ['-8deg', '8deg'] });

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        shadows.soft,
        locked && styles.cardLocked,
        {
          opacity: pressed ? 0.94 : 1,
          backgroundColor: locked ? tileColors.lockedCard : tileColors.card,
          borderColor: tileColors.border,
        },
      ]}
      accessibilityRole="button"
      accessibilityLabel={item.title}>
      {locked ? (
        <Animated.View
          style={[styles.lockBadge, { backgroundColor: tileColors.lockBg, transform: [{ rotate: lockRotate }] }]}
          pointerEvents="none">
          <Text style={styles.lockEmoji}>🔒</Text>
        </Animated.View>
      ) : null}

      <View style={[styles.wtile, { backgroundColor: wishBoxTintWash(icon.tint) }, locked && styles.wtileLocked]}>
        <Text style={styles.emoji}>{icon.emoji}</Text>
        {locked ? (
          <View style={styles.wtileVeil} pointerEvents="none" />
        ) : null}
      </View>

      <Text style={[styles.title, { color: tileColors.ink }]} numberOfLines={1}>
        {item.title}
      </Text>

      <View style={styles.meta}>
        <View style={[styles.tag, item.wish_type === 'repeat' ? styles.tagRep : styles.tagOnce]}>
          <Text
            style={[
              styles.tagText,
              item.wish_type === 'repeat' ? styles.tagRepText : styles.tagOnceText,
            ]}>
            {typeLabel}
          </Text>
        </View>
        {locked ? (
          <View style={[styles.tag, styles.tagLock]}>
            <Text style={styles.tagLockText}>{lockLabel}</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.foot}>
        <View style={[styles.pts, { backgroundColor: tileColors.coinBg }]}>
          <Text style={[styles.ptsText, { color: tileColors.coin }]}>
            ⭐{formatWishBoxPoints(item.cost_points)}
          </Text>
        </View>
        {isReady ? <Text style={styles.readyLink}>可兑换 ›</Text> : null}
      </View>

      {locked ? (
        <View style={styles.progBlock}>
          <View style={styles.progHead}>
            <Text style={[styles.progLabel, { color: tileColors.muted }]}>积分进度</Text>
            <Text style={[styles.progRemain, { color: tileColors.muted }]}>还差 {formatWishBoxPoints(shortfall)}</Text>
          </View>
          <View style={[styles.bar, { backgroundColor: tileColors.track }]}>
            <Animated.View style={[styles.barFill, { width: barWidth }]}>
              <ProgressFill />
            </Animated.View>
          </View>
        </View>
      ) : null}
    </Pressable>
  );
}

/** 积分进度条渐变填充（对应设计稿 bar 的 90° 渐变） */
function ProgressFill() {
  const rawId = React.useId();
  const { gradients } = useWishBoxTheme();
  const gradientId = `wishBar${rawId.replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
      <Defs>
        <LinearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor={gradients.barWarm[0]} />
          <Stop offset="1" stopColor={gradients.barWarm[1]} />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" rx={99} fill={`url(#${gradientId})`} />
    </Svg>
  );
}

function makeStyles(c: WishBoxPalette, _shadows: WishBoxShadowSet) {
  return StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: c.card,
    borderRadius: 20,
    padding: 11,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: c.line,
    position: 'relative',
  },
  cardLocked: {
    backgroundColor: c.cardLocked,
  },
  lockBadge: {
    position: 'absolute',
    top: 10,
    right: 10,
    zIndex: 3,
    width: 24,
    height: 24,
    borderRadius: 9,
    backgroundColor: 'c.card',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: 'c.ink',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.12,
    shadowRadius: 4,
    elevation: 2,
  },
  lockEmoji: {
    fontSize: 11,
  },
  wtile: {
    height: 78,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  wtileLocked: {
    opacity: 0.8,
  },
  /** 锁定卡去饱和（设计稿 grayscale(.35)）：叠一层暖白纱 */
  wtileVeil: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderRadius: 14,
    backgroundColor: 'c.cardLocked',
  },
  emoji: {
    fontSize: 40,
  },
  title: {
    fontSize: 14,
    fontWeight: '800',
    color: c.ink,
    marginTop: 8,
    lineHeight: 18,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 5,
    marginTop: 4,
  },
  tag: {
    borderRadius: 99,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  tagRep: {
    backgroundColor: c.mintSoft,
  },
  tagOnce: {
    backgroundColor: c.amberSoft,
  },
  tagLock: {
    backgroundColor: c.graySoft,
  },
  tagText: {
    fontSize: 11,
    fontWeight: '700',
  },
  tagRepText: {
    color: c.mint,
  },
  tagOnceText: {
    color: c.once,
  },
  tagLockText: {
    fontSize: 11,
    fontWeight: '700',
    color: c.muted,
  },
  foot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  pts: {
    backgroundColor: c.coinSoft,
    borderRadius: 99,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  ptsText: {
    fontSize: 13,
    fontWeight: '800',
    color: c.coin,
    fontVariant: ['tabular-nums'],
  },
  readyLink: {
    fontSize: 12.5,
    fontWeight: '800',
    color: c.mint,
  },
  progBlock: {
    marginTop: 8,
  },
  progHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 5,
  },
  progLabel: {
    fontSize: 10.5,
    fontWeight: '800',
    color: c.muted,
  },
  progRemain: {
    fontSize: 10.5,
    fontWeight: '800',
    color: c.muted,
    fontVariant: ['tabular-nums'],
  },
  bar: {
    height: 6,
    borderRadius: 99,
    backgroundColor: c.progressTrack,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 99,
    backgroundColor: c.pri,
  },
  });
}
