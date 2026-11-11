import { FOLD_MOTION_EASE } from '@/components/review/fold-motion';
import { Layout, Radius, Spacing } from '@/constants/design-tokens';
import {
  TaskFoldMotion,
  useTaskFoldTheme,
} from '@/constants/task-fold-theme';
import { useAppTheme } from '@/hooks/use-app-theme';
import { useReducedMotionState } from '@/hooks/use-reduced-motion';
import { toast, toUserMessage, Alert } from '@/lib/app-feedback';
import { isFrogAssignedOn } from '@/lib/frog-assignment';
import { isFrogDoneForToday } from '@/lib/long-term-task';
import { isFrogSubjectDeleted } from '@/lib/repositories/tasks/frog-completion-events';
import type { ProjectRow } from '@/lib/repositories/projects/project.types';
import type { TaskRow } from '@/lib/repositories/tasks/task.types';
import {
  buildScheduleTimeline,
  formatMinutesAsHm,
  getSlotCount,
  listWorkSlots,
  maxSpanFromSlot,
  placementEndMinutes,
  slotEndMinutes,
  slotStartMinutes,
  wallClockToAxisMinutes,
} from '@/lib/schedule/axis';
import {
  buildVirtualHabitPlacementsForDays,
  type VirtualHabitPlacement,
} from '@/lib/schedule/habit-virtual-placement';
import {
  buildOverdueFrogCarryPlacementsForToday,
  buildVirtualTaskPlacementsForDays,
  type VirtualTaskPlacement,
} from '@/lib/schedule/task-virtual-placement';
import { getHabits } from '@/lib/repositories/habits/habit';
import { getAllHabitCheckInsMaps } from '@/lib/repositories/habits/habit-check-in';
import { hasActiveSubHabits } from '@/lib/repositories/habits/habit-sub';
import { isStandaloneTodoTask } from '@/lib/standalone-todo-task';
import { isTaskOverdueForList } from '@/lib/standalone-todo-visibility';
import {
  centerYmdForPeriod,
  dayOffsetFromToday,
  formatDayScheduleLabel,
  getWeekStartMondayYmd,
  isEditableScheduleDay,
  WEEKDAY_SHORT_LABELS,
  weekdayFromYmd,
  ymdForWeekday,
} from '@/lib/schedule/week';
import {
  formatLocalYmdFromDate,
  getLogicalLocalYmd,
  loadTasksDayBoundary,
  type TasksDayBoundary,
} from '@/lib/tasks-logical-day';
import type { SchedulePlacementRow } from '@/lib/schedule/types';
import {
  cancelAssignForPlacementDay,
  loadScheduleForDayWindow,
  placeFrogOnSchedule,
  placeFrogOnScheduleAt,
  rematerializeOrphanedPlacement,
  rematerializeOrphanedPlacementAtMinutes,
  removePlacementSegment,
  type WeekScheduleView,
} from '@/lib/schedule-service';
import { subscribeFrogScheduleChanged } from '@/lib/schedule-events';
import { subscribeSyncDirty } from '@/lib/sync-pull';
import { buildTimelineEventsForDay, type PlacementDisplayResolver } from '@/lib/schedule/timeline/events';
import type { TimelineEvent } from '@/lib/schedule/timeline/types';
import { DayTimelineSchedule } from '@/components/tasks/timeline/DayTimelineSchedule';
import { resolveProjectDisplayIcon, resolveTaskDisplayIcon } from '@/lib/constants/entity-icon-choices';
import { MaterialIcons } from '@expo/vector-icons';
import React from 'react';
import {
  ActivityIndicator,
  Animated,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import {
  SchedulePlaceFrogSheet,
  type SchedulePlacePreselected,
  type SchedulePlaceResult,
} from '@/components/tasks/SchedulePlaceFrogSheet';
import { FrogScheduleSettingsSheet } from '@/components/tasks/FrogScheduleSettingsSheet';
import {
  SchedulePlacementDetailSheet,
  type ScheduleDetailSurface,
  type ScheduleSubjectInfo,
  type ScheduleVirtualSlot,
  buildAcceptance,
} from '@/components/tasks/SchedulePlacementDetailSheet';
import { loadScheduleTimelineWriteEnabled } from '@/lib/schedule/timeline-flags';
import {
  listAssignedSubjectsForBucket,
  summarizeDailyAssignQuota,
  type DailyAssignBucket,
  type DailyAssignedSubject,
  type DailyAssignQuotaBucketStat,
} from '@/lib/schedule/daily-assign-quota';

/** 日程表缩放：最简（当前时段）↔ 时间线日视图 */
export type ScheduleZoomMode = 'minimal' | 'day';

type TodayCompactItem = {
  /** 青蛙占用；习惯/虚拟待办块时为空 */
  placement: SchedulePlacementRow | null;
  habit: VirtualHabitPlacement | null;
  virtualTask: VirtualTaskPlacement | null;
  title: string;
  done: boolean;
  /** 截止/日程窗/漏做已过且未完成 → 置顶 */
  overdue: boolean;
  timeLabel: string;
  endLabel: string;
  startMins: number;
  endMins: number;
  /** 标签最大权重（与待办/项目树一致） */
  tagWeight: number;
  /** 四象限 priority，同权重次级键；习惯无此字段时为 0 */
  priority: number;
};

/** 最简态焦点：未完成优先 → 过期置顶 → 标签权重↓ → priority↓ → 标题 → 时刻 */
function compareTodayCompactByWeight(a: TodayCompactItem, b: TodayCompactItem): number {
  if (a.done !== b.done) return a.done ? 1 : -1;
  if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
  if (a.tagWeight !== b.tagWeight) return b.tagWeight - a.tagWeight;
  if (a.priority !== b.priority) return b.priority - a.priority;
  const byTitle = a.title.localeCompare(b.title, 'zh');
  if (byTitle !== 0) return byTitle;
  if (a.startMins !== b.startMins) return a.startMins - b.startMins;
  return 0;
}

function formatRemainLabel(remainSec: number, opts?: { untilStart?: boolean }): string {
  const sec = Math.max(0, Math.floor(remainSec));
  const prefix = opts?.untilStart ? '距开始' : '剩余';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${prefix} ${h} 时 ${m} 分 ${s} 秒`;
  if (m > 0) return `${prefix} ${m} 分 ${s} 秒`;
  return `${prefix} ${s} 秒`;
}

function remainSecondsUntil(
  targetMinutes: number,
  axisNowMins: number | null,
): number {
  if (axisNowMins == null) return 0;
  return Math.round((targetMinutes - axisNowMins) * 60);
}

/** 对齐设计稿 `.tt`：窄时间轴 + 矮日头 */
const TIME_GUTTER = 28;
const DAY_HEADER_H = 22;

type SubjectLookup = {
  tasks: TaskRow[];
  projects: ProjectRow[];
  projectFrogIds?: Set<string>;
};

export type SchedulePendingPlace = SchedulePlacePreselected;

/** 日程入格/取消指派后，供列表立刻刷新「已指派」标识 */
export type ScheduleChangedDetail = {
  kind: 'task' | 'project';
  id: string;
  assignYmd: string;
  action: 'assign' | 'unassign';
};

type Props = {
  logicalTodayYmd: string;
  /** 当前墙钟时刻（用于「现在」线） */
  now?: Date;
  sectionCardStyle: object | object[];
  lockedProjectIds?: Set<string>;
  subjects: SubjectLookup;
  /**
   * 最简态焦点混排用：习惯/任务/项目 id → 标签最大权重
   * （与待办栏、项目树同一套语义）
   */
  tagWeightBySubjectId?: Map<string, number>;
  /** 从项目列表长按预选：展开课表并点空格入格 */
  pendingPlace?: SchedulePendingPlace | null;
  onClearPendingPlace?: () => void;
  /** 入格/取消后回调；批量指派时可传多条，父级应一次静默同步 */
  onChanged?: (detail?: ScheduleChangedDetail | ScheduleChangedDetail[]) => void;
  onOpenSubject?: (kind: 'task' | 'project', id: string) => void;
  onToggleDone?: (info: {
    kind: 'task' | 'project';
    id: string;
    assignYmd: string;
  }) => void;
  /** 点日程表习惯块：等同小习惯打卡（仅今日） */
  onHabitCheckIn?: (habitId: string) => void;
  /** 点已达标的日程习惯块：撤销当日打卡（仅今日） */
  onHabitUndo?: (habitId: string) => void;
  /**
   * 任务页小习惯「今日完成」态（habitId → done）。
   * 今日虚拟习惯 / 时间线全天以此覆盖本地重建结果，避免打卡后日程仍显示待打卡。
   */
  habitDoneTodayById?: ReadonlyMap<string, boolean>;
  /** 顶部日历点选：跳到该日课表 */
  jumpToYmd?: string | null;
  onJumpToYmdConsumed?: () => void;
  /** 课表当前查看日变化（滑动 / 跳转），供顶部周条高亮同步 */
  onViewYmdChange?: (ymd: string) => void;
};

function resolveSubject(
  kind: 'task' | 'project',
  id: string,
  lookup: SubjectLookup,
  assignYmd: string,
): ScheduleSubjectInfo | null {
  if (kind === 'project') {
    const fromFrogRow = lookup.tasks.find((x) => x.id === id);
    const p = lookup.projects.find((x) => x.id === id);
    if (!p && !fromFrogRow) {
      return {
        kind: 'project',
        id,
        title: '（已删除项目）',
        priority: 0,
        dueDate: null,
        acceptanceCriteria: '',
        projectName: null,
        extraData: JSON.stringify({ frogSubjectDeleted: true }),
        status: 'done',
        done: true,
        deletedSnapshot: true,
      };
    }
    const extraData = fromFrogRow?.extra_data ?? p?.extra_data ?? null;
    const statusRaw = p?.status;
    const statusForDone =
      fromFrogRow?.status ??
      (statusRaw === 'completed' || statusRaw === 'archived' ? 'done' : 'todo');
    return {
      kind: 'project',
      id,
      title: p?.name ?? fromFrogRow?.title ?? '项目',
      priority: p?.priority ?? fromFrogRow?.priority ?? 0,
      dueDate: (p?.due_date ?? fromFrogRow?.due_date)?.slice(0, 10) ?? null,
      acceptanceCriteria: buildAcceptance(null, p?.note ?? fromFrogRow?.note ?? null),
      projectName: p?.name ?? fromFrogRow?.title ?? null,
      extraData,
      status: statusForDone,
      done: isFrogDoneForToday(extraData, statusForDone, assignYmd),
      deletedSnapshot: isFrogSubjectDeleted(extraData),
    };
  }
  const t = lookup.tasks.find((x) => x.id === id);
  if (!t) {
    return {
      kind: 'task',
      id,
      title: '（已删除任务）',
      priority: 0,
      dueDate: null,
      acceptanceCriteria: '',
      projectName: null,
      extraData: JSON.stringify({ frogSubjectDeleted: true }),
      status: 'done',
      done: true,
      deletedSnapshot: true,
    };
  }
  const projectName =
    t.project_id != null
      ? lookup.projects.find((p) => p.id === t.project_id)?.name ?? null
      : null;
  return {
    kind: 'task',
    id: t.id,
    title: t.title,
    priority: t.priority ?? 0,
    dueDate: t.due_date?.slice(0, 10) ?? null,
    acceptanceCriteria: buildAcceptance(t.description, t.note),
    projectName,
    extraData: t.extra_data,
    status: t.status,
    done: isFrogDoneForToday(t.extra_data, t.status, assignYmd),
    deletedSnapshot: isFrogSubjectDeleted(t.extra_data),
  };
}

/**
 * 对齐设计稿 `.blk`：
 * habit 浅绿虚线 · todo 琥珀黄 · proj 浅灰绿 · frog 深绿
 */
type ScheduleBlockKind = 'frog' | 'habit' | 'todo' | 'proj';

/** Alert / 轻量写库：短延后即可 */
const UI_SETTLE_MS = 48;
/** 关一个 RN Modal 再开另一个：原生卸层需要空窗，过短会触摸卡死（与菜谱 AI 入口同口径） */
const MODAL_HANDOFF_MS = 320;

/** Alert / Modal 关闭后再改状态，避免 Android 触摸层与 LayoutAnimation 抢焦点卡死 */
function runAfterUiSettles(action: () => void, delayMs = UI_SETTLE_MS) {
  const run = () => {
    requestAnimationFrame(() => {
      action();
    });
  };
  if (delayMs > UI_SETTLE_MS) {
    setTimeout(run, delayMs);
    return;
  }
  // RN 个别环境无 requestIdleCallback；有则加 timeout，避免闲时回调迟迟不来像「点了没反应」
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(run, { timeout: 400 });
    return;
  }
  setTimeout(run, delayMs);
}

function dayEditable(ymd: string, logicalTodayYmd: string): boolean {
  return isEditableScheduleDay(ymd, logicalTodayYmd);
}

  /** 占用 → 色种类：独立待办走 todo，项目本体走 proj，项目任务走 frog */
  function blockKindForPlacement(
    placement: SchedulePlacementRow,
    lookup: SubjectLookup,
  ): ScheduleBlockKind {
    if (placement.subjectKind === 'project') return 'proj';
    const task = lookup.tasks.find((t) => t.id === placement.subjectId);
    if (task && isStandaloneTodoTask(task)) return 'todo';
    return 'frog';
  }

  function scheduleBlockStyle(
    kind: ScheduleBlockKind,
    opts: { isPast: boolean; allDone: boolean; isDark: boolean },
  ): {
    backgroundColor: string;
    borderColor: string;
    borderStyle: 'solid' | 'dashed';
    titleColor: string;
    metaColor: string;
    /** 完成块用浅底，勾选图标用深色 */
    doneOnLight: boolean;
  } {
    // 已完成：整体退饱和 / 浅底，和未完成的实色块一眼可分（不止删除线）
    if (opts.allDone) {
      if (kind === 'habit') {
        return {
          backgroundColor: opts.isDark ? 'rgba(180,190,170,0.16)' : 'rgba(218,224,212,0.78)',
          borderColor: opts.isDark ? 'rgba(150,160,140,0.4)' : '#C2C9BB',
          borderStyle: 'dashed',
          titleColor: opts.isDark ? 'rgba(168,175,166,0.92)' : '#8A9388',
          metaColor: opts.isDark ? 'rgba(168,175,166,0.55)' : 'rgba(138,147,136,0.72)',
          doneOnLight: true,
        };
      }
      if (kind === 'todo') {
        return {
          backgroundColor: opts.isDark ? 'rgba(200,190,170,0.16)' : 'rgba(232,226,214,0.82)',
          borderColor: opts.isDark ? 'rgba(180,170,150,0.4)' : '#D0C8B6',
          borderStyle: 'solid',
          titleColor: opts.isDark ? 'rgba(180,170,150,0.9)' : '#9A9080',
          metaColor: opts.isDark ? 'rgba(180,170,150,0.55)' : 'rgba(154,144,128,0.72)',
          doneOnLight: true,
        };
      }
      if (kind === 'proj') {
        return {
          backgroundColor: opts.isDark ? 'rgba(180,188,176,0.16)' : 'rgba(220,224,216,0.82)',
          borderColor: opts.isDark ? 'rgba(160,168,155,0.4)' : '#C5CBBE',
          borderStyle: 'solid',
          titleColor: opts.isDark ? 'rgba(168,175,166,0.9)' : '#8A9388',
          metaColor: opts.isDark ? 'rgba(168,175,166,0.55)' : 'rgba(138,147,136,0.72)',
          doneOnLight: true,
        };
      }
      // frog 完成：浅百合绿底，对比未完成的深绿实色块
      return {
        backgroundColor: opts.isDark ? 'rgba(201,217,163,0.22)' : 'rgba(201,217,163,0.78)',
        borderColor: opts.isDark ? 'rgba(127,160,111,0.4)' : '#A8C08E',
        borderStyle: 'solid',
        titleColor: opts.isDark ? 'rgba(197,211,188,0.88)' : '#4B6048',
        metaColor: opts.isDark ? 'rgba(197,211,188,0.55)' : 'rgba(75,96,72,0.68)',
        doneOnLight: true,
      };
    }
    if (kind === 'habit') {
      // `.blk.habit`
      return {
        backgroundColor: opts.isDark ? 'rgba(226,236,211,0.28)' : 'rgba(226,236,211,0.8)',
        borderColor: opts.isDark ? 'rgba(175,195,142,0.55)' : '#AFC38E',
        borderStyle: 'dashed',
        titleColor: opts.isDark ? '#C5D6B4' : '#4C653F',
        metaColor: opts.isDark ? 'rgba(197,214,180,0.7)' : 'rgba(76,101,63,0.72)',
        doneOnLight: false,
      };
    }
    if (kind === 'todo') {
      // `.blk.todo`
      return {
        backgroundColor: opts.isDark ? 'rgba(246,232,204,0.28)' : 'rgba(246,232,204,0.88)',
        borderColor: opts.isDark ? 'rgba(230,204,162,0.55)' : '#E6CCA2',
        borderStyle: 'solid',
        titleColor: opts.isDark ? '#E2C896' : '#7A5B2D',
        metaColor: opts.isDark ? 'rgba(226,200,150,0.7)' : 'rgba(122,91,45,0.72)',
        doneOnLight: false,
      };
    }
    if (kind === 'proj') {
      // `.blk.proj`
      return {
        backgroundColor: opts.isDark ? 'rgba(230,236,224,0.22)' : 'rgba(230,236,224,0.9)',
        borderColor: opts.isDark ? 'rgba(200,211,190,0.5)' : '#C8D3BE',
        borderStyle: 'solid',
        titleColor: opts.isDark ? '#C5D3BC' : '#4B6048',
        metaColor: opts.isDark ? 'rgba(197,211,188,0.7)' : 'rgba(75,96,72,0.72)',
        doneOnLight: false,
      };
    }
    // `.blk.frog`：过去未完成略降饱和，仍保持深绿实色（与「已完成浅底」区分）
    if (opts.isPast) {
      return {
        backgroundColor: opts.isDark ? 'rgba(75,106,81,0.55)' : '#4B6A51',
        borderColor: opts.isDark ? 'rgba(127,160,111,0.28)' : 'rgba(55,82,61,0.35)',
        borderStyle: 'solid',
        titleColor: opts.isDark ? 'rgba(244,242,227,0.85)' : '#F4F2E3',
        metaColor: opts.isDark ? 'rgba(244,242,227,0.55)' : 'rgba(244,242,227,0.72)',
        doneOnLight: false,
      };
    }
    return {
      backgroundColor: opts.isDark ? 'rgba(53,96,74,0.88)' : '#35604A',
      borderColor: opts.isDark ? 'rgba(169,199,185,0.2)' : 'rgba(36,68,55,0.22)',
      borderStyle: 'solid',
      titleColor: '#F5F3E7',
      metaColor: 'rgba(245,243,231,0.72)',
      doneOnLight: false,
    };
  }

export function WeeklyFrogSchedule({
  logicalTodayYmd,
  now,
  sectionCardStyle,
  lockedProjectIds,
  subjects,
  tagWeightBySubjectId,
  pendingPlace = null,
  onClearPendingPlace,
  onChanged,
  onOpenSubject,
  onToggleDone,
  onHabitCheckIn,
  onHabitUndo,
  habitDoneTodayById,
  jumpToYmd = null,
  onJumpToYmdConsumed,
  onViewYmdChange,
}: Props) {
  const { colors: theme, isDark, shadows } = useAppTheme();
  const { tf, fonts: foldFonts } = useTaskFoldTheme();
  const primary = tf.pond;
  const outline = tf.muted;
  const surfaceLow = isDark ? tf.paper2 : tf.paper3;
  const gridLineSoft = tf.line;
  const todayWash = isDark ? tf.lily2 : 'rgba(232,239,217,0.55)';

  /** 阶段 G：是否按分钟写入。缺省关（旧选格；J 完成前保持）。 */
  const [timelineWrite, setTimelineWrite] = React.useState(true);
  React.useEffect(() => {
    let cancelled = false;
    void loadScheduleTimelineWriteEnabled().then((on) => {
      if (!cancelled) setTimelineWrite(on);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /** 时间线事件展示解析：复用课表 resolveSubject + 实体自带图标 */
  const resolveTimelineDisplay = React.useCallback<PlacementDisplayResolver>(
    ({ kind, id, assignYmd }) => {
      const info = resolveSubject(kind, id, subjects, assignYmd);
      if (!info) return null;
      /**
       * 未入格（该日无青蛙指派）不进入时间线：
       * 兼容历史「取消指派只清 frog 字段、占用行残留」的数据，
       * 与列表「已入格 / 未入格」徽章口径一致。
       */
      if (!info.deletedSnapshot && !isFrogAssignedOn(info.extraData, assignYmd)) {
        return null;
      }
      if (kind === 'project') {
        const due = info.dueDate?.slice(0, 10) ?? '';
        const overdue =
          !info.done && /^\d{4}-\d{2}-\d{2}$/.test(due) && due < logicalTodayYmd;
        return {
          title: info.title,
          done: info.done,
          priority: info.priority,
          blockKind: 'proj',
          icon: resolveProjectDisplayIcon(info.title, info.extraData),
          overdue,
        };
      }
      const task = subjects.tasks.find((t) => t.id === id);
      const blockKind = task && isStandaloneTodoTask(task) ? 'todo' : 'frog';
      const overdue =
        !info.done && task ? isTaskOverdueForList(task, logicalTodayYmd) : false;
      return {
        title: info.title,
        done: info.done,
        priority: info.priority,
        blockKind,
        icon: resolveTaskDisplayIcon(info.extraData),
        overdue,
      };
    },
    [subjects, logicalTodayYmd],
  );

  /** 0 = 今天；±1 翻一天 */
  const [periodIndex, setPeriodIndex] = React.useState(0);
  const wasDayRef = React.useRef(false);
  const centerYmd = React.useMemo(
    () => centerYmdForPeriod(logicalTodayYmd, periodIndex),
    [logicalTodayYmd, periodIndex],
  );
  const dayYmds = React.useMemo(() => [centerYmd], [centerYmd]);
  /** 切日仅走上方周条/日历；日程内横滑留给同刻多栏，不再预取邻日分页 */
  const loadDayYmds = dayYmds;
  const [view, setView] = React.useState<WeekScheduleView | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [virtualHabits, setVirtualHabits] = React.useState<VirtualHabitPlacement[]>([]);
  const [virtualTasks, setVirtualTasks] = React.useState<VirtualTaskPlacement[]>([]);
  const [dayBoundary, setDayBoundary] = React.useState<TasksDayBoundary>({ hour: 0, minute: 0 });
  /** 防止指派连发 notify 时旧 reload 用空打卡 Map 覆盖已完成习惯 */
  const reloadGenerationRef = React.useRef(0);
  const checkInsMapsRef = React.useRef<Map<string, Record<string, number>>>(new Map());
  const subjectsRef = React.useRef(subjects);
  subjectsRef.current = subjects;

  /**
   * 今日习惯完成态与任务页小习惯列表强绑定：
   * reload 尚未读到打卡表 / 口径偏差时，仍跟 habitDoneTodayById 对齐。
   */
  const virtualHabitsResolved = React.useMemo(() => {
    if (!habitDoneTodayById || habitDoneTodayById.size === 0) return virtualHabits;
    let changed = false;
    const next = virtualHabits.map((h) => {
      if (h.assignYmd !== logicalTodayYmd) return h;
      if (!habitDoneTodayById.has(h.habitId)) return h;
      const done = habitDoneTodayById.get(h.habitId) === true;
      if (done === h.done) return h;
      changed = true;
      return { ...h, done };
    });
    return changed ? next : virtualHabits;
  }, [virtualHabits, habitDoneTodayById, logicalTodayYmd]);
  const [gridWidth, setGridWidth] = React.useState(0);
  /** 时间线视口：默认半高，点按展开完整高度 */
  const [timelineHeightExpanded, setTimelineHeightExpanded] = React.useState(false);

  const [placeTarget, setPlaceTarget] = React.useState<{
    weekStartYmd: string;
    weekday: number;
    startSlotIndex: number;
    assignYmd: string;
    maxSpan: number;
    /** 从顶部全天格打开时，入格弹窗默认勾选全天 */
    preferAllDay?: boolean;
    /** 未入格重新落入 */
    rematerializePlacementId?: string;
    rematerializePreselected?: SchedulePlacePreselected;
  } | null>(null);

  const [orphanListOpen, setOrphanListOpen] = React.useState(false);
  /** 点配额条：查看该优先级当日已指派列表 */
  const [quotaDetailBucket, setQuotaDetailBucket] = React.useState<DailyAssignBucket | null>(null);

  /** 点选格子为未入格项重新指派时间 */
  const [reassignPending, setReassignPending] = React.useState<{
    placement: SchedulePlacementRow;
    subject: ScheduleSubjectInfo;
  } | null>(null);

  const [detail, setDetail] = React.useState<{
    surface: ScheduleDetailSurface;
    placement: SchedulePlacementRow | null;
    subject: ScheduleSubjectInfo;
    virtualSlot?: ScheduleVirtualSlot | null;
    /** 习惯虚拟块：完成走打卡 / 撤销 */
    habitId?: string;
  } | null>(null);
  /** 首页默认最简：当前时段 + 倒计时；可展开时间线日视图 */
  const [zoomMode, setZoomMode] = React.useState<ScheduleZoomMode>('minimal');
  const zoomModeRef = React.useRef(zoomMode);
  zoomModeRef.current = zoomMode;
  const isDay = zoomMode === 'day';
  const isMinimal = zoomMode === 'minimal';
  const zoomBusyRef = React.useRef(false);
  const bodyOpacity = React.useRef(new Animated.Value(1)).current;
  const bodyScale = React.useRef(new Animated.Value(1)).current;
  const bodyTranslateY = React.useRef(new Animated.Value(0)).current;
  /** 日历切日横向滑入（替代原三日分页手势动画） */
  const bodyTranslateX = React.useRef(new Animated.Value(0)).current;
  const prevCenterYmdRef = React.useRef(centerYmd);
  const { enabled: reduceMotion, ready: motionReady } = useReducedMotionState();

  /** 墙钟：最简态每秒刷新倒计时；课表「现在」线每 30s（勿用默认 now=new Date()，否则每渲染新引用会炸更新环） */
  const nowTs = now?.getTime();
  const [wallNow, setWallNow] = React.useState(() => (nowTs != null ? new Date(nowTs) : new Date()));
  React.useEffect(() => {
    if (nowTs == null) return;
    setWallNow(new Date(nowTs));
  }, [nowTs]);
  React.useEffect(() => {
    const ms = zoomMode === 'minimal' ? 1000 : 30_000;
    const id = setInterval(() => setWallNow(new Date()), ms);
    return () => clearInterval(id);
  }, [zoomMode]);
  const axisNowMins = React.useMemo(
    () =>
      wallClockToAxisMinutes(
        wallNow,
        logicalTodayYmd,
        dayBoundary,
        getLogicalLocalYmd,
        formatLocalYmdFromDate,
      ),
    [wallNow, logicalTodayYmd, dayBoundary],
  );
  const [settingsOpen, setSettingsOpen] = React.useState(false);

  const goZoom = React.useCallback(
    (next: ScheduleZoomMode) => {
      const prev = zoomModeRef.current;
      if (prev === next || zoomBusyRef.current) return;
      zoomBusyRef.current = true;

      const snapZoom = () => {
        bodyOpacity.stopAnimation();
        bodyScale.stopAnimation();
        bodyTranslateY.stopAnimation();
        bodyTranslateX.stopAnimation();
        bodyOpacity.setValue(1);
        bodyScale.setValue(1);
        bodyTranslateY.setValue(0);
        bodyTranslateX.setValue(0);
        setZoomMode(next);
        zoomBusyRef.current = false;
      };

      if (!motionReady || reduceMotion) {
        snapZoom();
        return;
      }

      const enteringDay = next === 'day';
      const leavingDay = prev === 'day';

      // 退场：淡出 + 按方向位移/缩放
      const exitScale = enteringDay ? 0.94 : leavingDay ? 1.06 : 1;
      const exitTY = leavingDay ? 10 : 0;

      Animated.parallel([
        Animated.timing(bodyOpacity, {
          toValue: 0,
          duration: 150,
          useNativeDriver: true,
        }),
        Animated.timing(bodyScale, {
          toValue: exitScale,
          duration: 150,
          useNativeDriver: true,
        }),
        Animated.timing(bodyTranslateY, {
          toValue: exitTY,
          duration: 150,
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        if (!finished) {
          zoomBusyRef.current = false;
          return;
        }
        setZoomMode(next);

        const enterFromScale = enteringDay ? 0.86 : leavingDay ? 1.1 : 1;
        const enterFromTY = enteringDay ? 16 : leavingDay ? -12 : 0;
        bodyOpacity.setValue(0);
        bodyScale.setValue(enterFromScale);
        bodyTranslateY.setValue(enterFromTY);

        requestAnimationFrame(() => {
          const morphMs = TaskFoldMotion.zoomMorph;
          Animated.parallel([
            Animated.timing(bodyOpacity, {
              toValue: 1,
              duration: morphMs,
              easing: FOLD_MOTION_EASE,
              useNativeDriver: true,
            }),
            Animated.timing(bodyScale, {
              toValue: 1,
              duration: morphMs,
              easing: FOLD_MOTION_EASE,
              useNativeDriver: true,
            }),
            Animated.timing(bodyTranslateY, {
              toValue: 0,
              duration: morphMs,
              easing: FOLD_MOTION_EASE,
              useNativeDriver: true,
            }),
          ]).start(() => {
            zoomBusyRef.current = false;
          });
        });
      });
    },
    [bodyOpacity, bodyScale, bodyTranslateY, bodyTranslateX, motionReady, reduceMotion],
  );

  /** 日历 / 回今天切日：横向滑入（方向跟日期先后一致） */
  React.useEffect(() => {
    const prev = prevCenterYmdRef.current;
    if (prev === centerYmd) return;
    prevCenterYmdRef.current = centerYmd;

    if (!isDay || zoomBusyRef.current || !motionReady || reduceMotion) {
      bodyTranslateX.setValue(0);
      return;
    }

    const dir = centerYmd > prev ? 1 : -1;
    const distance = Math.min(Math.max(gridWidth, 240), 360);
    bodyTranslateX.stopAnimation();
    bodyOpacity.stopAnimation();
    bodyTranslateX.setValue(dir * distance * 0.42);
    bodyOpacity.setValue(0.45);
    Animated.parallel([
      Animated.timing(bodyTranslateX, {
        toValue: 0,
        duration: 280,
        easing: FOLD_MOTION_EASE,
        useNativeDriver: true,
      }),
      Animated.timing(bodyOpacity, {
        toValue: 1,
        duration: 280,
        easing: FOLD_MOTION_EASE,
        useNativeDriver: true,
      }),
    ]).start();
  }, [
    centerYmd,
    isDay,
    motionReady,
    reduceMotion,
    gridWidth,
    bodyTranslateX,
    bodyOpacity,
  ]);

  /** 长按/详情预选入格：切到时间线日视图（今日） */
  React.useEffect(() => {
    if (!pendingPlace) return;
    goZoom('day');
    setPeriodIndex(0);
  }, [pendingPlace, goZoom]);

  /** 顶部日历点选：打开该日课表 */
  React.useEffect(() => {
    if (!jumpToYmd) return;
    setPeriodIndex(dayOffsetFromToday(jumpToYmd, logicalTodayYmd));
    goZoom('day');
    onJumpToYmdConsumed?.();
  }, [jumpToYmd, goZoom, onJumpToYmdConsumed, logicalTodayYmd]);

  const onViewYmdChangeRef = React.useRef(onViewYmdChange);
  onViewYmdChangeRef.current = onViewYmdChange;
  React.useEffect(() => {
    onViewYmdChangeRef.current?.(centerYmd);
  }, [centerYmd]);

  const loadDaysKey = loadDayYmds.join(',');

  const reload = React.useCallback(
    async (days: string[], opts?: { silent?: boolean; hydrateRemote?: boolean }) => {
      if (!opts?.silent) setLoading(true);
      const generation = ++reloadGenerationRef.current;
      try {
        const [data, habits, checkInsMaps, boundary] = await Promise.all([
          loadScheduleForDayWindow(days, logicalTodayYmd, {
            hydrateRemote: opts?.hydrateRemote ?? !opts?.silent,
          }),
          getHabits().catch(() => []),
          // 读失败时保留上一份打卡 Map，避免指派后并发 reload 把已完成习惯刷回未完成
          getAllHabitCheckInsMaps().catch((err) => {
            console.warn('[WeeklyFrogSchedule] check-ins load failed, keep previous', err);
            return checkInsMapsRef.current;
          }),
          loadTasksDayBoundary(),
        ]);
        // 过期请求直接丢弃，避免后返回的旧结果盖掉新指派/新打卡
        if (generation !== reloadGenerationRef.current) return;
        checkInsMapsRef.current = checkInsMaps;
        setDayBoundary(boundary);
        setView(data);
        setVirtualHabits(
          buildVirtualHabitPlacementsForDays({
            habits,
            dayYmds: days,
            logicalTodayYmd,
            axis: data.axis,
            dayBoundary: boundary,
            checkInsByHabit: checkInsMaps,
          }),
        );
        const lookup = subjectsRef.current;
        const virtualTodos = buildVirtualTaskPlacementsForDays({
          tasks: lookup.tasks,
          dayYmds: days,
          logicalTodayYmd,
          axis: data.axis,
          dayBoundary: boundary,
          placements: data.placements,
        });
        const overdueFrogs = buildOverdueFrogCarryPlacementsForToday({
          tasks: lookup.tasks,
          projects: lookup.projects,
          logicalTodayYmd,
          axis: data.axis,
          placements: data.placements,
        });
        setVirtualTasks([...virtualTodos, ...overdueFrogs]);
      } catch (err) {
        if (generation !== reloadGenerationRef.current) return;
        console.warn('[WeeklyFrogSchedule] load failed', err);
        if (!opts?.silent) toast.error(toUserMessage(err, '无法加载日程表'));
      } finally {
        if (!opts?.silent && generation === reloadGenerationRef.current) {
          setLoading(false);
        }
      }
    },
    [logicalTodayYmd],
  );

  const loadDayYmdsRef = React.useRef(loadDayYmds);
  loadDayYmdsRef.current = loadDayYmds;

  React.useEffect(() => {
    void reload(loadDayYmds);
  }, [loadDaysKey, reload, loadDayYmds]);

  // 任务列表变更（完成/编辑）时重算虚拟待办，不必整表 reload
  React.useEffect(() => {
    if (!view) return;
    let cancelled = false;
    void loadTasksDayBoundary().then((boundary) => {
      if (cancelled) return;
      const virtualTodos = buildVirtualTaskPlacementsForDays({
        tasks: subjects.tasks,
        dayYmds: loadDayYmdsRef.current,
        logicalTodayYmd,
        axis: view.axis,
        dayBoundary: boundary,
        placements: view.placements,
      });
      const overdueFrogs = buildOverdueFrogCarryPlacementsForToday({
        tasks: subjects.tasks,
        projects: subjects.projects,
        logicalTodayYmd,
        axis: view.axis,
        placements: view.placements,
      });
      setVirtualTasks([...virtualTodos, ...overdueFrogs]);
    });
    return () => {
      cancelled = true;
    };
  }, [subjects.tasks, subjects.projects, view, logicalTodayYmd]);

  // 任意本地课表变更（含设置弹窗改轴 / 开关切换）立即静默重载
  React.useEffect(() => {
    return subscribeFrogScheduleChanged(() => {
      void loadScheduleTimelineWriteEnabled().then(setTimelineWrite);
      void reload(loadDayYmdsRef.current, { silent: true });
    });
  }, [reload]);

  // 他端（桌面）改占用 / 指派 extra 后，带远端合并的静默刷新
  React.useEffect(() => {
    return subscribeSyncDirty((tables, needFullSync) => {
      if (
        !(
          needFullSync ||
          tables.some(
            (t) =>
              t === 'schedule_placements' ||
              t === 'schedule_week_axis_snapshot' ||
              t === 'tasks' ||
              t === 'projects' ||
              t === 'habits' ||
              t === 'habit_check_ins' ||
              t === 'frog_completion_events',
          )
        )
      ) {
        return;
      }
      void reload(loadDayYmdsRef.current, { silent: true, hydrateRemote: false });
    });
  }, [reload]);

  React.useEffect(() => {
    // 逻辑日跨天时回到「今天居中」
    setPeriodIndex(0);
  }, [logicalTodayYmd]);

  /** 当前选中日的时间线事件（切日由上方周条/日历驱动，不在此横滑翻日） */
  const timelineDay = React.useMemo(() => {
    if (!view) return null;
    const ymd = centerYmd;
    const events = buildTimelineEventsForDay({
      dayYmd: ymd,
      axis: view.axis,
      placements: view.placements,
      virtualHabits: virtualHabitsResolved,
      virtualTasks,
      resolvePlacement: resolveTimelineDisplay,
    });
    return { ymd, events };
  }, [
    view,
    virtualHabitsResolved,
    virtualTasks,
    resolveTimelineDisplay,
    centerYmd,
  ]);
  const axisKey = view
    ? `${view.axis.startMinutes}-${view.axis.endMinutes}-${view.axis.slotHours}-${JSON.stringify(view.axis.breaks ?? [])}`
    : 'none';

  const colWidth = gridWidth > 0 ? gridWidth : 100;
  const pageWidth = gridWidth > 0 ? gridWidth : 300;

  const onGridLayout = React.useCallback((e: LayoutChangeEvent) => {
    const w = Math.floor(e.nativeEvent.layout.width);
    if (w > 0 && w !== gridWidth) setGridWidth(w);
  }, [gridWidth]);

  const orphanedPlacements = React.useMemo(() => {
    if (!view) return [] as SchedulePlacementRow[];
    return view.placements.filter((p) => {
      if (p.orphaned || p.startSlotIndex == null) return true;
      // 格内但无该日青蛙指派：与时间线过滤一致，归入未入格池供重新落入
      const assignYmd = ymdForWeekday(p.weekStartYmd, p.weekday);
      const sub = resolveSubject(p.subjectKind, p.subjectId, subjects, assignYmd);
      if (sub && !sub.deletedSnapshot && !isFrogAssignedOn(sub.extraData, assignYmd)) {
        return true;
      }
      return false;
    });
  }, [view, subjects]);

  /** sc-head cnt：「N/M 只已入格」 */
  const frogPlaceStats = React.useMemo(() => {
    if (!view) return { inGrid: 0, total: 0 };
    const map = new Map<string, boolean>();
    for (const p of view.placements) {
      const k = `${p.subjectKind}:${p.subjectId}`;
      const assignYmd = ymdForWeekday(p.weekStartYmd, p.weekday);
      const sub = resolveSubject(p.subjectKind, p.subjectId, subjects, assignYmd);
      const assigned =
        !sub || sub.deletedSnapshot || isFrogAssignedOn(sub.extraData, assignYmd);
      const inGrid = assigned && !p.orphaned && p.startSlotIndex != null;
      const prev = map.get(k);
      if (prev == null) map.set(k, inGrid);
      else if (inGrid) map.set(k, true);
    }
    let inGrid = 0;
    for (const v of map.values()) if (v) inGrid += 1;
    return { inGrid, total: map.size };
  }, [view, subjects]);

  /** 当前查看日：各优先级已指派 / 剩余（2/3/4/5 上限） */
  const dailyAssignQuota = React.useMemo((): DailyAssignQuotaBucketStat[] => {
    const items: { priority: number; extraData: string | null }[] = [];
    for (const t of subjects.tasks) {
      items.push({ priority: t.priority ?? 0, extraData: t.extra_data });
    }
    for (const p of subjects.projects) {
      items.push({ priority: p.priority ?? 0, extraData: p.extra_data });
    }
    return summarizeDailyAssignQuota(items, centerYmd);
  }, [subjects, centerYmd]);

  const quotaDetailStat = React.useMemo(
    () =>
      quotaDetailBucket == null
        ? null
        : dailyAssignQuota.find((q) => q.bucket === quotaDetailBucket) ?? null,
    [quotaDetailBucket, dailyAssignQuota],
  );

  const quotaDetailItems = React.useMemo((): DailyAssignedSubject[] => {
    if (quotaDetailBucket == null) return [];
    const listed = listAssignedSubjectsForBucket({
      assignYmd: centerYmd,
      bucket: quotaDetailBucket,
      tasks: subjects.tasks,
      projects: subjects.projects,
    });
    // 完成态与课表青蛙会话一致（指派日 session）
    return listed.map((item) => {
      const status =
        item.kind === 'project'
          ? subjects.projects.find((p) => p.id === item.id)?.status ?? null
          : subjects.tasks.find((t) => t.id === item.id)?.status ?? null;
      const statusForDone =
        status === 'completed' || status === 'archived' || status === 'done' ? 'done' : 'todo';
      return {
        ...item,
        done: isFrogDoneForToday(item.extraData, statusForDone, centerYmd),
      };
    });
  }, [quotaDetailBucket, centerYmd, subjects]);

  const openPlace = (
    assignYmd: string,
    startSlotIndex: number,
    opts?: {
      preferAllDay?: boolean;
      rematerializePlacementId?: string;
      rematerializePreselected?: SchedulePlacePreselected;
    },
  ) => {
    if (!dayEditable(assignYmd, logicalTodayYmd) || !view) return;
    const weekStartYmd = getWeekStartMondayYmd(assignYmd);
    const weekday = weekdayFromYmd(assignYmd);
    const slot = opts?.preferAllDay ? 0 : startSlotIndex;
    setPlaceTarget({
      weekStartYmd,
      weekday,
      startSlotIndex: slot,
      assignYmd,
      maxSpan: maxSpanFromSlot(view.axis, slot),
      preferAllDay: opts?.preferAllDay,
      rematerializePlacementId: opts?.rematerializePlacementId,
      rematerializePreselected: opts?.rematerializePreselected,
    });
  };

  /**
   * 阶段 L 已无「空格」可点：预选后自动打开入格 Sheet（选时段）。
   * 关闭 Sheet 不取消预选；可点横幅或「添加安排」再开。
   */
  const autoOpenedPendingKeyRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!view) return;
    const key = reassignPending
      ? `reassign:${reassignPending.placement.id}`
      : pendingPlace
        ? `place:${pendingPlace.kind}:${pendingPlace.id}`
        : null;
    if (!key) {
      autoOpenedPendingKeyRef.current = null;
      return;
    }
    if (autoOpenedPendingKeyRef.current === key) return;
    if (placeTarget) return;
    autoOpenedPendingKeyRef.current = key;
    const ymd = centerYmdForPeriod(logicalTodayYmd, 0);
    if (reassignPending) {
      openPlace(ymd, 0, {
        rematerializePlacementId: reassignPending.placement.id,
        rematerializePreselected: {
          kind: reassignPending.subject.kind,
          id: reassignPending.subject.id,
          title: reassignPending.subject.title,
          priority: reassignPending.subject.priority,
          dueDate: reassignPending.subject.dueDate,
          acceptanceCriteria: reassignPending.subject.acceptanceCriteria,
          projectName: reassignPending.subject.projectName,
        },
      });
      return;
    }
    openPlace(ymd, 0);
    // openPlace / placeTarget 有意不入 deps：只在预选身份变化时自动弹一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPlace, reassignPending, view, logicalTodayYmd]);

  const finishPlaceSuccessUi = (assignYmd: string, successMessage: string) => {
    setPlaceTarget(null);
    setReassignPending(null);
    onClearPendingPlace?.();
    autoOpenedPendingKeyRef.current = null;
    toast.success(successMessage);
    setPeriodIndex(dayOffsetFromToday(assignYmd, logicalTodayYmd));
  };

  const handlePlaceConfirm = async (results: SchedulePlaceResult[]) => {
    if (!placeTarget || !view || results.length === 0) return;
    const target = placeTarget;
    const first = results[0]!;
    const assignYmd =
      first.assignYmd && isEditableScheduleDay(first.assignYmd, logicalTodayYmd)
        ? first.assignYmd
        : target.assignYmd;
    const weekStartYmd = getWeekStartMondayYmd(assignYmd);
    const weekday = weekdayFromYmd(assignYmd);
    const useMinutePath = timelineWrite;
    const daySlots = getSlotCount(view.axis);
    const successLabel =
      results.length > 1
        ? `已入格 ${results.length} 项`
        : first.title.trim()
          ? `已入格「${first.title.trim()}」`
          : '已入格';
    try {
      if (target.rematerializePlacementId) {
        const result = first;
        const startSlotIndex = result.allDay
          ? 0
          : target.startSlotIndex + (result.startSlotOffset ?? 0);
        const spanSlots = result.allDay ? Math.max(1, daySlots) : result.spanSlots;
        const rematerializeId = target.rematerializePlacementId;
        const row = useMinutePath
          ? await rematerializeOrphanedPlacementAtMinutes({
              placementId: rematerializeId,
              assignYmd,
              startMinutes: result.startMinutes ?? 0,
              endMinutes: result.endMinutes ?? 0,
              allDay: result.allDay,
              logicalTodayYmd,
            })
          : await rematerializeOrphanedPlacement({
              placementId: rematerializeId,
              assignYmd,
              startSlotIndex,
              spanSlots,
              logicalTodayYmd,
            });
        // 跨日且保留旧日时会新建占用（id 变化）；同日/过去日迁移则沿用原 id
        const keptAsAdd = row.id !== rematerializeId;
        finishPlaceSuccessUi(
          assignYmd,
          keptAsAdd ? successLabel : successLabel.replace(/^已入格/, '已改派'),
        );
        await reload([assignYmd], { silent: true });
        if (keptAsAdd) {
          onChanged?.({
            kind: row.subjectKind,
            id: row.subjectId,
            assignYmd,
            action: 'assign',
          });
        } else {
          onChanged?.();
        }
        return;
      }

      const placedRows: SchedulePlacementRow[] = [];
      for (const result of results) {
        const startSlotIndex = result.allDay
          ? 0
          : target.startSlotIndex + (result.startSlotOffset ?? 0);
        const spanSlots = result.allDay ? Math.max(1, daySlots) : result.spanSlots;
        const row = useMinutePath
          ? await placeFrogOnScheduleAt({
              weekStartYmd,
              weekday,
              startMinutes: result.startMinutes ?? 0,
              endMinutes: result.endMinutes ?? 0,
              allDay: result.allDay,
              subjectKind: result.kind,
              subjectId: result.id,
              logicalTodayYmd,
            })
          : await placeFrogOnSchedule({
              weekStartYmd,
              weekday,
              startSlotIndex,
              spanSlots,
              subjectKind: result.kind,
              subjectId: result.id,
              logicalTodayYmd,
            });
        placedRows.push(row);
      }
      if (placedRows.length > 0) {
        setView((prev) => {
          if (!prev) return prev;
          const byId = new Map(prev.placements.map((p) => [p.id, p]));
          for (const row of placedRows) byId.set(row.id, row);
          const placements = [...byId.values()];
          return {
            ...prev,
            placements,
            orphanedCount: placements.filter((p) => p.orphaned || p.startSlotIndex == null).length,
          };
        });
      }
      // 先清预选横幅与成功提示，再静默刷新；避免云端慢/失败时横幅残留且无反馈
      finishPlaceSuccessUi(assignYmd, successLabel);
      await reload([assignYmd], { silent: true });
      onChanged?.(
        results.map((result) => ({
          kind: result.kind,
          id: result.id,
          assignYmd,
          action: 'assign' as const,
        })),
      );
    } catch (err) {
      toast.error(
        toUserMessage(
          err,
          results.length > 1 ? '批量入格失败，请稍后重试' : '入格失败，请稍后重试',
        ),
      );
      // 真正失败时抛出让 Sheet 保持打开，便于改时段重试
      throw err;
    }
  };

  const startReassignTime = (placement: SchedulePlacementRow, subject: ScheduleSubjectInfo) => {
    // 先关详情 / 孤儿列表 Modal，再延后开入格 Sheet（Modal→Modal 需更长空窗）
    setDetail(null);
    setOrphanListOpen(false);
    setPlaceTarget(null);
    // 允许同一占用再次改派时强制重开 Sheet（否则 autoOpened key 会短路）
    autoOpenedPendingKeyRef.current = null;
    runAfterUiSettles(() => {
      goZoom('day');
      const assignYmd = ymdForWeekday(placement.weekStartYmd, placement.weekday);
      setPeriodIndex(dayOffsetFromToday(assignYmd, logicalTodayYmd));
      setReassignPending({ placement, subject });
    }, MODAL_HANDOFF_MS);
  };

  const openVirtualHabitDetail = React.useCallback((habit: VirtualHabitPlacement) => {
    setOrphanListOpen(false);
    setDetail({
      surface: 'habit',
      placement: null,
      habitId: habit.habitId,
      subject: {
        kind: 'task',
        id: habit.habitId,
        title: habit.name,
        priority: 0,
        dueDate: null,
        acceptanceCriteria: '',
        projectName: null,
        extraData: habit.extraData,
        status: habit.done ? 'done' : 'todo',
        done: habit.done,
        deletedSnapshot: false,
      },
      virtualSlot: {
        assignYmd: habit.assignYmd,
        startSlotIndex: habit.startSlotIndex,
        spanSlots: habit.spanSlots,
        hour: habit.hour,
        minute: habit.minute,
      },
    });
  }, []);

  const openVirtualTaskDetail = React.useCallback(
    (task: VirtualTaskPlacement) => {
      const kind = task.carrySubjectKind ?? 'task';
      const subject = resolveSubject(kind, task.taskId, subjects, task.assignYmd);
      if (!subject) return;
      setOrphanListOpen(false);
      setDetail({
        surface: task.carrySubjectKind ? 'frog' : 'todo',
        placement: null,
        subject: {
          ...subject,
          // 虚拟块完成态以当日实例为准
          done: task.done,
          status: task.done ? 'done' : subject.status,
          extraData: task.extraData ?? subject.extraData,
        },
        virtualSlot: {
          assignYmd: task.assignYmd,
          startSlotIndex: task.startSlotIndex,
          spanSlots: task.spanSlots,
          hour: task.hour,
          minute: task.minute,
        },
      });
    },
    [subjects],
  );

  const tapVirtualHabit = React.useCallback(
    (habit: VirtualHabitPlacement) => {
      if (habit.assignYmd !== logicalTodayYmd) {
        Alert.alert(habit.name, '未到打卡日，请到当天再打卡。');
        return;
      }
      // 子习惯走清单弹窗，不在此做整卡确认
      if (hasActiveSubHabits(habit.extraData)) {
        if (habit.done) onHabitUndo?.(habit.habitId);
        else onHabitCheckIn?.(habit.habitId);
        return;
      }
      openVirtualHabitDetail(habit);
    },
    [logicalTodayYmd, onHabitCheckIn, onHabitUndo, openVirtualHabitDetail],
  );

  const tapVirtualTask = React.useCallback(
    (task: VirtualTaskPlacement) => {
      openVirtualTaskDetail(task);
    },
    [openVirtualTaskDetail],
  );

  const openDetail = React.useCallback(
    (p: SchedulePlacementRow) => {
      const assignYmd = ymdForWeekday(p.weekStartYmd, p.weekday);
      const subject = resolveSubject(p.subjectKind, p.subjectId, subjects, assignYmd);
      if (!subject) return;
      const surface: ScheduleDetailSurface =
        blockKindForPlacement(p, subjects) === 'todo' ? 'todo' : 'frog';
      setOrphanListOpen(false);
      setDetail({ surface, placement: p, subject, virtualSlot: null });
    },
    [subjects],
  );

  /** 阶段 F：点时间线事件 → 复用现有详情 / 习惯打卡 / 待办详情 */
  const handleTimelineEventPress = React.useCallback(
    (event: TimelineEvent) => {
      const src = event.source;
      if (src.type === 'placement') {
        openDetail(src.placement);
        return;
      }
      if (src.type === 'habit') {
        tapVirtualHabit(src.habit);
        return;
      }
      tapVirtualTask(src.task);
    },
    [openDetail, tapVirtualHabit, tapVirtualTask],
  );

  const todayCompactItems = React.useMemo(() => {
    if (!view) return [];
    const daySlotCount = getSlotCount(view.axis);
    const weightOf = (id: string) => {
      const w = tagWeightBySubjectId?.get(id);
      return typeof w === 'number' && Number.isFinite(w) ? w : 0;
    };
    const items: TodayCompactItem[] = [];
    for (const p of view.placements) {
      if (p.orphaned || p.startSlotIndex == null) continue;
      const assignYmd = ymdForWeekday(p.weekStartYmd, p.weekday);
      if (assignYmd !== logicalTodayYmd) continue;
      const sub = resolveSubject(p.subjectKind, p.subjectId, subjects, assignYmd);
      // 未入格（无该日青蛙指派）不进时间线/最简焦点，兼容残留占用
      if (sub && !sub.deletedSnapshot && !isFrogAssignedOn(sub.extraData, assignYmd)) {
        continue;
      }
      const span = Math.max(1, p.spanSlots);
      const hasMins =
        typeof p.startMinutes === 'number' &&
        typeof p.endMinutes === 'number' &&
        p.endMinutes > p.startMinutes;
      const startMins = hasMins
        ? p.startMinutes!
        : slotStartMinutes(view.axis, p.startSlotIndex);
      const endMins = hasMins
        ? p.endMinutes!
        : placementEndMinutes(view.axis, p.startSlotIndex, span);
      const rawAllDay = p.allDay as number | boolean | null | undefined;
      const allDay =
        rawAllDay === 1 ||
        rawAllDay === true ||
        (p.startSlotIndex === 0 && span >= daySlotCount) ||
        (hasMins &&
          startMins <= view.axis.startMinutes &&
          endMins >= view.axis.endMinutes);
      const done = !!sub?.done;
      let overdue = false;
      if (!done) {
        if (p.subjectKind === 'task') {
          const row = subjects.tasks.find((t) => t.id === p.subjectId);
          overdue = row ? isTaskOverdueForList(row, logicalTodayYmd) : false;
        } else {
          const due = sub?.dueDate?.slice(0, 10) ?? '';
          overdue = /^\d{4}-\d{2}-\d{2}$/.test(due) && due < logicalTodayYmd;
        }
      }
      items.push({
        placement: p,
        habit: null,
        virtualTask: null,
        title: sub?.title?.trim() || '青蛙',
        done,
        overdue,
        // 过期全天仍标「全天」，否则最简全天区 / 时段焦点两边都漏掉
        timeLabel: allDay ? '全天' : overdue ? '过期' : formatMinutesAsHm(startMins),
        endLabel: allDay || overdue ? '' : formatMinutesAsHm(endMins),
        startMins,
        endMins,
        tagWeight: weightOf(p.subjectId),
        priority: sub?.priority ?? 0,
      });
    }
    for (const h of virtualHabitsResolved) {
      if (h.assignYmd !== logicalTodayYmd) continue;
      const span = Math.max(1, h.spanSlots);
      const hasMins =
        typeof h.startMinutes === 'number' &&
        typeof h.endMinutes === 'number' &&
        h.endMinutes > h.startMinutes;
      const startMins = hasMins
        ? h.startMinutes!
        : slotStartMinutes(view.axis, h.startSlotIndex);
      const endMins = hasMins
        ? h.endMinutes!
        : placementEndMinutes(view.axis, h.startSlotIndex, span);
      const allDay = h.allDay || (!hasMins && h.startSlotIndex === 0 && span >= daySlotCount);
      items.push({
        placement: null,
        habit: h,
        virtualTask: null,
        title: h.name,
        done: h.done,
        overdue: false,
        timeLabel: allDay ? '全天' : formatMinutesAsHm(startMins),
        endLabel: allDay ? '' : formatMinutesAsHm(endMins),
        startMins,
        endMins,
        tagWeight: weightOf(h.habitId),
        priority: 0,
      });
    }
    for (const t of virtualTasks) {
      if (t.assignYmd !== logicalTodayYmd) continue;
      // 当日未指派 / 未入格不进最简焦点（含过期滞留；与时间线一致）
      if (!isFrogAssignedOn(t.extraData, t.assignYmd)) continue;
      const span = Math.max(1, t.spanSlots);
      const hasMins =
        typeof t.startMinutes === 'number' &&
        typeof t.endMinutes === 'number' &&
        t.endMinutes > t.startMinutes;
      const startMins = hasMins
        ? t.startMinutes!
        : slotStartMinutes(view.axis, t.startSlotIndex);
      const endMins = hasMins
        ? t.endMinutes!
        : placementEndMinutes(view.axis, t.startSlotIndex, span);
      const allDay = t.allDay || (!hasMins && t.startSlotIndex === 0 && span >= daySlotCount);
      const overdue = !t.done && (!!t.overdue || !!t.carrySubjectKind);
      items.push({
        placement: null,
        habit: null,
        virtualTask: t,
        title: t.title,
        done: t.done,
        overdue,
        timeLabel: allDay ? '全天' : overdue ? '过期' : formatMinutesAsHm(startMins),
        endLabel: allDay || overdue ? '' : formatMinutesAsHm(endMins),
        startMins,
        endMins,
        tagWeight: weightOf(t.taskId),
        priority: t.priority ?? 0,
      });
    }
    items.sort(compareTodayCompactByWeight);
    return items;
  }, [view, logicalTodayYmd, subjects, virtualHabitsResolved, virtualTasks, tagWeightBySubjectId]);

  const minimalFocus = React.useMemo(() => {
    const nowMins = axisNowMins ?? -1;
    const timeline = view ? buildScheduleTimeline(view.axis) : [];
    const workSlots = view ? listWorkSlots(view.axis) : [];

    /** 已超时：时段已结束且未完成（按格宽轴，而非任务自身跨度「仍在进行」） */
    const overdueItems = todayCompactItems.filter(
      (x) => !x.done && axisNowMins != null && x.endMins <= nowMins,
    );

    const compactItemId = (x: TodayCompactItem) =>
      x.placement?.id ??
      (x.habit ? `habit:${x.habit.habitId}` : null) ??
      (x.virtualTask ? `vtask:${x.virtualTask.taskId}` : x.title);

    const mergeFocusItems = (slotItems: TodayCompactItem[]) => {
      const byId = new Map<string, TodayCompactItem>();
      for (const x of overdueItems) {
        byId.set(compactItemId(x), x);
      }
      for (const x of slotItems) {
        byId.set(compactItemId(x), x);
      }
      return [...byId.values()].sort(compareTodayCompactByWeight);
    };

    /** 当前格：起点落在本格，或时段覆盖本格（跨格；全天走顶部专属区，不挤占时段焦点） */
    const itemsCoveringSlot = (slot: {
      slotIndex: number;
      startMinutes: number;
      endMinutes: number;
    }) =>
      todayCompactItems.filter((x) => {
        if (x.timeLabel === '全天') return false;
        const startSlot =
          x.placement?.startSlotIndex ??
          x.habit?.startSlotIndex ??
          x.virtualTask?.startSlotIndex ??
          null;
        if (startSlot === slot.slotIndex) return true;
        return x.startMins < slot.endMinutes && x.endMins > slot.startMinutes;
      });

    const currentSlot = workSlots.find(
      (s) => nowMins >= s.startMinutes && nowMins < s.endMinutes,
    );
    if (currentSlot) {
      return {
        kind: 'current' as const,
        items: mergeFocusItems(itemsCoveringSlot(currentSlot)),
        rangeLabel: `${formatMinutesAsHm(currentSlot.startMinutes)}–${formatMinutesAsHm(currentSlot.endMinutes)}`,
        countdownLabel: formatRemainLabel(
          remainSecondsUntil(currentSlot.endMinutes, axisNowMins),
        ),
      };
    }

    // 断开时段（如午休）：不可入格，展示断开本身 + 超时项 + 下一段可排指派
    const currentBreak = timeline.find(
      (r): r is Extract<typeof r, { kind: 'break' }> =>
        r.kind === 'break' &&
        nowMins >= r.startMinutes &&
        nowMins < r.endMinutes,
    );
    const nextSlot = workSlots.find((s) => s.startMinutes > nowMins);
    if (currentBreak) {
      return {
        kind: 'break' as const,
        items: mergeFocusItems(nextSlot ? itemsCoveringSlot(nextSlot) : []),
        rangeLabel: `${formatMinutesAsHm(currentBreak.startMinutes)}–${formatMinutesAsHm(currentBreak.endMinutes)}`,
        countdownLabel: nextSlot
          ? formatRemainLabel(remainSecondsUntil(nextSlot.startMinutes, axisNowMins), {
              untilStart: true,
            })
          : formatRemainLabel(remainSecondsUntil(currentBreak.endMinutes, axisNowMins)),
        breakLabel: currentBreak.label?.trim() || '休息',
      };
    }

    if (nextSlot) {
      return {
        kind: 'upcoming' as const,
        items: mergeFocusItems(itemsCoveringSlot(nextSlot)),
        rangeLabel: `${formatMinutesAsHm(nextSlot.startMinutes)}–${formatMinutesAsHm(nextSlot.endMinutes)}`,
        countdownLabel: formatRemainLabel(
          remainSecondsUntil(nextSlot.startMinutes, axisNowMins),
          { untilStart: true },
        ),
      };
    }

    if (overdueItems.length > 0) {
      return {
        kind: 'finished' as const,
        items: overdueItems,
        rangeLabel: '',
        countdownLabel: '有超时未完成',
      };
    }
    if (todayCompactItems.length > 0) {
      return {
        kind: 'finished' as const,
        items: [] as TodayCompactItem[],
        rangeLabel: '',
        countdownLabel: '今日安排已结束',
      };
    }
    return {
      kind: 'empty' as const,
      items: [] as TodayCompactItem[],
      rangeLabel: '',
      countdownLabel: '今日暂无安排',
    };
  }, [todayCompactItems, axisNowMins, view]);

  /**
   * 最简态顶部全天区：经典课表「全天格」退役后，时段焦点仍排除全天块，
   * 须在此独立展示，否则已指派的全天待办/任务会「消失」。
   */
  const minimalAllDayItems = React.useMemo(
    () => todayCompactItems.filter((x) => x.timeLabel === '全天'),
    [todayCompactItems],
  );

  // 从时间线折回最简时归位今天（避免跳转过程中被清掉）
  React.useEffect(() => {
    if (wasDayRef.current && !isDay) {
      setPeriodIndex(0);
    }
    wasDayRef.current = isDay;
  }, [isDay]);

  const renderDayHeader = (ymd: string, width: number) => {
    const isTodayCol = ymd === logicalTodayYmd;
    const isPastCol = ymd < logicalTodayYmd;
    const weekday = weekdayFromYmd(ymd);
    const month = Number(ymd.slice(5, 7));
    const dayNum = Number(ymd.slice(8));
    /** 设计稿 `.tt-h`：`10/23 五`，今日 pond 加粗 */
    return (
      <View
        key={`h-${ymd}`}
        style={[
          styles.dayHeader,
          {
            width,
            height: DAY_HEADER_H,
            opacity: isPastCol ? 0.72 : 1,
          },
        ]}>
        <Text
          style={[
            styles.dayHeaderLabel,
            {
              color: isTodayCol ? primary : outline,
              fontWeight: isTodayCol ? '800' : '600',
            },
          ]}
          numberOfLines={1}>
          {month}/{dayNum} {WEEKDAY_SHORT_LABELS[weekday - 1]}
        </Text>
      </View>
    );
  };

  const renderTimelineGrid = () => {
    if (!view || !timelineDay) return null;
    const pw = pageWidth || colWidth;
    /** 完整高度：约 0.85px/分钟，夹在 260–560；默认半高，展开由 DayTimelineSchedule 做高度动画 */
    const timelineFullH = Math.max(
      260,
      Math.min((view.axis.endMinutes - view.axis.startMinutes) * 0.85, 560),
    );
    const timelineViewportH = timelineHeightExpanded
      ? timelineFullH
      : Math.max(130, Math.round(timelineFullH * 0.5));
    const headerRow = (
      <View
        style={[
          styles.gridWrap,
          styles.gridHeaderChrome,
          { backgroundColor: theme.surface, borderBottomColor: gridLineSoft },
        ]}>
        <View style={{ width: TIME_GUTTER, height: DAY_HEADER_H }} />
        <View style={{ flex: 1 }} onLayout={onGridLayout}>
          {gridWidth > 0 ? renderDayHeader(timelineDay.ymd, pw) : null}
        </View>
      </View>
    );

    const body = (
      <View style={{ width: pw, flexDirection: 'row' }}>
        <DayTimelineSchedule
          dayYmd={timelineDay.ymd}
          axis={view.axis}
          events={timelineDay.events}
          nowMinutes={timelineDay.ymd === logicalTodayYmd ? axisNowMins : null}
          maxHeight={timelineViewportH}
          width={pw}
          onPressEvent={handleTimelineEventPress}
          onRequestAdd={(ymd) => {
            if (reassignPending) {
              openPlace(ymd, 0, {
                rematerializePlacementId: reassignPending.placement.id,
                rematerializePreselected: {
                  kind: reassignPending.subject.kind,
                  id: reassignPending.subject.id,
                  title: reassignPending.subject.title,
                  priority: reassignPending.subject.priority,
                  dueDate: reassignPending.subject.dueDate,
                  acceptanceCriteria: reassignPending.subject.acceptanceCriteria,
                  projectName: reassignPending.subject.projectName,
                },
              });
              return;
            }
            openPlace(ymd, 0);
          }}
        />
      </View>
    );

    return (
      <View key={`${axisKey}-timeline`}>
        {headerRow}
        <View>{gridWidth > 0 ? body : null}</View>
        <Pressable
          onPress={() => setTimelineHeightExpanded((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel={
            timelineHeightExpanded ? '收起时间线为一半高度' : '展开时间线完整高度'
          }
          style={({ pressed }) => [
            styles.scFoot,
            {
              borderTopColor: isDark ? tf.line : 'rgba(230,221,206,0.55)',
              opacity: pressed ? 0.82 : 1,
            },
          ]}>
          <View
            style={[
              styles.scFootRing,
              {
                borderColor: isDark ? tf.line2 : '#E4E1D5',
                borderTopColor: tf.frog,
                borderRightColor: tf.frog,
              },
            ]}
          />
          <Text style={[styles.scFootText, { color: tf.faint }]} numberOfLines={1}>
            {timelineHeightExpanded
              ? '完整高度 · 点此收起为一半'
              : '半高预览 · 点此展开完整高度'}
          </Text>
          <MaterialIcons
            name={timelineHeightExpanded ? 'unfold-less' : 'unfold-more'}
            size={16}
            color={tf.pond}
          />
        </Pressable>
      </View>
    );
  };

  const renderScheduleGrid = () => {
    if (!view || !timelineDay) return null;
    return renderTimelineGrid();
  };

  const renderCompactRow = (
    item: TodayCompactItem,
    index: number,
    list: TodayCompactItem[],
    opts?: { dense?: boolean },
  ) => {
    const kind: ScheduleBlockKind = item.habit
      ? 'habit'
      : item.virtualTask?.carrySubjectKind === 'project'
        ? 'proj'
        : item.virtualTask?.carrySubjectKind === 'task'
          ? 'frog'
          : item.virtualTask
            ? 'todo'
            : item.placement
              ? blockKindForPlacement(item.placement, subjects)
              : 'frog';
    const fill = scheduleBlockStyle(kind, {
      isPast: false,
      allDone: item.done,
      isDark,
    });
    const durMin = Math.max(0, item.endMins - item.startMins);
    const isAllDayRow = item.timeLabel === '全天';
    const durLabel = isAllDayRow
      ? '全天'
      : durMin >= 60
        ? `${Math.round((durMin / 60) * 10) / 10}h`.replace(/\.0h$/, 'h')
        : `${durMin}m`;
    const sub = item.placement
      ? resolveSubject(
          item.placement.subjectKind,
          item.placement.subjectId,
          subjects,
          logicalTodayYmd,
        )
      : null;
    const meta =
      kind === 'habit'
        ? item.done
          ? '习惯 · 已完成'
          : '习惯虚拟块'
        : kind === 'todo'
          ? item.virtualTask?.allDay
            ? '独立待办 · 全天'
            : '独立待办 · 定点'
          : item.virtualTask?.carrySubjectKind === 'project'
            ? `过期项目 · ${item.done ? '已完成' : '待处理'}`
            : item.virtualTask?.carrySubjectKind === 'task'
              ? `过期青蛙 · ${item.done ? '已完成' : '待处理'}`
              : item.placement?.subjectKind === 'project'
                ? `项目 · ${item.done ? '已完成' : '进行中'}`
                : [sub?.projectName?.trim() || '青蛙', item.done ? '已完成' : '进行中']
                    .filter(Boolean)
                    .join(' · ');
    return (
      <Pressable
        key={
          item.placement?.id ??
          (item.habit
            ? `habit-${item.habit.habitId}-${item.startMins}`
            : `vtask-${item.virtualTask?.taskId}-${item.startMins}`)
        }
        onPress={() => {
          if (item.habit) {
            tapVirtualHabit(item.habit);
            return;
          }
          if (item.virtualTask) {
            tapVirtualTask(item.virtualTask);
            return;
          }
          if (item.placement) openDetail(item.placement);
        }}
        accessibilityRole="button"
        accessibilityLabel={`${item.timeLabel} ${item.title}${item.done ? '，已完成' : ''}`}
        style={({ pressed }) => [
          styles.dlRow,
          index < list.length - 1 && { marginBottom: 2 },
          { opacity: pressed ? 0.88 : item.done ? 0.72 : 1 },
        ]}>
        <View style={styles.dlTime}>
          <Text style={[styles.dlTimeStart, { color: outline }]}>{item.timeLabel}</Text>
          <Text style={[styles.dlTimeDur, { color: tf.faint }]}>{durLabel}</Text>
        </View>
        <View
          style={[
            styles.dlBlock,
            opts?.dense && styles.dlBlockDense,
            {
              backgroundColor: fill.backgroundColor,
              borderColor: fill.borderColor,
              borderStyle: fill.borderStyle,
            },
          ]}>
          <Text
            style={[
              styles.dlBlockTitle,
              {
                color: fill.titleColor,
                textDecorationLine: item.done ? 'line-through' : 'none',
              },
            ]}
            numberOfLines={1}>
            {item.title}
          </Text>
          {!opts?.dense ? (
            <Text style={[styles.dlBlockMeta, { color: fill.metaColor }]} numberOfLines={1}>
              {meta}
            </Text>
          ) : null}
          <View
            style={[
              styles.dlBlockCk,
              {
                borderColor: item.done
                  ? fill.doneOnLight
                    ? 'rgba(255,255,255,0.92)'
                    : fill.titleColor
                  : fill.titleColor,
                backgroundColor: item.done
                  ? fill.doneOnLight
                    ? 'rgba(255,255,255,0.92)'
                    : kind === 'frog'
                      ? '#DDE9CB'
                      : fill.titleColor
                  : 'transparent',
                opacity: item.done ? 1 : 0.5,
                alignItems: 'center',
                justifyContent: 'center',
              },
            ]}>
            {item.done ? (
              <MaterialIcons
                name="check"
                size={8}
                color={
                  fill.doneOnLight
                    ? primary
                    : kind === 'frog'
                      ? '#35604A'
                      : '#fff'
                }
              />
            ) : null}
          </View>
        </View>
      </Pressable>
    );
  };

  const zoomSegOptions: { key: ScheduleZoomMode; label: string }[] = [
    { key: 'minimal', label: '最简' },
    { key: 'day', label: '时间线' },
  ];

  return (
    <View style={styles.section}>
      <View
        style={
          isDay
            ? [
                sectionCardStyle,
                {
                  backgroundColor: isDark ? tf.paper2 : tf.cardSoft,
                  borderColor: isDark ? tf.line : 'rgba(216,205,187,0.78)',
                  overflow: 'hidden',
                  paddingTop: 0,
                  paddingHorizontal: 0,
                },
              ]
            : [
                styles.summaryCard,
                shadows.card,
                {
                  backgroundColor: isDark ? tf.paper2 : tf.cardSoft,
                  borderColor: isDark ? tf.line : 'rgba(216,205,187,0.78)',
                  overflow: 'hidden',
                  paddingTop: 0,
                  paddingHorizontal: 0,
                },
              ]
        }>
        <View
          style={[
            styles.scHead,
            {
              borderBottomColor: isDark ? tf.line : 'rgba(230,221,206,0.7)',
              marginBottom: 0,
            },
          ]}>
          <Text style={[styles.scHeadTitle, { color: tf.ink2 }]}>青蛙周日程</Text>
          <Text style={[styles.scHeadCnt, { color: tf.faint }]}>
            <Text style={{ color: tf.frog, fontFamily: foldFonts.mono, fontWeight: '700' }}>
              {frogPlaceStats.inGrid}
            </Text>
            /{Math.max(frogPlaceStats.total, frogPlaceStats.inGrid)} 只已入格
          </Text>
          <View style={[styles.zseg, { backgroundColor: tf.track }]}>
            {zoomSegOptions.map((opt) => {
              const on = zoomMode === opt.key;
              return (
                <Pressable
                  key={opt.key}
                  onPress={() => goZoom(opt.key)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={opt.label}
                  style={[
                    styles.zsegBtn,
                    on && {
                      backgroundColor: tf.cream,
                      shadowColor: tf.shadow,
                      shadowOpacity: 0.1,
                      shadowRadius: 6,
                      shadowOffset: { width: 0, height: 2 },
                      elevation: 2,
                    },
                  ]}>
                  <Text
                    style={{
                      fontSize: 11,
                      fontWeight: '700',
                      color: on ? tf.pond : tf.muted,
                    }}>
                    {opt.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {isDay && orphanedPlacements.length > 0 ? (
            <Pressable
              onPress={() => setOrphanListOpen(true)}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={`查看未入格任务 ${orphanedPlacements.length} 项`}
              style={[styles.orphanChip, { backgroundColor: `${tf.rose}18` }]}>
              <Text style={{ color: tf.rose, fontSize: 11, fontWeight: '700' }}>
                未入格 {orphanedPlacements.length}
              </Text>
            </Pressable>
          ) : null}
          <Pressable
            onPress={() => setSettingsOpen(true)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="课表设置"
            style={({ pressed }) => [
              styles.copyBtn,
              {
                backgroundColor: isDark ? tf.paper3 : '#F4EFE2',
                borderColor: isDark ? tf.line : 'rgba(216,205,187,0.6)',
                opacity: pressed ? 0.8 : 1,
              },
            ]}>
            <MaterialIcons name="tune" size={14} color={tf.muted} />
          </Pressable>
        </View>

        <View
          style={[styles.quotaRow, { borderBottomColor: isDark ? tf.line : 'rgba(230,221,206,0.55)' }]}
          accessibilityLabel={`当日指派配额 ${dailyAssignQuota
            .map((q) => `${q.shortLabel}已指派${q.used}剩余${q.remaining}`)
            .join('，')}`}>
          {dailyAssignQuota.map((q) => {
            const full = q.remaining <= 0;
            return (
              <Pressable
                key={q.bucket}
                onPress={() => setQuotaDetailBucket(q.bucket)}
                accessibilityRole="button"
                accessibilityLabel={`${q.shortLabel} ${q.label}，已指派 ${q.used}，剩余 ${q.remaining}，点按查看`}
                style={({ pressed }) => [
                  styles.quotaChip,
                  {
                    backgroundColor: full
                      ? isDark
                        ? `${tf.rose}22`
                        : 'rgba(186,26,26,0.08)'
                      : isDark
                        ? tf.paper3
                        : '#F4EFE2',
                    opacity: pressed ? 0.82 : 1,
                  },
                ]}>
                <Text style={[styles.quotaChipLabel, { color: full ? tf.rose : tf.muted }]}>
                  {q.shortLabel}
                </Text>
                <Text
                  style={[
                    styles.quotaChipValue,
                    { color: full ? tf.rose : tf.ink2, fontFamily: foldFonts.mono },
                  ]}>
                  {q.used}/{q.max}
                </Text>
                <Text style={[styles.quotaChipRemain, { color: full ? tf.rose : tf.faint }]}>
                  余{q.remaining}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {isMinimal && minimalFocus.kind !== 'empty' ? (
          <Text
            style={[styles.summaryMeta, { color: outline, paddingHorizontal: Spacing['2xl'], paddingTop: 6 }]}
            numberOfLines={1}>
            {minimalFocus.kind === 'finished'
              ? minimalFocus.countdownLabel
              : minimalFocus.kind === 'break'
                ? `${minimalFocus.breakLabel} ${minimalFocus.rangeLabel} · ${minimalFocus.countdownLabel}`
                : `${minimalFocus.rangeLabel} · ${minimalFocus.countdownLabel}`}
          </Text>
        ) : null}

        {reassignPending ? (
          <View
            style={[
              styles.pendingBanner,
              styles.preselectHint,
              {
                backgroundColor: isDark ? tf.amber2 : '#F8ECD7',
                borderColor: isDark ? tf.line2 : '#E8CDA2',
              },
            ]}>
            <Pressable
              onPress={() => {
                openPlace(centerYmd, 0, {
                  rematerializePlacementId: reassignPending.placement.id,
                  rematerializePreselected: {
                    kind: reassignPending.subject.kind,
                    id: reassignPending.subject.id,
                    title: reassignPending.subject.title,
                    priority: reassignPending.subject.priority,
                    dueDate: reassignPending.subject.dueDate,
                    acceptanceCriteria: reassignPending.subject.acceptanceCriteria,
                    projectName: reassignPending.subject.projectName,
                  },
                });
              }}
              style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0 }}
              accessibilityRole="button"
              accessibilityLabel="打开入格确认">
              <MaterialIcons name="cruelty-free" size={16} color={tf.amberInk} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ color: tf.amberInk, fontWeight: '700', fontSize: 12 }} numberOfLines={1}>
                  重新指派「{reassignPending.subject.title}」· 点此确认时段
                </Text>
              </View>
              <Text style={{ color: tf.sun, fontWeight: '700' }}>→</Text>
            </Pressable>
            <Pressable
              onPress={() => setReassignPending(null)}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="取消重新指派"
              style={styles.pendingClose}>
              <MaterialIcons name="close" size={18} color={tf.amberInk} />
            </Pressable>
          </View>
        ) : pendingPlace ? (
          <View
            style={[
              styles.pendingBanner,
              styles.preselectHint,
              {
                backgroundColor: isDark ? tf.amber2 : '#F8ECD7',
                borderColor: isDark ? tf.line2 : '#E8CDA2',
              },
            ]}>
            <Pressable
              onPress={() => openPlace(centerYmd, 0)}
              style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0 }}
              accessibilityRole="button"
              accessibilityLabel="打开入格确认">
              <MaterialIcons name="cruelty-free" size={16} color={tf.amberInk} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ color: tf.amberInk, fontWeight: '700', fontSize: 12 }} numberOfLines={1}>
                  已预选「{pendingPlace.title}」· 点此确认时段
                </Text>
              </View>
              <Text style={{ color: tf.sun, fontWeight: '700' }}>→</Text>
            </Pressable>
            <Pressable
              onPress={() => onClearPendingPlace?.()}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="取消放置"
              style={styles.pendingClose}>
              <MaterialIcons name="close" size={18} color={tf.amberInk} />
            </Pressable>
          </View>
        ) : null}

        <Animated.View
          style={{
            opacity: bodyOpacity,
            transform: [
              { translateX: bodyTranslateX },
              { scale: bodyScale },
              { translateY: bodyTranslateY },
            ],
            paddingHorizontal: Spacing['2xl'],
            paddingBottom: Spacing.xl,
            paddingTop: Spacing.md,
          }}>
        {isMinimal ? (
          loading && !view ? (
            <ActivityIndicator color={primary} style={{ marginVertical: Spacing.lg }} />
          ) : (
            <View style={styles.minimalBody}>
              <View
                style={[
                  styles.minimalAllDayWrap,
                  { backgroundColor: surfaceLow, borderColor: gridLineSoft },
                ]}>
                <View style={styles.minimalAllDayHead}>
                  <Text style={[styles.minimalCountdownLabel, { color: outline }]}>全天</Text>
                  {dayEditable(centerYmd, logicalTodayYmd) ? (
                    <Pressable
                      onPress={() => openPlace(centerYmd, 0, { preferAllDay: true })}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel="添加全天安排"
                      style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}>
                      <MaterialIcons name="add" size={16} color={tf.pond} />
                    </Pressable>
                  ) : null}
                </View>
                {minimalAllDayItems.length > 0 ? (
                  <View style={styles.todayAgenda}>
                    {minimalAllDayItems.map((item, index) =>
                      renderCompactRow(item, index, minimalAllDayItems, { dense: true }),
                    )}
                  </View>
                ) : (
                  <Text style={[styles.minimalAllDayEmpty, { color: tf.faint }]}>暂无全天安排</Text>
                )}
              </View>
              <View
                style={[
                  styles.minimalCountdownRow,
                  { backgroundColor: surfaceLow, borderColor: gridLineSoft },
                ]}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[styles.minimalCountdownLabel, { color: outline }]}>
                    {minimalFocus.kind === 'current'
                      ? '当前时段'
                      : minimalFocus.kind === 'break'
                        ? minimalFocus.breakLabel
                        : minimalFocus.kind === 'upcoming'
                          ? '下一时段'
                          : minimalFocus.kind === 'finished'
                            ? '日程'
                            : '今日'}
                  </Text>
                  {minimalFocus.rangeLabel ? (
                    <Text
                      style={[styles.minimalRange, { color: theme.text }]}
                      numberOfLines={1}>
                      {minimalFocus.rangeLabel}
                    </Text>
                  ) : null}
                </View>
                <Text
                  style={[
                    styles.minimalCountdown,
                    {
                      color:
                        minimalFocus.kind === 'current' ||
                        minimalFocus.kind === 'upcoming' ||
                        minimalFocus.kind === 'break'
                          ? primary
                          : outline,
                    },
                  ]}
                  numberOfLines={1}>
                  {minimalFocus.countdownLabel}
                </Text>
              </View>
              {minimalFocus.items.length > 0 ? (
                <View style={styles.todayAgenda}>
                  {minimalFocus.items.map((item, index) =>
                    renderCompactRow(item, index, minimalFocus.items, { dense: true }),
                  )}
                </View>
              ) : minimalFocus.kind === 'empty' || minimalFocus.kind === 'finished' ? (
                minimalAllDayItems.length > 0 ? null : (
                  <Pressable
                    onPress={() => goZoom('day')}
                    style={({ pressed }) => [
                      styles.todayEmpty,
                      styles.todayEmptyCompact,
                      {
                        backgroundColor: surfaceLow,
                        borderColor: gridLineSoft,
                        opacity: pressed ? 0.85 : 1,
                      },
                    ]}>
                    <Text style={[styles.todayEmptyHint, { color: outline }]}>
                      {minimalFocus.kind === 'finished'
                        ? '点开时间线查看今日安排'
                        : '点开时间线添加或查看安排'}
                    </Text>
                  </Pressable>
                )
              ) : null}
            </View>
          )
        ) : null}

        {isDay ? (
          <>
            {periodIndex !== 0 ? (
              <View style={styles.weekNavCompact}>
                <Pressable
                  onPress={() => setPeriodIndex(0)}
                  accessibilityRole="button"
                  accessibilityLabel="回到今天"
                  style={styles.weekTitleHit}>
                  <Text style={[styles.weekSub, { color: primary }]}>
                    {formatDayScheduleLabel(centerYmd)} · 回今天
                  </Text>
                </Pressable>
              </View>
            ) : null}

            {loading && !view ? (
              <ActivityIndicator color={primary} style={{ marginVertical: 24 }} />
            ) : view ? (
              <View style={styles.gridFrame}>{renderScheduleGrid()}</View>
            ) : null}
          </>
        ) : null}
        </Animated.View>
      </View>

      <SchedulePlaceFrogSheet
        visible={!!placeTarget}
        onClose={() => {
          setPlaceTarget(null);
          // 预选模式下关闭格数弹窗不取消 pending，可继续点其它格
        }}
        assignYmd={placeTarget?.assignYmd ?? logicalTodayYmd}
        maxSpan={placeTarget?.maxSpan ?? 1}
        daySlotCount={view ? getSlotCount(view.axis) : placeTarget?.maxSpan ?? 1}
        initialAllDay={!!placeTarget?.preferAllDay}
        lockedProjectIds={lockedProjectIds}
        preselected={
          placeTarget?.rematerializePreselected ?? pendingPlace ?? null
        }
        minuteMode={timelineWrite}
        axis={view?.axis ?? null}
        defaultStartMinutes={
          view && placeTarget
            ? slotStartMinutes(view.axis, placeTarget.startSlotIndex)
            : undefined
        }
        defaultEndMinutes={
          view && placeTarget
            ? slotEndMinutes(view.axis, placeTarget.startSlotIndex)
            : undefined
        }
        onAssignYmdChange={(ymd) => {
          if (!isEditableScheduleDay(ymd, logicalTodayYmd)) return;
          setPeriodIndex(dayOffsetFromToday(ymd, logicalTodayYmd));
          setPlaceTarget((prev) =>
            prev
              ? {
                  ...prev,
                  assignYmd: ymd,
                  weekStartYmd: getWeekStartMondayYmd(ymd),
                  weekday: weekdayFromYmd(ymd),
                }
              : prev,
          );
        }}
        onConfirm={handlePlaceConfirm}
      />

      <FrogScheduleSettingsSheet
        visible={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />

      <Modal
        visible={orphanListOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setOrphanListOpen(false)}>
        <Pressable style={styles.listBackdrop} onPress={() => setOrphanListOpen(false)}>
          <Pressable
            onPress={() => {}}
            style={[
              styles.listCard,
              shadows.card,
              { backgroundColor: theme.surface, borderColor: theme.outline },
            ]}>
            <Text style={[styles.listTitle, { color: theme.text }]}>
              未入格任务（{orphanedPlacements.length}）
            </Text>
            <Text style={{ color: outline, fontSize: 12, lineHeight: 17, marginBottom: Spacing.md }}>
              改轴后无法落入时间格的占用。可重新指派时段，或取消当日指派。
            </Text>
            <ScrollView style={{ maxHeight: 320 }}>
              {orphanedPlacements.length === 0 ? (
                <Text style={{ color: outline, paddingVertical: 16 }}>当前没有未入格任务</Text>
              ) : (
                orphanedPlacements.map((p) => {
                  const assignYmd = ymdForWeekday(p.weekStartYmd, p.weekday);
                  const sub = resolveSubject(p.subjectKind, p.subjectId, subjects, assignYmd);
                  const canEdit = dayEditable(assignYmd, logicalTodayYmd);
                  return (
                    <View
                      key={p.id}
                      style={[
                        styles.listRow,
                        {
                          backgroundColor: surfaceLow,
                          flexDirection: 'column',
                          alignItems: 'stretch',
                          gap: Spacing.sm,
                          paddingVertical: Spacing.lg,
                        },
                      ]}>
                      <Pressable
                        onPress={() => openDetail(p)}
                        style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.md }}>
                        <View
                          style={[
                            styles.listRowRail,
                            { backgroundColor: theme.danger, alignSelf: 'stretch' },
                          ]}
                        />
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text
                            style={{ color: theme.text, fontWeight: '700', fontSize: 14 }}
                            numberOfLines={2}>
                            {sub?.title ?? '青蛙'}
                          </Text>
                          <Text style={{ color: outline, fontSize: 12, marginTop: 2 }}>
                            指派日 {assignYmd}
                            {canEdit ? '' : ' · 只读'}
                          </Text>
                        </View>
                        <MaterialIcons name="chevron-right" size={18} color={outline} />
                      </Pressable>
                      {sub && !sub.deletedSnapshot ? (
                        <View style={styles.orphanActions}>
                          <Pressable
                            onPress={() => startReassignTime(p, sub)}
                            style={({ pressed }) => [
                              styles.orphanActionBtn,
                              {
                                borderColor: `${primary}55`,
                                backgroundColor: todayWash,
                                opacity: pressed ? 0.85 : 1,
                              },
                            ]}>
                            <MaterialIcons name="schedule" size={16} color={primary} />
                            <Text style={{ color: primary, fontWeight: '700', fontSize: 13 }}>
                              {canEdit ? '重新指派' : '指派到今天/未来'}
                            </Text>
                          </Pressable>
                          {canEdit ? (
                            <Pressable
                              onPress={() => {
                                // 先关孤儿列表 Modal，再弹确认，避免与 AppDialogHost Modal 嵌套卡死
                                const placementId = p.id;
                                const subjectKind = p.subjectKind;
                                const subjectId = p.subjectId;
                                const dayYmd = assignYmd;
                                setOrphanListOpen(false);
                                runAfterUiSettles(() => {
                                  Alert.alert(
                                    '取消指派',
                                    `确定取消「${sub.title}」在 ${dayYmd} 的指派吗？`,
                                    [
                                      { text: '保留', style: 'cancel' },
                                      {
                                        text: '取消指派',
                                        style: 'destructive',
                                        onPress: () => {
                                          void (async () => {
                                            try {
                                              await cancelAssignForPlacementDay(
                                                placementId,
                                                logicalTodayYmd,
                                              );
                                              await reload(loadDayYmds, { silent: true });
                                              onChanged?.({
                                                kind: subjectKind,
                                                id: subjectId,
                                                assignYmd: dayYmd,
                                                action: 'unassign',
                                              });
                                            } catch (err) {
                                              toast.error(
                                                toUserMessage(err, '取消失败，请稍后重试'),
                                              );
                                            }
                                          })();
                                        },
                                      },
                                    ],
                                  );
                                });
                              }}
                              style={({ pressed }) => [
                                styles.orphanActionBtn,
                                {
                                  borderColor: `${outline}55`,
                                  backgroundColor: theme.surface,
                                  opacity: pressed ? 0.85 : 1,
                                },
                              ]}>
                              <MaterialIcons name="link-off" size={16} color={outline} />
                              <Text style={{ color: theme.text, fontWeight: '600', fontSize: 13 }}>
                                取消指派
                              </Text>
                            </Pressable>
                          ) : null}
                        </View>
                      ) : null}
                    </View>
                  );
                })
              )}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={quotaDetailBucket != null}
        transparent
        animationType="fade"
        onRequestClose={() => setQuotaDetailBucket(null)}>
        <Pressable style={styles.listBackdrop} onPress={() => setQuotaDetailBucket(null)}>
          <Pressable
            onPress={() => {}}
            style={[
              styles.listCard,
              shadows.card,
              { backgroundColor: theme.surface, borderColor: theme.outline },
            ]}>
            <Text style={[styles.listTitle, { color: theme.text }]}>
              {quotaDetailStat
                ? `${quotaDetailStat.shortLabel} · ${quotaDetailStat.label}`
                : '已指派'}
            </Text>
            <Text style={{ color: outline, fontSize: 12, lineHeight: 17, marginBottom: Spacing.md }}>
              {formatDayScheduleLabel(centerYmd)} · 已指派{' '}
              {quotaDetailStat?.used ?? 0}/{quotaDetailStat?.max ?? 0}
              {quotaDetailStat != null
                ? ` · 剩余 ${quotaDetailStat.remaining}`
                : ''}
              {quotaDetailStat != null && quotaDetailStat.remaining <= 0
                ? ' · 已满，无法再指派同优先级'
                : ''}
            </Text>
            <ScrollView style={{ maxHeight: 360 }}>
              {quotaDetailItems.length === 0 ? (
                <Text style={{ color: outline, paddingVertical: 16 }}>该优先级今日暂无指派</Text>
              ) : (
                quotaDetailItems.map((item) => {
                  const kindLabel = item.kind === 'project'
                    ? '项目'
                    : item.isStandaloneTodo
                      ? '独立待办'
                      : '任务';
                  return (
                    <Pressable
                      key={`${item.kind}:${item.id}`}
                      onPress={() => {
                        setQuotaDetailBucket(null);
                        runAfterUiSettles(() => {
                          onOpenSubject?.(item.kind, item.id);
                        }, MODAL_HANDOFF_MS);
                      }}
                      style={({ pressed }) => [
                        styles.listRow,
                        {
                          backgroundColor: surfaceLow,
                          opacity: pressed ? 0.88 : 1,
                        },
                      ]}>
                      <View
                        style={[
                          styles.listRowRail,
                          { backgroundColor: item.done ? tf.sage : tf.frog },
                        ]}
                      />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text
                          style={{
                            color: theme.text,
                            fontWeight: '700',
                            fontSize: 14,
                            textDecorationLine: item.done ? 'line-through' : 'none',
                            opacity: item.done ? 0.65 : 1,
                          }}
                          numberOfLines={2}>
                          {item.title}
                        </Text>
                        <Text style={{ color: outline, fontSize: 11, marginTop: 2 }} numberOfLines={1}>
                          {kindLabel}
                          {item.projectName ? ` · ${item.projectName}` : ''}
                          {item.done ? ' · 已完成' : ''}
                        </Text>
                      </View>
                      <MaterialIcons name="chevron-right" size={18} color={outline} />
                    </Pressable>
                  );
                })
              )}
            </ScrollView>
            <Pressable
              onPress={() => setQuotaDetailBucket(null)}
              style={({ pressed }) => [
                styles.quotaDetailClose,
                {
                  backgroundColor: isDark ? tf.paper3 : '#F4EFE2',
                  opacity: pressed ? 0.85 : 1,
                },
              ]}>
              <Text style={{ color: tf.ink2, fontWeight: '700', fontSize: 13 }}>关闭</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <SchedulePlacementDetailSheet
        visible={!!detail}
        onClose={() => setDetail(null)}
        placement={detail?.placement ?? null}
        virtualSlot={detail?.virtualSlot ?? null}
        surface={detail?.surface ?? 'frog'}
        axis={view?.axis ?? { startMinutes: 480, endMinutes: 1320, slotHours: 2, breaks: [] }}
        subject={detail?.subject ?? null}
        editable={
          !!detail &&
          dayEditable(
            detail.virtualSlot?.assignYmd ??
              (detail.placement
                ? ymdForWeekday(detail.placement.weekStartYmd, detail.placement.weekday)
                : logicalTodayYmd),
            logicalTodayYmd,
          )
        }
        onToggleDone={() => {
          if (!detail) return;
          // 先关详情 Modal，再切换完成态，避免 Android Modal 卸掉时 LayoutAnimation 卡死触摸
          const snapshot = detail;
          setDetail(null);
          runAfterUiSettles(() => {
            if (snapshot.surface === 'habit' && snapshot.habitId) {
              if (snapshot.subject.done) onHabitUndo?.(snapshot.habitId);
              else onHabitCheckIn?.(snapshot.habitId);
              return;
            }
            if (!onToggleDone) return;
            const assignYmd =
              snapshot.virtualSlot?.assignYmd ??
              (snapshot.placement
                ? ymdForWeekday(snapshot.placement.weekStartYmd, snapshot.placement.weekday)
                : logicalTodayYmd);
            onToggleDone({
              kind: snapshot.placement?.subjectKind ?? snapshot.subject.kind,
              id: snapshot.placement?.subjectId ?? snapshot.subject.id,
              assignYmd,
            });
          });
        }}
        onRemoveSegment={
          detail?.placement
            ? () => {
                // Sheet 内已关 Modal；延后写库，与 onToggleDone 同口径
                const placementId = detail.placement!.id;
                setDetail(null);
                runAfterUiSettles(() => {
                  void (async () => {
                    try {
                      await removePlacementSegment(placementId, logicalTodayYmd);
                      await reload(loadDayYmds, { silent: true });
                      onChanged?.();
                    } catch (err) {
                      toast.error(toUserMessage(err, '移除失败，请稍后重试'));
                    }
                  })();
                });
              }
            : undefined
        }
        onCancelAssign={
          detail?.placement
            ? () => {
                const p = detail.placement!;
                const assignYmd = ymdForWeekday(p.weekStartYmd, p.weekday);
                setDetail(null);
                runAfterUiSettles(() => {
                  void (async () => {
                    try {
                      await cancelAssignForPlacementDay(p.id, logicalTodayYmd);
                      await reload(loadDayYmds, { silent: true });
                      onChanged?.({
                        kind: p.subjectKind,
                        id: p.subjectId,
                        assignYmd,
                        action: 'unassign',
                      });
                    } catch (err) {
                      toast.error(toUserMessage(err, '取消失败，请稍后重试'));
                    }
                  })();
                });
              }
            : undefined
        }
        onReassignTime={
          detail?.placement
            ? () => startReassignTime(detail.placement!, detail.subject)
            : undefined
        }
        onEdit={
          detail?.surface === 'habit'
            ? undefined
            : detail
              ? () => {
                  const kind = detail.placement?.subjectKind ?? detail.subject.kind;
                  const id = detail.placement?.subjectId ?? detail.subject.id;
                  onOpenSubject?.(kind, id);
                  setDetail(null);
                }
              : undefined
        }
      />

    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: Spacing.xs },
  summaryCard: {
    borderRadius: Radius['2xl'],
    paddingHorizontal: Spacing['2xl'],
    paddingVertical: Spacing.xl,
    borderWidth: StyleSheet.hairlineWidth,
  },
  scHead: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  scHeadTitle: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.1,
  },
  scHeadCnt: {
    fontSize: 11,
    fontWeight: '600',
  },
  quotaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  quotaChip: {
    flex: 1,
    minWidth: 0,
    borderRadius: 8,
    paddingHorizontal: 5,
    paddingVertical: 4,
    alignItems: 'center',
    gap: 1,
  },
  quotaChipLabel: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  quotaChipValue: {
    fontSize: 11,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  quotaChipRemain: {
    fontSize: 9,
    fontWeight: '600',
  },
  quotaDetailClose: {
    marginTop: Spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 10,
  },
  zseg: {
    marginLeft: 'auto',
    flexDirection: 'row',
    height: 28,
    padding: 2,
    borderRadius: 8,
    gap: 1,
  },
  zsegBtn: {
    paddingHorizontal: 8,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copyBtn: {
    width: 26,
    height: 26,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  pendingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.lg,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.lg,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: Spacing.lg,
  },
  preselectHint: {
    marginHorizontal: Spacing['2xl'],
    marginTop: 8,
    marginBottom: 6,
    minHeight: 32,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    gap: 6,
  },
  pendingIconWrap: {
    width: 32,
    height: 32,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pendingClose: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  todayEmpty: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.md,
    paddingVertical: Spacing['4xl'],
    paddingHorizontal: Spacing.xl,
    alignItems: 'center',
    gap: Spacing.sm,
  },
  todayEmptyHint: {
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 16,
  },
  todayEmptyCompact: {
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing.md,
  },
  minimalBody: {
    gap: Spacing.md,
  },
  minimalAllDayWrap: {
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.sm,
    gap: Spacing.xs,
  },
  minimalAllDayHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 22,
  },
  minimalAllDayEmpty: {
    fontSize: 12,
    fontWeight: '600',
    paddingVertical: 4,
  },
  minimalCountdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  minimalCountdownLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  minimalRange: {
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: -0.3,
    fontVariant: ['tabular-nums'],
    marginTop: 2,
  },
  minimalCountdown: {
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: -0.2,
    fontVariant: ['tabular-nums'],
    flexShrink: 0,
  },
  todayAgenda: {
    overflow: 'hidden',
    borderRadius: Radius.sm,
  },
  todayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing.xs,
    minHeight: Layout.minTouchTarget,
  },
  todayRowDense: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xs,
    minHeight: 44,
  },
  todayTimeCol: {
    width: 44,
    alignItems: 'flex-end',
  },
  todayTimeStart: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: -0.2,
    fontVariant: ['tabular-nums'],
  },
  todayTimeEnd: {
    fontSize: 11,
    fontWeight: '600',
    marginTop: 1,
    fontVariant: ['tabular-nums'],
  },
  todayRail: {
    width: 3,
    alignSelf: 'stretch',
    borderRadius: 2,
    minHeight: 28,
  },
  todayRailActive: {
    width: 4,
  },
  todayRowBody: {
    flex: 1,
    minWidth: 0,
  },
  todayRowTitle: {
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 19,
    letterSpacing: -0.2,
  },
  todayRowTitleActive: {
    fontWeight: '800',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.md,
    gap: Spacing.md,
  },
  headerRowPressable: {
    marginBottom: 0,
    minHeight: Layout.minTouchTarget,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    flexShrink: 1,
    minWidth: 0,
  },
  titleIconWrap: {
    width: 32,
    height: 32,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleTextCol: {
    flexShrink: 1,
    minWidth: 0,
    gap: 1,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    flexShrink: 0,
  },
  summaryMeta: {
    fontSize: 12,
    fontWeight: '600',
    flexShrink: 1,
  },
  orphanChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.pill,
  },
  iconActionBtn: {
    width: 32,
    height: 32,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  expandChevron: {
    width: 32,
    height: 32,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekNavCompact: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
    paddingHorizontal: 2,
  },
  weekTitleHit: { alignItems: 'center', gap: 2, flex: 1 },
  weekSub: { fontSize: 11, fontWeight: '600' },
  gridFrame: {
    overflow: 'hidden',
  },
  scFoot: {
    height: 26,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  scFootRing: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2.5,
  },
  scFootText: {
    flex: 1,
    fontSize: 10,
    fontWeight: '500',
  },
  gridWrap: { flexDirection: 'row' },
  gridHeaderChrome: {
    zIndex: 2,
  },
  dayHeader: {
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: 3,
  },
  dayHeaderLabel: {
    fontSize: 10,
    letterSpacing: 0.3,
    fontVariant: ['tabular-nums'],
  },
  dlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    minHeight: 41,
  },
  dlTime: {
    width: 36,
    alignItems: 'flex-end',
    paddingTop: 2,
  },
  dlTimeStart: {
    fontSize: 11,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  dlTimeDur: {
    fontSize: 9,
    fontWeight: '500',
    marginTop: 1,
    fontVariant: ['tabular-nums'],
  },
  dlBlock: {
    flex: 1,
    borderRadius: 9,
    borderWidth: 1,
    paddingVertical: 6,
    paddingHorizontal: 8,
    paddingRight: 22,
    minHeight: 36,
    justifyContent: 'center',
    position: 'relative',
    overflow: 'hidden',
  },
  dlBlockDense: {
    minHeight: 30,
    paddingVertical: 4,
  },
  dlBlockTitle: {
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 17,
  },
  dlBlockMeta: {
    fontSize: 10,
    fontWeight: '500',
    marginTop: 2,
  },
  dlBlockCk: {
    position: 'absolute',
    right: 6,
    top: 6,
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 1,
  },
  listBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.45)',
    justifyContent: 'center',
    padding: Spacing['6xl'],
  },
  listCard: {
    borderRadius: Radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing['2xl'],
    gap: Spacing.lg,
  },
  listTitle: { fontSize: 16, fontWeight: '800', letterSpacing: -0.2 },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.xl,
    borderRadius: Radius.sm,
    marginBottom: Spacing.sm,
    overflow: 'hidden',
  },
  listRowRail: {
    width: 3,
    alignSelf: 'stretch',
    borderRadius: 2,
    minHeight: 20,
  },
  orphanActions: {
    flexDirection: 'row',
    gap: Spacing.sm,
    paddingLeft: Spacing.md + 3,
  },
  orphanActionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.sm,
    paddingVertical: Spacing.md,
  },
});
