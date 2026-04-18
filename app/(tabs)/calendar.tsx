import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { MaterialIcons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Dimensions, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
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

export default function CalendarScreen() {
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const baseTheme = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';

  const [selectedDay, setSelectedDay] = useState<number | null>(3);
  const [isSheetVisible, setIsSheetVisible] = useState(false);
  const [activeTab, setActiveTab] = useState<'tasks' | 'finance' | 'intake'>('tasks');
  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const sheetTranslateY = useSharedValue(SCREEN_HEIGHT);
  const backdropOpacity = useSharedValue(0);

  const monthLabel = currentMonth.toLocaleDateString('zh-CN', { month: 'long' });
  const monthShortEn = currentMonth.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
  const currentYear = currentMonth.getFullYear();

  const changeMonth = (offset: number) => {
    setCurrentMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + offset, 1));
  };

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

  const bg = isDark ? baseTheme.background : '#faf8ff';
  const surface = isDark ? baseTheme.surface : '#ffffff';
  const text = isDark ? baseTheme.text : '#131b2e';
  const outline = isDark ? 'rgba(148,163,184,0.75)' : '#727785';
  const outlineVariant = isDark ? 'rgba(148,163,184,0.18)' : 'rgba(194,198,214,0.26)';

  const primary = isDark ? '#60a5fa' : '#0058be';
  const secondary = isDark ? '#34d399' : '#006c49';
  const tertiary = isDark ? '#fbbf24' : '#825100';
  const error = isDark ? '#f87171' : '#ba1a1a';

  const heat90 = isDark ? 'rgba(52,211,153,0.14)' : 'rgba(0,108,73,0.12)';
  const heat70 = isDark ? 'rgba(52,211,153,0.08)' : 'rgba(0,108,73,0.06)';
  const heat40 = isDark ? 'rgba(52,211,153,0.04)' : 'rgba(0,108,73,0.02)';

  const weekDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

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
    if (d === 1) {
      cells.push({
        kind: 'day',
        day: 1,
        heat: '90',
        bars: [{ color: primary, widthPct: 100 }],
        amount: { text: '+¥1,200', color: tertiary, weight: 'bold' },
      });
      continue;
    }
    if (d === 2) {
      cells.push({
        kind: 'day',
        day: 2,
        heat: '70',
        bars: [{ color: `${primary}55`, widthPct: 100 }],
        amount: { text: '-¥450', color: error, weight: 'bold' },
      });
      continue;
    }
    if (d === 3) {
      cells.push({
        kind: 'day',
        day: 3,
        bars: [
          { color: primary, widthPct: 100 },
          { color: `${secondary}80`, widthPct: 80 },
        ],
        amount: { text: '+¥88', color: text, weight: 'black' },
      });
      continue;
    }

    let heat: '90' | '70' | '40' | undefined;
    if ([6, 9, 12, 14, 17, 20, 23, 26, 29].includes(d)) heat = '70';
    else if ([7, 11, 15, 18, 21, 24, 27, 30].includes(d)) heat = '40';
    else if ([10, 13, 19, 22, 25, 28, 31].includes(d)) heat = '90';

    cells.push({ kind: 'day', day: d, heat });
  }

  while (cells.length % 7 !== 0) cells.push({ kind: 'empty' });

  const weeks: Cell[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  const selectedDate =
    selectedDay == null ? null : new Date(currentMonth.getFullYear(), currentMonth.getMonth(), selectedDay);

  const selectedWeekdayZh = selectedDate
    ? selectedDate.toLocaleDateString('zh-CN', { weekday: 'long' })
    : '';

  const cellBg = (cell: Cell) => {
    if (cell.kind === 'empty') return isDark ? 'rgba(148,163,184,0.06)' : 'rgba(242,243,255,0.65)';
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
            <Animated.Text style={[styles.archiveKicker, { color: `${primary}99` }, animatedMonthLabelStyle]}>{`ARCHIVE ${currentYear}`}</Animated.Text>
            <Text style={[styles.monthTitle, { color: text }]}>
              {monthLabel} <Text style={[styles.monthSub, { color: `${outline}99` }]}>{monthShortEn}</Text>
            </Text>
          </View>
          <Animated.View entering={FadeInDown.duration(420).delay(80)} style={styles.headerBtns}>
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

        <Animated.View
          entering={FadeInUp.duration(480).delay(120)}
          layout={LinearTransition.springify().damping(16)}
          style={[
            styles.card,
            { backgroundColor: surface, borderColor: outlineVariant, shadowColor: isDark ? '#000' : primary },
          ]}>
          <View style={[styles.weekHeader, { borderBottomColor: outlineVariant, backgroundColor: surface }]}>
            {weekDays.map((d) => (
              <View key={d} style={styles.weekHeaderCell}>
                <Text style={[styles.weekHeaderText, { color: outline }]}>{d}</Text>
              </View>
            ))}
          </View>

          <View>
            {weeks.map((row, rowIndex) => (
              <View key={rowIndex} style={styles.weekRow}>
                {row.map((cell, colIndex) => {
                  const isLastCol = colIndex === 6;
                  const isLastRow = rowIndex === weeks.length - 1;
                  const bgColor = cellBg(cell);
                  const isSelected = cell.kind === 'day' && cell.day === selectedDay;

                  const borders = {
                    borderRightWidth: isLastCol ? 0 : StyleSheet.hairlineWidth,
                    borderBottomWidth: isLastRow ? 0 : StyleSheet.hairlineWidth,
                    borderColor: isDark ? 'rgba(148,163,184,0.20)' : 'rgba(194,198,214,0.18)',
                  } as const;

                  const cellAnimDelay = 30 + rowIndex * 55 + colIndex * 18;

                  if (cell.kind === 'empty') {
                    return (
                      <Animated.View
                        key={colIndex}
                        entering={FadeInDown.duration(320).delay(cellAnimDelay)}
                        layout={LinearTransition.springify().damping(18)}
                        style={[styles.dayCellWrapper, borders]}>
                        <View style={[styles.dayCell, { backgroundColor: bgColor }]} />
                      </Animated.View>
                    );
                  }

                  const dayColor = isSelected ? primary : `${text}66`;
                  const dayOpacity = isSelected ? 1 : 0.9;

                  return (
                    <Animated.View
                      key={colIndex}
                      entering={FadeInDown.duration(360).delay(cellAnimDelay)}
                      layout={LinearTransition.springify().damping(18)}
                      style={[styles.dayCellWrapper, borders]}>
                      <Pressable
                        onPress={() => {
                          setSelectedDay(cell.day);
                          toggleSheet(true);
                        }}
                        style={({ pressed }) => [
                          styles.dayCell,
                          {
                            transform: [{ scale: pressed ? 0.97 : 1 }],
                            backgroundColor: pressed ? (isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.02)') : bgColor,
                            borderWidth: isSelected ? 2 : 0,
                            borderColor: isSelected ? `${primary}33` : 'transparent',
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
                            <View style={{ height: 14 }} />
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

        <Animated.View entering={FadeInUp.duration(520).delay(180)} style={styles.legend}>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: `${secondary}4D` }]} />
            <Text style={[styles.legendText, { color: `${outline}B3` }]}>健康完成度 Heatmap</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: primary }]} />
            <Text style={[styles.legendText, { color: `${outline}B3` }]}>任务进度 Gantt</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: tertiary }]} />
            <Text style={[styles.legendText, { color: `${outline}B3` }]}>当日结余 Net Flow</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: error }]} />
            <Text style={[styles.legendText, { color: `${outline}B3` }]}>异常支出 Deficit</Text>
          </View>
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
              {selectedDate ? `${selectedDate.getMonth() + 1}月${selectedDate.getDate()}日, ${selectedWeekdayZh}` : '请选择日期'}
            </Text>
            {activeTab === 'finance' && (
              <Text style={[styles.sheetSubtitle, { color: outline }]}>
                FINANCIAL LEDGER • DAILY
              </Text>
            )}
          </View>
          {activeTab === 'finance' && (
            <View style={styles.sheetHeaderRight}>
              <Text style={[styles.sheetAmountLabel, { color: outline }]}>当日收支</Text>
              <Text style={[styles.sheetAmountValue, { color: secondary }]}>+¥88.00</Text>
            </View>
          )}
        </Animated.View>

        {/* Tabs */}
        <View style={[styles.sheetTabs, { borderBottomColor: outlineVariant }]}>
          <Pressable
            onPress={() => setActiveTab('tasks')}
            style={[styles.sheetTab, activeTab === 'tasks' && styles.sheetTabActive]}>
            <Text
              style={[
                styles.sheetTabText,
                { color: activeTab === 'tasks' ? primary : outline },
              ]}>
              任务列表
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setActiveTab('finance')}
            style={[styles.sheetTab, activeTab === 'finance' && styles.sheetTabActive]}>
            <Text
              style={[
                styles.sheetTabText,
                { color: activeTab === 'finance' ? primary : outline },
              ]}>
              账单明细
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setActiveTab('intake')}
            style={[styles.sheetTab, activeTab === 'intake' && styles.sheetTabActive]}>
            <Text
              style={[
                styles.sheetTabText,
                { color: activeTab === 'intake' ? primary : outline },
              ]}>
              摄入日志
            </Text>
          </Pressable>
        </View>

        {/* Tab Content */}
        <ScrollView style={styles.sheetContent} showsVerticalScrollIndicator={false}>
          {activeTab === 'tasks' && (
            <View style={styles.taskList}>
              {/* Task Item 1 */}
              <View
                style={[
                  styles.taskItem,
                  { backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : '#faf8ff', borderLeftColor: primary },
                ]}>
                <MaterialIcons name="check-circle" size={24} color={primary} />
                <View style={styles.taskInfo}>
                  <Text style={[styles.taskTitle, { color: text }]}>完成 Q2 季度报告初稿</Text>
                  <Text style={[styles.taskMeta, { color: outline }]}>10:00 AM - 12:30 PM • 办公</Text>
                </View>
                <View style={[styles.taskTag, { backgroundColor: `${primary}1A` }]}>
                  <Text style={[styles.taskTagText, { color: primary }]}>重要</Text>
                </View>
              </View>

              {/* Task Item 2 */}
              <View
                style={[
                  styles.taskItem,
                  {
                    backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : '#faf8ff',
                    borderLeftColor: `${outlineVariant}80`,
                    opacity: 0.6,
                  },
                ]}>
                <MaterialIcons name="radio-button-unchecked" size={24} color={outline} />
                <View style={styles.taskInfo}>
                  <Text style={[styles.taskTitle, { color: text }]}>健身房力量训练</Text>
                  <Text style={[styles.taskMeta, { color: outline }]}>18:00 PM - 19:30 PM • 健康</Text>
                </View>
              </View>

              {/* Task Item 3 */}
              <View
                style={[
                  styles.taskItem,
                  { backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : '#faf8ff', borderLeftColor: primary },
                ]}>
                <MaterialIcons name="check-circle" size={24} color={primary} />
                <View style={styles.taskInfo}>
                  <Text style={[styles.taskTitle, { color: text }]}>家庭日购物</Text>
                  <Text style={[styles.taskMeta, { color: outline }]}>20:00 PM - 21:00 PM • 财务</Text>
                </View>
              </View>
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
                  <Text style={[styles.financeSummaryValue, { color: secondary }]}>¥340.00</Text>
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
                  <Text style={[styles.financeSummaryValue, { color: error }]}>¥252.00</Text>
                </View>
              </View>

              <View style={styles.transactionList}>
                <Text style={[styles.transactionHeader, { color: outline }]}>收支流水</Text>

                {[
                  {
                    title: '闲鱼二手售出',
                    time: '14:20',
                    account: '支付宝入账',
                    amount: '+¥280.00',
                    type: '闲置回血',
                    icon: 'trending-up',
                    iconColor: secondary,
                  },
                  {
                    title: '工作午餐',
                    time: '12:15',
                    account: '微信支付',
                    amount: '-¥38.00',
                    type: '餐饮',
                    icon: 'lunch-dining',
                    iconColor: error,
                  },
                  {
                    title: '地铁通勤',
                    time: '08:45',
                    account: '交通卡',
                    amount: '-¥6.00',
                    type: '交通',
                    icon: 'directions-subway',
                    iconColor: primary,
                  },
                  {
                    title: '红包收益',
                    time: '09:30',
                    account: '现金',
                    amount: '+¥60.00',
                    type: '其他',
                    icon: 'payments',
                    iconColor: secondary,
                  },
                  {
                    title: '超市购物',
                    time: '20:30',
                    account: '信用卡',
                    amount: '-¥208.00',
                    type: '购物',
                    icon: 'shopping-bag',
                    iconColor: tertiary,
                  },
                ].map((item, idx) => (
                  <View
                    key={idx}
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
                        { backgroundColor: `${item.iconColor}1A` },
                      ]}>
                      <MaterialIcons name={item.icon as any} size={20} color={item.iconColor} />
                    </View>
                    <View style={styles.transactionInfo}>
                      <Text style={[styles.transactionTitle, { color: text }]}>{item.title}</Text>
                      <Text style={[styles.transactionMeta, { color: outline }]}>
                        {item.time} • {item.account}
                      </Text>
                    </View>
                    <View style={styles.transactionRight}>
                      <Text
                        style={[
                          styles.transactionAmount,
                          { color: item.amount.startsWith('+') ? secondary : text },
                        ]}>
                        {item.amount}
                      </Text>
                      <Text style={[styles.transactionType, { color: outline }]}>{item.type}</Text>
                    </View>
                  </View>
                ))}
              </View>


            </View>
          )}

          {activeTab === 'intake' && (
            <View style={styles.intakeList}>
              <View style={styles.intakeSummary}>
                <View style={[styles.intakeSummaryCard, { backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(242,243,255,0.5)' }]}>
                  <Text style={[styles.intakeSummaryLabel, { color: outline }]}>能量摄入</Text>
                  <Text style={[styles.intakeSummaryValue, { color: text }]}>
                    1,840 <Text style={styles.intakeSummaryUnit}>kcal</Text>
                  </Text>
                </View>
                <View
                  style={[
                    styles.intakeSummaryCard,
                    {
                      backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(242,243,255,0.5)',
                      borderLeftWidth: 1,
                      borderRightWidth: 1,
                      borderColor: outlineVariant,
                    },
                  ]}>
                  <Text style={[styles.intakeSummaryLabel, { color: outline }]}>饮水量</Text>
                  <Text style={[styles.intakeSummaryValue, { color: secondary }]}>
                    2,100 <Text style={styles.intakeSummaryUnit}>ml</Text>
                  </Text>
                </View>
                <View style={[styles.intakeSummaryCard, { backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(242,243,255,0.5)' }]}>
                  <Text style={[styles.intakeSummaryLabel, { color: outline }]}>蛋白质</Text>
                  <Text style={[styles.intakeSummaryValue, { color: text }]}>
                    82 <Text style={styles.intakeSummaryUnit}>g</Text>
                  </Text>
                </View>
              </View>

              <View style={styles.mealList}>
                {[
                  {
                    title: '早餐 Breakfast',
                    time: '08:15 AM',
                    items: '水煮蛋 & 全麦吐司',
                    desc: '2个蛋, 1片吐司 • 320 kcal',
                    icon: 'egg-alt',
                    color: secondary,
                  },
                  {
                    title: '午餐 Lunch',
                    time: '12:30 PM',
                    items: '鸡胸肉藜麦沙拉',
                    desc: '中份, 低脂油醋汁 • 450 kcal',
                    icon: 'lunch-dining',
                    color: secondary,
                  },
                ].map((meal, idx) => (
                  <View key={idx} style={styles.mealGroup}>
                    <View style={styles.mealHeader}>
                      <View style={styles.mealHeaderLeft}>
                        <View style={[styles.mealDot, { backgroundColor: meal.color }]} />
                        <Text style={[styles.mealTitle, { color: outline }]}>{meal.title}</Text>
                      </View>
                      <Text style={[styles.mealTime, { color: outlineVariant }]}>{meal.time}</Text>
                    </View>
                    <View style={[styles.mealItem, { backgroundColor: surface, borderColor: outlineVariant }]}>
                      <View style={[styles.mealIcon, { backgroundColor: `${meal.color}0D` }]}>
                        <MaterialIcons name={meal.icon as any} size={20} color={meal.color} />
                      </View>
                      <View style={styles.mealInfo}>
                        <Text style={[styles.mealItemTitle, { color: text }]}>{meal.items}</Text>
                        <Text style={[styles.mealItemDesc, { color: outline }]}>{meal.desc}</Text>
                      </View>
                    </View>
                  </View>
                ))}

                <View style={styles.mealGroup}>
                  <View style={styles.mealHeader}>
                    <View style={styles.mealHeaderLeft}>
                      <View style={[styles.mealDot, { backgroundColor: secondary }]} />
                      <Text style={[styles.mealTitle, { color: outline }]}>晚餐 Dinner</Text>
                    </View>
                    <Text style={[styles.mealTime, { color: outlineVariant }]}>19:45 PM</Text>
                  </View>
                  <View style={[styles.mealItem, { backgroundColor: surface, borderColor: outlineVariant }]}>
                    <View style={[styles.mealIcon, { backgroundColor: `${secondary}0D` }]}>
                      <MaterialIcons name="restaurant-menu" size={20} color={secondary} />
                    </View>
                    <View style={styles.mealInfo}>
                      <Text style={[styles.mealItemTitle, { color: text }]}>清蒸鲈鱼与时蔬</Text>
                      <Text style={[styles.mealItemDesc, { color: outline }]}>小份, 糙米饭 • 380 kcal</Text>
                    </View>
                  </View>
                </View>

                <View style={styles.mealGroup}>
                  <View style={styles.mealHeader}>
                    <View style={styles.mealHeaderLeft}>
                      <View style={[styles.mealDot, { backgroundColor: primary }]} />
                      <Text style={[styles.mealTitle, { color: outline }]}>水分 Hydration</Text>
                    </View>
                    <Text style={[styles.mealTime, { color: outlineVariant }]}>Whole Day</Text>
                  </View>
                  <View style={[styles.hydrationCard, { backgroundColor: `${primary}0D`, borderColor: `${primary}1A` }]}>
                    <View style={[styles.mealIcon, { backgroundColor: `${primary}1A` }]}>
                      <MaterialIcons name="water-drop" size={20} color={primary} />
                    </View>
                    <View style={styles.hydrationInfo}>
                      <Text style={[styles.mealItemTitle, { color: text }]}>全天累计饮水</Text>
                      <View style={styles.hydrationProgressRow}>
                        <View style={[styles.hydrationProgressBar, { backgroundColor: `${primary}1A` }]}>
                          <View style={[styles.hydrationProgressFill, { backgroundColor: primary, width: '85%' }]} />
                        </View>
                        <Text style={[styles.hydrationText, { color: primary }]}>2.1 / 2.5 L</Text>
                      </View>
                    </View>
                  </View>
                </View>

                <View style={styles.mealGroup}>
                  <View style={styles.mealHeader}>
                    <View style={styles.mealHeaderLeft}>
                      <View style={[styles.mealDot, { backgroundColor: tertiary }]} />
                      <Text style={[styles.mealTitle, { color: outline }]}>蛋白质摄入 Protein</Text>
                    </View>
                    <Text style={[styles.mealTime, { color: outlineVariant }]}>Whole Day</Text>
                  </View>
                  <View style={[styles.hydrationCard, { backgroundColor: `${tertiary}0D`, borderColor: `${tertiary}1A` }]}>
                    <View style={[styles.mealIcon, { backgroundColor: `${tertiary}1A` }]}>
                      <MaterialIcons name="fitness-center" size={20} color={tertiary} />
                    </View>
                    <View style={styles.hydrationInfo}>
                      <Text style={[styles.mealItemTitle, { color: text }]}>今日蛋白质目标完成</Text>
                      <View style={styles.hydrationProgressRow}>
                        <View style={[styles.hydrationProgressBar, { backgroundColor: `${tertiary}1A` }]}>
                          <View style={[styles.hydrationProgressFill, { backgroundColor: tertiary, width: '82%' }]} />
                        </View>
                        <Text style={[styles.hydrationText, { color: tertiary }]}>82 / 100 g</Text>
                      </View>
                    </View>
                  </View>
                </View>

                <View style={styles.mealGroup}>
                  <View style={styles.mealHeader}>
                    <View style={styles.mealHeaderLeft}>
                      <View style={[styles.mealDot, { backgroundColor: error }]} />
                      <Text style={[styles.mealTitle, { color: outline }]}>钠摄入 Sodium</Text>
                    </View>
                    <Text style={[styles.mealTime, { color: outlineVariant }]}>Whole Day</Text>
                  </View>
                  <View style={[styles.hydrationCard, { backgroundColor: `${error}0D`, borderColor: `${error}1A` }]}>
                    <View style={[styles.mealIcon, { backgroundColor: `${error}1A` }]}>
                      <MaterialIcons name="warning-amber" size={20} color={error} />
                    </View>
                    <View style={styles.hydrationInfo}>
                      <Text style={[styles.mealItemTitle, { color: text }]}>今日钠摄入监控</Text>
                      <View style={styles.hydrationProgressRow}>
                        <View style={[styles.hydrationProgressBar, { backgroundColor: `${error}1A` }]}>
                          <View style={[styles.hydrationProgressFill, { backgroundColor: error, width: '82.5%' }]} />
                        </View>
                        <Text style={[styles.hydrationText, { color: error }]}>1,650 / 2,000 mg</Text>
                      </View>
                    </View>
                  </View>
                </View>
              </View>
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
    gap: 6,
    flex: 1,
    paddingRight: 12,
  },
  archiveKicker: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 2.6,
  },
  monthTitle: {
    fontSize: 36,
    fontWeight: '900',
    letterSpacing: -0.8,
    lineHeight: 42,
  },
  monthSub: {
    fontWeight: '300',
  },
  headerBtns: {
    flexDirection: 'row',
    gap: 10,
  },
  circleBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
  },
  card: {
    borderRadius: 22,
    overflow: 'hidden',
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.1,
    shadowRadius: 24,
    elevation: 6,
  },
  weekHeader: {
    flexDirection: 'row',
    borderBottomWidth: 1,
  },
  weekHeaderCell: {
    flex: 1,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekHeaderText: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  weekRow: {
    flexDirection: 'row',
  },
  dayCellWrapper: {
    flex: 1,
    height: 115,
  },
  dayCell: {
    flex: 1,
    height: '100%',
    padding: 10,
    justifyContent: 'space-between',
    borderRadius: 8,
  },
  dayNumber: {
    fontSize: 12,
    fontWeight: '900',
  },
  dayBottom: {
    gap: 6,
  },
  bars: {
    gap: 6,
  },
  bar: {
    height: 6,
    borderRadius: 999,
  },
  amountText: {
    fontSize: 10,
    letterSpacing: -0.1,
  },
  legend: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: 16,
    rowGap: 10,
    borderRadius: 14,
  },
  legendItem: {
    width: '48%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  legendDot: {
    width: 12,
    height: 12,
    borderRadius: 3,
  },
  legendText: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
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
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    zIndex: 50,
    shadowColor: '#131b2e',
    shadowOffset: { width: 0, height: -24 },
    shadowOpacity: 0.12,
    shadowRadius: 48,
    elevation: 24,
  },
  sheetHandle: {
    alignItems: 'center',
    paddingVertical: 16,
  },
  sheetHandleLine: {
    width: 56,
    height: 6,
    borderRadius: 3,
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
  sheetTabs: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    gap: 8,
    marginBottom: 8,
  },
  sheetTab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  sheetTabActive: {
    borderBottomColor: '#0058be',
  },
  sheetTabText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  sheetContent: {
    flex: 1,
    paddingHorizontal: 24,
  },
  taskList: {
    gap: 16,
    paddingTop: 16,
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
    flexDirection: 'row',
    borderRadius: 20,
    overflow: 'hidden',
  },
  intakeSummaryCard: {
    flex: 1,
    padding: 16,
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
