import { buildCashFlowAiSummaryText, type CashFlowMetrics } from '@/lib/cash-flow/cash-flow-metrics';
import { buildSavingsForecastSeries, computeNetWorthTotal } from '@/lib/finance-net-worth';
import { fetchFinanceCatalog, fetchFinanceInsights, fetchFinanceTransactionsRange } from '@/lib/finance-page-api';
import type { FinanceTransactionRow } from '@/lib/repositories/finance/finance.types';
import type { CashFlowState } from '@/lib/repositories/cash-flow/cash-flow.types';
import {
  analyzeAiFinanceDashboardFromText,
  getActiveAiLlmApiKey,
  isActiveAiLlmConfigured,
  type AiFinanceDashboardPayload,
} from '@/lib/zhipu-image-parse';
import { MaterialIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, Line, LinearGradient, Path, Stop } from 'react-native-svg';

const AI_FINANCE_CACHE_KEY = 'ai_finance_dashboard_cache_v2';

type FinanceInsightsContextValue = {
  aiDashboard: AiFinanceDashboardPayload | null;
  aiLoading: boolean;
  aiError: string | null;
  analysisStale: boolean;
  zhipuReady: boolean;
  displayHealthScore: number;
  fallbackHealthScore: number;
  healthSummary: string | null;
  savingsForecastSeries: number[];
  incomeForecastSeries: number[];
  surplusForecastSeries: number[];
  savingsForecastTimeline: Array<{ key: string; label: string; isForecast: boolean }>;
  incomeForecastTimeline: Array<{ key: string; label: string; isForecast: boolean }>;
  bootReady: boolean;
  runAiAnalysis: () => void;
  formatCurrency: (value: number) => string;
};

const FinanceInsightsContext = createContext<FinanceInsightsContextValue | null>(null);

function useFinanceInsights() {
  const ctx = useContext(FinanceInsightsContext);
  if (!ctx) throw new Error('CashFlowFinanceInsightsProvider missing');
  return ctx;
}

type ThemeProps = {
  surface: string;
  text: string;
  subtle: string;
  border: string;
  isDark: boolean;
};

function buildForecastChart(points: number[]) {
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = Math.max(1, max - min);
  const width = 400;
  const topPadding = 20;
  const bottomPadding = 160;
  const usableHeight = bottomPadding - topPadding;
  const stepX = width / Math.max(1, points.length - 1);
  const mapped = points.map((value, idx) => {
    const x = idx * stepX;
    const y = bottomPadding - ((value - min) / range) * usableHeight;
    return { x, y };
  });
  const history = mapped.slice(0, 6);
  const future = mapped.slice(5);
  const toPath = (list: Array<{ x: number; y: number }>) =>
    list.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x},${p.y}`).join(' ');
  return {
    mapped,
    historyPath: toPath(history),
    futurePath: toPath(future),
    areaPath: `${toPath(mapped)} V 200 H 0 Z`,
  };
}

export function CashFlowFinanceInsightsProvider({
  cashFlowState,
  cashFlowMetrics,
  refreshSignal,
  children,
}: {
  cashFlowState: CashFlowState;
  cashFlowMetrics: CashFlowMetrics;
  refreshSignal?: number;
  children: React.ReactNode;
}) {
  const zhipuReady = isActiveAiLlmConfigured();
  const [aiDashboard, setAiDashboard] = useState<AiFinanceDashboardPayload | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [savedDigest, setSavedDigest] = useState<string | null>(null);
  const [bootReady, setBootReady] = useState(false);
  const aiReqRef = useRef(0);

  const [monthlyIncome, setMonthlyIncome] = useState(0);
  const [monthlyExpense, setMonthlyExpense] = useState(0);
  const [monthlySavingsDelta, setMonthlySavingsDelta] = useState(0);
  const [past6Net, setPast6Net] = useState<number[]>([0, 0, 0, 0, 0, 0]);
  const [past6Income, setPast6Income] = useState<number[]>([0, 0, 0, 0, 0, 0]);
  const [past6MonthKeys, setPast6MonthKeys] = useState<string[]>(['', '', '', '', '', '']);
  const [currentNetWorth, setCurrentNetWorth] = useState(0);
  const [financeTransactions, setFinanceTransactions] = useState<FinanceTransactionRow[]>([]);
  const [expenseBreakdownRows, setExpenseBreakdownRows] = useState<Array<{ name: string; amount: number; pct: number }>>([]);
  const [savingsForecastTimeline, setSavingsForecastTimeline] = useState<
    Array<{ key: string; label: string; isForecast: boolean }>
  >([]);
  const [incomeForecastTimeline, setIncomeForecastTimeline] = useState<
    Array<{ key: string; label: string; isForecast: boolean }>
  >([]);

  const formatCurrency = useCallback(
    (value: number) => `¥${value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`,
    [],
  );

  const cashFlowAiBlock = useMemo(
    () => buildCashFlowAiSummaryText(cashFlowState, cashFlowMetrics),
    [cashFlowState, cashFlowMetrics],
  );

  const reloadFinanceData = useCallback(async () => {
    setBootReady(false);
    try {
      const insights = await fetchFinanceInsights({ months: 6, offlineFallback: true });
      const end = new Date();
      const start = new Date(end.getFullYear(), end.getMonth() - 6, 1);
      const ymd = (d: Date) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const [txnResult, catalog] = await Promise.all([
        fetchFinanceTransactionsRange({
          start: ymd(start),
          end: ymd(end),
          offlineFallback: true,
        }),
        fetchFinanceCatalog({ offlineFallback: true }),
      ]);
      const transactions = txnResult.transactions;
      const categories = catalog.categories;
      const accounts = catalog.accounts;
      setFinanceTransactions(transactions);
      setCurrentNetWorth(
        typeof insights?.netWorth === 'number' ? insights.netWorth : computeNetWorthTotal(accounts),
      );
      const now = new Date();
      const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);

      let thisIncome = 0;
      let thisExpense = 0;
      let prevIncome = 0;
      let prevExpense = 0;
      const expenseBucket = new Map<string, number>();
      const categoryNameMap = new Map(categories.map((c) => [c.id, c.name]));

      transactions.forEach((txn) => {
        const happenedAt = new Date(txn.happened_at);
        if (Number.isNaN(happenedAt.getTime())) return;
        const amount = Math.abs(txn.amount);
        const inThisMonth = happenedAt >= thisMonthStart && happenedAt < nextMonthStart;
        const inPrevMonth = happenedAt >= prevMonthStart && happenedAt < thisMonthStart;

        if (inThisMonth) {
          if (txn.transaction_type === 'income') thisIncome += amount;
          if (txn.transaction_type === 'expense') {
            thisExpense += amount;
            const categoryKey = txn.flow_category_id ?? 'uncategorized';
            expenseBucket.set(categoryKey, (expenseBucket.get(categoryKey) ?? 0) + amount);
          }
        }
        if (inPrevMonth) {
          if (txn.transaction_type === 'income') prevIncome += amount;
          if (txn.transaction_type === 'expense') prevExpense += amount;
        }
      });

      const thisSavingsRate = thisIncome > 0 ? ((thisIncome - thisExpense) / thisIncome) * 100 : 0;
      const prevSavingsRate = prevIncome > 0 ? ((prevIncome - prevExpense) / prevIncome) * 100 : 0;

      setMonthlyIncome(thisIncome);
      setMonthlyExpense(thisExpense);
      setMonthlySavingsDelta(thisSavingsRate - prevSavingsRate);
      setExpenseBreakdownRows(
        Array.from(expenseBucket.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([categoryId, amount]) => ({
            name: categoryNameMap.get(categoryId) ?? '未分类',
            amount,
            pct: thisExpense > 0 ? amount / thisExpense : 0,
          })),
      );

      const monthStarts = Array.from({ length: 6 }, (_, idx) => new Date(now.getFullYear(), now.getMonth() - (5 - idx), 1));
      const monthIncome = new Map<string, number>();
      const monthExpense = new Map<string, number>();
      const monthKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      monthStarts.forEach((start) => {
        const key = monthKey(start);
        monthIncome.set(key, 0);
        monthExpense.set(key, 0);
      });

      transactions.forEach((txn) => {
        const happenedAt = new Date(txn.happened_at);
        if (Number.isNaN(happenedAt.getTime())) return;
        const key = monthKey(new Date(happenedAt.getFullYear(), happenedAt.getMonth(), 1));
        if (!monthIncome.has(key)) return;
        const amount = Math.abs(txn.amount);
        if (txn.transaction_type === 'income') monthIncome.set(key, (monthIncome.get(key) ?? 0) + amount);
        if (txn.transaction_type === 'expense') monthExpense.set(key, (monthExpense.get(key) ?? 0) + amount);
      });

      setPast6Net(
        monthStarts.map((start) => {
          const key = monthKey(start);
          return (monthIncome.get(key) ?? 0) - (monthExpense.get(key) ?? 0);
        }),
      );
      setPast6Income(monthStarts.map((start) => monthIncome.get(monthKey(start)) ?? 0));
      setPast6MonthKeys(monthStarts.map((start) => monthKey(start)));

      const timeline = Array.from({ length: 12 }, (_, idx) => {
        const date = new Date(now.getFullYear(), now.getMonth() - 5 + idx, 1);
        return {
          key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`,
          label: `${date.getMonth() + 1}月`,
          isForecast: idx > 5,
        };
      });
      setSavingsForecastTimeline(timeline);
      setIncomeForecastTimeline(timeline);
    } catch (error) {
      console.warn('Failed to load finance data for insights:', error);
      setMonthlyIncome(0);
      setMonthlyExpense(0);
      setMonthlySavingsDelta(0);
      setExpenseBreakdownRows([]);
      setPast6Net([0, 0, 0, 0, 0, 0]);
      setPast6Income([0, 0, 0, 0, 0, 0]);
      setPast6MonthKeys(['', '', '', '', '', '']);
      setCurrentNetWorth(0);
      setFinanceTransactions([]);
      setSavingsForecastTimeline([]);
      setIncomeForecastTimeline([]);
    } finally {
      setBootReady(true);
    }
  }, []);

  useEffect(() => {
    void reloadFinanceData();
  }, [reloadFinanceData, refreshSignal]);

  useEffect(() => {
    if (!bootReady) return;
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(AI_FINANCE_CACHE_KEY);
        if (cancelled || !raw) return;
        const parsed = JSON.parse(raw) as { digest?: string; payload?: AiFinanceDashboardPayload };
        if (parsed?.payload) {
          setAiDashboard(parsed.payload);
          if (typeof parsed.digest === 'string') setSavedDigest(parsed.digest);
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bootReady]);

  const aiFinanceDigest = useMemo(() => {
    const lines: string[] = [];
    const now = new Date();
    lines.push(`锚点：${now.getFullYear()}年${now.getMonth() + 1}月（应用内「本月」）`);
    lines.push(`本月收入(元): ${monthlyIncome.toFixed(2)}`);
    lines.push(`本月支出(元): ${monthlyExpense.toFixed(2)}`);
    const savingRate = monthlyIncome > 0 ? ((monthlyIncome - monthlyExpense) / monthlyIncome) * 100 : null;
    lines.push(savingRate != null ? `隐含储蓄率: ${savingRate.toFixed(1)}%` : '隐含储蓄率: 无（本月收入为0）');
    lines.push(`储蓄率口径较上月变化(百分点): ${monthlySavingsDelta.toFixed(2)}（由应用对比上月同口径算出）`);
    lines.push('过去 6 个月（由旧到新；用于生成 12 点序列的前 6 个月，单位元）：');
    for (let i = 0; i < 6; i += 1) {
      const mk = past6MonthKeys[i]?.trim() || `第${i + 1}段`;
      lines.push(
        `  - ${mk}: 月收入 ${(past6Income[i] ?? 0).toFixed(2)} ，月净储蓄(收入−支出) ${(past6Net[i] ?? 0).toFixed(2)}`,
      );
    }
    if (!expenseBreakdownRows.length) {
      lines.push('本月可聚合的支出分类：暂无或支出为0。');
    } else {
      lines.push('本月支出分类 TOP:');
      expenseBreakdownRows.forEach((r) =>
        lines.push(`  - ${r.name}: ${r.amount.toFixed(2)} 元，占本月支出 ${(r.pct * 100).toFixed(1)}%`),
      );
    }
    lines.push('');
    lines.push('---');
    lines.push('【现金流图·月度模型】（与记账流水独立口径，用于补充主动/被动收入、资产负债与自由现金流视角）');
    lines.push(cashFlowAiBlock);
    return lines.join('\n');
  }, [
    cashFlowAiBlock,
    expenseBreakdownRows,
    monthlyExpense,
    monthlyIncome,
    monthlySavingsDelta,
    past6Income,
    past6MonthKeys,
    past6Net,
  ]);

  const fallbackHealthScore = useMemo(() => {
    if (monthlyIncome <= 0) return monthlyExpense > 0 ? 48 : 55;
    const rate = Math.max(0, Math.min(1, (monthlyIncome - monthlyExpense) / monthlyIncome));
    return Math.round(42 + rate * 52);
  }, [monthlyExpense, monthlyIncome]);

  const displayHealthScore = aiDashboard?.health_score ?? fallbackHealthScore;
  const analysisStale = !!(savedDigest && savedDigest !== aiFinanceDigest);

  const savingsForecastSeries = useMemo(
    () =>
      buildSavingsForecastSeries({
        currentNetWorth,
        transactions: financeTransactions,
        freeCashFlow: cashFlowMetrics.freeCashFlow,
      }),
    [cashFlowMetrics.freeCashFlow, currentNetWorth, financeTransactions],
  );
  const incomeForecastSeries = useMemo(
    () => aiDashboard?.income_forecast_12 ?? Array.from({ length: 12 }, () => 0),
    [aiDashboard],
  );
  const surplusForecastSeries = useMemo(
    () => aiDashboard?.surplus_forecast_12 ?? Array.from({ length: 12 }, () => 0),
    [aiDashboard],
  );

  const runAiAnalysis = useCallback(() => {
    if (!zhipuReady) {
      setAiError('未检测到智谱 API 密钥：请设置 EXPO_PUBLIC_ZHIPU_API_KEY。');
      return;
    }
    const seq = ++aiReqRef.current;
    setAiLoading(true);
    setAiError(null);
    void (async () => {
      try {
        const r = await analyzeAiFinanceDashboardFromText({
          apiKey: getActiveAiLlmApiKey(),
          summaryText: aiFinanceDigest,
          past6NetSavings: past6Net,
          past6Income,
          maxAttempts: 12,
          retryDelayMs: 1000,
        });
        if (seq !== aiReqRef.current) return;
        if (r.ok) {
          setAiDashboard(r.data);
          setSavedDigest(aiFinanceDigest);
          try {
            await AsyncStorage.setItem(
              AI_FINANCE_CACHE_KEY,
              JSON.stringify({ digest: aiFinanceDigest, savedAt: Date.now(), payload: r.data }),
            );
          } catch {
            /* ignore */
          }
        } else {
          setAiError(r.error);
        }
      } catch (e) {
        if (seq === aiReqRef.current) {
          setAiError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (seq === aiReqRef.current) setAiLoading(false);
      }
    })();
  }, [aiFinanceDigest, past6Income, past6Net, zhipuReady]);

  const healthSummary = aiDashboard?.health_summary ?? null;

  const value = useMemo<FinanceInsightsContextValue>(
    () => ({
      aiDashboard,
      aiLoading,
      aiError,
      analysisStale,
      zhipuReady,
      displayHealthScore,
      fallbackHealthScore,
      healthSummary,
      savingsForecastSeries,
      incomeForecastSeries,
      surplusForecastSeries,
      savingsForecastTimeline,
      incomeForecastTimeline,
      bootReady,
      runAiAnalysis,
      formatCurrency,
    }),
    [
      aiDashboard,
      aiLoading,
      aiError,
      analysisStale,
      zhipuReady,
      displayHealthScore,
      fallbackHealthScore,
      healthSummary,
      savingsForecastSeries,
      incomeForecastSeries,
      surplusForecastSeries,
      savingsForecastTimeline,
      incomeForecastTimeline,
      bootReady,
      runAiAnalysis,
      formatCurrency,
    ],
  );

  return <FinanceInsightsContext.Provider value={value}>{children}</FinanceInsightsContext.Provider>;
}

export function CashFlowHealthScoreCard({ surface, text, subtle, border, isDark }: ThemeProps) {
  const {
    aiLoading,
    aiError,
    zhipuReady,
    displayHealthScore,
    fallbackHealthScore,
    healthSummary,
    runAiAnalysis,
  } = useFinanceInsights();

  const healthSize = 140;
  const healthStroke = 8;
  const healthR = (healthSize - healthStroke) / 2;
  const healthC = 2 * Math.PI * healthR;
  const healthPct = Math.max(0.04, Math.min(1, displayHealthScore / 100));
  const trackColor = isDark ? 'rgba(148,163,184,0.2)' : '#e2e8f0';
  const accent = '#f59e0b';

  const desc =
    aiLoading && !healthSummary
      ? '正在请求智谱 GLM…'
      : healthSummary ??
        (aiError
          ? `智谱接口异常，圆环为本地估算（${fallbackHealthScore} 分）。可点击刷新重试。`
          : zhipuReady
            ? '基于记账流水与现金流模型。点击刷新生成 AI 健康分与预测曲线。'
            : '未配置智谱 API，显示本地估算分。');

  return (
    <View style={[styles.card, { backgroundColor: surface, borderColor: border, marginBottom: 16 }]}>
      <View style={styles.cardHeaderRow}>
        <View style={styles.cardTitleRow}>
          <MaterialIcons name="favorite" size={18} color={accent} />
          <Text style={[styles.cardTitle, { color: text }]}>财务健康分</Text>
        </View>
        <Pressable
          onPress={runAiAnalysis}
          disabled={aiLoading || !zhipuReady}
          hitSlop={8}
          style={({ pressed }) => [{ opacity: pressed || aiLoading || !zhipuReady ? 0.45 : 1, padding: 4 }]}>
          {aiLoading ? (
            <ActivityIndicator size="small" color={subtle} />
          ) : (
            <MaterialIcons name="refresh" size={22} color={subtle} />
          )}
        </Pressable>
      </View>

      <View style={styles.healthWrap}>
        <Svg width={healthSize} height={healthSize} style={{ transform: [{ rotate: '-90deg' }] }}>
          <Circle cx={healthSize / 2} cy={healthSize / 2} r={healthR} stroke={trackColor} strokeWidth={2} fill="none" />
          <Circle
            cx={healthSize / 2}
            cy={healthSize / 2}
            r={healthR}
            stroke={accent}
            strokeWidth={healthStroke}
            strokeDasharray={`${healthC * healthPct} ${healthC * (1 - healthPct)}`}
            strokeLinecap="butt"
            fill="none"
          />
        </Svg>
        <View style={styles.healthCenter}>
          {aiLoading && !healthSummary ? (
            <ActivityIndicator size="large" color={accent} />
          ) : (
            <>
              <Text style={[styles.healthScore, { color: text }]}>{displayHealthScore}</Text>
              <Text style={[styles.healthTotal, { color: subtle }]}>/ 100</Text>
            </>
          )}
        </View>
      </View>
      <Text style={[styles.healthDesc, { color: subtle }]}>{desc}</Text>
    </View>
  );
}

type ForecastChartProps = ThemeProps & {
  title: string;
  subtitle: string;
  accent: string;
  series: number[];
  timeline: Array<{ key: string; label: string; isForecast: boolean }>;
  selectedIndex: number;
  onSelectIndex: (idx: number) => void;
  gradId: string;
  showAiBadge?: boolean;
};

function ForecastChartCard({
  title,
  subtitle,
  accent,
  series,
  timeline,
  selectedIndex,
  onSelectIndex,
  gradId,
  showAiBadge = true,
  surface,
  text,
  subtle,
  border,
  isDark,
}: ForecastChartProps) {
  const { formatCurrency } = useFinanceInsights();
  const chart = useMemo(() => buildForecastChart(series.length ? series : Array(12).fill(0)), [series]);
  const selectedValue = series[selectedIndex] ?? 0;
  const selectedItem = timeline[selectedIndex];
  const changePct = useMemo(() => {
    if (selectedIndex <= 0) return 0;
    const prev = series[selectedIndex - 1] ?? 0;
    if (prev === 0) return 0;
    return ((selectedValue - prev) / Math.abs(prev)) * 100;
  }, [series, selectedIndex, selectedValue]);

  const trackColor = isDark ? 'rgba(148,163,184,0.2)' : '#e2e8f0';
  const dividerColor = isDark ? 'rgba(59,130,246,0.35)' : 'rgba(37,99,235,0.35)';

  return (
    <View style={[styles.card, { backgroundColor: surface, borderColor: border, marginBottom: 12 }]}>
      <View style={styles.forecastTitleRow}>
        <Text style={[styles.forecastTitle, { color: text }]}>{title}</Text>
        {showAiBadge ? (
          <View style={[styles.forecastBadge, { backgroundColor: isDark ? 'rgba(59,130,246,0.15)' : '#eff6ff' }]}>
            <Text style={[styles.forecastBadgeText, { color: accent }]}>AI</Text>
          </View>
        ) : (
          <View style={[styles.forecastBadge, { backgroundColor: isDark ? 'rgba(148,163,184,0.12)' : '#f1f5f9' }]}>
            <Text style={[styles.forecastBadgeText, { color: subtle }]}>模型</Text>
          </View>
        )}
      </View>
      <Text style={[styles.forecastSub, { color: subtle }]}>{subtitle}</Text>

      <View style={styles.chartBox}>
        <Svg width="100%" height="160" viewBox="0 0 400 200">
          {[180, 130, 80, 30].map((y) => (
            <Line key={y} x1="0" y1={y} x2="400" y2={y} stroke={trackColor} strokeWidth="1" />
          ))}
          {chart.mapped[5] ? (
            <Line
              x1={chart.mapped[5].x}
              y1="18"
              x2={chart.mapped[5].x}
              y2="186"
              stroke={dividerColor}
              strokeDasharray="4 4"
              strokeWidth="1.5"
            />
          ) : null}
          <Path d={chart.historyPath} fill="none" stroke={accent} strokeWidth="3" />
          <Path d={chart.futurePath} fill="none" stroke={accent} strokeDasharray="6 6" strokeWidth="3" />
          <Defs>
            <LinearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={accent} stopOpacity="0.18" />
              <Stop offset="1" stopColor={accent} stopOpacity="0" />
            </LinearGradient>
          </Defs>
          <Path d={chart.areaPath} fill={`url(#${gradId})`} />
          {chart.mapped.map((p, i) => (
            <Circle
              key={i}
              cx={p.x}
              cy={p.y}
              r={i === selectedIndex ? 5.5 : i === 5 || i === chart.mapped.length - 1 ? 4 : 3}
              fill={accent}
              stroke={i === selectedIndex ? surface : 'none'}
              strokeWidth={2}
              onPress={() => onSelectIndex(i)}
            />
          ))}
        </Svg>
        <View style={styles.monthLabels}>
          {(timeline.length > 0 ? timeline : [{ key: 'fb', label: '-', isForecast: false }]).map((item, idx) => (
            <Pressable key={item.key} onPress={() => onSelectIndex(idx)} style={styles.monthLabelBtn}>
              <Text
                style={[
                  styles.monthLabel,
                  idx === selectedIndex && styles.monthLabelSelected,
                  { color: idx === selectedIndex ? accent : item.isForecast ? accent : subtle },
                ]}>
                {item.label}
              </Text>
              {idx === 5 ? (
                <View
                  style={[
                    styles.currentMonthBadge,
                    { backgroundColor: idx === selectedIndex ? accent : isDark ? 'rgba(148,163,184,0.15)' : '#f1f5f9' },
                  ]}>
                  <Text style={[styles.currentMonthBadgeText, { color: idx === selectedIndex ? '#fff' : accent }]}>
                    本月
                  </Text>
                </View>
              ) : null}
            </Pressable>
          ))}
        </View>
      </View>

      <View style={styles.forecastFooter}>
        <View style={styles.forecastFooterLeft}>
          <Text style={[styles.forecastValue, { color: text }]}>{formatCurrency(selectedValue)}</Text>
          <Text style={[styles.forecastChange, { color: changePct >= 0 ? '#059669' : '#f43f5e' }]}>
            {changePct >= 0 ? '+' : ''}
            {changePct.toFixed(1)}%
          </Text>
        </View>
        <Text style={[styles.forecastMeta, { color: subtle }]}>
          {selectedItem
            ? `${selectedItem.label}${selectedItem.isForecast ? '（预测）' : '（历史）'}`
            : '点击月份查看'}
        </Text>
      </View>
    </View>
  );
}

export function CashFlowForecastSection({ surface, text, subtle, border, isDark }: ThemeProps) {
  const {
    aiLoading,
    aiError,
    analysisStale,
    zhipuReady,
    aiDashboard,
    savingsForecastSeries,
    incomeForecastSeries,
    surplusForecastSeries,
    savingsForecastTimeline,
    incomeForecastTimeline,
    runAiAnalysis,
  } = useFinanceInsights();

  const [selectedSavingsIdx, setSelectedSavingsIdx] = useState(5);
  const [selectedIncomeIdx, setSelectedIncomeIdx] = useState(5);
  const [selectedSurplusIdx, setSelectedSurplusIdx] = useState(5);

  return (
    <View style={styles.forecastSection}>
      <View style={styles.waterfallHeaderRow}>
        <Text style={[styles.sectionKicker, { color: subtle }]}>AI 趋势预测</Text>
        <Pressable
          onPress={runAiAnalysis}
          disabled={aiLoading || !zhipuReady}
          style={({ pressed }) => [
            styles.updateBtn,
            {
              borderColor: border,
              backgroundColor: isDark ? 'rgba(124,58,237,0.12)' : '#f5f3ff',
              opacity: pressed || aiLoading || !zhipuReady ? 0.5 : 1,
            },
          ]}>
          {aiLoading ? (
            <ActivityIndicator size="small" color="#7c3aed" />
          ) : (
            <MaterialIcons name="auto-awesome" size={14} color="#7c3aed" />
          )}
          <Text style={styles.updateBtnText}>{aiLoading ? '分析中…' : aiDashboard ? '更新预测' : '生成预测'}</Text>
        </Pressable>
      </View>

      {analysisStale ? (
        <View
          style={[
            styles.staleBanner,
            { backgroundColor: isDark ? 'rgba(245,158,11,0.12)' : '#fffbeb', borderColor: border },
          ]}>
          <MaterialIcons name="info-outline" size={16} color="#d97706" />
          <Text style={[styles.staleText, { color: subtle }]}>
            账单或现金流数据已变化，预测可能过时。点击「更新预测」同步。
          </Text>
        </View>
      ) : null}

      {aiError && !aiLoading ? (
        <Text style={[styles.errorText, { marginBottom: 8 }]}>{aiError}</Text>
      ) : null}

      {!aiDashboard && !aiLoading ? (
        <Text style={[styles.emptyHint, { color: subtle }]}>
          {zhipuReady
            ? '储蓄增长已按账户净资产与自由现金流实时计算；点击「生成预测」可补充收入与月盈余 AI 曲线。'
            : '未配置智谱 API，收入与月盈余预测不可用；储蓄增长仍按账户净资产与自由现金流计算。'}
        </Text>
      ) : null}

      <ForecastChartCard
        title="储蓄增长预测"
        subtitle="过去 6 个月为账户净资产快照；本月锚定现有净资产；虚线右侧按本页自由现金流逐月叠加"
        accent="#2563eb"
        series={savingsForecastSeries}
        timeline={savingsForecastTimeline}
        selectedIndex={selectedSavingsIdx}
        onSelectIndex={setSelectedSavingsIdx}
        gradId="cfSavingsGrad"
        showAiBadge={false}
        surface={surface}
        text={text}
        subtle={subtle}
        border={border}
        isDark={isDark}
      />

      {aiDashboard || aiLoading ? (
        <>
          <ForecastChartCard
            title="收入增长趋势"
            subtitle="过去 6 个月与后 6 个月，基于记账流水由 AI 生成"
            accent="#059669"
            series={incomeForecastSeries}
            timeline={incomeForecastTimeline}
            selectedIndex={selectedIncomeIdx}
            onSelectIndex={setSelectedIncomeIdx}
            gradId="cfIncomeGrad"
            surface={surface}
            text={text}
            subtle={subtle}
            border={border}
            isDark={isDark}
          />

          <ForecastChartCard
            title="月盈余增长趋势"
            subtitle="月收入减支出；虚线右侧为 AI 预测"
            accent="#7c3aed"
            series={surplusForecastSeries}
            timeline={savingsForecastTimeline}
            selectedIndex={selectedSurplusIdx}
            onSelectIndex={setSelectedSurplusIdx}
            gradId="cfSurplusGrad"
            surface={surface}
            text={text}
            subtle={subtle}
            border={border}
            isDark={isDark}
          />
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 24,
    borderWidth: 1,
    padding: 16,
    alignSelf: 'stretch',
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle: { fontSize: 15, fontWeight: '900' },
  healthWrap: { marginTop: 4, width: 140, height: 140, alignSelf: 'center', alignItems: 'center', justifyContent: 'center' },
  healthCenter: { position: 'absolute', alignItems: 'center' },
  healthScore: { fontSize: 36, fontWeight: '900' },
  healthTotal: { fontSize: 11, fontWeight: '800' },
  healthDesc: { marginTop: 12, fontSize: 12, lineHeight: 20, fontWeight: '600', textAlign: 'center' },
  forecastSection: { marginTop: 16, marginBottom: 4 },
  waterfallHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    paddingHorizontal: 2,
  },
  sectionKicker: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  updateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
  },
  updateBtnText: { fontSize: 11, fontWeight: '800', color: '#7c3aed' },
  staleBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 10,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 10,
  },
  staleText: { flex: 1, fontSize: 11, lineHeight: 16, fontWeight: '600' },
  errorText: { fontSize: 12, color: '#f43f5e', lineHeight: 18 },
  emptyHint: { fontSize: 12, lineHeight: 18, marginBottom: 10, paddingHorizontal: 2 },
  forecastTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  forecastTitle: { fontSize: 14, fontWeight: '800' },
  forecastBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  forecastBadgeText: { fontSize: 9, fontWeight: '900', letterSpacing: 0.8 },
  forecastSub: { fontSize: 11, marginBottom: 8, lineHeight: 16 },
  chartBox: { marginTop: 4 },
  monthLabels: { marginTop: 2, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  monthLabelBtn: { minWidth: 22, alignItems: 'center', gap: 2 },
  monthLabel: { fontSize: 9, fontWeight: '800' },
  monthLabelSelected: { fontSize: 12, fontWeight: '900' },
  currentMonthBadge: { borderRadius: 999, paddingHorizontal: 4, paddingVertical: 1 },
  currentMonthBadgeText: { fontSize: 7, fontWeight: '900' },
  forecastFooter: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 8,
  },
  forecastFooterLeft: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  forecastValue: { fontSize: 22, fontWeight: '900' },
  forecastChange: { fontSize: 11, fontWeight: '900' },
  forecastMeta: { fontSize: 11, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
});
