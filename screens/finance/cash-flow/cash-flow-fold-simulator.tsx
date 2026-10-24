/**
 * 决策模拟 · 对齐设计稿 16（滑杆情景 / 对比卡 / 差额 / 24 月柱 / AI 建议）
 */
import {
  FoldCountUpText,
  FoldPopIn,
  FoldRiseIn,
  FOLD_MOTION_EASE,
  useFoldMotionGate,
} from '@/components/review/fold-motion';
import { useFinanceFoldTheme } from '@/constants/finance-fold-theme';
import { calculateCashFlowMetrics, type CashFlowMetrics } from '@/lib/cash-flow/cash-flow-metrics';
import type { CashFlowState } from '@/lib/repositories/cash-flow/cash-flow.types';
import { MaterialIcons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import Reanimated from 'react-native-reanimated';

function formatMoney(value: number) {
  return `¥${value.toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function formatSignedMoney(value: number) {
  const sign = value >= 0 ? '+' : '-';
  return `${sign}¥${Math.abs(value).toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

type ScenarioId = 'A' | 'B';

type ScenarioParams = {
  label: string;
  price: number;
  downPct: number;
  monthlyIn: number;
  monthlyOut: number;
};

const SCENARIO_PRESETS: Record<ScenarioId, ScenarioParams> = {
  A: { label: '假设买房', price: 1_800_000, downPct: 30, monthlyIn: 18_600, monthlyOut: 11_200 },
  B: { label: '首付更低方案', price: 1_800_000, downPct: 25, monthlyIn: 18_600, monthlyOut: 10_200 },
};

const PRICE_MIN = 500_000;
const PRICE_MAX = 5_000_000;
const DOWN_MIN = 10;
const DOWN_MAX = 60;
const FLOW_MIN = 0;
const FLOW_MAX = 50_000;

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function monthsToCover(progressPct: number, monthlyGainPct: number, target = 50) {
  if (progressPct >= target) return 0;
  if (monthlyGainPct <= 0.01) return 999;
  return Math.ceil((target - progressPct) / monthlyGainPct);
}

/** 折页滑杆：拖动 + 点按，拇指圆点对齐设计稿 */
function FoldSlider({
  value,
  min,
  max,
  onChange,
  trackColor,
  fillColor,
  thumbBorder,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (next: number) => void;
  trackColor: string;
  fillColor: string;
  thumbBorder: string;
}) {
  const widthSv = useRef(1);
  const setFromX = useCallback(
    (x: number, width: number) => {
      if (width <= 0) return;
      const ratio = clamp(x / width, 0, 1);
      const raw = min + ratio * (max - min);
      onChange(Math.round(raw));
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
          <View style={[styles.sliderFill, { width: `${ratio * 100}%`, backgroundColor: fillColor }]} />
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

/** 8 组双柱：不买房 vs 情景，错峰 35ms × 580ms */
function SimForecastBars({
  baseStart,
  simStart,
  animate,
}: {
  baseStart: number;
  simStart: number;
  animate: boolean;
}) {
  const { ff, isDark, fonts } = useFinanceFoldTheme();
  const baseEnd = Math.min(0.98, baseStart + Math.max(0.1, (1 - baseStart) * 0.55));
  const simEnd = Math.min(0.98, simStart + Math.max(0.06, (1 - simStart) * 0.35));

  const pairs = useMemo(() => {
    return Array.from({ length: 8 }, (_, i) => {
      const t = i / 7;
      return {
        base: baseStart + (baseEnd - baseStart) * t,
        sim: simStart + (simEnd - simStart) * t,
        delay: i * 35,
      };
    });
  }, [baseEnd, baseStart, simEnd, simStart]);

  const heights = useRef(pairs.map(() => new Animated.Value(animate ? 0 : 1))).current;

  useEffect(() => {
    if (!animate) {
      heights.forEach((h) => h.setValue(1));
      return;
    }
    heights.forEach((h) => h.setValue(0));
    const anims = pairs.map((p, i) =>
      Animated.timing(heights[i]!, {
        toValue: 1,
        duration: 580,
        delay: 120 + p.delay,
        easing: FOLD_MOTION_EASE,
        useNativeDriver: false,
      }),
    );
    const batch = Animated.parallel(anims);
    batch.start();
    return () => batch.stop();
  }, [animate, heights, pairs]);

  const barBase = isDark ? ff.sage : '#779887';
  const barSim = isDark ? ff.clay : '#C8785C';
  const mono = fonts.mono;

  return (
    <View>
      <View style={styles.barsRow}>
        {pairs.map((p, i) => (
          <View key={i} style={styles.barPair}>
            <Animated.View
              style={[
                styles.bar,
                {
                  backgroundColor: barBase,
                  height: heights[i]!.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, Math.max(8, p.base * 78)],
                  }),
                },
              ]}
            />
            <Animated.View
              style={[
                styles.bar,
                {
                  backgroundColor: barSim,
                  height: heights[i]!.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, Math.max(5, p.sim * 78)],
                  }),
                },
              ]}
            />
          </View>
        ))}
      </View>
      <View style={styles.barX}>
        {['现在', '6 月', '12 月', '18 月', '24 月'].map((l) => (
          <Text key={l} style={[styles.barXLabel, { color: ff.faint, fontFamily: mono }]}>
            {l}
          </Text>
        ))}
      </View>
    </View>
  );
}

export function CashFlowFoldSimulator({
  state,
  currentMetrics,
  showToast,
  onSaveRequest,
}: {
  state: CashFlowState;
  currentMetrics: CashFlowMetrics;
  showToast: (m: string, t?: 'success' | 'warning') => void;
  /** 顶栏「保存」可触发同一逻辑 */
  onSaveRequest?: (handler: () => void) => void;
}) {
  const { ff, isDark, fonts } = useFinanceFoldTheme();
  const { animate } = useFoldMotionGate();
  const mono = fonts.mono;

  const [scenario, setScenario] = useState<ScenarioId>('A');
  const [price, setPrice] = useState(SCENARIO_PRESETS.A.price);
  const [downPct, setDownPct] = useState(SCENARIO_PRESETS.A.downPct);
  const [monthlyIn, setMonthlyIn] = useState(
    Math.round(currentMetrics.totalIncome) || SCENARIO_PRESETS.A.monthlyIn,
  );
  const [monthlyOut, setMonthlyOut] = useState(
    Math.round(currentMetrics.totalExpenses) || SCENARIO_PRESETS.A.monthlyOut,
  );

  const applyPreset = useCallback(
    (id: ScenarioId) => {
      const p = SCENARIO_PRESETS[id];
      setScenario(id);
      setPrice(p.price);
      setDownPct(p.downPct);
      setMonthlyIn(Math.round(currentMetrics.totalIncome) || p.monthlyIn);
      // 情景 B：月供更低；相对当前流出做偏移
      const baseOut = Math.round(currentMetrics.totalExpenses) || p.monthlyOut;
      setMonthlyOut(id === 'B' ? Math.max(FLOW_MIN, baseOut - 1000) : Math.max(baseOut, p.monthlyOut));
    },
    [currentMetrics.totalExpenses, currentMetrics.totalIncome],
  );

  const downPayment = Math.round((price * downPct) / 100);
  const loanPrincipal = Math.max(0, price - downPayment);
  /** 相对当前模型，多出的月流出视作新增负债月供；多出的流入视作资产回报 */
  const extraOut = Math.max(0, monthlyOut - currentMetrics.totalExpenses);
  const extraIn = Math.max(0, monthlyIn - currentMetrics.totalIncome);
  const reducedOut = Math.max(0, currentMetrics.totalExpenses - monthlyOut);
  const reducedIn = Math.max(0, currentMetrics.totalIncome - monthlyIn);

  const simulatedState = useMemo((): CashFlowState => {
    const holdings = [...state.holdings];
    // 买房：首付不进月度模型；贷款本金 + 月供差额写入台账项
    holdings.push({
      id: 'cf-sim-temp',
      name: SCENARIO_PRESETS[scenario].label,
      principal: loanPrincipal,
      inflow: extraIn,
      outflow: extraOut > 0 ? extraOut : 0,
      extra: extraOut > 0 ? { repayMonths: 240 } : undefined,
    });
    let necessary = state.necessaryExpenses;
    let unnecessary = state.unnecessaryExpenses;
    // 若整体月流出下降，优先压缩非必要
    if (reducedOut > 0) {
      const cutUn = Math.min(unnecessary, reducedOut);
      unnecessary -= cutUn;
      necessary = Math.max(0, necessary - (reducedOut - cutUn));
    }
    let incomes = state.incomes;
    if (reducedIn > 0 && incomes.length > 0) {
      // 等比下调主动收入预览（不落库）
      const active = incomes.filter((i) => i.quadrant === 'E' || i.quadrant === 'S');
      const activeSum = active.reduce((s, i) => s + i.amount, 0) || 1;
      incomes = incomes.map((i) => {
        if (i.quadrant !== 'E' && i.quadrant !== 'S') return i;
        const share = i.amount / activeSum;
        return { ...i, amount: Math.max(0, i.amount - reducedIn * share) };
      });
    }
    return { ...state, holdings, necessaryExpenses: necessary, unnecessaryExpenses: unnecessary, incomes };
  }, [
    extraIn,
    extraOut,
    loanPrincipal,
    reducedIn,
    reducedOut,
    scenario,
    state,
  ]);

  const simMetrics = useMemo(() => calculateCashFlowMetrics(simulatedState), [simulatedState]);

  const deltaFcf = simMetrics.freeCashFlow - currentMetrics.freeCashFlow;
  const deltaProgress = simMetrics.freedomProgress - currentMetrics.freedomProgress;
  const baseGainPerMonth = Math.max(0.15, (50 - Math.min(49, currentMetrics.freedomProgress)) / 36);
  const simGainPerMonth = Math.max(0.05, baseGainPerMonth + deltaProgress / 36);
  const monthsBase = monthsToCover(currentMetrics.freedomProgress, baseGainPerMonth, 50);
  const monthsSim = monthsToCover(simMetrics.freedomProgress, simGainPerMonth, 50);
  const delayMonths = monthsSim - monthsBase;

  const aiTip = useMemo(() => {
    if (deltaFcf >= 0 && deltaProgress >= 0) {
      return '此情景对自由现金流与覆盖率均为正向，可考虑推进；仍建议保留至少 6 个月应急金。';
    }
    if (downPct > 28 && extraOut > 2500) {
      return `若把首付降到 25% 并将月供控制在 ¥5,000 内，自由现金流仍可保持为正；否则建议先积累 6 个月应急金。`;
    }
    if (simMetrics.freeCashFlow < 0) {
      return '模拟后自由现金流转负，短期抗风险能力下降。建议下调总价、提高首付或推迟购买。';
    }
    return `自由现金流每月减少 ${formatMoney(Math.abs(deltaFcf))}。可对比「首付更低方案」，或先把应急金补到 6 个月再决策。`;
  }, [deltaFcf, deltaProgress, downPct, extraOut, simMetrics.freeCashFlow]);

  const handleSave = useCallback(() => {
    showToast('已保存决策模拟', 'success');
  }, [showToast]);

  useEffect(() => {
    onSaveRequest?.(handleSave);
  }, [handleSave, onSaveRequest]);

  const cardBg = ff.card;
  const softBg = isDark ? ff.paper2 : '#F7F2E7';
  const softBorder = isDark ? ff.line : '#E5DBC9';
  const afterBg = isDark ? ff.sage2 : '#E9F0E9';
  const afterBorder = isDark ? ff.line : '#C9DDD0';
  const deltaBg = isDark ? ff.amber2 : '#F4E5D7';
  const deltaBorder = isDark ? ff.line : '#E8CEB5';
  const aiBg = isDark ? ff.amber2 : '#F3EDE0';
  const aiBorder = isDark ? ff.line : '#E8D9BF';
  const track = isDark ? 'rgba(255,255,255,0.1)' : '#E7E1D5';
  const fill = isDark ? ff.sage : '#6F9A83';
  const rowBorder = isDark ? ff.line : '#ECE4D6';

  let rise = 0;
  const nextRise = () => rise++;

  const deltaIcon =
    deltaFcf < 0 ? ('arrow-downward' as const) : deltaFcf > 0 ? ('arrow-upward' as const) : ('remove' as const);

  return (
    <View style={styles.root}>
      <FoldRiseIn animate={animate} index={nextRise()} fromY={11}>
        <View style={[styles.card, { backgroundColor: cardBg, borderColor: ff.line }]}>
          <View style={styles.simHead}>
            <View style={[styles.simIcon, { backgroundColor: isDark ? ff.amber2 : '#F4E9D7' }]}>
              <MaterialIcons name="home" size={12} color={isDark ? ff.amberInk : '#996A2F'} />
            </View>
            <Text style={[styles.simTitle, { color: ff.ink }]}>{SCENARIO_PRESETS[scenario].label}</Text>
            <View style={[styles.tagAmber, { backgroundColor: isDark ? ff.amber2 : '#F4EAD9' }]}>
              <Text style={[styles.tagAmberText, { color: ff.amberInk }]}>情景 {scenario}</Text>
            </View>
          </View>

          <View style={[styles.simRow, { borderBottomColor: rowBorder }]}>
            <Text style={[styles.sl, { color: ff.muted }]}>房屋总价</Text>
            <Text style={[styles.sv, { color: ff.ink2, fontFamily: mono }]}>{formatMoney(price)}</Text>
          </View>
          <FoldSlider
            value={price}
            min={PRICE_MIN}
            max={PRICE_MAX}
            onChange={setPrice}
            trackColor={track}
            fillColor={fill}
            thumbBorder={fill}
          />

          <View style={[styles.simRow, { borderBottomColor: rowBorder }]}>
            <Text style={[styles.sl, { color: ff.muted }]}>首付比例</Text>
            <Text style={[styles.sv, { color: ff.ink2, fontFamily: mono }]}>
              {downPct}% · {formatMoney(downPayment)}
            </Text>
          </View>
          <FoldSlider
            value={downPct}
            min={DOWN_MIN}
            max={DOWN_MAX}
            onChange={setDownPct}
            trackColor={track}
            fillColor={fill}
            thumbBorder={fill}
          />

          <View style={[styles.simRow, { borderBottomColor: rowBorder }]}>
            <Text style={[styles.sl, { color: ff.muted }]}>月流入</Text>
            <Text style={[styles.sv, { color: ff.ink2, fontFamily: mono }]}>{formatMoney(monthlyIn)}</Text>
          </View>
          <FoldSlider
            value={monthlyIn}
            min={FLOW_MIN}
            max={FLOW_MAX}
            onChange={setMonthlyIn}
            trackColor={track}
            fillColor={fill}
            thumbBorder={fill}
          />

          <View style={[styles.simRow, { borderBottomWidth: 0 }]}>
            <Text style={[styles.sl, { color: ff.muted }]}>月流出（含月供）</Text>
            <Text style={[styles.sv, { color: ff.ink2, fontFamily: mono }]}>{formatMoney(monthlyOut)}</Text>
          </View>
          <FoldSlider
            value={monthlyOut}
            min={FLOW_MIN}
            max={FLOW_MAX}
            onChange={setMonthlyOut}
            trackColor={track}
            fillColor={fill}
            thumbBorder={fill}
          />
        </View>
      </FoldRiseIn>

      <FoldRiseIn animate={animate} index={nextRise()} fromY={11}>
        <View style={styles.compare}>
          <View style={[styles.compareCard, { backgroundColor: softBg, borderColor: softBorder }]}>
            <Text style={[styles.compareLab, { color: ff.faint }]}>当前自由现金流</Text>
            <FoldCountUpText
              value={currentMetrics.freeCashFlow}
              animate={animate}
              duration={760}
              delayMs={60}
              textStyle={[styles.compareVal, { color: ff.ink2, fontFamily: mono }]}
              formatter={(n) => formatSignedMoney(n)}
            />
            <Text style={[styles.compareSub, { color: ff.faint }]}>
              自由进度 {currentMetrics.freedomProgress.toFixed(0)}%
            </Text>
          </View>
          <View style={[styles.compareCard, { backgroundColor: afterBg, borderColor: afterBorder }]}>
            <Text style={[styles.compareLab, { color: isDark ? ff.muted : '#6B8B7A' }]}>模拟后</Text>
            <FoldCountUpText
              value={simMetrics.freeCashFlow}
              animate={animate}
              duration={760}
              delayMs={100}
              textStyle={[styles.compareVal, { color: isDark ? ff.pine : '#316148', fontFamily: mono }]}
              formatter={(n) => formatSignedMoney(n)}
            />
            <Text style={[styles.compareSub, { color: isDark ? ff.muted : '#6B8B7A' }]}>
              自由进度 {simMetrics.freedomProgress.toFixed(0)}%
            </Text>
          </View>
        </View>
      </FoldRiseIn>

      <FoldPopIn animate={animate} delayMs={120} duration={380}>
        <View style={[styles.deltaCard, { backgroundColor: deltaBg, borderColor: deltaBorder }]}>
          <MaterialIcons name={deltaIcon} size={16} color={ff.amberInk} />
          <Text style={[styles.deltaText, { color: isDark ? ff.amberInk : '#8A5A37' }]}>
            {deltaFcf === 0 && delayMonths === 0
              ? '情景对自由现金流与达成节奏影响很小。'
              : `自由现金流每月${deltaFcf <= 0 ? '减少' : '增加'} `}
            {deltaFcf !== 0 ? (
              <Text style={{ fontFamily: mono, fontWeight: '700' }}>{formatMoney(Math.abs(deltaFcf))}</Text>
            ) : null}
            {delayMonths !== 0 ? (
              <>
                {deltaFcf !== 0 ? '，' : ''}
                达成 50% 覆盖率预计{delayMonths > 0 ? '推迟' : '提前'}{' '}
                <Text style={{ fontFamily: mono, fontWeight: '700' }}>{Math.abs(delayMonths)} 个月</Text>
                。
              </>
            ) : deltaFcf !== 0 ? (
              '。'
            ) : null}
          </Text>
        </View>
      </FoldPopIn>

      <FoldRiseIn animate={animate} index={nextRise()} fromY={11}>
        <View style={[styles.card, { backgroundColor: cardBg, borderColor: ff.line }]}>
          <View style={styles.chartHead}>
            <Text style={[styles.chartTitle, { color: ff.ink }]}>未来 24 个月进度</Text>
            <View style={styles.legend2}>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: isDark ? ff.sage : '#779887' }]} />
                <Text style={[styles.legendText, { color: ff.muted }]}>不买房</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: isDark ? ff.clay : '#C8785C' }]} />
                <Text style={[styles.legendText, { color: ff.muted }]}>情景 {scenario}</Text>
              </View>
            </View>
          </View>
          <SimForecastBars
            baseStart={Math.max(0.05, Math.min(0.95, currentMetrics.freedomProgress / 100))}
            simStart={Math.max(0.05, Math.min(0.95, simMetrics.freedomProgress / 100))}
            animate={animate}
          />
        </View>
      </FoldRiseIn>

      <FoldRiseIn animate={animate} index={nextRise()} fromY={11}>
        <View style={[styles.aiInsight, { backgroundColor: aiBg, borderColor: aiBorder }]}>
          <MaterialIcons name="auto-awesome" size={14} color={ff.amber} style={{ marginTop: 2 }} />
          <Text style={[styles.aiBody, { color: isDark ? ff.ink2 : '#6D6658' }]}>
            <Text style={{ fontWeight: '700', color: isDark ? ff.ink : '#514B40' }}>AI 建议：</Text>
            {aiTip}
          </Text>
        </View>
      </FoldRiseIn>

      <FoldRiseIn animate={animate} index={nextRise()} fromY={11}>
        <View style={styles.actions}>
          <Pressable
            onPress={() => {
              const next: ScenarioId = scenario === 'A' ? 'B' : 'A';
              applyPreset(next);
              showToast('已切换另一个情景', 'success');
            }}
            style={({ pressed }) => [
              styles.ghostBtn,
              { borderColor: ff.line, backgroundColor: cardBg, opacity: pressed ? 0.85 : 1 },
            ]}>
            <Text style={[styles.ghostBtnText, { color: ff.ink2 }]}>对比另一方案</Text>
          </Pressable>
          <Pressable
            onPress={handleSave}
            style={({ pressed }) => [
              styles.primaryBtn,
              { backgroundColor: ff.pine, opacity: pressed ? 0.9 : 1 },
            ]}>
            <Text style={styles.primaryBtnText}>保存这个判断</Text>
          </Pressable>
        </View>
      </FoldRiseIn>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { paddingBottom: 12 },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 11,
    marginBottom: 8,
  },
  simHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  simIcon: {
    width: 22,
    height: 22,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  simTitle: { fontSize: 13, fontWeight: '700', flex: 1 },
  tagAmber: {
    height: 20,
    paddingHorizontal: 7,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tagAmberText: { fontSize: 10, fontWeight: '700' },
  simRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 8,
    paddingBottom: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sl: { fontSize: 12 },
  sv: { fontSize: 13, fontWeight: '700' },
  sliderHit: { height: 22, justifyContent: 'center', marginBottom: 2 },
  sliderTrack: { height: 3, borderRadius: 4, position: 'relative' },
  sliderFill: { height: '100%', borderRadius: 4 },
  sliderThumb: {
    position: 'absolute',
    top: '50%',
    width: 12,
    height: 12,
    marginLeft: -6,
    marginTop: -6,
    borderRadius: 6,
    backgroundColor: '#FFFCF5',
    borderWidth: 2,
    shadowColor: '#28322A',
    shadowOpacity: 0.15,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  compare: { flexDirection: 'row', gap: 7, marginBottom: 8 },
  compareCard: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    padding: 11,
  },
  compareLab: { fontSize: 10 },
  compareVal: { fontSize: 20, fontWeight: '700', marginTop: 4 },
  compareSub: { fontSize: 10, marginTop: 3 },
  deltaCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 11,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
  },
  deltaText: { flex: 1, fontSize: 12, lineHeight: 18 },
  chartHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  chartTitle: { fontSize: 13, fontWeight: '700' },
  legend2: { flexDirection: 'row', gap: 10 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 7, height: 7, borderRadius: 2 },
  legendText: { fontSize: 10 },
  barsRow: {
    height: 86,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 4,
  },
  barPair: {
    flex: 1,
    height: '100%',
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 2,
  },
  bar: { width: 5, borderRadius: 2 },
  barX: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 5 },
  barXLabel: { fontSize: 10 },
  aiInsight: {
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 11,
    paddingHorizontal: 11,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 10,
  },
  aiBody: { flex: 1, fontSize: 12, lineHeight: 19 },
  actions: { flexDirection: 'row', gap: 7 },
  ghostBtn: {
    flex: 1,
    height: 44,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghostBtnText: { fontSize: 13, fontWeight: '700' },
  primaryBtn: {
    flex: 1.2,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: { color: '#F8F3E9', fontSize: 14, fontWeight: '800' },
});
