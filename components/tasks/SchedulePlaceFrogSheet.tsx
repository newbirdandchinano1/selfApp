import {
  FOLD_MOTION_EASE,
  FOLD_MOTION_SPRING,
  FoldPopIn,
  FoldRiseIn,
  useFoldMotionGate,
} from '@/components/review/fold-motion';
import {
  TaskFoldMotion,
  useTaskFoldTheme,
  type TaskFoldPalette,
} from '@/constants/task-fold-theme';
import { fetchFrogCandidates, type FrogCandidate } from '@/lib/frog-candidates-api';
import { DEFAULT_PROJECT_TAG_COLOR } from '@/lib/repositories/projects/project-tag.types';
import { getProjectTags } from '@/lib/repositories/projects/project-tag';
import type { ScheduleSubjectKind } from '@/lib/schedule/types';
import { isTaskDueOverdue } from '@/lib/standalone-todo-visibility';
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
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Alert } from '@/lib/app-feedback';
export type SchedulePlaceResult = {
  kind: ScheduleSubjectKind;
  id: string;
  title: string;
  spanSlots: number;
  assignYmd: string;
  /** 占用当日全部可排格（从第 0 格起）；父级应忽略点选格的 startSlotIndex */
  allDay?: boolean;
};

export type SchedulePlaceTag = { name: string; color: string };

/** 从项目列表长按等入口预选主体时，跳过候选列表直接选格数 */
export type SchedulePlacePreselected = {
  kind: ScheduleSubjectKind;
  id: string;
  title: string;
  priority?: number;
  dueDate?: string | null;
  acceptanceCriteria?: string;
  rewardPoints?: number;
  projectId?: string | null;
  projectName?: string | null;
  tagNames?: string[];
  tags?: SchedulePlaceTag[];
  isOverdue?: boolean;
};

type Props = {
  visible: boolean;
  onClose: () => void;
  assignYmd: string;
  /** 从点选格起可连续占用的最大格数 */
  maxSpan: number;
  /** 当日可排工作格总数；用于「全天」铺满（默认与 maxSpan 相同） */
  daySlotCount?: number;
  lockedProjectIds?: Set<string>;
  /** 已选定主体时跳过列表，只选占用格数 */
  preselected?: SchedulePlacePreselected | null;
  onConfirm: (result: SchedulePlaceResult) => Promise<void> | void;
};

type DisplayCandidate = FrogCandidate & {
  tags: SchedulePlaceTag[];
  isOverdue: boolean;
};

type SegKey = 'recommend' | 'todo' | 'projectTask';

const WEEKDAY_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const;
const SEG_OPTIONS: { key: SegKey; label: string }[] = [
  { key: 'recommend', label: '推荐' },
  { key: 'todo', label: '独立待办' },
  { key: 'projectTask', label: '项目 / 任务' },
];

function formatAssignTitle(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return ymd;
  const month = Number(m[2]);
  const day = Number(m[3]);
  const d = new Date(Number(m[1]), month - 1, day);
  const wd = Number.isNaN(d.getTime()) ? '' : WEEKDAY_CN[d.getDay()] ?? '';
  return `${month}/${day}${wd ? ` ${wd}` : ''}`;
}

function priorityLabel(p: number): string {
  if (p >= 4) return 'P1 · 紧急重要';
  if (p === 3) return 'P2 · 紧急';
  if (p === 2) return 'P3 · 重要';
  if (p === 1) return 'P4';
  return '';
}

function kindTag(c: Pick<DisplayCandidate, 'kind' | 'projectId'>): string {
  if (c.kind === 'project') return '项目';
  if (!c.projectId) return '独立待办';
  return '叶子任务';
}

function kindIcon(
  c: Pick<DisplayCandidate, 'kind' | 'projectId'>,
): keyof typeof MaterialIcons.glyphMap {
  if (c.kind === 'project') return 'folder';
  if (!c.projectId) return 'inbox';
  return 'task-alt';
}

function normalizeChipColor(color: unknown): string {
  const raw = String(color ?? '').trim();
  if (/^#[0-9A-Fa-f]{6}$/.test(raw)) return raw.toUpperCase();
  if (/^#[0-9A-Fa-f]{8}$/.test(raw)) return `#${raw.slice(1, 7).toUpperCase()}`;
  return DEFAULT_PROJECT_TAG_COLOR;
}

function resolveTags(
  item: {
    tags?: SchedulePlaceTag[] | null;
    tagNames?: string[] | null;
  },
  colorByName: Map<string, string>,
): SchedulePlaceTag[] {
  if (Array.isArray(item.tags) && item.tags.length > 0) {
    const out: SchedulePlaceTag[] = [];
    for (const t of item.tags) {
      if (!t || typeof t !== 'object') continue;
      const name = String(t.name ?? '').trim();
      if (!name) continue;
      const mapped = colorByName.get(name);
      out.push({
        name,
        color: normalizeChipColor(mapped ?? t.color ?? DEFAULT_PROJECT_TAG_COLOR),
      });
    }
    return out;
  }
  return (item.tagNames ?? [])
    .map((name) => String(name ?? '').trim())
    .filter(Boolean)
    .map((name) => ({
      name,
      color: normalizeChipColor(colorByName.get(name) ?? DEFAULT_PROJECT_TAG_COLOR),
    }));
}

function resolveOverdue(
  item: { dueDate?: string | null; isOverdue?: boolean },
  logicalToday: string,
): boolean {
  if (typeof item.isOverdue === 'boolean') return item.isOverdue;
  const due = (item.dueDate ?? '').trim();
  if (!due || !logicalToday) return false;
  return isTaskDueOverdue(due, false, logicalToday);
}

function sortCandidates(items: DisplayCandidate[]): DisplayCandidate[] {
  return [...items].sort((a, b) => {
    if (a.alreadyAssigned !== b.alreadyAssigned) return a.alreadyAssigned ? 1 : -1;
    if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1;
    if (a.priority !== b.priority) return b.priority - a.priority;
    const dueA = a.dueDate ?? '9999-99-99';
    const dueB = b.dueDate ?? '9999-99-99';
    if (dueA !== dueB) return dueA.localeCompare(dueB);
    return a.title.localeCompare(b.title, 'zh');
  });
}

function toDisplayCandidate(
  item: FrogCandidate | SchedulePlacePreselected,
  colorByName: Map<string, string>,
  logicalToday: string,
  blockedOverride?: string | null,
): DisplayCandidate {
  const projectId =
    'projectId' in item ? (item.projectId ?? null) : item.kind === 'project' ? item.id : null;
  const baseBlocked = 'blockedReason' in item ? item.blockedReason ?? null : null;
  return {
    kind: item.kind,
    id: item.id,
    title: item.title,
    priority: item.priority ?? 0,
    dueDate: item.dueDate ?? null,
    acceptanceCriteria: item.acceptanceCriteria ?? '',
    rewardPoints: item.rewardPoints ?? 0,
    projectId,
    projectName: item.projectName ?? null,
    tagNames: item.tagNames ?? [],
    tags: resolveTags(item, colorByName),
    isOverdue: resolveOverdue(item, logicalToday),
    alreadyAssigned: 'alreadyAssigned' in item ? !!item.alreadyAssigned : false,
    blockedReason: blockedOverride !== undefined ? blockedOverride : baseBlocked,
  };
}

function candidateSubline(c: DisplayCandidate): string {
  const parts: string[] = [];
  if (c.kind === 'task' && c.projectName) parts.push(c.projectName);
  else if (c.kind === 'project') parts.push('空项目可入格');
  else parts.push('独立待办');
  const p = priorityLabel(c.priority ?? 0);
  if (p) parts.push(p.split(' · ')[0] ?? p);
  if (c.dueDate) parts.push(c.isOverdue ? `逾期 ${c.dueDate}` : c.dueDate);
  if (c.alreadyAssigned) parts.push('当日已指派');
  if (c.rewardPoints > 0) parts.push(`+${c.rewardPoints} 积分`);
  return parts.join(' · ');
}

function lockReason(c: DisplayCandidate): string {
  return (c.blockedReason || '暂不可入格').trim();
}

function isLockedByProjects(it: FrogCandidate, locked: Set<string>): boolean {
  if (it.kind === 'task' && it.projectId && locked.has(it.projectId)) return true;
  if (it.kind === 'project' && locked.has(it.id)) return true;
  return false;
}

/** 圆形 lily 底 frogmark；入场跳一次 */
function FrogMark({
  tf,
  size = 32,
  hop = false,
}: {
  tf: TaskFoldPalette;
  size?: number;
  hop?: boolean;
}) {
  const { animate } = useFoldMotionGate();
  const hopY = React.useRef(new Animated.Value(0)).current;
  const hopScale = React.useRef(new Animated.Value(1)).current;

  React.useEffect(() => {
    if (!hop || !animate) return;
    hopY.setValue(0);
    hopScale.setValue(1);
    const anim = Animated.sequence([
      Animated.parallel([
        Animated.timing(hopY, {
          toValue: -9,
          duration: Math.round(TaskFoldMotion.frogHop * 0.32),
          easing: FOLD_MOTION_EASE,
          useNativeDriver: true,
        }),
        Animated.timing(hopScale, {
          toValue: 1.04,
          duration: Math.round(TaskFoldMotion.frogHop * 0.32),
          easing: FOLD_MOTION_EASE,
          useNativeDriver: true,
        }),
      ]),
      Animated.parallel([
        Animated.timing(hopY, {
          toValue: 0,
          duration: Math.round(TaskFoldMotion.frogHop * 0.3),
          easing: FOLD_MOTION_EASE,
          useNativeDriver: true,
        }),
        Animated.timing(hopScale, {
          toValue: 0.98,
          duration: Math.round(TaskFoldMotion.frogHop * 0.3),
          easing: FOLD_MOTION_EASE,
          useNativeDriver: true,
        }),
      ]),
      Animated.timing(hopScale, {
        toValue: 1,
        duration: Math.round(TaskFoldMotion.frogHop * 0.38),
        easing: FOLD_MOTION_EASE,
        useNativeDriver: true,
      }),
    ]);
    anim.start();
    return () => anim.stop();
  }, [animate, hop, hopScale, hopY]);

  return (
    <Animated.View
      style={[
        styles.frogmark,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: tf.lily2,
          shadowColor: tf.frog,
          transform: [{ translateY: hopY }, { scale: hopScale }],
        },
      ]}>
      <MaterialIcons name="cruelty-free" size={Math.round(size * 0.55)} color={tf.frog} />
    </Animated.View>
  );
}

function SheetSeg({
  tf,
  value,
  onChange,
}: {
  tf: TaskFoldPalette;
  value: SegKey;
  onChange: (next: SegKey) => void;
}) {
  const count = SEG_OPTIONS.length;
  const activeIndex = Math.max(
    0,
    SEG_OPTIONS.findIndex((o) => o.key === value),
  );
  const [trackWidth, setTrackWidth] = React.useState(0);
  const slide = React.useRef(new Animated.Value(activeIndex)).current;
  const pad = 2;
  const indicatorWidth = trackWidth > 0 ? (trackWidth - pad * 2) / count : 0;

  React.useEffect(() => {
    Animated.timing(slide, {
      toValue: activeIndex,
      duration: TaskFoldMotion.paneInd,
      easing: FOLD_MOTION_EASE,
      useNativeDriver: true,
    }).start();
  }, [activeIndex, slide]);

  const translateX =
    indicatorWidth > 0
      ? slide.interpolate({
          inputRange: SEG_OPTIONS.map((_, i) => i),
          outputRange: SEG_OPTIONS.map((_, i) => pad + i * indicatorWidth),
          extrapolate: 'clamp',
        })
      : 0;

  return (
    <View
      onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}
      style={[styles.segTrack, { backgroundColor: tf.track }]}>
      {indicatorWidth > 0 ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.segInd,
            {
              width: indicatorWidth,
              backgroundColor: tf.cream,
              shadowColor: tf.shadow,
              transform: [{ translateX }],
            },
          ]}
        />
      ) : null}
      {SEG_OPTIONS.map((opt, index) => {
        const on = index === activeIndex;
        return (
          <Pressable
            key={opt.key}
            onPress={() => onChange(opt.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            style={styles.segBtn}>
            <Text
              style={[styles.segText, { color: on ? tf.pond : tf.muted, fontWeight: on ? '700' : '600' }]}
              numberOfLines={1}>
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function CandRow({
  tf,
  fonts,
  item,
  selected,
  disabled,
  index,
  animate,
  onPress,
}: {
  tf: TaskFoldPalette;
  fonts: ReturnType<typeof useTaskFoldTheme>['fonts'];
  item: DisplayCandidate;
  selected?: boolean;
  disabled?: boolean;
  index: number;
  animate: boolean;
  onPress?: () => void;
}) {
  const sub = disabled ? lockReason(item) : candidateSubline(item);
  const slotOccupied = item.alreadyAssigned && !disabled;

  return (
    <FoldRiseIn animate={animate} index={index} staggerMs={TaskFoldMotion.rowStagger} fromY={10}>
      <Pressable
        onPress={disabled ? undefined : onPress}
        disabled={disabled}
        style={({ pressed }) => [
          styles.cand,
          selected && { backgroundColor: 'rgba(232,239,217,0.55)', borderRadius: 8 },
          disabled && { opacity: 0.55 },
          pressed && !disabled && { opacity: 0.88 },
        ]}>
        <View style={[styles.candIcon, { backgroundColor: tf.lily2 }]}>
          <MaterialIcons name={kindIcon(item)} size={16} color={tf.frog} />
        </View>
        <View style={styles.candCopy}>
          <View style={styles.candTitleRow}>
            <Text
              style={[styles.candTitle, { color: item.isOverdue ? tf.rose : tf.ink2 }]}
              numberOfLines={1}>
              {item.title}
            </Text>
            <View
              style={[
                styles.kindTag,
                {
                  backgroundColor: disabled ? tf.paper2 : tf.lily2,
                },
              ]}>
              <Text style={[styles.kindTagText, { color: disabled ? tf.muted : tf.frog }]}>
                {kindTag(item)}
              </Text>
            </View>
          </View>
          <Text style={[styles.candSub, { color: tf.faint }]} numberOfLines={1}>
            {sub}
          </Text>
        </View>
        {disabled ? (
          <MaterialIcons name="lock-outline" size={16} color={tf.faint} />
        ) : (
          <View
            style={[
              styles.slotChip,
              slotOccupied
                ? { backgroundColor: tf.paper2 }
                : { backgroundColor: '#EAF0DA' },
            ]}>
            <Text
              style={[
                styles.slotChipText,
                {
                  color: slotOccupied ? tf.muted : '#5E8358',
                  fontFamily: fonts.mono,
                },
              ]}>
              {slotOccupied ? '已占用' : '可入格'}
            </Text>
          </View>
        )}
      </Pressable>
    </FoldRiseIn>
  );
}

export function SchedulePlaceFrogSheet({
  visible,
  onClose,
  assignYmd,
  maxSpan,
  daySlotCount,
  lockedProjectIds,
  preselected,
  onConfirm,
}: Props) {
  const insets = useSafeAreaInsets();
  const { height: winH } = useWindowDimensions();
  const { tf, isDark, fonts } = useTaskFoldTheme();
  const { animate } = useFoldMotionGate();

  const fullDaySlots = Math.max(1, daySlotCount ?? maxSpan);
  const canAssignAllDay = fullDaySlots >= 1;

  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [eligible, setEligible] = React.useState<DisplayCandidate[]>([]);
  const [blocked, setBlocked] = React.useState<DisplayCandidate[]>([]);
  const [picked, setPicked] = React.useState<DisplayCandidate | null>(null);
  const [span, setSpan] = React.useState(1);
  const [allDay, setAllDay] = React.useState(false);
  const [logicalToday, setLogicalToday] = React.useState(assignYmd);
  const [tagColorByName, setTagColorByName] = React.useState<Map<string, string>>(() => new Map());
  const [seg, setSeg] = React.useState<SegKey>('recommend');
  const [query, setQuery] = React.useState('');
  const [onlyEligible, setOnlyEligible] = React.useState(false);
  const [blockedOpen, setBlockedOpen] = React.useState(false);

  const scrim = React.useRef(new Animated.Value(0)).current;
  const sheetY = React.useRef(new Animated.Value(1)).current;

  React.useEffect(() => {
    if (!visible) {
      scrim.setValue(0);
      sheetY.setValue(1);
      return;
    }
    if (!animate) {
      scrim.setValue(1);
      sheetY.setValue(0);
      return;
    }
    scrim.setValue(0);
    sheetY.setValue(1);
    const anim = Animated.parallel([
      Animated.timing(scrim, {
        toValue: 1,
        duration: TaskFoldMotion.scrim,
        easing: FOLD_MOTION_EASE,
        useNativeDriver: true,
      }),
      Animated.timing(sheetY, {
        toValue: 0,
        duration: TaskFoldMotion.sheet,
        easing: FOLD_MOTION_SPRING,
        useNativeDriver: true,
      }),
    ]);
    anim.start();
    return () => anim.stop();
  }, [animate, visible, scrim, sheetY]);

  React.useEffect(() => {
    if (!visible) return;
    setSeg('recommend');
    setQuery('');
    setOnlyEligible(false);
    setBlockedOpen(false);
    setSpan(1);
    setAllDay(false);
  }, [visible, assignYmd]);

  React.useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    void getProjectTags()
      .then((rows) => {
        if (cancelled) return;
        const map = new Map<string, string>();
        for (const t of rows) {
          const name = t.name?.trim();
          if (!name) continue;
          map.set(name, normalizeChipColor(t.color || DEFAULT_PROJECT_TAG_COLOR));
        }
        setTagColorByName(map);
      })
      .catch(() => {
        if (!cancelled) setTagColorByName(new Map());
      });
    return () => {
      cancelled = true;
    };
  }, [visible]);

  React.useEffect(() => {
    if (!visible) return;
    setSpan(1);
    setAllDay(false);
    if (preselected) {
      setPicked(toDisplayCandidate(preselected, tagColorByName, logicalToday || assignYmd));
      setEligible([]);
      setBlocked([]);
      setLoading(false);
      return;
    }
    setPicked(null);
    let cancelled = false;
    setLoading(true);
    void fetchFrogCandidates({ assignYmd })
      .then((res) => {
        if (cancelled) return;
        const today = res.logicalToday || assignYmd;
        setLogicalToday(today);
        const locked = lockedProjectIds ?? new Set<string>();
        const canPlace: DisplayCandidate[] = [];
        const cannot: DisplayCandidate[] = [];
        for (const it of res.items) {
          if (isLockedByProjects(it, locked)) {
            cannot.push(
              toDisplayCandidate(it, tagColorByName, today, '日程或前置锁定，暂不可入格'),
            );
            continue;
          }
          const display = toDisplayCandidate(it, tagColorByName, today);
          if (display.blockedReason) cannot.push(display);
          else canPlace.push(display);
        }
        setEligible(sortCandidates(canPlace));
        setBlocked(sortCandidates(cannot));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // tagColorByName 变化时由下方 effect 仅重着色，避免重复请求
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, assignYmd, lockedProjectIds, preselected]);

  React.useEffect(() => {
    if (!visible) return;
    const today = logicalToday || assignYmd;
    if (preselected) {
      setPicked(toDisplayCandidate(preselected, tagColorByName, today));
      return;
    }
    setEligible((prev) =>
      sortCandidates(prev.map((c) => toDisplayCandidate(c, tagColorByName, today))),
    );
    setBlocked((prev) =>
      sortCandidates(
        prev.map((c) =>
          toDisplayCandidate(c, tagColorByName, today, c.blockedReason),
        ),
      ),
    );
  }, [visible, tagColorByName, preselected, logicalToday, assignYmd]);

  const effectiveSpan = allDay ? fullDaySlots : span;
  const canConfirm =
    !!picked &&
    !saving &&
    (allDay
      ? canAssignAllDay
      : span >= 1 && span <= maxSpan);
  const showList = !preselected && !picked;
  const dateLabel = formatAssignTitle(assignYmd);

  const filteredEligible = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = eligible;
    if (seg === 'todo') list = list.filter((c) => c.kind === 'task' && !c.projectId);
    else if (seg === 'projectTask') {
      list = list.filter((c) => c.kind === 'project' || (c.kind === 'task' && !!c.projectId));
    }
    if (q) {
      list = list.filter(
        (c) =>
          c.title.toLowerCase().includes(q) ||
          (c.projectName ?? '').toLowerCase().includes(q),
      );
    }
    return list;
  }, [eligible, query, seg]);

  const filteredBlocked = React.useMemo(() => {
    if (onlyEligible) return [] as DisplayCandidate[];
    const q = query.trim().toLowerCase();
    let list = blocked;
    if (seg === 'todo') list = list.filter((c) => c.kind === 'task' && !c.projectId);
    else if (seg === 'projectTask') {
      list = list.filter((c) => c.kind === 'project' || (c.kind === 'task' && !!c.projectId));
    }
    if (q) {
      list = list.filter(
        (c) =>
          c.title.toLowerCase().includes(q) ||
          (c.projectName ?? '').toLowerCase().includes(q) ||
          (c.blockedReason ?? '').toLowerCase().includes(q),
      );
    }
    return list;
  }, [blocked, onlyEligible, query, seg]);

  const submit = React.useCallback(async () => {
    if (!picked || !canConfirm) return;
    setSaving(true);
    try {
      await onConfirm({
        kind: picked.kind,
        id: picked.id,
        title: picked.title,
        spanSlots: effectiveSpan,
        assignYmd,
        allDay: allDay || undefined,
      });
      onClose();
    } catch (err) {
      Alert.alert('入格失败', err instanceof Error ? err.message : '请稍后重试');
    } finally {
      setSaving(false);
    }
  }, [picked, canConfirm, onConfirm, effectiveSpan, assignYmd, allDay, onClose]);

  const sheetBg = isDark ? tf.paper2 : tf.card;
  const translateY = sheetY.interpolate({
    inputRange: [0, 1],
    outputRange: [0, Math.min(480, winH * 0.55)],
  });
  const maxSheetH = Math.round(winH * 0.86);

  const renderSpanStep = (item: DisplayCandidate) => (
    <View style={styles.spanStep}>
      <FoldPopIn animate={animate} delayMs={40} duration={360}>
        <View
          style={[
            styles.previewCard,
            {
              backgroundColor: isDark ? 'rgba(232,239,217,0.12)' : 'rgba(232,239,217,0.42)',
              borderColor: isDark ? tf.line2 : '#C8D8B1',
            },
          ]}>
          <FrogMark tf={tf} size={27} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[styles.previewTitle, { color: tf.ink2 }]} numberOfLines={2}>
              {item.title}
            </Text>
            <Text style={[styles.previewSub, { color: tf.muted }]} numberOfLines={1}>
              {candidateSubline(item)}
              {item.rewardPoints > 0 ? ` · 完成 +${item.rewardPoints} 积分` : ''}
            </Text>
          </View>
          <View style={[styles.previewTag, { backgroundColor: tf.lily2 }]}>
            <Text style={[styles.previewTagText, { color: tf.frog }]}>可放入</Text>
          </View>
        </View>
      </FoldPopIn>

      <Text style={[styles.spanHint, { color: tf.muted }]}>
        {allDay
          ? `全天 · 占用当日全部 ${fullDaySlots} 格`
          : `连续占用格数（最多 ${maxSpan}）`}
      </Text>
      <View style={styles.spanRow}>
        {canAssignAllDay ? (
          <Pressable
            onPress={() => {
              setAllDay(true);
              setSpan(fullDaySlots);
            }}
            accessibilityRole="button"
            accessibilityState={{ selected: allDay }}
            accessibilityLabel="指派全天"
            style={[
              styles.spanChip,
              styles.allDayChip,
              {
                borderColor: allDay ? tf.pond : tf.line2,
                backgroundColor: allDay ? tf.lily2 : 'transparent',
              },
            ]}>
            <MaterialIcons
              name="wb-sunny"
              size={14}
              color={allDay ? tf.pond : tf.muted}
            />
            <Text
              style={{
                color: allDay ? tf.pond : tf.ink,
                fontWeight: '700',
                fontSize: 13,
              }}>
              全天
            </Text>
          </Pressable>
        ) : null}
        {Array.from({ length: maxSpan }, (_, i) => i + 1).map((n) => {
          const active = !allDay && span === n;
          return (
            <Pressable
              key={n}
              onPress={() => {
                setAllDay(false);
                setSpan(n);
              }}
              style={[
                styles.spanChip,
                {
                  borderColor: active ? tf.pond : tf.line2,
                  backgroundColor: active ? tf.lily2 : 'transparent',
                },
              ]}>
              <Text
                style={{
                  color: active ? tf.pond : tf.ink,
                  fontWeight: '700',
                  fontFamily: fonts.mono,
                }}>
                {n}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.foot2}>
        <Pressable
          onPress={() => {
            if (preselected) onClose();
            else setPicked(null);
          }}
          style={({ pressed }) => [
            styles.ghostBtn,
            {
              borderColor: tf.line2,
              backgroundColor: isDark ? tf.paper3 : 'rgba(255,252,245,0.55)',
              opacity: pressed ? 0.85 : 1,
            },
          ]}>
          <Text style={[styles.ghostBtnText, { color: tf.ink2 }]}>
            {preselected ? '取消' : '重选'}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => void submit()}
          disabled={!canConfirm}
          style={({ pressed }) => [
            styles.primaryBtn,
            {
              backgroundColor: canConfirm ? tf.pond : tf.faint,
              opacity: pressed && canConfirm ? 0.92 : 1,
              shadowColor: tf.shadow,
            },
          ]}>
          {saving ? (
            <ActivityIndicator color={tf.onPond} />
          ) : (
            <>
              <MaterialIcons name="cruelty-free" size={18} color={tf.onPond} />
              <Text style={[styles.primaryBtnText, { color: tf.onPond }]}>
                {allDay ? '指派全天' : '确认入格'}
              </Text>
            </>
          )}
        </Pressable>
      </View>
    </View>
  );

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Animated.View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: tf.dim, opacity: scrim },
          ]}
        />
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="关闭" />
        <Animated.View
          style={[
            styles.sheet,
            {
              backgroundColor: sheetBg,
              borderTopColor: tf.line,
              paddingBottom: Math.max(insets.bottom, 14),
              maxHeight: maxSheetH,
              transform: [{ translateY }],
              shadowColor: tf.shadow,
            },
          ]}>
          <View style={[styles.handle, { backgroundColor: tf.line2 }]} />

          <View style={styles.sheetHead}>
            <FrogMark tf={tf} size={32} hop />
            <View style={styles.sheetHeadCopy}>
              <Text
                style={[
                  styles.sheetTitle,
                  { color: tf.pond, fontFamily: fonts.serif },
                ]}>
                {showList ? `把这件事放进 ${dateLabel}` : '选择占用格数'}
              </Text>
              <Text style={[styles.sheetSub, { color: tf.muted }]}>
                {showList
                  ? '先选任务或项目 · 已完成 / 搁置 / 未开始项目不可入格'
                  : `放入 ${dateLabel} · 选格数或指派全天`}
              </Text>
            </View>
            <Pressable
              onPress={onClose}
              hitSlop={8}
              accessibilityLabel="关闭"
              style={({ pressed }) => [
                styles.closeBtn,
                { backgroundColor: isDark ? tf.paper3 : '#EFEADD', opacity: pressed ? 0.8 : 1 },
              ]}>
              <MaterialIcons name="close" size={16} color={tf.muted} />
            </Pressable>
          </View>

          {showList ? (
            <View style={{ flexGrow: 1, minHeight: 120 }}>
              <SheetSeg tf={tf} value={seg} onChange={setSeg} />

              <View
                style={[
                  styles.searchRow,
                  {
                    backgroundColor: isDark ? tf.paper3 : 'rgba(255,252,245,0.7)',
                    borderColor: isDark ? tf.line : 'rgba(216,205,187,0.8)',
                  },
                ]}>
                <MaterialIcons name="search" size={16} color={tf.faint} />
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder="搜索任务或项目…"
                  placeholderTextColor={tf.faint}
                  style={[styles.searchInput, { color: tf.ink }]}
                  returnKeyType="search"
                />
                <Pressable
                  onPress={() => setOnlyEligible((v) => !v)}
                  hitSlop={6}
                  style={styles.onlyEligible}>
                  <Text
                    style={{
                      fontSize: 11,
                      fontWeight: onlyEligible ? '700' : '500',
                      color: onlyEligible ? tf.pond : tf.faint,
                    }}>
                    仅可入格
                  </Text>
                </Pressable>
              </View>

              {loading ? (
                <ActivityIndicator color={tf.pond} style={{ marginVertical: 28 }} />
              ) : (
                <ScrollView
                  style={{ maxHeight: Math.round(winH * 0.52) }}
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}>
                  <View style={styles.capRow}>
                    <Text style={[styles.capTitle, { color: tf.muted }]}>最佳空档</Text>
                    <Text style={[styles.capHint, { color: tf.faint }]}>
                      按优先级与截止时间排序
                    </Text>
                  </View>

                  {filteredEligible.length === 0 ? (
                    <Text style={[styles.emptyText, { color: tf.muted }]}>
                      {eligible.length === 0
                        ? '当日暂无可指派项。'
                        : '当前筛选下暂无可入格项。'}
                    </Text>
                  ) : (
                    filteredEligible.map((c, i) => (
                      <CandRow
                        key={`${c.kind}-${c.id}`}
                        tf={tf}
                        fonts={fonts}
                        item={c}
                        index={i}
                        animate={animate}
                        onPress={() => setPicked(c)}
                      />
                    ))
                  )}

                  {!onlyEligible && blocked.length > 0 ? (
                    <>
                      <Pressable
                        onPress={() => setBlockedOpen((v) => !v)}
                        style={[styles.capRow, { marginTop: 8 }]}>
                        <Text style={[styles.capTitle, { color: tf.muted }]}>暂不可入格</Text>
                        <Text style={[styles.capHint, { color: tf.faint }]}>
                          {blockedOpen
                            ? `${filteredBlocked.length} 项`
                            : '点开查看原因'}
                        </Text>
                        <MaterialIcons
                          name={blockedOpen ? 'expand-less' : 'expand-more'}
                          size={16}
                          color={tf.faint}
                        />
                      </Pressable>
                      {blockedOpen
                        ? filteredBlocked.map((c, i) => (
                            <CandRow
                              key={`blocked-${c.kind}-${c.id}`}
                              tf={tf}
                              fonts={fonts}
                              item={c}
                              index={i}
                              animate={animate}
                              disabled
                            />
                          ))
                        : null}
                    </>
                  ) : null}

                  <View style={styles.candNote}>
                    <MaterialIcons name="lightbulb-outline" size={13} color={tf.faint} />
                    <Text style={[styles.candNoteText, { color: tf.faint, flex: 1 }]}>
                      长按主屏待办 / 项目后会带上预选，减少一次选择。
                    </Text>
                    {!onlyEligible ? (
                      <Text style={{ color: tf.amberInk, fontWeight: '700', fontSize: 11 }}>
                        不可入格
                      </Text>
                    ) : null}
                  </View>
                </ScrollView>
              )}
            </View>
          ) : picked ? (
            renderSpanStep(picked)
          ) : null}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingTop: 8,
    gap: 8,
    shadowOpacity: 0.22,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: -12 },
    elevation: 16,
  },
  handle: {
    alignSelf: 'center',
    width: 34,
    height: 4,
    borderRadius: 4,
    marginBottom: 4,
  },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingHorizontal: 2,
    paddingBottom: 4,
  },
  sheetHeadCopy: { flex: 1, minWidth: 0 },
  sheetTitle: {
    fontSize: 17,
    fontWeight: '600',
    letterSpacing: 0.2,
    lineHeight: 22,
  },
  sheetSub: {
    marginTop: 3,
    fontSize: 12,
    lineHeight: 16,
  },
  closeBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  frogmark: {
    alignItems: 'center',
    justifyContent: 'center',
    shadowOpacity: 0.16,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  segTrack: {
    height: 32,
    borderRadius: 8,
    padding: 2,
    flexDirection: 'row',
    position: 'relative',
    marginTop: 2,
    marginBottom: 4,
  },
  segInd: {
    position: 'absolute',
    left: 0,
    top: 2,
    bottom: 2,
    borderRadius: 6,
    shadowOpacity: 0.09,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  segBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  segText: { fontSize: 12 },
  searchRow: {
    height: 36,
    borderRadius: 9,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    marginBottom: 2,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    paddingVertical: 0,
  },
  onlyEligible: { paddingLeft: 4 },
  capRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 2,
    paddingTop: 8,
    paddingBottom: 4,
  },
  capTitle: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  capHint: {
    marginLeft: 'auto',
    fontSize: 11,
    fontWeight: '400',
  },
  emptyText: {
    paddingVertical: 16,
    paddingHorizontal: 4,
    fontSize: 13,
    lineHeight: 18,
  },
  cand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 9,
    paddingHorizontal: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(232,224,210,0.5)',
  },
  candIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  candCopy: { flex: 1, minWidth: 0 },
  candTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  candTitle: {
    flexShrink: 1,
    fontSize: 14,
    fontWeight: '700',
  },
  kindTag: {
    height: 16,
    borderRadius: 4,
    paddingHorizontal: 5,
    justifyContent: 'center',
  },
  kindTagText: { fontSize: 10, fontWeight: '600' },
  candSub: {
    marginTop: 2,
    fontSize: 11,
  },
  slotChip: {
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  slotChipText: {
    fontSize: 10,
    fontWeight: '600',
    textAlign: 'center',
  },
  candNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 2,
    paddingTop: 10,
    paddingBottom: 4,
  },
  candNoteText: { fontSize: 11, lineHeight: 15 },
  spanStep: { gap: 10, paddingBottom: 2 },
  previewCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  previewTitle: { fontSize: 14, fontWeight: '700' },
  previewSub: { fontSize: 11, marginTop: 2 },
  previewTag: {
    height: 20,
    borderRadius: 6,
    paddingHorizontal: 7,
    justifyContent: 'center',
  },
  previewTagText: { fontSize: 11, fontWeight: '700' },
  spanHint: { fontSize: 12 },
  spanRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  spanChip: {
    minWidth: 44,
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  allDayChip: {
    flexDirection: 'row',
    gap: 4,
    minWidth: 72,
    paddingHorizontal: 14,
  },
  foot2: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  ghostBtn: {
    flex: 1,
    height: 42,
    borderRadius: 13,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghostBtnText: { fontSize: 14, fontWeight: '600' },
  primaryBtn: {
    flex: 1.4,
    height: 44,
    borderRadius: 13,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  primaryBtnText: { fontSize: 14, fontWeight: '700' },
});
