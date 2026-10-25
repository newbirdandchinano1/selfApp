import {
  FoldCountUpText,
  FoldPopIn,
  FoldRiseIn,
  FOLD_MOTION_EASE,
  useFoldMotionGate,
} from '@/components/review/fold-motion';
import { useTaskFoldTheme } from '@/constants/task-fold-theme';
import { usePageDayBoundary } from '@/contexts/day-boundary-context';
import { toast, toUserMessage, Alert } from '@/lib/app-feedback';
import { addDaysToYmd } from '@/lib/date';
import { syncHabitDetailDataFromApi } from '@/lib/habit-detail-api';
import { resyncHabitReminderForHabitId } from '@/lib/habit-reminder-notifications';
import { playHabitCheckInDing } from '@/lib/play-habit-check-in-ding';
import { getHabitById } from '@/lib/repositories/habits/habit';
import type { HabitRow } from '@/lib/repositories/habits/habit.types';
import {
  isBreakHabitSucceeded,
  parseBreakHabitCycle,
  resolveBreakCycleStartYmd,
  syncBreakHabitCompletions,
  tryMarkBreakHabitCompleted,
} from '@/lib/repositories/habits/habit-break-success';
import {
  isBuildHabitSucceeded,
  syncBuildHabitCompletions,
  tryMarkBuildHabitCompleted,
} from '@/lib/repositories/habits/habit-build-success';
import {
  decrementHabitCheckInForDay,
  getCheckInsMapByHabitId,
  hasHabitCheckInRecordForDay,
  incrementHabitCheckInForDay,
  listHabitCheckInMetaByHabitId,
  type HabitCheckInMetaRow,
} from '@/lib/repositories/habits/habit-check-in';
import {
  computeBuildExpectedGoalProgress,
  computeConsecutiveGoalMetDays,
  formatBuildExpectedGoalProgressUnit,
  formatBuildExpectedGoalShort,
  isHabitDayGoalMet,
  parseBuildHabitExpectedGoal,
  parseHabitConsecutiveTargetDays,
  parseHabitDailyGoal,
  parseHabitIncrementCap,
} from '@/lib/repositories/habits/habit-goal';
import { parseHabitKind, type HabitKind } from '@/lib/repositories/habits/habit-kind';
import {
  applyBreakHabitReward,
  syncBreakHabitPenaltyPointsReward,
  syncBuildHabitDayPointsReward,
  syncTaskHabitPeriodPointsReward,
} from '@/lib/repositories/habits/habit-points-grant';
import { parseHabitRewardPoints } from '@/lib/repositories/habits/habit-reward-points';
import { formatHabitReminderClock, parseHabitReminder } from '@/lib/repositories/habits/habit-reminder-meta';
import { hasActiveSubHabits } from '@/lib/repositories/habits/habit-sub';
import {
  computeTaskPeriodGoalProgress,
  isTaskHabitPeriodGoalMet,
  parseTaskHabitExpectedGoal,
  parseTaskRepeatPeriod,
} from '@/lib/repositories/habits/habit-task-period';
import { getProjectById } from '@/lib/repositories/projects/project';
import { getTasks } from '@/lib/repositories/tasks/task';
import { taskHasBoundHabit } from '@/lib/repositories/tasks/task-habit-binding';
import { isTaskTerminalStatus } from '@/lib/repositories/tasks/task.types';
import {
  logicalYmdToLocalDate,
  refreshYmdFocusAfterLogicalDayChange,
} from '@/lib/tasks-logical-day';
import { usePageApiSync, usePagePullRefresh } from '@/hooks/use-page-api-sync';
import { MaterialIcons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useFocusEffect } from 'expo-router/react-navigation';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import {
  ActivityIndicator,
  Animated,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

/** 设计稿 shot 24 月历热力色阶 */
const HEAT0 = '#EFEADD';
const HEAT_ON = '#B7CC9B';
const HEAT_MID = '#83A473';
const HEAT_DEEP = '#4D7550';
const HEAT_MISS = '#F3E7DF';
const HEAT_LEGEND = [HEAT0, HEAT_ON, HEAT_MID, HEAT_DEEP] as const;

/** 折页纸感回退色（styles 静态表用；运行时优先 tf） */
const BG = '#F4F0E8';
const CARD = '#FFFCF5';
const CARD_BORDER = '#D8CDBB';
const TEXT_MAIN = '#202A25';
const TEXT_MUTED = '#7A857D';
const BLUE = '#4F7C51';
const GREEN_TEXT = '#4F7450';
const CAL_DAY_EMPTY = HEAT0;
const SUN_RING = '#D6974B';

type LinkedProjectInfo = {
  projectId: string;
  name: string;
  done: number;
  total: number;
  subtitle: string;
};

/** 设计稿：14 根趋势柱自底部生长 */
function SparkGrowBar({
  pct,
  hot,
  animate,
  index,
}: {
  pct: number;
  hot: boolean;
  animate: boolean;
  index: number;
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
      duration: 520,
      delay: 80 + index * 28,
      easing: FOLD_MOTION_EASE,
      useNativeDriver: false,
    });
    anim.start();
    return () => anim.stop();
  }, [animate, index, progress]);
  const height = progress.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', `${Math.max(6, pct)}%`],
  });
  return (
    <View style={styles.sparkCol}>
      <Animated.View
        style={[
          styles.sparkBar,
          {
            height,
            backgroundColor: hot ? '#D6974B' : '#8FAE76',
          },
        ]}
      />
    </View>
  );
}

/** 设计稿：月历格按周错峰淡入 */
function HeatCellFade({
  animate,
  weekIndex,
  dayIndex,
  children,
  style,
}: {
  animate: boolean;
  weekIndex: number;
  dayIndex: number;
  children: React.ReactNode;
  style?: object;
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
      duration: 360,
      delay: weekIndex * 48 + dayIndex * 10,
      easing: FOLD_MOTION_EASE,
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [animate, dayIndex, progress, weekIndex]);
  return <Animated.View style={[style, { opacity: progress }]}>{children}</Animated.View>;
}

function pickParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

/** 避免软同步反复 setState 导致概览数字/图表乱跳 */
function checkInsMapsEqual(a: Record<string, number>, b: Record<string, number>): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (a[k] !== b[k]) return false;
  }
  return true;
}

function habitOverviewEqual(a: HabitRow | null, b: HabitRow | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.id === b.id &&
    a.name === b.name &&
    a.icon === b.icon &&
    a.context === b.context &&
    a.note === b.note &&
    a.tag === b.tag &&
    a.extra_data === b.extra_data &&
    a.updated_at === b.updated_at
  );
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

function monthMatrix(year: number, month0: number): { leadingBlank: number; daysInMonth: number } {
  const first = new Date(year, month0, 1);
  const dow = first.getDay();
  const leadingBlank = dow === 0 ? 6 : dow - 1;
  const daysInMonth = new Date(year, month0 + 1, 0).getDate();
  return { leadingBlank, daysInMonth };
}

/** 有完成：1 次浅、2 次中、3 次及以上最深，与图例一致 */
function completionHeat(count: number, emptyBackground: string): string {
  if (count <= 0) return emptyBackground;
  if (count === 1) return HEAT_ON;
  if (count === 2) return HEAT_MID;
  return HEAT_DEEP;
}

const BREAK_GOAL_MET = HEAT_MID;
const BREAK_GOAL_FAIL = HEAT_MISS;

function completionBreakDay(
  count: number,
  dailyGoal: number | null,
  emptyBackground: string,
  hasDayRecord: boolean,
  ymd: string,
  logicalTodayYmd: string,
): string {
  if (!hasDayRecord) {
    if (ymd === logicalTodayYmd) return emptyBackground;
    if (ymd < logicalTodayYmd) return BREAK_GOAL_FAIL;
    return emptyBackground;
  }
  if (isHabitDayGoalMet({ kind: 'break', todayCount: count, dailyGoal, hasDayRecord: true })) {
    return count <= 0 ? BREAK_GOAL_MET : HEAT_DEEP;
  }
  return BREAK_GOAL_FAIL;
}

function needsLightTextOnHeat(fill: string): boolean {
  return fill === HEAT_MID || fill === HEAT_DEEP;
}

function formatRecentDayLabel(ymd: string, logicalTodayYmd: string): string {
  if (ymd === logicalTodayYmd) return '今天';
  if (ymd === addDaysToYmd(logicalTodayYmd, -1)) return '昨天';
  return ymd.slice(5).replace('-', '/');
}

async function loadLinkedProjectForHabit(habitId: string): Promise<LinkedProjectInfo | null> {
  const tasks = await getTasks();
  const bound = tasks.filter((t) => taskHasBoundHabit(t.extra_data, habitId) && t.project_id);
  if (bound.length === 0) return null;
  const byProject = new Map<string, typeof bound>();
  for (const t of bound) {
    const pid = t.project_id!;
    const arr = byProject.get(pid) ?? [];
    arr.push(t);
    byProject.set(pid, arr);
  }
  let bestId = '';
  let bestLen = 0;
  for (const [pid, ts] of byProject) {
    if (ts.length > bestLen) {
      bestId = pid;
      bestLen = ts.length;
    }
  }
  if (!bestId) return null;
  const project = await getProjectById(bestId);
  if (!project) return null;
  const all = tasks.filter((t) => t.project_id === bestId);
  const done = all.filter((t) => t.status === 'done').length;
  const openBound = bound.filter((t) => t.project_id === bestId && !isTaskTerminalStatus(t.status)).length;
  return {
    projectId: bestId,
    name: project.name,
    done,
    total: all.length,
    subtitle: `${done} / ${all.length} 任务${openBound > 0 ? ` · ${openBound} 项绑定进行中` : ''}`,
  };
}

const SCREEN_TITLE = '习惯详情';
const PAGE_API_KEY = 'habit-detail';
/** 详情页补卡/撤销连点防抖间隔（与任务页小习惯卡片一致） */
const HABIT_DETAIL_PRESS_DEBOUNCE_MS = 500;

function habitKindLabel(kind: HabitKind): string {
  if (kind === 'break') return '戒除';
  if (kind === 'task') return '完成任务';
  return '养成';
}

export default function HabitDetailScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { tf, fonts, isDark } = useTaskFoldTheme();
  const { animate: foldAnimate } = useFoldMotionGate();
  const { wrapLoad } = usePageApiSync(PAGE_API_KEY);
  const { boundary, logicalTodayYmd, logicalTodayDate } = usePageDayBoundary('tasks');
  const params = useLocalSearchParams<{ habitId?: string }>();
  const habitId = pickParam(params.habitId);
  const cardBg = isDark ? 'rgba(255,252,245,0.06)' : 'rgba(255,252,245,0.9)';

  const [loading, setLoading] = React.useState(true);
  const [habit, setHabit] = React.useState<HabitRow | null>(null);
  const [checkIns, setCheckIns] = React.useState<Record<string, number>>({});

  const [focusDate, setFocusDate] = React.useState(() => logicalTodayDate);
  const [calendarMonth, setCalendarMonth] = React.useState(() => {
    const t = new Date();
    return new Date(t.getFullYear(), t.getMonth(), 1);
  });
  const [checkInMeta, setCheckInMeta] = React.useState<HabitCheckInMetaRow[]>([]);
  const [linkedProject, setLinkedProject] = React.useState<LinkedProjectInfo | null>(null);
  const [recentExpanded, setRecentExpanded] = React.useState(false);

  const [datePickerOpen, setDatePickerOpen] = React.useState(false);
  const [makeUpSaving, setMakeUpSaving] = React.useState(false);
  const [cancelMakeUpSaving, setCancelMakeUpSaving] = React.useState(false);
  /** 补卡/撤销连点防抖（按习惯 ID） */
  const habitDetailPressAtByIdRef = React.useRef(new Map<string, number>());
  const habitLoadGenerationRef = React.useRef(0);
  const habitRef = React.useRef(habit);
  habitRef.current = habit;
  const boundaryRef = React.useRef(boundary);
  boundaryRef.current = boundary;
  const logicalTodayYmdRef = React.useRef(logicalTodayYmd);
  logicalTodayYmdRef.current = logicalTodayYmd;

  const consumeHabitDetailPressDebounce = React.useCallback((id: string) => {
    const now = Date.now();
    const last = habitDetailPressAtByIdRef.current.get(id) ?? 0;
    if (now - last < HABIT_DETAIL_PRESS_DEBOUNCE_MS) return false;
    habitDetailPressAtByIdRef.current.set(id, now);
    return true;
  }, []);

  const focusYmd = React.useMemo(() => toYMD(focusDate), [focusDate]);

  const applyHabitOverviewState = React.useCallback((row: HabitRow | null, nextCheckIns: Record<string, number>) => {
    setHabit((prev) => (habitOverviewEqual(prev, row) ? prev : row));
    setCheckIns((prev) => (checkInsMapsEqual(prev, nextCheckIns) ? prev : nextCheckIns));
  }, []);

  const refreshSidePanels = React.useCallback(async (id: string, generation: number) => {
    try {
      const [meta, linked] = await Promise.all([
        listHabitCheckInMetaByHabitId(id),
        loadLinkedProjectForHabit(id),
      ]);
      if (generation !== habitLoadGenerationRef.current) return;
      setCheckInMeta(meta);
      setLinkedProject(linked);
    } catch (e) {
      console.warn('习惯详情：侧栏数据加载失败', e);
      if (generation !== habitLoadGenerationRef.current) return;
      setCheckInMeta([]);
      setLinkedProject(null);
    }
  }, []);

  const loadHabitOverview = React.useCallback(async (opts?: { awaitRemote?: boolean }) => {
    const awaitRemote = opts?.awaitRemote === true;
    const generation = ++habitLoadGenerationRef.current;
    if (!habitId) {
      applyHabitOverviewState(null, {});
      setCheckInMeta([]);
      setLinkedProject(null);
      return;
    }
    // 先读本地，保证长按进详情立刻有内容；REST 软同步失败不挡页面
    let row = await getHabitById(habitId);
    if (generation !== habitLoadGenerationRef.current) return;
    if (row) {
      const localMap = await getCheckInsMapByHabitId(row.id);
      if (generation !== habitLoadGenerationRef.current) return;
      const mergedLocal = { ...localMap };
      const legacyLocal = normalizeCheckIns(parseExtra(row.extra_data).checkIns);
      for (const [k, v] of Object.entries(legacyLocal)) {
        if (mergedLocal[k] === undefined) mergedLocal[k] = v;
      }
      applyHabitOverviewState(row, mergedLocal);
      setLoading(false);
      void refreshSidePanels(row.id, generation);
    }

    const runRemoteSync = async () => {
      try {
        await syncBreakHabitCompletions();
        await syncBuildHabitCompletions();
      } catch (e) {
        console.warn('习惯详情：完成态同步失败', e);
      }

      try {
        row = (await syncHabitDetailDataFromApi(habitId, { boundary: boundaryRef.current })) ?? row;
      } catch (e) {
        console.warn('习惯详情：服务端同步失败，回退本地', e);
        row = row ?? (await getHabitById(habitId));
      }
      if (generation !== habitLoadGenerationRef.current) return;
      if (!row) {
        applyHabitOverviewState(null, {});
        setCheckInMeta([]);
        setLinkedProject(null);
        return;
      }
      const fromDb = await getCheckInsMapByHabitId(row.id);
      if (generation !== habitLoadGenerationRef.current) return;
      const merged = { ...fromDb };
      const legacy = normalizeCheckIns(parseExtra(row.extra_data).checkIns);
      for (const [k, v] of Object.entries(legacy)) {
        if (merged[k] === undefined) merged[k] = v;
      }
      applyHabitOverviewState(row, merged);
      void refreshSidePanels(row.id, generation);
    };

    // 本地已有数据：软同步放后台，避免二三级页干等 REST；下拉刷新仍可 await
    if (row && !awaitRemote) {
      void runRemoteSync();
      return;
    }
    await runRemoteSync();
  }, [applyHabitOverviewState, habitId, refreshSidePanels]);

  React.useEffect(() => {
    habitLoadGenerationRef.current += 1;
    setLoading(true);
    setHabit(null);
    setCheckIns({});
    setCheckInMeta([]);
    setLinkedProject(null);
    setRecentExpanded(false);
  }, [habitId]);

  const prevLogicalTodayYmdRef = React.useRef(logicalTodayYmd);
  React.useEffect(() => {
    const prev = prevLogicalTodayYmdRef.current;
    if (prev === logicalTodayYmd) return;
    prevLogicalTodayYmdRef.current = logicalTodayYmd;
    const todayDate = logicalYmdToLocalDate(logicalTodayYmd);
    setFocusDate((focusPrev) => {
      const nextYmd = refreshYmdFocusAfterLogicalDayChange(toYMD(focusPrev), logicalTodayYmd, prev);
      return nextYmd === toYMD(focusPrev) ? focusPrev : logicalYmdToLocalDate(nextYmd);
    });
    setCalendarMonth(new Date(todayDate.getFullYear(), todayDate.getMonth(), 1));
    if (habitId) void loadHabitOverview();
  }, [habitId, logicalTodayYmd, loadHabitOverview]);

  const reload = React.useCallback(
    async (forceRefresh = false) => {
      await wrapLoad(async () => {
        if (!habitId) {
          applyHabitOverviewState(null, {});
          setLoading(false);
          return;
        }
        // 仅无本地缓存时亮骨架；有数据则保持现有 UI，后台软同步
        if (forceRefresh || !habitRef.current) setLoading(true);
        try {
          await loadHabitOverview({ awaitRemote: forceRefresh });
        } catch (e) {
          console.warn('加载习惯详情失败', e);
          applyHabitOverviewState(null, {});
        } finally {
          setLoading(false);
        }
      }, forceRefresh);
    },
    [applyHabitOverviewState, habitId, loadHabitOverview, wrapLoad],
  );

  const reloadRef = React.useRef(reload);
  reloadRef.current = reload;

  const { refreshControl } = usePagePullRefresh(PAGE_API_KEY, reload);

  // 只用稳定回调：勿依赖 reload/habit，否则 setHabit 后会反复触发 focus 重载，概览数据乱跳
  useFocusEffect(
    React.useCallback(() => {
      void reloadRef.current();
      setFocusDate((prev) => {
        const ymd = toYMD(prev);
        const today = logicalTodayYmdRef.current;
        if (ymd >= today) {
          return logicalYmdToLocalDate(today);
        }
        return prev;
      });
    }, [])
  );

  const extraParsed = habit ? parseExtra(habit.extra_data) : {};
  const habitReminder = React.useMemo(
    () => (habit ? parseHabitReminder(habit.extra_data) : { enabled: false as const }),
    [habit]
  );
  const habitReminderClock = formatHabitReminderClock(habitReminder);
  const quantify = extraParsed.quantify as { unit?: string; dailyGoal?: number | null } | undefined;

  const habitKind = habit ? parseHabitKind(habit.extra_data) : 'build';
  const dailyGoal = habit ? parseHabitDailyGoal(habit.extra_data, habitKind) : null;
  const consecutiveTargetDays = habit ? parseHabitConsecutiveTargetDays(habit.extra_data) : null;
  const incrementCap = habit ? parseHabitIncrementCap(habit.extra_data, habitKind) : null;
  const focusHasRecord =
    habitKind === 'break' ? Object.prototype.hasOwnProperty.call(checkIns, focusYmd) : (checkIns[focusYmd] ?? 0) > 0;

  const { leadingBlank, daysInMonth } = monthMatrix(calendarMonth.getFullYear(), calendarMonth.getMonth());

  const breakCycle = habit ? parseBreakHabitCycle(habit.extra_data) : null;
  const breakSucceeded = habit ? isBreakHabitSucceeded(habit.extra_data) : false;
  const buildSucceeded = habit ? isBuildHabitSucceeded(habit.extra_data) : false;
  const buildExpectedGoal = habit ? parseBuildHabitExpectedGoal(habit.extra_data) : null;
  const buildExpectedProgress =
    buildExpectedGoal != null
      ? computeBuildExpectedGoalProgress({
          expectedGoal: buildExpectedGoal,
          checkIns,
          dailyGoal,
          endYmd: focusYmd,
          kind: 'build',
        })
      : 0;
  const taskExpectedGoal = habit ? parseTaskHabitExpectedGoal(habit.extra_data) : null;
  const taskRepeatPeriod = habit ? parseTaskRepeatPeriod(habit.extra_data) : '每月';
  const taskPeriodProgress =
    taskExpectedGoal != null
      ? computeTaskPeriodGoalProgress({
          expectedGoal: taskExpectedGoal,
          checkIns,
          dailyGoal,
          logicalYmd: focusYmd,
          period: taskRepeatPeriod,
        })
      : 0;
  const taskPeriodMet =
    habit != null &&
    isTaskHabitPeriodGoalMet({
      extraData: habit.extra_data,
      checkIns,
      logicalYmd: focusYmd,
    });

  const consecutiveStreak = React.useMemo(
    () =>
      computeConsecutiveGoalMetDays({
        checkIns,
        endYmd: focusYmd,
        kind: habitKind,
        dailyGoal,
        minYmd: habit ? resolveBreakCycleStartYmd(breakCycle ?? parseBreakHabitCycle(null), habit.created_at) : null,
        logicalTodayYmd,
      }),
    [breakCycle, checkIns, focusYmd, habit, habitKind, dailyGoal, logicalTodayYmd]
  );

  const monthStats = React.useMemo(() => {
    const y = calendarMonth.getFullYear();
    const m = calendarMonth.getMonth();
    const monthPrefix = `${y}-${pad2(m + 1)}-`;
    let hit = 0;
    let miss = 0;
    const makeupSet = new Set(
      checkInMeta.filter((r) => r.isMakeup && r.record_date.startsWith(monthPrefix)).map((r) => r.record_date),
    );
    for (let day = 1; day <= daysInMonth; day++) {
      const k = `${monthPrefix}${pad2(day)}`;
      if (k > logicalTodayYmd) continue;
      const hasDayRecord =
        habitKind === 'break' ? Object.prototype.hasOwnProperty.call(checkIns, k) : undefined;
      const met = isHabitDayGoalMet({
        kind: habitKind,
        todayCount: checkIns[k] ?? 0,
        dailyGoal,
        hasDayRecord,
        ymd: k,
        logicalTodayYmd,
      });
      if (met) hit += 1;
      else miss += 1;
    }
    const elapsed = hit + miss;
    const pct = elapsed > 0 ? Math.round((hit / elapsed) * 100) : 0;
    return { hit, miss, makeup: makeupSet.size, pct, elapsed };
  }, [calendarMonth, checkInMeta, checkIns, dailyGoal, daysInMonth, habitKind, logicalTodayYmd]);

  const spark14 = React.useMemo(() => {
    const arr: number[] = [];
    for (let i = 13; i >= 0; i -= 1) {
      arr.push(checkIns[addDaysToYmd(logicalTodayYmd, -i)] ?? 0);
    }
    return arr;
  }, [checkIns, logicalTodayYmd]);
  const sparkMax = Math.max(1, ...spark14, dailyGoal ?? 1);

  const rate30 = React.useMemo(() => {
    let hit = 0;
    for (let i = 0; i < 30; i += 1) {
      const ymd = addDaysToYmd(logicalTodayYmd, -i);
      const hasDayRecord = Object.prototype.hasOwnProperty.call(checkIns, ymd);
      if (
        isHabitDayGoalMet({
          kind: habitKind,
          todayCount: checkIns[ymd] ?? 0,
          dailyGoal,
          hasDayRecord: habitKind === 'break' ? hasDayRecord : undefined,
          ymd: habitKind === 'break' ? ymd : undefined,
          logicalTodayYmd,
        })
      ) {
        hit += 1;
      }
    }
    return Math.round((hit / 30) * 100);
  }, [checkIns, dailyGoal, habitKind, logicalTodayYmd]);

  const rewardPts = habit ? parseHabitRewardPoints(habit.extra_data) : 0;
  const todayDone = isHabitDayGoalMet({
    kind: habitKind,
    todayCount: checkIns[logicalTodayYmd] ?? 0,
    dailyGoal,
    hasDayRecord:
      habitKind === 'break' ? Object.prototype.hasOwnProperty.call(checkIns, logicalTodayYmd) : undefined,
    ymd: logicalTodayYmd,
    logicalTodayYmd,
  });

  const recentRows = React.useMemo(() => {
    const limit = recentExpanded ? 12 : 3;
    return checkInMeta
      .filter((r) => habitKind === 'break' || r.count > 0)
      .slice(0, limit)
      .map((r) => {
        const met = isHabitDayGoalMet({
          kind: habitKind,
          todayCount: r.count,
          dailyGoal,
          hasDayRecord: true,
          ymd: r.record_date,
          logicalTodayYmd,
        });
        const dayLabel = formatRecentDayLabel(r.record_date, logicalTodayYmd);
        let status = met ? '目标达成' : '未达标';
        if (r.isMakeup) status = met ? `补卡 · 目标达成` : `补卡 · 未达标`;
        const unit =
          typeof quantify?.unit === 'string' && quantify.unit.trim() ? quantify.unit.trim() : '次';
        const title =
          habitKind === 'break'
            ? r.count <= 0
              ? habit?.name ?? '保持戒除'
              : `${habit?.name ?? '习惯'} · 破戒 ${r.count}`
            : dailyGoal != null && r.count !== dailyGoal
              ? `${habit?.name ?? '习惯'} ${r.count} ${unit}`
              : habit?.name ?? '习惯';
        const pts = met ? rewardPts : r.isMakeup && rewardPts > 0 ? Math.max(1, Math.min(2, Math.round(rewardPts * 0.4))) : 0;
        return {
          key: r.record_date,
          title,
          meta: `${dayLabel} · ${status}`,
          pts,
          icon: habit?.icon || '📖',
        };
      });
  }, [
    checkInMeta,
    dailyGoal,
    habit?.icon,
    habit?.name,
    habitKind,
    logicalTodayYmd,
    quantify?.unit,
    recentExpanded,
    rewardPts,
  ]);

  const goalBarLabel = React.useMemo(() => {
    const monthLabel = `${calendarMonth.getMonth() + 1}月目标`;
    if (habitKind === 'task' && taskExpectedGoal != null) {
      return {
        title: monthLabel,
        sub: `本${taskRepeatPeriod.replace('每', '')} ${taskPeriodProgress} / ${taskExpectedGoal.value} ${formatBuildExpectedGoalProgressUnit(taskExpectedGoal.type)}`,
        pct: taskExpectedGoal.value > 0 ? Math.min(100, Math.round((taskPeriodProgress / taskExpectedGoal.value) * 100)) : 0,
      };
    }
    if (habitKind === 'build' && buildExpectedGoal != null) {
      return {
        title: monthLabel,
        sub: `${formatBuildExpectedGoalShort(buildExpectedGoal)} · 进度 ${buildExpectedProgress}`,
        pct: buildExpectedGoal.value > 0 ? Math.min(100, Math.round((buildExpectedProgress / buildExpectedGoal.value) * 100)) : 0,
      };
    }
    const unit =
      typeof quantify?.unit === 'string' && quantify.unit.trim() ? quantify.unit.trim() : '次';
    return {
      title: monthLabel,
      sub: dailyGoal != null ? `${dailyGoal} ${unit} / 天 · ${monthStats.elapsed} 天` : `本月已过 ${monthStats.elapsed} 天`,
      pct: monthStats.pct,
    };
  }, [
    buildExpectedGoal,
    buildExpectedProgress,
    calendarMonth,
    dailyGoal,
    habitKind,
    monthStats.elapsed,
    monthStats.pct,
    quantify?.unit,
    taskExpectedGoal,
    taskPeriodProgress,
    taskRepeatPeriod,
  ]);

  const subtitleParts = [
    habitKindLabel(habitKind),
    habit?.context,
    dailyGoal != null ? `每天 ${dailyGoal} 次` : habit?.tag,
  ].filter(Boolean);

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
        from: 'detail',
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
    if (!habit || makeUpSaving || cancelMakeUpSaving) return;
    if (!consumeHabitDetailPressDebounce(habit.id)) return;
    if (hasActiveSubHabits(habit.extra_data)) {
      const kind = parseHabitKind(habit.extra_data);
      const label = kind === 'task' ? '子任务' : '子习惯';
      Alert.alert('提示', `该习惯已启用${label}，请在任务页点击习惯后，在清单中完成打卡。`);
      return;
    }
    const ymd = focusYmd;
    if (ymd >= logicalTodayYmd) {
      Alert.alert('提示', '补卡仅适用于已过去的日期；今天请在任务页打卡，或先选择更早的日期。');
      return;
    }
    setMakeUpSaving(true);
    try {
      const kind = parseHabitKind(habit.extra_data);
      const prevCount = checkIns[ymd] ?? 0;
      const wasTaskPeriodMet =
        kind === 'task'
          ? isTaskHabitPeriodGoalMet({
              extraData: habit.extra_data,
              checkIns,
              logicalYmd: logicalTodayYmd,
            })
          : false;
      const { increased, nextCount } = await incrementHabitCheckInForDay(habit.id, ymd, incrementCap);
      if (!increased) {
        Alert.alert(
          '已达上限',
          incrementCap != null
            ? `该习惯每日最多 ${incrementCap} 次，${ymd} 当日已记满。`
            : '当日次数未增加（可能已达上限）。'
        );
        return;
      }
      setCheckIns((prev) => ({ ...prev, [ymd]: nextCount }));
      void playHabitCheckInDing();
      if (kind === 'build') {
        await tryMarkBuildHabitCompleted(habit, logicalTodayYmd);
      } else if (kind === 'break') {
        await tryMarkBreakHabitCompleted(habit, logicalTodayYmd);
        try {
          await syncBreakHabitPenaltyPointsReward({
            habitId: habit.id,
            prevCount,
            nextCount,
            dailyGoal,
            extraData: habit.extra_data,
          });
        } catch (ptsErr) {
          if (__DEV__) console.warn('[habit-detail] 补卡破戒扣分失败', ptsErr);
        }
      } else if (kind === 'task') {
        try {
          await syncTaskHabitPeriodPointsReward({
            habitId: habit.id,
            extraData: habit.extra_data,
            logicalYmd: logicalTodayYmd,
            wasPeriodMet: wasTaskPeriodMet,
          });
        } catch (ptsErr) {
          if (__DEV__) console.warn('[habit-detail] 补卡任务周期积分失败', ptsErr);
        }
      }
      await reload(true);
      toast.success('已补卡');
    } catch (e) {
      console.warn('习惯补卡失败', e);
      toast.error(toUserMessage(e, '补卡未保存，请稍后重试。'));
    } finally {
      setMakeUpSaving(false);
    }
  }, [
    cancelMakeUpSaving,
    checkIns,
    consumeHabitDetailPressDebounce,
    dailyGoal,
    focusYmd,
    habit,
    incrementCap,
    logicalTodayYmd,
    makeUpSaving,
    reload,
  ]);

  const handleDecrementFocusDayCheckIn = React.useCallback(async () => {
    if (!habit || makeUpSaving || cancelMakeUpSaving) return;
    if (!consumeHabitDetailPressDebounce(habit.id)) return;
    const ymd = focusYmd;
    if (ymd > logicalTodayYmd) {
      Alert.alert('提示', '不能撤销未来日期的记录。');
      return;
    }
    const hasRecord = await hasHabitCheckInRecordForDay(habit.id, ymd);
    if (!hasRecord) {
      const displayCnt = checkIns[ymd] ?? 0;
      if (displayCnt > 0) {
        Alert.alert(
          '无法撤销',
          '该日次数来自旧版本地数据，未写入打卡表。如需调整请编辑习惯或清除备注中的历史打卡字段。'
        );
      } else {
        Alert.alert(
          '提示',
          ymd === logicalTodayYmd ? '今日暂无打卡记录可撤销。' : '该日暂无打卡记录可撤销。',
        );
      }
      return;
    }
    setCancelMakeUpSaving(true);
    try {
      const prevCount = checkIns[ymd] ?? 0;
      const kind = parseHabitKind(habit.extra_data);
      const isBreak = kind === 'break';
      const wasTaskPeriodMet =
        kind === 'task'
          ? isTaskHabitPeriodGoalMet({
              extraData: habit.extra_data,
              checkIns,
              logicalYmd: logicalTodayYmd,
            })
          : false;
      const wasCleanConfirm = isBreak && prevCount <= 0;
      const nextCount = await decrementHabitCheckInForDay(habit.id, ymd, {
        breakHabit: isBreak,
      });
      setCheckIns((prev) => {
        const next = { ...prev };
        if (nextCount <= 0) delete next[ymd];
        else next[ymd] = nextCount;
        return next;
      });
      // 养成：当日目标刚回退才扣回；任务：周期目标回退时扣回；戒除：撤销超限破戒返还扣分 / 撤销保持戒除扣回加分
      if (kind === 'build' && ymd === logicalTodayYmd && nextCount < prevCount) {
        try {
          await syncBuildHabitDayPointsReward({
            habitId: habit.id,
            prevCount,
            nextCount,
            dailyGoal,
            extraData: habit.extra_data,
          });
        } catch (ptsErr) {
          if (__DEV__) console.warn('[habit-detail] 撤销打卡扣回积分失败', ptsErr);
        }
      } else if (kind === 'task') {
        try {
          await syncTaskHabitPeriodPointsReward({
            habitId: habit.id,
            extraData: habit.extra_data,
            logicalYmd: logicalTodayYmd,
            wasPeriodMet: wasTaskPeriodMet,
          });
        } catch (ptsErr) {
          if (__DEV__) console.warn('[habit-detail] 撤销任务周期积分失败', ptsErr);
        }
      } else if (isBreak) {
        try {
          if (nextCount < prevCount) {
            await syncBreakHabitPenaltyPointsReward({
              habitId: habit.id,
              prevCount,
              nextCount,
              dailyGoal,
              extraData: habit.extra_data,
            });
          } else if (wasCleanConfirm) {
            await applyBreakHabitReward(habit.id, 'clean', 'undo', {
              forceUndo: true,
              extraData: habit.extra_data,
            });
          }
        } catch (ptsErr) {
          if (__DEV__) console.warn('[habit-detail] 撤销破戒/保持戒除积分失败', ptsErr);
        }
      }
      if (kind === 'build') {
        await tryMarkBuildHabitCompleted(habit, logicalTodayYmd);
      }
      if (ymd === logicalTodayYmd) {
        void resyncHabitReminderForHabitId(habit.id);
      }
      await reload(true);
      toast.success('已撤销');
    } catch (e) {
      console.warn('撤销打卡失败', e);
      toast.error(toUserMessage(e, '未能撤销，请稍后重试。'));
    } finally {
      setCancelMakeUpSaving(false);
    }
  }, [
    cancelMakeUpSaving,
    checkIns,
    consumeHabitDetailPressDebounce,
    dailyGoal,
    focusYmd,
    habit,
    logicalTodayYmd,
    makeUpSaving,
    reload,
  ]);

  const renderAppBar = (showEdit: boolean) => (
    <View style={[styles.appbar, { paddingTop: Math.max(insets.top, 8) }]}>
      <Pressable
        onPress={() => router.back()}
        hitSlop={8}
        style={({ pressed }) => [styles.iconbtn, pressed && { opacity: 0.75 }]}>
        <MaterialIcons name="arrow-back" size={20} color={tf.ink2} />
      </Pressable>
      <View style={styles.appbarCenter}>
        <Text style={[styles.appbarTitle, { color: tf.ink }]}>{SCREEN_TITLE}</Text>
        <Text style={[styles.appbarSub, { color: tf.muted }]} numberOfLines={1}>
          {habit ? subtitleParts.join(' · ') : '…'}
        </Text>
      </View>
      {showEdit ? (
        <Pressable
          onPress={goEdit}
          style={({ pressed }) => [
            styles.pillbtn,
            {
              borderColor: tf.line2,
              backgroundColor: isDark ? 'rgba(255,252,245,0.08)' : 'rgba(255,252,245,0.66)',
              opacity: pressed ? 0.85 : 1,
            },
          ]}>
          <MaterialIcons name="edit" size={12} color={tf.ink2} />
          <Text style={{ fontSize: 12, fontWeight: '700', color: tf.ink2 }}>编辑</Text>
        </Pressable>
      ) : (
        <View style={{ width: 28 }} />
      )}
    </View>
  );

  if (!habitId) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: tf.paper }]} edges={['left', 'right']}>
        {renderAppBar(false)}
        <View style={styles.centerMsg}>
          <Text style={[styles.muted, { color: tf.muted }]}>缺少习惯参数</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (loading || !habit) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: tf.paper }]} edges={['left', 'right']}>
        {renderAppBar(false)}
        <View style={styles.centerMsg}>
          {loading ? (
            <ActivityIndicator color={tf.frog} />
          ) : (
            <Text style={[styles.muted, { color: tf.muted }]}>未找到该习惯</Text>
          )}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: tf.paper }]} edges={['left', 'right']}>
      {renderAppBar(true)}

      <ScrollView
        refreshControl={refreshControl}
        style={styles.scrollFlex}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: 28 + Math.max(insets.bottom, 12) },
        ]}
        showsVerticalScrollIndicator={false}>
        <FoldRiseIn animate={foldAnimate} index={0} duration={460} staggerMs={36} fromY={8} holdHidden={foldAnimate}>
          <View style={[styles.hhero, { backgroundColor: cardBg, borderColor: tf.line2 }]}>
            <View style={styles.hhtop}>
              <View style={[styles.bigicon, { backgroundColor: tf.lily2 }]}>
                <Text style={styles.bigiconEmoji}>{habit.icon || '📖'}</Text>
              </View>
              <View style={styles.hhc}>
                <Text style={[styles.heroName, { color: tf.pond, fontFamily: fonts.serif }]} numberOfLines={2}>
                  {habit.name}
                </Text>
                <View style={styles.heroMetaRow}>
                  <View
                    style={[
                      styles.todayTag,
                      {
                        backgroundColor: todayDone ? tf.lily2 : isDark ? tf.paper2 : '#F1EDE1',
                      },
                    ]}>
                    <Text style={{ fontSize: 10, fontWeight: '700', color: todayDone ? '#42613E' : tf.muted }}>
                      {todayDone ? '今日已打卡' : '今日未打卡'}
                    </Text>
                  </View>
                  {habitReminder.enabled && habitReminderClock ? (
                    <Text style={{ fontSize: 11, color: tf.faint }}>
                      {habitReminderClock} 提醒 · 已入格
                    </Text>
                  ) : null}
                </View>
              </View>
              <FoldPopIn animate={foldAnimate} index={0} delayMs={120} duration={380}>
                <View style={styles.streakbig}>
                  <View style={styles.streakNumRow}>
                    <MaterialIcons name="local-fire-department" size={16} color="#D6974B" />
                    <FoldCountUpText
                      value={consecutiveStreak}
                      animate={foldAnimate}
                      delayMs={160}
                      duration={700}
                      textStyle={[styles.streakNum, { color: '#4F7450', fontFamily: fonts.mono }]}
                    />
                  </View>
                  <Text style={{ fontSize: 10, color: tf.faint }}>连续天数</Text>
                </View>
              </FoldPopIn>
            </View>
            <View style={styles.hhstats}>
              <View style={[styles.hhstat, { backgroundColor: isDark ? tf.paper2 : 'rgba(255,252,245,0.62)' }]}>
                <Text style={[styles.hhstatNum, { color: '#4E6552', fontFamily: fonts.mono }]}>
                  {monthStats.hit} / {daysInMonth}
                </Text>
                <Text style={[styles.hhstatLabel, { color: tf.faint }]}>本月达标</Text>
              </View>
              <View style={[styles.hhstat, { backgroundColor: isDark ? tf.paper2 : 'rgba(255,252,245,0.62)' }]}>
                <Text style={[styles.hhstatNum, { color: '#4E6552', fontFamily: fonts.mono }]}>
                  ¥ {rewardPts}
                </Text>
                <Text style={[styles.hhstatLabel, { color: tf.faint }]}>累计积分</Text>
              </View>
              <View style={[styles.hhstat, { backgroundColor: isDark ? tf.paper2 : 'rgba(255,252,245,0.62)' }]}>
                <Text style={[styles.hhstatNum, { color: '#4E6552', fontFamily: fonts.mono }]}>
                  {rate30}%
                </Text>
                <Text style={[styles.hhstatLabel, { color: tf.faint }]}>近 30 天完成率</Text>
              </View>
            </View>
          </View>
        </FoldRiseIn>

        <FoldRiseIn animate={foldAnimate} index={1} duration={460} staggerMs={36} fromY={8} holdHidden={foldAnimate}>
          <View style={[styles.card, { backgroundColor: cardBg, borderColor: tf.line2 }]}>
            <View style={styles.hmhead2}>
              <Text style={[styles.sectionTitle, { color: tf.ink2 }]}>
                {calendarMonth.getMonth() + 1}月热力
              </Text>
              <Text style={{ fontSize: 11, color: tf.faint, fontFamily: fonts.mono, marginLeft: 6 }}>
                {calendarMonth.getFullYear()}
              </Text>
              <View style={styles.legendInline}>
                {HEAT_LEGEND.map((c) => (
                  <View key={c} style={[styles.legendSq, { backgroundColor: c }]} />
                ))}
              </View>
            </View>
            <View style={styles.monthNav}>
              <Pressable
                onPress={() =>
                  setCalendarMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))
                }
                hitSlop={8}>
                <MaterialIcons name="chevron-left" size={22} color={TEXT_MUTED} />
              </Pressable>
              <Pressable onPress={() => setDatePickerOpen(true)} hitSlop={6}>
                <Text style={[styles.monthTitle, { color: tf.ink2 }]}>
                  {focusYmd} · 选日补卡
                </Text>
              </Pressable>
              <Pressable
                onPress={() =>
                  setCalendarMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))
                }
                hitSlop={8}>
                <MaterialIcons name="chevron-right" size={22} color={TEXT_MUTED} />
              </Pressable>
            </View>
            <View style={styles.weekdayRow}>
              {['一', '二', '三', '四', '五', '六', '日'].map((w) => (
                <Text key={w} style={[styles.weekdayCell, { color: tf.faint }]}>
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
                const hasDayRecord =
                  habitKind === 'break' ? Object.prototype.hasOwnProperty.call(checkIns, ymd) : false;
                const isSel = ymd === focusYmd;
                const isToday = ymd === logicalTodayYmd;
                const fill =
                  habitKind === 'break'
                    ? completionBreakDay(cnt, dailyGoal, CAL_DAY_EMPTY, hasDayRecord, ymd, logicalTodayYmd)
                    : completionHeat(cnt, CAL_DAY_EMPTY);
                const showLightText =
                  habitKind === 'break'
                    ? hasDayRecord &&
                      !isHabitDayGoalMet({
                        kind: 'break',
                        todayCount: cnt,
                        dailyGoal,
                        hasDayRecord: true,
                      }) &&
                      cnt > 0
                    : cnt > 0 && needsLightTextOnHeat(fill);
                const weekIndex = Math.floor((leadingBlank + idx) / 7);
                const dayIndex = (leadingBlank + idx) % 7;
                return (
                  <HeatCellFade
                    key={ymd}
                    animate={foldAnimate}
                    weekIndex={weekIndex}
                    dayIndex={dayIndex}
                    style={styles.calCell}>
                    <Pressable onPress={() => selectCalendarDay(y, m, day)} style={styles.calCellPress}>
                      <View
                        style={[
                          styles.calDayInner,
                          { backgroundColor: fill },
                          isToday && styles.calDayToday,
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
                  </HeatCellFade>
                );
              })}
            </View>
            <View style={styles.heatFoot}>
              <View style={[styles.dot, { backgroundColor: HEAT_ON }]} />
              <Text style={{ flex: 1, fontSize: 11, color: tf.faint }}>
                已打卡 {monthStats.hit} 天 · 漏 {monthStats.miss} 天 · 补卡 {monthStats.makeup} 天
              </Text>
              <Text style={{ fontSize: 11, color: '#6F856B' }}>月历格可点 ›</Text>
            </View>
          </View>
        </FoldRiseIn>

        <FoldRiseIn animate={foldAnimate} index={2} duration={460} staggerMs={36} fromY={8} holdHidden={foldAnimate}>
          <View style={[styles.card, { backgroundColor: cardBg, borderColor: tf.line2 }]}>
            <View style={styles.sparkHead}>
              <Text style={[styles.sectionTitle, { color: tf.ink2 }]}>近 14 天</Text>
              <Text style={{ fontSize: 11, color: tf.faint, marginLeft: 6 }}>
                {dailyGoal != null
                  ? `目标 ${dailyGoal}${typeof quantify?.unit === 'string' && quantify.unit.trim() ? ` ${quantify.unit.trim()}` : ''} / 天`
                  : '次数趋势'}
              </Text>
              <Text style={{ marginLeft: 'auto', fontSize: 11, color: '#6F856B' }}>趋势 ›</Text>
            </View>
            <View style={styles.spark}>
              {spark14.map((v, i) => {
                const pct = Math.max(6, Math.round((v / sparkMax) * 100));
                return (
                  <SparkGrowBar
                    key={i}
                    pct={pct}
                    hot={i === spark14.length - 1}
                    animate={foldAnimate}
                    index={i}
                  />
                );
              })}
            </View>
            <View style={styles.sparkX}>
              <Text style={{ fontSize: 10, color: tf.faint }}>{addDaysToYmd(logicalTodayYmd, -13).slice(5)}</Text>
              <Text style={{ fontSize: 10, color: tf.faint }}>{addDaysToYmd(logicalTodayYmd, -7).slice(5)}</Text>
              <Text style={{ fontSize: 10, color: tf.faint }}>今天</Text>
            </View>
          </View>
        </FoldRiseIn>

        <FoldRiseIn animate={foldAnimate} index={3} duration={460} staggerMs={36} fromY={8} holdHidden={foldAnimate}>
          <View style={[styles.card, styles.extraCard, { backgroundColor: cardBg, borderColor: tf.line2 }]}>
            <View style={styles.goalHead}>
              <Text style={[styles.sectionTitle, { color: tf.ink2, fontSize: 13 }]}>{goalBarLabel.title}</Text>
              <Text style={{ fontSize: 11, color: tf.faint, marginLeft: 6, flex: 1 }} numberOfLines={1}>
                {goalBarLabel.sub}
              </Text>
              <Text style={{ fontSize: 11, color: '#6F856B', fontFamily: fonts.mono }}>{goalBarLabel.pct}%</Text>
            </View>
            <View style={[styles.pcprog, { backgroundColor: isDark ? tf.paper2 : '#EFEADD' }]}>
              <View
                style={[
                  styles.pcprogFill,
                  { width: `${Math.max(0, Math.min(100, goalBarLabel.pct))}%` },
                ]}
              />
            </View>
            <View style={styles.miniStat3}>
              <View style={[styles.miniStatCell, { backgroundColor: isDark ? tf.paper2 : 'rgba(255,252,245,0.62)' }]}>
                <Text style={[styles.miniStatNum, { color: '#4E6552', fontFamily: fonts.mono }]}>{monthStats.hit}</Text>
                <Text style={[styles.miniStatLabel, { color: tf.faint }]}>达标天数</Text>
              </View>
              <View style={[styles.miniStatCell, { backgroundColor: isDark ? tf.paper2 : 'rgba(255,252,245,0.62)' }]}>
                <Text style={[styles.miniStatNum, { color: '#4E6552', fontFamily: fonts.mono }]}>{monthStats.miss}</Text>
                <Text style={[styles.miniStatLabel, { color: tf.faint }]}>漏卡</Text>
              </View>
              <View style={[styles.miniStatCell, { backgroundColor: isDark ? tf.paper2 : 'rgba(255,252,245,0.62)' }]}>
                <Text style={[styles.miniStatNum, { color: '#4E6552', fontFamily: fonts.mono }]}>{monthStats.makeup}</Text>
                <Text style={[styles.miniStatLabel, { color: tf.faint }]}>补卡</Text>
              </View>
            </View>
            {habitKind === 'break' && !breakSucceeded ? (
              <Text style={[styles.makeUpSub, { marginTop: 6 }]}>
                {consecutiveTargetDays != null
                  ? `连续挑战 ${consecutiveStreak} / ${consecutiveTargetDays} 天`
                  : `已连续 ${consecutiveStreak} 天`}
              </Text>
            ) : null}
            {habitKind === 'build' && buildExpectedGoal != null && !buildSucceeded ? (
              <Text style={[styles.makeUpSub, { marginTop: 6 }]}>
                预期目标进度 {buildExpectedProgress} / {buildExpectedGoal.value}{' '}
                {formatBuildExpectedGoalProgressUnit(buildExpectedGoal.type)}
              </Text>
            ) : null}
            {habitKind === 'task' && taskExpectedGoal != null ? (
              <Text style={[styles.makeUpSub, { marginTop: 6, color: taskPeriodMet ? GREEN_TEXT : TEXT_MUTED }]}>
                {taskPeriodMet
                  ? `本${taskRepeatPeriod.replace('每', '')}已达成`
                  : `本${taskRepeatPeriod.replace('每', '')}进度 ${taskPeriodProgress} / ${taskExpectedGoal.value}`}
              </Text>
            ) : null}
          </View>
        </FoldRiseIn>

        <FoldRiseIn animate={foldAnimate} index={4} duration={460} staggerMs={36} fromY={8} holdHidden={foldAnimate}>
          <View style={[styles.card, styles.extraCardTight, { backgroundColor: cardBg, borderColor: tf.line2 }]}>
            <View style={styles.goalHead}>
              <Text style={[styles.sectionTitle, { color: tf.ink2, fontSize: 13 }]}>最近打卡</Text>
              <Text style={{ fontSize: 11, color: tf.faint, marginLeft: 6 }}>
                {Math.min(recentExpanded ? 12 : 3, checkInMeta.filter((r) => habitKind === 'break' || r.count > 0).length)} 条
              </Text>
              <Pressable
                onPress={() => setRecentExpanded((v) => !v)}
                hitSlop={8}
                style={{ marginLeft: 'auto' }}>
                <Text style={{ fontSize: 11, color: '#6F856B' }}>{recentExpanded ? '收起 ›' : '全部 ›'}</Text>
              </Pressable>
            </View>
            {recentRows.length === 0 ? (
              <Text style={[styles.makeUpSub, { paddingVertical: 8 }]}>暂无打卡记录</Text>
            ) : (
              recentRows.map((row, i) => (
                <View key={row.key} style={[styles.histrow, i === 0 && { borderTopWidth: 0 }]}>
                  <View style={styles.histIcon}>
                    <Text style={{ fontSize: 14 }}>{row.icon}</Text>
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[styles.histTitle, { color: tf.ink2 }]} numberOfLines={1}>
                      {row.title}
                    </Text>
                    <Text style={[styles.histMeta, { color: tf.faint }]} numberOfLines={1}>
                      {row.meta}
                    </Text>
                  </View>
                  <Text
                    style={[
                      styles.histPts,
                      { color: row.pts > 0 ? '#5D8457' : tf.faint, fontFamily: fonts.mono },
                    ]}>
                    {row.pts > 0 ? `+${row.pts}` : '0'}
                  </Text>
                </View>
              ))
            )}
          </View>
        </FoldRiseIn>

        {linkedProject ? (
          <FoldRiseIn animate={foldAnimate} index={5} duration={460} staggerMs={36} fromY={8} holdHidden={foldAnimate}>
            <Pressable
              onPress={() =>
                router.push({ pathname: '/edit-project', params: { id: linkedProject.projectId } })
              }
              style={[styles.linkedCard, { backgroundColor: cardBg, borderColor: tf.line2 }]}>
              <View style={[styles.frogmark, { backgroundColor: tf.lily2 }]}>
                <MaterialIcons name="spa" size={16} color={tf.frog} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ fontSize: 13, fontWeight: '700', color: '#536155' }} numberOfLines={1}>
                  关联项目：{linkedProject.name}
                </Text>
                <Text style={{ fontSize: 11, color: '#9CA59C', marginTop: 2 }} numberOfLines={1}>
                  {linkedProject.subtitle}
                </Text>
              </View>
              <Text style={{ fontSize: 11, color: '#6F856B' }}>查看 ›</Text>
            </Pressable>
          </FoldRiseIn>
        ) : null}

        <View style={[styles.hnote, { backgroundColor: isDark ? tf.sun2 : '#F8F1E2', borderColor: '#EBD7B7' }]}>
          <MaterialIcons name="lightbulb-outline" size={14} color={tf.sun} />
          <Text style={{ flex: 1, fontSize: 11, lineHeight: 16, color: '#8B6B37' }}>
            <Text style={{ fontWeight: '800' }}>补卡规则</Text>
            {' · '}仅支持逻辑日之前；今天请回任务页打卡。带子习惯时必须在清单逐项勾选；撤销会同步扣回积分。
            {focusYmd < logicalTodayYmd
              ? ` 当前选中 ${focusYmd}，已记 ${checkIns[focusYmd] ?? 0} 次。`
              : ''}
          </Text>
        </View>

        <View style={styles.ghostBtnRow}>
          <Pressable
            onPress={() => {
              if (focusYmd === logicalTodayYmd) {
                toast.info(todayDone ? '今天已在任务页打卡 · 可在此撤销一次' : '今天请回任务页打卡');
                router.push('/(tabs)/tasks');
                return;
              }
              void handleDecrementFocusDayCheckIn();
            }}
            disabled={cancelMakeUpSaving || (focusYmd !== logicalTodayYmd && !focusHasRecord)}
            style={({ pressed }) => [
              styles.ghostBtn,
              {
                borderColor: tf.line2,
                backgroundColor: isDark ? 'rgba(255,252,245,0.06)' : 'rgba(255,252,245,0.7)',
                opacity: pressed || cancelMakeUpSaving ? 0.75 : 1,
              },
            ]}>
            {cancelMakeUpSaving ? (
              <ActivityIndicator size="small" color={tf.frog} />
            ) : (
              <>
                <MaterialIcons
                  name={focusYmd === logicalTodayYmd ? 'spa' : 'undo'}
                  size={14}
                  color={tf.ink2}
                />
                <Text style={{ fontSize: 12, fontWeight: '700', color: tf.ink2 }}>
                  {focusYmd === logicalTodayYmd ? '今日打卡记录' : '撤销补卡'}
                </Text>
              </>
            )}
          </Pressable>
          <Pressable
            onPress={() => void handleMakeUpCheckIn()}
            disabled={makeUpSaving || focusYmd >= logicalTodayYmd || buildSucceeded}
            style={({ pressed }) => [
              styles.ghostBtn,
              {
                borderColor: tf.line2,
                backgroundColor: isDark ? 'rgba(255,252,245,0.06)' : 'rgba(255,252,245,0.7)',
                opacity:
                  makeUpSaving || focusYmd >= logicalTodayYmd || buildSucceeded
                    ? 0.45
                    : pressed
                      ? 0.75
                      : 1,
              },
            ]}>
            {makeUpSaving ? (
              <ActivityIndicator size="small" color={tf.frog} />
            ) : (
              <>
                <MaterialIcons name="event-available" size={14} color={tf.ink2} />
                <Text style={{ fontSize: 12, fontWeight: '700', color: tf.ink2 }}>补卡</Text>
              </>
            )}
          </Pressable>
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
                if (Platform.OS !== 'ios') setDatePickerOpen(false);
              }}
            />
            {Platform.OS === 'ios' ? (
              <Pressable style={[styles.pickerOk, { backgroundColor: BLUE }]} onPress={() => setDatePickerOpen(false)}>
                <Text style={styles.pickerOkText}>完成</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG },
  scrollFlex: { flex: 1 },
  appbar: {
    minHeight: 48,
    paddingHorizontal: 14,
    paddingBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  iconbtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  appbarCenter: { flex: 1, minWidth: 0 },
  appbarTitle: { fontSize: 15, fontWeight: '700' },
  appbarSub: { fontSize: 10, marginTop: 2 },
  pillbtn: {
    height: 28,
    paddingHorizontal: 10,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  scrollContent: { paddingHorizontal: 14, gap: 10, paddingTop: 4 },
  hhero: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 12,
    overflow: 'hidden',
  },
  hhtop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  bigicon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bigiconEmoji: { fontSize: 24 },
  hhc: { flex: 1, minWidth: 0 },
  heroName: { fontSize: 22, fontWeight: '600' },
  heroMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4, flexWrap: 'wrap' },
  todayTag: {
    height: 18,
    paddingHorizontal: 7,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  streakbig: { alignItems: 'flex-end' },
  streakNumRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  streakNum: { fontSize: 24, fontWeight: '700', lineHeight: 28 },
  hhstats: { flexDirection: 'row', gap: 6, marginTop: 12 },
  hhstat: { flex: 1, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 6 },
  hhstatNum: { fontSize: 13, fontWeight: '700' },
  hhstatLabel: { fontSize: 10, marginTop: 2 },
  card: {
    backgroundColor: CARD,
    borderRadius: 12,
    padding: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: CARD_BORDER,
  },
  extraCard: { paddingHorizontal: 12, paddingVertical: 10 },
  extraCardTight: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 6 },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: TEXT_MAIN },
  makeUpSub: { fontSize: 11, color: TEXT_MUTED, lineHeight: 16, marginTop: 4 },
  hmhead2: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  legendInline: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 3 },
  legendSq: { width: 10, height: 10, borderRadius: 2 },
  monthNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, marginBottom: 8 },
  monthTitle: { fontSize: 13, fontWeight: '600', color: TEXT_MAIN },
  weekdayRow: { flexDirection: 'row', marginBottom: 4 },
  weekdayCell: { flex: 1, textAlign: 'center', fontSize: 11 },
  calGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  calCell: {
    width: '14.2857%',
    paddingVertical: 2,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 34,
  },
  calCellPress: { width: '100%', alignItems: 'center', justifyContent: 'center' },
  calDayInner: {
    width: '88%',
    aspectRatio: 1,
    maxWidth: 34,
    borderRadius: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  calDayToday: {
    borderWidth: 1.5,
    borderColor: SUN_RING,
  },
  calDaySelected: {
    borderWidth: 1.5,
    borderColor: BLUE,
  },
  calDayText: { fontSize: 11, color: '#374151' },
  heatFoot: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 8 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  sparkHead: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  spark: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 3,
    height: 44,
    paddingTop: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(226,218,203,0.6)',
  },
  sparkCol: { flex: 1, height: '100%', justifyContent: 'flex-end' },
  sparkBar: { width: '100%', borderTopLeftRadius: 3, borderTopRightRadius: 3, minHeight: 3 },
  sparkX: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  goalHead: { flexDirection: 'row', alignItems: 'center', marginBottom: 6, gap: 4 },
  pcprog: { height: 5, borderRadius: 3, overflow: 'hidden' },
  pcprogFill: {
    height: '100%',
    borderRadius: 3,
    backgroundColor: '#6F9565',
  },
  miniStat3: { flexDirection: 'row', gap: 6, marginTop: 8 },
  miniStatCell: { flex: 1, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 6 },
  miniStatNum: { fontSize: 14, fontWeight: '700' },
  miniStatLabel: { fontSize: 10, marginTop: 2 },
  histrow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 7,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(232,224,210,0.55)',
  },
  histIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: '#E7EEE0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  histTitle: { fontSize: 13, fontWeight: '600' },
  histMeta: { fontSize: 11, marginTop: 2 },
  histPts: { fontSize: 12, fontWeight: '700', minWidth: 28, textAlign: 'right' },
  linkedCard: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  frogmark: {
    width: 28,
    height: 28,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hnote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: 2,
  },
  ghostBtnRow: { flexDirection: 'row', gap: 8, marginTop: 2 },
  ghostBtn: {
    flex: 1,
    minHeight: 40,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingHorizontal: 8,
  },
  centerMsg: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  muted: { color: TEXT_MUTED, fontSize: 14 },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  modalBackdrop: {
    ...StyleSheet.absoluteFill,
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
