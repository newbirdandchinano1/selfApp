import { AppButton, AppIconButton } from '@/components/ui';
import { Layout, Radius, Spacing, Typography } from '@/constants/design-tokens';
import { useAppTheme } from '@/hooks/use-app-theme';
import { usePullToRefresh } from '@/hooks/use-pull-to-refresh';
import { runPageApiLoad } from '@/lib/page-api-session';
import { getFinanceDailySummariesByDateRange, getFinanceTransactionsByYmd } from '@/lib/repositories/finance/finance';
import type { FinanceDailySummaryRow, FinanceTransactionRow } from '@/lib/repositories/finance/finance.types';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import React from 'react';
import { Animated, FlatList, Modal, PanResponder, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

type DayCell = {
  key: string;
  date: Date;
  inCurrentMonth: boolean;
  income: number;
  expense: number;
  net: number;
};

type Txn = {
  id: string;
  icon: keyof typeof MaterialIcons.glyphMap;
  title: string;
  meta: string;
  displayAmount: number;
  transactionType: FinanceTransactionRow['transaction_type'];
  /** 与财务首页一致：来自 `finance_transactions.ai_comment` */
  insight?: string;
};

const weekTitles = ['一', '二', '三', '四', '五', '六', '日'];
const weekdayCn = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const MONTH_PAGE_SPAN = 481;
const MONTH_PAGE_CENTER_INDEX = Math.floor(MONTH_PAGE_SPAN / 2);
const GRID_PADDING = 6;
const GRID_GAP = 4;

function formatYMD(date: Date) {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function monthStart(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date: Date, delta: number) {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1);
}

function getMonthDiff(from: Date, to: Date) {
  return (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
}

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function buildCalendarCells(targetMonth: Date, dailyMap: Map<string, FinanceDailySummaryRow>): DayCell[] {
  const firstDay = monthStart(targetMonth);
  const mondayStartOffset = (firstDay.getDay() + 6) % 7;
  const gridStart = new Date(firstDay);
  gridStart.setDate(firstDay.getDate() - mondayStartOffset);

  return Array.from({ length: 42 }).map((_, idx) => {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + idx);
    const ymd = formatYMD(d);
    const row = dailyMap.get(ymd);
    return {
      key: ymd,
      date: d,
      inCurrentMonth: d.getMonth() === targetMonth.getMonth(),
      income: row?.income ?? 0,
      expense: row?.expense ?? 0,
      net: row?.net ?? 0,
    };
  });
}

function formatTimeHHmm(happenedAt: string) {
  const t = happenedAt.slice(11, 16);
  return /\d{2}:\d{2}/.test(t) ? t : '--:--';
}

function txnIconByType(type: string): Txn['icon'] {
  if (type === 'income') return 'trending-up';
  if (type === 'expense') return 'trending-down';
  if (type === 'transfer') return 'swap-horiz';
  return 'receipt-long';
}

/** 与财务首页 `getTxnDisplayAmount` 一致：按收支类型与金额绝对值展示；转账按 transfer_leg 区分方向。 */
function getTxnDisplayAmount(row: FinanceTransactionRow): number {
  const absAmount = Math.abs(row.amount);
  if (row.transaction_type === 'income') return absAmount;
  if (row.transaction_type === 'expense') return -absAmount;
  if (row.transaction_type === 'transfer') {
    try {
      if (row.extra_data) {
        const raw = JSON.parse(row.extra_data) as unknown;
        if (raw && typeof raw === 'object') {
          const leg = (raw as Record<string, unknown>).transfer_leg;
          if (leg === 'out') return -absAmount;
          if (leg === 'in') return absAmount;
        }
      }
    } catch {
      // ignore
    }
    return 0;
  }
  return row.amount;
}

function txnToUi(row: FinanceTransactionRow): Txn {
  const ymd = row.happened_at.slice(0, 10);
  const trimmed = row.ai_comment?.trim();
  return {
    id: row.id,
    icon: txnIconByType(row.transaction_type),
    title: row.name,
    meta: `${formatTimeHHmm(row.happened_at)} · ${ymd}`,
    displayAmount: getTxnDisplayAmount(row),
    transactionType: row.transaction_type,
    insight: trimmed ? `AI 洞察：${trimmed}` : undefined,
  };
}

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}

function formatCellNetAmount(value: number) {
  const sign = value >= 0 ? '+' : '-';
  const abs = Math.abs(value);
  if (abs >= 10000) {
    const compact = abs >= 100000 ? (abs / 10000).toFixed(0) : (abs / 10000).toFixed(1);
    return `${sign}${compact}w`;
  }
  return `${sign}${abs.toFixed(2)}`;
}

const FinanceMonthPage = React.memo(function FinanceMonthPage(props: {
  offset: number;
  todayMonthStart: Date;
  calendarWidth: number;
  dayCellSize: number;
  text: string;
  subtle: string;
  outline: string;
  incomeColor: string;
  expenseColor: string;
  netNegativeColor: string;
  gridBg: string;
  activeBorderColor: string;
  activeCellBg: string;
  dataCellBg: string;
  emptyCellBg: string;
  selectedDate: Date | null;
  setSelectedDate: (d: Date) => void;
  setSheetSnap: (v: 'half' | 'full') => void;
  setSheetVisible: (v: boolean) => void;
  calendarRefreshKey: number;
}) {
  const {
    offset,
    todayMonthStart,
    calendarWidth,
    dayCellSize,
    text,
    subtle,
    outline,
    incomeColor,
    expenseColor,
    netNegativeColor,
    gridBg,
    activeBorderColor,
    activeCellBg,
    dataCellBg,
    emptyCellBg,
    selectedDate,
    setSelectedDate,
    setSheetSnap,
    setSheetVisible,
    calendarRefreshKey,
  } = props;

  const monthDate = React.useMemo(() => addMonths(todayMonthStart, offset), [offset, todayMonthStart]);
  const firstDay = React.useMemo(() => monthStart(monthDate), [monthDate]);
  const gridStart = React.useMemo(() => {
    const mondayStartOffset = (firstDay.getDay() + 6) % 7;
    const d = new Date(firstDay);
    d.setDate(firstDay.getDate() - mondayStartOffset);
    return startOfDay(d);
  }, [firstDay]);
  const gridEnd = React.useMemo(() => {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + 41);
    return startOfDay(d);
  }, [gridStart]);

  const [dailyMap, setDailyMap] = React.useState<Map<string, FinanceDailySummaryRow>>(() => new Map());
  React.useEffect(() => {
    let cancelled = false;
    void runPageApiLoad('finance-calendar', async () => {
      try {
        const rows = await getFinanceDailySummariesByDateRange(formatYMD(gridStart), formatYMD(gridEnd));
        if (cancelled) return;

        const map = new Map<string, FinanceDailySummaryRow>();
        for (const r of rows) {
          map.set(r.day, r);
        }
        setDailyMap(map);
      } catch {
        if (cancelled) return;
        setDailyMap(new Map());
      }
    });
    return () => {
      cancelled = true;
    };
  }, [gridEnd, gridStart, calendarRefreshKey]);

  const cells = React.useMemo(() => buildCalendarCells(monthDate, dailyMap), [dailyMap, monthDate]);

  return (
    <View style={[styles.calendarPage, { width: calendarWidth }]}>
      <View style={[styles.gridWrap, { backgroundColor: gridBg }]}>
        {Array.from({ length: 6 }).map((_, row) => (
          <View key={`row-${offset}-${row}`} style={styles.gridRow}>
            {cells.slice(row * 7, row * 7 + 7).map((item) => {
              if (!item.inCurrentMonth) {
                return <View key={item.key} style={[styles.blankCell, { width: dayCellSize, height: dayCellSize }]} />;
              }

              const isActive = selectedDate ? isSameDay(item.date, selectedDate) : false;
              const hasData = item.income !== 0 || item.expense !== 0;
              const totalFlow = item.income + item.expense;
              const incomeRatio = totalFlow > 0 ? clamp01(item.income / totalFlow) : 0;
              const expenseRatio = totalFlow > 0 ? clamp01(item.expense / totalFlow) : 0;

              return (
                <Pressable
                  key={item.key}
                  onPress={(e) => {
                    e.stopPropagation();
                    setSelectedDate(item.date);
                    if (hasData) {
                      setSheetSnap('half');
                      setSheetVisible(true);
                    } else {
                      setSheetVisible(false);
                    }
                  }}
                  style={[
                    styles.dayCell,
                    {
                      width: dayCellSize,
                      height: dayCellSize,
                      backgroundColor: isActive
                        ? activeCellBg
                        : hasData
                          ? dataCellBg
                          : emptyCellBg,
                      borderColor: isActive ? activeBorderColor : outline,
                      borderWidth: 1,
                    },
                  ]}
                >
                  <Text style={[styles.dayNum, { color: text }]}>{item.date.getDate()}</Text>
                  <View style={styles.midArea}>
                    <View style={styles.barsWrap}>
                      <View
                        style={[
                          styles.bar,
                          {
                            backgroundColor: incomeColor,
                            opacity: hasData ? 0.95 : 0.25,
                            width: `${Math.round(90 * incomeRatio)}%`,
                          },
                        ]}
                      />
                      <View
                        style={[
                          styles.bar,
                          {
                            backgroundColor: expenseColor,
                            opacity: hasData ? 0.8 : 0.25,
                            width: `${Math.round(90 * expenseRatio)}%`,
                          },
                        ]}
                      />
                    </View>
                  </View>
                  <Text
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.7}
                    style={[
                      styles.amount,
                      {
                        color: !hasData ? subtle : item.net >= 0 ? incomeColor : netNegativeColor,
                        fontWeight: isActive ? '800' : '700',
                      },
                    ]}
                  >
                    {!hasData ? '--' : formatCellNetAmount(item.net)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>
    </View>
  );
});

export default function FinanceCalendarScreen() {
  const router = useRouter();
  const { colors, isDark, shadows } = useAppTheme();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const today = React.useMemo(() => new Date(), []);
  const todayMonthStart = React.useMemo(() => monthStart(today), [today]);
  const [monthOffset, setMonthOffset] = React.useState(0);
  const [visibleMonthOffset, setVisibleMonthOffset] = React.useState(0);
  const [selectedDate, setSelectedDate] = React.useState<Date | null>(today);
  const [sheetVisible, setSheetVisible] = React.useState(false);
  const [sheetSnap, setSheetSnap] = React.useState<'half' | 'full'>('half');

  const [pickerVisible, setPickerVisible] = React.useState(false);
  const [pickYear, setPickYear] = React.useState(today.getFullYear());
  const [pickMonth, setPickMonth] = React.useState(today.getMonth() + 1);
  const [pickDay, setPickDay] = React.useState(today.getDate());

  const [calendarWidth, setCalendarWidth] = React.useState(() => Math.max(1, windowWidth - 32));
  const pagerRef = React.useRef<FlatList<number>>(null);
  const pagerCurrentIndexRef = React.useRef(MONTH_PAGE_CENTER_INDEX);
  const pagerWidthReadyRef = React.useRef(false);
  const pagerData = React.useMemo(
    () => Array.from({ length: MONTH_PAGE_SPAN }, (_, i) => i - MONTH_PAGE_CENTER_INDEX),
    []
  );
  const visibleMonth = React.useMemo(() => addMonths(todayMonthStart, visibleMonthOffset), [todayMonthStart, visibleMonthOffset]);
  const calendarInnerWidth = Math.max(280, calendarWidth);
  const dayCellSize = (calendarInnerWidth - GRID_PADDING * 2 - GRID_GAP * 6) / 7;

  const activeDate = selectedDate ?? today;
  const [activeTxns, setActiveTxns] = React.useState<Txn[]>([]);
  const [dayTotal, setDayTotal] = React.useState(0);
  const [calendarRefreshKey, setCalendarRefreshKey] = React.useState(0);

  const reloadDayTxns = React.useCallback(async (date: Date) => {
    try {
      const rows = await getFinanceTransactionsByYmd(formatYMD(date));
      const ui = rows.map((row) => txnToUi(row));
      setActiveTxns(ui);
      setDayTotal(
        ui.reduce((sum, t) => (t.transactionType === 'transfer' ? sum : sum + t.displayAmount), 0),
      );
      if (ui.length > 0) {
        setSheetSnap('half');
        setSheetVisible(true);
      } else {
        setSheetVisible(false);
      }
    } catch {
      setActiveTxns([]);
      setDayTotal(0);
      setSheetVisible(false);
    }
  }, []);

  const reload = React.useCallback(async () => {
    setCalendarRefreshKey((k) => k + 1);
    await reloadDayTxns(activeDate);
  }, [activeDate, reloadDayTxns]);

  const { refreshControl } = usePullToRefresh(reload);

  const dayAiInsightSummary = React.useMemo(() => {
    const total = activeTxns.length;
    const withInsight = activeTxns.filter((t) => t.insight).length;
    if (total === 0) return { kind: 'no_txns' as const };
    if (withInsight === 0) return { kind: 'no_ai' as const, total };
    return { kind: 'has_ai' as const, withInsight, total };
  }, [activeTxns]);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (cancelled) return;
      await reloadDayTxns(activeDate);
    })();
    return () => {
      cancelled = true;
    };
  }, [activeDate, reloadDayTxns]);

  const text = colors.text;
  const subtle = colors.textSecondary;
  const outline = colors.outline;
  const outlineVariant = isDark ? colors.surfaceMuted : colors.capsule;
  const accentColor = colors.primary;
  const income = colors.success;
  const expense = colors.textSecondary;
  const expenseAmountColor = colors.danger;
  const gridBg = colors.input;
  const activeBorderColor = colors.primarySoft;
  const activeCellBg = isDark ? 'rgba(96,165,250,0.22)' : colors.primaryMuted;
  const dataCellBg = isDark ? 'rgba(96,165,250,0.10)' : colors.capsule;
  const emptyCellBg = colors.surface;

  const formatTopDate = (d: Date) => `${d.getMonth() + 1}月${d.getDate()}日 ${weekdayCn[d.getDay()]}`;

  const openPicker = () => {
    const d = selectedDate ?? today;
    setPickYear(d.getFullYear());
    setPickMonth(d.getMonth() + 1);
    setPickDay(d.getDate());
    setPickerVisible(true);
  };

  const confirmPickDate = () => {
    const maxDay = new Date(pickYear, pickMonth, 0).getDate();
    const clampedDay = Math.min(pickDay, maxDay);
    const nextDate = new Date(pickYear, pickMonth - 1, clampedDay);

    setSelectedDate(nextDate);
    setMonthOffset(getMonthDiff(todayMonthStart, monthStart(nextDate)));
    setPickerVisible(false);
  };

  const changePick = (type: 'y' | 'm' | 'd', delta: number) => {
    if (type === 'y') setPickYear((v) => Math.max(1990, Math.min(2099, v + delta)));
    if (type === 'm') setPickMonth((v) => Math.max(1, Math.min(12, v + delta)));
    if (type === 'd') setPickDay((v) => Math.max(1, Math.min(31, v + delta)));
  };

  const sheetMaxHeight = Math.max(340, Math.floor(windowHeight * 0.6));
  /** 半开时向下偏移越小，露出越多 */
  const halfOpenOffset = Math.min(140, Math.max(56, Math.floor(windowHeight * 0.1)));
  const sheetTranslateY = React.useRef(new Animated.Value(halfOpenOffset)).current;
  const sheetOpenAnim = React.useRef(new Animated.Value(0)).current;

  const animateSheetTo = React.useCallback(
    (toValue: number) => {
      Animated.spring(sheetTranslateY, {
        toValue,
        useNativeDriver: true,
        bounciness: 5,
      }).start();
    },
    [sheetTranslateY],
  );

  React.useEffect(() => {
    if (!sheetVisible) return;
    sheetOpenAnim.stopAnimation();
    sheetOpenAnim.setValue(0);

    // Start offscreen then spring in for a "pop up" feel.
    sheetTranslateY.stopAnimation();
    sheetTranslateY.setValue(sheetMaxHeight + 24);
    requestAnimationFrame(() => {
      animateSheetTo(sheetSnap === 'full' ? 0 : halfOpenOffset);
    });
    Animated.timing(sheetOpenAnim, { toValue: 1, duration: 180, useNativeDriver: true }).start();
    animateSheetTo(sheetSnap === 'full' ? 0 : halfOpenOffset);
  }, [animateSheetTo, halfOpenOffset, sheetMaxHeight, sheetOpenAnim, sheetSnap, sheetTranslateY, sheetVisible]);

  const panResponder = React.useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, gesture) =>
          Math.abs(gesture.dy) > 6 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
        onPanResponderTerminationRequest: () => false,
        onPanResponderMove: (_, gesture) => {
          const base = sheetSnap === 'full' ? 0 : halfOpenOffset;
          const next = base + gesture.dy;
          sheetTranslateY.setValue(Math.max(0, Math.min(sheetMaxHeight + 40, next)));
        },
        onPanResponderRelease: (_, gesture) => {
          if (gesture.dy < -50) {
            setSheetSnap('full');
            animateSheetTo(0);
            return;
          }

          const shouldDismiss =
            gesture.dy > 90 ||
            (sheetSnap === 'half' && gesture.dy > 48) ||
            (gesture.vy ?? 0) > 1.1;

          if (shouldDismiss) {
            Animated.spring(sheetTranslateY, {
              toValue: sheetMaxHeight + 24,
              useNativeDriver: true,
              bounciness: 0,
            }).start(({ finished }) => {
              if (finished) {
                setSheetVisible(false);
                setSheetSnap('half');
              }
            });
            return;
          }

          if (gesture.dy > 50) {
            setSheetSnap('half');
            animateSheetTo(halfOpenOffset);
            return;
          }

          animateSheetTo(sheetSnap === 'full' ? 0 : halfOpenOffset);
        },
      }),
    [animateSheetTo, halfOpenOffset, sheetMaxHeight, sheetSnap, sheetTranslateY],
  );

  React.useEffect(() => {
    const nextWidth = Math.max(1, windowWidth - 32);
    setCalendarWidth((prev) => (Math.abs(prev - nextWidth) < 1 ? prev : nextWidth));
  }, [windowWidth]);

  React.useEffect(() => {
    setVisibleMonthOffset(monthOffset);
    if (calendarWidth <= 0) return;

    const nextIndex = monthOffset + MONTH_PAGE_CENTER_INDEX;
    if (!pagerWidthReadyRef.current) {
      pagerWidthReadyRef.current = true;
      pagerCurrentIndexRef.current = nextIndex;
      requestAnimationFrame(() => {
        pagerRef.current?.scrollToIndex({ index: nextIndex, animated: false });
      });
      return;
    }

    if (nextIndex === pagerCurrentIndexRef.current) return;
    pagerCurrentIndexRef.current = nextIndex;
    requestAnimationFrame(() => {
      pagerRef.current?.scrollToIndex({ index: nextIndex, animated: true });
    });
  }, [calendarWidth, monthOffset]);

  useFocusEffect(
    React.useCallback(() => {
      const now = new Date();
      setSelectedDate(now);
      setMonthOffset(getMonthDiff(todayMonthStart, monthStart(now)));
      setVisibleMonthOffset(getMonthDiff(todayMonthStart, monthStart(now)));
      setPickYear(now.getFullYear());
      setPickMonth(now.getMonth() + 1);
      setPickDay(now.getDate());
    }, [todayMonthStart]),
  );

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]} edges={['left', 'right']}>
      <View
        style={[
          styles.topBarWrap,
          {
            paddingTop: insets.top,
            backgroundColor: colors.headerScrim,
            borderBottomColor: colors.outline,
          },
        ]}>
        <View style={styles.topBar}>
          <AppIconButton icon="arrow-back" onPress={() => router.back()} accessibilityLabel="返回" />
          <Pressable onPress={openPicker} style={({ pressed }) => [styles.topDateBtn, pressed && { opacity: 0.75 }]}>
            <Text style={[Typography.title, { color: accentColor }]}>{formatTopDate(selectedDate ?? today)}</Text>
            <MaterialIcons name="arrow-drop-down" size={20} color={accentColor} />
          </Pressable>
          <View style={styles.topSpacer} />
        </View>
      </View>

      <Pressable style={styles.mainArea} onPress={() => setSheetVisible(false)}>
        <ScrollView refreshControl={refreshControl} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <View style={styles.monthHeader}>
            <View>
              <Text style={[Typography.kicker, { color: subtle }]}>
                {visibleMonth.toLocaleString('en-US', { month: 'long' }).toUpperCase()} {visibleMonth.getFullYear()}
              </Text>
              <Text style={[Typography.h1, styles.monthTitle, { color: text }]}>{visibleMonth.getMonth() + 1}月总览</Text>
            </View>
            <View style={styles.monthActions}>
              <Pressable
                onPress={(e) => {
                  e.stopPropagation();
                  setMonthOffset((prev) => prev - 1);
                }}
                style={({ pressed }) => [
                  styles.monthArrowBtn,
                  { backgroundColor: colors.surface, borderColor: colors.outline },
                  shadows.card,
                  pressed && { opacity: 0.72 },
                ]}>
                <MaterialIcons name="chevron-left" size={22} color={subtle} />
              </Pressable>
              <Pressable
                onPress={(e) => {
                  e.stopPropagation();
                  setMonthOffset((prev) => prev + 1);
                }}
                style={({ pressed }) => [
                  styles.monthArrowBtn,
                  { backgroundColor: colors.surface, borderColor: colors.outline },
                  shadows.card,
                  pressed && { opacity: 0.72 },
                ]}>
                <MaterialIcons name="chevron-right" size={22} color={subtle} />
              </Pressable>
            </View>
          </View>

          <View style={[styles.weekRow, { paddingHorizontal: GRID_PADDING, gap: GRID_GAP }]}>
            {weekTitles.map((item) => (
              <Text key={item} style={[styles.weekText, { color: subtle, width: dayCellSize }]}>{item}</Text>
            ))}
          </View>

          <FlatList
            ref={pagerRef}
            data={pagerData}
            horizontal
            pagingEnabled
            directionalLockEnabled
            decelerationRate="fast"
            initialScrollIndex={MONTH_PAGE_CENTER_INDEX}
            getItemLayout={(_, index) => ({ length: calendarWidth, offset: calendarWidth * index, index })}
            showsHorizontalScrollIndicator={false}
            keyExtractor={(offset) => `finance-month-${offset}`}
            windowSize={5}
            maxToRenderPerBatch={3}
            updateCellsBatchingPeriod={16}
            removeClippedSubviews
            onLayout={(e) => {
              const width = e.nativeEvent.layout.width;
              setCalendarWidth((prev) => (Math.abs(prev - width) < 1 ? prev : width));
            }}
            onScroll={(e) => {
              if (calendarWidth <= 0) return;
              const rawIndex = e.nativeEvent.contentOffset.x / calendarWidth;
              const previewOffset = Math.round(rawIndex) - MONTH_PAGE_CENTER_INDEX;
              setVisibleMonthOffset((prev) => (prev === previewOffset ? prev : previewOffset));
            }}
            scrollEventThrottle={16}
            onMomentumScrollEnd={(e) => {
              if (calendarWidth <= 0) return;
              const rawIndex = e.nativeEvent.contentOffset.x / calendarWidth;
              const nextIndex = Math.round(rawIndex);
              const nextOffset = nextIndex - MONTH_PAGE_CENTER_INDEX;
              pagerCurrentIndexRef.current = nextIndex;
              setVisibleMonthOffset(nextOffset);
              setMonthOffset((prev) => (prev === nextOffset ? prev : nextOffset));
            }}
            onScrollToIndexFailed={(info) => {
              if (calendarWidth <= 0) return;
              requestAnimationFrame(() => {
                pagerRef.current?.scrollToOffset({ offset: info.index * calendarWidth, animated: false });
              });
            }}
            renderItem={({ item: offset }) => {
              return (
                <FinanceMonthPage
                  offset={offset}
                  todayMonthStart={todayMonthStart}
                  calendarWidth={calendarWidth}
                  dayCellSize={dayCellSize}
                  text={text}
                  subtle={subtle}
                  outline={outline}
                  incomeColor={income}
                  expenseColor={expense}
                  netNegativeColor={colors.primary}
                  gridBg={gridBg}
                  activeBorderColor={activeBorderColor}
                  activeCellBg={activeCellBg}
                  dataCellBg={dataCellBg}
                  emptyCellBg={emptyCellBg}
                  selectedDate={selectedDate}
                  setSelectedDate={setSelectedDate}
                  setSheetSnap={setSheetSnap}
                  setSheetVisible={setSheetVisible}
                  calendarRefreshKey={calendarRefreshKey}
                />
              );
            }}
          />
        </ScrollView>
      </Pressable>

      {sheetVisible && selectedDate ? (
        <Animated.View
          style={[
            styles.sheetWrap,
            {
              opacity: sheetOpenAnim,
              transform: [{ translateY: sheetTranslateY }],
            },
          ]}
          pointerEvents="box-none">
          <View
            style={[
              styles.sheet,
              shadows.sheet,
              {
                backgroundColor: colors.surface,
                borderColor: outline,
                height: sheetMaxHeight,
                paddingBottom: Math.max(Spacing['4xl'], insets.bottom + Spacing.lg),
              },
            ]}>
            <View {...panResponder.panHandlers} style={styles.sheetDragZone}>
              <Pressable
                onPress={() => setSheetSnap((v) => (v === 'half' ? 'full' : 'half'))}
                style={styles.sheetHandleTapArea}>
                <View style={[styles.sheetHandle, { backgroundColor: colors.textMuted }]} />
              </Pressable>
            </View>
            <View style={styles.sheetHeaderRow}>
              <View>
                <Text style={[Typography.h2, { color: text }]}>今日流水</Text>
                <Text style={[Typography.caption, styles.sheetDate, { color: subtle }]}>
                  {selectedDate.getMonth() + 1}月{selectedDate.getDate()}日
                </Text>
              </View>
              <Text style={[styles.sheetTotal, { color: dayTotal >= 0 ? income : expenseAmountColor }]}>
                {dayTotal >= 0 ? '+' : ''}{dayTotal.toFixed(2)}
              </Text>
            </View>

            <View style={styles.sheetInsightSection}>
              <View
                style={[
                  styles.insightCard,
                  {
                    backgroundColor: colors.primaryMuted,
                    borderColor: isDark ? 'rgba(96,165,250,0.35)' : colors.outline,
                  },
                ]}>
                <View style={styles.insightHeader}>
                  <MaterialIcons name="auto-awesome" size={14} color={accentColor} />
                  <Text style={[Typography.kicker, { color: accentColor }]}>AI 洞察</Text>
                </View>
                <Text style={[Typography.body, styles.insightBody, { color: colors.textSecondary }]}>
                  {dayAiInsightSummary.kind === 'no_txns'
                    ? '选择有流水的日期即可查看记录。在「财务」首页使用智能/拍照记账并生成点评后，含点评的流水会同步显示在下方列表中。'
                    : dayAiInsightSummary.kind === 'no_ai'
                      ? '当日流水暂无 AI 点评。在「财务」首页保存或编辑流水并触发智能分析后，点评会写入数据库并显示在此处。'
                      : `当日共 ${dayAiInsightSummary.withInsight}/${dayAiInsightSummary.total} 笔流水含 AI 点评（数据与财务首页一致），详见下方。`}
                </Text>
              </View>
              <View style={[styles.sheetDivider, { backgroundColor: outline }]} />
            </View>

            <ScrollView
              style={styles.sheetTxnScroll}
              contentContainerStyle={styles.sheetTxnScrollContent}
              showsVerticalScrollIndicator={false}
              nestedScrollEnabled
              bounces
              scrollEventThrottle={16}>
              {activeTxns.length === 0 ? (
                <View style={[styles.emptyTxnWrap, { borderColor: outline }]}>
                  <MaterialIcons name="event-note" size={18} color={subtle} />
                  <Text style={[styles.emptyTxnText, { color: subtle }]}>今日暂无流水记录</Text>
                </View>
              ) : (
                activeTxns.map((txn) => (
                  <View key={txn.id} style={styles.txnRow}>
                    <View style={[styles.txnIconWrap, { backgroundColor: colors.primaryMuted }]}>
                      <MaterialIcons name={txn.icon} size={20} color={accentColor} />
                    </View>
                    <View
                      style={[
                        styles.txnMain,
                        styles.txnMainWithBorder,
                        { borderLeftColor: dayTotal >= 0 ? income : expenseAmountColor },
                      ]}>
                      <View style={styles.txnTitleRow}>
                        <View style={styles.txnTextCol}>
                          <Text style={[styles.txnTitle, { color: text }]}>{txn.title}</Text>
                          <Text style={[styles.txnMeta, { color: subtle }]}>{txn.meta}</Text>
                          {txn.insight ? (
                            <View style={[styles.txnInsightTag, { backgroundColor: outlineVariant }]}>
                              <MaterialIcons name="auto-awesome" size={14} color={accentColor} />
                              <Text style={[styles.txnInsightText, { color: accentColor }]}>{txn.insight}</Text>
                            </View>
                          ) : null}
                        </View>
                        <Text
                          style={[
                            styles.txnAmount,
                            {
                              color:
                                txn.transactionType === 'income'
                                  ? income
                                  : txn.transactionType === 'expense'
                                    ? expenseAmountColor
                                    : subtle,
                            },
                          ]}>
                          {txn.displayAmount >= 0 ? '+' : ''}{txn.displayAmount.toFixed(2)}
                        </Text>
                      </View>
                    </View>
                  </View>
                ))
              )}
            </ScrollView>
          </View>
        </Animated.View>
      ) : null}

      <Modal transparent visible={pickerVisible} animationType="fade" onRequestClose={() => setPickerVisible(false)}>
        <Pressable style={[styles.modalMask, { backgroundColor: colors.overlay }]} onPress={() => setPickerVisible(false)}>
          <Pressable
            style={[styles.pickerCard, shadows.card, { backgroundColor: colors.surface, borderColor: outline }]}
            onPress={(e) => e.stopPropagation()}>
            <Text style={[Typography.h3, { color: text }]}>选择日期</Text>

            {[
              { key: 'y', label: '年', value: pickYear },
              { key: 'm', label: '月', value: pickMonth },
              { key: 'd', label: '日', value: pickDay },
            ].map((row) => (
              <View key={row.key} style={styles.pickRow}>
                <Text style={[styles.pickLabel, { color: subtle }]}>{row.label}</Text>
                <Pressable
                  style={[styles.pickBtn, { backgroundColor: colors.capsule }]}
                  onPress={() => changePick(row.key as 'y' | 'm' | 'd', -1)}>
                  <MaterialIcons name="remove" size={18} color={text} />
                </Pressable>
                <Text style={[Typography.title, styles.pickValue, { color: text }]}>{row.value}</Text>
                <Pressable
                  style={[styles.pickBtn, { backgroundColor: colors.capsule }]}
                  onPress={() => changePick(row.key as 'y' | 'm' | 'd', 1)}>
                  <MaterialIcons name="add" size={18} color={text} />
                </Pressable>
              </View>
            ))}

            <View style={styles.pickFooter}>
              <AppButton label="取消" variant="outline" onPress={() => setPickerVisible(false)} style={styles.pickActionBtn} />
              <AppButton label="确定" variant="primary" onPress={confirmPickDate} style={styles.pickActionBtn} />
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  topBarWrap: {
    zIndex: 100,
    elevation: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  topBar: {
    minHeight: Layout.headerHeight,
    paddingHorizontal: Spacing['5xl'],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  topDateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  topSpacer: { width: Layout.iconButtonSize },
  mainArea: { flex: 1 },
  scrollContent: {
    paddingHorizontal: Spacing['5xl'],
    paddingTop: Spacing.xl,
    paddingBottom: 260,
    maxWidth: Layout.contentMaxWidth,
    alignSelf: 'center',
    width: '100%',
  },
  monthHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing['2xl'],
  },
  monthTitle: {
    marginTop: Spacing.xs,
  },
  monthActions: {
    flexDirection: 'row',
    gap: Spacing.md,
  },
  monthArrowBtn: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
  },
  weekRow: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  weekText: {
    textAlign: 'center',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  gridWrap: {
    borderRadius: Radius['2xl'],
    padding: GRID_PADDING,
    gap: GRID_GAP,
  },
  calendarPage: {
    width: '100%',
  },
  gridRow: {
    flexDirection: 'row',
    gap: GRID_GAP,
  },
  dayCell: {
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm,
    justifyContent: 'space-between',
    flexShrink: 0,
  },
  blankCell: {
    backgroundColor: 'transparent',
    flexShrink: 0,
  },
  dayNum: {
    fontSize: 14,
    fontWeight: '800',
  },
  midArea: {
    minHeight: 10,
    justifyContent: 'center',
  },
  barsWrap: {
    gap: 2,
  },
  bar: {
    height: 2,
    borderRadius: 999,
    width: '90%',
  },
  emptyMid: {
    height: 8,
  },
  amount: {
    fontSize: 9,
    textAlign: 'right',
  },
  sheetWrap: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 0,
    zIndex: 40,
    elevation: 8,
  },
  sheetDragZone: {
    alignSelf: 'stretch',
  },
  sheet: {
    borderTopLeftRadius: Radius.sheet,
    borderTopRightRadius: Radius.sheet,
    borderWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: 0,
    paddingHorizontal: Spacing['5xl'],
    paddingTop: Spacing.lg,
    flexDirection: 'column',
  },
  sheetInsightSection: {
    flexShrink: 0,
  },
  sheetTxnScroll: {
    flex: 1,
    minHeight: 0,
  },
  sheetTxnScrollContent: {
    paddingBottom: Spacing.md,
  },
  sheetHandleTapArea: {
    alignSelf: 'center',
    paddingTop: 2,
    paddingBottom: 10,
    paddingHorizontal: 12,
    marginBottom: 6,
  },
  sheetHandle: {
    width: 48,
    height: 5,
    borderRadius: 999,
    alignSelf: 'center',
  },
  sheetHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  sheetDate: {
    marginTop: Spacing.xs,
  },
  sheetTotal: {
    fontSize: 20,
    fontWeight: '900',
  },
  txnRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 14,
  },
  txnIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  txnMain: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  txnMainWithBorder: {
    borderLeftWidth: 4,
    paddingLeft: 10,
  },
  txnTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  txnTextCol: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  txnTitle: {
    fontSize: 15,
    fontWeight: '800',
  },
  txnMeta: {
    fontSize: 12,
    fontWeight: '600',
  },
  txnInsightTag: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 10,
    marginTop: 6,
    maxWidth: '100%',
  },
  txnInsightText: {
    flexShrink: 1,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.4,
    lineHeight: 14,
  },
  txnAmount: {
    fontSize: 15,
    fontWeight: '900',
    flexShrink: 0,
    paddingTop: 1,
  },
  insightCard: {
    borderRadius: Radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing['2xl'],
    gap: Spacing.md,
  },
  sheetDivider: {
    height: 1,
    marginTop: Spacing.xl,
    marginBottom: Spacing['2xl'],
    opacity: 0.9,
  },
  insightHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  insightBody: {
    lineHeight: 19,
  },
  emptyTxnWrap: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginBottom: 12,
  },
  emptyTxnText: {
    fontSize: 13,
    fontWeight: '700',
  },
  modalMask: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing['5xl'],
  },
  pickerCard: {
    width: '100%',
    borderRadius: Radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing['3xl'],
    gap: Spacing.xl,
  },
  pickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pickLabel: {
    width: 30,
    fontSize: 13,
    fontWeight: '700',
  },
  pickBtn: {
    width: 30,
    height: 30,
    borderRadius: Radius.icon,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickValue: {
    minWidth: 72,
    textAlign: 'center',
  },
  pickFooter: {
    marginTop: Spacing.md,
    flexDirection: 'row',
    gap: Spacing.lg,
  },
  pickActionBtn: {
    flex: 1,
  },
});
