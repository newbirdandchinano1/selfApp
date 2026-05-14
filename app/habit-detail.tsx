import { playHabitCheckInDing } from '@/lib/play-habit-check-in-ding';
import {
  decrementHabitCheckInForDay,
  getCheckInsMapByHabitId,
  getHabitCheckInDbCountForDay,
  incrementHabitCheckInForDay,
} from '@/lib/repositories/habits/habit-check-in';
import { getHabitById } from '@/lib/repositories/habits/habit';
import type { HabitRow } from '@/lib/repositories/habits/habit.types';
import { formatHabitReminderClock, parseHabitReminder } from '@/lib/repositories/habits/habit-reminder-meta';
import { DEFAULT_TASKS_DAY_BOUNDARY, getLogicalLocalYmd, loadTasksDayBoundary } from '@/lib/tasks-logical-day';
import { MaterialIcons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useFocusEffect } from '@react-navigation/native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Svg, { Circle, Line, Path, Text as SvgText } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const BG = '#f5f6f8';
const CARD = '#ffffff';
const CARD_BORDER = '#e8ecf0';
const TEXT_MAIN = '#111827';
const TEXT_MUTED = '#64748b';
const BLUE = '#2563eb';
const GREEN_BG = '#ecfdf5';
const GREEN_TEXT = '#059669';
const ORANGE_BG = '#fff7ed';
const ORANGE_TEXT = '#ea580c';
const RED_BG = '#fef2f2';
const RED_TEXT = '#dc2626';
const CAL_DAY_EMPTY = '#eef2f6';
/** 当年格子无记录（与月视图「无」区分可略浅） */
const HEAT_DAY_EMPTY = '#e8ecf0';
const HEAT_OUT_YEAR = '#f3f4f6';
const CHART_GRID = '#e2e8f0';

/** 与月视图左上角「少 → 多」三色块一致：次数越多越深 */
const BLUE_LEGEND = ['#bfdbfe', '#60a5fa', '#2563eb'] as const;

function pickParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

function toYMD(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function parseExtra(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const p = JSON.parse(raw) as unknown;
    if (p && typeof p === 'object' && !Array.isArray(p)) return p as Record<string, unknown>;
  } catch {
    /* ignore */
  }
  return {};
}

function normalizeCheckIns(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) out[k] = Math.floor(v);
    else if (v === true) out[k] = 1;
  }
  return out;
}

function startOfWeekMonday(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = x.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  x.setDate(x.getDate() + diff);
  return x;
}

function countDistinctAchievedDays(checkIns: Record<string, number>): number {
  return Object.entries(checkIns).filter(([, c]) => c > 0).length;
}

function countAchievedInMonth(checkIns: Record<string, number>, year: number, month0: number): number {
  const keys = Object.keys(checkIns).filter((k) => k.startsWith(`${year}-${pad2(month0 + 1)}-`));
  return keys.filter((k) => (checkIns[k] ?? 0) > 0).length;
}

function countAchievedInWeek(checkIns: Record<string, number>, weekStartMon: Date): number {
  let n = 0;
  for (let i = 0; i < 7; i++) {
    const dt = new Date(weekStartMon);
    dt.setDate(weekStartMon.getDate() + i);
    if ((checkIns[toYMD(dt)] ?? 0) > 0) n++;
  }
  return n;
}

function monthMatrix(year: number, month0: number): { leadingBlank: number; daysInMonth: number } {
  const first = new Date(year, month0, 1);
  const dow = first.getDay();
  const leadingBlank = dow === 0 ? 6 : dow - 1;
  const daysInMonth = new Date(year, month0 + 1, 0).getDate();
  return { leadingBlank, daysInMonth };
}

function buildHeatmapWeeks(year: number): Date[][] {
  const jan1 = new Date(year, 0, 1);
  const start = new Date(jan1);
  start.setDate(jan1.getDate() - jan1.getDay());
  const weeks: Date[][] = [];
  for (let w = 0; w < 54; w++) {
    const col: Date[] = [];
    for (let d = 0; d < 7; d++) {
      const t = new Date(start);
      t.setDate(start.getDate() + w * 7 + d);
      col.push(t);
    }
    if (col[0] > new Date(year, 11, 31)) break;
    weeks.push(col);
  }
  return weeks;
}

/** 有完成：1 次浅、2 次中、3 次及以上最深，与图例一致 */
function completionBlue(count: number, emptyBackground: string): string {
  if (count <= 0) return emptyBackground;
  if (count === 1) return BLUE_LEGEND[0];
  if (count === 2) return BLUE_LEGEND[1];
  return BLUE_LEGEND[2];
}

function needsLightTextOnBlue(fill: string): boolean {
  return fill === BLUE_LEGEND[1] || fill === BLUE_LEGEND[2];
}

/** 顶栏区内高度：上内边距 10 + 行高约 38 + 下内边距 10 */
const TOP_BAR_BODY_H = 58;

const SCREEN_TITLE = '习惯详情';

export default function HabitDetailScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const scrollTopPad = insets.top + TOP_BAR_BODY_H;
  const params = useLocalSearchParams<{ habitId?: string }>();
  const habitId = pickParam(params.habitId);

  const [loading, setLoading] = React.useState(true);
  const [habit, setHabit] = React.useState<HabitRow | null>(null);
  const [checkIns, setCheckIns] = React.useState<Record<string, number>>({});

  const [focusDate, setFocusDate] = React.useState(() => {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    return t;
  });
  const [calendarMonth, setCalendarMonth] = React.useState(() => {
    const t = new Date();
    return new Date(t.getFullYear(), t.getMonth(), 1);
  });
  const [trendWeekStart, setTrendWeekStart] = React.useState(() => startOfWeekMonday(new Date()));
  const [heatmapYear, setHeatmapYear] = React.useState(() => new Date().getFullYear());

  const [datePickerOpen, setDatePickerOpen] = React.useState(false);
  const [makeUpSaving, setMakeUpSaving] = React.useState(false);
  const [cancelMakeUpSaving, setCancelMakeUpSaving] = React.useState(false);
  const [logicalTodayYmd, setLogicalTodayYmd] = React.useState(() =>
    getLogicalLocalYmd(new Date(), DEFAULT_TASKS_DAY_BOUNDARY)
  );

  const focusYmd = React.useMemo(() => toYMD(focusDate), [focusDate]);

  const reload = React.useCallback(async () => {
    if (!habitId) {
      setHabit(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const boundary = await loadTasksDayBoundary();
      setLogicalTodayYmd(getLogicalLocalYmd(new Date(), boundary));
      const row = await getHabitById(habitId);
      setHabit(row ?? null);
      if (!row) {
        setCheckIns({});
      } else {
        const fromDb = await getCheckInsMapByHabitId(row.id);
        const merged = { ...fromDb };
        const legacy = normalizeCheckIns(parseExtra(row.extra_data).checkIns);
        for (const [k, v] of Object.entries(legacy)) {
          if (merged[k] === undefined) merged[k] = v;
        }
        setCheckIns(merged);
      }
    } catch (e) {
      console.warn('加载习惯详情失败', e);
      setHabit(null);
    } finally {
      setLoading(false);
    }
  }, [habitId]);

  useFocusEffect(
    React.useCallback(() => {
      void reload();
    }, [reload])
  );

  const extraParsed = habit ? parseExtra(habit.extra_data) : {};
  const habitReminder = React.useMemo(
    () => (habit ? parseHabitReminder(habit.extra_data) : { enabled: false as const }),
    [habit]
  );
  const habitReminderClock = formatHabitReminderClock(habitReminder);
  const quantify = extraParsed.quantify as { unit?: string; dailyGoal?: number | null } | undefined;
  const quoteText =
    habit?.note && habit.note.trim()
      ? habit.note.trim()
      : typeof quantify?.unit === 'string' && quantify.unit.trim()
        ? quantify.unit.trim()
        : habit?.tag && habit.tag.trim()
          ? habit.tag.trim()
          : '暂无备注';

  const totalAchieved = countDistinctAchievedDays(checkIns);
  const weekAchieved = countAchievedInWeek(checkIns, startOfWeekMonday(focusDate));
  const monthAchieved = countAchievedInMonth(checkIns, focusDate.getFullYear(), focusDate.getMonth());

  const { leadingBlank, daysInMonth } = monthMatrix(calendarMonth.getFullYear(), calendarMonth.getMonth());

  const trendCounts = React.useMemo(() => {
    const arr: number[] = [];
    for (let i = 0; i < 7; i++) {
      const dt = new Date(trendWeekStart);
      dt.setDate(trendWeekStart.getDate() + i);
      arr.push(checkIns[toYMD(dt)] ?? 0);
    }
    return arr;
  }, [checkIns, trendWeekStart]);

  const dailyGoal =
    typeof quantify?.dailyGoal === 'number' && quantify.dailyGoal > 0 ? Math.round(quantify.dailyGoal) : null;
  const trendMax = Math.max(dailyGoal ?? 1, ...trendCounts, 1);

  const trendEnd = React.useMemo(() => {
    const t = new Date(trendWeekStart);
    t.setDate(trendWeekStart.getDate() + 6);
    return t;
  }, [trendWeekStart]);

  const heatWeeks = React.useMemo(() => buildHeatmapWeeks(heatmapYear), [heatmapYear]);

  const monthHitCount = React.useMemo(() => {
    let n = 0;
    const y = calendarMonth.getFullYear();
    const m = calendarMonth.getMonth();
    for (let day = 1; day <= daysInMonth; day++) {
      const k = `${y}-${pad2(m + 1)}-${pad2(day)}`;
      if ((checkIns[k] ?? 0) > 0) n++;
    }
    return n;
  }, [calendarMonth, checkIns, daysInMonth]);

  const chartW = Math.min(Dimensions.get('window').width - 32, 440);

  const pathD = React.useMemo(() => {
    const w = 300;
    const h = 110;
    const padL = 28;
    const padR = 8;
    const padB = 18;
    const padT = 10;
    const innerW = w - padL - padR;
    const innerH = h - padT - padB;
    const pts = trendCounts.map((cnt, i) => {
      const x = padL + (innerW * i) / 6;
      const yn = trendMax > 0 ? cnt / trendMax : 0;
      const y = padT + innerH * (1 - yn);
      return { x, y: Math.max(padT, Math.min(padT + innerH, y)), cnt };
    });
    if (pts.length === 0) return { d: '', pts: [] as { x: number; y: number; cnt: number }[] };
    let d = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 1; i < pts.length; i++) {
      d += ` L ${pts[i].x} ${pts[i].y}`;
    }
    return { d, pts };
  }, [trendCounts, trendMax]);

  const goEdit = () => {
    if (!habit) return;
    router.push({
      pathname: '/add-habit',
      params: {
        mode: 'edit',
        name: habit.name,
        icon: habit.icon,
        context: habit.context,
        habitId: habit.id,
      },
    });
  };

  /** 月视图：仅选中日期（概览等），不写打卡、不改变「目标趋势」所在周 */
  const selectCalendarDay = React.useCallback((year: number, month0: number, day: number) => {
    const d = new Date(year, month0, day);
    d.setHours(0, 0, 0, 0);
    setFocusDate(d);
  }, []);

  const handleMakeUpCheckIn = React.useCallback(async () => {
    if (!habit) return;
    const boundary = await loadTasksDayBoundary();
    const todayYmd = getLogicalLocalYmd(new Date(), boundary);
    setLogicalTodayYmd(todayYmd);
    const ymd = focusYmd;
    if (ymd >= todayYmd) {
      Alert.alert('提示', '补卡仅适用于已过去的日期；今天请在任务页打卡，或先选择更早的日期。');
      return;
    }
    setMakeUpSaving(true);
    try {
      const { increased } = await incrementHabitCheckInForDay(habit.id, ymd, dailyGoal);
      if (!increased) {
        Alert.alert(
          '已达上限',
          dailyGoal != null
            ? `该习惯每日最多 ${dailyGoal} 次，${ymd} 当日已记满。`
            : '当日次数未增加（可能已达上限）。'
        );
        return;
      }
      void playHabitCheckInDing();
      await reload();
    } catch (e) {
      console.warn('习惯补卡失败', e);
      Alert.alert('操作失败', '补卡未保存，请稍后重试。');
    } finally {
      setMakeUpSaving(false);
    }
  }, [habit, focusYmd, dailyGoal, reload]);

  const handleCancelMakeUpCheckIn = React.useCallback(async () => {
    if (!habit) return;
    const boundary = await loadTasksDayBoundary();
    const todayYmd = getLogicalLocalYmd(new Date(), boundary);
    setLogicalTodayYmd(todayYmd);
    const ymd = focusYmd;
    if (ymd >= todayYmd) {
      Alert.alert('提示', '取消补卡仅适用于已过去的日期；今天的打卡请在任务页双击图标撤销。');
      return;
    }
    const dbBefore = await getHabitCheckInDbCountForDay(habit.id, ymd);
    if (dbBefore <= 0) {
      const displayCnt = checkIns[ymd] ?? 0;
      if (displayCnt > 0) {
        Alert.alert(
          '无法撤销',
          '该日次数来自旧版本地数据，未写入打卡表。如需调整请编辑习惯或清除备注中的历史打卡字段。'
        );
      } else {
        Alert.alert('提示', '该日暂无打卡记录可撤销。');
      }
      return;
    }
    setCancelMakeUpSaving(true);
    try {
      await decrementHabitCheckInForDay(habit.id, ymd);
      await reload();
    } catch (e) {
      console.warn('取消补卡失败', e);
      Alert.alert('操作失败', '未能撤销，请稍后重试。');
    } finally {
      setCancelMakeUpSaving(false);
    }
  }, [habit, focusYmd, checkIns, reload]);

  if (!habitId) {
    return (
      <View style={styles.safe}>
        <View style={[styles.topBar, styles.topBarFixed, { paddingTop: insets.top + 10 }]}>
          <Pressable onPress={() => router.back()} style={styles.iconBtn}>
            <MaterialIcons name="arrow-back" size={22} color={TEXT_MAIN} />
          </Pressable>
          <Text style={styles.topTitle}>{SCREEN_TITLE}</Text>
          <View style={{ width: 38 }} />
        </View>
        <View style={[styles.centerMsg, { paddingTop: scrollTopPad }]}>
          <Text style={styles.muted}>缺少习惯参数</Text>
        </View>
      </View>
    );
  }

  if (loading || !habit) {
    return (
      <View style={styles.safe}>
        <View style={[styles.topBar, styles.topBarFixed, { paddingTop: insets.top + 10 }]}>
          <Pressable onPress={() => router.back()} style={styles.iconBtn}>
            <MaterialIcons name="arrow-back" size={22} color={TEXT_MAIN} />
          </Pressable>
          <Text style={styles.topTitle}>{SCREEN_TITLE}</Text>
          <View style={{ width: 38 }} />
        </View>
        <View style={[styles.centerMsg, { paddingTop: scrollTopPad }]}>
          {loading ? <ActivityIndicator color={BLUE} /> : <Text style={styles.muted}>未找到该习惯</Text>}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.safe}>
      <View style={[styles.topBar, styles.topBarFixed, { paddingTop: insets.top + 10 }]}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn}>
          <MaterialIcons name="arrow-back" size={22} color={TEXT_MAIN} />
        </Pressable>
        <Text style={styles.topTitle}>{SCREEN_TITLE}</Text>
        <Pressable onPress={goEdit} style={styles.iconBtn}>
          <MaterialIcons name="edit" size={20} color={TEXT_MUTED} />
        </Pressable>
      </View>

      <ScrollView
        style={styles.scrollFlex}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: scrollTopPad, paddingBottom: 28 + insets.bottom },
        ]}
        showsVerticalScrollIndicator={false}>
        <View style={styles.card}>
          <Text style={styles.titleText}>{habit.name}</Text>
          {habitReminder.enabled && habitReminderClock ? (
            <View style={styles.reminderBadgeRow} accessibilityLabel={`已开启每日提醒 ${habitReminderClock}`}>
              <MaterialIcons name="notifications-active" size={16} color={BLUE} />
              <Text style={styles.reminderBadgeText}>每日提醒 · {habitReminderClock}</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.quoteCard}>
          <Text style={styles.quoteIconTL}>❝</Text>
          <Text style={styles.quoteBody}>{quoteText}</Text>
          <Text style={styles.quoteIconBR}>❞</Text>
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>概览</Text>
          <Pressable onPress={() => setDatePickerOpen(true)} style={styles.dateChip}>
            <Text style={styles.dateChipText}>{focusYmd}</Text>
            <MaterialIcons name="chevron-right" size={14} color={BLUE} />
          </Pressable>
        </View>

        <View style={styles.makeUpBlock}>
          <Text style={styles.makeUpHint}>
            {focusYmd} 已记 <Text style={styles.makeUpHintStrong}>{checkIns[focusYmd] ?? 0}</Text> 次
            {dailyGoal != null ? ` / 日上限 ${dailyGoal}` : ''}
          </Text>
          {focusYmd >= logicalTodayYmd ? (
            <Text style={styles.makeUpSub}>补卡、取消补卡仅针对「逻辑日」之前的日期（与任务页日界一致）。</Text>
          ) : null}
          <View style={styles.makeUpBtnRow}>
            <Pressable
              style={[
                styles.makeUpBtn,
                styles.makeUpBtnPrimary,
                (makeUpSaving || focusYmd >= logicalTodayYmd) && styles.makeUpBtnDisabled,
              ]}
              disabled={makeUpSaving || focusYmd >= logicalTodayYmd}
              onPress={() => void handleMakeUpCheckIn()}>
              {makeUpSaving ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <>
                  <MaterialIcons name="event-available" size={18} color="#fff" />
                  <Text style={styles.makeUpBtnText}>补卡</Text>
                </>
              )}
            </Pressable>
            <Pressable
              style={[
                styles.makeUpBtn,
                styles.makeUpBtnCancel,
                (cancelMakeUpSaving || focusYmd >= logicalTodayYmd) && styles.makeUpBtnCancelDisabled,
              ]}
              disabled={cancelMakeUpSaving || focusYmd >= logicalTodayYmd}
              onPress={() => void handleCancelMakeUpCheckIn()}>
              {cancelMakeUpSaving ? (
                <ActivityIndicator color={RED_TEXT} size="small" />
              ) : (
                <>
                  <MaterialIcons name="undo" size={18} color={RED_TEXT} />
                  <Text style={styles.makeUpBtnCancelText}>取消补卡</Text>
                </>
              )}
            </Pressable>
          </View>
        </View>

        <View style={styles.statsRow}>
          <View style={[styles.statCard, { backgroundColor: GREEN_BG }]}>
            <Text style={styles.statValue}>
              {totalAchieved} <Text style={styles.statUnit}>天</Text>
            </Text>
            <Text style={[styles.statLabel, { color: GREEN_TEXT }]}>总达成</Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: ORANGE_BG }]}>
            <Text style={[styles.statValue, { color: ORANGE_TEXT }]}>
              {weekAchieved} <Text style={[styles.statUnit, { color: ORANGE_TEXT }]}>天</Text>
            </Text>
            <Text style={[styles.statLabel, { color: ORANGE_TEXT }]}>周达成</Text>
          </View>
        </View>
        <View style={[styles.statCard, { backgroundColor: RED_BG, marginBottom: 6 }]}>
          <Text style={[styles.statValue, { color: RED_TEXT }]}>
            {monthAchieved} <Text style={[styles.statUnit, { color: RED_TEXT }]}>天</Text>
          </Text>
          <Text style={[styles.statLabel, { color: RED_TEXT }]}>月达成</Text>
        </View>

        <View style={styles.card}>
          <View style={styles.calTitleRow}>
            <MaterialIcons name="calendar-today" size={16} color={TEXT_MUTED} />
            <Text style={styles.calTitle}>月视图</Text>
          </View>
          <View style={styles.monthNav}>
            <Pressable
              onPress={() =>
                setCalendarMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))
              }
              hitSlop={8}>
              <MaterialIcons name="chevron-left" size={22} color={TEXT_MUTED} />
            </Pressable>
            <Text style={styles.monthTitle}>
              {calendarMonth.getFullYear()}年{pad2(calendarMonth.getMonth() + 1)}月
            </Text>
            <Pressable
              onPress={() =>
                setCalendarMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))
              }
              hitSlop={8}>
              <MaterialIcons name="chevron-right" size={22} color={TEXT_MUTED} />
            </Pressable>
          </View>

          <View style={styles.legendRow}>
            <View style={styles.legendGrad}>
              <Text style={styles.legendTxt}>少</Text>
              <View style={[styles.legendSq, { backgroundColor: BLUE_LEGEND[0] }]} />
              <View style={[styles.legendSq, { backgroundColor: BLUE_LEGEND[1] }]} />
              <View style={[styles.legendSq, { backgroundColor: BLUE_LEGEND[2] }]} />
              <Text style={styles.legendTxt}>多</Text>
            </View>
            <Text style={styles.legendItalic}>{monthHitCount} 天有记录</Text>
          </View>

          <View style={styles.weekdayRow}>
            {['一', '二', '三', '四', '五', '六', '日'].map((w) => (
              <Text key={w} style={styles.weekdayCell}>
                {w}
              </Text>
            ))}
          </View>

          <View style={styles.calGrid}>
            {Array.from({ length: leadingBlank }).map((_, i) => (
              <View key={`b-${i}`} style={styles.calCell} />
            ))}
            {Array.from({ length: daysInMonth }).map((_, idx) => {
              const day = idx + 1;
              const y = calendarMonth.getFullYear();
              const m = calendarMonth.getMonth();
              const ymd = `${y}-${pad2(m + 1)}-${pad2(day)}`;
              const cnt = checkIns[ymd] ?? 0;
              const isSel = ymd === focusYmd;
              const fill = completionBlue(cnt, CAL_DAY_EMPTY);
              const showLightText = cnt > 0 && needsLightTextOnBlue(fill);
              return (
                <Pressable key={ymd} onPress={() => selectCalendarDay(y, m, day)} style={styles.calCell}>
                  <View
                    style={[
                      styles.calDayInner,
                      { backgroundColor: fill },
                      isSel && styles.calDaySelected,
                    ]}>
                    <Text
                      style={[
                        styles.calDayText,
                        !isSel && showLightText && { color: '#ffffff' },
                        isSel && showLightText && { color: '#ffffff', fontWeight: '700' },
                        isSel && !showLightText && { color: BLUE, fontWeight: '700' },
                      ]}>
                      {day}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.card}>
          <View style={styles.trendHead}>
            <View style={styles.trendTitleRow}>
              <MaterialIcons name="show-chart" size={16} color={BLUE} />
              <Text style={styles.trendTitle}>目标趋势</Text>
            </View>
            <View style={styles.trendArrows}>
              <Pressable
                onPress={() =>
                  setTrendWeekStart((prev) => {
                    const n = new Date(prev);
                    n.setDate(prev.getDate() - 7);
                    return n;
                  })
                }
                hitSlop={8}>
                <MaterialIcons name="chevron-left" size={20} color={TEXT_MUTED} />
              </Pressable>
              <Pressable
                onPress={() =>
                  setTrendWeekStart((prev) => {
                    const n = new Date(prev);
                    n.setDate(prev.getDate() + 7);
                    return n;
                  })
                }
                hitSlop={8}>
                <MaterialIcons name="chevron-right" size={20} color={TEXT_MUTED} />
              </Pressable>
            </View>
          </View>
          <Text style={styles.trendRange}>
            {toYMD(trendWeekStart).replace(/-/g, '.')} - {toYMD(trendEnd).replace(/-/g, '.')}
          </Text>

          <View style={[styles.chartWrap, { width: chartW }]}>
            <Svg width={chartW} height={130} viewBox="0 0 300 120" preserveAspectRatio="none">
              <SvgText x="8" y="118" fill={BLUE} fontSize="10">
                0
              </SvgText>
              <SvgText x="8" y="62" fill={BLUE} fontSize="10">
                {Math.max(1, Math.round(trendMax / 2))}
              </SvgText>
              <SvgText x="8" y="14" fill={BLUE} fontSize="10">
                {trendMax}
              </SvgText>
              <Line x1="28" y1="110" x2="292" y2="110" stroke={CHART_GRID} strokeWidth="1" strokeDasharray="4 4" />
              <Line x1="28" y1="60" x2="292" y2="60" stroke={CHART_GRID} strokeWidth="1" strokeDasharray="4 4" />
              {pathD.d ? <Path d={pathD.d} fill="none" stroke={BLUE} strokeWidth="2" /> : null}
              {pathD.pts.map((p, i) => (
                <React.Fragment key={i}>
                  <Circle cx={p.x} cy={p.y} r={3.5} fill={CARD} stroke={BLUE} strokeWidth="2" />
                  <SvgText x={p.x} y={p.y - 10} fill={BLUE} fontSize="9" textAnchor="middle">
                    {p.cnt}次
                  </SvgText>
                </React.Fragment>
              ))}
            </Svg>
            <View style={styles.chartXLabels}>
              {['周一', '周二', '周三', '周四', '周五', '周六', '周日'].map((label) => (
                <Text key={label} style={styles.chartXText}>
                  {label}
                </Text>
              ))}
            </View>
          </View>
        </View>

        <View style={styles.card}>
          <View style={styles.trendHead}>
            <Text style={styles.heatYearTitle}>{heatmapYear}年</Text>
            <View style={styles.trendArrows}>
              <Pressable onPress={() => setHeatmapYear((y) => y - 1)} hitSlop={8}>
                <MaterialIcons name="chevron-left" size={20} color={TEXT_MUTED} />
              </Pressable>
              <Pressable onPress={() => setHeatmapYear((y) => y + 1)} hitSlop={8}>
                <MaterialIcons name="chevron-right" size={20} color={TEXT_MUTED} />
              </Pressable>
            </View>
          </View>
          <Text style={styles.heatSub}>年度完成热力图</Text>

          <View style={styles.heatRow}>
            <View style={styles.heatYLabels}>
              {['周日', '周一', '周二', '周三', '周四', '周五', '周六'].map((lb) => (
                <Text key={lb} style={styles.heatYText}>
                  {lb}
                </Text>
              ))}
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.heatScroll}>
              {heatWeeks.map((col, wi) => (
                <View key={wi} style={styles.heatCol}>
                  {col.map((dt, di) => {
                    const inYear = dt.getFullYear() === heatmapYear;
                    const ymd = toYMD(dt);
                    const cnt = inYear ? checkIns[ymd] ?? 0 : 0;
                    const bg = !inYear ? HEAT_OUT_YEAR : completionBlue(cnt, HEAT_DAY_EMPTY);
                    return (
                      <View key={`${wi}-${di}`} style={[styles.heatCell, { backgroundColor: bg }]} />
                    );
                  })}
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </ScrollView>

      <Modal visible={datePickerOpen} transparent animationType="fade" onRequestClose={() => setDatePickerOpen(false)}>
        <View style={styles.modalRoot}>
          <Pressable style={styles.modalBackdrop} onPress={() => setDatePickerOpen(false)} />
          <View style={[styles.pickerCard, { marginBottom: insets.bottom + 20 }]}>
            <Text style={styles.pickerTitle}>选择日期</Text>
            <DateTimePicker
              value={focusDate}
              mode="date"
              display={Platform.OS === 'ios' ? 'inline' : 'spinner'}
              onChange={(_, date) => {
                if (!date) return;
                const n = new Date(date);
                n.setHours(0, 0, 0, 0);
                setFocusDate(n);
                setCalendarMonth(new Date(n.getFullYear(), n.getMonth(), 1));
                setTrendWeekStart(startOfWeekMonday(n));
                if (Platform.OS !== 'ios') setDatePickerOpen(false);
              }}
            />
            {Platform.OS === 'ios' ? (
              <Pressable style={styles.pickerOk} onPress={() => setDatePickerOpen(false)}>
                <Text style={styles.pickerOkText}>完成</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG },
  scrollFlex: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingBottom: 10,
    backgroundColor: CARD,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: CARD_BORDER,
  },
  topBarFixed: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 100,
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
  },
  iconBtn: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  topTitle: { fontSize: 17, fontWeight: '600', color: TEXT_MAIN },
  scrollContent: { paddingHorizontal: 16, gap: 14, paddingTop: 6 },
  card: {
    backgroundColor: CARD,
    borderRadius: 12,
    padding: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: CARD_BORDER,
  },
  titleText: { fontSize: 18, fontWeight: '600', color: TEXT_MAIN },
  reminderBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
  },
  reminderBadgeText: { fontSize: 13, fontWeight: '600', color: BLUE },
  quoteCard: {
    backgroundColor: CARD,
    borderRadius: 12,
    paddingVertical: 18,
    paddingHorizontal: 20,
    position: 'relative',
    justifyContent: 'center',
    minHeight: 56,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: CARD_BORDER,
  },
  quoteIconTL: {
    position: 'absolute',
    top: 10,
    left: 10,
    opacity: 0.45,
    fontSize: 11,
    color: '#6b7280',
    fontWeight: '700',
  },
  quoteIconBR: {
    position: 'absolute',
    bottom: 10,
    right: 10,
    opacity: 0.45,
    fontSize: 11,
    color: '#6b7280',
    fontWeight: '700',
  },
  quoteBody: { fontSize: 14, color: TEXT_MUTED, paddingHorizontal: 12, lineHeight: 20 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
    marginBottom: 4,
  },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: TEXT_MAIN },
  dateChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(37,99,235,0.10)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  dateChipText: { fontSize: 12, color: BLUE, fontWeight: '600' },
  makeUpBlock: { gap: 8, paddingVertical: 2 },
  makeUpHint: { fontSize: 13, color: TEXT_MUTED },
  makeUpHintStrong: { fontWeight: '700', color: TEXT_MAIN },
  makeUpSub: { fontSize: 11, color: TEXT_MUTED, lineHeight: 16 },
  makeUpBtnRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  makeUpBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 11,
    borderRadius: 12,
    minHeight: 44,
  },
  makeUpBtnPrimary: { backgroundColor: BLUE },
  makeUpBtnDisabled: { backgroundColor: '#94a3b8', opacity: 0.85 },
  makeUpBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  makeUpBtnCancel: {
    backgroundColor: RED_BG,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: RED_TEXT,
  },
  makeUpBtnCancelDisabled: { opacity: 0.45 },
  makeUpBtnCancelText: { color: RED_TEXT, fontWeight: '700', fontSize: 14 },
  statsRow: { flexDirection: 'row', gap: 10 },
  statCard: { flex: 1, borderRadius: 12, padding: 14 },
  statValue: { fontSize: 26, fontWeight: '600', color: GREEN_TEXT, marginBottom: 4 },
  statUnit: { fontSize: 14, fontWeight: '400' },
  statLabel: { fontSize: 12, opacity: 0.85 },
  calTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  calTitle: { fontSize: 14, color: TEXT_MUTED },
  monthNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16, marginBottom: 10 },
  monthTitle: { fontSize: 18, fontWeight: '600', color: TEXT_MAIN },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  legendGrad: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendTxt: { fontSize: 11, color: '#6b7280' },
  legendSq: { width: 10, height: 10, borderRadius: 2 },
  legendItalic: { fontSize: 11, color: TEXT_MUTED, fontStyle: 'italic' },
  weekdayRow: { flexDirection: 'row', marginBottom: 8 },
  weekdayCell: { flex: 1, textAlign: 'center', fontSize: 11, color: '#6b7280' },
  calGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  calCell: {
    width: '14.2857%',
    paddingVertical: 4,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 40,
  },
  calDayInner: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  calDaySelected: {
    borderWidth: 2,
    borderColor: BLUE,
  },
  calDayText: { fontSize: 13, color: '#374151' },
  trendHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  trendTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  trendTitle: { fontSize: 14, fontWeight: '600', color: BLUE },
  trendArrows: {
    flexDirection: 'row',
    gap: 12,
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: CARD_BORDER,
  },
  trendRange: { fontSize: 11, color: '#6b7280', marginBottom: 12 },
  chartWrap: { alignSelf: 'center', marginTop: 8 },
  chartXLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: '4%',
    marginTop: 8,
  },
  chartXText: { fontSize: 10, color: BLUE, flex: 1, textAlign: 'center' },
  heatYearTitle: { fontSize: 18, fontWeight: '700', color: BLUE },
  heatSub: { fontSize: 11, color: '#6b7280', marginBottom: 10 },
  heatRow: { flexDirection: 'row' },
  heatYLabels: { justifyContent: 'space-between', paddingVertical: 2, marginRight: 8, height: 7 * 15 },
  heatYText: { fontSize: 10, color: TEXT_MUTED, lineHeight: 15 },
  heatScroll: { flexDirection: 'row', gap: 4, paddingBottom: 4 },
  heatCol: { flexDirection: 'column', gap: 4 },
  heatCell: { width: 11, height: 11, borderRadius: 2 },
  centerMsg: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  muted: { color: TEXT_MUTED, fontSize: 14 },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  pickerCard: {
    marginHorizontal: 16,
    backgroundColor: CARD,
    borderRadius: 16,
    padding: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: CARD_BORDER,
    zIndex: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 8,
  },
  pickerTitle: { fontSize: 16, fontWeight: '700', color: TEXT_MAIN, marginBottom: 10 },
  pickerOk: {
    marginTop: 12,
    backgroundColor: BLUE,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  pickerOkText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
