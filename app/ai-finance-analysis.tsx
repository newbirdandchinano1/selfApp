import { useColorScheme } from '@/hooks/use-color-scheme';
import { getFinanceFlowCategories, getFinanceTransactions } from '@/lib/repositories/finance/finance';
import { analyzeAiFinanceDashboardFromText, getActiveAiLlmApiKey, type AiFinanceDashboardPayload } from '@/lib/zhipu-image-parse';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, Line, LinearGradient, Path, Stop } from 'react-native-svg';


const AI_FINANCE_CACHE_KEY = 'ai_finance_dashboard_cache_v1';

const AI_PAGE_FALLBACK_INSIGHTS: AiFinanceDashboardPayload['insights'] = [
  {
    title: '现金流',
    body: '发薪后先转出一笔固定储蓄，再安排可变支出，能降低「不知不觉花完」的概率。',
  },
  {
    title: '记录习惯',
    body: '支出分类越完整，越容易发现高频小额支出；可先抓 TOP3 分类做预算上限。',
  },
];

export default function AiFinanceAnalysisScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  const bg = isDark ? '#0f172a' : '#faf8ff';
  const surface = isDark ? '#1e293b' : '#ffffff';
  const surfaceLow = isDark ? 'rgba(148,163,184,0.10)' : '#f2f3ff';
  const text = isDark ? '#f8fafc' : '#131b2e';
  const subtle = isDark ? '#94a3b8' : '#64748b';
  const outline = isDark ? 'rgba(148,163,184,0.22)' : 'rgba(194,198,214,0.5)';

  const tertiary = isDark ? '#fbbf24' : '#825100';
  const primary = isDark ? '#60a5fa' : '#0058be';
  const secondary = isDark ? '#34d399' : '#006c49';

  const healthSize = 160;
  const healthStroke = 8;
  const healthR = (healthSize - healthStroke) / 2;
  const healthC = 2 * Math.PI * healthR;
  const [aiDashboard, setAiDashboard] = React.useState<AiFinanceDashboardPayload | null>(null);
  const [aiDashboardLoading, setAiDashboardLoading] = React.useState(false);
  const [aiDashboardError, setAiDashboardError] = React.useState<string | null>(null);
  const [savedDigest, setSavedDigest] = React.useState<string | null>(null);
  const aiDashboardReqRef = React.useRef(0);
  const [bootReady, setBootReady] = React.useState(false);
  const [past6Net, setPast6Net] = React.useState<number[]>([0, 0, 0, 0, 0, 0]);
  const [past6Income, setPast6Income] = React.useState<number[]>([0, 0, 0, 0, 0, 0]);
  const [past6MonthKeys, setPast6MonthKeys] = React.useState<string[]>(['', '', '', '', '', '']);
  const [monthlyIncome, setMonthlyIncome] = React.useState(0);
  const [monthlyExpense, setMonthlyExpense] = React.useState(0);
  const [monthlySavingsDelta, setMonthlySavingsDelta] = React.useState(0);
  const [expenseBreakdownRows, setExpenseBreakdownRows] = React.useState<Array<{ name: string; amount: number; pct: number; color: string }>>([]);
  const [savingsForecastLabels, setSavingsForecastLabels] = React.useState<string[]>([]);
  const [savingsForecastTimeline, setSavingsForecastTimeline] = React.useState<Array<{ key: string; label: string; isForecast: boolean }>>([]);
  const [incomeForecastTimeline, setIncomeForecastTimeline] = React.useState<Array<{ key: string; label: string; isForecast: boolean }>>([]);
  const [selectedForecastIndex, setSelectedForecastIndex] = React.useState(5);
  const [selectedSurplusForecastIndex, setSelectedSurplusForecastIndex] = React.useState(5);
  const [selectedIncomeForecastIndex, setSelectedIncomeForecastIndex] = React.useState(5);

  const formatCurrency = React.useCallback((value: number) => `¥${value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`, []);

  const savingsForecastSeries = React.useMemo(
    () => aiDashboard?.savings_forecast_12 ?? Array.from({ length: 12 }, () => 0),
    [aiDashboard],
  );
  const incomeForecastSeries = React.useMemo(
    () => aiDashboard?.income_forecast_12 ?? Array.from({ length: 12 }, () => 0),
    [aiDashboard],
  );
  const surplusForecastSeries = React.useMemo(
    () => aiDashboard?.surplus_forecast_12 ?? Array.from({ length: 12 }, () => 0),
    [aiDashboard],
  );

  const loadMonthlyOverview = React.useCallback(async () => {
    setBootReady(false);
    try {
      const [transactions, categories] = await Promise.all([getFinanceTransactions(), getFinanceFlowCategories()]);
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
      const colors = [tertiary, '#94a3b8', '#cbd5e1', '#818cf8', '#22c55e'];
      const topExpenseRows = Array.from(expenseBucket.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([categoryId, amount], index) => ({
          name: categoryNameMap.get(categoryId) ?? '未分类',
          amount,
          pct: thisExpense > 0 ? amount / thisExpense : 0,
          color: colors[index % colors.length],
        }));
      setExpenseBreakdownRows(topExpenseRows);

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

      const historyNets = monthStarts.map((start) => {
        const key = monthKey(start);
        return (monthIncome.get(key) ?? 0) - (monthExpense.get(key) ?? 0);
      });
      const historyIncomes = monthStarts.map((start) => monthIncome.get(monthKey(start)) ?? 0);
      const monthKeys = monthStarts.map((start) => monthKey(start));

      setPast6Net(historyNets);
      setPast6Income(historyIncomes);
      setPast6MonthKeys(monthKeys);

      const labels = Array.from({ length: 12 }, (_, idx) => {
        const date = new Date(now.getFullYear(), now.getMonth() - 5 + idx, 1);
        return `${date.getMonth() + 1}月`;
      });
      const timeline = Array.from({ length: 12 }, (_, idx) => {
        const date = new Date(now.getFullYear(), now.getMonth() - 5 + idx, 1);
        return {
          key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`,
          label: `${date.getMonth() + 1}月`,
          isForecast: idx > 5,
        };
      });

      setSavingsForecastLabels(labels);
      setSavingsForecastTimeline(timeline);
      setIncomeForecastTimeline(timeline);
      setSelectedForecastIndex(5);
      setSelectedSurplusForecastIndex(5);
      setSelectedIncomeForecastIndex(5);
    } catch (error) {
      console.warn('Failed to load monthly overview:', error);
      setMonthlyIncome(0);
      setMonthlyExpense(0);
      setMonthlySavingsDelta(0);
      setExpenseBreakdownRows([]);
      setPast6Net([0, 0, 0, 0, 0, 0]);
      setPast6Income([0, 0, 0, 0, 0, 0]);
      setPast6MonthKeys(['', '', '', '', '', '']);
      setSavingsForecastLabels([]);
      setSavingsForecastTimeline([]);
      setIncomeForecastTimeline([]);
      setSelectedForecastIndex(5);
      setSelectedSurplusForecastIndex(5);
      setSelectedIncomeForecastIndex(5);
    } finally {
      setBootReady(true);
    }
  }, [tertiary]);

  const savingsForecastChart = React.useMemo(() => {
    const points = savingsForecastSeries.length ? savingsForecastSeries : Array(12).fill(0);
    const min = Math.min(...points);
    const max = Math.max(...points);
    const range = Math.max(1, max - min);
    const width = 400;
    const height = 200;
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
    const toPath = (list: Array<{ x: number; y: number }>) => list.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x},${p.y}`).join(' ');
    const historyPath = toPath(history);
    const futurePath = toPath(future);
    const areaPath = `${toPath(mapped)} V 200 H 0 Z`;
    return { mapped, historyPath, futurePath, areaPath };
  }, [savingsForecastSeries]);

  const surplusForecastChart = React.useMemo(() => {
    const points = surplusForecastSeries.length ? surplusForecastSeries : Array(12).fill(0);
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
    const toPath = (list: Array<{ x: number; y: number }>) => list.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x},${p.y}`).join(' ');
    return {
      mapped,
      historyPath: toPath(history),
      futurePath: toPath(future),
      areaPath: `${toPath(mapped)} V 200 H 0 Z`,
    };
  }, [surplusForecastSeries]);

  const selectedForecastValue = savingsForecastSeries[selectedForecastIndex] ?? 0;
  const selectedForecastItem = savingsForecastTimeline[selectedForecastIndex];
  const selectedForecastChangePct = React.useMemo(() => {
    if (selectedForecastIndex <= 0) return 0;
    const prev = savingsForecastSeries[selectedForecastIndex - 1] ?? 0;
    if (prev === 0) return 0;
    return ((selectedForecastValue - prev) / Math.abs(prev)) * 100;
  }, [savingsForecastSeries, selectedForecastIndex, selectedForecastValue]);

  const selectedSurplusValue = surplusForecastSeries[selectedSurplusForecastIndex] ?? 0;
  const selectedSurplusItem = savingsForecastTimeline[selectedSurplusForecastIndex];
  const selectedSurplusChangePct = React.useMemo(() => {
    if (selectedSurplusForecastIndex <= 0) return 0;
    const prev = surplusForecastSeries[selectedSurplusForecastIndex - 1] ?? 0;
    if (prev === 0) return 0;
    return ((selectedSurplusValue - prev) / Math.abs(prev)) * 100;
  }, [surplusForecastSeries, selectedSurplusForecastIndex, selectedSurplusValue]);

  const incomeForecastChart = React.useMemo(() => {
    const points = incomeForecastSeries.length ? incomeForecastSeries : Array(12).fill(0);
    const min = Math.min(...points);
    const max = Math.max(...points);
    const range = Math.max(1, max - min);
    const width = 400;
    const height = 200;
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
    const toPath = (list: Array<{ x: number; y: number }>) => list.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x},${p.y}`).join(' ');
    const historyPath = toPath(history);
    const futurePath = toPath(future);
    const areaPath = `${toPath(mapped)} V ${height} H 0 Z`;
    return { mapped, historyPath, futurePath, areaPath };
  }, [incomeForecastSeries]);

  const selectedIncomeValue = incomeForecastSeries[selectedIncomeForecastIndex] ?? 0;
  const selectedIncomeItem = incomeForecastTimeline[selectedIncomeForecastIndex];
  const selectedIncomeChangePct = React.useMemo(() => {
    if (selectedIncomeForecastIndex <= 0) return 0;
    const prev = incomeForecastSeries[selectedIncomeForecastIndex - 1] ?? 0;
    if (prev === 0) return 0;
    return ((selectedIncomeValue - prev) / Math.abs(prev)) * 100;
  }, [incomeForecastSeries, selectedIncomeForecastIndex, selectedIncomeValue]);

  const aiFinanceDigest = React.useMemo(() => {
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
      lines.push(`  - ${mk}: 月收入 ${(past6Income[i] ?? 0).toFixed(2)} ，月净储蓄(收入−支出) ${(past6Net[i] ?? 0).toFixed(2)}`);
    }
    if (!expenseBreakdownRows.length) {
      lines.push('本月可聚合的支出分类：暂无或支出为0。');
    } else {
      lines.push('本月支出分类 TOP:');
      expenseBreakdownRows.forEach((r) =>
        lines.push(`  - ${r.name}: ${r.amount.toFixed(2)} 元，占本月支出 ${(r.pct * 100).toFixed(1)}%`),
      );
    }
    return lines.join('\n');
  }, [expenseBreakdownRows, monthlyExpense, monthlyIncome, monthlySavingsDelta, past6Income, past6MonthKeys, past6Net]);

  const fallbackHealthScore = React.useMemo(() => {
    if (monthlyIncome <= 0) return monthlyExpense > 0 ? 48 : 55;
    const rate = Math.max(0, Math.min(1, (monthlyIncome - monthlyExpense) / monthlyIncome));
    return Math.round(42 + rate * 52);
  }, [monthlyExpense, monthlyIncome]);

  const displayHealthScore = aiDashboard?.health_score ?? fallbackHealthScore;
  const healthPct = Math.max(0.04, Math.min(1, displayHealthScore / 100));

  const analysisStale = React.useMemo(
    () => !!(savedDigest && savedDigest !== aiFinanceDigest),
    [aiFinanceDigest, savedDigest],
  );

  const runAiAnalysis = React.useCallback(async () => {
    const seq = ++aiDashboardReqRef.current;
    setAiDashboardLoading(true);
    setAiDashboardError(null);
    try {
      const r = await analyzeAiFinanceDashboardFromText({
        apiKey: getActiveAiLlmApiKey(),
        summaryText: aiFinanceDigest,
        past6NetSavings: past6Net,
        past6Income: past6Income,
        maxAttempts: 12,
        retryDelayMs: 1000,
      });
      if (seq !== aiDashboardReqRef.current) return;
      if (r.ok) {
        setAiDashboard(r.data);
        setAiDashboardError(null);
        setSavedDigest(aiFinanceDigest);
        try {
          await AsyncStorage.setItem(
            AI_FINANCE_CACHE_KEY,
            JSON.stringify({ digest: aiFinanceDigest, savedAt: Date.now(), payload: r.data }),
          );
        } catch {
          // 忽略持久化失败
        }
      } else {
        setAiDashboardError(r.error);
      }
    } catch (e) {
      if (seq === aiDashboardReqRef.current) {
        setAiDashboardError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (seq === aiDashboardReqRef.current) {
        setAiDashboardLoading(false);
      }
    }
  }, [aiFinanceDigest, past6Income, past6Net]);

  React.useEffect(() => {
    if (!bootReady) return;
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(AI_FINANCE_CACHE_KEY);
        if (cancelled || !raw) return;
        const parsed = JSON.parse(raw) as { digest?: string; payload?: AiFinanceDashboardPayload };
        if (parsed?.payload && !cancelled) {
          setAiDashboard(parsed.payload);
          if (typeof parsed.digest === 'string') setSavedDigest(parsed.digest);
        }
      } catch {
        // 忽略损坏的缓存
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bootReady]);

  React.useEffect(() => {
    void loadMonthlyOverview();
  }, [loadMonthlyOverview]);

  useFocusEffect(
    React.useCallback(() => {
      void loadMonthlyOverview();
    }, [loadMonthlyOverview])
  );

  const pageLocked = !bootReady || aiDashboardLoading;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: bg }]}>
      <View style={[styles.header, { backgroundColor: isDark ? 'rgba(15,23,42,0.85)' : 'rgba(255,255,255,0.82)' }]}>
        <View style={styles.headerLeft}>
          <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.75 }]}>
            <MaterialIcons name="arrow-back" size={22} color={text} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: text }]}>AI 财务分析</Text>
        </View>
        <Pressable
          onPress={() => void runAiAnalysis()}
          disabled={aiDashboardLoading || !bootReady}
          style={({ pressed }) => [
            styles.headerAnalyzeBtn,
            { borderColor: outline, backgroundColor: isDark ? 'rgba(96,165,250,0.12)' : 'rgba(0,88,190,0.08)' },
            pressed && { opacity: 0.82 },
            (aiDashboardLoading || !bootReady) && { opacity: 0.45 },
          ]}>
          <MaterialIcons name="auto-awesome" size={18} color={primary} />
          <Text style={[styles.headerAnalyzeBtnText, { color: primary }]}>{aiDashboardLoading ? '分析中…' : '更新分析'}</Text>
        </Pressable>
      </View>

      {analysisStale ? (
        <View style={[styles.staleBanner, { backgroundColor: isDark ? 'rgba(251,191,36,0.14)' : '#fff7ed', borderColor: outline }]}>
          <MaterialIcons name="info-outline" size={18} color={tertiary} />
          <Text style={[styles.staleBannerText, { color: text }]}>
            本地账单或分类已变化，以下为上次保存的分析。点击「更新分析」获取与当前数据一致的结论。
          </Text>
        </View>
      ) : null}

      {aiDashboardError && !aiDashboardLoading ? (
        <View style={[styles.errorBanner, { borderColor: 'rgba(220,38,38,0.35)' }]}>
          <MaterialIcons name="error-outline" size={18} color="#dc2626" />
          <Text style={styles.errorBannerText}>{aiDashboardError}</Text>
        </View>
      ) : null}

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={[styles.summaryCard, { backgroundColor: surface }]}>
          <View style={[styles.leftAccent, { backgroundColor: tertiary }]} />
          <Text style={[styles.kicker, { color: subtle }]}>本月汇总</Text>
          <Text style={[styles.summaryTitle, { color: text }]}>本月收支概览</Text>

          <View style={styles.summaryRow}>
            <View>
              <Text style={[styles.label, { color: subtle }]}>本月收入</Text>
              <Text style={[styles.bigNum, { color: text }]}>{formatCurrency(monthlyIncome)}</Text>
            </View>
            <View>
              <Text style={[styles.label, { color: subtle }]}>本月支出</Text>
              <Text style={[styles.bigNum, { color: tertiary }]}>{formatCurrency(monthlyExpense)}</Text>
            </View>
          </View>

          <View style={[styles.summaryFooter, { borderTopColor: outline }]}>
            <View style={styles.inlineRow}>
              <MaterialIcons name="trending-up" size={15} color={secondary} />
              <Text style={[styles.saveText, { color: secondary }]}>
                {monthlySavingsDelta >= 0 ? `较上月提升 ${monthlySavingsDelta.toFixed(1)}%` : `较上月下降 ${Math.abs(monthlySavingsDelta).toFixed(1)}%`}
              </Text>
            </View>
          </View>
        </View>

        <View style={[styles.healthCard, { backgroundColor: surfaceLow }]}>
          <Text style={[styles.kicker, { color: subtle }]}>健康评分</Text>
          <View style={styles.healthWrap}>
            <Svg width={healthSize} height={healthSize} style={{ transform: [{ rotate: '-90deg' }] }}>
              <Circle cx={healthSize / 2} cy={healthSize / 2} r={healthR} stroke={isDark ? 'rgba(148,163,184,0.25)' : 'rgba(194,198,214,0.35)'} strokeWidth={2} fill="none" />
              <Circle
                cx={healthSize / 2}
                cy={healthSize / 2}
                r={healthR}
                stroke={tertiary}
                strokeWidth={healthStroke}
                strokeDasharray={`${healthC * healthPct} ${healthC * (1 - healthPct)}`}
                strokeLinecap="butt"
                fill="none"
              />
            </Svg>
            <View style={styles.healthCenter}>
              {aiDashboardLoading ? (
                <ActivityIndicator size="large" color={tertiary} />
              ) : (
                <>
                  <Text style={[styles.healthScore, { color: text }]}>{displayHealthScore}</Text>
                  <Text style={[styles.healthTotal, { color: subtle }]}>/ 100</Text>
                </>
              )}
            </View>
          </View>
          <Text style={[styles.healthTitle, { color: text }]}>财务健康分</Text>
          <Text style={[styles.healthDesc, { color: subtle }]}>
            {aiDashboardLoading
              ? '正在请求智谱 GLM…'
              : aiDashboard?.health_summary ??
                (aiDashboardError
                  ? `智谱接口异常，圆环为本地估算（${fallbackHealthScore} 分）。可稍后重试「更新分析」。`
                  : '暂无已保存的 AI 分析。点击右上角「更新分析」生成健康分与预测曲线；结果会保存在本机。')}
          </Text>
        </View>

        <View style={styles.insightSection}>
          <View style={styles.insightHead}>
            <View style={[styles.insightLine, { backgroundColor: tertiary }]} />
            <Text style={[styles.insightTitle, { color: text }]}>AI 深度洞察</Text>
          </View>

          <View style={styles.gridGap}>
            {aiDashboardLoading ? (
              <>
                <View style={[styles.insightCard, { backgroundColor: surfaceLow, borderColor: outline }]}>
                  <ActivityIndicator size="small" color={secondary} style={{ alignSelf: 'flex-start' }} />
                  <Text style={[styles.insightBody, { color: subtle }]}>模型正在生成分条建议…</Text>
                </View>
                <View style={[styles.insightCard, { backgroundColor: surfaceLow, borderColor: outline }]}>
                  <ActivityIndicator size="small" color={primary} style={{ alignSelf: 'flex-start' }} />
                  <Text style={[styles.insightBody, { color: subtle }]}>请稍候</Text>
                </View>
              </>
            ) : (
              (aiDashboard?.insights ?? AI_PAGE_FALLBACK_INSIGHTS).map((card, idx) => (
                <View key={`${card.title}-${idx}`} style={[styles.insightCard, { backgroundColor: surfaceLow, borderColor: outline }]}>
                  <View style={styles.inlineRow}>
                    <MaterialIcons name={idx === 0 ? 'verified' : 'savings'} size={18} color={idx === 0 ? secondary : primary} />
                    <Text style={[styles.insightKicker, { color: subtle }]}>{card.title}</Text>
                  </View>
                  <Text style={[styles.insightBody, { color: subtle }]}>{card.body}</Text>
                </View>
              ))
            )}
          </View>
        </View>

        <View style={styles.gridGap}>
          <View style={[styles.panelCard, { backgroundColor: surface }]}>
            <View style={styles.panelTitleRow}>
              <Text style={[styles.panelTitle, { color: text }]}>支出分类构成</Text>
              <MaterialIcons name="pie-chart" size={20} color={subtle} />
            </View>

            {(expenseBreakdownRows.length > 0
              ? expenseBreakdownRows.map((row) => ({
                  ...row,
                  val: `${formatCurrency(row.amount)} (${(row.pct * 100).toFixed(1)}%)`,
                }))
              : [{ name: '暂无支出数据', val: '¥0 (0%)', pct: 0, color: '#94a3b8' }]
            ).map((row) => (
              <View key={row.name} style={styles.barBlock}>
                <View style={styles.barHead}>
                  <Text style={[styles.barName, { color: text }]}>{row.name}</Text>
                  <Text style={[styles.barVal, { color: text }]}>{row.val}</Text>
                </View>
                <View style={[styles.track, { backgroundColor: isDark ? 'rgba(148,163,184,0.2)' : '#f1f5f9' }]}>
                  <View style={[styles.fill, { width: `${row.pct * 100}%`, backgroundColor: row.color }]} />
                </View>
              </View>
            ))}

            <View style={[styles.tipCard, { backgroundColor: isDark ? 'rgba(148,163,184,0.12)' : '#f8fafc', borderColor: outline }]}>
              <MaterialIcons name="lightbulb" size={18} color={tertiary} />
              <Text style={[styles.tipText, { color: subtle }]}>
                {aiDashboardLoading
                  ? '正在生成支出结构点评…'
                  : aiDashboard?.expense_breakdown_comment ??
                    (aiDashboardError
                      ? `上次分析失败，仍显示上一次成功的结果。可点右上角「更新分析」重试。详情：${aiDashboardError}`
                      : expenseBreakdownRows.length > 0
                        ? '点击右上角「更新分析」可生成支出结构解读。'
                        : '暂无本月支出数据，模型无法分析结构；多记账后可重试。')}
              </Text>
            </View>
          </View>

          <View style={[styles.panelCard, { backgroundColor: surface }]}>
            <View style={styles.panelTitleRow}>
              <Text style={[styles.panelTitle, { color: text }]}>储蓄增长预测</Text>
              <View style={[styles.badge, { backgroundColor: isDark ? 'rgba(251,191,36,0.2)' : '#ffddb8' }]}>
                <Text style={[styles.badgeText, { color: tertiary }]}>预测</Text>
              </View>
            </View>
            <Text style={[styles.healthDesc, { color: subtle, marginBottom: 8 }]}>过去 6 个月与后 6 个月由 AI 根据账单生成（曲线与下方数值以模型输出为准）</Text>

            <View style={styles.chartBox}>
              <Svg width="100%" height="180" viewBox="0 0 400 200">
                {[180, 130, 80, 30].map((y) => (
                  <Line key={y} x1="0" y1={y} x2="400" y2={y} stroke={isDark ? 'rgba(148,163,184,0.16)' : '#f1f5f9'} strokeWidth="1" />
                ))}
                {savingsForecastChart.mapped[5] ? (
                  <Line
                    x1={savingsForecastChart.mapped[5].x}
                    y1="18"
                    x2={savingsForecastChart.mapped[5].x}
                    y2="186"
                    stroke={isDark ? 'rgba(251,191,36,0.30)' : 'rgba(130,81,0,0.35)'}
                    strokeDasharray="4 4"
                    strokeWidth="1.5"
                  />
                ) : null}
                <Path d={savingsForecastChart.historyPath} fill="none" stroke={tertiary} strokeWidth="3" />
                <Path d={savingsForecastChart.futurePath} fill="none" stroke={tertiary} strokeDasharray="6 6" strokeWidth="3" />
                <Defs>
                  <LinearGradient id="forecastGrad" x1="0" y1="0" x2="0" y2="1">
                    <Stop offset="0" stopColor={tertiary} stopOpacity="0.2" />
                    <Stop offset="1" stopColor={tertiary} stopOpacity="0" />
                  </LinearGradient>
                </Defs>
                <Path d={savingsForecastChart.areaPath} fill="url(#forecastGrad)" />
                {savingsForecastChart.mapped.map((p, i) => (
                  <Circle
                    key={i}
                    cx={p.x}
                    cy={p.y}
                    r={i === selectedForecastIndex ? 5.5 : i === savingsForecastChart.mapped.length - 1 ? 5 : 3.5}
                    fill={tertiary}
                    stroke={i === selectedForecastIndex ? '#ffffff' : i >= 6 ? '#fff' : 'none'}
                    strokeWidth={i === selectedForecastIndex ? 2 : 1.5}
                    onPress={() => setSelectedForecastIndex(i)}
                  />
                ))}
              </Svg>
              <View style={styles.monthLabels}>
                {(savingsForecastTimeline.length > 0 ? savingsForecastTimeline : [{ key: 'fallback', label: '-', isForecast: false }]).map((item, idx) => (
                  <Pressable key={item.key} onPress={() => setSelectedForecastIndex(idx)} style={styles.monthLabelBtn}>
                    <Text
                      style={[
                        styles.monthLabel,
                        idx === selectedForecastIndex && styles.monthLabelSelected,
                        { color: idx === selectedForecastIndex ? tertiary : item.isForecast ? tertiary : subtle },
                      ]}>
                      {item.label}
                    </Text>
                    {idx === 5 ? (
                      <View style={[styles.currentMonthBadge, { backgroundColor: idx === selectedForecastIndex ? tertiary : `${tertiary}30` }]}>
                        <Text style={[styles.currentMonthBadgeText, { color: idx === selectedForecastIndex ? '#ffffff' : tertiary }]}>本月</Text>
                      </View>
                    ) : null}
                  </Pressable>
                ))}
              </View>
            </View>

            <View style={styles.forecastFooter}>
              <View style={styles.inlineRow}>
                <Text style={[styles.forecastValue, { color: text }]}>{formatCurrency(selectedForecastValue)}</Text>
                <Text style={[styles.forecastUp, { color: selectedForecastChangePct >= 0 ? secondary : '#dc2626' }]}>
                  {selectedForecastChangePct >= 0 ? '+' : ''}
                  {selectedForecastChangePct.toFixed(1)}%
                </Text>
              </View>
              <Text style={[styles.forecastMeta, { color: subtle }]}>
                {selectedForecastItem ? `${selectedForecastItem.label}${selectedForecastItem.isForecast ? '（预测）' : '（历史）'}，相较上月变化` : '点击月份查看该月数据'}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.trendGrid}>
          <View style={[styles.trendMiniCard, { backgroundColor: surface, borderColor: outline }]}>
            <View style={styles.panelTitleRow}>
              <Text style={[styles.panelTitle, { color: text }]}>收入增长趋势</Text>
              <View style={[styles.badge, { backgroundColor: isDark ? 'rgba(96,165,250,0.18)' : '#dbeafe' }]}>
                <Text style={[styles.badgeText, { color: primary }]}>趋势</Text>
              </View>
            </View>
            <Text style={[styles.healthDesc, { color: subtle, marginBottom: 8 }]}>过去 6 个月与后 6 个月由 AI 根据账单生成</Text>

            <View style={styles.chartBox}>
              <Svg width="100%" height="180" viewBox="0 0 400 200">
                {[180, 130, 80, 30].map((y) => (
                  <Line key={`income-grid-${y}`} x1="0" y1={y} x2="400" y2={y} stroke={isDark ? 'rgba(148,163,184,0.16)' : '#f1f5f9'} strokeWidth="1" />
                ))}
                {incomeForecastChart.mapped[5] ? (
                  <Line
                    x1={incomeForecastChart.mapped[5].x}
                    y1="18"
                    x2={incomeForecastChart.mapped[5].x}
                    y2="186"
                    stroke={isDark ? 'rgba(96,165,250,0.30)' : 'rgba(0,88,190,0.30)'}
                    strokeDasharray="4 4"
                    strokeWidth="1.5"
                  />
                ) : null}
                <Path d={incomeForecastChart.historyPath} fill="none" stroke={primary} strokeWidth="3" />
                <Path d={incomeForecastChart.futurePath} fill="none" stroke={primary} strokeDasharray="6 6" strokeWidth="3" />
                <Defs>
                  <LinearGradient id="incomeForecastGrad" x1="0" y1="0" x2="0" y2="1">
                    <Stop offset="0" stopColor={primary} stopOpacity="0.18" />
                    <Stop offset="1" stopColor={primary} stopOpacity="0" />
                  </LinearGradient>
                </Defs>
                <Path d={incomeForecastChart.areaPath} fill="url(#incomeForecastGrad)" />
                {incomeForecastChart.mapped.map((p, i) => (
                  <Circle
                    key={`income-hit-${i}`}
                    cx={p.x}
                    cy={p.y}
                    r={10}
                    fill="transparent"
                    stroke="transparent"
                    onPress={() => setSelectedIncomeForecastIndex(i)}
                  />
                ))}
                {incomeForecastChart.mapped.map((p, i) => {
                  const isSelected = i === selectedIncomeForecastIndex;
                  const isDivider = i === 5;
                  const isLast = i === incomeForecastChart.mapped.length - 1;
                  if (!isSelected && !isDivider && !isLast) return null;
                  return (
                    <Circle
                      key={`income-point-${i}`}
                      cx={p.x}
                      cy={p.y}
                      r={isSelected ? 5.5 : 3.5}
                      fill={primary}
                      stroke={isSelected ? '#ffffff' : 'none'}
                      strokeWidth={isSelected ? 2 : 1.5}
                      onPress={() => setSelectedIncomeForecastIndex(i)}
                    />
                  );
                })}
              </Svg>
              <View style={styles.monthLabels}>
                {(incomeForecastTimeline.length > 0 ? incomeForecastTimeline : [{ key: 'income-fallback', label: '-', isForecast: false }]).map((item, idx) => (
                  <Pressable key={item.key} onPress={() => setSelectedIncomeForecastIndex(idx)} style={styles.monthLabelBtn}>
                    <Text
                      style={[
                        styles.monthLabel,
                        idx === selectedIncomeForecastIndex && styles.monthLabelSelected,
                        { color: idx === selectedIncomeForecastIndex ? primary : item.isForecast ? primary : subtle },
                      ]}>
                      {item.label}
                    </Text>
                    {idx === 5 ? (
                      <View style={[styles.currentMonthBadge, { backgroundColor: idx === selectedIncomeForecastIndex ? primary : `${primary}24` }]}>
                        <Text style={[styles.currentMonthBadgeText, { color: idx === selectedIncomeForecastIndex ? '#ffffff' : primary }]}>本月</Text>
                      </View>
                    ) : null}
                  </Pressable>
                ))}
              </View>
            </View>

            <View style={styles.forecastFooter}>
              <View style={styles.inlineRow}>
                <Text style={[styles.forecastValue, { color: text }]}>{formatCurrency(selectedIncomeValue)}</Text>
                <Text style={[styles.forecastUp, { color: selectedIncomeChangePct >= 0 ? secondary : '#dc2626' }]}>
                  {selectedIncomeChangePct >= 0 ? '+' : ''}
                  {selectedIncomeChangePct.toFixed(1)}%
                </Text>
              </View>
              <Text style={[styles.forecastMeta, { color: subtle }]}>
                {selectedIncomeItem ? `${selectedIncomeItem.label}${selectedIncomeItem.isForecast ? '（预测）' : '（历史）'}，相较上月变化` : '点击月份查看该月数据'}
              </Text>
            </View>
          </View>

          <View style={[styles.trendMiniCard, { backgroundColor: surface, borderColor: outline }]}>
            <Text style={[styles.kicker, { color: subtle }]}>月盈余增长趋势</Text>
            <View style={styles.trendMiniHeader}>
              <Text style={[styles.trendMiniValue, { color: text }]}>{formatCurrency(selectedSurplusValue)}</Text>
              <Text style={[styles.trendMiniMeta, { color: secondary }]}>
                {selectedSurplusItem ? `${selectedSurplusItem.label}${selectedSurplusItem.isForecast ? '（预测）' : '（历史）'}` : '本月'}
              </Text>
            </View>
            <View style={styles.trendLineChart}>
              <Svg width="100%" height="180" viewBox="0 0 400 200">
                {[180, 130, 80, 30].map((y) => (
                  <Line key={`surplus-grid-${y}`} x1="0" y1={y} x2="400" y2={y} stroke={isDark ? 'rgba(148,163,184,0.16)' : '#f1f5f9'} strokeWidth="1" />
                ))}
                {surplusForecastChart.mapped[5] ? (
                  <Line
                    x1={surplusForecastChart.mapped[5].x}
                    y1="18"
                    x2={surplusForecastChart.mapped[5].x}
                    y2="186"
                    stroke={isDark ? 'rgba(52,211,153,0.28)' : 'rgba(0,108,73,0.28)'}
                    strokeDasharray="4 4"
                    strokeWidth="1.5"
                  />
                ) : null}
                <Path d={surplusForecastChart.historyPath} fill="none" stroke={secondary} strokeWidth="3" />
                <Path d={surplusForecastChart.futurePath} fill="none" stroke={secondary} strokeDasharray="6 6" strokeWidth="3" />
                <Defs>
                  <LinearGradient id="surplusForecastGrad" x1="0" y1="0" x2="0" y2="1">
                    <Stop offset="0" stopColor={secondary} stopOpacity="0.18" />
                    <Stop offset="1" stopColor={secondary} stopOpacity="0" />
                  </LinearGradient>
                </Defs>
                <Path d={surplusForecastChart.areaPath} fill="url(#surplusForecastGrad)" />
                {surplusForecastChart.mapped.map((p, i) => (
                  <Circle
                    key={`surplus-hit-${i}`}
                    cx={p.x}
                    cy={p.y}
                    r={10}
                    fill="transparent"
                    stroke="transparent"
                    onPress={() => setSelectedSurplusForecastIndex(i)}
                  />
                ))}
                {surplusForecastChart.mapped.map((p, i) => {
                  const isSelected = i === selectedSurplusForecastIndex;
                  const isDivider = i === 5;
                  const isLast = i === surplusForecastChart.mapped.length - 1;
                  if (!isSelected && !isDivider && !isLast) return null;
                  return (
                    <Circle
                      key={`surplus-point-${i}`}
                      cx={p.x}
                      cy={p.y}
                      r={isSelected ? 5.5 : 3.5}
                      fill={secondary}
                      stroke={isSelected ? '#ffffff' : 'none'}
                      strokeWidth={isSelected ? 2 : 1.5}
                      onPress={() => setSelectedSurplusForecastIndex(i)}
                    />
                  );
                })}
              </Svg>
            </View>
            <View style={styles.monthLabels}>
              {(savingsForecastTimeline.length > 0 ? savingsForecastTimeline : [{ key: 'surplus-fallback', label: '-', isForecast: false }]).map((item, idx) => (
                <Pressable key={`surplus-${item.key}`} onPress={() => setSelectedSurplusForecastIndex(idx)} style={styles.monthLabelBtn}>
                  <Text
                    style={[
                      styles.monthLabel,
                      idx === selectedSurplusForecastIndex && styles.monthLabelSelected,
                      { color: idx === selectedSurplusForecastIndex ? secondary : item.isForecast ? secondary : subtle },
                    ]}>
                    {item.label}
                  </Text>
                  {idx === 5 ? (
                    <View style={[styles.currentMonthBadge, { backgroundColor: idx === selectedSurplusForecastIndex ? secondary : `${secondary}24` }]}>
                      <Text style={[styles.currentMonthBadgeText, { color: idx === selectedSurplusForecastIndex ? '#ffffff' : secondary }]}>本月</Text>
                    </View>
                  ) : null}
                </Pressable>
              ))}
            </View>
            <Text style={[styles.trendIncomeFootnote, { color: selectedSurplusChangePct >= 0 ? secondary : '#dc2626' }]}>
              较上月 {selectedSurplusChangePct >= 0 ? '+' : ''}
              {selectedSurplusChangePct.toFixed(1)}%
            </Text>
          </View>
        </View>

      </ScrollView>

      {pageLocked ? (
        <View
          style={[
            styles.screenBlocker,
            { backgroundColor: isDark ? 'rgba(15,23,42,0.82)' : 'rgba(250,248,255,0.94)' },
          ]}
          pointerEvents="auto">
          <Pressable
            onPress={() => router.back()}
            style={[styles.blockerBackFab, { top: Math.max(insets.top, 12) + 8 }]}
            hitSlop={12}>
            <MaterialIcons name="arrow-back" size={22} color="#fff" />
          </Pressable>
          <View style={[styles.blockerInner, { backgroundColor: surface, borderColor: outline }]}>
            {!bootReady ? (
              <>
                <ActivityIndicator size="large" color={primary} />
                <Text style={[styles.blockerTitle, { color: text }]}>正在加载本地账单…</Text>
              </>
            ) : aiDashboardLoading ? (
              <>
                <ActivityIndicator size="large" color={primary} />
                <Text style={[styles.blockerTitle, { color: text }]}>AI 分析中</Text>
                <Text style={[styles.blockerSub, { color: subtle }]}>正在调用智谱模型，请稍候…</Text>
              </>
            ) : null}
          </View>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 18,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  iconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '900' },
  headerAnalyzeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  headerAnalyzeBtnText: { fontSize: 13, fontWeight: '800' },
  staleBanner: {
    marginHorizontal: 18,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  staleBannerText: { flex: 1, fontSize: 13, fontWeight: '600', lineHeight: 19 },
  errorBanner: {
    marginHorizontal: 18,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  errorBannerText: { flex: 1, color: '#dc2626', fontSize: 13, fontWeight: '700', lineHeight: 18 },
  content: { paddingHorizontal: 18, paddingTop: 10, paddingBottom: 28, gap: 12 },
  gridGap: { gap: 12 },
  trendAxisText: { fontSize: 10, fontWeight: '700' },
  trendGrid: { gap: 12 },
  trendMiniCard: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 10 },
  trendMiniHeader: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  trendMiniValue: { fontSize: 34, lineHeight: 40, fontWeight: '800', letterSpacing: -0.8 },
  trendMiniMeta: { fontSize: 13, fontWeight: '700' },
  trendLineChart: { height: 126 },
  trendQuarterRow: { flexDirection: 'row', justifyContent: 'space-between' },
  trendMonthRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  trendMonthBtn: { minWidth: 24, alignItems: 'center', gap: 2 },
  trendMonthText: { fontSize: 9, fontWeight: '800' },
  trendMonthTextSelected: { fontSize: 12, lineHeight: 14, fontWeight: '900' },
  currentMonthMiniBadge: { borderRadius: 999, paddingHorizontal: 4, paddingVertical: 1 },
  currentMonthMiniBadgeText: { fontSize: 7, fontWeight: '900' },
  trendIncomeFootnote: { fontSize: 11, fontWeight: '800', marginTop: 2 },

  summaryCard: { borderRadius: 16, padding: 18, minHeight: 260, overflow: 'hidden' },
  leftAccent: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4 },
  kicker: { fontSize: 11, fontWeight: '800', letterSpacing: 1.4, textTransform: 'uppercase' },
  summaryTitle: { marginTop: 10, marginBottom: 24, fontSize: 28, fontWeight: '900' },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 16 },
  label: { fontSize: 13, fontWeight: '600' },
  bigNum: { marginTop: 6, fontSize: 36, fontWeight: '900', letterSpacing: -0.5 },
  summaryFooter: { marginTop: 22, paddingTop: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 1 },
  inlineRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  saveText: { fontSize: 13, fontWeight: '700' },
  linkText: { fontSize: 13, fontWeight: '700' },

  healthCard: { borderRadius: 16, padding: 18, alignItems: 'center' },
  healthWrap: { marginTop: 8, width: 160, height: 160, alignItems: 'center', justifyContent: 'center' },
  healthCenter: { position: 'absolute', alignItems: 'center' },
  healthScore: { fontSize: 42, fontWeight: '900' },
  healthTotal: { fontSize: 12, fontWeight: '800' },
  healthTitle: { marginTop: 12, fontSize: 22, fontWeight: '900' },
  healthDesc: { marginTop: 6, fontSize: 13, lineHeight: 20, fontWeight: '600' },

  panelCard: { borderRadius: 16, padding: 18 },
  panelTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  panelTitle: { fontSize: 22, fontWeight: '900' },
  barBlock: { marginBottom: 14 },
  barHead: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  barName: { fontSize: 13, fontWeight: '700' },
  barVal: { fontSize: 13, fontWeight: '700' },
  track: { height: 6, borderRadius: 999, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 999 },
  tipCard: { marginTop: 12, borderRadius: 12, borderWidth: 1, padding: 12, flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  tipText: { flex: 1, fontSize: 13, lineHeight: 19, fontWeight: '600' },

  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  badgeText: { fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  chartBox: { marginTop: 8 },
  monthLabels: { marginTop: 4, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  monthLabelBtn: { minWidth: 24, alignItems: 'center', gap: 2 },
  monthLabel: { fontSize: 10, fontWeight: '800' },
  monthLabelSelected: { fontSize: 14, lineHeight: 16, fontWeight: '900' },
  currentMonthBadge: { borderRadius: 999, paddingHorizontal: 5, paddingVertical: 1 },
  currentMonthBadgeText: { fontSize: 8, fontWeight: '900' },
  forecastFooter: { marginTop: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  forecastValue: { fontSize: 28, fontWeight: '900' },
  forecastUp: { fontSize: 12, fontWeight: '900' },
  forecastMeta: { fontSize: 12, fontWeight: '600' },

  insightSection: { marginTop: 4, gap: 12 },
  insightHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  insightLine: { width: 48, height: 2 },
  insightTitle: { fontSize: 26, fontWeight: '900' },
  insightCard: { borderRadius: 16, borderWidth: 1, padding: 14, gap: 8 },
  insightKicker: { fontSize: 11, fontWeight: '900', letterSpacing: 1.4, textTransform: 'uppercase' },
  insightBody: { fontSize: 13, lineHeight: 20, fontWeight: '600' },

  screenBlocker: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 2000,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 22,
  },
  blockerBackFab: {
    position: 'absolute',
    left: 18,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(15,23,42,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  blockerInner: {
    width: '100%',
    maxWidth: 340,
    borderRadius: 18,
    borderWidth: 1,
    paddingVertical: 26,
    paddingHorizontal: 20,
    alignItems: 'center',
    gap: 12,
  },
  blockerTitle: {
    fontSize: 18,
    fontWeight: '900',
    textAlign: 'center',
  },
  blockerSub: {
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 21,
  },
  retryBtn: {
    marginTop: 4,
    paddingVertical: 12,
    paddingHorizontal: 32,
    borderRadius: 12,
  },
  retryBtnText: {
    color: '#fff',
    fontWeight: '900',
    fontSize: 15,
  },
});
