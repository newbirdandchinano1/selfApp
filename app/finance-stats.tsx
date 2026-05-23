import { AppButton, AppCard, AppIconButton, ScreenHeader } from '@/components/ui';
import { Layout, Radius, Spacing, Typography } from '@/constants/design-tokens';
import { useAppTheme } from '@/hooks/use-app-theme';
import { getFinanceFlowCategories, getFinanceTransactions } from '@/lib/repositories/finance/finance';
import {
  BUILTIN_SHEET_CATEGORY_LABELS,
  getFinanceTransactionCategoryLabel,
  isInitialBalanceFinanceTransaction,
  parseFinanceTransactionExtra,
} from '@/lib/repositories/finance/finance-transaction-extra';
import type { FinanceFlowCategoryRow, FinanceTransactionRow } from '@/lib/repositories/finance/finance.types';
import { analyzeFinanceBillSummaryFromText, getActiveAiLlmApiKey } from '@/lib/zhipu-image-parse';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import React from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

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

type TrendPoint = {
  dateKey: string;
  label: string;
  rawValue: number;
  heightPct: number;
  income: number;
  expense: number;
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

function SummaryMetric({ label, valueText, color }: { label: string; valueText: string; color: string }) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.summaryCol}>
      <Text style={[Typography.caption, styles.summaryLabel, { color: colors.textSecondary }]} numberOfLines={1}>
        {label}
      </Text>
      <Text
        style={[styles.summaryAmount, { color }]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.5}>
        {valueText}
      </Text>
    </View>
  );
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

function resolveTransactionCategory(
  txn: FinanceTransactionRow,
  categoryMap: Map<string, FinanceFlowCategoryRow>,
  categoryByName: Map<string, FinanceFlowCategoryRow>,
) {
  if (txn.flow_category_id) {
    const row = categoryMap.get(txn.flow_category_id);
    if (row) {
      return { key: row.id, name: row.name, icon: getCategoryIcon(row), row };
    }
  }

  const extra = parseFinanceTransactionExtra(txn.extra_data);
  const label = extra.category_label?.trim() || (extra.category_key ? BUILTIN_SHEET_CATEGORY_LABELS[extra.category_key] : undefined);
  if (label) {
    const row = categoryByName.get(label);
    if (row) {
      return { key: row.id, name: row.name, icon: getCategoryIcon(row), row };
    }
    return { key: `label:${label}`, name: label, icon: DEFAULT_CATEGORY_ICON, row: undefined };
  }

  return { key: 'uncategorized', name: '未分类', icon: DEFAULT_CATEGORY_ICON, row: undefined };
}

export default function FinanceStatsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, isDark, shadows } = useAppTheme();
  const expenseColor = colors.primary;
  const incomeColor = colors.tertiary;
  const balanceColor = colors.secondary;
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
  const [selectedTrendIndex, setSelectedTrendIndex] = React.useState<number | null>(null);
  const [transactions, setTransactions] = React.useState<FinanceTransactionRow[]>([]);
  const [categories, setCategories] = React.useState<FinanceFlowCategoryRow[]>([]);
  const [aiBillAnalysis, setAiBillAnalysis] = React.useState<string | null>(null);
  const [aiBillAnalysisError, setAiBillAnalysisError] = React.useState<string | null>(null);
  const [aiBillAnalysisBusy, setAiBillAnalysisBusy] = React.useState(false);

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
  const categoryByName = React.useMemo(() => new Map(categories.map((category) => [category.name, category])), [categories]);
  const categoryNameById = React.useMemo(() => new Map(categories.map((category) => [category.id, category.name])), [categories]);
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
  const categoryAccent = categoryMode === 'income' ? incomeColor : expenseColor;
  const categoryData = React.useMemo<CategoryItem[]>(() => {
    const bucket = new Map<string, { name: string; amount: number; count: number; icon: keyof typeof MaterialIcons.glyphMap }>();
    filteredTransactions.forEach((txn) => {
      const isIncome = txn.transaction_type === 'income';
      const isExpense = txn.transaction_type !== 'income' && txn.transaction_type !== 'transfer';
      if ((categoryMode === 'income' && !isIncome) || (categoryMode === 'expense' && !isExpense)) return;
      const resolved = resolveTransactionCategory(txn, categoryMap, categoryByName);
      const current = bucket.get(resolved.key) ?? { name: resolved.name, amount: 0, count: 0, icon: resolved.icon };
      current.amount += Math.abs(txn.amount);
      current.count += 1;
      bucket.set(resolved.key, current);
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
  }, [categoryByName, categoryMap, categoryMode, categoryTotal, filteredTransactions]);

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
      .filter((txn) => !isInitialBalanceFinanceTransaction(txn))
      .filter((txn) => rankMode === 'income' ? txn.transaction_type === 'income' : txn.transaction_type !== 'income' && txn.transaction_type !== 'transfer')
      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
      .slice(0, 5)
      .map((txn, index) => {
        const resolved = resolveTransactionCategory(txn, categoryMap, categoryByName);
        return {
          id: txn.id,
          rank: index + 1,
          name: resolved.name === '未分类' ? txn.name : `${resolved.name}-${txn.name}`,
          desc: txn.note ?? txn.ai_comment ?? '',
          amount: Math.abs(txn.amount),
          icon: resolved.icon,
        };
      });
  }, [categoryByName, categoryMap, filteredTransactions, rankMode]);

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
      const year = range.start.getFullYear();
      const points: TrendPoint[] = monthly.map((item, index) => ({
        dateKey: `${year}-${String(index + 1).padStart(2, '0')}`,
        label: `${index + 1}月`,
        rawValue: pickTrendValue(item.income, item.expense),
        heightPct: Math.max(2, (Math.abs(pickTrendValue(item.income, item.expense)) / max) * 100),
        income: item.income,
        expense: item.expense,
      }));
      return {
        points,
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
    const points: TrendPoint[] = [];
    const cursor = new Date(range.start);
    while (cursor <= range.end) {
      const dayKey = formatYmd(cursor);
      const item = daily.get(dayKey) ?? { income: 0, expense: 0 };
      points.push({
        dateKey: dayKey,
        label: formatChineseDate(cursor),
        rawValue: pickTrendValue(item.income, item.expense),
        heightPct: 0,
        income: item.income,
        expense: item.expense,
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    const max = Math.max(...points.map((point) => Math.abs(point.rawValue)), 1);
    points.forEach((point) => {
      point.heightPct = Math.max(2, (Math.abs(point.rawValue) / max) * 100);
    });
    const shouldShowAxisYear = range.start.getFullYear() !== range.end.getFullYear();
    return {
      points,
      axis: activeTab === '周'
        ? Array.from({ length: 7 }, (_, index) => formatMonthDay(addDays(range.start, index)))
        : buildDateAxis(range.start, range.end, shouldShowAxisYear),
    };
  }, [activeTab, filteredTransactions, range.end, range.start, trendMode]);

  React.useEffect(() => {
    setSelectedTrendIndex(null);
  }, [activeTab, currentDate, customEndDate, customStartDate, trendMode]);

  const trendTotal = trendMode === 'income' ? totalIncome : trendMode === 'balance' ? balance : totalExpense;
  const trendModeLabel = trendMode === 'income' ? '收入' : trendMode === 'balance' ? '结余' : '支出';
  const selectedTrendPoint = selectedTrendIndex != null ? trendData.points[selectedTrendIndex] ?? null : null;
  const trendTipText = React.useMemo(() => {
    if (selectedTrendPoint) {
      if (trendMode === 'balance') {
        const balanceValue = selectedTrendPoint.income - selectedTrendPoint.expense;
        return `${selectedTrendPoint.label} · 收入 ${formatMoney(selectedTrendPoint.income)} · 支出 ${formatMoney(selectedTrendPoint.expense)} · 结余 ${balanceValue < 0 ? '-' : ''}${formatMoney(Math.abs(balanceValue))}`;
      }
      const value = trendMode === 'income' ? selectedTrendPoint.income : selectedTrendPoint.expense;
      return `${selectedTrendPoint.label} · ${trendModeLabel} ${formatMoney(value)}`;
    }
    if (!filteredTransactions.length) return '当前区间暂无账单数据';
    return `区间内共 ${filteredTransactions.length} 笔，${trendModeLabel} ${trendTotal < 0 ? '-' : ''}${formatMoney(Math.abs(trendTotal))} · 点击柱形查看具体日期`;
  }, [filteredTransactions.length, selectedTrendPoint, trendMode, trendModeLabel, trendTotal]);
  const trendTitle = trendMode === 'income' ? '每日收入趋势' : trendMode === 'balance' ? '每日结余趋势' : '每日支出趋势';
  const trendAccent = trendMode === 'income' ? incomeColor : trendMode === 'balance' ? balanceColor : expenseColor;
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
      const name = getFinanceTransactionCategoryLabel(txn, categoryNameById) ?? '未分类';
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
  }, [balance, categoryNameById, filteredTransactions, range.endYmd, range.startYmd, rangeLabel, totalExpense, totalIncome]);

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

  const renderModePill = (label: string, active: boolean, activeColor: string, onPress: () => void) => (
    <Pressable key={label} onPress={onPress}>
      <Text
        style={
          active
            ? [styles.pillTabActive, { backgroundColor: activeColor }]
            : [styles.pillTab, { color: colors.textSecondary }]
        }>
        {label}
      </Text>
    </Pressable>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['left', 'right', 'bottom']}>
      <ScreenHeader title="统计" onBack={() => router.back()} />

      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: Spacing['6xl'] + Math.max(insets.bottom, Spacing.md) },
        ]}
        showsVerticalScrollIndicator={false}>
        <View style={[styles.tabWrap, { backgroundColor: isDark ? colors.surfaceMuted : colors.capsule }]}>
          {RANGE_TABS.map((tab) => {
            const active = tab === activeTab;
            return (
              <Pressable
                key={tab}
                onPress={() => setActiveTab(tab)}
                style={({ pressed }) => [
                  styles.tabBtn,
                  active && [styles.tabBtnActive, shadows.card, { backgroundColor: colors.surface }],
                  pressed && { opacity: 0.88 },
                ]}>
                <Text style={[Typography.caption, { color: active ? colors.text : colors.textSecondary }]}>{tab}</Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.monthSwitcher}>
          <AppIconButton
            icon="chevron-left"
            onPress={() => shiftRange(-1)}
            color={colors.textSecondary}
            accessibilityLabel="上一段区间"
          />
          <Text style={[Typography.bodyStrong, styles.monthText, { color: colors.text }]}>{rangeLabel}</Text>
          <AppIconButton
            icon="chevron-right"
            onPress={() => shiftRange(1)}
            color={colors.textSecondary}
            accessibilityLabel="下一段区间"
          />
        </View>

        {activeTab === '自定义' ? (
          <AppCard style={styles.customDateWrap}>
            <Pressable
              onPress={() => openDatePicker('start')}
              style={({ pressed }) => [styles.datePickerBtn, { borderColor: colors.outline }, pressed && { opacity: 0.88 }]}>
              <Text style={[Typography.label, { color: colors.textSecondary }]}>开始日期</Text>
              <Text style={[Typography.bodyStrong, { color: colors.text }]}>{formatCustomDate(customStartDate, shouldShowCustomYear)}</Text>
            </Pressable>
            <MaterialIcons name="arrow-forward" size={18} color={colors.textSecondary} />
            <Pressable
              onPress={() => openDatePicker('end')}
              style={({ pressed }) => [styles.datePickerBtn, { borderColor: colors.outline }, pressed && { opacity: 0.88 }]}>
              <Text style={[Typography.label, { color: colors.textSecondary }]}>结束日期</Text>
              <Text style={[Typography.bodyStrong, { color: colors.text }]}>{formatCustomDate(customEndDate, shouldShowCustomYear)}</Text>
            </Pressable>
          </AppCard>
        ) : null}

        <Modal visible={!!activeDatePicker} transparent animationType="fade" onRequestClose={() => setActiveDatePicker(null)}>
          <Pressable style={[styles.modalBackdrop, { backgroundColor: colors.overlay }]} onPress={() => setActiveDatePicker(null)}>
            <Pressable
              style={[styles.modalCard, shadows.card, { backgroundColor: colors.surface, borderColor: colors.outline }]}
              onPress={(event) => event.stopPropagation()}>
              <View style={styles.modalHeader}>
                <Text style={[Typography.h3, { color: colors.text }]}>
                  {activeDatePicker === 'start' ? '选择开始日期' : '选择结束日期'}
                </Text>
                <Text style={[Typography.caption, styles.modalSubtitle, { color: colors.textSecondary }]}>
                  自定义日期跨度最多两年，确认后统计会按所选区间更新
                </Text>
              </View>

              <View style={[styles.modalPreview, { backgroundColor: colors.surfaceSubtle }]}>
                <Text style={[Typography.label, { color: colors.textSecondary }]}>当前选择</Text>
                <Text style={[Typography.h2, { color: colors.text }]}>{formatChineseDate(draftPickerDate)}</Text>
                {customDateError ? (
                  <Text style={[Typography.caption, { color: colors.danger }]}>{customDateError}</Text>
                ) : null}
              </View>

              <View style={styles.pickerColumns}>
                {([
                  { key: 'year', label: '年', value: `${draftPickerDate.getFullYear()}` },
                  { key: 'month', label: '月', value: `${draftPickerDate.getMonth() + 1}` },
                  { key: 'day', label: '日', value: `${draftPickerDate.getDate()}` },
                ] as { key: PickerColumn; label: string; value: string }[]).map((item) => (
                  <View
                    key={item.key}
                    style={[styles.pickerColumnCard, { backgroundColor: isDark ? colors.surfaceMuted : colors.surfaceSubtle }]}>
                    <Pressable onPress={() => adjustDraftDate(item.key, 1)} style={({ pressed }) => [styles.pickerAdjustBtn, pressed && { opacity: 0.7 }]}>
                      <MaterialIcons name="keyboard-arrow-up" size={22} color={expenseColor} />
                    </Pressable>
                    <Text style={[Typography.label, { color: colors.textSecondary }]}>{item.label}</Text>
                    <Text style={[Typography.h2, styles.pickerColumnValue, { color: colors.text }]}>{item.value}</Text>
                    <Pressable onPress={() => adjustDraftDate(item.key, -1)} style={({ pressed }) => [styles.pickerAdjustBtn, pressed && { opacity: 0.7 }]}>
                      <MaterialIcons name="keyboard-arrow-down" size={22} color={expenseColor} />
                    </Pressable>
                  </View>
                ))}
              </View>

              <View style={styles.modalActions}>
                <AppButton
                  label="取消"
                  variant="outline"
                  onPress={() => setActiveDatePicker(null)}
                  style={styles.modalActionBtn}
                />
                <AppButton label="确定" variant="primary" onPress={confirmDraftDate} style={styles.modalActionBtn} />
              </View>
            </Pressable>
          </Pressable>
        </Modal>

        <AppCard style={[shadows.card, styles.cardGap]}>
          <View style={styles.summaryRow}>
            <SummaryMetric label="支出" valueText={formatMoney(totalExpense)} color={expenseColor} />
            <SummaryMetric label="收入" valueText={formatMoney(totalIncome)} color={incomeColor} />
            <SummaryMetric
              label="结余"
              valueText={`${balance < 0 ? '-' : ''}${formatMoney(Math.abs(balance))}`}
              color={balanceColor}
            />
          </View>

          <View style={[styles.analysisCard, { backgroundColor: colors.surfaceSubtle, borderColor: colors.outline }]}>
            <View style={styles.analysisHeader}>
              <MaterialIcons name="auto-awesome" size={18} color={expenseColor} />
              <Text style={[Typography.bodyStrong, { color: colors.text }]}>AI 账单分析</Text>
            </View>
            {aiBillAnalysisBusy ? (
              <View style={styles.analysisLoadingRow}>
                <ActivityIndicator size="small" color={expenseColor} />
                <Text style={[Typography.caption, { color: colors.textSecondary, flex: 1 }]}>正在调用智谱模型，请稍候…</Text>
              </View>
            ) : (
              <Text
                style={[
                  Typography.caption,
                  styles.analysisBody,
                  { color: aiBillAnalysisError ? colors.danger : colors.textSecondary },
                ]}>
                {aiBillAnalysisError
                  ? `获取失败：${aiBillAnalysisError}`
                  : aiBillAnalysis ??
                    '根据当前区间的收支、分类与高额流水摘要生成约 300～400 字的结构化分析（总览、习惯、风险亮点与可行建议）。点击下方按钮调用智谱 GLM-4-Flash（与项目内智谱接口一致），需要网络；密钥优先读取 EXPO_PUBLIC_ZHIPU_API_KEY。'}
              </Text>
            )}
            <Pressable
              onPress={() => void runAiBillAnalysis()}
              disabled={aiBillAnalysisBusy}
              style={({ pressed }) => [
                styles.analysisActionBtn,
                { backgroundColor: colors.primaryMuted, borderColor: colors.outline },
                pressed && !aiBillAnalysisBusy && { opacity: 0.88 },
                aiBillAnalysisBusy && { opacity: 0.55 },
              ]}>
              <MaterialIcons name="psychology" size={18} color={expenseColor} />
              <Text style={[Typography.bodyStrong, { color: expenseColor }]}>
                {aiBillAnalysisBusy ? '分析中…' : aiBillAnalysis ? '重新生成' : '生成 AI 分析'}
              </Text>
            </Pressable>
          </View>
        </AppCard>

        <AppCard style={[shadows.card, styles.cardGap]}>
          <View style={styles.sectionHeader}>
            <Text style={[Typography.title, { color: colors.text }]}>
              {categoryMode === 'income' ? '收入分类构成' : '支出分类构成'}
            </Text>
            <View style={[styles.pillTabs, { backgroundColor: isDark ? colors.surfaceMuted : colors.capsule }]}>
              {renderModePill('支出', categoryMode === 'expense', expenseColor, () => setCategoryMode('expense'))}
              {renderModePill('收入', categoryMode === 'income', incomeColor, () => setCategoryMode('income'))}
            </View>
          </View>

          <View style={styles.donutArea}>
            <View style={[styles.donutOuter, { borderColor: categoryAccent }]}>
              <View style={[styles.donutInner, { backgroundColor: colors.surface }]}>
                <Text style={[Typography.label, { color: colors.textSecondary }]}>
                  {categoryMode === 'income' ? '本期收入' : '本期支出'}
                </Text>
                <Text style={[Typography.title, { color: colors.text }]}>{formatMoney(categoryTotal)}</Text>
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
                  <Text style={[Typography.bodyStrong, { color: colors.text }]}>{item.name}</Text>
                  <Text style={[Typography.bodyStrong, { color: colors.text }]}>{formatMoney(item.amount)}</Text>
                </View>
                <View style={styles.categoryBottom}>
                  <View style={[styles.progressTrack, { backgroundColor: colors.progressTrack }]}>
                    <View style={[styles.progressFill, { width: `${item.percent}%`, backgroundColor: item.color }]} />
                  </View>
                  <Text style={[styles.categoryMeta, { color: colors.textSecondary }]}>
                    {item.percent.toFixed(2)}% · {item.count}笔
                  </Text>
                </View>
              </View>
            </View>
          ))}
        </AppCard>

        <AppCard style={[shadows.card, styles.cardGap]}>
          <View style={styles.sectionHeader}>
            <Text style={[Typography.title, { color: colors.text }]}>{trendTitle}</Text>
            <View style={[styles.pillTabs, { backgroundColor: isDark ? colors.surfaceMuted : colors.capsule }]}>
              {renderModePill('支出', trendMode === 'expense', expenseColor, () => setTrendMode('expense'))}
              {renderModePill('收入', trendMode === 'income', incomeColor, () => setTrendMode('income'))}
              {renderModePill('结余', trendMode === 'balance', balanceColor, () => setTrendMode('balance'))}
            </View>
          </View>

          <View style={[styles.trendTip, { backgroundColor: colors.surfaceSubtle }]}>
            <Text style={[Typography.caption, { color: colors.textSecondary }]}>
              {trendTipText}
            </Text>
          </View>

          <View style={styles.trendChart}>
            {trendData.points.map((point, idx) => {
              const selected = selectedTrendIndex === idx;
              return (
                <Pressable
                  key={`bar-${point.dateKey}`}
                  onPress={() => setSelectedTrendIndex((prev) => (prev === idx ? null : idx))}
                  accessibilityRole="button"
                  accessibilityLabel={`${point.label} ${trendModeLabel} ${formatMoney(Math.abs(point.rawValue))}`}
                  style={({ pressed }) => [
                    styles.trendBarWrap,
                    pressed && { opacity: 0.82 },
                  ]}>
                  <View
                    style={[
                      styles.trendBar,
                      {
                        height: `${point.heightPct}%`,
                        backgroundColor: selected ? trendAccent : point.heightPct > 10 ? trendAccent : colors.primaryMuted,
                        opacity: selected ? 1 : selectedTrendIndex != null ? 0.45 : 1,
                      },
                    ]}
                  />
                </Pressable>
              );
            })}
          </View>
          <View style={styles.trendAxis}>
            {trendData.axis.map((label) => (
              <Text key={label} style={[styles.trendAxisText, { color: colors.textSecondary }]}>
                {label}
              </Text>
            ))}
          </View>
        </AppCard>

        <AppCard style={[shadows.card, styles.cardGap]}>
          <Text style={[Typography.title, { color: colors.text }]}>账单汇总</Text>
          <View style={[styles.tableWrap, { backgroundColor: colors.surfaceSubtle }]}>
            <View style={styles.tableHeader}>
              <Text style={[styles.tableHeadText, { color: colors.textSecondary }]}>日期</Text>
              <Text style={[styles.tableHeadText, { color: colors.textSecondary }]}>支出</Text>
              <Text style={[styles.tableHeadText, { color: colors.textSecondary }]}>收入</Text>
              <Text style={[styles.tableHeadText, { color: colors.textSecondary }]}>结余</Text>
            </View>
            {dailyRows.map((row) => (
              <View key={row.date} style={[styles.tableRow, { borderBottomColor: colors.outline }]}>
                <Text style={[styles.tableCell, { color: colors.text }]}>{row.date}</Text>
                <Text style={[styles.tableCell, { color: expenseColor }]}>{formatMoney(row.expense)}</Text>
                <Text style={[styles.tableCell, { color: incomeColor }]}>{formatMoney(row.income)}</Text>
                <Text style={[styles.tableCell, { color: balanceColor }]}>
                  {row.balance < 0 ? '-' : ''}
                  {formatMoney(Math.abs(row.balance))}
                </Text>
              </View>
            ))}
          </View>
        </AppCard>

        <AppCard style={[shadows.card, styles.cardGap]}>
          <View style={styles.sectionHeader}>
            <Text style={[Typography.title, { color: colors.text }]}>
              {rankMode === 'income' ? '单笔收入排行' : '单笔支出排行'}
            </Text>
            <View style={[styles.pillTabs, { backgroundColor: isDark ? colors.surfaceMuted : colors.capsule }]}>
              {renderModePill('支出', rankMode === 'expense', expenseColor, () => setRankMode('expense'))}
              {renderModePill('收入', rankMode === 'income', incomeColor, () => setRankMode('income'))}
            </View>
          </View>
          {topRankItems.map((item) => {
            const rankAccent = rankMode === 'income' ? incomeColor : expenseColor;
            return (
              <View key={item.id} style={[styles.rankRow, { backgroundColor: colors.surfaceSubtle }]}>
                <Text style={[styles.rankNum, { color: rankAccent }]}>{item.rank}</Text>
                <View style={[styles.rankIcon, { backgroundColor: `${rankAccent}22` }]}>
                  <MaterialIcons name={item.icon} size={18} color={rankAccent} />
                </View>
                <View style={styles.rankMain}>
                  <Text style={[Typography.bodyStrong, styles.rankTitle, { color: colors.text }]}>{item.name}</Text>
                  {item.desc ? (
                    <Text style={[Typography.caption, { color: colors.textSecondary }]}>{item.desc}</Text>
                  ) : null}
                </View>
                <Text style={[Typography.bodyStrong, { color: colors.text }]}>{formatMoney(item.amount)}</Text>
              </View>
            );
          })}
        </AppCard>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: {
    maxWidth: Layout.contentMaxWidth,
    alignSelf: 'center',
    width: '100%',
    paddingHorizontal: Spacing['5xl'],
    paddingTop: Spacing['3xl'],
    gap: Spacing['4xl'],
  },
  cardGap: {
    gap: Spacing.xl,
  },
  tabWrap: {
    borderRadius: Radius.pill,
    padding: Spacing.xs,
    flexDirection: 'row',
  },
  tabBtn: {
    flex: 1,
    borderRadius: Radius.pill,
    paddingVertical: Spacing.md,
    alignItems: 'center',
  },
  tabBtnActive: {},
  monthSwitcher: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.sm,
  },
  monthText: {
    textAlign: 'center',
    flex: 1,
  },
  customDateWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.lg,
  },
  datePickerBtn: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.lg,
    gap: Spacing.xs,
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'center',
    padding: Spacing['5xl'],
  },
  modalCard: {
    borderRadius: Radius.sheet,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing['4xl'],
    gap: Spacing['3xl'],
  },
  modalHeader: {
    gap: Spacing.sm,
  },
  modalSubtitle: {
    lineHeight: 18,
  },
  modalPreview: {
    borderRadius: Radius.xl,
    padding: Spacing.xl,
    gap: Spacing.xs,
  },
  pickerColumns: {
    flexDirection: 'row',
    gap: Spacing.lg,
  },
  pickerColumnCard: {
    flex: 1,
    borderRadius: Radius['2xl'],
    paddingVertical: Spacing.xl,
    alignItems: 'center',
    gap: Spacing.md,
  },
  pickerAdjustBtn: {
    width: Layout.iconButtonSize,
    height: Layout.iconButtonSize,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickerColumnValue: {
    fontSize: 22,
  },
  modalActions: {
    flexDirection: 'row',
    gap: Spacing.lg,
  },
  modalActionBtn: {
    flex: 1,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
  },
  summaryCol: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.xs,
  },
  summaryLabel: {
    textAlign: 'center',
    width: '100%',
  },
  summaryAmount: {
    ...Typography.h2,
    textAlign: 'center',
    width: '100%',
  },
  analysisCard: {
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.xl,
    gap: Spacing.md,
  },
  analysisHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  analysisBody: {
    lineHeight: 18,
  },
  analysisLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.lg,
  },
  analysisActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
    marginTop: Spacing.xs,
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing.xl,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: Spacing.md,
  },
  pillTabs: {
    borderRadius: Radius.pill,
    padding: Spacing.xs,
    flexDirection: 'row',
    gap: Spacing.xs,
    alignItems: 'center',
  },
  pillTabActive: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '800',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.pill,
    overflow: 'hidden',
  },
  pillTab: {
    fontSize: 11,
    fontWeight: '800',
    paddingHorizontal: Spacing.lg,
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
  categoryRow: {
    flexDirection: 'row',
    gap: Spacing.lg,
    alignItems: 'center',
  },
  categoryIcon: {
    width: 30,
    height: 30,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryMain: {
    flex: 1,
    gap: Spacing.xs,
  },
  categoryTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  categoryBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  progressTrack: {
    flex: 1,
    height: 6,
    borderRadius: Radius.pill,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: Radius.pill,
  },
  categoryMeta: {
    fontSize: 10,
    minWidth: 68,
    textAlign: 'right',
  },
  trendTip: {
    alignSelf: 'center',
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
  },
  trendChart: {
    height: 128,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 1,
    paddingHorizontal: Spacing.xs,
  },
  trendBarWrap: {
    flex: 1,
    height: '100%',
    justifyContent: 'flex-end',
  },
  trendBar: {
    width: '100%',
    borderTopLeftRadius: Radius.xs,
    borderTopRightRadius: Radius.xs,
    minHeight: 2,
  },
  trendAxis: {
    marginTop: Spacing.xs,
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
    borderRadius: Radius.lg,
    padding: Spacing.md,
  },
  tableHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: Spacing.sm,
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
    paddingVertical: Spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tableCell: {
    width: '25%',
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '600',
  },
  rankRow: {
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  rankNum: {
    width: 18,
    textAlign: 'center',
    fontWeight: '800',
  },
  rankIcon: {
    width: 34,
    height: 34,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankMain: {
    flex: 1,
    gap: Spacing.xs,
  },
  rankTitle: {
    fontSize: 12,
  },
});
