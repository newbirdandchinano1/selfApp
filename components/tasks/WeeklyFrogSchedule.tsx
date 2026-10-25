import { FoldRiseIn, FOLD_MOTION_EASE, useFoldMotionGate } from '@/components/review/fold-motion';
import { Layout, Radius, Spacing } from '@/constants/design-tokens';
import {
  TaskFoldMotion,
  taskFoldFonts,
  useTaskFoldTheme,
} from '@/constants/task-fold-theme';
import { useAppTheme } from '@/hooks/use-app-theme';
import { useReducedMotionState } from '@/hooks/use-reduced-motion';
import { toast, toUserMessage, Alert } from '@/lib/app-feedback';
import { isFrogDoneForToday } from '@/lib/long-term-task';
import { isFrogSubjectDeleted } from '@/lib/repositories/tasks/frog-completion-events';
import type { ProjectRow } from '@/lib/repositories/projects/project.types';
import type { TaskRow } from '@/lib/repositories/tasks/task.types';
import {
  buildScheduleTimeline,
  computeScheduleSlotLayout,
  formatMinuteRangeLabel,
  formatMinutesAsHm,
  getSlotCount,
  listWorkSlots,
  maxSpanFromSlot,
  placementEndMinutes,
  SCHEDULE_BASE_SLOT_H,
  slotStartMinutes,
  wallClockToAxisMinutes,
} from '@/lib/schedule/axis';
import {
  buildVirtualHabitPlacementsForDays,
  type VirtualHabitPlacement,
} from '@/lib/schedule/habit-virtual-placement';
import {
  buildVirtualTaskPlacementsForDays,
  type VirtualTaskPlacement,
} from '@/lib/schedule/task-virtual-placement';
import { getHabits } from '@/lib/repositories/habits/habit';
import { getAllHabitCheckInsMaps } from '@/lib/repositories/habits/habit-check-in';
import { hasActiveSubHabits } from '@/lib/repositories/habits/habit-sub';
import { isStandaloneTodoTask } from '@/lib/standalone-todo-task';
import {
  centerYmdForPeriod,
  formatThreeDayRangeLabel,
  getWeekStartMondayYmd,
  isEditableScheduleDay,
  isEditableWeek,
  threeDayWindow,
  WEEKDAY_SHORT_LABELS,
  weekdayFromYmd,
  ymdForWeekday,
} from '@/lib/schedule/week';
import {
  formatLocalYmdFromDate,
  getLogicalLocalYmd,
  logicalYmdToLocalDate,
  loadTasksDayBoundary,
  type TasksDayBoundary,
} from '@/lib/tasks-logical-day';
import type { SchedulePlacementRow } from '@/lib/schedule/types';
import {
  cancelAssignForPlacementDay,
  copyPreviousWeekToThisWeek,
  loadScheduleForDayWindow,
  placeFrogOnSchedule,
  rematerializeOrphanedPlacement,
  removePlacementSegment,
  type WeekScheduleView,
} from '@/lib/schedule-service';
import { subscribeFrogScheduleChanged } from '@/lib/schedule-events';
import { subscribeSyncDirty } from '@/lib/sync-pull';
import { MaterialIcons } from '@expo/vector-icons';
import React from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import {
  SchedulePlaceFrogSheet,
  type SchedulePlacePreselected,
  type SchedulePlaceResult,
} from '@/components/tasks/SchedulePlaceFrogSheet';
import { ScheduleCellTitleRotator } from '@/components/tasks/ScheduleCellTitleRotator';
import { FrogScheduleSettingsSheet } from '@/components/tasks/FrogScheduleSettingsSheet';
import {
  SchedulePlacementDetailSheet,
  type ScheduleDetailSurface,
  type ScheduleSubjectInfo,
  type ScheduleVirtualSlot,
  buildAcceptance,
} from '@/components/tasks/SchedulePlacementDetailSheet';
import {
  getSlotNote,
  loadScheduleSlotNotes,
  normalizeSlotNote,
  saveScheduleSlotNote,
  SCHEDULE_SLOT_NOTE_IME_SOFT_MAX,
  SCHEDULE_SLOT_NOTE_MAX_LEN,
  type ScheduleSlotNotesMap,
} from '@/lib/schedule/slot-notes';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** 日程表缩放：最简（当前时段）→ 今日列表 → 三天课表 */
export type ScheduleZoomMode = 'minimal' | 'agenda' | 'grid';

type TodayCompactItem = {
  /** 青蛙占用；习惯/自动入格待办虚拟块时为空 */
  placement: SchedulePlacementRow | null;
  habit: VirtualHabitPlacement | null;
  virtualTask: VirtualTaskPlacement | null;
  /** 预选入格时插入的空档（点此放入） */
  emptySlotIndex: number | null;
  title: string;
  done: boolean;
  timeLabel: string;
  endLabel: string;
  startMins: number;
  endMins: number;
};

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
/** 横向分页：左=上一周期 / 中=当前 / 右=下一周期 */
const MIDDLE_PAGE = 1;

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
  /** 从项目列表长按预选：展开课表并点空格入格 */
  pendingPlace?: SchedulePendingPlace | null;
  onClearPendingPlace?: () => void;
  onChanged?: (detail?: ScheduleChangedDetail) => void;
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
  /** 周条点选：跳到以该日为中心的三天窗并切到课表 */
  jumpToYmd?: string | null;
  onJumpToYmdConsumed?: () => void;
};

type CellKey = string; // `${ymd}-${slot}`

function cellKey(ymd: string, slot: number): CellKey {
  return `${ymd}-${slot}`;
}

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

/** 同一格内多占用：未完成优先的第一只；count = 未完成主体数（角标口径） */
function pickDisplayPlacement(
  list: SchedulePlacementRow[],
  lookup: SubjectLookup,
  assignYmd: string,
): { primary: SchedulePlacementRow; count: number; done: boolean; title: string } | null {
  if (list.length === 0) return null;
  const enriched = list.map((p) => {
    const sub = resolveSubject(p.subjectKind, p.subjectId, lookup, assignYmd);
    return { p, sub, done: !!sub?.done };
  });
  enriched.sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    return (b.sub?.priority ?? 0) - (a.sub?.priority ?? 0);
  });
  const first = enriched[0]!;
  const unfinishedCount = enriched.filter((x) => !x.done).length;
  return {
    primary: first.p,
    count: unfinishedCount,
    done: first.done,
    title: first.sub?.title ?? '青蛙',
  };
}

/** 格子角标：按主体去重后统计未完成数量 */
function countUnfinishedInCell(
  list: SchedulePlacementRow[],
  lookup: SubjectLookup,
  assignYmd: string,
): number {
  const unique = uniquePlacementsBySubject(list);
  let n = 0;
  for (const p of unique) {
    const sub = resolveSubject(p.subjectKind, p.subjectId, lookup, assignYmd);
    if (sub && !sub.done) n += 1;
  }
  return n;
}

/** 同一格未完成标题（主体去重，优先级高优先；供色块标题轮换） */
function listUnfinishedTitlesInCell(
  list: SchedulePlacementRow[],
  lookup: SubjectLookup,
  assignYmd: string,
): string[] {
  const unique = uniquePlacementsBySubject(list);
  const enriched = unique.map((p) => {
    const sub = resolveSubject(p.subjectKind, p.subjectId, lookup, assignYmd);
    return {
      title: (sub?.title ?? '').trim() || '青蛙',
      done: !!sub?.done,
      priority: sub?.priority ?? 0,
    };
  });
  return enriched
    .filter((x) => !x.done)
    .sort((a, b) => b.priority - a.priority)
    .map((x) => x.title);
}

/** 同一格按主体去重（跨段占用同一青蛙只算一只） */
function uniquePlacementsBySubject(list: SchedulePlacementRow[]): SchedulePlacementRow[] {
  return [...new Map(list.map((p) => [`${p.subjectKind}:${p.subjectId}`, p])).values()];
}

/** Alert / Modal 关闭后再改状态，避免 Android 触摸层与 LayoutAnimation 抢焦点卡死 */
function runAfterUiSettles(action: () => void) {
  requestIdleCallback(() => {
    // 再等一帧，让原生 Dialog / Modal dismiss 动画真正卸掉
    requestAnimationFrame(() => {
      action();
    });
  });
}

function dayEditable(ymd: string, logicalTodayYmd: string): boolean {
  return isEditableScheduleDay(ymd, logicalTodayYmd);
}

  /**
   * 对齐设计稿 `.blk`：
   * habit 浅绿虚线 · todo 琥珀黄 · proj 浅灰绿 · frog 深绿（#35604A，比旧 #2A4C3C 更轻）
   */
  type ScheduleBlockKind = 'frog' | 'habit' | 'todo' | 'proj';

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

/** 预选空档：2s 琥珀呼吸轮廓（preselGlow） */
function PreselGlowOutline({
  active,
  color,
  reduceMotion,
}: {
  active: boolean;
  color: string;
  reduceMotion: boolean;
}) {
  const glow = React.useRef(new Animated.Value(0.55)).current;
  React.useEffect(() => {
    if (!active || reduceMotion) {
      glow.stopAnimation();
      glow.setValue(1);
      return;
    }
    glow.setValue(0.45);
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, {
          toValue: 1,
          duration: TaskFoldMotion.preselGlow / 2,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(glow, {
          toValue: 0.45,
          duration: TaskFoldMotion.preselGlow / 2,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => {
      loop.stop();
      glow.stopAnimation();
    };
  }, [active, glow, reduceMotion]);
  if (!active) return null;
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        {
          margin: 1,
          borderRadius: Radius.xs,
          borderWidth: 1.5,
          borderStyle: 'dashed',
          borderColor: color,
          opacity: glow,
        },
      ]}
    />
  );
}

export function WeeklyFrogSchedule({
  logicalTodayYmd,
  now,
  sectionCardStyle,
  lockedProjectIds,
  subjects,
  pendingPlace = null,
  onClearPendingPlace,
  onChanged,
  onOpenSubject,
  onToggleDone,
  onHabitCheckIn,
  onHabitUndo,
  jumpToYmd = null,
  onJumpToYmdConsumed,
}: Props) {
  const { colors: theme, isDark, shadows } = useAppTheme();
  const { tf, fonts: foldFonts } = useTaskFoldTheme();
  const { animate: foldAnimate } = useFoldMotionGate();
  const primary = tf.pond;
  const outline = tf.muted;
  const surfaceLow = isDark ? tf.paper2 : tf.paper3;
  const gridLineSoft = tf.line;
  const todayWash = isDark ? tf.lily2 : 'rgba(232,239,217,0.55)';
  const todayWashStrong = isDark ? 'rgba(201,217,163,0.28)' : 'rgba(111,149,98,0.22)';
  const successTint = tf.frog;
  const sunAmber = tf.sun;

  /** 0 = 今天居中的三天；±1 切换一整周期（平移 3 天） */
  const [periodIndex, setPeriodIndex] = React.useState(0);
  /** 周条点选：以该日为中心，直到用户再翻周期 */
  const [centerOverride, setCenterOverride] = React.useState<string | null>(null);
  /** 课表块 FoldRiseIn 错峰序号（每次绘网格重置） */
  const bloomBlockIndex = React.useRef(0);
  const centerYmd = React.useMemo(
    () => centerOverride ?? centerYmdForPeriod(logicalTodayYmd, periodIndex),
    [centerOverride, logicalTodayYmd, periodIndex],
  );
  const dayYmds = React.useMemo(() => threeDayWindow(centerYmd), [centerYmd]);
  /** 预加载左右周期，滑动时邻页也有数据；周条跳转日一并纳入 */
  const loadDayYmds = React.useMemo(() => {
    const set = new Set<string>();
    for (const p of [periodIndex - 1, periodIndex, periodIndex + 1]) {
      for (const d of threeDayWindow(centerYmdForPeriod(logicalTodayYmd, p))) {
        set.add(d);
      }
    }
    if (centerOverride) {
      for (const d of threeDayWindow(centerOverride)) set.add(d);
    }
    return [...set].sort();
  }, [logicalTodayYmd, periodIndex, centerOverride]);
  const thisMonday = React.useMemo(
    () => getWeekStartMondayYmd(logicalTodayYmd),
    [logicalTodayYmd],
  );

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
  const [gridWidth, setGridWidth] = React.useState(0);
  const hPagerRef = React.useRef<React.ComponentRef<typeof ScrollView>>(null);
  const headerPagerRef = React.useRef<React.ComponentRef<typeof ScrollView>>(null);
  const pagingLock = React.useRef(false);

  const [placeTarget, setPlaceTarget] = React.useState<{
    weekStartYmd: string;
    weekday: number;
    startSlotIndex: number;
    assignYmd: string;
    maxSpan: number;
    /** 未入格重新落入 */
    rematerializePlacementId?: string;
    rematerializePreselected?: SchedulePlacePreselected;
  } | null>(null);

  const [cellList, setCellList] = React.useState<{
    assignYmd: string;
    slotIndex: number;
    placements: SchedulePlacementRow[];
    habits: VirtualHabitPlacement[];
    virtualTasks: VirtualTaskPlacement[];
    editable: boolean;
  } | null>(null);

  const [orphanListOpen, setOrphanListOpen] = React.useState(false);

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
  /** 首页默认最简：当前时段 + 倒计时；可展开今日列表 / 三天课表 */
  const [zoomMode, setZoomMode] = React.useState<ScheduleZoomMode>('minimal');
  const zoomModeRef = React.useRef(zoomMode);
  zoomModeRef.current = zoomMode;
  const isGrid = zoomMode === 'grid';
  const isAgenda = zoomMode === 'agenda';
  const isMinimal = zoomMode === 'minimal';
  const zoomBusyRef = React.useRef(false);
  const bodyOpacity = React.useRef(new Animated.Value(1)).current;
  const bodyScale = React.useRef(new Animated.Value(1)).current;
  const bodyTranslateY = React.useRef(new Animated.Value(0)).current;
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
  const [slotNotes, setSlotNotes] = React.useState<ScheduleSlotNotesMap>({});
  const [slotNoteEditor, setSlotNoteEditor] = React.useState<{
    startMinutes: number;
    draft: string;
  } | null>(null);
  const [slotNoteSaving, setSlotNoteSaving] = React.useState(false);
  const [slotNoteKeyboardH, setSlotNoteKeyboardH] = React.useState(0);
  const insets = useSafeAreaInsets();

  React.useEffect(() => {
    let cancelled = false;
    void loadScheduleSlotNotes().then((notes) => {
      if (!cancelled) setSlotNotes(notes);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    if (!slotNoteEditor) {
      setSlotNoteKeyboardH(0);
      return;
    }
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const onShow = (e: { endCoordinates?: { height?: number } }) => {
      setSlotNoteKeyboardH(Math.max(0, Math.round(e.endCoordinates?.height ?? 0)));
    };
    const onHide = () => setSlotNoteKeyboardH(0);
    const subShow = Keyboard.addListener(showEvent, onShow);
    const subHide = Keyboard.addListener(hideEvent, onHide);
    return () => {
      subShow.remove();
      subHide.remove();
    };
  }, [slotNoteEditor]);

  const goZoom = React.useCallback(
    (next: ScheduleZoomMode) => {
      const prev = zoomModeRef.current;
      if (prev === next || zoomBusyRef.current) return;
      zoomBusyRef.current = true;

      const snapZoom = () => {
        bodyOpacity.stopAnimation();
        bodyScale.stopAnimation();
        bodyTranslateY.stopAnimation();
        bodyOpacity.setValue(1);
        bodyScale.setValue(1);
        bodyTranslateY.setValue(0);
        setZoomMode(next);
        zoomBusyRef.current = false;
      };

      if (!motionReady || reduceMotion) {
        snapZoom();
        return;
      }

      const enteringGrid = next === 'grid';
      const leavingGrid = prev === 'grid';
      const expanding = prev === 'minimal' && next === 'agenda';
      const collapsing = (prev === 'agenda' && next === 'minimal') || leavingGrid;

      // 退场：淡出 + 按方向位移/缩放
      const exitScale = enteringGrid ? 0.94 : leavingGrid ? 1.06 : 1;
      const exitTY = expanding ? -14 : collapsing && !leavingGrid ? 14 : leavingGrid ? 10 : 0;

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

        const enterFromScale = enteringGrid ? 0.86 : leavingGrid ? 1.1 : 1;
        const enterFromTY = expanding
          ? -22
          : collapsing && !leavingGrid
            ? 22
            : enteringGrid
              ? 16
              : leavingGrid
                ? -12
                : 0;
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
    [bodyOpacity, bodyScale, bodyTranslateY, motionReady, reduceMotion],
  );

  /** 长按项目指派：自动展开课表并提示点选空格 */
  React.useEffect(() => {
    if (!pendingPlace) return;
    goZoom('grid');
    setCenterOverride(null);
    setPeriodIndex(0);
  }, [pendingPlace, goZoom]);

  /** 周条点选：以该日为中心打开三天课表 */
  React.useEffect(() => {
    if (!jumpToYmd) return;
    setCenterOverride(jumpToYmd);
    goZoom('grid');
    onJumpToYmdConsumed?.();
  }, [jumpToYmd, goZoom, onJumpToYmdConsumed]);

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
        setVirtualTasks(
          buildVirtualTaskPlacementsForDays({
            tasks: subjectsRef.current.tasks,
            dayYmds: days,
            logicalTodayYmd,
            axis: data.axis,
            dayBoundary: boundary,
            placements: data.placements,
          }),
        );
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

  // 任务列表变更（完成/编辑自动入格）时重算虚拟待办，不必整表 reload
  React.useEffect(() => {
    if (!view) return;
    let cancelled = false;
    void loadTasksDayBoundary().then((boundary) => {
      if (cancelled) return;
      setVirtualTasks(
        buildVirtualTaskPlacementsForDays({
          tasks: subjects.tasks,
          dayYmds: loadDayYmdsRef.current,
          logicalTodayYmd,
          axis: view.axis,
          dayBoundary: boundary,
          placements: view.placements,
        }),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [subjects.tasks, view, logicalTodayYmd]);

  // 任意本地课表变更（含设置弹窗改轴）立即静默重载
  React.useEffect(() => {
    return subscribeFrogScheduleChanged(() => {
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

  const layout = React.useMemo(
    () => (view ? computeScheduleSlotLayout(view.axis) : null),
    [view],
  );
  const slotCount = layout?.slotCount ?? 0;
  const timeline = layout?.timeline ?? [];
  /** 有备注的工作行抬高，避免虚线备注块被压扁 */
  const rowHeights = React.useMemo(() => {
    if (!layout) return [] as number[];
    return layout.timeline.map((row, i) => {
      const base = layout.rowHeights[i] ?? SCHEDULE_BASE_SLOT_H;
      if (row.kind !== 'work') return base;
      const note = getSlotNote(slotNotes, row.startMinutes);
      if (!note) return base;
      return Math.max(base, 36);
    });
  }, [layout, slotNotes]);
  const totalBodyH = React.useMemo(
    () => (rowHeights.length ? rowHeights.reduce((a, b) => a + b, 0) : layout?.totalBodyH ?? 52),
    [rowHeights, layout],
  );
  /** 外框高度对齐设计稿 `.tt` 表体；内容更高时内滚 */
  const fixedBodyH = layout?.fixedBodyH ?? 52;
  const bodyScrollable = totalBodyH > fixedBodyH + 1;
  const axisKey = view
    ? `${view.axis.startMinutes}-${view.axis.endMinutes}-${view.axis.slotHours}-${JSON.stringify(view.axis.breaks ?? [])}`
    : 'none';

  const colWidth = gridWidth > 0 ? gridWidth / 3 : 100;
  const pageWidth = gridWidth > 0 ? gridWidth : 300;

  const onGridLayout = React.useCallback((e: LayoutChangeEvent) => {
    const w = Math.floor(e.nativeEvent.layout.width);
    if (w > 0 && w !== gridWidth) setGridWidth(w);
  }, [gridWidth]);

  const snapPagerToMiddle = React.useCallback(
    (animated: boolean) => {
      if (pageWidth <= 0) return;
      const x = pageWidth * MIDDLE_PAGE;
      requestAnimationFrame(() => {
        hPagerRef.current?.scrollTo({ x, animated });
        headerPagerRef.current?.scrollTo({ x, animated });
      });
    },
    [pageWidth],
  );

  React.useEffect(() => {
    if (!isGrid || gridWidth <= 0) return;
    snapPagerToMiddle(false);
  }, [isGrid, gridWidth, periodIndex, axisKey, snapPagerToMiddle]);

  const placementsByCell = React.useMemo(() => {
    const map = new Map<CellKey, SchedulePlacementRow[]>();
    if (!view) return map;
    for (const p of view.placements) {
      if (p.orphaned || p.startSlotIndex == null) continue;
      const ymd = ymdForWeekday(p.weekStartYmd, p.weekday);
      for (let i = 0; i < p.spanSlots; i++) {
        const key = cellKey(ymd, p.startSlotIndex + i);
        const list = map.get(key) ?? [];
        list.push(p);
        map.set(key, list);
      }
    }
    return map;
  }, [view]);

  const habitsByCell = React.useMemo(() => {
    const map = new Map<CellKey, VirtualHabitPlacement[]>();
    for (const h of virtualHabits) {
      const key = cellKey(h.assignYmd, h.startSlotIndex);
      const list = map.get(key) ?? [];
      list.push(h);
      map.set(key, list);
    }
    return map;
  }, [virtualHabits]);

  const virtualTasksByCell = React.useMemo(() => {
    const map = new Map<CellKey, VirtualTaskPlacement[]>();
    for (const t of virtualTasks) {
      const key = cellKey(t.assignYmd, t.startSlotIndex);
      const list = map.get(key) ?? [];
      list.push(t);
      map.set(key, list);
    }
    return map;
  }, [virtualTasks]);

  // 指派/打卡后 virtualHabits、virtualTasks、placements 会变：同步已打开的「本格内容」列表里的完成态
  React.useEffect(() => {
    setCellList((prev) => {
      if (!prev) return prev;
      const key = cellKey(prev.assignYmd, prev.slotIndex);
      const habits = habitsByCell.get(key) ?? [];
      const vTasks = virtualTasksByCell.get(key) ?? [];
      const covering = placementsByCell.get(key) ?? [];
      return {
        ...prev,
        habits: [...habits],
        virtualTasks: [...vTasks],
        placements: uniquePlacementsBySubject(covering),
      };
    });
  }, [habitsByCell, virtualTasksByCell, placementsByCell]);

  const nowLineTop = React.useMemo(() => {
    if (!view || !layout || !dayYmds.includes(logicalTodayYmd)) return null;
    const mins = axisNowMins;
    if (mins == null || mins < view.axis.startMinutes || mins > view.axis.endMinutes) {
      return null;
    }
    let top = 0;
    for (let i = 0; i < layout.timeline.length; i++) {
      const row = layout.timeline[i]!;
      const h = rowHeights[i] ?? layout.rowHeights[i] ?? 0;
      if (mins < row.endMinutes) {
        const frac =
          row.endMinutes > row.startMinutes
            ? (mins - row.startMinutes) / (row.endMinutes - row.startMinutes)
            : 0;
        return top + Math.max(0, Math.min(1, frac)) * h;
      }
      top += h;
    }
    return top;
  }, [view, layout, rowHeights, dayYmds, logicalTodayYmd, axisNowMins]);

  const goPeriod = (delta: number) => {
    setCenterOverride(null);
    setPeriodIndex((i) => i + delta);
  };

  const onPagerScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (pagingLock.current || pageWidth <= 0) return;
    const x = e.nativeEvent.contentOffset.x;
    const page = Math.round(x / pageWidth);
    if (page === MIDDLE_PAGE) {
      headerPagerRef.current?.scrollTo({ x: pageWidth * MIDDLE_PAGE, animated: false });
      return;
    }
    pagingLock.current = true;
    const delta = page < MIDDLE_PAGE ? -1 : 1;
    setCenterOverride(null);
    setPeriodIndex((i) => i + delta);
    const midX = pageWidth * MIDDLE_PAGE;
    hPagerRef.current?.scrollTo({ x: midX, animated: false });
    headerPagerRef.current?.scrollTo({ x: midX, animated: false });
    requestAnimationFrame(() => {
      pagingLock.current = false;
    });
  };

  const onPagerScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (pagingLock.current || pageWidth <= 0) return;
    headerPagerRef.current?.scrollTo({
      x: e.nativeEvent.contentOffset.x,
      animated: false,
    });
  };

  const openSlotNoteEditor = React.useCallback(
    (startMinutes: number) => {
      setSlotNoteEditor({
        startMinutes,
        draft: getSlotNote(slotNotes, startMinutes),
      });
    },
    [slotNotes],
  );

  const saveSlotNoteEditor = React.useCallback(async () => {
    if (!slotNoteEditor) return;
    setSlotNoteSaving(true);
    try {
      const next = await saveScheduleSlotNote(
        slotNoteEditor.startMinutes,
        slotNoteEditor.draft,
      );
      setSlotNotes(next);
      setSlotNoteEditor(null);
      toast.success('已保存');
    } catch (err) {
      toast.error(toUserMessage(err, '保存失败，请稍后重试'));
    } finally {
      setSlotNoteSaving(false);
    }
  }, [slotNoteEditor]);

  const clearSlotNoteEditor = React.useCallback(async () => {
    if (!slotNoteEditor) return;
    setSlotNoteSaving(true);
    try {
      const next = await saveScheduleSlotNote(slotNoteEditor.startMinutes, '');
      setSlotNotes(next);
      setSlotNoteEditor(null);
      toast.success('已清除');
    } catch (err) {
      toast.error(toUserMessage(err, '清除失败，请稍后重试'));
    } finally {
      setSlotNoteSaving(false);
    }
  }, [slotNoteEditor]);

  const orphanedPlacements = React.useMemo(() => {
    if (!view) return [] as SchedulePlacementRow[];
    return view.placements.filter((p) => p.orphaned || p.startSlotIndex == null);
  }, [view]);

  /** sc-head cnt：「N/M 只已入格」 */
  const frogPlaceStats = React.useMemo(() => {
    if (!view) return { inGrid: 0, total: 0 };
    const map = new Map<string, boolean>();
    for (const p of view.placements) {
      const k = `${p.subjectKind}:${p.subjectId}`;
      const inGrid = !p.orphaned && p.startSlotIndex != null;
      const prev = map.get(k);
      if (prev == null) map.set(k, inGrid);
      else if (inGrid) map.set(k, true);
    }
    let inGrid = 0;
    for (const v of map.values()) if (v) inGrid += 1;
    return { inGrid, total: map.size };
  }, [view]);

  const placingMode = !!(pendingPlace || reassignPending);

  const openPlace = (
    assignYmd: string,
    startSlotIndex: number,
    opts?: {
      rematerializePlacementId?: string;
      rematerializePreselected?: SchedulePlacePreselected;
    },
  ) => {
    if (!dayEditable(assignYmd, logicalTodayYmd) || !view) return;
    const weekStartYmd = getWeekStartMondayYmd(assignYmd);
    const weekday = weekdayFromYmd(assignYmd);
    setPlaceTarget({
      weekStartYmd,
      weekday,
      startSlotIndex,
      assignYmd,
      maxSpan: maxSpanFromSlot(view.axis, startSlotIndex),
      rematerializePlacementId: opts?.rematerializePlacementId,
      rematerializePreselected: opts?.rematerializePreselected,
    });
  };

  const handlePlaceConfirm = async (result: SchedulePlaceResult) => {
    if (!placeTarget || !view) return;
    const daySlots = getSlotCount(view.axis);
    const startSlotIndex = result.allDay ? 0 : placeTarget.startSlotIndex;
    const spanSlots = result.allDay
      ? Math.max(1, daySlots)
      : result.spanSlots;
    if (placeTarget.rematerializePlacementId) {
      await rematerializeOrphanedPlacement({
        placementId: placeTarget.rematerializePlacementId,
        assignYmd: placeTarget.assignYmd,
        startSlotIndex,
        spanSlots,
        logicalTodayYmd,
      });
      setPlaceTarget(null);
      setReassignPending(null);
      await reload(loadDayYmds, { silent: true });
      onChanged?.();
      return;
    }
    const row = await placeFrogOnSchedule({
      weekStartYmd: placeTarget.weekStartYmd,
      weekday: placeTarget.weekday,
      startSlotIndex,
      spanSlots,
      subjectKind: result.kind,
      subjectId: result.id,
      logicalTodayYmd,
    });
    setView((prev) =>
      prev
        ? {
            ...prev,
            placements: [...prev.placements.filter((p) => p.id !== row.id), row],
            orphanedCount: prev.placements.filter((p) => p.orphaned || p.startSlotIndex == null)
              .length,
          }
        : prev,
    );
    setPlaceTarget(null);
    onClearPendingPlace?.();
    await reload(loadDayYmds, { silent: true });
    onChanged?.({
      kind: result.kind,
      id: result.id,
      assignYmd: placeTarget.assignYmd,
      action: 'assign',
    });
  };

  const startReassignTime = (placement: SchedulePlacementRow, subject: ScheduleSubjectInfo) => {
    setDetail(null);
    setOrphanListOpen(false);
    setCellList(null);
    goZoom('grid');
    const assignYmd = ymdForWeekday(placement.weekStartYmd, placement.weekday);
    const dayOffset = Math.round(
      (logicalYmdToLocalDate(assignYmd).getTime() -
        logicalYmdToLocalDate(logicalTodayYmd).getTime()) /
        (24 * 60 * 60 * 1000),
    );
    setPeriodIndex(Math.round(dayOffset / 3));
    setReassignPending({ placement, subject });
  };

  const openCellList = (
    assignYmd: string,
    slotIndex: number,
    list: SchedulePlacementRow[],
    habits: VirtualHabitPlacement[],
    vTasks: VirtualTaskPlacement[],
    editable: boolean,
  ) => {
    setCellList({
      assignYmd,
      slotIndex,
      placements: uniquePlacementsBySubject(list),
      habits: [...habits],
      virtualTasks: [...vTasks],
      editable,
    });
  };

  const openVirtualHabitDetail = React.useCallback((habit: VirtualHabitPlacement) => {
    setCellList(null);
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
      const subject = resolveSubject('task', task.taskId, subjects, task.assignYmd);
      if (!subject) return;
      setCellList(null);
      setOrphanListOpen(false);
      setDetail({
        surface: 'todo',
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
        Alert.alert(habit.name, '未到打卡日，请到当天再打卡。可在习惯编辑页关闭入格。');
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
      setCellList(null);
      setOrphanListOpen(false);
      setDetail({ surface, placement: p, subject, virtualSlot: null });
    },
    [subjects],
  );

  const handleCellPress = (assignYmd: string, slotIndex: number) => {
    const key = cellKey(assignYmd, slotIndex);
    const list = placementsByCell.get(key) ?? [];
    const habits = habitsByCell.get(key) ?? [];
    const vTasks = virtualTasksByCell.get(key) ?? [];
    const editable = dayEditable(assignYmd, logicalTodayYmd);

    if (reassignPending && editable) {
      openPlace(assignYmd, slotIndex, {
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

    if (list.length === 0 && habits.length === 0 && vTasks.length === 0) {
      if (editable) openPlace(assignYmd, slotIndex);
      return;
    }
    /** 预选入格模式下，已占用格仍允许再添加 */
    if (pendingPlace && editable) {
      openPlace(assignYmd, slotIndex);
      return;
    }
    const unique = uniquePlacementsBySubject(list);
    const totalItems = unique.length + habits.length + vTasks.length;
    /** 多只 / 含习惯或虚拟待办 / 只读：先弹出列表 */
    if (totalItems > 1 || !editable) {
      openCellList(assignYmd, slotIndex, list, habits, vTasks, editable);
      return;
    }
    if (habits.length === 1 && unique.length === 0 && vTasks.length === 0) {
      tapVirtualHabit(habits[0]!);
      return;
    }
    if (vTasks.length === 1 && unique.length === 0 && habits.length === 0) {
      tapVirtualTask(vTasks[0]!);
      return;
    }
    const display = pickDisplayPlacement(unique, subjects, assignYmd);
    if (!display?.primary) return;
    // 与习惯/待办虚拟块一致：进格内详情 Sheet，完成确认用设计稿弹窗，不用系统 Alert
    openDetail(display.primary);
  };

  const handleCellLongPress = (assignYmd: string, slotIndex: number) => {
    if (reassignPending) {
      handleCellPress(assignYmd, slotIndex);
      return;
    }
    const key = cellKey(assignYmd, slotIndex);
    const list = placementsByCell.get(key) ?? [];
    const habits = habitsByCell.get(key) ?? [];
    const vTasks = virtualTasksByCell.get(key) ?? [];
    const editable = dayEditable(assignYmd, logicalTodayYmd);
    if (list.length === 0 && habits.length === 0 && vTasks.length === 0) {
      if (editable) openPlace(assignYmd, slotIndex);
      return;
    }
    openCellList(assignYmd, slotIndex, list, habits, vTasks, editable);
  };

  const onCopyLastWeek = () => {
    if (!isEditableWeek(thisMonday, logicalTodayYmd)) return;
    const run = async (overwrite: boolean) => {
      try {
        const result = await copyPreviousWeekToThisWeek({
          thisWeekStartYmd: thisMonday,
          logicalTodayYmd,
          overwrite,
        });
        const skipMsg =
          result.skipped.length > 0
            ? `\n跳过 ${result.skipped.length} 项：${result.skipped
                .slice(0, 5)
                .map((s) => s.reason)
                .join('；')}${result.skipped.length > 5 ? '…' : ''}`
            : '';
        toast.success(
          `已复制 ${result.copied} 条${result.overwritten ? `（覆盖 ${result.overwritten}）` : ''}${skipMsg ? '，部分跳过' : ''}`,
        );
        await reload(loadDayYmds, { silent: true });
        onChanged?.();
      } catch (err) {
        if (err instanceof Error && err.message === 'NEED_CONFIRM_OVERWRITE') {
          Alert.alert('本周已有占用', '复制将覆盖本周全部日程表占用，是否继续？', [
            { text: '取消', style: 'cancel' },
            { text: '覆盖并复制', style: 'destructive', onPress: () => void run(true) },
          ]);
          return;
        }
        toast.error(toUserMessage(err, '复制失败，请稍后重试'));
      }
    };
    void run(false);
  };

  const todayHasPlacement =
    (view?.placements.some((p) => {
      if (p.orphaned || p.startSlotIndex == null) return false;
      return ymdForWeekday(p.weekStartYmd, p.weekday) === logicalTodayYmd;
    }) ?? false) ||
    virtualHabits.some((h) => h.assignYmd === logicalTodayYmd) ||
    virtualTasks.some((t) => t.assignYmd === logicalTodayYmd);

  const todayCompactItems = React.useMemo(() => {
    if (!view) return [];
    const items: TodayCompactItem[] = [];
    for (const p of view.placements) {
      if (p.orphaned || p.startSlotIndex == null) continue;
      const assignYmd = ymdForWeekday(p.weekStartYmd, p.weekday);
      if (assignYmd !== logicalTodayYmd) continue;
      const sub = resolveSubject(p.subjectKind, p.subjectId, subjects, assignYmd);
      const startMins = slotStartMinutes(view.axis, p.startSlotIndex);
      const endMins = placementEndMinutes(view.axis, p.startSlotIndex, Math.max(1, p.spanSlots));
      items.push({
        placement: p,
        habit: null,
        virtualTask: null,
        emptySlotIndex: null,
        title: sub?.title?.trim() || '青蛙',
        done: !!sub?.done,
        timeLabel: formatMinutesAsHm(startMins),
        endLabel: formatMinutesAsHm(endMins),
        startMins,
        endMins,
      });
    }
    for (const h of virtualHabits) {
      if (h.assignYmd !== logicalTodayYmd) continue;
      const startMins = slotStartMinutes(view.axis, h.startSlotIndex);
      const endMins = placementEndMinutes(view.axis, h.startSlotIndex, 1);
      items.push({
        placement: null,
        habit: h,
        virtualTask: null,
        emptySlotIndex: null,
        title: h.name,
        done: h.done,
        timeLabel: formatMinutesAsHm(startMins),
        endLabel: formatMinutesAsHm(endMins),
        startMins,
        endMins,
      });
    }
    for (const t of virtualTasks) {
      if (t.assignYmd !== logicalTodayYmd) continue;
      const startMins = slotStartMinutes(view.axis, t.startSlotIndex);
      const endMins = placementEndMinutes(view.axis, t.startSlotIndex, 1);
      items.push({
        placement: null,
        habit: null,
        virtualTask: t,
        emptySlotIndex: null,
        title: t.title,
        done: t.done,
        timeLabel: formatMinutesAsHm(startMins),
        endLabel: formatMinutesAsHm(endMins),
        startMins,
        endMins,
      });
    }
    items.sort((a, b) => {
      const sa =
        a.placement?.startSlotIndex ??
        a.habit?.startSlotIndex ??
        a.virtualTask?.startSlotIndex ??
        a.emptySlotIndex ??
        0;
      const sb =
        b.placement?.startSlotIndex ??
        b.habit?.startSlotIndex ??
        b.virtualTask?.startSlotIndex ??
        b.emptySlotIndex ??
        0;
      if (sa !== sb) return sa - sb;
      return a.title.localeCompare(b.title, 'zh');
    });
    return items;
  }, [view, logicalTodayYmd, subjects, virtualHabits, virtualTasks]);

  /** 今日列表：预选/改派时插入可放入空档（呼吸轮廓） */
  const todayAgendaItems = React.useMemo(() => {
    if (!view || !placingMode) return todayCompactItems;
    const occupied = new Set<number>();
    for (const it of todayCompactItems) {
      if (it.placement?.startSlotIndex != null) {
        const span = Math.max(1, it.placement.spanSlots);
        for (let i = 0; i < span; i++) occupied.add(it.placement.startSlotIndex + i);
      }
      if (it.habit) occupied.add(it.habit.startSlotIndex);
      if (it.virtualTask) occupied.add(it.virtualTask.startSlotIndex);
    }
    const workSlots = listWorkSlots(view.axis);
    const empties: TodayCompactItem[] = [];
    const nowCut = axisNowMins ?? -1;
    for (const slot of workSlots) {
      if (occupied.has(slot.slotIndex)) continue;
      // 预选时只提示「还能放入」的空档，避免整日空格刷屏
      if (nowCut >= 0 && slot.endMinutes <= nowCut) continue;
      empties.push({
        placement: null,
        habit: null,
        virtualTask: null,
        emptySlotIndex: slot.slotIndex,
        title: pendingPlace?.title?.trim() || reassignPending?.subject.title?.trim() || '放入',
        done: false,
        timeLabel: formatMinutesAsHm(slot.startMinutes),
        endLabel: formatMinutesAsHm(slot.endMinutes),
        startMins: slot.startMinutes,
        endMins: slot.endMinutes,
      });
      if (empties.length >= 3) break;
    }
    const merged = [...todayCompactItems, ...empties];
    merged.sort((a, b) => {
      if (a.startMins !== b.startMins) return a.startMins - b.startMins;
      const ae = a.emptySlotIndex != null ? 1 : 0;
      const be = b.emptySlotIndex != null ? 1 : 0;
      if (ae !== be) return ae - be;
      return a.title.localeCompare(b.title, 'zh');
    });
    return merged;
  }, [view, placingMode, todayCompactItems, pendingPlace, reassignPending, axisNowMins]);

  const todayFootStats = React.useMemo(() => {
    const used = todayCompactItems.reduce((sum, it) => sum + Math.max(0, it.endMins - it.startMins), 0);
    const workTotal = view
      ? listWorkSlots(view.axis).reduce((s, slot) => s + (slot.endMinutes - slot.startMinutes), 0)
      : 0;
    const free = Math.max(0, workTotal - used);
    const fmt = (mins: number) => {
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      if (h <= 0) return `${m}m`;
      if (m <= 0) return `${h}h`;
      return `${h}h ${String(m).padStart(2, '0')}m`;
    };
    return { usedLabel: fmt(used), freeLabel: fmt(free), count: todayCompactItems.length };
  }, [todayCompactItems, view]);

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
      return [...byId.values()].sort((a, b) => {
        const sa =
          a.placement?.startSlotIndex ?? a.habit?.startSlotIndex ?? a.virtualTask?.startSlotIndex ?? 0;
        const sb =
          b.placement?.startSlotIndex ?? b.habit?.startSlotIndex ?? b.virtualTask?.startSlotIndex ?? 0;
        if (sa !== sb) return sa - sb;
        return a.title.localeCompare(b.title, 'zh');
      });
    };

    const itemsStartingInSlot = (slotIndex: number) =>
      todayCompactItems.filter(
        (x) =>
          (x.placement?.startSlotIndex ?? x.habit?.startSlotIndex) === slotIndex,
      );

    const currentSlot = workSlots.find(
      (s) => nowMins >= s.startMinutes && nowMins < s.endMinutes,
    );
    if (currentSlot) {
      return {
        kind: 'current' as const,
        items: mergeFocusItems(itemsStartingInSlot(currentSlot.slotIndex)),
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
        items: mergeFocusItems(
          nextSlot ? itemsStartingInSlot(nextSlot.slotIndex) : [],
        ),
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
        items: mergeFocusItems(itemsStartingInSlot(nextSlot.slotIndex)),
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

  // 非课表态强制回今天周期
  React.useEffect(() => {
    if (!isGrid && periodIndex !== 0) {
      setPeriodIndex(0);
    }
  }, [isGrid, periodIndex]);

  const todayDoneCount = todayCompactItems.filter((x) => x.done).length;

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

  const renderDaySlots = (ymd: string, width: number) => {
    if (!view || !layout) return null;
    const isTodayCol = ymd === logicalTodayYmd;
    const isPastCol = ymd < logicalTodayYmd;
    const editable = dayEditable(ymd, logicalTodayYmd);
    /** 暖纸色休息带 / 空格，对齐设计稿 `.tt-day`（忌 slate 蓝灰） */
    const breakBg = isDark ? 'rgba(61,72,64,0.45)' : 'rgba(236,230,216,0.95)';
    const breakFg = isDark ? 'rgba(168,178,168,0.95)' : '#9AA49B';
    const emptyCellBg = isPastCol
      ? isDark
        ? 'rgba(50,58,52,0.4)'
        : 'rgba(241,237,226,0.7)'
      : isTodayCol
        ? todayWash
        : isDark
          ? 'rgba(32,40,36,0.35)'
          : 'rgba(255,252,245,0.4)';
    return (
      <View key={ymd} style={{ width, opacity: isPastCol ? 0.7 : 1 }}>
        <View style={{ height: totalBodyH, position: 'relative' }}>
          {timeline.map((row, rowIndex) => {
            const rowH = rowHeights[rowIndex] ?? 52;
            if (row.kind === 'break') {
              return (
                <View
                  key={`break-${row.startMinutes}-${rowIndex}`}
                  accessibilityLabel={`${row.label} ${formatMinuteRangeLabel(row.startMinutes, row.endMinutes)}，不可入格`}
                  style={[
                    styles.slotCell,
                    {
                      height: rowH,
                      borderColor: gridLineSoft,
                      backgroundColor: breakBg,
                      alignItems: 'center',
                      justifyContent: 'center',
                      opacity: 0.92,
                      paddingVertical: rowH < 20 ? 0 : 2,
                    },
                  ]}>
                  {rowH >= 14 ? (
                    <Text
                      style={{
                        color: breakFg,
                        fontSize: rowH < 20 ? 8 : rowH < 28 ? 9 : 11,
                        fontWeight: '700',
                        textAlign: 'center',
                      }}
                      numberOfLines={rowH < 22 ? 1 : 2}>
                      {row.label}
                    </Text>
                  ) : null}
                </View>
              );
            }

            const slotIndex = row.slotIndex;
            const key = cellKey(ymd, slotIndex);
            const covering = placementsByCell.get(key) ?? [];
            const cellHabits = habitsByCell.get(key) ?? [];
            const cellVirtualTasks = virtualTasksByCell.get(key) ?? [];
            const slotNote = getSlotNote(slotNotes, row.startMinutes);
            const isEmpty =
              covering.length === 0 && cellHabits.length === 0 && cellVirtualTasks.length === 0;
            /** 截断短行：收紧内边距，色块高度跟行高走 */
            const blockPad = rowH < 20 ? 1 : 2;
            const blockH = Math.max(10, rowH - blockPad * 2);
            const showTitle = rowH >= 18;
            const showMeta = rowH >= 34;
            const showCk = rowH >= 20;
            return (
              <Pressable
                key={`work-${slotIndex}`}
                onPress={() => handleCellPress(ymd, slotIndex)}
                onLongPress={() => handleCellLongPress(ymd, slotIndex)}
                delayLongPress={280}
                style={[
                  styles.slotCell,
                  {
                    height: rowH,
                    borderColor: gridLineSoft,
                    backgroundColor: emptyCellBg,
                    padding: blockPad,
                  },
                ]}>
                <PreselGlowOutline
                  active={placingMode && isEmpty && editable}
                  color={sunAmber}
                  reduceMotion={!foldAnimate}
                />
                {(() => {
                  // 跨格占用的每一格都画色块+任务名（与角标 covering 口径一致）
                  if (covering.length === 0 && cellHabits.length === 0 && cellVirtualTasks.length === 0) {
                    // 设计稿 `.blk.note`：空格虚线备注，随行高截断适配
                    if (!slotNote || rowH < 16) return null;
                    return (
                      <View
                        pointerEvents="none"
                        style={[
                          styles.noteBlock,
                          {
                            height: blockH,
                            borderColor: isDark
                              ? 'rgba(205,196,180,0.45)'
                              : 'rgba(205,196,180,0.9)',
                          },
                        ]}>
                        <Text
                          numberOfLines={rowH >= 28 ? 2 : 1}
                          style={[
                            styles.noteBlockText,
                            {
                              color: isDark ? 'rgba(155,156,145,0.9)' : '#9B9C91',
                              fontSize: rowH < 22 ? 8 : 9,
                            },
                          ]}>
                          {slotNote}
                        </Text>
                      </View>
                    );
                  }
                  const display =
                    covering.length > 0
                      ? pickDisplayPlacement(covering, subjects, ymd)
                      : null;
                  const primaryHabit =
                    !display && cellHabits.length > 0
                      ? [...cellHabits].sort((a, b) => Number(a.done) - Number(b.done))[0]
                      : null;
                  const primaryVirtualTask =
                    !display && !primaryHabit && cellVirtualTasks.length > 0
                      ? [...cellVirtualTasks].sort((a, b) => Number(a.done) - Number(b.done))[0]
                      : null;
                  const unfinishedFrogTitles = listUnfinishedTitlesInCell(
                    covering,
                    subjects,
                    ymd,
                  );
                  const unfinishedHabitTitles = cellHabits
                    .filter((x) => !x.done)
                    .map((x) => x.name);
                  const unfinishedVirtualTaskTitles = cellVirtualTasks
                    .filter((x) => !x.done)
                    .map((x) => x.title);
                  const unfinishedTitles = [
                    ...unfinishedFrogTitles,
                    ...unfinishedHabitTitles,
                    ...unfinishedVirtualTaskTitles,
                  ];
                  const showUnfinished =
                    unfinishedTitles.length > 0 ? unfinishedTitles : null;
                  const titleDone = !showUnfinished;
                  const allDone =
                    (display?.done ?? true) &&
                    cellHabits.every((x) => x.done) &&
                    cellVirtualTasks.every((x) => x.done);
                  const blockKind: ScheduleBlockKind = display
                    ? blockKindForPlacement(display.primary, subjects)
                    : primaryHabit
                      ? 'habit'
                      : 'todo';
                  const fill = scheduleBlockStyle(blockKind, {
                    isPast: isPastCol,
                    allDone,
                    isDark,
                  });
                  const titleStyle = [
                    styles.blockTitle,
                    rowH < 22 && styles.blockTitleCompact,
                    {
                      color: fill.titleColor,
                      textDecorationLine: titleDone
                        ? ('line-through' as const)
                        : ('none' as const),
                      opacity: titleDone ? 0.78 : 1,
                    },
                  ];
                  const fallbackTitle =
                    display?.title ??
                    primaryHabit?.name ??
                    primaryVirtualTask?.title ??
                    '日程';
                  const startHm = formatMinutesAsHm(row.startMinutes);
                  const endHm = formatMinutesAsHm(row.endMinutes);
                  const metaLabel = primaryHabit
                    ? `${startHm} · 习惯${allDone ? ' · 已完成' : ''}`
                    : primaryVirtualTask || blockKind === 'todo'
                      ? `${startHm} · 待办${allDone ? ' · 已完成' : ''}`
                      : display?.primary.subjectKind === 'project'
                        ? `${startHm}–${endHm} · 项目${allDone ? ' · 已完成' : ''}`
                        : `${startHm}–${endHm}${allDone ? ' · 已完成' : ' · 进行中'}`;
                  const blockKey =
                    display?.primary.id ??
                    (primaryHabit
                      ? `habit-${primaryHabit.habitId}`
                      : `vtask-${primaryVirtualTask?.taskId}`);
                  const riseIndex = bloomBlockIndex.current++;
                  const drawCk =
                    showCk &&
                    (allDone || blockKind === 'frog' || blockKind === 'todo' || blockKind === 'proj');
                  const ckFill = allDone
                    ? fill.doneOnLight
                      ? 'rgba(255,255,255,0.92)'
                      : blockKind === 'frog'
                        ? '#DDE9CB'
                        : fill.titleColor
                    : 'transparent';
                  const ckIconColor = fill.doneOnLight
                    ? primary
                    : blockKind === 'frog'
                      ? '#35604A'
                      : '#fff';
                  return (
                    <FoldRiseIn
                      key={blockKey}
                      animate={foldAnimate}
                      index={riseIndex}
                      staggerMs={TaskFoldMotion.schedBlockStagger}
                      fromY={10}
                      duration={380}
                      style={{ width: '100%' }}>
                      <View
                        pointerEvents="none"
                        style={[
                          styles.block,
                          {
                            height: blockH,
                            backgroundColor: fill.backgroundColor,
                            borderColor: fill.borderColor,
                            borderStyle: fill.borderStyle,
                            opacity: allDone ? 0.88 : 1,
                            top: 0,
                            left: 0,
                            right: 0,
                          },
                        ]}>
                        <View
                          style={[
                            styles.blockBody,
                            blockKind === 'habit' && !allDone && styles.blockBodyHabit,
                            rowH < 22 && styles.blockBodyCompact,
                          ]}>
                          {blockKind === 'habit' && showTitle && !allDone ? (
                            <View style={[styles.blockFrogDot, { backgroundColor: '#87A566' }]} />
                          ) : null}
                          {showTitle ? (
                            showUnfinished && showUnfinished.length > 1 && !isPastCol ? (
                              <ScheduleCellTitleRotator
                                titles={showUnfinished}
                                numberOfLines={1}
                                style={titleStyle}
                              />
                            ) : (
                              <Text numberOfLines={1} style={titleStyle}>
                                {showUnfinished?.[0] ?? fallbackTitle}
                              </Text>
                            )
                          ) : null}
                          {showMeta ? (
                            <Text
                              numberOfLines={1}
                              style={[styles.blockMeta, { color: fill.metaColor }]}>
                              {metaLabel}
                            </Text>
                          ) : null}
                          {drawCk ? (
                            <View
                              style={[
                                styles.blockCk,
                                allDone && styles.blockCkDone,
                                {
                                  borderColor: allDone
                                    ? fill.doneOnLight
                                      ? 'rgba(255,255,255,0.92)'
                                      : fill.titleColor
                                    : fill.titleColor,
                                  backgroundColor: ckFill,
                                  opacity: allDone ? 1 : 0.55,
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                },
                              ]}>
                              {allDone ? (
                                <MaterialIcons name="check" size={7} color={ckIconColor} />
                              ) : null}
                            </View>
                          ) : null}
                        </View>
                      </View>
                    </FoldRiseIn>
                  );
                })()}

                {(() => {
                  const unfinishedFrogs = countUnfinishedInCell(covering, subjects, ymd);
                  const unfinishedHabits = cellHabits.filter((x) => !x.done).length;
                  const unfinishedVTasks = cellVirtualTasks.filter((x) => !x.done).length;
                  const unfinished = unfinishedFrogs + unfinishedHabits + unfinishedVTasks;
                  if (unfinished <= 1 || isPastCol || rowH < 18) return null;
                  return (
                    <View style={[styles.badge, { backgroundColor: primary }]}>
                      <Text style={styles.badgeText}>{unfinished}</Text>
                    </View>
                  );
                })()}

                {isEmpty &&
                !slotNote &&
                isTodayCol &&
                editable &&
                !todayHasPlacement &&
                slotIndex === Math.floor(slotCount / 2) ? (
                  <Text style={[styles.emptyHint, { color: outline }]}>
                    点击添加
                  </Text>
                ) : null}
              </Pressable>
            );
          })}

          {isTodayCol && nowLineTop != null ? (
            <View
              pointerEvents="none"
              style={[styles.nowLine, { top: nowLineTop }]}>
              <View
                style={[
                  styles.nowDot,
                  { backgroundColor: sunAmber },
                ]}
              />
              <View
                style={[
                  styles.nowBar,
                  { backgroundColor: sunAmber, opacity: 0.75 },
                ]}
              />
              <View style={[styles.nowPill, { backgroundColor: isDark ? tf.paper2 : tf.cream }]}>
                <Text style={[styles.nowPillText, { color: tf.sun }]}>现在</Text>
              </View>
            </View>
          ) : null}
        </View>
      </View>
    );
  };

  const renderPeriodHeaders = (pagePeriodIndex: number, width: number) => {
    const pageCenter = centerYmdForPeriod(logicalTodayYmd, pagePeriodIndex);
    const days = threeDayWindow(pageCenter);
    const pageColW = width / 3;
    return (
      <View key={`ph-${pagePeriodIndex}`} style={{ width, flexDirection: 'row' }}>
        {days.map((ymd) => renderDayHeader(ymd, pageColW))}
      </View>
    );
  };

  const renderPeriodSlots = (pagePeriodIndex: number, width: number) => {
    const pageCenter = centerYmdForPeriod(logicalTodayYmd, pagePeriodIndex);
    const days = threeDayWindow(pageCenter);
    const pageColW = width / 3;
    return (
      <View key={`ps-${pagePeriodIndex}`} style={{ width, flexDirection: 'row' }}>
        {days.map((ymd) => renderDaySlots(ymd, pageColW))}
      </View>
    );
  };

  const renderScheduleGrid = () => {
    if (!view || !layout) return null;
    bloomBlockIndex.current = 0;
    const pages = [periodIndex - 1, periodIndex, periodIndex + 1];
    const pw = pageWidth || colWidth * 3;

    const headerRow = (
      <View
        style={[
          styles.gridWrap,
          styles.gridHeaderChrome,
          {
            backgroundColor: theme.surface,
            borderBottomColor: gridLineSoft,
          },
        ]}>
        <View style={[styles.timeGutterCorner, { width: TIME_GUTTER, height: DAY_HEADER_H }]} />
        <View style={{ flex: 1 }} onLayout={onGridLayout}>
          {gridWidth > 0 ? (
            <ScrollView
              ref={headerPagerRef}
              horizontal
              pagingEnabled
              scrollEnabled={false}
              showsHorizontalScrollIndicator={false}
              style={{ width: pw }}>
              {pages.map((pIdx) => renderPeriodHeaders(pIdx, pw))}
            </ScrollView>
          ) : null}
        </View>
      </View>
    );

    const timeColumn = (
      <View style={[styles.timeGutter, { width: TIME_GUTTER, borderRightColor: gridLineSoft }]}>
        {timeline.map((row, rowIndex) => {
          const rowH = rowHeights[rowIndex] ?? 52;
          const rangeLabel = formatMinuteRangeLabel(row.startMinutes, row.endMinutes);
          /** 设计稿 `.tt-t`：仅起始小时两位；备注改画在日列 `.blk.note` */
          const hourLabel = String(Math.floor(Math.max(0, row.startMinutes) / 60) % 24).padStart(
            2,
            '0',
          );
          const hourFont = rowH < 18 ? 7 : rowH < 24 ? 8 : 9;
          if (row.kind === 'break') {
            return (
              <View
                key={`tg-break-${row.startMinutes}-${rowIndex}`}
                style={[
                  styles.timeCell,
                  {
                    height: rowH,
                    borderColor: gridLineSoft,
                    backgroundColor: isDark ? 'rgba(61,72,64,0.4)' : 'rgba(236,230,216,0.7)',
                    justifyContent: 'flex-start',
                  },
                ]}>
                {rowH >= 12 ? (
                  <Text
                    style={[styles.timeHourText, { color: outline, fontSize: hourFont }]}
                    numberOfLines={1}>
                    {hourLabel}
                  </Text>
                ) : null}
              </View>
            );
          }
          const note = getSlotNote(slotNotes, row.startMinutes);
          return (
            <Pressable
              key={`tg-work-${row.slotIndex}`}
              onPress={() => openSlotNoteEditor(row.startMinutes)}
              accessibilityRole="button"
              accessibilityLabel={`${rangeLabel} 时段备注${note ? `：${note}` : ''}`}
              accessibilityHint="点击添加或修改时段备注，最多六个字"
              style={({ pressed }) => [
                styles.timeCell,
                {
                  height: rowH,
                  borderColor: gridLineSoft,
                  opacity: pressed ? 0.75 : 1,
                  backgroundColor: note ? todayWash : 'transparent',
                },
              ]}>
              {rowH >= 12 ? (
                <Text
                  style={[
                    styles.timeHourText,
                    { color: note ? primary : outline, fontSize: hourFont },
                  ]}
                  numberOfLines={1}>
                  {hourLabel}
                </Text>
              ) : null}
            </Pressable>
          );
        })}
      </View>
    );

    const bodyPager = (
      <ScrollView
        ref={hPagerRef}
        horizontal
        pagingEnabled
        nestedScrollEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={onPagerScroll}
        onMomentumScrollEnd={onPagerScrollEnd}
        scrollEventThrottle={16}
        style={{ width: pw || undefined, flexGrow: 1 }}>
        {pages.map((pIdx) => renderPeriodSlots(pIdx, pw))}
      </ScrollView>
    );

    const bodyRow = (
      <View style={styles.gridWrap}>
        {timeColumn}
        <View style={{ flex: 1, width: pw }}>
          {gridWidth > 0 ? bodyPager : null}
        </View>
      </View>
    );

    /** 外框锁定设计稿高度；内容行更高时表体内上下滑动 */
    const body = (
      <ScrollView
        style={{ height: fixedBodyH }}
        contentContainerStyle={{ minHeight: Math.max(totalBodyH, fixedBodyH) }}
        nestedScrollEnabled
        scrollEnabled={bodyScrollable}
        showsVerticalScrollIndicator={bodyScrollable}
        keyboardShouldPersistTaps="handled"
        bounces={bodyScrollable}>
        {bodyRow}
      </ScrollView>
    );

    return (
      <View key={axisKey}>
        {headerRow}
        {body}
      </View>
    );
  };

  const renderCompactRow = (
    item: TodayCompactItem,
    index: number,
    list: TodayCompactItem[],
    opts?: { dense?: boolean },
  ) => {
    const isEmpty = item.emptySlotIndex != null;
    const kind: ScheduleBlockKind = item.habit
      ? 'habit'
      : item.virtualTask
        ? 'todo'
        : item.placement
          ? blockKindForPlacement(item.placement, subjects)
          : 'frog';
    const fill = isEmpty
      ? {
          backgroundColor: isDark ? 'rgba(255,252,245,0.08)' : 'rgba(255,252,245,0.4)',
          borderColor: isDark ? tf.line2 : '#D8C9AF',
          borderStyle: 'dashed' as const,
          titleColor: isDark ? tf.amberInk : '#AA9C86',
          metaColor: isDark ? tf.sun : '#B07A32',
        }
      : scheduleBlockStyle(kind, {
          isPast: false,
          allDone: item.done,
          isDark,
        });
    const durMin = Math.max(0, item.endMins - item.startMins);
    const durLabel = isEmpty
      ? '可用'
      : durMin >= 60
        ? `${Math.round((durMin / 60) * 10) / 10}h`.replace(/\.0h$/, 'h')
        : `${durMin}m`;
    const sub =
      item.placement && !isEmpty
        ? resolveSubject(
            item.placement.subjectKind,
            item.placement.subjectId,
            subjects,
            logicalTodayYmd,
          )
        : null;
    const meta = isEmpty
      ? `预计放入 · ${pendingPlace?.title || reassignPending?.subject.title || '候选'}`
      : kind === 'habit'
        ? item.done
          ? '习惯 · 已完成'
          : '习惯虚拟块'
        : kind === 'todo'
          ? '自动入格 · 独立待办'
          : item.placement?.subjectKind === 'project'
            ? `项目 · ${item.done ? '已完成' : '进行中'}`
            : [sub?.projectName?.trim() || '青蛙', item.done ? '已完成' : '进行中']
                .filter(Boolean)
                .join(' · ');
    const preselTitle =
      pendingPlace?.title?.trim() || reassignPending?.subject.title?.trim() || '这件事';
    return (
      <Pressable
        key={
          isEmpty
            ? `empty-${item.emptySlotIndex}`
            : item.placement?.id ??
              (item.habit
                ? `habit-${item.habit.habitId}-${item.startMins}`
                : `vtask-${item.virtualTask?.taskId}-${item.startMins}`)
        }
        onPress={() => {
          if (isEmpty && item.emptySlotIndex != null) {
            handleCellPress(logicalTodayYmd, item.emptySlotIndex);
            return;
          }
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
        accessibilityLabel={
          isEmpty
            ? `${item.timeLabel} 空档，放入 ${preselTitle}`
            : `${item.timeLabel} ${item.title}${item.done ? '，已完成' : ''}`
        }
        style={({ pressed }) => [
          styles.dlRow,
          index < list.length - 1 && { marginBottom: 2 },
          { opacity: pressed ? 0.88 : item.done && !isEmpty ? 0.72 : 1 },
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
              alignItems: isEmpty ? 'center' : undefined,
            },
          ]}>
          {isEmpty ? (
            <>
              <PreselGlowOutline active color={tf.sun} reduceMotion={!foldAnimate} />
              <Text
                style={[styles.dlBlockTitle, { color: fill.titleColor, textAlign: 'center' }]}
                numberOfLines={2}>
                ＋ 点此处放入「{preselTitle}」
              </Text>
              {!opts?.dense ? (
                <Text
                  style={[styles.dlBlockMeta, { color: fill.metaColor, textAlign: 'center' }]}
                  numberOfLines={1}>
                  {durMin > 0 ? `空档约 ${durMin}m` : '空档'}
                </Text>
              ) : null}
            </>
          ) : (
            <>
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
            </>
          )}
        </View>
      </Pressable>
    );
  };

  const zoomSegOptions: { key: ScheduleZoomMode; label: string }[] = [
    { key: 'minimal', label: '最简' },
    { key: 'agenda', label: '今日' },
    { key: 'grid', label: '三天' },
  ];

  return (
    <View style={styles.section}>
      <View
        style={
          isGrid
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
              marginBottom: isGrid || isAgenda || isMinimal || !loading ? 0 : 0,
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
          {isGrid && orphanedPlacements.length > 0 ? (
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
            onPress={() => onCopyLastWeek()}
            disabled={!isEditableWeek(thisMonday, logicalTodayYmd)}
            accessibilityRole="button"
            accessibilityLabel="复制上周"
            style={({ pressed }) => [
              styles.copyBtn,
              {
                backgroundColor: isDark ? tf.paper3 : '#F4EFE2',
                borderColor: isDark ? tf.line : 'rgba(216,205,187,0.6)',
                opacity: !isEditableWeek(thisMonday, logicalTodayYmd)
                  ? 0.4
                  : pressed
                    ? 0.8
                    : 1,
              },
            ]}>
            <MaterialIcons name="content-copy" size={14} color={tf.muted} />
          </Pressable>
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
        {isAgenda && todayCompactItems.length > 0 ? (
          <Text
            style={[styles.summaryMeta, { color: outline, paddingHorizontal: Spacing['2xl'], paddingTop: 6 }]}
            numberOfLines={1}>
            {todayDoneCount > 0
              ? `${todayFootStats.count} 项安排 · ${todayDoneCount} 已完成`
              : `${todayFootStats.count} 项安排`}
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
            <MaterialIcons name="cruelty-free" size={16} color={tf.amberInk} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ color: tf.amberInk, fontWeight: '700', fontSize: 12 }} numberOfLines={1}>
                重新指派「{reassignPending.subject.title}」· 点空档放入
              </Text>
            </View>
            <Text style={{ color: tf.sun, fontWeight: '700' }}>→</Text>
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
            <MaterialIcons name="cruelty-free" size={16} color={tf.amberInk} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ color: tf.amberInk, fontWeight: '700', fontSize: 12 }} numberOfLines={1}>
                已预选「{pendingPlace.title}」· 点空档放入
              </Text>
            </View>
            <Text style={{ color: tf.sun, fontWeight: '700' }}>→</Text>
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
            transform: [{ scale: bodyScale }, { translateY: bodyTranslateY }],
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
                <Pressable
                  onPress={() => goZoom('grid')}
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
                      ? '点开完整课表查看今日安排'
                      : '点开三天视图添加或查看课表'}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          )
        ) : null}

        {isAgenda ? (
          loading && !view ? (
            <ActivityIndicator color={primary} style={{ marginVertical: Spacing.xl }} />
          ) : todayAgendaItems.length === 0 ? (
            <Pressable
              onPress={() => goZoom('grid')}
              style={({ pressed }) => [
                styles.todayEmpty,
                {
                  backgroundColor: surfaceLow,
                  borderColor: gridLineSoft,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}>
              <MaterialIcons name="event-available" size={22} color={primary} />
              <Text style={[styles.todayEmptyTitle, { color: theme.text }]}>今日暂无课程</Text>
              <Text style={[styles.todayEmptyHint, { color: outline }]}>
                点开三天视图添加或查看课表
              </Text>
            </Pressable>
          ) : (
            <View style={[styles.todayAgenda, { maxHeight: placingMode ? 240 : 196 }]}>
              <ScrollView
                nestedScrollEnabled
                showsVerticalScrollIndicator={todayAgendaItems.length > 4}
                keyboardShouldPersistTaps="handled">
                {todayAgendaItems.map((item, index) =>
                  renderCompactRow(item, index, todayAgendaItems),
                )}
              </ScrollView>
              <View style={styles.todayFoot}>
                <View style={[styles.todayFootDot, { backgroundColor: tf.sage }]} />
                <Text style={[styles.todayFootText, { color: tf.faint }]} numberOfLines={1}>
                  已用 {todayFootStats.usedLabel} / 空闲 {todayFootStats.freeLabel}
                </Text>
                <View style={styles.todayFootMini}>
                  {todayCompactItems.slice(0, 5).map((it, i) => {
                    const k = it.habit
                      ? 'habit'
                      : it.virtualTask
                        ? 'todo'
                        : it.placement
                          ? blockKindForPlacement(it.placement, subjects)
                          : 'frog';
                    const c =
                      k === 'frog'
                        ? tf.frog
                        : k === 'habit'
                          ? tf.lily
                          : k === 'todo'
                            ? tf.sun
                            : '#DDE5D4';
                    return (
                      <View
                        key={`ft-${i}`}
                        style={[styles.todayFootMiniDot, { backgroundColor: c }]}
                      />
                    );
                  })}
                </View>
              </View>
            </View>
          )
        ) : null}

        {isGrid ? (
          <>
            {periodIndex !== 0 || centerOverride ? (
              <View style={styles.weekNavCompact}>
                <Pressable
                  onPress={() => goPeriod(-1)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="上一周期"
                  style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1, padding: 4 }]}>
                  <MaterialIcons name="chevron-left" size={18} color={primary} />
                </Pressable>
                <Pressable
                  onPress={() => {
                    setCenterOverride(null);
                    setPeriodIndex(0);
                  }}
                  style={styles.weekTitleHit}>
                  <Text style={[styles.weekSub, { color: primary }]}>
                    {formatThreeDayRangeLabel(centerYmd)} · 回今天
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => goPeriod(1)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="下一周期"
                  style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1, padding: 4 }]}>
                  <MaterialIcons name="chevron-right" size={18} color={primary} />
                </Pressable>
              </View>
            ) : null}

            {loading && !view ? (
              <ActivityIndicator color={primary} style={{ marginVertical: 24 }} />
            ) : view ? (
              <View style={styles.gridFrame}>
                {renderScheduleGrid()}
                <View
                  style={[
                    styles.scFoot,
                    { borderTopColor: isDark ? tf.line : 'rgba(230,221,206,0.55)' },
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
                    本窗 {frogPlaceStats.inGrid}/{Math.max(frogPlaceStats.total, frogPlaceStats.inGrid)}{' '}
                    已入格
                  </Text>
                  <Pressable
                    onPress={() => onCopyLastWeek()}
                    disabled={!isEditableWeek(thisMonday, logicalTodayYmd)}
                    hitSlop={6}
                    accessibilityRole="button"
                    accessibilityLabel="复制上周"
                    style={({ pressed }) => [
                      styles.scFootGrow,
                      {
                        opacity: !isEditableWeek(thisMonday, logicalTodayYmd)
                          ? 0.4
                          : pressed
                            ? 0.7
                            : 1,
                      },
                    ]}>
                    <MaterialIcons name="auto-awesome" size={11} color={tf.muted} />
                    <Text style={[styles.scFootGrowText, { color: tf.muted }]}>复制上周</Text>
                  </Pressable>
                </View>
              </View>
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
        lockedProjectIds={lockedProjectIds}
        preselected={
          placeTarget?.rematerializePreselected ?? pendingPlace ?? null
        }
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
                                Alert.alert(
                                  '取消指派',
                                  `确定取消「${sub.title}」在 ${assignYmd} 的指派吗？`,
                                  [
                                    { text: '保留', style: 'cancel' },
                                    {
                                      text: '取消指派',
                                      style: 'destructive',
                                      onPress: () => {
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
                                      },
                                    },
                                  ],
                                );
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
        visible={!!cellList}
        transparent
        animationType="fade"
        onRequestClose={() => setCellList(null)}>
        <Pressable style={styles.listBackdrop} onPress={() => setCellList(null)}>
          <Pressable
            onPress={() => {}}
            style={[
              styles.listCard,
              shadows.card,
              { backgroundColor: theme.surface, borderColor: theme.outline },
            ]}>
            <Text style={[styles.listTitle, { color: theme.text }]}>
              {(cellList?.placements.length ?? 0) +
                (cellList?.habits.length ?? 0) +
                (cellList?.virtualTasks.length ?? 0) >
              1
                ? '选择本格内容'
                : '本格占用'}
            </Text>
            <ScrollView style={{ maxHeight: 280 }}>
              {(cellList?.habits ?? []).map((h) => (
                <Pressable
                  key={`habit-${h.habitId}`}
                  onPress={() => {
                    setCellList(null);
                    runAfterUiSettles(() => tapVirtualHabit(h));
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
                      { backgroundColor: h.done ? `${outline}66` : primary },
                    ]}
                  />
                  <Text
                    style={{ color: theme.text, flex: 1, fontWeight: '700', fontSize: 14 }}
                    numberOfLines={2}>
                    习惯 · {h.name}
                  </Text>
                  {h.done ? (
                    <MaterialIcons name="check-circle" size={16} color={successTint} />
                  ) : null}
                </Pressable>
              ))}
              {(cellList?.virtualTasks ?? []).map((t) => (
                <Pressable
                  key={`vtask-${t.taskId}`}
                  onPress={() => {
                    setCellList(null);
                    runAfterUiSettles(() => tapVirtualTask(t));
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
                      { backgroundColor: t.done ? `${outline}66` : primary },
                    ]}
                  />
                  <Text
                    style={{ color: theme.text, flex: 1, fontWeight: '700', fontSize: 14 }}
                    numberOfLines={2}>
                    待办 · {t.title}
                  </Text>
                  {t.done ? (
                    <MaterialIcons name="check-circle" size={16} color={successTint} />
                  ) : null}
                </Pressable>
              ))}
              {(cellList?.placements ?? []).map((p) => {
                const sub = resolveSubject(
                  p.subjectKind,
                  p.subjectId,
                  subjects,
                  cellList?.assignYmd ?? '',
                );
                return (
                  <Pressable
                    key={p.id}
                    onPress={() => {
                      setCellList(null);
                      runAfterUiSettles(() => openDetail(p));
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
                        { backgroundColor: sub?.done ? `${outline}66` : primary },
                      ]}
                    />
                    <Text style={{ color: theme.text, flex: 1, fontWeight: '700', fontSize: 14 }} numberOfLines={2}>
                      {sub?.title ?? '青蛙'}
                    </Text>
                    {sub?.done ? <MaterialIcons name="check-circle" size={16} color={successTint} /> : null}
                    <MaterialIcons name="chevron-right" size={18} color={outline} />
                  </Pressable>
                );
              })}
            </ScrollView>
            {cellList?.editable ? (
              <Pressable
                onPress={() => {
                  if (!cellList) return;
                  const slot = cellList.slotIndex;
                  const ymd = cellList.assignYmd;
                  setCellList(null);
                  openPlace(ymd, slot);
                }}
                style={({ pressed }) => [
                  styles.addMoreBtn,
                  {
                    borderColor: todayWashStrong,
                    backgroundColor: todayWash,
                    opacity: pressed ? 0.88 : 1,
                  },
                ]}>
                <MaterialIcons name="add" size={18} color={primary} />
                <Text style={{ color: primary, fontWeight: '800' }}>再添加一只</Text>
              </Pressable>
            ) : null}
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
                const placementId = detail.placement!.id;
                void (async () => {
                  try {
                    await removePlacementSegment(placementId, logicalTodayYmd);
                    setDetail(null);
                    await reload(loadDayYmds, { silent: true });
                    onChanged?.();
                  } catch (err) {
                    toast.error(toUserMessage(err, '移除失败，请稍后重试'));
                  }
                })();
              }
            : undefined
        }
        onCancelAssign={
          detail?.placement
            ? () => {
                const p = detail.placement!;
                void (async () => {
                  try {
                    const assignYmd = ymdForWeekday(p.weekStartYmd, p.weekday);
                    await cancelAssignForPlacementDay(p.id, logicalTodayYmd);
                    setDetail(null);
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

      <Modal
        visible={!!slotNoteEditor}
        transparent
        animationType="fade"
        onRequestClose={() => {
          Keyboard.dismiss();
          setSlotNoteEditor(null);
        }}>
        <KeyboardAvoidingView
          style={styles.noteKav}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={0}>
          <Pressable
            style={styles.noteBackdropFill}
            onPress={() => {
              Keyboard.dismiss();
              setSlotNoteEditor(null);
            }}
          />
          <View
            style={[
              styles.noteCard,
              {
                backgroundColor: theme.surface,
                borderColor: theme.outline,
                paddingBottom:
                  Math.max(insets.bottom, 16) +
                  (Platform.OS === 'android' ? slotNoteKeyboardH : 0),
              },
            ]}>
            <View style={[styles.noteHandle, { backgroundColor: `${outline}55` }]} />
            <Text style={[styles.noteTitle, { color: theme.text }]}>
              {slotNoteEditor && view
                ? `${(() => {
                    const slot = (layout?.timeline ?? []).find(
                      (r) =>
                        r.kind === 'work' && r.startMinutes === slotNoteEditor.startMinutes,
                    );
                    const end =
                      slot && slot.kind === 'work'
                        ? slot.endMinutes
                        : slotNoteEditor.startMinutes + view.axis.slotHours * 60;
                    return formatMinuteRangeLabel(slotNoteEditor.startMinutes, end);
                  })()} 时段备注`
                : '时段备注'}
            </Text>
            <Text style={{ color: outline, fontSize: 13, marginBottom: 8, lineHeight: 18 }}>
              显示在时段下方，最多 {SCHEDULE_SLOT_NOTE_MAX_LEN} 个字（如：学习时间）
            </Text>
            <TextInput
              value={slotNoteEditor?.draft ?? ''}
              onChangeText={(text) =>
                setSlotNoteEditor((prev) =>
                  // 输入中不截断：拼音中间态（如 xuexishijian）会超过 6 字母，
                  // 若此处 slice/maxLength=6，汉字无法上屏。成字后由 onEndEditing/保存再规范化。
                  prev ? { ...prev, draft: text } : prev,
                )
              }
              onEndEditing={(e) => {
                const next = normalizeSlotNote(e.nativeEvent.text);
                setSlotNoteEditor((prev) =>
                  prev ? { ...prev, draft: next } : prev,
                );
              }}
              placeholder="例如：学习"
              placeholderTextColor={outline}
              maxLength={SCHEDULE_SLOT_NOTE_IME_SOFT_MAX}
              autoFocus
              style={[
                styles.noteInput,
                {
                  color: theme.text,
                  borderColor: theme.outline,
                  backgroundColor: surfaceLow,
                },
              ]}
            />
            <Text
              style={{
                color:
                  (slotNoteEditor?.draft ?? '').length > SCHEDULE_SLOT_NOTE_MAX_LEN
                    ? '#dc2626'
                    : outline,
                fontSize: 11,
                alignSelf: 'flex-end',
              }}>
              {(slotNoteEditor?.draft ?? '').length}/{SCHEDULE_SLOT_NOTE_MAX_LEN}
            </Text>
            <View style={styles.noteActions}>
              <Pressable
                onPress={() => void clearSlotNoteEditor()}
                disabled={slotNoteSaving}
                style={({ pressed }) => [
                  styles.noteGhostBtn,
                  { opacity: pressed ? 0.7 : 1 },
                ]}>
                <Text style={{ color: outline, fontWeight: '600' }}>清除</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  Keyboard.dismiss();
                  setSlotNoteEditor(null);
                }}
                style={({ pressed }) => [
                  styles.noteGhostBtn,
                  { opacity: pressed ? 0.7 : 1 },
                ]}>
                <Text style={{ color: outline, fontWeight: '600' }}>取消</Text>
              </Pressable>
              <Pressable
                onPress={() => void saveSlotNoteEditor()}
                disabled={slotNoteSaving}
                style={({ pressed }) => [
                  styles.notePrimaryBtn,
                  { backgroundColor: primary, opacity: slotNoteSaving ? 0.5 : pressed ? 0.9 : 1 },
                ]}>
                {slotNoteSaving ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={{ color: '#fff', fontWeight: '700' }}>保存</Text>
                )}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
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
  todayEmptyTitle: {
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: -0.2,
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
  scFootGrow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  scFootGrowText: {
    fontSize: 10,
    fontWeight: '600',
  },
  gridWrap: { flexDirection: 'row' },
  gridHeaderChrome: {
    zIndex: 2,
  },
  timeGutter: {
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  timeGutterCorner: {
    alignItems: 'flex-end',
    justifyContent: 'flex-end',
  },
  timeCell: {
    justifyContent: 'flex-start',
    alignItems: 'flex-end',
    paddingTop: 0,
    paddingRight: 3,
  },
  timeHourText: {
    fontSize: 9,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.2,
    textAlign: 'right',
    transform: [{ translateY: -2 }],
  },
  noteKav: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(15,23,42,0.45)',
  },
  noteBackdropFill: {
    ...StyleSheet.absoluteFill,
  },
  noteCard: {
    borderTopLeftRadius: Radius.sheet,
    borderTopRightRadius: Radius.sheet,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing['3xl'],
    paddingTop: Spacing.md,
    gap: Spacing.sm,
  },
  noteHandle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    marginBottom: Spacing.sm,
  },
  noteTitle: { fontSize: 17, fontWeight: '800', letterSpacing: -0.3 },
  noteInput: {
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.xl,
    fontSize: 16,
    fontWeight: '600',
  },
  noteActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: Spacing.md,
    marginTop: Spacing.md,
  },
  noteGhostBtn: { paddingVertical: Spacing.xl, paddingHorizontal: Spacing.lg },
  notePrimaryBtn: {
    minWidth: 88,
    height: Layout.minTouchTarget,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing['3xl'],
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
  slotCell: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: StyleSheet.hairlineWidth,
    padding: 2,
    overflow: 'visible',
  },
  block: {
    position: 'absolute',
    left: 1,
    right: 2,
    top: 2,
    borderRadius: 7,
    borderWidth: 1,
    overflow: 'hidden',
    zIndex: 2,
  },
  blockBody: {
    flex: 1,
    paddingHorizontal: 4,
    paddingVertical: 3,
    paddingRight: 12,
    justifyContent: 'flex-start',
  },
  blockBodyHabit: {
    paddingLeft: 10,
  },
  blockTitle: {
    fontWeight: '700',
    fontSize: 11,
    lineHeight: 14,
  },
  blockTitleCompact: {
    fontSize: 9,
    lineHeight: 11,
  },
  blockBodyCompact: {
    paddingVertical: 1,
    paddingHorizontal: 3,
    paddingRight: 10,
  },
  blockMeta: {
    fontSize: 9,
    lineHeight: 12,
    marginTop: 1,
    fontWeight: '500',
  },
  /** 设计稿 `.blk.note`：空格虚线备注 */
  noteBlock: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
    backgroundColor: 'transparent',
  },
  noteBlockText: {
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 12,
  },
  blockCk: {
    position: 'absolute',
    right: 3,
    top: 3,
    width: 7,
    height: 7,
    borderRadius: 4,
    borderWidth: 1,
  },
  /** 完成态勾选略放大，浅底上更易辨认 */
  blockCkDone: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  blockFrogDot: {
    position: 'absolute',
    left: 4,
    top: 6,
    width: 4,
    height: 4,
    borderRadius: 2,
    zIndex: 1,
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
  todayFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingTop: 6,
    paddingBottom: 2,
    paddingHorizontal: 2,
  },
  todayFootDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
  },
  todayFootText: {
    flex: 1,
    fontSize: 10,
    fontWeight: '500',
  },
  todayFootMini: {
    flexDirection: 'row',
    gap: 2,
  },
  todayFootMiniDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#DDE5D4',
  },
  emptyHint: {
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
    paddingHorizontal: 4,
  },
  badge: {
    position: 'absolute',
    top: 3,
    right: 3,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    zIndex: 3,
  },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  nowLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 0,
    /** 压在空格底色上，但低于色块标题，避免挡住字 */
    zIndex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  nowDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginLeft: 0,
  },
  nowBar: {
    flex: 1,
    height: 2,
  },
  nowPill: {
    position: 'absolute',
    left: 6,
    top: -8,
  },
  nowPillText: {
    fontSize: 10,
    fontWeight: '700',
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
  addMoreBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingVertical: Spacing.xl,
    marginTop: Spacing.xs,
  },
});
