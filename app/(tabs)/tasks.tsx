import {
  TasksFrogSectionSkeleton,
  TasksHabitSectionSkeleton,
  TasksHeatmapSkeleton,
  TasksProjectsSectionSkeleton,
  TasksStandaloneSectionSkeleton,
} from '@/components/tasks/tasks-home-skeletons';
import { AppIconButton } from '@/components/ui';
import { CompletionRewardBadge } from '@/components/completion-reward/CompletionRewardBadge';
import { Layout, Radius, Shadows, Spacing, Typography } from '@/constants/design-tokens';
import { tryGrantProjectCompletionReward, tryGrantTaskCompletionReward } from '@/lib/completion-reward/completion-reward-grant';
import { useAppTheme } from '@/hooks/use-app-theme';
import { usePageApiSync, usePagePullRefresh } from '@/hooks/use-page-api-sync';
import { usePageFocusReload } from '@/hooks/use-page-focus-reload';
import { shouldSkipPageFocusApiRefresh, consumeForceFullApiRefreshAfterLocalClear } from '@/lib/page-api-session';
import { makeTimestampEntityId } from '@/lib/entity-id';
import { formatWriteError } from '@/lib/format-write-error';
import { markPendingTablesDirty } from '@/lib/api-incremental-sync';
import { pushLocalChangesToApi } from '@/lib/api-write-sync';
import {
  INBOX_PROJECT_CATEGORY_ID,
  INBOX_PROJECT_CATEGORY_NAME,
  INBOX_PROJECT_RETENTION_DAYS,
  isProjectInInboxCategory,
} from '@/lib/repositories/projects/constants';
import {
  createProjectCategory,
  deleteInboxProjectsPastRetentionDays,
  deleteProject,
  deleteProjectCategory,
  getProjectById,
  getProjectCategories,
  getProjects,
  updateProject,
  updateProjectCategory,
} from '@/lib/repositories/projects/project';
import type { ProjectCategoryRow, ProjectRow } from '@/lib/repositories/projects/project.types';
import {
  buildProjectLockMap,
  sortProjectsForList,
  type ProjectLockInfo,
} from '@/lib/repositories/projects/project-prerequisites';
import {
  getProjectScheduleLabel,
  getProjectScheduleYmdBounds,
  isProjectScheduleExpired,
  isProjectScheduleNotYetStarted,
} from '@/lib/repositories/projects/project-schedule-status';
import {
  cascadeParentTaskStatusAfterChildChange,
  countIncompleteTasksByProjectId,
  createTask,
  deleteTask,
  getProjectTaskTreeMap,
  getTasks,
  getTasksByProjectId,
  type TaskTreeNode,
  updateTask,
} from '@/lib/repositories/tasks/task';
import {
  completeTasksBoundToHabitIfGoalMet,
  parseBoundHabitIdsFromExtraData,
  syncAllHabitBoundTaskCompletions,
  type CompleteTasksBoundToHabitResult,
} from '@/lib/repositories/tasks/task-habit-binding';
import {
  insertFrogCompletionEvent,
  type FrogCompletionDayItem,
} from '@/lib/repositories/tasks/frog-completion-events';
import {
  clearFrogAssignedOn,
  getFrogAssignedOn,
  persistTaskFrogExtraToApi,
  unassignFrogFromApi,
} from '@/lib/frog-assignment';
import { persistTaskPatchToApi } from '@/lib/task-api-write';
import {
  clearFrogSessionCompletedOn,
  getIsLongTermTask,
  isFrogDoneForToday,
  setFrogSessionCompletedOn,
} from '@/lib/long-term-task';
import {
  insertTaskExecutionEvent,
  type TaskExecutionEventWithTitle,
} from '@/lib/repositories/tasks/task-execution-events';
import {
  computeMonthlyAverageMap,
  heatmapLevelFromMonthlyAverage,
} from '@/lib/tasks-global-heatmap';
import type { TaskRow } from '@/lib/repositories/tasks/task.types';
import {
  isTaskActiveStatus,
  isTaskShelvedStatus,
  isTaskTerminalStatus,
} from '@/lib/repositories/tasks/task.types';
import {
  parseProjectAiReview,
  type ProjectAiReview,
} from '@/lib/repositories/projects/project-ai-review';
import {
  addProjectAiPendingAnalysisListener,
  addProjectAiReviewSavedListener,
  runProjectAiReview,
} from '@/lib/project-ai-review-background';
import { isActiveAiLlmConfigured } from '@/lib/zhipu-image-parse';
import { playHabitCheckInDing } from '@/lib/play-habit-check-in-ding';
import {
  confirmBreakHabitDayClean,
  decrementTodayHabitCheckIn,
  getCheckInsMapByHabitId,
  getHabitDayRecordFlagsForYmd,
  incrementTodayHabitCheckIn,
} from '@/lib/repositories/habits/habit-check-in';
import { getHabitById, getHabits } from '@/lib/repositories/habits/habit';
import {
  isBreakHabitSucceeded,
  syncBreakHabitCompletions,
  tryMarkBreakHabitCompleted,
} from '@/lib/repositories/habits/habit-break-success';
import {
  isBuildHabitSucceeded,
  syncBuildHabitCompletions,
  tryMarkBuildHabitCompleted,
} from '@/lib/repositories/habits/habit-build-success';
import { parseHabitKind, type HabitKind } from '@/lib/repositories/habits/habit-kind';
import {
  getSubHabitDoneMapForYmd,
  hasActiveSubHabits,
  parseHabitSubHabitsMeta,
  toggleSubHabitCheckIn,
  type HabitSubItem,
} from '@/lib/repositories/habits/habit-sub';
import {
  breakSlipBadgeColor,
  breakSlipBorderColor,
  buildProgressBadgeColor,
  buildProgressBorderColor,
  getBreakHabitDayUiState,
  isHabitDayDisplayCompleted,
} from '@/lib/repositories/habits/habit-goal';
import {
  applyRepeatingTaskRollovers,
  patchExtraDataOnRepeatTaskComplete,
  patchExtraDataOnRepeatTaskReopen,
  taskHasRepeatingSchedule,
} from '@/lib/task-repeat-rollover';
import { formatTaskAuditDatetimeLocal } from '@/lib/api-mysql-datetime';
import { resyncHabitReminderForHabitId } from '@/lib/habit-reminder-notifications';
import { syncScheduledTaskReminders } from '@/lib/task-reminder-notifications';
import { fetchTodayFrogs } from '@/lib/today-frogs-api';
import { fetchProjectsListForTab, mergeProjectRowsById } from '@/lib/projects-list-api';
import {
  fetchMatrixWeekTasks,
  fetchStandaloneTodos,
  fetchTasksPageData,
  resolveMatrixProjectIds,
  sortStandaloneTodosLocally,
} from '@/lib/tasks-page-api';
import { fetchTasksHabitsGrid } from '@/lib/tasks-habits-grid-api';
import {
  fetchCompletionHeatmap,
  fetchCompletionHeatmapDayDetail,
} from '@/lib/tasks-completion-heatmap-api';
import { isStandaloneTodoTask, standaloneTodoEditorHref } from '@/lib/standalone-todo-task';
import {
  formatScheduleDateToYMD,
  getStandaloneTodoOverdueDisplayYmd,
  isStandaloneTodoOpen,
  isStandaloneTodoOverdue,
  isTaskDueOverdue,
  isTaskOverdueForList,
  isTaskRowOverdue,
} from '@/lib/standalone-todo-visibility';
import { upgradeStandaloneTodoToProject } from '@/lib/standalone-todo-to-project';
import { listWishItems } from '@/lib/repositories/wish-list/wish-list';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import React from 'react';
import {
  loadTasksHideCompletedProjectTasks,
  loadTasksMainListView,
  loadTasksProjectExpandedState,
  saveTasksHideCompletedProjectTasks,
  saveTasksMainListView,
  saveTasksProjectExpandedState,
  type TasksMainListView,
} from '@/lib/tasks-ui-settings';
import {
  getLogicalLocalYmd,
  type TasksDayBoundary,
} from '@/lib/tasks-logical-day';
import { useDayBoundary } from '@/contexts/day-boundary-context';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  InteractionManager,
  Keyboard,
  LayoutAnimation,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  Dimensions,
  TextInput,
  UIManager,
  View,
  type KeyboardEvent,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Swipeable } from 'react-native-gesture-handler';

const PAGE_API_KEY = 'tabs/tasks';

const MAIN_LIST_VIEW_TABS: Array<{ key: TasksMainListView; label: string }> = [
  { key: 'projects', label: '项目列表' },
  { key: 'tasks', label: '本周列表' },
];

/** Tasks「小习惯」网格：固定每行列数，单元宽度按行宽均分 */
const HABIT_GRID_GAP = 16;
const HABIT_GRID_COLUMNS = 4;

/** 无项目待办标题长度上限（与 add-task 页面一致，避免列表与详情不一致） */
const STANDALONE_TODO_TITLE_MAX = 50;

function PulseDot({ color }: { color: string }) {
  const scale = React.useRef(new Animated.Value(1)).current;
  const opacity = React.useRef(new Animated.Value(0.45)).current;

  React.useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(scale, { toValue: 2.4, duration: 1100, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 0, duration: 1100, useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.timing(scale, { toValue: 1, duration: 0, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 0.45, duration: 0, useNativeDriver: true }),
        ]),
      ]),
    );

    loop.start();
    return () => loop.stop();
  }, [opacity, scale]);

  return (
    <View style={styles.pulseWrap}>
      <Animated.View style={[styles.pulseRing, { backgroundColor: color, transform: [{ scale }], opacity }]} />
      <View style={[styles.pulseCenter, { backgroundColor: color }]} />
    </View>
  );
}

function EmptyPlaceholder({
  icon,
  title,
  subtitle,
  color,
  muted,
  cardBg,
}: {
  icon: React.ComponentProps<typeof MaterialIcons>['name'];
  title: string;
  subtitle?: string;
  color: string;
  muted: string;
  cardBg: string;
}) {
  return (
    <View style={[styles.emptyWrap, { backgroundColor: cardBg, borderColor: `${muted}22` }]}>
      <View style={[styles.emptyIcon, { backgroundColor: `${color}14` }]}>
        <MaterialIcons name={icon} size={26} color={color} />
      </View>
      <Text style={[styles.emptyTitle, { color: muted }]}>{title}</Text>
      {!!subtitle && (
        <Text style={[styles.emptySubtitle, { color: muted }]} numberOfLines={2}>
          {subtitle}
        </Text>
      )}
    </View>
  );
}

function SegmentTabs({
  tabs,
  active,
  onChange,
  color,
  muted,
  onLongPressTab,
}: {
  tabs: Array<{ key: string; label: string }>;
  active: string;
  onChange: (key: string) => void;
  color: string;
  muted: string;
  onLongPressTab?: (key: string, label: string) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.segmentRow}
      keyboardShouldPersistTaps="handled">
      {tabs.map((tab) => {
        const isActive = tab.key === active;
        return (
          <Pressable
            key={tab.key}
            onPress={() => onChange(tab.key)}
            onLongPress={() => onLongPressTab?.(tab.key, tab.label)}
            delayLongPress={260}
            style={styles.segmentBtn}>
            <Text
              style={[
                styles.segmentText,
                {
                  color: isActive ? color : muted,
                  borderBottomColor: isActive ? color : 'transparent',
                  fontWeight: isActive ? '800' : '600',
                },
              ]}>
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/** 任务页主列表：项目列表 / 任务列表二选一展示 */
function MainListViewSwitcher({
  value,
  onChange,
  primary,
  muted,
  onPrimary,
  trackBg,
}: {
  value: TasksMainListView;
  onChange: (next: TasksMainListView) => void;
  primary: string;
  muted: string;
  onPrimary: string;
  trackBg: string;
}) {
  return (
    <View
      style={[styles.mainListViewTrack, { backgroundColor: trackBg }]}
      accessibilityRole="tablist">
      {MAIN_LIST_VIEW_TABS.map((tab) => {
        const active = tab.key === value;
        return (
          <Pressable
            key={tab.key}
            onPress={() => onChange(tab.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            style={({ pressed }) => [
              styles.mainListViewBtn,
              active && { backgroundColor: primary },
              pressed && { opacity: 0.9 },
            ]}>
            <Text
              style={[
                styles.mainListViewBtnText,
                { color: active ? onPrimary : muted, fontWeight: active ? '800' : '600' },
              ]}>
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** 项目列表：筛选是否隐藏已完成任务（样式与 ghost 按钮一致） */
function ProjectListTaskFilterChip({
  active,
  onPress,
  primary,
  outline,
  onPrimary,
  isDark,
}: {
  active: boolean;
  onPress: () => void;
  primary: string;
  outline: string;
  onPrimary: string;
  isDark: boolean;
}) {
  return (
    <ScalePressable
      onPress={onPress}
      accessibilityRole="switch"
      accessibilityState={{ checked: active }}
      accessibilityLabel="隐藏已完成任务"
      style={({ pressed }) => [
        styles.projectFilterChip,
        {
          borderColor: active ? `${primary}55` : isDark ? 'rgba(148,163,184,0.28)' : 'rgba(194,198,214,0.8)',
          backgroundColor: active
            ? isDark
              ? 'rgba(96,165,250,0.16)'
              : 'rgba(0,88,190,0.08)'
            : isDark
              ? 'rgba(15,23,42,0.45)'
              : 'rgba(248,250,252,0.95)',
        },
        pressed && { opacity: 0.88 },
      ]}>
      <View
        style={[
          styles.projectFilterChipMark,
          {
            borderColor: active ? primary : outline,
            backgroundColor: active ? primary : 'transparent',
          },
        ]}>
        {active ? <MaterialIcons name="check" size={11} color={onPrimary} /> : null}
      </View>
      <Text style={[styles.projectFilterChipText, { color: active ? primary : outline }]}>隐藏已完成任务</Text>
    </ScalePressable>
  );
}

function ScalePressable({
  children,
  scaleTo = 0.97,
  style,
  animatedStyle,
  onPressIn,
  onPressOut,
  ...rest
}: React.ComponentProps<typeof Pressable> & {
  children: React.ReactNode;
  scaleTo?: number;
  animatedStyle?: any;
}) {
  const scale = React.useRef(new Animated.Value(1)).current;

  const handlePressIn = React.useCallback(
    (event: any) => {
      Animated.spring(scale, {
        toValue: scaleTo,
        speed: 30,
        bounciness: 4,
        useNativeDriver: true,
      }).start();
      onPressIn?.(event);
    },
    [onPressIn, scale, scaleTo]
  );

  const handlePressOut = React.useCallback(
    (event: any) => {
      Animated.spring(scale, {
        toValue: 1,
        speed: 24,
        bounciness: 6,
        useNativeDriver: true,
      }).start();
      onPressOut?.(event);
    },
    [onPressOut, scale]
  );

  return (
    <Animated.View style={[{ transform: [{ scale }] }, animatedStyle]}>
      <Pressable {...rest} style={style} onPressIn={handlePressIn} onPressOut={handlePressOut}>
        {children}
      </Pressable>
    </Animated.View>
  );
}

type ProjectScheduleMeta = {
  mode?: 'date' | 'time';
  reminderOption?: string;
  repeatOption?: string;
  date?: string;
  range?: { start: string; end: string };
};

type TaskMetaExtra = {
  reminder?: string;
  repeat?: string;
  frogAssignedOn?: string;
};

type HabitSection = {
  id: string;
  title: string;
  items: Array<{
    id: string;
    icon: string;
    name: string;
    todayCount: number;
    /** `extra_data.quantify.dailyGoal`；戒除可为 0，养成为 null 表示不限 */
    dailyGoal: number | null;
    /** 打卡递增上限（戒除习惯不设上限） */
    incrementCap: number | null;
    /** `extra_data.habitKind`：养成 / 戒除 */
    kind: HabitKind;
    /** 用于按 `schedule` 判断今日是否在循环打卡日 */
    extraData: string | null;
    /** 完成任务：本周期进度与展示态（仅 kind === 'task' 时有值） */
    periodProgress: number | null;
    periodGoal: number | null;
    taskShowPeriodCheck: boolean;
    /** 服务端 habits-grid 返回的今日完成态 */
    displayCompleted: boolean;
    /** 戒除：今日是否已有打卡记录（含 count=0 的保持戒除确认） */
    hasTodayRecord?: boolean;
    /** 子习惯模式（extra_data） */
    hasSubHabits?: boolean;
    subHabits?: HabitSubItem[];
    subHabitCompletedCount?: number;
  }>;
};

type HabitGridItem = HabitSection['items'][number];

function applyHabitCountPatch(
  item: HabitGridItem,
  todayCount: number,
  periodDelta = 0,
  opts?: { hasTodayRecord?: boolean; logicalTodayYmd?: string },
): HabitGridItem {
  const next: HabitGridItem = { ...item, todayCount };
  if (opts?.hasTodayRecord !== undefined) {
    next.hasTodayRecord = opts.hasTodayRecord;
  } else if (item.kind === 'break') {
    next.hasTodayRecord = todayCount > 0 ? true : false;
  }
  if (
    periodDelta !== 0 &&
    item.kind === 'task' &&
    typeof item.periodProgress === 'number' &&
    typeof item.periodGoal === 'number'
  ) {
    const nextProgress = Math.max(0, Math.min(item.periodGoal, item.periodProgress + periodDelta));
    next.periodProgress = nextProgress;
    next.taskShowPeriodCheck = nextProgress >= item.periodGoal;
  }
  const logicalTodayYmd = opts?.logicalTodayYmd;
  // 完成任务看周期进度；养成/戒除看当日目标
  next.displayCompleted =
    item.kind === 'task'
      ? next.taskShowPeriodCheck
      : isHabitDayDisplayCompleted({
          kind: item.kind,
          todayCount,
          dailyGoal: item.dailyGoal,
          hasDayRecord: item.kind === 'break' ? next.hasTodayRecord : undefined,
          ymd: logicalTodayYmd,
          logicalTodayYmd,
        });
  return next;
}

function patchHabitSectionsCount(
  sections: HabitSection[],
  habitId: string,
  todayCount: number,
  periodDelta = 0,
  opts?: { hasTodayRecord?: boolean; logicalTodayYmd?: string },
): HabitSection[] {
  return sections.map((sec) => ({
    ...sec,
    items: sec.items.map((it) => {
      if (it.id !== habitId) return it;
      return applyHabitCountPatch(it, todayCount, periodDelta, opts);
    }),
  }));
}

function optimisticHabitCountDelta(
  item: HabitGridItem,
  delta: 1 | -1,
): { nextCount: number; periodDelta: number; hasTodayRecord?: boolean } | null {
  const cur = item.todayCount;
  if (delta > 0) {
    if (item.incrementCap != null && cur >= item.incrementCap) return null;
    return {
      nextCount: cur + 1,
      periodDelta: item.kind === 'task' ? 1 : 0,
      hasTodayRecord: item.kind === 'break' ? true : undefined,
    };
  }
  if (item.kind === 'break') {
    if (!item.hasTodayRecord && cur <= 0) return null;
    if (cur <= 0) {
      return { nextCount: 0, periodDelta: 0, hasTodayRecord: false };
    }
    const nextCount = cur - 1;
    return {
      nextCount,
      periodDelta: 0,
      hasTodayRecord: nextCount > 0,
    };
  }
  if (cur <= 0) return null;
  return { nextCount: cur - 1, periodDelta: item.kind === 'task' ? -1 : 0 };
}

/** 与 `app/add-habit.tsx` 中 `schedule.activeTab` 一致 */
type HabitCycleTab = '每天' | '每周定期' | '每周N天' | '每月定期' | '每月N天';

const HABIT_CN_WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const;

type HabitScheduleMeta = {
  activeTab?: HabitCycleTab | string;
  selectedDays?: unknown;
  weeklyNDays?: unknown;
  monthlyFilter?: unknown;
  monthlySpecificDays?: unknown;
  monthlyNDays?: unknown;
};

function parseHabitSchedule(extraData: string | null): HabitScheduleMeta | null {
  if (!extraData) return null;
  try {
    const p = JSON.parse(extraData) as { schedule?: unknown };
    const s = p?.schedule;
    if (!s || typeof s !== 'object' || Array.isArray(s)) return null;
    return s as HabitScheduleMeta;
  } catch {
    return null;
  }
}

/** 逻辑「今天」是否为该习惯循环模式下允许打卡的日历日（每周N天/每月N天不限定具体日，始终为 true） */
function isHabitScheduledToday(extraData: string | null, d: Date = new Date()): boolean {
  const schedule = parseHabitSchedule(extraData);
  const tab = schedule?.activeTab;
  if (!tab || typeof tab !== 'string') return true;

  if (tab === '每天' || tab === '每周N天' || tab === '每月N天') return true;

  if (tab === '每周定期') {
    const selected = Array.isArray(schedule.selectedDays)
      ? schedule.selectedDays.filter((x): x is string => typeof x === 'string')
      : [];
    if (selected.length === 0) return false;
    const label = HABIT_CN_WEEKDAY_LABELS[d.getDay()];
    return selected.includes(label);
  }

  if (tab === '每月定期') {
    const dom = d.getDate();
    const days = Array.isArray(schedule.monthlySpecificDays)
      ? schedule.monthlySpecificDays.filter(
          (n): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 1 && n <= 31
        )
      : [];
    if (days.length === 0) return false;
    return days.includes(dom);
  }

  return true;
}

/** 每周/每月「定期」在非打卡日从任务页小习惯列表中隐藏（N 天模式仍始终展示） */
function isHabitHiddenByCalendarCycleOnTasks(extraData: string | null, logicalAnchor: Date): boolean {
  const schedule = parseHabitSchedule(extraData);
  const tab = schedule?.activeTab;
  if (tab !== '每周定期' && tab !== '每月定期') return false;
  return !isHabitScheduledToday(extraData, logicalAnchor);
}

function parseProjectSchedule(extraData: string | null): ProjectScheduleMeta | null {
  if (!extraData) return null;
  try {
    const parsed = JSON.parse(extraData) as { schedule?: ProjectScheduleMeta };
    return parsed?.schedule ?? null;
  } catch {
    return null;
  }
}

function parseTaskMeta(extraData: string | null): TaskMetaExtra {
  if (!extraData) return {};
  try {
    const parsed = JSON.parse(extraData) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as TaskMetaExtra;
    }
    return {};
  } catch {
    return {};
  }
}

function formatLocalYmd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 将逻辑日 YMD 转为本地日历日正午，与 `getLogicalLocalYmd` 的「今天」对齐，用于习惯循环星期/几号判断 */
const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'] as const;

function formatTasksHeaderDate(ymd: string) {
  const d = logicalYmdToLocalDate(ymd);
  return `${d.getMonth() + 1}月${d.getDate()}日 周${WEEKDAY_LABELS[d.getDay()]}`;
}

function logicalYmdToLocalDate(ymd: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return new Date();
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return new Date();
  return new Date(y, mo, d, 12, 0, 0, 0);
}

function formatTaskPriority(priority: number): string {
  if (priority >= 4) return '紧急重要';
  if (priority === 3) return '紧急不重要';
  if (priority === 2) return '不紧急重要';
  if (priority === 1) return '不紧急不重要';
  return '';
}

function getTaskPriorityColor(priority: number, isDark: boolean) {
  if (priority >= 4) return isDark ? '#f87171' : '#ba1a1a';
  if (priority === 3) return isDark ? '#fbbf24' : '#9a5b00';
  if (priority === 2) return isDark ? '#60a5fa' : '#0058be';
  if (priority === 1) return isDark ? '#94a3b8' : '#727785';
  return isDark ? '#94a3b8' : '#727785';
}

function sortTaskTree(nodes: TaskTreeNode[]): TaskTreeNode[] {
  const safeTime = (value: string | null | undefined) => {
    if (!value) return 0;
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? 0 : ms;
  };
  const safeDate = (value: string | null | undefined) => {
    if (!value) return Number.POSITIVE_INFINITY;
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms;
  };

  const clone = nodes.map((n) => ({
    ...n,
    children: sortTaskTree(n.children ?? []),
  }));

  clone.sort((a, b) => {
    const doneA = a.status === 'done' || a.status === 'cancelled';
    const doneB = b.status === 'done' || b.status === 'cancelled';
    if (doneA !== doneB) return doneA ? 1 : -1;
    const soA = a.sort_order ?? 1000;
    const soB = b.sort_order ?? 1000;
    if (soA !== soB) return soA - soB;
    if (a.priority !== b.priority) return b.priority - a.priority;
    const dueA = safeDate(a.due_date);
    const dueB = safeDate(b.due_date);
    if (dueA !== dueB) return dueA - dueB;
    const updA = safeTime(a.updated_at);
    const updB = safeTime(b.updated_at);
    return updB - updA;
  });

  return clone;
}

function sortProjectTaskTreeMap(treeMap: Record<string, TaskTreeNode[]>): Record<string, TaskTreeNode[]> {
  const next: Record<string, TaskTreeNode[]> = {};
  for (const [projectId, nodes] of Object.entries(treeMap)) {
    next[projectId] = sortTaskTree(nodes);
  }
  return next;
}

function isTaskInProjectListScope(
  task: Pick<TaskRow, 'project_id' | 'parent_task_id'>,
  treeMap: Record<string, TaskTreeNode[]>,
  taskId: string,
): boolean {
  if (task.project_id || task.parent_task_id) return true;
  return !!findTaskRowInProjectTreeMap(treeMap, taskId);
}

/** 从项目任务树中查找任务行（用于与扁平 `tasks` 状态短暂不一致时的勾选完成） */
function findTaskRowInProjectTreeMap(
  treeMap: Record<string, TaskTreeNode[]>,
  taskId: string
): TaskRow | null {
  const walk = (nodes: TaskTreeNode[]): TaskRow | null => {
    for (const n of nodes) {
      if (n.id === taskId) return n;
      const ch = n.children;
      if (ch?.length) {
        const hit = walk(ch);
        if (hit) return hit;
      }
    }
    return null;
  };
  for (const nodes of Object.values(treeMap)) {
    const hit = walk(nodes);
    if (hit) return hit;
  }
  return null;
}

function ymdToLocalDate(ymd: string): Date | null {
  const t = ymd.trim();
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  return new Date(year, month - 1, day);
}

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addLocalDays(d: Date, n: number): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + n);
  return x;
}

/** 含 `d` 的周的周一（本地 0:00） */
function mondayOfWeekContaining(d: Date): Date {
  const sod = startOfLocalDay(d);
  const dow = sod.getDay();
  const deltaMon = dow === 0 ? -6 : 1 - dow;
  return addLocalDays(sod, deltaMon);
}

/** 完成热力图：列=周（周一至周日自上而下），色阶按当月日均完成量相对映射 */
const COMPLETION_HEATMAP_WEEKS = 15;
const COMPLETION_HEAT_CELL = 22;
const COMPLETION_HEAT_GAP = 8;
const COMPLETION_HEAT_MONTH_ROW_H = 24;
const COMPLETION_HEAT_LEVEL_COLORS_LIGHT = ['#EAEBEE', '#C1DFCC', '#87C3A0', '#4EA871', '#329258'] as const;
const COMPLETION_HEAT_LEVEL_COLORS_DARK = [
  'rgba(51,65,85,0.78)',
  'rgba(193,223,204,0.32)',
  'rgba(135,195,160,0.5)',
  'rgba(78,168,113,0.68)',
  'rgba(50,146,88,0.85)',
] as const;

type CompletionHeatCell = { level: number | null; ymd: string | null; count: number };

function mergeDailyCountMaps(...maps: Map<string, number>[]): Map<string, number> {
  const merged = new Map<string, number>();
  for (const map of maps) {
    for (const [ymd, count] of map) {
      merged.set(ymd, (merged.get(ymd) ?? 0) + count);
    }
  }
  return merged;
}

function TaskCompletionHeatmap({
  logicalTodayYmd,
  dayBoundary,
  textMain,
  textMuted,
  accentColor,
  todoAccentColor,
  innerCardBg,
  innerBorderColor,
  isDark,
  reloadToken,
}: {
  logicalTodayYmd: string;
  dayBoundary: TasksDayBoundary;
  textMain: string;
  textMuted: string;
  accentColor: string;
  todoAccentColor: string;
  innerCardBg: string;
  innerBorderColor: string;
  isDark: boolean;
  /** 任务勾选变更后递增，触发热力图从服务端重载 */
  reloadToken: number;
}) {
  const router = useRouter();
  const scrollRef = React.useRef<ScrollView>(null);
  const colors = isDark ? COMPLETION_HEAT_LEVEL_COLORS_DARK : COMPLETION_HEAT_LEVEL_COLORS_LIGHT;
  const [selectedYmd, setSelectedYmd] = React.useState<string | null>(null);
  const [frogCountByYmd, setFrogCountByYmd] = React.useState<Map<string, number>>(new Map());
  const [todoCountByYmd, setTodoCountByYmd] = React.useState<Map<string, number>>(new Map());
  const [selectedFrogItems, setSelectedFrogItems] = React.useState<FrogCompletionDayItem[]>([]);
  const [selectedTodoItems, setSelectedTodoItems] = React.useState<TaskExecutionEventWithTitle[]>([]);
  const [dayItemsLoading, setDayItemsLoading] = React.useState(false);

  const combinedCountByYmd = React.useMemo(
    () => mergeDailyCountMaps(frogCountByYmd, todoCountByYmd),
    [frogCountByYmd, todoCountByYmd],
  );

  const heatmapRange = React.useMemo(() => {
    const todayCal = startOfLocalDay(new Date());
    const thisMonday = mondayOfWeekContaining(todayCal);
    const gridStartMonday = addLocalDays(thisMonday, -(COMPLETION_HEATMAP_WEEKS - 1) * 7);
    return { startYmd: formatLocalYmd(gridStartMonday), endYmd: logicalTodayYmd };
  }, [logicalTodayYmd]);

  const loadCompletionHeatmap = React.useCallback(async () => {
    try {
      const data = await fetchCompletionHeatmap({
        boundary: dayBoundary,
        heatmapStart: heatmapRange.startYmd,
        heatmapEnd: heatmapRange.endYmd,
      });
      setFrogCountByYmd(data.frogCountByYmd);
      setTodoCountByYmd(data.todoCountByYmd);
    } catch (e) {
      console.warn('加载完成热力图失败', e);
      setFrogCountByYmd(new Map());
      setTodoCountByYmd(new Map());
    }
  }, [dayBoundary, heatmapRange.endYmd, heatmapRange.startYmd]);

  useFocusEffect(
    React.useCallback(() => {
      if (shouldSkipPageFocusApiRefresh(PAGE_API_KEY)) return;
      let cancelled = false;
      const handle = InteractionManager.runAfterInteractions(() => {
        void (async () => {
          try {
            await loadCompletionHeatmap();
          } catch (e) {
            console.warn('加载完成热力图失败', e);
            if (!cancelled) {
              setFrogCountByYmd(new Map());
              setTodoCountByYmd(new Map());
            }
          }
        })();
      });
      return () => {
        cancelled = true;
        handle.cancel();
      };
    }, [loadCompletionHeatmap])
  );

  React.useEffect(() => {
    const handle = InteractionManager.runAfterInteractions(() => {
      void loadCompletionHeatmap();
    });
    return () => handle.cancel();
  }, [loadCompletionHeatmap, reloadToken]);

  const { weekColumns, monthTickColIndexes } = React.useMemo(() => {
    const todayCal = startOfLocalDay(new Date());
    const thisMonday = mondayOfWeekContaining(todayCal);
    const gridStartMonday = addLocalDays(thisMonday, -(COMPLETION_HEATMAP_WEEKS - 1) * 7);

    type Col = { cells: CompletionHeatCell[]; monday: Date };
    const weekColumns: Col[] = [];
    const monthTickColIndexes: number[] = [];
    const validDayYmds: string[] = [];

    for (let c = 0; c < COMPLETION_HEATMAP_WEEKS; c++) {
      const monday = addLocalDays(gridStartMonday, c * 7);
      const cells: CompletionHeatCell[] = [];
      for (let r = 0; r < 7; r++) {
        const day = addLocalDays(monday, r);
        const ymd = formatLocalYmd(day);
        if (ymd > logicalTodayYmd) {
          cells.push({ level: null, ymd: null, count: 0 });
        } else {
          validDayYmds.push(ymd);
          const n = combinedCountByYmd.get(ymd) ?? 0;
          cells.push({ level: 0, ymd, count: n });
        }
      }
      weekColumns.push({ cells, monday });
    }

    const monthAvgMap = computeMonthlyAverageMap(validDayYmds, combinedCountByYmd);
    for (const col of weekColumns) {
      for (const cell of col.cells) {
        if (!cell.ymd) continue;
        cell.level = heatmapLevelFromMonthlyAverage(cell.count, cell.ymd.slice(0, 7), monthAvgMap);
      }
    }

    let prevKey = '';
    for (let c = 0; c < weekColumns.length; c++) {
      const m = weekColumns[c].monday;
      const key = `${m.getFullYear()}-${m.getMonth()}`;
      if (key !== prevKey) {
        monthTickColIndexes.push(c);
        prevKey = key;
      }
    }

    return { weekColumns, monthTickColIndexes };
  }, [combinedCountByYmd, logicalTodayYmd]);

  React.useEffect(() => {
    if (!selectedYmd) {
      setSelectedFrogItems([]);
      setSelectedTodoItems([]);
      return;
    }
    let cancelled = false;
    setDayItemsLoading(true);
    void (async () => {
      try {
        const detail = await fetchCompletionHeatmapDayDetail({
          day: selectedYmd,
          boundary: dayBoundary,
          heatmapStart: heatmapRange.startYmd,
          heatmapEnd: heatmapRange.endYmd,
        });
        if (!cancelled) {
          setSelectedFrogItems(detail.frogItems);
          setSelectedTodoItems(detail.todoItems);
        }
      } catch (e) {
        console.warn('加载完成明细失败', e);
        if (!cancelled) {
          setSelectedFrogItems([]);
          setSelectedTodoItems([]);
        }
      } finally {
        if (!cancelled) setDayItemsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dayBoundary, heatmapRange.endYmd, heatmapRange.startYmd, selectedYmd, reloadToken]);

  const onHeatCellPress = React.useCallback((cell: CompletionHeatCell) => {
    if (!cell.ymd) return;
    setSelectedYmd((prev) => (prev === cell.ymd ? null : cell.ymd));
  }, []);

  const colStride = COMPLETION_HEAT_CELL + COMPLETION_HEAT_GAP;
  const selectedFrogCount =
    selectedYmd == null
      ? 0
      : dayItemsLoading
        ? frogCountByYmd.get(selectedYmd) ?? 0
        : selectedFrogItems.length;
  const selectedTodoCount =
    selectedYmd == null
      ? 0
      : dayItemsLoading
        ? todoCountByYmd.get(selectedYmd) ?? 0
        : selectedTodoItems.length;
  const hasSelectedDayItems = selectedFrogItems.length > 0 || selectedTodoItems.length > 0;

  React.useEffect(() => {
    const id = requestAnimationFrame(() => {
      scrollRef.current?.scrollToEnd({ animated: false });
    });
    return () => cancelAnimationFrame(id);
  }, [weekColumns]);

  const weekdayLeftLabels = ['一', '二', '三', '四', '五', '六', '日'];

  return (
    <View style={styles.frogHeatmapOuter}>
      <View style={styles.frogHeatmapHeading}>
        <Text style={[styles.frogHeatmapTitle, { color: textMain }]}>完成热力图</Text>
        <View style={styles.frogHeatmapLegend}>
          <Text style={[styles.frogHeatmapLegendText, { color: textMuted }]}>少</Text>
          <View style={styles.frogHeatmapLegendSwatches}>
            {colors.map((bg, i) => (
              <View key={i} style={[styles.frogHeatmapLegendCell, { backgroundColor: bg }]} />
            ))}
          </View>
          <Text style={[styles.frogHeatmapLegendText, { color: textMuted }]}>多</Text>
        </View>
      </View>

      <View
        style={[
          styles.frogHeatmapCard,
          { backgroundColor: innerCardBg, borderColor: innerBorderColor },
        ]}>
        <View style={styles.frogHeatmapBodyRow}>
          <View style={styles.frogHeatmapYAxis}>
            <View style={{ height: COMPLETION_HEAT_MONTH_ROW_H }} />
            {weekdayLeftLabels.map((lb) => (
              <View key={lb} style={[styles.frogHeatmapYCell, { height: COMPLETION_HEAT_CELL + COMPLETION_HEAT_GAP }]}>
                <Text style={[styles.frogHeatmapYLabel, { color: textMuted }]}>{lb}</Text>
              </View>
            ))}
          </View>

          <ScrollView
            ref={scrollRef}
            horizontal
            nestedScrollEnabled
            showsHorizontalScrollIndicator={false}
            style={{ flex: 1 }}
            onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}>
            <View>
              <View style={[styles.frogHeatmapMonthRow, { height: COMPLETION_HEAT_MONTH_ROW_H }]}>
                {weekColumns.map((col, c) => {
                  const show = monthTickColIndexes.includes(c);
                  const m = col.monday.getMonth() + 1;
                  return (
                    <View key={`m-${c}`} style={{ width: colStride, alignItems: 'center' }}>
                      {show ? (
                        <Text style={[styles.frogHeatmapMonthText, { color: textMuted }]}>{m}月</Text>
                      ) : null}
                    </View>
                  );
                })}
              </View>

              <View style={[styles.frogHeatmapGridRow, { gap: COMPLETION_HEAT_GAP }]}>
                {weekColumns.map((col, c) => (
                  <View key={`w-${c}`} style={{ gap: COMPLETION_HEAT_GAP }}>
                    {col.cells.map((cell, r) => {
                      const isFuture = cell.level === null || !cell.ymd;
                      const selected = !isFuture && cell.ymd === selectedYmd;
                      return (
                        <Pressable
                          key={`c-${c}-r-${r}`}
                          disabled={isFuture}
                          onPress={() => onHeatCellPress(cell)}
                          hitSlop={isFuture ? 0 : 4}
                          style={({ pressed }) => [
                            styles.frogHeatmapCellHit,
                            !isFuture && pressed && { opacity: 0.82 },
                          ]}>
                          <View
                            style={[
                              styles.frogHeatmapDataCell,
                              {
                                width: COMPLETION_HEAT_CELL,
                                height: COMPLETION_HEAT_CELL,
                                backgroundColor: isFuture ? 'transparent' : colors[cell.level!],
                                borderWidth: selected ? 2 : 0,
                                borderColor: selected ? accentColor : 'transparent',
                              },
                            ]}
                          />
                        </Pressable>
                      );
                    })}
                  </View>
                ))}
              </View>
            </View>
          </ScrollView>
        </View>

        {selectedYmd ? (
          <View
            style={[
              styles.frogHeatmapDetail,
              { borderTopColor: isDark ? 'rgba(148,163,184,0.2)' : 'rgba(148,163,184,0.28)' },
            ]}>
            <View style={styles.frogHeatmapDetailHead}>
              <Text style={[styles.frogHeatmapDetailDate, { color: textMain }]} numberOfLines={1}>
                {formatYmdCN(selectedYmd)}
              </Text>
              <Text style={[styles.frogHeatmapDetailFrogCount, { color: textMain }]}>
                青蛙✖{selectedFrogCount} · 待办✖{selectedTodoCount}
              </Text>
            </View>
            {dayItemsLoading ? (
              <Text style={[styles.frogHeatmapDetailEmpty, { color: textMuted }]}>加载中…</Text>
            ) : !hasSelectedDayItems ? (
              <Text style={[styles.frogHeatmapDetailEmpty, { color: textMuted }]}>该日暂无已完成记录</Text>
            ) : (
              <View style={styles.frogHeatmapDetailList}>
                {selectedFrogItems.length > 0 ? (
                  <>
                    <Text style={[styles.completionHeatmapDetailSectionLabel, { color: textMuted }]}>青蛙</Text>
                    {selectedFrogItems.map((item, idx) => {
                      const title = (item.task_title ?? '').trim() || '（无标题）';
                      const canOpen = Boolean(item.task_id?.trim());
                      const isLast = idx === selectedFrogItems.length - 1 && selectedTodoItems.length === 0;
                      return (
                        <Pressable
                          key={item.id}
                          disabled={!canOpen}
                          onPress={() => {
                            if (item.task_id) router.push({ pathname: '/task/[id]', params: { id: item.task_id } });
                          }}
                          style={({ pressed }) => [
                            styles.frogHeatmapDetailRow,
                            {
                              borderBottomColor: isDark ? 'rgba(148,163,184,0.14)' : 'rgba(148,163,184,0.2)',
                              opacity: pressed && canOpen ? 0.85 : 1,
                            },
                            isLast && { borderBottomWidth: 0 },
                          ]}>
                          <MaterialIcons name="eco" size={16} color={accentColor} style={{ marginTop: 1 }} />
                          <Text style={[styles.frogHeatmapDetailTitle, { color: textMain }]} numberOfLines={2}>
                            {title}
                          </Text>
                          {canOpen ? <MaterialIcons name="chevron-right" size={18} color={textMuted} /> : null}
                        </Pressable>
                      );
                    })}
                  </>
                ) : null}
                {selectedTodoItems.length > 0 ? (
                  <>
                    <Text
                      style={[
                        styles.completionHeatmapDetailSectionLabel,
                        { color: textMuted },
                        selectedFrogItems.length > 0 && { marginTop: 10 },
                      ]}>
                      待办
                    </Text>
                    {selectedTodoItems.map((item, idx) => {
                      const title = (item.task_title ?? '').trim() || '（无标题）';
                      const canOpen = Boolean(item.task_id?.trim());
                      return (
                        <Pressable
                          key={item.id}
                          disabled={!canOpen}
                          onPress={() => {
                            if (item.task_id) router.push({ pathname: '/task/[id]', params: { id: item.task_id } });
                          }}
                          style={({ pressed }) => [
                            styles.frogHeatmapDetailRow,
                            {
                              borderBottomColor: isDark ? 'rgba(148,163,184,0.14)' : 'rgba(148,163,184,0.2)',
                              opacity: pressed && canOpen ? 0.85 : 1,
                            },
                            idx === selectedTodoItems.length - 1 && { borderBottomWidth: 0 },
                          ]}>
                          <MaterialIcons name="check-circle" size={16} color={todoAccentColor} style={{ marginTop: 1 }} />
                          <Text style={[styles.frogHeatmapDetailTitle, { color: textMain }]} numberOfLines={2}>
                            {title}
                          </Text>
                          {canOpen ? <MaterialIcons name="chevron-right" size={18} color={textMuted} /> : null}
                        </Pressable>
                      );
                    })}
                  </>
                ) : null}
              </View>
            )}
          </View>
        ) : null}
      </View>
    </View>
  );
}

function formatYmdCN(ymd: string): string {
  const t = ymd.trim();
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return t;
  const year = m[1];
  const month = String(Number(m[2]));
  const day = String(Number(m[3]));
  return `${year}年${month}月${day}日`;
}

function formatProjectDueText(dueYmd: string, todayYmd: string): string {
  const due = ymdToLocalDate(dueYmd);
  const today = ymdToLocalDate(todayYmd);
  if (!due || !today) return `截止：${formatYmdCN(dueYmd)}`;
  const diffDays = Math.round((due.getTime() - today.getTime()) / 86400000);
  if (diffDays === 0) return '截至今日';
  if (diffDays === 1) return '截至明日';
  if (diffDays === 2) return '截至后天';
  return `截止：${formatYmdCN(dueYmd)}`;
}

function formatTaskDueText(dueYmd: string, todayYmd: string): string {
  const due = ymdToLocalDate(dueYmd);
  const today = ymdToLocalDate(todayYmd);
  if (!due || !today) return `截止：${dueYmd}`;
  const diffDays = Math.round((due.getTime() - today.getTime()) / 86400000);
  if (diffDays === 0) return '截至今日';
  if (diffDays === 1) return '截至明日';
  if (diffDays === 2) return '截至后天';
  return `截止：${dueYmd}`;
}

/** 待办勾选图标颜色：与任务优先级象限语义一致 */
function getTaskPriorityCheckColor(priority: number, isDark: boolean) {
  if (priority >= 4) return isDark ? '#f87171' : '#ba1a1a';
  if (priority === 3) return isDark ? '#fbbf24' : '#825100';
  if (priority === 2) return isDark ? '#60a5fa' : '#0058be';
  return isDark ? '#94a3b8' : '#727785';
}

const URGENT_IMPORTANT_PRIORITY = 4;

function trimTaskAcceptanceCriteria(task: Pick<TaskRow, 'description'>): string {
  return (task.description ?? '').trim();
}

/** 过期未完成待办在列表/四象限中按「紧急重要」展示与分组。 */
function getEffectiveTaskPriority(task: TaskRow, logicalTodayYmd: string): number {
  if (isTaskOverdueForList(task, logicalTodayYmd)) return URGENT_IMPORTANT_PRIORITY;
  return task.priority;
}

async function applyOverdueTaskPriorityBump(rows: TaskRow[], logicalTodayYmd: string): Promise<number> {
  let count = 0;
  for (const t of rows) {
    if (t.priority >= URGENT_IMPORTANT_PRIORITY) continue;
    if (!isTaskRowOverdue(t, logicalTodayYmd)) continue;
    await updateTask(t.id, { priority: URGENT_IMPORTANT_PRIORITY });
    count += 1;
  }
  return count;
}

/** 递归：收纳、到期自动归档等需整棵树均完成或取消 */
function areAllTasksInProjectTreeDone(nodes: TaskTreeNode[]): boolean {
  for (const n of nodes) {
    if (n.status !== 'done' && n.status !== 'cancelled') return false;
    const ch = n.children;
    if (ch.length > 0 && !areAllTasksInProjectTreeDone(ch)) return false;
  }
  return true;
}

/** 项目列表卡片「进度」：递归统计任务树中全部任务（已取消视为完成） */
function getProjectTreeTaskProgress(nodes: TaskTreeNode[]): { total: number; done: number; ratio: number } {
  let total = 0;
  let done = 0;
  const walk = (list: TaskTreeNode[]) => {
    for (const n of list) {
      total += 1;
      if (n.status === 'done' || n.status === 'cancelled') done += 1;
      const ch = Array.isArray(n.children) ? n.children : [];
      if (ch.length > 0) walk(ch);
    }
  };
  walk(nodes);
  return { total, done, ratio: total > 0 ? done / total : 0 };
}

/** 与项目列表卡片「进度」一致：任务树中全部任务均完成或取消 */
function isProjectListProgressComplete(nodes: TaskTreeNode[]): boolean {
  if (nodes.length === 0) return false;
  return areAllTasksInProjectTreeDone(nodes);
}

function isTaskNodeDoneOrCancelled(node: TaskTreeNode): boolean {
  return node.status === 'done' || node.status === 'cancelled';
}

/** 项目列表展开区：隐藏已完成/已取消任务（保留仍有未完成子节点的父任务） */
function filterProjectListTaskTree(nodes: TaskTreeNode[], hideCompleted: boolean): TaskTreeNode[] {
  if (!hideCompleted) return nodes;
  const result: TaskTreeNode[] = [];
  for (const node of nodes) {
    const children = Array.isArray(node.children) ? node.children : [];
    const filteredChildren = filterProjectListTaskTree(children, true);
    if (isTaskNodeDoneOrCancelled(node) && filteredChildren.length === 0) continue;
    result.push({ ...node, children: filteredChildren });
  }
  return result;
}

/** 展平任务树为 id -> 节点；隐藏已完成时列表用过滤树展示，进度仍按完整子任务统计 */
function buildProjectTaskNodeById(nodes: TaskTreeNode[]): Map<string, TaskTreeNode> {
  const map = new Map<string, TaskTreeNode>();
  const walk = (list: TaskTreeNode[]) => {
    for (const n of list) {
      map.set(n.id, n);
      const ch = Array.isArray(n.children) ? n.children : [];
      if (ch.length > 0) walk(ch);
    }
  };
  walk(nodes);
  return map;
}

/** 直接子任务完成进度（与项目列表父任务进度条一致） */
function getDirectChildTaskProgress(children: TaskTreeNode[]): { total: number; done: number; ratio: number } {
  const total = children.length;
  if (total <= 0) return { total: 0, done: 0, ratio: 0 };
  const done = children.reduce((acc, child) => {
    if (child.status === 'done' || child.status === 'cancelled') return acc + 1;
    return acc;
  }, 0);
  return { total, done, ratio: done / total };
}

/** 是否达到可询问归纳收集箱的完成度：有截止日期对齐列表进度，否则需整棵树完成 */
function isProjectInboxProgressComplete(project: ProjectRow, nodes: TaskTreeNode[]): boolean {
  if (nodes.length === 0) return false;
  if (getProjectInboxAutoArchiveDueYmd(project)) return isProjectListProgressComplete(nodes);
  return areAllTasksInProjectTreeDone(nodes);
}

function alertProjectTaskLocked(lockInfo: ProjectLockInfo | undefined) {
  if (lockInfo?.scheduleNotStarted) {
    Alert.alert('无法操作', '该项目计划尚未开始，到达开始日期前不可完成任务。');
    return;
  }
  Alert.alert('无法操作', '该项目仍被前置项目锁定，请先完成前置项目。');
}

function showMoveProjectToInboxPrompt(project: ProjectRow, onConfirm: () => void) {
  const dueYmd = getProjectInboxAutoArchiveDueYmd(project);
  const dueHint = dueYmd
    ? `若选「否」，将在截止日期 ${formatYmdCN(dueYmd)} 到达后自动归纳到收集箱。`
    : `若选「否」，请之后在项目卡片上左滑「收纳」手动归纳到收集箱。`;
  Alert.alert(
    `「${project.name}」进度已达 100%`,
    `项目当前完成量已达 100%。是否现在将项目归纳到收集箱？\n\n${dueHint}`,
    [
      { text: '否', style: 'cancel' },
      { text: '是', onPress: onConfirm },
    ],
  );
}

/** 到期自动归入收集箱所依据的日期（区间取结束日，否则取项目 due_date） */
function getProjectInboxAutoArchiveDueYmd(project: ProjectRow): string | null {
  const schedule = parseProjectSchedule(project.extra_data);
  if (schedule?.mode === 'time' && schedule.range?.start && schedule.range?.end) {
    return formatScheduleDateToYMD(schedule.range.end);
  }
  if (project.due_date?.trim()) return formatScheduleDateToYMD(project.due_date);
  return null;
}

function isLocalYmdOnOrAfter(todayYmd: string, dueYmd: string): boolean {
  const t = ymdToLocalDate(todayYmd);
  const d = ymdToLocalDate(dueYmd);
  if (!t || !d) return false;
  return t.getTime() >= d.getTime();
}

/** 进入任务页或刷新后：已到期且任务树全部完成的项目自动归入收集箱 */
async function autoArchiveProjectsPastDueIfNeeded(
  rows: ProjectRow[],
  treeMap: Record<string, TaskTreeNode[]>,
  todayYmd: string,
) {
  let changed = 0;
  for (const p of rows) {
    if (p.status === 'completed' || p.status === 'archived') continue;
    if (isProjectInInboxCategory(p.category_id)) continue;
    const tree = treeMap[p.id] ?? [];
    if (tree.length === 0) continue;
    if (!isProjectInboxProgressComplete(p, tree)) continue;
    const dueYmd = getProjectInboxAutoArchiveDueYmd(p);
    if (!dueYmd) continue;
    if (!isLocalYmdOnOrAfter(todayYmd, dueYmd)) continue;
    try {
      await updateProject(p.id, { category_id: INBOX_PROJECT_CATEGORY_ID, status: 'completed' });
      changed += 1;
    } catch (e) {
      console.warn('到期自动收纳项目失败', p.id, e);
    }
  }
  return changed;
}

function pickFirstNonInboxProjectCategoryId(categories: ProjectCategoryRow[]): string | null {
  const row = categories.find((c) => c.id !== INBOX_PROJECT_CATEGORY_ID);
  return row?.id ?? null;
}

/**
 * 收集箱内且状态为「已完成」的项目，若任务树中仍有未完成/未取消的任务（例如新加任务），则恢复为「进行中」
 * 并移出收集箱：归入当前第一个非收集箱项目分类；若仅有收集箱则 category_id 置为 null（与新建项目「未分类」一致）。
 */
async function reactivateInboxCompletedProjectsWithOpenTasks(
  rows: ProjectRow[],
  treeMap: Record<string, TaskTreeNode[]>,
  categories: ProjectCategoryRow[]
): Promise<number> {
  const nextCategoryId = pickFirstNonInboxProjectCategoryId(categories);
  let changed = 0;
  for (const p of rows) {
    if (p.status !== 'completed') continue;
    if (!isProjectInInboxCategory(p.category_id)) continue;
    const tree = treeMap[p.id] ?? [];
    if (tree.length === 0) continue;
    if (areAllTasksInProjectTreeDone(tree)) continue;
    try {
      await updateProject(p.id, {
        status: 'active',
        category_id: nextCategoryId,
      });
      changed += 1;
    } catch (e) {
      console.warn('收集箱已完成项目恢复进行中失败', p.id, e);
    }
  }
  return changed;
}

export default function TasksScreen() {
  const { wrapLoad, resetSync } = usePageApiSync(PAGE_API_KEY);
  /** 用户在本页做过写操作后调用，下次聚焦时再从后端全量拉取 */
  const markPageDirty = resetSync;
  /** 首次数据未就绪前展示骨架屏，避免显示空列表闪动 */
  const [initialTasksLoadPending, setInitialTasksLoadPending] = React.useState(true);
  const [tasksSkeletonMounted, setTasksSkeletonMounted] = React.useState(true);
  const tasksContentRevealDoneRef = React.useRef(false);
  const tasksSkeletonOpacity = React.useRef(new Animated.Value(1)).current;
  const tasksContentOpacity = React.useRef(new Animated.Value(0)).current;
  /** Measured width of the habit grid row — avoids guessing padding (tabs / safe area / web max-width). */
  const [habitItemsRowWidth, setHabitItemsRowWidth] = React.useState(0);
  const habitGridItemWidth = React.useMemo(() => {
    const gap = HABIT_GRID_GAP;
    const cols = HABIT_GRID_COLUMNS;
    const rowWidth =
      habitItemsRowWidth > 1
        ? habitItemsRowWidth
        : Math.max(120, Dimensions.get('window').width - Spacing['5xl'] * 2 - Spacing['4xl'] * 2);
    return (rowWidth - gap * (cols - 1)) / cols;
  }, [habitItemsRowWidth]);

  const onHabitItemsRowLayout = React.useCallback((e: { nativeEvent: { layout: { width: number } } }) => {
    const w = e.nativeEvent.layout.width;
    setHabitItemsRowWidth((prev) => (Math.abs(prev - w) < 0.5 ? prev : w));
  }, []);

  const router = useRouter();
  const { colors, isDark, shadows } = useAppTheme();
  const insets = useSafeAreaInsets();
  const TASK_INDENT = 18;

  const [taskTab, setTaskTab] = React.useState<string>('all');
  const [projectTab, setProjectTab] = React.useState<string>('all');
  const [mainListView, setMainListView] = React.useState<TasksMainListView>('projects');
  const [projects, setProjects] = React.useState<ProjectRow[]>([]);
  const [projectCategories, setProjectCategories] = React.useState<ProjectCategoryRow[]>([]);
  const [standaloneTodos, setStandaloneTodos] = React.useState<TaskRow[]>([]);
  const [matrixWeekTasks, setMatrixWeekTasks] = React.useState<TaskRow[]>([]);
  const [todayFrogs, setTodayFrogs] = React.useState<TaskRow[]>([]);
  const [completionHeatmapReloadToken, setCompletionHeatmapReloadToken] = React.useState(0);
  const [projectTaskTreeMap, setProjectTaskTreeMap] = React.useState<Record<string, TaskTreeNode[]>>({});
  const [expandedProjectIds, setExpandedProjectIds] = React.useState<Record<string, boolean>>({});
  const [hideCompletedProjectTasks, setHideCompletedProjectTasks] = React.useState(false);
  const [collapsedTaskIds, setCollapsedTaskIds] = React.useState<Record<string, boolean>>({});
  const [categoryModalVisible, setCategoryModalVisible] = React.useState(false);
  const [categoryEditorVisible, setCategoryEditorVisible] = React.useState(false);
  const [categoryEditorTitle, setCategoryEditorTitle] = React.useState('新建分类');
  const [categoryInputValue, setCategoryInputValue] = React.useState('');
  const [activeCategoryLabel, setActiveCategoryLabel] = React.useState('全部');
  const [activeCategoryId, setActiveCategoryId] = React.useState<string | null>(null);
  const [habitSections, setHabitSections] = React.useState<HabitSection[]>([]);
  /** 防止小习惯图标/名称快速连点产生并发打卡。 */
  const habitCheckInLockRef = React.useRef<Set<string>>(new Set());
  /** 丢弃过期的 loadHabits 结果，避免乐观更新后被陈旧请求覆盖。 */
  const habitLoadGenerationRef = React.useRef(0);
  const [habitLookupById, setHabitLookupById] = React.useState<
    Map<string, { name: string; icon: string }>
  >(() => new Map());
  const [expandedHabitSections, setExpandedHabitSections] = React.useState<Record<string, boolean>>({});
  const [subHabitModal, setSubHabitModal] = React.useState<{
    habitId: string;
    name: string;
    icon: string;
    subHabits: HabitSubItem[];
    doneMap: Record<string, boolean>;
  } | null>(null);
  const [subHabitTogglingId, setSubHabitTogglingId] = React.useState<string | null>(null);
  /** 底部「无项目待办」快捷输入框内容 */
  const [quickTodoDraft, setQuickTodoDraft] = React.useState('');
  const [quickTodoSaving, setQuickTodoSaving] = React.useState(false);
  const [mutationOverlayLabel, setMutationOverlayLabel] = React.useState<string | null>(null);
  const [operationToast, setOperationToast] = React.useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  const mutationInFlightRef = React.useRef(false);
  const operationToastTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const [wishNameById, setWishNameById] = React.useState<Map<string, string>>(() => new Map());
  /** 键盘占用高度：用于主列表底部留白，避免快捷待办被键盘挡住后无法滚到位 */
  const [mainScrollKeyboardPad, setMainScrollKeyboardPad] = React.useState(0);
  const mainScrollRef = React.useRef<ScrollView>(null);
  const quickTodoAnchorRef = React.useRef<View>(null);
  const mainScrollOffsetYRef = React.useRef(0);
  const keyboardHeightRef = React.useRef(0);
  const quickTodoInputFocusedRef = React.useRef(false);

  const scrollQuickTodoAboveKeyboard = React.useCallback(() => {
    const kb = keyboardHeightRef.current;
    if (kb <= 0) return;
    quickTodoAnchorRef.current?.measureInWindow((x, y, w, h) => {
      const winH = Dimensions.get('window').height;
      const margin = 16;
      const visibleBottom = winH - kb - margin;
      const inputBottom = y + h;
      if (inputBottom <= visibleBottom) return;
      const delta = inputBottom - visibleBottom;
      const nextY = mainScrollOffsetYRef.current + delta;
      mainScrollRef.current?.scrollTo({ y: Math.max(0, nextY), animated: true });
    });
  }, []);

  const showOperationToast = React.useCallback((kind: 'success' | 'error', message: string) => {
    if (operationToastTimerRef.current) clearTimeout(operationToastTimerRef.current);
    setOperationToast({ kind, message });
    operationToastTimerRef.current = setTimeout(() => {
      setOperationToast(null);
      operationToastTimerRef.current = null;
    }, 1800);
  }, []);

  const runExclusiveMutation = React.useCallback(
    async <T,>(label: string, action: () => Promise<T>, successMessage?: string): Promise<T | undefined> => {
      if (mutationInFlightRef.current) return undefined;
      mutationInFlightRef.current = true;
      setMutationOverlayLabel(label);
      try {
        const result = await action();
        if (successMessage) showOperationToast('success', successMessage);
        return result;
      } catch (err) {
        showOperationToast('error', '操作失败，请稍后重试。');
        throw err;
      } finally {
        mutationInFlightRef.current = false;
        setMutationOverlayLabel(null);
      }
    },
    [showOperationToast]
  );

  React.useEffect(() => {
    return () => {
      if (operationToastTimerRef.current) clearTimeout(operationToastTimerRef.current);
    };
  }, []);

  React.useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const winH = Dimensions.get('window').height;
    const onShow = (e: KeyboardEvent) => {
      const { height, screenY } = e.endCoordinates;
      let h = Math.max(0, Math.round(height));
      if (Platform.OS === 'ios' && screenY > 0 && screenY < winH) {
        const fromScreenY = Math.max(0, Math.round(winH - screenY));
        h = Math.min(h, fromScreenY);
      }
      keyboardHeightRef.current = h;
      setMainScrollKeyboardPad(h);
      if (quickTodoInputFocusedRef.current) {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            scrollQuickTodoAboveKeyboard();
          });
        });
      }
    };
    const onHide = () => {
      keyboardHeightRef.current = 0;
      setMainScrollKeyboardPad(0);
    };
    const subShow = Keyboard.addListener(showEvent, onShow);
    const subHide = Keyboard.addListener(hideEvent, onHide);
    return () => {
      subShow.remove();
      subHide.remove();
    };
  }, [scrollQuickTodoAboveKeyboard]);
  const { boundary: dayBoundary, logicalTodayYmd } = useDayBoundary();
  const [projectAiPendingIds, setProjectAiPendingIds] = React.useState<ReadonlySet<string>>(() => new Set());
  const [projectAiTriggerLoadingId, setProjectAiTriggerLoadingId] = React.useState<string | null>(null);
  const [projectAiModal, setProjectAiModal] = React.useState<{
    projectName: string;
    review: ProjectAiReview;
  } | null>(null);
  const zhipuReady = isActiveAiLlmConfigured();

  const habitScheduleAnchorDate = React.useMemo(() => logicalYmdToLocalDate(logicalTodayYmd), [logicalTodayYmd]);

  React.useEffect(() => {
    const unsubPending = addProjectAiPendingAnalysisListener(setProjectAiPendingIds);
    const unsubSaved = addProjectAiReviewSavedListener((saved) => {
      setProjects((prev) => prev.map((p) => (p.id === saved.id ? saved : p)));
    });
    return () => {
      unsubPending();
      unsubSaved();
    };
  }, []);

  const projectLockMap = React.useMemo(
    () => buildProjectLockMap(projects, projectTaskTreeMap, logicalTodayYmd),
    [logicalTodayYmd, projects, projectTaskTreeMap],
  );

  const lockedProjectIds = React.useMemo(() => {
    const ids = new Set<string>();
    projectLockMap.forEach((info, id) => {
      if (info.locked) ids.add(id);
    });
    return ids;
  }, [projectLockMap]);

  const projectsShownInList = React.useMemo(() => {
    const base =
      projectTab === 'all'
        ? projects.filter((p) => !isProjectInInboxCategory(p.category_id))
        : projectTab === INBOX_PROJECT_CATEGORY_ID
          ? projects.filter((p) => isProjectInInboxCategory(p.category_id))
          : projects.filter((p) => p.category_id === projectTab);
    return sortProjectsForList(base, lockedProjectIds);
  }, [lockedProjectIds, projects, projectTab]);

  React.useEffect(() => {
    if (taskTab === INBOX_PROJECT_CATEGORY_ID) setTaskTab('all');
  }, [taskTab]);

  const pageFadeAnim = React.useRef(new Animated.Value(0)).current;
  const pageTranslateAnim = React.useRef(new Animated.Value(18)).current;
  const frogCardAnim = React.useRef(new Animated.Value(0)).current;
  const matrixAnim = React.useRef(new Animated.Value(0)).current;
  const projectAnim = React.useRef(new Animated.Value(0)).current;
  const bgFloatAnim = React.useRef(new Animated.Value(0)).current;
  const frogDoneBounceMap = React.useRef<Record<string, Animated.Value>>({});
  const projectSwipeableRefs = React.useRef<Record<string, Swipeable | null>>({});
  const standaloneTodoSwipeableRefs = React.useRef<Record<string, Swipeable | null>>({});
  /** 丢弃过期的整页 reload，避免并发 focus 刷新互相覆盖项目任务 */
  const reloadGenerationRef = React.useRef(0);
  const projectTabApiReadyRef = React.useRef(false);
  /** reload 已拉过 projects-list 时，跳过一次 effect 重复请求 */
  const skipProjectsListEffectOnceRef = React.useRef(false);
  const loadProjectsListFromApiRef = React.useRef<
    (
      tab: string,
      opts?: {
        forceRefresh?: boolean;
        generation?: number;
        replaceMap?: boolean;
        hideCompletedProjectTasks?: boolean;
      },
    ) => Promise<Record<string, TaskTreeNode[]>>
  | null>(null);
  const projectsRef = React.useRef(projects);
  projectsRef.current = projects;
  const [upgradingStandaloneTodoId, setUpgradingStandaloneTodoId] = React.useState<string | null>(null);
  const [activatingShelvedTodoId, setActivatingShelvedTodoId] = React.useState<string | null>(null);

  const triggerProjectAiReview = React.useCallback(
    async (projectId: string) => {
      if (projectAiTriggerLoadingId || projectAiPendingIds.has(projectId)) return;
      if (!zhipuReady) {
        Alert.alert('未配置 AI', '请先在设置中配置智谱 API 密钥后再使用 AI 点评。');
        return;
      }
      const tree = projectTaskTreeMap[projectId] ?? [];
      if (tree.length === 0) {
        Alert.alert('无法分析', '该项目下尚无任务，请先添加任务。');
        return;
      }
      markPageDirty();
      setProjectAiTriggerLoadingId(projectId);
      try {
        const r = await runProjectAiReview(projectId, { force: true });
        if (!r.ok) {
          Alert.alert('AI 分析失败', r.error);
        }
      } finally {
        setProjectAiTriggerLoadingId(null);
      }
    },
    [markPageDirty, projectAiPendingIds, projectAiTriggerLoadingId, projectTaskTreeMap, zhipuReady],
  );

  const loadProjects = React.useCallback(async () => {
    try {
      const rows = await getProjects();
      setProjects(rows);
      return rows;
    } catch (err) {
      console.warn('加载项目列表失败', err);
      setProjects([]);
      return [];
    }
  }, []);

  const loadExpandedProjectState = React.useCallback(async () => {
    try {
      return await loadTasksProjectExpandedState();
    } catch (err) {
      console.warn('读取项目展开状态失败', err);
      return null;
    }
  }, []);

  const saveExpandedProjectState = React.useCallback(async (next: Record<string, boolean>) => {
    try {
      await saveTasksProjectExpandedState(next);
    } catch (err) {
      console.warn('保存项目展开状态失败', err);
    }
  }, []);

  const loadHideCompletedProjectTasks = React.useCallback(async (): Promise<boolean | null> => {
    try {
      return await loadTasksHideCompletedProjectTasks();
    } catch (err) {
      console.warn('读取隐藏已完成项目任务偏好失败', err);
      return null;
    }
  }, []);

  const saveHideCompletedProjectTasksPref = React.useCallback(async (hide: boolean) => {
    try {
      await saveTasksHideCompletedProjectTasks(hide);
    } catch (err) {
      console.warn('保存隐藏已完成项目任务偏好失败', err);
    }
  }, []);

  const onHideCompletedProjectTasksChange = React.useCallback(
    (hide: boolean) => {
      setHideCompletedProjectTasks(hide);
      void saveHideCompletedProjectTasksPref(hide);
      if (projectTabApiReadyRef.current) {
        void loadProjectsListFromApiRef.current?.(projectTab, {
          replaceMap: true,
          hideCompletedProjectTasks: hide,
        });
      }
    },
    [projectTab, saveHideCompletedProjectTasksPref],
  );

  const loadMainListView = React.useCallback(async (): Promise<TasksMainListView | null> => {
    try {
      return await loadTasksMainListView();
    } catch (err) {
      console.warn('读取主列表视图偏好失败', err);
      return null;
    }
  }, []);

  const saveMainListView = React.useCallback(async (view: TasksMainListView) => {
    try {
      await saveTasksMainListView(view);
    } catch (err) {
      console.warn('保存主列表视图偏好失败', err);
    }
  }, []);

  const onMainListViewChange = React.useCallback(
    (view: TasksMainListView) => {
      setMainListView(view);
      void saveMainListView(view);
    },
    [saveMainListView],
  );

  const loadProjectCategories = React.useCallback(async (): Promise<ProjectCategoryRow[]> => {
    try {
      const rows = await getProjectCategories();
      setProjectCategories(rows);
      return rows;
    } catch (err) {
      console.warn('加载项目分类失败', err);
      setProjectCategories([]);
      return [];
    }
  }, []);

  const loadTasks = React.useCallback(async (opts?: { forceRefresh?: boolean; forceLocal?: boolean }): Promise<number> => {
    try {
      let rows = await getTasks(opts);
      const logicalToday = getLogicalLocalYmd(new Date(), dayBoundary);
      const rolled = await applyRepeatingTaskRollovers(rows, logicalToday, dayBoundary);
      const overdueBumped = await applyOverdueTaskPriorityBump(rows, logicalToday);
      if (rolled > 0 || overdueBumped > 0) {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        rows = await getTasks(opts);
      }

      const matrixProjectIds = resolveMatrixProjectIds(projects, taskTab);
      const [standalone, matrix] = await Promise.all([
        fetchStandaloneTodos({
          boundary: dayBoundary,
          offlineFallback: true,
          forceLocal: opts?.forceLocal,
          forceRefresh: opts?.forceRefresh,
        }),
        fetchMatrixWeekTasks({
          boundary: dayBoundary,
          projectIds: matrixProjectIds,
          taskTab,
          projects,
          offlineFallback: true,
          forceLocal: opts?.forceLocal,
          forceRefresh: opts?.forceRefresh,
        }),
      ]);
      setStandaloneTodos(standalone.tasks);
      setMatrixWeekTasks(matrix.tasks);
      return rolled + overdueBumped;
    } catch (err) {
      console.warn('加载任务列表失败', err);
      return 0;
    }
  }, [dayBoundary, projects, taskTab]);

  const loadTodayFrogs = React.useCallback(async (opts?: { forceLocal?: boolean }) => {
    try {
      const result = await fetchTodayFrogs({
        boundary: dayBoundary,
        offlineFallback: true,
        forceLocal: opts?.forceLocal,
      });
      setTodayFrogs(result.tasks);
    } catch (err) {
      console.warn('加载今日青蛙失败', err);
    }
  }, [dayBoundary]);

  const loadHabits = React.useCallback(async () => {
    const generation = ++habitLoadGenerationRef.current;
    try {
      await syncBreakHabitCompletions();
      await syncBuildHabitCompletions();
      const data = await fetchTasksHabitsGrid({ boundary: dayBoundary, offlineFallback: true });
      if (generation !== habitLoadGenerationRef.current) return;
      const recordFlags = await getHabitDayRecordFlagsForYmd(logicalTodayYmd);
      if (generation !== habitLoadGenerationRef.current) return;
      const sections = (data.sections as HabitSection[]).map((section) => ({
        ...section,
        items: section.items.map((it) => {
          const hasTodayRecord = it.kind === 'break' ? recordFlags.get(it.id) ?? false : undefined;
          return applyHabitCountPatch(it, it.todayCount, 0, {
            hasTodayRecord,
            logicalTodayYmd,
          });
        }),
      }));
      if (generation !== habitLoadGenerationRef.current) return;
      setHabitLookupById(
        new Map(
          sections.flatMap((s) => s.items).map((it) => [it.id, { name: it.name, icon: it.icon }]),
        ),
      );
      setHabitSections(sections);
      setExpandedHabitSections((prev) => {
        const next = { ...prev };
        for (const s of sections) {
          if (typeof next[s.id] !== 'boolean') next[s.id] = true;
        }
        return next;
      });
    } catch (err) {
      if (generation !== habitLoadGenerationRef.current) return;
      console.warn('加载习惯失败', err);
      setHabitSections([]);
      setHabitLookupById(new Map());
    }
  }, [dayBoundary, logicalTodayYmd]);

  const loadProjectTasks = React.useCallback(
    async (
      rows: ProjectRow[],
      opts?: { forceRefresh?: boolean; generation?: number; preloadedTasks?: TaskRow[] },
    ): Promise<Record<string, TaskTreeNode[]>> => {
      const shouldApply = () =>
        opts?.generation == null || opts.generation === reloadGenerationRef.current;

      if (rows.length === 0) {
        if (shouldApply()) setProjectTaskTreeMap({});
        return {};
      }
      try {
        const map = await getProjectTaskTreeMap(
          rows.map((p) => p.id),
          {
            ...(opts?.forceRefresh ? { forceRefresh: true } : {}),
            ...(opts?.preloadedTasks ? { preloadedTasks: opts.preloadedTasks } : {}),
          },
        );
        if (shouldApply()) {
          setProjectTaskTreeMap(map);
        } else {
          setProjectTaskTreeMap((prev) => {
            const prevCount = Object.values(prev).reduce((n, nodes) => n + nodes.length, 0);
            const nextCount = Object.values(map).reduce((n, nodes) => n + nodes.length, 0);
            return prevCount === 0 && nextCount > 0 ? map : prev;
          });
        }
        return map;
      } catch (err) {
        console.warn('加载项目任务失败', err);
        throw err;
      }
    },
    [],
  );

  /** 完成/恢复项目内任务后：从本地 SQLite 重建任务树（保留已完成项并置底，避免 API 过滤误隐藏） */
  const reloadProjectTasksFromLocal = React.useCallback(async () => {
    const cachedTasks = await getTasks({ forceLocal: true });
    await loadProjectTasks(projectsRef.current, { preloadedTasks: cachedTasks });
  }, [loadProjectTasks]);

  /** 按当前项目 Tab 从 `GET /api/pages/projects` 拉取任务树；失败时回退本地组树 */
  const loadProjectsListFromApi = React.useCallback(
    async (
      tab: string,
      opts?: {
        forceRefresh?: boolean;
        generation?: number;
        replaceMap?: boolean;
        hideCompletedProjectTasks?: boolean;
      },
    ): Promise<Record<string, TaskTreeNode[]>> => {
      const shouldApply = () =>
        opts?.generation == null || opts.generation === reloadGenerationRef.current;

      try {
        const result = await fetchProjectsListForTab(tab, {
          hideCompletedProjectTasks: opts?.hideCompletedProjectTasks ?? hideCompletedProjectTasks,
          forceRefresh: opts?.forceRefresh,
          offlineFallback: true,
        });
        if (shouldApply()) {
          setProjects((prev) => mergeProjectRowsById(prev, result.projects));
          setProjectTaskTreeMap((prev) =>
            opts?.replaceMap ? result.projectTaskTreeMap : { ...prev, ...result.projectTaskTreeMap },
          );
        }
        return result.projectTaskTreeMap;
      } catch (err) {
        console.warn('加载项目列表 API 失败，回退本地组树', err);
        const tabProjects =
          tab === 'all'
            ? projectsRef.current.filter((p) => !isProjectInInboxCategory(p.category_id))
            : tab === INBOX_PROJECT_CATEGORY_ID
              ? projectsRef.current.filter((p) => isProjectInInboxCategory(p.category_id))
              : projectsRef.current.filter((p) => p.category_id === tab);
        return loadProjectTasks(tabProjects, { generation: opts?.generation });
      }
    },
    [hideCompletedProjectTasks, loadProjectTasks],
  );
  loadProjectsListFromApiRef.current = loadProjectsListFromApi;

  React.useEffect(() => {
    if (initialTasksLoadPending) return;

    if (!tasksContentRevealDoneRef.current) {
      tasksContentRevealDoneRef.current = true;
      setTasksSkeletonMounted(true);
      tasksSkeletonOpacity.setValue(1);
      tasksContentOpacity.setValue(0);
      pageFadeAnim.setValue(1);
      pageTranslateAnim.setValue(0);
      frogCardAnim.setValue(1);
      matrixAnim.setValue(1);
      projectAnim.setValue(1);
      Animated.parallel([
        Animated.timing(tasksSkeletonOpacity, {
          toValue: 0,
          duration: 280,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(tasksContentOpacity, {
          toValue: 1,
          duration: 320,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        if (finished) setTasksSkeletonMounted(false);
      });
      return;
    }

    pageFadeAnim.setValue(0);
    pageTranslateAnim.setValue(18);
    frogCardAnim.setValue(0);
    matrixAnim.setValue(0);
    projectAnim.setValue(0);
    tasksContentOpacity.setValue(1);
    Animated.sequence([
      Animated.parallel([
        Animated.timing(pageFadeAnim, {
          toValue: 1,
          duration: 420,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(pageTranslateAnim, {
          toValue: 0,
          duration: 420,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
      Animated.stagger(90, [
        Animated.timing(frogCardAnim, {
          toValue: 1,
          duration: 440,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(matrixAnim, {
          toValue: 1,
          duration: 460,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(projectAnim, {
          toValue: 1,
          duration: 460,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
    ]).start();
  }, [
    frogCardAnim,
    initialTasksLoadPending,
    matrixAnim,
    pageFadeAnim,
    pageTranslateAnim,
    projectAnim,
    tasksContentOpacity,
    tasksSkeletonOpacity,
  ]);

  React.useEffect(() => {
    matrixAnim.stopAnimation(() => {
      matrixAnim.setValue(0.9);
      Animated.spring(matrixAnim, {
        toValue: 1,
        speed: 18,
        bounciness: 7,
        useNativeDriver: true,
      }).start();
    });
  }, [matrixAnim, taskTab]);

  React.useEffect(() => {
    projectAnim.stopAnimation(() => {
      projectAnim.setValue(0.9);
      Animated.spring(projectAnim, {
        toValue: 1,
        speed: 18,
        bounciness: 7,
        useNativeDriver: true,
      }).start();
    });
  }, [projectAnim, projectTab]);

  React.useEffect(() => {
    if (!projectTabApiReadyRef.current) return;
    if (mainListView !== 'projects') return;
    if (skipProjectsListEffectOnceRef.current) {
      skipProjectsListEffectOnceRef.current = false;
      return;
    }
    void loadProjectsListFromApi(projectTab, { replaceMap: true });
  }, [projectTab, mainListView, loadProjectsListFromApi]);

  React.useEffect(() => {
    const anim = mainListView === 'tasks' ? matrixAnim : projectAnim;
    anim.stopAnimation(() => {
      anim.setValue(0.9);
      Animated.spring(anim, {
        toValue: 1,
        speed: 18,
        bounciness: 7,
        useNativeDriver: true,
      }).start();
    });
  }, [mainListView, matrixAnim, projectAnim]);

  React.useEffect(() => {
    frogCardAnim.stopAnimation(() => {
      frogCardAnim.setValue(0.92);
      Animated.spring(frogCardAnim, {
        toValue: 1,
        speed: 20,
        bounciness: 8,
        useNativeDriver: true,
      }).start();
    });
  }, [frogCardAnim, standaloneTodos, matrixWeekTasks]);

  React.useEffect(() => {
    if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
      UIManager.setLayoutAnimationEnabledExperimental(true);
    }
  }, []);

  React.useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(bgFloatAnim, {
          toValue: 1,
          duration: 3200,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(bgFloatAnim, {
          toValue: 0,
          duration: 3200,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ])
    );

    loop.start();
    return () => loop.stop();
  }, [bgFloatAnim]);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const [storedExpanded, storedHideCompleted, storedMainListView] = await Promise.all([
        loadExpandedProjectState(),
        loadHideCompletedProjectTasks(),
        loadMainListView(),
      ]);
      if (cancelled) return;
      if (storedExpanded) {
        setExpandedProjectIds(storedExpanded);
      }
      if (storedHideCompleted != null) {
        setHideCompletedProjectTasks(storedHideCompleted);
      }
      if (storedMainListView != null) {
        setMainListView(storedMainListView);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadExpandedProjectState, loadHideCompletedProjectTasks, loadMainListView]);

  React.useEffect(() => {
    if (Platform.OS === 'web') return;
    void getTasks().then((rows) => syncScheduledTaskReminders(rows));
  }, [standaloneTodos, matrixWeekTasks]);

  React.useEffect(() => {
    if (!categoryModalVisible) return;
    loadProjectCategories();
  }, [categoryModalVisible, loadProjectCategories]);

  const reload = React.useCallback(async (forceApi = false) => {
    const generation = ++reloadGenerationRef.current;
    const isStale = () => generation !== reloadGenerationRef.current;
    const forceApiRefresh = forceApi || consumeForceFullApiRefreshAfterLocalClear();
    const taskLoadOpts = forceApiRefresh ? { forceRefresh: true as const } : undefined;
    const projectTaskOpts = (extra?: { forceRefresh?: boolean; preloadedTasks?: TaskRow[] }) => ({
      ...extra,
      generation,
    });

    const logicalToday = logicalTodayYmd;
    const [storedExpanded, storedHideCompleted, storedMainListView] = await Promise.all([
      loadExpandedProjectState(),
      loadHideCompletedProjectTasks(),
      loadMainListView(),
    ]);
    if (isStale()) return;

    const pageData = await fetchTasksPageData({
      boundary: dayBoundary,
      taskTab,
      offlineFallback: true,
      forceLocal: false,
      forceRefresh: forceApiRefresh,
    });
    if (isStale()) return;

    const rows = pageData.projects;
    setProjects(rows);
    setProjectCategories(pageData.projectCategories);
    setStandaloneTodos(pageData.standaloneTodos);
    setMatrixWeekTasks(pageData.matrixWeekTasks);

    if (!storedExpanded) {
      const allCollapsed = Object.fromEntries(rows.map((p) => [p.id, false] as const));
      setExpandedProjectIds(allCollapsed);
      await saveExpandedProjectState(allCollapsed);
    } else {
      const merged: Record<string, boolean> = { ...storedExpanded };
      for (const p of rows) {
        if (typeof merged[p.id] !== 'boolean') merged[p.id] = false;
      }
      setExpandedProjectIds(merged);
      await saveExpandedProjectState(merged);
    }
    if (storedHideCompleted != null) {
      setHideCompletedProjectTasks(storedHideCompleted);
    }
    if (storedMainListView != null) {
      setMainListView(storedMainListView);
    }

    let cachedTasks = await getTasks(taskLoadOpts);
    if (isStale()) return;

    const effectiveHideCompleted = storedHideCompleted ?? hideCompletedProjectTasks;
    let treeMap = await loadProjectsListFromApi(projectTab, {
      forceRefresh: forceApiRefresh,
      generation,
      hideCompletedProjectTasks: effectiveHideCompleted,
    });
    skipProjectsListEffectOnceRef.current = true;
    projectTabApiReadyRef.current = true;
    if (isStale()) return;

    const archived = await autoArchiveProjectsPastDueIfNeeded(rows, treeMap, logicalToday);
    let workingRows = rows;
    if (archived > 0) {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      workingRows = await loadProjects();
      if (isStale()) return;
      cachedTasks = await getTasks(taskLoadOpts);
      treeMap = await loadProjectTasks(workingRows, projectTaskOpts({ ...taskLoadOpts, preloadedTasks: cachedTasks }));
      if (isStale()) return;
    }
    const catRows = pageData.projectCategories;
    if (isStale()) return;

    const reactivated = await reactivateInboxCompletedProjectsWithOpenTasks(workingRows, treeMap, catRows);
    if (reactivated > 0) {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      const refreshed = await loadProjects();
      if (isStale()) return;
      cachedTasks = await getTasks(taskLoadOpts);
      await loadProjectTasks(refreshed, projectTaskOpts({ ...taskLoadOpts, preloadedTasks: cachedTasks }));
      if (isStale()) return;
    }
    const purgedInbox = await deleteInboxProjectsPastRetentionDays(INBOX_PROJECT_RETENTION_DAYS);
    if (purgedInbox > 0) {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      const afterPurge = await loadProjects();
      if (isStale()) return;
      cachedTasks = await getTasks(taskLoadOpts);
      await loadProjectTasks(afterPurge, projectTaskOpts({ ...taskLoadOpts, preloadedTasks: cachedTasks }));
      if (isStale()) return;
    }
    const taskRolled = await loadTasks(taskLoadOpts);
    if (isStale()) return;
    if (taskRolled > 0) {
      cachedTasks = await getTasks(taskLoadOpts);
    }

    try {
      const habitSync = await syncAllHabitBoundTaskCompletions({ allTasks: cachedTasks });
      if (isStale()) return;
      if (habitSync.completedTasks.length > 0) {
        cachedTasks = await getTasks(taskLoadOpts);
        await loadTasks(taskLoadOpts);
        if (isStale()) return;
        await loadProjectTasks(workingRows, projectTaskOpts({ ...taskLoadOpts, preloadedTasks: cachedTasks }));
        if (isStale()) return;
      }
    } catch (err) {
      console.warn('批量同步习惯绑定任务失败', err);
    }

    if (taskRolled > 0) {
      await loadProjectTasks(workingRows, projectTaskOpts({ ...taskLoadOpts, preloadedTasks: cachedTasks }));
      if (isStale()) return;
    }
    await Promise.all([loadHabits(), loadTodayFrogs()]);
    if (isStale()) return;

    try {
      const wishRows = await listWishItems();
      if (!isStale()) {
        setWishNameById(new Map(wishRows.map((r) => [r.id, r.name])));
      }
    } catch {
      if (!isStale()) setWishNameById(new Map());
    }
  }, [
    loadExpandedProjectState,
    loadHideCompletedProjectTasks,
    loadMainListView,
    loadProjectCategories,
    loadProjects,
    loadProjectTasks,
    loadProjectsListFromApi,
    loadTasks,
    loadTodayFrogs,
    loadHabits,
    dayBoundary,
    logicalTodayYmd,
    taskTab,
    saveExpandedProjectState,
  ]);

  const reloadPage = React.useCallback(async (forceApi = false) => {
    try {
      await wrapLoad(async () => {
        await reload();
      }, forceApi);
      setInitialTasksLoadPending(false);
      setCompletionHeatmapReloadToken((n) => n + 1);
    } catch {
      setInitialTasksLoadPending(false);
    }
  }, [reload, wrapLoad]);

  const { refreshControl } = usePagePullRefresh(PAGE_API_KEY, reloadPage);

  usePageFocusReload(PAGE_API_KEY, reloadPage);

  const prevLogicalTodayYmdRef = React.useRef(logicalTodayYmd);
  React.useEffect(() => {
    if (prevLogicalTodayYmdRef.current === logicalTodayYmd) return;
    prevLogicalTodayYmdRef.current = logicalTodayYmd;
    void Promise.all([loadHabits(), loadTodayFrogs()]);
  }, [logicalTodayYmd, loadHabits, loadTodayFrogs]);

  const findVisibleTask = React.useCallback(
    (taskId: string): TaskRow | undefined =>
      standaloneTodos.find((t) => t.id === taskId) ??
      matrixWeekTasks.find((t) => t.id === taskId) ??
      findTaskRowInProjectTreeMap(projectTaskTreeMap, taskId) ??
      todayFrogs.find((t) => t.id === taskId),
    [standaloneTodos, matrixWeekTasks, projectTaskTreeMap, todayFrogs],
  );

  const patchVisibleTask = React.useCallback(
    (taskId: string, patch: Partial<TaskRow> | ((row: TaskRow) => TaskRow)) => {
      const apply = (row: TaskRow) => (typeof patch === 'function' ? patch(row) : { ...row, ...patch });
      setStandaloneTodos((prev) =>
        sortStandaloneTodosLocally(prev.map((t) => (t.id === taskId ? apply(t) : t))),
      );
      setMatrixWeekTasks((prev) => prev.map((t) => (t.id === taskId ? apply(t) : t)));
    },
    [],
  );

  const reloadMatrixWeekTasks = React.useCallback(async () => {
    try {
      const matrixProjectIds = resolveMatrixProjectIds(projects, taskTab);
      const matrix = await fetchMatrixWeekTasks({
        boundary: dayBoundary,
        projectIds: matrixProjectIds,
        taskTab,
        projects,
        offlineFallback: true,
      });
      setMatrixWeekTasks(matrix.tasks);
    } catch (err) {
      console.warn('加载本周列表失败', err);
    }
  }, [dayBoundary, projects, taskTab]);

  React.useEffect(() => {
    if (!projectTabApiReadyRef.current) return;
    void reloadMatrixWeekTasks();
  }, [taskTab, reloadMatrixWeekTasks]);

  const taskTitleById = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const t of standaloneTodos) map.set(t.id, t.title);
    for (const t of matrixWeekTasks) map.set(t.id, t.title);
    return map;
  }, [standaloneTodos, matrixWeekTasks]);

  const projectById = React.useMemo(() => {
    const map = new Map<string, ProjectRow>();
    projects.forEach((p) => map.set(p.id, p));
    return map;
  }, [projects]);

  const taskById = React.useMemo(() => {
    const map = new Map<string, TaskRow>();
    for (const t of standaloneTodos) map.set(t.id, t);
    for (const t of matrixWeekTasks) map.set(t.id, t);
    return map;
  }, [standaloneTodos, matrixWeekTasks]);

  const standaloneTodoOpenCount = React.useMemo(
    () => standaloneTodos.filter((t) => isStandaloneTodoOpen(t)).length,
    [standaloneTodos],
  );

  const frogCarouselCardWidth = React.useMemo(
    () => Math.min(196, Math.max(152, Dimensions.get('window').width * 0.46)),
    [],
  );

  const matrixGroups = React.useMemo(() => {
    const q11: TaskRow[] = [];
    const q10: TaskRow[] = [];
    const q01: TaskRow[] = [];
    const q00: TaskRow[] = [];

    const forMatrix = matrixWeekTasks.filter(
      (t) =>
        t.status !== 'done' &&
        t.status !== 'cancelled' &&
        (!!t.project_id || !!t.parent_task_id),
    );

    forMatrix.forEach((t) => {
      const p = getEffectiveTaskPriority(t, logicalTodayYmd);
      if (p >= 4) q11.push(t);
      else if (p === 2) q10.push(t);
      else if (p === 3) q01.push(t);
      else q00.push(t);
    });

    const sort = (arr: TaskRow[]) =>
      arr
        .slice()
        .sort((a, b) => {
          const doneA = a.status === 'done' || a.status === 'cancelled';
          const doneB = b.status === 'done' || b.status === 'cancelled';
          if (doneA !== doneB) return doneA ? 1 : -1;
          const dueA = a.due_date ? Date.parse(a.due_date) : Number.POSITIVE_INFINITY;
          const dueB = b.due_date ? Date.parse(b.due_date) : Number.POSITIVE_INFINITY;
          if (dueA !== dueB) return dueA - dueB;
          const updA = a.updated_at ? Date.parse(a.updated_at) : 0;
          const updB = b.updated_at ? Date.parse(b.updated_at) : 0;
          return updB - updA;
        });

    return { q11: sort(q11), q10: sort(q10), q01: sort(q01), q00: sort(q00) };
  }, [matrixWeekTasks, logicalTodayYmd]);

  const projectCategoryMap = React.useMemo(() => {
    const map = new Map<string, string>();
    projectCategories.forEach((category) => {
      map.set(category.id, category.name);
    });
    return map;
  }, [projectCategories]);

  const projectTabs = React.useMemo(() => {
    const base: Array<{ key: string; label: string }> = [
      { key: 'all', label: '全部' },
      { key: INBOX_PROJECT_CATEGORY_ID, label: INBOX_PROJECT_CATEGORY_NAME },
    ];
    const extra = projectCategories
      .filter((c) => c.id !== INBOX_PROJECT_CATEGORY_ID)
      .map((c) => ({ key: c.id, label: c.name }));
    return [...base, ...extra];
  }, [projectCategories]);

  const taskTabs = React.useMemo(() => {
    const base: Array<{ key: string; label: string }> = [{ key: 'all', label: '全部' }];
    const extra = projectCategories
      .filter((c) => c.id !== INBOX_PROJECT_CATEGORY_ID)
      .map((c) => ({ key: c.id, label: c.name }));
    return [...base, ...extra];
  }, [projectCategories]);

  const openTask = (id: string) => {
    const row = findVisibleTask(id);
    if (row && isStandaloneTodoTask(row)) {
      router.push(standaloneTodoEditorHref(id));
      return;
    }
    router.push({ pathname: '/task/[id]', params: { id } });
  };

  const openProject = (id: string) => {
    router.push({ pathname: '/edit-project', params: { id } });
  };

  const openQuickAddTaskForProject = (project: ProjectRow) => {
    router.push({
      pathname: '/add-task',
      params: {
        source: `tasks-quick-add-${project.id}`,
        projectId: project.id,
        categoryId: project.category_id ?? INBOX_PROJECT_CATEGORY_ID,
      },
    });
  };

  const updateTaskInProjectTree = React.useCallback(
    (treeMap: Record<string, TaskTreeNode[]>, taskId: string, updater: (node: TaskTreeNode) => TaskTreeNode) => {
      const updateNodes = (nodes: TaskTreeNode[]): TaskTreeNode[] => {
        let changed = false;
        const next = nodes.map((n) => {
          if (n.id === taskId) {
            changed = true;
            return { ...updater(n), children: n.children };
          }
          if (n.children?.length) {
            const updatedChildren = updateNodes(n.children);
            if (updatedChildren !== n.children) {
              changed = true;
              return { ...n, children: updatedChildren };
            }
          }
          return n;
        });
        return changed ? next : nodes;
      };

      let anyChanged = false;
      const nextMap: Record<string, TaskTreeNode[]> = {};
      for (const [projectId, nodes] of Object.entries(treeMap)) {
        const nextNodes = updateNodes(nodes);
        if (nextNodes !== nodes) anyChanged = true;
        nextMap[projectId] = nextNodes;
      }
      return anyChanged ? nextMap : treeMap;
    },
    []
  );

  const applyHabitBoundTaskSyncResult = React.useCallback(
    (result: CompleteTasksBoundToHabitResult) => {
      const changes = [...result.completedTasks, ...result.cascadeChanges];
      if (changes.length === 0) return;
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setStandaloneTodos((prev) =>
        sortStandaloneTodosLocally(
          prev.map((task) => {
            const change = changes.find((item) => item.id === task.id);
            if (!change) return task;
            return { ...task, status: change.status, completed_at: change.completed_at };
          }),
        ),
      );
      setMatrixWeekTasks((prev) =>
        prev.map((task) => {
          const change = changes.find((item) => item.id === task.id);
          if (!change) return task;
          return { ...task, status: change.status, completed_at: change.completed_at };
        }),
      );
      setProjectTaskTreeMap((prev) => {
        let next = prev;
        for (const change of changes) {
          next = updateTaskInProjectTree(next, change.id, (node) => ({
            ...node,
            status: change.status,
            completed_at: change.completed_at,
          }));
        }
        return next;
      });
    },
    [updateTaskInProjectTree],
  );

  const syncHabitBoundTasksForHabit = React.useCallback(
    async (habitId: string, todayCount?: number) => {
      try {
        const result = await completeTasksBoundToHabitIfGoalMet(habitId, { todayCount });
        applyHabitBoundTaskSyncResult(result);
      } catch (err) {
        console.warn('同步习惯绑定任务完成状态失败', err);
      }
    },
    [applyHabitBoundTaskSyncResult],
  );

  const getFrogDoneBounce = React.useCallback((taskId: string) => {
    if (!frogDoneBounceMap.current[taskId]) {
      frogDoneBounceMap.current[taskId] = new Animated.Value(1);
    }
    return frogDoneBounceMap.current[taskId];
  }, []);

  const playFrogDoneBounce = React.useCallback(
    (taskId: string) => {
      const anim = getFrogDoneBounce(taskId);
      anim.stopAnimation(() => {
        anim.setValue(1);
        Animated.sequence([
          Animated.timing(anim, {
            toValue: 1.28,
            duration: 120,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.spring(anim, {
            toValue: 1,
            speed: 18,
            bounciness: 9,
            useNativeDriver: true,
          }),
        ]).start();
      });
    },
    [getFrogDoneBounce]
  );

  const unassignFrog = React.useCallback(
    (taskId: string) => {
      const frog = findVisibleTask(taskId);
      if (!frog) return;
      const titleLabel = (frog.title ?? '').trim() || '该任务';
      Alert.alert('取消指派', `确定将「${titleLabel}」从今日青蛙中移除吗？`, [
        { text: '保留', style: 'cancel' },
        {
          text: '取消指派',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              markPageDirty();
              const nextExtra = clearFrogAssignedOn(frog.extra_data);
              LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
              patchVisibleTask(taskId, { extra_data: nextExtra });
              setTodayFrogs((prev) => prev.filter((t) => t.id !== taskId));
              setProjectTaskTreeMap((prev) =>
                updateTaskInProjectTree(prev, taskId, (node) => ({ ...node, extra_data: nextExtra }))
              );
              try {
                await unassignFrogFromApi(taskId, frog.extra_data, frog as Record<string, unknown>);
                await loadTodayFrogs({ forceLocal: true });
              } catch (err) {
                console.warn('取消青蛙指派失败', err);
                Alert.alert('操作失败', '未能取消指派，请稍后重试。');
                await loadTasks({ forceLocal: true });
                await loadTodayFrogs({ forceLocal: true });
                await loadProjectTasks(projects);
              }
            })();
          },
        },
      ]);
    },
    [findVisibleTask, loadProjectTasks, loadTasks, loadTodayFrogs, markPageDirty, patchVisibleTask, projects, projectTaskTreeMap, todayFrogs, updateTaskInProjectTree]
  );

  const moveProjectToInboxById = React.useCallback(async (projectId: string) => {
    try {
      await runExclusiveMutation('正在收纳项目...', async () => {
        markPageDirty();
        const proj = projects.find((p) => p.id === projectId) ?? (await getProjectById(projectId));
        await updateProject(projectId, {
          category_id: INBOX_PROJECT_CATEGORY_ID,
          status: 'completed',
        });
        if (proj) {
          await tryGrantProjectCompletionReward(proj);
        }
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        projectSwipeableRefs.current[projectId]?.close();
        await loadProjects();
      }, '项目已收纳');
    } catch (err) {
      console.warn('收纳项目失败', err);
      Alert.alert('操作失败', '未能将项目移至收集箱，请稍后重试。');
    }
  }, [loadProjects, markPageDirty, projects, runExclusiveMutation]);

  const handleProjectSwipeArchive = React.useCallback(
    (project: ProjectRow) => {
      const tree = projectTaskTreeMap[project.id] ?? [];
      if (!isProjectInboxProgressComplete(project, tree)) {
        Alert.alert(
          '暂时无法收纳',
          '请先完成项目内的全部任务（或将任务标记为取消）后，再将项目归纳到收集箱。',
        );
        projectSwipeableRefs.current[project.id]?.close();
        return;
      }
      void moveProjectToInboxById(project.id);
    },
    [moveProjectToInboxById, projectTaskTreeMap]
  );

  const confirmDeleteInboxProject = React.useCallback(
    (project: ProjectRow) => {
      projectSwipeableRefs.current[project.id]?.close();
      void (async () => {
        let message = `确定彻底删除「${project.name}」吗？删除后无法在本地找回（含其下全部任务）。`;
        try {
          const incomplete = await countIncompleteTasksByProjectId(project.id);
          if (incomplete > 0) {
            message = `「${project.name}」下仍有 ${incomplete} 个未完成任务。\n\n确定连同项目与全部任务一并彻底删除吗？删除后无法在本地找回。`;
          }
        } catch (err) {
          console.warn('统计项目未完成任务失败', err);
        }
        Alert.alert('删除项目', message, [
          { text: '取消', style: 'cancel' },
          {
            text: '删除',
            style: 'destructive',
            onPress: async () => {
              try {
                await runExclusiveMutation('正在删除项目...', async () => {
                  markPageDirty();
                  LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                  await deleteProject(project.id);
                  await markPendingTablesDirty(['projects', 'tasks']);
                  await pushLocalChangesToApi({ awaitSync: true, rethrow: true });
                  const rows = await loadProjects();
                  await loadProjectTasks(rows);
                  await loadProjectsListFromApi(projectTab, { replaceMap: true });
                }, '项目已删除');
              } catch (err) {
                console.warn('删除收集箱项目失败', err);
                Alert.alert('删除失败', formatWriteError(err, '项目删除失败，请稍后重试。'));
                await loadProjects();
              }
            }, 
          },
        ]);
      })();
    },
    [loadProjectTasks, loadProjects, loadProjectsListFromApi, markPageDirty, projectTab, runExclusiveMutation]
  );

  const activateShelvedTodo = React.useCallback(
    async (taskId: string) => {
      if (activatingShelvedTodoId || upgradingStandaloneTodoId) return;
      const current = findVisibleTask(taskId);
      if (!current || !isTaskShelvedStatus(current.status)) return;

      standaloneTodoSwipeableRefs.current[taskId]?.close();
      markPageDirty();
      setActivatingShelvedTodoId(taskId);
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      patchVisibleTask(taskId, { status: 'todo', completed_at: null });

      try {
        await updateTask(taskId, { status: 'todo', completed_at: null });
        try {
          await insertTaskExecutionEvent(taskId, 'reopened', current.title ?? null);
        } catch (logErr) {
          console.warn('记录待办激活事件失败', logErr);
        }
      } catch (err) {
        console.warn('激活搁置待办失败', err);
        Alert.alert('激活失败', '请稍后重试。');
        await loadTasks();
      } finally {
        setActivatingShelvedTodoId(null);
      }
    },
    [activatingShelvedTodoId, findVisibleTask, loadTasks, markPageDirty, patchVisibleTask, upgradingStandaloneTodoId]
  );

  const confirmActivateShelvedTodo = React.useCallback(
    (taskId: string, titleLabel: string) => {
      Alert.alert(
        '激活待办',
        `确定将「${titleLabel}」激活为正常待办吗？激活后可安排日程并勾选完成。`,
        [
          { text: '取消', style: 'cancel' },
          {
            text: '激活',
            onPress: () => void activateShelvedTodo(taskId),
          },
        ]
      );
    },
    [activateShelvedTodo]
  );

  const toggleTaskDone = React.useCallback(
    async (taskId: string) => {
      const current = findVisibleTask(taskId) ?? findTaskRowInProjectTreeMap(projectTaskTreeMap, taskId);
      if (!current) return;

      if (isTaskShelvedStatus(current.status)) return;

      if (current.project_id && lockedProjectIds.has(current.project_id)) {
        alertProjectTaskLocked(projectLockMap.get(current.project_id));
        return;
      }

      markPageDirty();

      const wasDone = isTaskTerminalStatus(current.status);
      const nextStatus: TaskRow['status'] = wasDone ? 'todo' : 'done';
      const nextCompletedAt = wasDone ? null : formatTaskAuditDatetimeLocal();
      let nextExtraData = current.extra_data;
      if (taskHasRepeatingSchedule(current.extra_data)) {
        if (nextStatus === 'done') {
          nextExtraData = patchExtraDataOnRepeatTaskComplete(current.extra_data, logicalTodayYmd);
        } else if (wasDone) {
          nextExtraData = patchExtraDataOnRepeatTaskReopen(current.extra_data);
        }
      }
      if (nextStatus === 'done' || wasDone) {
        nextExtraData = clearFrogSessionCompletedOn(nextExtraData);
      }

      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);

      // optimistic update: 待办/矩阵、今日青蛙、项目树
      patchVisibleTask(taskId, {
        status: nextStatus,
        completed_at: nextCompletedAt,
        extra_data: nextExtraData,
      });
      setTodayFrogs((prev) =>
        prev.map((t) =>
          t.id === taskId
            ? { ...t, status: nextStatus, completed_at: nextCompletedAt, extra_data: nextExtraData }
            : t
        )
      );
      setProjectTaskTreeMap((prev) =>
        sortProjectTaskTreeMap(
          updateTaskInProjectTree(prev, taskId, (node) => ({
            ...node,
            status: nextStatus,
            completed_at: nextCompletedAt,
            extra_data: nextExtraData,
          })),
        ),
      );

      try {
        await persistTaskPatchToApi(
          taskId,
          {
            status: nextStatus,
            completed_at: nextCompletedAt,
            extra_data: nextExtraData,
          },
          current as Record<string, unknown>,
        );
        const frogAssigned = (parseTaskMeta(current.extra_data).frogAssignedOn ?? '').trim();
        const frogAssignedValid = /^\d{4}-\d{2}-\d{2}$/.test(frogAssigned);
        // 待办热力图仅统计无项目待办；青蛙完成走 frog_completion_events，避免同一任务重复计入
        if (isStandaloneTodoTask(current) && !frogAssignedValid) {
          try {
            await insertTaskExecutionEvent(taskId, wasDone ? 'reopened' : 'completed', current.title ?? null);
          } catch (logErr) {
            console.warn('记录待办执行事件失败', logErr);
          }
        }
        if (nextStatus === 'done') {
          await tryGrantTaskCompletionReward({
            id: current.id,
            title: current.title,
            extra_data: nextExtraData,
          });
        }
        if (frogAssignedValid) {
          try {
            await insertFrogCompletionEvent(
              taskId,
              frogAssigned,
              wasDone ? 'reopened' : 'completed',
              current.title ?? null
            );
          } catch (frogLogErr) {
            console.warn('记录青蛙完成事件失败', frogLogErr);
          }
        }
        const cascadeChanges = await cascadeParentTaskStatusAfterChildChange(taskId, nextStatus === 'done');
        if (cascadeChanges.length > 0) {
          LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
          for (const change of cascadeChanges) {
            patchVisibleTask(change.id, {
              status: change.status,
              completed_at: change.completed_at,
            });
            const cascadeRow =
              findVisibleTask(change.id) ?? findTaskRowInProjectTreeMap(projectTaskTreeMap, change.id);
            if (cascadeRow && isStandaloneTodoTask(cascadeRow)) {
              try {
                await insertTaskExecutionEvent(
                  change.id,
                  change.status === 'done' ? 'completed' : 'reopened',
                  change.title ?? null,
                );
              } catch (logErr) {
                console.warn('记录父任务级联执行事件失败', logErr);
              }
            }
            if (change.status === 'done') {
              await tryGrantTaskCompletionReward({
                id: change.id,
                title: change.title,
                extra_data: change.extra_data,
              });
            }
          }
          setProjectTaskTreeMap((prev) => {
            let next = prev;
            for (const change of cascadeChanges) {
              next = updateTaskInProjectTree(next, change.id, (node) => ({
                ...node,
                status: change.status,
                completed_at: change.completed_at,
              }));
            }
            return sortProjectTaskTreeMap(next);
          });
        }
        setCompletionHeatmapReloadToken((n) => n + 1);
        if (nextStatus === 'done' && current.project_id) {
          const pid = current.project_id;
          const proj = projects.find((p) => p.id === pid);
          if (
            proj &&
            proj.status !== 'completed' &&
            proj.status !== 'archived' &&
            !isProjectInInboxCategory(proj.category_id)
          ) {
            let nextTreeMap = updateTaskInProjectTree(projectTaskTreeMap, taskId, (node) => ({
              ...node,
              status: nextStatus,
              completed_at: nextCompletedAt,
              extra_data: nextExtraData,
            }));
            for (const change of cascadeChanges) {
              nextTreeMap = updateTaskInProjectTree(nextTreeMap, change.id, (node) => ({
                ...node,
                status: change.status,
                completed_at: change.completed_at,
              }));
            }
            const tree = nextTreeMap[pid] ?? [];
            if (isProjectInboxProgressComplete(proj, tree)) {
              showMoveProjectToInboxPrompt(proj, () => void moveProjectToInboxById(pid));
            }
          }
        }
        if (current.project_id) {
          const pid = current.project_id;
          void (async () => {
            try {
              const proj = await getProjectById(pid);
              if (!proj || proj.status !== 'completed' || !isProjectInInboxCategory(proj.category_id)) return;
              const tree = await getTasksByProjectId(pid);
              const cats = await getProjectCategories();
              const n = await reactivateInboxCompletedProjectsWithOpenTasks([proj], { [pid]: tree }, cats);
              if (n > 0) {
                LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                const rr = await loadProjects();
                await loadProjectTasks(rr);
              }
            } catch (e) {
              console.warn('收集箱已完成项目恢复状态同步失败', e);
            }
          })();
        }
        await loadTodayFrogs({ forceLocal: true });
        if (isTaskInProjectListScope(current, projectTaskTreeMap, taskId)) {
          await reloadProjectTasksFromLocal();
        } else {
          await loadTasks({ forceLocal: true });
        }
      } catch (err) {
        console.warn('更新任务状态失败', err);
        // fallback: reload to ensure consistency
        await loadTodayFrogs({ forceLocal: true });
        if (isTaskInProjectListScope(current, projectTaskTreeMap, taskId)) {
          await reloadProjectTasksFromLocal();
        } else {
          await loadTasks({ forceLocal: true });
          await loadProjectTasks(projects);
        }
      }
    },
    [
      findVisibleTask,
      loadProjectTasks,
      loadProjects,
      loadTasks,
      loadTodayFrogs,
      lockedProjectIds,
      logicalTodayYmd,
      markPageDirty,
      moveProjectToInboxById,
      patchVisibleTask,
      projectLockMap,
      projectTaskTreeMap,
      projects,
      reloadProjectTasksFromLocal,
      updateTaskInProjectTree,
    ]
  );

  const completeFrogSessionOnly = React.useCallback(
    async (taskId: string) => {
      const current =
        findVisibleTask(taskId) ?? findTaskRowInProjectTreeMap(projectTaskTreeMap, taskId);
      if (!current) return;

      if (current.project_id && lockedProjectIds.has(current.project_id)) {
        alertProjectTaskLocked(projectLockMap.get(current.project_id));
        return;
      }

      const frogAssigned = getFrogAssignedOn(current.extra_data);
      if (frogAssigned !== logicalTodayYmd) return;

      markPageDirty();
      const nextExtraData = setFrogSessionCompletedOn(current.extra_data, logicalTodayYmd);

      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      patchVisibleTask(taskId, { extra_data: nextExtraData });
      setTodayFrogs((prev) =>
        prev.map((t) => (t.id === taskId ? { ...t, extra_data: nextExtraData } : t))
      );
      setProjectTaskTreeMap((prev) =>
        updateTaskInProjectTree(prev, taskId, (node) => ({ ...node, extra_data: nextExtraData }))
      );

      try {
        await persistTaskFrogExtraToApi(
          taskId,
          nextExtraData,
          current as Record<string, unknown>,
        );
        try {
          await insertFrogCompletionEvent(taskId, frogAssigned, 'completed', current.title ?? null);
        } catch (frogLogErr) {
          console.warn('记录青蛙完成事件失败', frogLogErr);
        }
        setCompletionHeatmapReloadToken((n) => n + 1);
        await loadTodayFrogs({ forceLocal: true });
        if (isTaskInProjectListScope(current, projectTaskTreeMap, taskId)) {
          await reloadProjectTasksFromLocal();
        } else {
          await loadTasks({ forceLocal: true });
        }
      } catch (err) {
        console.warn('完成青蛙会话失败', err);
        Alert.alert('操作失败', '未能完成今日青蛙，请稍后重试。');
        await loadTasks({ forceLocal: true });
        await loadTodayFrogs({ forceLocal: true });
        await loadProjectTasks(projects);
      }
    },
    [
      findVisibleTask,
      loadProjectTasks,
      loadTasks,
      loadTodayFrogs,
      lockedProjectIds,
      logicalTodayYmd,
      markPageDirty,
      patchVisibleTask,
      projectLockMap,
      projectTaskTreeMap,
      projects,
      reloadProjectTasksFromLocal,
      updateTaskInProjectTree,
    ]
  );

  const reopenFrogSessionOnly = React.useCallback(
    async (taskId: string) => {
      const current =
        findVisibleTask(taskId) ?? findTaskRowInProjectTreeMap(projectTaskTreeMap, taskId);
      if (!current) return;

      const frogAssigned = getFrogAssignedOn(current.extra_data);
      if (frogAssigned !== logicalTodayYmd) return;

      markPageDirty();
      const nextExtraData = clearFrogSessionCompletedOn(current.extra_data);

      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      patchVisibleTask(taskId, { extra_data: nextExtraData });
      setTodayFrogs((prev) =>
        prev.map((t) => (t.id === taskId ? { ...t, extra_data: nextExtraData } : t))
      );
      setProjectTaskTreeMap((prev) =>
        updateTaskInProjectTree(prev, taskId, (node) => ({ ...node, extra_data: nextExtraData }))
      );

      try {
        await persistTaskFrogExtraToApi(
          taskId,
          nextExtraData,
          current as Record<string, unknown>,
        );
        try {
          await insertFrogCompletionEvent(taskId, frogAssigned, 'reopened', current.title ?? null);
        } catch (frogLogErr) {
          console.warn('记录青蛙重开事件失败', frogLogErr);
        }
        setCompletionHeatmapReloadToken((n) => n + 1);
        await loadTodayFrogs({ forceLocal: true });
        if (isTaskInProjectListScope(current, projectTaskTreeMap, taskId)) {
          await reloadProjectTasksFromLocal();
        } else {
          await loadTasks({ forceLocal: true });
        }
      } catch (err) {
        console.warn('恢复青蛙会话失败', err);
        Alert.alert('操作失败', '未能恢复今日青蛙，请稍后重试。');
        await loadTasks({ forceLocal: true });
        await loadTodayFrogs({ forceLocal: true });
        await loadProjectTasks(projects);
      }
    },
    [
      findVisibleTask,
      loadProjectTasks,
      loadTasks,
      loadTodayFrogs,
      logicalTodayYmd,
      markPageDirty,
      patchVisibleTask,
      projectTaskTreeMap,
      projects,
      reloadProjectTasksFromLocal,
      updateTaskInProjectTree,
    ]
  );

  const toggleFrogDone = React.useCallback(
    (taskId: string) => {
      const current = findVisibleTask(taskId);
      if (!current || isTaskShelvedStatus(current.status)) return;

      const frogAssigned = getFrogAssignedOn(current.extra_data);
      const isAssignedToday = frogAssigned === logicalTodayYmd;
      const frogDone = isFrogDoneForToday(current.extra_data, current.status, logicalTodayYmd);

      if (frogDone && !isTaskTerminalStatus(current.status)) {
        playFrogDoneBounce(taskId);
        void reopenFrogSessionOnly(taskId);
        return;
      }

      if (frogDone) {
        playFrogDoneBounce(taskId);
        void toggleTaskDone(taskId);
        return;
      }

      if (isAssignedToday && getIsLongTermTask(current.extra_data)) {
        const titleLabel = (current.title ?? '').trim() || '该任务';
        Alert.alert(
          '完成长期任务？',
          `「${titleLabel}」是长期任务。是否已完成此任务？`,
          [
            { text: '取消', style: 'cancel' },
            {
              text: '还未完成',
              onPress: () => {
                playFrogDoneBounce(taskId);
                void completeFrogSessionOnly(taskId);
              },
            },
            {
              text: '完成',
              onPress: () => {
                playFrogDoneBounce(taskId);
                void toggleTaskDone(taskId);
              },
            },
          ]
        );
        return;
      }

      playFrogDoneBounce(taskId);
      void toggleTaskDone(taskId);
    },
    [
      completeFrogSessionOnly,
      findVisibleTask,
      logicalTodayYmd,
      playFrogDoneBounce,
      reopenFrogSessionOnly,
      todayFrogs,
      toggleTaskDone,
    ]
  );

  /** 从任务 Tab 底部快捷创建「无项目」待办 */
  const submitQuickStandaloneTodo = React.useCallback(async () => {
    const title = quickTodoDraft.trim();
    if (!title) {
      Alert.alert('提示', '请先输入待办内容。');
      return;
    }
    if (quickTodoSaving || mutationInFlightRef.current) return;
    setQuickTodoSaving(true);
    const id = makeTimestampEntityId('tsk_', 8);
    const now = formatTaskAuditDatetimeLocal();
    const optimisticTask: TaskRow = {
      id,
      project_id: null,
      category_id: null,
      parent_task_id: null,
      title,
      description: null,
      note: null,
      status: 'todo',
      priority: 0,
      due_date: null,
      completed_at: null,
      created_at: now,
      updated_at: now,
      sync_status: 'pending_create',
      extra_data: null,
      sort_order: 0,
    };
    try {
      await runExclusiveMutation('正在保存待办...', async () => {
        markPageDirty();
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setStandaloneTodos((prev) => sortStandaloneTodosLocally([optimisticTask, ...prev]));
        setQuickTodoDraft('');
        await createTask({
          id,
          project_id: null,
          category_id: null,
          parent_task_id: null,
          title,
          note: null,
          status: 'todo',
          priority: 0,
          due_date: null,
          extra_data: null,
        });
        await loadTasks();
      }, '待办已保存');
    } catch (err) {
      console.warn('创建无项目待办失败', err);
      Alert.alert('保存失败', formatWriteError(err, '待办未能写入，请稍后重试。'));
      await loadTasks();
    } finally {
      setQuickTodoSaving(false);
    }
  }, [loadTasks, markPageDirty, quickTodoDraft, quickTodoSaving, runExclusiveMutation]);

  /** 左滑删除：软删除整棵子树，并刷新列表（与 DB deleteTask 行为一致） */
  const handleUpgradeStandaloneTodo = React.useCallback(
    async (taskId: string) => {
      if (upgradingStandaloneTodoId || mutationInFlightRef.current) return;
      standaloneTodoSwipeableRefs.current[taskId]?.close();
      setUpgradingStandaloneTodoId(taskId);
      try {
        const result = await runExclusiveMutation('正在升级待办...', async () => {
          markPageDirty();
          const upgradeResult = await upgradeStandaloneTodoToProject(taskId);
          if (!upgradeResult.ok) return upgradeResult;
          LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
          const rows = await loadProjects();
          await loadTasks();
          await loadProjectTasks(rows);
          setExpandedProjectIds((prev) => {
            const next = { ...prev, [upgradeResult.projectId]: true };
            void saveExpandedProjectState(next);
            return next;
          });
          return upgradeResult;
        });
        if (!result) return;
        if (!result.ok) {
          Alert.alert('无法升级', result.message);
          return;
        }
        showOperationToast('success', '待办已升级为项目');
        Alert.alert('已升级为项目', `「${result.projectName}」已创建，原待办成为项目下的主任务。`);
      } catch (err) {
        console.warn('待办升级为项目失败', err);
        Alert.alert('升级失败', '请稍后重试。');
        await loadTasks();
      } finally {
        setUpgradingStandaloneTodoId(null);
      }
    },
    [
      loadProjectTasks,
      loadProjects,
      loadTasks,
      markPageDirty,
      saveExpandedProjectState,
      showOperationToast,
      upgradingStandaloneTodoId,
    ]
  );

  const confirmDeleteStandaloneTodo = React.useCallback(
    (taskId: string, titleLabel: string) => {
      standaloneTodoSwipeableRefs.current[taskId]?.close();
      Alert.alert('删除待办', `确定删除「${titleLabel}」吗？（若有子任务会一并删除）`, [
        { text: '取消', style: 'cancel' },
        {
          text: '删除',
          style: 'destructive',
          onPress: async () => {
            try {
              await runExclusiveMutation('正在删除待办...', async () => {
                markPageDirty();
                LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                await deleteTask(taskId);
                await loadTasks();
                await loadProjectTasks(projects);
              }, '待办已删除');
            } catch (err) {
              console.warn('删除待办失败', err);
              Alert.alert('删除失败', formatWriteError(err, '任务删除失败，请稍后重试。'));
              await loadTasks();
            }
          },
        },
      ]);
    },
    [loadProjectTasks, loadTasks, markPageDirty, projects, runExclusiveMutation]
  );

  const openStandaloneTaskComposer = React.useCallback(() => {
    router.push({ pathname: '/add-task', params: { standalone: '1' } });
  }, [router]);

  const openCategoryMenu = (_scope: 'task' | 'project', label: string, categoryId: string | null = null) => {
    setActiveCategoryLabel(label);
    setActiveCategoryId(categoryId);
    setCategoryInputValue(label);
    setCategoryModalVisible(true);
  };

  const toggleProjectExpand = React.useCallback(
    (projectId: string) => {
      setExpandedProjectIds((prev) => {
        const next = { ...prev, [projectId]: !prev[projectId] };
        void saveExpandedProjectState(next);
        return next;
      });
    },
    [saveExpandedProjectState]
  );

  const toggleTaskCollapse = React.useCallback((taskId: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setCollapsedTaskIds((prev) => ({ ...prev, [taskId]: !prev[taskId] }));
  }, []);

  const toggleHabitSection = React.useCallback((sectionId: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedHabitSections((prev) => ({ ...prev, [sectionId]: !prev[sectionId] }));
  }, []);


  const patchHabitTodayCount = React.useCallback(
    (
      habitId: string,
      todayCount: number,
      periodDelta = 0,
      opts?: { hasTodayRecord?: boolean },
    ) => {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setHabitSections((prev) =>
        patchHabitSectionsCount(prev, habitId, todayCount, periodDelta, {
          hasTodayRecord: opts?.hasTodayRecord,
          logicalTodayYmd,
        }),
      );
    },
    [logicalTodayYmd],
  );

  const restoreHabitGridItem = React.useCallback((snapshot: HabitGridItem) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setHabitSections((prev) =>
      prev.map((sec) => ({
        ...sec,
        items: sec.items.map((it) => (it.id === snapshot.id ? snapshot : it)),
      }))
    );
  }, []);

  const maybeCompleteBreakHabit = React.useCallback(
    async (habitId: string) => {
      try {
        const habit = await getHabitById(habitId);
        if (!habit || parseHabitKind(habit.extra_data) !== 'break') return;
        if (isBreakHabitSucceeded(habit.extra_data)) return;
        const todayYmd = getLogicalLocalYmd(new Date(), dayBoundary);
        const marked = await tryMarkBreakHabitCompleted(habit, todayYmd);
        if (marked) {
          await loadHabits();
          await syncHabitBoundTasksForHabit(habitId);
        }
      } catch (err) {
        console.warn('检测戒除习惯完成状态失败', err);
      }
    },
    [dayBoundary, loadHabits, syncHabitBoundTasksForHabit]
  );

  const maybeCompleteBuildHabit = React.useCallback(
    async (habitId: string) => {
      try {
        const habit = await getHabitById(habitId);
        if (!habit || parseHabitKind(habit.extra_data) !== 'build') return;
        if (isBuildHabitSucceeded(habit.extra_data)) return;
        const todayYmd = getLogicalLocalYmd(new Date(), dayBoundary);
        const marked = await tryMarkBuildHabitCompleted(habit, todayYmd);
        if (marked) {
          await loadHabits();
          await syncHabitBoundTasksForHabit(habitId);
        }
      } catch (err) {
        console.warn('检测养成习惯完成状态失败', err);
      }
    },
    [dayBoundary, loadHabits, syncHabitBoundTasksForHabit]
  );

  const maybeRefreshTaskHabitVisibility = React.useCallback(
    async (habitId: string) => {
      try {
        const habit = await getHabitById(habitId);
        if (!habit || parseHabitKind(habit.extra_data) !== 'task') return;
        await loadHabits();
      } catch (err) {
        console.warn('检测完成任务周期状态失败', err);
      }
    },
    [loadHabits]
  );

  const runHabitSideEffectsAfterCountChange = React.useCallback(
    (habitId: string, nextCount: number, opts?: { skipHabitReload?: boolean }) => {
      void maybeCompleteBreakHabit(habitId);
      void maybeCompleteBuildHabit(habitId);
      void maybeRefreshTaskHabitVisibility(habitId);
      void syncHabitBoundTasksForHabit(habitId, nextCount);
      if (!opts?.skipHabitReload) void loadHabits();
      void resyncHabitReminderForHabitId(habitId);
    },
    [
      loadHabits,
      maybeCompleteBreakHabit,
      maybeCompleteBuildHabit,
      maybeRefreshTaskHabitVisibility,
      syncHabitBoundTasksForHabit,
    ]
  );

  const handleHabitIncrement = React.useCallback(
    async (item: HabitGridItem) => {
      if (habitCheckInLockRef.current.has(item.id)) return;
      habitCheckInLockRef.current.add(item.id);
      habitLoadGenerationRef.current += 1;
      markPageDirty();
      const optimistic = optimisticHabitCountDelta(item, 1);
      if (optimistic) {
        patchHabitTodayCount(item.id, optimistic.nextCount, optimistic.periodDelta, {
          hasTodayRecord: optimistic.hasTodayRecord,
        });
      }
      try {
        const { nextCount, increased } = await incrementTodayHabitCheckIn(item.id, item.incrementCap);
        if (!optimistic || nextCount !== optimistic.nextCount) {
          patchHabitTodayCount(item.id, nextCount, increased && item.kind === 'task' ? 1 : 0, {
            hasTodayRecord: item.kind === 'break' ? true : undefined,
          });
        }
        if (increased) void playHabitCheckInDing();
        runHabitSideEffectsAfterCountChange(item.id, nextCount);
      } catch (err) {
        console.warn('习惯打卡失败', err);
        restoreHabitGridItem(item);
      } finally {
        habitCheckInLockRef.current.delete(item.id);
      }
    },
    [markPageDirty, patchHabitTodayCount, restoreHabitGridItem, runHabitSideEffectsAfterCountChange]
  );

  const handleBreakHabitConfirmClean = React.useCallback(
    async (item: HabitGridItem) => {
      if (habitCheckInLockRef.current.has(item.id)) return;
      habitCheckInLockRef.current.add(item.id);
      habitLoadGenerationRef.current += 1;
      markPageDirty();
      patchHabitTodayCount(item.id, 0, 0, { hasTodayRecord: true });
      try {
        await confirmBreakHabitDayClean(item.id, logicalTodayYmd);
        runHabitSideEffectsAfterCountChange(item.id, 0, { skipHabitReload: true });
      } catch (err) {
        console.warn('确认保持戒除失败', err);
        restoreHabitGridItem(item);
        Alert.alert(
          '确认失败',
          err instanceof Error && err.message.trim() ? err.message : '保持戒除未能保存，请稍后重试',
        );
      } finally {
        habitCheckInLockRef.current.delete(item.id);
      }
    },
    [
      logicalTodayYmd,
      markPageDirty,
      patchHabitTodayCount,
      restoreHabitGridItem,
      runHabitSideEffectsAfterCountChange,
    ],
  );

  const handleHabitUndoOnce = React.useCallback(
    async (item: HabitGridItem) => {
      if (habitCheckInLockRef.current.has(item.id)) return;
      habitCheckInLockRef.current.add(item.id);
      habitLoadGenerationRef.current += 1;
      markPageDirty();
      const optimistic = optimisticHabitCountDelta(item, -1);
      if (optimistic) {
        patchHabitTodayCount(item.id, optimistic.nextCount, optimistic.periodDelta, {
          hasTodayRecord: optimistic.hasTodayRecord,
        });
      }
      try {
        const nextCount = await decrementTodayHabitCheckIn(item.id, {
          breakHabit: item.kind === 'break',
        });
        if (!optimistic || nextCount !== optimistic.nextCount) {
          const periodDelta = item.kind === 'task' && nextCount < item.todayCount ? -1 : 0;
          patchHabitTodayCount(item.id, nextCount, periodDelta, {
            hasTodayRecord: item.kind === 'break' ? nextCount > 0 : undefined,
          });
        }
        runHabitSideEffectsAfterCountChange(item.id, nextCount);
      } catch (err) {
        console.warn('撤销打卡失败', err);
        restoreHabitGridItem(item);
      } finally {
        habitCheckInLockRef.current.delete(item.id);
      }
    },
    [markPageDirty, patchHabitTodayCount, restoreHabitGridItem, runHabitSideEffectsAfterCountChange]
  );

  const openSubHabitModal = React.useCallback((item: HabitGridItem) => {
    const meta = parseHabitSubHabitsMeta(item.extraData);
    const subHabits =
      item.subHabits && item.subHabits.length > 0 ? item.subHabits : meta.items;
    if (!(item.hasSubHabits || hasActiveSubHabits(item.extraData)) || subHabits.length === 0) return;
    setSubHabitModal({
      habitId: item.id,
      name: item.name,
      icon: item.icon,
      subHabits,
      doneMap: getSubHabitDoneMapForYmd(item.extraData, logicalTodayYmd),
    });
  }, [logicalTodayYmd]);

  const handleSubHabitToggle = React.useCallback(
    async (subHabitId: string) => {
      if (!subHabitModal || subHabitTogglingId) return;
      const prevDone = Boolean(subHabitModal.doneMap[subHabitId]);
      const nextDone = !prevDone;
      setSubHabitTogglingId(subHabitId);
      setSubHabitModal((prev) =>
        prev
          ? { ...prev, doneMap: { ...prev.doneMap, [subHabitId]: nextDone } }
          : prev,
      );
      markPageDirty();
      try {
        const result = await toggleSubHabitCheckIn({
          habitId: subHabitModal.habitId,
          subHabitId,
          ymd: logicalTodayYmd,
          done: nextDone,
        });
        if (nextDone) void playHabitCheckInDing();
        const completedCount = result.completedCount;
        const total = result.total;
        patchHabitTodayCount(subHabitModal.habitId, completedCount, 0);
        setHabitSections((prev) =>
          prev.map((sec) => ({
            ...sec,
            items: sec.items.map((it) => {
              if (it.id !== subHabitModal.habitId) return it;
              return {
                ...it,
                todayCount: completedCount,
                dailyGoal: total,
                displayCompleted: result.allDone,
                hasSubHabits: true,
                subHabits: subHabitModal.subHabits,
                subHabitCompletedCount: completedCount,
                extraData: result.extraData,
                incrementCap: total,
              };
            }),
          })),
        );
        runHabitSideEffectsAfterCountChange(subHabitModal.habitId, result.parentCount);
      } catch (err) {
        console.warn('子习惯打卡失败', err);
        setSubHabitModal((prev) =>
          prev
            ? { ...prev, doneMap: { ...prev.doneMap, [subHabitId]: prevDone } }
            : prev,
        );
        Alert.alert('提示', err instanceof Error && err.message.trim() ? err.message : '操作失败，请稍后重试');
      } finally {
        setSubHabitTogglingId(null);
      }
    },
    [
      logicalTodayYmd,
      markPageDirty,
      patchHabitTodayCount,
      runHabitSideEffectsAfterCountChange,
      subHabitModal,
      subHabitTogglingId,
    ],
  );

  const handleHabitIconPress = React.useCallback(
    (item: HabitGridItem) => {
      if (item.hasSubHabits || hasActiveSubHabits(item.extraData)) {
        openSubHabitModal(item);
        return;
      }
      if (item.kind === 'break' && !item.hasTodayRecord && item.todayCount <= 0) {
        Alert.alert(item.name, '请确认今日戒除状态', [
          { text: '保持戒除', onPress: () => void handleBreakHabitConfirmClean(item) },
          { text: '记录破戒', onPress: () => void handleHabitIncrement(item) },
          { text: '取消', style: 'cancel' },
        ]);
        return;
      }
      void handleHabitIncrement(item);
    },
    [handleBreakHabitConfirmClean, handleHabitIncrement, openSubHabitModal],
  );

  const hasChildrenDeeperThan = React.useCallback((nodes: TaskTreeNode[], level: number, maxLevel: number): boolean => {
    if (nodes.length === 0) return false;
    if (level >= maxLevel) {
      return nodes.some((node) => node.children.length > 0);
    }
    return nodes.some((node) => hasChildrenDeeperThan(node.children, level + 1, maxLevel));
  }, []);

  const closeCategoryMenu = () => setCategoryModalVisible(false);
  const openCategoryEditor = (title: string, initialValue = '', categoryId: string | null = null) => {
    setCategoryEditorTitle(title);
    setCategoryInputValue(initialValue);
    setActiveCategoryId(categoryId);
    setCategoryModalVisible(false);
    setCategoryEditorVisible(true);
  };
  const closeCategoryEditor = () => {
    setCategoryEditorVisible(false);
    setCategoryModalVisible(false);
  };

  const bg = colors.background;
  const card = colors.surface;
  const modalCardBg = isDark ? colors.accentCard : card;
  const soft = colors.input;
  const outline = colors.textSecondary;
  const outlineVariant = colors.outline;
  const primary = colors.primary;
  const secondary = colors.secondary;
  const tertiary = colors.tertiary;
  const error = colors.danger;
  const success = colors.success;
  const projectDoneSurface = isDark ? colors.surfaceMuted : colors.capsule;

  const sectionCardStyle = React.useMemo(
    () => [styles.sectionCard, shadows.card, { backgroundColor: card, borderColor: colors.outline }],
    [card, colors.outline, shadows.card],
  );
  const stackedSectionStyle = React.useMemo(
    () => [styles.section, styles.stackedSection, { borderTopColor: colors.outline }],
    [colors.outline],
  );
  const emptyCardBg = isDark ? colors.surfaceMuted : colors.surfaceSubtle;
  /** 过期待办卡片底色（不透明，避免左滑时透出操作条） */
  const standaloneOverdueCardBg = isDark ? '#2c2326' : '#fff5f5';
  /** 搁置待办卡片底色（置灰、不透明） */
  const standaloneShelvedCardBg = isDark ? '#252a34' : '#f0f2f7';

  const buildCategoryId = React.useCallback((scope: 'task' | 'project') => {
    const prefix = scope === 'task' ? 'tc_' : 'pc_';
    return makeTimestampEntityId(prefix, 8);
  }, []);

  const scopedCategories = projectCategories;

  const saveCategory = React.useCallback(async () => {
    const name = categoryInputValue.trim();
    if (!name) {
      Alert.alert('无法保存分类', '请输入分类名称后再确认。');
      return;
    }

    const normalizedName = name.toLocaleLowerCase();
    const isDuplicateName = scopedCategories.some((category) => {
      if (activeCategoryId && category.id === activeCategoryId) return false;
      return category.name.trim().toLocaleLowerCase() === normalizedName;
    });
    if (isDuplicateName) {
      Alert.alert('无法保存分类', '分类名称不能重复，请更换后重试。');
      return;
    }

    try {
      await runExclusiveMutation(categoryEditorTitle.includes('新建') ? '正在新建分类...' : '正在修改分类...', async () => {
        markPageDirty();
        if (categoryEditorTitle.includes('新建')) {
          await createProjectCategory({ id: buildCategoryId('project'), name });
          await loadProjectCategories();
        } else {
          if (!activeCategoryId) {
            Alert.alert('无法修改分类', '未找到要修改的分类。');
            return;
          }
          await updateProjectCategory(activeCategoryId, { name });
          await loadProjectCategories();
        }
        await markPendingTablesDirty(['project_categories']);
        await pushLocalChangesToApi({ awaitSync: true, rethrow: true });
        closeCategoryEditor();
      }, categoryEditorTitle.includes('新建') ? '分类已新建' : '分类已修改');
    } catch (err) {
      console.warn('保存分类失败', err);
      Alert.alert('保存失败', formatWriteError(err, '分类保存失败，请稍后重试。'));
    }
  }, [
    activeCategoryId,
    buildCategoryId,
    categoryEditorTitle,
    categoryInputValue,
    closeCategoryEditor,
    loadProjectCategories,
    markPageDirty,
    runExclusiveMutation,
    scopedCategories,
  ]);

  const removeCategory = React.useCallback(() => {
    if (!activeCategoryId) {
      Alert.alert('提示', '请先长按要删除的分类。');
      return;
    }
    if (activeCategoryId === 'all') {
      Alert.alert('提示', '“全部”不是可删除分类。');
      return;
    }
    if (activeCategoryId === INBOX_PROJECT_CATEGORY_ID) {
      Alert.alert('提示', '“收集箱”是内置分类，不能删除。');
      return;
    }
    const hasProjectsInCategory = projects.some(
      (project) => (project.category_id ?? INBOX_PROJECT_CATEGORY_ID) === activeCategoryId
    );
    if (hasProjectsInCategory) {
      Alert.alert('无法删除', '该分类下仍有关联项目，请先迁移或删除这些项目后再试。');
      return;
    }

    const targetName = activeCategoryLabel || scopedCategories.find((c) => c.id === activeCategoryId)?.name || '该分类';
    Alert.alert('删除分类', `确认删除「${targetName}」吗？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          try {
            await runExclusiveMutation('正在删除分类...', async () => {
              markPageDirty();
              await deleteProjectCategory(activeCategoryId);
              await loadProjectCategories();
              await markPendingTablesDirty(['project_categories']);
              await pushLocalChangesToApi({ awaitSync: true, rethrow: true });
              if (taskTab === activeCategoryId) setTaskTab('all');
              if (projectTab === activeCategoryId) setProjectTab('all');
              closeCategoryMenu();
            }, '分类已删除');
          } catch (err) {
            console.warn('删除分类失败', err);
            Alert.alert('删除失败', formatWriteError(err, '分类删除失败，请稍后重试。'));
          }
        },
      },
    ]);
  }, [
    activeCategoryId,
    activeCategoryLabel,
    closeCategoryMenu,
    loadProjectCategories,
    markPageDirty,
    projects,
    projectTab,
    runExclusiveMutation,
    scopedCategories,
    taskTab,
  ]);

  /** 四象限行：左侧勾选完成/取消，点击标题区域进入编辑 */
  const renderMatrixTaskRow = (t: TaskRow, accentColor: string, dueMuted: { bg: string; text: string }) => {
    const isDone = t.status === 'done' || t.status === 'cancelled';
    const meta = parseTaskMeta(t.extra_data);
    const due = t.due_date?.slice(0, 10) ?? '';
    const repeat = (meta.repeat ?? '').trim();
    const reminder = (meta.reminder ?? '').trim();
    const acceptanceText = trimTaskAcceptanceCriteria(t);
    const parentTitle = t.parent_task_id ? taskTitleById.get(t.parent_task_id) : null;
    const overdue = isTaskDueOverdue(due, isDone, logicalTodayYmd);
    return (
      <View key={t.id} style={styles.taskRow}>
        <Pressable
          hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
          onPress={() => void toggleTaskDone(t.id)}
          accessibilityRole="button"
          accessibilityLabel={isDone ? '标记为未完成' : '标记为已完成'}>
          <MaterialIcons name={isDone ? 'check-circle' : 'radio-button-unchecked'} size={20} color={accentColor} />
        </Pressable>
        <ScalePressable style={{ flex: 1, minWidth: 0 }} onPress={() => openTask(t.id)} scaleTo={0.985}>
          <View style={styles.taskBody}>
            {!!parentTitle && (
              <Text style={[styles.taskParentHint, { color: outline }]} numberOfLines={1}>
                上级任务：{parentTitle}
              </Text>
            )}
            <Text
              style={[
                styles.taskText,
                {
                  color: overdue ? error : colors.text,
                  fontWeight: overdue ? '800' : '600',
                  textDecorationLine: isDone ? 'line-through' : 'none',
                  opacity: isDone ? 0.42 : 1,
                },
              ]}
              numberOfLines={1}>
              {t.title}
            </Text>
            {!!acceptanceText ? (
              <View style={styles.metaRow}>
                <MaterialIcons name="fact-check" size={12} color={outline} />
                <Text style={[styles.metaHint, { color: outline }]} numberOfLines={2}>
                  {acceptanceText}
                </Text>
              </View>
            ) : null}
            {!!due ? (
              <View style={styles.deadlineRow}>
                <View
                  style={[
                    styles.deadlineBadge,
                    { backgroundColor: overdue ? `${error}22` : dueMuted.bg },
                  ]}>
                  <Text style={[styles.deadlineText, { color: overdue ? error : dueMuted.text }]}>{formatTaskDueText(due, logicalTodayYmd)}</Text>
                </View>
                {overdue ? (
                  <View style={[styles.overduePill, { backgroundColor: `${error}1a` }]}>
                    <MaterialIcons name="report-problem" size={12} color={error} />
                    <Text style={[styles.overduePillText, { color: error }]}>已过期</Text>
                  </View>
                ) : null}
              </View>
            ) : null}
            {!!repeat || !!reminder ? (
              <View style={styles.metaRow}>
                {!!repeat ? (
                  <>
                    <MaterialIcons name="refresh" size={12} color={outline} />
                    <Text style={[styles.metaHint, { color: outline }]} numberOfLines={1}>
                      {repeat}
                    </Text>
                  </>
                ) : null}
                {!!reminder ? (
                  <>
                    <MaterialIcons name="notifications-active" size={12} color={outline} />
                    <Text style={[styles.metaHint, { color: outline }]} numberOfLines={1}>
                      {reminder}
                    </Text>
                  </>
                ) : null}
              </View>
            ) : null}
            <CompletionRewardBadge
              extraData={t.extra_data}
              wishNameById={wishNameById}
              outline={outline}
              accent={tertiary}
              isDark={isDark}
            />
          </View>
        </ScalePressable>
      </View>
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: bg }]} edges={['left', 'right']}>
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <Animated.View
          style={[
            styles.bgOrb,
            styles.bgOrbTop,
            {
              backgroundColor: `${primary}18`,
              transform: [
                {
                  translateY: bgFloatAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, -8],
                  }),
                },
                {
                  translateX: bgFloatAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, 10],
                  }),
                },
              ],
            },
          ]}
        />
        <Animated.View
          style={[
            styles.bgOrb,
            styles.bgOrbBottom,
            {
              backgroundColor: `${primary}16`,
              transform: [
                {
                  translateY: bgFloatAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, 10],
                  }),
                },
                {
                  translateX: bgFloatAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, -8],
                  }),
                },
              ],
            },
          ]}
        />
      </View>

      <View
        style={[
          styles.pageHeader,
          {
            paddingTop: insets.top,
            borderBottomColor: isDark ? 'rgba(148,163,184,0.18)' : 'rgba(194,198,214,0.55)',
            backgroundColor: isDark ? 'rgba(15,23,42,0.75)' : 'rgba(250,248,255,0.86)',
          },
        ]}>
        <View style={styles.pageHeaderRow}>
          <View style={styles.pageHeaderSideSpacer} />
          <Text style={[styles.pageHeaderTitle, { color: colors.text }]}>{formatTasksHeaderDate(logicalTodayYmd)}</Text>
          <AppIconButton
            icon="calendar-today"
            onPress={() => router.push('/tasks-calendar')}
            accessibilityLabel="任务日历"
          />
        </View>
      </View>

      <ScrollView
        ref={mainScrollRef}
        refreshControl={refreshControl}
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          { paddingTop: Spacing.xl, paddingBottom: 0 },
        ]}
        showsVerticalScrollIndicator={false}
        nestedScrollEnabled
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        onScroll={(e) => {
          mainScrollOffsetYRef.current = e.nativeEvent.contentOffset.y;
        }}
        scrollEventThrottle={16}
      >
        <View style={styles.tasksBodyStack}>
          {!initialTasksLoadPending ? (
            <Animated.View style={{ opacity: tasksContentOpacity }}>
        <Animated.View
          style={{
            opacity: pageFadeAnim,
            transform: [{ translateY: pageTranslateAnim }],
          }}
        >
          <View style={styles.section}>
              <View style={sectionCardStyle}>
              <View style={styles.headerRow}>
                <View style={styles.titleRow}>
                  <Text style={[styles.sectionTitle, { color: colors.text }]}>今日青蛙</Text>
                  <MaterialIcons name="eco" size={20} color={primary} />
                </View>
                <View style={styles.frogHeaderActions}>
                  <ScalePressable
                    onPress={() => router.push('/add-frog')}
                    style={({ pressed }) => [styles.ghostBtn, { borderColor: `${primary}44` }, pressed && { opacity: 0.8 }]}>
                    <MaterialIcons name="add" size={14} color={primary} />
                    <Text style={[styles.ghostBtnText, { color: primary }]}>添加青蛙</Text>
                  </ScalePressable>
                  <ScalePressable
                    onPress={() => router.push({ pathname: '/add-frog', params: { target: 'tomorrow' } })}
                    style={({ pressed }) => [styles.ghostBtn, { borderColor: `${tertiary}44` }, pressed && { opacity: 0.8 }]}>
                    <MaterialIcons name="event" size={14} color={tertiary} />
                    <Text style={[styles.ghostBtnText, { color: tertiary }]}>预定青蛙</Text>
                  </ScalePressable>
                </View>
              </View>

              <Animated.View
                style={{
                  opacity: frogCardAnim,
                  transform: [
                    {
                      translateY: frogCardAnim.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }),
                    },
                    {
                      scale: frogCardAnim.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1] }),
                    },
                  ],
                }}
              >
                {todayFrogs.length > 0 ? (
                  <ScrollView
                    horizontal
                    nestedScrollEnabled
                    directionalLockEnabled
                    showsHorizontalScrollIndicator={false}
                    style={styles.frogCarousel}
                    contentContainerStyle={styles.frogCarouselContent}>
                    {todayFrogs.map((frog) => {
                      const isDone = isFrogDoneForToday(frog.extra_data, frog.status, logicalTodayYmd);
                      const isLongTerm = getIsLongTermTask(frog.extra_data);
                      return (
                        <ScalePressable
                          key={frog.id}
                          onPress={() => openTask(frog.id)}
                          onLongPress={() => unassignFrog(frog.id)}
                          scaleTo={0.985}
                          style={({ pressed }) => [
                            styles.frogCard,
                            styles.frogCardSlide,
                            { width: frogCarouselCardWidth },
                            {
                              backgroundColor: isDone ? colors.surfaceMuted : card,
                              borderColor: isDone ? colors.outline : `${primary}33`,
                              opacity: pressed ? 0.94 : 1,
                            },
                          ]}>
                          <View style={[styles.frogAccentBar, { backgroundColor: isDone ? success : primary }]} />
                          <View style={styles.frogTopRowCompact}>
                            <View style={styles.frogTopLeft}>
                              <View style={[styles.frogIconBadge, { backgroundColor: colors.primaryMuted }]}>
                                <MaterialIcons name="eco" size={18} color={primary} />
                              </View>
                              <View style={[styles.badge, styles.badgeCompact, { backgroundColor: colors.primaryMuted }]}>
                                <Text style={[styles.badgeText, styles.badgeTextCompact, { color: primary }]}>
                                  {isLongTerm ? '长期 · 今日已指派' : '今日已指派'}
                                </Text>
                              </View>
                            </View>
                            <View style={styles.frogCardActions}>
                              <Pressable
                                onPress={(e) => {
                                  e.stopPropagation?.();
                                  unassignFrog(frog.id);
                                }}
                                hitSlop={10}
                                accessibilityLabel="取消指派"
                                style={({ pressed }) => [styles.inlineDoneBtn, pressed && { opacity: 0.75 }]}>
                                <MaterialIcons name="link-off" size={17} color={outline} />
                              </Pressable>
                              <Pressable
                                onPress={(e) => {
                                  e.stopPropagation?.();
                                  toggleFrogDone(frog.id);
                                }}
                                hitSlop={10}
                                style={({ pressed }) => [styles.inlineDoneBtn, pressed && { opacity: 0.75 }]}>
                                <Animated.View style={{ transform: [{ scale: getFrogDoneBounce(frog.id) }] }}>
                                  <MaterialIcons
                                    name={isDone ? 'check-circle' : 'radio-button-unchecked'}
                                    size={18}
                                    color={primary}
                                  />
                                </Animated.View>
                              </Pressable>
                            </View>
                          </View>
                          {frog.parent_task_id ? (
                            <Text
                              style={[
                                styles.taskParentHint,
                                { color: outline, textDecorationLine: isDone ? 'line-through' : 'none', opacity: isDone ? 0.65 : 1 },
                              ]}
                              numberOfLines={1}>
                              上级任务：{taskTitleById.get(frog.parent_task_id) ?? '（未找到）'}
                            </Text>
                          ) : null}
                          <Text
                            style={[
                              styles.frogTitleCompact,
                              { color: colors.text, textDecorationLine: isDone ? 'line-through' : 'none', opacity: isDone ? 0.55 : 1 },
                            ]}
                            numberOfLines={2}>
                            {frog.title}
                          </Text>
                          <Text
                            style={[
                              styles.frogDescCompact,
                              { color: colors.textSecondary, textDecorationLine: isDone ? 'line-through' : 'none', opacity: isDone ? 0.58 : 1 },
                            ]}
                            numberOfLines={2}>
                            {(frog.note ?? '').trim() || '点击查看详情或继续执行。'}
                          </Text>
                          <View style={[styles.frogCardFooter, { borderTopColor: colors.outline }]}>
                            <Text style={[styles.progressLabel, { color: outline }]}>状态</Text>
                            <Text style={[styles.progressLabel, { color: isDone ? success : primary }]}>
                              {isDone ? '已完成' : '进行中'}
                            </Text>
                          </View>
                        </ScalePressable>
                      );
                    })}
                  </ScrollView>
                ) : (
                  <View
                    style={[
                      styles.frogCard,
                      styles.frogCardEmpty,
                      {
                        backgroundColor: card,
                        borderColor: `${primary}33`,
                      },
                    ]}>
                    <View style={[styles.frogAccentBar, { backgroundColor: primary }]} />
                    <View style={styles.frogTopRowCompact}>
                      <View style={styles.frogTopLeft}>
                        <View style={[styles.frogIconBadge, { backgroundColor: colors.primaryMuted }]}>
                          <MaterialIcons name="eco" size={18} color={primary} />
                        </View>
                        <View style={[styles.badge, styles.badgeCompact, { backgroundColor: colors.primaryMuted }]}>
                          <Text style={[styles.badgeText, styles.badgeTextCompact, { color: primary }]}>今日未指派</Text>
                        </View>
                      </View>
                      <MaterialIcons name="radio-button-unchecked" size={18} color={primary} />
                    </View>
                    <Text style={[styles.frogTitleCompact, { color: colors.text }]}>还没有今日青蛙</Text>
                    <Text style={[styles.frogDescCompact, { color: colors.textSecondary }]}>
                      点击右上角“添加青蛙”，从今日可选任务中指派。
                    </Text>
                  </View>
                )}
              </Animated.View>
            </View>
          </View>

          <View style={stackedSectionStyle}>
            <View style={sectionCardStyle}>
              <TaskCompletionHeatmap
                logicalTodayYmd={logicalTodayYmd}
                dayBoundary={dayBoundary}
                textMain={colors.text}
                textMuted={outline}
                accentColor={primary}
                todoAccentColor={secondary}
                innerCardBg={isDark ? colors.surfaceMuted : colors.surface}
                innerBorderColor={colors.outlineStrong}
                isDark={isDark}
                reloadToken={completionHeatmapReloadToken}
              />
            </View>
          </View>

          <View style={stackedSectionStyle}>
            <View style={sectionCardStyle}>
              <View style={styles.habitHeaderRow}>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={[styles.sectionTitle, { color: colors.text, fontSize: 18 }]}>待办</Text>
                  <Text style={[styles.standaloneTodoSubtitle, { color: outline }]}>
                    暂不挂项目 · 进行中 {standaloneTodoOpenCount} 条
                    {standaloneTodos.length > 0 ? ' · 左滑可升级或删除' : ''}
                  </Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  <ScalePressable
                    onPress={() => router.push('/tasks-overview')}
                    style={({ pressed }) => [
                      styles.ghostBtn,
                      { borderColor: `${primary}44` },
                      pressed && { opacity: 0.8 },
                    ]}>
                    <MaterialIcons name="insights" size={14} color={primary} />
                    <Text style={[styles.ghostBtnText, { color: primary }]}>待办总览</Text>
                  </ScalePressable>
                  <ScalePressable
                    onPress={openStandaloneTaskComposer}
                    style={({ pressed }) => [
                      styles.ghostBtn,
                      { borderColor: `${tertiary}44` },
                      pressed && { opacity: 0.8 },
                    ]}>
                    <MaterialIcons name="playlist-add" size={14} color={tertiary} />
                    <Text style={[styles.ghostBtnText, { color: tertiary }]}>详细新建</Text>
                  </ScalePressable>
                </View>
              </View>

              {/* 快捷输入：胶囊容器 + 左侧图标区 + 圆形发送，与上方「详细新建」表单区分 */}
              <View ref={quickTodoAnchorRef} collapsable={false}>
                <View
                  style={[
                    styles.quickTodoShell,
                    shadows.composer,
                    {
                      backgroundColor: card,
                      borderColor: colors.outlineStrong,
                    },
                  ]}>
                  <View style={[styles.quickTodoIconBadge, { backgroundColor: isDark ? `${secondary}22` : `${secondary}14` }]}>
                    <MaterialIcons name="bolt" size={18} color={secondary} />
                  </View>
                  <TextInput
                    value={quickTodoDraft}
                    onChangeText={(t) => setQuickTodoDraft(t.slice(0, STANDALONE_TODO_TITLE_MAX))}
                    placeholder="快速记一条…"
                    placeholderTextColor={outline}
                    returnKeyType="done"
                    blurOnSubmit={false}
                    multiline={false}
                    {...(Platform.OS === 'android'
                      ? ({ textAlignVertical: 'center', includeFontPadding: false } as const)
                      : {})}
                    onSubmitEditing={() => void submitQuickStandaloneTodo()}
                    onFocus={() => {
                      quickTodoInputFocusedRef.current = true;
                      const delay = Platform.OS === 'ios' ? 90 : 180;
                      setTimeout(() => {
                        scrollQuickTodoAboveKeyboard();
                      }, delay);
                    }}
                    onBlur={() => {
                      quickTodoInputFocusedRef.current = false;
                    }}
                    style={[styles.quickTodoInput, { color: colors.text }]}
                  />
                  <Pressable
                    onPress={() => void submitQuickStandaloneTodo()}
                    disabled={quickTodoSaving}
                    accessibilityRole="button"
                    accessibilityLabel="添加待办"
                    style={({ pressed }) => [
                      styles.quickTodoSendBtn,
                      {
                        backgroundColor: secondary,
                        opacity: quickTodoSaving ? 0.5 : pressed ? 0.88 : 1,
                      },
                    ]}>
                    {quickTodoSaving ? (
                      <Text style={styles.quickTodoSendBtnDots}>…</Text>
                    ) : (
                      <MaterialIcons name="arrow-upward" size={22} color={colors.onPrimary} />
                    )}
                  </Pressable>
                </View>
                <Text style={[styles.quickTodoHint, { color: outline }]}>回车或点右侧按钮即可保存 · 最多 {STANDALONE_TODO_TITLE_MAX} 字</Text>
              </View>

              {standaloneTodos.length === 0 ? (
                <EmptyPlaceholder
                  icon="task-alt"
                  title="还没有待办"
                  subtitle="杂事、灵感先记在这里，需要时再关联到项目。"
                  color={primary}
                  muted={outline}
                  cardBg={emptyCardBg}
                />
              ) : (
                <ScrollView
                  style={styles.standaloneTodoList}
                  contentContainerStyle={styles.standaloneTodoListContent}
                  nestedScrollEnabled
                  showsVerticalScrollIndicator={false}>
                  {standaloneTodos.map((t) => {
                    const isDone = isTaskTerminalStatus(t.status);
                    const isShelved = isTaskShelvedStatus(t.status);
                    const noteText = (t.note ?? '').trim();
                    const acceptanceText = trimTaskAcceptanceCriteria(t);
                    const meta = parseTaskMeta(t.extra_data);
                    const due = t.due_date?.slice(0, 10) ?? '';
                    const repeat = (meta.repeat ?? '').trim();
                    const reminder = (meta.reminder ?? '').trim();
                    const overdue = isStandaloneTodoOverdue(t, logicalTodayYmd);
                    const dueDisplayYmd = getStandaloneTodoOverdueDisplayYmd(t);
                    const effectivePriority = getEffectiveTaskPriority(t, logicalTodayYmd);
                    const checkColor = getTaskPriorityCheckColor(effectivePriority, isDark);
                    const isUpgrading = upgradingStandaloneTodoId === t.id;
                    const isActivating = activatingShelvedTodoId === t.id;
                    const swipeBusy = !!upgradingStandaloneTodoId || !!activatingShelvedTodoId;
                    return (
                      <View key={t.id} style={styles.standaloneTodoSwipeWrap}>
                        <Swipeable
                          ref={(r) => {
                            standaloneTodoSwipeableRefs.current[t.id] = r;
                          }}
                          overshootRight={false}
                          friction={2}
                          renderRightActions={() => (
                            <View style={styles.standaloneSwipeActions}>
                              {isShelved ? (
                                <Pressable
                                  onPress={() => confirmActivateShelvedTodo(t.id, t.title)}
                                  disabled={swipeBusy}
                                  style={({ pressed }) => [
                                    styles.standaloneSwipeUpgrade,
                                    {
                                      backgroundColor: primary,
                                      opacity: isActivating ? 0.55 : pressed ? 0.9 : 1,
                                    },
                                  ]}
                                  accessibilityRole="button"
                                  accessibilityLabel={`激活 ${t.title} 为正常待办`}>
                                  {isActivating ? (
                                    <ActivityIndicator color="#fff" size="small" />
                                  ) : (
                                    <MaterialIcons name="play-arrow" size={22} color="#fff" />
                                  )}
                                  <Text style={styles.standaloneSwipeUpgradeText} numberOfLines={1}>
                                    激活
                                  </Text>
                                </Pressable>
                              ) : (
                                <Pressable
                                  onPress={() => void handleUpgradeStandaloneTodo(t.id)}
                                  disabled={swipeBusy}
                                  style={({ pressed }) => [
                                    styles.standaloneSwipeUpgrade,
                                    {
                                      backgroundColor: secondary,
                                      opacity: isUpgrading ? 0.55 : pressed ? 0.9 : 1,
                                    },
                                  ]}
                                  accessibilityRole="button"
                                  accessibilityLabel={`将 ${t.title} 升级为项目`}>
                                  {isUpgrading ? (
                                    <ActivityIndicator color="#fff" size="small" />
                                  ) : (
                                    <MaterialIcons name="upgrade" size={22} color="#fff" />
                                  )}
                                  <Text style={styles.standaloneSwipeUpgradeText} numberOfLines={1}>
                                    升级
                                  </Text>
                                </Pressable>
                              )}
                              <Pressable
                                onPress={() => confirmDeleteStandaloneTodo(t.id, t.title)}
                                disabled={swipeBusy}
                                style={({ pressed }) => [
                                  styles.standaloneSwipeDelete,
                                  { backgroundColor: colors.danger, opacity: pressed ? 0.9 : 1 },
                                ]}
                                accessibilityRole="button"
                                accessibilityLabel={`删除 ${t.title}`}>
                                <MaterialIcons name="delete-outline" size={22} color="#fff" />
                                <Text style={styles.standaloneSwipeDeleteText} numberOfLines={1}>
                                  删除
                                </Text>
                              </Pressable>
                            </View>
                          )}>
                          <View
                            style={[
                              styles.standaloneTodoCard,
                              {
                                backgroundColor: isShelved && !isDone
                                  ? standaloneShelvedCardBg
                                  : overdue && !isDone
                                    ? standaloneOverdueCardBg
                                    : card,
                                borderColor:
                                  isShelved && !isDone
                                    ? outlineVariant
                                    : overdue && !isDone
                                      ? error
                                      : outlineVariant,
                                borderWidth: overdue && !isDone && !isShelved ? 1.5 : StyleSheet.hairlineWidth,
                                ...(isShelved && !isDone ? { shadowOpacity: 0.03, elevation: 0 } : null),
                              },
                            ]}>
                          {isShelved ? (
                            <View style={styles.shelvedStatusIcon} accessibilityLabel="暂时搁置">
                              <MaterialIcons name="inventory-2" size={22} color={colors.textMuted} />
                            </View>
                          ) : (
                            <Pressable
                              hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                              onPress={() => void toggleTaskDone(t.id)}
                              accessibilityRole="button"
                              accessibilityLabel={isDone ? '标记为未完成' : '标记为已完成'}>
                              <MaterialIcons
                                name={isDone ? 'check-circle' : 'radio-button-unchecked'}
                                size={22}
                                color={checkColor}
                              />
                            </Pressable>
                          )}
                          <Pressable
                            style={[styles.taskBody, isShelved && !isDone && styles.shelvedTodoBodyMuted]}
                            onPress={() => openTask(t.id)}>
                            <Text
                              style={[
                                styles.taskText,
                                {
                                  color: isShelved
                                    ? colors.textSecondary
                                    : overdue
                                      ? error
                                      : colors.text,
                                  fontWeight: overdue && !isShelved ? '800' : '600',
                                  textDecorationLine: isDone ? 'line-through' : 'none',
                                  opacity: isDone ? 0.45 : isShelved ? 0.82 : 1,
                                },
                              ]}
                              numberOfLines={2}>
                              {t.title}
                            </Text>
                            {isShelved ? (
                              <View style={[styles.shelvedPill, { backgroundColor: `${outline}18` }]}>
                                <MaterialIcons name="inventory-2" size={12} color={outline} />
                                <Text style={[styles.shelvedPillText, { color: outline }]}>暂时搁置</Text>
                              </View>
                            ) : null}
                            {!!acceptanceText ? (
                              <View style={styles.standaloneTodoAcceptanceRow}>
                                <MaterialIcons name="fact-check" size={13} color={outline} />
                                <Text
                                  style={[
                                    styles.standaloneTodoAcceptance,
                                    {
                                      color: colors.textSecondary,
                                      textDecorationLine: isDone ? 'line-through' : 'none',
                                      opacity: isDone ? 0.42 : 1,
                                    },
                                  ]}
                                  numberOfLines={3}>
                                  {acceptanceText}
                                </Text>
                              </View>
                            ) : null}
                            {!!noteText ? (
                              <Text
                                style={[
                                  styles.standaloneTodoNote,
                                  {
                                    color: colors.textSecondary,
                                    textDecorationLine: isDone ? 'line-through' : 'none',
                                    opacity: isDone ? 0.42 : 1,
                                  },
                                ]}>
                                {noteText}
                              </Text>
                            ) : null}
                            {!!dueDisplayYmd ? (
                              <View style={styles.deadlineRow}>
                                <View
                                  style={[
                                    styles.deadlineBadge,
                                    { backgroundColor: overdue ? `${error}22` : `${primary}14` },
                                  ]}>
                                  <Text style={[styles.deadlineText, { color: overdue ? error : primary }]}>
                                    {formatTaskDueText(dueDisplayYmd, logicalTodayYmd)}
                                  </Text>
                                </View>
                                {overdue ? (
                                  <View style={[styles.overduePill, { backgroundColor: `${error}1a` }]}>
                                    <MaterialIcons name="report-problem" size={12} color={error} />
                                    <Text style={[styles.overduePillText, { color: error }]}>已过期</Text>
                                  </View>
                                ) : null}
                              </View>
                            ) : overdue ? (
                              <View style={styles.deadlineRow}>
                                <View style={[styles.overduePill, { backgroundColor: `${error}1a` }]}>
                                  <MaterialIcons name="report-problem" size={12} color={error} />
                                  <Text style={[styles.overduePillText, { color: error }]}>已过期</Text>
                                </View>
                              </View>
                            ) : null}
                            {!!repeat || !!reminder ? (
                              <View style={styles.metaRow}>
                                {!!repeat ? (
                                  <>
                                    <MaterialIcons name="refresh" size={12} color={outline} />
                                    <Text style={[styles.metaHint, { color: outline }]} numberOfLines={1}>
                                      {repeat}
                                    </Text>
                                  </>
                                ) : null}
                                {!!reminder ? (
                                  <>
                                    <MaterialIcons name="notifications-active" size={12} color={outline} />
                                    <Text style={[styles.metaHint, { color: outline }]} numberOfLines={1}>
                                      {reminder}
                                    </Text>
                                  </>
                                ) : null}
                              </View>
                            ) : null}
                            <CompletionRewardBadge
                              extraData={t.extra_data}
                              wishNameById={wishNameById}
                              outline={outline}
                              accent={tertiary}
                              isDark={isDark}
                            />
                          </Pressable>
                          {isShelved ? (
                            <View style={styles.shelvedActivateAside}>
                              <Pressable
                                onPress={() => confirmActivateShelvedTodo(t.id, t.title)}
                                disabled={swipeBusy}
                                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                accessibilityRole="button"
                                accessibilityLabel={`激活 ${t.title} 为正常待办`}
                                style={({ pressed }) => [
                                  styles.shelvedActivateBtn,
                                  {
                                    backgroundColor: primary,
                                    opacity: isActivating ? 0.55 : pressed ? 0.88 : 1,
                                  },
                                ]}>
                                {isActivating ? (
                                  <ActivityIndicator color={colors.onPrimary} size="small" />
                                ) : (
                                  <MaterialIcons name="play-arrow" size={22} color={colors.onPrimary} />
                                )}
                              </Pressable>
                            </View>
                          ) : null}
                          </View>
                        </Swipeable>
                      </View>
                    );
                  })}
                </ScrollView>
              )}
            </View>
          </View>

          <View style={stackedSectionStyle}>
            <View style={sectionCardStyle}>
              <View style={styles.habitHeaderRow}>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>小习惯</Text>
                <ScalePressable
                  onPress={() => router.push('/habit-manage')}
                  style={({ pressed }) => [
                    styles.ghostBtn,
                    { borderColor: `${primary}44` },
                    pressed && { opacity: 0.8 },
                  ]}>
                  <MaterialIcons name="dashboard" size={14} color={primary} />
                  <Text style={[styles.ghostBtnText, { color: primary }]}>管理习惯</Text>
                </ScalePressable>
              </View>

              {habitSections.map((section) => {
                const isOpen = expandedHabitSections[section.id] ?? true;
                const visibleHabitItems = section.items.filter(
                  (it) => !isHabitHiddenByCalendarCycleOnTasks(it.extraData, habitScheduleAnchorDate)
                );
                return (
                  <View key={section.id} style={styles.habitSection}>
                    <Pressable
                      onPress={() => toggleHabitSection(section.id)}
                      style={({ pressed }) => [
                        styles.habitSectionToggle,
                        { backgroundColor: isDark ? 'rgba(148,163,184,0.16)' : 'rgba(148,163,184,0.14)' },
                        pressed && { opacity: 0.8 },
                      ]}>
                      <Text style={[styles.habitSectionToggleText, { color: outline }]}>
                        {section.title}・{visibleHabitItems.length}
                      </Text>
                      <MaterialIcons name={isOpen ? 'expand-less' : 'expand-more'} size={16} color={outline} />
                    </Pressable>

                    {isOpen ? (
                      <View style={styles.habitItemsRow} onLayout={onHabitItemsRowLayout}>
                        {visibleHabitItems.map((item) => {
                          const scheduleAllowsToday = item.extraData
                            ? isHabitScheduledToday(item.extraData, habitScheduleAnchorDate)
                            : true;
                          const isBreak = item.kind === 'break';
                          const isTask = item.kind === 'task';
                          const taskPeriodProgress = item.periodProgress ?? 0;
                          const hasProgress = isTask ? taskPeriodProgress > 0 : item.todayCount > 0;
                          const breakUi = isBreak
                            ? getBreakHabitDayUiState(item.todayCount, item.dailyGoal, {
                                hasDayRecord: item.hasTodayRecord,
                                ymd: logicalTodayYmd,
                                logicalTodayYmd,
                              })
                            : null;
                          const displayCompleted = isTask
                            ? item.taskShowPeriodCheck
                            : isHabitDayDisplayCompleted({
                                kind: item.kind,
                                todayCount: item.todayCount,
                                dailyGoal: item.dailyGoal,
                                hasDayRecord: isBreak ? item.hasTodayRecord : undefined,
                                ymd: logicalTodayYmd,
                                logicalTodayYmd,
                              });
                          const goalMet = isBreak
                            ? scheduleAllowsToday && displayCompleted
                            : displayCompleted;
                          const breakPending = isBreak && scheduleAllowsToday && breakUi === 'pending';
                          const goalFailed = isBreak && scheduleAllowsToday && breakUi === 'failed';
                          const breakSlipping = isBreak && scheduleAllowsToday && breakUi === 'slipping';
                          const taskProgressing =
                            isTask && scheduleAllowsToday && taskPeriodProgress > 0 && !goalMet;
                          const buildProgressing =
                            !isBreak &&
                            !isTask &&
                            scheduleAllowsToday &&
                            item.todayCount > 0 &&
                            !goalMet &&
                            item.dailyGoal != null &&
                            item.dailyGoal > 0;

                          const openHabitDetail = () =>
                            router.push({
                              pathname: '/habit-detail',
                              params: { habitId: item.id },
                            });

                          const partialBorderBuild = isDark ? 'rgba(52,211,153,0.5)' : 'rgba(0,108,73,0.42)';
                          const failBorder = isDark ? 'rgba(248,113,113,0.85)' : 'rgba(220,38,38,0.78)';
                          const slipBorder = breakSlipping
                            ? breakSlipBorderColor(item.todayCount, item.dailyGoal, isDark)
                            : null;
                          const buildBorder = buildProgressing
                            ? buildProgressBorderColor(item.todayCount, item.dailyGoal, isDark)
                            : null;
                          const progressBadgeCount = isTask ? taskPeriodProgress : item.todayCount;
                          const canUndoTodayBadge =
                            scheduleAllowsToday &&
                            !item.hasSubHabits &&
                            (item.todayCount > 0 || (isBreak && item.hasTodayRecord && item.todayCount <= 0));
                          const onHabitBadgeUndo = () => {
                            if (item.hasSubHabits) {
                              openSubHabitModal(item);
                              return;
                            }
                            if (!canUndoTodayBadge) return;
                            void handleHabitUndoOnce(item);
                          };
                          const progressBadgeBg = isBreak
                            ? breakSlipping
                              ? breakSlipBadgeColor(item.todayCount, item.dailyGoal, isDark)
                              : isDark
                                ? 'rgba(234,88,12,0.92)'
                                : 'rgba(194,65,12,0.9)'
                            : taskProgressing
                              ? isDark
                                ? 'rgba(59,130,246,0.92)'
                                : 'rgba(59,130,246,0.88)'
                            : buildProgressing
                              ? buildProgressBadgeColor(item.todayCount, item.dailyGoal, isDark)
                              : isDark
                                ? 'rgba(52,211,153,0.92)'
                                : 'rgba(0,108,73,0.88)';

                          return (
                            <View key={item.id} style={[styles.habitItem, { width: habitGridItemWidth }]}>
                              <Pressable
                                onPress={() => {
                                  if (!scheduleAllowsToday) return;
                                  handleHabitIconPress(item);
                                }}
                                onLongPress={openHabitDetail}
                                delayLongPress={260}
                                style={({ pressed }) => [
                                  styles.habitIconPressable,
                                  pressed && scheduleAllowsToday && { opacity: 0.86 },
                                ]}>
                                <View style={styles.habitIconWrap}>
                                  {isBreak ? (
                                    <View style={[styles.habitKindBadge, { borderColor: card }]}>
                                      <Text style={styles.habitKindBadgeText}>戒</Text>
                                    </View>
                                  ) : isTask ? (
                                    <View style={[styles.habitKindBadge, styles.habitKindBadgeTask, { borderColor: card }]}>
                                      <Text style={styles.habitKindBadgeText}>任</Text>
                                    </View>
                                  ) : null}
                                  <View
                                    style={[
                                      styles.habitIconCircle,
                                      {
                                        borderColor: isBreak
                                          ? goalFailed
                                            ? failBorder
                                            : breakSlipping && slipBorder
                                              ? slipBorder
                                              : goalMet
                                                ? secondary
                                                : breakPending
                                                  ? isDark
                                                    ? 'rgba(148,163,184,0.55)'
                                                    : 'rgba(148,163,184,0.62)'
                                                  : isDark
                                                    ? 'rgba(148,163,184,0.42)'
                                                    : 'rgba(148,163,184,0.5)'
                                          : goalMet
                                            ? secondary
                                            : buildProgressing && buildBorder
                                              ? buildBorder
                                              : taskProgressing || hasProgress
                                                ? partialBorderBuild
                                                : isDark
                                                  ? 'rgba(148,163,184,0.42)'
                                                  : 'rgba(148,163,184,0.5)',
                                        borderStyle:
                                          goalMet || goalFailed
                                            ? 'solid'
                                            : breakSlipping || buildProgressing || taskProgressing
                                              ? 'solid'
                                              : 'dashed',
                                        borderWidth:
                                          goalFailed || breakSlipping || buildProgressing || taskProgressing
                                            ? 2
                                            : StyleSheet.hairlineWidth,
                                        backgroundColor: card,
                                        opacity: scheduleAllowsToday ? 1 : 0.45,
                                      },
                                    ]}>
                                    <Text
                                      style={[
                                        styles.habitIconText,
                                        (goalMet || goalFailed) && styles.habitIconTextDone,
                                      ]}>
                                      {item.icon}
                                    </Text>
                                    {goalMet ? (
                                      <View style={styles.habitIconDoneOverlay} pointerEvents="none">
                                        <MaterialIcons name="check" size={30} color={secondary} />
                                      </View>
                                    ) : goalFailed ? (
                                      <View style={styles.habitIconDoneOverlay} pointerEvents="none">
                                        <Text style={styles.habitIconFailMark}>❌</Text>
                                      </View>
                                    ) : null}
                                    {!scheduleAllowsToday ? (
                                      <View style={styles.habitIconLockOverlay} pointerEvents="none">
                                        <MaterialIcons name="lock" size={26} color={colors.textSecondary} />
                                      </View>
                                    ) : null}
                                  </View>
                                  {goalMet ? (
                                    canUndoTodayBadge || item.hasSubHabits ? (
                                      <Pressable
                                        onPress={onHabitBadgeUndo}
                                        hitSlop={6}
                                        accessibilityLabel={item.hasSubHabits ? '查看子习惯' : '撤销一次打卡'}
                                        style={({ pressed }) => [
                                          styles.habitTodayBadge,
                                          { borderColor: card, backgroundColor: secondary },
                                          pressed && { opacity: 0.86 },
                                        ]}>
                                        <MaterialIcons name="check" size={11} color="#fff" />
                                      </Pressable>
                                    ) : (
                                      <View style={[styles.habitTodayBadge, { borderColor: card, backgroundColor: secondary }]}>
                                        <MaterialIcons name="check" size={11} color="#fff" />
                                      </View>
                                    )
                                  ) : goalFailed ? (
                                    <View
                                      style={[
                                        styles.habitTodayBadge,
                                        {
                                          borderColor: card,
                                          backgroundColor: isDark ? 'rgba(220,38,38,0.92)' : 'rgba(220,38,38,0.88)',
                                        },
                                      ]}>
                                      <Text style={styles.habitTodayBadgeFail}>❌</Text>
                                    </View>
                                  ) : breakPending ? (
                                    <View
                                      style={[
                                        styles.habitTodayBadge,
                                        {
                                          borderColor: card,
                                          backgroundColor: isDark
                                            ? 'rgba(148,163,184,0.92)'
                                            : 'rgba(148,163,184,0.88)',
                                        },
                                      ]}>
                                      <Text style={styles.habitTodayBadgeCount}>?</Text>
                                    </View>
                                  ) : breakSlipping || buildProgressing || taskProgressing || (!isBreak && !isTask && hasProgress) ? (
                                    canUndoTodayBadge || item.hasSubHabits ? (
                                      <Pressable
                                        onPress={onHabitBadgeUndo}
                                        hitSlop={6}
                                        accessibilityLabel={item.hasSubHabits ? '查看子习惯' : '撤销一次打卡'}
                                        style={({ pressed }) => [
                                          styles.habitTodayBadge,
                                          {
                                            borderColor: card,
                                            backgroundColor: progressBadgeBg,
                                          },
                                          pressed && { opacity: 0.86 },
                                        ]}>
                                        <Text style={styles.habitTodayBadgeCount}>{progressBadgeCount}</Text>
                                      </Pressable>
                                    ) : (
                                      <View
                                        style={[
                                          styles.habitTodayBadge,
                                          {
                                            borderColor: card,
                                            backgroundColor: progressBadgeBg,
                                          },
                                        ]}>
                                        <Text style={styles.habitTodayBadgeCount}>{progressBadgeCount}</Text>
                                      </View>
                                    )
                                  ) : null}
                                </View>
                              </Pressable>
                              <Pressable
                                onPress={() => {
                                  if (!scheduleAllowsToday) return;
                                  handleHabitIconPress(item);
                                }}
                                onLongPress={openHabitDetail}
                                delayLongPress={260}
                                style={({ pressed }) => [
                                  styles.habitNamePressable,
                                  pressed && scheduleAllowsToday && { opacity: 0.86 },
                                ]}>
                                <Text
                                  style={[
                                    styles.habitItemText,
                                    { color: colors.text, opacity: scheduleAllowsToday ? 1 : 0.5 },
                                  ]}
                                  numberOfLines={2}>
                                  {item.name}
                                </Text>
                              </Pressable>
                            </View>
                          );
                        })}
                        <Pressable
                          onPress={() => router.push('/add-habit')}
                          style={({ pressed }) => [
                            styles.habitItem,
                            { width: habitGridItemWidth },
                            pressed && { opacity: 0.86 },
                          ]}>
                          <View
                            style={[
                              styles.habitAddCircle,
                              { backgroundColor: isDark ? 'rgba(148,163,184,0.08)' : 'rgba(148,163,184,0.12)' },
                            ]}>
                            <MaterialIcons name="add" size={34} color={colors.textMuted} />
                          </View>
                          <Text style={[styles.habitAddText, { color: colors.textMuted }]}>添加打卡</Text>
                        </Pressable>
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </View>
          </View>

          <View style={stackedSectionStyle}>
            <MainListViewSwitcher
              value={mainListView}
              onChange={onMainListViewChange}
              primary={primary}
              muted={outline}
              onPrimary={colors.onPrimary}
              trackBg={isDark ? 'rgba(148,163,184,0.12)' : 'rgba(148,163,184,0.16)'}
            />

            {mainListView === 'tasks' ? (
              <>
            <Text style={[styles.sectionTitle, { color: colors.text, marginBottom: Spacing.md, marginTop: Spacing.md }]}>本周列表</Text>
            <SegmentTabs
              tabs={taskTabs}
              active={taskTab}
              onChange={setTaskTab}
              onLongPressTab={(key, label) => openCategoryMenu('project', label, key)}
              color={primary}
              muted={outline}
            />

            <Animated.View style={{ opacity: matrixAnim, transform: [{ translateY: matrixAnim.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }) }] }}>
              <View style={[styles.matrixWrap, { borderColor: outlineVariant, backgroundColor: `${outlineVariant}28` }]}>
                <View style={[styles.quadrant, { backgroundColor: card, borderColor: outlineVariant }]}>
                  <View style={styles.quadHead}>
                    <View style={styles.quadTitleRow}>
                      <PulseDot color={error} />
                      <Text style={[styles.quadTitle, { color: error }]}>紧急且重要 (立即执行)</Text>
                    </View>
                  </View>
                  {matrixGroups.q11.length === 0 ? (
                    <EmptyPlaceholder
                      icon="task-alt"
                      title="暂无任务"
                      subtitle="把重要紧急的事项放进来，优先处理。"
                      color={error}
                      muted={outline}
                      cardBg={emptyCardBg}
                    />
                  ) : (
                    <ScrollView style={styles.quadList} nestedScrollEnabled showsVerticalScrollIndicator={false}>
                      {matrixGroups.q11.map((t) => renderMatrixTaskRow(t, error, { bg: `${error}14`, text: error }))}
                    </ScrollView>
                  )}
                </View>
                <View style={[styles.quadrant, { backgroundColor: card, borderColor: outlineVariant }]}>
                  <View style={styles.quadHead}>
                    <View style={styles.quadTitleRow}>
                      <View style={[styles.dot, { backgroundColor: primary }]} />
                      <Text style={[styles.quadTitle, { color: primary }]}>不紧急但重要 (计划执行)</Text>
                    </View>
                  </View>
                  {matrixGroups.q10.length === 0 ? (
                    <EmptyPlaceholder
                      icon="event-available"
                      title="暂无任务"
                      subtitle="把重要但不紧急的任务安排进计划。"
                      color={primary}
                      muted={outline}
                      cardBg={emptyCardBg}
                    />
                  ) : (
                    <ScrollView style={styles.quadList} nestedScrollEnabled showsVerticalScrollIndicator={false}>
                      {matrixGroups.q10.map((t) => renderMatrixTaskRow(t, primary, { bg: `${primary}14`, text: primary }))}
                    </ScrollView>
                  )}
                </View>
                <View style={[styles.quadrant, { backgroundColor: card, borderColor: outlineVariant }]}>
                  <View style={styles.quadHead}>
                    <View style={styles.quadTitleRow}>
                      <View style={[styles.dot, { backgroundColor: tertiary }]} />
                      <Text style={[styles.quadTitle, { color: tertiary }]}>紧急但不重要 (委派他人)</Text>
                    </View>
                  </View>
                  {matrixGroups.q01.length === 0 ? (
                    <EmptyPlaceholder
                      icon="groups"
                      title="暂无任务"
                      subtitle="需要委派/协调的事项可以放这里。"
                      color={tertiary}
                      muted={outline}
                      cardBg={emptyCardBg}
                    />
                  ) : (
                    <ScrollView style={styles.quadList} nestedScrollEnabled showsVerticalScrollIndicator={false}>
                      {matrixGroups.q01.map((t) => renderMatrixTaskRow(t, tertiary, { bg: `${tertiary}14`, text: tertiary }))}
                    </ScrollView>
                  )}
                </View>
                <View style={[styles.quadrant, { backgroundColor: card, borderColor: outlineVariant }]}>
                  <View style={styles.quadHead}>
                    <View style={styles.quadTitleRow}>
                      <View style={[styles.dot, { backgroundColor: outline }]} />
                      <Text style={[styles.quadTitle, { color: outline }]}>不紧急不重要 (尽量消除)</Text>
                    </View>
                  </View>
                  {matrixGroups.q00.length === 0 ? (
                    <EmptyPlaceholder
                      icon="self-improvement"
                      title="暂无任务"
                      subtitle="不重要不紧急的事，能不做就不做。"
                      color={outline}
                      muted={outline}
                      cardBg={emptyCardBg}
                    />
                  ) : (
                    <ScrollView style={styles.quadList} nestedScrollEnabled showsVerticalScrollIndicator={false}>
                      {matrixGroups.q00.map((t) => renderMatrixTaskRow(t, outline, { bg: `${outline}12`, text: outline }))}
                    </ScrollView>
                  )}
                </View>
              </View>
            </Animated.View>
              </>
            ) : (
          <Animated.View style={{ opacity: projectAnim, transform: [{ translateY: projectAnim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }] }}>
              <View style={[sectionCardStyle, { marginTop: Spacing.md }]}>
                <View style={styles.headerRow}>
                  <View style={styles.projectListTitleCol}>
                    <Text style={[styles.sectionTitle, { color: colors.text }]}>项目列表</Text>
                    <Text style={[styles.sectionMeta, { color: outline }]} numberOfLines={2}>
                      共 {projectsShownInList.length} 个活跃项目
                      {projectTab === INBOX_PROJECT_CATEGORY_ID && projectsShownInList.length > 0
                        ? ' · 左滑可彻底删除'
                        : ''}
                    </Text>
                  </View>
                  <ScalePressable
                    onPress={() =>
                      router.push(
                        projectTab === 'all'
                          ? '/add-project'
                          : { pathname: '/add-project', params: { categoryId: projectTab } },
                      )
                    }
                    style={({ pressed }) => [styles.ghostBtn, { borderColor: `${primary}44` }, pressed && { opacity: 0.8 }]}>
                    <MaterialIcons name="add-circle" size={14} color={primary} />
                    <Text style={[styles.ghostBtnText, { color: primary }]}>新建项目</Text>
                  </ScalePressable>
                </View>
                <SegmentTabs
                  tabs={projectTabs}
                  active={projectTab}
                  onChange={setProjectTab}
                  onLongPressTab={(key, label) => openCategoryMenu('project', label, key)}
                  color={primary}
                  muted={outline}
                />
                <View style={styles.projectListFilterRow}>
                  <ProjectListTaskFilterChip
                    active={hideCompletedProjectTasks}
                    onPress={() => onHideCompletedProjectTasksChange(!hideCompletedProjectTasks)}
                    primary={primary}
                    outline={outline}
                    onPrimary={colors.onPrimary}
                    isDark={isDark}
                  />
                </View>
                <View style={styles.projectList}>
                {projectsShownInList.map((project) => {
                  const lockInfo = projectLockMap.get(project.id);
                  const isScheduleNotStarted = isProjectScheduleNotYetStarted(project, logicalTodayYmd);
                  const isLocked = !!(lockInfo?.locked || isScheduleNotStarted);
                  const isCompleted = project.status === 'completed' || project.status === 'archived';
                  const isArchived = project.status === 'archived';
                  const projectAccent = isLocked ? outline : isCompleted ? success : primary;
                  const projectCardBg = isLocked
                    ? isDark
                      ? colors.surfaceMuted
                      : colors.surfaceSubtle
                    : isCompleted
                      ? projectDoneSurface
                      : card;
                  const doneMuted = colors.textMuted;
                  const schedule = parseProjectSchedule(project.extra_data);
                  const dueDateLabel = getProjectScheduleLabel(project);
                  const isRangeSchedule = !!(dueDateLabel && dueDateLabel.includes(' ~ '));
                  const todayYmd = logicalTodayYmd;
                  const scheduleBounds = getProjectScheduleYmdBounds(project);
                  const rangeEndYmd = isRangeSchedule ? scheduleBounds.endYmd : null;
                  const dueYmd = !isRangeSchedule && project.due_date ? formatScheduleDateToYMD(project.due_date) : null;
                  const isScheduleExpired = !isCompleted && isProjectScheduleExpired(project, todayYmd);
                  const noteText = project.note?.trim();
                  const categoryLabel = !project.category_id || project.category_id === INBOX_PROJECT_CATEGORY_ID ? '收集箱' : projectCategoryMap.get(project.category_id) ?? '未分类';
                  const hasReminder = !!schedule?.reminderOption && schedule.reminderOption !== '不提前';
                  const hasRepeat = !!schedule?.repeatOption && schedule.repeatOption !== '不重复';
                  const taskTree = sortTaskTree(projectTaskTreeMap[project.id] ?? []);
                  const displayTaskTree = filterProjectListTaskTree(taskTree, hideCompletedProjectTasks);
                  const taskNodeById = buildProjectTaskNodeById(taskTree);
                  const isExpanded = !!expandedProjectIds[project.id];
                  const progress = getProjectTreeTaskProgress(taskTree);

                  const openEditTask = (id: string) => {
                    router.push({ pathname: '/edit-task', params: { id } });
                  };

                  const renderTaskLevel = (nodes: TaskTreeNode[], level: number): React.ReactNode => {
                    if (nodes.length === 0 || level > 3) return null;
                    const childAccent = isDark ? 'rgba(96,165,250,0.45)' : 'rgba(0,88,190,0.28)';
                    const hairlineColor = isDark ? 'rgba(148, 163, 184, 0.22)' : 'rgba(203,213,225,0.9)';
                    return nodes.map((node) => {
                      const isDone = node.status === 'done' || node.status === 'cancelled';
                      const fullNode = taskNodeById.get(node.id) ?? node;
                      const childrenAll = Array.isArray(fullNode.children) ? fullNode.children : [];
                      const displayChildren =
                        level < 3 ? (Array.isArray(node.children) ? node.children : []) : [];
                      const hasAnyChildren = childrenAll.length > 0;
                      const hasChildrenToRender = displayChildren.length > 0;
                      const hasDeeperLevels = level === 3 && hasAnyChildren;
                      const canToggleCollapse = hasAnyChildren;
                      const isCollapsed = canToggleCollapse ? !!collapsedTaskIds[node.id] : false;
                      const isExpandedTask = canToggleCollapse ? !isCollapsed : true;
                      const isChildRow = level > 1;
                      const noteText = (node.note ?? '').trim();
                      const acceptanceText = trimTaskAcceptanceCriteria(node);
                      const dueDate = node.due_date?.slice(0, 10) ?? '';
                      const dueOverdue = isTaskDueOverdue(dueDate, isDone, logicalTodayYmd);
                      const effectivePriority = getEffectiveTaskPriority(node, logicalTodayYmd);
                      const hintPaddingLeft = 10 + 22 + 8 + (isChildRow ? 28 : 0) + 14 + 8;
                      const boundHabitIds = parseBoundHabitIdsFromExtraData(node.extra_data);
                      const boundHabits = boundHabitIds
                        .map((id) => habitLookupById.get(id))
                        .filter((h): h is { name: string; icon: string } => !!h);
                      const boundHabitLabel = boundHabitIds
                        .map((id) => habitLookupById.get(id)?.name?.trim() || '已删除')
                        .join('、');
                      return (
                        <View key={node.id}>
                          <View
                            style={[
                              styles.projectTaskRow,
                              styles.projectTaskRowFlat,
                              {
                                paddingLeft: 10,
                                paddingVertical: isChildRow ? 6 : 8,
                                borderBottomWidth: StyleSheet.hairlineWidth,
                                borderBottomColor: hairlineColor,
                              },
                            ]}>
                            {canToggleCollapse ? (
                              <Pressable
                                onPress={(e) => {
                                  e.stopPropagation?.();
                                  toggleTaskCollapse(node.id);
                                }}
                                hitSlop={8}
                                accessibilityRole="button"
                                accessibilityLabel={isExpandedTask ? '收起子任务' : '展开子任务'}
                                accessibilityState={{ expanded: isExpandedTask }}
                                style={({ pressed }) => [
                                  styles.taskExpandBtn,
                                  { backgroundColor: isDark ? 'rgba(96,165,250,0.12)' : 'rgba(0,88,190,0.08)' },
                                  pressed && { opacity: 0.75 },
                                ]}>
                                <MaterialIcons
                                  name={isExpandedTask ? 'expand-less' : 'expand-more'}
                                  size={20}
                                  color={primary}
                                />
                              </Pressable>
                            ) : (
                              <View style={styles.taskExpandBtnPlaceholder} />
                            )}
                            {isChildRow ? (
                              <View style={styles.taskChildMark} accessible accessibilityLabel={`第 ${level} 层子任务`}>
                                <MaterialIcons name="subdirectory-arrow-right" size={16} color={childAccent} />
                              </View>
                            ) : null}
                            <Pressable
                              onPress={(e) => {
                                e.stopPropagation?.();
                                if (isLocked) {
                                  alertProjectTaskLocked(lockInfo);
                                  return;
                                }
                                void toggleTaskDone(node.id);
                              }}
                              hitSlop={10}
                              accessibilityRole="button"
                              accessibilityLabel={
                                isLocked
                                  ? '项目已锁定，暂不可完成任务'
                                  : isDone
                                    ? '标记为未完成'
                                    : '标记为已完成'
                              }
                              accessibilityState={{ disabled: isLocked }}>
                              <View
                                style={[
                                  styles.statusCircle,
                                  isLocked
                                    ? {
                                        borderColor: outline,
                                        backgroundColor: isDark ? 'rgba(148,163,184,0.12)' : 'rgba(114,119,133,0.08)',
                                        opacity: 0.72,
                                      }
                                    : { borderColor: primary, backgroundColor: isDone ? primary : 'transparent' },
                                ]}>
                                {isLocked ? (
                                  <MaterialIcons name="lock" size={11} color={outline} />
                                ) : isDone ? (
                                  <MaterialIcons name="check" size={12} color={colors.onPrimary} />
                                ) : null}
                              </View>
                            </Pressable>
                            <Pressable
                              onPress={() => openEditTask(node.id)}
                              hitSlop={8}
                              style={({ pressed }) => [{ flex: 1, minWidth: 0 }, pressed && { opacity: 0.85 }]}>
                              <View style={styles.projectTaskMain}>
                              {hasAnyChildren ? (
                                <View
                                  style={[
                                    styles.projectTaskParentTag,
                                    {
                                      alignSelf: 'flex-start',
                                      backgroundColor: isDark ? 'rgba(96,165,250,0.14)' : 'rgba(0,88,190,0.1)',
                                      borderColor: isDark ? 'rgba(96,165,250,0.35)' : 'rgba(0,88,190,0.22)',
                                    },
                                  ]}>
                                  <MaterialIcons name="account-tree" size={12} color={primary} />
                                  <Text style={[styles.projectTaskParentTagText, { color: primary }]}>
                                    {childrenAll.length} 项子任务
                                  </Text>
                                </View>
                              ) : null}
                              <View style={styles.taskTitleRow}>
                                <View style={styles.projectTaskTitleMain}>
                                  {boundHabits.length === 1 ? (
                                    <Text
                                      style={styles.projectTaskHabitBindEmoji}
                                      accessibilityLabel={`已绑定小习惯：${boundHabits[0].name}`}>
                                      {boundHabits[0].icon}
                                    </Text>
                                  ) : boundHabits.length > 1 ? (
                                    <Text
                                      style={styles.projectTaskHabitBindEmoji}
                                      accessibilityLabel={`已绑定 ${boundHabits.length} 个小习惯`}>
                                      {boundHabits
                                        .slice(0, 2)
                                        .map((h) => h.icon)
                                        .join('')}
                                    </Text>
                                  ) : null}
                                  <Text
                                    style={[
                                      styles.projectTaskText,
                                      level > 1 && styles.projectTaskTextChild,
                                      {
                                        color: isDone ? colors.textMuted : dueOverdue ? error : colors.text,
                                        fontWeight: dueOverdue && !isDone ? '800' : level > 1 ? '600' : '700',
                                        textDecorationLine: isDone ? 'line-through' : 'none',
                                        opacity: isDone ? 0.85 : 1,
                                      },
                                    ]}
                                    numberOfLines={1}>
                                    {node.title}
                                  </Text>
                                </View>
                                <View style={styles.projectTaskTitleTags}>
                                  {boundHabitIds.length > 0 ? (
                                    <Text style={[styles.projectTaskHabitBindPillText, { color: outline }]}>
                                      {boundHabitIds.length > 1 ? `${boundHabitIds.length}项习惯` : '习惯'}
                                    </Text>
                                  ) : null}
                                  {isDone ? <Text style={styles.taskDoneTag}>已完成</Text> : null}
                                </View>
                              </View>
                              {(() => {
                                const meta = parseTaskMeta(node.extra_data);
                                const priorityLabel = formatTaskPriority(effectivePriority);
                                const priorityColor = getTaskPriorityColor(effectivePriority, isDark);
                                const reminder = (meta.reminder ?? '').trim();
                                const repeat = (meta.repeat ?? '').trim();
                                return (
                                  <View style={styles.projectTaskMetaRow}>
                                    {boundHabitIds.length > 0 ? (
                                      <View style={[styles.projectTaskMetaChip, { borderColor: outlineVariant }]}>
                                        <MaterialIcons name="repeat" size={11} color={outline} />
                                        <Text style={[styles.projectTaskMetaText, { color: outline }]} numberOfLines={2}>
                                          {boundHabitIds.length > 1
                                            ? `绑定「${boundHabitLabel}」· 全部达成即完成`
                                            : boundHabits.length === 1
                                              ? `绑定「${boundHabits[0].name}」· 达成即完成`
                                              : '绑定习惯（已删除）'}
                                        </Text>
                                      </View>
                                    ) : null}
                                    {!!priorityLabel && (
                                      <View style={[styles.projectTaskMetaChip, { backgroundColor: `${priorityColor}14`, borderColor: `${priorityColor}40` }]}>
                                        <MaterialIcons name="flag" size={11} color={priorityColor} />
                                        <Text style={[styles.projectTaskMetaText, { color: priorityColor }]}>{priorityLabel}</Text>
                                      </View>
                                    )}
                                    {!!dueDate && (
                                      <View
                                        style={[
                                          styles.projectTaskMetaChip,
                                          { borderColor: outlineVariant },
                                          dueOverdue && { backgroundColor: `${error}14`, borderColor: `${error}44` },
                                        ]}>
                                        <MaterialIcons name="event" size={11} color={dueOverdue ? error : outline} />
                                        <Text style={[styles.projectTaskMetaText, { color: dueOverdue ? error : outline }]}>{formatTaskDueText(dueDate, logicalTodayYmd)}</Text>
                                      </View>
                                    )}
                                    {dueOverdue ? (
                                      <View style={[styles.projectTaskMetaChip, { backgroundColor: `${error}18`, borderColor: `${error}55` }]}>
                                        <MaterialIcons name="report-problem" size={11} color={error} />
                                        <Text style={[styles.projectTaskMetaText, { color: error }]}>已过期</Text>
                                      </View>
                                    ) : null}
                                    {!!repeat && (
                                      <View style={[styles.projectTaskMetaChip, { borderColor: outlineVariant }]}>
                                        <MaterialIcons name="repeat" size={11} color={outline} />
                                        <Text style={[styles.projectTaskMetaText, { color: outline }]}>{repeat}</Text>
                                      </View>
                                    )}
                                    {!!reminder && (
                                      <View style={[styles.projectTaskMetaChip, { borderColor: outlineVariant }]}>
                                        <MaterialIcons name="notifications-active" size={11} color={outline} />
                                        <Text style={[styles.projectTaskMetaText, { color: outline }]}>{reminder}</Text>
                                      </View>
                                    )}
                                    <CompletionRewardBadge
                                      extraData={node.extra_data}
                                      wishNameById={wishNameById}
                                      outline={outline}
                                      accent={tertiary}
                                      isDark={isDark}
                                    />
                                  </View>
                                );
                              })()}
                              {hasAnyChildren ? (() => {
                                const { total: directTotal, done: directDone, ratio } =
                                  getDirectChildTaskProgress(childrenAll);
                                if (directTotal <= 0) return null;
                                return (
                                  <>
                                    <View style={styles.projectTaskProgressRow}>
                                      <Text style={[styles.projectTaskProgressLabel, { color: outline }]}>
                                        进度 {directDone}/{directTotal}
                                      </Text>
                                      <Text style={[styles.projectTaskProgressLabel, { color: outline }]}>
                                        {Math.round(ratio * 100)}%
                                      </Text>
                                    </View>
                                    <View
                                      style={[
                                        styles.projectTaskProgressTrack,
                                        { backgroundColor: isDark ? 'rgba(148,163,184,0.14)' : '#e2e7ff' },
                                      ]}>
                                      <View
                                        style={[
                                          styles.projectTaskProgressFill,
                                          { backgroundColor: primary, width: `${Math.round(ratio * 100)}%` },
                                        ]}
                                      />
                                    </View>
                                  </>
                                );
                              })() : null}
                              {!!acceptanceText && (
                                <View style={[styles.projectTaskNoteRow, { borderTopColor: hairlineColor }]}>
                                  <MaterialIcons name="fact-check" size={13} color={secondary} style={styles.projectTaskNoteIcon} />
                                  <Text
                                    style={[styles.projectTaskAcceptanceText, { color: colors.textSecondary }]}
                                    numberOfLines={3}>
                                    {acceptanceText}
                                  </Text>
                                </View>
                              )}
                              {!!noteText && (
                                <View style={[styles.projectTaskNoteRow, { borderTopColor: hairlineColor }]}>
                                  <MaterialIcons name="sticky-note-2" size={13} color={outline} style={styles.projectTaskNoteIcon} />
                                  <Text
                                    style={[styles.projectTaskNoteText, { color: colors.textSecondary }]}
                                    numberOfLines={3}>
                                    {noteText}
                                  </Text>
                                </View>
                              )}
                              {canToggleCollapse && isCollapsed ? (
                                <Text style={[styles.projectTaskCollapsedHint, { color: outline }]}>
                                  已收起 {childrenAll.length} 项子任务，点击左侧箭头展开
                                </Text>
                              ) : null}
                            </View>
                            </Pressable>
                          </View>
                          {hasChildrenToRender && isExpandedTask ? renderTaskLevel(displayChildren, level + 1) : null}
                          {hasDeeperLevels && isExpandedTask ? (
                            <Text
                              style={[
                                styles.projectTaskEllipsisInline,
                                {
                                  color: '#6b7280',
                                  paddingLeft: hintPaddingLeft,
                                },
                              ]}>
                              还有更深层级任务
                            </Text>
                          ) : null}
                        </View>
                      );
                    });
                  };

                  const hasAnyTasks = taskTree.length > 0;
                  const isInInbox = isProjectInInboxCategory(project.category_id);
                  const canSwipeArchiveToInbox =
                    project.status !== 'completed' &&
                    project.status !== 'archived' &&
                    !isInInbox;
                  const canSwipeDeleteFromInbox = isInInbox;
                  return (
                    <View key={project.id} style={styles.projectSwipeWrap}>
                      <Swipeable
                        ref={(r) => {
                          projectSwipeableRefs.current[project.id] = r;
                        }}
                        enabled={canSwipeArchiveToInbox || canSwipeDeleteFromInbox}
                        overshootRight={false}
                        friction={2}
                        renderRightActions={() => (
                          <View style={styles.projectSwipeActions}>
                            {canSwipeDeleteFromInbox ? (
                              <Pressable
                                onPress={() => confirmDeleteInboxProject(project)}
                                style={({ pressed }) => [
                                  styles.projectSwipeDelete,
                                  { opacity: pressed ? 0.9 : 1, backgroundColor: error },
                                ]}
                                accessibilityRole="button"
                                accessibilityLabel={`彻底删除 ${project.name}`}>
                                <MaterialIcons name="delete-outline" size={22} color="#fff" />
                                <Text style={styles.projectSwipeDeleteText} numberOfLines={1}>
                                  删除
                                </Text>
                              </Pressable>
                            ) : canSwipeArchiveToInbox ? (
                              <Pressable
                                onPress={() => void handleProjectSwipeArchive(project)}
                                style={({ pressed }) => [
                                  styles.projectSwipeArchive,
                                  { opacity: pressed ? 0.9 : 1, backgroundColor: secondary },
                                ]}
                                accessibilityRole="button"
                                accessibilityLabel={`将 ${project.name} 归纳到收集箱`}>
                                <MaterialIcons name="inventory-2" size={22} color="#fff" />
                                <Text style={styles.projectSwipeArchiveText} numberOfLines={1}>
                                  收纳
                                </Text>
                              </Pressable>
                            ) : null}
                          </View>
                        )}>
                        <View
                          style={[
                            styles.projectCard,
                            {
                              backgroundColor: projectCardBg,
                              borderColor: isLocked
                                ? isDark
                                  ? 'rgba(148,163,184,0.32)'
                                  : 'rgba(148,163,184,0.38)'
                                : isCompleted
                                  ? isDark
                                    ? 'rgba(52, 211, 153, 0.32)'
                                    : 'rgba(0, 108, 73, 0.24)'
                                  : isDark
                                    ? 'rgba(148,163,184,0.2)'
                                    : 'rgba(15, 23, 42, 0.08)',
                            },
                          ]}>
                      <ScalePressable
                        onPress={() => openProject(project.id)}
                        hitSlop={6}
                        scaleTo={0.988}
                        style={styles.projectHeadPressable}>
                      <View style={styles.projectHead}>
                        <View style={styles.projectHeadLeft}>
                          <View
                            style={[
                              styles.projectIconWrap,
                              {
                                backgroundColor: isLocked
                                  ? isDark
                                    ? 'rgba(148,163,184,0.14)'
                                    : 'rgba(114,119,133,0.1)'
                                  : isCompleted
                                    ? isDark
                                      ? 'rgba(52, 211, 153, 0.14)'
                                      : 'rgba(0, 108, 73, 0.1)'
                                    : isDark
                                      ? 'rgba(96,165,250,0.14)'
                                      : 'rgba(0,88,190,0.08)',
                              },
                            ]}>
                            <MaterialIcons
                              name={isLocked ? 'lock' : isCompleted ? 'check-circle' : 'data-usage'}
                              size={20}
                              color={projectAccent}
                            />
                          </View>
                          <View style={styles.projectHeadMainColumn}>
                            <View style={styles.projectTitleRow}>
                              <Text
                                style={[
                                  styles.projectTitle,
                                  {
                                    color: isScheduleExpired
                                      ? error
                                      : isLocked || isCompleted
                                        ? doneMuted
                                        : colors.text,
                                    fontWeight: isScheduleExpired ? '800' : '700',
                                    flex: 1,
                                  },
                                  isCompleted && styles.projectTitleDone,
                                  isCompleted && Platform.OS === 'android' ? styles.projectTitleDoneAndroid : null,
                                ]}
                                numberOfLines={2}>
                                {project.name}
                              </Text>
                              {isScheduleExpired ? (
                                <View
                                  style={[
                                    styles.projectDoneBadge,
                                    {
                                      backgroundColor: isDark ? 'rgba(248,113,113,0.16)' : 'rgba(186,26,26,0.1)',
                                      borderColor: isDark ? 'rgba(248,113,113,0.38)' : 'rgba(186,26,26,0.28)',
                                    },
                                  ]}>
                                  <MaterialIcons name="report-problem" size={12} color={error} />
                                  <Text style={[styles.projectDoneBadgeText, { color: error, fontWeight: '800' }]}>
                                    已过期
                                  </Text>
                                </View>
                              ) : isLocked ? (
                                <View
                                  style={[
                                    styles.projectDoneBadge,
                                    {
                                      backgroundColor: isDark ? 'rgba(148,163,184,0.16)' : 'rgba(114,119,133,0.1)',
                                      borderColor: isDark ? 'rgba(148,163,184,0.38)' : 'rgba(114,119,133,0.28)',
                                    },
                                  ]}>
                                  <MaterialIcons name="lock" size={12} color={outline} />
                                  <Text style={[styles.projectDoneBadgeText, { color: outline }]}>待解锁</Text>
                                </View>
                              ) : isCompleted ? (
                                <View
                                  style={[
                                    styles.projectDoneBadge,
                                    {
                                      backgroundColor: isDark ? 'rgba(52, 211, 153, 0.16)' : 'rgba(0, 108, 73, 0.1)',
                                      borderColor: isDark ? 'rgba(52, 211, 153, 0.38)' : 'rgba(0, 108, 73, 0.28)',
                                    },
                                  ]}>
                                  <MaterialIcons name="verified" size={12} color={success} />
                                  <Text style={[styles.projectDoneBadgeText, { color: success }]}>
                                    {isArchived ? '已归档' : '已完成'}
                                  </Text>
                                </View>
                              ) : null}
                            </View>
                            <View style={styles.projectSubRow}>
                              {dueDateLabel ? (
                                <Text
                                  style={[
                                    styles.projectSub,
                                    {
                                      color: isScheduleExpired ? error : isCompleted ? doneMuted : outline,
                                      fontWeight: isScheduleExpired ? '800' : '600',
                                    },
                                  ]}>
                                  {isScheduleExpired
                                    ? isRangeSchedule && rangeEndYmd
                                      ? `已于：${formatYmdCN(rangeEndYmd)} 过期`
                                      : dueYmd
                                        ? `已于：${formatYmdCN(dueYmd)} 过期`
                                        : `已于：${dueDateLabel} 过期`
                                    : isRangeSchedule
                                      ? dueDateLabel
                                      : dueYmd
                                        ? formatProjectDueText(dueYmd, logicalTodayYmd)
                                        : `截止 ${dueDateLabel}`}
                                </Text>
                              ) : (
                                <Text style={[styles.projectSub, { color: isCompleted ? doneMuted : outline }]}>无截止日期</Text>
                              )}
                              <Text style={[styles.projectSub, { color: isCompleted ? doneMuted : outline }]}>•</Text>
                              <Text style={[styles.projectSub, { color: isCompleted ? doneMuted : outline }]}>
                                分类 {categoryLabel}
                              </Text>
                            </View>
                            {isLocked && (lockInfo?.unmetPrerequisiteNames.length ?? 0) > 0 ? (
                              <Text style={[styles.projectLockHint, { color: outline }]} numberOfLines={2}>
                                等待前置：{lockInfo!.unmetPrerequisiteNames.join('、')}（完成后解锁，暂不可分配青蛙）
                              </Text>
                            ) : null}
                            {isScheduleNotStarted ? (
                              <Text style={[styles.projectLockHint, { color: outline }]} numberOfLines={2}>
                                计划将于{' '}
                                {formatYmdCN(
                                  lockInfo?.scheduleStartYmd ??
                                    getProjectScheduleYmdBounds(project).startYmd ??
                                    '',
                                )}{' '}
                                开始，到达前暂不可分配青蛙
                              </Text>
                            ) : null}
                            {noteText ? (
                              <View
                                style={[
                                  styles.projectNoteRow,
                                  {
                                    borderTopColor: isDark
                                      ? 'rgba(148, 163, 184, 0.22)'
                                      : 'rgba(203,213,225,0.9)',
                                  },
                                ]}>
                                <MaterialIcons name="notes" size={14} color={outline} style={styles.projectNoteIcon} />
                                <Text
                                  style={[styles.projectNoteText, { color: colors.textSecondary }]}
                                  numberOfLines={2}>
                                  {noteText}
                                </Text>
                              </View>
                            ) : null}
                            <View style={styles.projectMetaRow}>
                              {!isCompleted ? (
                                <Text style={[styles.projectSubStrong, { color: primary }]}>
                                  {project.status === 'active' ? '进行中' : project.status === 'paused' ? '已暂停' : '未知状态'}
                                </Text>
                              ) : null}
                              {!isCompleted && (hasReminder || hasRepeat) ? (
                                <Text style={[styles.projectSub, { color: outline }]}>•</Text>
                              ) : null}
                              {hasReminder && (
                                <View style={styles.projectFlag}>
                                  <MaterialIcons
                                    name="notifications-active"
                                    size={11}
                                    color={isCompleted ? doneMuted : primary}
                                  />
                                  <Text style={[styles.projectFlagText, { color: isCompleted ? doneMuted : primary }]}>
                                    提醒
                                  </Text>
                                </View>
                              )}
                              {hasRepeat && (
                                <View style={styles.projectFlag}>
                                  <MaterialIcons name="repeat" size={11} color={isCompleted ? doneMuted : primary} />
                                  <Text style={[styles.projectFlagText, { color: isCompleted ? doneMuted : primary }]}>
                                    重复
                                  </Text>
                                </View>
                              )}
                              <CompletionRewardBadge
                                extraData={project.extra_data}
                                wishNameById={wishNameById}
                                outline={outline}
                                accent={tertiary}
                                isDark={isDark}
                              />
                            </View>
                            {progress.total > 0 ? (
                              <>
                                <View style={styles.projectProgressRow}>
                                  <Text
                                    style={[
                                      styles.projectProgressLabel,
                                      { color: isCompleted ? doneMuted : outline },
                                    ]}>
                                    进度 {progress.done}/{progress.total}
                                  </Text>
                                  <Text
                                    style={[
                                      styles.projectProgressLabel,
                                      { color: isCompleted ? success : outline },
                                    ]}>
                                    {Math.round(progress.ratio * 100)}%
                                  </Text>
                                </View>
                                <View
                                  style={[
                                    styles.projectProgressTrack,
                                    {
                                      backgroundColor: isCompleted
                                        ? isDark
                                          ? 'rgba(52, 211, 153, 0.12)'
                                          : 'rgba(0, 108, 73, 0.1)'
                                        : isDark
                                          ? 'rgba(148,163,184,0.16)'
                                          : '#e2e7ff',
                                    },
                                  ]}>
                                  <View
                                    style={[
                                      styles.projectProgressFill,
                                      {
                                        backgroundColor: isCompleted ? success : primary,
                                        width: `${Math.round(progress.ratio * 100)}%`,
                                      },
                                    ]}
                                  />
                                </View>
                              </>
                            ) : null}
                            {hasAnyTasks ? (() => {
                              const aiReview = parseProjectAiReview(project.extra_data);
                              const aiPending =
                                projectAiPendingIds.has(project.id) || projectAiTriggerLoadingId === project.id;
                              const hasAiContent = !!(aiReview?.evaluation || aiReview?.suggestions);
                              if (!aiPending && !hasAiContent) {
                                return (
                                  <Pressable
                                    onPress={(e) => {
                                      e.stopPropagation?.();
                                      void triggerProjectAiReview(project.id);
                                    }}
                                    disabled={!zhipuReady || aiPending}
                                    hitSlop={6}
                                    style={({ pressed }) => [
                                      styles.projectAiTriggerBtn,
                                      {
                                        borderColor: isDark ? 'rgba(96,165,250,0.35)' : 'rgba(0,88,190,0.22)',
                                        backgroundColor: isDark ? 'rgba(96,165,250,0.12)' : 'rgba(0,88,190,0.06)',
                                        opacity: !zhipuReady ? 0.45 : pressed ? 0.82 : 1,
                                      },
                                    ]}>
                                    <MaterialIcons name="auto-awesome" size={14} color={primary} />
                                    <Text style={[styles.projectAiTriggerText, { color: primary }]}>生成 AI 点评</Text>
                                  </Pressable>
                                );
                              }
                              return (
                                <View style={styles.projectAiWrap}>
                                  {aiPending ? (
                                    <View style={styles.projectAiPendingRow}>
                                      <ActivityIndicator size="small" color={primary} />
                                      <Text style={[styles.projectAiPreview, { color: outline }]}>AI 分析中…</Text>
                                    </View>
                                  ) : aiReview ? (
                                    <>
                                      <Pressable
                                        onPress={(e) => {
                                          e.stopPropagation?.();
                                          setProjectAiModal({ projectName: project.name, review: aiReview });
                                        }}
                                        hitSlop={6}
                                        style={({ pressed }) => [pressed && { opacity: 0.85 }]}>
                                        <Text style={[styles.projectAiPreview, { color: colors.textSecondary }]} numberOfLines={2}>
                                          <Text style={{ fontWeight: '800', color: primary }}>AI 点评：</Text>
                                          {aiReview.evaluation || aiReview.suggestions}
                                        </Text>
                                        {aiReview.review_at ? (
                                          <Text style={[styles.projectAiTime, { color: outline }]}>
                                            {new Date(aiReview.review_at).toLocaleString('zh-CN', {
                                              month: 'numeric',
                                              day: 'numeric',
                                              hour: '2-digit',
                                              minute: '2-digit',
                                            })}
                                          </Text>
                                        ) : null}
                                      </Pressable>
                                      <Pressable
                                        onPress={(e) => {
                                          e.stopPropagation?.();
                                          void triggerProjectAiReview(project.id);
                                        }}
                                        disabled={!zhipuReady}
                                        hitSlop={6}
                                        style={({ pressed }) => [
                                          styles.projectAiRetriggerBtn,
                                          { opacity: !zhipuReady ? 0.45 : pressed ? 0.75 : 1 },
                                        ]}>
                                        <Text style={[styles.projectAiRetriggerText, { color: primary }]}>重新分析</Text>
                                      </Pressable>
                                    </>
                                  ) : null}
                                </View>
                              );
                            })() : null}
                          </View>
                        </View>
                        <View style={styles.projectHeadRight}>
                          <Pressable
                            onPress={(e) => {
                              e.stopPropagation();
                              openQuickAddTaskForProject(project);
                            }}
                            hitSlop={8}
                            accessibilityRole="button"
                            accessibilityLabel={`为「${project.name}」快捷添加任务`}
                            style={({ pressed }) => [
                              styles.projectQuickAddBtn,
                              isCompleted && { opacity: 0.55 },
                              pressed && { opacity: 0.75 },
                            ]}>
                            <MaterialIcons name="add-task" size={20} color={isCompleted ? doneMuted : primary} />
                          </Pressable>
                          {hasAnyTasks ? (
                            <Pressable
                              onPress={(e) => {
                                e.stopPropagation();
                                toggleProjectExpand(project.id);
                              }}
                              hitSlop={8}
                              style={({ pressed }) => [styles.projectExpandBtn, pressed && { opacity: 0.75 }]}>
                              <MaterialIcons name={isExpanded ? 'expand-less' : 'expand-more'} size={20} color={outline} />
                            </Pressable>
                          ) : null}
                        </View>
                      </View>
                      </ScalePressable>
                      {(!hasAnyTasks || isExpanded) && (
                        <View
                          style={[
                            styles.projectTaskBody,
                            {
                              borderTopColor: outlineVariant,
                              backgroundColor: isDark ? 'rgba(15,23,42,0.28)' : 'rgba(248,250,252,0.9)',
                            },
                          ]}>
                          {!hasAnyTasks ? (
                            <Text style={[styles.projectTaskEmpty, { color: outline }]}>暂无任务</Text>
                          ) : displayTaskTree.length === 0 ? (
                            <Text style={[styles.projectTaskEmpty, { color: outline }]}>
                              已完成任务已隐藏，取消勾选「隐藏已完成任务」可查看
                            </Text>
                          ) : (
                            <>
                              {renderTaskLevel(displayTaskTree, 1)}
                            </>
                          )}
                        </View>
                      )}
                        </View>
                      </Swipeable>
                    </View>
                  );
                })}
                {projectsShownInList.length === 0 && (
                  <View style={styles.projectSwipeWrap}>
                  <View style={[styles.projectCard, { backgroundColor: soft, opacity: 0.86 }]}>
                    <View style={[styles.projectHead, { borderLeftColor: outline }]}> 
                      <View style={styles.projectHeadLeft}>
                        <MaterialIcons name="folder-open" size={22} color={outline} />
                        <View style={styles.projectHeadMainColumn}>
                          <Text style={[styles.projectTitle, { color: colors.textSecondary }]}>暂无项目</Text>
                          <Text style={[styles.projectSub, { color: outline }]}>可点击右上角“新建项目”添加</Text>
                        </View>
                      </View>
                    </View>
                  </View>
                  </View>
                )}
                </View>
              </View>
          </Animated.View>
            )}
          </View>

          {/* 底部留白用实体高度，避免 scrollEnabled 切换时与 paddingBottom 叠加触发布局回弹 */}
          <View style={{ height: 46 + mainScrollKeyboardPad }} />
        </Animated.View>
            </Animated.View>
          ) : null}

          {initialTasksLoadPending || tasksSkeletonMounted ? (
            <Animated.View
              pointerEvents={initialTasksLoadPending ? 'auto' : 'none'}
              style={[
                initialTasksLoadPending ? undefined : styles.tasksSkeletonOverlay,
                {
                  opacity: initialTasksLoadPending ? 1 : tasksSkeletonOpacity,
                  backgroundColor: initialTasksLoadPending ? undefined : bg,
                },
              ]}
            >
              <TasksFrogSectionSkeleton colors={colors} cardBg={card} frogCardWidth={frogCarouselCardWidth} />
              <TasksHeatmapSkeleton colors={colors} cardBg={card} />
              <TasksStandaloneSectionSkeleton colors={colors} cardBg={card} />
              <TasksHabitSectionSkeleton colors={colors} cardBg={card} habitItemWidth={habitGridItemWidth} />
              <TasksProjectsSectionSkeleton colors={colors} cardBg={card} />
              <View style={{ height: 46 }} />
            </Animated.View>
          ) : null}
        </View>
      </ScrollView>

      {operationToast && (
        <View pointerEvents="none" style={styles.operationToastWrap}>
          <View
            style={[
              styles.operationToast,
              { backgroundColor: operationToast.kind === 'success' ? `${success}f2` : `${error}f2` },
            ]}>
            <MaterialIcons
              name={operationToast.kind === 'success' ? 'check-circle' : 'error'}
              size={18}
              color="#fff"
            />
            <Text style={styles.operationToastText}>{operationToast.message}</Text>
          </View>
        </View>
      )}

      <Modal transparent visible={mutationOverlayLabel != null} animationType="fade" statusBarTranslucent>
        <View style={[styles.mutationOverlay, { backgroundColor: colors.overlay }]}>
          <View style={[styles.mutationOverlayCard, { backgroundColor: modalCardBg }]}>
            <ActivityIndicator color={primary} />
            <Text style={[styles.mutationOverlayText, { color: colors.text }]}>{mutationOverlayLabel}</Text>
          </View>
        </View>
      </Modal>

      <Modal
        visible={projectAiModal != null}
        transparent
        animationType="fade"
        onRequestClose={() => setProjectAiModal(null)}>
        <View style={styles.modalRoot}>
          <Pressable style={[styles.modalBackdrop, { backgroundColor: colors.overlay }]} onPress={() => setProjectAiModal(null)} />
          <View pointerEvents="box-none" style={styles.modalCenter}>
            <View style={[styles.modalCard, { backgroundColor: modalCardBg, maxHeight: '78%' }]}>
              <View style={styles.modalHeader}>
                <Text style={[styles.modalTitle, { color: colors.text }]} numberOfLines={1}>
                  {projectAiModal?.projectName ?? '项目'} · AI 点评
                </Text>
                <Pressable onPress={() => setProjectAiModal(null)} hitSlop={10}>
                  <MaterialIcons name="close" size={22} color={outline} />
                </Pressable>
              </View>
              <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 420 }}>
                {!!projectAiModal?.review.evaluation && (
                  <>
                    <Text style={[styles.projectAiModalKicker, { color: outline }]}>整体点评</Text>
                    <Text style={[styles.projectAiModalBody, { color: colors.text }]}>{projectAiModal.review.evaluation}</Text>
                  </>
                )}
                {!!projectAiModal?.review.suggestions && (
                  <>
                    <Text style={[styles.projectAiModalKicker, { color: outline, marginTop: 14 }]}>行动建议</Text>
                    <Text style={[styles.projectAiModalBody, { color: colors.textSecondary }]}>
                      {projectAiModal.review.suggestions}
                    </Text>
                  </>
                )}
              </ScrollView>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={subHabitModal != null}
        transparent
        animationType="fade"
        onRequestClose={() => setSubHabitModal(null)}>
        <View style={styles.modalRoot}>
          <Pressable
            style={[styles.modalBackdrop, { backgroundColor: colors.overlay }]}
            onPress={() => setSubHabitModal(null)}
          />
          <View pointerEvents="box-none" style={styles.modalCenter}>
            <View style={[styles.modalCard, { backgroundColor: modalCardBg, maxHeight: '78%', width: '92%' }]}>
              <View style={styles.modalHeader}>
                <View style={styles.subHabitModalTitleRow}>
                  <Text style={styles.subHabitModalIcon}>{subHabitModal?.icon ?? '✓'}</Text>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[styles.modalTitle, { color: colors.text }]} numberOfLines={1}>
                      {subHabitModal?.name ?? '子习惯'}
                    </Text>
                    <Text style={[styles.subHabitModalProgress, { color: outline }]}>
                      今日进度{' '}
                      {subHabitModal
                        ? `${Object.values(subHabitModal.doneMap).filter(Boolean).length}/${subHabitModal.subHabits.length}`
                        : '0/0'}
                    </Text>
                  </View>
                </View>
                <Pressable onPress={() => setSubHabitModal(null)} hitSlop={10}>
                  <MaterialIcons name="close" size={22} color={outline} />
                </Pressable>
              </View>
              <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 420 }}>
                <View style={styles.subHabitModalList}>
                  {(subHabitModal?.subHabits ?? []).map((sub) => {
                    const done = Boolean(subHabitModal?.doneMap[sub.id]);
                    const busy = subHabitTogglingId === sub.id;
                    return (
                      <Pressable
                        key={sub.id}
                        disabled={busy || subHabitTogglingId != null}
                        onPress={() => void handleSubHabitToggle(sub.id)}
                        style={({ pressed }) => [
                          styles.subHabitModalRow,
                          {
                            backgroundColor: done
                              ? isDark
                                ? 'rgba(52,211,153,0.14)'
                                : 'rgba(0,108,73,0.08)'
                              : isDark
                                ? 'rgba(148,163,184,0.1)'
                                : 'rgba(148,163,184,0.08)',
                            borderColor: done
                              ? isDark
                                ? 'rgba(52,211,153,0.45)'
                                : 'rgba(0,108,73,0.35)'
                              : colors.outline,
                            opacity: busy ? 0.7 : pressed ? 0.88 : 1,
                          },
                        ]}>
                        <View
                          style={[
                            styles.subHabitModalCheck,
                            {
                              backgroundColor: done ? secondary : 'transparent',
                              borderColor: done ? secondary : outline,
                            },
                          ]}>
                          {done ? <MaterialIcons name="check" size={16} color="#fff" /> : null}
                        </View>
                        <Text
                          style={[
                            styles.subHabitModalName,
                            {
                              color: colors.text,
                              textDecorationLine: done ? 'line-through' : 'none',
                              opacity: done ? 0.72 : 1,
                            },
                          ]}
                          numberOfLines={2}>
                          {sub.name}
                        </Text>
                        {busy ? <ActivityIndicator size="small" color={primary} /> : null}
                      </Pressable>
                    );
                  })}
                </View>
              </ScrollView>
              <Text style={[styles.subHabitModalHint, { color: outline }]}>
                点选完成子习惯；全部完成后计入父习惯当日打卡
              </Text>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={categoryModalVisible} transparent animationType="fade" onRequestClose={closeCategoryMenu}>
        <View style={styles.modalRoot}>
          <Pressable style={[styles.modalBackdrop, { backgroundColor: colors.overlay }]} onPress={closeCategoryMenu} />
          <View pointerEvents="box-none" style={styles.modalCenter}>
            <View style={[styles.modalCard, { backgroundColor: modalCardBg }]}>
              <View style={styles.modalHeader}>
                <View style={[styles.modalTitleWrap, { backgroundColor: `${primary}12` }]}>
                  <MaterialIcons name="folder-open" size={18} color={primary} />
                  <View>
                    <Text style={[styles.modalTitle, { color: colors.text }]}>{activeCategoryLabel}</Text>
                    <Text style={[styles.modalSubtitle, { color: outline }]}>编辑分类</Text>
                  </View>
                </View>
                <Pressable onPress={closeCategoryMenu} hitSlop={10}>
                  <MaterialIcons name="close" size={22} color={outline} />
                </Pressable>
              </View>

              <View style={styles.modalActions}>
                {[
                  { icon: 'add', label: '新建分类', color: primary, onPress: () => openCategoryEditor('新建分类') },
                  { icon: 'sort', label: '排序分类', color: secondary, onPress: () => {
                    closeCategoryMenu();
                    router.push({ pathname: '/category-sort', params: { scope: 'project' } });
                  } },
                  { icon: 'edit', label: '修改分类', color: tertiary, onPress: () => {
                    if (!activeCategoryId) {
                      Alert.alert('提示', '请先长按某个分类进入。');
                      return;
                    }
                    if (activeCategoryId === 'all') {
                      Alert.alert('提示', '“全部”不是可编辑分类。');
                      return;
                    }
                    if (activeCategoryId === INBOX_PROJECT_CATEGORY_ID) {
                      Alert.alert('提示', '“收集箱”是内置分类，不能改名。');
                      return;
                    }
                    const fallbackName = scopedCategories.find((c) => c.id === activeCategoryId)?.name ?? '';
                    openCategoryEditor('修改分类', categoryInputValue || fallbackName, activeCategoryId);
                  } },
                  { icon: 'delete', label: '删除分类', color: error, onPress: removeCategory },
                ].map((action) => (
                  <Pressable key={action.label} onPress={action.onPress} style={({ pressed }) => [styles.actionItem, { borderColor: `${action.color}22` }, pressed && { opacity: 0.8 }]}>
                    <View style={[styles.actionIcon, { backgroundColor: `${action.color}14` }]}>
                      <MaterialIcons name={action.icon as any} size={18} color={action.color} />
                    </View>
                    <Text style={[styles.actionText, { color: colors.text }]}>{action.label}</Text>
                    <MaterialIcons name="chevron-right" size={20} color={outline} />
                  </Pressable>
                ))}
              </View>

            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={categoryEditorVisible} transparent animationType="fade" onRequestClose={closeCategoryEditor}>
        <View style={styles.modalRoot}>
          <Pressable style={[styles.modalBackdrop, { backgroundColor: colors.overlay }]} onPress={closeCategoryEditor} />
          <View pointerEvents="box-none" style={styles.modalCenter}>
            <View style={[styles.editorCard, { backgroundColor: modalCardBg }]}>
              <Text style={[styles.editorTitle, { color: colors.text }]}>{categoryEditorTitle}</Text>
              <Text style={[styles.editorHint, { color: outline }]}>请输入分类名称后确认</Text>
              <View style={[styles.editorInputWrap, { borderColor: outlineVariant, backgroundColor: soft }]}>
                <TextInput
                  style={[styles.editorInput, { color: colors.text }]}
                  placeholder="例如：工作任务"
                  placeholderTextColor={outline}
                  value={categoryInputValue}
                  onChangeText={setCategoryInputValue}
                  underlineColorAndroid="transparent"
                  {...(Platform.OS === 'android'
                    ? { includeFontPadding: false, textAlignVertical: 'center' as const }
                    : {})}
                />
              </View>
              <View style={styles.editorActions}>
                <Pressable onPress={closeCategoryEditor} style={({ pressed }) => [styles.editorGhostBtn, pressed && { opacity: 0.8 }]}>
                  <Text style={[styles.editorGhostText, { color: outline }]}>取消</Text>
                </Pressable>
                <Pressable onPress={saveCategory} style={({ pressed }) => [styles.editorPrimaryBtn, { backgroundColor: primary }, pressed && { opacity: 0.9 }]}>
                  <Text style={styles.editorPrimaryText}>确认</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </View>
      </Modal>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  operationToastWrap: {
    position: 'absolute',
    top: 72,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 40,
    paddingHorizontal: Spacing.xl,
  },
  operationToast: {
    minHeight: 42,
    maxWidth: '92%',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  operationToastText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '800',
  },
  mutationOverlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing['2xl'],
  },
  mutationOverlayCard: {
    minWidth: 168,
    borderRadius: Radius['2xl'],
    paddingHorizontal: Spacing['2xl'],
    paddingVertical: Spacing.xl,
    alignItems: 'center',
    gap: Spacing.md,
  },
  mutationOverlayText: {
    fontSize: 14,
    fontWeight: '800',
  },
  pageHeader: {
    paddingHorizontal: Spacing['5xl'],
    paddingBottom: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    zIndex: 10,
  },
  pageHeaderRow: {
    height: Layout.headerHeight,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pageHeaderSideSpacer: {
    width: Layout.iconButtonSize,
    height: Layout.iconButtonSize,
  },
  pageHeaderTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: -0.2,
    textAlign: 'center',
  },
  scroll: { flex: 1 },
  content: {
    maxWidth: Layout.contentMaxWidth,
    alignSelf: 'center',
    width: '100%',
    paddingHorizontal: Spacing['5xl'],
    paddingBottom: Spacing['4xl'],
    gap: Spacing['4xl'],
  },
  tasksBodyStack: {
    position: 'relative',
    gap: Spacing['4xl'],
  },
  tasksSkeletonOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 2,
    gap: Spacing['4xl'],
  },
  bgOrb: {
    position: 'absolute',
    width: 170,
    height: 170,
    borderRadius: 999,
  },
  bgOrbTop: {
    top: 20,
    right: -52,
  },
  bgOrbBottom: {
    top: 440,
    left: -74,
  },
  section: { gap: Spacing.xl },
  stackedSection: {
    marginTop: Spacing.lg,
    paddingTop: Spacing['2xl'],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(148,163,184,0.18)',
  },
  sectionCard: {
    borderRadius: Radius['2xl'],
    padding: Spacing['4xl'],
    borderWidth: StyleSheet.hairlineWidth,
    gap: Spacing.xl,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.md },
  projectListTitleCol: { flex: 1, minWidth: 0, gap: Spacing.xs },
  projectListFilterRow: { paddingTop: Spacing.lg, paddingBottom: Spacing.xs },
  projectFilterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: Spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing['2xl'],
    paddingVertical: Spacing.md,
  },
  projectFilterChipMark: {
    width: 16,
    height: 16,
    borderRadius: 5,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  projectFilterChipText: { fontSize: 12, fontWeight: '800', letterSpacing: 0.2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, flexShrink: 1 },
  sectionTitle: { ...Typography.h2 },
  sectionMeta: { ...Typography.caption },
  frogHeaderActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flexShrink: 0 },
  ghostBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
  },
  ghostBtnText: { fontSize: 12, fontWeight: '800' },

  frogHeatmapOuter: { marginTop: 2, gap: 10 },
  completionHeatmapDetailSectionLabel: { fontSize: 12, fontWeight: '800', marginBottom: 4, letterSpacing: 0.2 },
  frogHeatmapHeading: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
    gap: 10,
  },
  frogHeatmapTitle: { fontSize: 17, fontWeight: '800', letterSpacing: 0.3 },
  frogHeatmapLegend: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  frogHeatmapLegendText: { fontSize: 12, fontWeight: '600' },
  frogHeatmapLegendSwatches: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  frogHeatmapLegendCell: { width: 14, height: 14, borderRadius: 4 },
  frogHeatmapCard: {
    borderRadius: Radius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing['2xl'],
    ...Shadows.card,
  },
  frogHeatmapBodyRow: { flexDirection: 'row', alignItems: 'flex-start' },
  frogHeatmapYAxis: { width: 22, marginRight: 4 },
  frogHeatmapYCell: { justifyContent: 'center', alignItems: 'flex-end', paddingRight: 2 },
  frogHeatmapYLabel: { fontSize: 11, fontWeight: '700' },
  frogHeatmapMonthRow: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 2 },
  frogHeatmapMonthText: { fontSize: 11, fontWeight: '700' },
  frogHeatmapGridRow: { flexDirection: 'row' },
  frogHeatmapCellHit: { alignItems: 'center', justifyContent: 'center' },
  frogHeatmapDataCell: { borderRadius: 6 },
  frogHeatmapDetail: {
    marginTop: 4,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  frogHeatmapDetailHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  frogHeatmapDetailDate: { fontSize: 16, fontWeight: '800', flex: 1, minWidth: 0, marginRight: 4 },
  frogHeatmapDetailFrogCount: { fontSize: 15, fontWeight: '800', flexShrink: 0 },
  frogHeatmapDetailEmpty: { fontSize: 13, fontWeight: '600', paddingVertical: 4 },
  frogHeatmapDetailList: { marginTop: 2 },
  frogHeatmapDetailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  frogHeatmapDetailTitle: { flex: 1, fontSize: 14, fontWeight: '700', lineHeight: 20 },

  frogCarousel: {
    flexGrow: 0,
    marginHorizontal: -2,
  },
  frogCarouselContent: {
    flexDirection: 'row',
    alignItems: 'stretch',
    paddingRight: 4,
  },
  frogCard: {
    borderRadius: Radius.xl,
    paddingHorizontal: Spacing['2xl'],
    paddingTop: Spacing.xl + 4,
    paddingBottom: Spacing.xl,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    ...Shadows.card,
  },
  frogAccentBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 3,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
  },
  frogCardSlide: {
    flexShrink: 0,
    marginRight: 12,
  },
  frogCardEmpty: {
    alignSelf: 'stretch',
  },
  frogIconBadge: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  frogTopLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 },
  frogTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  frogTopRowCompact: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  frogCardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  frogCardActions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  inlineDoneBtn: { borderRadius: 10 },
  badge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  badgeCompact: { paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { fontSize: 10, fontWeight: '800', letterSpacing: 1.1, textTransform: 'uppercase' },
  badgeTextCompact: { fontSize: 9, letterSpacing: 0.7 },
  frogTitle: { fontSize: 20, fontWeight: '800', marginBottom: 6, paddingRight: 40 },
  frogTitleCompact: { fontSize: 16, fontWeight: '800', marginBottom: 4, lineHeight: 22 },
  frogDesc: { fontSize: 13, lineHeight: 19, marginBottom: 14 },
  frogDescCompact: { fontSize: 12, lineHeight: 17, marginBottom: 2 },
  progressMeta: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  progressLabel: { fontSize: 10, fontWeight: '800' },
  progressTrack: { height: 6, borderRadius: 999, overflow: 'hidden' },
  progressFill: { height: '100%' },

  frogDoneCard: {
    borderRadius: 18,
    borderLeftWidth: 4,
    padding: 16,
  },
  frogDoneRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8, gap: 10 },
  frogDoneTitle: { fontSize: 17, fontWeight: '800', textDecorationLine: 'line-through', opacity: 0.45, flex: 1 },

  mainListViewTrack: {
    flexDirection: 'row',
    borderRadius: Radius.lg,
    padding: 4,
    gap: 4,
  },
  mainListViewBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.md,
    paddingVertical: 10,
    paddingHorizontal: 8,
  },
  mainListViewBtnText: {
    fontSize: 14,
    letterSpacing: 0.2,
  },
  segmentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(148,163,184,0.22)',
    marginBottom: 2,
  },
  segmentBtn: { paddingBottom: 8 },
  segmentText: {
    fontSize: 14,
    letterSpacing: 0.4,
    borderBottomWidth: 2,
    paddingBottom: 8,
  },

  matrixWrap: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.xl,
    overflow: 'hidden',
    flexDirection: 'row',
    flexWrap: 'wrap',
    ...Shadows.card,
  },
  quadrant: {
    width: '50%',
    minHeight: 220,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    gap: 10,
  },
  quadHead: { marginBottom: 2 },
  quadTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  quadTitle: { fontSize: 10, fontWeight: '900', letterSpacing: 1.2, textTransform: 'uppercase', flexShrink: 1 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  quadList: { maxHeight: 190 },
  quadEmpty: { fontSize: 12, fontWeight: '700', opacity: 0.7 },
  emptyWrap: {
    flex: 1,
    minHeight: 160,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 14,
    gap: 8,
  },
  emptyIcon: {
    width: 46,
    height: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: { fontSize: 12, fontWeight: '900', letterSpacing: 1.2, textTransform: 'uppercase', opacity: 0.9 },
  emptySubtitle: { fontSize: 11, fontWeight: '700', opacity: 0.7, textAlign: 'center', lineHeight: 16 },

  taskRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(148,163,184,0.18)',
  },
  taskDoneRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  taskBody: { flex: 1, gap: 4 },
  taskParentHint: { fontSize: 10, fontWeight: '700', opacity: 0.7, letterSpacing: 0.2 },
  taskText: { fontSize: 13, fontWeight: '600', lineHeight: 18 },
  deadlineRow: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
  },
  deadlineBadge: { alignSelf: 'flex-start', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  deadlineText: { fontSize: 10, fontWeight: '800' },
  overduePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    alignSelf: 'flex-start',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  overduePillText: { fontSize: 10, fontWeight: '800' },
  shelvedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    marginTop: 4,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  shelvedPillText: { fontSize: 10, fontWeight: '700' },
  shelvedStatusIcon: {
    alignSelf: 'flex-start',
    marginTop: 1,
    opacity: 0.72,
  },
  shelvedTodoBodyMuted: {
    opacity: 0.78,
  },
  shelvedActivateAside: {
    alignSelf: 'stretch',
    justifyContent: 'center',
    paddingLeft: Spacing.md,
    flexShrink: 0,
  },
  /** 主题色圆形激活钮，与快捷待办发送钮一致 */
  shelvedActivateBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  metaText: { fontSize: 12, fontWeight: '700' },
  metaHint: { fontSize: 10, fontWeight: '800' },

  pulseWrap: { width: 10, height: 10, alignItems: 'center', justifyContent: 'center' },
  pulseRing: { position: 'absolute', width: 10, height: 10, borderRadius: 999 },
  pulseCenter: { width: 7, height: 7, borderRadius: 999 },

  projectCard: {
    borderRadius: Radius.xl,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    ...Shadows.card,
  },
  /** 项目卡片列表：右侧留白，避免卡片与区块右缘贴齐 */
  projectList: {
    paddingRight: Spacing.xl,
  },
  /** 外边距放在 Swipeable 外，保证侧滑层高度与卡片本体一致 */
  projectSwipeWrap: { marginBottom: Spacing.lg },
  projectSwipeActions: {
    flexDirection: 'row',
    alignItems: 'stretch',
    marginLeft: -10,
  },
  projectSwipeArchive: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
    minWidth: 100,
    paddingHorizontal: 16,
    borderTopRightRadius: Radius.xl,
    borderBottomRightRadius: Radius.xl,
    gap: 8,
  },
  projectSwipeArchiveText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '800',
    flexShrink: 0,
  },
  projectSwipeDelete: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
    minWidth: 100,
    paddingHorizontal: 16,
    borderTopRightRadius: Radius.xl,
    borderBottomRightRadius: Radius.xl,
    gap: 8,
  },
  projectSwipeDeleteText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '800',
    flexShrink: 0,
  },
  /** 仅包住项目标题行，避免整块卡片拦截下方任务勾选 */
  projectHeadPressable: { alignSelf: 'stretch' },
  projectHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing['2xl'],
    paddingVertical: Spacing['2xl'],
  },
  projectIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  projectHeadLeft: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, flex: 1, paddingRight: 10 },
  projectHeadMainColumn: { flex: 1, minWidth: 0 },
  projectHeadRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  projectEditBtn: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  projectExpandBtn: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  projectQuickAddBtn: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  projectTitleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 2 },
  projectTitle: { fontSize: 16, fontWeight: '800' },
  projectTitleDone: {
    textDecorationLine: 'line-through',
    textDecorationStyle: 'solid',
  },
  projectTitleDoneAndroid: {
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  projectDoneBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
    flexShrink: 0,
    marginTop: 1,
  },
  projectDoneBadgeText: { fontSize: 10, fontWeight: '900', letterSpacing: 0.4 },
  projectSubRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  projectNoteRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  projectNoteIcon: { marginTop: 1 },
  projectNoteText: { flex: 1, fontSize: 12, fontWeight: '500', lineHeight: 18, fontStyle: 'italic' },
  projectLockHint: { fontSize: 11, fontWeight: '600', lineHeight: 16, marginTop: 4 },
  projectMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 },
  projectSub: { fontSize: 10, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase' },
  projectSubStrong: { fontSize: 10, fontWeight: '900', letterSpacing: 0.6 },
  projectFlag: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  projectFlagText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.3 },
  projectProgressRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8, marginBottom: 6 },
  projectProgressLabel: { fontSize: 10, fontWeight: '800' },
  projectProgressTrack: { height: 6, borderRadius: 999, overflow: 'hidden', alignSelf: 'stretch' },
  projectProgressFill: { height: '100%' },
  projectAiWrap: { marginTop: 8 },
  projectAiTriggerBtn: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  projectAiTriggerText: { fontSize: 12, fontWeight: '700' },
  projectAiPendingRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  projectAiPreview: { fontSize: 12, fontWeight: '600', lineHeight: 18 },
  projectAiTime: { fontSize: 10, fontWeight: '600', marginTop: 4 },
  projectAiRetriggerBtn: { marginTop: 6, alignSelf: 'flex-start' },
  projectAiRetriggerText: { fontSize: 11, fontWeight: '700' },
  projectAiModalKicker: { fontSize: 10, fontWeight: '800', letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 6 },
  projectAiModalBody: { fontSize: 14, fontWeight: '500', lineHeight: 22 },
  subHabitModalTitleRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 0, paddingRight: 8 },
  subHabitModalIcon: { fontSize: 28 },
  subHabitModalProgress: { fontSize: 12, fontWeight: '600', marginTop: 2 },
  subHabitModalList: { gap: 10, paddingBottom: 8 },
  subHabitModalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.md,
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  subHabitModalCheck: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  subHabitModalName: { flex: 1, fontSize: 15, fontWeight: '600', lineHeight: 20 },
  subHabitModalHint: { fontSize: 12, marginTop: 10, lineHeight: 17 },
  projectCount: { alignItems: 'flex-end' },
  projectCountMain: { fontSize: 12, fontWeight: '900' },
  projectCountSub: { fontSize: 10, fontWeight: '700' },

  projectTaskBody: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.lg,
    gap: 6,
  },
  projectTaskRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, minHeight: 24 },
  projectTaskRowFlat: { gap: 6 },
  taskChildMark: { width: 20, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  projectTaskParentTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 7,
    paddingVertical: 2,
    flexShrink: 0,
  },
  projectTaskParentTagText: { fontSize: 10, fontWeight: '800' },
  projectTaskTextChild: { fontSize: 12 },
  projectTaskCollapsedHint: { fontSize: 11, fontWeight: '600', marginTop: 4 },
  taskExpandBtn: {
    width: 22,
    height: 22,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -3,
  },
  taskExpandBtnPlaceholder: { width: 22, height: 22, marginTop: -3 },
  treeColumns: { flexDirection: 'row', alignSelf: 'stretch' },
  treeColumn: { alignSelf: 'stretch', position: 'relative' },
  treeLine: {
    position: 'absolute',
    left: 9,
    top: -14,
    bottom: -14,
    width: 1,
    backgroundColor: 'rgba(203,213,225,0.9)',
  },
  statusCircle: {
    width: 18,
    height: 18,
    borderRadius: 999,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  taskTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  projectTaskTitleMain: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 6 },
  projectTaskTitleTags: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 0 },
  taskTitleDoneMain: { color: '#6b7280', textDecorationLine: 'line-through' },
  taskDoneTag: { color: '#6b7280', fontSize: 12, fontWeight: '700' },
  projectTaskMain: { flex: 1, gap: 4, paddingTop: 1 },
  projectTaskText: { flex: 1, fontSize: 13, fontWeight: '600' },
  projectTaskTextDone: { textDecorationLine: 'line-through' },
  projectTaskMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap', paddingRight: 10 },
  projectTaskHabitBindEmoji: { fontSize: 13, lineHeight: 16 },
  projectTaskHabitBindPillText: { fontSize: 10, fontWeight: '700' },
  projectTaskMetaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  projectTaskMetaText: { fontSize: 10, fontWeight: '700' },
  projectTaskProgressRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6, marginBottom: 4 },
  projectTaskProgressLabel: { fontSize: 10, fontWeight: '800' },
  projectTaskProgressTrack: { height: 5, borderRadius: 999, overflow: 'hidden' },
  projectTaskProgressFill: { height: '100%' },
  projectTaskNoteRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginTop: 4,
    paddingTop: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  projectTaskNoteIcon: { marginTop: 1 },
  projectTaskNoteText: { flex: 1, fontSize: 12, fontWeight: '500', lineHeight: 18, fontStyle: 'italic' },
  projectTaskAcceptanceText: { flex: 1, fontSize: 12, fontWeight: '600', lineHeight: 18 },
  projectTaskEmpty: { fontSize: 12, fontWeight: '700' },
  projectTaskEllipsis: { marginTop: 2, fontSize: 11, fontWeight: '700' },
  projectTaskEllipsisInline: { marginTop: 2, fontSize: 11, fontWeight: '700' },
  projectBody: { borderTopWidth: 1, paddingHorizontal: 16, paddingVertical: 10, gap: 6 },
  subtaskRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  subtaskLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1, paddingRight: 8 },
  subtaskText: { fontSize: 13, fontWeight: '600' },
  subtaskStatus: { fontSize: 10, fontWeight: '800' },
  nested: { marginLeft: 12, paddingLeft: 12, borderLeftWidth: 1, gap: 4 },

  flatRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderTopWidth: 0 },
  flatLeft: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, flex: 1, paddingRight: 10 },
  priorityBadge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 },
  priorityText: { fontSize: 10, fontWeight: '900' },

  modalRoot: { flex: 1 },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  modalCenter: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: Spacing['5xl'],
  },
  modalCard: {
    borderRadius: Radius.sheet,
    padding: Spacing['3xl'],
    borderWidth: StyleSheet.hairlineWidth,
  },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14, gap: 12 },
  modalTitleWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 16, flex: 1 },
  modalTitle: { fontSize: 16, fontWeight: '800' },
  modalSubtitle: { fontSize: 11, fontWeight: '700', marginTop: 2 },
  modalActions: { gap: 10 },
  actionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 10,
  },
  actionIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  actionText: { flex: 1, fontSize: 14, fontWeight: '700' },

  editorCard: {
    borderRadius: Radius.sheet,
    padding: Spacing['3xl'],
    borderWidth: StyleSheet.hairlineWidth,
    gap: Spacing.xl,
  },
  editorTitle: { ...Typography.h3 },
  editorHint: { ...Typography.caption },
  editorInputWrap: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Platform.OS === 'android' ? Spacing.xs : Spacing.lg,
  },
  editorInput: {
    width: '100%',
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 22,
    paddingVertical: Platform.OS === 'android' ? 12 : 8,
    minHeight: 44,
  },
  editorActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
  editorGhostBtn: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12 },
  editorGhostText: { fontSize: 14, fontWeight: '700' },
  editorPrimaryBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12 },
  editorPrimaryText: { fontSize: 14, fontWeight: '800', color: '#fff' },

  habitHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  habitSection: { gap: 10 },
  habitSectionToggle: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  habitSectionToggleText: { fontSize: 13, fontWeight: '800' },
  habitItemsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: HABIT_GRID_GAP },
  habitItem: {
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 10,
  },
  habitIconPressable: { alignItems: 'center' },
  habitNamePressable: { alignItems: 'center', alignSelf: 'stretch', paddingHorizontal: 2 },
  habitIconWrap: {
    position: 'relative',
    width: 76,
    height: 76,
    alignItems: 'center',
    justifyContent: 'center',
  },
  habitKindBadge: {
    position: 'absolute',
    left: -2,
    top: -2,
    zIndex: 3,
    minWidth: 20,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ea580c',
    borderWidth: 2,
  },
  habitKindBadgeTask: {
    backgroundColor: '#3b82f6',
  },
  habitKindBadgeText: { color: '#fff', fontSize: 10, fontWeight: '900' },
  habitIconCircle: {
    position: 'relative',
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 2,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  habitIconText: { fontSize: 34 },
  habitIconTextDone: { opacity: 0.35 },
  habitIconDoneOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  habitIconFailMark: { fontSize: 28, lineHeight: 32 },
  habitIconLockOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 38,
    backgroundColor: 'rgba(15, 23, 42, 0.22)',
  },
  habitTodayBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    zIndex: 4,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },
  habitTodayBadgeCount: { color: '#fff', fontSize: 10, fontWeight: '800' },
  habitTodayBadgeFail: { fontSize: 9, lineHeight: 11 },
  habitItemText: { fontSize: 13, fontWeight: '800', textAlign: 'center', lineHeight: 19 },
  habitAddCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  habitAddText: { fontSize: 13, fontWeight: '600', textAlign: 'center' },

  standaloneTodoSubtitle: { fontSize: 12, fontWeight: '600' },
  standaloneTodoNote: { fontSize: 12, fontWeight: '500', lineHeight: 16 },
  standaloneTodoAcceptanceRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 4 },
  standaloneTodoAcceptance: { flex: 1, fontSize: 12, fontWeight: '600', lineHeight: 16 },
  quickTodoShell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    borderRadius: Radius.composer,
    borderWidth: StyleSheet.hairlineWidth,
    paddingLeft: Spacing.xs,
    paddingRight: Spacing.xs,
    paddingVertical: 3,
    minHeight: 40,
    maxHeight: 40,
  },
  quickTodoIconBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickTodoInput: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    paddingVertical: 0,
    paddingHorizontal: 6,
    margin: 0,
    height: 40,
    lineHeight: Platform.OS === 'ios' ? 20 : undefined,
  },
  quickTodoSendBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickTodoSendBtnDots: { color: '#fff', fontSize: 16, fontWeight: '900' },
  quickTodoHint: { fontSize: 11, fontWeight: '600', marginTop: 6, marginLeft: 8 },
  standaloneTodoList: { maxHeight: 280 },
  standaloneTodoListContent: { paddingTop: 2, paddingBottom: 6, gap: 0 },
  /** 外边距放在 Swipeable 外，保证侧滑层高度与卡片本体一致 */
  standaloneTodoSwipeWrap: { marginBottom: 10 },
  /** 待办卡片：圆角 + 描边，与四象限内扁平列表区分 */
  standaloneTodoCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.lg,
    borderRadius: Radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing['2xl'],
    paddingVertical: Spacing.xl,
    overflow: 'hidden',
    ...Shadows.card,
  },
  /**
   * 与卡片等高；负 margin 让操作条向左压住卡片右缘；内层 overflow 裁切，两钮无缝拼接。
   */
  standaloneSwipeActions: {
    flexDirection: 'row',
    alignItems: 'stretch',
    marginLeft: -10,
    borderRadius: Radius.xl,
    overflow: 'hidden',
  },
  standaloneSwipeUpgrade: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
    minWidth: 96,
    paddingHorizontal: Spacing['2xl'],
    borderRadius: 0,
    gap: Spacing.md,
  },
  standaloneSwipeUpgradeText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '800',
    flexShrink: 0,
  },
  /**
   * 删除条与卡片同高；横向「图标 + 删除」；
   * 左侧略叠在卡片下（配合 actions 的 marginLeft），右侧圆角与卡片一致。
   */
  standaloneSwipeDelete: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
    minWidth: 96,
    paddingHorizontal: Spacing['2xl'],
    borderRadius: 0,
    gap: Spacing.md,
  },
  standaloneSwipeDeleteText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '800',
    flexShrink: 0,
  },

});
