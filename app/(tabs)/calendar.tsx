import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  getFinanceAccounts,
  getFinanceDailySummariesByDateRange,
  getFinanceFlowCategories,
  getFinanceTransactionsByYmd,
} from '@/lib/repositories/finance/finance';
import type { FinanceDailySummaryRow, FinanceTransactionRow } from '@/lib/repositories/finance/finance.types';
import {
  getHealthIntakeTotalsForUserOnDate,
  getHealthRecordsForUserOnDate,
} from '@/lib/repositories/health/health';
import type { HealthIntakeDayTotals, HealthRecordRow } from '@/lib/repositories/health/health.types';
import {
  getTaskCategories,
  getTaskDueDayAggregatesForRange,
  getTasksDueOnDate,
  type TaskDueDayAggregateRow,
} from '@/lib/repositories/tasks/task';
import type { TaskRow } from '@/lib/repositories/tasks/task.types';
import { MaterialIcons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { DimensionValue } from 'react-native';
import { ActivityIndicator, Dimensions, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  FadeInDown,
  FadeInUp,
  LinearTransition,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

const HEALTH_USER_ID = 'default';

function toYmd(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatSignedYuan(net: number) {
  const abs = Math.abs(net).toFixed(2);
  if (net > 0.004) return `+¥${abs}`;
  if (net < -0.004) return `-¥${abs}`;
  return '¥0.00';
}

/** 月历格子内展示：尽量短、单行（配合 adjustsFontSizeToFit）。 */
function formatSignedYuanCompact(net: number) {
  const sign = net > 0 ? '+' : net < 0 ? '-' : '';
  const abs = Math.abs(net);
  if (abs < 0.005) return '¥0';
  if (abs >= 10_000) {
    const w = abs / 10_000;
    const s = w >= 100 ? w.toFixed(0) : w >= 10 ? w.toFixed(1).replace(/\.0$/, '') : w.toFixed(2).replace(/\.?0+$/, '');
    return `${sign}¥${s}万`;
  }
  if (abs >= 1000) return `${sign}¥${Math.round(abs)}`;
  if (abs >= 100) return `${sign}¥${Math.round(abs)}`;
  const one = abs.toFixed(1).replace(/\.0$/, '');
  return `${sign}¥${one}`;
}

function formatTxSignedAmount(t: FinanceTransactionRow): number {
  if (t.transaction_type === 'income') return Math.abs(Number(t.amount));
  if (t.transaction_type === 'expense') return -Math.abs(Number(t.amount));
  return 0;
}

function transactionIcon(t: FinanceTransactionRow): keyof typeof MaterialIcons.glyphMap {
  if (t.transaction_type === 'income') return 'trending-up';
  if (t.transaction_type === 'expense') return 'trending-down';
  return 'swap-horiz';
}

function formatTaskDueMeta(due: string | null, categoryLabel: string) {
  if (!due?.trim()) return categoryLabel;
  const iso = due.includes('T');
  const timePart = iso ? due.split('T')[1]?.slice(0, 5) : '';
  if (timePart) return `${timePart} · ${categoryLabel}`;
  return categoryLabel;
}

export default function CalendarScreen() {
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const baseTheme = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';

  const [selectedDay, setSelectedDay] = useState<number | null>(() => {
    const now = new Date();
    return now.getDate();
  });
  const [isSheetVisible, setIsSheetVisible] = useState(false);
  const [activeTab, setActiveTab] = useState<'tasks' | 'finance' | 'intake'>('tasks');
  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [monthFinanceMap, setMonthFinanceMap] = useState<Map<string, FinanceDailySummaryRow>>(() => new Map());
  const [monthTaskMap, setMonthTaskMap] = useState<Map<string, TaskDueDayAggregateRow>>(() => new Map());
  const [sheetTasks, setSheetTasks] = useState<TaskRow[]>([]);
  const [sheetTransactions, setSheetTransactions] = useState<FinanceTransactionRow[]>([]);
  const [financeAccountNames, setFinanceAccountNames] = useState<Map<string, string>>(() => new Map());
  const [flowCategoryNames, setFlowCategoryNames] = useState<Map<string, string>>(() => new Map());
  const [taskCategoryNames, setTaskCategoryNames] = useState<Map<string, string>>(() => new Map());
  const [sheetHealthTotals, setSheetHealthTotals] = useState<HealthIntakeDayTotals | null>(null);
  const [sheetHealthRecords, setSheetHealthRecords] = useState<HealthRecordRow[]>([]);
  const [monthDataLoading, setMonthDataLoading] = useState(false);
  const [sheetDataLoading, setSheetDataLoading] = useState(false);
  const sheetTranslateY = useSharedValue(SCREEN_HEIGHT);
  const backdropOpacity = useSharedValue(0);

  const monthLabel = currentMonth.toLocaleDateString('zh-CN', { month: 'long' });
  const monthShortZh = `${currentMonth.getMonth() + 1}月`;
  const currentYear = currentMonth.getFullYear();

  const changeMonth = useCallback((offset: number) => {
    setCurrentMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + offset, 1));
  }, []);

  const swipeMonthGesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(!isSheetVisible)
        .activeOffsetX([-28, 28])
        .failOffsetY([-22, 22])
        .onEnd((e) => {
          'worklet';
          const { translationX, velocityX } = e;
          const distThreshold = 64;
          const velThreshold = 520;
          if (translationX <= -distThreshold || velocityX <= -velThreshold) {
            runOnJS(changeMonth)(1);
          } else if (translationX >= distThreshold || velocityX >= velThreshold) {
            runOnJS(changeMonth)(-1);
          }
        }),
    [isSheetVisible, changeMonth],
  );

  const loadMonthAggregates = useCallback(async () => {
    setMonthDataLoading(true);
    try {
      const y = currentMonth.getFullYear();
      const mo = currentMonth.getMonth();
      const startYmd = toYmd(new Date(y, mo, 1));
      const endYmd = toYmd(new Date(y, mo + 1, 0));
      const [summaries, taskAggs, accounts, flows] = await Promise.all([
        getFinanceDailySummariesByDateRange(startYmd, endYmd),
        getTaskDueDayAggregatesForRange(startYmd, endYmd),
        getFinanceAccounts(),
        getFinanceFlowCategories(),
      ]);
      const fm = new Map<string, FinanceDailySummaryRow>();
      for (const s of summaries) {
        fm.set(s.day, s);
      }
      const tm = new Map<string, TaskDueDayAggregateRow>();
      for (const t of taskAggs) {
        tm.set(t.day, t);
      }
      setMonthFinanceMap(fm);
      setMonthTaskMap(tm);
      setFinanceAccountNames(new Map(accounts.map((a) => [a.id, a.name])));
      setFlowCategoryNames(new Map(flows.map((f) => [f.id, f.name])));
    } catch (e) {
      console.warn('calendar month load', e);
    } finally {
      setMonthDataLoading(false);
    }
  }, [currentMonth]);

  useEffect(() => {
    void loadMonthAggregates();
  }, [loadMonthAggregates]);

  React.useEffect(() => {
    void getTaskCategories().then((cats) => setTaskCategoryNames(new Map(cats.map((c) => [c.id, c.name]))));
  }, []);

  const selectedSheetYmd = useMemo(() => {
    if (selectedDay == null) return null;
    const y = currentMonth.getFullYear();
    const mo = currentMonth.getMonth();
    return `${y}-${String(mo + 1).padStart(2, '0')}-${String(selectedDay).padStart(2, '0')}`;
  }, [selectedDay, currentMonth]);

  React.useEffect(() => {
    if (!isSheetVisible || !selectedSheetYmd) return;
    let cancelled = false;
    setSheetDataLoading(true);
    (async () => {
      try {
        const [tasks, txs, intake, records] = await Promise.all([
          getTasksDueOnDate(selectedSheetYmd),
          getFinanceTransactionsByYmd(selectedSheetYmd),
          getHealthIntakeTotalsForUserOnDate(HEALTH_USER_ID, selectedSheetYmd),
          getHealthRecordsForUserOnDate(HEALTH_USER_ID, selectedSheetYmd),
        ]);
        if (!cancelled) {
          setSheetTasks(tasks);
          setSheetTransactions(txs);
          setSheetHealthTotals(intake);
          setSheetHealthRecords(records);
        }
      } catch (e) {
        console.warn('calendar sheet load', e);
      } finally {
        if (!cancelled) setSheetDataLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isSheetVisible, selectedSheetYmd]);

  React.useEffect(() => {
    if (selectedDay == null) return;
    const maxDay = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0).getDate();
    if (selectedDay > maxDay) {
      setSelectedDay(maxDay);
    }
  }, [currentMonth, selectedDay]);

  const toggleSheet = (show: boolean) => {
    if (show) {
      setIsSheetVisible(true);
      sheetTranslateY.value = withTiming(0, {
        duration: 320,
        easing: Easing.out(Easing.cubic),
      });
      backdropOpacity.value = withTiming(1, {
        duration: 260,
        easing: Easing.out(Easing.quad),
      });
      return;
    }

    sheetTranslateY.value = withTiming(
      SCREEN_HEIGHT,
      {
        duration: 280,
        easing: Easing.in(Easing.cubic),
      },
      (finished) => {
        if (finished) {
          runOnJS(setIsSheetVisible)(false);
        }
      },
    );
    backdropOpacity.value = withTiming(0, {
      duration: 220,
      easing: Easing.in(Easing.quad),
    });
  };

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: sheetTranslateY.value }],
  }));

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: backdropOpacity.value,
  }));

  const animatedMonthLabelStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - backdropOpacity.value) * 6 }],
    opacity: 0.86 + backdropOpacity.value * 0.14,
  }));

  const bg = baseTheme.background;
  const surface = baseTheme.surface;
  const text = baseTheme.text;
  const textMuted = baseTheme.textSecondary;
  const outline = isDark ? 'rgba(148,163,184,0.82)' : baseTheme.textSecondary;
  const outlineVariant = isDark ? 'rgba(148,163,184,0.14)' : 'rgba(148,163,184,0.22)';

  const primary = baseTheme.primary;
  const secondary = isDark ? '#34d399' : '#059669';
  const tertiary = isDark ? '#fbbf24' : '#d97706';
  const error = isDark ? '#f87171' : '#dc2626';

  const heat90 = isDark ? 'rgba(16,185,129,0.18)' : 'rgba(16,185,129,0.11)';
  const heat70 = isDark ? 'rgba(16,185,129,0.10)' : 'rgba(16,185,129,0.07)';
  const heat40 = isDark ? 'rgba(16,185,129,0.05)' : 'rgba(16,185,129,0.04)';

  const weekDays = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

  type Cell =
    | { kind: 'empty' }
    | {
        kind: 'day';
        day: number;
        heat?: '90' | '70' | '40';
        bars?: { color: string; widthPct: number }[];
        amount?: { text: string; color: string; weight?: 'bold' | 'black' };
      };

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstWeekdayMondayBased = (new Date(year, month, 1).getDay() + 6) % 7;

  const cells: Cell[] = [];
  for (let i = 0; i < firstWeekdayMondayBased; i++) {
    cells.push({ kind: 'empty' });
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const ymd = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const fin = monthFinanceMap.get(ymd);
    const ta = monthTaskMap.get(ymd);
    const net = fin?.net ?? 0;
    const taskTotal = ta?.total ?? 0;
    const taskDone = ta?.done ?? 0;
    const ratio = taskTotal > 0 ? taskDone / taskTotal : 0;

    let heat: '90' | '70' | '40' | undefined;
    const bars: { color: string; widthPct: number }[] = [];
    let amount: { text: string; color: string; weight?: 'bold' | 'black' } | undefined;

    if (taskTotal > 0) {
      heat = ratio >= 0.9 ? '90' : ratio >= 0.45 ? '70' : '40';
      bars.push({ color: primary, widthPct: Math.max(8, Math.round(ratio * 100)) });
      if (Math.abs(net) >= 0.01) {
        const w = Math.min(100, Math.round((Math.abs(net) / Math.max(Math.abs(net), 800)) * 100));
        bars.push({ color: `${secondary}80`, widthPct: Math.max(12, w) });
      }
    } else if (Math.abs(net) >= 0.01) {
      heat = net > 0 ? '70' : '70';
      bars.push({ color: net > 0 ? `${tertiary}99` : `${error}99`, widthPct: 55 });
    }

    if (Math.abs(net) >= 0.01) {
      amount = {
        text: formatSignedYuanCompact(net),
        color: net >= 0 ? tertiary : error,
        weight: 'bold',
      };
    }

    cells.push({ kind: 'day', day: d, heat, bars: bars.length ? bars : undefined, amount });
  }

  while (cells.length % 7 !== 0) cells.push({ kind: 'empty' });

  const weeks: Cell[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  const selectedDate =
    selectedDay == null ? null : new Date(currentMonth.getFullYear(), currentMonth.getMonth(), selectedDay);

  const selectedWeekdayZh = selectedDate
    ? selectedDate.toLocaleDateString('zh-CN', { weekday: 'long' })
    : '';

  const selectedDayFin = selectedSheetYmd ? monthFinanceMap.get(selectedSheetYmd) : undefined;
  const sheetNet = selectedDayFin?.net ?? 0;
  const sheetIncomeTotal =
    selectedDayFin?.income ??
    sheetTransactions.filter((t) => t.transaction_type === 'income').reduce((s, t) => s + Math.abs(Number(t.amount)), 0);
  const sheetExpenseTotal =
    selectedDayFin?.expense ??
    sheetTransactions.filter((t) => t.transaction_type === 'expense').reduce((s, t) => s + Math.abs(Number(t.amount)), 0);

  const intakeEstKcal =
    sheetHealthTotals != null
      ? Math.round((Number(sheetHealthTotals.protein) + Number(sheetHealthTotals.carbohydrate)) * 4)
      : null;

  const cellBg = (cell: Cell) => {
    if (cell.kind === 'empty') return isDark ? 'rgba(148,163,184,0.06)' : 'rgba(241,245,249,0.92)';
    if (cell.kind === 'day' && cell.day === selectedDay) return surface;
    if (cell.kind === 'day' && cell.heat === '90') return heat90;
    if (cell.kind === 'day' && cell.heat === '70') return heat70;
    if (cell.kind === 'day' && cell.heat === '40') return heat40;
    return surface;
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: bg }]} edges={['top', 'left', 'right']}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: Math.max(insets.top, 12), paddingBottom: 28 + Math.max(insets.bottom, 12) },
        ]}
        showsVerticalScrollIndicator={false}>
        <Animated.View entering={FadeInUp.duration(420)} style={styles.header}>
          <View style={styles.headerLeft}>
            <Animated.View
              style={[
                styles.yearChip,
                { backgroundColor: isDark ? 'rgba(16,185,129,0.14)' : 'rgba(16,185,129,0.10)' },
                animatedMonthLabelStyle,
              ]}>
              <Text style={[styles.yearChipText, { color: primary }]}>{currentYear}</Text>
            </Animated.View>
            <Text style={[styles.monthTitle, { color: text }]}>
              {monthLabel}
              <Text style={[styles.monthSub, { color: textMuted }]}> · {monthShortZh}</Text>
            </Text>
          </View>
            <Animated.View entering={FadeInDown.duration(420).delay(80)} style={styles.headerBtns}>
            {monthDataLoading ? (
              <View style={{ justifyContent: 'center', paddingRight: 8 }}>
                <ActivityIndicator size="small" color={primary} />
              </View>
            ) : null}
            <Pressable
              onPress={() => changeMonth(-1)}
              style={({ pressed }) => [
                styles.circleBtn,
                { backgroundColor: surface, borderColor: outlineVariant, opacity: pressed ? 0.85 : 1 },
              ]}>
              <MaterialIcons name="chevron-left" size={22} color={text} />
            </Pressable>
            <Pressable
              onPress={() => changeMonth(1)}
              style={({ pressed }) => [
                styles.circleBtn,
                { backgroundColor: surface, borderColor: outlineVariant, opacity: pressed ? 0.85 : 1 },
              ]}>
              <MaterialIcons name="chevron-right" size={22} color={text} />
            </Pressable>
          </Animated.View>
        </Animated.View>

        <GestureDetector gesture={swipeMonthGesture}>
          <Animated.View
            entering={FadeInUp.duration(480).delay(120)}
            layout={LinearTransition.springify().damping(16)}
            style={[
              styles.card,
              {
                backgroundColor: surface,
                borderColor: outlineVariant,
                shadowColor: isDark ? '#020617' : '#0f172a',
              },
            ]}>
          <View
            style={[
              styles.weekHeader,
              {
                borderBottomColor: outlineVariant,
                backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(248,250,252,0.96)',
              },
            ]}>
            {weekDays.map((d) => (
              <View key={d} style={styles.weekHeaderCell}>
                <Text style={[styles.weekHeaderText, { color: textMuted }]}>{d}</Text>
              </View>
            ))}
          </View>

          <View style={styles.calendarGrid}>
            {weeks.map((row, rowIndex) => (
              <View key={rowIndex} style={[styles.weekRow, rowIndex === weeks.length - 1 && styles.weekRowLast]}>
                {row.map((cell, colIndex) => {
                  const bgColor = cellBg(cell);
                  const isSelected = cell.kind === 'day' && cell.day === selectedDay;

                  const cellAnimDelay = 30 + rowIndex * 55 + colIndex * 18;

                  if (cell.kind === 'empty') {
                    return (
                      <Animated.View
                        key={colIndex}
                        entering={FadeInDown.duration(320).delay(cellAnimDelay)}
                        layout={LinearTransition.springify().damping(18)}
                        style={styles.dayCellWrapper}>
                        <View style={[styles.dayCell, styles.dayCellInner, { backgroundColor: bgColor }]} />
                      </Animated.View>
                    );
                  }

                  const dayColor = isSelected ? primary : text;
                  const dayOpacity = isSelected ? 1 : 0.72;

                  return (
                    <Animated.View
                      key={colIndex}
                      entering={FadeInDown.duration(360).delay(cellAnimDelay)}
                      layout={LinearTransition.springify().damping(18)}
                      style={styles.dayCellWrapper}>
                      <Pressable
                        onPress={() => {
                          setSelectedDay(cell.day);
                          toggleSheet(true);
                        }}
                        style={({ pressed }) => [
                          styles.dayCell,
                          styles.dayCellInner,
                          {
                            transform: [{ scale: pressed ? 0.97 : 1 }],
                            backgroundColor: pressed ? (isDark ? 'rgba(255,255,255,0.06)' : 'rgba(15,23,42,0.04)') : bgColor,
                            borderWidth: isSelected ? 2 : StyleSheet.hairlineWidth,
                            borderColor: isSelected ? `${primary}55` : (isDark ? 'rgba(148,163,184,0.12)' : 'rgba(226,232,240,0.95)'),
                            shadowColor: isSelected ? primary : 'transparent',
                            shadowOffset: { width: 0, height: 4 },
                            shadowOpacity: isSelected ? (isDark ? 0.35 : 0.18) : 0,
                            shadowRadius: isSelected ? 10 : 0,
                            elevation: isSelected ? 3 : 0,
                          },
                        ]}>
                        <Text style={[styles.dayNumber, { color: dayColor, opacity: dayOpacity }]}>
                          {String(cell.day).padStart(2, '0')}
                        </Text>

                        <View style={styles.dayBottom}>
                          {cell.bars?.length ? (
                            <View style={styles.bars}>
                              {cell.bars.map((b, i) => (
                                <View
                                  key={i}
                                  style={[
                                    styles.bar,
                                    { backgroundColor: b.color, width: `${b.widthPct}%` },
                                  ]}
                                />
                              ))}
                            </View>
                          ) : (
                            <View style={styles.bars} />
                          )}

                          {cell.amount ? (
                            <Text
                              numberOfLines={1}
                              adjustsFontSizeToFit
                              minimumFontScale={0.55}
                              ellipsizeMode="clip"
                              style={[
                                styles.amountText,
                                {
                                  color: cell.amount.color,
                                  fontWeight:
                                    cell.amount.weight === 'black'
                                      ? '900'
                                      : cell.amount.weight === 'bold'
                                        ? '800'
                                        : '600',
                                },
                              ]}>
                              {cell.amount.text}
                            </Text>
                          ) : (
                            <View style={styles.amountPlaceholder} />
                          )}
                        </View>
                      </Pressable>
                    </Animated.View>
                  );
                })}
              </View>
            ))}
          </View>
          </Animated.View>
        </GestureDetector>

        <Animated.View
          entering={FadeInUp.duration(520).delay(180)}
          style={[styles.legendCard, { backgroundColor: surface, borderColor: outlineVariant }]}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.legendScroll}>
            <View style={[styles.legendChip, { borderColor: outlineVariant }]}>
              <View style={[styles.legendDot, { backgroundColor: `${secondary}99` }]} />
              <Text style={[styles.legendText, { color: textMuted }]}>完成度热力</Text>
            </View>
            <View style={[styles.legendChip, { borderColor: outlineVariant }]}>
              <View style={[styles.legendDot, { backgroundColor: primary }]} />
              <Text style={[styles.legendText, { color: textMuted }]}>任务进度</Text>
            </View>
            <View style={[styles.legendChip, { borderColor: outlineVariant }]}>
              <View style={[styles.legendDot, { backgroundColor: tertiary }]} />
              <Text style={[styles.legendText, { color: textMuted }]}>当日结余</Text>
            </View>
            <View style={[styles.legendChip, { borderColor: outlineVariant }]}>
              <View style={[styles.legendDot, { backgroundColor: error }]} />
              <Text style={[styles.legendText, { color: textMuted }]}>支出赤字</Text>
            </View>
          </ScrollView>
        </Animated.View>
      </ScrollView>

      {/* Backdrop */}
      <Animated.View
        style={[styles.backdrop, backdropStyle]}
        pointerEvents={isSheetVisible ? 'auto' : 'none'}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={() => toggleSheet(false)} />
      </Animated.View>

      {/* Bottom Sheet */}
      <Animated.View
        style={[
          styles.bottomSheet,
          { backgroundColor: surface, borderColor: outlineVariant },
          sheetStyle,
        ]}>
        {/* Sheet Handle */}
        <Animated.View entering={FadeInDown.duration(260)} style={styles.sheetHandle}>
          <View style={[styles.sheetHandleLine, { backgroundColor: `${outlineVariant}80` }]} />
        </Animated.View>

        {/* Date Header */}
        <Animated.View entering={FadeInUp.duration(300).delay(40)} style={styles.sheetHeader}>
          <View style={styles.sheetHeaderLeft}>
            <Text style={[styles.sheetTitle, { color: text }]}>
              {selectedDate ? `${selectedDate.getMonth() + 1}月${selectedDate.getDate()}日，${selectedWeekdayZh}` : '请选择日期'}
            </Text>
            {activeTab === 'finance' && (
              <Text style={[styles.sheetSubtitle, { color: outline }]}>财务账本 · 当日明细</Text>
            )}
          </View>
          {activeTab === 'finance' && selectedDate && (
            <View style={styles.sheetHeaderRight}>
              <Text style={[styles.sheetAmountLabel, { color: outline }]}>当日净额</Text>
              <Text style={[styles.sheetAmountValue, { color: sheetNet >= 0 ? secondary : error }]}>
                {formatSignedYuan(sheetNet)}
              </Text>
            </View>
          )}
        </Animated.View>

        {/* Tabs */}
        <View style={styles.sheetTabsOuter}>
          <View
            style={[
              styles.sheetTabsTrack,
              {
                backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(15,23,42,0.05)',
                borderColor: outlineVariant,
              },
            ]}>
            <Pressable
              onPress={() => setActiveTab('tasks')}
              style={({ pressed }) => [
                styles.sheetTabPill,
                activeTab === 'tasks' && [
                  styles.sheetTabPillActive,
                  {
                    backgroundColor: surface,
                    borderColor: `${primary}40`,
                    shadowColor: isDark ? '#000' : primary,
                    opacity: pressed ? 0.92 : 1,
                  },
                ],
              ]}>
              <Text
                style={[
                  styles.sheetTabText,
                  { color: activeTab === 'tasks' ? text : textMuted, fontWeight: activeTab === 'tasks' ? '800' : '600' },
                ]}>
                任务列表
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setActiveTab('finance')}
              style={({ pressed }) => [
                styles.sheetTabPill,
                activeTab === 'finance' && [
                  styles.sheetTabPillActive,
                  {
                    backgroundColor: surface,
                    borderColor: `${primary}40`,
                    shadowColor: isDark ? '#000' : primary,
                    opacity: pressed ? 0.92 : 1,
                  },
                ],
              ]}>
              <Text
                style={[
                  styles.sheetTabText,
                  { color: activeTab === 'finance' ? text : textMuted, fontWeight: activeTab === 'finance' ? '800' : '600' },
                ]}>
                账单明细
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setActiveTab('intake')}
              style={({ pressed }) => [
                styles.sheetTabPill,
                activeTab === 'intake' && [
                  styles.sheetTabPillActive,
                  {
                    backgroundColor: surface,
                    borderColor: `${primary}40`,
                    shadowColor: isDark ? '#000' : primary,
                    opacity: pressed ? 0.92 : 1,
                  },
                ],
              ]}>
              <Text
                style={[
                  styles.sheetTabText,
                  { color: activeTab === 'intake' ? text : textMuted, fontWeight: activeTab === 'intake' ? '800' : '600' },
                ]}>
                摄入日志
              </Text>
            </Pressable>
          </View>
        </View>

        {/* Tab Content */}
        <ScrollView style={styles.sheetContent} showsVerticalScrollIndicator={false}>
          {activeTab === 'tasks' && (
            <View style={styles.taskList}>
              {sheetDataLoading ? (
                <ActivityIndicator style={{ marginTop: 24 }} color={primary} />
              ) : sheetTasks.length === 0 ? (
                <Text style={[styles.emptyHint, { color: outline }]}>当日暂无截止任务</Text>
              ) : (
                sheetTasks.map((task) => {
                  const done = task.status === 'done' || task.status === 'cancelled';
                  const cat = task.category_id ? (taskCategoryNames.get(task.category_id) ?? '分类') : '未分类';
                  return (
                    <View
                      key={task.id}
                      style={[
                        styles.taskItem,
                        {
                          backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(248,250,252,0.96)',
                          borderLeftColor: done ? primary : `${outlineVariant}80`,
                          opacity: done ? 1 : 0.92,
                        },
                      ]}>
                      <MaterialIcons
                        name={done ? 'check-circle' : 'radio-button-unchecked'}
                        size={24}
                        color={done ? primary : outline}
                      />
                      <View style={styles.taskInfo}>
                        <Text style={[styles.taskTitle, { color: text }]}>{task.title}</Text>
                        <Text style={[styles.taskMeta, { color: outline }]}>
                          {formatTaskDueMeta(task.due_date, cat)}
                        </Text>
                      </View>
                      {task.priority >= 3 && !done ? (
                        <View style={[styles.taskTag, { backgroundColor: `${primary}1A` }]}>
                          <Text style={[styles.taskTagText, { color: primary }]}>重要</Text>
                        </View>
                      ) : null}
                    </View>
                  );
                })
              )}
            </View>
          )}

          {activeTab === 'finance' && (
            <View style={styles.financeList}>
              <View style={styles.financeSummary}>
                <View
                  style={[
                    styles.financeSummaryCard,
                    {
                      backgroundColor: isDark ? 'rgba(52,211,153,0.05)' : 'rgba(0,108,73,0.05)',
                      borderColor: isDark ? 'rgba(52,211,153,0.1)' : 'rgba(0,108,73,0.1)',
                    },
                  ]}>
                  <Text style={[styles.financeSummaryLabel, { color: secondary }]}>总收入</Text>
                  <Text style={[styles.financeSummaryValue, { color: secondary }]}>
                    ¥{sheetIncomeTotal.toFixed(2)}
                  </Text>
                </View>
                <View
                  style={[
                    styles.financeSummaryCard,
                    {
                      backgroundColor: isDark ? 'rgba(248,113,113,0.05)' : 'rgba(186,26,26,0.05)',
                      borderColor: isDark ? 'rgba(248,113,113,0.1)' : 'rgba(186,26,26,0.1)',
                    },
                  ]}>
                  <Text style={[styles.financeSummaryLabel, { color: error }]}>总支出</Text>
                  <Text style={[styles.financeSummaryValue, { color: error }]}>
                    ¥{sheetExpenseTotal.toFixed(2)}
                  </Text>
                </View>
              </View>

              <View style={styles.transactionList}>
                <Text style={[styles.transactionHeader, { color: outline }]}>收支流水</Text>

                {sheetDataLoading ? (
                  <ActivityIndicator style={{ marginTop: 16 }} color={primary} />
                ) : sheetTransactions.length === 0 ? (
                  <Text style={[styles.emptyHint, { color: outline }]}>当日暂无账单记录</Text>
                ) : (
                  sheetTransactions.map((item) => {
                    const signed = formatTxSignedAmount(item);
                    const iconName = transactionIcon(item);
                    const iconColor =
                      item.transaction_type === 'income'
                        ? secondary
                        : item.transaction_type === 'expense'
                          ? error
                          : outline;
                    const acct = financeAccountNames.get(item.account_id) ?? '账户';
                    const happened = item.happened_at ?? '';
                    const timeShort = happened.includes('T') ? happened.split('T')[1]?.slice(0, 5) ?? '' : happened.slice(11, 16);
                    const flowLabel = item.flow_category_id
                      ? (flowCategoryNames.get(item.flow_category_id) ?? '分类')
                      : item.transaction_type === 'transfer'
                        ? '转账'
                        : '未分类';
                    const amountStr =
                      signed >= 0 ? `+¥${Math.abs(signed).toFixed(2)}` : `-¥${Math.abs(signed).toFixed(2)}`;
                    return (
                      <View
                        key={item.id}
                        style={[
                          styles.transactionItem,
                          {
                            backgroundColor: surface,
                            borderColor: outlineVariant,
                          },
                        ]}>
                        <View
                          style={[
                            styles.transactionIcon,
                            { backgroundColor: `${iconColor}1A` },
                          ]}>
                          <MaterialIcons name={iconName} size={20} color={iconColor} />
                        </View>
                        <View style={styles.transactionInfo}>
                          <Text style={[styles.transactionTitle, { color: text }]}>{item.name || '记账'}</Text>
                          <Text style={[styles.transactionMeta, { color: outline }]}>
                            {timeShort || '—'} · {acct}
                          </Text>
                        </View>
                        <View style={styles.transactionRight}>
                          <Text
                            style={[
                              styles.transactionAmount,
                              { color: signed >= 0 ? secondary : text },
                            ]}>
                            {amountStr}
                          </Text>
                          <Text style={[styles.transactionType, { color: outline }]}>{flowLabel}</Text>
                        </View>
                      </View>
                    );
                  })
                )}
              </View>
            </View>
          )}

          {activeTab === 'intake' && (
            <View style={styles.intakeList}>
              <View style={styles.intakeSummary}>
                <View style={styles.intakeSummaryRow}>
                  <View style={[styles.intakeSummaryCard, { backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(242,243,255,0.5)' }]}>
                    <Text style={[styles.intakeSummaryLabel, { color: outline }]}>估算热量</Text>
                    <Text style={[styles.intakeSummaryValue, { color: text }]}>
                      {intakeEstKcal != null ? (
                        <>
                          {new Intl.NumberFormat('zh-CN').format(intakeEstKcal)}{' '}
                          <Text style={styles.intakeSummaryUnit}>千卡</Text>
                        </>
                      ) : (
                        <Text style={[styles.intakeSummaryUnit, { color: outline }]}>—</Text>
                      )}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.intakeSummaryCard,
                      {
                        backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(242,243,255,0.5)',
                        borderLeftWidth: StyleSheet.hairlineWidth,
                        borderColor: outlineVariant,
                      },
                    ]}>
                    <Text style={[styles.intakeSummaryLabel, { color: outline }]}>饮水量</Text>
                    <Text style={[styles.intakeSummaryValue, { color: secondary }]}>
                      {sheetHealthTotals != null ? (
                        <>
                          {new Intl.NumberFormat('zh-CN').format(Math.round(sheetHealthTotals.hydration))}{' '}
                          <Text style={styles.intakeSummaryUnit}>毫升</Text>
                        </>
                      ) : (
                        <Text style={[styles.intakeSummaryUnit, { color: outline }]}>—</Text>
                      )}
                    </Text>
                  </View>
                </View>
                <View style={[styles.intakeSummaryRow, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: outlineVariant }]}>
                  <View style={[styles.intakeSummaryCard, { backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(242,243,255,0.5)' }]}>
                    <Text style={[styles.intakeSummaryLabel, { color: outline }]}>蛋白质</Text>
                    <Text style={[styles.intakeSummaryValue, { color: text }]}>
                      {sheetHealthTotals != null ? (
                        <>
                          {new Intl.NumberFormat('zh-CN').format(Math.round(sheetHealthTotals.protein * 10) / 10)}{' '}
                          <Text style={styles.intakeSummaryUnit}>克</Text>
                        </>
                      ) : (
                        <Text style={[styles.intakeSummaryUnit, { color: outline }]}>—</Text>
                      )}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.intakeSummaryCard,
                      {
                        backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(242,243,255,0.5)',
                        borderLeftWidth: StyleSheet.hairlineWidth,
                        borderColor: outlineVariant,
                      },
                    ]}>
                    <Text style={[styles.intakeSummaryLabel, { color: outline }]}>碳水化合物</Text>
                    <Text style={[styles.intakeSummaryValue, { color: text }]}>
                      {sheetHealthTotals != null ? (
                        <>
                          {new Intl.NumberFormat('zh-CN').format(Math.round(sheetHealthTotals.carbohydrate * 10) / 10)}{' '}
                          <Text style={styles.intakeSummaryUnit}>克</Text>
                        </>
                      ) : (
                        <Text style={[styles.intakeSummaryUnit, { color: outline }]}>—</Text>
                      )}
                    </Text>
                  </View>
                </View>
              </View>

              {sheetDataLoading ? (
                <ActivityIndicator style={{ marginTop: 16 }} color={primary} />
              ) : sheetHealthRecords.length === 0 && sheetHealthTotals == null ? (
                <Text style={[styles.emptyHint, { color: outline }]}>当日暂无健康摄入记录</Text>
              ) : (
                <View style={styles.mealList}>
                  {(() => {
                    const tgtH =
                      sheetHealthRecords.find((r) => r.target_hydration > 0)?.target_hydration ?? 2500;
                    const tgtP = sheetHealthRecords.find((r) => r.target_protein > 0)?.target_protein ?? 100;
                    const tgtC =
                      sheetHealthRecords.find((r) => r.target_carbohydrate > 0)?.target_carbohydrate ?? 250;
                    const tgtS = sheetHealthRecords.find((r) => r.target_sodium > 0)?.target_sodium ?? 2000;
                    const h = sheetHealthTotals?.hydration ?? 0;
                    const p = sheetHealthTotals?.protein ?? 0;
                    const c = sheetHealthTotals?.carbohydrate ?? 0;
                    const s = sheetHealthTotals?.sodium ?? 0;
                    const hPct: DimensionValue =
                      tgtH > 0 ? `${Math.min(100, Math.round((h / tgtH) * 100))}%` : '0%';
                    const pPct: DimensionValue =
                      tgtP > 0 ? `${Math.min(100, Math.round((p / tgtP) * 100))}%` : '0%';
                    const cPct: DimensionValue =
                      tgtC > 0 ? `${Math.min(100, Math.round((c / tgtC) * 100))}%` : '0%';
                    const sPct: DimensionValue =
                      tgtS > 0 ? `${Math.min(100, Math.round((s / tgtS) * 100))}%` : '0%';
                    return (
                      <>
                        <View style={styles.mealGroup}>
                          <View style={styles.mealHeader}>
                            <View style={styles.mealHeaderLeft}>
                              <View style={[styles.mealDot, { backgroundColor: primary }]} />
                              <Text style={[styles.mealTitle, { color: outline }]}>水分（汇总）</Text>
                            </View>
                            <Text style={[styles.mealTime, { color: outlineVariant }]}>全天</Text>
                          </View>
                          <View style={[styles.hydrationCard, { backgroundColor: `${primary}0D`, borderColor: `${primary}1A` }]}>
                            <View style={[styles.mealIcon, { backgroundColor: `${primary}1A` }]}>
                              <MaterialIcons name="water-drop" size={20} color={primary} />
                            </View>
                            <View style={styles.hydrationInfo}>
                              <Text style={[styles.mealItemTitle, { color: text }]}>饮水与目标</Text>
                              <View style={styles.hydrationProgressRow}>
                                <View style={[styles.hydrationProgressBar, { backgroundColor: `${primary}1A` }]}>
                                  <View style={[styles.hydrationProgressFill, { backgroundColor: primary, width: hPct }]} />
                                </View>
                                <Text style={[styles.hydrationText, { color: primary }]}>
                                  {(h / 1000).toFixed(1)} / {(tgtH / 1000).toFixed(1)} 升
                                </Text>
                              </View>
                            </View>
                          </View>
                        </View>

                        <View style={styles.mealGroup}>
                          <View style={styles.mealHeader}>
                            <View style={styles.mealHeaderLeft}>
                              <View style={[styles.mealDot, { backgroundColor: tertiary }]} />
                              <Text style={[styles.mealTitle, { color: outline }]}>蛋白质（汇总）</Text>
                            </View>
                            <Text style={[styles.mealTime, { color: outlineVariant }]}>全天</Text>
                          </View>
                          <View style={[styles.hydrationCard, { backgroundColor: `${tertiary}0D`, borderColor: `${tertiary}1A` }]}>
                            <View style={[styles.mealIcon, { backgroundColor: `${tertiary}1A` }]}>
                              <MaterialIcons name="fitness-center" size={20} color={tertiary} />
                            </View>
                            <View style={styles.hydrationInfo}>
                              <Text style={[styles.mealItemTitle, { color: text }]}>摄入与目标</Text>
                              <View style={styles.hydrationProgressRow}>
                                <View style={[styles.hydrationProgressBar, { backgroundColor: `${tertiary}1A` }]}>
                                  <View style={[styles.hydrationProgressFill, { backgroundColor: tertiary, width: pPct }]} />
                                </View>
                                <Text style={[styles.hydrationText, { color: tertiary }]}>
                                  {new Intl.NumberFormat('zh-CN').format(Math.round(p * 10) / 10)} /{' '}
                                  {new Intl.NumberFormat('zh-CN').format(tgtP)} 克
                                </Text>
                              </View>
                            </View>
                          </View>
                        </View>

                        <View style={styles.mealGroup}>
                          <View style={styles.mealHeader}>
                            <View style={styles.mealHeaderLeft}>
                              <View style={[styles.mealDot, { backgroundColor: secondary }]} />
                              <Text style={[styles.mealTitle, { color: outline }]}>碳水化合物（汇总）</Text>
                            </View>
                            <Text style={[styles.mealTime, { color: outlineVariant }]}>全天</Text>
                          </View>
                          <View style={[styles.hydrationCard, { backgroundColor: `${secondary}14`, borderColor: `${secondary}33` }]}>
                            <View style={[styles.mealIcon, { backgroundColor: `${secondary}26` }]}>
                              <MaterialIcons name="bakery-dining" size={20} color={secondary} />
                            </View>
                            <View style={styles.hydrationInfo}>
                              <Text style={[styles.mealItemTitle, { color: text }]}>摄入与目标</Text>
                              <View style={styles.hydrationProgressRow}>
                                <View style={[styles.hydrationProgressBar, { backgroundColor: `${secondary}26` }]}>
                                  <View style={[styles.hydrationProgressFill, { backgroundColor: secondary, width: cPct }]} />
                                </View>
                                <Text style={[styles.hydrationText, { color: secondary }]}>
                                  {new Intl.NumberFormat('zh-CN').format(Math.round(c * 10) / 10)} /{' '}
                                  {new Intl.NumberFormat('zh-CN').format(tgtC)} 克
                                </Text>
                              </View>
                            </View>
                          </View>
                        </View>

                        <View style={styles.mealGroup}>
                          <View style={styles.mealHeader}>
                            <View style={styles.mealHeaderLeft}>
                              <View style={[styles.mealDot, { backgroundColor: error }]} />
                              <Text style={[styles.mealTitle, { color: outline }]}>钠（汇总）</Text>
                            </View>
                            <Text style={[styles.mealTime, { color: outlineVariant }]}>全天</Text>
                          </View>
                          <View style={[styles.hydrationCard, { backgroundColor: `${error}0D`, borderColor: `${error}1A` }]}>
                            <View style={[styles.mealIcon, { backgroundColor: `${error}1A` }]}>
                              <MaterialIcons name="warning-amber" size={20} color={error} />
                            </View>
                            <View style={styles.hydrationInfo}>
                              <Text style={[styles.mealItemTitle, { color: text }]}>摄入与目标</Text>
                              <View style={styles.hydrationProgressRow}>
                                <View style={[styles.hydrationProgressBar, { backgroundColor: `${error}1A` }]}>
                                  <View style={[styles.hydrationProgressFill, { backgroundColor: error, width: sPct }]} />
                                </View>
                                <Text style={[styles.hydrationText, { color: error }]}>
                                  {new Intl.NumberFormat('zh-CN').format(Math.round(s))} /{' '}
                                  {new Intl.NumberFormat('zh-CN').format(tgtS)} 毫克
                                </Text>
                              </View>
                            </View>
                          </View>
                        </View>

                        {sheetHealthRecords.map((rec) => {
                          const t = rec.created_at?.includes('T')
                            ? rec.created_at.split('T')[1]?.slice(0, 5)
                            : '';
                          return (
                            <View key={rec.id} style={styles.mealGroup}>
                              <View style={styles.mealHeader}>
                                <View style={styles.mealHeaderLeft}>
                                  <View style={[styles.mealDot, { backgroundColor: secondary }]} />
                                  <Text style={[styles.mealTitle, { color: outline }]}>
                                    {rec.quick_add_key?.trim() ? rec.quick_add_key : '健康记录'}
                                  </Text>
                                </View>
                                <Text style={[styles.mealTime, { color: outlineVariant }]}>{t || '—'}</Text>
                              </View>
                              <View style={[styles.mealItem, { backgroundColor: surface, borderColor: outlineVariant }]}>
                                <View style={[styles.mealIcon, { backgroundColor: `${secondary}0D` }]}>
                                  <MaterialIcons name="restaurant-menu" size={20} color={secondary} />
                                </View>
                                <View style={styles.mealInfo}>
                                  <Text style={[styles.mealItemTitle, { color: text }]}>单次记录</Text>
                                  <Text style={[styles.mealItemDesc, { color: outline }]}>
                                    饮水 {new Intl.NumberFormat('zh-CN').format(rec.hydration)} ml · 蛋白质{' '}
                                    {rec.protein} g · 碳水 {rec.carbohydrate} g · 钠{' '}
                                    {new Intl.NumberFormat('zh-CN').format(rec.sodium)} mg
                                  </Text>
                                </View>
                              </View>
                            </View>
                          );
                        })}
                      </>
                    );
                  })()}
                </View>
              )}
            </View>
          )}
        </ScrollView>
      </Animated.View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
    gap: 16,
  },
  header: {
    paddingHorizontal: 8,
    paddingBottom: 8,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  headerLeft: {
    gap: 10,
    flex: 1,
    paddingRight: 12,
  },
  yearChip: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
  },
  yearChipText: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  monthTitle: {
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: -0.6,
    lineHeight: 36,
  },
  monthSub: {
    fontWeight: '500',
    fontSize: 17,
  },
  headerBtns: {
    flexDirection: 'row',
    gap: 10,
  },
  circleBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 2,
  },
  card: {
    borderRadius: 26,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.07,
    shadowRadius: 28,
    elevation: 5,
  },
  weekHeader: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  weekHeaderCell: {
    flex: 1,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekHeaderText: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  calendarGrid: {
    paddingTop: 8,
    paddingBottom: 10,
  },
  weekRow: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 10,
    marginBottom: 6,
  },
  weekRowLast: {
    marginBottom: 0,
  },
  dayCellWrapper: {
    flex: 1,
    minWidth: 0,
    height: 112,
  },
  dayCell: {
    flex: 1,
    height: '100%',
    justifyContent: 'space-between',
  },
  dayCellInner: {
    padding: 9,
    borderRadius: 14,
  },
  dayNumber: {
    fontSize: 13,
    fontWeight: '800',
  },
  dayBottom: {
    gap: 4,
    width: '100%',
    alignSelf: 'stretch',
  },
  bars: {
    gap: 6,
    width: '100%',
  },
  bar: {
    height: 5,
    borderRadius: 999,
  },
  amountText: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: -0.35,
    lineHeight: 12,
    textAlign: 'center',
    width: '100%',
  },
  amountPlaceholder: {
    height: 14,
    width: '100%',
  },
  legendCard: {
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 12,
    paddingHorizontal: 4,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.04,
    shadowRadius: 14,
    elevation: 2,
  },
  legendScroll: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
  },
  legendChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
  },
  legendText: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
    zIndex: 40,
  },
  bottomSheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 600,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderTopWidth: StyleSheet.hairlineWidth,
    zIndex: 50,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: -18 },
    shadowOpacity: 0.14,
    shadowRadius: 40,
    elevation: 24,
  },
  sheetHandle: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  sheetHandleLine: {
    width: 40,
    height: 5,
    borderRadius: 999,
  },
  sheetHeader: {
    paddingHorizontal: 32,
    paddingBottom: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  sheetHeaderLeft: {
    flex: 1,
  },
  sheetHeaderRight: {
    alignItems: 'flex-end',
  },
  sheetTitle: {
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  sheetSubtitle: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginTop: 4,
    textTransform: 'uppercase',
  },
  sheetAmountLabel: {
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  sheetAmountValue: {
    fontSize: 20,
    fontWeight: '800',
  },
  sheetTabsOuter: {
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  sheetTabsTrack: {
    flexDirection: 'row',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 4,
    gap: 4,
  },
  sheetTabPill: {
    flex: 1,
    paddingVertical: 11,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'transparent',
  },
  sheetTabPillActive: {
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 3,
  },
  sheetTabText: {
    fontSize: 12,
    letterSpacing: 0.15,
  },
  sheetContent: {
    flex: 1,
    paddingHorizontal: 24,
  },
  taskList: {
    gap: 16,
    paddingTop: 16,
  },
  emptyHint: {
    textAlign: 'center',
    marginTop: 28,
    fontSize: 14,
    fontWeight: '600',
  },
  taskItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    padding: 16,
    borderRadius: 12,
    borderLeftWidth: 4,
  },
  taskInfo: {
    flex: 1,
    gap: 2,
  },
  taskTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  taskMeta: {
    fontSize: 11,
    fontWeight: '500',
  },
  taskTag: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  taskTagText: {
    fontSize: 10,
    fontWeight: '800',
  },
  financeList: {
    gap: 24,
    paddingTop: 16,
    paddingBottom: 32,
  },
  financeSummary: {
    flexDirection: 'row',
    gap: 12,
  },
  financeSummaryCard: {
    flex: 1,
    padding: 16,
    borderRadius: 20,
    borderWidth: 1,
  },
  financeSummaryLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  financeSummaryValue: {
    fontSize: 18,
    fontWeight: '800',
  },
  transactionList: {
    gap: 12,
  },
  transactionHeader: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 2,
    textTransform: 'uppercase',
    paddingHorizontal: 4,
    marginBottom: 4,
  },
  transactionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
  },
  transactionIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  transactionInfo: {
    flex: 1,
    gap: 2,
  },
  transactionTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  transactionMeta: {
    fontSize: 11,
    fontWeight: '500',
  },
  transactionRight: {
    alignItems: 'flex-end',
    gap: 2,
  },
  transactionAmount: {
    fontSize: 14,
    fontWeight: '800',
  },
  transactionType: {
    fontSize: 10,
    fontWeight: '600',
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
    borderRadius: 20,
    marginTop: 8,
  },
  addButtonText: {
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 1,
  },
  intakeList: {
    gap: 24,
    paddingTop: 16,
    paddingBottom: 32,
  },
  intakeSummary: {
    borderRadius: 20,
    overflow: 'hidden',
  },
  intakeSummaryRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  intakeSummaryCard: {
    flex: 1,
    padding: 14,
    alignItems: 'center',
  },
  intakeSummaryLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  intakeSummaryValue: {
    fontSize: 18,
    fontWeight: '800',
  },
  intakeSummaryUnit: {
    fontSize: 10,
    fontWeight: '500',
  },
  mealList: {
    gap: 20,
  },
  mealGroup: {
    gap: 12,
  },
  mealHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  mealHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  mealDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  mealTitle: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  mealTime: {
    fontSize: 10,
    fontWeight: '600',
  },
  mealItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
  },
  mealIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mealInfo: {
    flex: 1,
    gap: 2,
  },
  mealItemTitle: {
    fontSize: 14,
    fontWeight: '800',
  },
  mealItemDesc: {
    fontSize: 11,
    fontWeight: '500',
  },
  hydrationCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
  },
  hydrationInfo: {
    flex: 1,
    gap: 6,
  },
  hydrationProgressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  hydrationProgressBar: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  hydrationProgressFill: {
    height: '100%',
    borderRadius: 3,
  },
  hydrationText: {
    fontSize: 11,
    fontWeight: '800',
    minWidth: 60,
  },
});
