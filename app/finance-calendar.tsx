import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
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

/** 与财务首页 `getTxnDisplayAmount` 一致：按收支类型与金额绝对值展示，负债账户的负金额已体现在 `amount` 符号中。 */
function getTxnDisplayAmount(row: FinanceTransactionRow): number {
  const absAmount = Math.abs(row.amount);
  if (row.transaction_type === 'income') return absAmount;
  if (row.transaction_type === 'expense') return -absAmount;
  return row.amount;
}

function txnToUi(row: FinanceTransactionRow): Txn {
  const ymd = row.happened_at.slice(0, 10);
  return {
    id: row.id,
    icon: txnIconByType(row.transaction_type),
    title: row.name,
    meta: `${formatTimeHHmm(row.happened_at)} · ${ymd}`,
    displayAmount: getTxnDisplayAmount(row),
    transactionType: row.transaction_type,
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
  isDark: boolean;
  text: string;
  subtle: string;
  outline: string;
  incomeColor: string;
  expenseColor: string;
  netNegativeColor: string;
  selectedDate: Date | null;
  setSelectedDate: (d: Date) => void;
  setSheetSnap: (v: 'half' | 'full') => void;
  setSheetVisible: (v: boolean) => void;
  getCellBg: (hasData: boolean, isActive: boolean) => string;
}) {
  const {
    offset,
    todayMonthStart,
    calendarWidth,
    dayCellSize,
    isDark,
    text,
    subtle,
    outline,
    incomeColor,
    expenseColor,
    netNegativeColor,
    selectedDate,
    setSelectedDate,
    setSheetSnap,
    setSheetVisible,
    getCellBg,
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
    (async () => {
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
    })();
    return () => {
      cancelled = true;
    };
  }, [gridEnd, gridStart]);

  const cells = React.useMemo(() => buildCalendarCells(monthDate, dailyMap), [dailyMap, monthDate]);

  return (
    <View style={[styles.calendarPage, { width: calendarWidth }]}>
      <View style={[styles.gridWrap, { backgroundColor: isDark ? 'rgba(30,41,59,0.75)' : '#f2f3ff' }]}>
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
                    setSheetSnap('half');
                    setSheetVisible(true);
                  }}
                  style={[
                    styles.dayCell,
                    {
                      width: dayCellSize,
                      height: dayCellSize,
                      backgroundColor: getCellBg(hasData, isActive),
                      borderColor: isActive ? (isDark ? '#f59e0b' : '#d97706') : outline,
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
  const scheme = useColorScheme();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const baseTheme = Colors[scheme ?? 'light'];
  const isDark = scheme === 'dark';

  const today = React.useMemo(() => new Date(), []);
  const todayMonthStart = React.useMemo(() => monthStart(today), [today]);
  const [monthOffset, setMonthOffset] = React.useState(0);
  const [visibleMonthOffset, setVisibleMonthOffset] = React.useState(0);
  const [selectedDate, setSelectedDate] = React.useState<Date | null>(today);
  const [sheetVisible, setSheetVisible] = React.useState(true);

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

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await getFinanceTransactionsByYmd(formatYMD(activeDate));
        if (cancelled) return;
        const ui = rows.map((row) => txnToUi(row));
        setActiveTxns(ui);
        setDayTotal(ui.reduce((sum, t) => sum + t.displayAmount, 0));
      } catch {
        if (cancelled) return;
        setActiveTxns([]);
        setDayTotal(0);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeDate]);

  const bg = isDark ? '#0f172a' : '#faf8ff';
  const surface = isDark ? '#1e293b' : '#ffffff';
  const text = isDark ? '#e2e8f0' : '#131b2e';
  const subtle = isDark ? '#94a3b8' : '#64748b';
  const outline = isDark ? 'rgba(148,163,184,0.20)' : 'rgba(194,198,214,0.45)';
  const titleColor = isDark ? '#fbbf24' : '#b45309';
  const income = isDark ? '#34d399' : '#006c49';
  const expense = isDark ? '#cbd5e1' : '#475569';
  const expenseAmountColor = isDark ? '#f87171' : '#dc2626';

  const formatTopDate = (d: Date) => `${d.getMonth() + 1}月${d.getDate()}日 ${weekdayCn[d.getDay()]}`;

  const getCellBg = (hasAmount: boolean, isActive: boolean) => {
    if (isActive) return isDark ? '#f59e0b' : '#fbbf24';
    if (hasAmount) return isDark ? 'rgba(251,191,36,0.16)' : 'rgba(255,251,235,0.92)';
    return isDark ? 'rgba(30,41,59,0.65)' : '#ffffff';
  };

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
    setSheetSnap('half');
    setSheetVisible(true);
    setPickerVisible(false);
  };

  const changePick = (type: 'y' | 'm' | 'd', delta: number) => {
    if (type === 'y') setPickYear((v) => Math.max(1990, Math.min(2099, v + delta)));
    if (type === 'm') setPickMonth((v) => Math.max(1, Math.min(12, v + delta)));
    if (type === 'd') setPickDay((v) => Math.max(1, Math.min(31, v + delta)));
  };

  const sheetMaxHeight = Math.max(340, Math.floor(windowHeight * 0.6));
  const halfOpenOffset = Math.min(220, Math.max(110, Math.floor(windowHeight * 0.2)));
  const sheetTranslateY = React.useRef(new Animated.Value(halfOpenOffset)).current;
  const [sheetSnap, setSheetSnap] = React.useState<'half' | 'full'>('half');
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
        onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dy) > 8 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
        onPanResponderMove: (_, gesture) => {
          const base = sheetSnap === 'full' ? 0 : halfOpenOffset;
          sheetTranslateY.setValue(Math.max(0, base + gesture.dy));
        },
        onPanResponderRelease: (_, gesture) => {
          if (gesture.dy > 180) {
            setSheetVisible(false);
            return;
          }

          if (gesture.dy < -70) {
            setSheetSnap('full');
            return;
          }

          if (gesture.dy > 70) {
            setSheetSnap('half');
            return;
          }

          animateSheetTo(sheetSnap === 'full' ? 0 : halfOpenOffset);
        },
      }),
    [animateSheetTo, halfOpenOffset, sheetSnap, sheetTranslateY],
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
      setSheetSnap('half');
      setSheetVisible(true);
    }, [todayMonthStart]),
  );

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: bg }]} edges={['top', 'left', 'right']}>
      <View style={[styles.topBar, { backgroundColor: isDark ? 'rgba(15,23,42,0.90)' : 'rgba(255,255,255,0.88)' }]}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.75 }]}>
          <MaterialIcons name="arrow-back-ios-new" size={20} color={text} />
        </Pressable>

        <Pressable onPress={openPicker} style={({ pressed }) => [styles.topDateBtn, pressed && { opacity: 0.75 }]}>
          <Text style={[styles.topBarTitle, { color: titleColor }]}>{formatTopDate(selectedDate ?? today)}</Text>
          <MaterialIcons name="arrow-drop-down" size={20} color={titleColor} />
        </Pressable>

        <View style={styles.topSpacer} />
      </View>

      <Pressable style={styles.mainArea} onPress={() => setSheetVisible(false)}>
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <View style={styles.monthHeader}>
            <View>
              <Text style={[styles.monthTag, { color: subtle }]}>
                {visibleMonth.toLocaleString('en-US', { month: 'long' }).toUpperCase()} {visibleMonth.getFullYear()}
              </Text>
              <Text style={[styles.monthTitle, { color: text }]}>{visibleMonth.getMonth() + 1}月总览</Text>
            </View>
            <View style={styles.monthActions}>
              <Pressable
                onPress={(e) => {
                  e.stopPropagation();
                  setMonthOffset((prev) => prev - 1);
                }}
                style={({ pressed }) => [styles.monthArrowBtn, { backgroundColor: surface }, pressed && { opacity: 0.72 }]}>
                <MaterialIcons name="chevron-left" size={22} color={subtle} />
              </Pressable>
              <Pressable
                onPress={(e) => {
                  e.stopPropagation();
                  setMonthOffset((prev) => prev + 1);
                }}
                style={({ pressed }) => [styles.monthArrowBtn, { backgroundColor: surface }, pressed && { opacity: 0.72 }]}>
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
                  isDark={isDark}
                  text={text}
                  subtle={subtle}
                  outline={outline}
                  incomeColor={income}
                  expenseColor={expense}
                  netNegativeColor={baseTheme.primary}
                  selectedDate={selectedDate}
                  setSelectedDate={setSelectedDate}
                  setSheetSnap={setSheetSnap}
                  setSheetVisible={setSheetVisible}
                  getCellBg={getCellBg}
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
              {
                backgroundColor: surface,
                borderColor: outline,
                height: sheetMaxHeight,
                paddingBottom: Math.max(18, insets.bottom + 10),
              },
            ]}
            {...panResponder.panHandlers}>
            <Pressable
              onPress={() => setSheetSnap((v) => (v === 'half' ? 'full' : 'half'))}
              style={styles.sheetHandleTapArea}>
              <View style={styles.sheetHandle} />
            </Pressable>
            <View style={styles.sheetHeaderRow}>
              <View>
                <Text style={[styles.sheetTitle, { color: text }]}>今日流水</Text>
                <Text style={[styles.sheetDate, { color: subtle }]}>{selectedDate.getMonth() + 1}月{selectedDate.getDate()}日</Text>
              </View>
              <Text style={[styles.sheetTotal, { color: dayTotal >= 0 ? income : titleColor }]}>
                {dayTotal >= 0 ? '+' : ''}{dayTotal.toFixed(2)}
              </Text>
            </View>

            <ScrollView
              style={[styles.sheetScroll, { maxHeight: Math.max(130, sheetMaxHeight - 110) }]}
              contentContainerStyle={styles.sheetScrollContent}
              showsVerticalScrollIndicator={false}
              nestedScrollEnabled>
              <View style={[styles.insightCard, { backgroundColor: isDark ? 'rgba(251,191,36,0.14)' : '#fff7ed', borderColor: isDark ? 'rgba(251,191,36,0.35)' : 'rgba(251,191,36,0.28)' }]}>
                <View style={styles.insightHeader}>
                  <MaterialIcons name="auto-awesome" size={14} color={titleColor} />
                  <Text style={[styles.insightTagText, { color: titleColor }]}>AI 洞察</Text>
                </View>
                <Text style={[styles.insightBody, { color: isDark ? '#fde68a' : '#92400e' }]}>
                  本月餐饮支出已超出过去 3 个月平均值的 12%，建议减少外卖频次以达成存款目标。
                </Text>
              </View>

              <View style={[styles.sheetDivider, { backgroundColor: outline }]} />

              {activeTxns.length === 0 ? (
                <View style={[styles.emptyTxnWrap, { borderColor: outline }]}>
                  <MaterialIcons name="event-note" size={18} color={subtle} />
                  <Text style={[styles.emptyTxnText, { color: subtle }]}>今日暂无流水记录</Text>
                </View>
              ) : (
                activeTxns.map((txn) => (
                  <View key={txn.id} style={styles.txnRow}>
                    <View style={[styles.txnIconWrap, { backgroundColor: isDark ? 'rgba(148,163,184,0.18)' : '#eef2ff' }]}>
                      <MaterialIcons name={txn.icon} size={20} color={titleColor} />
                    </View>
                    <View style={[styles.txnMain, styles.txnMainWithBorder, { borderLeftColor: dayTotal >= 0 ? income : titleColor }]}>
                      <Text style={[styles.txnTitle, { color: text }]}>{txn.title}</Text>
                      <Text style={[styles.txnMeta, { color: subtle }]}>{txn.meta}</Text>
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
                ))
              )}

              <View style={styles.sheetBottomSpacer} />
            </ScrollView>
          </View>
        </Animated.View>
      ) : null}

      <Modal transparent visible={pickerVisible} animationType="fade" onRequestClose={() => setPickerVisible(false)}>
        <Pressable style={styles.modalMask} onPress={() => setPickerVisible(false)}>
          <Pressable style={[styles.pickerCard, { backgroundColor: surface, borderColor: outline }]} onPress={(e) => e.stopPropagation()}>
            <Text style={[styles.pickerTitle, { color: text }]}>选择日期</Text>

            {[
              { key: 'y', label: '年', value: pickYear },
              { key: 'm', label: '月', value: pickMonth },
              { key: 'd', label: '日', value: pickDay },
            ].map((row) => (
              <View key={row.key} style={styles.pickRow}>
                <Text style={[styles.pickLabel, { color: subtle }]}>{row.label}</Text>
                <Pressable style={styles.pickBtn} onPress={() => changePick(row.key as 'y' | 'm' | 'd', -1)}>
                  <MaterialIcons name="remove" size={18} color={text} />
                </Pressable>
                <Text style={[styles.pickValue, { color: text }]}>{row.value}</Text>
                <Pressable style={styles.pickBtn} onPress={() => changePick(row.key as 'y' | 'm' | 'd', 1)}>
                  <MaterialIcons name="add" size={18} color={text} />
                </Pressable>
              </View>
            ))}

            <View style={styles.pickFooter}>
              <Pressable style={[styles.pickAction, { borderColor: outline }]} onPress={() => setPickerVisible(false)}>
                <Text style={[styles.pickActionText, { color: subtle }]}>取消</Text>
              </Pressable>
              <Pressable style={[styles.pickAction, { backgroundColor: baseTheme.primary }]} onPress={confirmPickDate}>
                <Text style={[styles.pickActionText, { color: '#fff' }]}>确定</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  topBar: {
    height: 56,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  iconBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
  },
  topDateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  topBarTitle: {
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: -0.2,
  },
  topSpacer: { width: 36 },
  mainArea: { flex: 1 },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 260,
  },
  monthHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  monthTag: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 2,
  },
  monthTitle: {
    marginTop: 4,
    fontSize: 28,
    fontWeight: '900',
  },
  monthActions: {
    flexDirection: 'row',
    gap: 8,
  },
  monthArrowBtn: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
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
    borderRadius: 18,
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
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 5,
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
  },
  sheet: {
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderWidth: 1,
    borderBottomWidth: 0,
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  sheetScroll: {
    flexGrow: 0,
  },
  sheetScrollContent: {
    paddingBottom: 8,
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
    backgroundColor: 'rgba(148,163,184,0.35)',
    alignSelf: 'center',
  },
  sheetHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  sheetTitle: {
    fontSize: 22,
    fontWeight: '900',
  },
  sheetDate: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: '600',
  },
  sheetTotal: {
    fontSize: 20,
    fontWeight: '900',
  },
  txnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 14,
  },
  txnIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  txnMain: {
    flex: 1,
    gap: 2,
  },
  txnMainWithBorder: {
    borderLeftWidth: 4,
    paddingLeft: 10,
  },
  txnTitle: {
    fontSize: 15,
    fontWeight: '800',
  },
  txnMeta: {
    fontSize: 12,
    fontWeight: '600',
  },
  txnAmount: {
    fontSize: 15,
    fontWeight: '900',
  },
  insightCard: {
    marginTop: 8,
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    gap: 8,
  },
  sheetDivider: {
    height: 1,
    marginTop: 12,
    marginBottom: 14,
    opacity: 0.9,
  },
  insightHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  insightTagText: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  insightBody: {
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
  },
  sheetBottomSpacer: {
    height: 12,
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
    backgroundColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 22,
  },
  pickerCard: {
    width: '100%',
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    gap: 12,
  },
  pickerTitle: {
    fontSize: 18,
    fontWeight: '900',
    marginBottom: 4,
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
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(148,163,184,0.18)',
  },
  pickValue: {
    minWidth: 72,
    textAlign: 'center',
    fontSize: 18,
    fontWeight: '800',
  },
  pickFooter: {
    marginTop: 8,
    flexDirection: 'row',
    gap: 10,
  },
  pickAction: {
    flex: 1,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  pickActionText: {
    fontSize: 14,
    fontWeight: '800',
  },
});
