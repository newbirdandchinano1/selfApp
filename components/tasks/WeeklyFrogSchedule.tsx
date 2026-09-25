import { Layout, Radius, Spacing } from '@/constants/design-tokens';
import { useAppTheme } from '@/hooks/use-app-theme';
import { getIsLongTermFrog, isFrogDoneForToday } from '@/lib/long-term-task';
import { isFrogSubjectDeleted } from '@/lib/repositories/tasks/frog-completion-events';
import type { ProjectRow } from '@/lib/repositories/projects/project.types';
import type { TaskRow } from '@/lib/repositories/tasks/task.types';
import {
  buildScheduleTimeline,
  computeScheduleSlotLayout,
  formatMinuteRangeLabel,
  formatMinutesAsHm,
  listWorkSlots,
  maxSpanFromSlot,
  placementBlockHeight,
  placementEndMinutes,
  slotStartMinutes,
} from '@/lib/schedule/axis';
import {
  buildVirtualHabitPlacementsForDays,
  type VirtualHabitPlacement,
} from '@/lib/schedule/habit-virtual-placement';
import { getHabits } from '@/lib/repositories/habits/habit';
import { getAllHabitCheckInsMaps } from '@/lib/repositories/habits/habit-check-in';
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
import { logicalYmdToLocalDate, loadTasksDayBoundary } from '@/lib/tasks-logical-day';
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
import { MaterialIcons } from '@expo/vector-icons';
import React from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
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
  type ScheduleSubjectInfo,
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
  /** 青蛙占用；习惯虚拟块时为空 */
  placement: SchedulePlacementRow | null;
  habit: VirtualHabitPlacement | null;
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

function remainSecondsUntil(targetMinutes: number, wall: Date): number {
  const nowMins = wall.getHours() * 60 + wall.getMinutes() + wall.getSeconds() / 60;
  return Math.round((targetMinutes - nowMins) * 60);
}

const TIME_GUTTER = 56;
const DAY_HEADER_H = 48;
/** 横向分页：左=上一周期 / 中=当前 / 右=下一周期 */
const MIDDLE_PAGE = 1;

type SubjectLookup = {
  tasks: TaskRow[];
  projects: ProjectRow[];
  projectFrogIds?: Set<string>;
};

export type SchedulePendingPlace = SchedulePlacePreselected;

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
  onChanged?: () => void;
  onOpenSubject?: (kind: 'task' | 'project', id: string) => void;
  onToggleDone?: (info: {
    kind: 'task' | 'project';
    id: string;
    assignYmd: string;
  }) => void;
  /** 点日程表习惯块：等同小习惯打卡（仅今日） */
  onHabitCheckIn?: (habitId: string) => void;
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

function confirmTogglePlacementDone(
  subject: ScheduleSubjectInfo,
  assignYmd: string,
  onToggleDone: NonNullable<Props['onToggleDone']>,
) {
  const titleLabel = (subject.title ?? '').trim() || '该青蛙';
  const run = () =>
    onToggleDone({
      kind: subject.kind,
      id: subject.id,
      assignYmd,
    });

  // 长期未完成：沿用既有多选项确认（完成任务 / 仅结束当日会话）
  if (!subject.done && getIsLongTermFrog(subject.extraData)) {
    run();
    return;
  }

  if (subject.done) {
    Alert.alert('取消完成？', `确定将「${titleLabel}」标记为未完成吗？`, [
      { text: '取消', style: 'cancel' },
      { text: '取消完成', onPress: run },
    ]);
    return;
  }

  Alert.alert('确认完成？', `确定将「${titleLabel}」标记为已完成吗？`, [
    { text: '取消', style: 'cancel' },
    { text: '完成', onPress: run },
  ]);
}

function dayEditable(ymd: string, logicalTodayYmd: string): boolean {
  return isEditableScheduleDay(ymd, logicalTodayYmd);
}

/** 有任务格子的蓝灰底：任务越多越深；过去日一律灰阶 */
function scheduleBlockColors(
  taskCount: number,
  opts: { isPast: boolean; allDone: boolean; isDark: boolean },
): { backgroundColor: string; borderColor: string } {
  const level = Math.min(4, Math.max(1, Math.round(taskCount))) - 1;
  if (opts.isPast || opts.allDone) {
    const alphas = opts.isDark
      ? [0.28, 0.36, 0.46, 0.58]
      : [0.14, 0.22, 0.30, 0.40];
    const a = alphas[level]!;
    return {
      backgroundColor: opts.isDark
        ? `rgba(100,116,139,${a})`
        : `rgba(148,163,184,${a})`,
      borderColor: opts.isDark ? 'rgba(148,163,184,0.28)' : 'rgba(148,163,184,0.35)',
    };
  }
  const alphas = opts.isDark
    ? [0.18, 0.26, 0.36, 0.48]
    : [0.10, 0.16, 0.24, 0.34];
  const a = alphas[level]!;
  return {
    backgroundColor: opts.isDark
      ? `rgba(96,165,250,${a})`
      : `rgba(0,88,190,${a})`,
    borderColor: opts.isDark ? 'rgba(96,165,250,0.32)' : 'rgba(0,88,190,0.18)',
  };
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
}: Props) {
  const { colors: theme, isDark, shadows } = useAppTheme();
  const primary = theme.primary;
  const outline = theme.textSecondary;
  const surfaceLow = theme.surfaceMuted;
  const gridLineSoft = theme.outline;
  const todayWash = theme.primaryMuted;
  const todayWashStrong = isDark ? 'rgba(96,165,250,0.28)' : 'rgba(0,88,190,0.12)';
  const successTint = theme.secondary;

  /** 0 = 今天居中的三天；±1 切换一整周期（平移 3 天） */
  const [periodIndex, setPeriodIndex] = React.useState(0);
  const centerYmd = React.useMemo(
    () => centerYmdForPeriod(logicalTodayYmd, periodIndex),
    [logicalTodayYmd, periodIndex],
  );
  const dayYmds = React.useMemo(() => threeDayWindow(centerYmd), [centerYmd]);
  /** 预加载左右周期，滑动时邻页也有数据 */
  const loadDayYmds = React.useMemo(() => {
    const set = new Set<string>();
    for (const p of [periodIndex - 1, periodIndex, periodIndex + 1]) {
      for (const d of threeDayWindow(centerYmdForPeriod(logicalTodayYmd, p))) {
        set.add(d);
      }
    }
    return [...set].sort();
  }, [logicalTodayYmd, periodIndex]);
  const thisMonday = React.useMemo(
    () => getWeekStartMondayYmd(logicalTodayYmd),
    [logicalTodayYmd],
  );

  const [view, setView] = React.useState<WeekScheduleView | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [virtualHabits, setVirtualHabits] = React.useState<VirtualHabitPlacement[]>([]);
  const [gridWidth, setGridWidth] = React.useState(0);
  const hPagerRef = React.useRef<ScrollView>(null);
  const headerPagerRef = React.useRef<ScrollView>(null);
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
    editable: boolean;
  } | null>(null);

  const [orphanListOpen, setOrphanListOpen] = React.useState(false);

  /** 点选格子为未入格项重新指派时间 */
  const [reassignPending, setReassignPending] = React.useState<{
    placement: SchedulePlacementRow;
    subject: ScheduleSubjectInfo;
  } | null>(null);

  const [detail, setDetail] = React.useState<{
    placement: SchedulePlacementRow;
    subject: ScheduleSubjectInfo;
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
          Animated.parallel([
            Animated.timing(bodyOpacity, {
              toValue: 1,
              duration: enteringGrid || leavingGrid ? 320 : 260,
              useNativeDriver: true,
            }),
            Animated.spring(bodyScale, {
              toValue: 1,
              friction: 6.5,
              tension: 64,
              useNativeDriver: true,
            }),
            Animated.spring(bodyTranslateY, {
              toValue: 0,
              friction: 7,
              tension: 68,
              useNativeDriver: true,
            }),
          ]).start(() => {
            zoomBusyRef.current = false;
          });
        });
      });
    },
    [bodyOpacity, bodyScale, bodyTranslateY],
  );

  /** 长按项目指派：自动展开课表并提示点选空格 */
  React.useEffect(() => {
    if (!pendingPlace) return;
    goZoom('grid');
    setPeriodIndex(0);
  }, [pendingPlace, goZoom]);

  const loadDaysKey = loadDayYmds.join(',');

  const reload = React.useCallback(
    async (days: string[], opts?: { silent?: boolean }) => {
      if (!opts?.silent) setLoading(true);
      try {
        const [data, habits, checkInsMaps, boundary] = await Promise.all([
          loadScheduleForDayWindow(days, logicalTodayYmd, {
            hydrateRemote: !opts?.silent,
          }),
          getHabits().catch(() => []),
          getAllHabitCheckInsMaps().catch(() => new Map()),
          loadTasksDayBoundary(),
        ]);
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
      } catch (err) {
        console.warn('[WeeklyFrogSchedule] load failed', err);
        if (!opts?.silent) Alert.alert('加载失败', '无法加载日程表');
      } finally {
        if (!opts?.silent) setLoading(false);
      }
    },
    [logicalTodayYmd],
  );

  const loadDayYmdsRef = React.useRef(loadDayYmds);
  loadDayYmdsRef.current = loadDayYmds;

  React.useEffect(() => {
    void reload(loadDayYmds);
  }, [loadDaysKey, reload, loadDayYmds]);

  // 任意本地课表变更（含设置弹窗改轴）立即静默重载
  React.useEffect(() => {
    return subscribeFrogScheduleChanged(() => {
      void reload(loadDayYmdsRef.current, { silent: true });
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
  const rowHeights = layout?.rowHeights ?? [];
  const totalBodyH = layout?.totalBodyH ?? 52;
  const fixedBodyH = layout?.fixedBodyH ?? 52;
  const bodyScrollable = layout?.scrollable ?? false;
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

  /** 合并色块：仅在起点格渲染 */
  const blockStarts = React.useMemo(() => {
    const map = new Map<CellKey, SchedulePlacementRow[]>();
    if (!view) return map;
    for (const p of view.placements) {
      if (p.orphaned || p.startSlotIndex == null) continue;
      const ymd = ymdForWeekday(p.weekStartYmd, p.weekday);
      const key = cellKey(ymd, p.startSlotIndex);
      const list = map.get(key) ?? [];
      list.push(p);
      map.set(key, list);
    }
    return map;
  }, [view]);

  const nowLineTop = React.useMemo(() => {
    if (!view || !layout || !dayYmds.includes(logicalTodayYmd)) return null;
    const mins = wallNow.getHours() * 60 + wallNow.getMinutes();
    if (mins < view.axis.startMinutes || mins > view.axis.endMinutes) return null;
    let top = 0;
    for (let i = 0; i < layout.timeline.length; i++) {
      const row = layout.timeline[i]!;
      const h = layout.rowHeights[i] ?? 0;
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
  }, [view, layout, dayYmds, logicalTodayYmd, wallNow]);

  const goPeriod = (delta: number) => {
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
    } catch (err) {
      Alert.alert('保存失败', err instanceof Error ? err.message : '请稍后重试');
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
    } catch (err) {
      Alert.alert('清除失败', err instanceof Error ? err.message : '请稍后重试');
    } finally {
      setSlotNoteSaving(false);
    }
  }, [slotNoteEditor]);

  const orphanedPlacements = React.useMemo(() => {
    if (!view) return [] as SchedulePlacementRow[];
    return view.placements.filter((p) => p.orphaned || p.startSlotIndex == null);
  }, [view]);

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
    if (placeTarget.rematerializePlacementId) {
      await rematerializeOrphanedPlacement({
        placementId: placeTarget.rematerializePlacementId,
        assignYmd: placeTarget.assignYmd,
        startSlotIndex: placeTarget.startSlotIndex,
        spanSlots: result.spanSlots,
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
      startSlotIndex: placeTarget.startSlotIndex,
      spanSlots: result.spanSlots,
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
    onChanged?.();
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
    editable: boolean,
  ) => {
    setCellList({
      assignYmd,
      slotIndex,
      placements: uniquePlacementsBySubject(list),
      habits: [...habits],
      editable,
    });
  };

  const tapVirtualHabit = React.useCallback(
    (habit: VirtualHabitPlacement) => {
      if (habit.assignYmd !== logicalTodayYmd) {
        Alert.alert(habit.name, '未到打卡日，请到当天再打卡。可在习惯编辑页关闭入格。');
        return;
      }
      if (habit.done) {
        Alert.alert(habit.name, '今日已达标。取消入格请到习惯编辑页关闭提醒。');
        return;
      }
      onHabitCheckIn?.(habit.habitId);
    },
    [logicalTodayYmd, onHabitCheckIn],
  );

  const handleCellPress = (assignYmd: string, slotIndex: number) => {
    const key = cellKey(assignYmd, slotIndex);
    const list = placementsByCell.get(key) ?? [];
    const habits = habitsByCell.get(key) ?? [];
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

    if (list.length === 0 && habits.length === 0) {
      if (editable) openPlace(assignYmd, slotIndex);
      return;
    }
    /** 预选入格模式下，已占用格仍允许再添加 */
    if (pendingPlace && editable) {
      openPlace(assignYmd, slotIndex);
      return;
    }
    const unique = uniquePlacementsBySubject(list);
    const totalItems = unique.length + habits.length;
    /** 多只 / 含习惯 / 只读：先弹出列表 */
    if (totalItems > 1 || !editable) {
      openCellList(assignYmd, slotIndex, list, habits, editable);
      return;
    }
    if (habits.length === 1 && unique.length === 0) {
      tapVirtualHabit(habits[0]!);
      return;
    }
    const display = pickDisplayPlacement(unique, subjects, assignYmd);
    if (!display?.primary.subjectKind || !onToggleDone) return;
    const subject = resolveSubject(
      display.primary.subjectKind,
      display.primary.subjectId,
      subjects,
      assignYmd,
    );
    if (!subject) return;
    confirmTogglePlacementDone(subject, assignYmd, onToggleDone);
  };

  const handleCellLongPress = (assignYmd: string, slotIndex: number) => {
    if (reassignPending) {
      handleCellPress(assignYmd, slotIndex);
      return;
    }
    const key = cellKey(assignYmd, slotIndex);
    const list = placementsByCell.get(key) ?? [];
    const habits = habitsByCell.get(key) ?? [];
    const editable = dayEditable(assignYmd, logicalTodayYmd);
    if (list.length === 0 && habits.length === 0) {
      if (editable) openPlace(assignYmd, slotIndex);
      return;
    }
    openCellList(assignYmd, slotIndex, list, habits, editable);
  };

  const openDetail = (p: SchedulePlacementRow) => {
    const assignYmd = ymdForWeekday(p.weekStartYmd, p.weekday);
    const subject = resolveSubject(p.subjectKind, p.subjectId, subjects, assignYmd);
    if (!subject) return;
    setCellList(null);
    setOrphanListOpen(false);
    setDetail({ placement: p, subject });
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
        Alert.alert(
          '复制完成',
          `成功 ${result.copied} 条${result.overwritten ? `（已覆盖 ${result.overwritten}）` : ''}${skipMsg}`,
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
        Alert.alert('复制失败', err instanceof Error ? err.message : '请稍后重试');
      }
    };
    void run(false);
  };

  const todayHasPlacement =
    (view?.placements.some((p) => {
      if (p.orphaned || p.startSlotIndex == null) return false;
      return ymdForWeekday(p.weekStartYmd, p.weekday) === logicalTodayYmd;
    }) ?? false) ||
    virtualHabits.some((h) => h.assignYmd === logicalTodayYmd);

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
        title: h.name,
        done: h.done,
        timeLabel: formatMinutesAsHm(startMins),
        endLabel: formatMinutesAsHm(endMins),
        startMins,
        endMins,
      });
    }
    items.sort((a, b) => {
      const sa = a.placement?.startSlotIndex ?? a.habit?.startSlotIndex ?? 0;
      const sb = b.placement?.startSlotIndex ?? b.habit?.startSlotIndex ?? 0;
      if (sa !== sb) return sa - sb;
      return a.title.localeCompare(b.title, 'zh');
    });
    return items;
  }, [view, logicalTodayYmd, subjects, virtualHabits]);

  const minimalFocus = React.useMemo(() => {
    const nowMins =
      wallNow.getHours() * 60 + wallNow.getMinutes() + wallNow.getSeconds() / 60;
    const timeline = view ? buildScheduleTimeline(view.axis) : [];
    const workSlots = view ? listWorkSlots(view.axis) : [];

    /** 已超时：时段已结束且未完成（按格宽轴，而非任务自身跨度「仍在进行」） */
    const overdueItems = todayCompactItems.filter(
      (x) => !x.done && x.endMins <= nowMins,
    );

    const mergeFocusItems = (slotItems: TodayCompactItem[]) => {
      const byId = new Map<string, TodayCompactItem>();
      for (const x of overdueItems) {
        const id = x.placement?.id ?? (x.habit ? `habit:${x.habit.habitId}` : x.title);
        byId.set(id, x);
      }
      for (const x of slotItems) {
        const id = x.placement?.id ?? (x.habit ? `habit:${x.habit.habitId}` : x.title);
        byId.set(id, x);
      }
      return [...byId.values()].sort((a, b) => {
        const sa = a.placement?.startSlotIndex ?? a.habit?.startSlotIndex ?? 0;
        const sb = b.placement?.startSlotIndex ?? b.habit?.startSlotIndex ?? 0;
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
          remainSecondsUntil(currentSlot.endMinutes, wallNow),
        ),
      };
    }

    // 断开时段（如午休）：不可入格，展示断开本身 + 超时项 + 下一段可排指派
    const currentBreak = timeline.find(
      (r) =>
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
          ? formatRemainLabel(remainSecondsUntil(nextSlot.startMinutes, wallNow), {
              untilStart: true,
            })
          : formatRemainLabel(remainSecondsUntil(currentBreak.endMinutes, wallNow)),
        breakLabel: currentBreak.label?.trim() || '休息',
      };
    }

    if (nextSlot) {
      return {
        kind: 'upcoming' as const,
        items: mergeFocusItems(itemsStartingInSlot(nextSlot.slotIndex)),
        rangeLabel: `${formatMinutesAsHm(nextSlot.startMinutes)}–${formatMinutesAsHm(nextSlot.endMinutes)}`,
        countdownLabel: formatRemainLabel(
          remainSecondsUntil(nextSlot.startMinutes, wallNow),
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
  }, [todayCompactItems, wallNow, view]);

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
    const dayNum = ymd.slice(8);
    return (
      <View
        key={`h-${ymd}`}
        style={[
          styles.dayHeader,
          {
            width,
            height: DAY_HEADER_H,
            borderColor: gridLineSoft,
            backgroundColor: isTodayCol
              ? todayWash
              : isPastCol
                ? isDark
                  ? 'rgba(51,65,85,0.45)'
                  : 'rgba(226,232,240,0.85)'
                : isDark
                  ? theme.surface
                  : theme.surfaceSubtle,
            opacity: isPastCol ? 0.72 : 1,
          },
        ]}>
        <Text
          style={[
            styles.dayHeaderWeekday,
            { color: isTodayCol ? primary : outline },
          ]}>
          周{WEEKDAY_SHORT_LABELS[weekday - 1]}
        </Text>
        <View
          style={[
            styles.dayHeaderDatePill,
            isTodayCol && { backgroundColor: primary },
          ]}>
          <Text
            style={[
              styles.dayHeaderDate,
              {
                color: isTodayCol
                  ? theme.onPrimary
                  : isPastCol
                    ? outline
                    : theme.text,
              },
            ]}>
            {dayNum}
          </Text>
        </View>
      </View>
    );
  };

  const renderDaySlots = (ymd: string, width: number) => {
    if (!view || !layout) return null;
    const isTodayCol = ymd === logicalTodayYmd;
    const isPastCol = ymd < logicalTodayYmd;
    const editable = dayEditable(ymd, logicalTodayYmd);
    const breakBg = isDark ? 'rgba(51,65,85,0.55)' : 'rgba(226,232,240,0.95)';
    const breakFg = isDark ? 'rgba(148,163,184,0.95)' : 'rgba(100,116,139,0.95)';
    const emptyCellBg = isPastCol
      ? isDark
        ? 'rgba(51,65,85,0.4)'
        : 'rgba(226,232,240,0.7)'
      : isTodayCol
        ? todayWash
        : isDark
          ? 'rgba(15,23,42,0.35)'
          : theme.surfaceSubtle;
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
                    },
                  ]}>
                  <Text
                    style={{
                      color: breakFg,
                      fontSize: 11,
                      fontWeight: '700',
                      textAlign: 'center',
                    }}
                    numberOfLines={2}>
                    {row.label}
                  </Text>
                </View>
              );
            }

            const slotIndex = row.slotIndex;
            const key = cellKey(ymd, slotIndex);
            const covering = placementsByCell.get(key) ?? [];
            const starts = blockStarts.get(key) ?? [];
            const cellHabits = habitsByCell.get(key) ?? [];
            const isEmpty = covering.length === 0 && cellHabits.length === 0;
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
                  },
                ]}>
                {(() => {
                  if (starts.length === 0 && cellHabits.length === 0) return null;
                  const display =
                    starts.length > 0
                      ? pickDisplayPlacement(starts, subjects, ymd)
                      : null;
                  const primaryHabit =
                    !display && cellHabits.length > 0
                      ? [...cellHabits].sort((a, b) => Number(a.done) - Number(b.done))[0]
                      : null;
                  const spanSlots = display?.primary.spanSlots ?? 1;
                  const startIdx =
                    display?.primary.startSlotIndex ??
                    primaryHabit?.startSlotIndex ??
                    slotIndex;
                  const h =
                    placementBlockHeight(view.axis, layout, startIdx, spanSlots) - 6;
                  const titleLines = Math.max(1, Math.min(3, spanSlots));
                  const unfinishedFrogTitles = listUnfinishedTitlesInCell(
                    covering,
                    subjects,
                    ymd,
                  );
                  const unfinishedHabitTitles = cellHabits
                    .filter((x) => !x.done)
                    .map((x) => x.name);
                  const unfinishedTitles = [
                    ...unfinishedFrogTitles,
                    ...unfinishedHabitTitles,
                  ];
                  const showUnfinished =
                    unfinishedTitles.length > 0 ? unfinishedTitles : null;
                  const titleDone = !showUnfinished;
                  const taskCount =
                    uniquePlacementsBySubject(starts).length + cellHabits.length;
                  const allDone =
                    (display?.done ?? true) && cellHabits.every((x) => x.done);
                  const fill = scheduleBlockColors(taskCount, {
                    isPast: isPastCol,
                    allDone,
                    isDark,
                  });
                  const titleStyle = [
                    styles.blockTitle,
                    {
                      color: isPastCol || titleDone ? outline : theme.text,
                      textDecorationLine: titleDone
                        ? ('line-through' as const)
                        : ('none' as const),
                      fontSize: h < 40 ? 11 : 12,
                    },
                  ];
                  const fallbackTitle =
                    display?.title ?? primaryHabit?.name ?? '日程';
                  return (
                    <View
                      key={display?.primary.id ?? `habit-${primaryHabit?.habitId}`}
                      pointerEvents="none"
                      style={[
                        styles.block,
                        {
                          height: Math.max(20, h),
                          backgroundColor: fill.backgroundColor,
                          borderColor: fill.borderColor,
                        },
                      ]}>
                      <View style={styles.blockBody}>
                        {showUnfinished && showUnfinished.length > 1 && !isPastCol ? (
                          <ScheduleCellTitleRotator
                            titles={showUnfinished}
                            numberOfLines={1}
                            style={titleStyle}
                          />
                        ) : (
                          <Text numberOfLines={titleLines} style={titleStyle}>
                            {showUnfinished?.[0] ?? fallbackTitle}
                          </Text>
                        )}
                        {titleDone ? (
                          <MaterialIcons
                            name="check-circle"
                            size={14}
                            color={successTint}
                            style={styles.blockCheck}
                          />
                        ) : null}
                      </View>
                    </View>
                  );
                })()}

                {(() => {
                  const unfinishedFrogs = countUnfinishedInCell(covering, subjects, ymd);
                  const unfinishedHabits = cellHabits.filter((x) => !x.done).length;
                  const unfinished = unfinishedFrogs + unfinishedHabits;
                  if (unfinished <= 1 || isPastCol) return null;
                  return (
                    <View style={[styles.badge, { backgroundColor: primary }]}>
                      <Text style={styles.badgeText}>{unfinished}</Text>
                    </View>
                  );
                })()}

                {isEmpty &&
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
                  {
                    backgroundColor: isDark ? '#f87171' : '#fca5a5',
                  },
                ]}
              />
              <View
                style={[
                  styles.nowBar,
                  {
                    backgroundColor: isDark ? '#f87171' : '#fca5a5',
                  },
                ]}
              />
              <View style={styles.nowPill}>
                <Text
                  style={[
                    styles.nowPillText,
                    { color: isDark ? '#fca5a5' : '#ef4444' },
                  ]}>
                  现在
                </Text>
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
        <View style={[styles.timeGutterCorner, { width: TIME_GUTTER, height: DAY_HEADER_H }]}>
          <Text style={[styles.timeGutterCornerLabel, { color: outline }]}>时段</Text>
        </View>
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
          if (row.kind === 'break') {
            return (
              <View
                key={`tg-break-${row.startMinutes}-${rowIndex}`}
                style={[
                  styles.timeCell,
                  {
                    height: rowH,
                    borderColor: gridLineSoft,
                    backgroundColor: isDark ? 'rgba(51,65,85,0.4)' : 'rgba(226,232,240,0.7)',
                    justifyContent: 'center',
                  },
                ]}>
                <Text
                  style={[styles.timeRangeText, { color: outline, fontSize: 9 }]}
                  numberOfLines={2}>
                  {row.label}
                </Text>
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
              <View style={styles.timeLabelBlock}>
                <Text style={[styles.timeRangeText, { color: outline }]}>{rangeLabel}</Text>
                {note ? (
                  <Text style={[styles.timeSlotNote, { color: primary }]} numberOfLines={2}>
                    {note}
                  </Text>
                ) : null}
              </View>
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

    const body = bodyScrollable ? (
      <ScrollView
        style={{ height: fixedBodyH }}
        nestedScrollEnabled
        showsVerticalScrollIndicator
        keyboardShouldPersistTaps="handled">
        {bodyRow}
      </ScrollView>
    ) : (
      <View style={{ height: fixedBodyH, overflow: 'hidden' }}>{bodyRow}</View>
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
  ) => (
    <Pressable
      key={item.placement?.id ?? `habit-${item.habit?.habitId}-${item.startMins}`}
      onPress={() => {
        if (item.habit) {
          tapVirtualHabit(item.habit);
          return;
        }
        if (item.placement) openDetail(item.placement);
      }}
      accessibilityRole="button"
      accessibilityLabel={`${item.timeLabel} ${item.title}${item.done ? '，已完成' : ''}`}
      style={({ pressed }) => [
        opts?.dense ? styles.todayRowDense : styles.todayRow,
        index < list.length - 1 &&
          item.done && {
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: gridLineSoft,
          },
        index < list.length - 1 &&
          !item.done && {
            marginBottom: 2,
          },
        item.done
          ? {
              opacity: pressed ? 0.4 : 0.48,
            }
          : {
              backgroundColor: isDark ? 'rgba(96,165,250,0.10)' : 'rgba(0,88,190,0.07)',
              borderRadius: Radius.sm,
              opacity: pressed ? 0.88 : 1,
            },
      ]}>
      <View style={styles.todayTimeCol}>
        <Text
          style={[
            styles.todayTimeStart,
            { color: item.done ? outline : primary },
          ]}>
          {item.timeLabel}
        </Text>
        <Text
          style={[
            styles.todayTimeEnd,
            { color: outline, opacity: item.done ? 0.85 : 1 },
          ]}>
          {item.endLabel}
        </Text>
      </View>
      <View
        style={[
          styles.todayRail,
          !item.done && styles.todayRailActive,
          {
            backgroundColor: item.done ? `${outline}66` : primary,
          },
        ]}
      />
      <View style={styles.todayRowBody}>
        <Text
          style={[
            styles.todayRowTitle,
            !item.done && styles.todayRowTitleActive,
            {
              color: item.done ? outline : theme.text,
              textDecorationLine: item.done ? 'line-through' : 'none',
            },
          ]}
          numberOfLines={opts?.dense ? 1 : 2}>
          {item.habit ? `习惯 · ${item.title}` : item.title}
        </Text>
      </View>
      {item.done ? (
        <MaterialIcons name="check-circle" size={18} color={outline} />
      ) : (
        <MaterialIcons name="chevron-right" size={18} color={primary} />
      )}
    </Pressable>
  );

  const headerTitle =
    zoomMode === 'grid' ? '日程表' : zoomMode === 'agenda' ? '今日日程' : '此刻';
  const headerIcon =
    zoomMode === 'grid' ? 'view-week' : zoomMode === 'agenda' ? 'today' : 'schedule';

  const zoomActionBtn = (
    icon: keyof typeof MaterialIcons.glyphMap,
    label: string,
    onPress: () => void,
    accent?: boolean,
  ) => (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.iconActionBtn,
        {
          backgroundColor: accent ? todayWash : surfaceLow,
          opacity: pressed ? 0.75 : 1,
        },
      ]}>
      <MaterialIcons name={icon} size={18} color={accent ? primary : outline} />
    </Pressable>
  );

  return (
    <View style={styles.section}>
      <View
        style={
          isGrid
            ? sectionCardStyle
            : [
                styles.summaryCard,
                shadows.card,
                {
                  backgroundColor: theme.surface,
                  borderColor: theme.outline,
                },
              ]
        }>
        <View
          style={[
            styles.headerRow,
            { marginBottom: isGrid || isAgenda || isMinimal || !loading ? Spacing.md : 0 },
          ]}>
          <View style={styles.titleRow}>
            <View style={[styles.titleIconWrap, { backgroundColor: todayWash }]}>
              <MaterialIcons name={headerIcon} size={18} color={primary} />
            </View>
            <View style={styles.titleTextCol}>
              <Text style={[styles.sectionTitle, { color: theme.text }]}>
                {headerTitle}
              </Text>
              {isMinimal && minimalFocus.kind !== 'empty' ? (
                <Text style={[styles.summaryMeta, { color: outline }]} numberOfLines={1}>
                  {minimalFocus.kind === 'finished'
                    ? minimalFocus.countdownLabel
                    : minimalFocus.kind === 'break'
                      ? `${minimalFocus.breakLabel} ${minimalFocus.rangeLabel} · ${minimalFocus.countdownLabel}`
                      : `${minimalFocus.rangeLabel} · ${minimalFocus.countdownLabel}`}
                </Text>
              ) : null}
              {isAgenda && todayCompactItems.length > 0 ? (
                <Text style={[styles.summaryMeta, { color: outline }]} numberOfLines={1}>
                  {todayDoneCount > 0
                    ? `${todayDoneCount}/${todayCompactItems.length} 已完成`
                    : `${todayCompactItems.length} 节安排`}
                </Text>
              ) : null}
            </View>
          </View>
          <View style={styles.headerActions}>
            {isMinimal && todayCompactItems.length === 0 && !(loading && !view) ? (
              <Text style={[styles.summaryMeta, { color: outline }]}>暂无安排</Text>
            ) : null}
            {isAgenda && todayCompactItems.length === 0 && !(loading && !view) ? (
              <Text style={[styles.summaryMeta, { color: outline }]}>暂无安排</Text>
            ) : null}
            {isGrid && orphanedPlacements.length > 0 ? (
              <Pressable
                onPress={() => setOrphanListOpen(true)}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel={`查看未入格任务 ${orphanedPlacements.length} 项`}
                style={[styles.orphanChip, { backgroundColor: `${theme.danger}14` }]}>
                <Text style={{ color: theme.danger, fontSize: 12, fontWeight: '700' }}>
                  未入格 {orphanedPlacements.length}
                </Text>
              </Pressable>
            ) : null}
            {isGrid ? (
              <Pressable
                onPress={() => onCopyLastWeek()}
                disabled={!isEditableWeek(thisMonday, logicalTodayYmd)}
                accessibilityRole="button"
                accessibilityLabel="复制上周"
                style={({ pressed }) => [
                  styles.iconActionBtn,
                  {
                    backgroundColor: todayWash,
                    opacity: !isEditableWeek(thisMonday, logicalTodayYmd)
                      ? 0.4
                      : pressed
                        ? 0.8
                        : 1,
                  },
                ]}>
                <MaterialIcons name="content-copy" size={16} color={primary} />
              </Pressable>
            ) : null}
            <Pressable
              onPress={() => setSettingsOpen(true)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="课表设置"
              style={({ pressed }) => [
                styles.iconActionBtn,
                {
                  backgroundColor: surfaceLow,
                  opacity: pressed ? 0.8 : 1,
                },
              ]}>
              <MaterialIcons name="tune" size={16} color={outline} />
            </Pressable>
            {isMinimal ? (
              <>
                {zoomActionBtn('expand-more', '下拉展开今日日程', () => goZoom('agenda'))}
                {zoomActionBtn('zoom-out-map', '放大为完整日程表', () => goZoom('grid'), true)}
              </>
            ) : null}
            {isAgenda ? (
              <>
                {zoomActionBtn('expand-less', '上拉收起为此刻', () => goZoom('minimal'))}
                {zoomActionBtn('zoom-out-map', '放大为完整日程表', () => goZoom('grid'), true)}
              </>
            ) : null}
            {isGrid
              ? zoomActionBtn('close-fullscreen', '收起日程表', () => goZoom('agenda'))
              : null}
          </View>
        </View>

        {reassignPending ? (
          <View
            style={[
              styles.pendingBanner,
              {
                backgroundColor: `${theme.danger}12`,
                borderColor: `${theme.danger}33`,
              },
            ]}>
            <View style={[styles.pendingIconWrap, { backgroundColor: `${theme.danger}22` }]}>
              <MaterialIcons name="schedule" size={18} color={theme.danger} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ color: theme.danger, fontWeight: '800', fontSize: 13 }} numberOfLines={1}>
                重新指派：{reassignPending.subject.title}
              </Text>
              <Text style={{ color: outline, fontSize: 12, marginTop: 2, lineHeight: 16 }}>
                点选今天或未来的格子以落入时段
              </Text>
            </View>
            <Pressable
              onPress={() => setReassignPending(null)}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="取消重新指派"
              style={styles.pendingClose}>
              <MaterialIcons name="close" size={20} color={outline} />
            </Pressable>
          </View>
        ) : pendingPlace ? (
          <View
            style={[
              styles.pendingBanner,
              {
                backgroundColor: todayWash,
                borderColor: todayWashStrong,
              },
            ]}>
            <View style={[styles.pendingIconWrap, { backgroundColor: `${primary}22` }]}>
              <MaterialIcons name="touch-app" size={18} color={primary} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ color: primary, fontWeight: '800', fontSize: 13 }} numberOfLines={1}>
                点选格子放置：{pendingPlace.title}
              </Text>
              <Text style={{ color: outline, fontSize: 12, marginTop: 2, lineHeight: 16 }}>
                点空格或已有占用格即可入格
              </Text>
            </View>
            <Pressable
              onPress={() => onClearPendingPlace?.()}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="取消放置"
              style={styles.pendingClose}>
              <MaterialIcons name="close" size={20} color={outline} />
            </Pressable>
          </View>
        ) : null}

        <Animated.View
          style={{
            opacity: bodyOpacity,
            transform: [{ scale: bodyScale }, { translateY: bodyTranslateY }],
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
          ) : todayCompactItems.length === 0 ? (
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
            <View style={[styles.todayAgenda, { maxHeight: 196 }]}>
              <ScrollView
                nestedScrollEnabled
                showsVerticalScrollIndicator={todayCompactItems.length > 4}
                keyboardShouldPersistTaps="handled">
                {todayCompactItems.map((item, index) =>
                  renderCompactRow(item, index, todayCompactItems),
                )}
              </ScrollView>
            </View>
          )
        ) : null}

        {isGrid ? (
          <>
            <View style={[styles.weekNav, { backgroundColor: surfaceLow }]}>
              <Pressable
                onPress={() => goPeriod(-1)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="上一周期"
                style={({ pressed }) => [
                  styles.navBtn,
                  { opacity: pressed ? 0.7 : 1, backgroundColor: theme.surface },
                ]}>
                <MaterialIcons name="chevron-left" size={22} color={primary} />
              </Pressable>
              <Pressable onPress={() => setPeriodIndex(0)} style={styles.weekTitleHit}>
                <Text style={[styles.weekTitle, { color: theme.text }]}>
                  {formatThreeDayRangeLabel(centerYmd)}
                </Text>
                {periodIndex !== 0 ? (
                  <Text style={[styles.weekSub, { color: primary }]}>回今天</Text>
                ) : (
                  <Text style={[styles.weekSub, { color: outline }]}>昨 · 今 · 明</Text>
                )}
              </Pressable>
              <Pressable
                onPress={() => goPeriod(1)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="下一周期"
                style={({ pressed }) => [
                  styles.navBtn,
                  { opacity: pressed ? 0.7 : 1, backgroundColor: theme.surface },
                ]}>
                <MaterialIcons name="chevron-right" size={22} color={primary} />
              </Pressable>
            </View>

            {loading && !view ? (
              <ActivityIndicator color={primary} style={{ marginVertical: 24 }} />
            ) : view ? (
              <View style={[styles.gridFrame, { borderColor: gridLineSoft }]}>
                {renderScheduleGrid()}
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
                                            onChanged?.();
                                          } catch (err) {
                                            Alert.alert(
                                              '取消失败',
                                              err instanceof Error ? err.message : '请稍后重试',
                                            );
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
              {(cellList?.placements.length ?? 0) + (cellList?.habits.length ?? 0) > 1
                ? '选择本格内容'
                : '本格占用'}
            </Text>
            <ScrollView style={{ maxHeight: 280 }}>
              {(cellList?.habits ?? []).map((h) => (
                <Pressable
                  key={`habit-${h.habitId}`}
                  onPress={() => {
                    setCellList(null);
                    tapVirtualHabit(h);
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
                    onPress={() => openDetail(p)}
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
        axis={view?.axis ?? { startMinutes: 480, endMinutes: 1320, slotHours: 2, breaks: [] }}
        subject={detail?.subject ?? null}
        editable={
          !!detail &&
          dayEditable(ymdForWeekday(detail.placement.weekStartYmd, detail.placement.weekday), logicalTodayYmd)
        }
        onToggleDone={() => {
          if (!detail || !onToggleDone) return;
          const assignYmd = ymdForWeekday(detail.placement.weekStartYmd, detail.placement.weekday);
          onToggleDone({
            kind: detail.placement.subjectKind,
            id: detail.placement.subjectId,
            assignYmd,
          });
          setDetail(null);
        }}
        onRemoveSegment={() => {
          if (!detail) return;
          void (async () => {
            try {
              await removePlacementSegment(detail.placement.id, logicalTodayYmd);
              setDetail(null);
              await reload(loadDayYmds, { silent: true });
              onChanged?.();
            } catch (err) {
              Alert.alert('移除失败', err instanceof Error ? err.message : '请稍后重试');
            }
          })();
        }}
        onCancelAssign={() => {
          if (!detail) return;
          void (async () => {
            try {
              await cancelAssignForPlacementDay(detail.placement.id, logicalTodayYmd);
              setDetail(null);
              await reload(loadDayYmds, { silent: true });
              onChanged?.();
            } catch (err) {
              Alert.alert('取消失败', err instanceof Error ? err.message : '请稍后重试');
            }
          })();
        }}
        onReassignTime={
          detail && (detail.placement.orphaned || detail.placement.startSlotIndex == null)
            ? () => startReassignTime(detail.placement, detail.subject)
            : undefined
        }
        onEdit={() => {
          if (!detail) return;
          onOpenSubject?.(detail.placement.subjectKind, detail.placement.subjectId);
          setDetail(null);
        }}
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
  pendingIconWrap: {
    width: 32,
    height: 32,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pendingClose: {
    width: Layout.minTouchTarget,
    height: Layout.minTouchTarget,
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
  weekNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.lg,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.xs,
    paddingVertical: Spacing.xs,
  },
  navBtn: {
    width: Layout.minTouchTarget,
    height: Layout.minTouchTarget,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekTitleHit: { alignItems: 'center', gap: 2, flex: 1 },
  weekTitle: { fontSize: 15, fontWeight: '800', letterSpacing: -0.2 },
  weekSub: { fontSize: 12, fontWeight: '600' },
  gridFrame: {
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  gridWrap: { flexDirection: 'row' },
  gridHeaderChrome: {
    zIndex: 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  timeGutter: {
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  timeGutterCorner: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  timeGutterCornerLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  timeCell: {
    justifyContent: 'center',
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.xs,
  },
  timeLabelBlock: {
    gap: 2,
    alignItems: 'center',
    width: '100%',
  },
  timeRangeText: {
    fontSize: 11,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.2,
    textAlign: 'center',
  },
  timeSlotNote: {
    fontSize: 10,
    fontWeight: '700',
    lineHeight: 12,
    letterSpacing: 0.1,
    textAlign: 'center',
  },
  noteKav: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(15,23,42,0.45)',
  },
  noteBackdropFill: {
    ...StyleSheet.absoluteFillObject,
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
    justifyContent: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 2,
  },
  dayHeaderWeekday: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  dayHeaderDatePill: {
    minWidth: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  dayHeaderDate: {
    fontSize: 14,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  slotCell: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    padding: 2,
    overflow: 'visible',
  },
  block: {
    position: 'absolute',
    left: 2,
    right: 2,
    top: 2,
    borderRadius: Radius.xs,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    zIndex: 2,
  },
  blockBody: {
    flex: 1,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    justifyContent: 'flex-start',
  },
  blockTitle: { fontWeight: '700' },
  blockCheck: { position: 'absolute', right: 4, bottom: 2 },
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
