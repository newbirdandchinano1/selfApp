import { Layout, Radius, Shadows, Spacing, Typography } from '@/constants/design-tokens';
import { useAppTheme } from '@/hooks/use-app-theme';
import {
  normalizeRouteParam,
  setSchedulePickerResult,
  type SchedulePickerResult,
} from '@/lib/schedule-picker-bridge';
import { MaterialIcons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as React from 'react';
import { FlatList, Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

type TabMode = 'date' | 'time';
type TimeRangeKey = '本周' | '下周' | '本月' | '下月' | '未来半年';
type ReminderOption = '不提前' | '提前1天' | '提前2天' | '提前3天' | '提前7天';
type RepeatOption = '不重复' | '每天' | '每周' | '每月' | '每年';
type SettingPickerType = 'reminder' | 'repeat' | 'timeStart' | 'timeEnd' | null;
type SettingModalStage = 'options' | 'repeatDetail';

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
  initial?: string;
  dateLimit?: string;
};

type SchedulePickerInitialValue = Omit<SchedulePickerResult, 'source'>;

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

/** 周一=1 … 周日=7，与重复规则存储一致 */
function getLocalWeekdayMon1(date = new Date()): number {
  return ((date.getDay() + 6) % 7) + 1;
}

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

/** 日历日期的本地年月日，避免 toISOString() 在 UTC 下截断后错一天。 */
function toLocalYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
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

function parseDateFromYMD(value: string | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [yearText, monthText, dayText] = value.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime())) return null;
  return startOfDay(date);
}

type DateLimit = {
  start?: Date;
  end?: Date;
};

function parseDateLimit(raw: string | undefined): DateLimit | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { start?: string; end?: string };
    const start = parseDateFromYMD(parsed?.start);
    const end = parseDateFromYMD(parsed?.end);
    if (!start && !end) return null;
    if (start && end && start.getTime() > end.getTime()) return { start, end: start };
    return { start: start ?? undefined, end: end ?? undefined };
  } catch {
    return null;
  }
}

function isDateInLimit(date: Date, limit: DateLimit | null): boolean {
  if (!limit) return true;
  const normalized = startOfDay(date).getTime();
  if (limit.start && normalized < limit.start.getTime()) return false;
  if (limit.end && normalized > limit.end.getTime()) return false;
  return true;
}

function clampDateInLimit(date: Date, limit: DateLimit | null): Date {
  if (!limit) return startOfDay(date);
  const normalized = startOfDay(date);
  if (limit.start && normalized.getTime() < limit.start.getTime()) return new Date(limit.start);
  if (limit.end && normalized.getTime() > limit.end.getTime()) return new Date(limit.end);
  return normalized;
}

function clampRangeInLimit(range: DateRange, limit: DateLimit | null): DateRange {
  if (!limit) return range;
  let start = startOfDay(range.start);
  let end = startOfDay(range.end);
  if (limit.start && start.getTime() < limit.start.getTime()) start = new Date(limit.start);
  if (limit.end && end.getTime() > limit.end.getTime()) end = new Date(limit.end);
  if (start.getTime() > end.getTime()) {
    start = new Date(end);
  }
  return { start, end };
}

function parseDateTime(value: string | undefined, fallbackDate: Date): Date {
  if (value) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date(fallbackDate);
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
  const sourceKey = React.useMemo(
    () => normalizeRouteParam(params.source as string | string[] | undefined),
    [params.source],
  );
  const { colors } = useAppTheme();

  const today = React.useMemo(() => new Date(), []);
  const todayStart = React.useMemo(() => startOfDay(today), [today]);
  const dateLimit = React.useMemo(
    () => parseDateLimit(typeof params.dateLimit === 'string' ? params.dateLimit : undefined),
    [params.dateLimit],
  );
  const isSingleDayLimit = React.useMemo(() => {
    if (!dateLimit?.start || !dateLimit.end) return false;
    return dateLimit.start.getTime() === dateLimit.end.getTime();
  }, [dateLimit]);
  const [tab, setTab] = React.useState<TabMode>('date');
  const [selectedDate, setSelectedDate] = React.useState<Date | null>(null);
  const [selectedQuickChip, setSelectedQuickChip] = React.useState<string>('');
  const [timeRangeKey, setTimeRangeKey] = React.useState<TimeRangeKey | null>(null);
  React.useEffect(() => {
    void timeRangeKey;
  }, [timeRangeKey]);
  const [timeRange, setTimeRange] = React.useState<DateRange | null>(null);
  const [timeSelectingEnd, setTimeSelectingEnd] = React.useState(false);
  const [monthOffset, setMonthOffset] = React.useState(0);
  const [visibleMonthOffset, setVisibleMonthOffset] = React.useState(0);
  const [allDay, setAllDay] = React.useState(true);
  const [hasExactTime, setHasExactTime] = React.useState(false);
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
  // 缓存弹窗关闭动画期间的类型，避免 UI 因为 state 先置空而闪烁
  const lastSettingPickerType = React.useRef<SettingPickerType>(null);
  if (settingPickerType !== null) {
    lastSettingPickerType.current = settingPickerType;
  }
  const displaySettingType = settingPickerType || lastSettingPickerType.current;
  const [reminderOption, setReminderOption] = React.useState<ReminderOption>('不提前');
  const defaultReminderTime = React.useMemo(() => {
    const t = new Date(todayStart);
    t.setHours(9, 0, 0, 0);
    return t;
  }, [todayStart]);
  const [reminderTime, setReminderTime] = React.useState<Date>(() => defaultReminderTime);
  const [reminderTimePickerVisible, setReminderTimePickerVisible] = React.useState(false);
  const [reminderTimeDraft, setReminderTimeDraft] = React.useState<Date>(() => defaultReminderTime);
  const [repeatOption, setRepeatOption] = React.useState<RepeatOption>('不重复');
  const [settingModalStage, setSettingModalStage] = React.useState<SettingModalStage>('options');
  const [weeklyDays, setWeeklyDays] = React.useState<number[]>([1]);
  const [monthlyDays, setMonthlyDays] = React.useState<number[]>([1]);
  const [yearlyDate, setYearlyDate] = React.useState<Date>(() => new Date(todayStart));
  const exactTime = startTime;
  const [timeDraft, setTimeDraft] = React.useState<Date>(startTime);
  const [timePickerTarget, setTimePickerTarget] = React.useState<'start' | 'end'>('start');
  const hasAppliedInitialRef = React.useRef(false);

  const { width: windowWidth } = useWindowDimensions();
  const [calendarWidth, setCalendarWidth] = React.useState(() => Math.max(1, windowWidth - Spacing['3xl'] * 2));
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

  const handleQuickChipPress = (chip: string) => {
    setSelectedQuickChip(chip);

    if (chip === '今天' || chip === '今晚') {
      const target = clampDateInLimit(todayStart, dateLimit);
      setTab('date');
      setTimeRangeKey(null);
      setTimeRange(null);
      setTimeSelectingEnd(false);
      setSelectedDate(target);
      setMonthOffset(getMonthDiff(todayStart, target));

      if (chip === '今晚') {
        setAllDay(false);
        setHasExactTime(true);
        const start = new Date(todayStart);
        start.setHours(20, 0, 0, 0);
        const end = new Date(todayStart);
        end.setHours(21, 0, 0, 0);
        setStartTime(start);
        setEndTime(end);
      } else {
        setAllDay(true);
        setHasExactTime(false);
      }
      if (!isDateInLimit(todayStart, dateLimit)) {
        showToast('已自动限制在父任务/项目允许的时间范围内');
      }
      return;
    }

    if (chip === '明天') {
      const origin = addDays(todayStart, 1);
      const target = clampDateInLimit(origin, dateLimit);
      setTab('date');
      setTimeRangeKey(null);
      setTimeRange(null);
      setTimeSelectingEnd(false);
      setSelectedDate(target);
      setMonthOffset(getMonthDiff(todayStart, target));
      setAllDay(true);
      setHasExactTime(false);
      if (!isDateInLimit(origin, dateLimit)) {
        showToast('已自动限制在父任务/项目允许的时间范围内');
      }
      return;
    }

    if (chip === '本周六') {
      const origin = getUpcomingWeekday(todayStart, 6);
      const target = clampDateInLimit(origin, dateLimit);
      setTab('date');
      setTimeRangeKey(null);
      setTimeRange(null);
      setTimeSelectingEnd(false);
      setSelectedDate(target);
      setMonthOffset(getMonthDiff(todayStart, target));
      setAllDay(true);
      setHasExactTime(false);
      if (!isDateInLimit(origin, dateLimit)) {
        showToast('已自动限制在父任务/项目允许的时间范围内');
      }
      return;
    }

    if (chip === '下周一') {
      const origin = addDays(getCurrentWeekStart(todayStart), 7);
      const target = clampDateInLimit(origin, dateLimit);
      setTab('date');
      setTimeRangeKey(null);
      setTimeRange(null);
      setTimeSelectingEnd(false);
      setSelectedDate(target);
      setMonthOffset(getMonthDiff(todayStart, target));
      setAllDay(true);
      setHasExactTime(false);
      if (!isDateInLimit(origin, dateLimit)) {
        showToast('已自动限制在父任务/项目允许的时间范围内');
      }
      return;
    }

    const rangeKey = chip as TimeRangeKey;
    const nextRange = clampRangeInLimit(getTimeRange(rangeKey, todayStart), dateLimit);
    if (nextRange.start.getTime() === nextRange.end.getTime()) {
      showToast('当前父任务/项目时间范围不足以设置“时刻”区间');
      return;
    }
    setTab('time');
    setSelectedQuickChip(chip);
    setTimeRangeKey(rangeKey);
    setTimeRange(nextRange);
    setTimeSelectingEnd(false);
    setSelectedDate(nextRange.start);
    setMonthOffset(getMonthDiff(todayStart, nextRange.start));
    setAllDay(false);
    setHasExactTime(false);
  };

  const handleDayPress = (year: number, month: number, day: number) => {
    const picked = new Date(year, month, day);
    if (!isDateInLimit(picked, dateLimit)) return;

    if (tab === 'time') {
      if (picked.getTime() < todayStart.getTime()) return;

      setSelectedQuickChip('');
      setTimeRangeKey(null);

      if (!timeRange || !timeSelectingEnd) {
        const nextRange = clampRangeInLimit({ start: picked, end: addDays(picked, 1) }, dateLimit);
        if (nextRange.start.getTime() === nextRange.end.getTime()) {
          showToast('当前父任务/项目时间范围不足以设置“时刻”区间');
          setTab('date');
          setTimeRange(null);
          setTimeSelectingEnd(false);
          setSelectedDate(nextRange.start);
          setMonthOffset(getMonthDiff(todayStart, nextRange.start));
          return;
        }
        setTimeRange(nextRange);
        setTimeSelectingEnd(true);
      } else {
        const start = startOfDay(timeRange.start);
        const end = startOfDay(picked);
        if (end.getTime() === start.getTime()) {
          showToast('时刻模式下开始和结束日期不能是同一天');
          return;
        }
        const nextRange = end.getTime() < start.getTime() ? { start: end, end: start } : { start, end };
        const clampedRange = clampRangeInLimit(nextRange, dateLimit);
        if (clampedRange.start.getTime() === clampedRange.end.getTime()) {
          showToast('当前父任务/项目时间范围不足以设置“时刻”区间');
          setTab('date');
          setTimeRange(null);
          setTimeSelectingEnd(false);
          setSelectedDate(clampedRange.start);
          setMonthOffset(getMonthDiff(todayStart, clampedRange.start));
          return;
        }
        setTimeRange(clampedRange);
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

  // “日期”分页选了某一天时，确保开始/结束时间的日期部分也落在该天（只保留时分）。
  React.useEffect(() => {
    if (tab !== 'date' || !selectedDate) return;
    setStartTime((prev) => {
      const next = new Date(selectedDate);
      next.setHours(prev.getHours(), prev.getMinutes(), 0, 0);
      return next;
    });
    setEndTime((prev) => {
      const next = new Date(selectedDate);
      next.setHours(prev.getHours(), prev.getMinutes(), 0, 0);
      return next;
    });
  }, [selectedDate, tab]);

  React.useEffect(() => {
    if (selectedDate) {
      const clampedDate = clampDateInLimit(selectedDate, dateLimit);
      if (clampedDate.getTime() !== selectedDate.getTime()) {
        setSelectedDate(clampedDate);
        setMonthOffset(getMonthDiff(todayStart, clampedDate));
      }
    }
    if (timeRange) {
      const clampedRange = clampRangeInLimit(timeRange, dateLimit);
      if (
        clampedRange.start.getTime() !== timeRange.start.getTime() ||
        clampedRange.end.getTime() !== timeRange.end.getTime()
      ) {
        setTimeRange(clampedRange);
      }
    }
  }, [dateLimit, selectedDate, timeRange, todayStart]);

  React.useEffect(() => {
    if (!isSingleDayLimit || tab !== 'time') return;
    setTab('date');
    setTimeRangeKey(null);
    setTimeRange(null);
    setTimeSelectingEnd(false);
  }, [isSingleDayLimit, tab]);

  const activeRange = tab === 'time' ? timeRange : null;
  const exactTimeLabel = formatTime(exactTime);

  const openTimePicker = (target: 'start' | 'end') => {
    // 仅在“日期分页”的“具体时间”关闭时禁止打开；“时刻分页”应始终允许选择开始/结束时间。
    if (tab === 'date' && !hasExactTime) return;
    setTimePickerTarget(target);
    setTimeDraft(target === 'start' ? startTime : endTime);
    setTimePickerVisible(true);
  };

  const resetToDefaultState = () => {
    if (yearlyPickerOpenTimerRef.current) {
      clearTimeout(yearlyPickerOpenTimerRef.current);
      yearlyPickerOpenTimerRef.current = null;
    }
    setSettingModalStage('options');
    setSelectedDate(null);
    setSelectedQuickChip('');
    setTimeRangeKey(null);
    setTimeRange(null);
    setTimeSelectingEnd(false);
    setMonthOffset(0);
    setVisibleMonthOffset(0);
    setAllDay(true);
    setHasExactTime(false);
    const defaultStart = new Date(todayStart);
    defaultStart.setHours(13, 0, 0, 0);
    const defaultEnd = new Date(todayStart);
    defaultEnd.setHours(14, 0, 0, 0);
    setStartTime(defaultStart);
    setEndTime(defaultEnd);
    setTimePickerVisible(false);
    setSettingPickerType(null);
    setReminderOption('不提前');
    setReminderTime(new Date(defaultReminderTime));
    setReminderTimeDraft(new Date(defaultReminderTime));
    setReminderTimePickerVisible(false);
    setRepeatOption('不重复');
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
    /** 设置了重复规则时，不把日历/时刻区间的选择带回来源页（仅提醒 + 重复规则生效） */
    const repeatLocksSchedule = repeatOption !== '不重复';
    const basePayload = {
      source: sourceKey,
      quickChip: selectedQuickChip,
      allDay: repeatLocksSchedule ? true : allDay,
      hasExactTime: repeatLocksSchedule ? false : hasExactTime,
      reminderOption,
      ...(reminderOption !== '不提前'
        ? { reminderHour: reminderTime.getHours(), reminderMinute: reminderTime.getMinutes() }
        : {}),
      repeatOption,
      repeatSummary: currentRepeatSummary,
      weeklyDays: [...weeklyDays],
      monthlyDays: [...monthlyDays],
      yearlyDate: toLocalYMD(yearlyDate),
      startTime: repeatLocksSchedule ? '' : startTime.toISOString(),
      endTime: repeatLocksSchedule ? '' : endTime.toISOString(),
    };

    if (tab === 'time') {
      if (repeatLocksSchedule) {
        return {
          mode: 'time',
          ...basePayload,
        };
      }
      const resolvedRange =
        timeRange ??
        (selectedDate
          ? {
              start: startOfDay(selectedDate),
              end: addDays(startOfDay(selectedDate), 1),
            }
          : null);
      if (!resolvedRange) {
        return {
          mode: 'time',
          ...basePayload,
        };
      }
      return {
        mode: 'time',
        ...basePayload,
        range: {
          start: toLocalYMD(resolvedRange.start),
          end: toLocalYMD(resolvedRange.end),
        },
      };
    }

    if (repeatLocksSchedule) {
      return {
        mode: 'date',
        ...basePayload,
      };
    }

    return {
      mode: 'date',
      ...basePayload,
      ...(selectedDate ? { date: toLocalYMD(selectedDate) } : {}),
    };
  }, [
    allDay,
    endTime,
    hasExactTime,
    monthlyDays,
    reminderOption,
    reminderTime,
    repeatOption,
    selectedDate,
    selectedQuickChip,
    sourceKey,
    startTime,
    tab,
    timeRange,
    weeklyDays,
    yearlyDate,
  ]);

  const applyTimeSelection = (target: 'start' | 'end', selected: Date) => {
    const normalized = new Date(selected);
    normalized.setSeconds(0, 0);
    const allowToast = tab === 'time';

    if (target === 'start') {
      setStartTime(normalized);
      setEndTime((prev) => {
        const minEnd = new Date(normalized.getTime() + 60 * 1000);
        if (prev.getTime() < minEnd.getTime()) {
          if (allowToast) showToast('结束时间已自动调整，且需至少晚于开始时间 1 分钟');
          return minEnd;
        }
        return prev;
      });
      return;
    }

    const minEnd = new Date(startTime.getTime() + 60 * 1000);
    const safeEnd = normalized.getTime() < minEnd.getTime() ? minEnd : normalized;
    setEndTime(safeEnd);
    if (allowToast && safeEnd.getTime() !== normalized.getTime()) {
      showToast('结束时间不能早于开始时间，且至少晚于开始时间 1 分钟');
    }
  };

  React.useEffect(() => {
    setEndTime((prev) => (prev.getTime() < startTime.getTime() ? new Date(startTime) : prev));
  }, [startTime]);
  const openSettingPicker = (type: Exclude<SettingPickerType, null>) => {
    setSettingModalStage('options');
    if (yearlyPickerOpenTimerRef.current) {
      clearTimeout(yearlyPickerOpenTimerRef.current);
      yearlyPickerOpenTimerRef.current = null;
    }
    setYearlyDatePickerVisible(false);

    setSettingPickerType(type);
  };
  const closeSettingPicker = React.useCallback(() => {
    setSettingModalStage('options');
    setYearlyDatePickerVisible(false);
    setSettingPickerType(null);
  }, []);
  const openYearlyDatePicker = React.useCallback(() => {
    if (yearlyPickerOpenTimerRef.current) {
      clearTimeout(yearlyPickerOpenTimerRef.current);
      yearlyPickerOpenTimerRef.current = null;
    }
    setYearlyDatePickerVisible(true);
  }, []);

  React.useEffect(() => {
    return () => {
      if (yearlyPickerOpenTimerRef.current) {
        clearTimeout(yearlyPickerOpenTimerRef.current);
      }
    };
  }, []);
  const settingPickerTitle =
    settingModalStage === 'repeatDetail'
      ? repeatOption === '每周'
        ? '选择每周重复日'
        : repeatOption === '每月'
          ? '选择每月重复日期'
          : '选择每年重复日期'
      : displaySettingType === 'reminder'
        ? '提醒设置'
        : '重复设置';
  const settingPickerOptions = displaySettingType === 'reminder' ? REMINDER_OPTIONS : REPEAT_OPTIONS;
  const settingPickerValue = displaySettingType === 'reminder' ? reminderOption : repeatOption;
  const startTimeLabel = formatTime(startTime);
  const endTimeLabel = formatTime(endTime);
  const timePickerTitle = timePickerTarget === 'start' ? '选择开始时间' : '选择结束时间';
  const repeatSummary = formatRepeatSummary(repeatOption, weeklyDays, monthlyDays, yearlyDate);
  const reminderTimeLabel = formatTime(reminderTime);
  const reminderSettingHint =
    reminderOption === '不提前' ? reminderOption : `${reminderOption} · ${reminderTimeLabel}`;

  const openReminderTimePicker = () => {
    setReminderTimeDraft(reminderTime);
    setReminderTimePickerVisible(true);
  };
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
    const nextWidth = Math.max(1, windowWidth - Spacing['3xl'] * 2);
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

  React.useEffect(() => {
    if (hasAppliedInitialRef.current) return;
    hasAppliedInitialRef.current = true;
    const raw = typeof params.initial === 'string' ? params.initial : '';
    if (!raw) return;

    try {
      const parsed = JSON.parse(raw) as Partial<SchedulePickerInitialValue>;
      const mode: TabMode = parsed.mode === 'time' ? 'time' : 'date';
      setTab(mode);
      setSelectedQuickChip(typeof parsed.quickChip === 'string' ? parsed.quickChip : '');

      const selectedReminder = parsed.reminderOption;
      if (selectedReminder && REMINDER_OPTIONS.includes(selectedReminder)) {
        setReminderOption(selectedReminder);
      }
      if (typeof parsed.reminderHour === 'number' && typeof parsed.reminderMinute === 'number') {
        const t = new Date(todayStart);
        t.setHours(parsed.reminderHour, parsed.reminderMinute, 0, 0);
        setReminderTime(t);
        setReminderTimeDraft(t);
      }
      const selectedRepeat = parsed.repeatOption;
      if (selectedRepeat && REPEAT_OPTIONS.includes(selectedRepeat)) {
        setRepeatOption(selectedRepeat);
      }
      if (Array.isArray(parsed.weeklyDays)) {
        const days = parsed.weeklyDays
          .filter((day): day is number => Number.isInteger(day) && day >= 1 && day <= 7);
        if (days.length > 0) setWeeklyDays(Array.from(new Set(days)));
      }
      if (Array.isArray(parsed.monthlyDays)) {
        const days = parsed.monthlyDays
          .filter((day): day is number => Number.isInteger(day) && day >= 1 && day <= 31);
        if (days.length > 0) setMonthlyDays(Array.from(new Set(days)));
      }
      if (typeof parsed.allDay === 'boolean') setAllDay(parsed.allDay);
      if (typeof parsed.hasExactTime === 'boolean') setHasExactTime(parsed.hasExactTime);

      const parsedDate = parseDateFromYMD(parsed.date);
      const dateBase = parsedDate ? clampDateInLimit(parsedDate, dateLimit) : null;
      const timeAnchor = dateBase ?? todayStart;
      const fallbackStart = new Date(timeAnchor);
      fallbackStart.setHours(13, 0, 0, 0);
      const fallbackEnd = new Date(timeAnchor);
      fallbackEnd.setHours(14, 0, 0, 0);
      const nextStartTime = parseDateTime(parsed.startTime, fallbackStart);
      const nextEndTime = parseDateTime(parsed.endTime, fallbackEnd);
      setStartTime(nextStartTime);
      setEndTime(nextEndTime);
      setTimeDraft(nextStartTime);
      setYearlyDate(parseDateFromYMD(parsed.yearlyDate) ?? new Date(timeAnchor));

      if (mode === 'time') {
        const rangeStart = parseDateFromYMD(parsed.range?.start) ?? dateBase ?? todayStart;
        const parsedRangeEnd = parseDateFromYMD(parsed.range?.end);
        const defaultRangeEnd = addDays(rangeStart, 1);
        const rangeEnd = parsedRangeEnd ?? defaultRangeEnd;
        let normalizedRange = rangeEnd.getTime() < rangeStart.getTime() ? { start: rangeEnd, end: rangeStart } : { start: rangeStart, end: rangeEnd };
        normalizedRange = clampRangeInLimit(normalizedRange, dateLimit);
        if (normalizedRange.start.getTime() === normalizedRange.end.getTime()) {
          setTab('date');
          setSelectedDate(normalizedRange.start);
          setMonthOffset(getMonthDiff(todayStart, normalizedRange.start));
          setTimeRangeKey(null);
          setTimeRange(null);
          setTimeSelectingEnd(false);
          return;
        }
        setTimeRange(normalizedRange);
        setTimeSelectingEnd(false);
        setSelectedDate(normalizedRange.start);
        setMonthOffset(getMonthDiff(todayStart, normalizedRange.start));
        const quickChip = parsed.quickChip;
        if (quickChip && timeQuickChips.includes(quickChip)) {
          setTimeRangeKey(quickChip as TimeRangeKey);
        } else {
          setTimeRangeKey(null);
        }
        return;
      }

      if (dateBase) {
        setSelectedDate(dateBase);
        setMonthOffset(getMonthDiff(todayStart, dateBase));
      } else {
        setSelectedDate(null);
        setMonthOffset(0);
      }
      setTimeRangeKey(null);
      setTimeRange(null);
      setTimeSelectingEnd(false);
    } catch {
      // ignore invalid external initial payload
    }
  }, [dateLimit, params.initial, todayStart]);


  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: colors.headerScrim }]}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn}>
          <MaterialIcons name="close" size={22} color={colors.outline} />
        </Pressable>

        <View style={[styles.tabSwitch, { backgroundColor: colors.capsule }]}>
          <Pressable onPress={() => setTab('date')} style={[styles.tabBtn, tab === 'date' && { backgroundColor: colors.surface }]}>
            <Text style={[styles.tabText, { color: tab === 'date' ? colors.primary : colors.textSecondary, fontWeight: tab === 'date' ? '700' : '500' }]}>日期</Text>
          </Pressable>
          <Pressable
            disabled={isSingleDayLimit}
            onPress={() => {
              if (isSingleDayLimit) return;
              if (!timeRange) {
                const base = clampDateInLimit(startOfDay(selectedDate ?? todayStart), dateLimit);
                const forward = clampRangeInLimit({ start: base, end: addDays(base, 1) }, dateLimit);
                const backward = clampRangeInLimit({ start: addDays(base, -1), end: base }, dateLimit);
                const proposed =
                  forward.start.getTime() !== forward.end.getTime()
                    ? forward
                    : backward.start.getTime() !== backward.end.getTime()
                      ? backward
                      : null;
                if (!proposed) {
                  showToast('当前父任务/项目时间范围不足以设置“时刻”区间');
                  setTab('date');
                  return;
                }
                setTimeRange(proposed);
                setTimeSelectingEnd(false);
              }
              setTab('time');
            }}
            style={[
              styles.tabBtn,
              tab === 'time' && { backgroundColor: colors.surface },
              isSingleDayLimit && { opacity: 0.45 },
            ]}
          >
            <Text
              style={[
                styles.tabText,
                {
                  color: tab === 'time' ? colors.primary : colors.textSecondary,
                  fontWeight: tab === 'time' ? '700' : '500',
                },
              ]}>
              时刻
            </Text>
          </Pressable>
        </View>

        <Pressable
          onPress={() => {
            setSchedulePickerResult(buildReturnPayload());
            router.back();
          }}
          style={styles.iconBtn}>
          <MaterialIcons name={tab === 'time' ? 'done' : 'check'} size={22} color={colors.primary} />
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
                  {
                    backgroundColor: isActive ? colors.primary : colors.surface,
                    borderColor: isActive ? colors.primary : colors.outline,
                  },
                ]}
              >
                <Text style={[styles.chipText, { color: isActive ? colors.onPrimary : colors.text }]}>{chip}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <View style={styles.calendarHead}>
          <Text style={[styles.monthTitle, { color: colors.text }]}>{visibleMonthTitle}</Text>
          <View style={styles.monthActions}>
            <Pressable style={styles.iconBtn} onPress={() => setMonthOffset((prev) => prev - 1)}>
              <MaterialIcons name="chevron-left" size={22} color={colors.outline} />
            </Pressable>
            <Pressable style={styles.iconBtn} onPress={() => setMonthOffset((prev) => prev + 1)}>
              <MaterialIcons name="chevron-right" size={22} color={colors.outline} />
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
                    <Text key={w} style={[styles.weekText, { color: colors.textSecondary }]}>
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
                    const isOutOfLimit = cell.inCurrentMonth && !isDateInLimit(cellDate, dateLimit);
                    const isSelected =
                      cell.inCurrentMonth &&
                      tab === 'date' &&
                      selectedDate !== null &&
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
                        onPress={() =>
                          cell.inCurrentMonth && !isPastDate && !isOutOfLimit && handleDayPress(currentMonthInfo.year, currentMonthInfo.month, day)
                        }
                        style={styles.dayCell}
                      >
                        {cell.inCurrentMonth ? (
                          <View style={styles.rangeWrap}>
                            {inRange && weekDayIndex !== 0 ? <View style={[styles.rangeLeftFill, { backgroundColor: colors.primaryMuted }]} /> : null}
                            {inRange && weekDayIndex !== 6 ? <View style={[styles.rangeRightFill, { backgroundColor: colors.primaryMuted }]} /> : null}

                            {showRangeLine ? (
                              <View style={[styles.dayCircle, styles.rangeMiddleCircle, { backgroundColor: colors.primaryMuted }]}>
                                <Text style={[styles.dayNum, { color: colors.primary }]}>{day}</Text>
                                <Text style={[styles.dayLunar, { color: colors.primary }]}>{lunar}</Text>
                              </View>
                            ) : (
                              <View
                                style={[
                                  styles.dayCircle,
                                  isSelected && { backgroundColor: colors.primary },
                                  isToday && !isSelected && { backgroundColor: colors.primaryMuted },
                                  isRangeStartOrEnd && { backgroundColor: colors.primary },
                                  inRange && !isRangeStartOrEnd && { backgroundColor: colors.primaryMuted },
                                  isRangeStartOrEnd && styles.rangeEndpoint,
                                  isToday && !isSelected && !isRangeStartOrEnd && [styles.todayCircle, { borderColor: colors.primaryRing }],
                                  isPastDate && styles.pastDayCircle,
                                  isOutOfLimit && styles.pastDayCircle,
                                ]}
                              >
                                <Text
                                  style={[
                                    styles.dayNum,
                                    {
                                      color:
                                        isSelected || isRangeStartOrEnd ? colors.onPrimary : isToday ? colors.primary : colors.text,
                                    },
                                    isPastDate && styles.pastDayText,
                                    isOutOfLimit && styles.pastDayText,
                                  ]}
                                >
                                  {day}
                                </Text>
                                <Text
                                  style={[
                                    styles.dayLunar,
                                    {
                                      color:
                                        isSelected || isRangeStartOrEnd ? colors.onPrimary : isToday ? colors.primary : colors.textSecondary,
                                    },
                                    isPastDate && styles.pastDayText,
                                    isOutOfLimit && styles.pastDayText,
                                  ]}
                                >
                                  {lunar}
                                </Text>
                              </View>
                            )}
                          </View>
                        ) : (
                          <View style={[styles.dayCircle, styles.outOfMonthCircle]}>
                            <Text style={[styles.dayNum, { color: colors.textSecondary, opacity: 0.4 }]}>{day}</Text>
                            <Text style={[styles.dayLunar, { color: colors.textSecondary, opacity: 0.35 }]}>{lunar}</Text>
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
          <>
            <View style={[styles.settingList, { backgroundColor: colors.input }]}>
              <Pressable style={[styles.settingRow, !hasExactTime && styles.disabledRow]} onPress={() => openTimePicker('start')}>
                <View style={styles.settingLeft}>
                  <View style={[styles.settingIcon, { backgroundColor: colors.surface }]}>
                    <MaterialIcons name="schedule" size={20} color={colors.primary} />
                  </View>
                  <Text style={[styles.settingLabel, { color: colors.text }]}>具体时间</Text>
                </View>
                <View style={styles.settingRight}>
                  <Text style={[styles.settingValue, { color: hasExactTime ? colors.primary : colors.textSecondary }]}>{exactTimeLabel}</Text>
                  <Switch
                    value={hasExactTime}
                    onValueChange={(next) => {
                      setHasExactTime(next);
                      // “具体时间”一旦启用，就不应再被视为“全天”。
                      setAllDay(!next);
                    }}
                  />
                </View>
              </Pressable>
              <Pressable style={styles.settingRow} onPress={() => openSettingPicker('reminder')}>
                <View style={styles.settingLeft}>
                  <View style={[styles.settingIcon, { backgroundColor: colors.surface }]}>
                    <MaterialIcons name="notifications" size={20} color={colors.primary} />
                  </View>
                  <Text style={[styles.settingLabel, { color: colors.text }]}>提醒设置</Text>
                </View>
                <View style={styles.settingRight}>
                  <Text style={[styles.settingHint, { color: colors.textSecondary }]} numberOfLines={1} ellipsizeMode="tail">
                    {reminderSettingHint}
                  </Text>
                  <MaterialIcons name="chevron-right" size={20} color={colors.outline} />
                </View>
              </Pressable>
              {reminderOption !== '不提前' ? (
                <Pressable style={styles.settingRow} onPress={openReminderTimePicker}>
                  <View style={styles.settingLeft}>
                    <View style={[styles.settingIcon, { backgroundColor: colors.surface }]}>
                      <MaterialIcons name="access-time" size={20} color={colors.primary} />
                    </View>
                    <Text style={[styles.settingLabel, { color: colors.text }]}>提醒时间</Text>
                  </View>
                  <View style={styles.settingRight}>
                    <Text style={[styles.settingValueSmall, { color: colors.primary }]}>{reminderTimeLabel}</Text>
                    <MaterialIcons name="chevron-right" size={20} color={colors.outline} />
                  </View>
                </Pressable>
              ) : null}
              <Pressable style={styles.settingRow} onPress={() => openSettingPicker('repeat')}>
                <View style={styles.settingLeft}>
                  <View style={[styles.settingIcon, { backgroundColor: colors.surface }]}>
                    <MaterialIcons name="repeat" size={20} color={colors.primary} />
                  </View>
                  <Text style={[styles.settingLabel, { color: colors.text }]}>重复设置</Text>
                </View>
                <View style={styles.settingRight}>
                  <Text style={[styles.settingHint, { color: colors.textSecondary }]} numberOfLines={1} ellipsizeMode="tail">
                    {repeatSummary}
                  </Text>
                  <MaterialIcons name="chevron-right" size={20} color={colors.outline} />
                </View>
              </Pressable>
            </View>

            <Pressable
              style={[styles.clearBtn, { borderColor: colors.outline, backgroundColor: colors.surface }]}
              onPress={resetToDefaultState}
            >
              <Text style={[styles.clearText, { color: colors.danger }]}>清除</Text>
            </Pressable>
          </>
        ) : (
          <>
            <View style={[styles.settingList, { backgroundColor: colors.input }]}>
              <View style={styles.settingRow}>
                <View style={styles.settingLeft}>
                  <View style={[styles.settingIcon, { backgroundColor: colors.surface }]}>
                    <MaterialIcons name="brightness-7" size={20} color={colors.primary} />
                  </View>
                  <Text style={[styles.settingLabel, { color: colors.text }]}>全天</Text>
                </View>
                <View style={styles.settingRight}>
                  <Switch value={allDay} onValueChange={setAllDay} />
                </View>
              </View>
              {!allDay && (
                <>
                  <Pressable style={styles.settingRow} onPress={() => openTimePicker('start')}>
                    <View style={styles.settingLeft}>
                      <View style={[styles.settingIcon, { backgroundColor: colors.surface }]}>
                        <MaterialIcons name="schedule" size={20} color={colors.primary} />
                      </View>
                      <Text style={[styles.settingLabel, { color: colors.text }]}>开始</Text>
                    </View>
                    <Pressable style={styles.settingRight} onPress={() => openTimePicker('start')}>
                      <Text style={[styles.settingValueSmall, { color: colors.primary }]}>{startTimeLabel}</Text>
                      <MaterialIcons name="chevron-right" size={20} color={colors.outline} />
                    </Pressable>
                  </Pressable>
                  <Pressable style={styles.settingRow} onPress={() => openTimePicker('end')}>
                    <View style={styles.settingLeft}>
                      <View style={[styles.settingIcon, { backgroundColor: colors.surface }]}>
                        <MaterialIcons name="timer-off" size={20} color={colors.primary} />
                      </View>
                      <Text style={[styles.settingLabel, { color: colors.text }]}>结束</Text>
                    </View>
                    <Pressable style={styles.settingRight} onPress={() => openTimePicker('end')}>
                      <Text style={[styles.settingValueSmall, { color: colors.primary }]}>{endTimeLabel}</Text>
                      <MaterialIcons name="chevron-right" size={20} color={colors.outline} />
                    </Pressable>
                  </Pressable>
                </>
              )}
            </View>

            <View style={[styles.settingList, { backgroundColor: colors.input }]}>
              <Pressable style={styles.settingRow} onPress={() => openSettingPicker('reminder')}>
                <View style={styles.settingLeft}>
                  <View style={[styles.settingIcon, { backgroundColor: colors.surface }]}>
                    <MaterialIcons name="notifications" size={20} color={colors.primary} />
                  </View>
                  <Text style={[styles.settingLabel, { color: colors.text }]}>提醒设置</Text>
                </View>
                <View style={styles.settingRight}>
                  <Text style={[styles.settingHint, { color: colors.textSecondary }]}>{reminderSettingHint}</Text>
                  <MaterialIcons name="chevron-right" size={20} color={colors.outline} />
                </View>
              </Pressable>
              {reminderOption !== '不提前' ? (
                <Pressable style={styles.settingRow} onPress={openReminderTimePicker}>
                  <View style={styles.settingLeft}>
                    <View style={[styles.settingIcon, { backgroundColor: colors.surface }]}>
                      <MaterialIcons name="access-time" size={20} color={colors.primary} />
                    </View>
                    <Text style={[styles.settingLabel, { color: colors.text }]}>提醒时间</Text>
                  </View>
                  <View style={styles.settingRight}>
                    <Text style={[styles.settingValueSmall, { color: colors.primary }]}>{reminderTimeLabel}</Text>
                    <MaterialIcons name="chevron-right" size={20} color={colors.outline} />
                  </View>
                </Pressable>
              ) : null}
              <Pressable style={styles.settingRow} onPress={() => openSettingPicker('repeat')}>
                <View style={styles.settingLeft}>
                  <View style={[styles.settingIcon, { backgroundColor: colors.surface }]}>
                    <MaterialIcons name="repeat" size={20} color={colors.primary} />
                  </View>
                  <Text style={[styles.settingLabel, { color: colors.text }]}>重复设置</Text>
                </View>
                <View style={styles.settingRight}>
                  <Text style={[styles.settingHint, { color: colors.textSecondary }]} numberOfLines={1} ellipsizeMode="tail">
                    {repeatSummary}
                  </Text>
                  <MaterialIcons name="chevron-right" size={20} color={colors.outline} />
                </View>
              </Pressable>
            </View>

            <Pressable style={[styles.clearBtn, { borderColor: colors.outline, backgroundColor: colors.surface }]} onPress={resetToDefaultState}>
              <Text style={[styles.clearText, { color: colors.danger }]}>清除</Text>
            </Pressable>
          </>
        )}
      </ScrollView>

      
      <Modal visible={timePickerVisible} transparent animationType="fade" onRequestClose={() => setTimePickerVisible(false)}>
        <View style={[styles.pickerBackdrop, { backgroundColor: colors.overlay }]}>
          <View style={[styles.pickerCard, { backgroundColor: colors.surface }]}>
            <Text style={[styles.pickerTitle, { color: colors.text }]}>{timePickerTitle}</Text>
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
                style={[styles.pickerBtn, { backgroundColor: colors.input }]}
              >
                <Text style={[styles.pickerBtnText, { color: colors.textSecondary }]}>取消</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  applyTimeSelection(timePickerTarget, timeDraft);
                  setTimePickerVisible(false);
                }}
                style={[styles.pickerBtn, { backgroundColor: colors.primary }]}
              >
                <Text style={[styles.pickerBtnText, { color: colors.onPrimary }]}>确定</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
      <Modal
        visible={reminderTimePickerVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setReminderTimePickerVisible(false)}
      >
        <View style={[styles.pickerBackdrop, { backgroundColor: colors.overlay }]}>
          <View style={[styles.pickerCard, { backgroundColor: colors.surface }]}>
            <Text style={[styles.pickerTitle, { color: colors.text }]}>选择提醒时间</Text>
            <DateTimePicker
              value={reminderTimeDraft}
              mode="time"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              is24Hour
              onChange={(_, date) => {
                if (date) setReminderTimeDraft(date);
              }}
            />
            <View style={styles.pickerActions}>
              <Pressable
                onPress={() => setReminderTimePickerVisible(false)}
                style={[styles.pickerBtn, { backgroundColor: colors.input }]}
              >
                <Text style={[styles.pickerBtnText, { color: colors.textSecondary }]}>取消</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  const normalized = new Date(reminderTimeDraft);
                  normalized.setSeconds(0, 0);
                  setReminderTime(normalized);
                  setReminderTimePickerVisible(false);
                }}
                style={[styles.pickerBtn, { backgroundColor: colors.primary }]}
              >
                <Text style={[styles.pickerBtnText, { color: colors.onPrimary }]}>确定</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
      <Modal visible={toastVisible} transparent animationType="fade" onRequestClose={() => setToastVisible(false)}>
        <View pointerEvents="box-none" style={styles.toastOverlay}>
          <View style={styles.toastHost}>
            <View style={[styles.toastWrap, { backgroundColor: colors.accentCard }]}>
              <Text style={[styles.toastText, { color: colors.onAccent }]}>{toastMessage}</Text>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={settingPickerType !== null}
        transparent
        animationType="fade"
        onRequestClose={closeSettingPicker}
      >
        {yearlyDatePickerVisible ? (
          <View style={[styles.pickerBackdrop, { backgroundColor: colors.overlay }]}>
            <View style={[styles.pickerCard, { backgroundColor: colors.surface }]}>
              <Text style={[styles.pickerTitle, { color: colors.text }]}>选择每年日期</Text>
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
                <Pressable onPress={() => setYearlyDatePickerVisible(false)} style={[styles.pickerBtn, { backgroundColor: colors.primary }]}>
                  <Text style={[styles.pickerBtnText, { color: colors.onPrimary }]}>确定</Text>
                </Pressable>
              </View>
            </View>
          </View>
        ) : (
          <Pressable style={[styles.pickerBackdrop, { backgroundColor: colors.overlay }]} onPress={closeSettingPicker}>
            <View
              // Prevent backdrop onPress from firing when tapping inside card (iOS can otherwise "leak" the press).
              onStartShouldSetResponder={() => true}
              style={[styles.pickerCard, { backgroundColor: colors.surface }]}
            >
              <Text style={[styles.pickerTitle, { color: colors.text }]}>{settingPickerTitle}</Text>

              {settingModalStage === 'options' ? (
                <View style={styles.optionList}>
                  {settingPickerOptions.map((option) => {
                    const selected = option === settingPickerValue;
                    return (
                      <Pressable
                        key={option}
                        style={[
                          styles.optionRow,
                          {
                            borderColor: selected ? colors.primary : colors.outline,
                            backgroundColor: selected ? colors.primaryMuted : 'transparent',
                          },
                        ]}
                        onPress={() => {
                          if (displaySettingType === 'reminder') {
                            setReminderOption(option as ReminderOption);
                            closeSettingPicker();
                            return;
                          }

                          const selectedRepeat = option as RepeatOption;
                          setRepeatOption(selectedRepeat);
                          if (selectedRepeat === '每周') setWeeklyDays([]);
                          if (selectedRepeat === '每月') setMonthlyDays([]);
                          const needsDetail = selectedRepeat === '每周' || selectedRepeat === '每月' || selectedRepeat === '每年';
                          if (needsDetail) {
                            setSettingModalStage('repeatDetail');
                          } else {
                            closeSettingPicker();
                          }
                        }}
                      >
                        <Text style={[styles.optionText, { color: selected ? colors.primary : colors.text }]}>{option}</Text>
                        {selected ? <MaterialIcons name="check" size={18} color={colors.primary} /> : null}
                      </Pressable>
                    );
                  })}
                </View>
              ) : (
                <>
                  {repeatOption === '每周' ? (
                    <View style={styles.tagWrap}>
                      {WEEKDAY_OPTIONS.map((item) => {
                        const active = weeklyDays.includes(item.value);
                        return (
                          <Pressable
                            key={item.value}
                            style={[
                              styles.tagItem,
                              {
                                borderColor: active ? colors.primary : colors.outline,
                                backgroundColor: active ? colors.primaryMuted : 'transparent',
                              },
                            ]}
                            onPress={() => toggleWeeklyDay(item.value)}
                          >
                            <Text style={[styles.tagText, { color: active ? colors.primary : colors.text }]}>{item.label}</Text>
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
                            style={[
                              styles.tagItem,
                              {
                                borderColor: active ? colors.primary : colors.outline,
                                backgroundColor: active ? colors.primaryMuted : 'transparent',
                              },
                            ]}
                            onPress={() => toggleMonthlyDay(day)}
                          >
                            <Text style={[styles.tagText, { color: active ? colors.primary : colors.text }]}>{day}日</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  ) : null}

                  {repeatOption === '每年' ? (
                    <View style={styles.yearlyWrap}>
                      <Pressable style={[styles.yearlyDateBtn, { borderColor: colors.outline }]} onPress={openYearlyDatePicker}>
                        <Text style={[styles.settingLabel, { color: colors.text }]}>
                          {yearlyDate.getMonth() + 1}月{yearlyDate.getDate()}日
                        </Text>
                        <MaterialIcons name="calendar-month" size={18} color={colors.outline} />
                      </Pressable>
                    </View>
                  ) : null}

                  <View style={styles.pickerActions}>
                    <Pressable
                      onPress={() => {
                        if (repeatOption === '每周' && weeklyDays.length === 0) {
                          setWeeklyDays([getLocalWeekdayMon1()]);
                        }
                        if (repeatOption === '每月' && monthlyDays.length === 0) {
                          setMonthlyDays([new Date().getDate()]);
                        }
                        if (yearlyPickerOpenTimerRef.current) {
                          clearTimeout(yearlyPickerOpenTimerRef.current);
                          yearlyPickerOpenTimerRef.current = null;
                        }
                        setYearlyDatePickerVisible(false);
                        closeSettingPicker();
                      }}
                      style={[styles.pickerBtn, { backgroundColor: colors.primary }]}
                    >
                      <Text style={[styles.pickerBtnText, { color: colors.onPrimary }]}>完成</Text>
                    </Pressable>
                  </View>
                </>
              )}
            </View>
          </Pressable>
        )}
      </Modal>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing['3xl'],
    paddingVertical: Spacing.lg,
  },
  iconBtn: {
    width: Layout.iconButtonSize,
    height: Layout.iconButtonSize,
    borderRadius: Radius.icon,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabSwitch: { flexDirection: 'row', borderRadius: Radius.md, padding: Spacing.xs, gap: Spacing.xs },
  tabBtn: { paddingHorizontal: Spacing['6xl'], paddingVertical: Spacing.sm, borderRadius: Radius.sm },
  tabText: Typography.body,
  content: { padding: Spacing['3xl'], gap: Spacing['5xl'], paddingBottom: Spacing['7xl'] },
  chipsRow: { gap: Spacing.lg },
  chip: { borderWidth: StyleSheet.hairlineWidth, borderRadius: Radius.md, paddingHorizontal: Spacing['3xl'], paddingVertical: Spacing.lg },
  chipText: { fontSize: 14, fontWeight: '500' },
  calendarHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  calendarPager: { alignItems: 'stretch' },
  monthTitle: { ...Typography.h1, fontSize: 28 },
  monthActions: { flexDirection: 'row', gap: Spacing.md },
  calendarPage: { width: '100%' },
  weekRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: Spacing.md },
  weekText: { width: '14.28%', textAlign: 'center', ...Typography.label },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  dayCell: { width: '14.28%', alignItems: 'center', paddingVertical: Spacing.md },
  rangeWrap: { width: '100%', alignItems: 'center', justifyContent: 'center' },
  rangeLeftFill: { position: 'absolute', left: 0, right: '50%', top: Spacing.sm, bottom: Spacing.sm },
  rangeRightFill: { position: 'absolute', left: '50%', right: 0, top: Spacing.sm, bottom: Spacing.sm },
  dayCircle: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', zIndex: 1 },
  todayCircle: { borderWidth: 2 },
  rangeMiddleCircle: { opacity: 0.95 },
  rangeEndpoint: { zIndex: 2 },
  outOfMonthCircle: { opacity: 0.5 },
  pastDayCircle: { opacity: 0.35 },
  pastDayText: { textDecorationLine: 'line-through' },
  dayNum: { fontSize: 18, fontWeight: '700', lineHeight: 20 },
  dayLunar: { fontSize: 9, fontWeight: '600' },
  settingList: { borderRadius: Radius.lg, overflow: 'hidden' },
  settingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: Spacing['2xl'] },
  disabledRow: { opacity: 0.6 },
  settingLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.lg },
  settingIcon: { width: 40, height: 40, borderRadius: Radius.sm, alignItems: 'center', justifyContent: 'center' },
  settingLabel: { fontSize: 16, fontWeight: '500' },
  settingRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, flexShrink: 1, minWidth: 0 },
  settingValue: { fontSize: 22, fontWeight: '800' },
  settingValueSmall: { fontSize: 22, fontWeight: '700' },
  settingHint: { fontSize: 14, fontWeight: '500' },
  clearBtn: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.md,
    paddingVertical: Spacing['2xl'],
    alignItems: 'center',
  },
  clearText: { fontSize: 16, fontWeight: '600' },
  pickerBackdrop: { flex: 1, justifyContent: 'center', paddingHorizontal: Spacing['6xl'] },
  pickerCard: { borderRadius: Radius.xl, padding: Spacing['3xl'], gap: Spacing.xl, ...Shadows.sheet },
  toastOverlay: { flex: 1, justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 120 },
  toastHost: { width: '100%', alignItems: 'center' },
  toastWrap: { borderRadius: Radius.pill, paddingHorizontal: Spacing['2xl'], paddingVertical: Spacing.md, maxWidth: '92%', ...Shadows.card },
  toastText: { fontSize: 13, fontWeight: '600', textAlign: 'center' },
  pickerTitle: { ...Typography.title, textAlign: 'center' },
  pickerActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: Spacing.lg },
  pickerBtn: { borderRadius: Radius.sm, paddingHorizontal: Spacing['3xl'], paddingVertical: Spacing.lg, minWidth: 72, alignItems: 'center' },
  pickerBtnText: { fontSize: 14, fontWeight: '600' },
  optionList: { gap: Spacing.md },
  optionRow: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.xl,
    paddingVertical: 11,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  optionText: { fontSize: 15, fontWeight: '500' },
  tagWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md },
  tagItem: { borderWidth: StyleSheet.hairlineWidth, borderRadius: Radius.sm, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md },
  tagText: { fontSize: 14, fontWeight: '500' },
  yearlyWrap: { gap: Spacing.lg },
  yearlyDateBtn: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.xl,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
});
