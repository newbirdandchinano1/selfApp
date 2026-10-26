/**
 * 日程选择器 — 对齐设计稿 shot 21
 * 日期/时刻 Tab 指示器 · 快捷芯片 · 月历 · 全天开关 · 提醒/重复 · 越界 toast+钳制
 */
import { FoldRiseIn, FOLD_MOTION_EASE, useFoldMotionGate } from '@/components/review/fold-motion';
import { TaskFoldSwitch } from '@/components/tasks/task-fold-switch';
import { Radius, Shadows, Spacing, Typography } from '@/constants/design-tokens';
import { TaskFoldMotion, useTaskFoldTheme } from '@/constants/task-fold-theme';
import { usePageDayBoundary } from '@/contexts/day-boundary-context';
import { toast, Alert } from '@/lib/app-feedback';
import { getCalendarLunarLabel } from '@/lib/lunar-day-label';
import { addDays } from '@/lib/date';
import {
  normalizeRouteParam,
  setSchedulePickerResult,
  type SchedulePickerResult,
} from '@/lib/schedule-picker-bridge';
import { TASK_REMINDER_OPTIONS, type TaskReminderOption } from '@/lib/task-reminder-schedule';
import { MaterialIcons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as React from 'react';
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Modal,
  PixelRatio,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

type TabMode = 'date' | 'time';
type TimeRangeKey = '本周' | '下周' | '本月' | '下月' | '未来半年';
type ReminderOption = TaskReminderOption;
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
  year: number;
  /** 0–11，与 Date#getMonth 一致 */
  month: number;
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

const WEEK_LABELS = ['一', '二', '三', '四', '五', '六', '日'];
const MONTH_PAGE_SPAN = 481;
const MONTH_PAGE_CENTER_INDEX = Math.floor(MONTH_PAGE_SPAN / 2);
const REMINDER_OPTIONS: ReminderOption[] = TASK_REMINDER_OPTIONS;

/** 亚像素宽度会导致 paging/snap 停在两月之间（左右各露一半） */
function roundCalendarWidth(width: number): number {
  return PixelRatio.roundToNearestPixel(width);
}
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
  // Date 会自动进位（如 month=12 → 次年 1 月），这里必须写回归一化后的 year/month，
  // 否则跨年格子会把 month=12 再 +1 传给农历库，触发 "wrong month 13"。
  const first = new Date(year, month, 1);
  const normalizedYear = first.getFullYear();
  const normalizedMonth = first.getMonth();
  const daysInMonth = new Date(normalizedYear, normalizedMonth + 1, 0).getDate();
  const jsDay = first.getDay(); // 0 = Sun
  const firstDayOffset = (jsDay + 6) % 7; // 0 = Mon
  return { year: normalizedYear, month: normalizedMonth, daysInMonth, firstDayOffset };
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
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
  if (!value) return null;
  // 接受 YYYY-MM-DD 或带时刻的 ISO（scheduleMeta.date 常为 `2026-10-25T12:00:00`）
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime())) return null;
  // 拒绝 Date 自动进位（如 2026-02-31 → 3 月）
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
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
      cells.push({
        key: `prev-${previous.year}-${previous.month}-${day}`,
        year: previous.year,
        month: previous.month,
        day,
        inCurrentMonth: false,
      });
      continue;
    }

    const currentDayIndex = i - prevMonthVisibleCount + 1;
    if (currentDayIndex <= current.daysInMonth) {
      cells.push({
        key: `curr-${current.year}-${current.month}-${currentDayIndex}`,
        year: current.year,
        month: current.month,
        day: currentDayIndex,
        inCurrentMonth: true,
      });
      continue;
    }

    const day = i - (prevMonthVisibleCount + current.daysInMonth) + 1;
    cells.push({
      key: `next-${next.year}-${next.month}-${day}`,
      year: next.year,
      month: next.month,
      day,
      inCurrentMonth: false,
    });
  }

  return cells;
}

function formatLimitLabel(d: Date): string {
  return `${d.getMonth() + 1}/${String(d.getDate()).padStart(2, '0')}`;
}

function formatSelectedDayLabel(d: Date | null): string {
  if (!d) return '未选日期';
  const wd = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
  return `${d.getMonth() + 1}月${d.getDate()}日 周${wd}`;
}

/** 设计稿 anim-item：520ms / 42ms 错峰 */
const PICK_RISE_MS = 520;
const PICK_RISE_STAGGER = TaskFoldMotion.schedBlockStagger;
/** 月历按周错峰（6 行，避免 42 格同时驱动被 FlatList 冲掉） */
const PICK_CAL_WEEK_STAGGER = 52;
const PICK_CAL_WEEK_DURATION = TaskFoldMotion.habitCalFade;

export default function SchedulePickerScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<SchedulePickerReturnParams>();
  const sourceKey = React.useMemo(
    () => normalizeRouteParam(params.source as string | string[] | undefined),
    [params.source],
  );
  const { tf, fonts, isDark } = useTaskFoldTheme();
  const { animate: foldAnimate, motionReduced, motionReady } = useFoldMotionGate();
  const enterReady = motionReady;
  const showContent = enterReady || (motionReady && motionReduced);
  const enterAnimate = foldAnimate && enterReady;
  const holdEntrance = !motionReduced;
  /** 只给入场时那一页月历播周错峰，换月/邻页不重播 */
  const calBloomMonthRef = React.useRef<number | null>(null);
  /** FlatList 量宽/定位完成后再解锁，否则入场动画会被 scrollToIndex 打断成「瞬出」 */
  const [calBloomArmed, setCalBloomArmed] = React.useState(false);
  const tabSlide = React.useRef(new Animated.Value(0)).current;
  const [pickTabWidth, setPickTabWidth] = React.useState(0);
  /** 折页令牌 → 旧 colors 形状，弹层与月历格子复用 */
  const colors = React.useMemo(
    () => ({
      background: tf.paper,
      headerScrim: tf.paper,
      surface: isDark ? 'rgba(255,252,245,0.08)' : tf.card,
      capsule: tf.track,
      primary: tf.pond,
      onPrimary: tf.onPond,
      text: tf.ink,
      textSecondary: tf.muted,
      outline: tf.line2,
      input: isDark ? tf.paper2 : 'rgba(255,252,245,0.72)',
      primaryMuted: tf.lily2,
      primaryRing: tf.sage,
      danger: tf.clay,
      overlay: tf.dim,
    }),
    [isDark, tf],
  );

  const { logicalTodayDate } = usePageDayBoundary('tasks');
  const today = React.useMemo(() => startOfDay(logicalTodayDate), [logicalTodayDate]);
  const todayStart = today;
  const dateLimit = React.useMemo(
    () => parseDateLimit(typeof params.dateLimit === 'string' ? params.dateLimit : undefined),
    [params.dateLimit],
  );
  const isSingleDayLimit = React.useMemo(() => {
    if (!dateLimit?.start || !dateLimit.end) return false;
    return dateLimit.start.getTime() === dateLimit.end.getTime();
  }, [dateLimit]);
  const [tab, setTab] = React.useState<TabMode>('date');
  React.useEffect(() => {
    Animated.timing(tabSlide, {
      toValue: tab === 'time' ? 1 : 0,
      duration: foldAnimate ? TaskFoldMotion.pickTabInd : 120,
      easing: FOLD_MOTION_EASE,
      useNativeDriver: true,
    }).start();
  }, [foldAnimate, tab, tabSlide]);
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
  const reminderTimeUserSetRef = React.useRef(false);
  const [repeatOption, setRepeatOption] = React.useState<RepeatOption>('不重复');
  const [settingModalStage, setSettingModalStage] = React.useState<SettingModalStage>('options');
  const [weeklyDays, setWeeklyDays] = React.useState<number[]>([1]);
  const [monthlyDays, setMonthlyDays] = React.useState<number[]>([1]);
  const [yearlyDate, setYearlyDate] = React.useState<Date>(() => new Date(todayStart));
  const exactTime = startTime;
  const [timeDraft, setTimeDraft] = React.useState<Date>(startTime);
  const [timePickerTarget, setTimePickerTarget] = React.useState<'start' | 'end'>('start');
  const hasAppliedInitialRef = React.useRef(false);

  /** 先测容器宽再挂 FlatList，避免估宽 / 亚像素导致翻页停在两月之间 */
  const [calendarWidth, setCalendarWidth] = React.useState(0);
  const [pagerMountKey, setPagerMountKey] = React.useState(0);
  const pagerRef = React.useRef<FlatList<number>>(null);
  const pagerCurrentIndexRef = React.useRef(MONTH_PAGE_CENTER_INDEX);
  const pagerSettledRef = React.useRef(false);
  const calendarWidthRef = React.useRef(0);
  const pagerData = React.useMemo(
    () => Array.from({ length: MONTH_PAGE_SPAN }, (_, i) => i - MONTH_PAGE_CENTER_INDEX),
    []
  );

  React.useEffect(() => {
    calendarWidthRef.current = calendarWidth;
  }, [calendarWidth]);

  const commitPagerIndex = React.useCallback((nextIndex: number) => {
    if (!pagerSettledRef.current) return;
    const clamped = Math.max(0, Math.min(MONTH_PAGE_SPAN - 1, nextIndex));
    pagerCurrentIndexRef.current = clamped;
    const nextOffset = clamped - MONTH_PAGE_CENTER_INDEX;
    setVisibleMonthOffset(nextOffset);
    setMonthOffset((prev) => (prev === nextOffset ? prev : nextOffset));
  }, []);

  const snapPagerToOffset = React.useCallback(
    (contentOffsetX: number, animatedScroll: boolean) => {
      if (!pagerSettledRef.current) return;
      const w = calendarWidthRef.current;
      if (w <= 0) return;
      const nextIndex = Math.round(contentOffsetX / w);
      const targetOffset = nextIndex * w;
      if (Math.abs(contentOffsetX - targetOffset) > 0.5) {
        pagerRef.current?.scrollToOffset({ offset: targetOffset, animated: animatedScroll });
      }
      commitPagerIndex(nextIndex);
    },
    [commitPagerIndex],
  );

  const scrollPagerToMonthOffset = React.useCallback((offset: number, animated: boolean) => {
    const w = calendarWidthRef.current;
    if (w <= 0) return;
    const nextIndex = offset + MONTH_PAGE_CENTER_INDEX;
    pagerCurrentIndexRef.current = nextIndex;
    pagerRef.current?.scrollToOffset({ offset: nextIndex * w, animated });
  }, []);

  const onPagerContainerLayout = React.useCallback(
    (e: { nativeEvent: { layout: { width: number } } }) => {
      const width = roundCalendarWidth(e.nativeEvent.layout.width);
      if (width <= 0) return;
      const prev = calendarWidthRef.current;
      if (Math.abs(prev - width) < 0.5) return;
      pagerSettledRef.current = false;
      calendarWidthRef.current = width;
      setCalendarWidth(width);
      setPagerMountKey((k) => k + 1);
    },
    [],
  );

  const onPagerListLoad = React.useCallback(() => {
    if (pagerSettledRef.current) return;
    const w = calendarWidthRef.current;
    if (w <= 0) return;
    const targetIndex = MONTH_PAGE_CENTER_INDEX + monthOffset;
    pagerCurrentIndexRef.current = targetIndex;
    requestAnimationFrame(() => {
      pagerRef.current?.scrollToOffset({ offset: targetIndex * w, animated: false });
      requestAnimationFrame(() => {
        pagerSettledRef.current = true;
        setVisibleMonthOffset(monthOffset);
      });
    });
  }, [monthOffset]);
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
    setAllDay(true);
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
    reminderTimeUserSetRef.current = false;
    setReminderTime(new Date(defaultReminderTime));
    setReminderTimeDraft(new Date(defaultReminderTime));
    setReminderTimePickerVisible(false);
    setRepeatOption('不重复');
    setWeeklyDays([1]);
    setMonthlyDays([1]);
    setYearlyDate(new Date(todayStart));
    setYearlyDatePickerVisible(false);
    setTimeDraft(defaultStart);
    setTimePickerTarget('start');
  };

  const confirmClearSchedule = () => {
    Alert.alert('清除日程设置', '将清除已选日期、时间区间、提醒与重复等设置，是否继续？', [
      { text: '取消', style: 'cancel' },
      { text: '清除', style: 'destructive', onPress: resetToDefaultState },
    ]);
  };

  const showToast = React.useCallback((message: string) => {
    toast.warn(message);
  }, []);

  const buildReturnPayload = React.useCallback((): SchedulePickerResult => {
    const currentRepeatSummary = formatRepeatSummary(repeatOption, weeklyDays, monthlyDays, yearlyDate);
    /**
     * 设置了重复规则时，不把日历/时刻区间带回（date/range 无效）。
     * 仍保留「具体时间」：供重复待办自动入格映射到日程表格子。
     */
    const repeatLocksSchedule = repeatOption !== '不重复';
    const basePayload = {
      source: sourceKey,
      quickChip: selectedQuickChip,
      allDay: repeatLocksSchedule ? !hasExactTime : allDay,
      hasExactTime,
      reminderOption,
      ...(reminderOption !== '不提前' && reminderTimeUserSetRef.current
        ? { reminderHour: reminderTime.getHours(), reminderMinute: reminderTime.getMinutes() }
        : {}),
      repeatOption,
      repeatSummary: currentRepeatSummary,
      weeklyDays: [...weeklyDays],
      monthlyDays: [...monthlyDays],
      yearlyDate: toLocalYMD(yearlyDate),
      startTime: hasExactTime ? startTime.toISOString() : '',
      endTime: hasExactTime ? endTime.toISOString() : '',
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

  const applyDefaultSelectedDate = React.useCallback(() => {
    const target = clampDateInLimit(todayStart, dateLimit);
    setSelectedDate(target);
    setMonthOffset(getMonthDiff(todayStart, target));
    setSelectedQuickChip(target.getTime() === todayStart.getTime() ? '今天' : '');
    setTimeRangeKey(null);
    setTimeRange(null);
    setTimeSelectingEnd(false);
  }, [dateLimit, todayStart]);

  /** 按钮换月：同步标题并滚到对应页（滑动回调已同步 index 时跳过，避免打架） */
  React.useEffect(() => {
    setVisibleMonthOffset(monthOffset);
    if (!pagerSettledRef.current || calendarWidth <= 0) return;
    const expectedIndex = monthOffset + MONTH_PAGE_CENTER_INDEX;
    if (expectedIndex === pagerCurrentIndexRef.current) return;
    scrollPagerToMonthOffset(monthOffset, true);
  }, [calendarWidth, monthOffset, scrollPagerToMonthOffset]);

  React.useEffect(() => {
    if (hasAppliedInitialRef.current) return;
    hasAppliedInitialRef.current = true;
    const raw = typeof params.initial === 'string' ? params.initial : '';
    if (!raw) {
      applyDefaultSelectedDate();
      return;
    }

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
        reminderTimeUserSetRef.current = true;
      } else {
        reminderTimeUserSetRef.current = false;
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
        if (!parsed.quickChip) {
          if (dateBase.getTime() === todayStart.getTime()) setSelectedQuickChip('今天');
          else if (dateBase.getTime() === addDays(todayStart, 1).getTime()) setSelectedQuickChip('明天');
        }
      } else {
        applyDefaultSelectedDate();
      }
      setTimeRangeKey(null);
      setTimeRange(null);
      setTimeSelectingEnd(false);
    } catch {
      applyDefaultSelectedDate();
    }
  }, [applyDefaultSelectedDate, dateLimit, params.initial, todayStart]);


  const switchToTimeTab = React.useCallback(() => {
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
  }, [dateLimit, isSingleDayLimit, selectedDate, showToast, timeRange, todayStart]);

  const confirmAndBack = React.useCallback(() => {
    setSchedulePickerResult(buildReturnPayload());
    toast.success(
      selectedDate
        ? `日程已更新：${formatLimitLabel(selectedDate)}${hasExactTime ? ` ${formatTime(startTime)}` : ''}`
        : '日程已更新',
    );
    router.back();
  }, [buildReturnPayload, hasExactTime, router, selectedDate, startTime]);

  const dateLimitSub =
    dateLimit?.end
      ? `日期与时刻 · 受项目截止 ${formatLimitLabel(dateLimit.end)} 限制`
      : dateLimit?.start
        ? `日期与时刻 · 不早于 ${formatLimitLabel(dateLimit.start)}`
        : '日期与时刻 · 快捷芯片与月历同步';
  const foldCardBg = isDark ? 'rgba(255,252,245,0.06)' : 'rgba(255,252,245,0.86)';
  const footPad = Math.max(insets.bottom, 12);
  const canAutoPlace = repeatOption !== '不重复' && hasExactTime;
  /** 首帧冻结入场月，避免 FlatList 先以「无绽放」挂载再切真 */
  if (showContent && calBloomMonthRef.current == null) {
    calBloomMonthRef.current = monthOffset;
  }

  React.useEffect(() => {
    if (!showContent) {
      setCalBloomArmed(false);
      return;
    }
    if (!enterAnimate) {
      setCalBloomArmed(true);
      return;
    }
    setCalBloomArmed(false);
    let cancelled = false;
    const armBloom = () => {
      // 再等两帧，避开 pager 首次 scrollToOffset / onLayout
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (!cancelled) setCalBloomArmed(true);
        });
      });
    };
    // RN 0.88+ 已移除 InteractionManager，改用 requestIdleCallback
    let idleId: number | undefined;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    if (typeof requestIdleCallback === 'function') {
      idleId = requestIdleCallback(armBloom);
    } else {
      timeoutId = setTimeout(armBloom, 0);
    }
    return () => {
      cancelled = true;
      if (idleId != null && typeof cancelIdleCallback === 'function') {
        cancelIdleCallback(idleId);
      }
      if (timeoutId != null) clearTimeout(timeoutId);
    };
  }, [showContent, enterAnimate]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: tf.paper }]} edges={['left', 'right']}>
      <View style={[styles.appbar, { paddingTop: Math.max(insets.top, 8) }]}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={8}
          style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.75 }]}>
          <MaterialIcons name="close" size={20} color={tf.ink2} />
        </Pressable>
        <View style={styles.appbarCenter}>
          <Text style={[styles.appbarTitle, { color: tf.ink }]}>日程</Text>
          <Text style={[styles.appbarSub, { color: tf.muted }]} numberOfLines={1}>
            {dateLimitSub}
          </Text>
        </View>
        <Pressable
          onPress={confirmClearSchedule}
          style={({ pressed }) => [
            styles.pillbtn,
            {
              borderColor: tf.line2,
              backgroundColor: isDark ? 'rgba(255,252,245,0.08)' : 'rgba(255,252,245,0.66)',
              opacity: pressed ? 0.85 : 1,
            },
          ]}>
          <Text style={{ fontSize: 12, fontWeight: '700', color: '#A56547' }}>清除</Text>
        </Pressable>
      </View>

      {!showContent ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={tf.frog} />
        </View>
      ) : (
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: 88 + footPad }]}
        showsVerticalScrollIndicator={false}
        nestedScrollEnabled>
        <FoldRiseIn
          animate={enterAnimate}
          index={0}
          duration={PICK_RISE_MS}
          staggerMs={PICK_RISE_STAGGER}
          fromY={10}
          fromScale={0.985}
          holdHidden={holdEntrance}>
          <View
            style={[styles.pickTabs, { backgroundColor: tf.track }]}
            onLayout={(e) => {
              const w = e.nativeEvent.layout.width;
              if (w > 0) setPickTabWidth(w);
            }}>
            {pickTabWidth > 0 ? (
              <Animated.View
                style={[
                  styles.pickTabInd,
                  {
                    backgroundColor: isDark ? tf.cream : '#FFFCF4',
                    width: (pickTabWidth - 6) / 2,
                    transform: [
                      {
                        translateX: tabSlide.interpolate({
                          inputRange: [0, 1],
                          outputRange: [0, (pickTabWidth - 6) / 2],
                        }),
                      },
                    ],
                  },
                ]}
              />
            ) : null}
            <Pressable onPress={() => setTab('date')} style={styles.pickTabBtn}>
              <Text
                style={[
                  styles.pickTabText,
                  { color: tab === 'date' ? tf.pond : tf.muted, fontWeight: tab === 'date' ? '700' : '600' },
                ]}>
                日期
              </Text>
            </Pressable>
            <Pressable
              disabled={isSingleDayLimit}
              onPress={switchToTimeTab}
              style={[styles.pickTabBtn, isSingleDayLimit && { opacity: 0.45 }]}>
              <Text
                style={[
                  styles.pickTabText,
                  { color: tab === 'time' ? tf.pond : tf.muted, fontWeight: tab === 'time' ? '700' : '600' },
                ]}>
                时刻
              </Text>
            </Pressable>
          </View>
        </FoldRiseIn>

        <FoldRiseIn
          animate={enterAnimate}
          index={1}
          duration={PICK_RISE_MS}
          staggerMs={PICK_RISE_STAGGER}
          fromY={10}
          fromScale={0.985}
          holdHidden={holdEntrance}>
          <View style={styles.chipsWrap}>
            {(tab === 'date' ? dateQuickChips : timeQuickChips).map((chip) => {
              const isActive = selectedQuickChip === chip;
              return (
                <Pressable
                  key={chip}
                  onPress={() => handleQuickChipPress(chip)}
                  style={[
                    styles.chip,
                    {
                      backgroundColor: isActive ? tf.lily2 : isDark ? tf.paper2 : '#F1EDE1',
                      borderColor: isActive ? '#B7CA9C' : 'transparent',
                      borderWidth: isActive ? 1 : 0,
                    },
                  ]}>
                  <Text style={[styles.chipText, { color: isActive ? '#42613E' : tf.muted }]}>{chip}</Text>
                </Pressable>
              );
            })}
          </View>
        </FoldRiseIn>

        <View style={[styles.minical, { backgroundColor: foldCardBg, borderColor: tf.line2 }]}>
          <FoldRiseIn
            animate={enterAnimate}
            index={2}
            duration={PICK_RISE_MS}
            staggerMs={PICK_RISE_STAGGER}
            fromY={8}
            fromScale={0.98}
            holdHidden={holdEntrance}>
            <View style={styles.calendarHead}>
              <Text style={[styles.monthTitle, { color: tf.pond, fontFamily: fonts.serif }]}>{visibleMonthTitle}</Text>
              <View style={styles.monthActions}>
                <Pressable style={styles.iconBtn} onPress={() => setMonthOffset((prev) => prev - 1)}>
                  <MaterialIcons name="chevron-left" size={20} color={tf.faint} />
                </Pressable>
                <Pressable style={styles.iconBtn} onPress={() => setMonthOffset((prev) => prev + 1)}>
                  <MaterialIcons name="chevron-right" size={20} color={tf.faint} />
                </Pressable>
              </View>
            </View>
          </FoldRiseIn>

          <View style={styles.pagerClip} onLayout={onPagerContainerLayout}>
          {calendarWidth > 0 ? (
          <FlatList
            key={`schedule-cal-pager-${pagerMountKey}-${calendarWidth}`}
            ref={pagerRef}
            data={pagerData}
            horizontal
            nestedScrollEnabled
            directionalLockEnabled
            decelerationRate="fast"
            bounces={false}
            overScrollMode="never"
            snapToInterval={calendarWidth}
            snapToAlignment="start"
            disableIntervalMomentum
            initialScrollIndex={MONTH_PAGE_CENTER_INDEX}
            contentOffset={{ x: MONTH_PAGE_CENTER_INDEX * calendarWidth, y: 0 }}
            getItemLayout={(_, index) => ({ length: calendarWidth, offset: calendarWidth * index, index })}
            showsHorizontalScrollIndicator={false}
            keyExtractor={(offset) => `month-${offset}`}
            style={{ width: calendarWidth }}
            windowSize={5}
            maxToRenderPerBatch={3}
            initialNumToRender={3}
            updateCellsBatchingPeriod={16}
            removeClippedSubviews={false}
            onLayout={onPagerListLoad}
            onScroll={(e) => {
              if (!pagerSettledRef.current) return;
              const w = calendarWidthRef.current;
              if (w <= 0) return;
              const rawIndex = e.nativeEvent.contentOffset.x / w;
              const previewOffset = Math.round(rawIndex) - MONTH_PAGE_CENTER_INDEX;
              setVisibleMonthOffset((prev) => (prev === previewOffset ? prev : previewOffset));
            }}
            scrollEventThrottle={16}
            onScrollEndDrag={(e) => {
              if (!pagerSettledRef.current) return;
              const velocityX = e.nativeEvent.velocity?.x ?? 0;
              if (Math.abs(velocityX) > 0.2) return;
              snapPagerToOffset(e.nativeEvent.contentOffset.x, true);
            }}
            onMomentumScrollEnd={(e) => {
              if (!pagerSettledRef.current) return;
              snapPagerToOffset(e.nativeEvent.contentOffset.x, false);
            }}
            onScrollToIndexFailed={(info) => {
              const w = calendarWidthRef.current;
              if (w <= 0) return;
              requestAnimationFrame(() => {
                pagerRef.current?.scrollToOffset({ offset: info.index * w, animated: false });
                requestAnimationFrame(() => {
                  pagerSettledRef.current = true;
                });
              });
            }}
            contentContainerStyle={styles.calendarPager}
            renderItem={({ item: offset }) => {
              const monthDate = new Date(today.getFullYear(), today.getMonth() + offset, 1);
              const currentMonthInfo = getMonthInfo(monthDate.getFullYear(), monthDate.getMonth());
              const prevMonthInfo = getMonthInfo(monthDate.getFullYear(), monthDate.getMonth() - 1);
              const nextMonthInfo = getMonthInfo(monthDate.getFullYear(), monthDate.getMonth() + 1);
              const days = buildCalendarCells(currentMonthInfo, prevMonthInfo, nextMonthInfo);
              const weeks: CalendarCell[][] = [];
              for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
              const isEntranceMonth =
                calBloomMonthRef.current != null && offset === calBloomMonthRef.current;
              /** 入场月：解锁前先藏住；解锁后按周升起。邻页直接显示 */
              const calBloomHold = holdEntrance && enterAnimate && isEntranceMonth;
              const calBloomPlay = enterAnimate && isEntranceMonth && calBloomArmed;

              return (
                <View style={[styles.calendarPage, { width: calendarWidth }]}>
                  <FoldRiseIn
                    animate={calBloomPlay}
                    index={0}
                    delayMs={0}
                    duration={PICK_CAL_WEEK_DURATION}
                    staggerMs={0}
                    fromY={4}
                    holdHidden={calBloomHold}>
                    <View style={styles.weekRow}>
                      {WEEK_LABELS.map((w) => (
                        <Text key={w} style={[styles.weekText, { color: colors.textSecondary }]}>
                          {w}
                        </Text>
                      ))}
                    </View>
                  </FoldRiseIn>

                  <View style={styles.grid}>
                    {weeks.map((week, weekIndex) => (
                      <FoldRiseIn
                        key={`week-${currentMonthInfo.year}-${currentMonthInfo.month}-${weekIndex}`}
                        animate={calBloomPlay}
                        index={weekIndex}
                        delayMs={28}
                        duration={PICK_CAL_WEEK_DURATION}
                        staggerMs={PICK_CAL_WEEK_STAGGER}
                        fromY={12}
                        fromScale={0.96}
                        holdHidden={calBloomHold}
                        style={styles.calWeekRise}>
                        <View style={styles.calWeekInner}>
                          {week.map((cell, dayIndex) => {
                            const index = weekIndex * 7 + dayIndex;
                            const day = cell.day;
                            const lunar = getCalendarLunarLabel(cell.year, cell.month + 1, day);
                            const cellDate = new Date(cell.year, cell.month, day);
                            const isPastDate =
                              cell.inCurrentMonth && cellDate.getTime() < todayStart.getTime();
                            const isOutOfLimit =
                              cell.inCurrentMonth && !isDateInLimit(cellDate, dateLimit);
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
                            const inRange =
                              !!activeRange &&
                              cell.inCurrentMonth &&
                              cellDate >= activeRange.start &&
                              cellDate <= activeRange.end;
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
                                  cell.inCurrentMonth &&
                                  !isPastDate &&
                                  !isOutOfLimit &&
                                  handleDayPress(
                                    currentMonthInfo.year,
                                    currentMonthInfo.month,
                                    day,
                                  )
                                }
                                style={styles.dayCell}>
                                {cell.inCurrentMonth ? (
                                  <View style={styles.rangeWrap}>
                                    {inRange && weekDayIndex !== 0 ? (
                                      <View
                                        style={[
                                          styles.rangeLeftFill,
                                          { backgroundColor: colors.primaryMuted },
                                        ]}
                                      />
                                    ) : null}
                                    {inRange && weekDayIndex !== 6 ? (
                                      <View
                                        style={[
                                          styles.rangeRightFill,
                                          { backgroundColor: colors.primaryMuted },
                                        ]}
                                      />
                                    ) : null}

                                    {showRangeLine ? (
                                      <View
                                        style={[
                                          styles.dayCircle,
                                          styles.rangeMiddleCircle,
                                          { backgroundColor: colors.primaryMuted },
                                        ]}>
                                        <Text style={[styles.dayNum, { color: colors.primary }]}>
                                          {day}
                                        </Text>
                                        <Text style={[styles.dayLunar, { color: colors.primary }]}>
                                          {lunar}
                                        </Text>
                                      </View>
                                    ) : (
                                      <View
                                        style={[
                                          styles.dayCircle,
                                          isSelected && { backgroundColor: colors.primary },
                                          isToday &&
                                            !isSelected && { backgroundColor: colors.primaryMuted },
                                          isRangeStartOrEnd && { backgroundColor: colors.primary },
                                          inRange &&
                                            !isRangeStartOrEnd && {
                                              backgroundColor: colors.primaryMuted,
                                            },
                                          isRangeStartOrEnd && styles.rangeEndpoint,
                                          isToday &&
                                            !isSelected &&
                                            !isRangeStartOrEnd && [
                                              styles.todayCircle,
                                              { borderColor: colors.primaryRing },
                                            ],
                                          isPastDate && styles.pastDayCircle,
                                          isOutOfLimit && styles.pastDayCircle,
                                        ]}>
                                        <Text
                                          style={[
                                            styles.dayNum,
                                            {
                                              color:
                                                isSelected || isRangeStartOrEnd
                                                  ? colors.onPrimary
                                                  : isToday
                                                    ? colors.primary
                                                    : colors.text,
                                            },
                                            isPastDate && styles.pastDayText,
                                            isOutOfLimit && styles.pastDayText,
                                          ]}>
                                          {day}
                                        </Text>
                                        <Text
                                          style={[
                                            styles.dayLunar,
                                            {
                                              color:
                                                isSelected || isRangeStartOrEnd
                                                  ? colors.onPrimary
                                                  : isToday
                                                    ? colors.primary
                                                    : colors.textSecondary,
                                            },
                                            isPastDate && styles.pastDayText,
                                            isOutOfLimit && styles.pastDayText,
                                          ]}>
                                          {lunar}
                                        </Text>
                                      </View>
                                    )}
                                  </View>
                                ) : (
                                  <View style={[styles.dayCircle, styles.outOfMonthCircle]}>
                                    <Text
                                      style={[
                                        styles.dayNum,
                                        { color: colors.textSecondary, opacity: 0.4 },
                                      ]}>
                                      {day}
                                    </Text>
                                    <Text
                                      style={[
                                        styles.dayLunar,
                                        { color: colors.textSecondary, opacity: 0.35 },
                                      ]}>
                                      {lunar}
                                    </Text>
                                  </View>
                                )}
                              </Pressable>
                            );
                          })}
                        </View>
                      </FoldRiseIn>
                    ))}
                  </View>
                </View>
              );
            }}
          />
          ) : (
            <View style={{ minHeight: 220 }} />
          )}
          </View>
        </View>

        <FoldRiseIn
          animate={enterAnimate}
          index={3}
          duration={PICK_RISE_MS}
          staggerMs={PICK_RISE_STAGGER}
          fromY={10}
          fromScale={0.985}
          holdHidden={holdEntrance}>
          <View style={styles.alltog}>
            <View style={[styles.dot, { backgroundColor: tf.sage }]} />
            <Text style={{ fontSize: 13, color: tf.ink2, fontWeight: '600' }}>
              {tab === 'date' ? '具体时间' : '全天'}
            </Text>
            <TaskFoldSwitch
              value={tab === 'date' ? hasExactTime : allDay}
              onValueChange={(next) => {
                if (tab === 'date') {
                  setHasExactTime(next);
                  setAllDay(!next);
                } else {
                  setAllDay(next);
                  if (next) setHasExactTime(false);
                  else setHasExactTime(true);
                }
              }}
              accessibilityLabel={tab === 'date' ? '具体时间' : '全天'}
            />
            <Text style={{ marginLeft: 'auto', fontSize: 11, color: tf.faint }}>
              {formatSelectedDayLabel(selectedDate)}
            </Text>
          </View>

          {(tab === 'date' ? hasExactTime : !allDay) ? (
            <View style={styles.timerow}>
              <Pressable
                onPress={() => openTimePicker('start')}
                style={[styles.timebox, { borderColor: tf.line2, backgroundColor: foldCardBg }]}>
                <View>
                  <Text style={styles.timeboxSmall}>开始</Text>
                  <Text style={[styles.timeboxBig, { color: tf.ink2, fontFamily: fonts.mono }]}>{startTimeLabel}</Text>
                </View>
                <Text style={{ marginLeft: 'auto', color: tf.faint }}>⌄</Text>
              </Pressable>
              <Pressable
                onPress={() => openTimePicker('end')}
                style={[styles.timebox, { borderColor: tf.line2, backgroundColor: foldCardBg }]}>
                <View>
                  <Text style={styles.timeboxSmall}>结束</Text>
                  <Text style={[styles.timeboxBig, { color: tf.ink2, fontFamily: fonts.mono }]}>{endTimeLabel}</Text>
                </View>
                <Text style={{ marginLeft: 'auto', color: tf.faint }}>⌄</Text>
              </Pressable>
            </View>
          ) : null}

          <Pressable style={[styles.pickrow, { borderTopColor: 'rgba(232,224,210,0.52)' }]} onPress={() => openSettingPicker('reminder')}>
            <Text style={[styles.pl, { color: tf.muted }]}>提醒</Text>
            <View style={styles.pv}>
              <MaterialIcons name="notifications-none" size={14} color={tf.muted} />
              <Text style={{ fontSize: 13, fontWeight: '600', color: tf.ink2 }} numberOfLines={1}>
                {reminderSettingHint}
              </Text>
            </View>
            <Text style={{ fontSize: 11, color: tf.muted }}>修改 ›</Text>
          </Pressable>
          {reminderOption !== '不提前' ? (
            <Pressable style={[styles.pickrow, { borderTopColor: 'rgba(232,224,210,0.52)' }]} onPress={openReminderTimePicker}>
              <Text style={[styles.pl, { color: tf.muted }]}>提醒时刻</Text>
              <View style={styles.pv}>
                <MaterialIcons name="access-time" size={14} color={tf.muted} />
                <Text style={{ fontSize: 13, fontWeight: '600', color: tf.ink2 }}>{reminderTimeLabel}</Text>
              </View>
              <Text style={{ fontSize: 11, color: tf.muted }}>›</Text>
            </Pressable>
          ) : null}
          <Pressable style={[styles.pickrow, { borderTopColor: 'rgba(232,224,210,0.52)' }]} onPress={() => openSettingPicker('repeat')}>
            <Text style={[styles.pl, { color: tf.muted }]}>重复</Text>
            <View style={styles.pv}>
              <MaterialIcons name="repeat" size={14} color={tf.muted} />
              <Text style={{ fontSize: 13, fontWeight: '600', color: tf.ink2 }} numberOfLines={1}>
                {repeatSummary}
              </Text>
            </View>
            {canAutoPlace ? (
              <View style={[styles.autoTag, { backgroundColor: tf.sage2 }]}>
                <Text style={{ fontSize: 10, fontWeight: '700', color: '#36594D' }}>可自动入格</Text>
              </View>
            ) : null}
            <Text style={{ fontSize: 11, color: tf.muted, marginLeft: 2 }}>›</Text>
          </Pressable>
        </FoldRiseIn>

        {dateLimit?.end || dateLimit?.start ? (
          <FoldRiseIn
            animate={enterAnimate}
            index={4}
            duration={PICK_RISE_MS}
            staggerMs={PICK_RISE_STAGGER}
            fromY={8}
            fromScale={0.985}
            holdHidden={holdEntrance}>
            <View
              style={[
                styles.boundHint,
                {
                  backgroundColor: isDark ? tf.amber2 : '#F8ECD7',
                  borderColor: isDark ? tf.scoreBorder : '#E8CDA2',
                },
              ]}>
              <Text style={{ fontSize: 11, color: tf.amberInk, lineHeight: 16 }}>
                {dateLimit.end
                  ? `父项目截止 ${formatLimitLabel(dateLimit.end)} · 超出范围的日期会被钳制并提示。`
                  : `不早于 ${formatLimitLabel(dateLimit.start!)} · 超出范围的日期会被钳制并提示。`}
              </Text>
            </View>
          </FoldRiseIn>
        ) : null}

        <FoldRiseIn
          animate={enterAnimate}
          index={5}
          duration={PICK_RISE_MS}
          staggerMs={PICK_RISE_STAGGER}
          fromY={6}
          fromScale={0.99}
          holdHidden={holdEntrance}>
          <View style={styles.hintline}>
            <MaterialIcons name="lightbulb-outline" size={14} color={tf.faint} />
            <Text style={{ flex: 1, fontSize: 11, color: tf.faint, lineHeight: 16 }}>
              确认后结果回传调用方；日期与时刻两个 Tab 共享同一份草稿。
            </Text>
          </View>
        </FoldRiseIn>
      </ScrollView>
      )}

      <View style={[styles.foldFoot, { paddingBottom: footPad, backgroundColor: tf.paper }]}>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [
            styles.ghostBtn,
            { borderColor: tf.line2, backgroundColor: foldCardBg, opacity: pressed ? 0.88 : 1, flex: 1 },
          ]}>
          <Text style={{ fontSize: 13, fontWeight: '700', color: tf.ink2 }}>取消</Text>
        </Pressable>
        <Pressable
          onPress={confirmAndBack}
          style={({ pressed }) => [
            styles.foldPrimary,
            { backgroundColor: tf.pond, opacity: pressed ? 0.9 : 1, flex: 1.5 },
          ]}>
          <Text style={{ fontSize: 14, fontWeight: '700', color: tf.onPond }}>确定</Text>
        </Pressable>
      </View>

     
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
                  reminderTimeUserSetRef.current = true;
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
  appbar: {
    minHeight: 48,
    paddingHorizontal: 14,
    paddingBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  appbarCenter: { flex: 1, minWidth: 0 },
  appbarTitle: { fontSize: 15, fontWeight: '700' },
  appbarSub: { fontSize: 10, marginTop: 2 },
  pillbtn: {
    height: 28,
    paddingHorizontal: 11,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: { paddingHorizontal: 14, paddingTop: 4, gap: 10 },
  pickTabs: {
    height: 34,
    borderRadius: 10,
    padding: 3,
    flexDirection: 'row',
    position: 'relative',
  },
  pickTabInd: {
    position: 'absolute',
    top: 3,
    left: 3,
    bottom: 3,
    borderRadius: 8,
    shadowColor: '#20382F',
    shadowOpacity: 0.1,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  pickTabBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', zIndex: 1 },
  pickTabText: { fontSize: 12 },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    height: 28,
    borderRadius: 8,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipText: { fontSize: 12, fontWeight: '600' },
  minical: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    padding: 8,
  },
  calendarHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
    paddingBottom: 4,
  },
  pagerClip: { width: '100%', overflow: 'hidden' },
  calendarPager: { alignItems: 'stretch' },
  monthTitle: { fontSize: 16, fontWeight: '600' },
  monthActions: { flexDirection: 'row', gap: 4 },
  calendarPage: {},
  weekRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 2, paddingBottom: 2 },
  weekText: { width: '14.28%', textAlign: 'center', fontSize: 10, fontWeight: '600' },
  grid: { width: '100%' },
  dayCell: { width: '14.28%', alignItems: 'center', paddingVertical: 3 },
  calWeekRise: { width: '100%' },
  calWeekInner: { flexDirection: 'row', width: '100%' },
  rangeWrap: { width: '100%', alignItems: 'center', justifyContent: 'center' },
  rangeLeftFill: { position: 'absolute', left: 0, right: '50%', top: 2, bottom: 2 },
  rangeRightFill: { position: 'absolute', left: '50%', right: 0, top: 2, bottom: 2 },
  dayCircle: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  todayCircle: { borderWidth: 1.5 },
  rangeMiddleCircle: { opacity: 0.95 },
  rangeEndpoint: { zIndex: 2 },
  outOfMonthCircle: { opacity: 0.5 },
  pastDayCircle: { opacity: 0.35 },
  pastDayText: { textDecorationLine: 'line-through' },
  dayNum: { fontSize: 14, fontWeight: '700', lineHeight: 17 },
  dayLunar: { fontSize: 8, fontWeight: '600' },
  alltog: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
    paddingHorizontal: 2,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  timerow: { flexDirection: 'row', gap: 8, marginBottom: 4 },
  timebox: {
    flex: 1,
    height: 42,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
  },
  timeboxSmall: { fontSize: 10, color: '#9DA69D' },
  timeboxBig: { fontSize: 15, fontWeight: '700', marginTop: 1 },
  pickrow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 40,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  pl: { width: 52, fontSize: 12 },
  pv: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 },
  autoTag: {
    height: 18,
    paddingHorizontal: 6,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boundHint: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  hintline: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    paddingHorizontal: 2,
    paddingVertical: 4,
  },
  foldFoot: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 14,
    paddingTop: 10,
    flexDirection: 'row',
    gap: 8,
  },
  ghostBtn: {
    height: 46,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  foldPrimary: {
    height: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingLabel: { fontSize: 15, fontWeight: '500' },
  pickerBackdrop: { flex: 1, justifyContent: 'center', paddingHorizontal: Spacing['6xl'] },
  pickerCard: { borderRadius: Radius.xl, padding: Spacing['3xl'], gap: Spacing.xl, ...Shadows.sheet },
  pickerTitle: { ...Typography.title, textAlign: 'center' },
  pickerActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: Spacing.lg },
  pickerBtn: {
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing['3xl'],
    paddingVertical: Spacing.lg,
    minWidth: 72,
    alignItems: 'center',
  },
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
  tagItem: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
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
