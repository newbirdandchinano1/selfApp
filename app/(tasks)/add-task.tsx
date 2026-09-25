import {
    ComposerPriorityMatrix,
    ComposerTopBar,
    taskPriorityLabel,
    type TaskPriorityKey,
} from '@/components/composer';
import { Layout, Radius, Spacing } from '@/constants/design-tokens';
import { useAppTheme } from '@/hooks/use-app-theme';
import { usePageApiSync, usePagePullRefresh } from '@/hooks/use-page-api-sync';
import { setAddTaskResult } from '@/lib/add-task-bridge';
import { markPendingTablesDirty } from '@/lib/api-incremental-sync';
import { pushLocalChangesToApi } from '@/lib/api-write-sync';
import { makeTimestampEntityId } from '@/lib/entity-id';
import { formatWriteError } from '@/lib/format-write-error';
import { clearProjectFrogFields } from '@/lib/frog-assignment';
import { mergeLongTermTaskIntoExtraData } from '@/lib/long-term-task';
import { resolveAcceptanceCriteria } from '@/lib/acceptance-criteria';
import {
  mergeRewardPointsIntoExtraData,
  normalizeRewardPoints,
  parseRewardPointsFromExtraData,
} from '@/lib/reward-points';
import { ProjectTagPickerField } from '@/components/projects/ProjectTagPickerField';
import { INBOX_PROJECT_CATEGORY_ID } from '@/lib/repositories/projects/constants';
import { getProjectById, updateProject } from '@/lib/repositories/projects/project';
import { ensureLocalRowForWrite } from '@/lib/api-local-row';
import { createTask, deleteTask, updateTask } from '@/lib/repositories/tasks/task';
import type { TaskPriority, TaskRow } from '@/lib/repositories/tasks/task.types';
import {
  getTagIdsByEntity,
  getTags,
  setTaskTagIds,
} from '@/lib/repositories/tags/tag';
import type { TagRow } from '@/lib/repositories/tags/tag.types';
import {
    applyScheduleMetaToLabels,
    dueDateFromScheduleMeta,
    extractScheduleLimitFromExtra,
    parseDateLimitParam,
    parseDefaultScheduleParam,
    resolveInheritedDefaultSchedule,
} from '@/lib/schedule-inherit';
import { consumeSchedulePickerResult, normalizeRouteParam } from '@/lib/schedule-picker-bridge';
import { isStandaloneTodoTask } from '@/lib/standalone-todo-task';
import { formatTaskReminderLabel, type TaskReminderOption } from '@/lib/task-reminder-schedule';
import { getDayBoundarySync, getLogicalLocalYmd } from '@/lib/tasks-logical-day';
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
  note?: string | null;
  acceptanceCriteria?: string;
  schedule?: TaskScheduleMeta | null;
  isLongTermTask?: boolean;
};
type MainTask = { id: string; title: string; due: string };
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

type DateLimitYmd = {
  start?: string;
  end?: string;
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
const MAX_PROJECT_TASK_TITLE_LENGTH = 80;
const MAX_STANDALONE_TODO_TITLE_LENGTH = 50;
const STANDALONE_SCHEDULE_SOURCE = 'add-standalone-todo';

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

function firstRouteParam(value: string | string[] | undefined): string {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0].trim();
  return '';
}

function extractDueDateFromDeadlineText(deadlineText: string) {
  const all = deadlineText.match(/\d{4}-\d{2}-\d{2}/g);
  if (!all?.length) return null;
  return all[all.length - 1] ?? null;
}

function labelToTaskPriority(value?: string): TaskPriority {
  const text = (value ?? '').toLowerCase();
  if (text.includes('不紧急不重要')) return 1;
  if (text.includes('不紧急重要')) return 2;
  if (text.includes('紧急不重要')) return 3;
  if (text.includes('紧急重要')) return 4;
  return 0;
}

function extractDueYmdFromSchedulePick(picked: SchedulePickerResult): string | null {
  if (picked.repeatOption !== '不重复') return null;
  if (picked.mode === 'time' && picked.range) {
    return formatDate(picked.range.end);
  }
  if (picked.date) {
    return formatDate(picked.date);
  }
  return null;
}

function isDueYmdToday(dueYmd: string | null): boolean {
  if (!dueYmd) return false;
  return dueYmd === getLogicalLocalYmd(new Date(), getDayBoundarySync());
}

function taskPriorityToKey(priority: number): TaskPriorityKey {
  if (priority >= 4) return 'urgent-important';
  if (priority === 3) return 'urgent-not-important';
  if (priority === 2) return 'not-urgent-important';
  return 'not-urgent-not-important';
}

function parseStandaloneTaskScheduleMeta(extraData: string | null): TaskScheduleMeta | null {
  if (!extraData) return null;
  try {
    const parsed = JSON.parse(extraData) as { schedule?: TaskScheduleMeta };
    return parsed?.schedule ?? null;
  } catch {
    return null;
  }
}

function resolveStandaloneStatusOnSave(previous: string, intent: 'active' | 'shelved'): string {
  if (intent === 'shelved') return 'shelved';
  if (previous === 'done' || previous === 'cancelled' || previous === 'doing' || previous === 'blocked') {
    return previous;
  }
  return 'todo';
}

const PAGE_API_KEY = 'add-task';

export default function AddTaskScreen() {
  const { wrapLoad, notifyAncestorsDataChanged } = usePageApiSync(PAGE_API_KEY);
  const router = useRouter();
  const params = useLocalSearchParams<{
    source?: string;
    dateLimit?: string;
    defaultSchedule?: string;
    projectId?: string;
    categoryId?: string;
    standalone?: string;
    id?: string;
  }>();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useAppTheme();

  const [title, setTitle] = React.useState('');
  const [acceptanceCriteria, setAcceptanceCriteria] = React.useState('');
  const [rewardPointsText, setRewardPointsText] = React.useState('0');
  const [priority, setPriority] = React.useState<TaskPriorityKey>('not-urgent-not-important');
  const [mainTaskOpen, setMainTaskOpen] = React.useState(false);
  const [mainTaskQuery, setMainTaskQuery] = React.useState('');
  const [selectedMainTaskId, setSelectedMainTaskId] = React.useState<string | null>(null);
  const [deadlineText, setDeadlineText] = React.useState('');
  const [reminderText, setReminderText] = React.useState('');
  const [repeatText, setRepeatText] = React.useState('');
  const [scheduleMeta, setScheduleMeta] = React.useState<TaskScheduleMeta | null>(null);
  const [subtasks, setSubtasks] = React.useState<Subtask[]>([]);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [isLongTermTask, setIsLongTermTask] = React.useState(false);
  const [projectName, setProjectName] = React.useState<string | null>(null);
  const [projectPriority, setProjectPriority] = React.useState<TaskPriority>(0);
  /** 独立待办：正常待办 vs 暂时搁置（时间未定，不可直接完成） */
  const [standaloneIntent, setStandaloneIntent] = React.useState<'active' | 'shelved'>('active');
  const [loadingEdit, setLoadingEdit] = React.useState(false);
  const [selectedTagIds, setSelectedTagIds] = React.useState<string[]>([]);
  const [allTags, setAllTags] = React.useState<TagRow[]>([]);
  const [tagsLoading, setTagsLoading] = React.useState(false);
  const editTaskStatusRef = React.useRef<string>('todo');

  const isStandalone =
    firstRouteParam(params.standalone) === '1' || firstRouteParam(params.standalone).toLowerCase() === 'true';
  const editTaskId = isStandalone ? firstRouteParam(params.id) : '';
  const isEditStandalone = isStandalone && !!editTaskId;
  const titleMaxLength = isStandalone ? MAX_STANDALONE_TODO_TITLE_LENGTH : MAX_PROJECT_TASK_TITLE_LENGTH;

  const quickProjectId = isStandalone ? '' : firstRouteParam(params.projectId);
  const quickCategoryRaw = firstRouteParam(params.categoryId);
  const quickTaskCategoryId =
    !quickCategoryRaw || quickCategoryRaw === INBOX_PROJECT_CATEGORY_ID ? null : quickCategoryRaw;
  const scheduleSource = isEditStandalone
    ? `edit-standalone-todo-${editTaskId}`
    : isStandalone
      ? STANDALONE_SCHEDULE_SOURCE
      : normalizeRouteParam(params.source as string | string[] | undefined) || 'add-task';
  const dateLimit = React.useMemo(
    () => parseDateLimitParam(typeof params.dateLimit === 'string' ? params.dateLimit : undefined),
    [params.dateLimit],
  );
  const defaultScheduleApplied = React.useRef(false);

  React.useEffect(() => {
    if (defaultScheduleApplied.current || scheduleMeta) return;
    const inherited = resolveInheritedDefaultSchedule(
      parseDefaultScheduleParam(typeof params.defaultSchedule === 'string' ? params.defaultSchedule : undefined),
      dateLimit,
    );
    if (!inherited) return;
    defaultScheduleApplied.current = true;
    const applied = applyScheduleMetaToLabels(inherited);
    setDeadlineText(applied.deadlineText);
    setReminderText(applied.reminderText);
    setRepeatText(applied.repeatText);
    setScheduleMeta(applied.scheduleMeta as TaskScheduleMeta);
  }, [dateLimit, params.defaultSchedule, scheduleMeta]);

  React.useEffect(() => {
    if (!quickProjectId || defaultScheduleApplied.current || scheduleMeta) return;
    if (params.defaultSchedule || params.dateLimit) return;

    let cancelled = false;
    (async () => {
      try {
        const project = await getProjectById(quickProjectId);
        if (!project || cancelled) return;
        setProjectName(project.name?.trim() || null);
        setProjectPriority(project.priority ?? 0);
        const extra = project.extra_data ? (JSON.parse(project.extra_data) as { schedule?: TaskScheduleMeta }) : {};
        const projectSchedule = extra.schedule ?? null;
        const limit = extractScheduleLimitFromExtra(project.extra_data, project.due_date);
        const inherited = resolveInheritedDefaultSchedule(projectSchedule, limit.start || limit.end ? limit : null);
        if (!inherited || cancelled || defaultScheduleApplied.current) return;
        defaultScheduleApplied.current = true;
        const applied = applyScheduleMetaToLabels(inherited);
        setDeadlineText(applied.deadlineText);
        setReminderText(applied.reminderText);
        setRepeatText(applied.repeatText);
        setScheduleMeta(applied.scheduleMeta as TaskScheduleMeta);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params.dateLimit, params.defaultSchedule, quickProjectId, scheduleMeta]);

  const priorityLabel = taskPriorityLabel(priority);

  const applyLoadedStandaloneTask = React.useCallback((task: TaskRow) => {
    setTitle(task.title ?? '');
    setAcceptanceCriteria(resolveAcceptanceCriteria(task.description, task.note));
    setRewardPointsText(String(parseRewardPointsFromExtraData(task.extra_data)));
    setPriority(taskPriorityToKey(task.priority ?? 0));
    editTaskStatusRef.current = task.status;
    const shelved = task.status === 'shelved';
    setStandaloneIntent(shelved ? 'shelved' : 'active');
    if (shelved) {
      setDeadlineText('');
      setReminderText('');
      setRepeatText('');
      setScheduleMeta(null);
      return;
    }
    const loadedSchedule = parseStandaloneTaskScheduleMeta(task.extra_data);
    if (loadedSchedule) {
      const applied = applyScheduleMetaToLabels(loadedSchedule);
      setDeadlineText(applied.deadlineText);
      setReminderText(applied.reminderText);
      setRepeatText(applied.repeatText);
      setScheduleMeta(applied.scheduleMeta as TaskScheduleMeta);
      return;
    }
    let reminder = '';
    let repeat = '';
    if (task.extra_data) {
      try {
        const parsed = JSON.parse(task.extra_data) as { reminder?: string; repeat?: string };
        reminder = typeof parsed.reminder === 'string' ? parsed.reminder : '';
        repeat = typeof parsed.repeat === 'string' ? parsed.repeat : '';
      } catch {
        /* ignore */
      }
    }
    setDeadlineText(task.due_date ? formatDate(task.due_date) : '');
    setReminderText(reminder);
    setRepeatText(repeat);
    setScheduleMeta(null);
  }, []);

  const reloadAddTaskData = React.useCallback(
    async (forceApi = false) => {
      await wrapLoad(async () => {
        if (isStandalone) {
          setTagsLoading(true);
          try {
            setAllTags(await getTags());
          } catch (err) {
            console.warn('加载标签失败', err);
            setAllTags([]);
          } finally {
            setTagsLoading(false);
          }
        }
        if (isEditStandalone && editTaskId) {
          setLoadingEdit(true);
          try {
            const task = await ensureLocalRowForWrite<TaskRow>('tasks', editTaskId);
            if (!task || !isStandaloneTodoTask(task)) {
              Alert.alert('待办不存在', '未找到对应待办，可能已被删除。');
              router.back();
              return;
            }
            applyLoadedStandaloneTask(task);
            try {
              setSelectedTagIds(await getTagIdsByEntity('task', editTaskId));
            } catch (tagErr) {
              console.warn('加载待办标签失败', tagErr);
              setSelectedTagIds([]);
            }
          } catch (error) {
            console.warn('加载待办失败', error);
            Alert.alert('加载失败', '无法读取待办，请稍后重试。');
            router.back();
          } finally {
            setLoadingEdit(false);
          }
        }
        if (quickProjectId) {
          const project = await getProjectById(quickProjectId);
          setProjectName(project?.name?.trim() || null);
          setProjectPriority(project?.priority ?? 0);
        } else {
          setProjectName(null);
          setProjectPriority(0);
        }
      }, forceApi);
    },
    [applyLoadedStandaloneTask, editTaskId, isEditStandalone, isStandalone, quickProjectId, router, wrapLoad],
  );

  const { refreshControl } = usePagePullRefresh(PAGE_API_KEY, reloadAddTaskData);

  const mainTaskOptions: MainTask[] = [
    { id: 'm1', title: 'Q4 品牌战略规划', due: '截止日期: 12月31日' },
    { id: 'm2', title: '移动端应用 2.0 重构', due: '截止日期: 11月15日' },
    { id: 'm3', title: '新员工入职培训手册', due: '进行中' },
    { id: 'm4', title: '年度开发者大会筹备', due: '截止日期: 10月20日' },
  ];
  const filteredMainTasks = mainTaskOptions.filter((item) =>
    `${item.title}${item.due}`.toLowerCase().includes(mainTaskQuery.trim().toLowerCase()),
  );
  const toggleSubtask = (id: string) => {
    setSubtasks((prev) => prev.map((s) => (s.id === id ? { ...s, done: !s.done } : s)));
  };

  const removeSubtask = (id: string) => {
    setSubtasks((prev) => prev.filter((s) => s.id !== id));
  };

  const handleTitleChange = (text: string) => {
    setTitle(text.slice(0, titleMaxLength));
  };

  const readScheduleResult = React.useCallback(() => {
    const picked = consumeSchedulePickerResult(scheduleSource);
    if (!picked) return;

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
    if (isStandalone && isDueYmdToday(extractDueYmdFromSchedulePick(picked))) {
      setPriority('urgent-important');
    }
  }, [isStandalone, scheduleSource]);

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
        dateLimit: dateLimit ? JSON.stringify(dateLimit) : '',
      },
    });
  }, [dateLimit, router, scheduleMeta, scheduleSource]);

  React.useEffect(() => {
    readScheduleResult();
  }, [readScheduleResult]);

  React.useEffect(() => {
    void reloadAddTaskData().catch((e) => console.warn('加载添加任务页数据失败', e));
  }, [reloadAddTaskData]);

  useFocusEffect(
    React.useCallback(() => {
      readScheduleResult();
    }, [readScheduleResult]),
  );

  const handleCreateTask = async () => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      Alert.alert(isStandalone ? '无法保存' : '无法创建任务', isStandalone ? '请先填写待办标题。' : '请输入任务名称后再创建。');
      return;
    }
    if (isStandalone) {
      try {
        setIsSubmitting(true);
        const shelved = standaloneIntent === 'shelved';
        const dueDate = shelved
          ? null
          : dueDateFromScheduleMeta(scheduleMeta, extractDueDateFromDeadlineText(deadlineText));
        const extraPayload = mergeRewardPointsIntoExtraData(
          shelved
            ? JSON.stringify({ reminder: '', repeat: '', schedule: null })
            : JSON.stringify({
                reminder: reminderText || '',
                repeat: repeatText || '',
                schedule: scheduleMeta,
              }),
          normalizeRewardPoints(rewardPointsText),
        );
        const trimmedAcceptanceCriteria = acceptanceCriteria.trim() || null;
        if (isEditStandalone) {
          await updateTask(editTaskId, {
            title: trimmedTitle,
            description: trimmedAcceptanceCriteria,
            note: null,
            status: resolveStandaloneStatusOnSave(editTaskStatusRef.current, standaloneIntent),
            priority: labelToTaskPriority(priorityLabel),
            due_date: dueDate,
            extra_data: extraPayload,
          });
          await setTaskTagIds(editTaskId, selectedTagIds);
        } else {
          const id = makeTimestampEntityId('tsk_', 8);
          await createTask({
            id,
            project_id: null,
            category_id: null,
            parent_task_id: null,
            title: trimmedTitle,
            description: trimmedAcceptanceCriteria,
            note: null,
            status: shelved ? 'shelved' : 'todo',
            priority: labelToTaskPriority(priorityLabel),
            due_date: dueDate,
            extra_data: extraPayload,
          });
          await setTaskTagIds(id, selectedTagIds);
        }
        try {
          await markPendingTablesDirty(['tasks', 'tags', 'tag_links']);
          await pushLocalChangesToApi({ awaitSync: true, rethrow: true });
        } catch (syncErr) {
          console.warn('待办保存后同步到服务器失败', syncErr);
        }
        notifyAncestorsDataChanged();
        router.back();
      } catch (error) {
        console.warn('保存待办失败', error);
        Alert.alert('保存失败', formatWriteError(error, '请稍后重试。'));
      } finally {
        setIsSubmitting(false);
      }
      return;
    }
    if (quickProjectId) {
      try {
        setIsSubmitting(true);
        const id = makeTimestampEntityId('tsk_', 8);
        await createTask({
          id,
          project_id: quickProjectId,
          category_id: quickTaskCategoryId,
          parent_task_id: null,
          title: trimmedTitle,
          description: acceptanceCriteria.trim() || null,
          note: null,
          status: 'todo',
          priority: projectPriority,
          due_date: dueDateFromScheduleMeta(scheduleMeta, extractDueDateFromDeadlineText(deadlineText)),
          extra_data: mergeRewardPointsIntoExtraData(
            mergeLongTermTaskIntoExtraData(
              JSON.stringify({
                reminder: reminderText || '',
                repeat: repeatText || '',
                schedule: scheduleMeta,
              }),
              isLongTermTask,
            ),
            normalizeRewardPoints(rewardPointsText),
          ),
        });
        try {
          const hostProject = await getProjectById(quickProjectId);
          if (hostProject) {
            const cleared = clearProjectFrogFields(hostProject.extra_data);
            if (cleared !== hostProject.extra_data) {
              await updateProject(quickProjectId, { extra_data: cleared });
            }
          }
        } catch (clearErr) {
          console.warn('清除空项目青蛙指派失败', clearErr);
        }
        try {
          await markPendingTablesDirty(['tasks', 'projects']);
          await pushLocalChangesToApi({ awaitSync: true, rethrow: true });
        } catch (syncErr) {
          console.warn('任务保存后同步到服务器失败', syncErr);
        }
        notifyAncestorsDataChanged();
        router.back();
      } catch (error) {
        console.warn('创建任务失败', error);
        Alert.alert('保存失败', formatWriteError(error, '任务未能写入，请稍后重试。'));
      } finally {
        setIsSubmitting(false);
      }
      return;
    }
    setAddTaskResult({
      source: scheduleSource,
      task: {
        id: makeTimestampEntityId('tsk_', 8),
        title: trimmedTitle,
        done: false,
        deadline: deadlineText,
        deadlineText: deadlineText,
        reminder: reminderText,
        reminderText: reminderText,
        repeat: repeatText,
        repeatText: repeatText,
        note: null,
        acceptanceCriteria: acceptanceCriteria.trim(),
        schedule: scheduleMeta,
        isLongTermTask,
      },
    });
    router.back();
  };

  const topSubtitle = isStandalone
    ? '不挂项目 · 仍可与日程、提醒同步'
    : projectName
      ? `归属 · ${projectName}`
      : undefined;
  const screenTitle = isEditStandalone ? '编辑待办' : isStandalone ? '新建待办' : '新建任务';
  const formBusy = isSubmitting || loadingEdit;

  const removeStandaloneTodo = React.useCallback(() => {
    if (!editTaskId || formBusy) return;
    const titleLabel = title.trim() || '该待办';
    Alert.alert('删除待办', `确定删除「${titleLabel}」吗？（若有子任务会一并删除）`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          try {
            setIsSubmitting(true);
            await deleteTask(editTaskId);
            try {
              await markPendingTablesDirty(['tasks']);
              await pushLocalChangesToApi({ awaitSync: true, rethrow: true });
            } catch (syncErr) {
              console.warn('待办删除后同步到服务器失败', syncErr);
            }
            notifyAncestorsDataChanged();
            router.back();
          } catch (error) {
            console.warn('删除待办失败', error);
            Alert.alert('删除失败', formatWriteError(error, '待办删除失败，请稍后重试。'));
          } finally {
            setIsSubmitting(false);
          }
        },
      },
    ]);
  }, [editTaskId, formBusy, notifyAncestorsDataChanged, router, title]);

  const panelBorder = isDark ? 'rgba(148,163,184,0.22)' : 'rgba(194,198,214,0.65)';
  const panelBg = isDark ? 'rgba(30,41,59,0.45)' : colors.surface;
  const fieldBg = isDark ? 'rgba(15,23,42,0.45)' : colors.input;
  const divider = isDark ? 'rgba(148,163,184,0.16)' : 'rgba(226,232,240,0.95)';

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['left', 'right', 'bottom']}>
      <ComposerTopBar
        title={screenTitle}
        subtitle={topSubtitle}
        onBack={() => router.back()}
        onSubmit={() => void handleCreateTask()}
        submitting={formBusy}
        submitLabel={isStandalone ? '保存' : '创建'}
      />

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView
          refreshControl={refreshControl}
          contentContainerStyle={[
            styles.content,
            { paddingBottom: 48 + Math.max(insets.bottom, 12) },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          {loadingEdit ? (
            <View style={styles.editLoading}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text style={[styles.loadingText, { color: colors.textSecondary }]}>加载待办…</Text>
            </View>
          ) : (
            <>
              <View style={[styles.panel, { backgroundColor: panelBg, borderColor: panelBorder }]}>
                <Text style={[styles.panelTitle, { color: colors.text }]}>概要</Text>
                <TextInput
                  value={title}
                  onChangeText={handleTitleChange}
                  placeholder={isStandalone ? '写下待办名称…' : '写下任务名称…'}
                  placeholderTextColor={colors.textMuted}
                  multiline
                  maxLength={titleMaxLength}
                  style={[styles.titleInput, { color: colors.text }]}
                />
                <Text style={[styles.charCounter, { color: colors.textSecondary }]}>
                  {title.length}/{titleMaxLength}
                </Text>

                {isStandalone ? (
                  <>
                    <View style={[styles.panelDivider, { backgroundColor: divider }]} />
                    <View style={styles.standaloneIntentRow}>
                      <Pressable
                        onPress={() => setStandaloneIntent('active')}
                        accessibilityRole="button"
                        accessibilityState={{ selected: standaloneIntent === 'active' }}
                        style={({ pressed }) => [
                          styles.standaloneIntentChip,
                          {
                            backgroundColor:
                              standaloneIntent === 'active' ? `${colors.primary}18` : fieldBg,
                            borderColor:
                              standaloneIntent === 'active' ? colors.primary : 'transparent',
                            opacity: pressed ? 0.88 : 1,
                          },
                        ]}>
                        <MaterialIcons
                          name="radio-button-checked"
                          size={18}
                          color={standaloneIntent === 'active' ? colors.primary : colors.textSecondary}
                        />
                        <Text
                          style={[
                            styles.standaloneIntentChipText,
                            { color: standaloneIntent === 'active' ? colors.primary : colors.text },
                          ]}>
                          正常待办
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={() => setStandaloneIntent('shelved')}
                        accessibilityRole="button"
                        accessibilityState={{ selected: standaloneIntent === 'shelved' }}
                        style={({ pressed }) => [
                          styles.standaloneIntentChip,
                          {
                            backgroundColor:
                              standaloneIntent === 'shelved' ? `${colors.secondary}22` : fieldBg,
                            borderColor:
                              standaloneIntent === 'shelved' ? colors.secondary : 'transparent',
                            opacity: pressed ? 0.88 : 1,
                          },
                        ]}>
                        <MaterialIcons
                          name="inventory-2"
                          size={18}
                          color={
                            standaloneIntent === 'shelved' ? colors.secondary : colors.textSecondary
                          }
                        />
                        <Text
                          style={[
                            styles.standaloneIntentChipText,
                            {
                              color: standaloneIntent === 'shelved' ? colors.secondary : colors.text,
                            },
                          ]}>
                          暂时搁置
                        </Text>
                      </Pressable>
                    </View>
                    {standaloneIntent === 'shelved' ? (
                      <Text style={[styles.standaloneShelvedHint, { color: colors.textSecondary }]}>
                        搁置项会留在待办栏，不能勾选完成；需要时在卡片右侧点「激活」并确认后变为正常待办。
                      </Text>
                    ) : null}
                  </>
                ) : null}

                {isStandalone ? (
                  <View style={styles.fieldBlock}>
                    <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>标签</Text>
                    <ProjectTagPickerField
                      selectedIds={selectedTagIds}
                      allTags={allTags}
                      loading={tagsLoading}
                      onChange={setSelectedTagIds}
                      textColor={colors.text}
                      outline={colors.textSecondary}
                      placeholderColor={colors.textMuted}
                      primary={colors.primary}
                      surfaceLow={colors.input}
                      surfaceLowest={colors.surfaceSubtle}
                      isDark={isDark}
                    />
                  </View>
                ) : null}
              </View>

              {isStandalone ? (
                <View style={[styles.panel, { backgroundColor: panelBg, borderColor: panelBorder }]}>
                  <Text style={[styles.panelTitle, { color: colors.text }]}>优先级</Text>
                  <ComposerPriorityMatrix value={priority} onChange={setPriority} />
                </View>
              ) : null}

              {!isStandalone || standaloneIntent === 'active' ? (
                <View style={[styles.panel, { backgroundColor: panelBg, borderColor: panelBorder }]}>
                  <Text style={[styles.panelTitle, { color: colors.text }]}>日程</Text>
                  <Pressable
                    onPress={openSchedulePicker}
                    style={({ pressed }) => [
                      styles.scheduleRow,
                      { backgroundColor: fieldBg, opacity: pressed ? 0.85 : 1 },
                    ]}>
                    <View style={[styles.scheduleIcon, { backgroundColor: colors.surfaceSubtle }]}>
                      <MaterialIcons name="event-note" size={20} color={colors.primary} />
                    </View>
                    <View style={styles.scheduleBody}>
                      <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>时间安排</Text>
                      <Text style={[styles.fieldValue, { color: colors.text }]}>
                        {deadlineText || '未设置'}
                      </Text>
                      {!!(reminderText || repeatText) && (
                        <View style={styles.tagRow}>
                          {!!reminderText && (
                            <View
                              style={[
                                styles.metaTag,
                                { backgroundColor: colors.surfaceSubtle, borderColor: colors.outline },
                              ]}>
                              <MaterialIcons name="notifications-active" size={13} color={colors.primary} />
                              <Text style={[styles.metaTagText, { color: colors.text }]}>{reminderText}</Text>
                            </View>
                          )}
                          {!!repeatText && (
                            <View
                              style={[
                                styles.metaTag,
                                { backgroundColor: colors.surfaceSubtle, borderColor: colors.outline },
                              ]}>
                              <MaterialIcons name="repeat" size={13} color={colors.primary} />
                              <Text style={[styles.metaTagText, { color: colors.text }]}>{repeatText}</Text>
                            </View>
                          )}
                        </View>
                      )}
                    </View>
                    <MaterialIcons name="chevron-right" size={20} color={colors.textSecondary} />
                  </Pressable>
                </View>
              ) : null}

              <View style={[styles.panel, { backgroundColor: panelBg, borderColor: panelBorder }]}>
                <Text style={[styles.panelTitle, { color: colors.text }]}>更多</Text>
                {!isStandalone ? (
                  <Pressable
                    onPress={() => setIsLongTermTask((v) => !v)}
                    accessibilityRole="switch"
                    accessibilityState={{ checked: isLongTermTask }}
                    style={({ pressed }) => [
                      styles.longTermRow,
                      {
                        backgroundColor: isLongTermTask ? `${colors.primary}12` : fieldBg,
                        borderColor: isLongTermTask ? colors.primary : 'transparent',
                        opacity: pressed ? 0.88 : 1,
                      },
                    ]}>
                    <View style={styles.longTermTextWrap}>
                      <Text style={[styles.longTermTitle, { color: colors.text }]}>长期任务</Text>
                      <Text style={[styles.longTermHint, { color: colors.textSecondary }]}>
                        指派为青蛙后，完成时可仅结束今日会话
                      </Text>
                    </View>
                    <MaterialIcons
                      name={isLongTermTask ? 'check-box' : 'check-box-outline-blank'}
                      size={22}
                      color={isLongTermTask ? colors.primary : colors.textSecondary}
                    />
                  </Pressable>
                ) : null}

                <View style={styles.fieldBlock}>
                  <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>奖励积分</Text>
                  <View style={[styles.rewardPointsWrap, { backgroundColor: fieldBg }]}>
                    <TextInput
                      value={rewardPointsText}
                      onChangeText={setRewardPointsText}
                      placeholder="0"
                      placeholderTextColor={colors.textMuted}
                      keyboardType="numbers-and-punctuation"
                      style={[styles.rewardPointsInput, { color: colors.text }]}
                    />
                  </View>
                  <Text style={[styles.longTermHint, { color: colors.textSecondary }]}>
                    完成后计入；负数扣除，可含小数；0 无变动
                  </Text>
                </View>

                <View style={styles.fieldBlock}>
                  <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>验收标准</Text>
                  <View style={[styles.notesWrap, { backgroundColor: fieldBg }]}>
                    <TextInput
                      value={acceptanceCriteria}
                      onChangeText={setAcceptanceCriteria}
                      placeholder="怎样算完成？（可选）"
                      placeholderTextColor={colors.textMuted}
                      multiline
                      textAlignVertical="top"
                      style={[styles.notesInput, { color: colors.text }]}
                    />
                  </View>
                </View>

                {isEditStandalone ? (
                  <Pressable
                    onPress={removeStandaloneTodo}
                    disabled={formBusy}
                    accessibilityRole="button"
                    accessibilityLabel="删除待办"
                    style={({ pressed }) => [
                      styles.deleteBtn,
                      {
                        borderColor: isDark ? 'rgba(248,113,113,0.45)' : 'rgba(186,26,26,0.35)',
                        opacity: formBusy ? 0.55 : pressed ? 0.8 : 1,
                      },
                    ]}>
                    <MaterialIcons
                      name="delete-outline"
                      size={18}
                      color={isDark ? '#f87171' : '#ba1a1a'}
                    />
                    <Text style={[styles.deleteText, { color: isDark ? '#f87171' : '#ba1a1a' }]}>
                      删除待办
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            </>
          )}
        </ScrollView>

        <Modal transparent visible={mainTaskOpen} animationType="fade" onRequestClose={() => setMainTaskOpen(false)}>
          <Pressable style={styles.mainTaskOverlay} onPress={() => setMainTaskOpen(false)}>
            <Pressable
              onPress={() => {}}
              style={[
                styles.mainTaskSheet,
                {
                  backgroundColor: colors.background,
                  borderColor: colors.outline,
                },
              ]}>
              <View style={[styles.mainTaskHandle, { backgroundColor: colors.outline }]} />

              <View style={styles.mainTaskHead}>
                <Text style={[styles.mainTaskHeadTitle, { color: colors.text }]}>关联主任务</Text>
                <Pressable
                  onPress={() => setMainTaskOpen(false)}
                  style={[styles.mainTaskCloseBtn, { backgroundColor: colors.surfaceMuted }]}>
                  <MaterialIcons name="close" size={16} color={colors.textSecondary} />
                </Pressable>
              </View>

              <View style={[styles.mainTaskSearchWrap, { backgroundColor: colors.input }]}>
                <MaterialIcons name="search" size={20} color={colors.textSecondary} />
                <TextInput
                  value={mainTaskQuery}
                  onChangeText={setMainTaskQuery}
                  placeholder="搜索已有主任务..."
                  placeholderTextColor={colors.textMuted}
                  style={[styles.mainTaskSearchInput, { color: colors.text }]}
                />
              </View>

              <ScrollView style={styles.mainTaskList} contentContainerStyle={{ gap: 10 }} showsVerticalScrollIndicator={false}>
                {filteredMainTasks.map((item) => {
                  const active = selectedMainTaskId === item.id;
                  return (
                    <Pressable
                      key={item.id}
                      onPress={() => setSelectedMainTaskId(item.id)}
                      style={({ pressed }) => [
                        styles.mainTaskItem,
                        {
                          backgroundColor: colors.surface,
                          borderColor: active ? `${colors.primary}44` : colors.outline,
                        },
                        pressed && { opacity: 0.86 },
                      ]}>
                      <View style={[styles.mainTaskRadio, { borderColor: active ? colors.primary : colors.outline }]}>
                        {active ? <View style={[styles.mainTaskRadioInner, { backgroundColor: colors.primary }]} /> : null}
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.mainTaskItemTitle, { color: colors.text }]}>{item.title}</Text>
                        <Text style={[styles.mainTaskItemDue, { color: colors.textSecondary }]}>{item.due}</Text>
                      </View>
                    </Pressable>
                  );
                })}
              </ScrollView>

              <Pressable
                onPress={() => setMainTaskOpen(false)}
                style={({ pressed }) => [
                  styles.mainTaskConfirmBtn,
                  { backgroundColor: colors.primary },
                  pressed && { opacity: 0.9 },
                ]}>
                <Text style={[styles.mainTaskConfirmText, { color: colors.onPrimary }]}>确认关联</Text>
              </Pressable>
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
  content: {
    paddingHorizontal: 14,
    paddingTop: 14,
    gap: 12,
    maxWidth: 560,
    width: '100%',
    alignSelf: 'center',
  },
  panel: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    padding: 14,
    gap: 12,
  },
  panelTitle: { fontSize: 15, fontWeight: '700', letterSpacing: -0.2 },
  panelDivider: { height: StyleSheet.hairlineWidth, marginVertical: 2 },
  titleInput: { padding: 0, fontSize: 22, fontWeight: '700', lineHeight: 28, minHeight: 56 },
  charCounter: { alignSelf: 'flex-end', fontSize: 11, fontWeight: '500' },
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
  scheduleBody: { flex: 1, gap: 4, minWidth: 0 },
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
  editLoading: {
    paddingVertical: Spacing['6xl'],
    alignItems: 'center',
    gap: Spacing.xl,
  },
  loadingText: { fontSize: 12, fontWeight: '500' },
  standaloneIntentRow: {
    flexDirection: 'row',
    gap: 8,
  },
  standaloneIntentChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  standaloneIntentChipText: {
    fontSize: 13,
    fontWeight: '600',
  },
  standaloneShelvedHint: {
    fontSize: 12,
    lineHeight: 17,
  },
  deleteBtn: {
    width: '100%',
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
    marginTop: 4,
  },
  deleteText: { fontSize: 14, fontWeight: '600' },
  longTermRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  longTermTextWrap: {
    flex: 1,
    gap: 3,
  },
  longTermTitle: { fontSize: 14, fontWeight: '600' },
  longTermHint: { fontSize: 12, lineHeight: 16 },
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
  notesWrap: { borderRadius: 10, padding: 12, minHeight: 100 },
  notesInput: { minHeight: 76, fontSize: 14, fontWeight: '500', lineHeight: 20 },
  mainTaskOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  mainTaskSheet: {
    borderTopLeftRadius: Radius.sheet,
    borderTopRightRadius: Radius.sheet,
    borderWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: 0,
    paddingHorizontal: Layout.pagePaddingX,
    paddingBottom: Spacing['4xl'],
    maxHeight: '85%',
    gap: Spacing.lg,
  },
  mainTaskHandle: {
    width: 32,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: Spacing.xl,
  },
  mainTaskHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  mainTaskHeadTitle: { fontSize: 17, fontWeight: '700' },
  mainTaskCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: Radius.icon,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mainTaskSearchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.lg,
  },
  mainTaskSearchInput: {
    flex: 1,
    paddingVertical: 0,
    fontSize: 15,
  },
  mainTaskList: {
    maxHeight: 320,
  },
  mainTaskItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xl,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing['2xl'],
    paddingVertical: Spacing['2xl'],
  },
  mainTaskRadio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mainTaskRadioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  mainTaskItemTitle: {
    marginBottom: 2,
    fontSize: 15,
    fontWeight: '600',
  },
  mainTaskItemDue: { fontSize: 12 },
  mainTaskConfirmBtn: {
    marginTop: Spacing.sm,
    borderRadius: Radius.lg,
    paddingVertical: Spacing['2xl'],
    alignItems: 'center',
    justifyContent: 'center',
  },
  mainTaskConfirmText: { fontSize: 15, fontWeight: '700' },
});

