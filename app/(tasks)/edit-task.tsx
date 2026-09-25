import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { usePageApiSync, usePagePullRefresh } from '@/hooks/use-page-api-sync';
import {
  buildDeadlineTextFromSchedule,
  dueDateFromScheduleMeta,
  extractScheduleLimitFromExtra,
  formatDate,
  formatTime,
  mergeDateLimit,
  resolveInheritedDefaultSchedule,
  scheduleMetaToDateLimit,
  toYmd,
  type DateLimitYmd,
} from '@/lib/schedule-inherit';
import { pushLocalChangesToApi } from '@/lib/api-write-sync';
import { formatWriteError } from '@/lib/format-write-error';
import { notifyAncestorPagesLocalReload } from '@/lib/page-api-session';
import { tightenDescendantTasksOf } from '@/lib/tighten-task-schedules';
import { consumeSchedulePickerResult, normalizeRouteParam } from '@/lib/schedule-picker-bridge';
import { formatTaskReminderLabel, type TaskReminderOption } from '@/lib/task-reminder-schedule';
import { getProjectById } from '@/lib/repositories/projects/project';
import {
  countIncompleteDescendantTasks,
  createTask,
  deleteTask,
  getChildTasksByParentTaskId,
  getTaskById,
  updateTask,
} from '@/lib/repositories/tasks/task';
import type { TaskPriority, TaskRow } from '@/lib/repositories/tasks/task.types';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect, useIsFocused, useNavigation, usePreventRemove } from "expo-router/react-navigation";
import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import {
  Alert,
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
import { isStandaloneTodoTask, standaloneTodoEditorHref } from '@/lib/standalone-todo-task';
import { BoundHabitPickerField } from '@/components/tasks/BoundHabitPickerField';
import { ProjectTagPickerField } from '@/components/projects/ProjectTagPickerField';
import {
  getTagIdsByEntity,
  getTags,
  setTaskTagIds,
} from '@/lib/repositories/tags/tag';
import type { TagRow } from '@/lib/repositories/tags/tag.types';
import { markPendingTablesDirty } from '@/lib/api-incremental-sync';
import {
  mergeRewardPointsIntoExtraData,
  normalizeRewardPoints,
  parseRewardPointsFromExtraData,
} from '@/lib/reward-points';
import { getHabits } from '@/lib/repositories/habits/habit';
import { getHabitContexts } from '@/lib/repositories/habits/habit-context';
import type { HabitRow } from '@/lib/repositories/habits/habit.types';
import {
  mergeBoundHabitIdsIntoExtraData,
  parseBoundHabitIdsFromExtraData,
  tryCompleteTaskByBoundHabits,
} from '@/lib/repositories/tasks/task-habit-binding';
import { getIsLongTermTask, mergeLongTermTaskIntoExtraData } from '@/lib/long-term-task';
import { resolveAcceptanceCriteria } from '@/lib/acceptance-criteria';

type PriorityKey =
  | 'urgent-important'
  | 'urgent-not-important'
  | 'not-urgent-important'
  | 'not-urgent-not-important';

type SchedulePickerResult = {
  mode: 'date' | 'time';
  source: string;
  quickChip: string;
  allDay: boolean;
  hasExactTime: boolean;
  reminderOption: TaskReminderOption;
  repeatOption: '不重复' | '每天' | '每周' | '每月' | '每年';
  repeatSummary: string;
  weeklyDays: number[];
  monthlyDays: number[];
  yearlyDate: string;
  date?: string;
  range?: { start: string; end: string };
  startTime: string;
  endTime: string;
};

type SchedulePickerInitPayload = {
  mode?: 'date' | 'time';
  quickChip?: string;
  allDay?: boolean;
  hasExactTime?: boolean;
  reminderOption?: TaskReminderOption;
  repeatOption?: '不重复' | '每天' | '每周' | '每月' | '每年';
  repeatSummary?: string;
  weeklyDays?: number[];
  monthlyDays?: number[];
  yearlyDate?: string;
  date?: string;
  range?: { start: string; end: string };
  startTime?: string;
  endTime?: string;
};

type TaskScheduleMeta = Pick<
  SchedulePickerResult,
  | 'mode'
  | 'allDay'
  | 'hasExactTime'
  | 'reminderOption'
  | 'reminderHour'
  | 'reminderMinute'
  | 'repeatOption'
  | 'repeatSummary'
  | 'weeklyDays'
  | 'monthlyDays'
  | 'yearlyDate'
  | 'date'
  | 'range'
  | 'startTime'
  | 'endTime'
>;

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
  note?: string;
  schedule?: TaskScheduleMeta | null;
};

function extractDueDate(deadlineText: string) {
  const all = deadlineText.match(/\d{4}-\d{2}-\d{2}/g);
  if (!all?.length) return null;
  return all[all.length - 1] ?? null;
}

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

function getPriorityColor(priorityText: string, isDark: boolean) {
  const value = priorityText.trim();
  if (!value) {
    return {
      tint: isDark ? '#94a3b8' : '#727785',
      bg: isDark ? 'rgba(148,163,184,0.18)' : 'rgba(114,119,133,0.12)',
      border: isDark ? 'rgba(148,163,184,0.34)' : 'rgba(114,119,133,0.25)',
    };
  }

  if (value.includes('不紧急不重要')) {
    return {
      tint: isDark ? '#94a3b8' : '#727785',
      bg: isDark ? 'rgba(148,163,184,0.18)' : 'rgba(114,119,133,0.12)',
      border: isDark ? 'rgba(148,163,184,0.34)' : 'rgba(114,119,133,0.25)',
    };
  }

  if (value.includes('不紧急重要')) {
    return {
      tint: isDark ? '#60a5fa' : '#0058be',
      bg: isDark ? 'rgba(96,165,250,0.2)' : 'rgba(0,88,190,0.1)',
      border: isDark ? 'rgba(96,165,250,0.4)' : 'rgba(0,88,190,0.24)',
    };
  }

  if (value.includes('紧急不重要')) {
    return {
      tint: isDark ? '#fbbf24' : '#9a5b00',
      bg: isDark ? 'rgba(251,191,36,0.2)' : 'rgba(154,91,0,0.1)',
      border: isDark ? 'rgba(251,191,36,0.42)' : 'rgba(154,91,0,0.24)',
    };
  }

  if (value.includes('紧急重要')) {
    return {
      tint: isDark ? '#f87171' : '#ba1a1a',
      bg: isDark ? 'rgba(248,113,113,0.18)' : 'rgba(186,26,26,0.1)',
      border: isDark ? 'rgba(248,113,113,0.4)' : 'rgba(186,26,26,0.25)',
    };
  }

  return {
    tint: isDark ? '#94a3b8' : '#727785',
    bg: isDark ? 'rgba(148,163,184,0.18)' : 'rgba(114,119,133,0.12)',
    border: isDark ? 'rgba(148,163,184,0.34)' : 'rgba(114,119,133,0.25)',
  };
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
  acceptanceCriteria: string;
  priority: PriorityKey;
  deadlineText: string;
  reminderText: string;
  repeatText: string;
  scheduleMeta: TaskScheduleMeta | null;
  boundHabitIds: string[];
  isLongTermTask: boolean;
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
    acceptanceCriteria: resolveAcceptanceCriteria(task.description, task.note),
    priority: mapPriorityTextToKey(priorityLabel),
    deadlineText,
    reminderText,
    repeatText,
    scheduleMeta,
    boundHabitIds: parseBoundHabitIdsFromExtraData(task.extra_data),
    isLongTermTask: getIsLongTermTask(task.extra_data),
    rewardPointsText: String(parseRewardPointsFromExtraData(task.extra_data)),
  };
}

function buildFormSnapshotFromFields(input: {
  title: string;
  acceptanceCriteria: string;
  priority: PriorityKey;
  deadlineText: string;
  reminderText: string;
  repeatText: string;
  scheduleMeta: TaskScheduleMeta | null;
  boundHabitIds: string[];
  isLongTermTask: boolean;
  rewardPointsText: string;
}): EditTaskFormSnapshot {
  return {
    title: input.title.trim(),
    acceptanceCriteria: input.acceptanceCriteria.trim(),
    priority: input.priority,
    deadlineText: input.deadlineText,
    reminderText: input.reminderText,
    repeatText: input.repeatText,
    scheduleMeta: input.scheduleMeta,
    boundHabitIds: input.boundHabitIds,
    isLongTermTask: input.isLongTermTask,
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
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';

  const taskId = typeof params.id === 'string' ? params.id : '';
  /** 从任务详情进入编辑时，保存/删除后需跳过详情页，直接回到任务 Tab */
  const openedFromTaskDetail =
    params.from === 'task-detail' || (Array.isArray(params.from) && params.from[0] === 'task-detail');
  const scheduleSource =
    normalizeRouteParam(params.source as string | string[] | undefined) || `edit-task-${taskId || 'unknown'}`;
  const addSubtaskSource = `${scheduleSource}-add-subtask`;
  const pickParentTaskSource = `${scheduleSource}-pick-parent`;

  const [title, setTitle] = React.useState('');
  const [acceptanceCriteria, setAcceptanceCriteria] = React.useState('');
  const [priority, setPriority] = React.useState<PriorityKey>('urgent-important');
  const [priorityOpen, setPriorityOpen] = React.useState(false);
  const [projectPriorityLabel, setProjectPriorityLabel] = React.useState('');
  const [deadlineText, setDeadlineText] = React.useState('');
  const [reminderText, setReminderText] = React.useState('');
  const [repeatText, setRepeatText] = React.useState('');
  const [scheduleMeta, setScheduleMeta] = React.useState<TaskScheduleMeta | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [taskSnapshot, setTaskSnapshot] = React.useState<TaskRow | null>(null);
  const [loadedFormSnapshot, setLoadedFormSnapshot] = React.useState<EditTaskFormSnapshot | null>(null);
  const [subtasks, setSubtasks] = React.useState<SubtaskDraft[]>([]);
  const [parentTask, setParentTask] = React.useState<SubtaskDraft | null>(null);
  const [parentDateLimit, setParentDateLimit] = React.useState<DateLimitYmd>({});
  const [projectDateLimit, setProjectDateLimit] = React.useState<DateLimitYmd>({});
  const [boundHabitIds, setBoundHabitIds] = React.useState<string[]>([]);
  const [isLongTermTask, setIsLongTermTask] = React.useState(false);
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
  const titleRef = React.useRef(title);
  const acceptanceCriteriaRef = React.useRef(acceptanceCriteria);
  const priorityRef = React.useRef(priority);
  const deadlineTextRef = React.useRef(deadlineText);
  const reminderTextRef = React.useRef(reminderText);
  const repeatTextRef = React.useRef(repeatText);
  const scheduleMetaRef = React.useRef(scheduleMeta);
  const taskSnapshotRef = React.useRef(taskSnapshot);
  const boundHabitIdsRef = React.useRef(boundHabitIds);
  const isLongTermTaskRef = React.useRef(isLongTermTask);
  const rewardPointsTextRef = React.useRef(rewardPointsText);
  const selectedTagIdsRef = React.useRef(selectedTagIds);
  titleRef.current = title;
  acceptanceCriteriaRef.current = acceptanceCriteria;
  priorityRef.current = priority;
  deadlineTextRef.current = deadlineText;
  reminderTextRef.current = reminderText;
  repeatTextRef.current = repeatText;
  scheduleMetaRef.current = scheduleMeta;
  taskSnapshotRef.current = taskSnapshot;
  boundHabitIdsRef.current = boundHabitIds;
  isLongTermTaskRef.current = isLongTermTask;
  rewardPointsTextRef.current = rewardPointsText;
  selectedTagIdsRef.current = selectedTagIds;

  const inheritsProjectPriority = !!taskSnapshot?.project_id;
  const canTagTask = !taskSnapshot?.parent_task_id;

  const subtaskDateLimit = React.useMemo<DateLimitYmd | null>(() => {
    const selfLimit = mergeDateLimit(scheduleMetaToDateLimit(scheduleMeta), {
      end: extractDueDate(deadlineText) || undefined,
    });
    const merged = mergeDateLimit(selfLimit, projectDateLimit);
    return merged.start || merged.end ? merged : null;
  }, [deadlineText, projectDateLimit, scheduleMeta]);

  const taskDateLimit = React.useMemo<DateLimitYmd | null>(() => {
    const merged = mergeDateLimit(parentDateLimit, projectDateLimit);
    return merged.start || merged.end ? merged : null;
  }, [parentDateLimit, projectDateLimit]);

  const inheritedSubtaskSchedule = React.useMemo(
    () => resolveInheritedDefaultSchedule(scheduleMeta, subtaskDateLimit),
    [scheduleMeta, subtaskDateLimit],
  );

  const primary = isDark ? '#60a5fa' : '#0058be';
  const outlineVariant = isDark ? 'rgba(148,163,184,0.22)' : 'rgba(194,198,214,0.7)';
  const outline = isDark ? 'rgba(148,163,184,0.65)' : 'rgba(114,119,133,0.8)';
  const surfaceLow = isDark ? 'rgba(30,41,59,0.35)' : 'rgba(241,243,255,0.9)';
  const surfaceLowest = theme.surface;
  const subtaskCardBg = isDark ? 'rgba(15,23,42,0.72)' : '#ffffff';
  const subtaskCardBorder = isDark ? 'rgba(148,163,184,0.3)' : 'rgba(194,198,214,0.55)';
  const subtaskIndicatorBg = isDark ? 'rgba(30,41,59,0.72)' : 'rgba(226,232,240,0.85)';
  const panelBorder = isDark ? 'rgba(148,163,184,0.22)' : 'rgba(194,198,214,0.65)';
  const panelBg = isDark ? 'rgba(30,41,59,0.45)' : '#ffffff';
  const fieldBg = isDark ? 'rgba(15,23,42,0.45)' : 'rgba(241,243,255,0.72)';
  const divider = isDark ? 'rgba(148,163,184,0.16)' : 'rgba(226,232,240,0.95)';

  const priorityOptions: Array<{ key: PriorityKey; label: string; color: string }> = [
    { key: 'urgent-important', label: '紧急重要', color: isDark ? '#f87171' : '#ba1a1a' },
    { key: 'urgent-not-important', label: '紧急不重要', color: isDark ? '#fbbf24' : '#825100' },
    { key: 'not-urgent-important', label: '不紧急重要', color: isDark ? '#60a5fa' : '#0058be' },
    { key: 'not-urgent-not-important', label: '不紧急不重要', color: isDark ? '#94a3b8' : '#727785' },
  ];
  const currentPriority = priorityOptions.find((p) => p.key === priority) ?? priorityOptions[0];

  const isDirty = React.useMemo(() => {
    if (!loadedFormSnapshot || loading) return false;
    const current = buildFormSnapshotFromFields({
      title,
      acceptanceCriteria,
      priority,
      deadlineText,
      reminderText,
      repeatText,
      scheduleMeta,
      boundHabitIds,
      isLongTermTask,
      rewardPointsText,
    });
    return !formSnapshotsEqual(loadedFormSnapshot, current);
  }, [acceptanceCriteria, boundHabitIds, deadlineText, isLongTermTask, loadedFormSnapshot, loading, priority, reminderText, repeatText, rewardPointsText, scheduleMeta, title]);

  const reload = React.useCallback(async (forceApi = false) => {
    if (!taskId) return;
    try {
      await wrapLoad(async () => {
        const nodes = await getChildTasksByParentTaskId(taskId);
        const rows = nodes.map((n) => n as unknown as TaskRow);
        setSubtasks(rows.map(mapTaskRowToSubtask));
      }, forceApi);
    } catch (error) {
      console.warn('加载子任务失败', error);
      setSubtasks([]);
    }
  }, [taskId, wrapLoad]);

  const { refreshControl } = usePagePullRefresh(PAGE_API_KEY, reload);

  const readScheduleResult = React.useCallback((): boolean => {
    const picked = consumeSchedulePickerResult(scheduleSource);
    if (!picked) return false;

    if (picked.repeatOption !== '不重复') {
      setDeadlineText('');
    } else if (picked.mode === 'time' && picked.range) {
      const rangeStart = formatDate(picked.range.start);
      const rangeEnd = formatDate(picked.range.end);
      const rangeLabel = rangeStart === rangeEnd ? rangeStart : `${rangeStart} ~ ${rangeEnd}`;
      const timeLabel = picked.allDay ? '全天' : `${formatTime(picked.startTime)} - ${formatTime(picked.endTime)}`;
      setDeadlineText(`${rangeLabel} ${timeLabel}`);
    } else if (picked.date) {
      const dateLabel = formatDate(picked.date);
      const timeLabel = picked.allDay ? '全天' : picked.hasExactTime ? formatTime(picked.startTime) : '';
      setDeadlineText(timeLabel ? `${dateLabel} ${timeLabel}` : dateLabel);
    } else {
      setDeadlineText('');
    }
    setReminderText(
      formatTaskReminderLabel({
        reminderOption: picked.reminderOption,
        reminderHour: picked.reminderHour,
        reminderMinute: picked.reminderMinute,
      }),
    );
    setRepeatText(picked.repeatOption === '不重复' ? '' : picked.repeatSummary);
    setScheduleMeta({
      mode: picked.mode,
      allDay: picked.allDay,
      hasExactTime: picked.hasExactTime,
      reminderOption: picked.reminderOption,
      reminderHour: picked.reminderHour,
      reminderMinute: picked.reminderMinute,
      repeatOption: picked.repeatOption,
      repeatSummary: picked.repeatSummary,
      weeklyDays: picked.weeklyDays,
      monthlyDays: picked.monthlyDays,
      yearlyDate: picked.yearlyDate,
      date: picked.date,
      range: picked.range,
      startTime: picked.startTime,
      endTime: picked.endTime,
    });

    return true;
  }, [scheduleSource]);

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
        dateLimit: taskDateLimit ? JSON.stringify(taskDateLimit) : '',
      },
    });
  }, [router, scheduleMeta, scheduleSource, taskDateLimit]);

  const readAddSubtaskResult = React.useCallback(async () => {
    const payload = globalThis.__addSubtaskResult as { source: string; task: SubtaskDraft } | undefined;
    if (!payload || payload.source !== addSubtaskSource) return;
    if (creatingSubtaskIdRef.current === payload.task.id) return;

    const parentTask = taskSnapshotRef.current;
    if (!parentTask) {
      Alert.alert('添加失败', '父任务尚未加载完成，请稍后重试。');
      return;
    }

    creatingSubtaskIdRef.current = payload.task.id;
    globalThis.__addSubtaskResult = undefined;

    try {
      const subtaskSchedule = payload.task.schedule ?? null;
      const dueDate = dueDateFromScheduleMeta(
        subtaskSchedule,
        extractDueDate(payload.task.deadline || payload.task.deadlineText || ''),
      );
      let subtaskPriority = parentTask.priority;
      if (parentTask.project_id) {
        const project = await getProjectById(parentTask.project_id);
        if (project) subtaskPriority = project.priority ?? 0;
      }
      await createTask({
        id: payload.task.id,
        project_id: parentTask.project_id,
        category_id: parentTask.category_id,
        parent_task_id: taskId,
        title: payload.task.title.trim() || '未命名任务',
        note: null,
        status: 'todo',
        priority: subtaskPriority,
        due_date: dueDate,
        extra_data: JSON.stringify({
          reminder: payload.task.reminder || payload.task.reminderText || '',
          repeat: payload.task.repeat || payload.task.repeatText || '',
          schedule: subtaskSchedule,
        }),
      });
      Alert.alert('已添加', '子任务已创建。');
      await reload();
    } catch (error) {
      console.warn('创建子任务失败', error);
      const message = formatWriteError(error, '子任务创建失败，请稍后重试。');
      Alert.alert('添加失败', message);
    } finally {
      if (creatingSubtaskIdRef.current === payload.task.id) {
        creatingSubtaskIdRef.current = null;
      }
    }
  }, [addSubtaskSource, reload, taskId]);

  const readPickParentTaskResult = React.useCallback(async () => {
    const payload = globalThis.__pickParentTaskResult as
      | { source: string; parentTaskId: string | null }
      | undefined;
    if (!payload || payload.source !== pickParentTaskSource) return;

    const childTask = taskSnapshotRef.current;
    if (!childTask) {
      Alert.alert('关联失败', '当前任务尚未加载完成，请稍后重试。');
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
      await pushLocalChangesToApi({ awaitSync: true, rethrow: true });

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
      notifyAncestorPagesLocalReload(PAGE_API_KEY);
      Alert.alert('已更新', nextParentId ? '父任务已关联。' : '已移除父任务。');
    } catch (error) {
      console.warn('关联父任务失败', error);
      Alert.alert('关联失败', formatWriteError(error, '父任务关联失败，请稍后重试。'));
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
      setRewardPointsText(String(parseRewardPointsFromExtraData(task.extra_data)));

      if (!task.parent_task_id) {
        setTagsLoading(true);
        try {
          const [tags, tagIds] = await Promise.all([
            getTags(),
            getTagIdsByEntity('task', taskId),
          ]);
          setAllTags(tags);
          setSelectedTagIds(tagIds);
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
      if (task.project_id) {
        const project = await getProjectById(task.project_id);
        if (project) {
          projectLimit = extractScheduleLimitFromExtra(project.extra_data, project.due_date);
          inheritedPriorityLabel = fromTaskPriority(project.priority ?? 0);
          setPriority(mapPriorityTextToKey(inheritedPriorityLabel));
          setLoadedFormSnapshot((prev) =>
            prev
              ? { ...prev, priority: mapPriorityTextToKey(inheritedPriorityLabel), acceptanceCriteria: resolveAcceptanceCriteria(task.description, task.note) }
              : prev,
          );
        }
      }
      setProjectPriorityLabel(inheritedPriorityLabel);
      setParentDateLimit(parentLimit);
      setProjectDateLimit(projectLimit);

      await reload();
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
      void readAddSubtaskResult();
      void readPickParentTaskResult();
      if (!consumedSchedule) {
        void reload();
      }
    }, [readPickParentTaskResult, readAddSubtaskResult, readScheduleResult, reload])
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
      const meta = scheduleMetaRef.current;
      const dueDate = dueDateFromScheduleMeta(meta, extractDueDate(deadlineTextRef.current));
      const parsedExtra = parseTaskExtraData(snapshot.extra_data);
      delete (parsedExtra as Record<string, unknown>).completion_reward;
      const mergedExtra = mergeRewardPointsIntoExtraData(
        mergeLongTermTaskIntoExtraData(
          mergeBoundHabitIdsIntoExtraData(
            JSON.stringify({
              ...parsedExtra,
              reminder: reminderTextRef.current,
              repeat: repeatTextRef.current,
              schedule: meta,
            }),
            boundHabitIdsRef.current,
          ),
          isLongTermTaskRef.current,
        ),
        normalizeRewardPoints(rewardPointsTextRef.current),
      );
      const acceptance = acceptanceCriteriaRef.current.trim() || null;
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
      await updateTask(taskId, {
        title: trimmedTitle,
        description: acceptance,
        note: null,
        priority: nextPriority,
        due_date: dueDate,
        extra_data: mergedExtra,
      });
      if (!snapshot.parent_task_id) {
        await setTaskTagIds(taskId, selectedTagIdsRef.current);
        await markPendingTablesDirty(['tasks', 'tags', 'tag_links']);
      }
      const parentFrame = mergeDateLimit(scheduleMetaToDateLimit(meta), {
        end: toYmd(dueDate ?? undefined) ?? undefined,
      });
      const tightenFrame = mergeDateLimit(parentFrame, projectDateLimit);
      await tightenDescendantTasksOf(taskId, tightenFrame);
      await pushLocalChangesToApi({ awaitSync: true, rethrow: true });

      const nextSnapshot = buildFormSnapshotFromFields({
        title: trimmedTitle,
        acceptanceCriteria: acceptanceCriteriaRef.current,
        priority: mapPriorityTextToKey(fromTaskPriority(nextPriority)),
        deadlineText: deadlineTextRef.current,
        reminderText: reminderTextRef.current,
        repeatText: repeatTextRef.current,
        scheduleMeta: meta,
        boundHabitIds: boundHabitIdsRef.current,
        isLongTermTask: isLongTermTaskRef.current,
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
              priority: nextPriority,
              due_date: dueDate,
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
        : `${detail}\n\n若仅本机已保存，请检查网络与服务器登录状态后重试。`;
      Alert.alert('保存失败', syncHint);
      return false;
    } finally {
      setSaving(false);
    }
  }, [loading, projectDateLimit, taskId]);

  const handleSavePress = React.useCallback(() => {
    if (saving || loading) return;
    void (async () => {
      const ok = await persistTask();
      if (!ok) return;
      performLeave();
    })();
  }, [loading, performLeave, persistTask, saving]);

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
                notifyAncestorPagesLocalReload(PAGE_API_KEY);
                navigateAfterDeleteTask();
              } catch (error) {
                console.warn('删除任务失败', error);
                Alert.alert('删除失败', formatWriteError(error, '任务删除失败，请稍后重试。'));
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
                notifyAncestorPagesLocalReload(PAGE_API_KEY);
                navigateAfterDeleteTask();
              } catch (err) {
                console.warn('删除任务失败', err);
                Alert.alert('删除失败', formatWriteError(err, '任务删除失败，请稍后重试。'));
              } finally {
                setSaving(false);
              }
            },
          },
        ]);
      }
    })();
  }, [loading, navigateAfterDeleteTask, saving, taskId]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={['top']}>
      <View
        style={[
          styles.header,
          {
            paddingTop: Math.max(insets.top, 8),
            backgroundColor: theme.background,
            borderBottomColor: divider,
          },
        ]}>
        <Pressable
          onPress={handleBackPress}
          disabled={saving || loading}
          hitSlop={10}
          style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.75 }]}>
          <MaterialIcons name="arrow-back" size={22} color={theme.text} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: theme.text }]}>{loading ? '加载中' : '编辑任务'}</Text>
        <Pressable
          onPress={handleSavePress}
          disabled={saving || loading}
          hitSlop={10}
          style={({ pressed }) => [
            styles.headerActionBtn,
            {
              backgroundColor: saving || loading ? `${primary}55` : primary,
              opacity: pressed ? 0.88 : 1,
            },
          ]}>
          <Text style={styles.headerActionText}>{saving ? '保存中' : '保存'}</Text>
        </Pressable>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView
          refreshControl={refreshControl}
          contentContainerStyle={[styles.content, { paddingBottom: 120 + Math.max(insets.bottom, 12) }]}
          showsVerticalScrollIndicator={false}>
          <View style={[styles.panel, { backgroundColor: panelBg, borderColor: panelBorder }]}>
            <Text style={[styles.panelTitle, { color: theme.text }]}>概要</Text>
            <TextInput
              value={title}
              onChangeText={(t) => setTitle(t.slice(0, TITLE_MAX_LENGTH))}
              placeholder="任务名称"
              placeholderTextColor={outlineVariant}
              maxLength={TITLE_MAX_LENGTH}
              multiline
              editable={!loading}
              style={[styles.titleInput, { color: theme.text, opacity: loading ? 0.65 : 1 }]}
            />
            <Text style={[styles.charCounter, { color: outline }]}>
              {title.length}/{TITLE_MAX_LENGTH}
            </Text>

            <View style={[styles.panelDivider, { backgroundColor: divider }]} />

            <View style={styles.fieldBlock}>
              <Text style={[styles.fieldLabel, { color: outline }]}>优先级</Text>
              {inheritsProjectPriority ? (
                <View style={[styles.prioritySelect, { backgroundColor: fieldBg, opacity: loading ? 0.65 : 1 }]}>
                  <View style={styles.priorityLeft}>
                    <View style={[styles.priorityDot, { backgroundColor: currentPriority.color }]} />
                    <Text style={[styles.priorityValue, { color: theme.text }]}>
                      {`与项目一致：${projectPriorityLabel || currentPriority.label || '未设置'}`}
                    </Text>
                  </View>
                </View>
              ) : (
                <Pressable
                  onPress={() => setPriorityOpen(true)}
                  disabled={loading}
                  style={({ pressed }) => [
                    styles.prioritySelect,
                    {
                      backgroundColor: fieldBg,
                      opacity: loading ? 0.65 : pressed ? 0.85 : 1,
                    },
                  ]}>
                  <View style={styles.priorityLeft}>
                    <View style={[styles.priorityDot, { backgroundColor: currentPriority.color }]} />
                    <Text style={[styles.priorityValue, { color: theme.text }]}>{currentPriority.label}</Text>
                  </View>
                  <MaterialIcons name="chevron-right" size={20} color={outline} />
                </Pressable>
              )}
            </View>

            {canTagTask ? (
              <View style={styles.fieldBlock}>
                <Text style={[styles.fieldLabel, { color: outline }]}>标签</Text>
                <ProjectTagPickerField
                  selectedIds={selectedTagIds}
                  allTags={allTags}
                  loading={tagsLoading}
                  disabled={loading}
                  onChange={setSelectedTagIds}
                  textColor={theme.text}
                  outline={outline}
                  placeholderColor={outlineVariant}
                  primary={primary}
                  surfaceLow={surfaceLow}
                  surfaceLowest={surfaceLowest}
                  isDark={isDark}
                />
              </View>
            ) : null}
          </View>

          <View style={[styles.panel, { backgroundColor: panelBg, borderColor: panelBorder }]}>
            <Text style={[styles.panelTitle, { color: theme.text }]}>日程</Text>
            <Pressable
              onPress={openSchedulePicker}
              disabled={loading}
              style={({ pressed }) => [
                styles.scheduleRow,
                { backgroundColor: fieldBg, opacity: loading ? 0.65 : pressed ? 0.85 : 1 },
              ]}>
              <View style={[styles.scheduleIcon, { backgroundColor: surfaceLowest }]}>
                <MaterialIcons name="event-note" size={20} color={primary} />
              </View>
              <View style={styles.deadlineBody}>
                <Text style={[styles.fieldLabel, { color: outline }]}>时间限制</Text>
                <Text style={[styles.fieldValue, { color: theme.text }]}>{deadlineText || '未设置'}</Text>
                {!!(reminderText || repeatText) && (
                  <View style={styles.tagRow}>
                    {!!reminderText && (
                      <View style={[styles.metaTag, { backgroundColor: surfaceLowest, borderColor: outlineVariant }]}>
                        <MaterialIcons name="notifications-active" size={13} color={primary} />
                        <Text style={[styles.metaTagText, { color: theme.text }]}>{reminderText}</Text>
                      </View>
                    )}
                    {!!repeatText && (
                      <View style={[styles.metaTag, { backgroundColor: surfaceLowest, borderColor: outlineVariant }]}>
                        <MaterialIcons name="repeat" size={13} color={primary} />
                        <Text style={[styles.metaTagText, { color: theme.text }]}>{repeatText}</Text>
                      </View>
                    )}
                  </View>
                )}
              </View>
              <MaterialIcons name="chevron-right" size={20} color={outline} />
            </Pressable>
          </View>

          <View style={[styles.panel, { backgroundColor: panelBg, borderColor: panelBorder }]}>
            <View style={styles.subtaskHeader}>
              <View>
                <Text style={[styles.panelTitle, { color: theme.text }]}>父任务</Text>
                <Text style={[styles.panelHint, { color: outline }]}>
                  {parentTask ? '已关联上级任务' : '可选，用于任务层级'}
                </Text>
              </View>
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
                  styles.addTaskBtn,
                  { backgroundColor: `${primary}14`, opacity: pressed || loading ? 0.75 : 1 },
                ]}>
                <MaterialIcons name="add" size={16} color={primary} />
                <Text style={[styles.linkBtnText, { color: primary }]}>
                  {parentTask ? '更换' : '添加'}
                </Text>
              </Pressable>
            </View>
            <View style={styles.subtaskList}>
              {parentTask ? (
                <Pressable
                  onPress={() => openEditSubtask(parentTask.id)}
                  style={({ pressed }) => [
                    styles.subtaskRow,
                    { backgroundColor: subtaskCardBg, borderColor: subtaskCardBorder, opacity: pressed ? 0.86 : 1 },
                  ]}>
                  <View style={[styles.subtaskIndicator, { backgroundColor: subtaskIndicatorBg }]}>
                    <MaterialIcons name="account-tree" size={18} color={primary} />
                  </View>
                  <View style={styles.subtaskBody}>
                    <Text style={[styles.subtaskText, { color: theme.text }]} numberOfLines={1}>
                      {parentTask.title}
                    </Text>
                    {!!(
                      parentTask.priority ||
                      parentTask.priorityLabel ||
                      parentTask.deadline ||
                      parentTask.deadlineText ||
                      parentTask.reminder ||
                      parentTask.reminderText ||
                      parentTask.repeat ||
                      parentTask.repeatText ||
                      parentTask.note
                    ) && (
                      <>
                        <View style={styles.subtaskMetaRow}>
                          {!!(parentTask.priority || parentTask.priorityLabel) &&
                            (() => {
                              const priorityText = parentTask.priority || parentTask.priorityLabel || '';
                              const priorityColor = getPriorityColor(priorityText, isDark);
                              return (
                                <View
                                  style={[
                                    styles.metaTag,
                                    { backgroundColor: priorityColor.bg, borderColor: priorityColor.border },
                                  ]}>
                                  <MaterialIcons name="flag" size={13} color={priorityColor.tint} />
                                  <Text style={[styles.metaTagText, { color: priorityColor.tint }]}>{priorityText}</Text>
                                </View>
                              );
                            })()}
                          {!!(parentTask.deadline || parentTask.deadlineText) && (
                            <View style={[styles.metaTag, { backgroundColor: surfaceLow, borderColor: outlineVariant }]}>
                              <MaterialIcons name="event" size={13} color={primary} />
                              <Text style={[styles.metaTagText, { color: theme.text }]} numberOfLines={1}>
                                {parentTask.deadline || parentTask.deadlineText}
                              </Text>
                            </View>
                          )}
                        </View>
                        {!!parentTask.note && (
                          <Text style={[styles.subtaskNote, { color: outline }]} numberOfLines={2}>
                            {parentTask.note}
                          </Text>
                        )}
                      </>
                    )}
                  </View>
                  <View style={[styles.subtaskAction, { backgroundColor: subtaskIndicatorBg }]}>
                    <MaterialIcons name="chevron-right" size={18} color={outline} />
                  </View>
                </Pressable>
              ) : (
                <View style={[styles.emptySubtaskRow, { backgroundColor: fieldBg, borderColor: panelBorder }]}>
                  <MaterialIcons name="device-hub" size={18} color={outline} />
                  <Text style={[styles.emptySubtaskText, { color: outline }]}>暂无父任务</Text>
                </View>
              )}
            </View>
          </View>

          <View style={[styles.panel, { backgroundColor: panelBg, borderColor: panelBorder }]}>
            <View style={styles.subtaskHeader}>
              <View>
                <Text style={[styles.panelTitle, { color: theme.text }]}>子任务</Text>
                <Text style={[styles.panelHint, { color: outline }]}>
                  {subtasks.length > 0 ? `${subtasks.length} 项` : '拆成更小可执行步骤'}
                </Text>
              </View>
              <Pressable
                onPress={() =>
                  router.push({
                    pathname: '/add-subtask',
                    params: {
                      source: addSubtaskSource,
                      dateLimit: subtaskDateLimit ? JSON.stringify(subtaskDateLimit) : '',
                      defaultSchedule: inheritedSubtaskSchedule ? JSON.stringify(inheritedSubtaskSchedule) : '',
                    },
                  })
                }
                disabled={loading}
                style={({ pressed }) => [
                  styles.addTaskBtn,
                  { backgroundColor: `${primary}14`, opacity: pressed || loading ? 0.75 : 1 },
                ]}>
                <MaterialIcons name="add" size={16} color={primary} />
                <Text style={[styles.linkBtnText, { color: primary }]}>添加</Text>
              </Pressable>
            </View>
            <View style={styles.subtaskList}>
              {subtasks.map((s) => (
                <Pressable
                  key={s.id}
                  onPress={() => openEditSubtask(s.id)}
                  style={({ pressed }) => [
                    styles.subtaskRow,
                    { backgroundColor: subtaskCardBg, borderColor: subtaskCardBorder, opacity: pressed ? 0.86 : 1 },
                  ]}>
                  <View style={[styles.subtaskIndicator, { backgroundColor: subtaskIndicatorBg }]}>
                    <View
                      style={[
                        styles.checkbox,
                        { borderColor: outlineVariant, backgroundColor: s.done ? primary : 'transparent' },
                      ]}>
                      {s.done && <MaterialIcons name="check" size={14} color="#fff" />}
                    </View>
                  </View>
                  <View style={styles.subtaskBody}>
                    <Text style={[styles.subtaskText, { color: theme.text }]} numberOfLines={1}>
                      {s.title}
                    </Text>
                    {!!(
                      s.priority ||
                      s.priorityLabel ||
                      s.deadline ||
                      s.deadlineText ||
                      s.reminder ||
                      s.reminderText ||
                      s.repeat ||
                      s.repeatText ||
                      s.note
                    ) && (
                      <>
                        <View style={styles.subtaskMetaRow}>
                          {!!(s.priority || s.priorityLabel) &&
                            (() => {
                              const priorityText = s.priority || s.priorityLabel || '';
                              const priorityColor = getPriorityColor(priorityText, isDark);
                              return (
                                <View
                                  style={[
                                    styles.metaTag,
                                    { backgroundColor: priorityColor.bg, borderColor: priorityColor.border },
                                  ]}>
                                  <MaterialIcons name="flag" size={13} color={priorityColor.tint} />
                                  <Text style={[styles.metaTagText, { color: priorityColor.tint }]}>{priorityText}</Text>
                                </View>
                              );
                            })()}
                          {!!(s.deadline || s.deadlineText) && (
                            <View style={[styles.metaTag, { backgroundColor: surfaceLow, borderColor: outlineVariant }]}>
                              <MaterialIcons name="event" size={13} color={primary} />
                              <Text style={[styles.metaTagText, { color: theme.text }]} numberOfLines={1}>
                                {s.deadline || s.deadlineText}
                              </Text>
                            </View>
                          )}
                          {!!(s.reminder || s.reminderText) && (
                            <View style={[styles.metaTag, { backgroundColor: surfaceLow, borderColor: outlineVariant }]}>
                              <MaterialIcons name="notifications-active" size={13} color={primary} />
                              <Text style={[styles.metaTagText, { color: theme.text }]}>
                                {s.reminder || s.reminderText}
                              </Text>
                            </View>
                          )}
                          {!!(s.repeat || s.repeatText) && (
                            <View style={[styles.metaTag, { backgroundColor: surfaceLow, borderColor: outlineVariant }]}>
                              <MaterialIcons name="repeat" size={13} color={primary} />
                              <Text style={[styles.metaTagText, { color: theme.text }]}>
                                {s.repeat || s.repeatText}
                              </Text>
                            </View>
                          )}
                        </View>
                        {!!s.note && (
                          <Text style={[styles.subtaskNote, { color: outline }]} numberOfLines={2}>
                            {s.note}
                          </Text>
                        )}
                      </>
                    )}
                  </View>
                  <View style={[styles.subtaskAction, { backgroundColor: subtaskIndicatorBg }]}>
                    <MaterialIcons name="chevron-right" size={18} color={outline} />
                  </View>
                </Pressable>
              ))}
              {subtasks.length === 0 && (
                <View style={[styles.emptySubtaskRow, { backgroundColor: fieldBg, borderColor: panelBorder }]}>
                  <MaterialIcons name="playlist-add-check" size={18} color={outline} />
                  <Text style={[styles.emptySubtaskText, { color: outline }]}>暂无子任务</Text>
                </View>
              )}
            </View>
          </View>

          <View style={[styles.panel, { backgroundColor: panelBg, borderColor: panelBorder }]}>
            <Text style={[styles.panelTitle, { color: theme.text }]}>更多</Text>
            <Pressable
              onPress={() => setIsLongTermTask((v) => !v)}
              disabled={loading}
              accessibilityRole="switch"
              accessibilityState={{ checked: isLongTermTask }}
              style={({ pressed }) => [
                styles.longTermRow,
                {
                  backgroundColor: isLongTermTask ? `${primary}12` : fieldBg,
                  borderColor: isLongTermTask ? primary : 'transparent',
                  opacity: loading ? 0.65 : pressed ? 0.88 : 1,
                },
              ]}>
              <View style={styles.longTermTextWrap}>
                <Text style={[styles.longTermTitle, { color: theme.text }]}>长期任务</Text>
                <Text style={[styles.longTermHint, { color: outline }]}>
                  指派为青蛙后，完成时确认是否结束整项
                </Text>
              </View>
              <MaterialIcons
                name={isLongTermTask ? 'check-box' : 'check-box-outline-blank'}
                size={22}
                color={isLongTermTask ? primary : outline}
              />
            </Pressable>

            <View style={styles.fieldBlock}>
              <Text style={[styles.fieldLabel, { color: outline }]}>绑定小习惯</Text>
              <BoundHabitPickerField
                selectedHabitIds={boundHabitIds}
                sections={habitSections}
                loading={habitsLoading}
                disabled={loading}
                onChange={setBoundHabitIds}
                textColor={theme.text}
                outline={outline}
                placeholderColor={outlineVariant}
                primary={primary}
                surfaceLow={surfaceLow}
                surfaceLowest={surfaceLowest}
                isDark={isDark}
              />
            </View>

            <View style={styles.fieldBlock}>
              <Text style={[styles.fieldLabel, { color: outline }]}>奖励积分</Text>
              <View style={[styles.rewardPointsWrap, { backgroundColor: fieldBg }]}>
                <TextInput
                  value={rewardPointsText}
                  onChangeText={setRewardPointsText}
                  placeholder="0"
                  placeholderTextColor={outline}
                  keyboardType="numbers-and-punctuation"
                  editable={!loading}
                  style={[styles.rewardPointsInput, { color: theme.text, opacity: loading ? 0.65 : 1 }]}
                />
              </View>
              <Text style={[styles.longTermHint, { color: outline }]}>
                完成后计入；负数扣除，可含小数；0 无变动
              </Text>
            </View>

            <View style={styles.fieldBlock}>
              <Text style={[styles.fieldLabel, { color: outline }]}>验收标准</Text>
              <View style={[styles.notesWrap, { backgroundColor: fieldBg }]}>
                <TextInput
                  value={acceptanceCriteria}
                  onChangeText={setAcceptanceCriteria}
                  placeholder="怎样算完成？（可选）"
                  placeholderTextColor={outline}
                  multiline
                  editable={!loading}
                  style={[styles.notesInput, { color: theme.text, opacity: loading ? 0.65 : 1 }]}
                />
              </View>
            </View>
          </View>
        </ScrollView>

        <View
          style={[
            styles.bottomBar,
            {
              paddingBottom: Math.max(insets.bottom, 10),
              backgroundColor: theme.background,
              borderTopColor: divider,
            },
          ]}>
          <Pressable
            onPress={removeTask}
            disabled={saving || loading}
            style={({ pressed }) => [
              styles.deleteBtn,
              {
                borderColor: isDark ? 'rgba(248,113,113,0.45)' : 'rgba(186,26,26,0.35)',
                opacity: saving || loading ? 0.55 : pressed ? 0.8 : 1,
              },
            ]}>
            <MaterialIcons name="delete-outline" size={18} color={isDark ? '#f87171' : '#ba1a1a'} />
            <Text style={[styles.deleteText, { color: isDark ? '#f87171' : '#ba1a1a' }]}>删除任务</Text>
          </Pressable>
        </View>

        <Modal
          transparent
          visible={!inheritsProjectPriority && priorityOpen}
          animationType="fade"
          onRequestClose={() => setPriorityOpen(false)}>
          <Pressable style={styles.priorityOverlay} onPress={() => setPriorityOpen(false)}>
            <Pressable
              onPress={() => {}}
              style={[
                styles.prioritySheet,
                {
                  backgroundColor: surfaceLowest,
                  borderColor: panelBorder,
                },
              ]}>
              <Text style={[styles.prioritySheetTitle, { color: theme.text }]}>选择优先级</Text>
              {priorityOptions.map((item) => {
                const active = item.key === priority;
                return (
                  <Pressable
                    key={item.key}
                    onPress={() => {
                      setPriority(item.key);
                      setPriorityOpen(false);
                    }}
                    style={({ pressed }) => [
                      styles.priorityItem,
                      {
                        backgroundColor: active ? `${item.color}14` : fieldBg,
                        borderColor: active ? `${item.color}44` : 'transparent',
                      },
                      pressed && { opacity: 0.85 },
                    ]}>
                    <View style={[styles.priorityDot, { backgroundColor: item.color }]} />
                    <Text style={[styles.priorityItemText, { color: theme.text }]}>{item.label}</Text>
                    {active ? <MaterialIcons name="check" size={18} color={item.color} /> : null}
                  </Pressable>
                );
              })}
            </Pressable>
          </Pressable>
        </Modal>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  iconBtn: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', letterSpacing: -0.2 },
  headerActionBtn: {
    minWidth: 64,
    height: 34,
    paddingHorizontal: 14,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerActionText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  content: { paddingTop: 84, paddingHorizontal: 14, gap: 12 },
  panel: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    padding: 14,
    gap: 12,
  },
  panelTitle: { fontSize: 15, fontWeight: '700', letterSpacing: -0.2 },
  panelHint: { fontSize: 12, marginTop: 2, lineHeight: 16 },
  panelDivider: { height: StyleSheet.hairlineWidth, marginVertical: 2 },
  titleInput: { padding: 0, fontSize: 22, fontWeight: '700', lineHeight: 28 },
  charCounter: { alignSelf: 'flex-end', fontSize: 11, fontWeight: '500' },
  fieldBlock: { gap: 8 },
  fieldLabel: { fontSize: 12, fontWeight: '600' },
  fieldValue: { fontSize: 14, fontWeight: '600' },
  longTermRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  longTermTextWrap: { flex: 1, gap: 3 },
  longTermTitle: { fontSize: 14, fontWeight: '600' },
  longTermHint: { fontSize: 12, lineHeight: 16 },
  prioritySelect: {
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  priorityLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 },
  priorityDot: { width: 8, height: 8, borderRadius: 4 },
  priorityValue: { fontSize: 14, fontWeight: '600', flex: 1 },
  scheduleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  scheduleIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deadlineBody: { flex: 1, gap: 4, minWidth: 0 },
  tagRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  metaTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  metaTagText: { fontSize: 11, fontWeight: '600' },
  subtaskHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 },
  linkBtnText: { fontSize: 13, fontWeight: '600' },
  addTaskBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  subtaskList: { gap: 8 },
  subtaskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  subtaskIndicator: { width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  checkbox: { width: 18, height: 18, borderRadius: 5, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  subtaskBody: { flex: 1, gap: 6, paddingRight: 2 },
  subtaskText: { flex: 1, fontSize: 14, fontWeight: '600', lineHeight: 19 },
  subtaskMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  subtaskNote: { fontSize: 12, fontWeight: '500', lineHeight: 17 },
  subtaskAction: { width: 26, height: 26, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  emptySubtaskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 14,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: 'dashed',
  },
  emptySubtaskText: { flex: 1, fontSize: 13, fontWeight: '500' },
  notesWrap: { borderRadius: 10, padding: 12, minHeight: 100 },
  notesInput: { minHeight: 76, fontSize: 14, fontWeight: '500', lineHeight: 20 },
  rewardPointsWrap: {
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 40,
    justifyContent: 'center',
  },
  rewardPointsInput: {
    padding: 0,
    margin: 0,
    fontSize: 15,
    fontWeight: '600',
    minHeight: 20,
  },
  bottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 14,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  deleteBtn: {
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  deleteText: { fontSize: 14, fontWeight: '600' },
  priorityOverlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.35)', justifyContent: 'flex-end', padding: 14 },
  prioritySheet: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, padding: 14, gap: 8 },
  prioritySheetTitle: { fontSize: 15, fontWeight: '700', marginBottom: 2 },
  priorityItem: {
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  priorityItemText: { flex: 1, fontSize: 14, fontWeight: '600' },
});

