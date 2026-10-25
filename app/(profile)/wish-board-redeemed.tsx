import {
  formatWishBoxPoints,
  type WishBoxPalette,
  type WishBoxShadowSet,
} from '@/constants/wish-box-ui';
import { useWishBoxTheme, useWishStyles } from '@/hooks/use-wish-box-theme';
import { useReducedMotionState } from '@/hooks/use-reduced-motion';
import { resolveWishBoardIconOption } from '@/lib/constants/wish-board-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

const AnimatedPath = Animated.createAnimatedComponent(Path);

function paramText(raw: string | string[] | undefined, fallback = ''): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function paramNumber(raw: string | string[] | undefined, fallback = 0): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** 设计稿：10-20 21:08 */
function formatNowAt(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${mm}-${dd} ${hh}:${mi}`;
}

export default function WishBoardRedeemedScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { c } = useWishBoxTheme();
  const styles = useWishStyles(makeStyles);
  const params = useLocalSearchParams<{
    title?: string;
    icon?: string;
    cost?: string;
    balance?: string;
    times?: string;
    type?: string;
  }>();

  const title = paramText(params.title, '心愿');
  const icon = resolveWishBoardIconOption(paramText(params.icon, ''));
  const cost = Math.abs(paramNumber(params.cost));
  const balance = Math.max(0, paramNumber(params.balance));
  const times = Math.max(1, Math.round(paramNumber(params.times, 1)));
  const wishType = paramText(params.type, 'once') === 'repeat' ? 'repeat' : 'once';
  const [timeText] = useState(() => formatNowAt());

  const { enabled: reduceMotion, ready: motionReady } = useReducedMotionState();
  const animate = motionReady && !reduceMotion;

  return (
    <View style={styles.root}>
      <SuccessBackdrop />
      <ScrollView
        showsVerticalScrollIndicator={false}
        bounces={false}
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 10, paddingBottom: 16 }]}>
        <View style={styles.hero}>
          <Confetti animate={animate} />

          <Rise animate={animate} delay={80}>
            <View style={styles.pill}>
              <Text style={styles.pillText}>🎁 心愿达成 · 第 {times} 次</Text>
            </View>
          </Rise>

          <SuccessRing animate={animate} />

          <Rise animate={animate} delay={200}>
            <Text style={styles.heading}>兑换成功！</Text>
          </Rise>

          <Rise animate={animate} delay={270}>
            <Text style={styles.subtitle}>{`「${title}」已收入囊中`}</Text>
            <Text style={styles.subtitle}>{`好好享受这个周末吧 ${icon.emoji}`}</Text>
          </Rise>

          <View style={styles.receipt}>
            <ReceiptRow emoji="⏱️" label="兑换时间" value={timeText} animate={animate} index={0} />
            <ReceiptRow
              emoji="⭐"
              label="本次消耗"
              value={`-${formatWishBoxPoints(cost)} 积分`}
              valueColor={c.pri}
              animate={animate}
              index={1}
            />
            <ReceiptRow
              emoji="💰"
              label="剩余积分"
              value={`${formatWishBoxPoints(balance)} 积分`}
              animate={animate}
              index={2}
            />
            <ReceiptRow
              emoji="🧾"
              label="足迹记录"
              value="已自动记入 ✓"
              valueColor={c.mint}
              animate={animate}
              index={3}
              last
            />
          </View>

          <Text style={styles.note}>
            {wishType === 'repeat'
              ? '该心愿为「可重复」类型，可继续攒积分再次兑换 🔁'
              : '该心愿为「一次性」类型，已收入心愿档案 🎬'}
          </Text>
        </View>
      </ScrollView>

      <View style={[styles.cta, { paddingBottom: Math.max(insets.bottom, 16) + 4 }]}>
        <PrimaryButton
          label="查看积分足迹"
          onPress={() => router.replace('/wish-board-footprints')}
        />
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [styles.ghostBtn, { opacity: pressed ? 0.88 : 1 }]}
          accessibilityRole="button"
          accessibilityLabel="继续许愿">
          <Text style={styles.ghostText}>继续许愿</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Rise({
  animate,
  delay = 0,
  style,
  children,
}: {
  animate: boolean;
  delay?: number;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}) {
  const [value] = useState(() => new Animated.Value(animate ? 0 : 1));

  useEffect(() => {
    if (!animate) {
      value.setValue(1);
      return;
    }
    value.setValue(0);
    const anim = Animated.timing(value, {
      toValue: 1,
      duration: 460,
      delay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    anim.start();
    return () => {
      anim.stop();
    };
  }, [animate, delay, value]);

  const translateY = value.interpolate({ inputRange: [0, 1], outputRange: [14, 0] });

  return (
    <Animated.View style={[style, { opacity: value, transform: [{ translateY }] }]}>
      {children}
    </Animated.View>
  );
}

const CONFETTI = [
  { emoji: '✨', left: 36, top: 118, size: 18 },
  { emoji: '🎉', right: 30, top: 84, size: 18 },
  { emoji: '⭐', left: 22, top: 286, size: 19 },
  { emoji: '💫', right: 18, top: 330, size: 18 },
  { emoji: '🎊', left: 88, top: 56, size: 13 },
  { emoji: '✨', right: 96, top: 236, size: 12 },
] as const;

function Confetti({ animate }: { animate: boolean }) {
  const styles = useWishStyles(makeStyles);
  const [value] = useState(() => new Animated.Value(animate ? 0 : 1));

  useEffect(() => {
    if (!animate) {
      value.setValue(1);
      return;
    }
    value.setValue(0);
    const anim = Animated.timing(value, {
      toValue: 1,
      duration: 900,
      delay: 250,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    anim.start();
    return () => {
      anim.stop();
    };
  }, [animate, value]);

  const scale = value.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] });

  return (
    <>
      {CONFETTI.map((c, i) => (
        <Animated.Text
          key={i}
          pointerEvents="none"
          style={[
            styles.confetti,
            {
              left: 'left' in c ? c.left : undefined,
              right: 'right' in c ? c.right : undefined,
              top: c.top,
              fontSize: c.size,
              opacity: value,
              transform: [{ scale }],
            },
          ]}>
          {c.emoji}
        </Animated.Text>
      ))}
    </>
  );
}

function SuccessRing({ animate }: { animate: boolean }) {
  const styles = useWishStyles(makeStyles);
  const [pop] = useState(() => new Animated.Value(animate ? 0 : 1));
  const [draw] = useState(() => new Animated.Value(animate ? 0 : 1));

  useEffect(() => {
    if (!animate) {
      pop.setValue(1);
      draw.setValue(1);
      return;
    }
    const popAnim = Animated.spring(pop, {
      toValue: 1,
      speed: 12,
      bounciness: 9,
      useNativeDriver: true,
    });
    popAnim.start();
    const drawAnim = Animated.timing(draw, {
      toValue: 1,
      duration: 500,
      delay: 500,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    });
    drawAnim.start();
    return () => {
      popAnim.stop();
      drawAnim.stop();
    };
  }, [animate, pop, draw]);

  const scale = pop.interpolate({ inputRange: [0, 1], outputRange: [0.86, 1] });
  const strokeOffset = draw.interpolate({ inputRange: [0, 1], outputRange: [24, 0] });

  return (
    <View style={styles.ringWrap}>
      <View style={styles.ringDashed} pointerEvents="none" />
      <Animated.View style={[styles.okRing, { opacity: pop, transform: [{ scale }] }]}>
        <RingGradient />
        <Svg
          width={52}
          height={52}
          viewBox="0 0 24 24"
          style={StyleSheet.absoluteFill}
          pointerEvents="none">
          <AnimatedPath
            d="M4 12.5l5 5L20 6.5"
            stroke="#fff"
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
            strokeDasharray={24}
            strokeDashoffset={strokeOffset}
          />
        </Svg>
      </Animated.View>
    </View>
  );
}

function RingGradient() {
  const rawId = React.useId();
  const id = `wishDone${rawId.replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#57B894" />
          <Stop offset="1" stopColor="#2F8A6C" />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
    </Svg>
  );
}

function SuccessBackdrop() {
  const rawId = React.useId();
  const { c } = useWishBoxTheme();
  const id = `wishDoneBg${rawId.replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={c.successBgTop} />
          <Stop offset="0.6" stopColor={c.successBgMid} />
          <Stop offset="1" stopColor={c.successBg} />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
    </Svg>
  );
}

function ReceiptRow({
  emoji,
  label,
  value,
  valueColor,
  animate,
  index,
  last = false,
}: {
  emoji: string;
  label: string;
  value: string;
  valueColor?: string;
  animate: boolean;
  index: number;
  last?: boolean;
}) {
  const styles = useWishStyles(makeStyles);
  return (
    <Rise
      animate={animate}
      delay={340 + index * 55}
      style={[styles.receiptRow, !last && styles.receiptRowDivider]}>
      <Text style={styles.receiptLabel}>
        {emoji} {label}
      </Text>
      <Text style={[styles.receiptValue, valueColor ? { color: valueColor } : null]}>{value}</Text>
    </Rise>
  );
}

function PrimaryButton({ label, onPress }: { label: string; onPress: () => void }) {
  const styles = useWishStyles(makeStyles);
  const { shadows } = useWishBoxTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.primaryBtn,
        shadows.button,
        { opacity: pressed ? 0.92 : 1, transform: [{ scale: pressed ? 0.985 : 1 }] },
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}>
      <ButtonGradient />
      <Text style={styles.primaryText}>{label}</Text>
    </Pressable>
  );
}

function ButtonGradient() {
  const rawId = React.useId();
  const id = `wishDoneBtn${rawId.replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#FF8A5B" />
          <Stop offset="1" stopColor="#EF5F38" />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" rx={17} fill={`url(#${id})`} />
    </Svg>
  );
}

function makeStyles(c: WishBoxPalette, shadows: WishBoxShadowSet) {
  return StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: c.successBg,
  },
  scroll: {
    flexGrow: 1,
  },
  hero: {
    alignItems: 'center',
    position: 'relative',
    paddingHorizontal: 18,
  },
  confetti: {
    position: 'absolute',
  },
  pill: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.card,
    borderWidth: 1,
    borderColor: c.line,
    borderRadius: 99,
    paddingVertical: 7,
    paddingHorizontal: 16,
    marginTop: 2,
    ...shadows.soft,
  },
  pillText: {
    fontSize: 12,
    fontWeight: '800',
    color: c.pri,
    letterSpacing: 0.6,
  },
  ringWrap: {
    width: 120,
    height: 120,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 26,
    marginBottom: 20,
  },
  ringDashed: {
    position: 'absolute',
    width: 146,
    height: 146,
    borderRadius: 73,
    borderWidth: 2.5,
    borderStyle: 'dashed',
    borderColor: 'rgba(63,161,132,0.45)',
  },
  okRing: {
    width: 120,
    height: 120,
    borderRadius: 60,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    shadowColor: '#2F8A6C',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.4,
    shadowRadius: 18,
    elevation: 10,
  },
  heading: {
    fontSize: 30,
    fontWeight: '800',
    color: c.ink,
    letterSpacing: 1,
    textAlign: 'center',
  },
  subtitle: {
    marginTop: 6,
    fontSize: 14,
    fontWeight: '600',
    color: c.ink2,
    textAlign: 'center',
    lineHeight: 22,
  },
  receipt: {
    alignSelf: 'stretch',
    backgroundColor: c.card,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: c.line,
    paddingVertical: 8,
    paddingHorizontal: 18,
    marginTop: 22,
    ...shadows.card,
  },
  receiptRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    gap: 10,
  },
  receiptRowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.divider,
    borderStyle: 'dashed',
  },
  receiptLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: c.ink2,
  },
  receiptValue: {
    fontSize: 13.5,
    fontWeight: '800',
    color: c.ink,
    fontVariant: ['tabular-nums'],
  },
  note: {
    marginTop: 14,
    fontSize: 11,
    fontWeight: '600',
    lineHeight: 18,
    color: c.muted,
    textAlign: 'center',
  },
  cta: {
    paddingHorizontal: 20,
    paddingTop: 10,
    gap: 10,
  },
  primaryBtn: {
    height: 54,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  primaryText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: 1,
  },
  ghostBtn: {
    height: 52,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.card,
    borderWidth: 1.5,
    borderColor: c.line,
  },
  ghostText: {
    fontSize: 16,
    fontWeight: '800',
    color: c.ink,
    letterSpacing: 1,
  },
  });
}
