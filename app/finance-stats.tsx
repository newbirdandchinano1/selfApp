import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { getFinanceFlowCategories, getFinanceTransactions } from '@/lib/repositories/finance/finance';
import type { FinanceFlowCategoryRow, FinanceTransactionRow } from '@/lib/repositories/finance/finance.types';
import { analyzeFinanceBillSummaryFromText, getActiveAiLlmApiKey } from '@/lib/zhipu-image-parse';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import React from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

type RangeTab = '周' | '月' | '年' | '自定义';
type CategoryMode = 'expense' | 'income';
type TrendMode = 'expense' | 'income' | 'balance';
type RankMode = 'expense' | 'income';
type CustomDateField = 'start' | 'end';
type PickerColumn = 'year' | 'month' | 'day';

type CategoryItem = {
  id: number;
  name: string;
  percent: number;
  amount: number;
  count: number;
  icon: keyof typeof MaterialIcons.glyphMap;
  color: string;
};

const RANGE_TABS: RangeTab[] = ['周', '月', '年', '自定义'];

type BillSummaryItem = {
  date: string;
  expense: number;
  income: number;
  balance: number;
};

type TopExpenseItem = {
  id: string;
  rank: number;
  name: string;
  desc: string;
  amount: number;
  icon: keyof typeof MaterialIcons.glyphMap;
};

const CATEGORY_COLORS = ['#2563eb', '#3b82f6', '#60a5fa', '#93c5fd', '#bfdbfe', '#0ea5e9', '#38bdf8'];
const DEFAULT_CATEGORY_ICON: keyof typeof MaterialIcons.glyphMap = 'category';

function parseYmd(value: string) {
  const datePart = value.includes('T') ? value.split('T')[0] : value.split(' ')[0];
  return datePart || value;
}

function formatYmd(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatMoney(value: number) {
  return `¥${value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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
  return shouldShowYear ? `${String(value.getFullYear()).slice(2)}.${value.getMonth() + 1}` : `${value.getMonth() + 1}.${value.getDate()}`;
}

function addDays(value: Date, days: number) {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return next;
}

const MAX_CUSTOM_RANGE_DAYS = 731;

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

function getSignedAmount(txn: FinanceTransactionRow) {
  if (txn.transaction_type === 'income') return Math.abs(txn.amount);
  if (txn.transaction_type === 'transfer') return 0;
  return -Math.abs(txn.amount);
}

function getCategoryIcon(category?: FinanceFlowCategoryRow) {
  if (!category?.extra_data) return DEFAULT_CATEGORY_ICON;
  try {
    const extra = JSON.parse(category.extra_data) as { icon?: keyof typeof MaterialIcons.glyphMap; icon_key?: keyof typeof MaterialIcons.glyphMap };
    return extra.icon ?? extra.icon_key ?? DEFAULT_CATEGORY_ICON;
  } catch {
    return DEFAULT_CATEGORY_ICON;
  }
}

export default function FinanceStatsScreen() {
  const router = useRouter();
  const scheme = useColorScheme();
  const themeKey: keyof typeof Colors = scheme === 'dark' ? 'dark' : 'light';
  const baseTheme = Colors[themeKey];
  const isDark = themeKey === 'dark';
  const [activeTab, setActiveTab] = React.useState<RangeTab>('月');
  const [currentDate, setCurrentDate] = React.useState(() => new Date());
  const [customStartDate, setCustomStartDate] = React.useState(() => addDays(new Date(), -6));
  const [customEndDate, setCustomEndDate] = React.useState(() => new Date());
  const [activeDatePicker, setActiveDatePicker] = React.useState<CustomDateField | null>(null);
  const [draftPickerDate, setDraftPickerDate] = React.useState(() => new Date());
  const [customDateError, setCustomDateError] = React.useState<string | null>(null);
  const [categoryMode, setCategoryMode] = React.useState<CategoryMode>('expense');
  const [trendMode, setTrendMode] = React.useState<TrendMode>('expense');
  const [rankMode, setRankMode] = React.useState<RankMode>('expense');
  const [transactions, setTransactions] = React.useState<FinanceTransactionRow[]>([]);
  const [categories, setCategories] = React.useState<FinanceFlowCategoryRow[]>([]);
  const [aiBillAnalysis, setAiBillAnalysis] = React.useState<string | null>(null);
  const [aiBillAnalysisError, setAiBillAnalysisError] = React.useState<string | null>(null);
  const [aiBillAnalysisBusy, setAiBillAnalysisBusy] = React.useState(false);

  const bg = isDark ? baseTheme.background : '#e8f4fa';
  const surface = isDark ? '#1e293b' : '#ffffff';
  const text = isDark ? '#f8fafc' : '#1f2937';
  const subtle = isDark ? '#94a3b8' : '#6b7280';
  const accent = isDark ? '#60a5fa' : '#2563eb';
  const orange = isDark ? '#fbbf24' : '#f59e0b';
  const green = isDark ? '#34d399' : '#10b981';
  const outline = isDark ? 'rgba(148,163,184,0.25)' : '#e5e7eb';

  const loadStatsData = React.useCallback(async () => {
    try {
      const [transactionRows, categoryRows] = await Promise.all([getFinanceTransactions(), getFinanceFlowCategories()]);
      setTransactions(transactionRows);
      setCategories(categoryRows);
    } catch (error) {
      console.warn('Failed to load finance stats:', error);
      setTransactions([]);
      setCategories([]);
    }
  }, []);

  React.useEffect(() => {
    void loadStatsData();
  }, [loadStatsData]);

  useFocusEffect(
    React.useCallback(() => {
      void loadStatsData();
    }, [loadStatsData])
  );

  const range = React.useMemo(() => {
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
  }, [activeTab, currentDate, customEndDate, customStartDate]);

  const filteredTransactions = React.useMemo(() => {
    return transactions.filter((txn) => {
      const ymd = parseYmd(txn.happened_at);
      return ymd >= range.startYmd && ymd <= range.endYmd;
    });
  }, [range.endYmd, range.startYmd, transactions]);

  const categoryMap = React.useMemo(() => new Map(categories.map((category) => [category.id, category])), [categories]);
  const totalIncome = React.useMemo(
    () => filteredTransactions.filter((txn) => txn.transaction_type === 'income').reduce((sum, txn) => sum + Math.abs(txn.amount), 0),
    [filteredTransactions]
  );
  const totalExpense = React.useMemo(
    () => filteredTransactions.filter((txn) => txn.transaction_type !== 'income' && txn.transaction_type !== 'transfer').reduce((sum, txn) => sum + Math.abs(txn.amount), 0),
    [filteredTransactions]
  );
  const balance = totalIncome - totalExpense;

  const categoryTotal = categoryMode === 'income' ? totalIncome : totalExpense;
  const categoryAccent = categoryMode === 'income' ? orange : accent;
  const categoryData = React.useMemo<CategoryItem[]>(() => {
    const bucket = new Map<string, { name: string; amount: number; count: number; icon: keyof typeof MaterialIcons.glyphMap }>();
    filteredTransactions.forEach((txn) => {
      const isIncome = txn.transaction_type === 'income';
      const isExpense = txn.transaction_type !== 'income' && txn.transaction_type !== 'transfer';
      if ((categoryMode === 'income' && !isIncome) || (categoryMode === 'expense' && !isExpense)) return;
      const category = txn.flow_category_id ? categoryMap.get(txn.flow_category_id) : undefined;
      const key = category?.id ?? 'uncategorized';
      const current = bucket.get(key) ?? { name: category?.name ?? '未分类', amount: 0, count: 0, icon: getCategoryIcon(category) };
      current.amount += Math.abs(txn.amount);
      current.count += 1;
      bucket.set(key, current);
    });
    return Array.from(bucket.values())
      .sort((a, b) => b.amount - a.amount)
      .map((item, index) => ({
        id: index + 1,
        name: item.name,
        percent: categoryTotal > 0 ? (item.amount / categoryTotal) * 100 : 0,
        amount: item.amount,
        count: item.count,
        icon: item.icon,
        color: CATEGORY_COLORS[index % CATEGORY_COLORS.length],
      }));
  }, [categoryMap, categoryMode, categoryTotal, filteredTransactions]);

  const dailyRows = React.useMemo<BillSummaryItem[]>(() => {
    const bucket = new Map<string, { income: number; expense: number }>();
    filteredTransactions.forEach((txn) => {
      const day = parseYmd(txn.happened_at);
      const current = bucket.get(day) ?? { income: 0, expense: 0 };
      const signed = getSignedAmount(txn);
      if (signed > 0) current.income += signed;
      if (signed < 0) current.expense += Math.abs(signed);
      bucket.set(day, current);
    });
    const days = Math.max(1, Math.ceil((range.end.getTime() - range.start.getTime()) / 86400000) + 1);
    const rows = Array.from(bucket.entries())
      .sort(([a], [b]) => (a < b ? 1 : -1))
      .slice(0, 6)
      .map(([day, item]) => ({ date: `${Number(day.slice(5, 7))}.${Number(day.slice(8, 10))}`, expense: item.expense, income: item.income, balance: item.income - item.expense }));
    return [
      { date: '总计', expense: totalExpense, income: totalIncome, balance },
      { date: '日均', expense: totalExpense / days, income: totalIncome / days, balance: balance / days },
      ...rows,
    ];
  }, [balance, filteredTransactions, range.end, range.start, totalExpense, totalIncome]);

  const topRankItems = React.useMemo<TopExpenseItem[]>(() => {
    return filteredTransactions
      .filter((txn) => rankMode === 'income' ? txn.transaction_type === 'income' : txn.transaction_type !== 'income' && txn.transaction_type !== 'transfer')
      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
      .slice(0, 5)
      .map((txn, index) => {
        const category = txn.flow_category_id ? categoryMap.get(txn.flow_category_id) : undefined;
        return {
          id: txn.id,
          rank: index + 1,
          name: category ? `${category.name}-${txn.name}` : txn.name,
          desc: txn.note ?? txn.ai_comment ?? '',
          amount: Math.abs(txn.amount),
          icon: getCategoryIcon(category),
        };
      });
  }, [categoryMap, filteredTransactions, rankMode]);

  const shiftRange = React.useCallback((direction: -1 | 1) => {
    if (activeTab === '自定义') {
      const days = Math.max(1, Math.ceil((customEndDate.getTime() - customStartDate.getTime()) / 86400000) + 1);
      setCustomStartDate((prev) => addDays(prev, direction * days));
      setCustomEndDate((prev) => addDays(prev, direction * days));
      return;
    }

    setCurrentDate((prev) => {
      const next = new Date(prev);
      if (activeTab === '周') {
        next.setDate(next.getDate() + direction * 7);
      } else if (activeTab === '年') {
        next.setFullYear(next.getFullYear() + direction);
      } else {
        next.setMonth(next.getMonth() + direction);
      }
      return next;
    });
  }, [activeTab, customEndDate, customStartDate]);

  const openDatePicker = React.useCallback((field: CustomDateField) => {
    setCustomDateError(null);
    setDraftPickerDate(new Date(field === 'start' ? customStartDate : customEndDate));
    setActiveDatePicker(field);
  }, [customEndDate, customStartDate]);

  const adjustDraftDate = React.useCallback((column: PickerColumn, direction: -1 | 1) => {
    setDraftPickerDate((prev) => {
      const next = new Date(prev);
      if (column === 'year') {
        next.setFullYear(next.getFullYear() + direction);
      } else if (column === 'month') {
        next.setMonth(next.getMonth() + direction);
      } else {
        next.setDate(next.getDate() + direction);
      }
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

  const trendData = React.useMemo(() => {
    const pickTrendValue = (income: number, expense: number) => {
      if (trendMode === 'income') return income;
      if (trendMode === 'balance') return income - expense;
      return expense;
    };

    if (activeTab === '年') {
      const monthly = Array.from({ length: 12 }, () => ({ income: 0, expense: 0 }));
      filteredTransactions.forEach((txn) => {
        if (txn.transaction_type === 'transfer') return;
        const month = Number(parseYmd(txn.happened_at).slice(5, 7));
        if (month < 1 || month > 12) return;
        if (txn.transaction_type === 'income') monthly[month - 1].income += Math.abs(txn.amount);
        else monthly[month - 1].expense += Math.abs(txn.amount);
      });
      const rawValues = monthly.map((item) => pickTrendValue(item.income, item.expense));
      const max = Math.max(...rawValues.map((value) => Math.abs(value)), 1);
      return {
        rawValues,
        values: rawValues.map((value) => Math.max(2, (Math.abs(value) / max) * 100)),
        axis: ['1月', '3月', '6月', '9月', '12月'],
      };
    }

    const daily = new Map<string, { income: number; expense: number }>();
    filteredTransactions.forEach((txn) => {
      if (txn.transaction_type === 'transfer') return;
      const day = parseYmd(txn.happened_at);
      const current = daily.get(day) ?? { income: 0, expense: 0 };
      if (txn.transaction_type === 'income') current.income += Math.abs(txn.amount);
      else current.expense += Math.abs(txn.amount);
      daily.set(day, current);
    });
    const rawValues: number[] = [];
    const cursor = new Date(range.start);
    while (cursor <= range.end) {
      const item = daily.get(formatYmd(cursor)) ?? { income: 0, expense: 0 };
      rawValues.push(pickTrendValue(item.income, item.expense));
      cursor.setDate(cursor.getDate() + 1);
    }
    const max = Math.max(...rawValues.map((value) => Math.abs(value)), 1);
    const shouldShowAxisYear = range.start.getFullYear() !== range.end.getFullYear();
    return {
      rawValues,
      values: rawValues.map((value) => Math.max(2, (Math.abs(value) / max) * 100)),
      axis: activeTab === '周'
        ? Array.from({ length: 7 }, (_, index) => formatMonthDay(addDays(range.start, index)))
        : buildDateAxis(range.start, range.end, shouldShowAxisYear),
    };
  }, [activeTab, filteredTransactions, range.end, range.start, trendMode]);

  const trendTotal = trendMode === 'income' ? totalIncome : trendMode === 'balance' ? balance : totalExpense;
  const trendTitle = trendMode === 'income' ? '每日收入趋势' : trendMode === 'balance' ? '每日结余趋势' : '每日支出趋势';
  const trendModeLabel = trendMode === 'income' ? '收入' : trendMode === 'balance' ? '结余' : '支出';
  const trendAccent = trendMode === 'income' ? orange : trendMode === 'balance' ? green : accent;
  const shouldShowCustomYear = range.start.getFullYear() !== range.end.getFullYear();
  const rangeLabel = activeTab === '年'
    ? `${range.start.getFullYear()}年`
    : activeTab === '自定义'
      ? `${formatCustomDate(range.start, shouldShowCustomYear)} - ${formatCustomDate(range.end, shouldShowCustomYear)}`
      : activeTab === '周'
        ? `${formatMonthDay(range.start)} - ${formatMonthDay(range.end)}`
        : `${range.start.getFullYear()}年${range.start.getMonth() + 1}月`;

  const billSummaryForAi = React.useMemo(() => {
    const parts: string[] = [];
    parts.push(`统计区间：${rangeLabel}（${range.startYmd} 至 ${range.endYmd}）`);
    parts.push(
      `收入合计 ${totalIncome.toFixed(2)} 元，支出合计 ${totalExpense.toFixed(2)} 元，结余 ${balance.toFixed(2)} 元，流水 ${filteredTransactions.length} 笔（转账未计入收支分类）。`,
    );

    if (!filteredTransactions.length) {
      return parts.join('\n');
    }

    const expenseMap = new Map<string, { amount: number; count: number }>();
    const incomeMap = new Map<string, { amount: number; count: number }>();
    for (const txn of filteredTransactions) {
      const cat = txn.flow_category_id ? categoryMap.get(txn.flow_category_id) : undefined;
      const name = cat?.name ?? '未分类';
      if (txn.transaction_type === 'income') {
        const cur = incomeMap.get(name) ?? { amount: 0, count: 0 };
        cur.amount += Math.abs(txn.amount);
        cur.count += 1;
        incomeMap.set(name, cur);
      } else if (txn.transaction_type !== 'transfer') {
        const cur = expenseMap.get(name) ?? { amount: 0, count: 0 };
        cur.amount += Math.abs(txn.amount);
        cur.count += 1;
        expenseMap.set(name, cur);
      }
    }

    const expLines = Array.from(expenseMap.entries())
      .sort((a, b) => b[1].amount - a[1].amount)
      .slice(0, 8)
      .map(([n, { amount, count }]) => `  - 支出「${n}」：${amount.toFixed(2)} 元（${count} 笔）`);
    if (expLines.length) {
      parts.push('支出分类概览：');
      parts.push(...expLines);
    }

    const incLines = Array.from(incomeMap.entries())
      .sort((a, b) => b[1].amount - a[1].amount)
      .slice(0, 6)
      .map(([n, { amount, count }]) => `  - 收入「${n}」：${amount.toFixed(2)} 元（${count} 笔）`);
    if (incLines.length) {
      parts.push('收入分类概览：');
      parts.push(...incLines);
    }

    const top = [...filteredTransactions]
      .filter((t) => t.transaction_type !== 'transfer')
      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
      .slice(0, 6)
      .map((t) => {
        const d = parseYmd(t.happened_at);
        const typ = t.transaction_type === 'income' ? '收入' : '支出';
        const title = (t.name?.trim() || '未命名').slice(0, 28);
        return `  - ${d} ${typ}「${title}」${Math.abs(t.amount).toFixed(2)} 元`;
      });
    if (top.length) {
      parts.push('单笔金额较高的流水（节选）：');
      parts.push(...top);
    }

    const s = parts.join('\n');
    return s.length > 8000 ? `${s.slice(0, 8000)}\n…（摘要已截断）` : s;
  }, [balance, categoryMap, filteredTransactions, range.endYmd, range.startYmd, rangeLabel, totalExpense, totalIncome]);

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
      if (r.ok) {
        setAiBillAnalysis(r.analysis);
      } else {
        setAiBillAnalysisError(r.error);
      }
    } catch (e) {
      setAiBillAnalysisError(e instanceof Error ? e.message : String(e));
    } finally {
      setAiBillAnalysisBusy(false);
    }
  }, [billSummaryForAi]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: bg }]} edges={['top', 'left', 'right']}>
      <View style={[styles.header, { borderBottomColor: outline }]}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.75 }]}>
          <MaterialIcons name="arrow-back" size={22} color={text} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: accent }]}>统计</Text>
        <View style={styles.iconBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={[styles.tabWrap, { backgroundColor: isDark ? 'rgba(148,163,184,0.18)' : 'rgba(255,255,255,0.65)' }]}>
          {RANGE_TABS.map((tab) => {
            const active = tab === activeTab;
            return (
              <Pressable
                key={tab}
                onPress={() => setActiveTab(tab)}
                style={({ pressed }) => [
                  styles.tabBtn,
                  active && [styles.tabBtnActive, { backgroundColor: surface }],
                  pressed && { opacity: 0.8 },
                ]}>
                <Text style={[styles.tabText, { color: active ? text : subtle }]}>{tab}</Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.monthSwitcher}>
          <Pressable onPress={() => shiftRange(-1)} style={({ pressed }) => [styles.switchBtn, pressed && { opacity: 0.65 }]}>
            <MaterialIcons name="chevron-left" size={22} color={subtle} />
          </Pressable>
          <Text style={[styles.monthText, { color: text }]}>{rangeLabel}</Text>
          <Pressable onPress={() => shiftRange(1)} style={({ pressed }) => [styles.switchBtn, pressed && { opacity: 0.65 }]}>
            <MaterialIcons name="chevron-right" size={22} color={subtle} />
          </Pressable>
        </View>

        {activeTab === '自定义' ? (
          <View style={[styles.customDateWrap, { backgroundColor: surface }]}> 
            <Pressable onPress={() => openDatePicker('start')} style={({ pressed }) => [styles.datePickerBtn, { borderColor: outline }, pressed && { opacity: 0.75 }]}>
              <Text style={[styles.datePickerLabel, { color: subtle }]}>开始日期</Text>
              <Text style={[styles.datePickerValue, { color: text }]}>{formatCustomDate(customStartDate, shouldShowCustomYear)}</Text>
            </Pressable>
            <MaterialIcons name="arrow-forward" size={18} color={subtle} />
            <Pressable onPress={() => openDatePicker('end')} style={({ pressed }) => [styles.datePickerBtn, { borderColor: outline }, pressed && { opacity: 0.75 }]}>
              <Text style={[styles.datePickerLabel, { color: subtle }]}>结束日期</Text>
              <Text style={[styles.datePickerValue, { color: text }]}>{formatCustomDate(customEndDate, shouldShowCustomYear)}</Text>
            </Pressable>
          </View>
        ) : null}

        <Modal visible={!!activeDatePicker} transparent animationType="fade" onRequestClose={() => setActiveDatePicker(null)}>
          <Pressable style={styles.modalBackdrop} onPress={() => setActiveDatePicker(null)}>
            <Pressable style={[styles.modalCard, { backgroundColor: surface }]} onPress={(event) => event.stopPropagation()}>
              <View style={styles.modalHeader}>
                <Text style={[styles.modalTitle, { color: text }]}>{activeDatePicker === 'start' ? '选择开始日期' : '选择结束日期'}</Text>
                <Text style={[styles.modalSubtitle, { color: subtle }]}>自定义日期跨度最多两年，确认后统计会按所选区间更新</Text>
              </View>

              <View style={[styles.modalPreview, { backgroundColor: isDark ? 'rgba(148,163,184,0.12)' : '#f8fafc' }]}>
                <Text style={[styles.modalPreviewLabel, { color: subtle }]}>当前选择</Text>
                <Text style={[styles.modalPreviewValue, { color: text }]}>{formatChineseDate(draftPickerDate)}</Text>
                {customDateError ? <Text style={styles.modalErrorText}>{customDateError}</Text> : null}
              </View>

              <View style={styles.pickerColumns}>
                {([
                  { key: 'year', label: '年', value: `${draftPickerDate.getFullYear()}` },
                  { key: 'month', label: '月', value: `${draftPickerDate.getMonth() + 1}` },
                  { key: 'day', label: '日', value: `${draftPickerDate.getDate()}` },
                ] as { key: PickerColumn; label: string; value: string }[]).map((item) => (
                  <View key={item.key} style={[styles.pickerColumnCard, { backgroundColor: isDark ? 'rgba(148,163,184,0.1)' : '#f8f9fc' }]}>
                    <Pressable onPress={() => adjustDraftDate(item.key, 1)} style={({ pressed }) => [styles.pickerAdjustBtn, pressed && { opacity: 0.7 }]}>
                      <MaterialIcons name="keyboard-arrow-up" size={22} color={accent} />
                    </Pressable>
                    <Text style={[styles.pickerColumnLabel, { color: subtle }]}>{item.label}</Text>
                    <Text style={[styles.pickerColumnValue, { color: text }]}>{item.value}</Text>
                    <Pressable onPress={() => adjustDraftDate(item.key, -1)} style={({ pressed }) => [styles.pickerAdjustBtn, pressed && { opacity: 0.7 }]}>
                      <MaterialIcons name="keyboard-arrow-down" size={22} color={accent} />
                    </Pressable>
                  </View>
                ))}
              </View>

              <View style={styles.modalActions}>
                <Pressable onPress={() => setActiveDatePicker(null)} style={({ pressed }) => [styles.modalActionBtn, { backgroundColor: isDark ? 'rgba(148,163,184,0.12)' : '#eef2ff' }, pressed && { opacity: 0.8 }]}>
                  <Text style={[styles.modalActionText, { color: subtle }]}>取消</Text>
                </Pressable>
                <Pressable onPress={confirmDraftDate} style={({ pressed }) => [styles.modalActionBtn, { backgroundColor: accent }, pressed && { opacity: 0.85 }]}>
                  <Text style={styles.modalActionTextPrimary}>确定</Text>
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </Modal>

        <View style={[styles.card, { backgroundColor: surface }]}>
          <View style={styles.summaryRow}>
            <View style={styles.summaryCol}>
              <Text style={[styles.summaryLabel, { color: subtle }]}>支出</Text>
              <Text style={[styles.summaryValue, { color: accent }]}>{formatMoney(totalExpense)}</Text>
            </View>
            <View style={styles.summaryCol}>
              <Text style={[styles.summaryLabel, { color: subtle }]}>收入</Text>
              <Text style={[styles.summaryValue, { color: orange }]}>{formatMoney(totalIncome)}</Text>
            </View>
            <View style={styles.summaryCol}>
              <Text style={[styles.summaryLabel, { color: subtle }]}>结余</Text>
              <Text style={[styles.summaryValue, { color: green }]}>{balance < 0 ? '-' : ''}{formatMoney(Math.abs(balance))}</Text>
            </View>
          </View>

          <View style={[styles.analysisCard, { backgroundColor: isDark ? 'rgba(148,163,184,0.12)' : '#f8fafc', borderColor: outline }]}>
            <View style={styles.analysisHeader}>
              <MaterialIcons name="auto-awesome" size={18} color={accent} />
              <Text style={[styles.analysisTitle, { color: text }]}>AI 账单分析</Text>
            </View>
            {aiBillAnalysisBusy ? (
              <View style={styles.analysisLoadingRow}>
                <ActivityIndicator size="small" color={accent} />
                <Text style={[styles.analysisBody, { color: subtle, flex: 1 }]}>正在调用智谱模型，请稍候…</Text>
              </View>
            ) : (
              <Text style={[styles.analysisBody, { color: aiBillAnalysisError ? (isDark ? '#f87171' : '#dc2626') : subtle }]}>
                {aiBillAnalysisError
                  ? `获取失败：${aiBillAnalysisError}`
                  : aiBillAnalysis ??
                    '根据当前区间的收支、分类与高额流水摘要生成 2～5 句建议。点击下方按钮调用智谱 GLM-4-Flash（与项目内智谱接口一致），需要网络；密钥优先读取 EXPO_PUBLIC_ZHIPU_API_KEY。'}
              </Text>
            )}
            <Pressable
              onPress={() => void runAiBillAnalysis()}
              disabled={aiBillAnalysisBusy}
              style={({ pressed }) => [
                styles.analysisActionBtn,
                { backgroundColor: isDark ? 'rgba(96,165,250,0.18)' : 'rgba(37,99,235,0.10)', borderColor: outline },
                pressed && !aiBillAnalysisBusy && { opacity: 0.88 },
                aiBillAnalysisBusy && { opacity: 0.55 },
              ]}>
              <MaterialIcons name="psychology" size={18} color={accent} />
              <Text style={[styles.analysisActionBtnText, { color: accent }]}>
                {aiBillAnalysisBusy ? '分析中…' : aiBillAnalysis ? '重新生成' : '生成 AI 分析'}
              </Text>
            </Pressable>
          </View>
        </View>

        <View style={[styles.card, { backgroundColor: surface }]}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: text }]}>{categoryMode === 'income' ? '收入分类构成' : '支出分类构成'}</Text>
            <View style={[styles.pillTabs, { backgroundColor: isDark ? 'rgba(148,163,184,0.16)' : '#f3f4f6' }]}>
              <Pressable onPress={() => setCategoryMode('expense')}>
                <Text style={categoryMode === 'expense' ? [styles.pillTabActive, { backgroundColor: accent }] : [styles.pillTab, { color: subtle }]}>支出</Text>
              </Pressable>
              <Pressable onPress={() => setCategoryMode('income')}>
                <Text style={categoryMode === 'income' ? [styles.pillTabActive, { backgroundColor: orange }] : [styles.pillTab, { color: subtle }]}>收入</Text>
              </Pressable>
            </View>
          </View>

          <View style={styles.donutArea}>
            <View style={[styles.donutOuter, { borderColor: categoryAccent }]}>
              <View style={[styles.donutInner, { backgroundColor: surface }]}>
                <Text style={[styles.donutLabel, { color: subtle }]}>{categoryMode === 'income' ? '本期收入' : '本期支出'}</Text>
                <Text style={[styles.donutValue, { color: text }]}>{formatMoney(categoryTotal)}</Text>
              </View>
            </View>
          </View>

          {categoryData.map((item) => (
            <View key={item.id} style={styles.categoryRow}>
              <View style={[styles.categoryIcon, { backgroundColor: `${item.color}20` }]}>
                <MaterialIcons name={item.icon} size={16} color={item.color} />
              </View>
              <View style={styles.categoryMain}>
                <View style={styles.categoryTop}>
                  <Text style={[styles.categoryName, { color: text }]}>{item.name}</Text>
                  <Text style={[styles.categoryAmount, { color: text }]}>{formatMoney(item.amount)}</Text>
                </View>
                <View style={styles.categoryBottom}>
                  <View style={[styles.progressTrack, { backgroundColor: isDark ? 'rgba(148,163,184,0.2)' : '#e5e7eb' }]}>
                    <View style={[styles.progressFill, { width: `${item.percent}%`, backgroundColor: item.color }]} />
                  </View>
                  <Text style={[styles.categoryMeta, { color: subtle }]}>{item.percent.toFixed(2)}% · {item.count}笔</Text>
                </View>
              </View>
            </View>
          ))}
        </View>

        <View style={[styles.card, { backgroundColor: surface }]}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: text }]}>{trendTitle}</Text>
            <View style={[styles.pillTabs, { backgroundColor: isDark ? 'rgba(148,163,184,0.16)' : '#f3f4f6' }]}>
              <Pressable onPress={() => setTrendMode('expense')}>
                <Text style={trendMode === 'expense' ? [styles.pillTabActive, { backgroundColor: accent }] : [styles.pillTab, { color: subtle }]}>支出</Text>
              </Pressable>
              <Pressable onPress={() => setTrendMode('income')}>
                <Text style={trendMode === 'income' ? [styles.pillTabActive, { backgroundColor: orange }] : [styles.pillTab, { color: subtle }]}>收入</Text>
              </Pressable>
              <Pressable onPress={() => setTrendMode('balance')}>
                <Text style={trendMode === 'balance' ? [styles.pillTabActive, { backgroundColor: green }] : [styles.pillTab, { color: subtle }]}>结余</Text>
              </Pressable>
            </View>
          </View>

          <View style={[styles.trendTip, { backgroundColor: isDark ? 'rgba(148,163,184,0.14)' : '#f8fafc' }]}>
            <Text style={[styles.trendTipText, { color: subtle }]}>
              {filteredTransactions.length ? `区间内共 ${filteredTransactions.length} 笔，${trendModeLabel} ${trendTotal < 0 ? '-' : ''}${formatMoney(Math.abs(trendTotal))}` : '当前区间暂无账单数据'}
            </Text>
          </View>

          <View style={styles.trendChart}>
            {trendData.values.map((h, idx) => (
              <View
                key={`bar-${idx}`}
                style={[
                  styles.trendBar,
                  {
                    height: `${h}%`,
                    backgroundColor: h > 10 ? trendAccent : (isDark ? 'rgba(148,163,184,0.35)' : '#dbeafe'),
                  },
                ]}
              />
            ))}
          </View>
          <View style={styles.trendAxis}>
            {trendData.axis.map((label) => (
              <Text key={label} style={[styles.trendAxisText, { color: subtle }]}>{label}</Text>
            ))}
          </View>
        </View>

        <View style={[styles.card, { backgroundColor: surface }]}>
          <Text style={[styles.sectionTitle, { color: text }]}>账单汇总</Text>
          <View style={[styles.tableWrap, { backgroundColor: isDark ? 'rgba(148,163,184,0.08)' : '#f8f9fc' }]}>
            <View style={styles.tableHeader}>
              <Text style={[styles.tableHeadText, { color: subtle }]}>日期</Text>
              <Text style={[styles.tableHeadText, { color: subtle }]}>支出</Text>
              <Text style={[styles.tableHeadText, { color: subtle }]}>收入</Text>
              <Text style={[styles.tableHeadText, { color: subtle }]}>结余</Text>
            </View>
            {dailyRows.map((row) => (
              <View key={row.date} style={[styles.tableRow, { borderBottomColor: outline }]}>
                <Text style={[styles.tableCell, { color: text }]}>{row.date}</Text>
                <Text style={[styles.tableCell, { color: accent }]}>{formatMoney(row.expense)}</Text>
                <Text style={[styles.tableCell, { color: orange }]}>{formatMoney(row.income)}</Text>
                <Text style={[styles.tableCell, { color: green }]}>{row.balance < 0 ? '-' : ''}{formatMoney(Math.abs(row.balance))}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={[styles.card, { backgroundColor: surface, marginBottom: 14 }]}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: text }]}>{rankMode === 'income' ? '单笔收入排行' : '单笔支出排行'}</Text>
            <View style={[styles.pillTabs, { backgroundColor: isDark ? 'rgba(148,163,184,0.16)' : '#f3f4f6' }]}>
              <Pressable onPress={() => setRankMode('expense')}>
                <Text style={rankMode === 'expense' ? [styles.pillTabActive, { backgroundColor: accent }] : [styles.pillTab, { color: subtle }]}>支出</Text>
              </Pressable>
              <Pressable onPress={() => setRankMode('income')}>
                <Text style={rankMode === 'income' ? [styles.pillTabActive, { backgroundColor: orange }] : [styles.pillTab, { color: subtle }]}>收入</Text>
              </Pressable>
            </View>
          </View>
          {topRankItems.map((item) => (
            <View key={item.id} style={[styles.rankRow, { backgroundColor: isDark ? 'rgba(148,163,184,0.1)' : '#f8f9fc' }]}>
              <Text style={[styles.rankNum, { color: rankMode === 'income' ? orange : accent }]}>{item.rank}</Text>
              <View style={[styles.rankIcon, { backgroundColor: `${rankMode === 'income' ? orange : accent}22` }]}>
                <MaterialIcons name={item.icon} size={18} color={rankMode === 'income' ? orange : accent} />
              </View>
              <View style={styles.rankMain}>
                <Text style={[styles.rankTitle, { color: text }]}>{item.name}</Text>
                {item.desc ? <Text style={[styles.rankDesc, { color: subtle }]}>{item.desc}</Text> : null}
              </View>
              <Text style={[styles.rankAmount, { color: text }]}>{formatMoney(item.amount)}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    height: 56,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 19,
    fontWeight: '900',
    letterSpacing: 0.6,
  },
  scrollContent: {
    padding: 14,
    paddingBottom: 28,
    gap: 12,
  },
  tabWrap: {
    borderRadius: 999,
    padding: 4,
    flexDirection: 'row',
  },
  tabBtn: {
    flex: 1,
    borderRadius: 999,
    paddingVertical: 8,
    alignItems: 'center',
  },
  tabBtnActive: {
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  tabText: {
    fontSize: 13,
    fontWeight: '700',
  },
  monthSwitcher: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 6,
  },
  switchBtn: {
    width: 36,
    height: 32,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthText: {
    fontSize: 15,
    fontWeight: '700',
  },
  customDateWrap: {
    borderRadius: 16,
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  datePickerBtn: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 4,
  },
  datePickerLabel: {
    fontSize: 11,
    fontWeight: '700',
  },
  datePickerValue: {
    fontSize: 14,
    fontWeight: '800',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.45)',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    borderRadius: 24,
    padding: 18,
    gap: 16,
  },
  modalHeader: {
    gap: 6,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '900',
  },
  modalSubtitle: {
    fontSize: 12,
    lineHeight: 18,
  },
  modalPreview: {
    borderRadius: 16,
    padding: 12,
    gap: 4,
  },
  modalPreviewLabel: {
    fontSize: 11,
    fontWeight: '700',
  },
  modalPreviewValue: {
    fontSize: 20,
    fontWeight: '900',
  },
  modalErrorText: {
    color: '#ef4444',
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '700',
  },
  pickerColumns: {
    flexDirection: 'row',
    gap: 10,
  },
  pickerColumnCard: {
    flex: 1,
    borderRadius: 18,
    paddingVertical: 12,
    alignItems: 'center',
    gap: 8,
  },
  pickerAdjustBtn: {
    width: 36,
    height: 36,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickerColumnLabel: {
    fontSize: 12,
    fontWeight: '700',
  },
  pickerColumnValue: {
    fontSize: 22,
    fontWeight: '900',
  },
  modalActions: {
    flexDirection: 'row',
    gap: 10,
  },
  modalActionBtn: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalActionText: {
    fontSize: 14,
    fontWeight: '800',
  },
  modalActionTextPrimary: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '800',
  },
  card: {
    borderRadius: 22,
    padding: 14,
    gap: 12,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  summaryCol: {
    alignItems: 'center',
    width: '32%',
  },
  summaryLabel: {
    fontSize: 12,
    marginBottom: 4,
  },
  summaryValue: {
    fontSize: 20,
    fontWeight: '800',
  },
  analysisCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    gap: 8,
  },
  analysisHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  analysisTitle: {
    fontSize: 13,
    fontWeight: '800',
  },
  analysisBody: {
    fontSize: 12,
    lineHeight: 18,
  },
  analysisLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  analysisActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 4,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  analysisActionBtnText: {
    fontSize: 13,
    fontWeight: '800',
  },
  analysisLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  analysisLinkText: {
    fontSize: 11,
    fontWeight: '700',
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '800',
  },
  pillTabs: {
    borderRadius: 999,
    padding: 3,
    flexDirection: 'row',
    gap: 4,
    alignItems: 'center',
  },
  pillTabActive: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    overflow: 'hidden',
  },
  pillTab: {
    fontSize: 11,
    fontWeight: '700',
    paddingHorizontal: 10,
  },
  donutArea: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  donutOuter: {
    width: 160,
    height: 160,
    borderRadius: 999,
    borderWidth: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  donutInner: {
    width: 98,
    height: 98,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  donutLabel: {
    fontSize: 11,
    marginBottom: 3,
  },
  donutValue: {
    fontSize: 16,
    fontWeight: '800',
  },
  categoryRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
  },
  categoryIcon: {
    width: 30,
    height: 30,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryMain: {
    flex: 1,
    gap: 4,
  },
  categoryTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  categoryName: {
    fontSize: 13,
    fontWeight: '700',
  },
  categoryAmount: {
    fontSize: 13,
    fontWeight: '700',
  },
  categoryBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  progressTrack: {
    flex: 1,
    height: 6,
    borderRadius: 999,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
  },
  categoryMeta: {
    fontSize: 10,
    minWidth: 68,
    textAlign: 'right',
  },
  trendTip: {
    alignSelf: 'center',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  trendTipText: {
    fontSize: 11,
    fontWeight: '600',
  },
  trendChart: {
    height: 128,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 1,
    paddingHorizontal: 2,
  },
  trendBar: {
    flex: 1,
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
    minHeight: 2,
  },
  trendAxis: {
    marginTop: 2,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  trendAxisText: {
    flexShrink: 1,
    maxWidth: 58,
    textAlign: 'center',
    fontSize: 10,
    fontWeight: '600',
  },
  tableWrap: {
    borderRadius: 14,
    padding: 8,
  },
  tableHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  tableHeadText: {
    width: '25%',
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '700',
  },
  tableRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tableCell: {
    width: '25%',
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '600',
  },
  rankRow: {
    borderRadius: 14,
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  rankNum: {
    width: 18,
    textAlign: 'center',
    fontWeight: '800',
  },
  rankIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankMain: {
    flex: 1,
    gap: 2,
  },
  rankTitle: {
    fontSize: 12,
    fontWeight: '700',
  },
  rankDesc: {
    fontSize: 11,
  },
  rankAmount: {
    fontSize: 13,
    fontWeight: '800',
  },
});
