/**
 * 任务日历 — 对齐设计稿 shot 09 / motion 09
 * 换月横移 · 点日展开 · 圆点语义色（蛙/办/习/项）
 */
import {
  FoldCountUpText,
  FoldRiseIn,
  useFoldMotionGate,
} from '@/components/review/fold-motion';
import { ScreenHeader, ScreenHeaderIconAction } from '@/components/ui';
import { Layout, Spacing } from '@/constants/design-tokens';
import { TaskFoldMotion, useTaskFoldTheme } from '@/constants/task-fold-theme';
import { usePageDayBoundary } from '@/contexts/day-boundary-context';
import { useAppTheme } from '@/hooks/use-app-theme';
import { usePageApiSync } from '@/hooks/use-page-api-sync';
import { useTasksCalendarSummaries } from '@/hooks/use-tasks-calendar-summaries';
import { formatYmd } from '@/lib/date';
import { openTaskById } from '@/lib/open-task-by-id';
import { isHabitDayGoalMet } from '@/lib/repositories/habits/habit-goal';
import {
  emptyCalendarDay,
  type FrogCalendarDayStatus,
  type TasksCalendarDaySummary,
  type TasksCalendarGridDay,
  type TasksCalendarHabitItem,
  type TasksCalendarProjectItem,
  type TasksCalendarTaskItem,
} from '@/lib/tasks-calendar-data';
import { refreshYmdFocusAfterLogicalDayChange } from '@/lib/tasks-logical-day';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import {
  ActivityIndicator,
  Animated,
  FlatList,
  PixelRatio,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const WEEK_TITLES = ['一', '二', '三', '四', '五', '六', '日'] as const;
const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const;
const GRID_GAP = 2;
const MONTH_PAGE_SPAN = 121;
const MONTH_PAGE_CENTER_INDEX = Math.floor(MONTH_PAGE_SPAN / 2);
const PAGE_RISE_MS = 520;
const PAGE_STAGGER_MS = 42;

const DOT = {
  frog: '#4F7C51',
  todo: '#D6974B',
  habit: '#A8BE8C',
  project: '#C47055',
} as const;

function roundCalendarWidth(width: number): number {
  return PixelRatio.roundToNearestPixel(width);
}

function monthStart(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function addMonths(d: Date, delta: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + delta, 1);
}

function buildGridCellsForMonth(monthDate: Date) {
  const first = monthStart(monthDate);
  const mondayOffset = (first.getDay() + 6) % 7;
  const gridStart = new Date(first);
  gridStart.setDate(first.getDate() - mondayOffset);
  return Array.from({ length: 42 }).map((_, idx) => {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + idx);
    const ymd = formatYmd(d);
    return {
      key: ymd,
      date: d,
      ymd,
      inCurrentMonth: d.getMonth() === monthDate.getMonth(),
    };
  });
}

function chunkWeeks<T>(cells: T[]): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < cells.length; i += 7) {
    rows.push(cells.slice(i, i + 7));
  }
  return rows;
}

function formatTopDate(d: Date) {
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

function formatWeekday(d: Date) {
  return WEEKDAY_LABELS[d.getDay()];
}

function formatTaskStatus(status: string) {
  if (status === 'doing') return '进行中';
  if (status === 'done') return '已完成';
  if (status === 'blocked') return '受阻';
  if (status === 'cancelled') return '已取消';
  if (status === 'shelved') return '暂时搁置';
  return '待办';
}

function formatPriority(p: number) {
  if (p >= 4) return '紧急重要';
  if (p === 3) return '紧急不重要';
  if (p === 2) return '不紧急重要';
  if (p === 1) return '不紧急不重要';
  return '';
}

function formatFrogDayStatus(status: FrogCalendarDayStatus | undefined) {
  if (status === 'completed' || status === 'partial') return '已完成';
  if (status === 'incomplete') return '未完成';
  return null;
}

function daySummaryCounts(summary: TasksCalendarDaySummary | undefined) {
  if (!summary) return { frogs: 0, todos: 0, habits: 0, projects: 0, total: 0 };
  const todos = summary.standaloneTodos.length;
  const frogs = summary.frogs.length;
  const habits = summary.habits.length;
  const projects = summary.projectsDue.length;
  return { frogs, todos, habits, projects, total: frogs + todos + habits + projects };
}

type GridCell = ReturnType<typeof buildGridCellsForMonth>[number];

function MonthDayCell({
  cell,
  cellGrid,
  selected,
  isToday,
  onSelect,
  fonts,
  tf,
}: {
  cell: GridCell;
  cellGrid: TasksCalendarGridDay | undefined;
  selected: boolean;
  isToday: boolean;
  onSelect: (d: Date) => void;
  fonts: ReturnType<typeof useTaskFoldTheme>['fonts'];
  tf: ReturnType<typeof useTaskFoldTheme>['tf'];
}) {
  const frogN = cellGrid?.frogs ?? 0;
  const habitN = cellGrid?.habits ?? 0;
  const openN = cellGrid?.openTodos ?? 0;
  const projN = cellGrid?.projectsDue ?? 0;
  const inMonth = cell.inCurrentMonth;

  let bg = 'transparent';
  let color = inMonth ? '#5C6A5F' : '#D2D6CC';
  if (selected && inMonth) {
    bg = tf.pond;
    color = tf.onPond;
  } else if (isToday && inMonth) {
    bg = 'rgba(201,217,163,0.32)';
    color = '#36563C';
  }

  const showDots = inMonth && (frogN > 0 || openN > 0 || habitN > 0 || projN > 0);
  const dotColor = selected ? '#C9D9A3' : undefined;

  return (
    <Pressable
      onPress={() => onSelect(cell.date)}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${cell.ymd}，青蛙 ${frogN}，待办 ${openN}，习惯 ${habitN}，项目 ${projN}`}
      style={({ pressed }) => [
        styles.mcell,
        {
          backgroundColor: bg,
          opacity: pressed ? 0.88 : 1,
          shadowColor: selected ? tf.shadow : 'transparent',
          shadowOpacity: selected ? 0.18 : 0,
          shadowRadius: selected ? 6 : 0,
          shadowOffset: { width: 0, height: 3 },
          elevation: selected ? 3 : 0,
        },
      ]}>
      <Text
        style={[
          styles.mcellNum,
          {
            color,
            fontFamily: fonts.mono,
            fontWeight: selected || isToday ? '800' : '600',
          },
        ]}>
        {cell.date.getDate()}
      </Text>
      {showDots ? (
        <View style={styles.dots}>
          {frogN > 0 ? <View style={[styles.dot, { backgroundColor: dotColor ?? DOT.frog }]} /> : null}
          {openN > 0 ? <View style={[styles.dot, { backgroundColor: dotColor ?? DOT.todo }]} /> : null}
          {habitN > 0 ? <View style={[styles.dot, { backgroundColor: dotColor ?? DOT.habit }]} /> : null}
          {projN > 0 ? <View style={[styles.dot, { backgroundColor: dotColor ?? DOT.project }]} /> : null}
        </View>
      ) : (
        <View style={styles.dotsPlaceholder} />
      )}
      {isToday && !selected ? <Text style={[styles.fire, { color: tf.sun }]}>●</Text> : null}
    </Pressable>
  );
}

const TasksCalendarMonthPage = React.memo(function TasksCalendarMonthPage({
  offset,
  todayMonthStart,
  logicalTodayYmd,
  pageWidth,
  selectedYmd,
  onSelectDate,
  grid,
  loading,
}: {
  offset: number;
  todayMonthStart: Date;
  logicalTodayYmd: string;
  pageWidth: number;
  selectedYmd: string;
  onSelectDate: (d: Date) => void;
  grid: Map<string, TasksCalendarGridDay> | undefined;
  loading: boolean;
}) {
  const { tf, fonts } = useTaskFoldTheme();
  const monthDate = React.useMemo(() => addMonths(todayMonthStart, offset), [offset, todayMonthStart]);
  const gridCells = React.useMemo(() => buildGridCellsForMonth(monthDate), [monthDate]);
  const gridWeeks = React.useMemo(() => chunkWeeks(gridCells), [gridCells]);

  if ((loading && !grid) || pageWidth <= 0) {
    return (
      <View style={{ width: pageWidth, minHeight: 220, justifyContent: 'center' }}>
        <ActivityIndicator color={tf.frog} />
      </View>
    );
  }

  return (
    <View style={{ width: pageWidth, paddingHorizontal: 2 }}>
      <View style={styles.weeklabel}>
        {WEEK_TITLES.map((w, i) => (
          <Text
            key={w}
            style={[
              styles.weeklabelText,
              { color: i === 5 || i === 6 ? '#BD8F78' : '#9CA69D' },
            ]}>
            {w}
          </Text>
        ))}
      </View>
      <View style={[styles.monthgrid, { borderColor: 'rgba(216,205,187,0.72)', backgroundColor: 'rgba(255,252,245,0.55)' }]}>
        {gridWeeks.map((week, wi) => (
          <View key={`week-${offset}-${wi}`} style={styles.weekRow}>
            {week.map((cell) => (
              <View key={cell.key} style={styles.mcellSlot}>
                <MonthDayCell
                  cell={cell}
                  cellGrid={grid?.get(cell.ymd)}
                  selected={cell.ymd === selectedYmd}
                  isToday={cell.ymd === logicalTodayYmd}
                  onSelect={onSelectDate}
                  fonts={fonts}
                  tf={tf}
                />
              </View>
            ))}
          </View>
        ))}
      </View>
    </View>
  );
});

function DdRow({
  icon,
  iconBg,
  title,
  meta,
  when,
  onPress,
  ink2,
  faint,
}: {
  icon: React.ReactNode;
  iconBg: string;
  title: string;
  meta: string;
  when: string;
  onPress: () => void;
  ink2: string;
  faint: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.ddrow, pressed && { opacity: 0.85 }]}>
      <View style={[styles.di2, { backgroundColor: iconBg }]}>{icon}</View>
      <View style={styles.dt}>
        <Text style={[styles.dtTitle, { color: ink2 }]} numberOfLines={1}>
          {title}
        </Text>
        <Text style={[styles.dtMeta, { color: faint }]} numberOfLines={1}>
          {meta}
        </Text>
      </View>
      <Text style={[styles.when, { color: '#859385' }]}>{when}</Text>
    </Pressable>
  );
}

function DayDetailBody({
  summary,
  selectedDate,
  logicalTodayYmd,
  riseAnimate,
  riseDuration,
  riseStagger,
  riseFromY,
}: {
  summary: TasksCalendarDaySummary;
  selectedDate: Date;
  logicalTodayYmd: string;
  riseAnimate: boolean;
  riseDuration: number;
  riseStagger: number;
  riseFromY: number;
}) {
  const { tf, fonts } = useTaskFoldTheme();
  const router = useRouter();
  const counts = daySummaryCounts(summary);
  const hasAny = counts.total > 0;
  const selectedYmd = formatYmd(selectedDate);
  const isToday = selectedYmd === logicalTodayYmd;
  let riseIndex = 0;

  const openTask = (id: string) => {
    void openTaskById(router, id);
  };
  const openHabit = (id: string) =>
    router.push({ pathname: '/habit-detail', params: { habitId: id } });
  const openProject = (id: string) =>
    router.push({ pathname: '/edit-project', params: { id } });

  const habitMeta = (h: TasksCalendarHabitItem) => {
    const goal = h.dailyGoal;
    const isTask = h.kind === 'task';
    const met = isTask
      ? !!h.taskShowPeriodCheck
      : isHabitDayGoalMet({
          kind: h.kind,
          todayCount: h.todayCount,
          dailyGoal: goal,
          hasDayRecord: h.kind === 'break' ? h.hasDayRecord : undefined,
          ymd: summary.ymd,
          logicalTodayYmd,
        });
    if (isTask && h.periodGoal != null) return `习惯 · 本周期 ${h.periodProgress ?? 0} / ${h.periodGoal}`;
    if (h.kind === 'break') return `习惯 · ${met ? '达标' : '未达标'} · 记录 ${h.todayCount}`;
    return `习惯 · 打卡 ${h.todayCount}${goal != null ? ` / ${goal}` : ''}${met ? ' · 已完成' : ''}`;
  };

  const frogWhen = (t: TasksCalendarTaskItem) => {
    const s = formatFrogDayStatus(t.frogDayStatus);
    if (s) return s;
    if (t.status === 'doing') return '进行中';
    return formatTaskStatus(t.status);
  };

  const frogMeta = (t: TasksCalendarTaskItem) => {
    const bits = ['青蛙'];
    const st = formatFrogDayStatus(t.frogDayStatus) ?? formatTaskStatus(t.status);
    bits.push(st);
    const pri = formatPriority(t.priority);
    if (pri) bits.push(pri);
    return bits.join(' · ');
  };

  const todoMeta = (t: TasksCalendarTaskItem) => {
    const bits = ['独立待办'];
    const reason = t.todoDayReason;
    if (reason === 'completed' || reason === 'completed-and-due') bits.push('已完成');
    else bits.push(formatTaskStatus(t.status));
    const pri = formatPriority(t.priority);
    if (pri) bits.push(pri);
    return bits.join(' · ');
  };

  return (
    <View>
      <View style={styles.ddhead}>
        <Text style={[styles.ddheadTitle, { color: tf.pond, fontFamily: fonts.serif }]}>
          {formatTopDate(selectedDate)}
        </Text>
        <Text style={[styles.ddheadSub, { color: tf.faint }]}>
          {formatWeekday(selectedDate)} · {isToday ? '今日' : selectedYmd < logicalTodayYmd ? '已过' : '未来'}
        </Text>
        {hasAny ? (
          <View style={styles.chips}>
            {counts.frogs > 0 ? (
              <Text style={[styles.chip, { backgroundColor: '#EDF1E5', color: '#5F765B' }]}>
                青蛙 {counts.frogs}
              </Text>
            ) : null}
            {counts.todos > 0 ? (
              <Text style={[styles.chip, { backgroundColor: '#EDF1E5', color: '#5F765B' }]}>
                待办 {counts.todos}
              </Text>
            ) : null}
            {counts.habits > 0 ? (
              <Text style={[styles.chip, { backgroundColor: '#EDF1E5', color: '#5F765B' }]}>
                习惯 {counts.habits}
              </Text>
            ) : null}
            {counts.projects > 0 ? (
              <Text style={[styles.chip, { backgroundColor: '#EDF1E5', color: '#5F765B' }]}>
                项目 {counts.projects}
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>

      {!hasAny ? (
        <FoldRiseIn
          animate={riseAnimate}
          index={riseIndex++}
          duration={riseDuration}
          staggerMs={riseStagger}
          fromY={riseFromY}
          holdHidden={riseAnimate}>
          <View style={styles.empty}>
            <View style={[styles.emptyIcon, { backgroundColor: '#EDF1E5' }]}>
              <MaterialIcons name="event-available" size={20} color="#8FA487" />
            </View>
            <Text style={[styles.emptyTitle, { color: '#7C8C7E' }]}>这一天很清静</Text>
            <Text style={[styles.emptySub, { color: tf.faint }]}>没有青蛙、待办、习惯或项目截止</Text>
          </View>
        </FoldRiseIn>
      ) : (
        <>
          {summary.frogs.map((t) => (
            <FoldRiseIn
              key={`f-${t.id}`}
              animate={riseAnimate}
              index={riseIndex++}
              duration={riseDuration}
              staggerMs={riseStagger}
              fromY={riseFromY}
              holdHidden={riseAnimate}>
              <DdRow
                icon={<MaterialIcons name="spa" size={14} color="#4F7450" />}
                iconBg="#E7EEE0"
                title={t.title}
                meta={frogMeta(t)}
                when={frogWhen(t)}
                onPress={() => openTask(t.id)}
                ink2={tf.ink2}
                faint={tf.faint}
              />
            </FoldRiseIn>
          ))}
          {summary.standaloneTodos.map((t) => {
            const done =
              t.todoDayReason === 'completed' || t.todoDayReason === 'completed-and-due';
            return (
              <FoldRiseIn
                key={`t-${t.id}`}
                animate={riseAnimate}
                index={riseIndex++}
                duration={riseDuration}
                staggerMs={riseStagger}
                fromY={riseFromY}
                holdHidden={riseAnimate}>
                <DdRow
                  icon={<MaterialIcons name="check" size={14} color="#9B6B2C" />}
                  iconBg="#F7E9D5"
                  title={t.title}
                  meta={todoMeta(t)}
                  when={done ? '完成' : '待办'}
                  onPress={() => openTask(t.id)}
                  ink2={tf.ink2}
                  faint={tf.faint}
                />
              </FoldRiseIn>
            );
          })}
          {summary.habits.map((h) => (
            <FoldRiseIn
              key={`h-${h.id}`}
              animate={riseAnimate}
              index={riseIndex++}
              duration={riseDuration}
              staggerMs={riseStagger}
              fromY={riseFromY}
              holdHidden={riseAnimate}>
              <DdRow
                icon={<Text style={{ fontSize: 12 }}>{h.icon || '✓'}</Text>}
                iconBg="#E8EFD9"
                title={h.name}
                meta={habitMeta(h)}
                when={h.kind === 'break' ? '戒除' : h.kind === 'task' ? '任务' : '习惯'}
                onPress={() => openHabit(h.id)}
                ink2={tf.ink2}
                faint={tf.faint}
              />
            </FoldRiseIn>
          ))}
          {summary.projectsDue.map((p: TasksCalendarProjectItem) => (
            <FoldRiseIn
              key={`p-${p.id}`}
              animate={riseAnimate}
              index={riseIndex++}
              duration={riseDuration}
              staggerMs={riseStagger}
              fromY={riseFromY}
              holdHidden={riseAnimate}>
              <DdRow
                icon={<MaterialIcons name="folder" size={14} color="#A25A62" />}
                iconBg="#F4E7EA"
                title={p.name}
                meta={`项目 · ${p.status === 'done' ? '已完成' : '进行中'}`}
                when="项目"
                onPress={() => openProject(p.id)}
                ink2={tf.ink2}
                faint={tf.faint}
              />
            </FoldRiseIn>
          ))}
        </>
      )}
    </View>
  );
}

const PAGE_API_KEY = 'tasks-calendar';

export default function TasksCalendarScreen() {
  const { wrapLoad } = usePageApiSync(PAGE_API_KEY);
  const router = useRouter();
  const { colors, isDark } = useAppTheme();
  const { tf, fonts } = useTaskFoldTheme();
  const { animate, ready: motionReady } = useFoldMotionGate();
  const { logicalTodayYmd, logicalTodayDate, boundary } = usePageDayBoundary('tasks');

  const today = React.useMemo(() => {
    if (logicalTodayDate && !Number.isNaN(logicalTodayDate.getTime())) return logicalTodayDate;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(logicalTodayYmd);
    if (!m) return new Date();
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }, [logicalTodayDate, logicalTodayYmd]);

  const todayMonthStart = React.useMemo(() => monthStart(today), [today]);
  const [monthOffset, setMonthOffset] = React.useState(0);
  const [visibleMonthOffset, setVisibleMonthOffset] = React.useState(0);
  /** null = 跟随逻辑今日，保证首屏默认选中当日 */
  const [selectedYmdOverride, setSelectedYmdOverride] = React.useState<string | null>(null);
  const selectedYmd = selectedYmdOverride ?? (logicalTodayYmd || formatYmd(today));
  const selectedDate = React.useMemo(() => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(selectedYmd);
    if (!m) return today;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }, [selectedYmd, today]);

  const prevLogicalTodayYmdRef = React.useRef(logicalTodayYmd);
  React.useEffect(() => {
    const prev = prevLogicalTodayYmdRef.current;
    if (prev === logicalTodayYmd) return;
    prevLogicalTodayYmdRef.current = logicalTodayYmd;
    setSelectedYmdOverride((override) => {
      if (override == null) return null;
      const next = refreshYmdFocusAfterLogicalDayChange(override, logicalTodayYmd, prev);
      return next === logicalTodayYmd ? null : next;
    });
    setMonthOffset(0);
    setVisibleMonthOffset(0);
  }, [logicalTodayYmd]);

  const { monthGrid, selectedSummary, detailLoading, cacheVersion, getMonthPageData, refreshControl } =
    useTasksCalendarSummaries({
      pageKey: PAGE_API_KEY,
      monthOffset,
      todayMonthStart,
      selectedYmd,
      boundary,
      wrapLoad,
    });

  const pagerRef = React.useRef<FlatList<number>>(null);
  const pagerCurrentIndexRef = React.useRef(MONTH_PAGE_CENTER_INDEX);
  /** 测量完成且已滚到当月中心后，才允许滚动回调改 monthOffset */
  const pagerSettledRef = React.useRef(false);
  const calendarWidthRef = React.useRef(0);
  const pagerData = React.useMemo(
    () => Array.from({ length: MONTH_PAGE_SPAN }, (_, i) => i - MONTH_PAGE_CENTER_INDEX),
    [],
  );

  /** 先测容器宽，再挂 FlatList，避免 initialScrollIndex 用错宽度滚到别的月 */
  const [calendarWidth, setCalendarWidth] = React.useState(0);
  const [pagerMountKey, setPagerMountKey] = React.useState(0);
  const pagerExtraData = React.useMemo(
    () => `${calendarWidth}:${cacheVersion}:${selectedYmd}:${monthOffset}`,
    [calendarWidth, cacheVersion, selectedYmd, monthOffset],
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

  const visibleMonth = React.useMemo(
    () => addMonths(todayMonthStart, monthOffset),
    [todayMonthStart, monthOffset],
  );
  const headerMonth = React.useMemo(
    () => addMonths(todayMonthStart, visibleMonthOffset),
    [todayMonthStart, visibleMonthOffset],
  );

  /** 换月标题淡出 120ms */
  const monthTitleOpacity = React.useRef(new Animated.Value(1)).current;
  const lastHeaderKey = React.useRef(`${headerMonth.getFullYear()}-${headerMonth.getMonth()}`);
  React.useEffect(() => {
    const key = `${headerMonth.getFullYear()}-${headerMonth.getMonth()}`;
    if (key === lastHeaderKey.current) return;
    lastHeaderKey.current = key;
    if (!animate) {
      monthTitleOpacity.setValue(1);
      return;
    }
    monthTitleOpacity.setValue(0);
    Animated.timing(monthTitleOpacity, {
      toValue: 1,
      duration: TaskFoldMotion.calMonthFade,
      useNativeDriver: true,
    }).start();
  }, [animate, headerMonth, monthTitleOpacity]);

  /** 按钮换月：同步标题预览并滚到对应页（滑动回调已同步 index 时跳过，避免打架） */
  React.useEffect(() => {
    setVisibleMonthOffset(monthOffset);
    if (!pagerSettledRef.current || calendarWidth <= 0) return;
    const expectedIndex = monthOffset + MONTH_PAGE_CENTER_INDEX;
    if (expectedIndex === pagerCurrentIndexRef.current) return;
    scrollPagerToMonthOffset(monthOffset, true);
  }, [calendarWidth, monthOffset, scrollPagerToMonthOffset]);

  const goPrevMonth = React.useCallback(() => setMonthOffset((p) => p - 1), []);
  const goNextMonth = React.useCallback(() => setMonthOffset((p) => p + 1), []);
  const goToday = React.useCallback(() => {
    setMonthOffset(0);
    setVisibleMonthOffset(0);
    setSelectedYmdOverride(logicalTodayYmd || formatYmd(today));
    if (pagerSettledRef.current) {
      scrollPagerToMonthOffset(0, true);
    }
  }, [logicalTodayYmd, scrollPagerToMonthOffset, today]);

  const onPagerContainerLayout = React.useCallback((e: { nativeEvent: { layout: { width: number } } }) => {
    const width = roundCalendarWidth(e.nativeEvent.layout.width);
    if (width <= 0) return;
    const prev = calendarWidthRef.current;
    if (Math.abs(prev - width) < 0.5) return;
    pagerSettledRef.current = false;
    calendarWidthRef.current = width;
    setCalendarWidth(width);
    setPagerMountKey((k) => k + 1);
    setMonthOffset(0);
    setVisibleMonthOffset(0);
  }, []);

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

  const monthStats = React.useMemo(() => {
    let frogDone = 0;
    let todoDays = 0;
    let habitDone = 0;
    let habitDue = 0;
    const y = visibleMonth.getFullYear();
    const m = visibleMonth.getMonth();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const dayScores: number[] = [];
    let peakScore = 0;
    for (let day = 1; day <= daysInMonth; day += 1) {
      const ymd = formatYmd(new Date(y, m, day));
      const cell = monthGrid.get(ymd);
      const score = cell
        ? cell.frogs + cell.openTodos + cell.habits + cell.projectsDue + (cell.frogDone ? 1 : 0)
        : 0;
      dayScores.push(score);
      if (score > peakScore) peakScore = score;
      if (!cell) continue;
      if (cell.frogDone) frogDone += 1;
      if (cell.openTodos > 0 || cell.dueCount > 0) todoDays += 1;
      if (cell.habits > 0) {
        habitDue += 1;
        if (cell.habitChecked) habitDone += 1;
      }
    }
    const habitRate = habitDue > 0 ? Math.round((habitDone / habitDue) * 100) : 0;
    const bars = dayScores.map((score) => {
      if (score <= 0) return { heightPct: 12, kind: 'dim' as const };
      const pct = peakScore > 0 ? Math.max(18, Math.round((score / peakScore) * 100)) : 18;
      return {
        heightPct: pct,
        kind: (score === peakScore && peakScore > 0 ? 'hot' : 'normal') as 'hot' | 'normal' | 'dim',
      };
    });
    return { frogDone, todoDays, habitRate, daysInMonth, bars };
  }, [visibleMonth, monthGrid]);

  /** 点日展开：明细高度 / 透明度 */
  const detailH = React.useRef(new Animated.Value(1)).current;
  const [detailEntranceKey, setDetailEntranceKey] = React.useState(0);
  const selectDate = React.useCallback(
    (d: Date) => {
      const ymd = formatYmd(d);
      if (ymd === selectedYmd) return;
      setSelectedYmdOverride(ymd);
      setDetailEntranceKey((k) => k + 1);
      if (!animate) {
        detailH.setValue(1);
        return;
      }
      detailH.setValue(0);
      Animated.timing(detailH, {
        toValue: 1,
        duration: TaskFoldMotion.calDetailExpand,
        useNativeDriver: true,
      }).start();
    },
    [animate, detailH, selectedYmd],
  );

  const enterReady = motionReady && !detailLoading;
  const fullMotion = animate;
  const riseDuration = fullMotion ? PAGE_RISE_MS : 120;
  const riseFromY = fullMotion ? 10 : 0;
  const riseStagger = fullMotion ? PAGE_STAGGER_MS : 0;
  const pageEnterAnimate = enterReady;

  const summary = selectedSummary ?? emptyCalendarDay(selectedYmd);
  const headerSub = `按逻辑日归档 · ${today.getMonth() + 1}月${today.getDate()}日 ${formatWeekday(today)}`;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: tf.paper }]} edges={['left', 'right']}>
      <ScreenHeader
        title="任务日历"
        subtitle={headerSub}
        onBack={() => router.back()}
        right={
          <ScreenHeaderIconAction
            icon="my-location"
            accessibilityLabel="回到今天"
            onPress={goToday}
          />
        }
        style={{ backgroundColor: isDark ? colors.headerScrim : tf.paper, borderBottomColor: tf.line }}
      />

      <ScrollView
        refreshControl={refreshControl}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        nestedScrollEnabled>
        <FoldRiseIn
          animate={pageEnterAnimate}
          index={0}
          fromY={riseFromY}
          duration={riseDuration}
          staggerMs={riseStagger}
          holdHidden={pageEnterAnimate}>
          <View
            style={[
              styles.card,
              {
                backgroundColor: isDark ? colors.surfaceMuted : 'rgba(255,252,245,0.92)',
                borderColor: tf.line2,
              },
            ]}>
            <View style={styles.calhead}>
              <Animated.View style={{ opacity: monthTitleOpacity, flexDirection: 'row', alignItems: 'baseline', gap: 7 }}>
                <Text style={[styles.calMonth, { color: tf.pond, fontFamily: fonts.serif }]}>
                  {headerMonth.getMonth() + 1}月
                </Text>
                <Text style={[styles.calYear, { color: tf.faint, fontFamily: fonts.mono }]}>
                  {headerMonth.getFullYear()}
                </Text>
              </Animated.View>
              <View style={styles.calNav}>
                <Pressable
                  onPress={goPrevMonth}
                  accessibilityLabel="上一月"
                  style={({ pressed }) => [styles.navBtn, { backgroundColor: '#F1EDE1', opacity: pressed ? 0.75 : 1 }]}>
                  <MaterialIcons name="chevron-left" size={18} color="#77857A" />
                </Pressable>
                <Pressable
                  onPress={goNextMonth}
                  accessibilityLabel="下一月"
                  style={({ pressed }) => [styles.navBtn, { backgroundColor: '#F1EDE1', opacity: pressed ? 0.75 : 1 }]}>
                  <MaterialIcons name="chevron-right" size={18} color="#77857A" />
                </Pressable>
              </View>
            </View>

            <View style={styles.pagerClip} onLayout={onPagerContainerLayout}>
              {calendarWidth > 0 ? (
                <FlatList
                  key={`tasks-cal-pager-${pagerMountKey}-${calendarWidth}`}
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
                  showsHorizontalScrollIndicator={false}
                  keyExtractor={(offset) => `tasks-cal-month-${offset}`}
                  initialScrollIndex={MONTH_PAGE_CENTER_INDEX}
                  contentOffset={{ x: MONTH_PAGE_CENTER_INDEX * calendarWidth, y: 0 }}
                  extraData={pagerExtraData}
                  style={{ width: calendarWidth }}
                  onLayout={onPagerListLoad}
                  getItemLayout={(_, index) => ({
                    length: calendarWidth,
                    offset: calendarWidth * index,
                    index,
                  })}
                  windowSize={5}
                  maxToRenderPerBatch={3}
                  initialNumToRender={3}
                  updateCellsBatchingPeriod={16}
                  removeClippedSubviews={false}
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
                  renderItem={({ item: offset }) => {
                    const { grid: monthGridPage, loading: monthLoading } = getMonthPageData(offset);
                    return (
                      <TasksCalendarMonthPage
                        key={`tasks-cal-page-${offset}`}
                        offset={offset}
                        todayMonthStart={todayMonthStart}
                        logicalTodayYmd={logicalTodayYmd || formatYmd(today)}
                        pageWidth={calendarWidth}
                        selectedYmd={selectedYmd}
                        onSelectDate={selectDate}
                        grid={monthGridPage}
                        loading={monthLoading}
                      />
                    );
                  }}
                />
              ) : (
                <View style={{ minHeight: 160, alignItems: 'center', justifyContent: 'center' }}>
                  <ActivityIndicator color={tf.frog} />
                </View>
              )}
            </View>

            <View style={styles.callegend}>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: DOT.frog }]} />
                <Text style={styles.legendText}>青蛙</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: DOT.todo }]} />
                <Text style={styles.legendText}>待办</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: DOT.habit }]} />
                <Text style={styles.legendText}>习惯</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: DOT.project }]} />
                <Text style={styles.legendText}>项目</Text>
              </View>
              <Text style={[styles.legendHint, { marginLeft: 'auto' }]}>横滑换月 →</Text>
            </View>
          </View>
        </FoldRiseIn>

        <FoldRiseIn
          animate={pageEnterAnimate}
          index={1}
          fromY={riseFromY}
          duration={riseDuration}
          staggerMs={riseStagger}
          holdHidden={pageEnterAnimate}>
          <View
            style={[
              styles.daydetail,
              {
                borderTopColor: 'rgba(216,205,187,0.62)',
                backgroundColor: isDark ? colors.surfaceMuted : 'rgba(255,252,245,0.72)',
                borderColor: tf.line2,
              },
            ]}>
            {detailLoading && !selectedSummary ? (
              <ActivityIndicator color={tf.frog} style={{ marginVertical: 24 }} />
            ) : (
              <Animated.View style={{ opacity: detailH }} key={`detail-${detailEntranceKey}`}>
                <DayDetailBody
                  summary={summary}
                  selectedDate={selectedDate}
                  logicalTodayYmd={logicalTodayYmd}
                  riseAnimate={fullMotion && detailEntranceKey > 0}
                  riseDuration={fullMotion ? 320 : 120}
                  riseStagger={fullMotion ? 36 : 0}
                  riseFromY={fullMotion ? 8 : 0}
                />
              </Animated.View>
            )}
          </View>
        </FoldRiseIn>

        <FoldRiseIn
          animate={pageEnterAnimate}
          index={2}
          fromY={riseFromY}
          duration={riseDuration}
          staggerMs={riseStagger}
          holdHidden={pageEnterAnimate}>
          <View
            style={[
              styles.card,
              styles.overviewCard,
              {
                backgroundColor: isDark ? colors.surfaceMuted : 'rgba(255,252,245,0.92)',
                borderColor: tf.line2,
              },
            ]}>
            <View style={styles.overviewHead}>
              <Text style={[styles.overviewTitle, { color: tf.ink2 }]}>本月概览</Text>
              <Text style={[styles.overviewSub, { color: tf.faint }]}>
                {visibleMonth.getMonth() + 1}月 · {monthStats.daysInMonth} 天
              </Text>
            </View>
            <View style={styles.miniStat3}>
              <View style={styles.miniStat}>
                <FoldCountUpText
                  value={monthStats.frogDone}
                  animate={pageEnterAnimate && fullMotion}
                  textStyle={[styles.miniStatVal, { color: tf.pond, fontFamily: fonts.mono }]}
                />
                <Text style={[styles.miniStatLbl, { color: tf.faint }]}>完成青蛙</Text>
              </View>
              <View style={styles.miniStat}>
                <FoldCountUpText
                  value={monthStats.todoDays}
                  animate={pageEnterAnimate && fullMotion}
                  textStyle={[styles.miniStatVal, { color: tf.pond, fontFamily: fonts.mono }]}
                />
                <Text style={[styles.miniStatLbl, { color: tf.faint }]}>有待办日</Text>
              </View>
              <View style={styles.miniStat}>
                <Text style={[styles.miniStatVal, { color: tf.pond, fontFamily: fonts.mono }]}>
                  {monthStats.habitRate}%
                </Text>
                <Text style={[styles.miniStatLbl, { color: tf.faint }]}>习惯达成</Text>
              </View>
            </View>
            <View style={styles.tinybars}>
              {monthStats.bars.map((bar, i) => (
                <View
                  key={`bar-${visibleMonth.getFullYear()}-${visibleMonth.getMonth()}-${i}`}
                  style={[
                    styles.tinybar,
                    {
                      height: Math.max(3, Math.round((28 * bar.heightPct) / 100)),
                      backgroundColor:
                        bar.kind === 'hot' ? tf.sun : bar.kind === 'dim' ? '#E6E1D4' : tf.lily,
                    },
                  ]}
                />
              ))}
            </View>
          </View>
        </FoldRiseIn>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: {
    paddingHorizontal: 13,
    paddingTop: 8,
    paddingBottom: Spacing['4xl'],
    gap: 8,
  },
  card: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 9,
    paddingTop: 8,
    paddingBottom: 6,
  },
  calhead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 3,
    paddingBottom: 8,
  },
  calMonth: { fontSize: 22, fontWeight: '600', letterSpacing: 0.3 },
  calYear: { fontSize: 11 },
  calNav: { marginLeft: 'auto', flexDirection: 'row', gap: 5 },
  navBtn: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pagerClip: { width: '100%', overflow: 'hidden' },
  weeklabel: {
    flexDirection: 'row',
    paddingHorizontal: 1,
    paddingBottom: 4,
  },
  weeklabelText: {
    flex: 1,
    textAlign: 'center',
    fontSize: 10,
    fontWeight: '650',
  },
  monthgrid: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 5,
    gap: GRID_GAP,
  },
  weekRow: { flexDirection: 'row', gap: 0 },
  mcellSlot: { flex: 1 },
  mcell: {
    height: 42,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    position: 'relative',
  },
  mcellNum: { fontSize: 13, lineHeight: 16 },
  dots: { flexDirection: 'row', gap: 1.5, height: 4, alignItems: 'center' },
  dotsPlaceholder: { height: 4 },
  dot: { width: 3.5, height: 3.5, borderRadius: 2 },
  fire: { position: 'absolute', right: 3, top: 2, fontSize: 7 },
  callegend: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 3,
    paddingTop: 8,
    paddingBottom: 4,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  legendDot: { width: 5, height: 5, borderRadius: 3 },
  legendText: { fontSize: 10, color: '#9CA59C' },
  legendHint: { fontSize: 10, color: '#9CA59C' },
  daydetail: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingTop: 10,
    paddingBottom: 6,
  },
  ddhead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
    paddingHorizontal: 2,
    paddingBottom: 6,
    flexWrap: 'wrap',
  },
  ddheadTitle: { fontSize: 17, fontWeight: '600' },
  ddheadSub: { fontSize: 11 },
  chips: { marginLeft: 'auto', flexDirection: 'row', gap: 3, flexWrap: 'wrap' },
  chip: {
    fontSize: 10,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: 'hidden',
    fontWeight: '700',
  },
  ddrow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 7,
    paddingHorizontal: 3,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(232,224,210,0.45)',
  },
  di2: {
    width: 26,
    height: 26,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dt: { flex: 1, minWidth: 0 },
  dtTitle: { fontSize: 13, fontWeight: '700' },
  dtMeta: { fontSize: 10, marginTop: 2 },
  when: { fontSize: 11, fontVariant: ['tabular-nums'] },
  empty: {
    alignItems: 'center',
    paddingVertical: 28,
    gap: 6,
  },
  emptyIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyTitle: { fontSize: 13, fontWeight: '700' },
  emptySub: { fontSize: 11 },
  overviewCard: { marginTop: 2, paddingBottom: 12 },
  overviewHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
  },
  overviewTitle: { fontSize: 13, fontWeight: '800' },
  overviewSub: { fontSize: 11 },
  miniStat3: { flexDirection: 'row' },
  miniStat: { flex: 1, alignItems: 'center', gap: 2 },
  miniStatVal: { fontSize: 22, fontWeight: '700' },
  miniStatLbl: { fontSize: 10 },
  tinybars: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
    height: 28,
    marginTop: 8,
  },
  tinybar: {
    flex: 1,
    minHeight: 3,
    borderTopLeftRadius: 2,
    borderTopRightRadius: 2,
  },
});
