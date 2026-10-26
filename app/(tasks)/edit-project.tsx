import { ComposerTopBar, taskPriorityKeyToNumber, taskPriorityToKey, type TaskPriorityKey } from '@/components/composer';
import { labelsFromPickerResult, extractDueDateFromDeadlineText } from '@/components/entity-form';
import { LifeBetPickerField } from '@/components/life-road/LifeBetPickerField';
import { PrerequisiteProjectPickerField } from '@/components/projects/PrerequisiteProjectPickerField';
import { ProjectTagPickerField } from '@/components/projects/ProjectTagPickerField';
import { FoldRiseIn, useFoldMotionGate } from '@/components/review/fold-motion';
import { AcceptanceChecklistEditor } from '@/components/tasks/AcceptanceChecklistEditor';
import { EntityIconPickerField } from '@/components/tasks/EntityIconPickerField';
import { FoldProgressBar } from '@/components/tasks/fold-progress-bar';
import { FoldProgressRing } from '@/components/tasks/fold-progress-ring';
import { ProjectFoldTaskTree } from '@/components/tasks/ProjectFoldTaskTree';
import { TaskFoldPriorityGrid } from '@/components/tasks/task-fold-priority-grid';
import { TaskFoldSwitch } from '@/components/tasks/task-fold-switch';
import { useTaskFoldTheme } from '@/constants/task-fold-theme';
import { useAppTheme } from '@/hooks/use-app-theme';
import { usePageApiSync, usePagePullRefresh } from '@/hooks/use-page-api-sync';
import {
  acceptanceChecklistToLines,
  createEmptyAcceptanceItem,
  linesToAcceptanceChecklist,
  mergeAcceptanceChecklistIntoExtraData,
  parseAcceptanceChecklist,
  type AcceptanceCriterionItem,
} from '@/lib/acceptance-criteria';
import { consumeAddTaskResult } from '@/lib/add-task-bridge';
import { markPendingTablesDirty } from '@/lib/api-incremental-sync';
import { toast, Alert } from '@/lib/app-feedback';
import {
  beginCloudSqliteDirtyIgnoreBatch,
  endCloudSqliteDirtyIgnoreBatch,
} from '@/lib/cloud-sql-dirty-track';
import {
  DEFAULT_PROJECT_ICON,
  DEFAULT_TODO_ICON,
  mergeIconIntoExtraObject,
  normalizeEntityIcon,
  resolveProjectDisplayIcon,
} from '@/lib/constants/entity-icon-choices';
import { getDatabase } from '@/lib/database.native';
import { formatWriteError } from '@/lib/format-write-error';
import { addDaysToYmd } from '@/lib/date';
import { clearProjectFrogFields, getFrogAssignedDates } from '@/lib/frog-assignment';
import {
  getIsLongTermProject,
  getIsLongTermTask,
  mergeLongTermProjectIntoExtraData,
  mergeLongTermTaskIntoExtraData,
} from '@/lib/long-term-task';
import { getLifeBetsLocal } from '@/lib/repositories/life-road/life-bet';
import type { LifeBetRow } from '@/lib/repositories/life-road/life-bet.types';
import { INBOX_PROJECT_CATEGORY_ID } from '@/lib/repositories/projects/constants';
import { deleteProject, getProjectById, getProjectCategories, getProjects, updateProject } from '@/lib/repositories/projects/project';
import {
  mergePrerequisiteIdsIntoExtraData,
  parsePrerequisiteProjectIds,
  validatePrerequisiteSelection,
} from '@/lib/repositories/projects/project-prerequisites';
import { ensureProjectScheduleMetaForSave } from '@/lib/repositories/projects/project-schedule-save';
import {
  getProjectTags,
  getTagIdsByProjectId,
  setProjectTagIds,
} from '@/lib/repositories/projects/project-tag';
import type { ProjectTagRow } from '@/lib/repositories/projects/project-tag.types';
import type { ProjectCategoryRow, ProjectRow } from '@/lib/repositories/projects/project.types';
import {
  mergeRewardPointsIntoExtraObject,
  normalizeRewardPoints,
  parseRewardPointsFromExtraData,
} from '@/lib/reward-points';
import {
  dueDateFromScheduleMeta,
  hasDateLimitBounds,
  mergeDateLimit,
  resolveInheritedDefaultSchedule,
  scheduleMetaHasConcreteDates,
  scheduleMetaToDateLimit,
  toYmd,
} from '@/lib/schedule-inherit';
import { getWeekStartMondayYmd } from '@/lib/schedule/week';
import {
  consumeSchedulePickerResult,
  normalizeRouteParam,
  type PickedScheduleMeta,
  type SchedulePickerInitPayload,
} from '@/lib/schedule-picker-bridge';
import { requestPush } from '@/lib/sync-manager';
import { setTaskTagIds } from '@/lib/repositories/tags/tag';
import {
  getRecentExecutionEventsForTaskIds,
  type TaskExecutionEventWithTitle,
} from '@/lib/repositories/tasks/task-execution-events';
import { parseBoundHabitIdsFromExtraData } from '@/lib/repositories/tasks/task-habit-binding';
import {
  countIncompleteTasksByProjectId,
  createTask,
  getTasksByProjectId,
  updateTask,
  type TaskTreeNode,
} from '@/lib/repositories/tasks/task';
import type { TaskPriority, TaskRow } from '@/lib/repositories/tasks/task.types';
import { formatTaskReminderLabel } from '@/lib/task-reminder-schedule';
import { getDayBoundarySync, getLogicalLocalYmd } from '@/lib/tasks-logical-day';
import { applyProjectScheduleToAllTasks } from '@/lib/tighten-task-schedules';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router/react-navigation';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

function formatTaskPriorityShort(priority: number): string {
  if (priority >= 4) return 'P1';
  if (priority === 3) return 'P2';
  if (priority === 2) return 'P3';
  if (priority === 1) return 'P4';
  return '';
}

function formatFrogAssignDayLabel(ymd: string, todayYmd: string): string {
  if (ymd === todayYmd) return '今天';
  try {
    const d = new Date(`${ymd}T12:00:00`);
    const week = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()] ?? '';
    return `周${week}`;
  } catch {
    return ymd.slice(5);
  }
}

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

function countFrogLeaves(nodes: TaskTreeNode[]): number {
  let n = 0;
  const walk = (list: TaskTreeNode[]) => {
    for (const node of list) {
      const children = Array.isArray(node.children) ? node.children : [];
      if (children.length === 0 && getFrogAssignedDates(node.extra_data).length > 0) n += 1;
      if (children.length > 0) walk(children);
    }
  };
  walk(nodes);
  return n;
}

function collectTaskTreeIds(nodes: TaskTreeNode[]): string[] {
  return nodes.flatMap((n) => [n.id, ...collectTaskTreeIds(n.children ?? [])]);
}

function collectLeafTasks(nodes: TaskTreeNode[]): TaskTreeNode[] {
  const leaves: TaskTreeNode[] = [];
  const walk = (list: TaskTreeNode[]) => {
    for (const node of list) {
      const children = Array.isArray(node.children) ? node.children : [];
      if (children.length === 0) leaves.push(node);
      else walk(children);
    }
  };
  walk(nodes);
  return leaves;
}

function formatHmFromScheduleTime(raw: string | null | undefined): string {
  const t = (raw ?? '').trim();
  if (!t) return '';
  const m = /(\d{1,2}):(\d{2})/.exec(t);
  if (!m) return t.slice(0, 5);
  return `${m[1]!.padStart(2, '0')}:${m[2]}`;
}

function formatActivityWhen(createdAt: string, todayYmd: string): string {
  const trimmed = createdAt.trim();
  const day = trimmed.slice(0, 10);
  const timeMatch = /(\d{2}):(\d{2})/.exec(trimmed);
  const hm = timeMatch ? `${timeMatch[1]}:${timeMatch[2]}` : '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    if (day === todayYmd) return hm || '今天';
    try {
      const d = new Date(`${day}T12:00:00`);
      const t = new Date(`${todayYmd}T12:00:00`);
      const diff = Math.round((t.getTime() - d.getTime()) / 86400000);
      if (diff === 1) return '昨天';
      if (diff > 1 && diff < 7) return `${diff} 天前`;
    } catch {
      /* ignore */
    }
    const [, m, dd] = day.split('-');
    return `${Number(m)}/${Number(dd)}`;
  }
  return hm || trimmed.slice(5, 16);
}

function activityActionLabel(action: string): string {
  if (action === 'completed') return '完成';
  if (action === 'reopened') return '恢复为待办';
  return action;
}

type WeekPlanItem = {
  id: string;
  title: string;
  ymd: string;
  dayLabel: string;
  timeLabel: string;
  inGrid: boolean;
};

function filterTreeHideCompleted(nodes: TaskTreeNode[]): TaskTreeNode[] {
  return nodes
    .filter((n) => n.status !== 'done' && n.status !== 'cancelled')
    .map((n) => ({
      ...n,
      children: filterTreeHideCompleted(n.children ?? []),
    }));
}

function markDoneInTaskTree(nodes: TaskTreeNode[], taskId: string, done: boolean): TaskTreeNode[] {
  return nodes.map((n) => {
    if (n.id === taskId) {
      return { ...n, status: done ? 'done' : 'todo', completed_at: done ? new Date().toISOString() : null };
    }
    if (!n.children?.length) return n;
    return { ...n, children: markDoneInTaskTree(n.children, taskId, done) };
  });
}

type Subtask = {
  id: string;
  title: string;
  done: boolean;
  priority?: string;
  priorityLabel?: string;
  deadline?: string;
  deadlineText?: string;
  reminder?: string;
  reminderText?: string;
  repeat?: string;
  repeatText?: string;
  note?: string;
  acceptanceCriteria?: string;
  schedule?: ProjectScheduleMeta | null;
  boundHabitIds?: string[];
  isLongTermTask?: boolean;
  autoPlaceIntoSchedule?: boolean;
  icon?: string;
};

type SubtaskNode = Subtask & { children: SubtaskNode[] };

const TITLE_MAX_LENGTH = 80;

type ProjectScheduleMeta = PickedScheduleMeta;

type ProjectExtraData = {
  schedule?: ProjectScheduleMeta | null;
  [key: string]: unknown;
};

type DateLimitYmd = {
  start?: string;
  end?: string;
};

function formatDate(value: string): string {
  const v = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(11, 16);
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${hour}:${minute}`;
}

function normalizeProjectCategoryId(categoryId: string | null | undefined): string | null {
  return !categoryId || categoryId === INBOX_PROJECT_CATEGORY_ID ? null : categoryId;
}

/** 未在弹窗中改分类时保留加载时的 category_id，避免 focus 重载把 selectedCategoryId 置空后误保存为未分类 */
function resolveProjectCategoryIdForSave(
  selectedId: string | null,
  snapshotCategoryId: string | null | undefined,
  categoryTouched: boolean,
): string | null {
  if (categoryTouched) {
    return normalizeProjectCategoryId(selectedId);
  }
  return normalizeProjectCategoryId(snapshotCategoryId ?? selectedId);
}

function parseProjectExtraData(raw: string | null): ProjectExtraData {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as ProjectExtraData;
    }
    return {};
  } catch {
    return {};
  }
}

function parseTaskExtraData(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

function buildWeekPlanItems(
  nodes: TaskTreeNode[],
  weekStartYmd: string,
  weekEndYmd: string,
  todayYmd: string,
): WeekPlanItem[] {
  const leaves = collectLeafTasks(nodes).filter(
    (n) => n.status !== 'done' && n.status !== 'cancelled',
  );
  const items: WeekPlanItem[] = [];
  for (const leaf of leaves) {
    const frogInWeek = getFrogAssignedDates(leaf.extra_data).filter(
      (d) => d >= weekStartYmd && d <= weekEndYmd,
    );
    const extra = parseTaskExtraData(leaf.extra_data);
    const schedule =
      extra.schedule && typeof extra.schedule === 'object' && !Array.isArray(extra.schedule)
        ? (extra.schedule as ProjectScheduleMeta)
        : null;
    const dueYmd = leaf.due_date ? toYmd(leaf.due_date) : null;
    const scheduleDate = schedule?.date ? toYmd(schedule.date) : null;
    const rangeStart = schedule?.range?.start ? toYmd(schedule.range.start) : null;
    const rangeEnd = schedule?.range?.end ? toYmd(schedule.range.end) : null;

    let anchorYmd: string | null = null;
    if (frogInWeek.length > 0) {
      anchorYmd = frogInWeek[frogInWeek.length - 1]!;
    } else if (dueYmd && dueYmd >= weekStartYmd && dueYmd <= weekEndYmd) {
      anchorYmd = dueYmd;
    } else if (scheduleDate && scheduleDate >= weekStartYmd && scheduleDate <= weekEndYmd) {
      anchorYmd = scheduleDate;
    } else if (rangeStart && rangeEnd && rangeStart <= weekEndYmd && rangeEnd >= weekStartYmd) {
      anchorYmd = rangeStart >= weekStartYmd ? rangeStart : weekStartYmd;
    }
    if (!anchorYmd) continue;

    const timeLabel = schedule?.hasExactTime
      ? formatHmFromScheduleTime(schedule.startTime)
      : schedule?.allDay
        ? '全天'
        : '';
    items.push({
      id: leaf.id,
      title: leaf.title.trim() || '未命名任务',
      ymd: anchorYmd,
      dayLabel: formatFrogAssignDayLabel(anchorYmd, todayYmd),
      timeLabel,
      inGrid: frogInWeek.length > 0,
    });
  }
  return items.sort((a, b) => a.ymd.localeCompare(b.ymd) || a.title.localeCompare(b.title));
}

function fromTaskPriority(value: TaskPriority): string {
  if (value >= 4) return '紧急重要';
  if (value === 3) return '紧急不重要';
  if (value === 2) return '不紧急重要';
  if (value === 1) return '不紧急不重要';
  return '';
}

function mapTaskRowToSubtask(task: TaskRow): Subtask {
  const extraData = parseTaskExtraData(task.extra_data);
  const reminder = typeof extraData.reminder === 'string' ? extraData.reminder : '';
  const repeat = typeof extraData.repeat === 'string' ? extraData.repeat : '';
  const priorityLabel = fromTaskPriority(task.priority);
  return {
    id: task.id,
    title: task.title,
    done: task.status === 'done',
    priority: priorityLabel,
    priorityLabel,
    deadline: task.due_date ? formatDate(task.due_date) : '',
    deadlineText: task.due_date ? formatDate(task.due_date) : '',
    reminder,
    reminderText: reminder,
    repeat,
    repeatText: repeat,
    note: task.note ?? '',
    acceptanceCriteria: task.description ?? '',
    boundHabitIds: parseBoundHabitIdsFromExtraData(task.extra_data),
    isLongTermTask: getIsLongTermTask(task.extra_data),
  };
}

function mapTaskTreeToSubtaskNodes(nodes: TaskTreeNode[]): SubtaskNode[] {
  return nodes.map((n) => ({
    ...mapTaskRowToSubtask(n),
    children: mapTaskTreeToSubtaskNodes(n.children),
  }));
}

function collectAllSubtaskIds(nodes: SubtaskNode[]): string[] {
  return nodes.flatMap((n) => [n.id, ...collectAllSubtaskIds(n.children)]);
}

function isProjectSubtaskUnchanged(
  existing: TaskRow,
  subtask: Subtask,
  parentTaskId: string | null,
): boolean {
  const existingExtra = parseTaskExtraData(existing.extra_data);
  const nextExtra = JSON.stringify({
    ...existingExtra,
    reminder: subtask.reminder || subtask.reminderText || '',
    repeat: subtask.repeat || subtask.repeatText || '',
  });
  const nextStatus = (subtask.done ? 'done' : 'todo') as TaskRow['status'];
  const nextDue = extractDueDateFromDeadlineText(subtask.deadline || subtask.deadlineText || '');
  const longTerm = subtask.isLongTermTask === true;
  const nextDescription = longTerm ? subtask.acceptanceCriteria?.trim() || null : null;
  const nextNote = longTerm ? null : subtask.note?.trim() || null;
  return (
    existing.title === (subtask.title.trim() || '未命名任务') &&
    (existing.description ?? null) === nextDescription &&
    (existing.note ?? null) === nextNote &&
    existing.status === nextStatus &&
    (existing.due_date?.slice(0, 10) ?? null) === (nextDue ?? null) &&
    (existing.extra_data ?? null) === nextExtra &&
    (existing.parent_task_id ?? null) === (parentTaskId ?? null)
  );
}

function flattenSubtasksWithParents(
  nodes: SubtaskNode[],
  parentId: string | null,
): Array<{ subtask: Subtask; parent_task_id: string | null }> {
  const out: Array<{ subtask: Subtask; parent_task_id: string | null }> = [];
  for (const n of nodes) {
    const { children, ...rest } = n;
    out.push({ subtask: rest, parent_task_id: parentId });
    out.push(...flattenSubtasksWithParents(children, n.id));
  }
  return out;
}

function markDoneInSubtaskTree(nodes: SubtaskNode[], taskId: string, done: boolean): SubtaskNode[] {
  return nodes.map((n) => {
    if (n.id === taskId) return { ...n, done };
    if (n.children.length === 0) return n;
    return { ...n, children: markDoneInSubtaskTree(n.children, taskId, done) };
  });
}

function buildDeadlineTextFromSchedule(schedule: ProjectScheduleMeta | null) {
  if (!schedule) return '';
  if (schedule.mode === 'time' && schedule.range) {
    const rangeStart = formatDate(schedule.range.start);
    const rangeEnd = formatDate(schedule.range.end);
    const rangeLabel = rangeStart === rangeEnd ? rangeStart : `${rangeStart} ~ ${rangeEnd}`;
    const timeLabel = schedule.allDay ? '全天' : `${formatTime(schedule.startTime)} - ${formatTime(schedule.endTime)}`;
    return `${rangeLabel} ${timeLabel}`;
  }
  if (schedule.date) {
    const dateLabel = formatDate(schedule.date);
    const timeLabel = schedule.allDay ? '全天' : schedule.hasExactTime ? formatTime(schedule.startTime) : '';
    return timeLabel ? `${dateLabel} ${timeLabel}` : dateLabel;
  }
  return '';
}

const PAGE_API_KEY = 'edit-project';

export default function EditProjectScreen() {
  const { wrapLoad, notifyAncestorsDataChanged } = usePageApiSync(PAGE_API_KEY);
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string; source?: string }>();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useAppTheme();
  const { tf, fonts } = useTaskFoldTheme();
  const { animate: foldAnimate } = useFoldMotionGate();

  const projectId = typeof params.id === 'string' ? params.id : '';
  const [title, setTitle] = React.useState('');
  const [entityIcon, setEntityIcon] = React.useState(DEFAULT_PROJECT_ICON);
  const [notes, setNotes] = React.useState('');
  const [acceptanceItems, setAcceptanceItems] = React.useState<AcceptanceCriterionItem[]>([
    createEmptyAcceptanceItem(),
  ]);
  const [deadlineText, setDeadlineText] = React.useState('');
  const [reminderText, setReminderText] = React.useState('');
  const [repeatText, setRepeatText] = React.useState('');
  const [scheduleMeta, setScheduleMeta] = React.useState<ProjectScheduleMeta | null>(null);
  const [projectExtraData, setProjectExtraData] = React.useState<ProjectExtraData>({});
  const [subtasks, setSubtasks] = React.useState<SubtaskNode[]>([]);
  const [taskTree, setTaskTree] = React.useState<TaskTreeNode[]>([]);
  const [hideCompletedTasks, setHideCompletedTasks] = React.useState(false);
  const [collapsedTaskIds, setCollapsedTaskIds] = React.useState<Record<string, boolean>>({});
  const [persistedTaskIds, setPersistedTaskIds] = React.useState<Set<string>>(new Set());
  const [categories, setCategories] = React.useState<ProjectCategoryRow[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = React.useState<string | null>(null);
  /** 供 readAddTaskResult / saveProject 读取，避免 focus 重载与闭包竞态 */
  const selectedCategoryIdRef = React.useRef<string | null>(null);
  const projectSnapshotRef = React.useRef<ProjectRow | null>(null);
  const categoryTouchedRef = React.useRef(false);
  React.useEffect(() => {
    selectedCategoryIdRef.current = selectedCategoryId;
  }, [selectedCategoryId]);
  const [categoryModalVisible, setCategoryModalVisible] = React.useState(false);
  const [allProjects, setAllProjects] = React.useState<ProjectRow[]>([]);
  const [projectsLoading, setProjectsLoading] = React.useState(true);
  const [prerequisiteProjectIds, setPrerequisiteProjectIds] = React.useState<string[]>([]);
  const [selectedTagIds, setSelectedTagIds] = React.useState<string[]>([]);
  const [allTags, setAllTags] = React.useState<ProjectTagRow[]>([]);
  const [tagsLoading, setTagsLoading] = React.useState(true);
  const [isLongTermProject, setIsLongTermProject] = React.useState(false);
  const [selectedLifeBetId, setSelectedLifeBetId] = React.useState<string | null>(null);
  const [lifeBets, setLifeBets] = React.useState<LifeBetRow[]>([]);
  const [lifeBetsLoading, setLifeBetsLoading] = React.useState(true);
  const [rewardPointsText, setRewardPointsText] = React.useState('0');
  const [priority, setPriority] = React.useState<TaskPriorityKey>('not-urgent-not-important');
  const [saving, setSaving] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [activityEvents, setActivityEvents] = React.useState<TaskExecutionEventWithTitle[]>([]);

  const scheduleSource =
    normalizeRouteParam(params.source as string | string[] | undefined) || `edit-project-${projectId || 'unknown'}`;
  const addTaskSource = `${scheduleSource}-add-task`;
  const foldCardBg = isDark ? colors.surfaceMuted : 'rgba(255,252,245,0.86)';
  const foldCardBorder = tf.line2;
  const outline = tf.muted;
  const outlineVariant = tf.line;
  const surfaceLow = isDark ? colors.input : '#F1EDE1';
  const surfaceLowest = isDark ? colors.surface : tf.card;
  const primary = tf.pond;
  const logicalTodayYmd = React.useMemo(
    () => getLogicalLocalYmd(new Date(), getDayBoundarySync()),
    [],
  );
  const weekStartYmd = React.useMemo(() => getWeekStartMondayYmd(logicalTodayYmd), [logicalTodayYmd]);
  const weekEndYmd = React.useMemo(() => addDaysToYmd(weekStartYmd, 6), [weekStartYmd]);
  const frowBorder = {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(232,224,210,0.52)',
  } as const;

  const refreshActivityEvents = React.useCallback(async (tree: TaskTreeNode[]) => {
    const ids = collectTaskTreeIds(tree);
    if (ids.length === 0) {
      setActivityEvents([]);
      return;
    }
    try {
      setActivityEvents(await getRecentExecutionEventsForTaskIds(ids, 5));
    } catch (error) {
      console.warn('加载项目活动失败', error);
      setActivityEvents([]);
    }
  }, []);

  const readScheduleResult = React.useCallback((): boolean => {
    const picked = consumeSchedulePickerResult(scheduleSource);
    if (!picked) return false;
    const labels = labelsFromPickerResult(picked);
    setDeadlineText(labels.deadlineText);
    setReminderText(labels.reminderText);
    setRepeatText(labels.repeatText);
    setScheduleMeta(labels.scheduleMeta);
    return true;
  }, [scheduleSource]);

  const readAddTaskResult = React.useCallback(async (): Promise<boolean> => {
    const payload = consumeAddTaskResult(addTaskSource);
    if (!payload) return false;
    if (!projectId) return true;

    const task = payload.task as Subtask;
    const normalizedCategoryId = resolveProjectCategoryIdForSave(
      selectedCategoryIdRef.current,
      projectSnapshotRef.current?.category_id,
      categoryTouchedRef.current,
    );

    try {
      const taskSchedule = (task.schedule ?? null) as ProjectScheduleMeta | null;
      const dueDate = dueDateFromScheduleMeta(
        taskSchedule,
        extractDueDateFromDeadlineText(task.deadline || task.deadlineText || ''),
      );
      const longTerm = task.isLongTermTask === true;
      const checklist = longTerm
        ? linesToAcceptanceChecklist(task.acceptanceCriteria ?? '')
        : [];
      let taskExtra = mergeLongTermTaskIntoExtraData(
        JSON.stringify({
          reminder: task.reminder || task.reminderText || '',
          repeat: task.repeat || task.repeatText || '',
          schedule: taskSchedule,
          ...(task.autoPlaceIntoSchedule ? { autoPlaceIntoSchedule: true } : {}),
          ...(task.icon?.trim()
            ? { icon: normalizeEntityIcon(task.icon, DEFAULT_TODO_ICON) }
            : {}),
        }),
        longTerm,
      );
      taskExtra = mergeAcceptanceChecklistIntoExtraData(taskExtra, checklist) ?? taskExtra;
      await createTask({
        id: task.id,
        project_id: projectId,
        category_id: normalizedCategoryId,
        parent_task_id: null,
        title: task.title.trim() || '未命名任务',
        description: longTerm ? task.acceptanceCriteria?.trim() || null : null,
        note: longTerm ? null : task.note?.trim() || null,
        status: (task.done ? 'done' : 'todo') as TaskRow['status'],
        priority: taskPriorityKeyToNumber(priority),
        due_date: dueDate,
        extra_data: taskExtra,
      });
      // 项目一旦有子任务，不再可作为青蛙实体
      const snap = projectSnapshotRef.current;
      if (snap) {
        const cleared = clearProjectFrogFields(snap.extra_data);
        if (cleared !== snap.extra_data) {
          await updateProject(projectId, { extra_data: cleared });
          projectSnapshotRef.current = { ...snap, extra_data: cleared };
          setProjectExtraData(parseProjectExtraData(cleared));
        }
      }
      setPersistedTaskIds((prev) => new Set(prev).add(task.id));
      try {
        const projectTasks = await getTasksByProjectId(projectId);
        setTaskTree(projectTasks);
        setSubtasks(mapTaskTreeToSubtaskNodes(projectTasks));
        await refreshActivityEvents(projectTasks);
      } catch {
        setSubtasks((prev) => [...prev, { ...task, children: [] }]);
      }
      toast.success('已加入项目');
      return true;
    } catch (error) {
      console.warn('添加任务写入失败', error);
      toast.error(formatWriteError(error, '任务未能写入数据库，请返回重新添加或稍后重试。'));
      return true;
    }
  }, [addTaskSource, priority, projectId, refreshActivityEvents]);

  const loadProject = React.useCallback(async () => {
    if (!projectId) {
      setLoading(false);
      Alert.alert('参数缺失', '未找到项目 ID。');
      router.back();
      return;
    }
    setLoading(true);
    try {
      const project = await getProjectById(projectId);
      if (!project) {
        Alert.alert('项目不存在', '未找到对应项目，可能已被删除。');
        router.back();
        return;
      }
      projectSnapshotRef.current = project;
      categoryTouchedRef.current = false;
      setTitle(project.name);
      setEntityIcon(resolveProjectDisplayIcon(project.name, project.extra_data));
      setSelectedCategoryId(normalizeProjectCategoryId(project.category_id));
      setPriority(taskPriorityToKey(project.priority ?? 0));
      const longTerm = getIsLongTermProject(project.extra_data);
      const checklist = parseAcceptanceChecklist(project.extra_data, longTerm ? project.note : null, null);
      setAcceptanceItems(checklist.length > 0 ? checklist : [createEmptyAcceptanceItem()]);
      setNotes(longTerm ? '' : (project.note ?? ''));
      const extraData = parseProjectExtraData(project.extra_data);
      setProjectExtraData(extraData);
      const loadedSchedule = (extraData.schedule ?? null) as ProjectScheduleMeta | null;
      setScheduleMeta(loadedSchedule);
      setReminderText(loadedSchedule ? formatTaskReminderLabel(loadedSchedule) : '');
      setRepeatText(loadedSchedule?.repeatOption === '不重复' ? '' : loadedSchedule?.repeatSummary ?? '');
      setDeadlineText(buildDeadlineTextFromSchedule(loadedSchedule) || (project.due_date ? formatDate(project.due_date) : ''));
      setPrerequisiteProjectIds(parsePrerequisiteProjectIds(project.extra_data));
      try {
        setSelectedTagIds(await getTagIdsByProjectId(projectId));
      } catch (tagErr) {
        console.warn('加载项目标签关联失败', tagErr);
        setSelectedTagIds([]);
      }
      setIsLongTermProject(longTerm);
      setSelectedLifeBetId(project.life_bet_id?.trim() ? project.life_bet_id : null);
      setRewardPointsText(String(parseRewardPointsFromExtraData(project.extra_data)));
      const projectTasks = await getTasksByProjectId(projectId);
      setTaskTree(projectTasks);
      const tree = mapTaskTreeToSubtaskNodes(projectTasks);
      setSubtasks(tree);
      setPersistedTaskIds(new Set(collectAllSubtaskIds(tree)));
      await refreshActivityEvents(projectTasks);
    } catch (error) {
      console.warn('加载项目详情失败', error);
      Alert.alert('加载失败', '无法读取项目详情，请稍后重试。');
      router.back();
    } finally {
      setLoading(false);
    }
  }, [projectId, refreshActivityEvents, router]);

  const reloadProjectPage = React.useCallback(
    async (forceRefresh = false) => {
      await wrapLoad(async () => {
        await loadProject();
        try {
          const rows = await getProjectCategories();
          setCategories(rows);
        } catch (error) {
          console.warn('加载项目分类失败', error);
          setCategories([]);
        }
        setProjectsLoading(true);
        try {
          const rows = await getProjects();
          setAllProjects(rows);
        } catch (error) {
          console.warn('加载项目列表失败', error);
          setAllProjects([]);
        } finally {
          setProjectsLoading(false);
        }
        setTagsLoading(true);
        try {
          setAllTags(await getProjectTags());
        } catch (error) {
          console.warn('加载项目标签失败', error);
          setAllTags([]);
        } finally {
          setTagsLoading(false);
        }
        setLifeBetsLoading(true);
        try {
          setLifeBets(await getLifeBetsLocal());
        } catch (error) {
          console.warn('加载道路赌注失败', error);
          setLifeBets([]);
        } finally {
          setLifeBetsLoading(false);
        }
      }, forceRefresh);
    },
    [loadProject, wrapLoad],
  );

  const { refreshControl } = usePagePullRefresh(PAGE_API_KEY, reloadProjectPage);

  React.useEffect(() => {
    readScheduleResult();
  }, [readScheduleResult]);

  React.useEffect(() => {
    void readAddTaskResult();
  }, [readAddTaskResult]);

  const reloadSubtasksOnly = React.useCallback(async () => {
    if (!projectId) return;
    try {
      const projectTasks = await getTasksByProjectId(projectId);
      setTaskTree(projectTasks);
      const tree = mapTaskTreeToSubtaskNodes(projectTasks);
      setSubtasks(tree);
      setPersistedTaskIds(new Set(collectAllSubtaskIds(tree)));
      await refreshActivityEvents(projectTasks);
    } catch (error) {
      console.warn('刷新项目任务失败', error);
    }
  }, [projectId, refreshActivityEvents]);

  /** 从子任务编辑页返回后刷新项目快照与分类展示，不重置 categoryTouched */
  const reloadProjectSnapshotOnly = React.useCallback(async () => {
    if (!projectId) return;
    try {
      const project = await getProjectById(projectId);
      if (!project) return;
      projectSnapshotRef.current = project;
      if (!categoryTouchedRef.current) {
        setSelectedCategoryId(normalizeProjectCategoryId(project.category_id));
      }
    } catch (error) {
      console.warn('刷新项目快照失败', error);
    }
  }, [projectId]);

  const reloadProjectPageRef = React.useRef(reloadProjectPage);
  reloadProjectPageRef.current = reloadProjectPage;
  const reloadSubtasksOnlyRef = React.useRef(reloadSubtasksOnly);
  reloadSubtasksOnlyRef.current = reloadSubtasksOnly;
  const reloadProjectSnapshotOnlyRef = React.useRef(reloadProjectSnapshotOnly);
  reloadProjectSnapshotOnlyRef.current = reloadProjectSnapshotOnly;
  const readScheduleResultRef = React.useRef(readScheduleResult);
  readScheduleResultRef.current = readScheduleResult;
  const readAddTaskResultRef = React.useRef(readAddTaskResult);
  readAddTaskResultRef.current = readAddTaskResult;

  React.useEffect(() => {
    categoryTouchedRef.current = false;
    projectSnapshotRef.current = null;
    void reloadProjectPageRef.current();
  }, [projectId]);

  useFocusEffect(
    React.useCallback(() => {
      let cancelled = false;
      void (async () => {
        const consumedSchedule = readScheduleResultRef.current();
        const consumedAddTask = await readAddTaskResultRef.current();
        if (cancelled) return;
        if (!consumedSchedule && !consumedAddTask) {
          await reloadProjectSnapshotOnlyRef.current();
          await reloadSubtasksOnlyRef.current();
        }
        try {
          const tags = await getProjectTags();
          if (!cancelled) {
            setAllTags(tags);
            setSelectedTagIds((prev) => prev.filter((id) => tags.some((t) => t.id === id)));
          }
        } catch (error) {
          console.warn('刷新项目标签失败', error);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [projectId]),
  );

  const selectedCategoryName = React.useMemo(() => {
    if (!selectedCategoryId) return '';
    return categories.find((item) => item.id === selectedCategoryId)?.name ?? '';
  }, [categories, selectedCategoryId]);

  const selectableProjectCategories = React.useMemo(
    () => categories.filter((c) => c.id !== INBOX_PROJECT_CATEGORY_ID),
    [categories]
  );
  const taskDateLimit = React.useMemo<DateLimitYmd | null>(() => {
    if (scheduleMeta?.mode === 'time' && scheduleMeta.range?.start && scheduleMeta.range?.end) {
      const start = toYmd(scheduleMeta.range.start);
      const end = toYmd(scheduleMeta.range.end);
      if (start || end) return { start: start ?? undefined, end: end ?? undefined };
    }
    if (scheduleMeta?.date) {
      const date = toYmd(scheduleMeta.date);
      if (date) return { start: date, end: date };
    }
    const end = extractDueDateFromDeadlineText(deadlineText);
    if (end) return { end };
    return null;
  }, [deadlineText, scheduleMeta]);

  const inheritedTaskSchedule = React.useMemo(
    () => resolveInheritedDefaultSchedule(scheduleMeta, taskDateLimit),
    [scheduleMeta, taskDateLimit],
  );

  const openEditTask = React.useCallback(
    (taskId: string) => {
      if (!taskId) return;
      if (!persistedTaskIds.has(taskId)) {
        Alert.alert('暂不可打开', '该任务尚未保存到数据库，请先保存项目后再查看详情。');
        return;
      }
      router.push({ pathname: '/task/[id]', params: { id: taskId } });
    },
    [persistedTaskIds, router],
  );

  const progress = React.useMemo(() => getProjectTreeTaskProgress(taskTree), [taskTree]);
  const frogLeafCount = React.useMemo(() => countFrogLeaves(taskTree), [taskTree]);
  const displayTaskTree = React.useMemo(
    () => (hideCompletedTasks ? filterTreeHideCompleted(taskTree) : taskTree),
    [hideCompletedTasks, taskTree],
  );
  const weekPlanItems = React.useMemo(
    () => buildWeekPlanItems(taskTree, weekStartYmd, weekEndYmd, logicalTodayYmd),
    [logicalTodayYmd, taskTree, weekEndYmd, weekStartYmd],
  );
  const activityFeed = React.useMemo(() => {
    type FeedRow = { key: string; title: string; detail: string; when: string; tone: 'frog' | 'amber' };
    const rows: FeedRow[] = [];
    for (const leaf of collectLeafTasks(taskTree)) {
      const frogDates = getFrogAssignedDates(leaf.extra_data).filter(
        (d) => d >= weekStartYmd && d <= weekEndYmd,
      );
      if (frogDates.length === 0) continue;
      const ymd = frogDates[frogDates.length - 1]!;
      const extra = parseTaskExtraData(leaf.extra_data);
      const schedule =
        extra.schedule && typeof extra.schedule === 'object' && !Array.isArray(extra.schedule)
          ? (extra.schedule as ProjectScheduleMeta)
          : null;
      const time = schedule?.hasExactTime ? formatHmFromScheduleTime(schedule.startTime) : '';
      const day = formatFrogAssignDayLabel(ymd, logicalTodayYmd);
      rows.push({
        key: `frog-${leaf.id}-${ymd}`,
        title: leaf.title.trim() || '未命名任务',
        detail: ` 指派为青蛙 · ${day}${time ? ` ${time}` : ''}`,
        when: formatActivityWhen(`${ymd} 12:00:00`, logicalTodayYmd),
        tone: 'frog',
      });
    }
    for (const ev of activityEvents) {
      const name = ev.task_title?.trim() || '任务';
      const action = activityActionLabel(ev.action);
      const progressHint =
        ev.action === 'completed' && progress.total > 0
          ? ` · ${progress.done} / ${progress.total}`
          : '';
      rows.push({
        key: ev.id,
        title: name,
        detail: ` ${action}${progressHint}`,
        when: formatActivityWhen(ev.created_at, logicalTodayYmd),
        tone: ev.action === 'completed' ? 'frog' : 'amber',
      });
    }
    return rows.slice(0, 4);
  }, [activityEvents, logicalTodayYmd, progress.done, progress.total, taskTree, weekEndYmd, weekStartYmd]);
  const rewardN = Math.round(Number(rewardPointsText) || 0);
  const hasChildTasks = progress.total > 0;

  const toggleTaskCollapse = React.useCallback((taskId: string) => {
    setCollapsedTaskIds((prev) => ({ ...prev, [taskId]: !prev[taskId] }));
  }, []);

  const toggleTaskDone = React.useCallback(
    async (task: TaskRow) => {
      const nextDone = !(task.status === 'done' || task.status === 'cancelled');
      try {
        await updateTask(task.id, {
          status: nextDone ? 'done' : 'todo',
          completed_at: nextDone ? new Date().toISOString() : null,
        });
        setTaskTree((prev) => markDoneInTaskTree(prev, task.id, nextDone));
        setSubtasks((prev) => markDoneInSubtaskTree(prev, task.id, nextDone));
      } catch (error) {
        console.warn('切换任务完成状态失败', error);
        toast.error('无法更新任务状态');
      }
    },
    [],
  );

  const bumpReward = React.useCallback((delta: number) => {
    const cur = Number(rewardPointsText);
    const base = Number.isFinite(cur) ? cur : 0;
    setRewardPointsText(String(Math.max(-999, Math.min(999, Math.round(base + delta)))));
  }, [rewardPointsText]);

  const openSchedulePicker = React.useCallback(() => {
    const scheduleInit: SchedulePickerInitPayload | undefined = scheduleMeta
      ? {
          mode: scheduleMeta.mode,
          quickChip: '',
          allDay: scheduleMeta.allDay,
          hasExactTime: scheduleMeta.hasExactTime,
          reminderOption: scheduleMeta.reminderOption,
          reminderHour: scheduleMeta.reminderHour,
          reminderMinute: scheduleMeta.reminderMinute,
          repeatOption: scheduleMeta.repeatOption,
          repeatSummary: scheduleMeta.repeatSummary,
          weeklyDays: scheduleMeta.weeklyDays,
          monthlyDays: scheduleMeta.monthlyDays,
          yearlyDate: scheduleMeta.yearlyDate,
          date: scheduleMeta.date,
          range: scheduleMeta.range,
          startTime: scheduleMeta.startTime,
          endTime: scheduleMeta.endTime,
        }
      : undefined;
    router.push({
      pathname: '/schedule-picker',
      params: {
        source: scheduleSource,
        initial: scheduleInit ? JSON.stringify(scheduleInit) : '',
      },
    });
  }, [router, scheduleMeta, scheduleSource]);

  const saveProject = React.useCallback(async () => {
    if (!projectId) return;
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      Alert.alert('无法保存项目', '请输入项目名称后再保存。');
      return;
    }
    if (saving) return;

    const prereqValidation = validatePrerequisiteSelection(projectId, prerequisiteProjectIds, allProjects);
    if (!prereqValidation.ok) {
      Alert.alert('无法保存项目', prereqValidation.message);
      return;
    }

    setSaving(true);
    let committed = false;
    beginCloudSqliteDirtyIgnoreBatch();
    try {
      const db = await getDatabase();
      await db.execAsync('BEGIN IMMEDIATE');
      const categoryTouched = categoryTouchedRef.current;
      const normalizedCategoryId = categoryTouched
        ? resolveProjectCategoryIdForSave(
            selectedCategoryIdRef.current,
            projectSnapshotRef.current?.category_id,
            true,
          )
        : null;
      const writeOpts = { deferSync: true as const };
      const scheduleToSave = ensureProjectScheduleMetaForSave(scheduleMeta, deadlineText);
      const mergedExtra = mergePrerequisiteIdsIntoExtraData(
        { ...projectExtraData, schedule: scheduleToSave },
        prerequisiteProjectIds,
      );
      delete (mergedExtra as Record<string, unknown>).completion_reward;
      const withReward = mergeRewardPointsIntoExtraObject(
        mergedExtra as Record<string, unknown>,
        normalizeRewardPoints(rewardPointsText),
      );
      const withIcon = mergeIconIntoExtraObject(withReward, entityIcon, DEFAULT_PROJECT_ICON);
      const withLongTerm = mergeLongTermProjectIntoExtraData(JSON.stringify(withIcon), isLongTermProject);
      const checklist = isLongTermProject ? acceptanceItems : [];
      const withAcceptance =
        mergeAcceptanceChecklistIntoExtraData(withLongTerm, checklist) ?? withLongTerm;
      // 项目一旦有子任务，不再可作为青蛙实体
      const nextExtraAfterTasks =
        subtasks.length > 0 ? clearProjectFrogFields(withAcceptance) : withAcceptance;
      const projectDueDate = dueDateFromScheduleMeta(scheduleToSave, extractDueDateFromDeadlineText(deadlineText));
      await updateProject(projectId, {
        ...(categoryTouched ? { category_id: normalizedCategoryId } : {}),
        life_bet_id: selectedLifeBetId,
        name: trimmedTitle,
        priority: taskPriorityKeyToNumber(priority),
        note: isLongTermProject
          ? acceptanceChecklistToLines(acceptanceItems) || null
          : notes.trim() || null,
        due_date: projectDueDate,
        extra_data: nextExtraAfterTasks,
      });
      await setProjectTagIds(projectId, selectedTagIds);
      const projectFrame = mergeDateLimit(scheduleMetaToDateLimit(scheduleToSave), {
        end: projectDueDate ?? undefined,
      });
      const existingTasks = await getTasksByProjectId(projectId);
      const existingTaskIds = new Set(collectAllSubtaskIds(mapTaskTreeToSubtaskNodes(existingTasks)));
      const existingTaskById = new Map<string, TaskRow>();
      const walkExistingTasks = (nodes: TaskTreeNode[]) => {
        for (const node of nodes) {
          existingTaskById.set(node.id, node);
          if (node.children.length > 0) walkExistingTasks(node.children);
        }
      };
      walkExistingTasks(existingTasks);

      const projectPriorityValue = taskPriorityKeyToNumber(priority);
      const flatWithParents = flattenSubtasksWithParents(subtasks, null);
      for (const { subtask, parent_task_id } of flatWithParents) {
        const existingTask = existingTaskById.get(subtask.id);
        const existingExtra = existingTask ? parseTaskExtraData(existingTask.extra_data) : parseTaskExtraData(null);
        const longTerm = subtask.isLongTermTask === true;
        const checklist = longTerm
          ? linesToAcceptanceChecklist(subtask.acceptanceCriteria ?? '')
          : [];
        let taskExtra = mergeLongTermTaskIntoExtraData(
          JSON.stringify({
            ...existingExtra,
            reminder: subtask.reminder || subtask.reminderText || '',
            repeat: subtask.repeat || subtask.repeatText || '',
          }),
          longTerm,
        );
        taskExtra = mergeAcceptanceChecklistIntoExtraData(taskExtra, checklist) ?? taskExtra;
        const payload = {
          project_id: projectId,
          parent_task_id,
          title: subtask.title.trim() || '未命名任务',
          description: longTerm ? subtask.acceptanceCriteria?.trim() || null : null,
          note: longTerm ? null : subtask.note?.trim() || null,
          status: (subtask.done ? 'done' : 'todo') as TaskRow['status'],
          priority: projectPriorityValue,
          due_date: extractDueDateFromDeadlineText(subtask.deadline || subtask.deadlineText || ''),
          extra_data: taskExtra,
        };

        if (existingTaskIds.has(subtask.id)) {
          if (!existingTask || !isProjectSubtaskUnchanged(existingTask, subtask, parent_task_id) || existingTask.priority !== projectPriorityValue) {
            await updateTask(subtask.id, payload, writeOpts);
          }
        } else {
          await createTask(
            {
              id: subtask.id,
              ...payload,
              category_id: null,
            },
            writeOpts,
          );
        }
      }
      // 保存后若已有任务，清除项目级青蛙标记（项目不可再作青蛙）
      const editedSubtaskIds = new Set(flatWithParents.map((x) => x.subtask.id));
      for (const [tid, existingTask] of existingTaskById) {
        if (editedSubtaskIds.has(tid)) continue;
        if (existingTask.priority !== projectPriorityValue) {
          await updateTask(tid, { priority: projectPriorityValue }, writeOpts);
        }
      }
      // 项目已设日程 → 下属任务完全继承；未设则不改任务自有日程
      const scheduleForInherit =
        scheduleMetaHasConcreteDates(scheduleToSave)
          ? scheduleToSave
          : hasDateLimitBounds(projectFrame)
            ? resolveInheritedDefaultSchedule(scheduleToSave, projectFrame)
            : null;
      if (scheduleForInherit) {
        await applyProjectScheduleToAllTasks(projectId, scheduleForInherit, writeOpts);
      }
      // 项目已贴标签 → 清除任务自有标签（展示/排序走项目标签）
      if (selectedTagIds.length > 0) {
        for (const [tid, existingTask] of existingTaskById) {
          if (existingTask.parent_task_id) continue;
          await setTaskTagIds(tid, []);
        }
      }
      await db.execAsync('COMMIT');
      committed = true;
    } catch (error) {
      try {
        const db = await getDatabase();
        await db.execAsync('ROLLBACK');
      } catch {
        /* 无活动事务时 ROLLBACK 可能失败，忽略 */
      }
      console.warn('保存项目失败', error);
      toast.error(formatWriteError(error, '保存失败，请稍后重试'));
      setSaving(false);
    } finally {
      endCloudSqliteDirtyIgnoreBatch();
    }

    if (!committed) return;

    try {
      const projectSyncTables = [
        'projects',
        'project_categories',
        'tasks',
        'task_categories',
        'tags',
        'tag_links',
      ];
      await markPendingTablesDirty(projectSyncTables);
      await requestPush({
        awaitSync: true,
        rethrow: true,
        // 本地已落库；同步失败用下方 toast，勿挂全局「加载失败」蒙层
        quiet: true,
        onlyTables: projectSyncTables,
      });
      notifyAncestorsDataChanged();
      toast.success('已保存');
    } catch (syncErr) {
      console.warn('项目保存后同步到服务器失败', syncErr);
      toast.warn('已保存 · 同步失败，仅本机生效');
    }

    try {
      if (Platform.OS !== 'web' && router.canGoBack()) {
        router.back();
      } else if (Platform.OS !== 'web') {
        router.replace('/(tabs)/tasks');
      } else {
        router.back();
      }
    } catch (e) {
      console.warn('离开编辑页失败（数据已保存）', e);
      setSaving(false);
      try {
        router.replace('/(tabs)/tasks');
      } catch (e2) {
        console.warn('备用跳转失败', e2);
      }
    }
  }, [
    allProjects,
    deadlineText,
    entityIcon,
    isLongTermProject,
    acceptanceItems,
    notes,
    prerequisiteProjectIds,
    priority,
    projectExtraData,
    projectId,
    rewardPointsText,
    notifyAncestorsDataChanged,
    router,
    saving,
    scheduleMeta,
    selectedLifeBetId,
    selectedTagIds,
    subtasks,
    title,
  ]);

  const removeProject = React.useCallback(() => {
    if (!projectId || saving || loading) return;

    const deleteProjectAndLeave = async () => {
      try {
        setSaving(true);
        await deleteProject(projectId);
        // 本地已软删：无论云端同步是否成功，都通知任务列表下次聚焦重读 SQLite
        notifyAncestorsDataChanged();
        try {
          const projectSyncTables = ['projects', 'tasks'];
          await markPendingTablesDirty(projectSyncTables);
          await requestPush({
            awaitSync: true,
            rethrow: true,
            quiet: true,
            onlyTables: projectSyncTables,
          });
        } catch (syncErr) {
          console.warn('项目删除后同步到服务器失败', syncErr);
        }
        toast.success('已删除');
        router.back();
      } catch (error) {
        console.warn('删除项目失败', error);
        toast.error(formatWriteError(error, '项目删除失败，请稍后重试。'));
      } finally {
        setSaving(false);
      }
    };

    (async () => {
      try {
        const incomplete = await countIncompleteTasksByProjectId(projectId);
        const message =
          incomplete > 0
            ? `该项目下有 ${incomplete} 个未完成任务/子任务。\n\n确认删除该项目，并连同其所有任务一起删除吗？（删除后在同步或恢复功能前无法找回）`
            : '删除后在同步或恢复功能前无法找回，确认删除吗？';

        Alert.alert('删除项目', message, [
          { text: '取消', style: 'cancel' },
          {
            text: '删除',
            style: 'destructive',
            onPress: () => void deleteProjectAndLeave(),
          },
        ]);
      } catch (error) {
        console.warn('统计项目任务失败', error);
        Alert.alert('删除项目', '删除后在同步或恢复功能前无法找回，确认删除吗？', [
          { text: '取消', style: 'cancel' },
          {
            text: '删除',
            style: 'destructive',
            onPress: () => void deleteProjectAndLeave(),
          },
        ]);
      }
    })();
  }, [loading, notifyAncestorsDataChanged, projectId, router, saving]);


  const footPad = Math.max(insets.bottom, 12);
  const formBusy = saving || loading;
  const headerSub = [
    selectedCategoryName || '未分类',
    frogLeafCount > 0 ? `${frogLeafCount} 只青蛙` : null,
    deadlineText ? deadlineText.split(/\s/)[0] : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const prereqLabels = prerequisiteProjectIds
    .map((id) => allProjects.find((p) => p.id === id)?.name)
    .filter(Boolean) as string[];

  const openAddTask = () => {
    router.push({
      pathname: '/add-task',
      params: {
        source: addTaskSource,
        dateLimit: taskDateLimit ? JSON.stringify(taskDateLimit) : '',
        defaultSchedule: inheritedTaskSchedule ? JSON.stringify(inheritedTaskSchedule) : '',
        lockSchedule:
          scheduleMetaHasConcreteDates(scheduleMeta) || hasDateLimitBounds(taskDateLimit ?? {})
            ? '1'
            : '',
      },
    });
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: tf.paper }]} edges={['left', 'right']}>
      <ComposerTopBar
        title={loading ? '加载中' : '项目详情'}
        subtitle={headerSub || '编辑项目'}
        onBack={() => router.back()}
        onSubmit={() => void saveProject()}
        submitting={formBusy}
        submitLabel="保存"
      />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView
          refreshControl={refreshControl}
          contentContainerStyle={[styles.foldContent, { paddingBottom: 100 + footPad }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          {loading && !title ? (
            <View style={styles.editLoading}>
              <ActivityIndicator size="large" color={tf.frog} />
              <Text style={{ fontSize: 13, color: tf.faint }}>加载项目…</Text>
            </View>
          ) : (
            <>
              <FoldRiseIn animate={foldAnimate} index={0} duration={520} staggerMs={42} fromY={10} holdHidden={foldAnimate}>
                <View style={[styles.fcard, { backgroundColor: foldCardBg, borderColor: foldCardBorder }]}>
                  <View style={styles.heroRow}>
                    <EntityIconPickerField
                      compact
                      value={entityIcon}
                      onChange={setEntityIcon}
                      fallback={DEFAULT_PROJECT_ICON}
                      disabled={formBusy}
                      accessibilityLabel="选择项目图标"
                    />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <TextInput
                        value={title}
                        onChangeText={(t) => setTitle(t.slice(0, TITLE_MAX_LENGTH))}
                        placeholder="项目名称"
                        placeholderTextColor={tf.faint}
                        multiline
                        editable={!formBusy}
                        maxLength={TITLE_MAX_LENGTH}
                        style={[
                          styles.foldTitleInput,
                          { color: tf.pond, fontFamily: fonts.serif, opacity: loading ? 0.65 : 1 },
                        ]}
                      />
                      <Text style={{ fontSize: 11, color: tf.faint, marginTop: 2 }} numberOfLines={1}>
                        {[
                          selectedCategoryName || '未分类',
                          formatTaskPriorityShort(taskPriorityKeyToNumber(priority)),
                          deadlineText || null,
                          prereqLabels[0] ? `前置：${prereqLabels[0]}${prereqLabels.length > 1 ? '…' : ''}` : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </Text>
                    </View>
                    {progress.total > 0 ? (
                      <FoldProgressRing
                        ratio={progress.ratio}
                        size={38}
                        strokeWidth={3}
                        color={tf.rose}
                      />
                    ) : null}
                  </View>
                  {progress.total > 0 ? (
                    <View style={{ marginTop: 8 }}>
                      <FoldProgressBar
                        ratio={progress.ratio}
                        height={4}
                        colorFrom="#E3B39C"
                        colorTo={tf.rose}
                      />
                    </View>
                  ) : null}
                  <View style={styles.heroMeta}>
                    <Text style={{ fontSize: 11, color: tf.faint }}>
                      {progress.total > 0
                        ? `${progress.done} / ${progress.total} 任务`
                        : '暂无任务'}
                    </Text>
                    <Text style={styles.dot}>·</Text>
                    <Text style={{ fontSize: 11, color: tf.faint }}>
                      {frogLeafCount > 0 ? `${frogLeafCount} 只青蛙已入格` : '未入格青蛙'}
                    </Text>
                    <Text style={styles.dot}>·</Text>
                    <Text style={{ fontSize: 11, color: tf.faint, fontFamily: fonts.mono }}>
                      {rewardN > 0 ? `+${rewardN}` : String(rewardN)} 积分
                    </Text>
                  </View>
                </View>
              </FoldRiseIn>

              <FoldRiseIn animate={foldAnimate} index={1} duration={520} staggerMs={42} fromY={10} holdHidden={foldAnimate}>
                <View style={[styles.fcard, { backgroundColor: foldCardBg, borderColor: foldCardBorder }]}>
                  <View style={styles.treeHead}>
                    <Text style={{ fontSize: 14, fontWeight: '800', color: tf.ink2 }}>任务树</Text>
                    <Text style={{ fontSize: 10, color: tf.faint, flex: 1 }}>可展开 / 勾选 / 进编辑</Text>
                    <Pressable onPress={() => setHideCompletedTasks((v) => !v)} hitSlop={6}>
                      <Text style={{ fontSize: 11, color: '#8C998E' }}>
                        {hideCompletedTasks ? '显示已完成' : '隐藏已完成'}
                      </Text>
                    </Pressable>
                  </View>
                  {displayTaskTree.length === 0 ? (
                    <View style={[styles.emptyTree, { borderColor: foldCardBorder }]}>
                      <MaterialIcons name="playlist-add-check" size={16} color={tf.faint} />
                      <Text style={{ flex: 1, fontSize: 12, color: tf.muted }}>
                        {taskTree.length === 0
                          ? '暂无任务，点下方加任务'
                          : '已完成任务已隐藏'}
                      </Text>
                    </View>
                  ) : (
                    <ProjectFoldTaskTree
                      nodes={displayTaskTree}
                      expanded
                      locked={formBusy}
                      logicalTodayYmd={logicalTodayYmd}
                      collapsedTaskIds={collapsedTaskIds}
                      formatDayLabel={formatFrogAssignDayLabel}
                      priorityLabel={formatTaskPriorityShort}
                      onToggleCollapse={toggleTaskCollapse}
                      onToggleDone={(task) => {
                        if (formBusy) return;
                        void toggleTaskDone(task);
                      }}
                      onOpenTask={(id) => openEditTask(id)}
                    />
                  )}
                  <View style={styles.treefoot}>
                    <Pressable
                      onPress={openAddTask}
                      disabled={formBusy}
                      style={({ pressed }) => [
                        styles.treeAdd,
                        { opacity: formBusy ? 0.5 : pressed ? 0.8 : 1 },
                      ]}>
                      <MaterialIcons name="add" size={12} color={tf.frog} />
                      <Text style={{ fontSize: 12, fontWeight: '700', color: tf.frog }}>加任务</Text>
                    </Pressable>
                    <Text style={{ fontSize: 10, color: tf.faint }}>未落库临时任务不能进编辑</Text>
                  </View>
                </View>
              </FoldRiseIn>

              <FoldRiseIn animate={foldAnimate} index={2} duration={520} staggerMs={42} fromY={10} holdHidden={foldAnimate}>
                <View
                  style={[
                    styles.fcard,
                    styles.fcardTight,
                    { backgroundColor: foldCardBg, borderColor: foldCardBorder },
                  ]}>
                  <View style={styles.frow}>
                    <Text style={[styles.frowLab, { color: '#8A968C' }]}>依赖</Text>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <PrerequisiteProjectPickerField
                        selectedIds={prerequisiteProjectIds}
                        allProjects={allProjects}
                        excludeProjectId={projectId}
                        loading={projectsLoading || loading}
                        disabled={formBusy}
                        onChange={setPrerequisiteProjectIds}
                        textColor={tf.ink}
                        outline={outline}
                        placeholderColor={tf.faint}
                        primary={primary}
                        surfaceLow={surfaceLow}
                        surfaceLowest={surfaceLowest}
                        isDark={isDark}
                      />
                    </View>
                  </View>
                  <Pressable
                    onPress={openSchedulePicker}
                    disabled={formBusy}
                    style={({ pressed }) => [
                      styles.frow,
                      frowBorder,
                      { opacity: formBusy ? 0.65 : pressed ? 0.88 : 1 },
                    ]}>
                    <Text style={[styles.frowLab, { color: '#8A968C' }]}>日程</Text>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={[styles.frowValBold, { color: tf.ink2 }]} numberOfLines={1}>
                        {deadlineText || '未设置'}
                      </Text>
                      {reminderText || repeatText ? (
                        <Text style={{ fontSize: 10, color: tf.faint, marginTop: 1 }} numberOfLines={1}>
                          {[reminderText, repeatText].filter(Boolean).join(' · ')}
                        </Text>
                      ) : null}
                    </View>
                    <Text style={{ fontSize: 11, color: '#6F856B' }}>选择 ›</Text>
                  </Pressable>
                  <View style={[styles.frow, frowBorder]}>
                    <Text style={[styles.frowLab, { color: '#8A968C' }]}>标签</Text>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <ProjectTagPickerField
                        selectedIds={selectedTagIds}
                        allTags={allTags}
                        loading={tagsLoading || loading}
                        disabled={formBusy}
                        onChange={setSelectedTagIds}
                        textColor={tf.ink}
                        outline={outline}
                        placeholderColor={tf.faint}
                        primary={primary}
                        surfaceLow={surfaceLow}
                        surfaceLowest={surfaceLowest}
                        isDark={isDark}
                      />
                    </View>
                  </View>
                  {isLongTermProject ? (
                    <View style={[styles.frow, frowBorder, { alignItems: 'flex-start', paddingVertical: 8 }]}>
                      <Text style={[styles.frowLab, { color: '#8A968C', marginTop: 4 }]}>验收标准</Text>
                      <View style={{ flex: 1, minWidth: 0, opacity: formBusy ? 0.65 : 1 }}>
                        <AcceptanceChecklistEditor
                          items={acceptanceItems}
                          onChange={setAcceptanceItems}
                          mode="edit"
                          disabled={formBusy}
                          inkColor={tf.ink2}
                          faintColor={tf.faint}
                          frogColor={tf.frog}
                          onPondColor={tf.onPond}
                          lineColor={tf.line2}
                        />
                      </View>
                    </View>
                  ) : (
                    <View style={[styles.frow, frowBorder, { alignItems: 'flex-start', paddingVertical: 8 }]}>
                      <Text style={[styles.frowLab, { color: '#8A968C', marginTop: 4 }]}>备注</Text>
                      <TextInput
                        value={notes}
                        onChangeText={setNotes}
                        placeholder="可选补充说明"
                        placeholderTextColor={tf.faint}
                        editable={!formBusy}
                        multiline
                        style={[
                          styles.frowInput,
                          { color: tf.ink2, flex: 1, minHeight: 36, opacity: formBusy ? 0.65 : 1 },
                        ]}
                      />
                      <MaterialIcons name="edit" size={14} color="#A4ADA3" style={{ marginTop: 6 }} />
                    </View>
                  )}
                </View>
              </FoldRiseIn>

              <FoldRiseIn animate={foldAnimate} index={3} duration={520} staggerMs={42} fromY={10} holdHidden={foldAnimate}>
                <View style={[styles.fcard, styles.extraCard, { backgroundColor: foldCardBg, borderColor: foldCardBorder }]}>
                  <View style={styles.sectionHead}>
                    <Text style={{ fontSize: 13, fontWeight: '800', color: tf.ink2 }}>本周安排</Text>
                    <Text style={{ fontSize: 10, color: tf.faint, flex: 1 }}>
                      {weekPlanItems.length > 0
                        ? `${weekPlanItems.length} 个叶子待推进`
                        : '暂无叶子'}
                    </Text>
                    <Pressable
                      onPress={() => router.push('/tasks-calendar')}
                      hitSlop={8}
                      style={{ marginLeft: 'auto' }}>
                      <Text style={{ fontSize: 11, color: '#6F856B', fontWeight: '600' }}>日程 ›</Text>
                    </Pressable>
                  </View>
                  {weekPlanItems.length === 0 ? (
                    <Text style={{ fontSize: 12, color: tf.faint, paddingVertical: 4 }}>
                      本周尚无入格或到期的叶子任务
                    </Text>
                  ) : (
                    weekPlanItems.map((item, i) => (
                      <Pressable
                        key={item.id}
                        onPress={() => openEditTask(item.id)}
                        style={[styles.histrow, i === 0 ? { borderTopWidth: 0 } : null]}>
                        <View
                          style={[
                            styles.hiBox,
                            {
                              backgroundColor: item.inGrid
                                ? 'rgba(79,124,81,0.12)'
                                : isDark
                                  ? tf.mist
                                  : '#F1EDE1',
                            },
                          ]}>
                          {item.inGrid ? (
                            <MaterialIcons name="eco" size={12} color={tf.frog} />
                          ) : (
                            <Text style={{ fontSize: 11 }}>·</Text>
                          )}
                        </View>
                        <View style={styles.hc2}>
                          <Text style={[styles.hcTitle, { color: tf.ink2 }]} numberOfLines={1}>
                            {item.title}
                          </Text>
                          <Text style={{ fontSize: 10, color: tf.faint, marginTop: 1 }} numberOfLines={1}>
                            {[item.dayLabel, item.timeLabel].filter(Boolean).join(' · ')}
                            {' · '}
                            {item.inGrid ? '已入格' : '尚未入格'}
                          </Text>
                        </View>
                        <Text style={{ fontSize: 11, color: '#9DA69D', fontWeight: '600' }}>
                          {item.dayLabel}
                        </Text>
                      </Pressable>
                    ))
                  )}
                </View>
              </FoldRiseIn>

              <FoldRiseIn animate={foldAnimate} index={4} duration={520} staggerMs={42} fromY={10} holdHidden={foldAnimate}>
                <View style={[styles.fcard, styles.extraCard, { backgroundColor: foldCardBg, borderColor: foldCardBorder }]}>
                  <View style={styles.sectionHead}>
                    <Text style={{ fontSize: 13, fontWeight: '800', color: tf.ink2 }}>项目活动</Text>
                    <Pressable
                      onPress={() => router.push('/tasks-overview')}
                      hitSlop={8}
                      style={{ marginLeft: 'auto' }}>
                      <Text style={{ fontSize: 11, color: '#6F856B', fontWeight: '600' }}>全部 ›</Text>
                    </Pressable>
                  </View>
                  {activityFeed.length === 0 ? (
                    <Text style={{ fontSize: 12, color: tf.faint, paddingVertical: 4 }}>
                      入格、完成或恢复任务后会出现在这里
                    </Text>
                  ) : (
                    activityFeed.map((row, i) => (
                      <View
                        key={row.key}
                        style={[styles.actrow, i === 0 ? { borderTopWidth: 0, paddingTop: 2 } : null]}>
                        <View
                          style={[
                            styles.ad,
                            { backgroundColor: row.tone === 'frog' ? tf.frog : tf.amber },
                          ]}
                        />
                        <Text style={[styles.at, { color: tf.ink2 }]} numberOfLines={2}>
                          <Text style={{ fontWeight: '700' }}>{row.title}</Text>
                          {row.detail}
                        </Text>
                        <Text style={[styles.aw, { color: tf.faint }]}>{row.when}</Text>
                      </View>
                    ))
                  )}
                </View>
              </FoldRiseIn>

              <FoldRiseIn animate={foldAnimate} index={5} duration={520} staggerMs={42} fromY={10} holdHidden={foldAnimate}>
                <View style={[styles.fcard, { backgroundColor: foldCardBg, borderColor: foldCardBorder }]}>
                  <TaskFoldPriorityGrid
                    value={priority}
                    onChange={setPriority}
                    subtitle="改判后下属任务同步移动"
                  />
                </View>
              </FoldRiseIn>

              <FoldRiseIn animate={foldAnimate} index={6} duration={520} staggerMs={42} fromY={10} holdHidden={foldAnimate}>
                <View
                  style={[
                    styles.fcard,
                    styles.fcardTight,
                    { backgroundColor: foldCardBg, borderColor: foldCardBorder },
                  ]}>
                  <Pressable
                    onPress={() => setCategoryModalVisible(true)}
                    disabled={formBusy}
                    style={({ pressed }) => [
                      styles.frow,
                      { opacity: formBusy ? 0.65 : pressed ? 0.88 : 1 },
                    ]}>
                    <Text style={[styles.frowLab, { color: '#8A968C' }]}>分类</Text>
                    <Text style={[styles.frowValBold, { color: tf.ink2, flex: 1 }]} numberOfLines={1}>
                      {selectedCategoryName || '未分类'}
                    </Text>
                    <Text style={{ fontSize: 11, color: '#6F856B' }}>选择 ›</Text>
                  </Pressable>
                  <View style={[styles.frow, frowBorder]}>
                    <Text style={[styles.frowLab, { color: '#8A968C' }]}>道路</Text>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <LifeBetPickerField
                        selectedId={selectedLifeBetId}
                        allBets={lifeBets}
                        loading={lifeBetsLoading || loading}
                        disabled={formBusy}
                        onChange={setSelectedLifeBetId}
                        textColor={tf.ink}
                        outline={outline}
                        placeholderColor={tf.faint}
                        primary={primary}
                        surfaceLow={surfaceLow}
                        surfaceLowest={surfaceLowest}
                        isDark={isDark}
                      />
                    </View>
                  </View>
                  <View style={[styles.frow, frowBorder]}>
                    <Text style={[styles.frowLab, { color: '#8A968C' }]}>奖励积分</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.frowValBold, { color: tf.ink2 }]}>
                        {rewardN > 0 ? `+${rewardN}` : String(rewardN)}
                      </Text>
                      <Text style={{ fontSize: 10, color: tf.faint }}>项目完成时结算</Text>
                    </View>
                    <View style={styles.stepper}>
                      <Pressable
                        onPress={() => bumpReward(-1)}
                        disabled={formBusy}
                        style={styles.stepperBtn}>
                        <Text style={{ color: '#6F7D72', fontWeight: '700' }}>−</Text>
                      </Pressable>
                      <Text
                        style={{
                          fontFamily: fonts.mono,
                          fontSize: 13,
                          color: '#5C6D60',
                          minWidth: 24,
                          textAlign: 'center',
                        }}>
                        {rewardN}
                      </Text>
                      <Pressable
                        onPress={() => bumpReward(1)}
                        disabled={formBusy}
                        style={styles.stepperBtn}>
                        <Text style={{ color: '#6F7D72', fontWeight: '700' }}>+</Text>
                      </Pressable>
                    </View>
                  </View>
                  <View style={[styles.frow, frowBorder]}>
                    <Text style={[styles.frowLab, { color: '#8A968C' }]}>长期</Text>
                    <Text style={{ flex: 1, fontSize: 12, color: tf.faint }}>
                      无子任务时可指派青蛙
                    </Text>
                    <TaskFoldSwitch
                      value={isLongTermProject}
                      onValueChange={(next) => {
                        if (next) {
                          setAcceptanceItems((prev) => {
                            const hasText = prev.some((i) => i.text.trim());
                            if (hasText) return prev;
                            const fromNote = linesToAcceptanceChecklist(notes);
                            return fromNote.length > 0 ? fromNote : [createEmptyAcceptanceItem()];
                          });
                          setNotes('');
                        } else {
                          setNotes((prev) => prev.trim() || acceptanceChecklistToLines(acceptanceItems));
                          setAcceptanceItems([createEmptyAcceptanceItem()]);
                        }
                        setIsLongTermProject(next);
                      }}
                      disabled={formBusy}
                      accessibilityLabel="长期项目"
                    />
                  </View>
                </View>
              </FoldRiseIn>

              {hasChildTasks ? (
                <FoldRiseIn animate={foldAnimate} index={7} duration={520} staggerMs={42} fromY={8} holdHidden={foldAnimate}>
                  <View
                    style={[
                      styles.lockBanner,
                      {
                        backgroundColor: isDark ? 'rgba(245,237,224,0.12)' : 'rgba(245,237,224,0.7)',
                        borderColor: isDark ? tf.line2 : '#E4D3B9',
                      },
                    ]}>
                    <View style={[styles.lockIcon, { backgroundColor: '#F1E3CC' }]}>
                      <MaterialIcons name="lock-outline" size={14} color="#A87C3E" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 12, fontWeight: '700', color: '#8B6B37' }}>
                        项目暂不可直接指派青蛙
                      </Text>
                      <Text style={{ fontSize: 10, color: '#A38B63', marginTop: 2 }}>
                        已有子任务；请把叶子任务放进日程
                      </Text>
                    </View>
                    <Pressable
                      onPress={openAddTask}
                      style={[styles.miniChip, { backgroundColor: '#EFE6D6' }]}>
                      <Text style={{ fontSize: 11, color: '#A38B63', fontWeight: '600' }}>
                        选择叶子 ›
                      </Text>
                    </Pressable>
                  </View>
                </FoldRiseIn>
              ) : null}

              <FoldRiseIn animate={foldAnimate} index={8} duration={520} staggerMs={42} fromY={8} holdHidden={foldAnimate}>
                <View style={styles.hintline}>
                  <MaterialIcons name="lightbulb-outline" size={13} color={tf.faint} />
                  <Text style={{ flex: 1, fontSize: 11, color: tf.faint, lineHeight: 15 }}>
                    项目标签会清空任务自有标签；下属任务继承项目日程。
                  </Text>
                </View>
              </FoldRiseIn>

              <FoldRiseIn animate={foldAnimate} index={9} duration={520} staggerMs={42} fromY={8} holdHidden={foldAnimate}>
                <View style={styles.deleteRow}>
                  <Pressable
                    onPress={removeProject}
                    disabled={formBusy}
                    style={({ pressed }) => [
                      styles.deleteGhost,
                      {
                        borderColor: isDark ? 'rgba(224,139,109,0.45)' : '#E2C5B9',
                        backgroundColor: isDark ? 'rgba(247,230,222,0.12)' : 'rgba(247,230,222,0.45)',
                        opacity: formBusy ? 0.5 : pressed ? 0.85 : 1,
                      },
                    ]}>
                    <MaterialIcons name="delete-outline" size={16} color={tf.rose} />
                    <Text style={{ fontSize: 13, fontWeight: '600', color: tf.rose }}>删除项目</Text>
                  </Pressable>
                  <Text style={{ fontSize: 10, color: tf.faint, textAlign: 'right', lineHeight: 14 }}>
                    同步失败时{'\n'}仅本机保存
                  </Text>
                </View>
              </FoldRiseIn>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal
        transparent
        visible={categoryModalVisible}
        animationType="fade"
        onRequestClose={() => setCategoryModalVisible(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setCategoryModalVisible(false)}>
          <Pressable
            onPress={() => {}}
            style={[styles.modalCard, { backgroundColor: surfaceLowest, borderColor: outlineVariant }]}>
            <Text style={[styles.modalTitle, { color: tf.ink }]}>选择项目分类</Text>
            <Pressable
              onPress={() => {
                categoryTouchedRef.current = true;
                setSelectedCategoryId(null);
                setCategoryModalVisible(false);
              }}
              style={({ pressed }) => [styles.modalItem, pressed && { opacity: 0.8 }]}>
              <Text style={[styles.modalItemText, { color: tf.ink }]}>未分类</Text>
              {selectedCategoryId === null ? (
                <MaterialIcons name="check" size={18} color={primary} />
              ) : null}
            </Pressable>
            {selectableProjectCategories.map((item) => (
              <Pressable
                key={item.id}
                onPress={() => {
                  categoryTouchedRef.current = true;
                  setSelectedCategoryId(item.id);
                  setCategoryModalVisible(false);
                }}
                style={({ pressed }) => [styles.modalItem, pressed && { opacity: 0.8 }]}>
                <Text style={[styles.modalItemText, { color: tf.ink }]}>{item.name}</Text>
                {selectedCategoryId === item.id ? (
                  <MaterialIcons name="check" size={18} color={primary} />
                ) : null}
              </Pressable>
            ))}
          </Pressable>
        </Pressable>
      </Modal>

      {saving ? (
        <View
          style={[
            styles.savingOverlay,
            { backgroundColor: isDark ? 'rgba(15,23,42,0.55)' : 'rgba(255,252,245,0.72)' },
          ]}
          pointerEvents="auto">
          <ActivityIndicator size="large" color={primary} />
          <Text style={{ fontSize: 15, fontWeight: '600', color: tf.ink }}>正在保存…</Text>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  foldContent: {
    paddingHorizontal: 14,
    paddingTop: 10,
    gap: 8,
    maxWidth: 560,
    width: '100%',
    alignSelf: 'center',
  },
  editLoading: { paddingVertical: 48, alignItems: 'center', gap: 12 },
  fcard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  fcardTight: { paddingVertical: 8 },
  extraCard: { paddingVertical: 9 },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  histrow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 7,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(232,224,210,0.55)',
  },
  hiBox: {
    width: 22,
    height: 22,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hc2: { flex: 1, minWidth: 0 },
  hcTitle: { fontSize: 13, fontWeight: '700' },
  actrow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingVertical: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(232,224,210,0.55)',
  },
  ad: { width: 6, height: 6, borderRadius: 3, marginTop: 5 },
  at: { flex: 1, fontSize: 12, lineHeight: 17 },
  aw: { fontSize: 10, marginTop: 2 },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  foldTitleInput: {
    padding: 0,
    fontSize: 20,
    fontWeight: '600',
    lineHeight: 26,
    minHeight: 28,
  },
  heroMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 8,
    flexWrap: 'wrap',
  },
  dot: { fontSize: 11, color: '#98A197' },
  treeHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  emptyTree: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: 'dashed',
  },
  treefoot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(232,224,210,0.5)',
  },
  treeAdd: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  frow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 40,
  },
  frowLab: { width: 52, fontSize: 12, flexShrink: 0 },
  frowValBold: { fontSize: 13, fontWeight: '700' },
  frowInput: { fontSize: 13, paddingVertical: 4, paddingHorizontal: 0, fontWeight: '600' },
  miniChip: {
    height: 22,
    paddingHorizontal: 8,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepperBtn: {
    width: 22,
    height: 22,
    borderRadius: 6,
    backgroundColor: '#F0EBDE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lockBanner: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  lockIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hintline: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 5,
    paddingHorizontal: 4,
  },
  deleteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 2,
  },
  deleteGhost: {
    flex: 1,
    height: 40,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.38)',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  modalCard: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 6 },
  modalTitle: { fontSize: 16, fontWeight: '700', marginBottom: 4 },
  modalItem: {
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modalItemText: { fontSize: 14, fontWeight: '600' },
  savingOverlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 300,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
  },
});
