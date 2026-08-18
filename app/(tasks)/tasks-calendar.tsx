import { AppIconButton } from '@/components/ui';
import { Layout, Radius, Spacing, Typography } from '@/constants/design-tokens';
import { useDayBoundary } from '@/contexts/day-boundary-context';
import { useAppTheme } from '@/hooks/use-app-theme';
import { usePageApiSync } from '@/hooks/use-page-api-sync';
import { useTasksCalendarSummaries } from '@/hooks/use-tasks-calendar-summaries';
import { isHabitDayGoalMet } from '@/lib/repositories/habits/habit-goal';
import type { HabitKind } from '@/lib/repositories/habits/habit-kind';
import {
  emptyCalendarDay,
  formatTasksCalendarPriority,
  getTasksCalendarPriorityColor,
  type FrogCalendarDayStatus,
  type TasksCalendarDaySummary,
  type TasksCalendarGridDay,
  type TasksCalendarHabitItem,
  type TasksCalendarProjectItem,
  type TasksCalendarTaskItem,
} from '@/lib/tasks-calendar-data';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import {
  ActivityIndicator,
  FlatList,
  PixelRatio,
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
/** 固定边框宽度，避免选中/今日态改变 borderWidth 导致格子总宽度变化、与星期列错位 */
const DAY_CELL_BORDER = 2;
const MONTH_PAGE_SPAN = 121;
const MONTH_PAGE_CENTER_INDEX = Math.floor(MONTH_PAGE_SPAN / 2);

function roundCalendarWidth(width: number): number {
  return PixelRatio.roundToNearestPixel(width);
}

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

function formatTopDate(d: Date) {
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
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

function habitKindCornerBadge(kind: HabitKind, isDark: boolean): { text: string; color: string } {
  if (kind === 'break') {
    return { text: '戒', color: isDark ? '#ea580c' : '#ea580c' };
  }
  if (kind === 'task') {
    return { text: '任', color: isDark ? '#3b82f6' : '#2563eb' };
  }
  return { text: '习', color: isDark ? '#059669' : '#047857' };
}

function daySummaryCounts(summary: TasksCalendarDaySummary | undefined) {
  if (!summary) {
    return { frogs: 0, todos: 0, habits: 0, projects: 0, total: 0 };
  }
  const todos = summary.standaloneTodos.length;
  const frogs = summary.frogs.length;
  const habits = summary.habits.length;
  const projects = summary.projectsDue.length;
  return { frogs, todos, habits, projects, total: frogs + todos + habits + projects };
}

function FrogTaskRowItem({
  item,
  onPress,
  text,
  muted,
  success,
  danger,
  rowBg,
  borderColor,
  isDark,
}: {
  item: TasksCalendarTaskItem;
  onPress: () => void;
  text: string;
  muted: string;
  success: string;
  danger: string;
  rowBg: string;
  borderColor: string;
  isDark: boolean;
}) {
  const frogStatus = item.frogDayStatus ?? 'pending';
  const visualDone = frogStatus === 'completed' || frogStatus === 'partial';
  const isIncomplete = frogStatus === 'incomplete';
  const isPartial = frogStatus === 'partial';
  const pri = formatPriority(item.priority);
  const frogStatusLabel = formatFrogDayStatus(frogStatus);
  const partialBadgeBg = isDark ? 'rgba(59,130,246,0.18)' : 'rgba(59,130,246,0.12)';
  const partialBadgeColor = isDark ? '#93c5fd' : '#2563eb';
  const incompleteBg = isDark ? 'rgba(248,113,113,0.12)' : 'rgba(254,226,226,0.72)';
  const incompleteBorder = isDark ? 'rgba(248,113,113,0.72)' : 'rgba(220,38,38,0.55)';

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.listRow,
        {
          backgroundColor: isIncomplete ? incompleteBg : rowBg,
          borderColor: isIncomplete ? incompleteBorder : borderColor,
          borderWidth: isIncomplete ? 1.5 : StyleSheet.hairlineWidth,
        },
        pressed && { opacity: 0.88 },
      ]}
      accessibilityRole="button">
      <View
        style={[
          styles.listDot,
          {
            backgroundColor: isIncomplete ? danger : visualDone ? muted : success,
            width: isIncomplete ? 8 : 7,
            height: isIncomplete ? 8 : 7,
          },
        ]}
      />
      <View style={{ flex: 1, gap: 2 }}>
        <Text
          style={[
            styles.listTitle,
            { color: isIncomplete ? danger : text },
            visualDone && styles.listTitleDone,
          ]}
          numberOfLines={2}>
          {item.title}
        </Text>
        <Text style={[styles.listMeta, { color: isIncomplete ? danger : visualDone ? success : muted }]}>
          {frogStatusLabel ?? formatTaskStatus(item.status)}
          {pri && frogStatus === 'pending' ? ` · ${pri}` : ''}
          {visualDone && pri ? ` · ${pri}` : ''}
        </Text>
      </View>
      {isPartial ? (
        <View style={[styles.frogPartialBadge, { backgroundColor: partialBadgeBg }]}>
          <Text style={[styles.frogPartialBadgeText, { color: partialBadgeColor }]}>部分完成</Text>
        </View>
      ) : null}
      {isIncomplete ? (
        <View style={[styles.frogPartialBadge, { backgroundColor: isDark ? 'rgba(248,113,113,0.18)' : 'rgba(254,202,202,0.85)' }]}>
          <Text style={[styles.frogPartialBadgeText, { color: danger }]}>未完成</Text>
        </View>
      ) : null}
      <MaterialIcons name="chevron-right" size={18} color={muted} />
    </Pressable>
  );
}

function formatFrogDayStatus(status: FrogCalendarDayStatus | undefined) {
  if (status === 'completed') return '已完成';
  if (status === 'partial') return '已完成';
  if (status === 'incomplete') return '未完成';
  return null;
}

function StandaloneTodoRowItem({
  item,
  onPress,
  text,
  muted,
  success,
  rowBg,
  borderColor,
  isDark,
}: {
  item: TasksCalendarTaskItem;
  onPress: () => void;
  text: string;
  muted: string;
  success: string;
  rowBg: string;
  borderColor: string;
  isDark: boolean;
}) {
  const reason = item.todoDayReason;
  const completedOnDay = reason === 'completed' || reason === 'completed-and-due';
  const dueOnDay = reason === 'due' || reason === 'completed-and-due';
  const priorityColor = getTasksCalendarPriorityColor(item.priority, isDark);
  const pri = formatTasksCalendarPriority(item.priority);
  const dueBadgeBg = isDark ? 'rgba(251,191,36,0.18)' : 'rgba(254,243,199,0.95)';
  const dueBadgeColor = isDark ? '#fcd34d' : '#92400e';

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.listRow,
        { backgroundColor: rowBg, borderColor },
        pressed && { opacity: 0.88 },
      ]}
      accessibilityRole="button">
      <View style={[styles.listDot, { backgroundColor: completedOnDay ? muted : priorityColor }]} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text
          style={[styles.listTitle, { color: text }, completedOnDay && styles.listTitleDone]}
          numberOfLines={2}>
          {item.title}
        </Text>
        <Text style={[styles.listMeta, { color: completedOnDay ? success : priorityColor }]}>
          {completedOnDay ? '已完成' : formatTaskStatus(item.status)}
          {pri ? ` · ${pri}` : ''}
        </Text>
      </View>
      {dueOnDay ? (
        <View style={[styles.frogPartialBadge, { backgroundColor: dueBadgeBg }]}>
          <Text style={[styles.frogPartialBadgeText, { color: dueBadgeColor }]}>截止日</Text>
        </View>
      ) : null}
      <MaterialIcons name="chevron-right" size={18} color={muted} />
    </Pressable>
  );
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
  dayYmd,
  logicalTodayYmd,
  onPress,
  text,
  muted,
  success,
  rowBg,
  borderColor,
  isDark,
}: {
  item: TasksCalendarHabitItem;
  dayYmd: string;
  logicalTodayYmd: string;
  onPress: () => void;
  text: string;
  muted: string;
  success: string;
  rowBg: string;
  borderColor: string;
  isDark: boolean;
}) {
  const goal = item.dailyGoal;
  const isTask = item.kind === 'task';
  const taskPeriodProgress = item.periodProgress ?? 0;
  const met = isTask
    ? !!item.taskShowPeriodCheck
    : isHabitDayGoalMet({
        kind: item.kind,
        todayCount: item.todayCount,
        dailyGoal: goal,
        hasDayRecord: item.kind === 'break' ? item.hasDayRecord : undefined,
        ymd: dayYmd,
        logicalTodayYmd,
      });
  const isBreak = item.kind === 'break';
  const cornerBadge = habitKindCornerBadge(item.kind, isDark);
  const progressLabel =
    isTask && item.periodGoal != null
      ? `本周期 ${taskPeriodProgress} / ${item.periodGoal}`
      : isBreak && !item.hasDayRecord && dayYmd === logicalTodayYmd
        ? '待确认今日状态'
        : `${isBreak ? '记录' : '打卡'} ${item.todayCount}${goal != null ? ` / 阈值 ${goal}` : ''}`;
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
        <View style={[styles.habitKindCornerBadge, { backgroundColor: cornerBadge.color, borderColor: rowBg }]}>
          <Text style={styles.habitKindCornerBadgeText}>{cornerBadge.text}</Text>
        </View>
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[styles.listTitle, { color: text }]} numberOfLines={1}>
          {item.name}
        </Text>
        <Text style={[styles.listMeta, { color: met ? success : muted }]}>
          {progressLabel}
          {isBreak ? (met ? ' · 达标' : ' · 未达标') : isTask && met ? ' · 已完成' : ''}
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
  logicalTodayYmd,
  router,
  text,
  muted,
  accent,
  success,
  danger,
  sectionBg,
  rowBg,
  borderColor,
  isDark,
}: {
  summary: TasksCalendarDaySummary;
  selectedDate: Date;
  logicalTodayYmd: string;
  router: ReturnType<typeof useRouter>;
  text: string;
  muted: string;
  accent: string;
  success: string;
  danger: string;
  sectionBg: string;
  rowBg: string;
  borderColor: string;
  isDark: boolean;
}) {
  const openTask = (id: string) => router.push(`/task/${id}`);
  const openHabit = (id: string) => router.push({ pathname: '/habit-detail', params: { habitId: id } });
  const openProject = (id: string) => router.push({ pathname: '/edit-project', params: { id } });

  const counts = daySummaryCounts(summary);
  const hasAny = counts.total > 0;
  const selectedYmd = formatYmd(selectedDate);
  const isTodaySelected = selectedYmd === logicalTodayYmd;
  const frogSectionTitle = isTodaySelected ? '今日青蛙' : '青蛙';
  const frogIncompleteCount = summary.frogs.filter((f) => f.frogDayStatus === 'incomplete').length;

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
            frogSectionTitle,
            'eco',
            frogIncompleteCount > 0 ? danger : success,
            summary.frogs.length,
            summary.frogs.map((t) => (
              <FrogTaskRowItem
                key={t.id}
                item={t}
                onPress={() => openTask(t.id)}
                text={text}
                muted={muted}
                success={success}
                danger={danger}
                rowBg={rowBg}
                borderColor={borderColor}
                isDark={isDark}
              />
            ))
          )}
          {renderSection(
            '待办',
            'check-circle-outline',
            accent,
            summary.standaloneTodos.length,
            summary.standaloneTodos.map((t) => (
              <StandaloneTodoRowItem
                key={t.id}
                item={t}
                onPress={() => openTask(t.id)}
                text={text}
                muted={muted}
                success={success}
                rowBg={rowBg}
                borderColor={borderColor}
                isDark={isDark}
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
                dayYmd={summary.ymd}
                logicalTodayYmd={logicalTodayYmd}
                onPress={() => openHabit(h.id)}
                text={text}
                muted={muted}
                success={success}
                rowBg={rowBg}
                borderColor={borderColor}
                isDark={isDark}
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
  pageWidth,
  dayCellSize,
  selectedYmd,
  onSelectDate,
  grid,
  loading,
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
  pageWidth: number;
  dayCellSize: number;
  selectedYmd: string;
  onSelectDate: (d: Date) => void;
  grid: Map<string, TasksCalendarGridDay> | undefined;
  loading: boolean;
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

  const gridTrackWidth = dayCellSize * 7 + GRID_GAP * 6;

  if ((loading && !grid) || dayCellSize <= 0) {
    return (
      <View style={{ width: pageWidth, minHeight: pageWidth * 0.72, justifyContent: 'center' }}>
        <ActivityIndicator color={primary} />
      </View>
    );
  }

  return (
    <View style={{ width: pageWidth }}>
      <View style={{ width: gridTrackWidth, gap: GRID_GAP }}>
        <View style={[styles.weekRow, { gap: GRID_GAP, marginBottom: GRID_GAP }]}>
          {WEEK_TITLES.map((w) => (
            <View key={w} style={[styles.weekCell, { width: dayCellSize }]}>
              <Text style={[styles.weekText, { color: textMuted }]}>{w}</Text>
            </View>
          ))}
        </View>
      {gridWeeks.map((week, wi) => (
        <View key={`week-${offset}-${wi}`} style={[styles.weekRow, { gap: GRID_GAP }]}>
          {week.map((cell: GridCell) => {
            const cellGrid = grid?.get(cell.ymd);
            const level = cellGrid?.level ?? 0;
            const bg = level === 0 ? heatEmpty : heatLevels[level];
            const selected = cell.ymd === selectedYmd;
            const isToday = cell.ymd === logicalTodayYmd;
            const frogN = cellGrid?.frogs ?? 0;
            const habitN = cellGrid?.habits ?? 0;
            const openN = cellGrid?.openTodos ?? 0;

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
                    width: dayCellSize,
                    height: dayCellSize,
                    backgroundColor: bg,
                    borderColor: selected ? primary : isToday ? `${secondary}88` : 'transparent',
                    borderWidth: DAY_CELL_BORDER,
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
    </View>
  );
});

const PAGE_API_KEY = 'tasks-calendar';

export default function TasksCalendarScreen() {
  const { wrapLoad } = usePageApiSync(PAGE_API_KEY);
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
  const selectedYmd = formatYmd(selectedDate);

  const { monthGrid, selectedSummary, detailLoading, cacheVersion, getMonthPageData, refreshControl } =
    useTasksCalendarSummaries({
      pageKey: PAGE_API_KEY,
      monthOffset,
      todayMonthStart,
      selectedYmd,
      boundary,
      wrapLoad,
    });

  const initialCalendarWidth = React.useMemo(
    () => Math.max(1, roundCalendarWidth(windowWidth - Layout.pagePaddingX * 2 - Spacing.md * 2)),
    [windowWidth]
  );

  const pagerRef = React.useRef<FlatList<number>>(null);
  const pagerCurrentIndexRef = React.useRef(MONTH_PAGE_CENTER_INDEX);
  const pagerWidthReadyRef = React.useRef(false);
  const calendarWidthRef = React.useRef(initialCalendarWidth);
  const pagerData = React.useMemo(
    () => Array.from({ length: MONTH_PAGE_SPAN }, (_, i) => i - MONTH_PAGE_CENTER_INDEX),
    []
  );

  const [calendarWidth, setCalendarWidth] = React.useState(initialCalendarWidth);
  const dayCellSize = React.useMemo(() => {
    if (calendarWidth <= 0) return 0;
    return Math.floor((calendarWidth - GRID_GAP * 6) / 7);
  }, [calendarWidth]);
  const pagerExtraData = React.useMemo(
    () => `${calendarWidth}:${dayCellSize}:${cacheVersion}`,
    [calendarWidth, dayCellSize, cacheVersion]
  );

  React.useEffect(() => {
    calendarWidthRef.current = calendarWidth;
  }, [calendarWidth]);

  const commitPagerIndex = React.useCallback((nextIndex: number) => {
    const clamped = Math.max(0, Math.min(MONTH_PAGE_SPAN - 1, nextIndex));
    pagerCurrentIndexRef.current = clamped;
    const nextOffset = clamped - MONTH_PAGE_CENTER_INDEX;
    setVisibleMonthOffset(nextOffset);
    setMonthOffset((prev) => (prev === nextOffset ? prev : nextOffset));
  }, []);

  const snapPagerToOffset = React.useCallback(
    (contentOffsetX: number, animated: boolean) => {
      const w = calendarWidthRef.current;
      if (w <= 0) return;
      const nextIndex = Math.round(contentOffsetX / w);
      const targetOffset = nextIndex * w;
      if (Math.abs(contentOffsetX - targetOffset) > 0.5) {
        pagerRef.current?.scrollToOffset({ offset: targetOffset, animated });
      }
      commitPagerIndex(nextIndex);
    },
    [commitPagerIndex]
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

  React.useEffect(() => {
    setVisibleMonthOffset(monthOffset);
    if (calendarWidth <= 0) return;

    const nextIndex = monthOffset + MONTH_PAGE_CENTER_INDEX;
    const w = calendarWidthRef.current;
    if (!pagerWidthReadyRef.current) {
      pagerWidthReadyRef.current = true;
      pagerCurrentIndexRef.current = nextIndex;
      requestAnimationFrame(() => {
        pagerRef.current?.scrollToOffset({ offset: nextIndex * w, animated: false });
      });
      return;
    }

    if (nextIndex === pagerCurrentIndexRef.current) return;
    pagerCurrentIndexRef.current = nextIndex;
    requestAnimationFrame(() => {
      pagerRef.current?.scrollToOffset({ offset: nextIndex * w, animated: true });
    });
  }, [calendarWidth, monthOffset]);

  const goPrevMonth = React.useCallback(() => {
    setMonthOffset((prev) => prev - 1);
  }, []);

  const goNextMonth = React.useCallback(() => {
    setMonthOffset((prev) => prev + 1);
  }, []);

  const monthStats = React.useMemo(() => {
    let frogDays = 0;
    let habitDays = 0;
    let dueDays = 0;
    const y = visibleMonth.getFullYear();
    const m = visibleMonth.getMonth();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    for (let day = 1; day <= daysInMonth; day += 1) {
      const ymd = formatYmd(new Date(y, m, day));
      const cell = monthGrid.get(ymd);
      if (!cell) continue;
      if (cell.frogDone) frogDays += 1;
      if (cell.habitChecked) habitDays += 1;
      if (cell.dueCount > 0) dueDays += 1;
    }
    return { frogDays, habitDays, dueDays };
  }, [visibleMonth, monthGrid]);

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
        <View style={styles.topBarSpacer} />
      </View>

      <ScrollView
        refreshControl={refreshControl}
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
                setSelectedDate(today);
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

        <View style={[styles.calendarCard, { backgroundColor: colors.surface, borderColor: colors.outline }]}>
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

          {dayCellSize > 0 ? (
          <View style={styles.calendarPagerClip}>
          <FlatList
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
            extraData={pagerExtraData}
            style={styles.calendarPager}
            onLayout={(e) => {
              const width = roundCalendarWidth(e.nativeEvent.layout.width);
              calendarWidthRef.current = width;
              setCalendarWidth((prev) => (Math.abs(prev - width) < 0.5 ? prev : Math.max(1, width)));
            }}
            getItemLayout={(_, index) => {
              const w = calendarWidthRef.current;
              return { length: w, offset: w * index, index };
            }}
            windowSize={3}
            maxToRenderPerBatch={1}
            initialNumToRender={1}
            updateCellsBatchingPeriod={16}
            removeClippedSubviews={false}
            onScroll={(e) => {
              const w = calendarWidthRef.current;
              if (w <= 0) return;
              const rawIndex = e.nativeEvent.contentOffset.x / w;
              const previewOffset = Math.round(rawIndex) - MONTH_PAGE_CENTER_INDEX;
              setVisibleMonthOffset((prev) => (prev === previewOffset ? prev : previewOffset));
            }}
            scrollEventThrottle={16}
            onScrollEndDrag={(e) => {
              const velocityX = e.nativeEvent.velocity?.x ?? 0;
              if (Math.abs(velocityX) > 0.2) return;
              snapPagerToOffset(e.nativeEvent.contentOffset.x, true);
            }}
            onMomentumScrollEnd={(e) => {
              snapPagerToOffset(e.nativeEvent.contentOffset.x, false);
            }}
            onScrollToIndexFailed={(info) => {
              const w = calendarWidthRef.current;
              if (w <= 0) return;
              requestAnimationFrame(() => {
                pagerRef.current?.scrollToOffset({ offset: info.index * w, animated: false });
              });
            }}
            renderItem={({ item: offset }) => {
              const { grid: monthGridPage, loading: monthLoading } = getMonthPageData(offset);
              return (
              <TasksCalendarMonthPage
                key={`tasks-cal-page-${offset}`}
                offset={offset}
                todayMonthStart={todayMonthStart}
                logicalTodayYmd={logicalTodayYmd}
                pageWidth={calendarWidth}
                dayCellSize={dayCellSize}
                selectedYmd={selectedYmd}
                onSelectDate={setSelectedDate}
                grid={monthGridPage}
                loading={monthLoading}
                heatLevels={heatLevels}
                heatEmpty={heatEmpty}
                textColor={colors.text}
                textMuted={colors.textMuted}
                primary={colors.primary}
                secondary={colors.secondary}
                tertiary={colors.tertiary}
              />
              );
            }}
          />
          </View>
          ) : (
            <View style={{ minHeight: 120, alignItems: 'center', justifyContent: 'center' }}>
              <ActivityIndicator color={colors.primary} />
            </View>
          )}
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
              logicalTodayYmd={logicalTodayYmd}
              router={router}
              text={colors.text}
              muted={colors.textMuted}
              accent={colors.primary}
              success={colors.secondary}
              danger={colors.danger}
              sectionBg={sectionBg}
              rowBg={rowBg}
              borderColor={colors.outline}
              isDark={isDark}
            />
          ) : (
            <DayDetailSections
              summary={emptyCalendarDay(selectedYmd)}
              selectedDate={selectedDate}
              logicalTodayYmd={logicalTodayYmd}
              router={router}
              text={colors.text}
              muted={colors.textMuted}
              accent={colors.primary}
              success={colors.secondary}
              danger={colors.danger}
              sectionBg={sectionBg}
              rowBg={rowBg}
              borderColor={colors.outline}
              isDark={isDark}
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
  topBarSpacer: { width: 40 },
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
  calendarPagerClip: { width: '100%', overflow: 'hidden' },
  calendarPager: { width: '100%' },
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
  weekRow: { flexDirection: 'row' },
  weekCell: { alignItems: 'center' },
  weekText: { fontSize: 11, fontWeight: '800' },
  dayCell: {
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
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
    position: 'relative',
  },
  habitKindCornerBadge: {
    position: 'absolute',
    left: -4,
    top: -4,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 3,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  habitKindCornerBadgeText: { color: '#fff', fontSize: 9, fontWeight: '900', lineHeight: 11 },
  listTitle: { fontSize: 14, fontWeight: '700' },
  listTitleDone: { textDecorationLine: 'line-through', opacity: 0.6 },
  listMeta: { fontSize: 11, fontWeight: '600' },
  frogPartialBadge: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: Radius.pill,
  },
  frogPartialBadgeText: { fontSize: 10, fontWeight: '800' },
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
