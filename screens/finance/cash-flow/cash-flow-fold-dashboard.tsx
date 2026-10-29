/**
 * 现金流看板 · 对齐设计稿 13（深色 pine 自由模型 + 表盘 / Sankey / 预测柱 / AI）
 */
import {
  FoldCountUpText,
  FoldRiseIn,
  FOLD_MOTION_EASE,
  useFoldMotionGate,
} from '@/components/review/fold-motion';
import { FINANCE_FOLD_DARK, financeFoldFonts } from '@/constants/finance-fold-theme';
import {
  buildCashFlowAiSummaryText,
  computeCashFlowAiFingerprint,
  type CashFlowMetrics,
} from '@/lib/cash-flow/cash-flow-metrics';
import type { CashFlowState } from '@/lib/repositories/cash-flow/cash-flow.types';
import {
  analyzeCashFlowDashboardFromText,
} from '@/lib/zhipu-image-parse';
import { MaterialIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Svg, { Circle, Path, Text as SvgText } from 'react-native-svg';

import {
  CashFlowFinanceInsightsProvider,
  useCashFlowHealthScore,
} from './cash-flow-finance-insights';

const ff = FINANCE_FOLD_DARK;
const mono = financeFoldFonts.mono;
const serif = financeFoldFonts.serif;

const CASH_FLOW_AI_CACHE_KEY = 'cash_flow_dashboard_ai_v2';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedPath = Animated.createAnimatedComponent(Path);

type NavTab = 'entry' | 'ledger' | 'simulator' | 'detail_active' | 'detail_passive' | 'detail_asset' | 'detail_liability' | 'detail_expense';

function formatMoney(value: number) {
  return `¥${value.toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function formatSignedMoney(value: number) {
  const sign = value >= 0 ? '+' : '-';
  return `${sign}¥${Math.abs(value).toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function formatCompactK(value: number) {
  const abs = Math.abs(value);
  if (abs >= 1000) {
    const k = abs / 1000;
    const s = k >= 10 ? k.toFixed(0) : k.toFixed(1);
    return `${value < 0 ? '-' : ''}¥${s}k`;
  }
  return formatMoney(value);
}

/** 自由进度环：1s 扫入（设计稿「自由表盘」） */
function FreedomGauge({
  progress01,
  animate,
}: {
  progress01: number;
  animate: boolean;
}) {
  const size = 84;
  const stroke = 6.5;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(1, progress01));
  const sweep = useRef(new Animated.Value(animate ? 0 : 1)).current;

  useEffect(() => {
    if (!animate) {
      sweep.setValue(1);
      return;
    }
    sweep.setValue(0);
    const anim = Animated.timing(sweep, {
      toValue: 1,
      duration: 1000,
      delay: 80,
      easing: FOLD_MOTION_EASE,
      useNativeDriver: false,
    });
    anim.start();
    return () => anim.stop();
  }, [animate, p, sweep]);

  const dashOffset = sweep.interpolate({
    inputRange: [0, 1],
    outputRange: [c, c * (1 - p)],
  });

  return (
    <View style={styles.gaugeWrap}>
      <Svg width={size} height={size} style={{ transform: [{ rotate: '-90deg' }] }}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="rgba(255,255,255,0.1)"
          strokeWidth={stroke}
          fill="none"
        />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="#E7BB7A"
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${c} ${c}`}
          strokeDashoffset={dashOffset}
        />
      </Svg>
      <View style={styles.gaugeCenter} pointerEvents="none">
        <FoldCountUpText
          value={p * 100}
          animate={animate}
          duration={1000}
          delayMs={80}
          textStyle={[styles.gaugePct, { fontFamily: mono, color: '#F6D7A7' }]}
          formatter={(n) => `${Math.round(n)}%`}
        />
        <Text style={styles.gaugeLabel}>被动覆盖</Text>
      </View>
    </View>
  );
}

/** 覆盖率条自左生长 800ms */
function CoverageTrack({ ratio, animate }: { ratio: number; animate: boolean }) {
  const w = useRef(new Animated.Value(animate ? 0 : 1)).current;
  const clamped = Math.max(0, Math.min(1, ratio));

  useEffect(() => {
    if (!animate) {
      w.setValue(1);
      return;
    }
    w.setValue(0);
    const anim = Animated.timing(w, {
      toValue: 1,
      duration: 800,
      delay: 220,
      easing: FOLD_MOTION_EASE,
      useNativeDriver: false,
    });
    anim.start();
    return () => anim.stop();
  }, [animate, clamped, w]);

  const width = w.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', `${clamped * 100}%`],
  });

  return (
    <View style={styles.covTrack}>
      <Animated.View style={[styles.covFill, { width }]} />
    </View>
  );
}

const SANKEY_PATHS = {
  a: 'M58 28 C100 28,108 52,151 56 C192 60,207 72,252 72',
  b: 'M58 52 C103 52,108 58,151 62 C196 66,212 77,252 78',
  c: 'M58 119 C98 119,111 94,151 88 C193 82,210 80,252 79',
  d: 'M58 119 C97 119,110 128,151 132 C192 136,215 136,252 136',
} as const;

/** Sankey：虚线流动 + 粒子（reduced-motion 时静态） */
function CashFlowSankey({ animate }: { animate: boolean }) {
  const dash = useRef(new Animated.Value(0)).current;
  const particleT = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!animate) {
      dash.setValue(0);
      particleT.setValue(0);
      return;
    }
    const flow = Animated.loop(
      Animated.timing(dash, {
        toValue: 14,
        duration: 2000,
        easing: Easing.linear,
        useNativeDriver: false,
      }),
    );
    const particles = Animated.loop(
      Animated.timing(particleT, {
        toValue: 1,
        duration: 2400,
        easing: Easing.linear,
        useNativeDriver: false,
      }),
    );
    flow.start();
    particles.start();
    return () => {
      flow.stop();
      particles.stop();
    };
  }, [animate, dash, particleT]);

  const bandProps = (color: string, width: number, opacity: number) => ({
    stroke: color,
    strokeWidth: width,
    strokeOpacity: opacity,
    fill: 'none' as const,
    strokeLinecap: 'round' as const,
    strokeDasharray: animate ? '8 6' : undefined,
    strokeDashoffset: animate ? dash : undefined,
  });

  // 粒子沿路径近似采样（固定关键帧点做透明度循环，避免复杂 path 插值）
  const particleOpacity = (phase: number) =>
    particleT.interpolate({
      inputRange: [0, 0.15, 0.5, 0.85, 1],
      outputRange: [
        phase === 0 ? 0.2 : 0.9,
        phase === 0 ? 1 : 0.35,
        phase === 1 ? 1 : 0.4,
        phase === 2 ? 1 : 0.3,
        phase === 0 ? 0.2 : 0.9,
      ],
    });

  return (
    <View style={styles.sankeyBox}>
      <Svg width="100%" height={147} viewBox="0 0 326 146" preserveAspectRatio="none">
        <AnimatedPath d={SANKEY_PATHS.a} {...bandProps('#7FA18E', 7, 0.42)} />
        <AnimatedPath d={SANKEY_PATHS.b} {...bandProps('#D1A05C', 5, 0.32)} />
        <AnimatedPath d={SANKEY_PATHS.c} {...bandProps('#C97659', 4, 0.2)} />
        <AnimatedPath d={SANKEY_PATHS.d} {...bandProps('#6B8A94', 3, 0.15)} />
        <Circle cx={46} cy={28} r={4} fill="#7FA18E" />
        <Circle cx={46} cy={52} r={3.4} fill="#D1A05C" />
        <Circle cx={46} cy={119} r={3.4} fill="#C97659" />
        <Circle cx={260} cy={76} r={7} fill="#D9B274" />
        <Circle cx={260} cy={136} r={3} fill="#6B8A94" />
        <SvgText x={33} y={22} fill="#9FB7A9" fontSize={6}>
          主动
        </SvgText>
        <SvgText x={33} y={46} fill="#B6A07D" fontSize={6}>
          被动
        </SvgText>
        <SvgText x={30} y={132} fill="#B08B7C" fontSize={6}>
          流出
        </SvgText>
        <SvgText x={270} y={78} fill="#E7C48D" fontSize={6}>
          自由
        </SvgText>
        <SvgText x={270} y={140} fill="#83A2AB" fontSize={6}>
          税/息
        </SvgText>
        {animate ? (
          <>
            <AnimatedCircle cx={100} cy={40} r={2.2} fill="#F2D7A4" opacity={particleOpacity(0)} />
            <AnimatedCircle cx={160} cy={62} r={2} fill="#F2D7A4" opacity={particleOpacity(1)} />
            <AnimatedCircle cx={210} cy={90} r={1.8} fill="#F2D7A4" opacity={particleOpacity(2)} />
          </>
        ) : null}
      </Svg>
    </View>
  );
}

/** 12 个月覆盖预测柱（设计稿 bars） */
function CoverageForecastBars({
  coverStart,
  animate,
}: {
  coverStart: number;
  animate: boolean;
}) {
  const start = Math.max(0.08, Math.min(0.95, coverStart));
  const end = Math.min(0.95, start + Math.max(0.12, (1 - start) * 0.45));
  const pairs = useMemo(() => {
    return Array.from({ length: 8 }, (_, i) => {
      const t = i / 7;
      const cover = start + (end - start) * t;
      const out = Math.max(0.06, cover * 0.42);
      return { cover, out, delay: i * 35 };
    });
  }, [end, start]);

  const heights = useRef(pairs.map((p) => new Animated.Value(animate ? 0 : 1))).current;

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
        delay: 180 + p.delay,
        easing: FOLD_MOTION_EASE,
        useNativeDriver: false,
      }),
    );
    const batch = Animated.parallel(anims);
    batch.start();
    return () => batch.stop();
  }, [animate, heights, pairs]);

  const now = new Date();
  const labels = [
    `${now.getMonth() + 1}月`,
    `${((now.getMonth() + 3) % 12) + 1}月`,
    `${((now.getMonth() + 6) % 12) + 1}月`,
    `${((now.getMonth() + 9) % 12) + 1}月`,
    `明年 ${now.getMonth() + 1} 月`,
  ];

  return (
    <View>
      <View style={styles.barsRow}>
        {pairs.map((p, i) => (
          <View key={i} style={styles.barPair}>
            <Animated.View
              style={[
                styles.barInc,
                {
                  height: heights[i]!.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, Math.max(8, p.cover * 58)],
                  }),
                },
              ]}
            />
            <Animated.View
              style={[
                styles.barOut,
                {
                  height: heights[i]!.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, Math.max(5, p.out * 58)],
                  }),
                },
              ]}
            />
          </View>
        ))}
      </View>
      <View style={styles.barX}>
        {labels.map((l) => (
          <Text key={l} style={styles.barXLabel}>
            {l}
          </Text>
        ))}
      </View>
      <View style={styles.forecastTags}>
        <View style={[styles.tag, styles.tagGreen]}>
          <Text style={styles.tagGreenText}>
            覆盖率 {Math.round(start * 100)}% → {Math.round(end * 100)}%
          </Text>
        </View>
        <View style={[styles.tag, styles.tagAmber]}>
          <Text style={styles.tagAmberText}>自由现金流转正</Text>
        </View>
      </View>
    </View>
  );
}

function HealthScoreTag() {
  const { displayHealthScore, aiLoading } = useCashFlowHealthScore();
  return (
    <View style={[styles.tag, styles.tagAmber]}>
      {aiLoading ? (
        <ActivityIndicator size="small" color="#E1BE86" />
      ) : (
        <Text style={styles.tagAmberText}>健康分 {displayHealthScore}</Text>
      )}
    </View>
  );
}

function DashboardBody({
  state,
  metrics,
  onNavigate,
  animate,
}: {
  state: CashFlowState;
  metrics: CashFlowMetrics;
  onNavigate: (tab: NavTab) => void;
  animate: boolean;
}) {
  const fp01 = Math.min(1, Math.max(0, metrics.freedomProgress / 100));
  const savingsRate =
    metrics.totalIncome > 0 ? (metrics.freeCashFlow / metrics.totalIncome) * 100 : 0;
  const gapToFreedom = Math.max(0, state.necessaryExpenses - metrics.totalPassiveIncome);
  const now = new Date();

  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiRefreshTick, setAiRefreshTick] = useState(0);
  const forceAiRefreshRef = useRef(false);
  const aiRequestId = useRef(0);

  const aiFingerprint = useMemo(() => computeCashFlowAiFingerprint(state, metrics), [state, metrics]);
  const aiSummaryText = useMemo(() => buildCashFlowAiSummaryText(state, metrics), [state, metrics]);

  const onRefreshAiAdvice = useCallback(() => {
    forceAiRefreshRef.current = true;
    setAiLoading(true);
    setAiError(null);
    setAiRefreshTick((t) => t + 1);
  }, []);

  useEffect(() => {
    const reqId = ++aiRequestId.current;
    let cancelled = false;

    (async () => {
      const force = forceAiRefreshRef.current;
      forceAiRefreshRef.current = false;

      if (!force) {
        try {
          const raw = await AsyncStorage.getItem(CASH_FLOW_AI_CACHE_KEY);
          if (raw) {
            const parsed = JSON.parse(raw) as { fp: string; analysis: string };
            if (parsed.fp === aiFingerprint && typeof parsed.analysis === 'string' && parsed.analysis.trim()) {
              if (cancelled || reqId !== aiRequestId.current) return;
              setAiAnalysis(parsed.analysis.trim());
              setAiError(null);
              setAiLoading(false);
              return;
            }
          }
        } catch {
          /* ignore */
        }
        if (cancelled || reqId !== aiRequestId.current) return;
        setAiAnalysis(null);
        setAiError(null);
        setAiLoading(false);
        return;
      }

      if (cancelled || reqId !== aiRequestId.current) return;
      setAiLoading(true);
      setAiError(null);

      try {
        const res = await analyzeCashFlowDashboardFromText({
          summaryText: aiSummaryText,
        });
        if (cancelled || reqId !== aiRequestId.current) return;
        if (res.ok) {
          setAiAnalysis(res.analysis);
          try {
            await AsyncStorage.setItem(
              CASH_FLOW_AI_CACHE_KEY,
              JSON.stringify({ fp: aiFingerprint, analysis: res.analysis }),
            );
          } catch {
            /* ignore */
          }
        } else {
          setAiAnalysis(null);
          setAiError(res.error);
        }
      } catch (e) {
        if (cancelled || reqId !== aiRequestId.current) return;
        setAiAnalysis(null);
        setAiError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled && reqId === aiRequestId.current) setAiLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [aiFingerprint, aiSummaryText, aiRefreshTick]);

  const insightFallback = useMemo(() => {
    const cover = metrics.freedomProgress.toFixed(0);
    if (metrics.freeCashFlow >= 0) {
      return `你的自由现金流为正，但被动收入覆盖率仍只有 ${cover}%。持续提高资产净流入，是拉开与「老鼠赛跑」距离的关键杠杆。`;
    }
    return `当前自由现金流为负，被动覆盖 ${cover}%。优先压低必要支出与负债月供，再把结余投入能产生流入的资产。`;
  }, [metrics.freeCashFlow, metrics.freedomProgress]);

  return (
    <View style={styles.body}>
      <FoldRiseIn animate={animate} index={0} fromY={11} holdHidden>
        <View style={styles.hero}>
          <View style={styles.heroDecor} pointerEvents="none" />
          <View style={styles.cfHead}>
            <Text style={styles.cfLab}>Financial freedom / 财务自由进度</Text>
            <HealthScoreTag />
          </View>
          <View style={styles.cfProgress}>
            <FreedomGauge progress01={fp01} animate={animate} />
            <View style={styles.cfMain}>
              <FoldCountUpText
                value={metrics.freeCashFlow}
                animate={animate}
                duration={760}
                delayMs={120}
                textStyle={[styles.cfMainAmt, { fontFamily: mono }]}
                formatter={(n) => formatSignedMoney(n)}
              />
              <Text style={styles.cfMainSub}>
                本月自由现金流 · {metrics.pattern.replace(/\s*[🎉🐀🚀]\s*/g, '').trim() || '模型'}
              </Text>
              <View style={styles.cfMiniRow}>
                <View style={styles.cfMini}>
                  <Text style={styles.cfMiniLab}>被动收入</Text>
                  <FoldCountUpText
                    value={metrics.totalPassiveIncome}
                    animate={animate}
                    duration={760}
                    delayMs={220}
                    textStyle={[styles.cfMiniVal, { fontFamily: mono }]}
                    formatter={(n) => formatMoney(n)}
                  />
                </View>
                <View style={styles.cfMini}>
                  <Text style={styles.cfMiniLab}>必要支出</Text>
                  <FoldCountUpText
                    value={state.necessaryExpenses}
                    animate={animate}
                    duration={760}
                    delayMs={260}
                    textStyle={[styles.cfMiniVal, { fontFamily: mono }]}
                    formatter={(n) => formatMoney(n)}
                  />
                </View>
                <View style={styles.cfMini}>
                  <Text style={styles.cfMiniLab}>储蓄率</Text>
                  <FoldCountUpText
                    value={savingsRate}
                    animate={animate}
                    duration={760}
                    delayMs={300}
                    textStyle={[styles.cfMiniVal, { fontFamily: mono }]}
                    formatter={(n) => `${Math.round(n)}%`}
                  />
                </View>
              </View>
            </View>
          </View>
          <View style={styles.coverage}>
            <View style={styles.covLabels}>
              <Text style={styles.covLab}>被动收入 / 必要支出</Text>
              <Text style={styles.covLab}>
                {gapToFreedom > 0 ? `还差 ${formatMoney(gapToFreedom)} 达成 100%` : '已覆盖必要支出'}
              </Text>
            </View>
            <CoverageTrack ratio={fp01} animate={animate} />
          </View>
        </View>
      </FoldRiseIn>

      <FoldRiseIn animate={animate} index={1} fromY={11} holdHidden>
        <View style={styles.cfActions}>
          <Pressable
            onPress={() => onNavigate('entry')}
            style={({ pressed }) => [styles.cfAction, styles.cfActionHot, pressed && { opacity: 0.88 }]}>
            <MaterialIcons name="add" size={18} color="#F0D0A0" />
            <Text style={styles.cfActionHotText}>记一笔流水</Text>
          </Pressable>
          <Pressable
            onPress={() => onNavigate('ledger')}
            style={({ pressed }) => [styles.cfAction, pressed && { opacity: 0.88 }]}>
            <MaterialIcons name="account-balance" size={16} color="#4B6B59" />
            <Text style={styles.cfActionText}>资产台账</Text>
          </Pressable>
          <Pressable
            onPress={() => onNavigate('simulator')}
            style={({ pressed }) => [styles.cfAction, pressed && { opacity: 0.88 }]}>
            <MaterialIcons name="track-changes" size={16} color="#4B6B59" />
            <Text style={styles.cfActionText}>决策模拟</Text>
          </Pressable>
        </View>
      </FoldRiseIn>

      <FoldRiseIn animate={animate} index={2} fromY={11} holdHidden>
        <View style={styles.sankeyCard}>
          <View style={styles.sankeyHead}>
            <Text style={styles.sankeyTitle}>全景流向</Text>
            <Text style={styles.sankeyUnit}>单位：元 / 月</Text>
          </View>
          <Pressable onPress={() => onNavigate('detail_active')} accessibilityRole="button">
            <CashFlowSankey animate={animate} />
          </Pressable>
          <View style={styles.skLabels}>
            <Pressable style={styles.skLabel} onPress={() => onNavigate('detail_active')}>
              <Text style={styles.skLabelB}>主动收入</Text>
              <Text style={styles.skLabelS}>工资 {formatCompactK(metrics.activeIncome)}</Text>
            </Pressable>
            <Pressable style={[styles.skLabel, styles.skMid]} onPress={() => onNavigate('detail_asset')}>
              <Text style={styles.skLabelB}>资产池</Text>
              <Text style={styles.skLabelS}>月流入 {formatCompactK(metrics.assetInflow)}</Text>
            </Pressable>
            <Pressable style={[styles.skLabel, styles.skMid]} onPress={() => onNavigate('detail_expense')}>
              <Text style={styles.skLabelB}>必要流出</Text>
              <Text style={styles.skLabelS}>{formatCompactK(state.necessaryExpenses)}</Text>
            </Pressable>
            <Pressable style={[styles.skLabel, styles.skRt]} onPress={() => onNavigate('detail_passive')}>
              <Text style={styles.skLabelB}>自由现金流</Text>
              <Text style={styles.skLabelS}>{formatCompactK(metrics.freeCashFlow)}</Text>
            </Pressable>
          </View>
        </View>
      </FoldRiseIn>

      <FoldRiseIn animate={animate} index={3} fromY={11} holdHidden>
        <View style={styles.forecastCard}>
          <View style={styles.forecastHead}>
            <Text style={styles.sankeyTitle}>12 个月覆盖预测</Text>
            <View style={[styles.tag, styles.tagAmber]}>
              <Text style={styles.tagAmberText}>保守情景</Text>
            </View>
          </View>
          <CoverageForecastBars coverStart={fp01} animate={animate} />
        </View>
      </FoldRiseIn>

      <FoldRiseIn animate={animate} index={4} fromY={11} holdHidden>
        <View style={styles.insight}>
          <MaterialIcons name="auto-awesome" size={16} color="#A57635" style={{ marginTop: 2 }} />
          <View style={{ flex: 1 }}>
            <View style={styles.insightHeadRow}>
              <Text style={styles.insightTitle}>AI 综合判断：</Text>
              <Pressable
                onPress={onRefreshAiAdvice}
                disabled={aiLoading}
                hitSlop={8}
                style={({ pressed }) => [{ opacity: pressed || aiLoading ? 0.45 : 1 }]}>
                {aiLoading ? (
                  <ActivityIndicator size="small" color="#A57635" />
                ) : (
                  <MaterialIcons name="refresh" size={18} color="#A57635" />
                )}
              </Pressable>
            </View>
            {aiError && !aiAnalysis ? (
              <Text style={styles.insightBody}>{aiError}</Text>
            ) : (
              <Text style={styles.insightBody}>{aiAnalysis?.trim() || insightFallback}</Text>
            )}
          </View>
        </View>
      </FoldRiseIn>

      <Text style={styles.footNote}>
        FREEDOM MODEL · {now.getFullYear()}.{String(now.getMonth() + 1).padStart(2, '0')} · 与日常流水分开建模
      </Text>
    </View>
  );
}

export function CashFlowFoldDashboard({
  state,
  metrics,
  onNavigate,
  financeInsightsRefresh,
}: {
  state: CashFlowState;
  metrics: CashFlowMetrics;
  onNavigate: (tab: NavTab) => void;
  financeInsightsRefresh: number;
}) {
  const { animate, motionReady } = useFoldMotionGate();
  const motionOn = animate && motionReady;

  return (
    <CashFlowFinanceInsightsProvider
      cashFlowState={state}
      cashFlowMetrics={metrics}
      refreshSignal={financeInsightsRefresh}>
      <DashboardBody state={state} metrics={metrics} onNavigate={onNavigate} animate={motionOn} />
    </CashFlowFinanceInsightsProvider>
  );
}

/** 供壳层取深色看板底色 */
export const CASH_FLOW_DASH_BG = '#172B24';

const styles = StyleSheet.create({
  body: { paddingBottom: 8 },
  hero: {
    padding: 14,
    marginBottom: 8,
    borderRadius: 16,
    backgroundColor: '#24483C',
    borderWidth: 1,
    borderColor: '#2A4D40',
    overflow: 'hidden',
    position: 'relative',
  },
  heroDecor: {
    position: 'absolute',
    right: -45,
    top: -60,
    width: 170,
    height: 170,
    borderRadius: 85,
    borderWidth: 1,
    borderColor: 'rgba(238,196,133,0.15)',
  },
  cfHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: 1,
  },
  cfLab: {
    fontSize: 10,
    letterSpacing: 1.2,
    color: '#B3C8BC',
    textTransform: 'uppercase',
    flex: 1,
    paddingRight: 8,
  },
  cfProgress: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 8,
    zIndex: 1,
  },
  gaugeWrap: { width: 84, height: 84, position: 'relative' },
  gaugeCenter: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gaugePct: { fontSize: 18, fontWeight: '700', lineHeight: 22 },
  gaugeLabel: { fontSize: 9, color: '#A9BFB2', marginTop: 2 },
  cfMain: { flex: 1, minWidth: 0 },
  cfMainAmt: { fontSize: 24, fontWeight: '700', color: '#F8D8A7', lineHeight: 28 },
  cfMainSub: { fontSize: 11, color: '#A9BFB2', marginTop: 4 },
  cfMiniRow: { flexDirection: 'row', gap: 5, marginTop: 10 },
  cfMini: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 10,
    paddingVertical: 6,
    paddingHorizontal: 7,
  },
  cfMiniLab: { fontSize: 9, color: '#A3BBAE' },
  cfMiniVal: { fontSize: 12, fontWeight: '700', color: '#F0D3A7', marginTop: 3 },
  coverage: { marginTop: 12, zIndex: 1 },
  covLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 5,
    gap: 8,
  },
  covLab: { fontSize: 10, color: '#A8BDB1', flexShrink: 1 },
  covTrack: {
    height: 5,
    borderRadius: 5,
    backgroundColor: 'rgba(255,255,255,0.1)',
    overflow: 'hidden',
  },
  covFill: {
    height: 5,
    borderRadius: 5,
    backgroundColor: '#8BA878',
  },
  cfActions: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 8,
  },
  cfAction: {
    flex: 1,
    height: 52,
    borderRadius: 14,
    backgroundColor: 'rgba(255,252,245,0.88)',
    borderWidth: 1,
    borderColor: 'rgba(228,218,200,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  cfActionHot: {
    backgroundColor: '#1E4034',
    borderColor: '#1E4034',
  },
  cfActionText: { fontSize: 11, color: '#55635A', fontWeight: '600' },
  cfActionHotText: { fontSize: 11, color: '#F8F2E7', fontWeight: '700' },
  sankeyCard: {
    padding: 12,
    marginBottom: 8,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.055)',
    borderWidth: 1,
    borderColor: 'rgba(235,219,189,0.12)',
  },
  sankeyHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  sankeyTitle: { fontSize: 13, fontWeight: '700', color: '#EADFCE' },
  sankeyUnit: { fontSize: 10, color: '#8FA597' },
  sankeyBox: { height: 147, overflow: 'hidden' },
  skLabels: { flexDirection: 'row', gap: 4, marginTop: 4 },
  skLabel: { flex: 1 },
  skMid: { alignItems: 'center' },
  skRt: { alignItems: 'flex-end' },
  skLabelB: { fontSize: 11, fontWeight: '700', color: '#C9D6CE' },
  skLabelS: { fontSize: 10, color: '#949C94', marginTop: 2, lineHeight: 14 },
  forecastCard: {
    padding: 12,
    marginBottom: 8,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.055)',
    borderWidth: 1,
    borderColor: 'rgba(235,219,189,0.12)',
  },
  forecastHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  barsRow: {
    height: 58,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 4,
    marginTop: 2,
  },
  barPair: {
    flex: 1,
    height: '100%',
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 2,
  },
  barInc: {
    width: 5,
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
    backgroundColor: '#6D9A80',
  },
  barOut: {
    width: 5,
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
    backgroundColor: '#CE7A5C',
  },
  barX: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  barXLabel: { fontSize: 9, fontFamily: mono, color: '#7F9688' },
  forecastTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 8 },
  tag: {
    height: 22,
    paddingHorizontal: 8,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tagAmber: { backgroundColor: 'rgba(216,154,77,0.14)' },
  tagAmberText: { fontSize: 10, color: '#E1BE86', fontWeight: '600' },
  tagGreen: { backgroundColor: 'rgba(134,167,149,0.14)' },
  tagGreenText: { fontSize: 10, color: '#A8CBB4', fontWeight: '600' },
  insight: {
    padding: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(245,235,217,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(234,214,183,0.28)',
    flexDirection: 'row',
    gap: 8,
  },
  insightHeadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  insightTitle: { fontSize: 12, fontWeight: '700', color: '#E8D5B4' },
  insightBody: { fontSize: 12, lineHeight: 19, color: '#C4B49A' },
  footNote: {
    marginTop: 10,
    fontSize: 10,
    color: '#6F8578',
    textAlign: 'center',
    letterSpacing: 0.4,
    fontFamily: serif,
  },
});
