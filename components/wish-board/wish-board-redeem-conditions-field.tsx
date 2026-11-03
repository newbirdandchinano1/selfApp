import type { WishBoxPalette, WishBoxShadowSet } from '@/constants/wish-box-ui';
import { useWishBoxTheme, useWishStyles } from '@/hooks/use-wish-box-theme';
import { WishFormLabel, WishToggleRow } from '@/components/wish-board/wish-board-form-ui';
import { WishBoxGradientFill } from '@/components/wish-board/wish-box-gradient-fill';
import { formatSignedMoneyTrunc2 } from '@/lib/finance-net-worth';
import type { ProjectRow } from '@/lib/repositories/projects/project.types';
import { buildTaskTreeFromRows, type TaskTreeNode } from '@/lib/repositories/tasks/task';
import type { TaskRow } from '@/lib/repositories/tasks/task.types';
import type { HabitRow } from '@/lib/repositories/habits/habit.types';
import { parseHabitKind } from '@/lib/repositories/habits/habit-kind';
import { parseCompletionHabitIds } from '@/lib/repositories/projects/project-completion-habits';
import {
  formatAvailableFromDate,
  formatAvailableFromLabel,
  formatWishHabitPickerSubtitle,
  isHabitEligibleForWishRedeem,
  isProjectBoundTask,
  isProjectRedeemConditionMet,
  isTaskRedeemConditionMet,
  isTodoBoundTask,
  normalizeMinNetWorth,
  parseAvailableFromDate,
  type WishBoardRedeemConditions,
} from '@/lib/repositories/wish-board/wish-board-redeem-conditions';
import { standaloneTodoEditorHref } from '@/lib/standalone-todo-task';
import { MaterialIcons } from '@expo/vector-icons';
import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import { useRouter } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

function defaultAvailableFromDate(): Date {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(0, 0, 0, 0);
  return d;
}

type PickerTab = 'tree' | 'habit' | 'todo';

type DraftBind = {
  projectIds: string[];
  taskIds: string[];
  todoIds: string[];
  habitIds: string[];
};

type Props = {
  value: WishBoardRedeemConditions;
  onChange: (next: WishBoardRedeemConditions) => void;
  projects: ProjectRow[];
  tasks: TaskRow[];
  habits?: HabitRow[];
  /** 资产页口径的当前净资产，用于对照提示 */
  currentNetWorth?: number | null;
  loading?: boolean;
  disabled?: boolean;
};

function countTaskProgress(tasks: TaskRow[], projectId: string): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const t of tasks) {
    if (t.project_id !== projectId || t.status === 'cancelled') continue;
    total += 1;
    if (t.status === 'done') done += 1;
  }
  return { done, total };
}

function emptyDraft(): DraftBind {
  return { projectIds: [], taskIds: [], todoIds: [], habitIds: [] };
}

function draftFromValue(
  value: WishBoardRedeemConditions,
  tasksByProjectId?: Map<string, TaskRow[]>,
): DraftBind {
  const projectIds = [...value.project_ids];
  let taskIds = [...value.task_ids];
  // 项目与旗下任务互斥：若同时存在，保留项目、清掉其下任务
  if (tasksByProjectId && projectIds.length > 0) {
    const covered = new Set<string>();
    for (const pid of projectIds) {
      for (const t of tasksByProjectId.get(pid) ?? []) covered.add(t.id);
    }
    if (covered.size > 0) taskIds = taskIds.filter(id => !covered.has(id));
  }
  return {
    projectIds,
    taskIds,
    todoIds: [...value.todo_ids],
    habitIds: [...(value.habit_ids ?? [])],
  };
}

function draftCount(draft: DraftBind): number {
  return (
    draft.projectIds.length +
    draft.taskIds.length +
    draft.todoIds.length +
    draft.habitIds.length
  );
}

function toggleId(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter(x => x !== id) : [...list, id];
}

/** 任务节点是否应出现在选择树中：未完成，或已在草稿里（便于取消已完成绑定） */
function shouldShowTaskNode(node: TaskTreeNode, selectedTaskIds: Set<string>): boolean {
  if (selectedTaskIds.has(node.id)) return true;
  if (!isTaskRedeemConditionMet(node)) return true;
  return node.children.some(child => shouldShowTaskNode(child, selectedTaskIds));
}

function filterVisibleTaskTree(
  nodes: TaskTreeNode[],
  selectedTaskIds: Set<string>,
): TaskTreeNode[] {
  const out: TaskTreeNode[] = [];
  for (const node of nodes) {
    if (!shouldShowTaskNode(node, selectedTaskIds)) continue;
    out.push({
      ...node,
      children: filterVisibleTaskTree(node.children, selectedTaskIds),
    });
  }
  return out;
}

/**
 * 兑换条件：绑定项目树（项目 / 任意层级任务）或独立待办 + 最低净资产门槛。
 * 绑定开启后弹出多选；净资产门槛开启后行内输入。
 */
export function WishBoardRedeemConditionsField({
  value,
  onChange,
  projects,
  tasks,
  habits = [],
  currentNetWorth = null,
  loading = false,
  disabled = false,
}: Props) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { c, gradients, isDark } = useWishBoxTheme();
  const styles = useWishStyles(makeStyles);
  const [pickerTab, setPickerTab] = useState<PickerTab>('tree');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [draft, setDraft] = useState<DraftBind>(emptyDraft);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [netWorthText, setNetWorthText] = useState(
    value.min_net_worth == null ? '' : String(value.min_net_worth),
  );
  const [availablePickerVisible, setAvailablePickerVisible] = useState(false);
  const [availablePickerMode, setAvailablePickerMode] = useState<'date' | 'time'>('date');
  const [availableDraftDate, setAvailableDraftDate] = useState<Date>(() =>
    parseAvailableFromDate(value.available_from) ?? defaultAvailableFromDate(),
  );

  const openProjectDetail = useCallback(
    (id: string) => {
      router.push({ pathname: '/edit-project', params: { id } });
    },
    [router],
  );

  const openTaskDetail = useCallback(
    (id: string) => {
      router.push({ pathname: '/task/[id]', params: { id } });
    },
    [router],
  );

  const openTodoDetail = useCallback(
    (id: string) => {
      router.push(standaloneTodoEditorHref(id));
    },
    [router],
  );

  const openHabitDetail = useCallback(
    (id: string) => {
      router.push({ pathname: '/habit-detail', params: { habitId: id } });
    },
    [router],
  );

  const projectTasks = useMemo(() => tasks.filter(t => isProjectBoundTask(t)), [tasks]);
  const todoTasks = useMemo(() => tasks.filter(t => isTodoBoundTask(t)), [tasks]);
  const projectNameById = useMemo(() => new Map(projects.map(p => [p.id, p.name])), [projects]);
  const taskNameById = useMemo(() => new Map(tasks.map(t => [t.id, t.title])), [tasks]);
  const habitNameById = useMemo(() => new Map(habits.map(h => [h.id, h.name])), [habits]);

  /** 习惯 → 已用作项目完成条件的项目名（弱提示） */
  const habitUsedByProjects = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const project of projects) {
      for (const hid of parseCompletionHabitIds(project.extra_data)) {
        const list = map.get(hid) ?? [];
        list.push(project.name.trim() || '未命名项目');
        map.set(hid, list);
      }
    }
    return map;
  }, [projects]);

  const tasksByProjectId = useMemo(() => {
    const map = new Map<string, TaskRow[]>();
    for (const t of projectTasks) {
      const pid = t.project_id?.trim();
      if (!pid) continue;
      const list = map.get(pid);
      if (list) list.push(t);
      else map.set(pid, [t]);
    }
    return map;
  }, [projectTasks]);

  const boundCount =
    value.project_ids.length +
    value.task_ids.length +
    value.todo_ids.length +
    (value.habit_ids?.length ?? 0);
  const bindingOn = boundCount > 0;
  const netWorthOn = value.min_net_worth != null;
  const availableFromOn = value.available_from != null;

  /** 绑定副标题：单项目时带进度（设计稿「晨间跑步 · 21 天项目（18 / 21）· 更换」） */
  const bindingSubtitle = useMemo(() => {
    if (boundCount === 0) return '未绑定 · 点右侧开关选择';
    const parts: string[] = [];
    for (const id of value.project_ids) {
      const name = projectNameById.get(id)?.trim() || '已删除的项目';
      const { done, total } = countTaskProgress(tasks, id);
      parts.push(total > 0 ? `${name}（${done} / ${total}）` : name);
    }
    for (const id of [...value.task_ids, ...value.todo_ids]) {
      parts.push(taskNameById.get(id)?.trim() || '已删除的任务');
    }
    for (const id of value.habit_ids ?? []) {
      parts.push(habitNameById.get(id)?.trim() || '已删除的习惯');
    }
    if (parts.length <= 2) return parts.join('、');
    return `${parts.slice(0, 2).join('、')} 等 ${parts.length} 项`;
  }, [boundCount, habitNameById, projectNameById, taskNameById, tasks, value]);

  const openPicker = useCallback(() => {
    const nextDraft = draftFromValue(value, tasksByProjectId);
    setDraft(nextDraft);
    setPickerTab('tree');

    // 默认展开：有子任务的项目，以及已选任务所在的祖先链
    const nextExpanded = new Set<string>();
    const selectedTasks = new Set(nextDraft.taskIds);
    for (const project of projects) {
      const rows = tasksByProjectId.get(project.id) ?? [];
      if (rows.length === 0) continue;
      const hasSelectedChild = rows.some(t => selectedTasks.has(t.id));
      if (hasSelectedChild || !isProjectRedeemConditionMet(project)) {
        nextExpanded.add(`project:${project.id}`);
      }
      for (const t of rows) {
        if (!selectedTasks.has(t.id)) continue;
        let parentId = t.parent_task_id;
        while (parentId) {
          nextExpanded.add(`task:${parentId}`);
          const parent = rows.find(r => r.id === parentId);
          parentId = parent?.parent_task_id ?? null;
        }
      }
    }
    setExpandedIds(nextExpanded);
    setPickerOpen(true);
  }, [projects, tasksByProjectId, value]);

  const toggleBinding = useCallback(
    (next: boolean) => {
      if (!next) {
        onChange({
          ...value,
          project_ids: [],
          task_ids: [],
          todo_ids: [],
          habit_ids: [],
        });
        return;
      }
      openPicker();
    },
    [onChange, openPicker, value],
  );

  const toggleNetWorth = useCallback(
    (next: boolean) => {
      if (!next) {
        setNetWorthText('');
        onChange({ ...value, min_net_worth: null });
        return;
      }
      // 开启后先带入当前净资产作参考默认值，用户可改
      const rounded =
        currentNetWorth != null && Number.isFinite(currentNetWorth)
          ? Math.round(currentNetWorth)
          : 0;
      setNetWorthText(String(rounded));
      onChange({ ...value, min_net_worth: rounded });
    },
    [currentNetWorth, onChange, value],
  );

  const onNetWorthChange = useCallback(
    (text: string) => {
      setNetWorthText(text);
      const trimmed = text.trim();
      if (!trimmed) {
        if (value.min_net_worth != null) onChange({ ...value, min_net_worth: null });
        return;
      }
      const parsed = normalizeMinNetWorth(trimmed);
      if (parsed != null && parsed !== value.min_net_worth) {
        onChange({ ...value, min_net_worth: parsed });
      }
    },
    [onChange, value],
  );

  const toggleAvailableFrom = useCallback(
    (next: boolean) => {
      if (!next) {
        setAvailablePickerVisible(false);
        onChange({ ...value, available_from: null });
        return;
      }
      const initial = parseAvailableFromDate(value.available_from) ?? defaultAvailableFromDate();
      setAvailableDraftDate(initial);
      onChange({ ...value, available_from: formatAvailableFromDate(initial) });
      setAvailablePickerMode('date');
      setAvailablePickerVisible(true);
    },
    [onChange, value],
  );

  const openAvailablePicker = useCallback(() => {
    const initial = parseAvailableFromDate(value.available_from) ?? defaultAvailableFromDate();
    setAvailableDraftDate(initial);
    setAvailablePickerMode('date');
    setAvailablePickerVisible(true);
  }, [value.available_from]);

  const commitAvailableDraft = useCallback(
    (date: Date) => {
      setAvailableDraftDate(date);
      onChange({ ...value, available_from: formatAvailableFromDate(date) });
    },
    [onChange, value],
  );

  const onAvailablePickerChange = useCallback(
    (_event: DateTimePickerEvent, date?: Date) => {
      if (!date) return;
      if (availablePickerMode === 'date') {
        const next = new Date(availableDraftDate);
        next.setFullYear(date.getFullYear(), date.getMonth(), date.getDate());
        commitAvailableDraft(next);
        return;
      }
      const next = new Date(availableDraftDate);
      next.setHours(date.getHours(), date.getMinutes(), 0, 0);
      commitAvailableDraft(next);
    },
    [availableDraftDate, availablePickerMode, commitAvailableDraft],
  );

  const closeAvailablePicker = useCallback(() => {
    setAvailablePickerVisible(false);
    setAvailablePickerMode('date');
  }, []);

  const toggleProject = useCallback(
    (id: string) => {
      setDraft(prev => {
        const already = prev.projectIds.includes(id);
        if (already) {
          return { ...prev, projectIds: prev.projectIds.filter(x => x !== id) };
        }
        // 选中项目时清掉旗下已选任务（互斥）
        const under = new Set((tasksByProjectId.get(id) ?? []).map(t => t.id));
        return {
          ...prev,
          projectIds: [...prev.projectIds, id],
          taskIds: under.size === 0 ? prev.taskIds : prev.taskIds.filter(tid => !under.has(tid)),
        };
      });
    },
    [tasksByProjectId],
  );

  const toggleTask = useCallback(
    (id: string, projectId: string | null | undefined) => {
      setDraft(prev => {
        const already = prev.taskIds.includes(id);
        if (already) {
          return { ...prev, taskIds: prev.taskIds.filter(x => x !== id) };
        }
        // 选中任务时取消所属项目（互斥）
        const pid = projectId?.trim() || '';
        return {
          ...prev,
          taskIds: [...prev.taskIds, id],
          projectIds:
            pid && prev.projectIds.includes(pid)
              ? prev.projectIds.filter(x => x !== pid)
              : prev.projectIds,
        };
      });
    },
    [],
  );

  const toggleTodo = useCallback((id: string) => {
    setDraft(prev => ({ ...prev, todoIds: toggleId(prev.todoIds, id) }));
  }, []);

  const toggleHabit = useCallback((id: string) => {
    setDraft(prev => ({ ...prev, habitIds: toggleId(prev.habitIds, id) }));
  }, []);

  const toggleExpanded = useCallback((key: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const confirmPicker = useCallback(() => {
    const sanitized = draftFromValue(
      {
        ...value,
        project_ids: draft.projectIds,
        task_ids: draft.taskIds,
        todo_ids: draft.todoIds,
        habit_ids: draft.habitIds,
      },
      tasksByProjectId,
    );
    onChange({
      ...value,
      project_ids: sanitized.projectIds,
      task_ids: sanitized.taskIds,
      todo_ids: sanitized.todoIds,
      habit_ids: sanitized.habitIds,
    });
    setPickerOpen(false);
  }, [draft, onChange, tasksByProjectId, value]);

  const closePicker = useCallback(() => {
    setPickerOpen(false);
    setDraft(emptyDraft());
  }, []);

  const selectedTaskIdSet = useMemo(() => new Set(draft.taskIds), [draft.taskIds]);

  const projectTreeSections = useMemo(() => {
    const sections: {
      project: ProjectRow;
      progress: { done: number; total: number };
      showProject: boolean;
      taskRoots: TaskTreeNode[];
    }[] = [];

    for (const project of projects) {
      const selectedProject = draft.projectIds.includes(project.id);
      const rows = tasksByProjectId.get(project.id) ?? [];
      const taskRoots = filterVisibleTaskTree(buildTaskTreeFromRows(rows), selectedTaskIdSet);
      const progress = countTaskProgress(tasks, project.id);
      const showProject = selectedProject || !isProjectRedeemConditionMet(project);
      if (!showProject && taskRoots.length === 0) continue;
      sections.push({ project, progress, showProject, taskRoots });
    }
    return sections;
  }, [draft.projectIds, projects, selectedTaskIdSet, tasks, tasksByProjectId]);

  const todoOptions = useMemo(() => {
    const selected = new Set(draft.todoIds);
    return todoTasks
      .filter(t => selected.has(t.id) || !isTaskRedeemConditionMet(t))
      .map(t => ({
        id: t.id,
        title: t.title,
        subtitle: isTaskRedeemConditionMet(t) ? '已完成 · 已绑定' : '未完成',
      }));
  }, [draft.todoIds, todoTasks]);

  const habitOptions = useMemo(() => {
    const selected = new Set(draft.habitIds);
    return habits
      .filter(h => {
        const kind = parseHabitKind(h.extra_data);
        if (kind === 'task') return false;
        const eligible = isHabitEligibleForWishRedeem(h);
        return selected.has(h.id) || eligible || kind === 'build' || kind === 'break';
      })
      .map(h => {
        const eligible = isHabitEligibleForWishRedeem(h);
        const usedBy = habitUsedByProjects.get(h.id);
        let subtitle = formatWishHabitPickerSubtitle(h);
        if (usedBy && usedBy.length > 0) {
          subtitle +=
            usedBy.length === 1
              ? ` · 已是「${usedBy[0]}」完成条件`
              : ` · 已是 ${usedBy.length} 个项目完成条件`;
        }
        return {
          id: h.id,
          title: h.name.trim() || '未命名习惯',
          subtitle,
          eligible,
          selectable: eligible || selected.has(h.id),
        };
      });
  }, [draft.habitIds, habitUsedByProjects, habits]);

  const renderTaskNodes = (
    nodes: TaskTreeNode[],
    depth: number,
    projectId: string,
    projectSelected: boolean,
  ): React.ReactNode =>
    nodes.map(node => {
      const key = `task:${node.id}`;
      const hasChildren = node.children.length > 0;
      const expanded = expandedIds.has(key);
      const picked = draft.taskIds.includes(node.id);
      const done = isTaskRedeemConditionMet(node);
      const childProgress = countSubtreeProgress(node);
      const coveredByProject = projectSelected && !picked;
      return (
        <View key={node.id}>
          <View style={[styles.optRow, { paddingLeft: 12 + depth * 16 }]}>
            {hasChildren ? (
              <Pressable
                onPress={() => toggleExpanded(key)}
                hitSlop={8}
                style={styles.expandHit}
                accessibilityRole="button"
                accessibilityLabel={expanded ? '收起子任务' : '展开子任务'}>
                <MaterialIcons
                  name={expanded ? 'expand-more' : 'chevron-right'}
                  size={20}
                  color={c.muted}
                />
              </Pressable>
            ) : (
              <View style={styles.expandSpacer} />
            )}
            <Pressable
              onPress={() => openTaskDetail(node.id)}
              style={({ pressed }) => [
                styles.optSelect,
                { opacity: pressed ? 0.7 : coveredByProject ? 0.45 : 1 },
              ]}
              accessibilityRole="button"
              accessibilityLabel={`查看任务 ${node.title}`}
              accessibilityHint={coveredByProject ? '已含于所选项目' : undefined}>
              <MaterialIcons
                name={hasChildren ? 'account-tree' : 'checklist'}
                size={18}
                color={c.pri}
              />
              <View style={styles.optBody}>
                <Text style={styles.optTitle} numberOfLines={2}>
                  {node.title}
                </Text>
                <Text style={styles.optSub}>
                  {coveredByProject
                    ? '已含于所选项目'
                    : done
                      ? '已完成 · 已绑定'
                      : childProgress.total > 0
                        ? `任务 · ${childProgress.done} / ${childProgress.total}`
                        : '任务 · 未完成'}
                </Text>
              </View>
            </Pressable>
            <Pressable
              onPress={() => toggleTask(node.id, projectId)}
              hitSlop={8}
              style={styles.checkHit}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: picked }}
              accessibilityLabel={picked ? '取消绑定此任务' : '绑定此任务'}
              accessibilityHint={
                coveredByProject ? '点选将改为绑定此任务并取消所属项目' : undefined
              }>
              {picked ? (
                <MaterialIcons name="check-circle" size={21} color={c.pri} />
              ) : (
                <MaterialIcons name="radio-button-unchecked" size={21} color={c.muted} />
              )}
            </Pressable>
          </View>
          {hasChildren && expanded
            ? renderTaskNodes(node.children, depth + 1, projectId, projectSelected)
            : null}
        </View>
      );
    });

  const selectedCount = draftCount(draft);

  return (
    <View>
      <WishFormLabel label="兑换条件" hint="可选 · 不满足时不可兑换" />

      <WishToggleRow
        emoji="🔗"
        title="绑定项目 / 任务 / 待办"
        subtitle={loading ? '加载中…' : bindingSubtitle}
        subtitleLink={bindingOn ? '更换' : undefined}
        onPressLink={openPicker}
        on={bindingOn}
        disabled={disabled || loading}
        onToggle={toggleBinding}
      />

      <WishToggleRow
        emoji="💰"
        title="最低净资产门槛"
        subtitle="资产达标后才可兑换"
        on={netWorthOn}
        disabled={disabled}
        onToggle={toggleNetWorth}
      />

      {netWorthOn ? (
        <View style={styles.netWorthRow}>
          <Text style={styles.netWorthLabel}>净资产 ≥</Text>
          <TextInput
            value={netWorthText}
            onChangeText={onNetWorthChange}
            editable={!disabled}
            placeholder="输入门槛金额"
            placeholderTextColor={c.muted}
            keyboardType="decimal-pad"
            style={styles.netWorthInput}
          />
          <Text style={styles.netWorthCurrent}>
            {currentNetWorth != null && Number.isFinite(currentNetWorth)
              ? `当前 ${formatSignedMoneyTrunc2(currentNetWorth)}`
              : '未知'}
          </Text>
        </View>
      ) : null}

      <WishToggleRow
        emoji="🕒"
        title="开放兑换时间"
        subtitle={
          availableFromOn
            ? `自 ${formatAvailableFromLabel(value.available_from)} 起可兑`
            : '到点后才可兑换 · 点右侧开关设置'
        }
        subtitleLink={availableFromOn ? '更改' : undefined}
        onPressLink={openAvailablePicker}
        on={availableFromOn}
        disabled={disabled}
        onToggle={toggleAvailableFrom}
      />

      {availableFromOn ? (
        <Pressable
          onPress={openAvailablePicker}
          disabled={disabled}
          style={({ pressed }) => [styles.timeRow, { opacity: pressed || disabled ? 0.72 : 1 }]}
          accessibilityRole="button"
          accessibilityLabel="选择开放兑换时间">
          <Text style={styles.timeLabel}>开放时间</Text>
          <Text style={styles.timeValue}>{formatAvailableFromLabel(value.available_from)}</Text>
          <MaterialIcons name="event" size={18} color={c.pri} />
        </Pressable>
      ) : null}

      <Modal
        transparent
        visible={availablePickerVisible}
        animationType="slide"
        onRequestClose={closeAvailablePicker}>
        <View style={styles.timePickerRoot}>
          <Pressable
            style={styles.timePickerOverlay}
            onPress={closeAvailablePicker}
            accessibilityLabel="关闭"
          />
          <View style={[styles.timePickerSheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            <View style={styles.handle} />
            <View style={styles.timePickerHead}>
              <Text style={styles.timePickerTitle}>开放兑换时间</Text>
              <Pressable onPress={closeAvailablePicker} hitSlop={10} accessibilityLabel="完成">
                <Text style={styles.timePickerDone}>完成</Text>
              </Pressable>
            </View>

            <View style={styles.timePreview}>
              <Text style={styles.timePreviewLabel}>将于此时开放</Text>
              <Text style={styles.timePreviewValue}>
                {formatAvailableFromLabel(formatAvailableFromDate(availableDraftDate))}
              </Text>
            </View>

            <View style={styles.timeModeTabs}>
              {(
                [
                  { key: 'date' as const, label: '日期' },
                  { key: 'time' as const, label: '时间' },
                ] as const
              ).map(tab => {
                const selected = availablePickerMode === tab.key;
                return (
                  <Pressable
                    key={tab.key}
                    onPress={() => setAvailablePickerMode(tab.key)}
                    style={[styles.timeModeTab, selected ? styles.tabOn : styles.tabOff]}
                    accessibilityRole="tab"
                    accessibilityState={{ selected }}>
                    <Text style={[styles.tabText, selected && styles.tabTextOn]}>{tab.label}</Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.nativePickerWrap}>
              <DateTimePicker
                key={`available-${availablePickerMode}`}
                value={availableDraftDate}
                mode={availablePickerMode}
                display="spinner"
                locale="zh-CN"
                themeVariant={isDark ? 'dark' : 'light'}
                onChange={onAvailablePickerChange}
                style={styles.nativePicker}
              />
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        transparent
        visible={pickerOpen}
        animationType="slide"
        onRequestClose={closePicker}>
        <View style={styles.pickerRoot}>
          <Pressable style={styles.pickerOverlay} onPress={closePicker} accessibilityLabel="关闭" />
          <View style={[styles.pickerSheet, { paddingBottom: Math.max(insets.bottom, 18) }]}>
            <View style={styles.handle} />
            <View style={styles.pickerHead}>
              <Text style={styles.pickerTitle}>绑定项目 / 任务 / 待办</Text>
              <Pressable onPress={closePicker} hitSlop={10} accessibilityLabel="关闭">
                <MaterialIcons name="close" size={21} color={c.ink2} />
              </Pressable>
            </View>
            <Text style={styles.pickerHint}>
              点名称进详情；右侧勾选绑定。项目与旗下任务互斥
            </Text>

            <View style={styles.tabs}>
              {(
                [
                  { key: 'tree' as const, label: '项目树' },
                  { key: 'habit' as const, label: '小习惯' },
                  { key: 'todo' as const, label: '待办' },
                ] as const
              ).map(tab => {
                const selected = tab.key === pickerTab;
                return (
                  <Pressable
                    key={tab.key}
                    onPress={() => setPickerTab(tab.key)}
                    style={[styles.tab, selected ? styles.tabOn : styles.tabOff]}
                    accessibilityRole="tab"
                    accessibilityState={{ selected }}>
                    <Text style={[styles.tabText, selected && styles.tabTextOn]}>{tab.label}</Text>
                  </Pressable>
                );
              })}
            </View>

            {pickerTab === 'tree' ? (
              projectTreeSections.length === 0 ? (
                <Text style={styles.pickerEmpty}>暂无可绑定的项目或任务</Text>
              ) : (
                <ScrollView
                  style={styles.pickerList}
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}>
                  {projectTreeSections.map(({ project, progress, showProject, taskRoots }) => {
                    const expandKey = `project:${project.id}`;
                    const expanded = expandedIds.has(expandKey);
                    const picked = draft.projectIds.includes(project.id);
                    const projectDone = isProjectRedeemConditionMet(project);
                    const canExpand = taskRoots.length > 0;
                    return (
                      <View key={project.id} style={styles.treeBlock}>
                        {showProject ? (
                          <View style={[styles.optRow, styles.projectRow]}>
                            {canExpand ? (
                              <Pressable
                                onPress={() => toggleExpanded(expandKey)}
                                hitSlop={8}
                                style={styles.expandHit}
                                accessibilityRole="button"
                                accessibilityLabel={expanded ? '收起任务' : '展开任务'}>
                                <MaterialIcons
                                  name={expanded ? 'expand-more' : 'chevron-right'}
                                  size={20}
                                  color={c.muted}
                                />
                              </Pressable>
                            ) : (
                              <View style={styles.expandSpacer} />
                            )}
                            <Pressable
                              onPress={() => openProjectDetail(project.id)}
                              style={({ pressed }) => [
                                styles.optSelect,
                                { opacity: pressed ? 0.7 : 1 },
                              ]}
                              accessibilityRole="button"
                              accessibilityLabel={`查看项目 ${project.name}`}>
                              <MaterialIcons name="folder" size={20} color={c.pri} />
                              <View style={styles.optBody}>
                                <Text style={styles.optTitle} numberOfLines={2}>
                                  {project.name}
                                </Text>
                                <Text style={styles.optSub}>
                                  {projectDone
                                    ? '项目已完成 · 已绑定'
                                    : progress.total > 0
                                      ? `项目 · ${progress.done} / ${progress.total}`
                                      : '项目 · 进行中'}
                                </Text>
                              </View>
                            </Pressable>
                            <Pressable
                              onPress={() => toggleProject(project.id)}
                              hitSlop={8}
                              style={styles.checkHit}
                              accessibilityRole="checkbox"
                              accessibilityState={{ checked: picked }}
                              accessibilityLabel={picked ? '取消绑定此项目' : '绑定此项目'}>
                              {picked ? (
                                <MaterialIcons name="check-circle" size={21} color={c.pri} />
                              ) : (
                                <MaterialIcons
                                  name="radio-button-unchecked"
                                  size={21}
                                  color={c.muted}
                                />
                              )}
                            </Pressable>
                          </View>
                        ) : null}
                        {canExpand && (expanded || !showProject)
                          ? renderTaskNodes(
                              taskRoots,
                              showProject ? 1 : 0,
                              project.id,
                              picked,
                            )
                          : null}
                      </View>
                    );
                  })}
                </ScrollView>
              )
            ) : pickerTab === 'habit' ? (
              habitOptions.length === 0 ? (
                <Text style={styles.pickerEmpty}>暂无可绑定的小习惯</Text>
              ) : (
                <ScrollView
                  style={styles.pickerList}
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}>
                  {habitOptions.map(opt => {
                    const picked = draft.habitIds.includes(opt.id);
                    return (
                      <View key={opt.id} style={[styles.optRow, !opt.selectable && { opacity: 0.48 }]}>
                        <View style={styles.expandSpacer} />
                        <Pressable
                          onPress={() => openHabitDetail(opt.id)}
                          style={({ pressed }) => [
                            styles.optSelect,
                            { opacity: pressed ? 0.7 : 1 },
                          ]}
                          accessibilityRole="button"
                          accessibilityLabel={`查看习惯 ${opt.title}`}>
                          <MaterialIcons name="spa" size={20} color={c.pri} />
                          <View style={styles.optBody}>
                            <Text style={styles.optTitle} numberOfLines={2}>
                              {opt.title}
                            </Text>
                            <Text style={styles.optSub}>{opt.subtitle}</Text>
                          </View>
                        </Pressable>
                        <Pressable
                          onPress={() => {
                            if (!opt.selectable) return;
                            toggleHabit(opt.id);
                          }}
                          disabled={!opt.selectable}
                          hitSlop={8}
                          style={styles.checkHit}
                          accessibilityRole="checkbox"
                          accessibilityState={{ checked: picked, disabled: !opt.selectable }}
                          accessibilityLabel={
                            !opt.selectable
                              ? '未设周期目标，不可绑定'
                              : picked
                                ? '取消绑定此习惯'
                                : '绑定此习惯'
                          }>
                          {picked ? (
                            <MaterialIcons name="check-circle" size={21} color={c.pri} />
                          ) : (
                            <MaterialIcons
                              name="radio-button-unchecked"
                              size={21}
                              color={c.muted}
                            />
                          )}
                        </Pressable>
                      </View>
                    );
                  })}
                </ScrollView>
              )
            ) : todoOptions.length === 0 ? (
              <Text style={styles.pickerEmpty}>暂无可绑定的待办</Text>
            ) : (
              <ScrollView
                style={styles.pickerList}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}>
                {todoOptions.map(opt => {
                  const picked = draft.todoIds.includes(opt.id);
                  return (
                    <View key={opt.id} style={styles.optRow}>
                      <View style={styles.expandSpacer} />
                      <Pressable
                        onPress={() => openTodoDetail(opt.id)}
                        style={({ pressed }) => [styles.optSelect, { opacity: pressed ? 0.7 : 1 }]}
                        accessibilityRole="button"
                        accessibilityLabel={`查看待办 ${opt.title}`}>
                        <MaterialIcons name="event-note" size={20} color={c.pri} />
                        <View style={styles.optBody}>
                          <Text style={styles.optTitle} numberOfLines={2}>
                            {opt.title}
                          </Text>
                          <Text style={styles.optSub}>{opt.subtitle}</Text>
                        </View>
                      </Pressable>
                      <Pressable
                        onPress={() => toggleTodo(opt.id)}
                        hitSlop={8}
                        style={styles.checkHit}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: picked }}
                        accessibilityLabel={picked ? '取消绑定此待办' : '绑定此待办'}>
                        {picked ? (
                          <MaterialIcons name="check-circle" size={21} color={c.pri} />
                        ) : (
                          <MaterialIcons name="radio-button-unchecked" size={21} color={c.muted} />
                        )}
                      </Pressable>
                    </View>
                  );
                })}
              </ScrollView>
            )}

            <Pressable
              onPress={confirmPicker}
              style={({ pressed }) => [styles.confirmBtn, { opacity: pressed ? 0.9 : 1 }]}
              accessibilityRole="button"
              accessibilityLabel="确定">
              <WishBoxGradientFill colors={gradients.primary} radius={17} />
              <Text style={styles.confirmText}>
                确定{selectedCount > 0 ? `（已选 ${selectedCount} 个）` : ''}
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function countSubtreeProgress(node: TaskTreeNode): { done: number; total: number } {
  let done = 0;
  let total = 0;
  const walk = (list: TaskTreeNode[]) => {
    for (const child of list) {
      if (child.status === 'cancelled') continue;
      total += 1;
      if (child.status === 'done') done += 1;
      if (child.children.length > 0) walk(child.children);
    }
  };
  walk(node.children);
  return { done, total };
}

function makeStyles(c: WishBoxPalette, _shadows: WishBoxShadowSet) {
  return StyleSheet.create({
    netWorthRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginTop: 9,
      paddingHorizontal: 12,
      paddingVertical: 9,
      backgroundColor: c.card,
      borderWidth: 1.5,
      borderColor: c.line,
      borderRadius: 16,
    },
    netWorthLabel: {
      fontSize: 12.5,
      fontWeight: '700',
      color: c.ink2,
    },
    netWorthInput: {
      flex: 1,
      minWidth: 0,
      fontSize: 14.5,
      fontWeight: '800',
      color: c.ink,
      paddingVertical: 2,
    },
    netWorthCurrent: {
      fontSize: 10.5,
      fontWeight: '600',
      color: c.muted,
    },
    timeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginTop: 9,
      paddingHorizontal: 12,
      paddingVertical: 11,
      backgroundColor: c.card,
      borderWidth: 1.5,
      borderColor: c.line,
      borderRadius: 16,
    },
    timeLabel: {
      fontSize: 12.5,
      fontWeight: '700',
      color: c.ink2,
    },
    timeValue: {
      flex: 1,
      minWidth: 0,
      fontSize: 14,
      fontWeight: '800',
      color: c.ink,
      textAlign: 'right',
    },
    timePickerRoot: {
      flex: 1,
      justifyContent: 'flex-end',
    },
    timePickerOverlay: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: c.overlay,
    },
    timePickerSheet: {
      backgroundColor: c.sheet,
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
      paddingHorizontal: 16,
      paddingTop: 12,
    },
    timePickerHead: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 10,
      paddingHorizontal: 4,
    },
    timePickerTitle: {
      fontSize: 16,
      fontWeight: '800',
      color: c.ink,
    },
    timePickerDone: {
      fontSize: 15,
      fontWeight: '800',
      color: c.pri,
    },
    timePreview: {
      backgroundColor: c.card,
      borderWidth: 1.5,
      borderColor: c.line,
      borderRadius: 16,
      paddingHorizontal: 14,
      paddingVertical: 12,
      gap: 4,
    },
    timePreviewLabel: {
      fontSize: 11,
      fontWeight: '700',
      color: c.muted,
    },
    timePreviewValue: {
      fontSize: 18,
      fontWeight: '800',
      color: c.ink,
    },
    timeModeTabs: {
      flexDirection: 'row',
      gap: 8,
      marginTop: 12,
    },
    timeModeTab: {
      flex: 1,
      height: 36,
      borderRadius: 13,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1.5,
    },
    nativePickerWrap: {
      marginTop: 6,
      minHeight: Platform.OS === 'ios' ? 216 : 180,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    nativePicker: {
      alignSelf: 'stretch',
      width: '100%',
      height: Platform.OS === 'ios' ? 216 : 180,
    },
    pickerRoot: {
      flex: 1,
      justifyContent: 'flex-end',
    },
    pickerOverlay: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: c.overlay,
    },
    pickerSheet: {
      backgroundColor: c.sheet,
      borderTopLeftRadius: 30,
      borderTopRightRadius: 30,
      paddingHorizontal: 20,
      paddingTop: 12,
    },
    handle: {
      width: 44,
      height: 5,
      borderRadius: 99,
      backgroundColor: c.handle,
      alignSelf: 'center',
      marginBottom: 14,
    },
    pickerHead: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    pickerTitle: {
      fontSize: 17,
      fontWeight: '800',
      color: c.ink,
    },
    pickerHint: {
      fontSize: 12,
      color: c.muted,
      marginTop: 4,
    },
    tabs: {
      flexDirection: 'row',
      gap: 8,
      marginTop: 12,
    },
    tab: {
      flex: 1,
      height: 36,
      borderRadius: 13,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1.5,
    },
    tabOn: {
      backgroundColor: c.ink,
      borderColor: c.ink,
    },
    tabOff: {
      backgroundColor: c.card,
      borderColor: c.line,
    },
    tabText: {
      fontSize: 13,
      fontWeight: '800',
      color: c.muted,
    },
    tabTextOn: {
      color: c.onInk,
    },
    pickerList: {
      marginTop: 10,
      maxHeight: 360,
    },
    treeBlock: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.divider,
      paddingBottom: 2,
      marginBottom: 2,
    },
    projectRow: {
      borderBottomWidth: 0,
    },
    optRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 11,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.divider,
    },
    optSelect: {
      flex: 1,
      minWidth: 0,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    expandHit: {
      width: 22,
      height: 22,
      alignItems: 'center',
      justifyContent: 'center',
    },
    expandSpacer: {
      width: 22,
    },
    checkHit: {
      width: 28,
      height: 28,
      alignItems: 'center',
      justifyContent: 'center',
    },
    optBody: {
      flex: 1,
      minWidth: 0,
      gap: 2,
    },
    optTitle: {
      fontSize: 14,
      fontWeight: '700',
      color: c.ink,
    },
    optSub: {
      fontSize: 11,
      fontWeight: '600',
      color: c.muted,
    },
    pickerEmpty: {
      fontSize: 13,
      fontWeight: '600',
      color: c.muted,
      paddingVertical: 28,
      textAlign: 'center',
    },
    confirmBtn: {
      marginTop: 14,
      height: 50,
      borderRadius: 17,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    confirmText: {
      fontSize: 16,
      fontWeight: '800',
      color: '#fff',
      letterSpacing: 1,
    },
  });
}
