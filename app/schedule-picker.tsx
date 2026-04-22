import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { Dimensions, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

type TabMode = 'date' | 'time';
type TimeRangeKey = '本周' | '下周' | '本月' | '下月' | '未来半年';

type MonthInfo = {
  year: number;
  month: number;
  daysInMonth: number;
  firstDayOffset: number;
};

const dateQuickChips = ['今天', '今晚', '明天', '本周六', '下周一'];
const timeQuickChips = ['本周', '下周', '本月', '下月', '未来半年'];
const lunarLabels = ['十五', '十六', '十七', '十八', '清明', '廿十', '廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿七', '廿八', '廿九', '三十', '三月', '初二', '初三', '初四', '初五', '谷雨', '初七', '初八', '初九', '初十', '十一', '十二', '十三', '十四'];

const WEEK_LABELS = ['一', '二', '三', '四', '五', '六', '日'];

function getMonthInfo(year: number, month: number): MonthInfo {
  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const jsDay = first.getDay(); // 0 = Sun
  const firstDayOffset = (jsDay + 6) % 7; // 0 = Mon
  return { year, month, daysInMonth, firstDayOffset };
}

function getTimeRange(key: TimeRangeKey, monthInfo: MonthInfo) {
  switch (key) {
    case '本周':
      return { start: 1, end: Math.min(7, monthInfo.daysInMonth) };
    case '下周':
      return { start: 8, end: Math.min(14, monthInfo.daysInMonth) };
    case '本月':
      return { start: 1, end: monthInfo.daysInMonth };
    case '下月':
      return { start: 1, end: monthInfo.daysInMonth };
    case '未来半年':
      return { start: 1, end: monthInfo.daysInMonth };
  }
}

export default function SchedulePickerScreen() {
  const router = useRouter();
  const scheme = useColorScheme();
  const theme = Colors[scheme ?? 'light'];
  const isDark = scheme === 'dark';

  const today = React.useMemo(() => new Date(), []);
  const [tab, setTab] = React.useState<TabMode>('date');
  const [selectedDay, setSelectedDay] = React.useState(today.getDate());
  const [selectedQuickChip, setSelectedQuickChip] = React.useState<string>('今天');
  const [timeRangeKey, setTimeRangeKey] = React.useState<TimeRangeKey | null>(null);
  const [monthOffset, setMonthOffset] = React.useState(0);
  const [allDay, setAllDay] = React.useState(false);
  const [hasExactTime, setHasExactTime] = React.useState(true);

  const screenWidth = Dimensions.get('window').width;
  const scrollRef = React.useRef<ScrollView>(null);
  const visibleMonthDate = React.useMemo(() => new Date(today.getFullYear(), today.getMonth() + monthOffset, 1), [monthOffset, today]);
  const visibleMonthInfo = React.useMemo(() => getMonthInfo(visibleMonthDate.getFullYear(), visibleMonthDate.getMonth()), [visibleMonthDate]);
  const prevMonthInfo = React.useMemo(() => getMonthInfo(visibleMonthDate.getFullYear(), visibleMonthDate.getMonth() - 1), [visibleMonthDate]);
  const nextMonthInfo = React.useMemo(() => getMonthInfo(visibleMonthDate.getFullYear(), visibleMonthDate.getMonth() + 1), [visibleMonthDate]);
  const visibleMonthTitle = `${visibleMonthInfo.year}年${visibleMonthInfo.month + 1}月`;
  const isTodayVisible = monthOffset === 0;

  const outline = isDark ? 'rgba(148,163,184,0.7)' : '#727785';
  const outlineVariant = isDark ? 'rgba(148,163,184,0.25)' : 'rgba(194,198,214,0.45)';
  const surfaceLow = isDark ? 'rgba(30,41,59,0.5)' : '#f2f3ff';

  const quickChipMap: Record<string, { tab: TabMode; day?: number; rangeKey?: TimeRangeKey }> = {
    今天: { tab: 'date', day: today.getDate() },
    今晚: { tab: 'date', day: today.getDate() },
    明天: { tab: 'date', day: Math.min(today.getDate() + 1, visibleMonthInfo.daysInMonth) },
    本周六: { tab: 'date', day: Math.min(today.getDate() + 2, visibleMonthInfo.daysInMonth) },
    下周一: { tab: 'date', day: Math.min(today.getDate() + 4, visibleMonthInfo.daysInMonth) },
    本周: { tab: 'time', rangeKey: '本周' },
    下周: { tab: 'time', rangeKey: '下周' },
    本月: { tab: 'time', rangeKey: '本月' },
    下月: { tab: 'time', rangeKey: '下月' },
    未来半年: { tab: 'time', rangeKey: '未来半年' },
  };

  const handleQuickChipPress = (chip: string) => {
    const next = quickChipMap[chip];
    if (!next) return;
    setTab(next.tab);
    setSelectedQuickChip(chip);
    setMonthOffset(next.offset);
    setTimeRangeKey(next.rangeKey ?? null);

    if (next.rangeKey) {
      const range = getTimeRange(next.rangeKey, getMonthInfo(today.getFullYear(), today.getMonth() + next.offset));
      setSelectedDay(range.start);
    } else if (typeof next.day === 'number') {
      setSelectedDay(next.day);
    }

    requestAnimationFrame(() => scrollRef.current?.scrollTo({ x: screenWidth, animated: false }));
  };

  const handleDayPress = (day: number) => {
    setSelectedDay(day);
    setTab('date');
    setTimeRangeKey(null);
    if (day === today.getDate() && monthOffset === 0) setSelectedQuickChip('今天');
    else if (day === today.getDate() + 1 && monthOffset === 0) setSelectedQuickChip('明天');
    else if (day === today.getDate() + 2 && monthOffset === 0) setSelectedQuickChip('本周六');
    else if (day === today.getDate() + 4 && monthOffset === 0) setSelectedQuickChip('下周一');
    else setSelectedQuickChip('');
  };

  const activeRange = tab === 'time' && timeRangeKey ? getTimeRange(timeRangeKey, visibleMonthInfo) : null;


  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={[styles.header, { backgroundColor: isDark ? 'rgba(15,23,42,0.86)' : 'rgba(255,255,255,0.86)' }]}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn}>
          <MaterialIcons name="close" size={22} color={outline} />
        </Pressable>

        <View style={[styles.tabSwitch, { backgroundColor: surfaceLow }]}>
          <Pressable onPress={() => setTab('date')} style={[styles.tabBtn, tab === 'date' && { backgroundColor: theme.surface }]}>
            <Text style={[styles.tabText, { color: tab === 'date' ? theme.primary : outline, fontWeight: tab === 'date' ? '700' : '500' }]}>日期</Text>
          </Pressable>
          <Pressable onPress={() => setTab('time')} style={[styles.tabBtn, tab === 'time' && { backgroundColor: theme.surface }]}>
            <Text style={[styles.tabText, { color: tab === 'time' ? theme.primary : outline, fontWeight: tab === 'time' ? '700' : '500' }]}>时刻</Text>
          </Pressable>
        </View>

        <Pressable onPress={() => router.back()} style={styles.iconBtn}>
          <MaterialIcons name={tab === 'time' ? 'done' : 'check'} size={22} color={theme.primary} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
          {(tab === 'date' ? dateQuickChips : timeQuickChips).map((chip) => {
            const isActive = selectedQuickChip === chip;
            return (
              <Pressable
                key={chip}
                onPress={() => handleQuickChipPress(chip)}
                style={[
                  styles.chip,
                  { backgroundColor: isActive ? '#006c49' : theme.surface, borderColor: isActive ? '#006c49' : outlineVariant },
                ]}
              >
                <Text style={[styles.chipText, { color: isActive ? '#fff' : theme.text }]}>{chip}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <View style={styles.calendarHead}>
          <Text style={[styles.monthTitle, { color: theme.text }]}>{visibleMonthTitle}</Text>
          <View style={styles.monthActions}>
            <Pressable style={styles.iconBtn} onPress={() => setMonthOffset((prev) => prev - 1)}>
              <MaterialIcons name="chevron-left" size={22} color={outline} />
            </Pressable>
            <Pressable style={styles.iconBtn} onPress={() => setMonthOffset((prev) => prev + 1)}>
              <MaterialIcons name="chevron-right" size={22} color={outline} />
            </Pressable>
          </View>
        </View>

        <ScrollView
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          contentOffset={{ x: Dimensions.get('window').width, y: 0 }}
          onScrollEndDrag={(e) => {
            const width = Dimensions.get('window').width;
            const x = e.nativeEvent.contentOffset.x;
            if (x > width * 1.5) setMonthOffset((prev) => prev + 1);
            else if (x < width * 0.5) setMonthOffset((prev) => prev - 1);
          }}
          contentContainerStyle={styles.calendarPager}
        >
          <View style={styles.calendarPage}>
            <View style={styles.weekRow}>
              {WEEK_LABELS.map((w) => (
                <Text key={w} style={[styles.weekText, { color: outline }]}>
                  {w}
                </Text>
              ))}
            </View>

            <View style={styles.grid}>
              {days.map((cell, index) => {
                const day = cell.day;
                const lunar = lunarLabels[(day - 1) % lunarLabels.length] ?? '农历';
                const isSelected = cell.inCurrentMonth && day === selectedDay && tab === 'date';
                const isToday = isTodayVisible && cell.inCurrentMonth && day === today.getDate();
                const inRange = !!activeRange && cell.inCurrentMonth && day >= activeRange.start && day <= activeRange.end;
                const start = !!activeRange && cell.inCurrentMonth && day === activeRange.start;
                const end = !!activeRange && cell.inCurrentMonth && day === activeRange.end;
                const weekDayIndex = index % 7;
                const isRangeStartOrEnd = start || end;
                const showRangeLine = inRange && !isRangeStartOrEnd;

                return (
                  <Pressable key={cell.key} onPress={() => cell.inCurrentMonth && handleDayPress(day)} style={styles.dayCell}>
                    {cell.inCurrentMonth ? (
                      <View style={styles.rangeWrap}>
                        {inRange && weekDayIndex !== 0 ? <View style={styles.rangeLeftFill} /> : null}
                        {inRange && weekDayIndex !== 6 ? <View style={styles.rangeRightFill} /> : null}

                        {showRangeLine ? (
                          <View style={[styles.dayCircle, styles.rangeMiddleCircle, { backgroundColor: 'rgba(0,108,73,0.14)' }]}>
                            <Text style={[styles.dayNum, { color: '#006c49' }]}>{day}</Text>
                            <Text style={[styles.dayLunar, { color: '#006c49' }]}>{lunar}</Text>
                          </View>
                        ) : (
                          <View
                            style={[
                              styles.dayCircle,
                              isSelected && { backgroundColor: '#006c49' },
                              isToday && !isSelected && { backgroundColor: 'rgba(0,108,73,0.12)' },
                              isRangeStartOrEnd && { backgroundColor: '#006c49' },
                              inRange && !isRangeStartOrEnd && { backgroundColor: 'rgba(0,108,73,0.14)' },
                              isRangeStartOrEnd && styles.rangeEndpoint,
                              isToday && !isSelected && !isRangeStartOrEnd && styles.todayCircle,
                            ]}
                          >
                            <Text style={[styles.dayNum, { color: isSelected || isRangeStartOrEnd ? '#fff' : isToday ? '#006c49' : theme.text }]}>{day}</Text>
                            <Text style={[styles.dayLunar, { color: isSelected || isRangeStartOrEnd ? '#fff' : isToday ? '#006c49' : outline }]}>{lunar}</Text>
                          </View>
                        )}
                      </View>
                    ) : (
                      <View style={[styles.dayCircle, styles.outOfMonthCircle]}>
                        <Text style={[styles.dayNum, { color: outline, opacity: 0.4 }]}>{day}</Text>
                        <Text style={[styles.dayLunar, { color: outline, opacity: 0.35 }]}>{lunar}</Text>
                      </View>
                    )}
                  </Pressable>
                );
              })}
            </View>
          </View>
          <View style={styles.calendarPage} />
          <View style={styles.calendarPage} />
        </ScrollView>

        {tab === 'date' ? (
          <View style={[styles.settingList, { backgroundColor: surfaceLow }]}>
            <View style={styles.settingRow}>
              <View style={styles.settingLeft}>
                <View style={[styles.settingIcon, { backgroundColor: theme.surface }]}>
                  <MaterialIcons name="schedule" size={20} color={theme.primary} />
                </View>
                <Text style={[styles.settingLabel, { color: theme.text }]}>具体时间</Text>
              </View>
              <View style={styles.settingRight}>
                <Text style={[styles.settingValue, { color: theme.primary }]}>13:00</Text>
                <Switch value={hasExactTime} onValueChange={setHasExactTime} />
              </View>
            </View>
            <View style={styles.settingRow}>
              <View style={styles.settingLeft}>
                <View style={[styles.settingIcon, { backgroundColor: theme.surface }]}>
                  <MaterialIcons name="notifications" size={20} color={theme.primary} />
                </View>
                <Text style={[styles.settingLabel, { color: theme.text }]}>提醒设置</Text>
              </View>
              <View style={styles.settingRight}>
                <Text style={[styles.settingHint, { color: outline }]}>不提醒</Text>
                <MaterialIcons name="chevron-right" size={20} color={outline} />
              </View>
            </View>
            <View style={styles.settingRow}>
              <View style={styles.settingLeft}>
                <View style={[styles.settingIcon, { backgroundColor: theme.surface }]}>
                  <MaterialIcons name="repeat" size={20} color={theme.primary} />
                </View>
                <Text style={[styles.settingLabel, { color: theme.text }]}>重复设置</Text>
              </View>
              <View style={styles.settingRight}>
                <Text style={[styles.settingHint, { color: outline }]}>不重复</Text>
                <MaterialIcons name="chevron-right" size={20} color={outline} />
              </View>
            </View>
          </View>
        ) : (
          <>
            <View style={[styles.settingList, { backgroundColor: surfaceLow }]}>
              <View style={styles.settingRow}>
                <View style={styles.settingLeft}>
                  <View style={[styles.settingIcon, { backgroundColor: theme.surface }]}>
                    <MaterialIcons name="brightness-7" size={20} color={theme.primary} />
                  </View>
                  <Text style={[styles.settingLabel, { color: theme.text }]}>全天</Text>
                </View>
                <View style={styles.settingRight}>
                  <Switch value={allDay} onValueChange={setAllDay} />
                </View>
              </View>
              <View style={styles.settingRow}>
                <View style={styles.settingLeft}>
                  <View style={[styles.settingIcon, { backgroundColor: theme.surface }]}>
                    <MaterialIcons name="schedule" size={20} color={theme.primary} />
                  </View>
                  <Text style={[styles.settingLabel, { color: theme.text }]}>开始</Text>
                </View>
                <View style={styles.settingRight}>
                  <Text style={[styles.settingValueSmall, { color: theme.primary }]}>4月1日 13:00</Text>
                  <MaterialIcons name="chevron-right" size={20} color={outline} />
                </View>
              </View>
              <View style={styles.settingRow}>
                <View style={styles.settingLeft}>
                  <View style={[styles.settingIcon, { backgroundColor: theme.surface }]}>
                    <MaterialIcons name="timer-off" size={20} color={theme.primary} />
                  </View>
                  <Text style={[styles.settingLabel, { color: theme.text }]}>结束</Text>
                </View>
                <View style={styles.settingRight}>
                  <Text style={[styles.settingValueSmall, { color: theme.primary }]}>4月8日 14:00</Text>
                  <MaterialIcons name="chevron-right" size={20} color={outline} />
                </View>
              </View>
            </View>

            <View style={[styles.settingList, { backgroundColor: surfaceLow }]}>
              <View style={styles.settingRow}>
                <View style={styles.settingLeft}>
                  <View style={[styles.settingIcon, { backgroundColor: theme.surface }]}>
                    <MaterialIcons name="notifications" size={20} color={theme.primary} />
                  </View>
                  <Text style={[styles.settingLabel, { color: theme.text }]}>提醒设置</Text>
                </View>
                <View style={styles.settingRight}>
                  <Text style={[styles.settingHint, { color: outline }]}>无</Text>
                  <MaterialIcons name="chevron-right" size={20} color={outline} />
                </View>
              </View>
              <View style={styles.settingRow}>
                <View style={styles.settingLeft}>
                  <View style={[styles.settingIcon, { backgroundColor: theme.surface }]}>
                    <MaterialIcons name="repeat" size={20} color={theme.primary} />
                  </View>
                  <Text style={[styles.settingLabel, { color: theme.text }]}>重复设置</Text>
                </View>
                <View style={styles.settingRight}>
                  <Text style={[styles.settingHint, { color: outline }]}>不重复</Text>
                  <MaterialIcons name="chevron-right" size={20} color={outline} />
                </View>
              </View>
            </View>

            <Pressable style={[styles.clearBtn, { borderColor: 'rgba(186,26,26,0.2)', backgroundColor: theme.surface }]}>
              <Text style={styles.clearText}>清除</Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10 },
  iconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  tabSwitch: { flexDirection: 'row', borderRadius: 12, padding: 4, gap: 2 },
  tabBtn: { paddingHorizontal: 20, paddingVertical: 6, borderRadius: 10 },
  tabText: { fontSize: 14 },
  content: { padding: 16, gap: 20, paddingBottom: 40 },
  chipsRow: { gap: 10 },
  chip: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 10 },
  chipText: { fontSize: 14, fontWeight: '500' },
  calendarHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  monthTitle: { fontSize: 28, fontWeight: '900' },
  monthActions: { flexDirection: 'row', gap: 8 },
  calendarPager: { width: '100%' },
  calendarPage: { width: '100%' },
  weekRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 8 },
  weekText: { width: '14.28%', textAlign: 'center', fontSize: 11, fontWeight: '800' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  dayCell: { width: '14.28%', alignItems: 'center', paddingVertical: 8 },
  rangeWrap: { width: '100%', alignItems: 'center', justifyContent: 'center' },
  rangeLeftFill: { position: 'absolute', left: 0, right: '50%', top: 6, bottom: 6, backgroundColor: 'rgba(0,108,73,0.12)' },
  rangeRightFill: { position: 'absolute', left: '50%', right: 0, top: 6, bottom: 6, backgroundColor: 'rgba(0,108,73,0.12)' },
  dayCircle: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', zIndex: 1 },
  todayCircle: { borderWidth: 2, borderColor: 'rgba(0,108,73,0.2)' },
  rangeMiddleCircle: { opacity: 0.95 },
  rangeEndpoint: { zIndex: 2 },
  outOfMonthCircle: { opacity: 0.5 },
  dayNum: { fontSize: 18, fontWeight: '700', lineHeight: 20 },
  dayLunar: { fontSize: 9, fontWeight: '600' },
  settingList: { borderRadius: 14, overflow: 'hidden' },
  settingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14 },
  settingLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  settingIcon: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  settingLabel: { fontSize: 16, fontWeight: '500' },
  settingRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  settingValue: { fontSize: 22, fontWeight: '800' },
  settingValueSmall: { fontSize: 22, fontWeight: '700' },
  settingHint: { fontSize: 14, fontWeight: '500' },
  clearBtn: { borderWidth: 1, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  clearText: { color: '#ba1a1a', fontSize: 16, fontWeight: '600' },
});
