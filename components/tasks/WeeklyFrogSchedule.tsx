import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { isFrogDoneForToday } from '@/lib/long-term-task';
import { isFrogSubjectDeleted } from '@/lib/repositories/tasks/frog-completion-events';
import type { ProjectRow } from '@/lib/repositories/projects/project.types';
import type { TaskRow } from '@/lib/repositories/tasks/task.types';
import {
  formatMinutesAsHm,
  getSlotCount,
  maxSpanFromSlot,
  slotStartMinutes,
} from '@/lib/schedule/axis';
import {
  addWeeksToWeekStart,
  formatWeekRangeLabel,
  getWeekStartMondayYmd,
  WEEKDAY_SHORT_LABELS,
  ymdForWeekday,
} from '@/lib/schedule/week';
import type { SchedulePlacementRow } from '@/lib/schedule/types';
import {
  cancelAssignForPlacementDay,
  copyPreviousWeekToThisWeek,
  loadWeekSchedule,
  placeFrogOnSchedule,
  removePlacementSegment,
  type WeekScheduleView,
} from '@/lib/schedule-service';
import { MaterialIcons } from '@expo/vector-icons';
import React from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import {
  SchedulePlaceFrogSheet,
  type SchedulePlaceResult,
} from '@/components/tasks/SchedulePlaceFrogSheet';
import {
  SchedulePlacementDetailSheet,
  type ScheduleSubjectInfo,
  buildAcceptance,
} from '@/components/tasks/SchedulePlacementDetailSheet';

const COL_WIDTH = 108;
const SLOT_H = 52;
const TIME_GUTTER = 44;
const DAY_HEADER_H = 40;

type SubjectLookup = {
  tasks: TaskRow[];
  projects: ProjectRow[];
  projectFrogIds?: Set<string>;
};

type Props = {
  logicalTodayYmd: string;
  /** 当前墙钟时刻（用于「现在」线） */
  now?: Date;
  sectionCardStyle: object | object[];
  lockedProjectIds?: Set<string>;
  subjects: SubjectLookup;
  onChanged?: () => void;
  onOpenSubject?: (kind: 'task' | 'project', id: string) => void;
  onToggleDone?: (info: {
    kind: 'task' | 'project';
    id: string;
    assignYmd: string;
  }) => void;
  onOpenSettings?: () => void;
};

type CellKey = string; // `${weekday}-${slot}`

function cellKey(weekday: number, slot: number): CellKey {
  return `${weekday}-${slot}`;
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

export function WeeklyFrogSchedule({
  logicalTodayYmd,
  now = new Date(),
  sectionCardStyle,
  lockedProjectIds,
  subjects,
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

  const thisMonday = React.useMemo(
    () => getWeekStartMondayYmd(logicalTodayYmd),
    [logicalTodayYmd],
  );
  const [weekStartYmd, setWeekStartYmd] = React.useState(thisMonday);
  const [view, setView] = React.useState<WeekScheduleView | null>(null);
  const [loading, setLoading] = React.useState(true);
  const hScrollRef = React.useRef<ScrollView>(null);
  const didAutoScroll = React.useRef(false);

  const [placeTarget, setPlaceTarget] = React.useState<{
    weekday: number;
    startSlotIndex: number;
    assignYmd: string;
    maxSpan: number;
  } | null>(null);

  const [cellList, setCellList] = React.useState<{
    weekday: number;
    slotIndex: number;
    assignYmd: string;
    placements: SchedulePlacementRow[];
  } | null>(null);

  const [detail, setDetail] = React.useState<{
    placement: SchedulePlacementRow;
    subject: ScheduleSubjectInfo;
  } | null>(null);

  const reload = React.useCallback(async (week: string) => {
    setLoading(true);
    try {
      const data = await loadWeekSchedule(week, logicalTodayYmd);
      setView(data);
    } catch (err) {
      console.warn('[WeeklyFrogSchedule] load failed', err);
      Alert.alert('加载失败', '无法加载周课程表');
    } finally {
      setLoading(false);
    }
  }, [logicalTodayYmd]);

  React.useEffect(() => {
    void reload(weekStartYmd);
  }, [weekStartYmd, reload]);

  React.useEffect(() => {
    // 逻辑日跨周时跟到本周
    setWeekStartYmd(thisMonday);
  }, [thisMonday]);

  const slotCount = view ? getSlotCount(view.axis) : 0;
  const todayWeekday =
    weekStartYmd <= logicalTodayYmd && logicalTodayYmd <= ymdForWeekday(weekStartYmd, 7)
      ? (() => {
          const d = new Date(logicalTodayYmd + 'T12:00:00');
          const day = d.getDay();
          return day === 0 ? 7 : day;
        })()
      : null;

  React.useEffect(() => {
    if (!view || didAutoScroll.current || todayWeekday == null) return;
    const x = Math.max(0, (todayWeekday - 1) * COL_WIDTH - COL_WIDTH * 0.3);
    requestAnimationFrame(() => {
      hScrollRef.current?.scrollTo({ x, animated: false });
      didAutoScroll.current = true;
    });
  }, [view, todayWeekday]);

  React.useEffect(() => {
    didAutoScroll.current = false;
  }, [weekStartYmd]);

  const placementsByCell = React.useMemo(() => {
    const map = new Map<CellKey, SchedulePlacementRow[]>();
    if (!view) return map;
    for (const p of view.placements) {
      if (p.orphaned || p.startSlotIndex == null) continue;
      for (let i = 0; i < p.spanSlots; i++) {
        const key = cellKey(p.weekday, p.startSlotIndex + i);
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
      const key = cellKey(p.weekday, p.startSlotIndex);
      const list = map.get(key) ?? [];
      list.push(p);
      map.set(key, list);
    }
    return map;
  }, [view]);

  const nowLineTop = React.useMemo(() => {
    if (!view || todayWeekday == null) return null;
    const mins = now.getHours() * 60 + now.getMinutes();
    if (mins < view.axis.startMinutes || mins > view.axis.endMinutes) return null;
    const rel = mins - view.axis.startMinutes;
    const total = view.axis.endMinutes - view.axis.startMinutes;
    return DAY_HEADER_H + (rel / total) * (slotCount * SLOT_H);
  }, [view, todayWeekday, now, slotCount]);

  const goWeek = (delta: number) => {
    setWeekStartYmd((w) => addWeeksToWeekStart(w, delta));
  };

  const openPlace = (weekday: number, startSlotIndex: number) => {
    if (!view?.editable) return;
    const assignYmd = ymdForWeekday(weekStartYmd, weekday);
    setPlaceTarget({
      weekday,
      startSlotIndex,
      assignYmd,
      maxSpan: maxSpanFromSlot(view.axis, startSlotIndex),
    });
  };

  const handlePlaceConfirm = async (result: SchedulePlaceResult) => {
    if (!placeTarget || !view) return;
    await placeFrogOnSchedule({
      weekStartYmd,
      weekday: placeTarget.weekday,
      startSlotIndex: placeTarget.startSlotIndex,
      spanSlots: result.spanSlots,
      subjectKind: result.kind,
      subjectId: result.id,
      logicalTodayYmd,
    });
    setPlaceTarget(null);
    await reload(weekStartYmd);
    onChanged?.();
  };

  const handleCellPress = (weekday: number, slotIndex: number) => {
    const key = cellKey(weekday, slotIndex);
    const list = placementsByCell.get(key) ?? [];
    if (list.length === 0) {
      openPlace(weekday, slotIndex);
      return;
    }
    if (!view?.editable) {
      // 只读：打开列表浏览
      setCellList({
        weekday,
        slotIndex,
        assignYmd: ymdForWeekday(weekStartYmd, weekday),
        placements: list,
      });
      return;
    }
    const assignYmd = ymdForWeekday(weekStartYmd, weekday);
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

  const handleCellLongPress = (weekday: number, slotIndex: number) => {
    const key = cellKey(weekday, slotIndex);
    const list = placementsByCell.get(key) ?? [];
    if (list.length === 0) {
      if (view?.editable) openPlace(weekday, slotIndex);
      return;
    }
    setCellList({
      weekday,
      slotIndex,
      assignYmd: ymdForWeekday(weekStartYmd, weekday),
      placements: [...new Map(list.map((p) => [p.id, p])).values()],
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
    if (!view?.editable) return;
    const run = async (overwrite: boolean) => {
      try {
        const result = await copyPreviousWeekToThisWeek({
          thisWeekStartYmd: weekStartYmd,
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
        await reload(weekStartYmd);
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
    todayWeekday != null &&
    (view?.placements.some(
      (p) => p.weekday === todayWeekday && !p.orphaned && p.startSlotIndex != null,
    ) ??
      false);

  return (
    <View style={styles.section}>
      <View style={sectionCardStyle}>
        <View style={styles.headerRow}>
          <View style={styles.titleRow}>
            <Text style={[styles.sectionTitle, { color: theme.text }]}>周课程表</Text>
            <MaterialIcons name="calendar-view-week" size={20} color={primary} />
          </View>
          <View style={styles.headerActions}>
            {view && view.orphanedCount > 0 ? (
              <Pressable onPress={onOpenSettings} hitSlop={6}>
                <Text style={{ color: theme.danger, fontSize: 12, fontWeight: '700' }}>
                  未入格 {view.orphanedCount}
                </Text>
              </Pressable>
            ) : null}
            <Pressable
              onPress={onCopyLastWeek}
              disabled={!view?.editable}
              style={({ pressed }) => [
                styles.ghostBtn,
                { borderColor: `${primary}44`, opacity: !view?.editable ? 0.4 : pressed ? 0.8 : 1 },
              ]}>
              <MaterialIcons name="content-copy" size={14} color={primary} />
              <Text style={[styles.ghostBtnText, { color: primary }]}>复制上周</Text>
            </Pressable>
            <Pressable
              onPress={onOpenSettings}
              style={({ pressed }) => [
                styles.ghostBtn,
                { borderColor: `${outline}44`, opacity: pressed ? 0.8 : 1 },
              ]}>
              <MaterialIcons name="tune" size={14} color={outline} />
            </Pressable>
          </View>
        </View>

        <View style={styles.weekNav}>
          <Pressable onPress={() => goWeek(-1)} hitSlop={8} style={styles.navBtn}>
            <MaterialIcons name="chevron-left" size={22} color={primary} />
          </Pressable>
          <Pressable onPress={() => setWeekStartYmd(thisMonday)} style={styles.weekTitleHit}>
            <Text style={[styles.weekTitle, { color: theme.text }]}>
              {formatWeekRangeLabel(weekStartYmd)}
            </Text>
            {weekStartYmd !== thisMonday ? (
              <Text style={{ color: primary, fontSize: 12, fontWeight: '600' }}>回本周</Text>
            ) : view && !view.editable ? (
              <Text style={{ color: outline, fontSize: 12 }}>历史周 · 只读</Text>
            ) : null}
          </Pressable>
          <Pressable onPress={() => goWeek(1)} hitSlop={8} style={styles.navBtn}>
            <MaterialIcons name="chevron-right" size={22} color={primary} />
          </Pressable>
        </View>

        {loading && !view ? (
          <ActivityIndicator color={primary} style={{ marginVertical: 24 }} />
        ) : view ? (
          <View style={styles.gridWrap}>
            <View style={{ width: TIME_GUTTER }}>
              <View style={{ height: DAY_HEADER_H }} />
              {Array.from({ length: slotCount }, (_, i) => (
                <View key={i} style={[styles.timeCell, { height: SLOT_H, borderColor: gridLine }]}>
                  <Text style={{ color: outline, fontSize: 10 }}>
                    {formatMinutesAsHm(slotStartMinutes(view.axis, i))}
                  </Text>
                </View>
              ))}
            </View>

            <ScrollView
              ref={hScrollRef}
              horizontal
              nestedScrollEnabled
              showsHorizontalScrollIndicator={false}
              onScroll={(_e: NativeSyntheticEvent<NativeScrollEvent>) => {}}
              scrollEventThrottle={16}>
              <View style={{ flexDirection: 'row', position: 'relative' }}>
                {[1, 2, 3, 4, 5, 6, 7].map((weekday) => {
                  const ymd = ymdForWeekday(weekStartYmd, weekday);
                  const isTodayCol = weekday === todayWeekday;
                  return (
                    <View key={weekday} style={{ width: COL_WIDTH }}>
                      <View
                        style={[
                          styles.dayHeader,
                          {
                            height: DAY_HEADER_H,
                            borderColor: gridLine,
                            backgroundColor: isTodayCol ? `${primary}14` : 'transparent',
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

                      <View style={{ height: slotCount * SLOT_H, position: 'relative' }}>
                        {Array.from({ length: slotCount }, (_, slotIndex) => {
                          const key = cellKey(weekday, slotIndex);
                          const covering = placementsByCell.get(key) ?? [];
                          const starts = blockStarts.get(key) ?? [];
                          const isEmpty = covering.length === 0;
                          return (
                            <Pressable
                              key={slotIndex}
                              onPress={() => handleCellPress(weekday, slotIndex)}
                              onLongPress={() => handleCellLongPress(weekday, slotIndex)}
                              delayLongPress={280}
                              style={[
                                styles.slotCell,
                                {
                                  height: SLOT_H,
                                  borderColor: gridLine,
                                  backgroundColor: isTodayCol ? `${primary}08` : surfaceLow,
                                },
                              ]}>
                              {(() => {
                                if (starts.length === 0) return null;
                                const assignYmd = ymdForWeekday(weekStartYmd, weekday);
                                const display = pickDisplayPlacement(starts, subjects, assignYmd);
                                if (!display) return null;
                                const h = display.primary.spanSlots * SLOT_H - 4;
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

                              {/* 多蛙角标：同格覆盖数 */}
                              {covering.length > 1 ? (
                                <View style={[styles.badge, { backgroundColor: primary }]}>
                                  <Text style={styles.badgeText}>{covering.length}</Text>
                                </View>
                              ) : null}

                              {isEmpty &&
                              isTodayCol &&
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
                              { top: nowLineTop - DAY_HEADER_H, backgroundColor: theme.danger },
                            ]}>
                            <Text style={[styles.nowLabel, { color: theme.danger }]}>现在</Text>
                          </View>
                        ) : null}
                      </View>
                    </View>
                  );
                })}
              </View>
            </ScrollView>
          </View>
        ) : null}
      </View>

      <SchedulePlaceFrogSheet
        visible={!!placeTarget}
        onClose={() => setPlaceTarget(null)}
        assignYmd={placeTarget?.assignYmd ?? logicalTodayYmd}
        maxSpan={placeTarget?.maxSpan ?? 1}
        lockedProjectIds={lockedProjectIds}
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
            {view?.editable ? (
              <Pressable
                onPress={() => {
                  if (!cellList) return;
                  const slot = cellList.slotIndex;
                  setCellList(null);
                  openPlace(cellList.weekday, slot);
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
        editable={!!view?.editable}
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
              await reload(weekStartYmd);
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
              await reload(weekStartYmd);
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
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: 4 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    gap: 8,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sectionTitle: { fontSize: 17, fontWeight: '700' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
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
