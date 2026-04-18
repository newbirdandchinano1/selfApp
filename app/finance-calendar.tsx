import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { Animated, Modal, PanResponder, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

type DayCell = {
  key: string;
  date: Date;
  inCurrentMonth: boolean;
  amount?: number;
  bars: number;
  tone: 'empty' | 'veryLight' | 'light' | 'medium' | 'strong';
};

type Txn = {
  icon: keyof typeof MaterialIcons.glyphMap;
  title: string;
  meta: string;
  amount: number;
};

const weekTitles = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const weekdayCn = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

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

function amountByDate(date: Date) {
  const seed = date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
  const hasData = seed % 4 !== 0;
  if (!hasData) return undefined;

  const sign = seed % 5 === 0 ? 1 : -1;
  const val = ((seed % 930) + 12) * sign;
  return Number(val.toFixed(2));
}

function toneByAmount(amount?: number): DayCell['tone'] {
  if (amount === undefined) return 'empty';
  const abs = Math.abs(amount);
  if (abs > 500) return 'strong';
  if (abs > 220) return 'medium';
  if (abs > 90) return 'light';
  return 'veryLight';
}

function barsByAmount(amount?: number) {
  if (amount === undefined) return 0;
  const abs = Math.abs(amount);
  if (abs > 450) return 3;
  if (abs > 150) return 2;
  return 1;
}

function buildCalendarCells(targetMonth: Date): DayCell[] {
  const firstDay = monthStart(targetMonth);
  const mondayStartOffset = (firstDay.getDay() + 6) % 7;
  const gridStart = new Date(firstDay);
  gridStart.setDate(firstDay.getDate() - mondayStartOffset);

  return Array.from({ length: 42 }).map((_, idx) => {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + idx);

    const amount = amountByDate(d);
    return {
      key: formatYMD(d),
      date: d,
      inCurrentMonth: d.getMonth() === targetMonth.getMonth(),
      amount,
      bars: barsByAmount(amount),
      tone: toneByAmount(amount),
    };
  });
}

function txnsByDate(date: Date): Txn[] {
  const seed = date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
  const expenseA = ((seed % 180) + 35).toFixed(2);
  const expenseB = ((seed % 260) + 80).toFixed(2);
  const expenseC = ((seed % 120) + 20).toFixed(2);

  return [
    { icon: 'restaurant', title: '晚餐', meta: '19:24 · 美食广场', amount: -Number(expenseA) },
    { icon: 'laptop-mac', title: 'Apple Store', meta: '14:10 · 线上订阅', amount: -Number(expenseB) },
    { icon: 'local-taxi', title: '滴滴出行', meta: '08:45 · 交通出行', amount: -Number(expenseC) },
  ];
}

export default function FinanceCalendarScreen() {
  const router = useRouter();
  const scheme = useColorScheme();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const baseTheme = Colors[scheme ?? 'light'];
  const isDark = scheme === 'dark';

  const today = React.useMemo(() => new Date(), []);
  const [displayMonth, setDisplayMonth] = React.useState(monthStart(today));
  const [selectedDate, setSelectedDate] = React.useState<Date | null>(today);
  const [sheetVisible, setSheetVisible] = React.useState(true);

  const [pickerVisible, setPickerVisible] = React.useState(false);
  const [pickYear, setPickYear] = React.useState(today.getFullYear());
  const [pickMonth, setPickMonth] = React.useState(today.getMonth() + 1);
  const [pickDay, setPickDay] = React.useState(today.getDate());

  const cells = React.useMemo(() => buildCalendarCells(displayMonth), [displayMonth]);
  const calendarHorizontalPadding = 16;
  const gridInnerPadding = 12;
  const gridGapTotal = 24;
  const calendarInnerWidth = Math.max(280, windowWidth - calendarHorizontalPadding * 2 - gridInnerPadding);
  const dayCellSize = Math.floor((calendarInnerWidth - gridGapTotal) / 7);

  const activeDate = selectedDate ?? today;
  const activeTxns = React.useMemo(() => txnsByDate(activeDate), [activeDate]);
  const dayTotal = activeTxns.reduce((sum, t) => sum + t.amount, 0);

  const bg = isDark ? '#0f172a' : '#faf8ff';
  const surface = isDark ? '#1e293b' : '#ffffff';
  const text = isDark ? '#e2e8f0' : '#131b2e';
  const subtle = isDark ? '#94a3b8' : '#64748b';
  const outline = isDark ? 'rgba(148,163,184,0.20)' : 'rgba(194,198,214,0.45)';
  const titleColor = isDark ? '#fbbf24' : '#b45309';
  const income = isDark ? '#34d399' : '#006c49';

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
    setDisplayMonth(monthStart(nextDate));
    setSheetSnap('half');
    setSheetVisible(true);
    setPickerVisible(false);
  };

  const changePick = (type: 'y' | 'm' | 'd', delta: number) => {
    if (type === 'y') setPickYear((v) => Math.max(1990, Math.min(2099, v + delta)));
    if (type === 'm') setPickMonth((v) => Math.max(1, Math.min(12, v + delta)));
    if (type === 'd') setPickDay((v) => Math.max(1, Math.min(31, v + delta)));
  };

  const halfOpenOffset = Math.min(220, Math.max(120, Math.floor(windowHeight * 0.22)));
  const sheetTranslateY = React.useRef(new Animated.Value(halfOpenOffset)).current;
  const [sheetSnap, setSheetSnap] = React.useState<'half' | 'full'>('half');

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
    animateSheetTo(sheetSnap === 'full' ? 0 : halfOpenOffset);
  }, [animateSheetTo, halfOpenOffset, sheetSnap, sheetVisible]);

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
                {displayMonth.toLocaleString('en-US', { month: 'long' }).toUpperCase()} {displayMonth.getFullYear()}
              </Text>
              <Text style={[styles.monthTitle, { color: text }]}>{displayMonth.getMonth() + 1}月总览</Text>
            </View>
            <View style={styles.monthActions}>
              <Pressable
                onPress={(e) => {
                  e.stopPropagation();
                  setDisplayMonth((m) => addMonths(m, -1));
                }}
                style={({ pressed }) => [styles.monthArrowBtn, { backgroundColor: surface }, pressed && { opacity: 0.72 }]}>
                <MaterialIcons name="chevron-left" size={22} color={subtle} />
              </Pressable>
              <Pressable
                onPress={(e) => {
                  e.stopPropagation();
                  setDisplayMonth((m) => addMonths(m, 1));
                }}
                style={({ pressed }) => [styles.monthArrowBtn, { backgroundColor: surface }, pressed && { opacity: 0.72 }]}>
                <MaterialIcons name="chevron-right" size={22} color={subtle} />
              </Pressable>
            </View>
          </View>

          <View style={styles.weekRow}>
            {weekTitles.map((item) => (
              <Text key={item} style={[styles.weekText, { color: subtle }]}>{item}</Text>
            ))}
          </View>

          <View style={[styles.gridWrap, { backgroundColor: isDark ? 'rgba(30,41,59,0.75)' : '#f2f3ff' }]}>
            {Array.from({ length: 6 }).map((_, row) => (
              <View key={row} style={styles.gridRow}>
                {cells.slice(row * 7, row * 7 + 7).map((item) => {
                  if (!item.inCurrentMonth) {
                    return <View key={item.key} style={[styles.blankCell, { width: dayCellSize, height: dayCellSize }]} />;
                  }

                  const isActive = selectedDate ? isSameDay(item.date, selectedDate) : false;
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
                          backgroundColor: getCellBg(item.amount !== undefined, isActive),
                          borderColor: isActive ? (isDark ? '#f59e0b' : '#d97706') : outline,
                          borderWidth: 1,
                        },
                      ]}
                    >
                      <Text style={[styles.dayNum, { color: text }]}>{item.date.getDate()}</Text>
                      <View style={styles.midArea}>
                        {item.bars > 0 ? (
                          <View style={styles.barsWrap}>
                            {Array.from({ length: item.bars }).map((_, i) => (
                              <View key={i} style={[styles.bar, { backgroundColor: baseTheme.primary, opacity: 0.55 + i * 0.14 }]} />
                            ))}
                          </View>
                        ) : (
                          <View style={styles.emptyMid} />
                        )}
                      </View>
                      <Text
                        style={[
                          styles.amount,
                          {
                            color:
                              item.amount === undefined
                                ? subtle
                                : item.amount > 0
                                  ? income
                                  : isDark
                                    ? '#cbd5e1'
                                    : '#475569',
                            fontWeight: isActive ? '800' : '700',
                          },
                        ]}
                      >
                        {item.amount === undefined ? '--' : `${item.amount > 0 ? '+' : ''}${item.amount.toFixed(2)}`}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </View>
        </ScrollView>
      </Pressable>

      {sheetVisible && selectedDate ? (
        <Animated.View style={[styles.sheetWrap, { transform: [{ translateY: sheetTranslateY }] }]} pointerEvents="box-none">
          <View
            style={[
              styles.sheet,
              {
                backgroundColor: surface,
                borderColor: outline,
                height: Math.min(618, Math.floor(windowHeight * 0.72)),
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
              style={styles.sheetScroll}
              contentContainerStyle={styles.sheetScrollContent}
              showsVerticalScrollIndicator={false}
              nestedScrollEnabled>
              {activeTxns.map((txn) => (
                <View key={`${txn.title}-${txn.meta}`} style={styles.txnRow}>
                  <View style={[styles.txnIconWrap, { backgroundColor: isDark ? 'rgba(148,163,184,0.18)' : '#eef2ff' }]}>
                    <MaterialIcons name={txn.icon} size={20} color={titleColor} />
                  </View>
                  <View style={[styles.txnMain, styles.txnMainWithBorder, { borderLeftColor: dayTotal >= 0 ? income : titleColor }]}>
                    <Text style={[styles.txnTitle, { color: text }]}>{txn.title}</Text>
                    <Text style={[styles.txnMeta, { color: subtle }]}>{txn.meta}</Text>
                  </View>
                  <Text style={[styles.txnAmount, { color: text }]}>{txn.amount >= 0 ? '+' : ''}{txn.amount.toFixed(2)}</Text>
                </View>
              ))}

              <View style={[styles.insightCard, { backgroundColor: isDark ? 'rgba(251,191,36,0.14)' : '#fff7ed', borderColor: isDark ? 'rgba(251,191,36,0.35)' : 'rgba(251,191,36,0.28)' }]}>
                <View style={styles.insightHeader}>
                  <MaterialIcons name="auto-awesome" size={14} color={titleColor} />
                  <Text style={[styles.insightTagText, { color: titleColor }]}>AI 洞察</Text>
                </View>
                <Text style={[styles.insightBody, { color: isDark ? '#fde68a' : '#92400e' }]}>
                  本月餐饮支出已超出过去 3 个月平均值的 12%，建议减少外卖频次以达成存款目标。
                </Text>
              </View>

              <View style={[styles.prevSection, { borderTopColor: outline }]}>
                <Text style={[styles.prevLabel, { color: subtle }]}>昨日 · {selectedDate.getMonth() + 1}月{Math.max(1, selectedDate.getDate() - 1)}日</Text>
                <View style={styles.txnRow}>
                  <View style={[styles.txnIconWrap, { backgroundColor: isDark ? 'rgba(52,211,153,0.25)' : '#dcfce7' }]}>
                    <MaterialIcons name="payments" size={20} color={income} />
                  </View>
                  <View style={[styles.txnMain, styles.txnMainWithBorder, { borderLeftColor: income }]}>
                    <Text style={[styles.txnTitle, { color: text }]}>工资发放</Text>
                    <Text style={[styles.txnMeta, { color: subtle }]}>10:00 · 基础收入</Text>
                  </View>
                  <Text style={[styles.txnAmount, { color: income }]}>+15800.00</Text>
                </View>
              </View>

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
    flex: 1,
    textAlign: 'center',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  gridWrap: {
    borderRadius: 18,
    padding: 6,
    gap: 4,
  },
  gridRow: {
    flexDirection: 'row',
    gap: 4,
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
    flex: 1,
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
  prevSection: {
    marginTop: 12,
    borderTopWidth: 1,
    paddingTop: 12,
  },
  prevLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  sheetBottomSpacer: {
    height: 48,
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
