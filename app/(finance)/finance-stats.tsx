import {
  FoldCountUpText,
  FoldRiseIn,
  FOLD_MOTION_EASE,
  useFoldMotionGate,
} from '@/components/review/fold-motion';
import { Layout } from '@/constants/design-tokens';
import { useFinanceFoldTheme } from '@/constants/finance-fold-theme';
import { usePageApiSync, usePagePullRefresh } from '@/hooks/use-page-api-sync';
import { fetchFinanceStats, type FinanceStatsData } from '@/lib/finance-page-api';
import { addDays, formatYmd } from '@/lib/date';
import { analyzeFinanceBillSummaryFromText, getActiveAiLlmApiKey } from '@/lib/zhipu-image-parse';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router/react-navigation';
import { useRouter } from 'expo-router';
import React from 'react';
import {
  ActivityIndicator,
  Animated,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { Alert } from '@/lib/app-feedback';
type RangeTab = '周' | '月' | '年' | '自定义';
type CustomDateField = 'start' | 'end';
type PickerColumn = 'year' | 'month' | 'day';

const RANGE_TABS: RangeTab[] = ['周', '月', '年', '自定义'];
const MAX_CUSTOM_RANGE_DAYS = 731;
const PAGE_API_KEY = 'finance-stats';

const CAT_COLORS = ['#C8785C', '#9A7553', '#779887', '#8A7C95', '#B6B0A1', '#6D9A80', '#A4593F'];
const FIXED_CAT_RE = /居住|房租|房贷|水电|物业|保险|话费|网费|宽带|燃气|贷款|还款/;

function formatMoney(value: number) {
  return `¥${Math.abs(value).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatMoneyShort(value: number) {
  const abs = Math.abs(value);
  if (abs >= 10000) {
    const wan = abs / 10000;
    return `¥${wan >= 100 ? wan.toFixed(0) : wan.toFixed(1).replace(/\.0$/, '')}万`;
  }
  if (abs >= 1000) {
    return `¥${abs.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}`;
  }
  return `¥${abs.toLocaleString('zh-CN', { maximumFractionDigits: abs % 1 ? 2 : 0 })}`;
}

function formatSignedMoney(value: number) {
  if (!Number.isFinite(value) || Math.abs(value) < 0.005) return '¥0.00';
  const sign = value > 0 ? '+' : '−';
  return `${sign}${formatMoney(value)}`;
}

function formatMonthDay(value: Date) {
  return `${value.getMonth() + 1}.${value.getDate()}`;
}

function formatChineseDate(value: Date) {
  return `${value.getFullYear()}年${value.getMonth() + 1}月${value.getDate()}日`;
}

function formatCustomDate(value: Date, shouldShowYear: boolean) {
  return shouldShowYear ? formatChineseDate(value) : `${value.getMonth() + 1}月${value.getDate()}日`;
}

function formatAxisDate(value: Date, shouldShowYear: boolean) {
  return shouldShowYear
    ? `${String(value.getFullYear()).slice(2)}.${value.getMonth() + 1}`
    : `${value.getMonth() + 1}.${value.getDate()}`;
}

function getDaySpan(start: Date, end: Date) {
  return Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 86400000) + 1);
}

function buildDateAxis(start: Date, end: Date, shouldShowYear: boolean) {
  const daySpan = getDaySpan(start, end);
  if (daySpan <= 7) {
    return Array.from({ length: daySpan }, (_, index) => formatAxisDate(addDays(start, index), shouldShowYear));
  }
  const maxTicks = daySpan > 90 ? 4 : 5;
  const offsets = new Set<number>();
  for (let index = 0; index < maxTicks; index += 1) {
    offsets.add(Math.round((daySpan - 1) * (index / (maxTicks - 1))));
  }
  return Array.from(offsets)
    .sort((a, b) => a - b)
    .map((offset) => formatAxisDate(addDays(start, offset), shouldShowYear));
}

function resolveRange(
  activeTab: RangeTab,
  currentDate: Date,
  customStartDate: Date,
  customEndDate: Date,
) {
  const start = new Date(currentDate);
  const end = new Date(currentDate);
  if (activeTab === '自定义') {
    start.setTime(customStartDate.getTime());
    end.setTime(customEndDate.getTime());
  } else if (activeTab === '周') {
    const day = start.getDay() || 7;
    start.setDate(start.getDate() - day + 1);
    end.setTime(start.getTime());
    end.setDate(start.getDate() + 6);
  } else if (activeTab === '年') {
    start.setMonth(0, 1);
    end.setMonth(11, 31);
  } else {
    start.setDate(1);
    end.setMonth(start.getMonth() + 1, 0);
  }
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);
  return { start, end, startYmd: formatYmd(start), endYmd: formatYmd(end) };
}

function shiftToPrevPeriod(
  activeTab: RangeTab,
  currentDate: Date,
  customStartDate: Date,
  customEndDate: Date,
) {
  if (activeTab === '自定义') {
    const days = getDaySpan(customStartDate, customEndDate);
    return {
      currentDate,
      customStartDate: addDays(customStartDate, -days),
      customEndDate: addDays(customEndDate, -days),
    };
  }
  const next = new Date(currentDate);
  if (activeTab === '周') next.setDate(next.getDate() - 7);
  else if (activeTab === '年') next.setFullYear(next.getFullYear() - 1);
  else next.setMonth(next.getMonth() - 1);
  return { currentDate: next, customStartDate, customEndDate };
}

/** 分类进度条：growX 700ms，错峰 55ms（宽动画，自左生长） */
function CatTrackFill({
  widthPct,
  color,
  animate,
  index,
}: {
  widthPct: number;
  color: string;
  animate: boolean;
  index: number;
}) {
  const progress = React.useRef(new Animated.Value(animate ? 0 : 1)).current;
  const target = Math.max(0, Math.min(100, widthPct));

  React.useEffect(() => {
    if (!animate) {
      progress.setValue(1);
      return;
    }
    progress.setValue(0);
    const anim = Animated.timing(progress, {
      toValue: 1,
      duration: 700,
      delay: 160 + index * 55,
      easing: FOLD_MOTION_EASE,
      useNativeDriver: false,
    });
    anim.start();
    return () => anim.stop();
  }, [animate, index, progress, target]);

  const width = progress.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', `${target}%`],
  });

  return <Animated.View style={[styles.catFill, { width, backgroundColor: color }]} />;
}

/** 柱图 barRise 580ms，错峰 35ms */
function TrendPairBar({
  heightPct,
  color,
  animate,
  index,
}: {
  heightPct: number;
  color: string;
  animate: boolean;
  index: number;
}) {
  const progress = React.useRef(new Animated.Value(animate ? 0 : 1)).current;
  const h = Math.max(2, Math.round((Math.max(0, Math.min(100, heightPct)) / 100) * 90));

  React.useEffect(() => {
    if (!animate) {
      progress.setValue(1);
      return;
    }
    progress.setValue(0);
    const anim = Animated.timing(progress, {
      toValue: 1,
      duration: 580,
      delay: 120 + index * 35,
      easing: FOLD_MOTION_EASE,
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [animate, h, index, progress]);

  const scaleY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0.05, 1],
  });
  /** 补偿 scaleY 中心原点，使柱自底部生长（对齐设计稿 transform-origin:bottom） */
  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [(h * 0.95) / 2, 0],
  });

  return (
    <Animated.View
      style={[
        styles.trendBar,
        {
          height: h,
          backgroundColor: color,
          opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }),
          transform: [{ translateY }, { scaleY }],
        },
      ]}
    />
  );
}

export default function FinanceStatsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { ff, isDark, fonts: ffFonts } = useFinanceFoldTheme();
  const { animate: foldAnimate } = useFoldMotionGate();
  const { wrapLoad } = usePageApiSync(PAGE_API_KEY);

  const bg = ff.paper;
  const card = isDark ? ff.paper2 : ff.card;
  const text = ff.ink;
  const subtle = ff.muted;
  const faint = ff.faint;
  const line = ff.line;
  const pine = ff.pine;
  const incomeColor = ff.income;
  const expenseColor = ff.expense;
  const headerScrim = isDark ? 'rgba(23,43,36,0.94)' : 'rgba(243,238,228,0.94)';
  const cellBg = isDark ? 'rgba(255,255,255,0.05)' : '#F5F0E5';
  const cellBorder = isDark ? line : '#E8DFCF';
  const trackBg = isDark ? 'rgba(255,255,255,0.08)' : '#EEE9DE';

  const [activeTab, setActiveTab] = React.useState<RangeTab>('月');
  const [currentDate, setCurrentDate] = React.useState(() => new Date());
  const [customStartDate, setCustomStartDate] = React.useState(() => addDays(new Date(), -6));
  const [customEndDate, setCustomEndDate] = React.useState(() => new Date());
  const [activeDatePicker, setActiveDatePicker] = React.useState<CustomDateField | null>(null);
  const [draftPickerDate, setDraftPickerDate] = React.useState(() => new Date());
  const [customDateError, setCustomDateError] = React.useState<string | null>(null);
  const [stats, setStats] = React.useState<FinanceStatsData | null>(null);
  const [prevBalance, setPrevBalance] = React.useState<number | null>(null);
  const [aiBillAnalysis, setAiBillAnalysis] = React.useState<string | null>(null);
  const [aiBillAnalysisError, setAiBillAnalysisError] = React.useState<string | null>(null);
  const [aiBillAnalysisBusy, setAiBillAnalysisBusy] = React.useState(false);
  /** 有数据后再挂载内容块，避免空态先播一遍、数据回来再播一遍 */
  const [contentReady, setContentReady] = React.useState(false);
  /** 仅随「已加载区间」变化；同区间 focus/pull 刷新不重挂载 */
  const [contentKey, setContentKey] = React.useState('');
  const skipNextFocusReloadRef = React.useRef(true);

  const range = React.useMemo(
    () => resolveRange(activeTab, currentDate, customStartDate, customEndDate),
    [activeTab, currentDate, customEndDate, customStartDate],
  );

  const statsGranularity = activeTab === '年' ? 'month' : ('day' as const);
  /** 内容块：等首包数据后再挂载并入场，避免空态+实态各播一次 */
  const motionOn = foldAnimate && contentReady;
  /** 顶栏控件首屏入场即可，不随区间数据重挂载 */
  const chromeMotionOn = foldAnimate;

  const reload = React.useCallback(
    async (forceRefresh = false) => {
      const requestKey = `${range.startYmd}|${range.endYmd}`;
      await wrapLoad(async () => {
        try {
          const prevShift = shiftToPrevPeriod(activeTab, currentDate, customStartDate, customEndDate);
          const prevRange = resolveRange(
            activeTab,
            prevShift.currentDate,
            prevShift.customStartDate,
            prevShift.customEndDate,
          );
          const [data, prevData] = await Promise.all([
            fetchFinanceStats({
              start: range.startYmd,
              end: range.endYmd,
              granularity: statsGranularity,
              categoryMode: 'both',
              rankMode: 'both',
              rankLimit: 5,
              recentDaysLimit: 31,
              excludeCorrections: true,
              serverFallback: true,
            }),
            fetchFinanceStats({
              start: prevRange.startYmd,
              end: prevRange.endYmd,
              granularity: statsGranularity,
              categoryMode: 'expense',
              rankMode: 'expense',
              rankLimit: 1,
              recentDaysLimit: 1,
              excludeCorrections: true,
              serverFallback: true,
            }).catch(() => null),
          ]);
          setStats(data);
          setPrevBalance(prevData?.summary.balance ?? null);
          setContentKey((prev) => (prev === requestKey ? prev : requestKey));
          setContentReady(true);
        } catch (error) {
          console.warn('Failed to load finance stats:', error);
          setStats(null);
          setPrevBalance(null);
          setContentKey(requestKey);
          setContentReady(true);
        }
      }, forceRefresh);
    },
    [
      activeTab,
      currentDate,
      customEndDate,
      customStartDate,
      range.endYmd,
      range.startYmd,
      statsGranularity,
      wrapLoad,
    ],
  );

  const { refreshControl } = usePagePullRefresh(PAGE_API_KEY, reload);

  React.useEffect(() => {
    void reload();
  }, [reload]);

  /** 首屏已由 useEffect 拉取；跳过第一次 focus，避免入场动画播两次 */
  useFocusEffect(
    React.useCallback(() => {
      if (skipNextFocusReloadRef.current) {
        skipNextFocusReloadRef.current = false;
        return;
      }
      void reload();
    }, [reload]),
  );

  const totalIncome = stats?.summary.income ?? 0;
  const totalExpense = stats?.summary.expense ?? 0;
  const balance = stats?.summary.balance ?? totalIncome - totalExpense;
  const txnCount = stats?.summary.txnCount ?? 0;
  const days = Math.max(1, stats?.summary.days ?? getDaySpan(range.start, range.end));
  const dailyAvgExpense = totalExpense / days;
  const savingsRate = totalIncome > 0 ? ((totalIncome - totalExpense) / totalIncome) * 100 : 0;

  const balanceDeltaPct = React.useMemo(() => {
    if (prevBalance == null || Math.abs(prevBalance) < 0.01) return null;
    return ((balance - prevBalance) / Math.abs(prevBalance)) * 100;
  }, [balance, prevBalance]);

  const categoryData = React.useMemo(() => {
    return (stats?.categories.expense ?? []).slice(0, 6).map((item, index) => ({
      id: item.categoryId ?? `name:${item.name}`,
      name: item.name,
      percent: item.percent,
      amount: item.amount,
      color: CAT_COLORS[index % CAT_COLORS.length]!,
    }));
  }, [stats?.categories.expense]);

  const insight = React.useMemo(() => {
    const cats = stats?.categories.expense ?? [];
    const fixed = cats
      .filter((c) => FIXED_CAT_RE.test(c.name))
      .reduce((sum, c) => sum + c.amount, 0);
    const fixedPct = totalExpense > 0 ? (fixed / totalExpense) * 100 : 0;
    const flexible = Math.max(0, totalExpense - fixed);
    const maxDay = (stats?.billTable.recentDays ?? []).reduce(
      (max, row) => Math.max(max, row.expense),
      0,
    );
    const healthy = savingsRate >= 20 || (totalIncome > 0 && balance >= 0);
    return { fixedPct, flexible, maxDay, healthy };
  }, [balance, savingsRate, stats?.billTable.recentDays, stats?.categories.expense, totalExpense, totalIncome]);

  const trendPairs = React.useMemo(() => {
    const points = stats?.trend.points ?? [];
    const max = Math.max(...points.map((p) => Math.max(p.income, p.expense)), 1);
    const maxPairs = activeTab === '周' ? 7 : activeTab === '年' ? 12 : 14;
    const sampled =
      points.length <= maxPairs
        ? points
        : Array.from({ length: maxPairs }, (_, i) => {
            const idx = Math.round((i / (maxPairs - 1)) * (points.length - 1));
            return points[idx]!;
          });
    return sampled.map((p) => ({
      key: p.key,
      label: p.label,
      incomePct: (p.income / max) * 100,
      expensePct: (p.expense / max) * 100,
    }));
  }, [activeTab, stats?.trend.points]);

  const trendAxis = React.useMemo(() => {
    const isMonth = stats?.trend.granularity === 'month' || activeTab === '年';
    const shouldShowAxisYear = range.start.getFullYear() !== range.end.getFullYear();
    if (isMonth) return ['1月', '3月', '6月', '9月', '12月'];
    if (activeTab === '周') {
      return Array.from({ length: 7 }, (_, index) => formatMonthDay(addDays(range.start, index)));
    }
    return buildDateAxis(range.start, range.end, shouldShowAxisYear);
  }, [activeTab, range.end, range.start, stats?.trend.granularity]);

  const shouldShowCustomYear = range.start.getFullYear() !== range.end.getFullYear();
  const rangeLabel =
    activeTab === '年'
      ? `${range.start.getFullYear()}年`
      : activeTab === '自定义'
        ? `${formatCustomDate(range.start, shouldShowCustomYear)} - ${formatCustomDate(range.end, shouldShowCustomYear)}`
        : activeTab === '周'
          ? `${formatMonthDay(range.start)} - ${formatMonthDay(range.end)}`
          : `${range.start.getFullYear()}年${range.start.getMonth() + 1}月`;

  const headerSub =
    activeTab === '年'
      ? `ANALYSIS · ${range.start.getFullYear()}`
      : activeTab === '周' || activeTab === '自定义'
        ? `ANALYSIS · ${formatMonthDay(range.start)}–${formatMonthDay(range.end)}`
        : `ANALYSIS · ${range.start.getFullYear()}.${String(range.start.getMonth() + 1).padStart(2, '0')}`;

  const metaLeft = `${range.startYmd.slice(0, 7).replace('-', '.')}.${range.startYmd.slice(8)} – ${range.endYmd.slice(5).replace('-', '.')}`;
  const metaRight = `${txnCount} 笔 · 日均 ${formatMoneyShort(dailyAvgExpense)}`;

  const shiftRange = React.useCallback(
    (direction: -1 | 1) => {
      if (activeTab === '自定义') {
        const days = getDaySpan(customStartDate, customEndDate);
        setCustomStartDate((prev) => addDays(prev, direction * days));
        setCustomEndDate((prev) => addDays(prev, direction * days));
        return;
      }
      setCurrentDate((prev) => {
        const next = new Date(prev);
        if (activeTab === '周') next.setDate(next.getDate() + direction * 7);
        else if (activeTab === '年') next.setFullYear(next.getFullYear() + direction);
        else next.setMonth(next.getMonth() + direction);
        return next;
      });
    },
    [activeTab, customEndDate, customStartDate],
  );

  const openDatePicker = React.useCallback(
    (field: CustomDateField) => {
      setCustomDateError(null);
      setDraftPickerDate(new Date(field === 'start' ? customStartDate : customEndDate));
      setActiveDatePicker(field);
    },
    [customEndDate, customStartDate],
  );

  const adjustDraftDate = React.useCallback((column: PickerColumn, direction: -1 | 1) => {
    setDraftPickerDate((prev) => {
      const next = new Date(prev);
      if (column === 'year') next.setFullYear(next.getFullYear() + direction);
      else if (column === 'month') next.setMonth(next.getMonth() + direction);
      else next.setDate(next.getDate() + direction);
      return next;
    });
  }, []);

  const confirmDraftDate = React.useCallback(() => {
    if (!activeDatePicker) return;
    const nextDate = new Date(draftPickerDate);
    const nextStartDate = activeDatePicker === 'start' ? nextDate : customStartDate;
    const nextEndDate = activeDatePicker === 'end' ? nextDate : customEndDate;
    const normalizedStart = nextStartDate > nextEndDate ? nextDate : nextStartDate;
    const normalizedEnd = nextStartDate > nextEndDate ? nextDate : nextEndDate;
    if (getDaySpan(normalizedStart, normalizedEnd) > MAX_CUSTOM_RANGE_DAYS) {
      setCustomDateError('自定义日期跨度不能超过两年，请缩短开始日期和结束日期之间的范围');
      return;
    }
    setCustomStartDate(normalizedStart);
    setCustomEndDate(normalizedEnd);
    setCustomDateError(null);
    setActiveDatePicker(null);
  }, [activeDatePicker, customEndDate, customStartDate, draftPickerDate]);

  const billSummaryForAi = React.useMemo(() => {
    const parts: string[] = [];
    parts.push(`统计区间：${rangeLabel}（${range.startYmd} 至 ${range.endYmd}）`);
    parts.push(
      `收入合计 ${totalIncome.toFixed(2)} 元，支出合计 ${totalExpense.toFixed(2)} 元，结余 ${balance.toFixed(2)} 元，流水 ${txnCount} 笔（转账与余额校正未计入收支统计）。`,
    );
    if (!txnCount || !stats) return parts.join('\n');
    const expLines = (stats.categories.expense ?? [])
      .slice(0, 8)
      .map((item) => `  - 支出「${item.name}」：${item.amount.toFixed(2)} 元（${item.count} 笔）`);
    if (expLines.length) {
      parts.push('支出分类概览：');
      parts.push(...expLines);
    }
    const s = parts.join('\n');
    return s.length > 8000 ? `${s.slice(0, 8000)}\n…（摘要已截断）` : s;
  }, [balance, range.endYmd, range.startYmd, rangeLabel, stats, totalExpense, totalIncome, txnCount]);

  React.useEffect(() => {
    setAiBillAnalysis(null);
    setAiBillAnalysisError(null);
  }, [billSummaryForAi]);

  const runAiBillAnalysis = React.useCallback(async () => {
    setAiBillAnalysisBusy(true);
    setAiBillAnalysisError(null);
    try {
      const r = await analyzeFinanceBillSummaryFromText({
        apiKey: getActiveAiLlmApiKey(),
        summaryText: billSummaryForAi,
        maxAttempts: 12,
        retryDelayMs: 1000,
      });
      if (r.ok) setAiBillAnalysis(r.analysis);
      else setAiBillAnalysisError(r.error);
    } catch (e) {
      setAiBillAnalysisError(e instanceof Error ? e.message : String(e));
    } finally {
      setAiBillAnalysisBusy(false);
    }
  }, [billSummaryForAi]);

  const openDetail = React.useCallback(() => {
    router.push({
      pathname: '/finance-stats-detail',
      params: {
        start: range.startYmd,
        end: range.endYmd,
        tab: activeTab,
        label: rangeLabel,
      },
    });
  }, [activeTab, range.endYmd, range.startYmd, rangeLabel, router]);

  const scrollBottomPad = 40 + Math.max(insets.bottom, 12);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: bg }]} edges={['left', 'right']}>
      <View
        style={[
          styles.header,
          { paddingTop: insets.top, backgroundColor: headerScrim, borderBottomColor: line },
        ]}>
        <View style={styles.headerInner}>
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => [
              styles.foldIconBtn,
              { borderColor: line, backgroundColor: card },
              pressed && { opacity: 0.85, transform: [{ scale: 0.94 }] },
            ]}
            accessibilityRole="button"
            accessibilityLabel="返回">
            <MaterialIcons name="arrow-back" size={16} color={ff.ink2} />
          </Pressable>
          <View style={styles.headerCenter}>
            <Text style={[styles.headerTitle, { color: text, fontFamily: ffFonts.serif }]}>统计</Text>
            <Text style={[styles.headerSub, { color: subtle }]} numberOfLines={1}>
              {headerSub}
            </Text>
          </View>
          <Pressable
            onPress={() => Alert.alert('导出', '导出 CSV 即将支持，当前可先截图保存。')}
            style={({ pressed }) => [
              styles.foldIconBtn,
              {
                borderColor: line,
                backgroundColor: isDark ? ff.cardSoft : 'rgba(255,252,245,0.66)',
              },
              pressed && { opacity: 0.85, transform: [{ scale: 0.94 }] },
            ]}
            accessibilityRole="button"
            accessibilityLabel="导出">
            <MaterialIcons name="file-download" size={16} color={ff.ink2} />
          </Pressable>
        </View>
      </View>

      <ScrollView
        refreshControl={refreshControl}
        contentContainerStyle={[
          styles.content,
          {
            paddingBottom: scrollBottomPad,
            maxWidth: Layout.contentMaxWidth,
            alignSelf: 'center',
            width: '100%',
          },
        ]}
        showsVerticalScrollIndicator={false}>
        <FoldRiseIn animate={chromeMotionOn} index={0} fromY={11}>
          <View
            style={[
              styles.segment,
              {
                backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : '#EFEADD',
                borderColor: line,
              },
            ]}>
            {RANGE_TABS.map((tab) => {
              const on = tab === activeTab;
              return (
                <Pressable
                  key={tab}
                  onPress={() => setActiveTab(tab)}
                  style={({ pressed }) => [
                    styles.segmentBtn,
                    on && {
                      backgroundColor: card,
                      shadowColor: '#2B352D',
                      shadowOpacity: isDark ? 0 : 0.08,
                      shadowRadius: 8,
                      shadowOffset: { width: 0, height: 3 },
                      elevation: isDark ? 0 : 2,
                    },
                    pressed && { opacity: 0.88 },
                  ]}>
                  <Text style={[styles.segmentLabel, { color: on ? pine : '#7B867E', fontWeight: on ? '800' : '600' }]}>
                    {tab}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </FoldRiseIn>

        <FoldRiseIn animate={chromeMotionOn} index={1} fromY={11}>
          <View style={styles.monthSwitcher}>
            <Pressable
              onPress={() => shiftRange(-1)}
              style={({ pressed }) => [
                styles.navBtn,
                { borderColor: line, backgroundColor: card },
                pressed && { opacity: 0.85 },
              ]}
              accessibilityLabel="上一段区间">
              <MaterialIcons name="chevron-left" size={18} color={subtle} />
            </Pressable>
            <Text style={[styles.monthText, { color: text, fontFamily: ffFonts.mono }]}>{rangeLabel}</Text>
            <Pressable
              onPress={() => shiftRange(1)}
              style={({ pressed }) => [
                styles.navBtn,
                { borderColor: line, backgroundColor: card },
                pressed && { opacity: 0.85 },
              ]}
              accessibilityLabel="下一段区间">
              <MaterialIcons name="chevron-right" size={18} color={subtle} />
            </Pressable>
          </View>
        </FoldRiseIn>

        {activeTab === '自定义' ? (
          <FoldRiseIn animate={chromeMotionOn} index={2} fromY={11}>
            <View style={[styles.customRow, { backgroundColor: card, borderColor: line }]}>
              <Pressable
                onPress={() => openDatePicker('start')}
                style={({ pressed }) => [
                  styles.dateBtn,
                  { borderColor: line, backgroundColor: cellBg },
                  pressed && { opacity: 0.88 },
                ]}>
                <Text style={[styles.dateLab, { color: subtle }]}>开始日期</Text>
                <Text style={[styles.dateVal, { color: text }]}>
                  {formatCustomDate(customStartDate, shouldShowCustomYear)}
                </Text>
              </Pressable>
              <MaterialIcons name="arrow-forward" size={16} color={subtle} />
              <Pressable
                onPress={() => openDatePicker('end')}
                style={({ pressed }) => [
                  styles.dateBtn,
                  { borderColor: line, backgroundColor: cellBg },
                  pressed && { opacity: 0.88 },
                ]}>
                <Text style={[styles.dateLab, { color: subtle }]}>结束日期</Text>
                <Text style={[styles.dateVal, { color: text }]}>
                  {formatCustomDate(customEndDate, shouldShowCustomYear)}
                </Text>
              </Pressable>
            </View>
          </FoldRiseIn>
        ) : null}

        {contentReady ? (
          <React.Fragment key={contentKey}>
        <FoldRiseIn animate={motionOn} index={0} fromY={12} fromScale={0.98} delayMs={40}>
          <View style={[styles.heroCard, { backgroundColor: card, borderColor: line }]}>
            <View style={styles.heroTop}>
              <Text style={[styles.eyebrow, { color: subtle }]}>本期结余</Text>
              {balanceDeltaPct != null ? (
                <View
                  style={[
                    styles.tag,
                    {
                      backgroundColor:
                        balanceDeltaPct >= 0
                          ? isDark
                            ? 'rgba(134,167,149,0.22)'
                            : '#E7EFE9'
                          : isDark
                            ? 'rgba(198,106,76,0.22)'
                            : '#F3E0D9',
                    },
                  ]}>
                  <Text
                    style={[
                      styles.tagText,
                      { color: balanceDeltaPct >= 0 ? (isDark ? ff.sage : '#3F6B54') : ff.clayInk },
                    ]}>
                    较上期 {balanceDeltaPct >= 0 ? '+' : ''}
                    {balanceDeltaPct.toFixed(1)}%
                  </Text>
                </View>
              ) : null}
            </View>
            <FoldCountUpText
              value={balance}
              animate={motionOn}
              duration={760}
              delayMs={80}
              textStyle={[
                styles.heroBig,
                {
                  color: balance < 0 ? expenseColor : pine,
                  fontFamily: ffFonts.mono,
                },
              ]}
              formatter={(n) => formatSignedMoney(n)}
            />
            <View style={styles.heroMeta}>
              <Text style={[styles.metaText, { color: faint }]} numberOfLines={1}>
                {metaLeft}
              </Text>
              <Text style={[styles.metaText, { color: faint }]} numberOfLines={1}>
                {metaRight}
              </Text>
            </View>
            <View style={styles.statsGrid}>
              <View style={[styles.statCell, { backgroundColor: cellBg, borderColor: cellBorder }]}>
                <Text style={[styles.statLab, { color: faint }]}>收入</Text>
                <Text style={[styles.statVal, { color: incomeColor, fontFamily: ffFonts.mono }]}>
                  {formatMoneyShort(totalIncome)}
                </Text>
              </View>
              <View style={[styles.statCell, { backgroundColor: cellBg, borderColor: cellBorder }]}>
                <Text style={[styles.statLab, { color: faint }]}>支出</Text>
                <Text style={[styles.statVal, { color: expenseColor, fontFamily: ffFonts.mono }]}>
                  {formatMoneyShort(totalExpense)}
                </Text>
              </View>
              <View style={[styles.statCell, { backgroundColor: cellBg, borderColor: cellBorder }]}>
                <Text style={[styles.statLab, { color: faint }]}>储蓄率</Text>
                <Text style={[styles.statVal, { color: pine, fontFamily: ffFonts.mono }]}>
                  {totalIncome > 0 ? `${savingsRate.toFixed(1)}%` : '—'}
                </Text>
              </View>
            </View>
          </View>
        </FoldRiseIn>

        <FoldRiseIn animate={motionOn} index={1} fromY={11} delayMs={40}>
          <Pressable
            onPress={() => void runAiBillAnalysis()}
            disabled={aiBillAnalysisBusy}
            style={({ pressed }) => [
              styles.aiBanner,
              {
                backgroundColor: isDark ? ff.budgetMid : undefined,
              },
              !isDark && styles.aiBannerGrad,
              pressed && !aiBillAnalysisBusy && { opacity: 0.92, transform: [{ scale: 0.99 }] },
              aiBillAnalysisBusy && { opacity: 0.72 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="生成 AI 账单分析">
            <View style={styles.aiBannerIcon}>
              {aiBillAnalysisBusy ? (
                <ActivityIndicator size="small" color="#EDC48B" />
              ) : (
                <MaterialIcons name="auto-awesome" size={16} color="#EDC48B" />
              )}
            </View>
            <View style={styles.aiBannerText}>
              <Text style={styles.aiBannerTitle}>
                {aiBillAnalysisBusy ? 'AI 正在读取流水…' : aiBillAnalysis ? '重新生成 AI 账单分析' : '生成 AI 账单分析'}
              </Text>
              <Text style={styles.aiBannerSub} numberOfLines={2}>
                {aiBillAnalysisError
                  ? `获取失败：${aiBillAnalysisError}`
                  : aiBillAnalysis
                    ? aiBillAnalysis
                    : '找出本期变化最大的 3 个消费习惯'}
              </Text>
            </View>
            <MaterialIcons name="chevron-right" size={18} color="#DFBE8C" />
          </Pressable>
        </FoldRiseIn>

        <FoldRiseIn animate={motionOn} index={2} fromY={12} delayMs={40}>
          <View style={[styles.card, { backgroundColor: card, borderColor: line }]}>
            <View style={styles.catHead}>
              <Text style={[styles.cardTitle, { color: text }]}>支出构成</Text>
              <Text style={[styles.cardHint, { color: faint }]}>共 {formatMoney(totalExpense)}</Text>
            </View>
            <View style={styles.catBars}>
              {categoryData.length ? (
                categoryData.map((item, index) => (
                  <View key={item.id} style={styles.catBar}>
                    <Text style={[styles.catName, { color: subtle }]} numberOfLines={1}>
                      {item.name}
                    </Text>
                    <View style={[styles.catTrackWrap, { backgroundColor: trackBg }]}>
                      <CatTrackFill
                        widthPct={item.percent}
                        color={item.color}
                        animate={motionOn}
                        index={index}
                      />
                    </View>
                    <Text style={[styles.catNum, { color: '#5C6960', fontFamily: ffFonts.mono }]}>
                      {formatMoneyShort(item.amount)}
                    </Text>
                    <Text style={[styles.catPct, { color: faint }]}>{Math.round(item.percent)}%</Text>
                  </View>
                ))
              ) : (
                <Text style={[styles.emptyHint, { color: faint }]}>本期暂无支出分类</Text>
              )}
            </View>
          </View>
        </FoldRiseIn>

        <FoldRiseIn animate={motionOn} index={3} fromY={12} delayMs={40}>
          <View style={[styles.card, { backgroundColor: card, borderColor: line }]}>
            <View style={styles.chartHead}>
              <Text style={[styles.cardTitle, { color: text }]}>
                {stats?.trend.granularity === 'month' ? '每月收支趋势' : '每日收支趋势'}
              </Text>
              <View style={styles.legend2}>
                <View style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: '#6D9A80' }]} />
                  <Text style={[styles.legendLab, { color: subtle }]}>收入</Text>
                </View>
                <View style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: '#CE7A5C' }]} />
                  <Text style={[styles.legendLab, { color: subtle }]}>支出</Text>
                </View>
              </View>
            </View>
            <View style={styles.bars}>
              {trendPairs.length ? (
                trendPairs.map((pair, i) => (
                  <View key={pair.key} style={styles.barPair}>
                    <TrendPairBar
                      heightPct={pair.incomePct}
                      color="#6D9A80"
                      animate={motionOn}
                      index={i * 2}
                    />
                    <TrendPairBar
                      heightPct={pair.expensePct}
                      color="#CE7A5C"
                      animate={motionOn}
                      index={i * 2 + 1}
                    />
                  </View>
                ))
              ) : (
                <Text style={[styles.emptyHint, { color: faint, alignSelf: 'center' }]}>暂无趋势数据</Text>
              )}
            </View>
            <View style={styles.barX}>
              {trendAxis.map((label) => (
                <Text key={label} style={[styles.barXText, { color: faint, fontFamily: ffFonts.mono }]}>
                  {label}
                </Text>
              ))}
            </View>
          </View>
        </FoldRiseIn>

        <FoldRiseIn animate={motionOn} index={4} fromY={10} delayMs={40}>
          <Pressable
            onPress={openDetail}
            style={({ pressed }) => [
              styles.linkRow,
              { backgroundColor: card, borderColor: line },
              pressed && { opacity: 0.9, transform: [{ scale: 0.99 }] },
            ]}
            accessibilityRole="button"
            accessibilityLabel="按日汇总表与单笔排行">
            <MaterialIcons name="bar-chart" size={16} color={pine} />
            <Text style={[styles.linkText, { color: text }]}>按日汇总表与单笔排行</Text>
            <MaterialIcons name="chevron-right" size={18} color={faint} />
          </Pressable>
        </FoldRiseIn>

        <FoldRiseIn animate={motionOn} index={5} fromY={11} delayMs={40}>
          <View style={[styles.card, { backgroundColor: card, borderColor: line }]}>
            <View style={styles.conclusionHead}>
              <Text style={[styles.cardTitle, { color: text }]}>本期小结论</Text>
              <View
                style={[
                  styles.tag,
                  {
                    backgroundColor: insight.healthy
                      ? isDark
                        ? 'rgba(134,167,149,0.22)'
                        : '#E7EFE9'
                      : isDark
                        ? 'rgba(216,154,77,0.2)'
                        : ff.amber2,
                  },
                ]}>
                <Text
                  style={[
                    styles.tagText,
                    { color: insight.healthy ? (isDark ? ff.sage : '#3F6B54') : ff.amberInk },
                  ]}>
                  {insight.healthy ? '节奏健康' : '留意开支'}
                </Text>
              </View>
            </View>
            <View style={styles.statsGrid}>
              <View style={[styles.statCell, { backgroundColor: cellBg, borderColor: cellBorder }]}>
                <Text style={[styles.statLab, { color: faint }]}>固定支出占比</Text>
                <Text style={[styles.statVal, { color: text, fontFamily: ffFonts.mono }]}>
                  {totalExpense > 0 ? `${Math.round(insight.fixedPct)}%` : '—'}
                </Text>
              </View>
              <View style={[styles.statCell, { backgroundColor: cellBg, borderColor: cellBorder }]}>
                <Text style={[styles.statLab, { color: faint }]}>弹性支出</Text>
                <Text style={[styles.statVal, { color: text, fontFamily: ffFonts.mono }]}>
                  {formatMoneyShort(insight.flexible)}
                </Text>
              </View>
              <View style={[styles.statCell, { backgroundColor: cellBg, borderColor: cellBorder }]}>
                <Text style={[styles.statLab, { color: faint }]}>最大单日</Text>
                <Text style={[styles.statVal, { color: text, fontFamily: ffFonts.mono }]}>
                  {insight.maxDay > 0 ? formatMoneyShort(insight.maxDay) : '—'}
                </Text>
              </View>
            </View>
            {(aiBillAnalysis || categoryData[0]) && (
              <View
                style={[
                  styles.aiLine,
                  {
                    backgroundColor: isDark ? 'rgba(216,154,77,0.12)' : '#F3EDE0',
                    borderColor: isDark ? 'rgba(216,154,77,0.25)' : '#E8D9BF',
                  },
                ]}>
                <MaterialIcons name="auto-awesome" size={14} color={ff.amberInk} />
                <Text style={[styles.aiLineText, { color: isDark ? ff.ink2 : '#6D6658' }]} numberOfLines={3}>
                  {aiBillAnalysis
                    ? aiBillAnalysis
                    : categoryData[0]
                      ? `「${categoryData[0].name}」占支出 ${Math.round(categoryData[0].percent)}%，是本期最大支出块。${
                          insight.healthy
                            ? '储蓄节奏尚可，建议把大额支出放在发薪后几天。'
                            : '可先盯住弹性支出，给储蓄留出缓冲。'
                        }`
                      : '暂无足够数据生成结论。'}
                </Text>
              </View>
            )}
          </View>
        </FoldRiseIn>
          </React.Fragment>
        ) : null}
      </ScrollView>

      <Modal
        visible={!!activeDatePicker}
        transparent
        animationType="fade"
        onRequestClose={() => setActiveDatePicker(null)}>
        <Pressable
          style={[styles.modalBackdrop, { backgroundColor: 'rgba(29,41,35,0.45)' }]}
          onPress={() => setActiveDatePicker(null)}>
          <Pressable
            style={[styles.modalCard, { backgroundColor: card, borderColor: line }]}
            onPress={(e) => e.stopPropagation()}>
            <Text style={[styles.modalTitle, { color: text, fontFamily: ffFonts.serif }]}>
              {activeDatePicker === 'start' ? '选择开始日期' : '选择结束日期'}
            </Text>
            <Text style={[styles.modalSub, { color: subtle }]}>
              自定义跨度最多两年，确认后统计会按所选区间更新
            </Text>
            <View style={[styles.modalPreview, { backgroundColor: cellBg }]}>
              <Text style={[styles.dateLab, { color: subtle }]}>当前选择</Text>
              <Text style={[styles.modalPreviewVal, { color: text, fontFamily: ffFonts.mono }]}>
                {formatChineseDate(draftPickerDate)}
              </Text>
              {customDateError ? (
                <Text style={[styles.modalErr, { color: expenseColor }]}>{customDateError}</Text>
              ) : null}
            </View>
            <View style={styles.pickerRow}>
              {(
                [
                  { key: 'year' as const, label: '年', value: `${draftPickerDate.getFullYear()}` },
                  { key: 'month' as const, label: '月', value: `${draftPickerDate.getMonth() + 1}` },
                  { key: 'day' as const, label: '日', value: `${draftPickerDate.getDate()}` },
                ]
              ).map((item) => (
                <View key={item.key} style={[styles.pickerCol, { backgroundColor: cellBg }]}>
                  <Pressable onPress={() => adjustDraftDate(item.key, 1)} style={styles.pickerAdj}>
                    <MaterialIcons name="keyboard-arrow-up" size={20} color={pine} />
                  </Pressable>
                  <Text style={[styles.dateLab, { color: subtle }]}>{item.label}</Text>
                  <Text style={[styles.pickerVal, { color: text, fontFamily: ffFonts.mono }]}>{item.value}</Text>
                  <Pressable onPress={() => adjustDraftDate(item.key, -1)} style={styles.pickerAdj}>
                    <MaterialIcons name="keyboard-arrow-down" size={20} color={pine} />
                  </Pressable>
                </View>
              ))}
            </View>
            <View style={styles.modalActions}>
              <Pressable
                onPress={() => setActiveDatePicker(null)}
                style={({ pressed }) => [
                  styles.modalBtn,
                  styles.modalBtnGhost,
                  { borderColor: line },
                  pressed && { opacity: 0.85 },
                ]}>
                <Text style={[styles.modalBtnText, { color: subtle }]}>取消</Text>
              </Pressable>
              <Pressable
                onPress={confirmDraftDate}
                style={({ pressed }) => [
                  styles.modalBtn,
                  { backgroundColor: pine },
                  pressed && { opacity: 0.9 },
                ]}>
                <Text style={[styles.modalBtnText, { color: ff.onPine }]}>确定</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: { borderBottomWidth: StyleSheet.hairlineWidth, zIndex: 60 },
  headerInner: {
    minHeight: 54,
    paddingHorizontal: 14,
    paddingBottom: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerCenter: { flex: 1, minWidth: 0, alignItems: 'center', gap: 2 },
  headerTitle: { fontSize: 17, fontWeight: '600', letterSpacing: 0.2 },
  headerSub: { fontSize: 10, fontWeight: '600', letterSpacing: 0.6 },
  foldIconBtn: {
    width: 31,
    height: 31,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 10,
    gap: 8,
  },
  segment: {
    flexDirection: 'row',
    gap: 3,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 11,
    padding: 3,
  },
  segmentBtn: {
    flex: 1,
    height: 30,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentLabel: { fontSize: 13 },
  monthSwitcher: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
    marginTop: 2,
  },
  navBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthText: { flex: 1, textAlign: 'center', fontSize: 14, fontWeight: '700' },
  customRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 10,
  },
  dateBtn: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 2,
  },
  dateLab: { fontSize: 11 },
  dateVal: { fontSize: 13, fontWeight: '700' },
  heroCard: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 12,
  },
  heroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  tag: {
    height: 20,
    paddingHorizontal: 8,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tagText: { fontSize: 10, fontWeight: '700' },
  heroBig: {
    fontSize: 28,
    fontWeight: '700',
    marginTop: 4,
    letterSpacing: -0.4,
  },
  heroMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
    gap: 8,
  },
  metaText: { fontSize: 11, flexShrink: 1 },
  statsGrid: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 12,
  },
  statCell: {
    flex: 1,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 8,
    paddingVertical: 8,
    gap: 3,
  },
  statLab: { fontSize: 10 },
  statVal: { fontSize: 13, fontWeight: '700' },
  aiBanner: {
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    overflow: 'hidden',
    backgroundColor: '#1D3B31',
  },
  aiBannerGrad: {
    backgroundColor: '#23473B',
  },
  aiBannerIcon: {
    width: 30,
    height: 30,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  aiBannerText: { flex: 1, minWidth: 0, gap: 2 },
  aiBannerTitle: { fontSize: 13, fontWeight: '700', color: '#F6EFE1' },
  aiBannerSub: { fontSize: 11, color: '#A9BFB2', lineHeight: 15 },
  card: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  catHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  cardTitle: { fontSize: 14, fontWeight: '700' },
  cardHint: { fontSize: 11 },
  catBars: { gap: 10 },
  catBar: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  catName: { width: 42, fontSize: 12, flexShrink: 0 },
  catTrackWrap: {
    flex: 1,
    height: 5,
    borderRadius: 4,
    overflow: 'hidden',
  },
  catFill: {
    height: '100%',
    borderRadius: 4,
  },
  catNum: { width: 52, textAlign: 'right', fontSize: 12 },
  catPct: { width: 28, textAlign: 'right', fontSize: 11 },
  chartHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  legend2: { flexDirection: 'row', gap: 10 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 5, height: 5, borderRadius: 3 },
  legendLab: { fontSize: 11 },
  bars: {
    height: 90,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 3,
    marginTop: 10,
  },
  barPair: {
    flex: 1,
    height: '100%',
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 2,
  },
  trendBar: {
    width: 5,
    borderTopLeftRadius: 2,
    borderTopRightRadius: 2,
    borderBottomLeftRadius: 1,
    borderBottomRightRadius: 1,
  },
  barX: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  barXText: { fontSize: 10 },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 13,
  },
  linkText: { flex: 1, fontSize: 13, fontWeight: '600' },
  conclusionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  aiLine: {
    marginTop: 10,
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
  },
  aiLineText: { flex: 1, fontSize: 12, lineHeight: 17 },
  emptyHint: { fontSize: 12, paddingVertical: 8 },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    gap: 12,
  },
  modalTitle: { fontSize: 18, fontWeight: '600' },
  modalSub: { fontSize: 12, lineHeight: 17, marginTop: -6 },
  modalPreview: {
    borderRadius: 12,
    padding: 12,
    gap: 4,
  },
  modalPreviewVal: { fontSize: 20, fontWeight: '700' },
  modalErr: { fontSize: 12, marginTop: 4 },
  pickerRow: { flexDirection: 'row', gap: 8 },
  pickerCol: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 10,
    alignItems: 'center',
    gap: 4,
  },
  pickerAdj: {
    width: 36,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickerVal: { fontSize: 20, fontWeight: '700' },
  modalActions: { flexDirection: 'row', gap: 10 },
  modalBtn: {
    flex: 1,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBtnGhost: { borderWidth: StyleSheet.hairlineWidth, backgroundColor: 'transparent' },
  modalBtnText: { fontSize: 14, fontWeight: '700' },
});
