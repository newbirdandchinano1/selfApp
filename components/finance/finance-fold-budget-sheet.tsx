/**
 * 折页 · 预算调整弹层 — 对齐 `finance-screens/财务APP-设计稿.html` 21
 * 环形重算 · 滑杆联动 · 预扣明细 · 弹簧弹层（380ms / 遮罩 280ms）
 */
import {
  FinanceFoldSheetChrome,
  FinanceFoldSheetHead,
} from '@/components/finance/finance-fold-record-sheet';
import {
  FOLD_MOTION_EASE,
  FoldRiseIn,
  useFoldMotionGate,
} from '@/components/review/fold-motion';
import {
  financeFoldFonts,
  type FinanceFoldPalette,
} from '@/constants/finance-fold-theme';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import Reanimated from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function formatMoney0(n: number) {
  return `¥${Math.round(n).toLocaleString('zh-CN')}`;
}

function formatMoney2(n: number) {
  const abs = Math.abs(n);
  return `¥${abs.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** 预算滑杆：拖动即改数字，松手不重入场 */
function BudgetSlider({
  value,
  min,
  max,
  onChange,
  trackColor,
  fillColors,
  thumbBorder,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (next: number) => void;
  trackColor: string;
  fillColors: [string, string];
  thumbBorder: string;
}) {
  const widthSv = useRef(1);
  const setFromX = useCallback(
    (x: number, width: number) => {
      if (width <= 0) return;
      const ratio = clamp(x / width, 0, 1);
      const raw = min + ratio * (max - min);
      // 100 元步进，贴近设计稿滑杆手感
      onChange(Math.round(raw / 100) * 100);
    },
    [max, min, onChange],
  );

  const pan = Gesture.Pan()
    .onBegin((e) => {
      runOnJS(setFromX)(e.x, widthSv.current);
    })
    .onUpdate((e) => {
      runOnJS(setFromX)(e.x, widthSv.current);
    });
  const tap = Gesture.Tap().onEnd((e) => {
    runOnJS(setFromX)(e.x, widthSv.current);
  });
  const gesture = Gesture.Simultaneous(pan, tap);
  const ratio = max > min ? clamp((value - min) / (max - min), 0, 1) : 0;

  return (
    <GestureDetector gesture={gesture}>
      <Reanimated.View
        style={styles.sliderHit}
        onLayout={(e) => {
          widthSv.current = Math.max(1, e.nativeEvent.layout.width);
        }}>
        <View style={[styles.sliderTrack, { backgroundColor: trackColor }]}>
          <View
            style={[
              styles.sliderFill,
              {
                width: `${ratio * 100}%`,
                backgroundColor: fillColors[0],
              },
            ]}
          />
          <View
            style={[
              styles.sliderThumb,
              {
                left: `${ratio * 100}%`,
                borderColor: thumbBorder,
              },
            ]}
          />
        </View>
      </Reanimated.View>
    </GestureDetector>
  );
}

/** 首次 760ms count-up；之后跟手更新，避免滑杆时重播入场 */
function BudgetAmountDisplay({
  value,
  animate,
  color,
  mono,
}: {
  value: number;
  animate: boolean;
  color: string;
  mono: string;
}) {
  const [display, setDisplay] = useState(animate ? 0 : value);
  const entered = useRef(false);
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!animate) {
      setDisplay(value);
      entered.current = true;
      return;
    }
    if (!entered.current) {
      entered.current = true;
      anim.setValue(0);
      setDisplay(0);
      const id = anim.addListener(({ value: v }) => setDisplay(v));
      const runner = Animated.timing(anim, {
        toValue: value,
        duration: 760,
        easing: FOLD_MOTION_EASE,
        useNativeDriver: false,
      });
      runner.start(() => anim.removeListener(id));
      return () => {
        anim.removeListener(id);
        runner.stop();
      };
    }
    setDisplay(value);
  }, [animate, anim, value]);

  return (
    <Text style={[styles.heroAmount, { color, fontFamily: mono }]}>{formatMoney0(display)}</Text>
  );
}

function TodayAvailableRing({
  pct,
  amountLabel,
  animate,
  ff,
  fonts,
}: {
  pct: number;
  amountLabel: string;
  animate: boolean;
  ff: FinanceFoldPalette;
  fonts: typeof financeFoldFonts;
}) {
  const size = 92;
  const stroke = 6;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = clamp(pct, 0, 1);
  const progress = useRef(new Animated.Value(animate ? 0 : p)).current;
  const drawnOnce = useRef(false);

  useEffect(() => {
    if (!animate) {
      progress.setValue(p);
      drawnOnce.current = true;
      return;
    }
    // 首次入场 1.05s 描边；拖动滑杆时仅短补间，不重新入场
    const first = !drawnOnce.current;
    if (first) {
      drawnOnce.current = true;
      progress.setValue(0);
    }
    const anim = Animated.timing(progress, {
      toValue: p,
      duration: first ? 1050 : 220,
      delay: first ? 180 : 0,
      easing: FOLD_MOTION_EASE,
      useNativeDriver: false,
    });
    anim.start();
    return () => anim.stop();
  }, [animate, p, progress]);

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={ff.line2}
          strokeWidth={stroke}
          fill="none"
        />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={ff.amber}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={`${c}`}
          strokeDashoffset={progress.interpolate({
            inputRange: [0, 1],
            outputRange: [c, 0],
          })}
          strokeLinecap="round"
        />
      </Svg>
      <View style={styles.ringCenter}>
        <Text style={[styles.ringValue, { color: ff.pine, fontFamily: fonts.mono }]} numberOfLines={1}>
          {amountLabel}
        </Text>
        <Text style={[styles.ringLabel, { color: ff.muted }]}>今日可用</Text>
      </View>
    </View>
  );
}

export type FinanceFoldBudgetSheetProps = {
  visible: boolean;
  ff: FinanceFoldPalette;
  isDark: boolean;
  paddingBottom: number;
  maxHeight: number;
  /** 弹层标题月/周期文案，如「本月」 */
  scopeLabel: string;
  budgetAmount: number;
  budgetUsedAmount: number;
  budgetUsedPercent: number;
  todayAvailable: number;
  todayRingPct: number;
  scheduledDeduction: number;
  /** 是否已配置本月预算（用于「可撤销」） */
  hasSavedBudget: boolean;
  aiHint: string;
  onClose: () => void;
  onChangeBudget: (amount: number) => void;
  onManageScheduled: () => void;
  onReset: () => void;
  onSave: () => void;
};

export function FinanceFoldBudgetSheet({
  visible,
  ff,
  isDark,
  paddingBottom,
  maxHeight,
  scopeLabel,
  budgetAmount,
  budgetUsedAmount,
  budgetUsedPercent,
  todayAvailable,
  todayRingPct,
  scheduledDeduction,
  hasSavedBudget,
  aiHint,
  onClose,
  onChangeBudget,
  onManageScheduled,
  onReset,
  onSave,
}: FinanceFoldBudgetSheetProps) {
  const { animate } = useFoldMotionGate();
  const fonts = financeFoldFonts;

  const sliderBounds = useMemo(() => {
    const mid = Math.max(budgetAmount, 8000);
    const min = 0;
    const max = Math.max(20_000, Math.ceil((mid * 1.8) / 1000) * 1000);
    return { min, max };
  }, [budgetAmount]);

  const suggestLo = Math.round(sliderBounds.max * 0.5);
  const suggestHi = Math.round(sliderBounds.max * 0.7);

  if (!visible) return null;

  return (
    <FinanceFoldSheetChrome
      ff={ff}
      isDark={isDark}
      paddingBottom={paddingBottom}
      maxHeight={maxHeight}
      marginBottom={0}
      onClose={onClose}
      style={styles.sheet}>
      <FinanceFoldSheetHead
        ff={ff}
        fonts={fonts}
        title={`调整${scopeLabel}预算`}
        subtitle="调高或调低都会实时更新「今日可用」。"
        onClose={onClose}
      />

      <FoldRiseIn animate={animate} index={0} staggerMs={45} fromY={11} delayMs={80}>
        <View style={styles.heroRow}>
          <TodayAvailableRing
            pct={todayRingPct}
            amountLabel={formatMoney0(todayAvailable)}
            animate={animate}
            ff={ff}
            fonts={fonts}
          />
          <View style={styles.heroCopy}>
            <Text style={[styles.heroKicker, { color: ff.muted }]}>{scopeLabel}预算</Text>
            {/* 入场用 count-up；拖动滑杆时只同步数字，不重新入场 */}
            <BudgetAmountDisplay
              value={budgetAmount}
              animate={animate}
              color={ff.pine}
              mono={fonts.mono}
            />
            <Text style={[styles.heroUsed, { color: ff.muted }]}>
              已用 {formatMoney2(budgetUsedAmount)} · {Math.round(budgetUsedPercent)}%
            </Text>
          </View>
        </View>
      </FoldRiseIn>

      <FoldRiseIn animate={animate} index={1} staggerMs={45} fromY={8} delayMs={80}>
        <View style={styles.sliderLabels}>
          <Text style={[styles.sliderEdge, { color: ff.faint, fontFamily: fonts.mono }]}>
            {formatMoney0(Math.max(sliderBounds.min, 8000))}
          </Text>
          <Text style={[styles.sliderHint, { color: ff.faint }]}>
            建议 {formatMoney0(suggestLo)} – {formatMoney0(suggestHi)}
          </Text>
          <Text style={[styles.sliderEdge, { color: ff.faint, fontFamily: fonts.mono }]}>
            {formatMoney0(sliderBounds.max)}
          </Text>
        </View>
        <BudgetSlider
          value={clamp(budgetAmount, sliderBounds.min, sliderBounds.max)}
          min={sliderBounds.min}
          max={sliderBounds.max}
          onChange={onChangeBudget}
          trackColor={isDark ? 'rgba(235,219,189,0.14)' : '#E7E1D5'}
          fillColors={['#D8A35E', '#E8C68F']}
          thumbBorder="#D08E40"
        />
      </FoldRiseIn>

      <FoldRiseIn animate={animate} index={2} staggerMs={45} fromY={8} delayMs={100}>
        <Pressable
          onPress={onManageScheduled}
          style={({ pressed }) => [styles.formRow, { borderBottomColor: ff.line }, pressed && { opacity: 0.75 }]}
          accessibilityRole="button"
          accessibilityLabel="管理定时支出预扣">
          <Text style={[styles.formLabel, { color: ff.muted }]}>定时支出已预扣</Text>
          <View style={styles.formRight}>
            <Text style={[styles.formValue, { color: ff.ink, fontFamily: fonts.mono }]}>
              {formatMoney0(scheduledDeduction)}
            </Text>
            <MaterialIcons name="chevron-right" size={16} color={ff.faint} />
          </View>
        </Pressable>
        <Pressable
          onPress={hasSavedBudget ? onReset : undefined}
          disabled={!hasSavedBudget}
          style={({ pressed }) => [
            styles.formRow,
            { borderBottomColor: 'transparent' },
            pressed && hasSavedBudget && { opacity: 0.75 },
          ]}
          accessibilityRole="button"
          accessibilityLabel={hasSavedBudget ? '撤销本月预算调整' : undefined}>
          <Text style={[styles.formLabel, { color: ff.muted }]}>{scopeLabel}已有预算调整</Text>
          <Text style={[styles.formMuted, { color: ff.faint }]}>
            {hasSavedBudget ? '已设置 · 可撤销' : '尚未设置'}
          </Text>
        </Pressable>
      </FoldRiseIn>

      <FoldRiseIn animate={animate} index={3} staggerMs={45} fromY={8} delayMs={120}>
        <View style={styles.aiLine}>
          <MaterialIcons name="auto-awesome" size={14} color={ff.amber} />
          <Text style={[styles.aiText, { color: ff.muted }]}>{aiHint}</Text>
        </View>
      </FoldRiseIn>

      <FoldRiseIn animate={animate} index={4} staggerMs={45} fromY={10} delayMs={140}>
        <View style={styles.actions}>
          <Pressable
            onPress={onManageScheduled}
            style={({ pressed }) => [
              styles.ghostBtn,
              {
                backgroundColor: isDark ? ff.paper2 : ff.paper,
                borderColor: ff.line,
              },
              pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] },
            ]}
            accessibilityRole="button"
            accessibilityLabel="管理定时支出">
            <MaterialIcons name="event-repeat" size={16} color={ff.pine} />
            <Text style={[styles.ghostText, { color: ff.pine }]}>管理</Text>
          </Pressable>
          <Pressable
            onPress={onSave}
            style={({ pressed }) => [
              styles.primaryBtn,
              { backgroundColor: ff.pine },
              pressed && { opacity: 0.9, transform: [{ scale: 0.985 }] },
            ]}
            accessibilityRole="button"
            accessibilityLabel="保存新预算">
            <Text style={[styles.primaryText, { color: ff.onPine }]}>保存新预算</Text>
          </Pressable>
        </View>
      </FoldRiseIn>
    </FinanceFoldSheetChrome>
  );
}

const styles = StyleSheet.create({
  sheet: {
    paddingHorizontal: 16,
  },
  heroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginTop: 8,
    marginBottom: 14,
  },
  heroCopy: { flex: 1, minWidth: 0 },
  heroKicker: { fontSize: 11 },
  heroAmount: { fontSize: 26, fontWeight: '750', marginTop: 2, letterSpacing: -0.4 },
  heroUsed: { fontSize: 11, marginTop: 4 },
  ringCenter: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  ringValue: { fontSize: 15, fontWeight: '750' },
  ringLabel: { fontSize: 10, marginTop: 1 },
  sliderLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  sliderEdge: { fontSize: 10 },
  sliderHint: { fontSize: 10 },
  sliderHit: { height: 28, justifyContent: 'center', marginBottom: 10 },
  sliderTrack: { height: 5, borderRadius: 4, overflow: 'visible', position: 'relative' },
  sliderFill: { height: '100%', borderRadius: 4 },
  sliderThumb: {
    position: 'absolute',
    top: '50%',
    width: 15,
    height: 15,
    marginLeft: -7.5,
    marginTop: -7.5,
    borderRadius: 8,
    backgroundColor: '#FFFCF5',
    borderWidth: 2,
    shadowColor: '#322A1E',
    shadowOpacity: 0.15,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  formRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  formLabel: { fontSize: 13 },
  formRight: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  formValue: { fontSize: 13, fontWeight: '650' },
  formMuted: { fontSize: 13, fontWeight: '500' },
  aiLine: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginTop: 4,
    marginBottom: 4,
  },
  aiText: { flex: 1, fontSize: 12, lineHeight: 18 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  ghostBtn: {
    width: 84,
    height: 42,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  ghostText: { fontSize: 13, fontWeight: '700' },
  primaryBtn: {
    flex: 1,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { fontSize: 14, fontWeight: '750' },
});
