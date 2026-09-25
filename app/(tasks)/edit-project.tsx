import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { usePageApiSync, usePagePullRefresh } from '@/hooks/use-page-api-sync';
import {
  dueDateFromScheduleMeta,
  mergeDateLimit,
  resolveInheritedDefaultSchedule,
  scheduleMetaToDateLimit,
} from '@/lib/schedule-inherit';
import { tightenAllProjectTasks } from '@/lib/tighten-task-schedules';
import { consumeAddTaskResult } from '@/lib/add-task-bridge';
import { consumeSchedulePickerResult, normalizeRouteParam } from '@/lib/schedule-picker-bridge';
import { formatTaskReminderLabel, type TaskReminderOption } from '@/lib/task-reminder-schedule';
import { PrerequisiteProjectPickerField } from '@/components/projects/PrerequisiteProjectPickerField';
import { ProjectTagPickerField } from '@/components/projects/ProjectTagPickerField';
import {
  ComposerPriorityMatrix,
  taskPriorityKeyToNumber,
  taskPriorityToKey,
  type TaskPriorityKey,
} from '@/components/composer';
import { INBOX_PROJECT_CATEGORY_ID } from '@/lib/repositories/projects/constants';
import { getDatabase } from '@/lib/database.native';
import { formatWriteError } from '@/lib/format-write-error';
import {
  getIsLongTermProject,
  mergeLongTermProjectIntoExtraData,
  mergeLongTermTaskIntoExtraData,
} from '@/lib/long-term-task';
import { clearProjectFrogFields } from '@/lib/frog-assignment';
import {
  mergeRewardPointsIntoExtraObject,
  normalizeRewardPoints,
  parseRewardPointsFromExtraData,
} from '@/lib/reward-points';
import {
  mergePrerequisiteIdsIntoExtraData,
  parsePrerequisiteProjectIds,
  validatePrerequisiteSelection,
} from '@/lib/repositories/projects/project-prerequisites';
import { ensureProjectScheduleMetaForSave } from '@/lib/repositories/projects/project-schedule-save';
import { markPendingTablesDirty } from '@/lib/api-incremental-sync';
import { pushLocalChangesToApi } from '@/lib/api-write-sync';
import {
  beginCloudSqliteDirtyIgnoreBatch,
  endCloudSqliteDirtyIgnoreBatch,
} from '@/lib/cloud-sql-dirty-track';
import { deleteProject, getProjectById, getProjectCategories, getProjects, updateProject } from '@/lib/repositories/projects/project';
import {
  getProjectTags,
  getTagIdsByProjectId,
  setProjectTagIds,
} from '@/lib/repositories/projects/project-tag';
import type { ProjectCategoryRow, ProjectRow } from '@/lib/repositories/projects/project.types';
import type { ProjectTagRow } from '@/lib/repositories/projects/project-tag.types';
import {
  countIncompleteTasksByProjectId,
  createTask,
  getTasksByProjectId,
  updateTask,
  type TaskTreeNode,
} from '@/lib/repositories/tasks/task';
import type { TaskPriority, TaskRow } from '@/lib/repositories/tasks/task.types';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from "expo-router/react-navigation";
import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import {
  ActivityIndicator,
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
import { getHabits } from '@/lib/repositories/habits/habit';
import { parseBoundHabitIdsFromExtraData } from '@/lib/repositories/tasks/task-habit-binding';

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
};

type SubtaskNode = Subtask & { children: SubtaskNode[] };
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

const TITLE_MAX_LENGTH = 80;

type ProjectScheduleMeta = Pick<
  SchedulePickerResult,
  | 'mode'
  | 'allDay'
  | 'hasExactTime'
  | 'reminderOption'
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

function extractDueDate(deadlineText: string) {
  const all = deadlineText.match(/\d{4}-\d{2}-\d{2}/g);
  if (!all?.length) return null;
  return all[all.length - 1] ?? null;
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
  const nextDue = extractDueDate(subtask.deadline || subtask.deadlineText || '');
  return (
    existing.title === (subtask.title.trim() || '未命名任务') &&
    (existing.description ?? null) === (subtask.acceptanceCriteria?.trim() || null) &&
    existing.status === nextStatus &&
    (existing.due_date?.slice(0, 10) ?? null) === (nextDue ?? null) &&
    (existing.extra_data ?? null) === nextExtra &&
    (existing.parent_task_id ?? null) === (parentTaskId ?? null)
  );
}

function collectExpandableSubtaskIds(nodes: SubtaskNode[]): string[] {
  const ids: string[] = [];
  const walk = (list: SubtaskNode[]) => {
    for (const n of list) {
      if (n.children.length > 0) {
        ids.push(n.id);
        walk(n.children);
      }
    }
  };
  walk(nodes);
  return ids;
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

function toYmd(value: string): string | null {
  const t = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const PAGE_API_KEY = 'edit-project';

export default function EditProjectScreen() {
  const { wrapLoad, notifyAncestorsDataChanged } = usePageApiSync(PAGE_API_KEY);
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string; source?: string }>();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';

  const projectId = typeof params.id === 'string' ? params.id : '';
  const [title, setTitle] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [deadlineText, setDeadlineText] = React.useState('');
  const [reminderText, setReminderText] = React.useState('');
  const [repeatText, setRepeatText] = React.useState('');
  const [scheduleMeta, setScheduleMeta] = React.useState<ProjectScheduleMeta | null>(null);
  const [projectExtraData, setProjectExtraData] = React.useState<ProjectExtraData>({});
  const [subtasks, setSubtasks] = React.useState<SubtaskNode[]>([]);
  const [expandedTaskIds, setExpandedTaskIds] = React.useState<Set<string>>(() => new Set());
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
  const [rewardPointsText, setRewardPointsText] = React.useState('0');
  const [priority, setPriority] = React.useState<TaskPriorityKey>('not-urgent-not-important');
  const [habitNameById, setHabitNameById] = React.useState<Map<string, string>>(() => new Map());
  const [saving, setSaving] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [toastVisible, setToastVisible] = React.useState(false);
  const [toastMessage, setToastMessage] = React.useState('');
  const toastTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const primary = isDark ? '#60a5fa' : '#0058be';
  const scheduleSource =
    normalizeRouteParam(params.source as string | string[] | undefined) || `edit-project-${projectId || 'unknown'}`;
  const addTaskSource = `${scheduleSource}-add-task`;
  const outlineVariant = isDark ? 'rgba(148,163,184,0.22)' : 'rgba(194,198,214,0.7)';
  const outline = isDark ? 'rgba(148,163,184,0.65)' : 'rgba(114,119,133,0.8)';
  const surfaceLow = isDark ? 'rgba(30,41,59,0.35)' : 'rgba(241,243,255,0.9)';
  const surfaceLowest = theme.surface;
  const subtaskCardBg = isDark ? 'rgba(15,23,42,0.72)' : '#ffffff';
  const subtaskCardBorder = isDark ? 'rgba(148,163,184,0.3)' : 'rgba(194,198,214,0.55)';
  const subtaskIndicatorBg = isDark ? 'rgba(30,41,59,0.72)' : 'rgba(226,232,240,0.85)';

  const showToast = React.useCallback((message: string) => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
    setToastMessage(message);
    setToastVisible(true);
    toastTimerRef.current = setTimeout(() => {
      setToastVisible(false);
      toastTimerRef.current = null;
    }, 2200);
  }, []);

  React.useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
        toastTimerRef.current = null;
      }
    };
  }, []);

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
        extractDueDate(task.deadline || task.deadlineText || ''),
      );
      await createTask({
        id: task.id,
        project_id: projectId,
        category_id: normalizedCategoryId,
        parent_task_id: null,
        title: task.title.trim() || '未命名任务',
        description: task.acceptanceCriteria?.trim() || null,
        note: null,
        status: (task.done ? 'done' : 'todo') as TaskRow['status'],
        priority: taskPriorityKeyToNumber(priority),
        due_date: dueDate,
        extra_data: mergeLongTermTaskIntoExtraData(
          JSON.stringify({
            reminder: task.reminder || task.reminderText || '',
            repeat: task.repeat || task.repeatText || '',
            schedule: taskSchedule,
          }),
          task.isLongTermTask === true,
        ),
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
      setSubtasks((prev) => [...prev, { ...task, children: [] }]);
      setPersistedTaskIds((prev) => new Set(prev).add(task.id));
      showToast('已加入项目');
      return true;
    } catch (error) {
      console.warn('添加任务写入失败', error);
      Alert.alert('任务保存失败', formatWriteError(error, '任务未能写入数据库，请返回重新添加或稍后重试。'));
      return true;
    }
  }, [addTaskSource, priority, projectId, showToast]);

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
      setSelectedCategoryId(normalizeProjectCategoryId(project.category_id));
      setPriority(taskPriorityToKey(project.priority ?? 0));
      setNotes(project.note ?? '');
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
      setIsLongTermProject(getIsLongTermProject(project.extra_data));
      setRewardPointsText(String(parseRewardPointsFromExtraData(project.extra_data)));
      const projectTasks = await getTasksByProjectId(projectId);
      const tree = mapTaskTreeToSubtaskNodes(projectTasks);
      setSubtasks(tree);
      setPersistedTaskIds(new Set(collectAllSubtaskIds(tree)));
      try {
        const habits = await getHabits();
        setHabitNameById(new Map(habits.map((h) => [h.id, h.name])));
      } catch (habitErr) {
        console.warn('加载小习惯名称失败', habitErr);
        setHabitNameById(new Map());
      }
    } catch (error) {
      console.warn('加载项目详情失败', error);
      Alert.alert('加载失败', '无法读取项目详情，请稍后重试。');
      router.back();
    } finally {
      setLoading(false);
    }
  }, [projectId, router]);

  const reloadProjectPage = React.useCallback(
    async (forceApi = false) => {
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
      }, forceApi);
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
      const tree = mapTaskTreeToSubtaskNodes(projectTasks);
      setSubtasks(tree);
      setPersistedTaskIds(new Set(collectAllSubtaskIds(tree)));
    } catch (error) {
      console.warn('刷新项目任务失败', error);
    }
  }, [projectId]);

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
    const end = extractDueDate(deadlineText);
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
        Alert.alert('暂不可编辑', '该任务尚未保存到数据库，请先保存项目后再进入编辑。');
        return;
      }
      router.push({ pathname: '/edit-task', params: { id: taskId } });
    },
    [persistedTaskIds, router],
  );

  const expandableSubtaskIds = React.useMemo(() => collectExpandableSubtaskIds(subtasks), [subtasks]);
  const allSubtasksExpanded = React.useMemo(
    () => expandableSubtaskIds.length > 0 && expandableSubtaskIds.every((id) => expandedTaskIds.has(id)),
    [expandableSubtaskIds, expandedTaskIds],
  );

  const toggleSubtaskExpanded = React.useCallback((id: string) => {
    setExpandedTaskIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleExpandAllSubtasks = React.useCallback(() => {
    setExpandedTaskIds((prev) => {
      const ids = collectExpandableSubtaskIds(subtasks);
      const allOpen = ids.length > 0 && ids.every((id) => prev.has(id));
      if (allOpen) return new Set();
      return new Set(ids);
    });
  }, [subtasks]);

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
      const withLongTerm = mergeLongTermProjectIntoExtraData(JSON.stringify(withReward), isLongTermProject);
      // 保存后若已有任务，清除项目级青蛙标记（项目不可再作青蛙）
      const nextExtraAfterTasks =
        subtasks.length > 0 ? clearProjectFrogFields(withLongTerm) : withLongTerm;
      const projectDueDate = dueDateFromScheduleMeta(scheduleToSave, extractDueDate(deadlineText));
      await updateProject(projectId, {
        ...(categoryTouched ? { category_id: normalizedCategoryId } : {}),
        name: trimmedTitle,
        priority: taskPriorityKeyToNumber(priority),
        note: notes.trim() || null,
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
        const payload = {
          project_id: projectId,
          parent_task_id,
          title: subtask.title.trim() || '未命名任务',
          description: subtask.acceptanceCriteria?.trim() || null,
          note: null,
          status: (subtask.done ? 'done' : 'todo') as TaskRow['status'],
          priority: projectPriorityValue,
          due_date: extractDueDate(subtask.deadline || subtask.deadlineText || ''),
          extra_data: JSON.stringify({
            ...existingExtra,
            reminder: subtask.reminder || subtask.reminderText || '',
            repeat: subtask.repeat || subtask.repeatText || '',
          }),
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
      // 同步未出现在编辑分录中的项目任务优先级（继承母项目）
      const editedSubtaskIds = new Set(flatWithParents.map((x) => x.subtask.id));
      for (const [tid, existingTask] of existingTaskById) {
        if (editedSubtaskIds.has(tid)) continue;
        if (existingTask.priority !== projectPriorityValue) {
          await updateTask(tid, { priority: projectPriorityValue }, writeOpts);
        }
      }
      await tightenAllProjectTasks(projectId, projectFrame, writeOpts);
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
      Alert.alert('保存失败', formatWriteError(error));
      setSaving(false);
    } finally {
      endCloudSqliteDirtyIgnoreBatch();
    }

    if (!committed) return;

    try {
      await markPendingTablesDirty(['projects', 'project_categories', 'tasks', 'task_categories', 'tags', 'tag_links']);
      await pushLocalChangesToApi({ awaitSync: true, rethrow: true });
      notifyAncestorsDataChanged();
    } catch (syncErr) {
      console.warn('项目保存后同步到服务器失败', syncErr);
      Alert.alert(
        '同步失败',
        formatWriteError(syncErr, '已保存到本机，但未能写入服务器。请检查网络后重试或下拉刷新。'),
      );
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
    isLongTermProject,
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
        try {
          await markPendingTablesDirty(['projects', 'tasks']);
          await pushLocalChangesToApi({ awaitSync: true, rethrow: true });
          notifyAncestorsDataChanged();
        } catch (syncErr) {
          console.warn('项目删除后同步到服务器失败', syncErr);
        }
        router.back();
      } catch (error) {
        console.warn('删除项目失败', error);
        Alert.alert('删除失败', formatWriteError(error, '项目删除失败，请稍后重试。'));
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

  const renderSubtaskNodes = (nodes: SubtaskNode[], depth: number): React.ReactNode =>
    nodes.map((s) => {
      const hasChildren = s.children.length > 0;
      const isExpanded = expandedTaskIds.has(s.id);
      return (
        <React.Fragment key={s.id}>
          <View style={styles.subtaskTreeWrap}>
            <View
              style={[
                styles.subtaskRow,
                { backgroundColor: subtaskCardBg, borderColor: subtaskCardBorder },
              ]}>
              {hasChildren ? (
                <Pressable
                  onPress={() => toggleSubtaskExpanded(s.id)}
                  hitSlop={6}
                  style={({ pressed }) => [styles.subtaskExpandHit, pressed && { opacity: 0.75 }]}>
                  <MaterialIcons name={isExpanded ? 'expand-less' : 'expand-more'} size={22} color={outline} />
                </Pressable>
              ) : (
                <View style={styles.subtaskExpandPlaceholder} />
              )}
              <View style={styles.subtaskLevelMark} accessible accessibilityLabel={depth > 0 ? `第 ${depth} 层子任务` : undefined}>
                {depth > 0 ? (
                  <View
                    style={[
                      styles.subtaskLevelBadge,
                      {
                        borderColor: isDark ? 'rgba(96,165,250,0.4)' : 'rgba(0,88,190,0.28)',
                        backgroundColor: isDark ? 'rgba(96,165,250,0.12)' : 'rgba(0,88,190,0.08)',
                      },
                    ]}>
                    <Text style={[styles.subtaskLevelText, { color: primary }]} numberOfLines={1}>
                      {depth > 9 ? '9+' : String(depth)}
                    </Text>
                  </View>
                ) : null}
              </View>
              <View style={[styles.subtaskIndicator, { backgroundColor: subtaskIndicatorBg }]}>
                <View style={[styles.checkbox, { borderColor: outlineVariant, backgroundColor: s.done ? primary : 'transparent' }]}>
                  {s.done && <MaterialIcons name="check" size={14} color="#fff" />}
                </View>
              </View>
              <Pressable
                onPress={() => openEditTask(s.id)}
                style={({ pressed }) => [styles.subtaskRowMainPress, pressed && { opacity: 0.86 }]}>
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
                    s.note ||
                    (s.boundHabitIds?.length ?? 0) > 0
                  ) && (
                    <>
                      <View style={styles.subtaskMetaRow}>
                        {!!(s.priority || s.priorityLabel) &&
                          (() => {
                            const priorityText = s.priority || s.priorityLabel || '';
                            const priorityColor = getPriorityColor(priorityText, isDark);
                            return (
                              <View style={[styles.metaTag, { backgroundColor: priorityColor.bg, borderColor: priorityColor.border }]}>
                                <MaterialIcons name="flag" size={14} color={priorityColor.tint} />
                                <Text style={[styles.metaTagText, { color: priorityColor.tint }]}>{priorityText}</Text>
                              </View>
                            );
                          })()}
                        {!!(s.deadline || s.deadlineText) && (
                          <View style={[styles.metaTag, { backgroundColor: surfaceLow, borderColor: outlineVariant }]}>
                            <MaterialIcons name="event" size={14} color={primary} />
                            <Text style={[styles.metaTagText, { color: theme.text }]} numberOfLines={1}>
                              {s.deadline || s.deadlineText}
                            </Text>
                          </View>
                        )}
                        {!!(s.reminder || s.reminderText) && (
                          <View style={[styles.metaTag, { backgroundColor: surfaceLow, borderColor: outlineVariant }]}>
                            <MaterialIcons name="notifications-active" size={14} color={primary} />
                            <Text style={[styles.metaTagText, { color: theme.text }]}>{s.reminder || s.reminderText}</Text>
                          </View>
                        )}
                        {!!(s.repeat || s.repeatText) && (
                          <View style={[styles.metaTag, { backgroundColor: surfaceLow, borderColor: outlineVariant }]}>
                            <MaterialIcons name="repeat" size={14} color={primary} />
                            <Text style={[styles.metaTagText, { color: theme.text }]}>{s.repeat || s.repeatText}</Text>
                          </View>
                        )}
                        {(s.boundHabitIds ?? []).map((habitId) => (
                          <View
                            key={habitId}
                            style={[styles.metaTag, { backgroundColor: surfaceLow, borderColor: outlineVariant }]}>
                            <MaterialIcons name="repeat" size={14} color={primary} />
                            <Text style={[styles.metaTagText, { color: theme.text }]} numberOfLines={1}>
                              {habitNameById.get(habitId)?.trim() || '已绑定习惯'}
                            </Text>
                          </View>
                        ))}
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
            </View>
          </View>
          {hasChildren && isExpanded ? renderSubtaskNodes(s.children, depth + 1) : null}
        </React.Fragment>
      );
    });

  const panelBorder = isDark ? 'rgba(148,163,184,0.22)' : 'rgba(194,198,214,0.65)';
  const panelBg = isDark ? 'rgba(30,41,59,0.45)' : '#ffffff';
  const fieldBg = isDark ? 'rgba(15,23,42,0.45)' : 'rgba(241,243,255,0.72)';
  const divider = isDark ? 'rgba(148,163,184,0.16)' : 'rgba(226,232,240,0.95)';

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
          onPress={() => router.back()}
          disabled={saving}
          hitSlop={10}
          style={({ pressed }) => [styles.iconBtn, { opacity: saving ? 0.45 : pressed ? 0.75 : 1 }]}>
          <MaterialIcons name="arrow-back" size={22} color={theme.text} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: theme.text }]}>{loading ? '加载中' : '项目详情'}</Text>
        <Pressable
          onPress={saveProject}
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
              onChangeText={setTitle}
              placeholder="项目名称"
              placeholderTextColor={outlineVariant}
              multiline
              editable={!loading && !saving}
              maxLength={TITLE_MAX_LENGTH}
              style={[styles.titleInput, { color: theme.text, opacity: loading ? 0.65 : 1 }]}
            />
            <Text style={[styles.charCounter, { color: outline }]}>
              {title.length}/{TITLE_MAX_LENGTH}
            </Text>

            <View style={[styles.panelDivider, { backgroundColor: divider }]} />

            <Pressable
              onPress={() => setCategoryModalVisible(true)}
              disabled={loading || saving}
              style={({ pressed }) => [
                styles.fieldRow,
                { backgroundColor: fieldBg, opacity: loading ? 0.65 : pressed ? 0.82 : 1 },
              ]}>
              <View style={styles.fieldRowLeft}>
                <MaterialIcons name="folder-open" size={18} color={primary} />
                <View style={styles.fieldCopy}>
                  <Text style={[styles.fieldLabel, { color: outline }]}>分类</Text>
                  <Text style={[styles.fieldValue, { color: theme.text }]}>{selectedCategoryName || '未分类'}</Text>
                </View>
              </View>
              <MaterialIcons name="chevron-right" size={20} color={outline} />
            </Pressable>

            <View style={styles.fieldBlock}>
              <Text style={[styles.fieldLabel, { color: outline }]}>标签</Text>
              <ProjectTagPickerField
                selectedIds={selectedTagIds}
                allTags={allTags}
                loading={tagsLoading || loading}
                disabled={loading || saving}
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
          </View>

          <View
            style={[styles.panel, { backgroundColor: panelBg, borderColor: panelBorder, opacity: loading ? 0.65 : 1 }]}
            pointerEvents={loading || saving ? 'none' : 'auto'}>
            <Text style={[styles.panelTitle, { color: theme.text }]}>优先级</Text>
            <ComposerPriorityMatrix value={priority} onChange={setPriority} />
          </View>

          <View style={[styles.panel, { backgroundColor: panelBg, borderColor: panelBorder }]}>
            <Text style={[styles.panelTitle, { color: theme.text }]}>依赖与日程</Text>
            <View style={styles.fieldBlock}>
              <Text style={[styles.fieldLabel, { color: outline }]}>前置项目</Text>
              <PrerequisiteProjectPickerField
                selectedIds={prerequisiteProjectIds}
                allProjects={allProjects}
                excludeProjectId={projectId}
                loading={projectsLoading || loading}
                disabled={loading || saving}
                onChange={setPrerequisiteProjectIds}
                textColor={theme.text}
                outline={outline}
                placeholderColor={outlineVariant}
                primary={primary}
                surfaceLow={surfaceLow}
                surfaceLowest={surfaceLowest}
                isDark={isDark}
              />
            </View>

            <Pressable
              onPress={openSchedulePicker}
              disabled={loading || saving}
              style={({ pressed }) => [
                styles.scheduleRow,
                { backgroundColor: fieldBg, opacity: loading || saving ? 0.65 : pressed ? 0.85 : 1 },
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
                <Text style={[styles.panelTitle, { color: theme.text }]}>任务拆解</Text>
                <Text style={[styles.panelHint, { color: outline }]}>
                  {subtasks.length > 0 ? `${subtasks.length} 项顶层任务` : '把项目拆成可执行任务'}
                </Text>
              </View>
              <View style={styles.subtaskHeaderActions}>
                {expandableSubtaskIds.length > 0 ? (
                  <Pressable
                    onPress={toggleExpandAllSubtasks}
                    style={({ pressed }) => [styles.linkBtn, pressed && { opacity: 0.75 }]}>
                    <Text style={[styles.linkBtnText, { color: primary }]}>
                      {allSubtasksExpanded ? '收起' : '展开'}
                    </Text>
                  </Pressable>
                ) : null}
                <Pressable
                  onPress={() =>
                    router.push({
                      pathname: '/add-task',
                      params: {
                        source: addTaskSource,
                        dateLimit: taskDateLimit ? JSON.stringify(taskDateLimit) : '',
                        defaultSchedule: inheritedTaskSchedule ? JSON.stringify(inheritedTaskSchedule) : '',
                      },
                    })
                  }
                  style={({ pressed }) => [
                    styles.addTaskBtn,
                    { backgroundColor: `${primary}14`, opacity: pressed ? 0.8 : 1 },
                  ]}>
                  <MaterialIcons name="add" size={16} color={primary} />
                  <Text style={[styles.linkBtnText, { color: primary }]}>添加</Text>
                </Pressable>
              </View>
            </View>
            <View style={styles.subtaskList}>
              {renderSubtaskNodes(subtasks, 0)}
              {subtasks.length === 0 && (
                <View style={[styles.emptySubtaskRow, { backgroundColor: fieldBg, borderColor: panelBorder }]}>
                  <MaterialIcons name="playlist-add-check" size={18} color={outline} />
                  <Text style={[styles.emptySubtaskText, { color: outline }]}>暂无任务，点右上角添加</Text>
                </View>
              )}
            </View>
          </View>

          <View style={[styles.panel, { backgroundColor: panelBg, borderColor: panelBorder }]}>
            <Text style={[styles.panelTitle, { color: theme.text }]}>更多</Text>
            <Pressable
              onPress={() => setIsLongTermProject((v) => !v)}
              disabled={loading || saving}
              accessibilityRole="switch"
              accessibilityState={{ checked: isLongTermProject }}
              style={({ pressed }) => [
                styles.longTermRow,
                {
                  backgroundColor: isLongTermProject ? `${primary}12` : fieldBg,
                  borderColor: isLongTermProject ? primary : 'transparent',
                  opacity: loading || saving ? 0.65 : pressed ? 0.88 : 1,
                },
              ]}>
              <View style={styles.longTermTextWrap}>
                <Text style={[styles.longTermTitle, { color: theme.text }]}>长期项目</Text>
                <Text style={[styles.longTermHint, { color: outline }]}>
                  无子任务时可指派为青蛙；完成时确认是否结束整项
                </Text>
              </View>
              <MaterialIcons
                name={isLongTermProject ? 'check-box' : 'check-box-outline-blank'}
                size={22}
                color={isLongTermProject ? primary : outline}
              />
            </Pressable>

            <View style={styles.fieldBlock}>
              <Text style={[styles.fieldLabel, { color: outline }]}>奖励积分</Text>
              <View style={[styles.rewardPointsWrap, { backgroundColor: fieldBg }]}>
                <TextInput
                  value={rewardPointsText}
                  onChangeText={setRewardPointsText}
                  placeholder="0"
                  placeholderTextColor={outline}
                  keyboardType="numbers-and-punctuation"
                  editable={!loading && !saving}
                  style={[styles.rewardPointsInput, { color: theme.text, opacity: loading || saving ? 0.65 : 1 }]}
                />
              </View>
              <Text style={[styles.longTermHint, { color: outline }]}>
                完成整项后计入；负数扣除，可含小数；0 无变动
              </Text>
            </View>

            <View style={styles.fieldBlock}>
              <Text style={[styles.fieldLabel, { color: outline }]}>验收标准</Text>
              <View style={[styles.notesWrap, { backgroundColor: fieldBg }]}>
                <TextInput
                  value={notes}
                  onChangeText={setNotes}
                  placeholder="怎样算完成？（可选）"
                  placeholderTextColor={outline}
                  multiline
                  editable={!loading && !saving}
                  style={[styles.notesInput, { color: theme.text, opacity: loading || saving ? 0.65 : 1 }]}
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
            onPress={removeProject}
            disabled={saving || loading}
            style={({ pressed }) => [
              styles.deleteBtn,
              {
                borderColor: isDark ? 'rgba(248,113,113,0.45)' : 'rgba(186,26,26,0.35)',
                opacity: saving || loading ? 0.55 : pressed ? 0.8 : 1,
              },
            ]}>
            <MaterialIcons name="delete-outline" size={18} color={isDark ? '#f87171' : '#ba1a1a'} />
            <Text style={[styles.deleteText, { color: isDark ? '#f87171' : '#ba1a1a' }]}>删除项目</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      <Modal transparent visible={categoryModalVisible} animationType="fade" onRequestClose={() => setCategoryModalVisible(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setCategoryModalVisible(false)}>
          <Pressable onPress={() => {}} style={[styles.modalCard, { backgroundColor: surfaceLowest, borderColor: outlineVariant }]}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>选择项目分类</Text>
            <Pressable
              onPress={() => {
                categoryTouchedRef.current = true;
                setSelectedCategoryId(null);
                setCategoryModalVisible(false);
              }}
              style={({ pressed }) => [styles.modalItem, pressed && { opacity: 0.8 }]}>
              <Text style={[styles.modalItemText, { color: theme.text }]}>未分类</Text>
              {selectedCategoryId === null ? <MaterialIcons name="check" size={18} color={primary} /> : null}
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
                <Text style={[styles.modalItemText, { color: theme.text }]}>{item.name}</Text>
                {selectedCategoryId === item.id ? <MaterialIcons name="check" size={18} color={primary} /> : null}
              </Pressable>
            ))}
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={toastVisible} transparent animationType="fade" onRequestClose={() => setToastVisible(false)}>
        <View
          pointerEvents="box-none"
          style={[styles.toastOverlay, { paddingBottom: Math.max(insets.bottom, 14) + 100 }]}>
          <View style={styles.toastHost}>
            <View style={[styles.toastWrap, { backgroundColor: isDark ? 'rgba(15,23,42,0.96)' : 'rgba(17,24,39,0.96)' }]}>
              <Text style={styles.toastText}>{toastMessage}</Text>
            </View>
          </View>
        </View>
      </Modal>

      {saving ? (
        <View style={[styles.savingOverlay, { backgroundColor: isDark ? 'rgba(15,23,42,0.55)' : 'rgba(255,255,255,0.72)' }]} pointerEvents="auto">
          <ActivityIndicator size="large" color={primary} />
          <Text style={[styles.savingOverlayText, { color: theme.text }]}>正在保存…</Text>
        </View>
      ) : null}
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
  headerActionBtn: {
    minWidth: 64,
    height: 34,
    paddingHorizontal: 14,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerActionText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  headerTitle: { fontSize: 17, fontWeight: '700', letterSpacing: -0.2 },
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
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 10,
  },
  fieldRowLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 },
  fieldCopy: { flex: 1, gap: 2, minWidth: 0 },
  fieldBlock: { gap: 8 },
  fieldLabel: { fontSize: 12, fontWeight: '600' },
  fieldValue: { fontSize: 14, fontWeight: '600' },
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
  subtaskHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 1,
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
  },
  linkBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 6, paddingHorizontal: 4 },
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
  subtaskTreeWrap: { width: '100%' },
  subtaskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  subtaskExpandHit: { width: 26, height: 32, alignItems: 'center', justifyContent: 'center' },
  subtaskExpandPlaceholder: { width: 26, height: 32 },
  subtaskLevelMark: { width: 24, alignItems: 'center', justifyContent: 'center' },
  subtaskLevelBadge: {
    minWidth: 20,
    height: 20,
    paddingHorizontal: 4,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  subtaskLevelText: { fontSize: 10, fontWeight: '700' },
  subtaskRowMainPress: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 0 },
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
  modalOverlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.38)', justifyContent: 'center', paddingHorizontal: 18 },
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
  toastOverlay: { flex: 1, justifyContent: 'flex-end', alignItems: 'center' },
  toastHost: { width: '100%', alignItems: 'center' },
  toastWrap: { borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8, maxWidth: '92%' },
  toastText: { color: '#fff', fontSize: 13, fontWeight: '600', textAlign: 'center' },
  savingOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 300,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
  },
  savingOverlayText: { fontSize: 15, fontWeight: '600' },
});
