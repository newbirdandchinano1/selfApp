import { ComposerTopBar, type TaskPriorityKey } from '@/components/composer';
import {
  AddSubtaskSheet,
  labelsFromPickerResult,
  extractDueDateFromDeadlineText,
  type AddSubtaskDraft,
} from '@/components/entity-form';
import { ProjectTagPickerField } from '@/components/projects/ProjectTagPickerField';
import {
  FoldRiseIn,
  useFoldMotionGate,
} from '@/components/review/fold-motion';
import { BoundHabitPickerField } from '@/components/tasks/BoundHabitPickerField';
import { EntityIconPickerField } from '@/components/tasks/EntityIconPickerField';
import { TaskFoldPriorityGrid } from '@/components/tasks/task-fold-priority-grid';
import { TaskFoldSwitch } from '@/components/tasks/task-fold-switch';
import { useTaskFoldTheme } from '@/constants/task-fold-theme';
import { useAppTheme } from '@/hooks/use-app-theme';
import { usePageApiSync, usePagePullRefresh } from '@/hooks/use-page-api-sync';
import { resolveAcceptanceCriteria } from '@/lib/acceptance-criteria';
import { markPendingTablesDirty } from '@/lib/api-incremental-sync';
import { toast } from '@/lib/app-feedback';
import {
  DEFAULT_TODO_ICON,
  mergeIconIntoExtraData,
  normalizeEntityIcon,
  parseIconFromExtraData,
} from '@/lib/constants/entity-icon-choices';
import { formatWriteError } from '@/lib/format-write-error';
import { getIsLongTermTask, mergeLongTermTaskIntoExtraData } from '@/lib/long-term-task';
import { notifyPageDataChanged } from '@/lib/page-api-session';
import { getHabitContexts } from '@/lib/repositories/habits/habit-context';
import { getHabits } from '@/lib/repositories/habits/habit';
import type { HabitRow } from '@/lib/repositories/habits/habit.types';
import { getProjectById } from '@/lib/repositories/projects/project';
import {
  getTagIdsByEntity,
  getProjectTags,
  getTagsByProjectId,
  getTagIdsByProjectId,
  setTaskTagIds,
} from '@/lib/repositories/tags/tag';
import type { TagRow } from '@/lib/repositories/tags/tag.types';
import {
  mergeBoundHabitIdsIntoExtraData,
  parseBoundHabitIdsFromExtraData,
  tryCompleteTaskByBoundHabits,
} from '@/lib/repositories/tasks/task-habit-binding';
import {
  countIncompleteDescendantTasks,
  createTask,
  deleteTask,
  getChildTasksByParentTaskId,
  getTaskById,
  updateTask,
} from '@/lib/repositories/tasks/task';
import {
  normalizeTaskPriority,
  type TaskPriority,
  type TaskRow,
  type TaskStatus,
} from '@/lib/repositories/tasks/task.types';
import {
  mergeRewardPointsIntoExtraData,
  normalizeRewardPoints,
  parseRewardPointsFromExtraData,
} from '@/lib/reward-points';
import {
  applyScheduleMetaToLabels,
  buildDeadlineTextFromSchedule,
  dueDateFromScheduleMeta,
  extractScheduleLimitFromExtra,
  formatDate,
  mergeDateLimit,
  projectDefinesSchedule,
  resolveInheritedDefaultSchedule,
  scheduleMetaHasConcreteDates,
  scheduleMetaToDateLimit,
  toYmd,
  type DateLimitYmd,
  type ScheduleMetaLike,
} from '@/lib/schedule-inherit';
import {
  canEnableAutoPlaceIntoSchedule,
  parseAutoPlaceIntoSchedule,
} from '@/lib/schedule/task-virtual-placement';
import {
  consumeSchedulePickerResult,
  normalizeRouteParam,
  type SchedulePickerInitPayload,
  type PickedScheduleMeta,
} from '@/lib/schedule-picker-bridge';
import { isStandaloneTodoTask, standaloneTodoEditorHref } from '@/lib/standalone-todo-task';
import { requestPush } from '@/lib/sync-manager';
import { formatTaskReminderLabel } from '@/lib/task-reminder-schedule';
import { tightenDescendantTasksOf } from '@/lib/tighten-task-schedules';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect, useIsFocused, useNavigation, usePreventRemove } from 'expo-router/react-navigation';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

type PriorityKey = TaskPriorityKey;

/** 设计稿状态芯片（不含已完成；done 仍可在快照中保留） */
const STATUS_CHIPS: Array<{ key: Exclude<TaskStatus, 'done'>; label: string }> = [
  { key: 'doing', label: '进行中' },
  { key: 'todo', label: '待办' },
  { key: 'blocked', label: '受阻' },
  { key: 'cancelled', label: '已取消' },
  { key: 'shelved', label: '暂时搁置' },
];

function normalizeEditTaskStatus(raw: string | null | undefined): TaskStatus {
  if (
    raw === 'doing' ||
    raw === 'done' ||
    raw === 'blocked' ||
    raw === 'cancelled' ||
    raw === 'shelved' ||
    raw === 'todo'
  ) {
    return raw;
  }
  return 'todo';
}

type TaskScheduleMeta = PickedScheduleMeta;

type SubtaskDraft = {
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
  note?: string | null;
  schedule?: TaskScheduleMeta | null;
  /** Sheet 回传的数值优先级（1–4）；列表草稿仍用字符串 priority */
  priorityValue?: number;
  estimatedMinutes?: number;
};

function parseTaskExtraData(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    return {};
  } catch {
    return {};
  }
}

function toTaskPriority(value?: string): TaskPriority {
  const text = (value ?? '').toLowerCase();
  if (text.includes('不紧急不重要')) return 1;
  if (text.includes('不紧急重要')) return 2;
  if (text.includes('紧急不重要')) return 3;
  if (text.includes('紧急重要')) return 4;
  return 0;
}

function fromTaskPriority(value: TaskPriority): string {
  if (value >= 4) return '紧急重要';
  if (value === 3) return '紧急不重要';
  if (value === 2) return '不紧急重要';
  if (value === 1) return '不紧急不重要';
  return '';
}

function priorityShortLabel(priorityText?: string): string {
  const value = (priorityText ?? '').trim();
  if (value.includes('紧急重要') && !value.includes('不')) return 'P1';
  if (value.includes('紧急不重要')) return 'P2';
  if (value.includes('不紧急重要')) return 'P3';
  if (value.includes('不紧急不重要')) return 'P4';
  return '';
}

function mapTaskRowToSubtask(task: TaskRow): SubtaskDraft {
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
  };
}

function mapPriorityTextToKey(label: string): PriorityKey {
  if (label.includes('不紧急不重要')) return 'not-urgent-not-important';
  if (label.includes('不紧急重要')) return 'not-urgent-important';
  if (label.includes('紧急不重要')) return 'urgent-not-important';
  if (label.includes('紧急重要')) return 'urgent-important';
  return 'not-urgent-not-important';
}

function priorityKeyToLabel(key: PriorityKey): string {
  if (key === 'urgent-important') return '紧急重要';
  if (key === 'urgent-not-important') return '紧急不重要';
  if (key === 'not-urgent-important') return '不紧急重要';
  return '不紧急不重要';
}

type EditTaskFormSnapshot = {
  title: string;
  entityIcon: string;
  status: TaskStatus;
  acceptanceCriteria: string;
  priority: PriorityKey;
  deadlineText: string;
  reminderText: string;
  repeatText: string;
  scheduleMeta: TaskScheduleMeta | null;
  boundHabitIds: string[];
  isLongTermTask: boolean;
  autoPlaceIntoSchedule: boolean;
  rewardPointsText: string;
};

function buildFormSnapshotFromTask(task: TaskRow): EditTaskFormSnapshot {
  const priorityLabel = fromTaskPriority(task.priority);
  const extraData = parseTaskExtraData(task.extra_data);
  const reminder = typeof extraData.reminder === 'string' ? extraData.reminder : '';
  const repeat = typeof extraData.repeat === 'string' ? extraData.repeat : '';
  const loadedSchedule = (extraData.schedule ?? null) as TaskScheduleMeta | null;

  let deadlineText = task.due_date ? formatDate(task.due_date) : '';
  let reminderText = reminder;
  let repeatText = repeat;
  let scheduleMeta: TaskScheduleMeta | null = null;

  if (loadedSchedule) {
    scheduleMeta = loadedSchedule;
    reminderText = formatTaskReminderLabel(loadedSchedule);
    repeatText = loadedSchedule.repeatOption === '不重复' ? '' : loadedSchedule.repeatSummary;
    deadlineText =
      buildDeadlineTextFromSchedule(loadedSchedule) || (task.due_date ? formatDate(task.due_date) : '');
  }

  return {
    title: (task.title ?? '').trim(),
    entityIcon: parseIconFromExtraData(task.extra_data, DEFAULT_TODO_ICON),
    status: normalizeEditTaskStatus(task.status),
    acceptanceCriteria: resolveAcceptanceCriteria(task.description, task.note),
    priority: mapPriorityTextToKey(priorityLabel),
    deadlineText,
    reminderText,
    repeatText,
    scheduleMeta,
    boundHabitIds: parseBoundHabitIdsFromExtraData(task.extra_data),
    isLongTermTask: getIsLongTermTask(task.extra_data),
    autoPlaceIntoSchedule: parseAutoPlaceIntoSchedule(task.extra_data),
    rewardPointsText: String(parseRewardPointsFromExtraData(task.extra_data)),
  };
}

function buildFormSnapshotFromFields(input: {
  title: string;
  entityIcon: string;
  status: TaskStatus;
  acceptanceCriteria: string;
  priority: PriorityKey;
  deadlineText: string;
  reminderText: string;
  repeatText: string;
  scheduleMeta: TaskScheduleMeta | null;
  boundHabitIds: string[];
  isLongTermTask: boolean;
  autoPlaceIntoSchedule: boolean;
  rewardPointsText: string;
}): EditTaskFormSnapshot {
  return {
    title: input.title.trim(),
    entityIcon: normalizeEntityIcon(input.entityIcon, DEFAULT_TODO_ICON),
    status: input.status,
    acceptanceCriteria: input.acceptanceCriteria.trim(),
    priority: input.priority,
    deadlineText: input.deadlineText,
    reminderText: input.reminderText,
    repeatText: input.repeatText,
    scheduleMeta: input.scheduleMeta,
    boundHabitIds: input.boundHabitIds,
    isLongTermTask: input.isLongTermTask,
    autoPlaceIntoSchedule: input.autoPlaceIntoSchedule,
    rewardPointsText: String(normalizeRewardPoints(input.rewardPointsText)),
  };
}

function formSnapshotsEqual(a: EditTaskFormSnapshot, b: EditTaskFormSnapshot): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

const TITLE_MAX_LENGTH = 80;

const PAGE_API_KEY = 'edit-task';

export default function EditTaskScreen() {
  const { wrapLoad } = usePageApiSync(PAGE_API_KEY);
  const router = useRouter();
  const navigation = useNavigation();
  const isFocused = useIsFocused();
  const params = useLocalSearchParams<{ id?: string; source?: string; from?: string | string[] }>();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useAppTheme();
  const { tf, fonts } = useTaskFoldTheme();
  const { animate: foldAnimate } = useFoldMotionGate();

  const taskId = typeof params.id === 'string' ? params.id : '';
  /** 从任务详情进入编辑时，保存/删除后需跳过详情页，直接回到任务 Tab */
  const openedFromTaskDetail =
    params.from === 'task-detail' || (Array.isArray(params.from) && params.from[0] === 'task-detail');
  const scheduleSource =
    normalizeRouteParam(params.source as string | string[] | undefined) || `edit-task-${taskId || 'unknown'}`;
  const addSubtaskSource = `${scheduleSource}-add-subtask`;
  const pickParentTaskSource = `${scheduleSource}-pick-parent`;

  const [title, setTitle] = React.useState('');
  const [entityIcon, setEntityIcon] = React.useState(DEFAULT_TODO_ICON);
  const [status, setStatus] = React.useState<TaskStatus>('todo');
  const [acceptanceCriteria, setAcceptanceCriteria] = React.useState('');
  const [priority, setPriority] = React.useState<PriorityKey>('urgent-important');
  const [projectPriorityLabel, setProjectPriorityLabel] = React.useState('');
  const [projectName, setProjectName] = React.useState('');
  const [deadlineText, setDeadlineText] = React.useState('');
  const [reminderText, setReminderText] = React.useState('');
  const [repeatText, setRepeatText] = React.useState('');
  const [scheduleMeta, setScheduleMeta] = React.useState<TaskScheduleMeta | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [taskSnapshot, setTaskSnapshot] = React.useState<TaskRow | null>(null);
  const [loadedFormSnapshot, setLoadedFormSnapshot] = React.useState<EditTaskFormSnapshot | null>(null);
  const [subtasks, setSubtasks] = React.useState<SubtaskDraft[]>([]);
  const [addSubtaskOpen, setAddSubtaskOpen] = React.useState(false);
  const [parentTask, setParentTask] = React.useState<SubtaskDraft | null>(null);
  const [parentDateLimit, setParentDateLimit] = React.useState<DateLimitYmd>({});
  const [projectDateLimit, setProjectDateLimit] = React.useState<DateLimitYmd>({});
  const [projectScheduleMeta, setProjectScheduleMeta] = React.useState<ScheduleMetaLike | null>(null);
  const [inheritsProjectSchedule, setInheritsProjectSchedule] = React.useState(false);
  const [inheritsProjectTags, setInheritsProjectTags] = React.useState(false);
  const [boundHabitIds, setBoundHabitIds] = React.useState<string[]>([]);
  const [isLongTermTask, setIsLongTermTask] = React.useState(false);
  const [autoPlaceIntoSchedule, setAutoPlaceIntoSchedule] = React.useState(false);
  const [switchBounceToken, setSwitchBounceToken] = React.useState(0);
  const [rewardPointsText, setRewardPointsText] = React.useState('0');
  const [selectedTagIds, setSelectedTagIds] = React.useState<string[]>([]);
  const [allTags, setAllTags] = React.useState<TagRow[]>([]);
  const [tagsLoading, setTagsLoading] = React.useState(false);
  const [habitSections, setHabitSections] = React.useState<
    Array<{ contextId: string; contextName: string; habits: HabitRow[] }>
  >([]);
  const [habitsLoading, setHabitsLoading] = React.useState(true);

  const skipAutoSaveRef = React.useRef(false);
  const exitingAfterSaveRef = React.useRef(false);
  const creatingSubtaskIdRef = React.useRef<string | null>(null);
  const [skipRemoveGuard, setSkipRemoveGuard] = React.useState(false);
  const dirtyOpacity = React.useRef(new Animated.Value(0)).current;
  const titleRef = React.useRef(title);
  const entityIconRef = React.useRef(entityIcon);
  const statusRef = React.useRef(status);
  const acceptanceCriteriaRef = React.useRef(acceptanceCriteria);
  const priorityRef = React.useRef(priority);
  const deadlineTextRef = React.useRef(deadlineText);
  const reminderTextRef = React.useRef(reminderText);
  const repeatTextRef = React.useRef(repeatText);
  const scheduleMetaRef = React.useRef(scheduleMeta);
  const taskSnapshotRef = React.useRef(taskSnapshot);
  const boundHabitIdsRef = React.useRef(boundHabitIds);
  const isLongTermTaskRef = React.useRef(isLongTermTask);
  const autoPlaceIntoScheduleRef = React.useRef(autoPlaceIntoSchedule);
  const rewardPointsTextRef = React.useRef(rewardPointsText);
  const selectedTagIdsRef = React.useRef(selectedTagIds);
  titleRef.current = title;
  entityIconRef.current = entityIcon;
  statusRef.current = status;
  acceptanceCriteriaRef.current = acceptanceCriteria;
  priorityRef.current = priority;
  deadlineTextRef.current = deadlineText;
  reminderTextRef.current = reminderText;
  repeatTextRef.current = repeatText;
  scheduleMetaRef.current = scheduleMeta;
  taskSnapshotRef.current = taskSnapshot;
  boundHabitIdsRef.current = boundHabitIds;
  isLongTermTaskRef.current = isLongTermTask;
  autoPlaceIntoScheduleRef.current = autoPlaceIntoSchedule;
  rewardPointsTextRef.current = rewardPointsText;
  selectedTagIdsRef.current = selectedTagIds;

  React.useEffect(() => {
    if (!autoPlaceIntoSchedule) return;
    const gate = canEnableAutoPlaceIntoSchedule(scheduleMeta, repeatText);
    if (!gate.ok) setAutoPlaceIntoSchedule(false);
  }, [autoPlaceIntoSchedule, scheduleMeta, repeatText]);

  const openSchedulePickerRef = React.useRef<() => void>(() => {});
  const toggleAutoPlaceIntoSchedule = React.useCallback(() => {
    if (autoPlaceIntoSchedule) {
      setAutoPlaceIntoSchedule(false);
      return;
    }
    const gate = canEnableAutoPlaceIntoSchedule(scheduleMeta, repeatText);
    if (!gate.ok) {
      setSwitchBounceToken((n) => n + 1);
      if (gate.reason === 'no-repeat') {
        Alert.alert('无法开启自动入格', '请先在日程中设置重复规则。', [
          { text: '取消', style: 'cancel' },
          { text: '去设置', onPress: () => openSchedulePickerRef.current() },
        ]);
        return;
      }
      Alert.alert('无法开启自动入格', '自动入格需在日程中开启「具体时间」。', [
        { text: '取消', style: 'cancel' },
        { text: '去设置', onPress: () => openSchedulePickerRef.current() },
      ]);
      return;
    }
    setAutoPlaceIntoSchedule(true);
  }, [autoPlaceIntoSchedule, repeatText, scheduleMeta]);

  const inheritsProjectPriority = !!taskSnapshot?.project_id;
  const isRootTask = !taskSnapshot?.parent_task_id;
  /** 顶层任务可编辑标签（项目未贴标签时）；子任务仅展示继承的项目标签 */
  const showTagField = isRootTask || inheritsProjectTags;

  const subtaskDateLimit = React.useMemo<DateLimitYmd | null>(() => {
    const selfLimit = mergeDateLimit(scheduleMetaToDateLimit(scheduleMeta), {
      end: extractDueDateFromDeadlineText(deadlineText) || undefined,
    });
    const merged = mergeDateLimit(selfLimit, projectDateLimit);
    return merged.start || merged.end ? merged : null;
  }, [deadlineText, projectDateLimit, scheduleMeta]);

  const taskDateLimit = React.useMemo<DateLimitYmd | null>(() => {
    const merged = mergeDateLimit(parentDateLimit, projectDateLimit);
    return merged.start || merged.end ? merged : null;
  }, [parentDateLimit, projectDateLimit]);

  const inheritedSubtaskSchedule = React.useMemo(() => {
    if (inheritsProjectSchedule && projectScheduleMeta) {
      return resolveInheritedDefaultSchedule(projectScheduleMeta, projectDateLimit);
    }
    return resolveInheritedDefaultSchedule(scheduleMeta, subtaskDateLimit);
  }, [
    inheritsProjectSchedule,
    projectDateLimit,
    projectScheduleMeta,
    scheduleMeta,
    subtaskDateLimit,
  ]);

  const foldCardBg = isDark ? colors.surfaceMuted : 'rgba(255,252,245,0.86)';
  const foldCardBorder = tf.line2;
  const autoPlaceGate = React.useMemo(
    () => canEnableAutoPlaceIntoSchedule(scheduleMeta, repeatText),
    [repeatText, scheduleMeta],
  );
  const rewardN = Math.round(Number(rewardPointsText) || 0);
  const incompleteSubtaskCount = React.useMemo(
    () => subtasks.filter((s) => !s.done).length,
    [subtasks],
  );

  const isDirty = React.useMemo(() => {
    if (!loadedFormSnapshot || loading) return false;
    const current = buildFormSnapshotFromFields({
      title,
      entityIcon,
      status,
      acceptanceCriteria,
      priority,
      deadlineText,
      reminderText,
      repeatText,
      scheduleMeta,
      boundHabitIds,
      isLongTermTask,
      autoPlaceIntoSchedule,
      rewardPointsText,
    });
    return !formSnapshotsEqual(loadedFormSnapshot, current);
  }, [
    acceptanceCriteria,
    autoPlaceIntoSchedule,
    boundHabitIds,
    deadlineText,
    entityIcon,
    isLongTermTask,
    loadedFormSnapshot,
    loading,
    priority,
    reminderText,
    repeatText,
    rewardPointsText,
    scheduleMeta,
    status,
    title,
  ]);

  React.useEffect(() => {
    Animated.timing(dirtyOpacity, {
      toValue: isDirty ? 1 : 0,
      duration: 220,
      useNativeDriver: true,
    }).start();
  }, [dirtyOpacity, isDirty]);

  const bumpReward = React.useCallback((delta: number) => {
    const cur = Number(rewardPointsText);
    const base = Number.isFinite(cur) ? cur : 0;
    setRewardPointsText(String(Math.max(-999, Math.min(999, Math.round(base + delta)))));
  }, [rewardPointsText]);

  const reload = React.useCallback(async (forceRefresh = false) => {
    if (!taskId) return;
    try {
      await wrapLoad(async () => {
        const nodes = await getChildTasksByParentTaskId(taskId);
        const rows = nodes.map((n) => n as unknown as TaskRow);
        setSubtasks(rows.map(mapTaskRowToSubtask));
      }, forceRefresh);
    } catch (error) {
      console.warn('加载子任务失败', error);
      setSubtasks([]);
    }
  }, [taskId, wrapLoad]);

  const { refreshControl } = usePagePullRefresh(PAGE_API_KEY, reload);

  const readScheduleResult = React.useCallback((): boolean => {
    const picked = consumeSchedulePickerResult(scheduleSource);
    if (!picked) return false;
    const labels = labelsFromPickerResult(picked, taskDateLimit);
    setDeadlineText(labels.deadlineText);
    setReminderText(labels.reminderText);
    setRepeatText(labels.repeatText);
    setScheduleMeta(labels.scheduleMeta);
    return true;
  }, [scheduleSource, taskDateLimit]);

  const openSchedulePicker = React.useCallback(() => {
    if (inheritsProjectSchedule) return;
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
        dateLimit: taskDateLimit ? JSON.stringify(taskDateLimit) : '',
      },
    });
  }, [inheritsProjectSchedule, router, scheduleMeta, scheduleSource, taskDateLimit]);
  openSchedulePickerRef.current = openSchedulePicker;

  const createSubtaskFromDraft = React.useCallback(
    async (draft: AddSubtaskDraft) => {
      if (creatingSubtaskIdRef.current === draft.id) return;
      const parent = taskSnapshotRef.current;
      if (!parent) {
        toast.error('父任务尚未加载完成，请稍后重试。');
        throw new Error('父任务尚未加载');
      }

      creatingSubtaskIdRef.current = draft.id;
      try {
        const subtaskSchedule = draft.schedule ?? null;
        const dueDate = dueDateFromScheduleMeta(
          subtaskSchedule,
          extractDueDateFromDeadlineText(draft.deadline || draft.deadlineText || ''),
        );
        const payloadPriority = typeof draft.priority === 'number' ? draft.priority : 0;
        let subtaskPriority = normalizeTaskPriority(
          payloadPriority > 0 ? payloadPriority : parent.priority,
        );
        if (!(payloadPriority > 0) && parent.project_id) {
          const project = await getProjectById(parent.project_id);
          if (project) subtaskPriority = normalizeTaskPriority(project.priority ?? 0);
        }
        const doneCount = subtasks.filter((s) => s.done).length;
        const totalCount = subtasks.length;
        await createTask({
          id: draft.id,
          project_id: parent.project_id,
          category_id: parent.category_id,
          parent_task_id: taskId,
          title: draft.title.trim() || '未命名任务',
          note: draft.note?.trim() || null,
          status: 'todo',
          priority: subtaskPriority,
          due_date: dueDate,
          extra_data: JSON.stringify({
            reminder: draft.reminder || draft.reminderText || '',
            repeat: draft.repeat || draft.repeatText || '',
            schedule: subtaskSchedule,
            ...(typeof draft.estimatedMinutes === 'number'
              ? { estimatedMinutes: draft.estimatedMinutes }
              : {}),
          }),
        });
        toast.success(
          totalCount > 0
            ? `子任务已添加 · 父任务进度 ${Math.round((doneCount / totalCount) * 100)}% → ${Math.round((doneCount / (totalCount + 1)) * 100)}%`
            : '子任务已添加',
        );
        await reload();
      } catch (error) {
        console.warn('创建子任务失败', error);
        toast.error(formatWriteError(error, '子任务创建失败，请稍后重试。'));
        throw error;
      } finally {
        if (creatingSubtaskIdRef.current === draft.id) {
          creatingSubtaskIdRef.current = null;
        }
      }
    },
    [reload, subtasks, taskId],
  );

  const readPickParentTaskResult = React.useCallback(async () => {
    const payload = globalThis.__pickParentTaskResult as
      | { source: string; parentTaskId: string | null }
      | undefined;
    if (!payload || payload.source !== pickParentTaskSource) return;

    const childTask = taskSnapshotRef.current;
    if (!childTask) {
      toast.error('当前任务尚未加载完成，请稍后重试。');
      return;
    }

    const nextParentId = payload.parentTaskId;
    if ((childTask.parent_task_id ?? null) === nextParentId) {
      globalThis.__pickParentTaskResult = undefined;
      return;
    }

    globalThis.__pickParentTaskResult = undefined;

    try {
      await updateTask(taskId, { parent_task_id: nextParentId });
      await requestPush({ awaitSync: true, rethrow: true });

      if (nextParentId) {
        const parent = await getTaskById(nextParentId);
        setParentTask(parent ? mapTaskRowToSubtask(parent) : null);
        setParentDateLimit(extractScheduleLimitFromExtra(parent?.extra_data ?? null, parent?.due_date ?? null));

        const parentSchedule = (parseTaskExtraData(parent?.extra_data ?? null).schedule ?? null) as TaskScheduleMeta | null;
        const parentFrame = mergeDateLimit(scheduleMetaToDateLimit(parentSchedule), {
          end: toYmd(parent?.due_date ?? undefined) ?? undefined,
        });
        const tightenFrame = mergeDateLimit(parentFrame, projectDateLimit);
        await tightenDescendantTasksOf(nextParentId, tightenFrame);
      } else {
        setParentTask(null);
        setParentDateLimit({});
      }

      setTaskSnapshot((prev) => (prev ? { ...prev, parent_task_id: nextParentId } : prev));
      notifyPageDataChanged(PAGE_API_KEY);
      toast.success(nextParentId ? '父任务已关联' : '已移除父任务');
    } catch (error) {
      console.warn('关联父任务失败', error);
      toast.error(formatWriteError(error, '父任务关联失败，请稍后重试。'));
    }
  }, [pickParentTaskSource, projectDateLimit, taskId]);

  const loadTask = React.useCallback(async () => {
    if (!taskId) {
      setLoading(false);
      Alert.alert('参数缺失', '未找到任务 ID。');
      router.back();
      return;
    }

    setLoading(true);
    try {
      const task = await getTaskById(taskId);
      if (!task) {
        Alert.alert('任务不存在', '未找到对应任务，可能已被删除。');
        router.back();
        return;
      }
      if (isStandaloneTodoTask(task)) {
        router.replace(standaloneTodoEditorHref(taskId));
        return;
      }
      setTaskSnapshot(task);
      setLoadedFormSnapshot(buildFormSnapshotFromTask(task));
      setTitle(task.title ?? '');
      setEntityIcon(parseIconFromExtraData(task.extra_data, DEFAULT_TODO_ICON));
      setStatus(normalizeEditTaskStatus(task.status));
      setAcceptanceCriteria(resolveAcceptanceCriteria(task.description, task.note));
      setDeadlineText(task.due_date ? formatDate(task.due_date) : '');
      setScheduleMeta(null);
      const priorityLabel = fromTaskPriority(task.priority);
      setPriority(mapPriorityTextToKey(priorityLabel));
      const extraData = parseTaskExtraData(task.extra_data);
      const reminder = typeof extraData.reminder === 'string' ? extraData.reminder : '';
      const repeat = typeof extraData.repeat === 'string' ? extraData.repeat : '';
      const loadedSchedule = (extraData.schedule ?? null) as TaskScheduleMeta | null;
      if (loadedSchedule) {
        setScheduleMeta(loadedSchedule);
        setReminderText(formatTaskReminderLabel(loadedSchedule));
        setRepeatText(loadedSchedule.repeatOption === '不重复' ? '' : loadedSchedule.repeatSummary);
        setDeadlineText(buildDeadlineTextFromSchedule(loadedSchedule) || (task.due_date ? formatDate(task.due_date) : ''));
      } else {
        setReminderText(reminder);
        setRepeatText(repeat);
      }
      setBoundHabitIds(parseBoundHabitIdsFromExtraData(task.extra_data));
      setIsLongTermTask(getIsLongTermTask(task.extra_data));
      setAutoPlaceIntoSchedule(parseAutoPlaceIntoSchedule(task.extra_data));
      setRewardPointsText(String(parseRewardPointsFromExtraData(task.extra_data)));

      // 任务主体已加载完成，附属数据不应阻塞编辑操作。
      setLoading(false);

      if (!task.parent_task_id) {
        setTagsLoading(true);
        try {
          const tags = await getProjectTags();
          setAllTags(tags);
          setSelectedTagIds(await getTagIdsByEntity('task', taskId));
        } catch (tagErr) {
          console.warn('加载任务标签失败', tagErr);
          setAllTags([]);
          setSelectedTagIds([]);
        } finally {
          setTagsLoading(false);
        }
      } else {
        setAllTags([]);
        setSelectedTagIds([]);
      }

      try {
        setHabitsLoading(true);
        const [contexts, habits] = await Promise.all([getHabitContexts(), getHabits()]);
        const habitsByContext = new Map<string, HabitRow[]>();
        for (const habit of habits) {
          const list = habitsByContext.get(habit.context) ?? [];
          list.push(habit);
          habitsByContext.set(habit.context, list);
        }
        setHabitSections(
          contexts.map((ctx) => ({
            contextId: ctx.id,
            contextName: ctx.name,
            habits: habitsByContext.get(ctx.id) ?? [],
          })),
        );
      } catch (error) {
        console.warn('加载小习惯列表失败', error);
        setHabitSections([]);
      } finally {
        setHabitsLoading(false);
      }

      let parentLimit: DateLimitYmd = {};
      if (task.parent_task_id) {
        const parentRow = await getTaskById(task.parent_task_id);
        if (parentRow) {
          parentLimit = extractScheduleLimitFromExtra(parentRow.extra_data, parentRow.due_date);
          setParentTask(mapTaskRowToSubtask(parentRow));
        } else {
          setParentTask(null);
        }
      } else {
        setParentTask(null);
      }
      let projectLimit: DateLimitYmd = {};
      let inheritedPriorityLabel = '';
      let nextInheritsSchedule = false;
      let nextInheritsTags = false;
      let nextProjectSchedule: ScheduleMetaLike | null = null;
      if (task.project_id) {
        const project = await getProjectById(task.project_id);
        if (project) {
          setProjectName(project.name ?? '');
          projectLimit = extractScheduleLimitFromExtra(project.extra_data, project.due_date);
          nextInheritsSchedule = projectDefinesSchedule(project.extra_data, project.due_date);
          try {
            const parsed = project.extra_data
              ? (JSON.parse(project.extra_data) as { schedule?: ScheduleMetaLike })
              : {};
            nextProjectSchedule = parsed.schedule ?? null;
            if (!scheduleMetaHasConcreteDates(nextProjectSchedule) && nextInheritsSchedule) {
              nextProjectSchedule = resolveInheritedDefaultSchedule(null, projectLimit);
            }
          } catch {
            nextProjectSchedule = nextInheritsSchedule
              ? resolveInheritedDefaultSchedule(null, projectLimit)
              : null;
          }
          if (nextInheritsSchedule && nextProjectSchedule) {
            const applied = applyScheduleMetaToLabels(nextProjectSchedule);
            setDeadlineText(applied.deadlineText);
            setReminderText(applied.reminderText);
            setRepeatText(applied.repeatText);
            setScheduleMeta(applied.scheduleMeta as TaskScheduleMeta);
            setLoadedFormSnapshot((prev) =>
              prev
                ? {
                    ...prev,
                    deadlineText: applied.deadlineText,
                    reminderText: applied.reminderText,
                    repeatText: applied.repeatText,
                    scheduleMeta: applied.scheduleMeta as TaskScheduleMeta,
                  }
                : prev,
            );
          }
          inheritedPriorityLabel = fromTaskPriority(project.priority ?? 0);
          setPriority(mapPriorityTextToKey(inheritedPriorityLabel));
          setLoadedFormSnapshot((prev) =>
            prev
              ? {
                  ...prev,
                  status: normalizeEditTaskStatus(task.status),
                  priority: mapPriorityTextToKey(inheritedPriorityLabel),
                  acceptanceCriteria: resolveAcceptanceCriteria(task.description, task.note),
                }
              : prev,
          );
          try {
            const [projectTags, projectTagIds] = await Promise.all([
              getTagsByProjectId(task.project_id),
              getTagIdsByProjectId(task.project_id),
            ]);
            nextInheritsTags = projectTagIds.length > 0;
            if (nextInheritsTags) {
              setAllTags(projectTags);
              setSelectedTagIds(projectTagIds);
              setTagsLoading(false);
            } else if (task.parent_task_id) {
              setAllTags([]);
              setSelectedTagIds([]);
            }
          } catch (tagErr) {
            console.warn('加载项目标签失败', tagErr);
          }
        }
      }
      setProjectPriorityLabel(inheritedPriorityLabel);
      if (!task.project_id) setProjectName('');
      setParentDateLimit(parentLimit);
      setProjectDateLimit(projectLimit);
      setProjectScheduleMeta(nextProjectSchedule);
      setInheritsProjectSchedule(nextInheritsSchedule);
      setInheritsProjectTags(nextInheritsTags);

      // 子任务列表属于附属数据，失败或变慢不能阻塞主表单。
      void reload();
    } catch (error) {
      console.warn('加载任务详情失败', error);
      Alert.alert('加载失败', '无法读取任务详情，请稍后重试。');
      router.back();
    } finally {
      setLoading(false);
    }
  }, [reload, router, taskId]);

  React.useEffect(() => {
    loadTask();
  }, [loadTask]);

  React.useEffect(() => {
    readScheduleResult();
  }, [readScheduleResult]);

  useFocusEffect(
    React.useCallback(() => {
      const consumedSchedule = readScheduleResult();
      void readPickParentTaskResult();
      if (!consumedSchedule) {
        void reload();
      }
    }, [readPickParentTaskResult, readScheduleResult, reload])
  );

  const openEditSubtask = React.useCallback(
    (id: string) => {
      if (!id) return;
      router.push({ pathname: '/edit-task', params: { id } });
    },
    [router],
  );

  const persistTask = React.useCallback(async (): Promise<boolean> => {
    if (!taskId || loading || skipAutoSaveRef.current) return true;
    const trimmedTitle = titleRef.current.trim();
    if (!trimmedTitle) {
      Alert.alert('无法保存任务', '请输入任务名称后再离开。');
      return false;
    }
    const snapshot = taskSnapshotRef.current;
    if (!snapshot) return true;

    try {
      setSaving(true);

      let meta = scheduleMetaRef.current;
      let deadlineForDue = deadlineTextRef.current;
      let reminderForExtra = reminderTextRef.current;
      let repeatForExtra = repeatTextRef.current;
      let wantAutoPlace = autoPlaceIntoScheduleRef.current;
      if (wantAutoPlace) {
        const gate = canEnableAutoPlaceIntoSchedule(meta, repeatForExtra);
        if (!gate.ok) {
          Alert.alert(
            '无法保存任务',
            gate.reason === 'no-repeat'
              ? '自动入格需先设置重复规则。'
              : '自动入格需在日程中设置具体时间。',
          );
          return false;
        }
      }
      let nextInheritsSchedule = inheritsProjectSchedule;
      let nextInheritsTags = inheritsProjectTags;
      let forcedProjectSchedule = projectScheduleMeta;

      if (snapshot.project_id) {
        const project = await getProjectById(snapshot.project_id);
        if (project) {
          const projLimit = extractScheduleLimitFromExtra(project.extra_data, project.due_date);
          nextInheritsSchedule = projectDefinesSchedule(project.extra_data, project.due_date);
          try {
            const parsed = project.extra_data
              ? (JSON.parse(project.extra_data) as { schedule?: ScheduleMetaLike })
              : {};
            forcedProjectSchedule = parsed.schedule ?? null;
            if (!scheduleMetaHasConcreteDates(forcedProjectSchedule) && nextInheritsSchedule) {
              forcedProjectSchedule = resolveInheritedDefaultSchedule(null, projLimit);
            }
          } catch {
            forcedProjectSchedule = nextInheritsSchedule
              ? resolveInheritedDefaultSchedule(null, projLimit)
              : null;
          }
          if (nextInheritsSchedule && forcedProjectSchedule) {
            const applied = applyScheduleMetaToLabels(forcedProjectSchedule);
            meta = applied.scheduleMeta as TaskScheduleMeta;
            deadlineForDue = applied.deadlineText;
            reminderForExtra = applied.reminderText;
            repeatForExtra = applied.repeatText;
            setDeadlineText(applied.deadlineText);
            setReminderText(applied.reminderText);
            setRepeatText(applied.repeatText);
            setScheduleMeta(meta);
            setProjectScheduleMeta(forcedProjectSchedule);
            setInheritsProjectSchedule(true);
          } else {
            setInheritsProjectSchedule(false);
            setProjectScheduleMeta(null);
          }
          try {
            const projectTagIds = await getTagIdsByProjectId(snapshot.project_id);
            nextInheritsTags = projectTagIds.length > 0;
            setInheritsProjectTags(nextInheritsTags);
            if (nextInheritsTags) {
              const projectTags = await getTagsByProjectId(snapshot.project_id);
              setAllTags(projectTags);
              setSelectedTagIds(projectTagIds);
            }
          } catch {
            /* ignore */
          }
        }
      }

      const dueDate = dueDateFromScheduleMeta(meta, extractDueDateFromDeadlineText(deadlineForDue));
      const parsedExtra = parseTaskExtraData(snapshot.extra_data);
      delete (parsedExtra as Record<string, unknown>).completion_reward;
      if (wantAutoPlace) {
        parsedExtra.autoPlaceIntoSchedule = true;
      } else {
        delete parsedExtra.autoPlaceIntoSchedule;
      }
      const mergedExtra = mergeIconIntoExtraData(
        mergeRewardPointsIntoExtraData(
          mergeLongTermTaskIntoExtraData(
            mergeBoundHabitIdsIntoExtraData(
              JSON.stringify({
                ...parsedExtra,
                reminder: reminderForExtra,
                repeat: repeatForExtra,
                schedule: meta,
              }),
              boundHabitIdsRef.current,
            ),
            isLongTermTaskRef.current,
          ),
          normalizeRewardPoints(rewardPointsTextRef.current),
        ),
        entityIconRef.current,
        DEFAULT_TODO_ICON,
      );
      const acceptance = acceptanceCriteriaRef.current.trim() || null;
      const nextStatus = statusRef.current;
      let nextPriority = toTaskPriority(priorityKeyToLabel(priorityRef.current));
      if (snapshot.project_id) {
        const project = await getProjectById(snapshot.project_id);
        if (project) {
          nextPriority = project.priority ?? 0;
          const label = fromTaskPriority(nextPriority);
          setProjectPriorityLabel(label);
          setPriority(mapPriorityTextToKey(label));
        }
      }
      const nextCompletedAt =
        nextStatus === 'done'
          ? snapshot.completed_at
          : snapshot.status === 'done'
            ? null
            : undefined;
      await updateTask(taskId, {
        title: trimmedTitle,
        description: acceptance,
        note: null,
        status: nextStatus,
        priority: nextPriority,
        due_date: dueDate,
        completed_at: nextCompletedAt,
        extra_data: mergedExtra,
      });
      if (!snapshot.parent_task_id) {
        // 项目已贴标签 → 清空任务自有标签；否则保存任务标签
        await setTaskTagIds(taskId, nextInheritsTags ? [] : selectedTagIdsRef.current);
        await markPendingTablesDirty(['tasks', 'tags', 'tag_links']);
      }
      const parentFrame = mergeDateLimit(scheduleMetaToDateLimit(meta), {
        end: toYmd(dueDate ?? undefined) ?? undefined,
      });
      const tightenFrame = mergeDateLimit(parentFrame, projectDateLimit);
      // 项目已设日程时子任务已随项目继承，不必再按本任务框架收紧
      if (!nextInheritsSchedule) {
        await tightenDescendantTasksOf(taskId, tightenFrame);
      }
      await requestPush({ awaitSync: true, rethrow: true });

      const nextSnapshot = buildFormSnapshotFromFields({
        title: trimmedTitle,
        entityIcon: entityIconRef.current,
        status: nextStatus,
        acceptanceCriteria: acceptanceCriteriaRef.current,
        priority: mapPriorityTextToKey(fromTaskPriority(nextPriority)),
        deadlineText: deadlineForDue,
        reminderText: reminderForExtra,
        repeatText: repeatForExtra,
        scheduleMeta: meta,
        boundHabitIds: boundHabitIdsRef.current,
        isLongTermTask: isLongTermTaskRef.current,
        autoPlaceIntoSchedule: wantAutoPlace,
        rewardPointsText: rewardPointsTextRef.current,
      });
      setLoadedFormSnapshot(nextSnapshot);
      if (boundHabitIdsRef.current.length > 0) {
        try {
          await tryCompleteTaskByBoundHabits(taskId);
        } catch (syncErr) {
          console.warn('同步习惯绑定任务完成状态失败', syncErr);
        }
      }
      setTaskSnapshot((prev) =>
        prev
          ? {
              ...prev,
              title: trimmedTitle,
              description: acceptance,
              note: null,
              status: nextStatus,
              priority: nextPriority,
              due_date: dueDate,
              completed_at:
                nextCompletedAt !== undefined ? nextCompletedAt : prev.completed_at,
              extra_data: mergedExtra,
            }
          : prev,
      );
      return true;
    } catch (error) {
      console.warn('更新任务失败', error);
      const detail = formatWriteError(error, '任务保存失败，请稍后重试。');
      const syncHint = /同步|服务器|网络|登录/i.test(detail)
        ? detail
        : `${detail} 若仅本机已保存，请检查网络与登录状态后重试。`;
      toast.error(syncHint);
      return false;
    } finally {
      setSaving(false);
    }
  }, [inheritsProjectSchedule, inheritsProjectTags, loading, projectDateLimit, projectScheduleMeta, taskId]);

  /** 从详情→编辑离开（保存或删除）时跳过详情页，直接回到任务 Tab */
  const navigateAfterLeaveEdit = React.useCallback(() => {
    if (openedFromTaskDetail) {
      router.dismissTo('/(tabs)/tasks');
    } else {
      router.back();
    }
  }, [openedFromTaskDetail, router]);

  const performLeave = React.useCallback(
    (leaveAction?: () => void) => {
      if (exitingAfterSaveRef.current || saving) return;
      exitingAfterSaveRef.current = true;
      setSkipRemoveGuard(true);
      if (leaveAction) leaveAction();
      else navigateAfterLeaveEdit();
    },
    [navigateAfterLeaveEdit, saving],
  );

  const handleSavePress = React.useCallback(() => {
    if (saving || loading) return;
    void (async () => {
      const ok = await persistTask();
      if (!ok) return;
      toast.success('已保存');
      performLeave();
    })();
  }, [loading, performLeave, persistTask, saving]);

  const promptUnsavedChanges = React.useCallback(
    (onLeave: () => void) => {
      Alert.alert('未保存的更改', '是否保存本次修改？', [
        { text: '取消', style: 'cancel' },
        { text: '不保存', style: 'destructive', onPress: onLeave },
        {
          text: '保存',
          onPress: () =>
            void (async () => {
              const ok = await persistTask();
              if (!ok) return;
              onLeave();
            })(),
        },
      ]);
    },
    [persistTask],
  );

  const handleBackPress = React.useCallback(() => {
    if (saving || loading) return;
    if (!isDirty) {
      performLeave();
      return;
    }
    promptUnsavedChanges(() => performLeave());
  }, [isDirty, loading, performLeave, promptUnsavedChanges, saving]);

  const preventRemove =
    isFocused &&
    isDirty &&
    !loading &&
    !skipRemoveGuard &&
    !skipAutoSaveRef.current &&
    !exitingAfterSaveRef.current;

  usePreventRemove(preventRemove, ({ data }) => {
    promptUnsavedChanges(() =>
      performLeave(() => {
        if (openedFromTaskDetail) {
          router.dismissTo('/(tabs)/tasks');
        } else {
          navigation.dispatch(data.action);
        }
      }),
    );
  });

  const navigateAfterDeleteTask = navigateAfterLeaveEdit;

  const removeTask = React.useCallback(() => {
    if (!taskId || saving || loading) return;
    (async () => {
      try {
        const incomplete = await countIncompleteDescendantTasks(taskId);
        const message =
          incomplete > 0
            ? `该任务下有 ${incomplete} 个未完成子任务。\n\n确认删除该任务，并连同其所有子任务一起删除吗？（删除后在同步或恢复功能前无法找回）`
            : '删除后在同步或恢复功能前无法找回，确认删除吗？';

        Alert.alert('删除任务', message, [
          { text: '取消', style: 'cancel' },
          {
            text: '删除',
            style: 'destructive',
            onPress: async () => {
              try {
                skipAutoSaveRef.current = true;
                setSkipRemoveGuard(true);
                setSaving(true);
                await deleteTask(taskId);
                notifyPageDataChanged(PAGE_API_KEY);
                toast.success('已删除');
                navigateAfterDeleteTask();
              } catch (error) {
                console.warn('删除任务失败', error);
                toast.error(formatWriteError(error, '任务删除失败，请稍后重试。'));
              } finally {
                setSaving(false);
              }
            },
          },
        ]);
      } catch (error) {
        console.warn('统计子任务失败', error);
        Alert.alert('删除任务', '删除后在同步或恢复功能前无法找回，确认删除吗？', [
          { text: '取消', style: 'cancel' },
          {
            text: '删除',
            style: 'destructive',
            onPress: async () => {
              try {
                skipAutoSaveRef.current = true;
                setSkipRemoveGuard(true);
                setSaving(true);
                await deleteTask(taskId);
                notifyPageDataChanged(PAGE_API_KEY);
                toast.success('已删除');
                navigateAfterDeleteTask();
              } catch (err) {
                console.warn('删除任务失败', err);
                toast.error(formatWriteError(err, '任务删除失败，请稍后重试。'));
              } finally {
                setSaving(false);
              }
            },
          },
        ]);
      }
    })();
  }, [loading, navigateAfterDeleteTask, saving, taskId]);

  const footPad = Math.max(insets.bottom, 12);
  const formBusy = saving || loading;
  const frowBorder = {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(232,224,210,0.52)',
  } as const;
  const projectScheduleHint = inheritsProjectSchedule
    ? deadlineText || (projectDateLimit.end ? `日程继承 ${projectDateLimit.end}` : '继承项目日程')
    : '';

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: tf.paper }]} edges={['left', 'right']}>
      <ComposerTopBar
        title={loading ? '加载中' : '编辑任务'}
        subtitle="修改会影响项目进度与自动入格"
        onBack={handleBackPress}
        onSubmit={handleSavePress}
        submitting={formBusy}
        submitLabel="保存"
      />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView
          refreshControl={refreshControl}
          contentContainerStyle={[styles.foldContent, { paddingBottom: 96 + footPad }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          {loading && !taskSnapshot ? (
            <View style={styles.editLoading}>
              <ActivityIndicator size="large" color={tf.frog} />
              <Text style={[styles.loadingText, { color: tf.faint }]}>加载任务…</Text>
            </View>
          ) : (
            <>
              <Animated.View
                pointerEvents={isDirty ? 'auto' : 'none'}
                style={[
                  styles.dirtyBar,
                  {
                    opacity: dirtyOpacity,
                    backgroundColor: isDark ? tf.amber2 : '#F8ECD7',
                    borderColor: isDark ? tf.scoreBorder : '#E8CDA2',
                  },
                ]}>
                <View style={[styles.dirtyDot, { backgroundColor: tf.amber }]} />
                <Text style={[styles.dirtyText, { color: tf.amberInk }]}>有未保存的修改 · 返回会询问</Text>
              </Animated.View>

              <FoldRiseIn animate={foldAnimate} index={0} duration={520} staggerMs={42} fromY={10} holdHidden={foldAnimate}>
                <View style={[styles.fcard, { backgroundColor: foldCardBg, borderColor: foldCardBorder }]}>
                  <View style={styles.titleRow}>
                    <EntityIconPickerField
                      compact
                      value={entityIcon}
                      onChange={setEntityIcon}
                      fallback={DEFAULT_TODO_ICON}
                      disabled={formBusy}
                      accessibilityLabel="选择任务图标"
                    />
                    <View style={{ flex: 1 }}>
                      <TextInput
                        value={title}
                        onChangeText={(t) => setTitle(t.slice(0, TITLE_MAX_LENGTH))}
                        placeholder="任务名称"
                        placeholderTextColor={tf.faint}
                        maxLength={TITLE_MAX_LENGTH}
                        multiline
                        editable={!loading}
                        style={[
                          styles.foldTitleInput,
                          { color: tf.ink, fontFamily: fonts.serif, opacity: loading ? 0.65 : 1 },
                        ]}
                      />
                      <Text style={[styles.charCounter, { color: tf.faint }]}>
                        {title.length}/{TITLE_MAX_LENGTH}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.foldChipRow}>
                    {STATUS_CHIPS.map((chip) => {
                      const active = status === chip.key;
                      return (
                        <Pressable
                          key={chip.key}
                          onPress={() => setStatus(chip.key)}
                          disabled={loading}
                          accessibilityRole="button"
                          accessibilityState={{ selected: active }}
                          style={[
                            styles.fchip,
                            active && { backgroundColor: tf.pond, borderColor: tf.pond },
                            loading && { opacity: 0.65 },
                          ]}>
                          <Text
                            style={[
                              styles.fchipText,
                              { color: active ? tf.onPond : '#7C897E' },
                            ]}>
                            {chip.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                    {status === 'done' ? (
                      <View style={[styles.fchip, { backgroundColor: tf.lily2, borderColor: tf.lily }]}>
                        <Text style={[styles.fchipText, { color: tf.frog }]}>已完成</Text>
                      </View>
                    ) : null}
                  </View>
                </View>
              </FoldRiseIn>

              <FoldRiseIn animate={foldAnimate} index={1} duration={520} staggerMs={42} fromY={10} holdHidden={foldAnimate}>
                <View
                  style={[
                    styles.fcard,
                    styles.fcardTight,
                    { backgroundColor: foldCardBg, borderColor: foldCardBorder },
                  ]}>
                  <Pressable
                    onPress={() =>
                      router.push({
                        pathname: '/pick-parent-task',
                        params: {
                          taskId,
                          source: pickParentTaskSource,
                          currentParentId: parentTask?.id ?? taskSnapshot?.parent_task_id ?? '',
                        },
                      })
                    }
                    disabled={loading}
                    style={({ pressed }) => [
                      styles.frow,
                      { opacity: loading ? 0.65 : pressed ? 0.88 : 1 },
                    ]}>
                    <Text style={[styles.frowLab, { color: '#8A968C' }]}>父任务</Text>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      {parentTask ? (
                        <>
                          <Text style={[styles.frowValBold, { color: tf.ink2 }]} numberOfLines={1}>
                            {parentTask.title}
                          </Text>
                          {parentTask.deadline || parentTask.deadlineText ? (
                            <Text style={{ fontSize: 10, color: tf.faint, marginTop: 1 }} numberOfLines={1}>
                              {parentTask.deadline || parentTask.deadlineText}
                            </Text>
                          ) : null}
                        </>
                      ) : (
                        <Text style={[styles.frowVal, { color: tf.faint }]}>未关联 · 可选</Text>
                      )}
                    </View>
                    <Text style={{ fontSize: 11, color: '#6F856B' }}>选择 ›</Text>
                  </Pressable>
                  <View style={[styles.frow, frowBorder]}>
                    <Text style={[styles.frowLab, { color: '#8A968C' }]}>项目</Text>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={[styles.frowValBold, { color: tf.ink2 }]} numberOfLines={1}>
                        {projectName || '未关联项目'}
                      </Text>
                      {projectScheduleHint ? (
                        <Text style={{ fontSize: 10, color: tf.faint, marginTop: 1 }} numberOfLines={1}>
                          {projectScheduleHint}
                        </Text>
                      ) : null}
                    </View>
                    <MaterialIcons name="lock-outline" size={14} color="#A4ADA3" />
                  </View>
                </View>
              </FoldRiseIn>

              <FoldRiseIn animate={foldAnimate} index={2} duration={520} staggerMs={42} fromY={10} holdHidden={foldAnimate}>
                <View style={[styles.fcard, { backgroundColor: foldCardBg, borderColor: foldCardBorder }]}>
                  {inheritsProjectPriority ? (
                    <>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                        <Text style={{ fontSize: 12, fontWeight: '800', color: '#5B6A5D' }}>优先级</Text>
                        <Text style={{ fontSize: 10, color: tf.faint, flex: 1 }}>与项目一致，不可单独改判</Text>
                      </View>
                      <View style={[styles.frow, { minHeight: 32 }]}>
                        <Text style={[styles.frowValBold, { color: tf.ink2, flex: 1 }]}>
                          {projectPriorityLabel || priorityKeyToLabel(priority) || '未设置'}
                        </Text>
                        <MaterialIcons name="lock-outline" size={14} color="#A4ADA3" />
                      </View>
                    </>
                  ) : (
                    <TaskFoldPriorityGrid
                      value={priority}
                      onChange={setPriority}
                      subtitle="改判后本周四象限同步移动"
                    />
                  )}
                </View>
              </FoldRiseIn>

              <FoldRiseIn animate={foldAnimate} index={3} duration={520} staggerMs={42} fromY={10} holdHidden={foldAnimate}>
                <View
                  style={[
                    styles.fcard,
                    styles.fcardTight,
                    { backgroundColor: foldCardBg, borderColor: foldCardBorder },
                  ]}>
                  <Pressable
                    onPress={openSchedulePicker}
                    disabled={loading || inheritsProjectSchedule}
                    accessibilityRole="button"
                    accessibilityLabel="修改日程"
                    style={({ pressed }) => [
                      styles.calendarbtn,
                      {
                        borderColor: 'rgba(216,205,187,0.8)',
                        backgroundColor: isDark ? colors.input : 'rgba(255,255,255,0.55)',
                        opacity: loading ? 0.65 : pressed && !inheritsProjectSchedule ? 0.88 : 1,
                      },
                    ]}>
                    <View style={[styles.calic, { backgroundColor: tf.lily2 }]}>
                      <MaterialIcons name="event" size={16} color="#64805D" />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={[styles.calMain, { color: '#59685E' }]} numberOfLines={1}>
                        {deadlineText || '设置日期 / 时间'}
                      </Text>
                      <Text style={[styles.calSub, { color: tf.faint }]} numberOfLines={1}>
                        {[reminderText, repeatText].filter(Boolean).join(' · ') ||
                          (inheritsProjectSchedule ? '继承项目日程' : '提醒 / 重复可选')}
                      </Text>
                    </View>
                    {inheritsProjectSchedule ? (
                      <MaterialIcons name="lock-outline" size={14} color="#A4ADA3" />
                    ) : (
                      <Text style={{ fontSize: 11, color: '#8C998E' }}>修改 ›</Text>
                    )}
                  </Pressable>

                  <View style={styles.frow}>
                    <Text style={[styles.frowLab, { color: '#8A968C' }]}>自动入格</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 11, color: tf.faint }}>
                        {autoPlaceGate.ok
                          ? autoPlaceIntoSchedule
                            ? '重复 + 具体时间已满足 · 当前已占用'
                            : '重复 + 具体时间已满足'
                          : '需同时有重复与具体时间'}
                      </Text>
                    </View>
                    <TaskFoldSwitch
                      value={autoPlaceIntoSchedule}
                      onValueChange={() => toggleAutoPlaceIntoSchedule()}
                      disabled={loading}
                      bounceToken={switchBounceToken}
                      accessibilityLabel="自动入格"
                    />
                  </View>

                  {showTagField ? (
                    <View style={[styles.frow, frowBorder, { alignItems: 'flex-start', paddingVertical: 6 }]}>
                      <Text style={[styles.frowLab, { color: '#8A968C', marginTop: 6 }]}>标签</Text>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <ProjectTagPickerField
                          selectedIds={selectedTagIds}
                          allTags={allTags}
                          loading={tagsLoading}
                          disabled={loading}
                          locked={inheritsProjectTags}
                          onChange={setSelectedTagIds}
                          textColor={tf.ink2}
                          outline={tf.muted}
                          placeholderColor={tf.faint}
                          primary={tf.frog}
                          surfaceLow={isDark ? colors.input : '#F1EDE1'}
                          surfaceLowest={isDark ? colors.surfaceSubtle : '#FFFCF5'}
                          isDark={isDark}
                        />
                      </View>
                      {inheritsProjectTags ? (
                        <MaterialIcons name="lock-outline" size={14} color="#A4ADA3" style={{ marginTop: 8 }} />
                      ) : null}
                    </View>
                  ) : null}

                  <View style={[styles.frow, frowBorder]}>
                    <Text style={[styles.frowLab, { color: '#8A968C' }]}>奖励积分</Text>
                    <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <Text style={{ fontSize: 14, fontWeight: '700', color: tf.ink2, fontFamily: fonts.mono }}>
                        {rewardN > 0 ? `+${rewardN}` : String(rewardN)}
                      </Text>
                    </View>
                    <View style={styles.stepper}>
                      <Pressable
                        onPress={() => bumpReward(-1)}
                        disabled={loading}
                        style={styles.stepperBtn}
                        accessibilityLabel="减少积分">
                        <Text style={{ color: '#6F7D72', fontWeight: '700' }}>−</Text>
                      </Pressable>
                      <Text
                        style={{
                          fontFamily: fonts.mono,
                          color: '#5C6D60',
                          minWidth: 18,
                          textAlign: 'center',
                        }}>
                        {rewardN}
                      </Text>
                      <Pressable
                        onPress={() => bumpReward(1)}
                        disabled={loading}
                        style={styles.stepperBtn}
                        accessibilityLabel="增加积分">
                        <Text style={{ color: '#6F7D72', fontWeight: '700' }}>+</Text>
                      </Pressable>
                    </View>
                  </View>

                  <View style={[styles.frow, frowBorder]}>
                    <Text style={[styles.frowLab, { color: '#8A968C' }]}>验收标准</Text>
                    <TextInput
                      value={acceptanceCriteria}
                      onChangeText={setAcceptanceCriteria}
                      placeholder="怎样算完成？（可选）"
                      placeholderTextColor={tf.faint}
                      editable={!loading}
                      style={[styles.frowInput, { color: tf.ink2, flex: 1, opacity: loading ? 0.65 : 1 }]}
                    />
                  </View>

                  <View style={[styles.frow, frowBorder, { opacity: loading ? 0.65 : 1 }]}>
                    <Text style={[styles.frowLab, { color: '#8A968C' }]}>长期任务</Text>
                    <Text style={{ flex: 1, fontSize: 11, color: tf.faint }}>完成时确认是否结束整项</Text>
                    <TaskFoldSwitch
                      value={isLongTermTask}
                      onValueChange={setIsLongTermTask}
                      disabled={loading}
                      accessibilityLabel="长期任务"
                    />
                  </View>

                  <View style={[styles.frow, frowBorder, { alignItems: 'flex-start', paddingVertical: 6 }]}>
                    <Text style={[styles.frowLab, { color: '#8A968C', marginTop: 6 }]}>绑定习惯</Text>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <BoundHabitPickerField
                        selectedHabitIds={boundHabitIds}
                        sections={habitSections}
                        loading={habitsLoading}
                        disabled={loading}
                        onChange={setBoundHabitIds}
                        textColor={tf.ink2}
                        outline={tf.muted}
                        placeholderColor={tf.faint}
                        primary={tf.frog}
                        surfaceLow={isDark ? colors.input : '#F1EDE1'}
                        surfaceLowest={isDark ? colors.surfaceSubtle : '#FFFCF5'}
                        isDark={isDark}
                      />
                    </View>
                  </View>
                </View>
              </FoldRiseIn>

              <FoldRiseIn animate={foldAnimate} index={4} duration={520} staggerMs={42} fromY={10} holdHidden={foldAnimate}>
                <View
                  style={[
                    styles.fcard,
                    styles.fcardTight,
                    { backgroundColor: foldCardBg, borderColor: foldCardBorder },
                  ]}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                    <Text style={{ fontSize: 12, fontWeight: '800', color: '#5B6A5D' }}>子任务</Text>
                    <Text style={{ fontSize: 10, color: '#9AA49B' }}>
                      {subtasks.length > 0 ? `${incompleteSubtaskCount} 未完成` : '可拆成更小步骤'}
                    </Text>
                    <Pressable
                      onPress={() => setAddSubtaskOpen(true)}
                      disabled={loading}
                      hitSlop={8}
                      style={{ marginLeft: 'auto', opacity: loading ? 0.55 : 1 }}>
                      <Text style={{ fontSize: 11, color: '#6F856B', fontWeight: '600' }}>＋ 新建</Text>
                    </Pressable>
                  </View>

                  {subtasks.map((s) => {
                    const tp = priorityShortLabel(s.priority || s.priorityLabel);
                    return (
                      <Pressable
                        key={s.id}
                        onPress={() => openEditSubtask(s.id)}
                        style={({ pressed }) => [styles.trow, { opacity: pressed ? 0.86 : 1 }]}>
                        <View
                          style={[
                            styles.cb,
                            {
                              borderColor: s.done ? tf.frog : '#C8D1C0',
                              backgroundColor: s.done ? tf.frog : 'rgba(255,255,255,0.5)',
                            },
                          ]}>
                          {s.done ? <MaterialIcons name="check" size={10} color={tf.onPond} /> : null}
                        </View>
                        <Text
                          style={[
                            styles.tn,
                            {
                              color: s.done ? '#A8AFA6' : tf.ink2,
                              textDecorationLine: s.done ? 'line-through' : 'none',
                            },
                          ]}
                          numberOfLines={1}>
                          {s.title}
                        </Text>
                        {tp ? (
                          <Text style={[styles.tp, { color: tf.faint, fontFamily: fonts.mono }]}>{tp}</Text>
                        ) : null}
                      </Pressable>
                    );
                  })}

                  {subtasks.length === 0 ? (
                    <View style={[styles.emptySubtaskRow, { borderColor: foldCardBorder }]}>
                      <MaterialIcons name="playlist-add-check" size={16} color={tf.faint} />
                      <Text style={{ fontSize: 12, color: tf.faint, flex: 1 }}>暂无子任务</Text>
                    </View>
                  ) : null}
                </View>
              </FoldRiseIn>

              <FoldRiseIn animate={foldAnimate} index={5} duration={520} staggerMs={42} fromY={10} holdHidden={foldAnimate}>
                <Pressable
                  onPress={removeTask}
                  disabled={formBusy}
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.deleteGhost,
                    {
                      borderColor: isDark ? 'rgba(224,139,109,0.45)' : '#E2C5B9',
                      backgroundColor: isDark ? tf.clay2 : 'rgba(247,230,222,0.5)',
                      opacity: formBusy ? 0.55 : pressed ? 0.82 : 1,
                    },
                  ]}>
                  <MaterialIcons name="delete-outline" size={16} color={isDark ? tf.clay : '#A56547'} />
                  <Text style={[styles.deleteGhostText, { color: isDark ? tf.clay : '#A56547' }]}>
                    删除任务
                  </Text>
                </Pressable>
              </FoldRiseIn>
            </>
          )}
        </ScrollView>

        <View style={[styles.foldFoot, { paddingBottom: footPad }]}>
          <Pressable
            onPress={handleSavePress}
            disabled={formBusy}
            style={({ pressed }) => [
              styles.foldPrimary,
              {
                backgroundColor: tf.pond,
                opacity: formBusy ? 0.65 : pressed ? 0.9 : 1,
              },
            ]}>
            {saving ? (
              <ActivityIndicator color={tf.onPond} />
            ) : (
              <>
                <MaterialIcons name="check" size={16} color={tf.onPond} />
                <Text style={[styles.foldPrimaryText, { color: tf.onPond }]}>保存修改</Text>
              </>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      <AddSubtaskSheet
        visible={addSubtaskOpen}
        onClose={() => setAddSubtaskOpen(false)}
        onSubmit={createSubtaskFromDraft}
        parentTitle={title}
        parentPriority={taskSnapshot?.priority ?? 0}
        progressDone={subtasks.filter((s) => s.done).length}
        progressTotal={subtasks.length}
        dateLimit={subtaskDateLimit}
        defaultSchedule={inheritedSubtaskSchedule}
        lockSchedule={inheritsProjectSchedule}
        scheduleSource={addSubtaskSource}
      />
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
  editLoading: {
    paddingVertical: 48,
    alignItems: 'center',
    gap: 12,
  },
  loadingText: { fontSize: 13, fontWeight: '500' },
  dirtyBar: {
    height: 28,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginBottom: 2,
  },
  dirtyDot: { width: 6, height: 6, borderRadius: 3 },
  dirtyText: { fontSize: 11, fontWeight: '600' },
  fcard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 10,
    marginBottom: 0,
  },
  fcardTight: { paddingVertical: 8 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  foldTitleInput: {
    padding: 0,
    fontSize: 18,
    fontWeight: '600',
    lineHeight: 24,
    minHeight: 40,
  },
  charCounter: { alignSelf: 'flex-end', fontSize: 11, fontWeight: '500' },
  foldChipRow: { flexDirection: 'row', gap: 6, marginTop: 8, flexWrap: 'wrap' },
  fchip: {
    height: 28,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: '#F1EDE1',
    borderWidth: 1,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fchipText: { fontSize: 12, fontWeight: '600' },
  calendarbtn: {
    height: 44,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    marginBottom: 6,
  },
  calic: {
    width: 26,
    height: 26,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  calMain: { fontSize: 13, fontWeight: '600' },
  calSub: { fontSize: 10, marginTop: 2 },
  frow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 36,
  },
  frowLab: { width: 64, fontSize: 12, flexShrink: 0 },
  frowVal: { flex: 1, fontSize: 13, fontWeight: '600' },
  frowValBold: { fontSize: 13, fontWeight: '700' },
  frowInput: { fontSize: 13, paddingVertical: 4, paddingHorizontal: 0 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepperBtn: {
    width: 22,
    height: 22,
    borderRadius: 6,
    backgroundColor: '#F0EBDE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  trow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 7,
    paddingHorizontal: 2,
  },
  cb: {
    width: 16,
    height: 16,
    borderRadius: 5,
    borderWidth: 1.2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tn: { flex: 1, fontSize: 13, fontWeight: '600', lineHeight: 18 },
  tp: { fontSize: 10, fontWeight: '600' },
  emptySubtaskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: 'dashed',
  },
  deleteGhost: {
    width: '100%',
    marginTop: 2,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  deleteGhostText: { fontSize: 13, fontWeight: '600' },
  foldFoot: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 14,
    paddingTop: 10,
  },
  foldPrimary: {
    height: 46,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  foldPrimaryText: { fontSize: 14, fontWeight: '700' },
});
