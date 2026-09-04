import {
    ComposerEditorialCard,
    ComposerHero,
    ComposerMain,
    ComposerNoteSection,
    ComposerPriorityMatrix,
    ComposerScheduleSection,
    ComposerSection,
    ComposerSectionHead,
    ComposerTopBar,
    composerStyles,
    taskPriorityLabel,
    type TaskPriorityKey,
} from '@/components/composer';
import { Layout, Radius, Spacing, Typography } from '@/constants/design-tokens';
import { useAppTheme } from '@/hooks/use-app-theme';
import { usePageApiSync, usePagePullRefresh } from '@/hooks/use-page-api-sync';
import { setAddTaskResult } from '@/lib/add-task-bridge';
import { markPendingTablesDirty } from '@/lib/api-incremental-sync';
import { pushLocalChangesToApi } from '@/lib/api-write-sync';
import { makeTimestampEntityId } from '@/lib/entity-id';
import { formatWriteError } from '@/lib/format-write-error';
import { clearProjectFrogFields } from '@/lib/frog-assignment';
import { mergeLongTermTaskIntoExtraData } from '@/lib/long-term-task';
import {
  mergeRewardPointsIntoExtraData,
  normalizeRewardPoints,
  parseRewardPointsFromExtraData,
} from '@/lib/reward-points';
import { AppInput } from '@/components/ui';
import { INBOX_PROJECT_CATEGORY_ID } from '@/lib/repositories/projects/constants';
import { getProjectById, updateProject } from '@/lib/repositories/projects/project';
import { ensureLocalRowForWrite } from '@/lib/api-local-row';
import { createTask, deleteTask, updateTask } from '@/lib/repositories/tasks/task';
import type { TaskPriority, TaskRow } from '@/lib/repositories/tasks/task.types';
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
  note?: string;
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
  const [notes, setNotes] = React.useState('');
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
  /** 独立待办：正常待办 vs 暂时搁置（时间未定，不可直接完成） */
  const [standaloneIntent, setStandaloneIntent] = React.useState<'active' | 'shelved'>('active');
  const [loadingEdit, setLoadingEdit] = React.useState(false);
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
    setAcceptanceCriteria(task.description ?? '');
    setNotes(task.note ?? '');
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
        } else {
          setProjectName(null);
        }
      }, forceApi);
    },
    [applyLoadedStandaloneTask, editTaskId, isEditStandalone, quickProjectId, router, wrapLoad],
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
            note: notes.trim() || null,
            status: resolveStandaloneStatusOnSave(editTaskStatusRef.current, standaloneIntent),
            priority: labelToTaskPriority(priorityLabel),
            due_date: dueDate,
            extra_data: extraPayload,
          });
        } else {
          const id = makeTimestampEntityId('tsk_', 8);
          await createTask({
            id,
            project_id: null,
            category_id: null,
            parent_task_id: null,
            title: trimmedTitle,
            description: trimmedAcceptanceCriteria,
            note: notes.trim() || null,
            status: shelved ? 'shelved' : 'todo',
            priority: labelToTaskPriority(priorityLabel),
            due_date: dueDate,
            extra_data: extraPayload,
          });
        }
        try {
          await markPendingTablesDirty(['tasks']);
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
          note: notes.trim() || null,
          status: 'todo',
          priority: labelToTaskPriority(priorityLabel),
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
        priority: priorityLabel,
        priorityLabel: priorityLabel,
        deadline: deadlineText,
        deadlineText: deadlineText,
        reminder: reminderText,
        reminderText: reminderText,
        repeat: repeatText,
        repeatText: repeatText,
        note: notes.trim(),
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

  return (
    <SafeAreaView style={[composerStyles.container, { backgroundColor: colors.background }]} edges={['left', 'right', 'bottom']}>
      <ComposerTopBar
        title={screenTitle}
        subtitle={topSubtitle}
        onBack={() => router.back()}
        onSubmit={() => void handleCreateTask()}
        submitting={formBusy}
        submitLabel={isStandalone ? '保存' : '创建'}
      />

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={composerStyles.flex}>
        <ScrollView
          refreshControl={refreshControl}
          contentContainerStyle={[
            composerStyles.content,
            { paddingBottom: Spacing['6xl'] + Math.max(insets.bottom, Spacing.md) },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          {loadingEdit ? (
            <View style={styles.editLoading}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text style={[Typography.caption, { color: colors.textSecondary }]}>加载待办…</Text>
            </View>
          ) : (
          <ComposerMain>
            <ComposerHero
              badgeIcon="task-alt"
              kicker={isStandalone && standaloneIntent === 'shelved' ? '先记下来，以后再安排' : '今天要完成什么？'}
              placeholder={isStandalone ? '写下待办名称…' : '写下任务名称…'}
              value={title}
              onChangeText={handleTitleChange}
              maxLength={titleMaxLength}
            />

            {isStandalone ? (
              <View style={styles.standaloneIntentRow}>
                <Pressable
                  onPress={() => setStandaloneIntent('active')}
                  accessibilityRole="button"
                  accessibilityState={{ selected: standaloneIntent === 'active' }}
                  style={({ pressed }) => [
                    styles.standaloneIntentChip,
                    {
                      backgroundColor: standaloneIntent === 'active' ? `${colors.primary}18` : colors.surfaceMuted,
                      borderColor: standaloneIntent === 'active' ? colors.primary : colors.outline,
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
                      backgroundColor: standaloneIntent === 'shelved' ? `${colors.secondary}22` : colors.surfaceMuted,
                      borderColor: standaloneIntent === 'shelved' ? colors.secondary : colors.outline,
                      opacity: pressed ? 0.88 : 1,
                    },
                  ]}>
                  <MaterialIcons
                    name="inventory-2"
                    size={18}
                    color={standaloneIntent === 'shelved' ? colors.secondary : colors.textSecondary}
                  />
                  <Text
                    style={[
                      styles.standaloneIntentChipText,
                      { color: standaloneIntent === 'shelved' ? colors.secondary : colors.text },
                    ]}>
                    暂时搁置
                  </Text>
                </Pressable>
              </View>
            ) : null}

            {isStandalone && standaloneIntent === 'shelved' ? (
              <Text style={[styles.standaloneShelvedHint, { color: colors.textSecondary }]}>
                搁置项会留在待办栏，不能勾选完成；需要时在卡片右侧点「激活」并确认后变为正常待办。
              </Text>
            ) : null}

            <ComposerPriorityMatrix value={priority} onChange={setPriority} />

            {!isStandalone || standaloneIntent === 'active' ? (
              <ComposerSection>
                <ComposerScheduleSection
                  deadlineText={deadlineText}
                  reminderText={reminderText}
                  repeatText={repeatText}
                  onPress={openSchedulePicker}
                />
              </ComposerSection>
            ) : null}

            {!isStandalone ? (
              <ComposerSection>
                <ComposerSectionHead
                  accentColor={colors.primary}
                  title="长期任务"
                  description="指派为青蛙后，完成时可仅结束今日会话"
                  rightIcon="timeline"
                />
                <ComposerEditorialCard>
                  <Pressable
                    onPress={() => setIsLongTermTask((v) => !v)}
                    accessibilityRole="switch"
                    accessibilityState={{ checked: isLongTermTask }}
                    style={({ pressed }) => [
                      styles.longTermRow,
                      {
                        backgroundColor: isLongTermTask ? `${colors.primary}12` : colors.surfaceSubtle,
                        borderColor: isLongTermTask ? colors.primary : colors.outline,
                        opacity: pressed ? 0.88 : 1,
                      },
                    ]}>
                    <View style={styles.longTermTextWrap}>
                      <Text style={[Typography.bodyStrong, { color: colors.text }]}>标记为长期任务</Text>
                      <Text style={[Typography.caption, { color: colors.textSecondary }]}>
                        完成青蛙时会询问是否已完成整个任务
                      </Text>
                    </View>
                    <MaterialIcons
                      name={isLongTermTask ? 'check-box' : 'check-box-outline-blank'}
                      size={24}
                      color={isLongTermTask ? colors.primary : colors.textSecondary}
                    />
                  </Pressable>
                </ComposerEditorialCard>
              </ComposerSection>
            ) : null}

            <ComposerSection>
              <ComposerSectionHead
                accentColor={colors.tertiary}
                title="奖励积分"
                description="完成任务后计入心愿板积分；负数表示扣除，可含小数；0 表示无变动"
                rightIcon="stars"
              />
              <ComposerEditorialCard>
                <AppInput
                  label="奖励积分"
                  value={rewardPointsText}
                  onChangeText={setRewardPointsText}
                  placeholder="0"
                  keyboardType="numbers-and-punctuation"
                  inputWrapStyle={styles.rewardPointsWrap}
                />
              </ComposerEditorialCard>
            </ComposerSection>

            <ComposerNoteSection
              value={acceptanceCriteria}
              onChangeText={setAcceptanceCriteria}
              title="验收标准"
              placeholder="怎样算完成？可写可验证的标准…（可选）"
            />

            <ComposerNoteSection
              value={notes}
              onChangeText={setNotes}
              placeholder="背景信息、协作人、链接…（可选）"
            />

            {isEditStandalone ? (
              <View style={[styles.pageFooter, { borderTopColor: colors.outline }]}>
                <Pressable
                  onPress={removeStandaloneTodo}
                  disabled={formBusy}
                  accessibilityRole="button"
                  accessibilityLabel="删除待办"
                  style={({ pressed }) => [
                    styles.deleteBtn,
                    {
                      backgroundColor: pressed ? '#991b1b' : '#ba1a1a',
                      opacity: formBusy ? 0.7 : 1,
                    },
                    pressed && { transform: [{ scale: 0.98 }] },
                  ]}>
                  <MaterialIcons name="delete-outline" size={22} color="#fff" />
                  <Text style={styles.deleteText}>删除待办</Text>
                </Pressable>
              </View>
            ) : null}
          </ComposerMain>
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
                <Text style={[Typography.h3, { color: colors.text }]}>关联主任务</Text>
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
                  style={[Typography.body, styles.mainTaskSearchInput, { color: colors.text }]}
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
                        <Text style={[Typography.bodyStrong, styles.mainTaskItemTitle, { color: colors.text }]}>{item.title}</Text>
                        <Text style={[Typography.caption, { color: colors.textSecondary }]}>{item.due}</Text>
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
                <Text style={[Typography.bodyStrong, { color: colors.onPrimary }]}>确认关联</Text>
              </Pressable>
            </Pressable>
          </Pressable>
        </Modal>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  editLoading: {
    paddingVertical: Spacing['6xl'],
    alignItems: 'center',
    gap: Spacing.xl,
  },
  standaloneIntentRow: {
    flexDirection: 'row',
    gap: Spacing.md,
  },
  standaloneIntentChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.xl,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.lg,
    borderWidth: 1,
  },
  standaloneIntentChipText: {
    fontSize: 14,
    fontWeight: '600',
  },
  standaloneShelvedHint: {
    fontSize: 13,
    lineHeight: 20,
    marginTop: -Spacing.sm,
  },
  pageFooter: {
    marginTop: Spacing['4xl'],
    paddingTop: Spacing['4xl'],
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  deleteBtn: {
    width: '100%',
    paddingVertical: Spacing.xl,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: Spacing.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.14,
    shadowRadius: 20,
    elevation: 8,
  },
  deleteText: { color: '#fff', fontSize: 18, fontWeight: '900', letterSpacing: -0.2 },
  longTermRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
    padding: Spacing.lg,
    borderRadius: Radius.lg,
    borderWidth: 1,
  },
  longTermTextWrap: {
    flex: 1,
    gap: Spacing.xs,
  },
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
  },
  mainTaskConfirmBtn: {
    marginTop: Spacing.sm,
    borderRadius: Radius.lg,
    paddingVertical: Spacing['2xl'],
    alignItems: 'center',
    justifyContent: 'center',
  },
  rewardPointsWrap: {
    minHeight: 40,
    paddingVertical: Spacing.md,
  },
});

