import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { isFrogDoneForToday } from '@/lib/long-term-task';
import { isFrogSubjectDeleted } from '@/lib/repositories/tasks/frog-completion-events';
import type { ProjectRow } from '@/lib/repositories/projects/project.types';
import type { TaskRow } from '@/lib/repositories/tasks/task.types';
import {
  computeScheduleSlotLayout,
  formatMinutesAsHm,
  maxSpanFromSlot,
  placementEndMinutes,
  slotStartMinutes,
} from '@/lib/schedule/axis';
import {
  centerYmdForPeriod,
  formatThreeDayRangeLabel,
  getWeekStartMondayYmd,
  isEditableWeek,
  threeDayWindow,
  WEEKDAY_SHORT_LABELS,
  weekdayFromYmd,
  ymdForWeekday,
} from '@/lib/schedule/week';
import type { SchedulePlacementRow } from '@/lib/schedule/types';
import {
  cancelAssignForPlacementDay,
  copyPreviousWeekToThisWeek,
  loadScheduleForDayWindow,
  placeFrogOnSchedule,
  removePlacementSegment,
  type WeekScheduleView,
} from '@/lib/schedule-service';
import { subscribeFrogScheduleChanged } from '@/lib/schedule-events';
import { useSettingsDrawer } from '@/components/settings-drawer/settings-drawer-context';
import { MaterialIcons } from '@expo/vector-icons';
import React from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  LayoutAnimation,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  UIManager,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}
import {
  SchedulePlaceFrogSheet,
  type SchedulePlacePreselected,
  type SchedulePlaceResult,
} from '@/components/tasks/SchedulePlaceFrogSheet';
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
  SCHEDULE_SLOT_NOTE_MAX_LEN,
  type ScheduleSlotNotesMap,
} from '@/lib/schedule/slot-notes';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const TIME_GUTTER = 48;
const DAY_HEADER_H = 40;
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
  onOpenSettings?: () => void;
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

/** 同一格内多占用：未完成优先的第一只 */
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
  return {
    primary: first.p,
    count: list.length,
    done: first.done,
    title: first.sub?.title ?? '青蛙',
  };
}

function dayEditable(ymd: string, logicalTodayYmd: string): boolean {
  return isEditableWeek(getWeekStartMondayYmd(ymd), logicalTodayYmd);
}

export function WeeklyFrogSchedule({
  logicalTodayYmd,
  now = new Date(),
  sectionCardStyle,
  lockedProjectIds,
  subjects,
  pendingPlace = null,
  onClearPendingPlace,
  onChanged,
  onOpenSubject,
  onToggleDone,
  onOpenSettings,
}: Props) {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';
  const primary = theme.primary;
  const outline = theme.textSecondary;
  const surfaceLow = isDark ? 'rgba(148,163,184,0.1)' : 'rgba(241,245,249,0.95)';
  const gridLine = isDark ? 'rgba(148,163,184,0.18)' : 'rgba(203,213,225,0.85)';

  const { registerOnClose } = useSettingsDrawer();

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
  } | null>(null);

  const [cellList, setCellList] = React.useState<{
    assignYmd: string;
    slotIndex: number;
    placements: SchedulePlacementRow[];
    editable: boolean;
  } | null>(null);

  const [detail, setDetail] = React.useState<{
    placement: SchedulePlacementRow;
    subject: ScheduleSubjectInfo;
  } | null>(null);
  /** 首页默认折叠为摘要，避免网格占满首屏 */
  const [expanded, setExpanded] = React.useState(false);
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

  /** 长按项目指派：自动展开课表并提示点选空格 */
  React.useEffect(() => {
    if (!pendingPlace) return;
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded(true);
    setPeriodIndex(0);
  }, [pendingPlace]);

  const loadDaysKey = loadDayYmds.join(',');

  const reload = React.useCallback(
    async (days: string[], opts?: { silent?: boolean }) => {
      if (!opts?.silent) setLoading(true);
      try {
        const data = await loadScheduleForDayWindow(days, logicalTodayYmd, {
          hydrateRemote: !opts?.silent,
        });
        setView(data);
      } catch (err) {
        console.warn('[WeeklyFrogSchedule] load failed', err);
        if (!opts?.silent) Alert.alert('加载失败', '无法加载课程表');
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

  // 任意本地课表变更（含设置页改轴）立即静默重载
  React.useEffect(() => {
    return subscribeFrogScheduleChanged(() => {
      void reload(loadDayYmdsRef.current, { silent: true });
    });
  }, [reload]);

  // 设置抽屉关闭后再刷一次，避免保存提示出现后网格仍用旧轴
  React.useEffect(() => {
    return registerOnClose(() => {
      void reload(loadDayYmdsRef.current, { silent: true });
    });
  }, [registerOnClose, reload]);

  React.useEffect(() => {
    // 逻辑日跨天时回到「今天居中」
    setPeriodIndex(0);
  }, [logicalTodayYmd]);

  const layout = React.useMemo(
    () => (view ? computeScheduleSlotLayout(view.axis) : null),
    [view],
  );
  const slotCount = layout?.slotCount ?? 0;
  const slotH = layout?.slotH ?? 52;
  const fixedBodyH = layout?.fixedBodyH ?? 52;
  const bodyScrollable = layout?.scrollable ?? false;
  const axisKey = view
    ? `${view.axis.startMinutes}-${view.axis.endMinutes}-${view.axis.slotHours}`
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
    if (!expanded || gridWidth <= 0) return;
    snapPagerToMiddle(false);
  }, [expanded, gridWidth, periodIndex, axisKey, snapPagerToMiddle]);

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
    if (!view || !dayYmds.includes(logicalTodayYmd)) return null;
    const mins = now.getHours() * 60 + now.getMinutes();
    if (mins < view.axis.startMinutes || mins > view.axis.endMinutes) return null;
    const rel = mins - view.axis.startMinutes;
    const total = view.axis.endMinutes - view.axis.startMinutes;
    if (total <= 0) return null;
    return (rel / total) * (slotCount * slotH);
  }, [view, dayYmds, logicalTodayYmd, now, slotCount, slotH]);

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

  const openPlace = (assignYmd: string, startSlotIndex: number) => {
    if (!dayEditable(assignYmd, logicalTodayYmd) || !view) return;
    const weekStartYmd = getWeekStartMondayYmd(assignYmd);
    const weekday = weekdayFromYmd(assignYmd);
    setPlaceTarget({
      weekStartYmd,
      weekday,
      startSlotIndex,
      assignYmd,
      maxSpan: maxSpanFromSlot(view.axis, startSlotIndex),
    });
  };

  const handlePlaceConfirm = async (result: SchedulePlaceResult) => {
    if (!placeTarget || !view) return;
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

  const handleCellPress = (assignYmd: string, slotIndex: number) => {
    const key = cellKey(assignYmd, slotIndex);
    const list = placementsByCell.get(key) ?? [];
    const editable = dayEditable(assignYmd, logicalTodayYmd);
    if (list.length === 0) {
      if (editable) openPlace(assignYmd, slotIndex);
      return;
    }
    /** 预选入格模式下，已占用格仍允许再添加 */
    if (pendingPlace && editable) {
      openPlace(assignYmd, slotIndex);
      return;
    }
    if (!editable) {
      setCellList({
        assignYmd,
        slotIndex,
        placements: list,
        editable: false,
      });
      return;
    }
    const display = pickDisplayPlacement(list, subjects, assignYmd);
    if (!display) return;
    if (display.primary.subjectKind && onToggleDone) {
      onToggleDone({
        kind: display.primary.subjectKind,
        id: display.primary.subjectId,
        assignYmd,
      });
    }
  };

  const handleCellLongPress = (assignYmd: string, slotIndex: number) => {
    const key = cellKey(assignYmd, slotIndex);
    const list = placementsByCell.get(key) ?? [];
    const editable = dayEditable(assignYmd, logicalTodayYmd);
    if (list.length === 0) {
      if (editable) openPlace(assignYmd, slotIndex);
      return;
    }
    setCellList({
      assignYmd,
      slotIndex,
      placements: [...new Map(list.map((p) => [p.id, p])).values()],
      editable,
    });
  };

  const openDetail = (p: SchedulePlacementRow) => {
    const assignYmd = ymdForWeekday(p.weekStartYmd, p.weekday);
    const subject = resolveSubject(p.subjectKind, p.subjectId, subjects, assignYmd);
    if (!subject) return;
    setCellList(null);
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
          Alert.alert('本周已有占用', '复制将覆盖本周全部课程表占用，是否继续？', [
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
    view?.placements.some((p) => {
      if (p.orphaned || p.startSlotIndex == null) return false;
      return ymdForWeekday(p.weekStartYmd, p.weekday) === logicalTodayYmd;
    }) ?? false;

  const todayCompactItems = React.useMemo(() => {
    if (!view) return [];
    const items: Array<{
      placement: SchedulePlacementRow;
      title: string;
      done: boolean;
      timeLabel: string;
      endLabel: string;
    }> = [];
    for (const p of view.placements) {
      if (p.orphaned || p.startSlotIndex == null) continue;
      const assignYmd = ymdForWeekday(p.weekStartYmd, p.weekday);
      if (assignYmd !== logicalTodayYmd) continue;
      const sub = resolveSubject(p.subjectKind, p.subjectId, subjects, assignYmd);
      const startMins = slotStartMinutes(view.axis, p.startSlotIndex);
      const endMins = placementEndMinutes(view.axis, p.startSlotIndex, Math.max(1, p.spanSlots));
      items.push({
        placement: p,
        title: sub?.title?.trim() || '青蛙',
        done: !!sub?.done,
        timeLabel: formatMinutesAsHm(startMins),
        endLabel: formatMinutesAsHm(endMins),
      });
    }
    items.sort((a, b) => {
      const sa = a.placement.startSlotIndex ?? 0;
      const sb = b.placement.startSlotIndex ?? 0;
      if (sa !== sb) return sa - sb;
      return a.title.localeCompare(b.title, 'zh');
    });
    return items;
  }, [view, logicalTodayYmd, subjects]);

  // 折叠时强制回今天周期
  React.useEffect(() => {
    if (!expanded && periodIndex !== 0) {
      setPeriodIndex(0);
    }
  }, [expanded, periodIndex]);

  const todayCompactCols = todayCompactItems.length >= 5 ? 3 : 2;
  const todayChipFlexBasis = todayCompactCols === 3 ? ('30%' as const) : ('47%' as const);

  const toggleExpanded = React.useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded((v) => !v);
  }, []);

  const renderDayHeader = (ymd: string, width: number) => {
    const isTodayCol = ymd === logicalTodayYmd;
    const weekday = weekdayFromYmd(ymd);
    return (
      <View
        key={`h-${ymd}`}
        style={[
          styles.dayHeader,
          {
            width,
            height: DAY_HEADER_H,
            borderColor: gridLine,
            backgroundColor: isTodayCol
              ? `${primary}14`
              : isDark
                ? 'rgba(15,23,42,0.92)'
                : 'rgba(255,255,255,0.96)',
          },
        ]}>
        <Text
          style={{
            color: isTodayCol ? primary : theme.text,
            fontWeight: '700',
            fontSize: 13,
          }}>
          周{WEEKDAY_SHORT_LABELS[weekday - 1]}
        </Text>
        <Text style={{ color: outline, fontSize: 11 }}>
          {ymd.slice(5).replace('-', '/')}
        </Text>
      </View>
    );
  };

  const renderDaySlots = (ymd: string, width: number) => {
    if (!view || !layout) return null;
    const isTodayCol = ymd === logicalTodayYmd;
    const editable = dayEditable(ymd, logicalTodayYmd);
    return (
      <View key={ymd} style={{ width }}>
        <View style={{ height: slotCount * slotH, position: 'relative' }}>
          {Array.from({ length: slotCount }, (_, slotIndex) => {
            const key = cellKey(ymd, slotIndex);
            const covering = placementsByCell.get(key) ?? [];
            const starts = blockStarts.get(key) ?? [];
            const isEmpty = covering.length === 0;
            return (
              <Pressable
                key={slotIndex}
                onPress={() => handleCellPress(ymd, slotIndex)}
                onLongPress={() => handleCellLongPress(ymd, slotIndex)}
                delayLongPress={280}
                style={[
                  styles.slotCell,
                  {
                    height: slotH,
                    borderColor: gridLine,
                    backgroundColor: isTodayCol ? `${primary}08` : surfaceLow,
                  },
                ]}>
                {(() => {
                  if (starts.length === 0) return null;
                  const display = pickDisplayPlacement(starts, subjects, ymd);
                  if (!display) return null;
                  const h = display.primary.spanSlots * slotH - 4;
                  return (
                    <View
                      key={display.primary.id}
                      pointerEvents="none"
                      style={[
                        styles.block,
                        {
                          height: h,
                          backgroundColor: display.done
                            ? isDark
                              ? 'rgba(100,116,139,0.55)'
                              : 'rgba(148,163,184,0.45)'
                            : `${primary}33`,
                          borderColor: display.done ? `${outline}66` : `${primary}66`,
                        },
                      ]}>
                      <Text
                        numberOfLines={Math.max(1, Math.min(3, display.primary.spanSlots))}
                        style={[
                          styles.blockTitle,
                          {
                            color: display.done ? outline : theme.text,
                            textDecorationLine: display.done ? 'line-through' : 'none',
                            fontSize: h < 40 ? 11 : 12,
                          },
                        ]}>
                        {display.title}
                      </Text>
                      {display.done ? (
                        <MaterialIcons
                          name="check"
                          size={14}
                          color={outline}
                          style={styles.blockCheck}
                        />
                      ) : null}
                    </View>
                  );
                })()}

                {covering.length > 1 ? (
                  <View style={[styles.badge, { backgroundColor: primary }]}>
                    <Text style={styles.badgeText}>{covering.length}</Text>
                  </View>
                ) : null}

                {isEmpty &&
                isTodayCol &&
                editable &&
                !todayHasPlacement &&
                slotIndex === Math.floor(slotCount / 2) ? (
                  <Text
                    style={{
                      color: outline,
                      fontSize: 10,
                      textAlign: 'center',
                      paddingHorizontal: 4,
                    }}>
                    点击格子添加青蛙
                  </Text>
                ) : null}
              </Pressable>
            );
          })}

          {isTodayCol && nowLineTop != null ? (
            <View
              pointerEvents="none"
              style={[
                styles.nowLine,
                { top: nowLineTop, backgroundColor: theme.danger },
              ]}>
              <Text style={[styles.nowLabel, { color: theme.danger }]}>现在</Text>
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
          {
            backgroundColor: isDark ? 'rgba(15,23,42,0.96)' : 'rgba(255,255,255,0.98)',
            zIndex: 2,
          },
        ]}>
        <View style={{ width: TIME_GUTTER, height: DAY_HEADER_H }} />
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
      <View style={{ width: TIME_GUTTER }}>
        {Array.from({ length: slotCount }, (_, i) => {
          const isLast = i === slotCount - 1;
          const startMins = slotStartMinutes(view.axis, i);
          const note = getSlotNote(slotNotes, startMins);
          return (
            <Pressable
              key={i}
              onPress={() => openSlotNoteEditor(startMins)}
              accessibilityRole="button"
              accessibilityLabel={`${formatMinutesAsHm(startMins)} 时段备注${note ? `：${note}` : ''}`}
              accessibilityHint="点击添加或修改时段备注，最多六个字"
              style={({ pressed }) => [
                styles.timeCell,
                {
                  height: slotH,
                  borderColor: gridLine,
                  justifyContent: isLast ? 'space-between' : 'flex-start',
                  opacity: pressed ? 0.75 : 1,
                  backgroundColor: note
                    ? isDark
                      ? `${primary}18`
                      : `${primary}10`
                    : 'transparent',
                },
              ]}>
              <View style={styles.timeLabelBlock}>
                <Text style={{ color: outline, fontSize: 10, fontWeight: '600' }}>
                  {formatMinutesAsHm(startMins)}
                </Text>
                {note ? (
                  <Text
                    style={[styles.timeSlotNote, { color: primary }]}
                    numberOfLines={2}>
                    {note}
                  </Text>
                ) : null}
              </View>
              {isLast ? (
                <Text
                  style={{
                    color: outline,
                    fontSize: 10,
                    fontWeight: '700',
                    paddingBottom: 1,
                  }}>
                  {formatMinutesAsHm(view.axis.endMinutes)}
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

  return (
    <View style={styles.section}>
      <View
        style={
          expanded
            ? sectionCardStyle
            : [
                styles.summaryCard,
                {
                  backgroundColor: isDark ? 'rgba(148,163,184,0.08)' : 'rgba(241,245,249,0.9)',
                  borderColor: gridLine,
                },
              ]
        }>
        <Pressable
          onPress={toggleExpanded}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          accessibilityLabel={
            expanded
              ? '收起课程表'
              : `展开课程表，今日 ${todayCompactItems.length} 节`
          }
          style={({ pressed }) => [
            styles.headerRow,
            styles.headerRowPressable,
            { marginBottom: expanded || !loading ? 8 : 0 },
            pressed && { opacity: 0.88 },
          ]}>
          <View style={styles.titleRow}>
            <Text style={[styles.sectionTitle, { color: theme.text }]}>
              {expanded ? '课程表' : '今日课程'}
            </Text>
            <MaterialIcons
              name={expanded ? 'view-column' : 'today'}
              size={20}
              color={primary}
            />
          </View>
          <View style={styles.headerActions}>
            {!expanded ? (
              <Text style={[styles.summaryMeta, { color: outline }]} numberOfLines={1}>
                {loading && !view
                  ? '加载中…'
                  : todayCompactItems.length > 0
                    ? `${todayCompactItems.length} 节`
                    : '暂无安排'}
              </Text>
            ) : null}
            {expanded && view && view.orphanedCount > 0 ? (
              <Pressable
                onPress={(e) => {
                  e.stopPropagation?.();
                  onOpenSettings?.();
                }}
                hitSlop={6}>
                <Text style={{ color: theme.danger, fontSize: 12, fontWeight: '700' }}>
                  未入格 {view.orphanedCount}
                </Text>
              </Pressable>
            ) : null}
            {expanded ? (
              <Pressable
                onPress={(e) => {
                  e.stopPropagation?.();
                  onCopyLastWeek();
                }}
                disabled={!isEditableWeek(thisMonday, logicalTodayYmd)}
                style={({ pressed }) => [
                  styles.ghostBtn,
                  {
                    borderColor: `${primary}44`,
                    opacity: !isEditableWeek(thisMonday, logicalTodayYmd)
                      ? 0.4
                      : pressed
                        ? 0.8
                        : 1,
                  },
                ]}>
                <MaterialIcons name="content-copy" size={14} color={primary} />
                <Text style={[styles.ghostBtnText, { color: primary }]}>复制上周</Text>
              </Pressable>
            ) : null}
            <Pressable
              onPress={(e) => {
                e.stopPropagation?.();
                onOpenSettings?.();
              }}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="课表设置"
              style={({ pressed }) => [
                styles.ghostBtn,
                { borderColor: `${outline}44`, opacity: pressed ? 0.8 : 1 },
              ]}>
              <MaterialIcons name="tune" size={14} color={outline} />
            </Pressable>
            <MaterialIcons
              name={expanded ? 'expand-less' : 'expand-more'}
              size={22}
              color={outline}
            />
          </View>
        </Pressable>

        {pendingPlace ? (
          <View
            style={[
              styles.pendingBanner,
              {
                backgroundColor: `${primary}14`,
                borderColor: `${primary}44`,
              },
            ]}>
            <MaterialIcons name="touch-app" size={18} color={primary} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ color: primary, fontWeight: '700', fontSize: 13 }} numberOfLines={1}>
                点选格子放置：{pendingPlace.title}
              </Text>
              <Text style={{ color: outline, fontSize: 11, marginTop: 2 }}>
                点空格或已有占用格即可入格
              </Text>
            </View>
            <Pressable
              onPress={() => onClearPendingPlace?.()}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="取消放置">
              <MaterialIcons name="close" size={20} color={outline} />
            </Pressable>
          </View>
        ) : null}

        {!expanded ? (
          loading && !view ? (
            <ActivityIndicator color={primary} style={{ marginVertical: 12 }} />
          ) : todayCompactItems.length === 0 ? (
            <Pressable
              onPress={toggleExpanded}
              style={({ pressed }) => [
                styles.todayEmpty,
                { borderColor: gridLine, opacity: pressed ? 0.85 : 1 },
              ]}>
              <Text style={{ color: outline, fontSize: 13, fontWeight: '600' }}>
                今日暂无课程
              </Text>
              <Text style={{ color: outline, fontSize: 11, marginTop: 2 }}>
                点开三天视图添加或查看课表
              </Text>
            </Pressable>
          ) : (
            <View style={[styles.todayGrid, { maxHeight: todayCompactCols === 3 ? 168 : 152 }]}>
              <ScrollView
                nestedScrollEnabled
                showsVerticalScrollIndicator={todayCompactItems.length > todayCompactCols * 2}
                keyboardShouldPersistTaps="handled">
                <View style={styles.todayGridInner}>
                  {todayCompactItems.map((item) => (
                    <Pressable
                      key={item.placement.id}
                      onPress={() => openDetail(item.placement)}
                      accessibilityRole="button"
                      accessibilityLabel={`${item.timeLabel} ${item.title}${item.done ? '，已完成' : ''}`}
                      style={({ pressed }) => [
                        styles.todayChip,
                        {
                          flexBasis: todayChipFlexBasis,
                          flexGrow: 1,
                          maxWidth: todayCompactCols === 3 ? '32%' : '49%',
                          backgroundColor: item.done
                            ? isDark
                              ? 'rgba(100,116,139,0.35)'
                              : 'rgba(148,163,184,0.28)'
                            : `${primary}18`,
                          borderColor: item.done ? `${outline}55` : `${primary}44`,
                          opacity: pressed ? 0.88 : 1,
                        },
                      ]}>
                      <Text
                        style={[
                          styles.todayChipTime,
                          { color: item.done ? outline : primary },
                        ]}
                        numberOfLines={1}>
                        {item.timeLabel}–{item.endLabel}
                      </Text>
                      <View style={styles.todayChipTitleRow}>
                        <Text
                          style={[
                            styles.todayChipTitle,
                            {
                              color: item.done ? outline : theme.text,
                              textDecorationLine: item.done ? 'line-through' : 'none',
                            },
                          ]}
                          numberOfLines={2}>
                          {item.title}
                        </Text>
                        {item.done ? (
                          <MaterialIcons name="check" size={14} color={outline} />
                        ) : null}
                      </View>
                    </Pressable>
                  ))}
                </View>
              </ScrollView>
            </View>
          )
        ) : null}

        {expanded ? (
          <>
            <View style={styles.weekNav}>
              <Pressable onPress={() => goPeriod(-1)} hitSlop={8} style={styles.navBtn}>
                <MaterialIcons name="chevron-left" size={22} color={primary} />
              </Pressable>
              <Pressable onPress={() => setPeriodIndex(0)} style={styles.weekTitleHit}>
                <Text style={[styles.weekTitle, { color: theme.text }]}>
                  {formatThreeDayRangeLabel(centerYmd)}
                </Text>
                {periodIndex !== 0 ? (
                  <Text style={{ color: primary, fontSize: 12, fontWeight: '600' }}>回今天</Text>
                ) : view && !dayEditable(logicalTodayYmd, logicalTodayYmd) ? (
                  <Text style={{ color: outline, fontSize: 12 }}>只读</Text>
                ) : (
                  <Text style={{ color: outline, fontSize: 12 }}>昨 · 今 · 明</Text>
                )}
              </Pressable>
              <Pressable onPress={() => goPeriod(1)} hitSlop={8} style={styles.navBtn}>
                <MaterialIcons name="chevron-right" size={22} color={primary} />
              </Pressable>
            </View>

            {loading && !view ? (
              <ActivityIndicator color={primary} style={{ marginVertical: 24 }} />
            ) : view ? (
              renderScheduleGrid()
            ) : null}
          </>
        ) : null}
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
        preselected={pendingPlace}
        onConfirm={handlePlaceConfirm}
      />

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
              { backgroundColor: isDark ? '#1e293b' : '#fff', borderColor: gridLine },
            ]}>
            <Text style={[styles.listTitle, { color: theme.text }]}>本格占用</Text>
            <ScrollView style={{ maxHeight: 280 }}>
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
                    style={[styles.listRow, { backgroundColor: surfaceLow }]}>
                    <Text style={{ color: theme.text, flex: 1, fontWeight: '600' }} numberOfLines={2}>
                      {sub?.title ?? '青蛙'}
                    </Text>
                    {sub?.done ? <MaterialIcons name="check" size={16} color={outline} /> : null}
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
                style={[styles.addMoreBtn, { borderColor: `${primary}55` }]}>
                <MaterialIcons name="add" size={18} color={primary} />
                <Text style={{ color: primary, fontWeight: '700' }}>再添加一只</Text>
              </Pressable>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>

      <SchedulePlacementDetailSheet
        visible={!!detail}
        onClose={() => setDetail(null)}
        placement={detail?.placement ?? null}
        axis={view?.axis ?? { startMinutes: 480, endMinutes: 1320, slotHours: 2 }}
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
                backgroundColor: isDark ? '#1e293b' : '#fff',
                borderColor: gridLine,
                paddingBottom:
                  Math.max(insets.bottom, 16) +
                  (Platform.OS === 'android' ? slotNoteKeyboardH : 0),
              },
            ]}>
            <Text style={[styles.noteTitle, { color: theme.text }]}>
              {slotNoteEditor
                ? `${formatMinutesAsHm(slotNoteEditor.startMinutes)} 时段备注`
                : '时段备注'}
            </Text>
            <Text style={{ color: outline, fontSize: 12, marginBottom: 8 }}>
              显示在时刻下方，最多 {SCHEDULE_SLOT_NOTE_MAX_LEN} 个字（如：学习时间）
            </Text>
            <TextInput
              value={slotNoteEditor?.draft ?? ''}
              onChangeText={(text) =>
                setSlotNoteEditor((prev) =>
                  prev ? { ...prev, draft: normalizeSlotNote(text) } : prev,
                )
              }
              placeholder="例如：学习"
              placeholderTextColor={outline}
              maxLength={SCHEDULE_SLOT_NOTE_MAX_LEN}
              autoFocus
              style={[
                styles.noteInput,
                {
                  color: theme.text,
                  borderColor: gridLine,
                  backgroundColor: isDark ? 'rgba(148,163,184,0.12)' : 'rgba(241,245,249,0.95)',
                },
              ]}
            />
            <Text style={{ color: outline, fontSize: 11, alignSelf: 'flex-end' }}>
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
  section: { marginBottom: 4 },
  summaryCard: {
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  pendingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 10,
  },
  todayEmpty: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  todayGrid: {
    overflow: 'hidden',
  },
  todayGridInner: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  todayChip: {
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 8,
    paddingVertical: 8,
    minHeight: 58,
    gap: 4,
  },
  todayChipTime: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  todayChipTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 4,
  },
  todayChipTitle: {
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 17,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    gap: 8,
  },
  headerRowPressable: {
    marginBottom: 0,
    minHeight: 44,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  sectionTitle: { fontSize: 17, fontWeight: '700' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  summaryMeta: { fontSize: 12, fontWeight: '600', flexShrink: 1, maxWidth: 160 },
  ghostBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  ghostBtnText: { fontSize: 12, fontWeight: '600' },
  weekNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  navBtn: { padding: 4 },
  weekTitleHit: { alignItems: 'center', gap: 2 },
  weekTitle: { fontSize: 15, fontWeight: '700' },
  gridWrap: { flexDirection: 'row' },
  timeCell: {
    justifyContent: 'flex-start',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 2,
    paddingHorizontal: 2,
  },
  timeLabelBlock: {
    gap: 2,
    alignItems: 'flex-start',
  },
  timeSlotNote: {
    fontSize: 9,
    fontWeight: '700',
    lineHeight: 11,
    letterSpacing: 0.2,
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
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingTop: 16,
    gap: 6,
  },
  noteTitle: { fontSize: 17, fontWeight: '700' },
  noteInput: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
    fontWeight: '600',
  },
  noteActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 8,
  },
  noteGhostBtn: { paddingVertical: 12, paddingHorizontal: 10 },
  notePrimaryBtn: {
    minWidth: 88,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  dayHeader: {
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 1,
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
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 5,
    paddingVertical: 4,
    zIndex: 2,
  },
  blockTitle: { fontWeight: '700' },
  blockCheck: { position: 'absolute', right: 4, bottom: 2 },
  badge: {
    position: 'absolute',
    top: 2,
    right: 2,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
    zIndex: 3,
  },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  nowLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 2,
    zIndex: 5,
  },
  nowLabel: {
    position: 'absolute',
    left: 2,
    top: -12,
    fontSize: 10,
    fontWeight: '800',
  },
  listBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.45)',
    justifyContent: 'center',
    padding: 24,
  },
  listCard: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    gap: 10,
  },
  listTitle: { fontSize: 16, fontWeight: '700' },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 12,
    borderRadius: 10,
    marginBottom: 6,
  },
  addMoreBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    marginTop: 4,
  },
});
