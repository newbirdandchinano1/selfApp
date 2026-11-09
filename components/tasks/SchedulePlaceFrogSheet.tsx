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
import {
  getProjectTaskTreeMap,
  type TaskTreeNode,
} from '@/lib/repositories/tasks/task';
import {
  breakIntersectingInterval,
  formatMinutesAsHm,
  SCHEDULE_DAY_END_MAX_MINUTES,
} from '@/lib/schedule/axis';
import { formatEventDuration } from '@/lib/schedule/timeline/layout';
import { semanticBucketsForAxis } from '@/lib/schedule/timeline/labels';
import type { ScheduleBreak, ScheduleSubjectKind } from '@/lib/schedule/types';
import { addDaysToYmd, formatYmd, parseYmd } from '@/lib/date';
import { isEditableScheduleDay } from '@/lib/schedule/week';
import { isTaskDueOverdue } from '@/lib/standalone-todo-visibility';
import { MaterialIcons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
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
  /** 阶段 G：按分钟写入时的开始分钟（逻辑日轴；全天时省略） */
  startMinutes?: number;
  /** 阶段 G：按分钟写入时的结束分钟（半开；全天时省略） */
  endMinutes?: number;
  /**
   * 批量入格时相对点选格起点的偏移格数（单项为 0）。
   * 分钟模式下不必使用：每条自带 startMinutes/endMinutes。
   */
  startSlotOffset?: number;
};

function candidateKey(item: { kind: string; id: string }): string {
  return `${item.kind}:${item.id}`;
}

/** 阶段 G：分钟写入所需的时间轴 */
export type ScheduleMinuteAxis = {
  startMinutes: number;
  endMinutes: number;
  slotHours: number;
  breaks?: ScheduleBreak[];
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
  /** 当日可排工作格总数；用于「全天」语义（默认与 maxSpan 相同） */
  daySlotCount?: number;
  /** 从顶部全天格打开时默认勾选全天 */
  initialAllDay?: boolean;
  lockedProjectIds?: Set<string>;
  /** 已选定主体时跳过列表，只选占用格数 */
  preselected?: SchedulePlacePreselected | null;
  /** 阶段 G：按分钟选择起止（时间线 write 开关开时启用） */
  minuteMode?: boolean;
  /** 阶段 G：分钟模式下的时间轴（校验起止 / 禁跨 break） */
  axis?: ScheduleMinuteAxis | null;
  /** 阶段 G：分钟模式默认开始分钟（通常为点选格起点） */
  defaultStartMinutes?: number;
  /** 阶段 G：分钟模式默认结束分钟（通常为点选格终点） */
  defaultEndMinutes?: number;
  /** 弹窗内改日期时同步父级（切日视图等） */
  onAssignYmdChange?: (ymd: string) => void;
  /** 确认入格；批量时按顺序传入多条（已排好时段/格偏移） */
  onConfirm: (results: SchedulePlaceResult[]) => Promise<void> | void;
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

function formatAssignDayChip(ymd: string, todayYmd: string): string {
  if (ymd === todayYmd) return '今天';
  if (ymd === addDaysToYmd(todayYmd, 1)) return '明天';
  if (ymd === addDaysToYmd(todayYmd, 2)) return '后天';
  return formatAssignTitle(ymd);
}

function ymdToPickerDate(ymd: string, fallbackYmd: string): Date {
  return parseYmd(ymd) ?? parseYmd(fallbackYmd) ?? new Date();
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

type ProjectPlaceGroup = {
  key: string;
  projectId: string;
  projectName: string;
  /** 无子任务的空项目：项目本身可入格 */
  projectCandidate: DisplayCandidate | null;
  tree: TaskTreeNode[];
  candidateById: Map<string, DisplayCandidate>;
  eligibleCount: number;
  totalCount: number;
  sortPriority: number;
  hasOverdue: boolean;
};

/** 只保留候选节点及其祖先，避免整棵项目树塞进弹窗 */
function pruneTreeToCandidateIds(
  nodes: TaskTreeNode[],
  candidateIds: Set<string>,
): TaskTreeNode[] {
  const out: TaskTreeNode[] = [];
  for (const node of nodes) {
    const children = pruneTreeToCandidateIds(
      Array.isArray(node.children) ? node.children : [],
      candidateIds,
    );
    if (candidateIds.has(node.id) || children.length > 0) {
      out.push({ ...node, children });
    }
  }
  return out;
}

function treeContainsQuery(nodes: TaskTreeNode[], q: string): boolean {
  for (const node of nodes) {
    if ((node.title ?? '').toLowerCase().includes(q)) return true;
    const ch = Array.isArray(node.children) ? node.children : [];
    if (ch.length > 0 && treeContainsQuery(ch, q)) return true;
  }
  return false;
}

function buildProjectPlaceGroups(
  items: DisplayCandidate[],
  taskTreeMap: Record<string, TaskTreeNode[]>,
): ProjectPlaceGroup[] {
  const byProject = new Map<
    string,
    {
      projectId: string;
      projectName: string;
      projectCandidate: DisplayCandidate | null;
      tasks: DisplayCandidate[];
    }
  >();

  for (const item of items) {
    if (item.kind === 'project') {
      const pid = item.id;
      const cur = byProject.get(pid) ?? {
        projectId: pid,
        projectName: item.title || item.projectName || '未命名项目',
        projectCandidate: null,
        tasks: [],
      };
      cur.projectCandidate = item;
      cur.projectName = item.title || cur.projectName;
      byProject.set(pid, cur);
      continue;
    }
    if (item.kind !== 'task' || !item.projectId) continue;
    const pid = item.projectId;
    const cur = byProject.get(pid) ?? {
      projectId: pid,
      projectName: item.projectName?.trim() || '未命名项目',
      projectCandidate: null,
      tasks: [],
    };
    if (item.projectName?.trim()) cur.projectName = item.projectName.trim();
    cur.tasks.push(item);
    byProject.set(pid, cur);
  }

  const groups: ProjectPlaceGroup[] = [];
  for (const cur of byProject.values()) {
    const candidateById = new Map<string, DisplayCandidate>();
    for (const t of cur.tasks) candidateById.set(t.id, t);
    const candidateIds = new Set(candidateById.keys());
    const rawTree = taskTreeMap[cur.projectId] ?? [];
    const tree =
      candidateIds.size > 0 ? pruneTreeToCandidateIds(rawTree, candidateIds) : [];

    // 本地树尚未同步时：退化为扁平任务列表（挂在虚拟根下）
    const displayTree =
      tree.length > 0
        ? tree
        : cur.tasks.map(
            (t) =>
              ({
                id: t.id,
                project_id: t.projectId,
                category_id: null,
                parent_task_id: null,
                title: t.title,
                description: null,
                note: null,
                status: 'todo',
                priority: (t.priority ?? 0) as 0 | 1 | 2 | 3 | 4,
                due_date: t.dueDate,
                completed_at: null,
                created_at: '',
                updated_at: '',
                sync_status: 'synced',
                extra_data: null,
                sort_order: 0,
                children: [],
              }) satisfies TaskTreeNode,
          );

    let eligibleCount = 0;
    let sortPriority = 0;
    let hasOverdue = false;
    const allItems = [
      ...(cur.projectCandidate ? [cur.projectCandidate] : []),
      ...cur.tasks,
    ];
    for (const it of allItems) {
      if (!it.blockedReason) eligibleCount += 1;
      sortPriority = Math.max(sortPriority, it.priority ?? 0);
      if (it.isOverdue) hasOverdue = true;
    }

    groups.push({
      key: cur.projectId,
      projectId: cur.projectId,
      projectName: cur.projectName,
      projectCandidate: cur.projectCandidate,
      tree: displayTree,
      candidateById,
      eligibleCount,
      totalCount: allItems.length,
      sortPriority,
      hasOverdue,
    });
  }

  return groups.sort((a, b) => {
    if (a.hasOverdue !== b.hasOverdue) return a.hasOverdue ? -1 : 1;
    if (a.eligibleCount !== b.eligibleCount) {
      if (a.eligibleCount === 0) return 1;
      if (b.eligibleCount === 0) return -1;
    }
    if (a.sortPriority !== b.sortPriority) return b.sortPriority - a.sortPriority;
    return a.projectName.localeCompare(b.projectName, 'zh');
  });
}

/**
 * 轴分钟 → 墙钟展示。
 * 逻辑日可越过午夜（如 1440=次日 00:00、1680=次日 04:00），禁止直接显示 24:00 / 28:00。
 */
function axisTimeDisplayValue(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m >= SCHEDULE_DAY_END_MAX_MINUTES) {
    const wall = m % SCHEDULE_DAY_END_MAX_MINUTES;
    const h = Math.floor(wall / 60);
    const mm = wall % 60;
    return `次日 ${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }
  return formatMinutesAsHm(m);
}

/** 快捷时段芯片文案：跨午夜片段标「次日」 */
function quickPeriodChipLabel(startMinutes: number, label: string): string {
  return startMinutes >= SCHEDULE_DAY_END_MAX_MINUTES ? `${label}·次日` : label;
}

/** 轴分钟 → 给 DateTimePicker 的墙钟 Date（小时对 24 取模） */
function axisMinutesToPickerDate(minutes: number): Date {
  const m = Math.max(0, Math.round(minutes));
  const d = new Date();
  d.setSeconds(0, 0);
  d.setHours(Math.floor(m / 60) % 24, m % 60, 0, 0);
  return d;
}

/**
 * 滚轮选出的墙钟分钟映射回逻辑日轴分钟。
 * 轴可跨午夜（≥24h）：在 [min,max] 内优先贴近当前值。
 */
function resolveAxisMinutesFromClock(
  clockMins: number,
  prev: number,
  min: number,
  max: number,
): number {
  const normalized = ((clockMins % (24 * 60)) + 24 * 60) % (24 * 60);
  const candidates = [normalized, normalized + 24 * 60].filter((m) => m >= min && m <= max);
  if (candidates.length === 0) {
    return Math.min(max, Math.max(min, normalized));
  }
  return candidates.reduce((best, m) =>
    Math.abs(m - prev) < Math.abs(best - prev) ? m : best,
  );
}

/** 阶段 G：单个时刻（−5 / 时间选择器 / +5）；滚轮选分，支持跨午夜轴 */
function AxisTimeField({
  label,
  value,
  min,
  max,
  onChange,
  tf,
  fonts,
  isDark,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (next: number) => void;
  tf: TaskFoldPalette;
  fonts: ReturnType<typeof useTaskFoldTheme>['fonts'];
  isDark: boolean;
}) {
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [draft, setDraft] = React.useState(() => axisMinutesToPickerDate(value));

  const clampToRange = (n: number) => Math.min(max, Math.max(min, n));

  const openPicker = () => {
    setDraft(axisMinutesToPickerDate(value));
    setPickerOpen(true);
  };

  const commitDraft = () => {
    const clock = draft.getHours() * 60 + draft.getMinutes();
    onChange(resolveAxisMinutesFromClock(clock, value, min, max));
    setPickerOpen(false);
  };

  const step = (delta: number) => {
    onChange(clampToRange(value + delta));
  };

  return (
    <View style={styles.timeFieldRow}>
      <Text style={[styles.timeFieldLabel, { color: tf.muted }]}>{label}</Text>
      <Pressable
        onPress={() => step(-5)}
        accessibilityRole="button"
        accessibilityLabel={`${label}减5分钟`}
        style={({ pressed }) => [
          styles.timeStepBtn,
          { borderColor: tf.line2, opacity: pressed ? 0.8 : 1 },
        ]}>
        <Text style={{ color: tf.ink2, fontWeight: '700', fontFamily: fonts.mono }}>−5</Text>
      </Pressable>
      <Pressable
        onPress={openPicker}
        accessibilityRole="button"
        accessibilityLabel={`选择${label}时间`}
        style={({ pressed }) => [
          styles.timeInputWrap,
          {
            borderColor: pickerOpen ? tf.pond : tf.line2,
            backgroundColor: isDark ? tf.paper3 : 'rgba(255,252,245,0.72)',
            opacity: pressed ? 0.88 : 1,
          },
        ]}>
        <Text style={[styles.timeInput, { color: tf.ink2, fontFamily: fonts.mono }]}>
          {axisTimeDisplayValue(value)}
        </Text>
        <MaterialIcons name="schedule" size={14} color={tf.muted} style={{ marginLeft: 4 }} />
      </Pressable>
      <Pressable
        onPress={() => step(5)}
        accessibilityRole="button"
        accessibilityLabel={`${label}加5分钟`}
        style={({ pressed }) => [
          styles.timeStepBtn,
          { borderColor: tf.line2, opacity: pressed ? 0.8 : 1 },
        ]}>
        <Text style={{ color: tf.ink2, fontWeight: '700', fontFamily: fonts.mono }}>+5</Text>
      </Pressable>

      <Modal
        visible={pickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setPickerOpen(false)}>
        <View style={styles.timePickerBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setPickerOpen(false)} />
          <View
            style={[
              styles.timePickerCard,
              {
                backgroundColor: isDark ? tf.paper2 : '#FFFCF5',
                borderColor: isDark ? tf.line2 : 'rgba(216,205,187,0.7)',
              },
            ]}>
            <Text style={[styles.timePickerTitle, { color: tf.ink2 }]}>选择{label}时间</Text>
            <DateTimePicker
              value={draft}
              mode="time"
              // Modal 内必须用 spinner：Android default 是系统对话框，组件本身空白
              display="spinner"
              is24Hour
              locale="zh-CN"
              themeVariant={isDark ? 'dark' : 'light'}
              textColor={tf.ink2}
              onChange={(_, date) => {
                if (date) {
                  const next = new Date(date);
                  next.setSeconds(0, 0);
                  setDraft(next);
                }
              }}
              style={styles.nativeTimePicker}
            />
            <View style={styles.timePickerActions}>
              <Pressable
                onPress={() => setPickerOpen(false)}
                style={[
                  styles.timePickerBtn,
                  { backgroundColor: isDark ? tf.paper3 : 'rgba(241,237,225,0.9)' },
                ]}>
                <Text style={{ fontSize: 14, fontWeight: '600', color: tf.muted }}>取消</Text>
              </Pressable>
              <Pressable
                onPress={commitDraft}
                style={[styles.timePickerBtn, { backgroundColor: tf.pond }]}>
                <Text style={{ fontSize: 14, fontWeight: '700', color: tf.onPond }}>确定</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
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
  checked,
  batchMode,
  disabled,
  index,
  animate,
  onPress,
  depth = 0,
  leading,
}: {
  tf: TaskFoldPalette;
  fonts: ReturnType<typeof useTaskFoldTheme>['fonts'];
  item: DisplayCandidate;
  selected?: boolean;
  /** 多选勾选态 */
  checked?: boolean;
  batchMode?: boolean;
  disabled?: boolean;
  index: number;
  animate: boolean;
  onPress?: () => void;
  /** 项目树缩进层级（0=顶层） */
  depth?: number;
  /** 树行左侧展开箭头等 */
  leading?: React.ReactNode;
}) {
  const sub = disabled ? lockReason(item) : candidateSubline(item);
  const slotOccupied = item.alreadyAssigned && !disabled;
  const padLeft = depth > 0 ? 6 + depth * 14 : 6;
  const highlight = selected || !!checked;

  return (
    <FoldRiseIn animate={animate} index={index} staggerMs={TaskFoldMotion.rowStagger} fromY={10}>
      <Pressable
        onPress={disabled ? undefined : onPress}
        disabled={disabled}
        accessibilityState={batchMode ? { selected: !!checked, disabled } : { disabled }}
        style={({ pressed }) => [
          styles.cand,
          { paddingLeft: padLeft },
          highlight && { backgroundColor: 'rgba(232,239,217,0.55)', borderRadius: 8 },
          disabled && { opacity: 0.55 },
          pressed && !disabled && { opacity: 0.88 },
        ]}>
        {batchMode ? (
          <View
            style={[
              styles.checkBox,
              {
                borderColor: checked ? tf.pond : tf.line2,
                backgroundColor: checked ? tf.pond : 'transparent',
              },
            ]}>
            {checked ? <MaterialIcons name="check" size={14} color={tf.onPond} /> : null}
          </View>
        ) : null}
        {leading}
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

function ProjectGroupHeader({
  tf,
  fonts,
  group,
  collapsed,
  index,
  animate,
  onToggle,
  onSelectProject,
  batchMode = false,
  checked = false,
}: {
  tf: TaskFoldPalette;
  fonts: ReturnType<typeof useTaskFoldTheme>['fonts'];
  group: ProjectPlaceGroup;
  collapsed: boolean;
  index: number;
  animate: boolean;
  onToggle: () => void;
  onSelectProject?: () => void;
  batchMode?: boolean;
  checked?: boolean;
}) {
  const emptySelectable = !!group.projectCandidate && !group.projectCandidate.blockedReason;
  const emptyLocked = !!group.projectCandidate?.blockedReason;
  const chev = React.useRef(new Animated.Value(collapsed ? 0 : 1)).current;

  React.useEffect(() => {
    Animated.timing(chev, {
      toValue: collapsed ? 0 : 1,
      duration: animate ? TaskFoldMotion.treeExpand * 0.7 : 0,
      easing: FOLD_MOTION_EASE,
      useNativeDriver: true,
    }).start();
  }, [animate, chev, collapsed]);

  const rotate = chev.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '90deg'],
  });

  const hasTree = group.tree.length > 0;
  const countLabel =
    group.eligibleCount > 0
      ? `${group.eligibleCount}/${group.totalCount} 可入格`
      : `${group.totalCount} 项`;

  return (
    <FoldRiseIn animate={animate} index={index} staggerMs={TaskFoldMotion.rowStagger} fromY={8}>
      <View
        style={[
          styles.projectHead,
          {
            backgroundColor: checked
              ? 'rgba(232,239,217,0.55)'
              : 'rgba(232,239,217,0.28)',
            borderColor: tf.line2,
          },
        ]}>
        {batchMode && emptySelectable ? (
          <Pressable
            onPress={onSelectProject}
            hitSlop={6}
            accessibilityRole="checkbox"
            accessibilityState={{ checked }}
            accessibilityLabel={`选择项目 ${group.projectName}`}
            style={[
              styles.checkBox,
              {
                borderColor: checked ? tf.pond : tf.line2,
                backgroundColor: checked ? tf.pond : 'transparent',
                marginLeft: 4,
              },
            ]}>
            {checked ? <MaterialIcons name="check" size={14} color={tf.onPond} /> : null}
          </Pressable>
        ) : null}
        {hasTree ? (
          <Pressable
            onPress={onToggle}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={collapsed ? '展开项目任务' : '收起项目任务'}
            style={styles.treeChev}>
            <Animated.View style={{ transform: [{ rotate }] }}>
              <MaterialIcons name="chevron-right" size={16} color={tf.muted} />
            </Animated.View>
          </Pressable>
        ) : (
          <View style={styles.treeChev}>
            <MaterialIcons name="folder" size={14} color={tf.frog} />
          </View>
        )}
        <Pressable
          onPress={() => {
            if (emptySelectable && onSelectProject) {
              onSelectProject();
              return;
            }
            if (hasTree) onToggle();
          }}
          disabled={emptyLocked}
          style={({ pressed }) => [
            styles.projectHeadCopy,
            pressed && { opacity: 0.88 },
            emptyLocked && { opacity: 0.55 },
          ]}>
          <Text style={[styles.projectHeadTitle, { color: tf.ink2 }]} numberOfLines={1}>
            {group.projectName}
          </Text>
          <Text style={[styles.projectHeadMeta, { color: tf.faint, fontFamily: fonts.mono }]}>
            {emptySelectable
              ? '空项目可入格'
              : emptyLocked
                ? lockReason(group.projectCandidate!)
                : countLabel}
          </Text>
        </Pressable>
        {emptySelectable ? (
          <View style={[styles.slotChip, { backgroundColor: '#EAF0DA' }]}>
            <Text style={[styles.slotChipText, { color: '#5E8358', fontFamily: fonts.mono }]}>
              可入格
            </Text>
          </View>
        ) : emptyLocked ? (
          <MaterialIcons name="lock-outline" size={16} color={tf.faint} />
        ) : null}
      </View>
    </FoldRiseIn>
  );
}

function PlaceProjectTreeList({
  tf,
  fonts,
  groups,
  collapsedProjectIds,
  collapsedTaskIds,
  animate,
  batchMode,
  selectedKeys,
  onToggleProject,
  onToggleTask,
  onPick,
}: {
  tf: TaskFoldPalette;
  fonts: ReturnType<typeof useTaskFoldTheme>['fonts'];
  groups: ProjectPlaceGroup[];
  collapsedProjectIds: Record<string, boolean>;
  collapsedTaskIds: Record<string, boolean>;
  animate: boolean;
  batchMode: boolean;
  selectedKeys: Set<string>;
  onToggleProject: (projectId: string) => void;
  onToggleTask: (taskId: string) => void;
  onPick: (item: DisplayCandidate) => void;
}) {
  let rowIndex = 0;

  const renderNodes = (nodes: TaskTreeNode[], depth: number, candidateById: Map<string, DisplayCandidate>) =>
    nodes.map((node) => {
      const children = Array.isArray(node.children) ? node.children : [];
      const hasChildren = children.length > 0;
      const collapsed = hasChildren ? !!collapsedTaskIds[node.id] : false;
      const cand = candidateById.get(node.id);
      const idx = rowIndex++;

      const chev = hasChildren ? (
        <Pressable
          onPress={() => onToggleTask(node.id)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={collapsed ? '展开子任务' : '收起子任务'}
          style={styles.treeChev}>
          <MaterialIcons
            name={collapsed ? 'chevron-right' : 'expand-more'}
            size={16}
            color={tf.faint}
          />
        </Pressable>
      ) : (
        <View style={styles.treeChev}>
          <MaterialIcons name="fiber-manual-record" size={6} color={tf.faint} />
        </View>
      );

      return (
        <View key={node.id}>
          {cand ? (
            <CandRow
              tf={tf}
              fonts={fonts}
              item={cand}
              index={idx}
              animate={animate}
              batchMode={batchMode}
              checked={selectedKeys.has(candidateKey(cand))}
              disabled={!!cand.blockedReason}
              depth={depth}
              leading={chev}
              onPress={cand.blockedReason ? undefined : () => onPick(cand)}
            />
          ) : (
            <View style={[styles.structRow, { paddingLeft: 6 + depth * 14 }]}>
              {chev}
              <Text style={[styles.structTitle, { color: tf.muted }]} numberOfLines={1}>
                {node.title?.trim() || '（无标题）'}
              </Text>
              <Text style={[styles.structHint, { color: tf.faint }]}>结构节点</Text>
            </View>
          )}
          {hasChildren && !collapsed ? renderNodes(children, depth + 1, candidateById) : null}
        </View>
      );
    });

  return (
    <View>
      {groups.map((group) => {
        const collapsed = !!collapsedProjectIds[group.projectId];
        const headIdx = rowIndex++;
        const projectCand = group.projectCandidate;
        const projectChecked =
          !!projectCand && selectedKeys.has(candidateKey(projectCand));
        return (
          <View key={group.key} style={styles.projectGroup}>
            <ProjectGroupHeader
              tf={tf}
              fonts={fonts}
              group={group}
              collapsed={collapsed}
              index={headIdx}
              animate={animate}
              onToggle={() => onToggleProject(group.projectId)}
              onSelectProject={
                projectCand && !projectCand.blockedReason
                  ? () => onPick(projectCand)
                  : undefined
              }
              batchMode={batchMode}
              checked={projectChecked}
            />
            {!collapsed && group.tree.length > 0
              ? renderNodes(group.tree, 1, group.candidateById)
              : null}
          </View>
        );
      })}
    </View>
  );
}

export function SchedulePlaceFrogSheet({
  visible,
  onClose,
  assignYmd,
  maxSpan,
  daySlotCount,
  initialAllDay = false,
  lockedProjectIds,
  preselected,
  minuteMode = false,
  axis,
  defaultStartMinutes,
  defaultEndMinutes,
  onAssignYmdChange,
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
  const [taskTreeMap, setTaskTreeMap] = React.useState<Record<string, TaskTreeNode[]>>({});
  const [collapsedProjectIds, setCollapsedProjectIds] = React.useState<Record<string, boolean>>({});
  const [collapsedTaskIds, setCollapsedTaskIds] = React.useState<Record<string, boolean>>({});
  /** 进入时段步后的已选主体（1+）；null 表示仍在列表步 */
  const [pickedItems, setPickedItems] = React.useState<DisplayCandidate[] | null>(null);
  /** 列表步多选：勾选池（尚未点「下一步」） */
  const [batchMode, setBatchMode] = React.useState(false);
  const [selectedByKey, setSelectedByKey] = React.useState<Map<string, DisplayCandidate>>(
    () => new Map(),
  );
  const [span, setSpan] = React.useState(1);
  const [allDay, setAllDay] = React.useState(!!initialAllDay);
  const [selectedYmd, setSelectedYmd] = React.useState(assignYmd);
  const [logicalToday, setLogicalToday] = React.useState(assignYmd);
  const [datePickerOpen, setDatePickerOpen] = React.useState(false);
  const [datePickerDraft, setDatePickerDraft] = React.useState(() =>
    ymdToPickerDate(assignYmd, assignYmd),
  );
  const [tagColorByName, setTagColorByName] = React.useState<Map<string, string>>(() => new Map());
  const [seg, setSeg] = React.useState<SegKey>('recommend');
  const [query, setQuery] = React.useState('');
  const [onlyEligible, setOnlyEligible] = React.useState(false);
  const [blockedOpen, setBlockedOpen] = React.useState(false);
  const onAssignYmdChangeRef = React.useRef(onAssignYmdChange);
  onAssignYmdChangeRef.current = onAssignYmdChange;

  const axisStart = axis?.startMinutes ?? 8 * 60;
  const axisEnd = axis?.endMinutes ?? 22 * 60;
  const slotSpanMins = Math.max(30, Math.round((axis?.slotHours ?? 2) * 60));
  const [startM, setStartM] = React.useState(axisStart);
  const [endM, setEndM] = React.useState(Math.min(axisEnd, axisStart + slotSpanMins));

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

  const applySelectedYmd = React.useCallback((nextYmd: string, opts?: { notify?: boolean }) => {
    const today = logicalToday || assignYmd;
    const clamped =
      nextYmd && isEditableScheduleDay(nextYmd, today) ? nextYmd : today;
    setSelectedYmd((prev) => (prev === clamped ? prev : clamped));
    setDatePickerOpen(false);
    if (opts?.notify !== false) onAssignYmdChangeRef.current?.(clamped);
  }, [assignYmd, logicalToday]);

  const openedSessionRef = React.useRef(false);
  React.useEffect(() => {
    if (!visible) {
      openedSessionRef.current = false;
      setDatePickerOpen(false);
      return;
    }
    // 仅在本次打开时初始化；弹窗内改日会回写 assignYmd，不能把时段/选中态冲掉
    if (openedSessionRef.current) return;
    openedSessionRef.current = true;
    setSeg('recommend');
    setQuery('');
    setOnlyEligible(false);
    setBlockedOpen(false);
    setCollapsedProjectIds({});
    setCollapsedTaskIds({});
    setTaskTreeMap({});
    setBatchMode(false);
    setSelectedByKey(new Map());
    setPickedItems(null);
    const preferAllDay = !!initialAllDay;
    setAllDay(preferAllDay);
    setSpan(preferAllDay ? fullDaySlots : 1);
    setSelectedYmd(assignYmd);
    setDatePickerDraft(ymdToPickerDate(assignYmd, assignYmd));
    setDatePickerOpen(false);

    const initStart =
      defaultStartMinutes != null
        ? Math.min(axisEnd, Math.max(axisStart, defaultStartMinutes))
        : axisStart;
    const initEndRaw = defaultEndMinutes != null ? defaultEndMinutes : initStart + slotSpanMins;
    setStartM(initStart);
    setEndM(Math.min(axisEnd, Math.max(initStart + 5, initEndRaw)));
  }, [
    visible,
    assignYmd,
    initialAllDay,
    fullDaySlots,
    defaultStartMinutes,
    defaultEndMinutes,
    axisStart,
    axisEnd,
    slotSpanMins,
  ]);

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
      setBatchMode(false);
      setSelectedByKey(new Map());
      setPickedItems([
        toDisplayCandidate(preselected, tagColorByName, logicalToday || selectedYmd || assignYmd),
      ]);
      setEligible([]);
      setBlocked([]);
      setTaskTreeMap({});
      setLoading(false);
      return;
    }
    setPickedItems(null);
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const res = await fetchFrogCandidates({ assignYmd: selectedYmd || assignYmd });
        if (cancelled) return;
        const today = res.logicalToday || selectedYmd || assignYmd;
        setLogicalToday(today);
        // 若初始日早于逻辑今日，钳回今天
        if (selectedYmd && !isEditableScheduleDay(selectedYmd, today)) {
          setSelectedYmd(today);
          onAssignYmdChangeRef.current?.(today);
        }
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

        const projectIds = [
          ...new Set(
            [...canPlace, ...cannot]
              .map((c) =>
                c.kind === 'project' ? c.id : c.kind === 'task' && c.projectId ? c.projectId : '',
              )
              .filter(Boolean),
          ),
        ];
        if (projectIds.length === 0) {
          setTaskTreeMap({});
          return;
        }
        try {
          const trees = await getProjectTaskTreeMap(projectIds);
          if (!cancelled) setTaskTreeMap(trees);
        } catch (err) {
          console.warn('[schedule-place] 加载项目任务树失败', err);
          if (!cancelled) setTaskTreeMap({});
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // tagColorByName 变化时由下方 effect 仅重着色，避免重复请求
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, selectedYmd, lockedProjectIds, preselected]);

  React.useEffect(() => {
    if (!visible) return;
    const today = logicalToday || selectedYmd || assignYmd;
    if (preselected) {
      setPickedItems([toDisplayCandidate(preselected, tagColorByName, today)]);
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
  }, [visible, tagColorByName, preselected, logicalToday, selectedYmd, assignYmd]);

  const effectiveSpan = allDay ? fullDaySlots : span;
  const minuteRangeValid = React.useMemo(() => {
    if (!minuteMode) return true;
    if (allDay) return true;
    if (!(endM > startM)) return false;
    if (startM < axisStart || endM > axisEnd) return false;
    if (axis && breakIntersectingInterval(axis, startM, endM)) return false;
    return true;
  }, [minuteMode, allDay, endM, startM, axisStart, axisEnd, axis]);
  const minuteConflictLabel = React.useMemo(() => {
    if (!minuteMode || allDay) return '';
    if (!(endM > startM)) return '结束时间须晚于开始';
    if (startM < axisStart || endM > axisEnd) return '超出可排时间轴';
    if (axis) {
      const brk = breakIntersectingInterval(axis, startM, endM);
      if (brk) return `与「${brk.label?.trim() || '休息'}」重叠，请避开`;
    }
    return '';
  }, [minuteMode, allDay, endM, startM, axisStart, axisEnd, axis]);
  const minuteDurationLabel =
    minuteMode && !allDay && endM > startM ? formatEventDuration(startM, endM) : '';
  /** 可排轴上的语义时段，作快捷选择（裁剪到轴范围） */
  const quickPeriods = React.useMemo(() => {
    if (!minuteMode) return [];
    return semanticBucketsForAxis({
      startMinutes: axisStart,
      endMinutes: axisEnd,
      slotHours: axis?.slotHours ?? 2,
      breaks: axis?.breaks,
    });
  }, [minuteMode, axisStart, axisEnd, axis?.slotHours, axis?.breaks]);
  /** 从当前起点延伸的常用时长 */
  const quickDurations = React.useMemo(() => {
    if (!minuteMode) return [] as { key: string; label: string; minutes: number }[];
    const opts: { key: string; label: string; minutes: number }[] = [
      { key: '30', label: '30分', minutes: 30 },
      { key: '60', label: '1小时', minutes: 60 },
      { key: '120', label: '2小时', minutes: 120 },
    ];
    if (slotSpanMins !== 30 && slotSpanMins !== 60 && slotSpanMins !== 120) {
      opts.push({ key: 'slot', label: '一格', minutes: slotSpanMins });
    }
    return opts.filter((o) => startM + o.minutes <= axisEnd && o.minutes >= 5);
  }, [minuteMode, slotSpanMins, startM, axisEnd]);
  const pickedCount = pickedItems?.length ?? 0;
  const selectedCount = selectedByKey.size;
  const selectedKeys = React.useMemo(() => new Set(selectedByKey.keys()), [selectedByKey]);
  const batchPackError = React.useMemo(() => {
    if (!pickedItems || pickedItems.length <= 1) return '';
    if (allDay) return '';
    if (minuteMode) {
      if (!minuteRangeValid) return minuteConflictLabel || '时段无效';
      const duration = endM - startM;
      if (duration < 5) return '每段至少 5 分钟';
      for (let i = 0; i < pickedItems.length; i += 1) {
        const s = startM + i * duration;
        const e = s + duration;
        if (e > axisEnd) return `连续排 ${pickedItems.length} 项会超出可排时间轴`;
        if (axis && breakIntersectingInterval(axis, s, e)) {
          return `第 ${i + 1} 段与休息时段重叠，请缩短时长或改全天`;
        }
      }
      return '';
    }
    if (span < 1 || span > maxSpan) return '格数无效';
    if (pickedItems.length * span > maxSpan) {
      return `从当前格起最多还能连排 ${maxSpan} 格，装不下 ${pickedItems.length} × ${span} 格`;
    }
    return '';
  }, [
    pickedItems,
    allDay,
    minuteMode,
    minuteRangeValid,
    minuteConflictLabel,
    endM,
    startM,
    axisEnd,
    axis,
    span,
    maxSpan,
  ]);
  const canConfirm =
    pickedCount > 0 &&
    !saving &&
    !batchPackError &&
    (allDay
      ? canAssignAllDay
      : minuteMode
        ? minuteRangeValid
        : span >= 1 && span <= maxSpan);
  const showList = !preselected && pickedItems == null;
  const effectiveYmd = selectedYmd || assignYmd;
  const todayYmd = logicalToday || assignYmd;
  const dateLabel = formatAssignTitle(effectiveYmd);
  const dayQuickChips = React.useMemo(() => {
    const chips = [
      { key: 'today', ymd: todayYmd, label: '今天' },
      { key: 'tomorrow', ymd: addDaysToYmd(todayYmd, 1), label: '明天' },
      { key: 'dayAfter', ymd: addDaysToYmd(todayYmd, 2), label: '后天' },
    ];
    const isQuick = chips.some((c) => c.ymd === effectiveYmd);
    if (!isQuick && effectiveYmd) {
      chips.push({
        key: 'custom',
        ymd: effectiveYmd,
        label: formatAssignDayChip(effectiveYmd, todayYmd),
      });
    }
    return chips;
  }, [todayYmd, effectiveYmd]);

  const openDatePicker = React.useCallback(() => {
    setDatePickerDraft(ymdToPickerDate(effectiveYmd, todayYmd));
    setDatePickerOpen(true);
  }, [effectiveYmd, todayYmd]);

  const commitDatePicker = React.useCallback(() => {
    const ymd = formatYmd(datePickerDraft);
    if (!isEditableScheduleDay(ymd, todayYmd)) {
      Alert.alert('无法指派', '只能选择今天或未来的日期。');
      return;
    }
    applySelectedYmd(ymd);
  }, [applySelectedYmd, datePickerDraft, todayYmd]);

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

  /** 「项目 / 任务」Tab：可入格 +（可选）暂不可入格，合并成项目树 */
  const projectPlaceGroups = React.useMemo(() => {
    if (seg !== 'projectTask') return [] as ProjectPlaceGroup[];
    const merged = onlyEligible
      ? filteredEligible
      : [...filteredEligible, ...filteredBlocked];
    const groups = buildProjectPlaceGroups(merged, taskTreeMap);
    const q = query.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter((g) => {
      if (g.projectName.toLowerCase().includes(q)) return true;
      if (g.projectCandidate?.title.toLowerCase().includes(q)) return true;
      for (const c of g.candidateById.values()) {
        if (c.title.toLowerCase().includes(q)) return true;
        if ((c.blockedReason ?? '').toLowerCase().includes(q)) return true;
      }
      return treeContainsQuery(g.tree, q);
    });
  }, [
    seg,
    onlyEligible,
    filteredEligible,
    filteredBlocked,
    taskTreeMap,
    query,
  ]);

  const toggleProjectCollapsed = React.useCallback((projectId: string) => {
    setCollapsedProjectIds((prev) => ({ ...prev, [projectId]: !prev[projectId] }));
  }, []);

  const toggleTaskCollapsed = React.useCallback((taskId: string) => {
    setCollapsedTaskIds((prev) => ({ ...prev, [taskId]: !prev[taskId] }));
  }, []);

  const toggleBatchSelect = React.useCallback((item: DisplayCandidate) => {
    setSelectedByKey((prev) => {
      const key = candidateKey(item);
      const next = new Map(prev);
      if (next.has(key)) next.delete(key);
      else next.set(key, item);
      return next;
    });
  }, []);

  const handlePickCandidate = React.useCallback(
    (item: DisplayCandidate) => {
      if (batchMode) {
        toggleBatchSelect(item);
        return;
      }
      setPickedItems([item]);
    },
    [batchMode, toggleBatchSelect],
  );

  const enterSpanFromBatch = React.useCallback(() => {
    if (selectedByKey.size === 0) return;
    setPickedItems([...selectedByKey.values()]);
  }, [selectedByKey]);

  const buildResults = React.useCallback(
    (ymd: string): SchedulePlaceResult[] => {
      const items = pickedItems ?? [];
      if (items.length === 0) return [];
      if (allDay || !minuteMode) {
        return items.map((item, index) => ({
          kind: item.kind,
          id: item.id,
          title: item.title,
          spanSlots: effectiveSpan,
          assignYmd: ymd,
          allDay: allDay || undefined,
          startSlotOffset: allDay ? 0 : index * span,
        }));
      }
      const duration = endM - startM;
      return items.map((item, index) => {
        const s = startM + index * duration;
        const e = s + duration;
        return {
          kind: item.kind,
          id: item.id,
          title: item.title,
          spanSlots: effectiveSpan,
          assignYmd: ymd,
          startMinutes: s,
          endMinutes: e,
          startSlotOffset: index * span,
        };
      });
    },
    [pickedItems, allDay, minuteMode, effectiveSpan, span, startM, endM],
  );

  const submit = React.useCallback(async () => {
    if (!pickedItems?.length || !canConfirm) return;
    const ymd = selectedYmd || assignYmd;
    if (!isEditableScheduleDay(ymd, logicalToday || assignYmd)) {
      Alert.alert('无法指派', '只能选择今天或未来的日期。');
      return;
    }
    const results = buildResults(ymd);
    if (results.length === 0) return;
    setSaving(true);
    try {
      await onConfirm(results);
      onClose();
    } catch (err) {
      Alert.alert('入格失败', err instanceof Error ? err.message : '请稍后重试');
    } finally {
      setSaving(false);
    }
  }, [
    pickedItems,
    canConfirm,
    buildResults,
    onConfirm,
    selectedYmd,
    assignYmd,
    logicalToday,
    onClose,
  ]);

  const sheetBg = isDark ? tf.paper2 : tf.card;
  const translateY = sheetY.interpolate({
    inputRange: [0, 1],
    outputRange: [0, Math.min(480, winH * 0.55)],
  });
  const maxSheetH = Math.round(winH * 0.86);

  const renderSpanStep = (items: DisplayCandidate[]) => {
    const primary = items[0];
    const isBatch = items.length > 1;
    if (!primary) return null;
    return (
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
              {isBatch ? `批量指派 ${items.length} 项` : primary.title}
            </Text>
            <Text style={[styles.previewSub, { color: tf.muted }]} numberOfLines={isBatch ? 3 : 1}>
              {isBatch
                ? items.map((it) => it.title).join(' · ')
                : `${candidateSubline(primary)}${
                    primary.rewardPoints > 0 ? ` · 完成 +${primary.rewardPoints} 积分` : ''
                  }`}
            </Text>
          </View>
          <View style={[styles.previewTag, { backgroundColor: tf.lily2 }]}>
            <Text style={[styles.previewTagText, { color: tf.frog }]}>
              {isBatch ? `${items.length} 只` : '可放入'}
            </Text>
          </View>
        </View>
      </FoldPopIn>

      <Text style={[styles.spanHint, { color: tf.muted }]}>
        {isBatch
          ? minuteMode
            ? allDay
              ? '全天 · 各项同时铺满当日可排时段'
              : '按所选时长依次顺排；不够装时请缩短或改全天'
            : allDay
              ? '全天 · 各项放入顶部全天格'
              : `每项占 ${span} 格并顺排（从点选格起最多 ${maxSpan} 格）`
          : minuteMode
            ? allDay
              ? '全天 · 铺满当日可排时段'
              : '可点快捷时段，或点时刻微调（精确到分钟）'
            : allDay
              ? '全天 · 放入顶部全天格，不占用时段'
              : `连续占用格数（最多 ${maxSpan}）`}
      </Text>
      {batchPackError ? (
        <Text style={[styles.batchError, { color: tf.rose }]}>{batchPackError}</Text>
      ) : null}

      {minuteMode && !allDay ? (
        <View style={styles.timeFields}>
          {quickPeriods.length > 0 ? (
            <View style={styles.quickBlock}>
              <Text style={[styles.quickLabel, { color: tf.faint }]}>快捷时段</Text>
              <View style={styles.quickChipRow}>
                {quickPeriods.map((p) => {
                  const chipLabel = quickPeriodChipLabel(p.startMinutes, p.label);
                  const active =
                    !allDay && startM === p.startMinutes && endM === p.endMinutes;
                  return (
                    <Pressable
                      key={`${p.key}-${p.startMinutes}`}
                      onPress={() => {
                        setAllDay(false);
                        setStartM(p.startMinutes);
                        setEndM(p.endMinutes);
                      }}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      accessibilityLabel={`快捷时段 ${chipLabel} ${axisTimeDisplayValue(p.startMinutes)}到${axisTimeDisplayValue(p.endMinutes)}`}
                      style={[
                        styles.quickChip,
                        {
                          borderColor: active ? tf.pond : tf.line2,
                          backgroundColor: active ? tf.lily2 : 'transparent',
                        },
                      ]}>
                      <Text
                        style={{
                          color: active ? tf.pond : tf.ink,
                          fontWeight: '700',
                          fontSize: 12,
                        }}>
                        {chipLabel}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : null}
          {quickDurations.length > 0 ? (
            <View style={styles.quickBlock}>
              <Text style={[styles.quickLabel, { color: tf.faint }]}>从起点起</Text>
              <View style={styles.quickChipRow}>
                {quickDurations.map((d) => {
                  const nextEnd = Math.min(axisEnd, startM + d.minutes);
                  const active = !allDay && endM === nextEnd && endM - startM === d.minutes;
                  return (
                    <Pressable
                      key={d.key}
                      onPress={() => {
                        setAllDay(false);
                        setEndM(Math.min(axisEnd, Math.max(startM + 5, startM + d.minutes)));
                      }}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      accessibilityLabel={`时长 ${d.label}`}
                      style={[
                        styles.quickChip,
                        {
                          borderColor: active ? tf.pond : tf.line2,
                          backgroundColor: active ? tf.lily2 : 'transparent',
                        },
                      ]}>
                      <Text
                        style={{
                          color: active ? tf.pond : tf.ink,
                          fontWeight: '700',
                          fontSize: 12,
                          fontFamily: fonts.mono,
                        }}>
                        {d.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : null}
          <AxisTimeField
            label="开始"
            value={startM}
            min={axisStart}
            max={Math.max(axisStart, axisEnd - 5)}
            onChange={(v) => {
              setStartM(v);
              if (v >= endM) setEndM(Math.min(axisEnd, v + 5));
            }}
            tf={tf}
            fonts={fonts}
            isDark={isDark}
          />
          <AxisTimeField
            label="结束"
            value={endM}
            min={Math.min(axisEnd, axisStart + 5)}
            max={axisEnd}
            onChange={(v) => {
              setEndM(v);
              if (v <= startM) setStartM(Math.max(axisStart, v - 5));
            }}
            tf={tf}
            fonts={fonts}
            isDark={isDark}
          />
          <View style={styles.timeHintRow}>
            <MaterialIcons
              name={minuteConflictLabel ? 'error-outline' : 'schedule'}
              size={13}
              color={minuteConflictLabel ? tf.rose : tf.faint}
            />
            <Text
              style={[styles.timeHintText, { color: minuteConflictLabel ? tf.rose : tf.faint }]}
              numberOfLines={2}>
              {minuteConflictLabel ||
                `${minuteDurationLabel ? `${minuteDurationLabel} · ` : ''}${
                  axis
                    ? `可排 ${axisTimeDisplayValue(axisStart)}–${axisTimeDisplayValue(axisEnd)}`
                    : ''
                }`}
            </Text>
          </View>
        </View>
      ) : null}

      <View style={styles.spanRow}>
        {minuteMode ? (
          <Pressable
            onPress={() => setAllDay(false)}
            accessibilityRole="button"
            accessibilityState={{ selected: !allDay }}
            style={[
              styles.spanChip,
              {
                borderColor: !allDay ? tf.pond : tf.line2,
                backgroundColor: !allDay ? tf.lily2 : 'transparent',
              },
            ]}>
            <MaterialIcons name="schedule" size={14} color={!allDay ? tf.pond : tf.muted} />
            <Text style={{ color: !allDay ? tf.pond : tf.ink, fontWeight: '700', fontSize: 13 }}>
              指定时段
            </Text>
          </Pressable>
        ) : null}
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
        {!minuteMode
          ? Array.from({ length: maxSpan }, (_, i) => i + 1).map((n) => {
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
            })
          : null}
      </View>

      <View style={styles.foot2}>
        <Pressable
          onPress={() => {
            if (preselected) onClose();
            else setPickedItems(null);
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
                {pickedCount > 1
                  ? allDay
                    ? `指派全天 · ${pickedCount}`
                    : `确认入格 · ${pickedCount}`
                  : allDay
                    ? '指派全天'
                    : minuteMode
                      ? '确认时段'
                      : '确认入格'}
              </Text>
            </>
          )}
        </Pressable>
      </View>
    </View>
    );
  };

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
                {showList
                  ? batchMode
                    ? `批量放入 ${dateLabel}`
                    : `把这件事放进 ${dateLabel}`
                  : pickedCount > 1
                    ? '批量选择时段'
                    : minuteMode
                      ? '选择时段'
                      : '选择占用格数'}
              </Text>
              <Text style={[styles.sheetSub, { color: tf.muted }]}>
                {showList
                  ? batchMode
                    ? '勾选多项待办 / 项目，再点下一步统一入格'
                    : '先选日期，再选任务或项目 · 可开多选批量指派'
                  : minuteMode
                    ? `放入 ${dateLabel} · 选起止时刻或指派全天`
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

          <View style={styles.datePickRow}>
            {dayQuickChips.map((chip) => {
              const active = chip.ymd === effectiveYmd;
              return (
                <Pressable
                  key={chip.key}
                  onPress={() => applySelectedYmd(chip.ymd)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`指派到${chip.label}`}
                  style={[
                    styles.dateChip,
                    {
                      borderColor: active ? tf.pond : tf.line2,
                      backgroundColor: active ? tf.lily2 : 'transparent',
                    },
                  ]}>
                  <Text
                    style={{
                      color: active ? tf.pond : tf.ink,
                      fontWeight: '700',
                      fontSize: 12,
                    }}>
                    {chip.label}
                  </Text>
                </Pressable>
              );
            })}
            <Pressable
              onPress={openDatePicker}
              accessibilityRole="button"
              accessibilityLabel="选择具体日期"
              style={[
                styles.dateChip,
                styles.dateChipCalendar,
                {
                  borderColor: datePickerOpen ? tf.pond : tf.line2,
                  backgroundColor: datePickerOpen ? tf.lily2 : 'transparent',
                },
              ]}>
              <MaterialIcons
                name="event"
                size={14}
                color={datePickerOpen ? tf.pond : tf.muted}
              />
              <Text
                style={{
                  color: datePickerOpen ? tf.pond : tf.ink,
                  fontWeight: '700',
                  fontSize: 12,
                }}>
                选日期
              </Text>
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
                    <Text style={[styles.capTitle, { color: tf.muted }]}>
                      {seg === 'projectTask' ? '项目树' : '最佳空档'}
                    </Text>
                    <Text style={[styles.capHint, { color: tf.faint }]}>
                      {seg === 'projectTask'
                        ? '按项目折叠 · 叶子可入格'
                        : '按优先级与截止时间排序'}
                    </Text>
                    <Pressable
                      onPress={() => {
                        setBatchMode((v) => {
                          if (v) setSelectedByKey(new Map());
                          return !v;
                        });
                      }}
                      hitSlop={6}
                      accessibilityRole="button"
                      accessibilityState={{ selected: batchMode }}
                      accessibilityLabel={batchMode ? '退出多选' : '开启多选批量指派'}
                      style={[
                        styles.batchToggle,
                        {
                          borderColor: batchMode ? tf.pond : tf.line2,
                          backgroundColor: batchMode ? tf.lily2 : 'transparent',
                        },
                      ]}>
                      <MaterialIcons
                        name={batchMode ? 'checklist' : 'library-add-check'}
                        size={13}
                        color={batchMode ? tf.pond : tf.muted}
                      />
                      <Text
                        style={{
                          fontSize: 11,
                          fontWeight: '700',
                          color: batchMode ? tf.pond : tf.muted,
                        }}>
                        {batchMode ? '多选中' : '多选'}
                      </Text>
                    </Pressable>
                  </View>

                  {seg === 'projectTask' ? (
                    projectPlaceGroups.length === 0 ? (
                      <Text style={[styles.emptyText, { color: tf.muted }]}>
                        {eligible.length === 0 && blocked.length === 0
                          ? '当日暂无可指派项。'
                          : '当前筛选下暂无项目 / 任务。'}
                      </Text>
                    ) : (
                      <PlaceProjectTreeList
                        tf={tf}
                        fonts={fonts}
                        groups={projectPlaceGroups}
                        collapsedProjectIds={collapsedProjectIds}
                        collapsedTaskIds={collapsedTaskIds}
                        animate={animate}
                        batchMode={batchMode}
                        selectedKeys={selectedKeys}
                        onToggleProject={toggleProjectCollapsed}
                        onToggleTask={toggleTaskCollapsed}
                        onPick={handlePickCandidate}
                      />
                    )
                  ) : filteredEligible.length === 0 ? (
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
                        batchMode={batchMode}
                        checked={selectedKeys.has(candidateKey(c))}
                        onPress={() => handlePickCandidate(c)}
                      />
                    ))
                  )}

                  {seg !== 'projectTask' && !onlyEligible && blocked.length > 0 ? (
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
                      {batchMode
                        ? '勾选多项后点下一步；同日顺排时段，也可改全天。'
                        : '点「多选」可一次指派多项；长按主屏待办 / 项目可预选单条。'}
                    </Text>
                    {!onlyEligible ? (
                      <Text style={{ color: tf.amberInk, fontWeight: '700', fontSize: 11 }}>
                        不可入格
                      </Text>
                    ) : null}
                  </View>
                </ScrollView>
              )}
              {batchMode ? (
                <View style={styles.foot2}>
                  <Pressable
                    onPress={() => {
                      setBatchMode(false);
                      setSelectedByKey(new Map());
                    }}
                    style={({ pressed }) => [
                      styles.ghostBtn,
                      {
                        borderColor: tf.line2,
                        backgroundColor: isDark ? tf.paper3 : 'rgba(255,252,245,0.55)',
                        opacity: pressed ? 0.85 : 1,
                      },
                    ]}>
                    <Text style={[styles.ghostBtnText, { color: tf.ink2 }]}>取消多选</Text>
                  </Pressable>
                  <Pressable
                    onPress={enterSpanFromBatch}
                    disabled={selectedCount === 0}
                    style={({ pressed }) => [
                      styles.primaryBtn,
                      {
                        backgroundColor: selectedCount > 0 ? tf.pond : tf.faint,
                        opacity: pressed && selectedCount > 0 ? 0.92 : 1,
                        shadowColor: tf.shadow,
                      },
                    ]}>
                    <MaterialIcons name="arrow-forward" size={18} color={tf.onPond} />
                    <Text style={[styles.primaryBtnText, { color: tf.onPond }]}>
                      {selectedCount > 0 ? `下一步 · ${selectedCount}` : '请先勾选'}
                    </Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          ) : pickedItems && pickedItems.length > 0 ? (
            renderSpanStep(pickedItems)
          ) : null}
        </Animated.View>
      </View>

      <Modal
        visible={datePickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setDatePickerOpen(false)}>
        <View style={styles.timePickerBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setDatePickerOpen(false)} />
          <View
            style={[
              styles.timePickerCard,
              {
                backgroundColor: isDark ? tf.paper2 : '#FFFCF5',
                borderColor: isDark ? tf.line2 : 'rgba(216,205,187,0.7)',
              },
            ]}>
            <Text style={[styles.timePickerTitle, { color: tf.ink2 }]}>选择指派日期</Text>
            <DateTimePicker
              value={datePickerDraft}
              mode="date"
              // Modal 内必须用 spinner：Android default 是系统对话框，组件本身空白
              display="spinner"
              minimumDate={ymdToPickerDate(todayYmd, todayYmd)}
              locale="zh-CN"
              themeVariant={isDark ? 'dark' : 'light'}
              textColor={tf.ink2}
              onChange={(_, date) => {
                if (!date) return;
                const next = new Date(date);
                next.setHours(12, 0, 0, 0);
                setDatePickerDraft(next);
              }}
              style={styles.nativeTimePicker}
            />
            <View style={styles.timePickerActions}>
              <Pressable
                onPress={() => setDatePickerOpen(false)}
                style={[
                  styles.timePickerBtn,
                  { backgroundColor: isDark ? tf.paper3 : 'rgba(241,237,225,0.9)' },
                ]}>
                <Text style={{ fontSize: 14, fontWeight: '600', color: tf.muted }}>取消</Text>
              </Pressable>
              <Pressable
                onPress={commitDatePicker}
                style={[styles.timePickerBtn, { backgroundColor: tf.pond }]}>
                <Text style={{ fontSize: 14, fontWeight: '700', color: tf.onPond }}>确定</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
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
  datePickRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 2,
    paddingBottom: 2,
  },
  dateChip: {
    minHeight: 32,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  dateChipCalendar: {
    flexDirection: 'row',
    gap: 4,
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
  batchToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderWidth: 1,
    borderRadius: 7,
    paddingHorizontal: 7,
    paddingVertical: 4,
  },
  checkBox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  batchError: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    marginTop: 2,
    paddingHorizontal: 2,
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
  projectGroup: {
    marginBottom: 6,
  },
  projectHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: 4,
  },
  projectHeadCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  projectHeadTitle: {
    fontSize: 13.5,
    fontWeight: '700',
  },
  projectHeadMeta: {
    fontSize: 10.5,
  },
  treeChev: {
    width: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  structRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 7,
    paddingRight: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(232,224,210,0.5)',
  },
  structTitle: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    fontWeight: '600',
  },
  structHint: {
    fontSize: 10,
    fontWeight: '600',
  },
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
  quickBlock: { gap: 6 },
  quickLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  quickChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  quickChip: {
    minHeight: 32,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  timeFields: { gap: 8 },
  timeFieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  timeFieldLabel: {
    width: 34,
    fontSize: 13,
    fontWeight: '600',
  },
  timeStepBtn: {
    width: 40,
    height: 38,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timeInputWrap: {
    flex: 1,
    height: 38,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  timeInput: {
    fontSize: 16,
    fontWeight: '700',
    paddingVertical: 0,
    textAlign: 'center',
    letterSpacing: 1,
  },
  timePickerBackdrop: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 28,
    backgroundColor: 'rgba(20, 30, 24, 0.45)',
  },
  timePickerCard: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 14,
    gap: 10,
  },
  timePickerTitle: {
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
  },
  nativeTimePicker: {
    alignSelf: 'center',
    width: '100%',
    height: 180,
  },
  timePickerActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  timePickerBtn: {
    minWidth: 72,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  timeHintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 2,
  },
  timeHintText: { flex: 1, fontSize: 11, lineHeight: 15 },
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
