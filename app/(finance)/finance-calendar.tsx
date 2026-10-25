import {
  FoldRiseIn,
  FOLD_MOTION_EASE,
  FOLD_MOTION_SPRING,
  useFoldMotionGate,
} from '@/components/review/fold-motion';
import { Layout, Spacing } from '@/constants/design-tokens';
import { useFinanceFoldTheme } from '@/constants/finance-fold-theme';
import { usePageDayBoundary } from '@/contexts/day-boundary-context';
import { usePullToRefresh } from '@/hooks/use-pull-to-refresh';
import { formatYmd } from '@/lib/date';
import { fetchFinanceDailySummaries, fetchFinanceTransactionsRange } from '@/lib/finance-page-api';
import { runPageApiLoad } from '@/lib/page-api-session';
import type { FinanceDailySummaryRow, FinanceTransactionRow } from '@/lib/repositories/finance/finance.types';
import { refreshYmdFocusAfterLogicalDayChange } from '@/lib/tasks-logical-day';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router/react-navigation';
import { useRouter } from 'expo-router';
import React from 'react';
import {
  Animated,
  Easing,
  FlatList,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
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
  title: string;
  meta: string;
  displayAmount: number;
  transactionType: FinanceTransactionRow['transaction_type'];
  insight?: string;
};

const weekTitles = ['一', '二', '三', '四', '五', '六', '日'];
const weekdayCn = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const MONTH_PAGE_SPAN = 481;
const MONTH_PAGE_CENTER_INDEX = Math.floor(MONTH_PAGE_SPAN / 2);

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
    const ymd = formatYmd(d);
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

function txnFlowLabel(type: FinanceTransactionRow['transaction_type']) {
  if (type === 'income') return '收入';
  if (type === 'expense') return '支出';
  if (type === 'transfer') return '转账';
  return '流水';
}

function txnToUi(row: FinanceTransactionRow): Txn {
  const trimmed = row.ai_comment?.trim();
  return {
    id: row.id,
    title: row.name,
    meta: `${txnFlowLabel(row.transaction_type)} · ${formatTimeHHmm(row.happened_at)}`,
    displayAmount: getTxnDisplayAmount(row),
    transactionType: row.transaction_type,
    insight: trimmed ? trimmed : undefined,
  };
}

function formatMoney(amount: number) {
  return `¥${Math.abs(amount).toLocaleString('zh-CN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

function formatSignedMoney(amount: number) {
  if (!Number.isFinite(amount) || Math.abs(amount) < 0.005) return '¥0.00';
  const sign = amount > 0 ? '+' : '−';
  return `${sign}¥${Math.abs(amount).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function ledgerInitial(name: string) {
  const t = name.trim();
  if (!t) return '记';
  return t.slice(0, 1);
}

/** 选中日格涟漪环：1.8s scale .92→1.12 + 透明度衰减，对齐设计稿 calRipple */
function CalDayRipple({ active, color }: { active: boolean; color: string }) {
  const { animate } = useFoldMotionGate();
  const progress = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    if (!active || !animate) {
      progress.stopAnimation();
      progress.setValue(0);
      return;
    }
    progress.setValue(0);
    const loop = Animated.loop(
      Animated.timing(progress, {
        toValue: 1,
        duration: 1800,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [active, animate, progress]);

  if (!active || !animate) return null;

  const scale = progress.interpolate({
    inputRange: [0, 0.7, 1],
    outputRange: [0.92, 1.08, 1.12],
  });
  const opacity = progress.interpolate({
    inputRange: [0, 0.7, 1],
    outputRange: [0.8, 0.25, 0],
  });

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.calRipple,
        {
          borderColor: color,
          opacity,
          transform: [{ scale }],
        },
      ]}
    />
  );
}

const FinanceMonthPage = React.memo(function FinanceMonthPage(props: {
  offset: number;
  todayMonthStart: Date;
  today: Date;
  calendarWidth: number;
  dayCellH: number;
  selectedDate: Date | null;
  setSelectedDate: (d: Date) => void;
  setSheetSnap: (v: 'half' | 'full') => void;
  setSheetVisible: (v: boolean) => void;
  calendarRefreshKey: number;
  reportStats: boolean;
  onMonthStats: (stats: { income: number; expense: number; net: number; daysWithTxn: number; rhythm: number[] }) => void;
  pine: string;
  ink: string;
  muted: string;
  faint: string;
  line: string;
  card: string;
  incomeDot: string;
  expenseDot: string;
  isDark: boolean;
  monoFont?: string;
}) {
  const {
    offset,
    todayMonthStart,
    today,
    calendarWidth,
    dayCellH,
    selectedDate,
    setSelectedDate,
    setSheetSnap,
    setSheetVisible,
    calendarRefreshKey,
    reportStats,
    onMonthStats,
    pine,
    ink,
    muted,
    faint,
    line,
    card,
    incomeDot,
    expenseDot,
    isDark,
    monoFont,
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
        const { days: rows } = await fetchFinanceDailySummaries({
          start: formatYmd(gridStart),
          end: formatYmd(gridEnd),
          serverFallback: true,
        });
        if (cancelled) return;
        const map = new Map<string, FinanceDailySummaryRow>();
        for (const r of rows) {
          const day = typeof r.day === 'string' ? r.day.slice(0, 10) : '';
          if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
          map.set(day, r);
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

  React.useEffect(() => {
    if (!reportStats) return;
    let income = 0;
    let expense = 0;
    let daysWithTxn = 0;
    const daysInMonth = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0).getDate();
    const rhythm: number[] = [];
    for (let day = 1; day <= daysInMonth; day++) {
      const ymd = formatYmd(new Date(monthDate.getFullYear(), monthDate.getMonth(), day));
      const row = dailyMap.get(ymd);
      const inc = row?.income ?? 0;
      const exp = row?.expense ?? 0;
      income += inc;
      expense += exp;
      const flow = inc + exp;
      if (flow > 0) daysWithTxn += 1;
      rhythm.push(flow);
    }
    onMonthStats({ income, expense, net: income - expense, daysWithTxn, rhythm });
  }, [dailyMap, monthDate, onMonthStats, reportStats]);

  const cellW = Math.floor((calendarWidth - 4) / 7);

  return (
    <View style={[styles.calendarPage, { width: calendarWidth }]}>
      <View style={styles.calGrid}>
        {cells.map((item) => {
          const isToday = isSameDay(item.date, today);
          const isSel = selectedDate ? isSameDay(item.date, selectedDate) : false;
          const hasIncome = item.income > 0;
          const hasExpense = item.expense > 0;
          const hasData = hasIncome || hasExpense;
          const mutedDay = !item.inCurrentMonth;

          return (
            <Pressable
              key={item.key}
              onPress={() => {
                setSelectedDate(item.date);
                if (hasData || item.inCurrentMonth) {
                  setSheetSnap('half');
                  setSheetVisible(true);
                }
              }}
              style={[
                styles.calDay,
                {
                  width: cellW,
                  height: dayCellH,
                  backgroundColor: isSel
                    ? pine
                    : isToday
                      ? isDark
                        ? 'rgba(134,167,149,0.14)'
                        : '#F4F8F5'
                      : 'transparent',
                  borderColor: isSel ? pine : isToday ? (isDark ? line : '#C9D9CF') : 'transparent',
                  borderWidth: isToday || isSel ? 1 : 0,
                },
                isSel && styles.calDaySelShadow,
              ]}
              accessibilityRole="button"
              accessibilityState={{ selected: isSel }}
              accessibilityLabel={`${item.date.getMonth() + 1}月${item.date.getDate()}日`}>
              {isSel ? <CalDayRipple active color="rgba(134,167,149,0.55)" /> : null}
              <Text
                style={[
                  styles.calDayNum,
                  {
                    color: isSel ? '#F7F0E0' : mutedDay ? faint : ink,
                    fontFamily: monoFont,
                    opacity: mutedDay && !isSel ? 0.55 : 1,
                  },
                ]}>
                {item.date.getDate()}
              </Text>
              <View style={styles.calDots}>
                {hasExpense ? (
                  <View
                    style={[
                      styles.calDot,
                      { backgroundColor: isSel ? '#F0B69F' : expenseDot },
                    ]}
                  />
                ) : null}
                {hasIncome ? (
                  <View
                    style={[
                      styles.calDot,
                      { backgroundColor: isSel ? '#A9D1B7' : incomeDot },
                    ]}
                  />
                ) : null}
                {!hasData ? <View style={styles.calDotSpacer} /> : null}
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
});

function RhythmBars({
  values,
  animate,
  barColor,
  trackColor,
}: {
  values: number[];
  animate: boolean;
  barColor: string;
  trackColor: string;
}) {
  const max = Math.max(1, ...values);
  const display = values.length > 0 ? values : Array.from({ length: 16 }, () => 0);

  return (
    <View style={styles.rhythmRow}>
      {display.map((v, i) => {
        const h = Math.max(8, Math.round((v / max) * 42));
        return (
          <RhythmBar
            key={`r-${i}`}
            height={h}
            index={i}
            animate={animate && v > 0}
            color={v > 0 ? barColor : trackColor}
          />
        );
      })}
    </View>
  );
}

function RhythmBar({
  height,
  index,
  animate,
  color,
}: {
  height: number;
  index: number;
  animate: boolean;
  color: string;
}) {
  const progress = React.useRef(new Animated.Value(animate ? 0 : 1)).current;

  React.useEffect(() => {
    if (!animate) {
      progress.setValue(1);
      return;
    }
    progress.setValue(0);
    const anim = Animated.timing(progress, {
      toValue: 1,
      duration: 580,
      delay: 70 + index * 35,
      easing: FOLD_MOTION_EASE,
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [animate, index, progress]);

  const scaleY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0.05, 1],
  });

  return (
    <View style={[styles.rhythmBarTrack, { height: 48 }]}>
      <Animated.View
        style={[
          styles.rhythmBar,
          {
            height,
            backgroundColor: color,
            opacity: progress,
            transform: [{ scaleY }],
          },
        ]}
      />
    </View>
  );
}

export default function FinanceCalendarScreen() {
  const router = useRouter();
  const { ff, isDark, fonts: ffFonts } = useFinanceFoldTheme();
  const { animate: foldAnimate } = useFoldMotionGate();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const bg = ff.paper;
  const card = isDark ? ff.paper2 : ff.card;
  const text = ff.ink;
  const subtle = ff.muted;
  const faint = ff.faint;
  const line = ff.line;
  const pine = ff.pine;
  const income = ff.income;
  const expense = ff.expense;
  const headerScrim = isDark ? 'rgba(23,43,36,0.94)' : 'rgba(243,238,228,0.94)';
  const incomeDot = '#6AA083';
  const expenseDot = '#D17A5D';

  const { logicalTodayYmd, logicalTodayDate: today } = usePageDayBoundary('finance');
  const todayMonthStart = React.useMemo(() => monthStart(today), [today]);
  const [monthOffset, setMonthOffset] = React.useState(0);
  const [visibleMonthOffset, setVisibleMonthOffset] = React.useState(0);
  const [selectedDate, setSelectedDate] = React.useState<Date | null>(null);
  const [sheetVisible, setSheetVisible] = React.useState(false);
  const [sheetSnap, setSheetSnap] = React.useState<'half' | 'full'>('half');

  const [pickerVisible, setPickerVisible] = React.useState(false);
  const [pickYear, setPickYear] = React.useState(() => today.getFullYear());
  const [pickMonth, setPickMonth] = React.useState(() => today.getMonth() + 1);
  const [pickDay, setPickDay] = React.useState(() => today.getDate());

  const prevLogicalTodayYmdRef = React.useRef(logicalTodayYmd);
  React.useEffect(() => {
    const prev = prevLogicalTodayYmdRef.current;
    if (prev === logicalTodayYmd) return;
    prevLogicalTodayYmdRef.current = logicalTodayYmd;
    setSelectedDate((sel) => {
      const selYmd = formatYmd(sel ?? today);
      const nextYmd = refreshYmdFocusAfterLogicalDayChange(selYmd, logicalTodayYmd, prev);
      if (nextYmd === selYmd && sel != null) return sel;
      return today;
    });
    setMonthOffset(0);
    setVisibleMonthOffset(0);
    setPickYear(today.getFullYear());
    setPickMonth(today.getMonth() + 1);
    setPickDay(today.getDate());
  }, [logicalTodayYmd, today]);

  const [calendarWidth, setCalendarWidth] = React.useState(() => Math.max(1, windowWidth - 32 - 22));
  const pagerRef = React.useRef<FlatList<number>>(null);
  const pagerCurrentIndexRef = React.useRef(MONTH_PAGE_CENTER_INDEX);
  const pagerWidthReadyRef = React.useRef(false);
  const pagerData = React.useMemo(
    () => Array.from({ length: MONTH_PAGE_SPAN }, (_, i) => i - MONTH_PAGE_CENTER_INDEX),
    [],
  );
  const visibleMonth = React.useMemo(
    () => addMonths(todayMonthStart, visibleMonthOffset),
    [todayMonthStart, visibleMonthOffset],
  );

  const dayCellH = 44;
  const activeDate = selectedDate ?? today;
  const [activeTxns, setActiveTxns] = React.useState<Txn[]>([]);
  const [dayTotal, setDayTotal] = React.useState(0);
  const [calendarRefreshKey, setCalendarRefreshKey] = React.useState(0);
  const [monthStats, setMonthStats] = React.useState({
    income: 0,
    expense: 0,
    net: 0,
    daysWithTxn: 0,
    rhythm: [] as number[],
  });

  const onMonthStats = React.useCallback(
    (stats: { income: number; expense: number; net: number; daysWithTxn: number; rhythm: number[] }) => {
      setMonthStats(stats);
    },
    [],
  );

  const reloadDayTxns = React.useCallback(async (date: Date) => {
    try {
      const ymd = formatYmd(date);
      const { transactions: rows } = await fetchFinanceTransactionsRange({
        start: ymd,
        end: ymd,
        serverFallback: true,
      });
      const ui = rows.map((row) => txnToUi(row));
      setActiveTxns(ui);
      setDayTotal(
        ui.reduce((sum, t) => (t.transactionType === 'transfer' ? sum : sum + t.displayAmount), 0),
      );
      if (ui.length > 0) {
        setSheetSnap('half');
        setSheetVisible(true);
      }
    } catch {
      setActiveTxns([]);
      setDayTotal(0);
    }
  }, []);

  const reload = React.useCallback(async () => {
    setCalendarRefreshKey((k) => k + 1);
    await reloadDayTxns(activeDate);
  }, [activeDate, reloadDayTxns]);

  const { refreshControl } = usePullToRefresh(reload);

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

  const dayCounts = React.useMemo(() => {
    let expenseN = 0;
    let incomeN = 0;
    for (const t of activeTxns) {
      if (t.transactionType === 'expense') expenseN += 1;
      if (t.transactionType === 'income') incomeN += 1;
    }
    return { expenseN, incomeN };
  }, [activeTxns]);

  const dayAiText = React.useMemo(() => {
    const withInsight = activeTxns.filter((t) => t.insight);
    if (activeTxns.length === 0) {
      return '这一天还没有流水。记账后可在此回看合计与 AI 点评。';
    }
    if (withInsight.length === 0) {
      return `当日共 ${activeTxns.length} 笔流水，暂无 AI 点评。在首页智能记账后点评会同步到这里。`;
    }
    if (withInsight.length === 1) {
      return withInsight[0]!.insight!;
    }
    return `当日 ${withInsight.length}/${activeTxns.length} 笔含 AI 点评：${withInsight[0]!.insight}`;
  }, [activeTxns]);

  const coverageTag = React.useMemo(() => {
    const exp = activeTxns
      .filter((t) => t.transactionType === 'expense')
      .reduce((s, t) => s + Math.abs(t.displayAmount), 0);
    const inc = activeTxns
      .filter((t) => t.transactionType === 'income')
      .reduce((s, t) => s + Math.abs(t.displayAmount), 0);
    if (inc > 0 && exp > 0) {
      const ratio = Math.round(inc / Math.max(exp, 0.01));
      return `收入覆盖 ${ratio}×`;
    }
    if (inc > 0 && exp === 0) return '纯收入日';
    if (exp > 0 && inc === 0) return '纯支出日';
    return null;
  }, [activeTxns]);

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
    setSheetVisible(true);
    setPickerVisible(false);
  };

  const changePick = (type: 'y' | 'm' | 'd', delta: number) => {
    if (type === 'y') setPickYear((v) => Math.max(1990, Math.min(2099, v + delta)));
    if (type === 'm') setPickMonth((v) => Math.max(1, Math.min(12, v + delta)));
    if (type === 'd') setPickDay((v) => Math.max(1, Math.min(31, v + delta)));
  };

  const sheetMaxHeight = Math.max(340, Math.floor(windowHeight * 0.58));
  const halfOpenOffset = Math.min(120, Math.max(48, Math.floor(windowHeight * 0.08)));
  const sheetTranslateY = React.useRef(new Animated.Value(sheetMaxHeight)).current;
  const scrimOpacity = React.useRef(new Animated.Value(0)).current;
  const [sheetMounted, setSheetMounted] = React.useState(false);

  const animateSheetClosed = React.useCallback(() => {
    Animated.parallel([
      Animated.timing(sheetTranslateY, {
        toValue: sheetMaxHeight + 40,
        duration: 280,
        easing: FOLD_MOTION_EASE,
        useNativeDriver: true,
      }),
      Animated.timing(scrimOpacity, {
        toValue: 0,
        duration: 220,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished) {
        setSheetVisible(false);
        setSheetMounted(false);
        setSheetSnap('half');
      }
    });
  }, [scrimOpacity, sheetMaxHeight, sheetTranslateY]);

  const animateSheetTo = React.useCallback(
    (toValue: number) => {
      Animated.timing(sheetTranslateY, {
        toValue,
        duration: 380,
        easing: FOLD_MOTION_SPRING,
        useNativeDriver: true,
      }).start();
    },
    [sheetTranslateY],
  );

  React.useEffect(() => {
    if (!sheetVisible) return;
    setSheetMounted(true);
    sheetTranslateY.stopAnimation();
    scrimOpacity.stopAnimation();
    if (!foldAnimate) {
      sheetTranslateY.setValue(sheetSnap === 'full' ? 0 : halfOpenOffset);
      scrimOpacity.setValue(1);
      return;
    }
    sheetTranslateY.setValue(sheetMaxHeight + 40);
    scrimOpacity.setValue(0);
    requestAnimationFrame(() => {
      Animated.parallel([
        Animated.timing(scrimOpacity, {
          toValue: 1,
          duration: 280,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(sheetTranslateY, {
          toValue: sheetSnap === 'full' ? 0 : halfOpenOffset,
          duration: 380,
          easing: FOLD_MOTION_SPRING,
          useNativeDriver: true,
        }),
      ]).start();
    });
  }, [
    foldAnimate,
    halfOpenOffset,
    scrimOpacity,
    sheetMaxHeight,
    sheetSnap,
    sheetTranslateY,
    sheetVisible,
  ]);

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
            animateSheetClosed();
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
    [animateSheetClosed, animateSheetTo, halfOpenOffset, sheetMaxHeight, sheetSnap, sheetTranslateY],
  );

  React.useEffect(() => {
    const nextWidth = Math.max(1, windowWidth - 32 - 22);
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
      setSelectedDate(today);
      setMonthOffset(0);
      setVisibleMonthOffset(0);
      setPickYear(today.getFullYear());
      setPickMonth(today.getMonth() + 1);
      setPickDay(today.getDate());
    }, [today]),
  );

  const motionOn = foldAnimate;
  const sheetTitleDate = selectedDate ?? today;
  const isSelectedToday = isSameDay(sheetTitleDate, today);
  const sheetHeadTitle = `${sheetTitleDate.getMonth() + 1}月${sheetTitleDate.getDate()}日 · ${
    isSelectedToday ? '今日流水' : '当日流水'
  }`;
  const sheetHeadSub = `${weekdayCn[sheetTitleDate.getDay()]}${
    dayCounts.expenseN || dayCounts.incomeN
      ? ` · ${dayCounts.expenseN ? `${dayCounts.expenseN} 笔支出` : ''}${
          dayCounts.expenseN && dayCounts.incomeN ? '，' : ''
        }${dayCounts.incomeN ? `${dayCounts.incomeN} 笔收入` : ''}`
      : ' · 暂无流水'
  }`;

  const onOpenTxn = React.useCallback(
    (id: string) => {
      router.push({ pathname: '/edit-finance-transaction/[id]', params: { id } });
    },
    [router],
  );

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: bg }]} edges={['left', 'right']}>
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
          <Pressable
            onPress={openPicker}
            style={styles.headerCenter}
            accessibilityRole="button"
            accessibilityLabel="选择日期">
            <Text style={[styles.headerTitle, { color: text, fontFamily: ffFonts.serif }]}>财务日历</Text>
            <Text style={[styles.headerSub, { color: subtle }]}>回看，不打扰</Text>
          </Pressable>
          <Pressable
            onPress={() => router.push('/finance-stats')}
            style={({ pressed }) => [
              styles.pillBtn,
              {
                borderColor: ff.line2,
                backgroundColor: isDark ? ff.cardSoft : 'rgba(255,252,245,0.66)',
              },
              pressed && { opacity: 0.85 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="统计">
            <Text style={[styles.pillBtnText, { color: ff.ink2 }]}>统计</Text>
            <MaterialIcons name="chevron-right" size={14} color={ff.ink2} />
          </Pressable>
        </View>
      </View>

      <View style={styles.mainArea}>
        <ScrollView
          refreshControl={refreshControl}
          contentContainerStyle={[
            styles.scrollContent,
            {
              paddingBottom: sheetMounted ? sheetMaxHeight * 0.45 : 40 + insets.bottom,
              maxWidth: Layout.contentMaxWidth,
              alignSelf: 'center',
              width: '100%',
            },
          ]}
          showsVerticalScrollIndicator={false}>
          <FoldRiseIn animate={motionOn} index={0} fromY={11}>
            <View
              style={[styles.calWrap, { backgroundColor: card, borderColor: line }]}
              onLayout={(e) => {
                const w = e.nativeEvent.layout.width - 22;
                setCalendarWidth((prev) => (Math.abs(prev - w) < 1 ? prev : Math.max(1, w)));
              }}>
              <View style={styles.calTop}>
                <Pressable onPress={openPicker} hitSlop={8}>
                  <Text style={[styles.calTitle, { color: '#34463C', fontFamily: ffFonts.mono }]}>
                    {visibleMonth.getFullYear()} 年 {visibleMonth.getMonth() + 1} 月
                  </Text>
                </Pressable>
                <View style={styles.calNav}>
                  <Pressable
                    onPress={() => setMonthOffset((p) => p - 1)}
                    style={({ pressed }) => [
                      styles.calNavBtn,
                      {
                        backgroundColor: isDark ? ff.paper2 : '#F5F0E5',
                        borderColor: isDark ? line : '#E5DBC9',
                      },
                      pressed && { opacity: 0.75 },
                    ]}
                    accessibilityLabel="上个月">
                    <MaterialIcons name="chevron-left" size={18} color="#6B776F" />
                  </Pressable>
                  <Pressable
                    onPress={() => setMonthOffset((p) => p + 1)}
                    style={({ pressed }) => [
                      styles.calNavBtn,
                      {
                        backgroundColor: isDark ? ff.paper2 : '#F5F0E5',
                        borderColor: isDark ? line : '#E5DBC9',
                      },
                      pressed && { opacity: 0.75 },
                    ]}
                    accessibilityLabel="下个月">
                    <MaterialIcons name="chevron-right" size={18} color="#6B776F" />
                  </Pressable>
                </View>
              </View>

              <View style={styles.calWeek}>
                {weekTitles.map((w) => (
                  <Text key={w} style={[styles.calWeekText, { color: faint, width: Math.floor(calendarWidth / 7) }]}>
                    {w}
                  </Text>
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
                getItemLayout={(_, index) => ({
                  length: calendarWidth,
                  offset: calendarWidth * index,
                  index,
                })}
                showsHorizontalScrollIndicator={false}
                keyExtractor={(offset) => `finance-month-${offset}`}
                windowSize={5}
                maxToRenderPerBatch={3}
                updateCellsBatchingPeriod={16}
                removeClippedSubviews
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
                    pagerRef.current?.scrollToOffset({
                      offset: info.index * calendarWidth,
                      animated: false,
                    });
                  });
                }}
                renderItem={({ item: offset }) => (
                  <FinanceMonthPage
                    offset={offset}
                    todayMonthStart={todayMonthStart}
                    today={today}
                    calendarWidth={calendarWidth}
                    dayCellH={dayCellH}
                    selectedDate={selectedDate}
                    setSelectedDate={setSelectedDate}
                    setSheetSnap={setSheetSnap}
                    setSheetVisible={setSheetVisible}
                    calendarRefreshKey={calendarRefreshKey}
                    reportStats={offset === visibleMonthOffset}
                    onMonthStats={onMonthStats}
                    pine={pine}
                    ink={text}
                    muted={subtle}
                    faint={faint}
                    line={line}
                    card={card}
                    incomeDot={incomeDot}
                    expenseDot={expenseDot}
                    isDark={isDark}
                    monoFont={ffFonts.mono}
                  />
                )}
              />

              <View style={[styles.monthSummary, { borderTopColor: isDark ? line : '#ECE4D6' }]}>
                <View style={styles.ms}>
                  <Text style={[styles.msLabel, { color: faint }]}>本月收入</Text>
                  <Text style={[styles.msVal, { color: income, fontFamily: ffFonts.mono }]}>
                    {formatMoney(monthStats.income)}
                  </Text>
                </View>
                <View style={styles.ms}>
                  <Text style={[styles.msLabel, { color: faint }]}>本月支出</Text>
                  <Text style={[styles.msVal, { color: expense, fontFamily: ffFonts.mono }]}>
                    {formatMoney(monthStats.expense)}
                  </Text>
                </View>
                <View style={styles.ms}>
                  <Text style={[styles.msLabel, { color: faint }]}>结余</Text>
                  <Text style={[styles.msVal, { color: pine, fontFamily: ffFonts.mono }]}>
                    {formatMoney(monthStats.net)}
                  </Text>
                </View>
              </View>
            </View>
          </FoldRiseIn>

          <FoldRiseIn animate={motionOn} index={1} fromY={11}>
            <View style={styles.sectionH}>
              <Text style={[styles.sectionHT, { color: subtle }]}>Month rhythm / 记账节奏</Text>
              <Text style={[styles.sectionHA, { color: faint }]}>已记 {monthStats.daysWithTxn} 天</Text>
            </View>
            <View style={[styles.rhythmCard, { backgroundColor: card, borderColor: line }]}>
              <RhythmBars
                values={monthStats.rhythm}
                animate={motionOn}
                barColor={isDark ? ff.sage : '#C9DDCF'}
                trackColor={isDark ? 'rgba(255,255,255,0.06)' : '#E9EFE8'}
              />
            </View>
          </FoldRiseIn>
        </ScrollView>
      </View>

      {sheetMounted ? (
        <>
          <Animated.View
            pointerEvents={sheetVisible ? 'auto' : 'none'}
            style={[styles.scrim, { opacity: scrimOpacity, backgroundColor: 'rgba(23,34,28,0.38)' }]}>
            <Pressable style={StyleSheet.absoluteFill} onPress={animateSheetClosed} accessibilityLabel="关闭" />
          </Animated.View>

          <Animated.View
            style={[
              styles.sheetWrap,
              {
                transform: [{ translateY: sheetTranslateY }],
                paddingBottom: Math.max(16, insets.bottom),
              },
            ]}
            pointerEvents="box-none">
            <View
              style={[
                styles.sheet,
                {
                  backgroundColor: card,
                  borderColor: line,
                  height: sheetMaxHeight,
                },
              ]}>
              <View {...panResponder.panHandlers} style={styles.sheetDragZone}>
                <Pressable
                  onPress={() => {
                    const next = sheetSnap === 'half' ? 'full' : 'half';
                    setSheetSnap(next);
                    animateSheetTo(next === 'full' ? 0 : halfOpenOffset);
                  }}
                  style={styles.sheetHandleTap}>
                  <View style={[styles.sheetHandle, { backgroundColor: faint }]} />
                </Pressable>
              </View>

              <View style={styles.sheetHead}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[styles.sheetTitle, { color: text, fontFamily: ffFonts.serif }]} numberOfLines={1}>
                    {sheetHeadTitle}
                  </Text>
                  <Text style={[styles.sheetSub, { color: subtle }]} numberOfLines={1}>
                    {sheetHeadSub}
                  </Text>
                </View>
                <Pressable
                  onPress={animateSheetClosed}
                  style={({ pressed }) => [
                    styles.sheetClose,
                    { borderColor: line, backgroundColor: isDark ? ff.paper2 : '#F7F2E7' },
                    pressed && { opacity: 0.8 },
                  ]}
                  accessibilityLabel="关闭弹层">
                  <MaterialIcons name="close" size={16} color={ff.ink2} />
                </Pressable>
              </View>

              <View style={[styles.dayTotal, { borderBottomColor: isDark ? line : '#ECE4D6' }]}>
                <View style={styles.dayTotalLeft}>
                  <Text style={[styles.dayTotalLab, { color: faint }]}>当日净额</Text>
                  <Text
                    style={[
                      styles.dayTotalVal,
                      {
                        color: dayTotal >= 0 ? pine : expense,
                        fontFamily: ffFonts.mono,
                      },
                    ]}>
                    {formatSignedMoney(dayTotal)}
                  </Text>
                </View>
                {coverageTag ? (
                  <View style={[styles.tagGreen, { backgroundColor: isDark ? ff.sage2 : '#E7EFE9' }]}>
                    <Text style={{ color: income, fontSize: 11, fontWeight: '700' }}>{coverageTag}</Text>
                  </View>
                ) : null}
              </View>

              <View
                style={[
                  styles.aiInsight,
                  {
                    backgroundColor: isDark ? ff.amber2 : '#F3EDE0',
                    borderColor: isDark ? line : '#E8D9BF',
                  },
                ]}>
                <MaterialIcons name="auto-awesome" size={14} color={ff.amberInk} style={{ marginTop: 1 }} />
                <Text style={[styles.aiInsightText, { color: isDark ? ff.ink2 : '#6D6658' }]}>
                  <Text style={{ fontWeight: '750', color: isDark ? text : '#514B40' }}>AI 洞察：</Text>
                  {dayAiText}
                </Text>
              </View>

              <ScrollView
                style={styles.sheetTxnScroll}
                contentContainerStyle={styles.sheetTxnScrollContent}
                showsVerticalScrollIndicator={false}
                nestedScrollEnabled>
                {activeTxns.length === 0 ? (
                  <Text style={[styles.emptyNote, { color: faint }]}>当日暂无流水</Text>
                ) : (
                  activeTxns.map((txn, i) => {
                    const amtColor =
                      txn.transactionType === 'income'
                        ? income
                        : txn.transactionType === 'expense'
                          ? expense
                          : subtle;
                    const icBg =
                      txn.transactionType === 'income'
                        ? isDark
                          ? 'rgba(106,160,131,0.22)'
                          : '#E7EFE9'
                        : txn.transactionType === 'expense'
                          ? isDark
                            ? 'rgba(198,106,76,0.2)'
                            : '#F4E4DC'
                          : isDark
                            ? 'rgba(255,255,255,0.08)'
                            : '#F0EBE0';
                    return (
                      <FoldRiseIn key={txn.id} animate={motionOn && sheetVisible} index={i} staggerMs={45} delayMs={60} fromY={8}>
                        <Pressable
                          onPress={() => onOpenTxn(txn.id)}
                          style={({ pressed }) => [
                            styles.ledgerRow,
                            i < activeTxns.length - 1
                              ? {
                                  borderBottomWidth: StyleSheet.hairlineWidth,
                                  borderBottomColor: isDark ? line : '#ECE4D6',
                                }
                              : null,
                            pressed && { opacity: 0.82 },
                          ]}
                          accessibilityRole="button"
                          accessibilityLabel={`编辑 ${txn.title}`}>
                          <View style={[styles.ledgerIc, { backgroundColor: icBg }]}>
                            <Text style={[styles.ledgerIcText, { color: amtColor }]}>
                              {ledgerInitial(txn.title)}
                            </Text>
                          </View>
                          <View style={styles.ledgerMain}>
                            <Text style={[styles.ledgerTitle, { color: text }]} numberOfLines={1}>
                              {txn.title}
                            </Text>
                            <Text style={[styles.ledgerMeta, { color: faint }]} numberOfLines={1}>
                              {txn.meta}
                            </Text>
                          </View>
                          <Text style={[styles.ledgerAmt, { color: amtColor, fontFamily: ffFonts.mono }]}>
                            {formatSignedMoney(txn.displayAmount)}
                          </Text>
                        </Pressable>
                      </FoldRiseIn>
                    );
                  })
                )}
                <Text style={[styles.readOnlyNote, { color: faint }]}>
                  本页只回看 · 点击流水可去编辑
                </Text>
              </ScrollView>
            </View>
          </Animated.View>
        </>
      ) : null}

      <Modal transparent visible={pickerVisible} animationType="fade" onRequestClose={() => setPickerVisible(false)}>
        <Pressable
          style={[styles.modalMask, { backgroundColor: 'rgba(29,41,35,0.42)' }]}
          onPress={() => setPickerVisible(false)}>
          <Pressable
            style={[styles.pickerCard, { backgroundColor: card, borderColor: line }]}
            onPress={(e) => e.stopPropagation()}>
            <Text style={[styles.pickerTitle, { color: text, fontFamily: ffFonts.serif }]}>选择日期</Text>
            {(
              [
                { key: 'y' as const, label: '年', value: pickYear },
                { key: 'm' as const, label: '月', value: pickMonth },
                { key: 'd' as const, label: '日', value: pickDay },
              ] as const
            ).map((row) => (
              <View key={row.key} style={styles.pickRow}>
                <Text style={[styles.pickLabel, { color: subtle }]}>{row.label}</Text>
                <Pressable
                  style={[styles.pickBtn, { backgroundColor: isDark ? ff.paper2 : '#F5F0E5' }]}
                  onPress={() => changePick(row.key, -1)}>
                  <MaterialIcons name="remove" size={18} color={text} />
                </Pressable>
                <Text style={[styles.pickValue, { color: text, fontFamily: ffFonts.mono }]}>{row.value}</Text>
                <Pressable
                  style={[styles.pickBtn, { backgroundColor: isDark ? ff.paper2 : '#F5F0E5' }]}
                  onPress={() => changePick(row.key, 1)}>
                  <MaterialIcons name="add" size={18} color={text} />
                </Pressable>
              </View>
            ))}
            <View style={styles.pickFooter}>
              <Pressable
                onPress={() => setPickerVisible(false)}
                style={({ pressed }) => [
                  styles.pickActionGhost,
                  { borderColor: ff.line2, backgroundColor: isDark ? ff.paper2 : '#F7F2E7' },
                  pressed && { opacity: 0.85 },
                ]}>
                <Text style={{ color: '#56645B', fontWeight: '700' }}>取消</Text>
              </Pressable>
              <Pressable
                onPress={confirmPickDate}
                style={({ pressed }) => [
                  styles.pickActionPrimary,
                  { backgroundColor: pine },
                  pressed && { opacity: 0.9 },
                ]}>
                <Text style={{ color: ff.onPine, fontWeight: '700' }}>确定</Text>
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
  header: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    zIndex: 60,
  },
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
  pillBtn: {
    height: 27,
    paddingHorizontal: 10,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  pillBtnText: { fontSize: 12, fontWeight: '700' },
  mainArea: { flex: 1 },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 10,
    gap: 8,
  },
  calWrap: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 11,
    paddingTop: 12,
    paddingBottom: 10,
  },
  calTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  calTitle: { fontSize: 15, fontWeight: '700' },
  calNav: { flexDirection: 'row', gap: 6 },
  calNavBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  calWeek: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  calWeekText: {
    textAlign: 'center',
    fontSize: 11,
    letterSpacing: 0.4,
  },
  calendarPage: {},
  calGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  calDay: {
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    position: 'relative',
  },
  calDaySelShadow: {
    shadowColor: '#1E4034',
    shadowOpacity: 0.22,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  calRipple: {
    ...StyleSheet.absoluteFillObject,
    margin: -4,
    borderRadius: 13,
    borderWidth: 1,
  },
  calDayNum: {
    fontSize: 13,
    fontWeight: '600',
  },
  calDots: {
    flexDirection: 'row',
    gap: 3,
    height: 5,
    alignItems: 'center',
  },
  calDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
  },
  calDotSpacer: {
    width: 4,
    height: 4,
  },
  monthSummary: {
    flexDirection: 'row',
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  ms: { flex: 1, alignItems: 'center' },
  msLabel: { fontSize: 11 },
  msVal: { fontSize: 14, fontWeight: '700', marginTop: 3 },
  sectionH: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
    marginTop: 4,
    marginBottom: 6,
  },
  sectionHT: { fontSize: 12, fontWeight: '700', letterSpacing: 0.2 },
  sectionHA: { fontSize: 11 },
  rhythmCard: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 10,
    height: 64,
    justifyContent: 'flex-end',
  },
  rhythmRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 3,
    height: 48,
  },
  rhythmBarTrack: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  rhythmBar: {
    width: '100%',
    borderRadius: 3,
  },
  scrim: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 40,
  },
  sheetWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 50,
  },
  sheet: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: 0,
    paddingHorizontal: 16,
    overflow: 'hidden',
  },
  sheetDragZone: { alignSelf: 'stretch' },
  sheetHandleTap: {
    alignSelf: 'center',
    paddingTop: 8,
    paddingBottom: 8,
    paddingHorizontal: 16,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 999,
  },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 4,
  },
  sheetTitle: { fontSize: 18, fontWeight: '650' },
  sheetSub: { fontSize: 12, marginTop: 2 },
  sheetClose: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayTotal: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginTop: 10,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  dayTotalLeft: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  dayTotalLab: { fontSize: 12 },
  dayTotalVal: { fontSize: 22, fontWeight: '750' },
  tagGreen: {
    height: 22,
    paddingHorizontal: 8,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  aiInsight: {
    marginTop: 10,
    marginBottom: 6,
    paddingVertical: 10,
    paddingHorizontal: 11,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 8,
  },
  aiInsightText: { flex: 1, fontSize: 12, lineHeight: 18 },
  sheetTxnScroll: { flex: 1, minHeight: 0 },
  sheetTxnScrollContent: { paddingBottom: 12 },
  ledgerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
  },
  ledgerIc: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ledgerIcText: { fontSize: 13, fontWeight: '750' },
  ledgerMain: { flex: 1, minWidth: 0, gap: 2 },
  ledgerTitle: { fontSize: 14, fontWeight: '700' },
  ledgerMeta: { fontSize: 11 },
  ledgerAmt: { fontSize: 14, fontWeight: '750' },
  emptyNote: { textAlign: 'center', paddingVertical: 20, fontSize: 13 },
  readOnlyNote: {
    textAlign: 'center',
    fontSize: 11,
    marginTop: 8,
    marginBottom: 4,
  },
  modalMask: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing['5xl'],
  },
  pickerCard: {
    width: '100%',
    maxWidth: Layout.contentMaxWidth,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 18,
    gap: 14,
  },
  pickerTitle: { fontSize: 17, fontWeight: '650' },
  pickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pickLabel: { width: 28, fontSize: 13, fontWeight: '700' },
  pickBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickValue: { minWidth: 72, textAlign: 'center', fontSize: 16, fontWeight: '700' },
  pickFooter: { flexDirection: 'row', gap: 10, marginTop: 4 },
  pickActionGhost: {
    flex: 1,
    height: 42,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickActionPrimary: {
    flex: 1,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
