import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { MaterialIcons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { FlatList, Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

type TabMode = 'date' | 'time';
type TimeRangeKey = '本周' | '下周' | '本月' | '下月' | '未来半年';
type ReminderOption = '不提前' | '提前1天' | '提前2天' | '提前3天' | '提前7天';
type RepeatOption = '不重复' | '每天' | '每周' | '每月' | '每年';
type SettingPickerType = 'reminder' | 'repeat' | 'timeStart' | 'timeEnd' | null;

type MonthInfo = {
  year: number;
  month: number;
  daysInMonth: number;
  firstDayOffset: number;
};

type CalendarCell = {
  key: string;
  day: number;
  inCurrentMonth: boolean;
};

type DateRange = {
  start: Date;
  end: Date;
};

type SchedulePickerReturnParams = {
  source?: string;
};

type SchedulePickerResult = {
  mode: TabMode;
  source: string;
  quickChip: string;
  allDay: boolean;
  hasExactTime: boolean;
  reminderOption: ReminderOption;
  repeatOption: RepeatOption;
  repeatSummary: string;
  date?: string;
  range?: { start: string; end: string };
  startTime: string;
  endTime: string;
};

declare global {
  // eslint-disable-next-line no-var
  var __schedulePickerResult: SchedulePickerResult | undefined;
}

const dateQuickChips = ['今天', '今晚', '明天', '本周六', '下周一'];
const timeQuickChips = ['本周', '下周', '本月', '下月', '未来半年'];
const lunarLabels = ['十五', '十六', '十七', '十八', '清明', '廿十', '廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿七', '廿八', '廿九', '三十', '三月', '初二', '初三', '初四', '初五', '谷雨', '初七', '初八', '初九', '初十', '十一', '十二', '十三', '十四'];

const WEEK_LABELS = ['一', '二', '三', '四', '五', '六', '日'];
const MONTH_PAGE_SPAN = 481;
const MONTH_PAGE_CENTER_INDEX = Math.floor(MONTH_PAGE_SPAN / 2);
const REMINDER_OPTIONS: ReminderOption[] = ['不提前', '提前1天', '提前2天', '提前3天', '提前7天'];
const REPEAT_OPTIONS: RepeatOption[] = ['不重复', '每天', '每周', '每月', '每年'];
const WEEKDAY_OPTIONS = [
  { label: '周一', value: 1 },
  { label: '周二', value: 2 },
  { label: '周三', value: 3 },
  { label: '周四', value: 4 },
  { label: '周五', value: 5 },
  { label: '周六', value: 6 },
  { label: '周日', value: 7 },
];
const MONTH_DAY_OPTIONS = Array.from({ length: 31 }, (_, i) => i + 1);

function getMonthInfo(year: number, month: number): MonthInfo {
  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const jsDay = first.getDay(); // 0 = Sun
  const firstDayOffset = (jsDay + 6) % 7; // 0 = Mon
  return { year, month, daysInMonth, firstDayOffset };
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(base: Date, amount: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + amount);
  return d;
}

function getMonthDiff(from: Date, to: Date): number {
  return (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
}

function getWeekdayMonAs1(date: Date): number {
  return ((date.getDay() + 6) % 7) + 1;
}

function getCurrentWeekStart(date: Date): Date {
  return addDays(startOfDay(date), -(getWeekdayMonAs1(date) - 1));
}

function getUpcomingWeekday(date: Date, targetMonAs1: number): Date {
  const current = getWeekdayMonAs1(date);
  const delta = targetMonAs1 - current;
  return addDays(startOfDay(date), delta);
}

function getTimeRange(key: TimeRangeKey, today: Date): DateRange {
  const currentWeekStart = getCurrentWeekStart(today);
  switch (key) {
    case '本周':
      return { start: currentWeekStart, end: addDays(currentWeekStart, 6) };
    case '下周':
      return { start: addDays(currentWeekStart, 7), end: addDays(currentWeekStart, 13) };
    case '本月':
      return {
        start: new Date(today.getFullYear(), today.getMonth(), 1),
        end: new Date(today.getFullYear(), today.getMonth() + 1, 0),
      };
    case '下月':
      return {
        start: new Date(today.getFullYear(), today.getMonth() + 1, 1),
        end: new Date(today.getFullYear(), today.getMonth() + 2, 0),
      };
    case '未来半年':
      return { start: startOfDay(today), end: addDays(startOfDay(today), 180) };
  }
}

function formatTime(date: Date): string {
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

function formatRepeatSummary(option: RepeatOption, weeklyDays: number[], monthlyDays: number[], yearlyDate: Date): string {
  if (option === '每周') {
    if (!weeklyDays.length) return '每周';
    const labels = WEEKDAY_OPTIONS.filter((item) => weeklyDays.includes(item.value)).map((item) => item.label);
    return `每周 ${labels.join('、')}`;
  }

  if (option === '每月') {
    if (!monthlyDays.length) return '每月';
    const sortedDays = [...monthlyDays].sort((a, b) => a - b);
    if (sortedDays.length > 3) {
      return `每月 ${sortedDays.slice(0, 3).join('、')}...`;
    }
    return `每月 ${sortedDays.join('、')}日`;
  }

  if (option === '每年') {
    return `每年 ${yearlyDate.getMonth() + 1}月${yearlyDate.getDate()}日`;
  }

  return option;
}

function buildCalendarCells(current: MonthInfo, previous: MonthInfo, next: MonthInfo): CalendarCell[] {
  const totalCells = 42;
  const cells: CalendarCell[] = [];
  const prevMonthVisibleCount = current.firstDayOffset;

  for (let i = 0; i < totalCells; i += 1) {
    if (i < prevMonthVisibleCount) {
      const day = previous.daysInMonth - prevMonthVisibleCount + i + 1;
      cells.push({ key: `prev-${previous.year}-${previous.month}-${day}`, day, inCurrentMonth: false });
      continue;
    }

    const currentDayIndex = i - prevMonthVisibleCount + 1;
    if (currentDayIndex <= current.daysInMonth) {
      cells.push({ key: `curr-${current.year}-${current.month}-${currentDayIndex}`, day: currentDayIndex, inCurrentMonth: true });
      continue;
    }

    const day = i - (prevMonthVisibleCount + current.daysInMonth) + 1;
    cells.push({ key: `next-${next.year}-${next.month}-${day}`, day, inCurrentMonth: false });
  }

  return cells;
}

export default function SchedulePickerScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<SchedulePickerReturnParams>();
  const scheme = useColorScheme();
  const theme = Colors[scheme ?? 'light'];
  const isDark = scheme === 'dark';

  const today = React.useMemo(() => new Date(), []);
  const todayStart = React.useMemo(() => startOfDay(today), [today]);
  const [tab, setTab] = React.useState<TabMode>('date');
  const [selectedDate, setSelectedDate] = React.useState<Date>(todayStart);
  const [selectedQuickChip, setSelectedQuickChip] = React.useState<string>('今天');
  const [timeRangeKey, setTimeRangeKey] = React.useState<TimeRangeKey | null>(null);
  React.useEffect(() => {
    void timeRangeKey;
  }, [timeRangeKey]);
  const [timeRange, setTimeRange] = React.useState<DateRange | null>(null);
  const [timeSelectingEnd, setTimeSelectingEnd] = React.useState(false);
  const [monthOffset, setMonthOffset] = React.useState(0);
  const [visibleMonthOffset, setVisibleMonthOffset] = React.useState(0);
  const [allDay, setAllDay] = React.useState(false);
  const [hasExactTime, setHasExactTime] = React.useState(true);
  const [startTime, setStartTime] = React.useState<Date>(() => {
    const initial = new Date(todayStart);
    initial.setHours(13, 0, 0, 0);
    return initial;
  });
  const [endTime, setEndTime] = React.useState<Date>(() => {
    const initial = new Date(todayStart);
    initial.setHours(14, 0, 0, 0);
    return initial;
  });
  const [timePickerVisible, setTimePickerVisible] = React.useState(false);
  const [toastVisible, setToastVisible] = React.useState(false);
  const [toastMessage, setToastMessage] = React.useState('');
  const toastTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const [yearlyDatePickerVisible, setYearlyDatePickerVisible] = React.useState(false);
  const yearlyPickerOpenTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const [settingPickerType, setSettingPickerType] = React.useState<SettingPickerType>(null);
  const [reminderOption, setReminderOption] = React.useState<ReminderOption>('不提前');
  const [repeatOption, setRepeatOption] = React.useState<RepeatOption>('不重复');
  const [repeatDetailVisible, setRepeatDetailVisible] = React.useState(false);
  const [weeklyDays, setWeeklyDays] = React.useState<number[]>([1]);
  const [monthlyDays, setMonthlyDays] = React.useState<number[]>([1]);
  const [yearlyDate, setYearlyDate] = React.useState<Date>(() => new Date(todayStart));
  const exactTime = startTime;
  const [timeDraft, setTimeDraft] = React.useState<Date>(startTime);
  const [timePickerTarget, setTimePickerTarget] = React.useState<'start' | 'end'>('start');

  const { width: windowWidth } = useWindowDimensions();
  const [calendarWidth, setCalendarWidth] = React.useState(() => Math.max(1, windowWidth - 32));
  const pagerRef = React.useRef<FlatList<number>>(null);
  const pagerCurrentIndexRef = React.useRef(MONTH_PAGE_CENTER_INDEX);
  const pagerWidthReadyRef = React.useRef(false);
  const pagerData = React.useMemo(
    () => Array.from({ length: MONTH_PAGE_SPAN }, (_, i) => i - MONTH_PAGE_CENTER_INDEX),
    []
  );
  const visibleMonthDate = React.useMemo(
    () => new Date(today.getFullYear(), today.getMonth() + visibleMonthOffset, 1),
    [today, visibleMonthOffset]
  );
  const visibleMonthInfo = React.useMemo(() => getMonthInfo(visibleMonthDate.getFullYear(), visibleMonthDate.getMonth()), [visibleMonthDate]);
  const visibleMonthTitle = `${visibleMonthInfo.year}年${visibleMonthInfo.month + 1}月`;

  const outline = isDark ? 'rgba(148,163,184,0.7)' : '#727785';
  const outlineVariant = isDark ? 'rgba(148,163,184,0.25)' : 'rgba(194,198,214,0.45)';
  const surfaceLow = isDark ? 'rgba(30,41,59,0.5)' : '#f2f3ff';

  const handleQuickChipPress = (chip: string) => {
    setSelectedQuickChip(chip);

    if (chip === '今天' || chip === '今晚') {
      setTab('date');
      setTimeRangeKey(null);
      setTimeRange(null);
      setTimeSelectingEnd(false);
      setSelectedDate(todayStart);
      setMonthOffset(0);
      return;
    }

    if (chip === '明天') {
      const target = addDays(todayStart, 1);
      setTab('date');
      setTimeRangeKey(null);
      setTimeRange(null);
      setTimeSelectingEnd(false);
      setSelectedDate(target);
      setMonthOffset(getMonthDiff(todayStart, target));
      return;
    }

    if (chip === '本周六') {
      const target = getUpcomingWeekday(todayStart, 6);
      setTab('date');
      setTimeRangeKey(null);
      setTimeRange(null);
      setTimeSelectingEnd(false);
      setSelectedDate(target);
      setMonthOffset(getMonthDiff(todayStart, target));
      return;
    }

    if (chip === '下周一') {
      const target = addDays(getCurrentWeekStart(todayStart), 7);
      setTab('date');
      setTimeRangeKey(null);
      setTimeRange(null);
      setTimeSelectingEnd(false);
      setSelectedDate(target);
      setMonthOffset(getMonthDiff(todayStart, target));
      return;
    }

    const rangeKey = chip as TimeRangeKey;
    const nextRange = getTimeRange(rangeKey, todayStart);
    setTab('time');
    setSelectedQuickChip(chip);
    setTimeRangeKey(rangeKey);
    setTimeRange(nextRange);
    setTimeSelectingEnd(false);
    setSelectedDate(nextRange.start);
    setMonthOffset(getMonthDiff(todayStart, nextRange.start));
  };

  const handleDayPress = (year: number, month: number, day: number) => {
    const picked = new Date(year, month, day);

    if (tab === 'time') {
      if (picked.getTime() < todayStart.getTime()) return;

      setSelectedQuickChip('');
      setTimeRangeKey(null);

      if (!timeRange || !timeSelectingEnd) {
        setTimeRange({ start: picked, end: picked });
        setTimeSelectingEnd(true);
      } else {
        const start = startOfDay(timeRange.start);
        const end = startOfDay(picked);
        if (end.getTime() < start.getTime()) {
          setTimeRange({ start: end, end: start });
        } else {
          setTimeRange({ start, end });
        }
        setTimeSelectingEnd(false);
      }

      setSelectedDate(picked);
      return;
    }

    setSelectedDate(picked);
    setTab('date');
    setTimeRangeKey(null);
    setTimeRange(null);
    setTimeSelectingEnd(false);
    if (picked.getTime() === todayStart.getTime()) setSelectedQuickChip('今天');
    else if (picked.getTime() === addDays(todayStart, 1).getTime()) setSelectedQuickChip('明天');
    else if (picked.getTime() === getUpcomingWeekday(todayStart, 6).getTime()) setSelectedQuickChip('本周六');
    else if (picked.getTime() === addDays(getCurrentWeekStart(todayStart), 7).getTime()) setSelectedQuickChip('下周一');
    else setSelectedQuickChip('');
  };

  const activeRange = tab === 'time' ? timeRange : null;
  const exactTimeLabel = formatTime(exactTime);

  const openTimePicker = (target: 'start' | 'end') => {
    if (!hasExactTime) return;
    setTimePickerTarget(target);
    setTimeDraft(target === 'start' ? startTime : endTime);
    setTimePickerVisible(true);
  };

  const resetToDefaultState = () => {
    setSelectedDate(todayStart);
    setSelectedQuickChip('今天');
    setTimeRangeKey(null);
    setTimeRange(null);
    setTimeSelectingEnd(false);
    setMonthOffset(0);
    setVisibleMonthOffset(0);
    setAllDay(false);
    setHasExactTime(true);
    const defaultStart = new Date(todayStart);
    defaultStart.setHours(13, 0, 0, 0);
    const defaultEnd = new Date(todayStart);
    defaultEnd.setHours(14, 0, 0, 0);
    setStartTime(defaultStart);
    setEndTime(defaultEnd);
    setTimePickerVisible(false);
    setSettingPickerType(null);
    setReminderOption('不提前');
    setRepeatOption('不重复');
    setRepeatDetailVisible(false);
    setWeeklyDays([1]);
    setMonthlyDays([1]);
    setYearlyDate(new Date(todayStart));
    setYearlyDatePickerVisible(false);
    setToastVisible(false);
    setToastMessage('');
    setTimeDraft(defaultStart);
    setTimePickerTarget('start');
  };

  const showToast = React.useCallback((message: string) => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
    setToastMessage(message);
    setToastVisible(true);
    toastTimerRef.current = setTimeout(() => {
      setToastVisible(false);
      toastTimerRef.current = null;
    }, 2500);
  }, []);

  const buildReturnPayload = React.useCallback((): SchedulePickerResult => {
    const currentRepeatSummary = formatRepeatSummary(repeatOption, weeklyDays, monthlyDays, yearlyDate);

    if (tab === 'time' && timeRange) {
      return {
        mode: 'time',
        source: params.source ?? '',
        quickChip: selectedQuickChip,
        allDay,
        hasExactTime,
        reminderOption,
        repeatOption,
        repeatSummary: currentRepeatSummary,
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        range: {
          start: timeRange.start.toISOString(),
          end: timeRange.end.toISOString(),
        },
      };
    }

    return {
      mode: 'date',
      source: params.source ?? '',
      quickChip: selectedQuickChip,
      date: selectedDate.toISOString(),
      allDay,
      hasExactTime,
      reminderOption,
      repeatOption,
      repeatSummary: currentRepeatSummary,
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
    };
  }, [allDay, endTime, hasExactTime, monthlyDays, params.source, reminderOption, repeatOption, selectedDate, selectedQuickChip, startTime, tab, timeRange, weeklyDays, yearlyDate]);

  const applyTimeSelection = (target: 'start' | 'end', selected: Date) => {
    const normalized = new Date(selected);
    normalized.setSeconds(0, 0);

    if (target === 'start') {
      setStartTime(normalized);
      setEndTime((prev) => {
        const minEnd = new Date(normalized.getTime() + 60 * 1000);
        if (prev.getTime() < minEnd.getTime()) {
          showToast('结束时间已自动调整，且需至少晚于开始时间 1 分钟');
          return minEnd;
        }
        return prev;
      });
      return;
    }

    const minEnd = new Date(startTime.getTime() + 60 * 1000);
    const safeEnd = normalized.getTime() < minEnd.getTime() ? minEnd : normalized;
    setEndTime(safeEnd);
    if (safeEnd.getTime() !== normalized.getTime()) {
      showToast('结束时间不能早于开始时间，且至少晚于开始时间 1 分钟');
    }
  };

  React.useEffect(() => {
    setEndTime((prev) => (prev.getTime() < startTime.getTime() ? new Date(startTime) : prev));
  }, [startTime]);
  const openSettingPicker = (type: Exclude<SettingPickerType, null>) => setSettingPickerType(type);
  const openYearlyDatePicker = React.useCallback(() => {
    if (yearlyPickerOpenTimerRef.current) {
      clearTimeout(yearlyPickerOpenTimerRef.current);
      yearlyPickerOpenTimerRef.current = null;
    }

    setRepeatDetailVisible(false);
    yearlyPickerOpenTimerRef.current = setTimeout(() => {
      setYearlyDatePickerVisible(true);
      yearlyPickerOpenTimerRef.current = null;
    }, 220);
  }, []);

  React.useEffect(() => {
    return () => {
      if (yearlyPickerOpenTimerRef.current) {
        clearTimeout(yearlyPickerOpenTimerRef.current);
      }
    };
  }, []);
  const settingPickerTitle = settingPickerType === 'reminder' ? '提醒设置' : '重复设置';
  const settingPickerOptions = settingPickerType === 'reminder' ? REMINDER_OPTIONS : REPEAT_OPTIONS;
  const settingPickerValue = settingPickerType === 'reminder' ? reminderOption : repeatOption;
  const startTimeLabel = formatTime(startTime);
  const endTimeLabel = formatTime(endTime);
  const timePickerTitle = timePickerTarget === 'start' ? '选择开始时间' : '选择结束时间';
  const repeatSummary = formatRepeatSummary(repeatOption, weeklyDays, monthlyDays, yearlyDate);
  const yearlyPickerMinDate = React.useMemo(() => {
    const base = new Date(yearlyDate);
    base.setHours(0, 0, 0, 0);
    return new Date(base.getFullYear() - 100, 0, 1);
  }, [yearlyDate]);
  const yearlyPickerMaxDate = React.useMemo(() => {
    const base = new Date(yearlyDate);
    base.setHours(0, 0, 0, 0);
    return new Date(base.getFullYear() + 100, 11, 31);
  }, [yearlyDate]);

  React.useEffect(() => {
    const nextWidth = Math.max(1, windowWidth - 32);
    setCalendarWidth((prev) => (Math.abs(prev - nextWidth) < 1 ? prev : nextWidth));
  }, [windowWidth]);

  const toggleWeeklyDay = (day: number) => {
    setWeeklyDays((prev) => {
      if (prev.includes(day)) return prev.filter((d) => d !== day);
      return [...prev, day];
    });
  };

  const toggleMonthlyDay = (day: number) => {
    setMonthlyDays((prev) => {
      if (prev.includes(day)) return prev.filter((d) => d !== day);
      return [...prev, day];
    });
  };

  React.useEffect(() => {
    setVisibleMonthOffset(monthOffset);
    if (calendarWidth <= 0) return;

    const nextIndex = monthOffset + MONTH_PAGE_CENTER_INDEX;
    // Width is measured after first paint; force-align once to avoid wrong initial offset/year.
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

        <Pressable
          onPress={() => {
            globalThis.__schedulePickerResult = buildReturnPayload();
            router.back();
          }}
          style={styles.iconBtn}>
          <MaterialIcons name={tab === 'time' ? 'done' : 'check'} size={22} color={theme.primary} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} nestedScrollEnabled>
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

        <FlatList
          ref={pagerRef}
          data={pagerData}
          horizontal
          pagingEnabled
          nestedScrollEnabled
          directionalLockEnabled
          decelerationRate="fast"
          initialScrollIndex={MONTH_PAGE_CENTER_INDEX}
          getItemLayout={(_, index) => ({ length: calendarWidth, offset: calendarWidth * index, index })}
          showsHorizontalScrollIndicator={false}
          keyExtractor={(offset) => `month-${offset}`}
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
          contentContainerStyle={styles.calendarPager}
          renderItem={({ item: offset }) => {
            const monthDate = new Date(today.getFullYear(), today.getMonth() + offset, 1);
            const currentMonthInfo = getMonthInfo(monthDate.getFullYear(), monthDate.getMonth());
            const prevMonthInfo = getMonthInfo(monthDate.getFullYear(), monthDate.getMonth() - 1);
            const nextMonthInfo = getMonthInfo(monthDate.getFullYear(), monthDate.getMonth() + 1);
            const days = buildCalendarCells(currentMonthInfo, prevMonthInfo, nextMonthInfo);

            return (
              <View style={[styles.calendarPage, { width: calendarWidth || '100%' }]}>
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
                    const cellDate = new Date(currentMonthInfo.year, currentMonthInfo.month, day);
                    const isPastDate = cell.inCurrentMonth && cellDate.getTime() < todayStart.getTime();
                    const isSelected =
                      cell.inCurrentMonth &&
                      tab === 'date' &&
                      selectedDate.getFullYear() === cellDate.getFullYear() &&
                      selectedDate.getMonth() === cellDate.getMonth() &&
                      selectedDate.getDate() === cellDate.getDate();
                    const isToday =
                      cell.inCurrentMonth &&
                      todayStart.getFullYear() === cellDate.getFullYear() &&
                      todayStart.getMonth() === cellDate.getMonth() &&
                      todayStart.getDate() === cellDate.getDate();
                    const inRange = !!activeRange && cell.inCurrentMonth && cellDate >= activeRange.start && cellDate <= activeRange.end;
                    const start =
                      !!activeRange &&
                      cell.inCurrentMonth &&
                      cellDate.getFullYear() === activeRange.start.getFullYear() &&
                      cellDate.getMonth() === activeRange.start.getMonth() &&
                      cellDate.getDate() === activeRange.start.getDate();
                    const end =
                      !!activeRange &&
                      cell.inCurrentMonth &&
                      cellDate.getFullYear() === activeRange.end.getFullYear() &&
                      cellDate.getMonth() === activeRange.end.getMonth() &&
                      cellDate.getDate() === activeRange.end.getDate();
                    const weekDayIndex = index % 7;
                    const isRangeStartOrEnd = start || end;
                    const showRangeLine = inRange && !isRangeStartOrEnd;

                    return (
                      <Pressable
                        key={cell.key}
                        onPress={() => cell.inCurrentMonth && !isPastDate && handleDayPress(currentMonthInfo.year, currentMonthInfo.month, day)}
                        style={styles.dayCell}
                      >
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
                                  isPastDate && styles.pastDayCircle,
                                ]}
                              >
                                <Text
                                  style={[
                                    styles.dayNum,
                                    { color: isSelected || isRangeStartOrEnd ? '#fff' : isToday ? '#006c49' : theme.text },
                                    isPastDate && styles.pastDayText,
                                  ]}
                                >
                                  {day}
                                </Text>
                                <Text
                                  style={[
                                    styles.dayLunar,
                                    { color: isSelected || isRangeStartOrEnd ? '#fff' : isToday ? '#006c49' : outline },
                                    isPastDate && styles.pastDayText,
                                  ]}
                                >
                                  {lunar}
                                </Text>
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
            );
          }}
        />

        {tab === 'date' ? (
          <View style={[styles.settingList, { backgroundColor: surfaceLow }]}>
            <Pressable style={[styles.settingRow, !hasExactTime && styles.disabledRow]} onPress={() => openTimePicker('start')}>
              <View style={styles.settingLeft}>
                <View style={[styles.settingIcon, { backgroundColor: theme.surface }]}>
                  <MaterialIcons name="schedule" size={20} color={theme.primary} />
                </View>
                <Text style={[styles.settingLabel, { color: theme.text }]}>具体时间</Text>
              </View>
              <View style={styles.settingRight}>
                <Text style={[styles.settingValue, { color: hasExactTime ? theme.primary : outline }]}>{exactTimeLabel}</Text>
                <Switch value={hasExactTime} onValueChange={setHasExactTime} />
              </View>
            </Pressable>
            <Pressable style={styles.settingRow} onPress={() => openSettingPicker('reminder')}>
              <View style={styles.settingLeft}>
                <View style={[styles.settingIcon, { backgroundColor: theme.surface }]}>
                  <MaterialIcons name="notifications" size={20} color={theme.primary} />
                </View>
                <Text style={[styles.settingLabel, { color: theme.text }]}>提醒设置</Text>
              </View>
              <View style={styles.settingRight}>
                <Text style={[styles.settingHint, { color: outline }]} numberOfLines={1} ellipsizeMode="tail">
                  {reminderOption}
                </Text>
                <MaterialIcons name="chevron-right" size={20} color={outline} />
              </View>
            </Pressable>
            <Pressable style={styles.settingRow} onPress={() => openSettingPicker('repeat')}>
              <View style={styles.settingLeft}>
                <View style={[styles.settingIcon, { backgroundColor: theme.surface }]}>
                  <MaterialIcons name="repeat" size={20} color={theme.primary} />
                </View>
                <Text style={[styles.settingLabel, { color: theme.text }]}>重复设置</Text>
              </View>
              <View style={styles.settingRight}>
                <Text style={[styles.settingHint, { color: outline }]} numberOfLines={1} ellipsizeMode="tail">
                  {repeatSummary}
                </Text>
                <MaterialIcons name="chevron-right" size={20} color={outline} />
              </View>
            </Pressable>
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
              {!allDay && (
                <>
                  <Pressable style={styles.settingRow} onPress={() => openTimePicker('start')}>
                    <View style={styles.settingLeft}>
                      <View style={[styles.settingIcon, { backgroundColor: theme.surface }]}>
                        <MaterialIcons name="schedule" size={20} color={theme.primary} />
                      </View>
                      <Text style={[styles.settingLabel, { color: theme.text }]}>开始</Text>
                    </View>
                    <Pressable style={styles.settingRight} onPress={() => openTimePicker('start')}>
                      <Text style={[styles.settingValueSmall, { color: theme.primary }]}>{startTimeLabel}</Text>
                      <MaterialIcons name="chevron-right" size={20} color={outline} />
                    </Pressable>
                  </Pressable>
                  <Pressable style={styles.settingRow} onPress={() => openTimePicker('end')}>
                    <View style={styles.settingLeft}>
                      <View style={[styles.settingIcon, { backgroundColor: theme.surface }]}>
                        <MaterialIcons name="timer-off" size={20} color={theme.primary} />
                      </View>
                      <Text style={[styles.settingLabel, { color: theme.text }]}>结束</Text>
                    </View>
                    <Pressable style={styles.settingRight} onPress={() => openTimePicker('end')}>
                      <Text style={[styles.settingValueSmall, { color: theme.primary }]}>{endTimeLabel}</Text>
                      <MaterialIcons name="chevron-right" size={20} color={outline} />
                    </Pressable>
                  </Pressable>
                </>
              )}
            </View>

            <View style={[styles.settingList, { backgroundColor: surfaceLow }]}>
              <Pressable style={styles.settingRow} onPress={() => openSettingPicker('reminder')}>
                <View style={styles.settingLeft}>
                  <View style={[styles.settingIcon, { backgroundColor: theme.surface }]}>
                    <MaterialIcons name="notifications" size={20} color={theme.primary} />
                  </View>
                  <Text style={[styles.settingLabel, { color: theme.text }]}>提醒设置</Text>
                </View>
                <View style={styles.settingRight}>
                  <Text style={[styles.settingHint, { color: outline }]}>{reminderOption}</Text>
                  <MaterialIcons name="chevron-right" size={20} color={outline} />
                </View>
              </Pressable>
              <Pressable style={styles.settingRow} onPress={() => openSettingPicker('repeat')}>
                <View style={styles.settingLeft}>
                  <View style={[styles.settingIcon, { backgroundColor: theme.surface }]}>
                    <MaterialIcons name="repeat" size={20} color={theme.primary} />
                  </View>
                  <Text style={[styles.settingLabel, { color: theme.text }]}>重复设置</Text>
                </View>
                <View style={styles.settingRight}>
                  <Text style={[styles.settingHint, { color: outline }]} numberOfLines={1} ellipsizeMode="tail">
                    {repeatSummary}
                  </Text>
                  <MaterialIcons name="chevron-right" size={20} color={outline} />
                </View>
              </Pressable>
            </View>

            <Pressable style={[styles.clearBtn, { borderColor: 'rgba(186,26,26,0.2)', backgroundColor: theme.surface }]} onPress={resetToDefaultState}>
              <Text style={styles.clearText}>清除</Text>
            </Pressable>
          </>
        )}
      </ScrollView>

      
      <Modal visible={timePickerVisible} transparent animationType="fade" onRequestClose={() => setTimePickerVisible(false)}>
        <View style={styles.pickerBackdrop}>
          <View style={[styles.pickerCard, { backgroundColor: theme.surface }]}>
            <Text style={[styles.pickerTitle, { color: theme.text }]}>{timePickerTitle}</Text>
            <DateTimePicker
              value={timeDraft}
              mode="time"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              is24Hour
              onChange={(_, date) => {
                if (date) setTimeDraft(date);
              }}
            />
            <View style={styles.pickerActions}>
              <Pressable
                onPress={() => {
                  setTimePickerVisible(false);
                }}
                style={[styles.pickerBtn, { backgroundColor: surfaceLow }]}
              >
                <Text style={[styles.pickerBtnText, { color: outline }]}>取消</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  applyTimeSelection(timePickerTarget, timeDraft);
                  setTimePickerVisible(false);
                }}
                style={[styles.pickerBtn, { backgroundColor: '#006c49' }]}
              >
                <Text style={[styles.pickerBtnText, { color: '#fff' }]}>确定</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
      <Modal visible={toastVisible} transparent animationType="fade" onRequestClose={() => setToastVisible(false)}>
        <View pointerEvents="box-none" style={styles.toastOverlay}>
          <View style={styles.toastHost}>
            <View style={[styles.toastWrap, { backgroundColor: isDark ? 'rgba(15,23,42,0.96)' : 'rgba(17,24,39,0.96)' }]}>
              <Text style={styles.toastText}>{toastMessage}</Text>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={settingPickerType !== null} transparent animationType="fade" onRequestClose={() => setSettingPickerType(null)}>
        <View style={styles.pickerBackdrop}>
          <View style={[styles.pickerCard, { backgroundColor: theme.surface }]}>
            <Text style={[styles.pickerTitle, { color: theme.text }]}>{settingPickerTitle}</Text>

            <View style={styles.optionList}>
              {settingPickerOptions.map((option) => {
                const selected = option === settingPickerValue;
                return (
                  <Pressable
                    key={option}
                    style={[styles.optionRow, { borderColor: selected ? '#006c49' : outlineVariant, backgroundColor: selected ? 'rgba(0,108,73,0.1)' : 'transparent' }]}
                    onPress={() => {
                      if (settingPickerType === 'reminder') setReminderOption(option as ReminderOption);
                      else {
                        const selectedRepeat = option as RepeatOption;
                        setRepeatOption(selectedRepeat);
                        setRepeatDetailVisible(selectedRepeat === '每周' || selectedRepeat === '每月' || selectedRepeat === '每年');

                      }
                      setSettingPickerType(null);
                    }}
                  >
                    <Text style={[styles.optionText, { color: selected ? '#006c49' : theme.text }]}>{option}</Text>
                    {selected ? <MaterialIcons name="check" size={18} color="#006c49" /> : null}
                  </Pressable>
                );
              })}
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={repeatDetailVisible} transparent animationType="fade" onRequestClose={() => setRepeatDetailVisible(false)}>
        <View style={styles.pickerBackdrop}>
          <View style={[styles.pickerCard, { backgroundColor: theme.surface }]}>
            <Text style={[styles.pickerTitle, { color: theme.text }]}>
              {repeatOption === '每周' ? '选择每周重复日' : repeatOption === '每月' ? '选择每月重复日期' : '选择每年重复日期'}
            </Text>

            {repeatOption === '每周' ? (
              <View style={styles.tagWrap}>
                {WEEKDAY_OPTIONS.map((item) => {
                  const active = weeklyDays.includes(item.value);
                  return (
                    <Pressable
                      key={item.value}
                      style={[styles.tagItem, { borderColor: active ? '#006c49' : outlineVariant, backgroundColor: active ? 'rgba(0,108,73,0.1)' : 'transparent' }]}
                      onPress={() => toggleWeeklyDay(item.value)}
                    >
                      <Text style={[styles.tagText, { color: active ? '#006c49' : theme.text }]}>{item.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}

            {repeatOption === '每月' ? (
              <View style={styles.tagWrap}>
                {MONTH_DAY_OPTIONS.map((day) => {
                  const active = monthlyDays.includes(day);
                  return (
                    <Pressable
                      key={day}
                      style={[styles.tagItem, { borderColor: active ? '#006c49' : outlineVariant, backgroundColor: active ? 'rgba(0,108,73,0.1)' : 'transparent' }]}
                      onPress={() => toggleMonthlyDay(day)}
                    >
                      <Text style={[styles.tagText, { color: active ? '#006c49' : theme.text }]}>{day}日</Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}

            {repeatOption === '每年' ? (
              <View style={styles.yearlyWrap}>
                <Pressable
                  style={[styles.yearlyDateBtn, { borderColor: outlineVariant }]}
                  onPress={openYearlyDatePicker}
                >
                  <Text style={[styles.settingLabel, { color: theme.text }]}>
                    {yearlyDate.getMonth() + 1}月{yearlyDate.getDate()}日
                  </Text>
                  <MaterialIcons name="calendar-month" size={18} color={outline} />
                </Pressable>
              </View>
            ) : null}

            <View style={styles.pickerActions}>
              <Pressable
                onPress={() => {
                  if (repeatOption === '每周' && weeklyDays.length === 0) setWeeklyDays([1]);
                  if (repeatOption === '每月' && monthlyDays.length === 0) setMonthlyDays([1]);
                  if (yearlyPickerOpenTimerRef.current) {
                    clearTimeout(yearlyPickerOpenTimerRef.current);
                    yearlyPickerOpenTimerRef.current = null;
                  }
                  setYearlyDatePickerVisible(false);
                  setRepeatDetailVisible(false);
                  setRepeatDetailVisible(false);
                }}
                style={[styles.pickerBtn, { backgroundColor: '#006c49' }]}
              >
                <Text style={[styles.pickerBtnText, { color: '#fff' }]}>完成</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={yearlyDatePickerVisible}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (yearlyPickerOpenTimerRef.current) {
            clearTimeout(yearlyPickerOpenTimerRef.current);
            yearlyPickerOpenTimerRef.current = null;
          }
          setYearlyDatePickerVisible(false);
        }}
      >
        <View style={styles.pickerBackdrop}>
          <View style={[styles.pickerCard, { backgroundColor: theme.surface }]}>
            <Text style={[styles.pickerTitle, { color: theme.text }]}>选择每年日期</Text>
            <DateTimePicker
              value={yearlyDate}
              mode="date"
              display={Platform.OS === 'ios' ? 'inline' : 'spinner'}
              minimumDate={yearlyPickerMinDate}
              maximumDate={yearlyPickerMaxDate}
              onChange={(_, date) => {
                if (date) {
                  const normalized = new Date(date);
                  normalized.setHours(0, 0, 0, 0);
                  setYearlyDate(normalized);
                }
              }}
            />
            <View style={styles.pickerActions}>
              <Pressable onPress={() => setYearlyDatePickerVisible(false)} style={[styles.pickerBtn, { backgroundColor: '#006c49' }]}>
                <Text style={[styles.pickerBtnText, { color: '#fff' }]}>确定</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
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
  calendarPager: { alignItems: 'stretch' },
  monthTitle: { fontSize: 28, fontWeight: '900' },
  monthActions: { flexDirection: 'row', gap: 8 },
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
  pastDayCircle: { opacity: 0.35 },
  pastDayText: { textDecorationLine: 'line-through' },
  dayNum: { fontSize: 18, fontWeight: '700', lineHeight: 20 },
  dayLunar: { fontSize: 9, fontWeight: '600' },
  settingList: { borderRadius: 14, overflow: 'hidden' },
  settingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14 },
  disabledRow: { opacity: 0.6 },
  settingLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  settingIcon: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  settingLabel: { fontSize: 16, fontWeight: '500' },
  settingRight: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1, minWidth: 0 },
  settingValue: { fontSize: 22, fontWeight: '800' },
  settingValueSmall: { fontSize: 22, fontWeight: '700' },
  settingHint: { fontSize: 14, fontWeight: '500' },
  clearBtn: { borderWidth: 1, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  clearText: { color: '#ba1a1a', fontSize: 16, fontWeight: '600' },
  pickerBackdrop: { flex: 1, backgroundColor: 'rgba(2,6,23,0.4)', justifyContent: 'center', paddingHorizontal: 24 },
  pickerCard: { borderRadius: 16, padding: 16, gap: 12 },
  toastOverlay: { flex: 1, justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 120 },
  toastHost: { width: '100%', alignItems: 'center' },
  toastWrap: { borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, maxWidth: '92%' },
  toastText: { color: '#fff', fontSize: 13, fontWeight: '600', textAlign: 'center' },
  pickerTitle: { fontSize: 16, fontWeight: '700', textAlign: 'center' },
  pickerActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
  pickerBtn: { borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10, minWidth: 72, alignItems: 'center' },
  pickerBtnText: { fontSize: 14, fontWeight: '600' },
  optionList: { gap: 8 },
  optionRow: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  optionText: { fontSize: 15, fontWeight: '500' },
  tagWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tagItem: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  tagText: { fontSize: 14, fontWeight: '500' },
  yearlyWrap: { gap: 10 },
  yearlyDateBtn: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
