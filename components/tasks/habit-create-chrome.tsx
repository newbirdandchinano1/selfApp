/**
 * 新建习惯页视觉件 — 对齐设计稿 shot 23（.hbt-* / .hb-score）
 */
import { FoldRiseIn, FOLD_MOTION_EASE, FOLD_MOTION_SPRING } from '@/components/review/fold-motion';
import { TaskFoldMotion, useTaskFoldTheme } from '@/constants/task-fold-theme';
import type { HabitKind } from '@/lib/repositories/habits/habit-kind';
import { MaterialIcons } from '@expo/vector-icons';
import React from 'react';
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

export const HBT_KIND_META: Record<
  HabitKind,
  {
    label: string;
    sub: string;
    note: string;
    noteTag: string;
    badge: string;
    scoreLabel: string;
    scoreDesc: string;
    toast: string;
    onBg: string;
    onBorder: string;
    bar: string;
    titleOn: string;
  }
> = {
  build: {
    label: '养成习惯',
    sub: '每天 / 每周打卡',
    note: '当日目标达成后计分',
    noteTag: '默认',
    badge: '养成',
    scoreLabel: '奖励积分',
    scoreDesc: '当日目标达成后计分',
    toast: '养成习惯 · 可配循环与目标',
    onBg: '#EDF2E2',
    onBorder: '#BCCF9F',
    bar: '#AFC38E',
    titleOn: '#3F5D3E',
  },
  break: {
    label: '戒除',
    sub: '破戒 · 连续加分',
    note: '破戒扣分 · 未破戒加分 · 连续达成加分',
    noteTag: '强制量化',
    badge: '戒除',
    scoreLabel: '戒除积分',
    scoreDesc: '三轨独立结算',
    toast: '戒除 · 循环固定每天，量化强制开启',
    onBg: '#F7E7E1',
    onBorder: '#E3BBAE',
    bar: '#C47055',
    titleOn: '#A35B41',
  },
  task: {
    label: '完成任务',
    sub: '周期内达标',
    note: '本周期预期目标达成后计分',
    noteTag: '周期达标',
    badge: '任务',
    scoreLabel: '奖励积分',
    scoreDesc: '本周期目标达成后计分',
    toast: '完成任务 · 按周期累计进度',
    onBg: '#FAEEDC',
    onBorder: '#E7C89B',
    bar: '#D6974B',
    titleOn: '#9C6B2B',
  },
};

export const HBT_SUM: Record<HabitKind, { title: string; cells: { b: string; s: string }[] }> = {
  build: {
    title: '养成',
    cells: [
      { b: '达标才计分', s: '中间进度不发' },
      { b: '回退对称扣回', s: '取消打卡即扣' },
      { b: '漏卡 0', s: '不扣分' },
    ],
  },
  break: {
    title: '戒除',
    cells: [
      { b: '须确认守住', s: '无记录不算达标' },
      { b: '子项任一破戒', s: '当日整体判破' },
      { b: '连续达成', s: '一次性加分' },
    ],
  },
  task: {
    title: '完成任务',
    cells: [
      { b: '周期累计', s: '子任务可跨日' },
      { b: '刚达标发奖', s: '回退时扣回' },
      { b: '达标后隐藏', s: '下周期再现' },
    ],
  },
};

export const HBT_PREVIEWS: Record<
  HabitKind,
  { icon: React.ComponentProps<typeof MaterialIcons>['name'] | '0'; tone: 'ok' | 'cont' | 'make' | 'pen' | 'zero'; b: string; em: string }[]
> = {
  build: [
    { icon: 'check', tone: 'ok', b: '打卡达标', em: 'pts' },
    { icon: 'local-fire-department', tone: 'cont', b: '连续加分', em: '规则内' },
    { icon: 'undo', tone: 'make', b: '补卡估算', em: 'makeup' },
    { icon: '0', tone: 'zero', b: '漏卡不扣', em: '0' },
  ],
  break: [
    { icon: 'close', tone: 'pen', b: '破戒扣分', em: 'pen' },
    { icon: 'check', tone: 'ok', b: '未破戒', em: 'clean' },
    { icon: 'flag', tone: 'cont', b: '达成目标', em: 'goal' },
    { icon: '0', tone: 'zero', b: '漏卡不计分', em: '0' },
  ],
  task: [
    { icon: 'check', tone: 'ok', b: '周期达标', em: 'pts' },
    { icon: 'replay', tone: 'cont', b: '回退扣回', em: 'neg' },
    { icon: 'bar-chart', tone: 'make', b: '进度中', em: '不发' },
    { icon: '0', tone: 'zero', b: '漏卡不扣', em: '0' },
  ],
};

const CTX_TONES = [
  { key: 'rose', bg: '#F8EAE4', fg: '#9A6550', border: '#EDD5CB' },
  { key: 'blue', bg: '#E8EFF2', fg: '#5B7480', border: '#D2E0E6' },
  { key: 'amber', bg: '#F9EFDE', fg: '#956A31', border: '#EBD6B3' },
  { key: 'violet', bg: '#EFEAF2', fg: '#6F5F78', border: '#DFD4E4' },
] as const;

export function contextTone(index: number) {
  return CTX_TONES[index % CTX_TONES.length];
}

export function formatSignedPoints(n: number): string {
  if (n > 0) return `+${Number.isInteger(n) ? n : n.toFixed(1)}`;
  if (n < 0) return String(Number.isInteger(n) ? n : n.toFixed(1));
  return '0';
}

/** 设计稿 .hbt-caret 闪烁 */
export function HabitNameCaret({ visible }: { visible: boolean }) {
  const { tf } = useTaskFoldTheme();
  const opacity = React.useRef(new Animated.Value(1)).current;
  React.useEffect(() => {
    if (!visible) {
      opacity.setValue(0);
      return;
    }
    opacity.setValue(1);
    // 设计稿 steps(1) 硬闪：半周期内保持，到点跳变
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(TaskFoldMotion.habitCaretBlink),
        Animated.timing(opacity, {
          toValue: 0,
          duration: 1,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
        Animated.delay(TaskFoldMotion.habitCaretBlink),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 1,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity, visible]);
  if (!visible) return null;
  return <Animated.View style={[styles.caret, { backgroundColor: tf.frog, opacity }]} />;
}

export function HabitTypeCard({
  kind,
  selected,
  onPress,
}: {
  kind: HabitKind;
  selected: boolean;
  onPress: () => void;
}) {
  const { tf, isDark } = useTaskFoldTheme();
  const meta = HBT_KIND_META[kind];
  const tick = React.useRef(new Animated.Value(selected ? 1 : 0)).current;
  React.useEffect(() => {
    Animated.timing(tick, {
      toValue: selected ? 1 : 0,
      duration: 240,
      easing: FOLD_MOTION_SPRING,
      useNativeDriver: true,
    }).start();
  }, [selected, tick]);
  const tickScale = tick.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] });

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.typeCard,
        {
          backgroundColor: selected
            ? isDark
              ? kind === 'build'
                ? tf.lily2
                : kind === 'break'
                  ? tf.rose2
                  : tf.sun2
              : meta.onBg
            : isDark
              ? tf.paper2
              : '#F3EFE4',
          borderColor: selected ? meta.onBorder : 'transparent',
          transform: [{ translateY: selected ? -1 : 0 }],
          opacity: pressed ? 0.9 : 1,
        },
      ]}>
      <View style={[styles.typeBar, { backgroundColor: selected ? meta.bar : '#CFCBC0' }]} />
      <Animated.View
        style={[
          styles.typeTick,
          { backgroundColor: tf.pond, opacity: tick, transform: [{ scale: tickScale }] },
        ]}>
        <MaterialIcons name="check" size={9} color="#fff" />
      </Animated.View>
      <Text style={[styles.typeTitle, { color: selected ? meta.titleOn : tf.ink2 }]}>{meta.label}</Text>
      <Text style={[styles.typeSub, { color: tf.faint }]} numberOfLines={1}>
        {meta.sub}
      </Text>
    </Pressable>
  );
}

export function HabitAccordion({
  open,
  onToggle,
  icon,
  iconTone,
  title,
  subtitle,
  summary,
  headerRight,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  icon: React.ReactNode;
  iconTone: 'green' | 'rose' | 'amber' | 'blue' | 'violet';
  title: string;
  subtitle: string;
  summary?: string;
  headerRight?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const { tf } = useTaskFoldTheme();
  const chev = React.useRef(new Animated.Value(open ? 1 : 0)).current;
  React.useEffect(() => {
    Animated.timing(chev, {
      toValue: open ? 1 : 0,
      duration: TaskFoldMotion.habitAccExpand,
      easing: FOLD_MOTION_EASE,
      useNativeDriver: true,
    }).start();
  }, [chev, open]);
  const rotate = chev.interpolate({ inputRange: [0, 1], outputRange: ['-90deg', '0deg'] });
  const toneBg =
    iconTone === 'green'
      ? '#E7EEDC'
      : iconTone === 'rose'
        ? '#F7E9E3'
        : iconTone === 'amber'
          ? '#F8EEDC'
          : iconTone === 'blue'
            ? '#E4EDF0'
            : '#EEE8F0';

  return (
    <View style={[styles.card, styles.accCard, { backgroundColor: tf.card, borderColor: tf.line2 }]}>
      <Pressable onPress={onToggle} style={({ pressed }) => [styles.accHead, pressed && { opacity: 0.88 }]}>
        <View style={[styles.aicon, { backgroundColor: toneBg }]}>{icon}</View>
        <View style={styles.accCopy}>
          <Text style={[styles.accTitle, { color: tf.ink2 }]}>{title}</Text>
          <Text style={[styles.accSub, { color: tf.faint }]} numberOfLines={1}>
            {subtitle}
          </Text>
        </View>
        {headerRight}
        {summary && !headerRight ? (
          <Text style={[styles.accSum, { color: tf.muted }]} numberOfLines={1}>
            {summary}
          </Text>
        ) : null}
        <Animated.View style={{ transform: [{ rotate }] }}>
          <MaterialIcons name="keyboard-arrow-down" size={18} color={tf.faint} />
        </Animated.View>
      </Pressable>
      {open ? <View style={styles.accBody}>{children}</View> : null}
    </View>
  );
}

export function HabitTile({
  icon,
  iconTone,
  title,
  subtitle,
  trailing,
  wide,
  onPress,
}: {
  icon: React.ReactNode;
  iconTone: 'green' | 'rose' | 'amber' | 'blue' | 'violet';
  title: string;
  subtitle: string;
  trailing: string;
  wide?: boolean;
  onPress: () => void;
}) {
  const { tf, isDark } = useTaskFoldTheme();
  const toneBg =
    iconTone === 'green'
      ? '#E7EEDC'
      : iconTone === 'rose'
        ? '#F7E9E3'
        : iconTone === 'amber'
          ? '#F8EEDC'
          : iconTone === 'blue'
            ? '#E4EDF0'
            : '#EEE8F0';
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.tile,
        wide && styles.tileWide,
        {
          backgroundColor: isDark ? tf.paper2 : '#F5F1E7',
          borderColor: tf.line,
          opacity: pressed ? 0.88 : 1,
        },
      ]}>
      <View style={[styles.aiconSm, { backgroundColor: toneBg }]}>{icon}</View>
      <View style={styles.tileCopy}>
        <Text style={[styles.tileTitle, { color: tf.ink2 }]} numberOfLines={1}>
          {title}
        </Text>
        <Text style={[styles.tileSub, { color: tf.faint }]} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
      <Text style={[styles.tileTrail, { color: tf.muted }]} numberOfLines={1}>
        {trailing}
      </Text>
    </Pressable>
  );
}

export function HabitScoreFade({
  animateKey,
  children,
  style,
}: {
  animateKey: string | number;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <FoldRiseIn
      key={String(animateKey)}
      animate
      index={0}
      duration={TaskFoldMotion.habitScoreFade}
      staggerMs={0}
      fromY={3}
      holdHidden={false}
      style={style}>
      {children}
    </FoldRiseIn>
  );
}

export function HabitCard({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const { tf } = useTaskFoldTheme();
  return (
    <View style={[styles.card, { backgroundColor: tf.card, borderColor: tf.line2 }, style]}>{children}</View>
  );
}

export function HabitSect({
  title,
  hint,
  count,
}: {
  title: string;
  hint?: string;
  count?: string;
}) {
  const { tf, isDark } = useTaskFoldTheme();
  return (
    <View style={styles.sect}>
      <Text style={[styles.sectTitle, { color: tf.ink2 }]}>{title}</Text>
      {hint ? <Text style={[styles.sectHint, { color: tf.faint }]}>{hint}</Text> : null}
      {count ? (
        <View
          style={[
            styles.sectCount,
            { backgroundColor: isDark ? 'rgba(241,237,225,0.12)' : '#F1EDE1' },
          ]}>
          <Text style={{ fontSize: 11, color: tf.muted }}>{count}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 10,
    marginBottom: 4,
  },
  caret: { width: 1.5, height: 16, marginLeft: 2, borderRadius: 1 },
  typeCard: {
    flex: 1,
    minHeight: 52,
    borderRadius: 11,
    borderWidth: 1,
    paddingTop: 8,
    paddingBottom: 6,
    paddingLeft: 12,
    paddingRight: 8,
    overflow: 'hidden',
    position: 'relative',
  },
  typeBar: {
    position: 'absolute',
    left: 0,
    top: 10,
    bottom: 10,
    width: 3,
    borderTopRightRadius: 2,
    borderBottomRightRadius: 2,
  },
  typeTick: {
    position: 'absolute',
    right: 6,
    top: 6,
    width: 14,
    height: 14,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  typeTitle: { fontSize: 12, fontWeight: '700', lineHeight: 16 },
  typeSub: { fontSize: 10, marginTop: 2, lineHeight: 13 },
  accCard: { padding: 0, overflow: 'hidden' },
  accHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    minHeight: 42,
  },
  accCopy: { flex: 1, minWidth: 0 },
  accTitle: { fontSize: 13, fontWeight: '600' },
  accSub: { fontSize: 10, marginTop: 2 },
  accSum: { fontSize: 11, maxWidth: 72 },
  accBody: { paddingHorizontal: 10, paddingBottom: 10 },
  aicon: {
    width: 26,
    height: 26,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  aiconSm: {
    width: 20,
    height: 20,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 9,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 6,
    paddingVertical: 6,
    minHeight: 40,
    width: '48%',
    flexGrow: 1,
  },
  tileWide: { width: '100%' },
  tileCopy: { flex: 1, minWidth: 0 },
  tileTitle: { fontSize: 12, fontWeight: '600' },
  tileSub: { fontSize: 10, marginTop: 1 },
  tileTrail: { fontSize: 10 },
  sect: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  sectTitle: { fontSize: 13, fontWeight: '700' },
  sectHint: { fontSize: 11 },
  sectCount: { marginLeft: 'auto', borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 },
});
