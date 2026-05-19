import { AppIconButton } from '@/components/ui';
import { Layout, Radius, Spacing, Typography } from '@/constants/design-tokens';
import { useDayBoundary } from '@/contexts/day-boundary-context';
import { useAppTheme } from '@/hooks/use-app-theme';
import { getHabitCheckInCountsByDateRange } from '@/lib/repositories/habits/habit-check-in';
import { getHabits } from '@/lib/repositories/habits/habit';
import { getProjects } from '@/lib/repositories/projects/project';
import { getTasks } from '@/lib/repositories/tasks/task';
import {
  buildTasksCalendarSummaries,
  getTasksCalendarCellLevel,
  monthGridBounds,
  type TasksCalendarDaySummary,
  type TasksCalendarHabitItem,
  type TasksCalendarProjectItem,
  type TasksCalendarTaskItem,
} from '@/lib/tasks-calendar-data';
import type { TasksDayBoundary } from '@/lib/tasks-logical-day';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import React from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

const WEEK_TITLES = ['一', '二', '三', '四', '五', '六', '日'];
const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const;
const GRID_GAP = 5;
const MONTH_PAGE_SPAN = 121;
const MONTH_PAGE_CENTER_INDEX = Math.floor(MONTH_PAGE_SPAN / 2);

function formatYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
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

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function formatTopDate(d: Date) {
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

function formatTaskStatus(status: string) {
  if (status === 'doing') return '进行中';
  if (status === 'done') return '已完成';
  if (status === 'blocked') return '受阻';
  if (status === 'cancelled') return '已取消';
  return '待办';
}

function formatPriority(p: number) {
  if (p >= 4) return '紧急重要';
  if (p === 3) return '紧急不重要';
  if (p === 2) return '不紧急重要';
  if (p === 1) return '不紧急不重要';
  return '';
}

/** 低饱和热力色，贴近任务页青蛙热力图，避免刺眼纯蓝 */
const HEAT_LEVELS_LIGHT = ['#f4f5f8', '#e8ecef', '#d9e2e8', '#c5d4de', '#b0c4d4'] as const;
const HEAT_LEVELS_DARK = [
  'rgba(51,65,85,0.35)',
  'rgba(71,85,105,0.45)',
  'rgba(100,116,139,0.38)',
  'rgba(148,163,184,0.32)',
  'rgba(148,163,184,0.48)',
] as const;

function chunkWeeks<T>(cells: T[]): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < cells.length; i += 7) {
    rows.push(cells.slice(i, i + 7));
  }
  return rows;
}

function formatWeekday(d: Date) {
  return WEEKDAY_LABELS[d.getDay()];
}

function daySummaryCounts(summary: TasksCalendarDaySummary | undefined) {
  if (!summary) {
    return { frogs: 0, todos: 0, matrix: 0, habits: 0, projects: 0, total: 0 };
  }
  const todos = summary.standaloneTodos.length;
  const matrix = summary.matrixTasks.length;
  const frogs = summary.frogs.length;
  const habits = summary.habits.length;
  const projects = summary.projectsDue.length;
  return { frogs, todos, matrix, habits, projects, total: frogs + todos + matrix + habits + projects };
}

function TaskRowItem({
  item,
  onPress,
  text,
  muted,
  accent,
  rowBg,
  borderColor,
}: {
  item: TasksCalendarTaskItem;
  onPress: () => void;
  text: string;
  muted: string;
  accent: string;
  rowBg: string;
  borderColor: string;
}) {
  const done = item.status === 'done' || item.status === 'cancelled';
  const pri = formatPriority(item.priority);
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.listRow,
        { backgroundColor: rowBg, borderColor },
        pressed && { opacity: 0.88 },
      ]}
      accessibilityRole="button">
      <View style={[styles.listDot, { backgroundColor: done ? muted : accent }]} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[styles.listTitle, { color: text }, done && styles.listTitleDone]} numberOfLines={2}>
          {item.title}
        </Text>
        <Text style={[styles.listMeta, { color: muted }]}>
          {formatTaskStatus(item.status)}
          {pri ? ` · ${pri}` : ''}
        </Text>
      </View>
      <MaterialIcons name="chevron-right" size={18} color={muted} />
    </Pressable>
  );
}

function HabitRowItem({
  item,
  onPress,
  text,
  muted,
  success,
  rowBg,
  borderColor,
}: {
  item: TasksCalendarHabitItem;
  onPress: () => void;
  text: string;
  muted: string;
  success: string;
  rowBg: string;
  borderColor: string;
}) {
  const goal = item.dailyGoalMax;
  const met = goal !== null ? item.todayCount >= goal : item.todayCount > 0;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.listRow,
        { backgroundColor: rowBg, borderColor },
        pressed && { opacity: 0.88 },
      ]}
      accessibilityRole="button">
      <View style={[styles.listIconBadge, { backgroundColor: `${success}18` }]}>
        <Text style={{ fontSize: 18 }}>{item.icon || '✓'}</Text>
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[styles.listTitle, { color: text }]} numberOfLines={1}>
          {item.name}
        </Text>
        <Text style={[styles.listMeta, { color: met ? success : muted }]}>
          打卡 {item.todayCount}
          {goal !== null ? ` / ${goal}` : ''}
        </Text>
      </View>
      <MaterialIcons name="chevron-right" size={18} color={muted} />
    </Pressable>
  );
}

function ProjectRowItem({
  item,
  onPress,
  text,
  muted,
  rowBg,
  borderColor,
}: {
  item: TasksCalendarProjectItem;
  onPress: () => void;
  text: string;
  muted: string;
  rowBg: string;
  borderColor: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.listRow,
        { backgroundColor: rowBg, borderColor },
        pressed && { opacity: 0.88 },
      ]}
      accessibilityRole="button">
      <View style={[styles.listIconBadge, { backgroundColor: `${muted}14` }]}>
        <MaterialIcons name="folder" size={18} color={muted} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.listTitle, { color: text }]} numberOfLines={1}>
          {item.name}
        </Text>
        <Text style={[styles.listMeta, { color: muted }]}>项目截止</Text>
      </View>
      <MaterialIcons name="chevron-right" size={18} color={muted} />
    </Pressable>
  );
}

function SummaryChip({ label, value, color, bg }: { label: string; value: number; color: string; bg: string }) {
  if (value <= 0) return null;
  return (
    <View style={[styles.summaryChip, { backgroundColor: bg }]}>
      <Text style={[styles.summaryChipVal, { color }]}>{value}</Text>
      <Text style={[styles.summaryChipLbl, { color }]}>{label}</Text>
    </View>
  );
}

function DayDetailSections({
  summary,
  selectedDate,
  router,
  text,
  muted,
  accent,
  success,
  tertiary,
  sectionBg,
  rowBg,
  borderColor,
}: {
  summary: TasksCalendarDaySummary;
  selectedDate: Date;
  router: ReturnType<typeof useRouter>;
  text: string;
  muted: string;
  accent: string;
  success: string;
  tertiary: string;
  sectionBg: string;
  rowBg: string;
  borderColor: string;
}) {
  const openTask = (id: string) => router.push(`/task/${id}`);
  const openHabit = (id: string) => router.push({ pathname: '/habit-detail', params: { id } });
  const openProject = (id: string) => router.push({ pathname: '/edit-project', params: { id } });

  const counts = daySummaryCounts(summary);
  const hasAny = counts.total > 0;

  const renderSection = (
    title: string,
    icon: React.ComponentProps<typeof MaterialIcons>['name'],
    color: string,
    count: number,
    children: React.ReactNode
  ) => {
    if (!children || count <= 0) return null;
    return (
      <View style={[styles.detailSection, { backgroundColor: sectionBg, borderColor }]}>
        <View style={styles.detailSectionHead}>
          <View style={[styles.detailSectionIcon, { backgroundColor: `${color}16` }]}>
            <MaterialIcons name={icon} size={15} color={color} />
          </View>
          <Text style={[styles.detailSectionTitle, { color: text }]}>{title}</Text>
          <View style={[styles.detailSectionBadge, { backgroundColor: `${color}14` }]}>
            <Text style={[styles.detailSectionBadgeText, { color }]}>{count}</Text>
          </View>
        </View>
        <View style={styles.detailSectionBody}>{children}</View>
      </View>
    );
  };

  const dueOnly = summary.dueTasks.filter(
    (d) => !summary.matrixTasks.some((m) => m.id === d.id) && !summary.frogs.some((f) => f.id === d.id)
  );

  return (
    <View style={{ gap: Spacing.md }}>
      <View style={styles.detailHeader}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={[styles.detailDate, { color: text }]}>{formatTopDate(selectedDate)}</Text>
          <Text style={[styles.detailWeekday, { color: muted }]}>{formatWeekday(selectedDate)}</Text>
        </View>
        {hasAny ? (
          <View style={[styles.detailTotalBadge, { backgroundColor: `${accent}12`, borderColor: `${accent}30` }]}>
            <Text style={[styles.detailTotalText, { color: accent }]}>{counts.total} 项</Text>
          </View>
        ) : null}
      </View>

      {hasAny ? (
        <View style={styles.summaryChipRow}>
          <SummaryChip label="青蛙" value={counts.frogs} color={success} bg={`${success}12`} />
          <SummaryChip label="待办" value={counts.todos} color={accent} bg={`${accent}12`} />
          <SummaryChip label="矩阵" value={counts.matrix} color={tertiary} bg={`${tertiary}12`} />
          <SummaryChip label="习惯" value={counts.habits} color={success} bg={`${success}10`} />
          <SummaryChip label="项目" value={counts.projects} color={muted} bg={`${muted}14`} />
        </View>
      ) : null}

      {!hasAny ? (
        <View style={[styles.emptyDayWrap, { backgroundColor: sectionBg, borderColor }]}>
          <View style={[styles.emptyDayIcon, { backgroundColor: `${muted}12` }]}>
            <MaterialIcons name="event-available" size={28} color={muted} />
          </View>
          <Text style={[styles.emptyDayTitle, { color: text }]}>暂无安排</Text>
          <Text style={[styles.emptyDay, { color: muted }]}>这一天没有青蛙、待办、习惯或项目截止。</Text>
        </View>
      ) : (
        <>
          {renderSection(
            '今日青蛙',
            'eco',
            success,
            summary.frogs.length,
            summary.frogs.map((t) => (
              <TaskRowItem
                key={t.id}
                item={t}
                onPress={() => openTask(t.id)}
                text={text}
                muted={muted}
                accent={success}
                rowBg={rowBg}
                borderColor={borderColor}
              />
            ))
          )}
          {renderSection(
            '待办',
            'check-circle-outline',
            accent,
            summary.standaloneTodos.length,
            summary.standaloneTodos.map((t) => (
              <TaskRowItem
                key={t.id}
                item={t}
                onPress={() => openTask(t.id)}
                text={text}
                muted={muted}
                accent={accent}
                rowBg={rowBg}
                borderColor={borderColor}
              />
            ))
          )}
          {renderSection(
            '任务列表',
            'grid-view',
            tertiary,
            summary.matrixTasks.length,
            summary.matrixTasks.map((t) => (
              <TaskRowItem
                key={t.id}
                item={t}
                onPress={() => openTask(t.id)}
                text={text}
                muted={muted}
                accent={tertiary}
                rowBg={rowBg}
                borderColor={borderColor}
              />
            ))
          )}
          {renderSection(
            '截止任务',
            'event',
            accent,
            dueOnly.length,
            dueOnly.map((t) => (
              <TaskRowItem
                key={t.id}
                item={t}
                onPress={() => openTask(t.id)}
                text={text}
                muted={muted}
                accent={accent}
                rowBg={rowBg}
                borderColor={borderColor}
              />
            ))
          )}
          {renderSection(
            '小习惯',
            'favorite',
            success,
            summary.habits.length,
            summary.habits.map((h) => (
              <HabitRowItem
                key={h.id}
                item={h}
                onPress={() => openHabit(h.id)}
                text={text}
                muted={muted}
                success={success}
                rowBg={rowBg}
                borderColor={borderColor}
              />
            ))
          )}
          {renderSection(
            '项目截止',
            'folder',
            muted,
            summary.projectsDue.length,
            summary.projectsDue.map((p) => (
              <ProjectRowItem
                key={p.id}
                item={p}
                onPress={() => openProject(p.id)}
                text={text}
                muted={muted}
                rowBg={rowBg}
                borderColor={borderColor}
              />
            ))
          )}
        </>
      )}
    </View>
  );
}

type GridCell = ReturnType<typeof buildGridCellsForMonth>[number];

const TasksCalendarMonthPage = React.memo(function TasksCalendarMonthPage({
  offset,
  todayMonthStart,
  logicalTodayYmd,
  boundary,
  pageWidth,
  selectedDate,
  onSelectDate,
  heatLevels,
  heatEmpty,
  textColor,
  textMuted,
  primary,
  secondary,
  tertiary,
}: {
  offset: number;
  todayMonthStart: Date;
  logicalTodayYmd: string;
  boundary: TasksDayBoundary;
  pageWidth: number;
  selectedDate: Date;
  onSelectDate: (d: Date) => void;
  heatLevels: readonly string[];
  heatEmpty: string;
  textColor: string;
  textMuted: string;
  primary: string;
  secondary: string;
  tertiary: string;
}) {
  const monthDate = React.useMemo(() => addMonths(todayMonthStart, offset), [offset, todayMonthStart]);
  const gridCells = React.useMemo(() => buildGridCellsForMonth(monthDate), [monthDate]);
  const gridWeeks = React.useMemo(() => chunkWeeks(gridCells), [gridCells]);
  const { gridStartYmd, gridEndYmd } = React.useMemo(() => monthGridBounds(monthDate), [monthDate]);

  const [summaries, setSummaries] = React.useState<Map<string, TasksCalendarDaySummary>>(() => new Map());
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const [tasks, habits, projects, habitCheckInsByDay] = await Promise.all([
          getTasks(),
          getHabits(),
          getProjects(),
          getHabitCheckInCountsByDateRange(gridStartYmd, gridEndYmd),
        ]);
        if (cancelled) return;
        const map = buildTasksCalendarSummaries({
          startYmd: gridStartYmd,
          endYmd: gridEndYmd,
          tasks,
          habits,
          projects,
          habitCheckInsByDay,
          dayBoundary: boundary,
        });
        setSummaries(map);
      } catch (e) {
        console.warn('加载任务日历月份失败', e);
        if (!cancelled) setSummaries(new Map());
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [gridStartYmd, gridEndYmd, boundary]);

  if (loading) {
    return (
      <View style={{ width: pageWidth, minHeight: pageWidth * 0.72, justifyContent: 'center' }}>
        <ActivityIndicator color={primary} />
      </View>
    );
  }

  return (
    <View style={{ width: pageWidth, gap: GRID_GAP }}>
      {gridWeeks.map((week, wi) => (
        <View key={`week-${offset}-${wi}`} style={[styles.weekRow, { gap: GRID_GAP }]}>
          {week.map((cell: GridCell) => {
            const summary = summaries.get(cell.ymd);
            const level = getTasksCalendarCellLevel(summary);
            const bg = level === 0 ? heatEmpty : heatLevels[level];
            const selected = isSameDay(cell.date, selectedDate);
            const isToday = cell.ymd === logicalTodayYmd;
            const frogN = summary?.frogs.length ?? 0;
            const habitN = summary?.habits.length ?? 0;
            const openN =
              (summary?.standaloneTodos.filter((t) => t.status !== 'done' && t.status !== 'cancelled').length ?? 0) +
              (summary?.matrixTasks.filter((t) => t.status !== 'done' && t.status !== 'cancelled').length ?? 0);

            return (
              <Pressable
                key={cell.key}
                onPress={() => onSelectDate(cell.date)}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={`${cell.ymd}，青蛙 ${frogN}，待办 ${openN}，习惯 ${habitN}`}
                style={({ pressed }) => [
                  styles.dayCell,
                  {
                    backgroundColor: bg,
                    borderColor: selected ? primary : isToday ? `${secondary}88` : 'transparent',
                    borderWidth: selected ? 2 : isToday ? 1.5 : 0,
                    opacity: cell.inCurrentMonth ? (pressed ? 0.9 : 1) : 0.42,
                  },
                ]}>
                <Text
                  style={[
                    styles.dayNum,
                    {
                      color: cell.inCurrentMonth ? textColor : textMuted,
                      fontWeight: selected || isToday ? '900' : '600',
                      opacity: cell.inCurrentMonth ? 1 : 0.75,
                    },
                  ]}>
                  {cell.date.getDate()}
                </Text>
                {level > 0 && cell.inCurrentMonth ? (
                  <View style={styles.microDots}>
                    {frogN > 0 ? <View style={[styles.microDot, { backgroundColor: secondary }]} /> : null}
                    {openN > 0 ? <View style={[styles.microDot, { backgroundColor: primary }]} /> : null}
                    {habitN > 0 ? <View style={[styles.microDot, { backgroundColor: tertiary }]} /> : null}
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
});

export default function TasksCalendarScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const { colors, isDark, shadows } = useAppTheme();
  const { logicalTodayYmd, boundary } = useDayBoundary();
  const today = React.useMemo(() => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(logicalTodayYmd);
    if (!m) return new Date();
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }, [logicalTodayYmd]);

  const todayMonthStart = React.useMemo(() => monthStart(today), [today]);
  const [monthOffset, setMonthOffset] = React.useState(0);
  const [visibleMonthOffset, setVisibleMonthOffset] = React.useState(0);
  const [selectedDate, setSelectedDate] = React.useState<Date>(() => today);
  const [summaries, setSummaries] = React.useState<Map<string, TasksCalendarDaySummary>>(() => new Map());
  const [detailLoading, setDetailLoading] = React.useState(true);

  const pagerRef = React.useRef<FlatList<number>>(null);
  const pagerCurrentIndexRef = React.useRef(MONTH_PAGE_CENTER_INDEX);
  const pagerWidthReadyRef = React.useRef(false);
  const pagerData = React.useMemo(
    () => Array.from({ length: MONTH_PAGE_SPAN }, (_, i) => i - MONTH_PAGE_CENTER_INDEX),
    []
  );

  const [calendarWidth, setCalendarWidth] = React.useState(() =>
    Math.max(1, windowWidth - Layout.pagePaddingX * 2 - Spacing.md * 2)
  );

  const heatLevels = isDark ? HEAT_LEVELS_DARK : HEAT_LEVELS_LIGHT;
  const heatEmpty = isDark ? 'rgba(30,41,59,0.28)' : colors.surfaceMuted;
  const sectionBg = isDark ? 'rgba(15,23,42,0.45)' : colors.surfaceMuted;
  const rowBg = isDark ? 'rgba(30,41,59,0.55)' : colors.background;

  const visibleMonth = React.useMemo(
    () => addMonths(todayMonthStart, monthOffset),
    [todayMonthStart, monthOffset]
  );
  const headerMonth = React.useMemo(
    () => addMonths(todayMonthStart, visibleMonthOffset),
    [todayMonthStart, visibleMonthOffset]
  );

  const loadRange = React.useMemo(() => {
    const monthBounds = monthGridBounds(visibleMonth);
    let startYmd = monthBounds.gridStartYmd;
    let endYmd = monthBounds.gridEndYmd;
    const selectedYmd = formatYmd(selectedDate);
    if (selectedYmd < startYmd || selectedYmd > endYmd) {
      const selBounds = monthGridBounds(monthStart(selectedDate));
      startYmd = selectedYmd < startYmd ? selBounds.gridStartYmd : startYmd;
      endYmd = selectedYmd > endYmd ? selBounds.gridEndYmd : endYmd;
    }
    return { startYmd, endYmd };
  }, [visibleMonth, selectedDate]);

  const loadDetailSummaries = React.useCallback(async () => {
    setDetailLoading(true);
    try {
      const { startYmd, endYmd } = loadRange;
      const [tasks, habits, projects, habitCheckInsByDay] = await Promise.all([
        getTasks(),
        getHabits(),
        getProjects(),
        getHabitCheckInCountsByDateRange(startYmd, endYmd),
      ]);
      const map = buildTasksCalendarSummaries({
        startYmd,
        endYmd,
        tasks,
        habits,
        projects,
        habitCheckInsByDay,
        dayBoundary: boundary,
      });
      setSummaries(map);
    } catch (e) {
      console.warn('加载任务日历失败', e);
      setSummaries(new Map());
    } finally {
      setDetailLoading(false);
    }
  }, [loadRange, boundary]);

  useFocusEffect(
    React.useCallback(() => {
      void loadDetailSummaries();
    }, [loadDetailSummaries])
  );

  React.useEffect(() => {
    void loadDetailSummaries();
  }, [monthOffset, loadDetailSummaries]);

  React.useEffect(() => {
    const nextWidth = Math.max(1, windowWidth - Layout.pagePaddingX * 2 - Spacing.md * 2);
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

  const scrollPagerToOffset = React.useCallback(
    (offset: number, animated: boolean) => {
      const index = offset + MONTH_PAGE_CENTER_INDEX;
      pagerCurrentIndexRef.current = index;
      pagerRef.current?.scrollToIndex({ index, animated });
    },
    []
  );

  const goPrevMonth = React.useCallback(() => {
    const next = monthOffset - 1;
    setMonthOffset(next);
    setVisibleMonthOffset(next);
    scrollPagerToOffset(next, true);
  }, [monthOffset, scrollPagerToOffset]);

  const goNextMonth = React.useCallback(() => {
    const next = monthOffset + 1;
    setMonthOffset(next);
    setVisibleMonthOffset(next);
    scrollPagerToOffset(next, true);
  }, [monthOffset, scrollPagerToOffset]);

  const selectedYmd = formatYmd(selectedDate);
  const selectedSummary = summaries.get(selectedYmd);

  const monthStats = React.useMemo(() => {
    let frogDays = 0;
    let habitDays = 0;
    let dueDays = 0;
    const y = visibleMonth.getFullYear();
    const m = visibleMonth.getMonth();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    for (let day = 1; day <= daysInMonth; day += 1) {
      const ymd = formatYmd(new Date(y, m, day));
      const s = summaries.get(ymd);
      if (!s) continue;
      if (s.frogs.some((f) => f.status === 'done')) frogDays += 1;
      if (s.habits.some((h) => h.todayCount > 0)) habitDays += 1;
      if (s.dueTasks.length > 0) dueDays += 1;
    }
    return { frogDays, habitDays, dueDays };
  }, [visibleMonth, summaries]);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]} edges={['left', 'right']}>
      <View
        style={[
          styles.topBar,
          {
            paddingTop: insets.top,
            backgroundColor: colors.headerScrim,
            borderBottomColor: colors.outline,
          },
        ]}>
        <AppIconButton icon="arrow-back" onPress={() => router.back()} accessibilityLabel="返回" />
        <Text style={[Typography.title, { color: colors.primary, flex: 1, textAlign: 'center' }]}>任务日历</Text>
        <AppIconButton
          icon="insights"
          onPress={() => router.push('/tasks-overview')}
          accessibilityLabel="待办总览"
        />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        nestedScrollEnabled>
        <View style={styles.monthHeader}>
          <View>
            <Text style={[Typography.kicker, { color: colors.textMuted }]}>{headerMonth.getFullYear()}</Text>
            <Text style={[Typography.h1, { color: colors.text }]}>{headerMonth.getMonth() + 1}月总览</Text>
          </View>
          <View style={styles.monthNav}>
            <Pressable
              onPress={goPrevMonth}
              style={({ pressed }) => [
                styles.navBtn,
                shadows.card,
                { backgroundColor: colors.surface, borderColor: colors.outline },
                pressed && { opacity: 0.75 },
              ]}>
              <MaterialIcons name="chevron-left" size={22} color={colors.textMuted} />
            </Pressable>
            <Pressable
              onPress={() => {
                setMonthOffset(0);
                setVisibleMonthOffset(0);
                setSelectedDate(today);
                scrollPagerToOffset(0, true);
              }}
              style={({ pressed }) => [pressed && { opacity: 0.75 }]}>
              <Text style={{ fontSize: 13, fontWeight: '800', color: colors.primary }}>今天</Text>
            </Pressable>
            <Pressable
              onPress={goNextMonth}
              style={({ pressed }) => [
                styles.navBtn,
                shadows.card,
                { backgroundColor: colors.surface, borderColor: colors.outline },
                pressed && { opacity: 0.75 },
              ]}>
              <MaterialIcons name="chevron-right" size={22} color={colors.textMuted} />
            </Pressable>
          </View>
        </View>

        <View style={[styles.statsRow, shadows.card, { backgroundColor: colors.surface, borderColor: colors.outline }]}>
          <View style={styles.statChip}>
            <View style={[styles.statIconWrap, { backgroundColor: `${colors.secondary}14` }]}>
              <MaterialIcons name="eco" size={16} color={colors.secondary} />
            </View>
            <Text style={[styles.statVal, { color: colors.text }]}>{monthStats.frogDays}</Text>
            <Text style={[styles.statLbl, { color: colors.textMuted }]}>青蛙完成日</Text>
          </View>
          <View style={[styles.statDivider, { backgroundColor: colors.outline }]} />
          <View style={styles.statChip}>
            <View style={[styles.statIconWrap, { backgroundColor: `${colors.primary}12` }]}>
              <MaterialIcons name="favorite" size={16} color={colors.primary} />
            </View>
            <Text style={[styles.statVal, { color: colors.text }]}>{monthStats.habitDays}</Text>
            <Text style={[styles.statLbl, { color: colors.textMuted }]}>习惯打卡日</Text>
          </View>
          <View style={[styles.statDivider, { backgroundColor: colors.outline }]} />
          <View style={styles.statChip}>
            <View style={[styles.statIconWrap, { backgroundColor: `${colors.textMuted}12` }]}>
              <MaterialIcons name="event" size={16} color={colors.textMuted} />
            </View>
            <Text style={[styles.statVal, { color: colors.text }]}>{monthStats.dueDays}</Text>
            <Text style={[styles.statLbl, { color: colors.textMuted }]}>有截止日</Text>
          </View>
        </View>

        <View
          style={[styles.calendarCard, { backgroundColor: colors.surface, borderColor: colors.outline }]}
          onLayout={(e) => {
            const inner = e.nativeEvent.layout.width - Spacing.md * 2;
            setCalendarWidth((prev) => (Math.abs(prev - inner) < 1 ? prev : Math.max(1, inner)));
          }}>
          <View style={styles.legendRow}>
            <Text style={[styles.legend, { color: colors.textMuted }]}>
              左右滑动切换月份 · 颜色深浅表示密度
            </Text>
            <View style={styles.legendDots}>
              <View style={[styles.legendDot, { backgroundColor: colors.secondary }]} />
              <Text style={[styles.legendDotLbl, { color: colors.textMuted }]}>蛙</Text>
              <View style={[styles.legendDot, { backgroundColor: colors.primary }]} />
              <Text style={[styles.legendDotLbl, { color: colors.textMuted }]}>办</Text>
              <View style={[styles.legendDot, { backgroundColor: colors.tertiary }]} />
              <Text style={[styles.legendDotLbl, { color: colors.textMuted }]}>习</Text>
            </View>
          </View>

          <View style={[styles.weekRow, { gap: GRID_GAP }]}>
            {WEEK_TITLES.map((w) => (
              <View key={w} style={styles.weekCell}>
                <Text style={[styles.weekText, { color: colors.textMuted }]}>{w}</Text>
              </View>
            ))}
          </View>

          <FlatList
            ref={pagerRef}
            data={pagerData}
            horizontal
            pagingEnabled
            directionalLockEnabled
            decelerationRate="fast"
            showsHorizontalScrollIndicator={false}
            keyExtractor={(offset) => `tasks-cal-month-${offset}`}
            initialScrollIndex={MONTH_PAGE_CENTER_INDEX}
            getItemLayout={(_, index) => ({ length: calendarWidth, offset: calendarWidth * index, index })}
            windowSize={5}
            maxToRenderPerBatch={3}
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
                pagerRef.current?.scrollToOffset({ offset: info.index * calendarWidth, animated: false });
              });
            }}
            renderItem={({ item: offset }) => (
              <TasksCalendarMonthPage
                offset={offset}
                todayMonthStart={todayMonthStart}
                logicalTodayYmd={logicalTodayYmd}
                boundary={boundary}
                pageWidth={calendarWidth}
                selectedDate={selectedDate}
                onSelectDate={setSelectedDate}
                heatLevels={heatLevels}
                heatEmpty={heatEmpty}
                textColor={colors.text}
                textMuted={colors.textMuted}
                primary={colors.primary}
                secondary={colors.secondary}
                tertiary={colors.tertiary}
              />
            )}
          />
        </View>

        <View style={[styles.detailCard, shadows.card, { backgroundColor: colors.surface, borderColor: colors.outline }]}>
          {detailLoading ? (
            <View style={{ alignItems: 'center', paddingVertical: Spacing['3xl'] }}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : selectedSummary ? (
            <DayDetailSections
              summary={selectedSummary}
              selectedDate={selectedDate}
              router={router}
              text={colors.text}
              muted={colors.textMuted}
              accent={colors.primary}
              success={colors.secondary}
              tertiary={colors.tertiary}
              sectionBg={sectionBg}
              rowBg={rowBg}
              borderColor={colors.outline}
            />
          ) : (
            <DayDetailSections
              summary={{
                ymd: selectedYmd,
                frogs: [],
                standaloneTodos: [],
                matrixTasks: [],
                dueTasks: [],
                habits: [],
                projectsDue: [],
              }}
              selectedDate={selectedDate}
              router={router}
              text={colors.text}
              muted={colors.textMuted}
              accent={colors.primary}
              success={colors.secondary}
              tertiary={colors.tertiary}
              sectionBg={sectionBg}
              rowBg={rowBg}
              borderColor={colors.outline}
            />
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Layout.pagePaddingX,
    paddingBottom: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  scroll: {
    paddingHorizontal: Layout.pagePaddingX,
    paddingBottom: Spacing['4xl'],
    gap: Spacing.lg,
  },
  monthHeader: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginTop: Spacing.lg,
  },
  monthNav: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  navBtn: {
    width: 40,
    height: 40,
    borderRadius: Radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statsRow: {
    flexDirection: 'row',
    borderRadius: Radius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing.sm,
  },
  statChip: { flex: 1, alignItems: 'center', gap: 6 },
  statIconWrap: {
    width: 30,
    height: 30,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statVal: { fontSize: 20, fontWeight: '900', letterSpacing: -0.4 },
  statLbl: { fontSize: 10, fontWeight: '700' },
  statDivider: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch', marginVertical: 4 },
  calendarCard: {
    width: '100%',
    borderRadius: Radius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.md,
    gap: Spacing.md,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
    paddingHorizontal: 2,
  },
  legend: { fontSize: 11, fontWeight: '600', flex: 1 },
  legendDots: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 5, height: 5, borderRadius: 3 },
  legendDotLbl: { fontSize: 10, fontWeight: '700', marginRight: 4 },
  weekRow: { flexDirection: 'row', width: '100%' },
  weekCell: { flex: 1, alignItems: 'center' },
  weekText: { fontSize: 11, fontWeight: '800' },
  dayCell: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayNum: { fontSize: 13 },
  microDots: { flexDirection: 'row', gap: 2, position: 'absolute', bottom: 4 },
  microDot: { width: 4, height: 4, borderRadius: 2, opacity: 0.85 },
  detailCard: {
    borderRadius: Radius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.lg,
    marginTop: Spacing.xs,
  },
  detailHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  detailDate: { fontSize: 18, fontWeight: '900', letterSpacing: -0.3 },
  detailWeekday: { fontSize: 13, fontWeight: '600' },
  detailTotalBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  detailTotalText: { fontSize: 12, fontWeight: '800' },
  summaryChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  summaryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: Radius.pill,
  },
  summaryChipVal: { fontSize: 13, fontWeight: '900' },
  summaryChipLbl: { fontSize: 11, fontWeight: '700', opacity: 0.85 },
  detailSection: {
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  detailSectionHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  detailSectionIcon: {
    width: 28,
    height: 28,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailSectionTitle: { flex: 1, fontSize: 14, fontWeight: '800' },
  detailSectionBadge: {
    minWidth: 22,
    height: 22,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  detailSectionBadgeText: { fontSize: 11, fontWeight: '900' },
  detailSectionBody: { gap: 8 },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  listDot: { width: 7, height: 7, borderRadius: 4 },
  listIconBadge: {
    width: 34,
    height: 34,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listTitle: { fontSize: 14, fontWeight: '700' },
  listTitleDone: { textDecorationLine: 'line-through', opacity: 0.6 },
  listMeta: { fontSize: 11, fontWeight: '600' },
  emptyDayWrap: {
    alignItems: 'center',
    paddingVertical: Spacing['3xl'],
    paddingHorizontal: Spacing.lg,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    gap: Spacing.sm,
  },
  emptyDayIcon: {
    width: 52,
    height: 52,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyDayTitle: { fontSize: 15, fontWeight: '800' },
  emptyDay: { fontSize: 13, fontWeight: '600', lineHeight: 19, textAlign: 'center' },
});
