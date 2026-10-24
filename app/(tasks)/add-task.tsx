import {
    ComposerTopBar,
    taskPriorityKeyToNumber,
    taskPriorityLabel,
    taskPriorityToKey,
    type TaskPriorityKey,
} from '@/components/composer';
import {
  clampTitle,
  ENTITY_TITLE_MAX,
  useComposerSchedule,
  validateRequiredTitle,
} from '@/components/entity-form';
import {
  FoldRiseIn,
  useFoldMotionGate,
} from '@/components/review/fold-motion';
import { TaskFoldPriorityGrid } from '@/components/tasks/task-fold-priority-grid';
import { TaskFoldSwitch } from '@/components/tasks/task-fold-switch';
import { TaskFoldMotion, useTaskFoldTheme } from '@/constants/task-fold-theme';
import { useAppTheme } from '@/hooks/use-app-theme';
import { usePageApiSync, usePagePullRefresh } from '@/hooks/use-page-api-sync';
import { setAddTaskResult } from '@/lib/add-task-bridge';
import { markPendingTablesDirty } from '@/lib/api-incremental-sync';
import { requestPush } from '@/lib/sync-manager';
import { makeTimestampEntityId } from '@/lib/entity-id';
import { toast } from '@/lib/app-feedback';
import { formatWriteError } from '@/lib/format-write-error';
import { clearProjectFrogFields } from '@/lib/frog-assignment';
import { mergeLongTermTaskIntoExtraData } from '@/lib/long-term-task';
import { resolveAcceptanceCriteria } from '@/lib/acceptance-criteria';
import {
  mergeRewardPointsIntoExtraData,
  normalizeRewardPoints,
  parseRewardPointsFromExtraData,
} from '@/lib/reward-points';
import {
  canEnableAutoPlaceIntoSchedule,
  parseAutoPlaceIntoSchedule,
} from '@/lib/schedule/task-virtual-placement';
import { ProjectTagPickerField } from '@/components/projects/ProjectTagPickerField';
import { EntityIconPickerField } from '@/components/tasks/EntityIconPickerField';
import {
  DEFAULT_TODO_ICON,
  mergeIconIntoExtraData,
  parseIconFromExtraData,
} from '@/lib/constants/entity-icon-choices';
import { INBOX_PROJECT_CATEGORY_ID } from '@/lib/repositories/projects/constants';
import { getProjectById, updateProject } from '@/lib/repositories/projects/project';
import { ensureLocalRowForWrite } from '@/lib/api-local-row';
import { createTask, deleteTask, updateTask } from '@/lib/repositories/tasks/task';
import type { TaskPriority, TaskRow, TaskStatus } from '@/lib/repositories/tasks/task.types';
import {
  getTagIdsByEntity,
  getTagIdsByProjectId,
  getProjectTags,
  getTagsByProjectId,
  setTaskTagIds,
} from '@/lib/repositories/tags/tag';
import type { TagRow } from '@/lib/repositories/tags/tag.types';
import {
    extractScheduleLimitFromExtra,
    formatDate,
    parseDateLimitParam,
    parseDefaultScheduleParam,
    projectDefinesSchedule,
    resolveInheritedDefaultSchedule,
} from '@/lib/schedule-inherit';
import { normalizeRouteParam, type SchedulePickerResult, type PickedScheduleMeta } from '@/lib/schedule-picker-bridge';
import { isStandaloneTodoTask } from '@/lib/standalone-todo-task';
import { getDayBoundarySync, getLogicalLocalYmd } from '@/lib/tasks-logical-day';
import { MaterialIcons } from '@expo/vector-icons';
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

type TaskScheduleMeta = PickedScheduleMeta;
const STANDALONE_SCHEDULE_SOURCE = 'add-standalone-todo';

function firstRouteParam(value: string | string[] | undefined): string {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0].trim();
  return '';
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

function parseStandaloneTaskScheduleMeta(extraData: string | null): TaskScheduleMeta | null {
  if (!extraData) return null;
  try {
    const parsed = JSON.parse(extraData) as { schedule?: TaskScheduleMeta };
    return parsed?.schedule ?? null;
  } catch {
    return null;
  }
}

function resolveStandaloneStatusOnSave(
  previous: string,
  intent: 'active' | 'shelved',
): TaskStatus {
  if (intent === 'shelved') return 'shelved';
  if (previous === 'done' || previous === 'cancelled' || previous === 'doing' || previous === 'blocked') {
    return previous as TaskStatus;
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
    lockSchedule?: string;
    projectId?: string;
    categoryId?: string;
    standalone?: string;
    id?: string;
  }>();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useAppTheme();
  const { tf, fonts } = useTaskFoldTheme();
  const { animate: foldAnimate } = useFoldMotionGate();
  const titleInputRef = React.useRef<React.ElementRef<typeof TextInput>>(null);

  const [title, setTitle] = React.useState('');
  const [entityIcon, setEntityIcon] = React.useState(DEFAULT_TODO_ICON);
  const [acceptanceCriteria, setAcceptanceCriteria] = React.useState('');
  const [note, setNote] = React.useState('');
  const [rewardPointsText, setRewardPointsText] = React.useState('0');
  const [priority, setPriority] = React.useState<TaskPriorityKey>('not-urgent-not-important');
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [isLongTermTask, setIsLongTermTask] = React.useState(false);
  const [autoPlaceIntoSchedule, setAutoPlaceIntoSchedule] = React.useState(false);
  const [switchBounceToken, setSwitchBounceToken] = React.useState(0);
  const [projectName, setProjectName] = React.useState<string | null>(null);
  /** 独立待办：正常待办 vs 暂时搁置（时间未定，不可直接完成） */
  const [standaloneIntent, setStandaloneIntent] = React.useState<'active' | 'shelved'>('active');
  const [loadingEdit, setLoadingEdit] = React.useState(false);
  const [selectedTagIds, setSelectedTagIds] = React.useState<string[]>([]);
  const [allTags, setAllTags] = React.useState<TagRow[]>([]);
  const [tagsLoading, setTagsLoading] = React.useState(false);
  const [inheritsProjectSchedule, setInheritsProjectSchedule] = React.useState(false);
  const [inheritsProjectTags, setInheritsProjectTags] = React.useState(false);
  const editTaskStatusRef = React.useRef<string>('todo');

  const isStandalone =
    firstRouteParam(params.standalone) === '1' || firstRouteParam(params.standalone).toLowerCase() === 'true';
  const editTaskId = isStandalone ? firstRouteParam(params.id) : '';
  const isEditStandalone = isStandalone && !!editTaskId;
  const titleMaxLength = isStandalone ? ENTITY_TITLE_MAX.standaloneTodo : ENTITY_TITLE_MAX.projectTask;

  const quickProjectId = isStandalone ? '' : firstRouteParam(params.projectId);
  const quickCategoryRaw = firstRouteParam(params.categoryId);
  const quickTaskCategoryId =
    !quickCategoryRaw || quickCategoryRaw === INBOX_PROJECT_CATEGORY_ID ? null : quickCategoryRaw;
  const scheduleSource = isEditStandalone
    ? `edit-standalone-todo-${editTaskId}`
    : isStandalone
      ? STANDALONE_SCHEDULE_SOURCE
      : normalizeRouteParam(params.source as string | string[] | undefined) || 'add-task';
  const lockScheduleFromParam =
    firstRouteParam(params.lockSchedule) === '1' ||
    firstRouteParam(params.lockSchedule).toLowerCase() === 'true';
  const dateLimit = React.useMemo(
    () => parseDateLimitParam(typeof params.dateLimit === 'string' ? params.dateLimit : undefined),
    [params.dateLimit],
  );
  const {
    deadlineText,
    reminderText,
    repeatText,
    scheduleMeta,
    applySchedule,
    clearSchedule,
    openSchedulePicker,
    resolveDueDate,
    setDeadlineText,
    setReminderText,
    setRepeatText,
  } = useComposerSchedule({
    source: scheduleSource,
    dateLimit,
    locked: inheritsProjectSchedule,
    onPicked: (picked) => {
      if (isStandalone && isDueYmdToday(extractDueYmdFromSchedulePick(picked))) {
        setPriority('urgent-important');
      }
    },
  });
  const defaultScheduleApplied = React.useRef(false);

  /** 清除重复或去掉具体时间时关掉自动入格 */
  React.useEffect(() => {
    if (!autoPlaceIntoSchedule) return;
    const gate = canEnableAutoPlaceIntoSchedule(scheduleMeta, repeatText);
    if (!gate.ok) setAutoPlaceIntoSchedule(false);
  }, [autoPlaceIntoSchedule, scheduleMeta, repeatText]);

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
          { text: '去设置', onPress: openSchedulePicker },
        ]);
        return;
      }
      Alert.alert('无法开启自动入格', '自动入格需在日程中开启「具体时间」。', [
        { text: '取消', style: 'cancel' },
        { text: '去设置', onPress: openSchedulePicker },
      ]);
      return;
    }
    setAutoPlaceIntoSchedule(true);
  }, [autoPlaceIntoSchedule, openSchedulePicker, repeatText, scheduleMeta]);

  const autoPlaceGate = React.useMemo(
    () => canEnableAutoPlaceIntoSchedule(scheduleMeta, repeatText),
    [repeatText, scheduleMeta],
  );
  const autoPlaceExpand = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    Animated.timing(autoPlaceExpand, {
      toValue: autoPlaceIntoSchedule ? 1 : 0,
      duration: foldAnimate ? TaskFoldMotion.fieldExpand : 120,
      useNativeDriver: false,
    }).start();
  }, [autoPlaceExpand, autoPlaceIntoSchedule, foldAnimate]);

  React.useEffect(() => {
    if (lockScheduleFromParam) setInheritsProjectSchedule(true);
  }, [lockScheduleFromParam]);

  React.useEffect(() => {
    if (defaultScheduleApplied.current || scheduleMeta) return;
    const inherited = resolveInheritedDefaultSchedule(
      parseDefaultScheduleParam(typeof params.defaultSchedule === 'string' ? params.defaultSchedule : undefined),
      dateLimit,
    );
    if (!inherited) return;
    defaultScheduleApplied.current = true;
    applySchedule(inherited);
    if (lockScheduleFromParam) setInheritsProjectSchedule(true);
  }, [applySchedule, dateLimit, lockScheduleFromParam, params.defaultSchedule, scheduleMeta]);

  React.useEffect(() => {
    if (!quickProjectId || defaultScheduleApplied.current || scheduleMeta) return;
    if (params.defaultSchedule || params.dateLimit) return;

    let cancelled = false;
    (async () => {
      try {
        const project = await getProjectById(quickProjectId);
        if (!project || cancelled) return;
        setProjectName(project.name?.trim() || null);
        setPriority(taskPriorityToKey(project.priority ?? 0));
        const limit = extractScheduleLimitFromExtra(project.extra_data, project.due_date);
        const inheritsSchedule = projectDefinesSchedule(project.extra_data, project.due_date);
        setInheritsProjectSchedule(inheritsSchedule);
        const extra = project.extra_data ? (JSON.parse(project.extra_data) as { schedule?: TaskScheduleMeta }) : {};
        const projectSchedule = extra.schedule ?? null;
        const inherited = resolveInheritedDefaultSchedule(projectSchedule, limit.start || limit.end ? limit : null);
        if (!inherited || cancelled || defaultScheduleApplied.current) return;
        defaultScheduleApplied.current = true;
        applySchedule(inherited);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applySchedule, params.dateLimit, params.defaultSchedule, quickProjectId, scheduleMeta]);

  React.useEffect(() => {
    if (isStandalone || !quickProjectId) {
      if (!isStandalone) {
        setInheritsProjectTags(false);
      }
      return;
    }
    let cancelled = false;
    setTagsLoading(true);
    void (async () => {
      try {
        const [tags, projectTagIds] = await Promise.all([
          getProjectTags(),
          getTagIdsByProjectId(quickProjectId),
        ]);
        if (cancelled) return;
        const inheritsTags = projectTagIds.length > 0;
        setInheritsProjectTags(inheritsTags);
        if (inheritsTags) {
          const projectTags = await getTagsByProjectId(quickProjectId);
          if (cancelled) return;
          setAllTags(projectTags);
          setSelectedTagIds(projectTagIds);
        } else {
          setAllTags(tags);
          setSelectedTagIds([]);
        }
      } catch {
        if (!cancelled) {
          setAllTags([]);
          setSelectedTagIds([]);
          setInheritsProjectTags(false);
        }
      } finally {
        if (!cancelled) setTagsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isStandalone, quickProjectId]);

  const priorityLabel = taskPriorityLabel(priority);

  const applyLoadedStandaloneTask = React.useCallback((task: TaskRow) => {
    setTitle(task.title ?? '');
    setEntityIcon(parseIconFromExtraData(task.extra_data, DEFAULT_TODO_ICON));
    setAcceptanceCriteria(resolveAcceptanceCriteria(task.description, task.note));
    setRewardPointsText(String(parseRewardPointsFromExtraData(task.extra_data)));
    setPriority(taskPriorityToKey(task.priority ?? 0));
    editTaskStatusRef.current = task.status;
    setAutoPlaceIntoSchedule(parseAutoPlaceIntoSchedule(task.extra_data));
    const shelved = task.status === 'shelved';
    setStandaloneIntent(shelved ? 'shelved' : 'active');
    if (shelved) {
      clearSchedule();
      setAutoPlaceIntoSchedule(false);
      return;
    }
    const loadedSchedule = parseStandaloneTaskScheduleMeta(task.extra_data);
    if (loadedSchedule) {
      applySchedule(loadedSchedule);
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
    applySchedule(null);
    setDeadlineText(task.due_date ? formatDate(task.due_date) : '');
    setReminderText(reminder);
    setRepeatText(repeat);
  }, [applySchedule, clearSchedule, setDeadlineText, setReminderText, setRepeatText]);

  const reloadAddTaskData = React.useCallback(
    async (forceRefresh = false) => {
      await wrapLoad(async () => {
        if (isStandalone) {
          setTagsLoading(true);
          try {
            setAllTags(await getProjectTags());
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
          if (project) setPriority(taskPriorityToKey(project.priority ?? 0));
        } else {
          setProjectName(null);
        }
      }, forceRefresh);
    },
    [applyLoadedStandaloneTask, editTaskId, isEditStandalone, isStandalone, quickProjectId, router, wrapLoad],
  );

  const { refreshControl } = usePagePullRefresh(PAGE_API_KEY, reloadAddTaskData);

  const handleTitleChange = (text: string) => {
    setTitle(clampTitle(text, titleMaxLength));
  };

  React.useEffect(() => {
    void reloadAddTaskData().catch((e) => console.warn('加载添加任务页数据失败', e));
  }, [reloadAddTaskData]);

  const handleCreateTask = async () => {
    const titleCheck = validateRequiredTitle(title, {
      emptyMessage: isStandalone ? '请先填写待办标题。' : '请输入任务名称后再创建。',
    });
    if (!titleCheck.ok) {
      titleInputRef.current?.focus?.();
      toast.error(isStandalone ? '请输入标题' : '请输入任务名称');
      return;
    }
    const trimmedTitle = titleCheck.title;
    const wantAutoPlace =
      autoPlaceIntoSchedule && (!isStandalone || standaloneIntent === 'active');
    if (wantAutoPlace) {
      const gate = canEnableAutoPlaceIntoSchedule(scheduleMeta, repeatText);
      if (!gate.ok) {
        Alert.alert(
          '无法保存',
          gate.reason === 'no-repeat'
            ? '自动入格需先设置重复规则。'
            : '自动入格需在日程中设置具体时间。',
        );
        return;
      }
    }
    if (isStandalone) {
      try {
        setIsSubmitting(true);
        const shelved = standaloneIntent === 'shelved';
        const dueDate = shelved ? null : resolveDueDate();
        const extraPayload = mergeIconIntoExtraData(
          mergeRewardPointsIntoExtraData(
            shelved
              ? JSON.stringify({ reminder: '', repeat: '', schedule: null })
              : JSON.stringify({
                  reminder: reminderText || '',
                  repeat: repeatText || '',
                  schedule: scheduleMeta,
                  ...(wantAutoPlace ? { autoPlaceIntoSchedule: true } : {}),
                }),
            normalizeRewardPoints(rewardPointsText),
          ),
          entityIcon,
          DEFAULT_TODO_ICON,
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
          // 本地已写入；后台推送即可，勿 awaitSync 阻塞返回列表
          void requestPush();
        } catch (syncErr) {
          console.warn('待办保存后标记同步失败', syncErr);
        }
        notifyAncestorsDataChanged();
        toast.success(editTaskId ? '已保存' : '已创建');
        router.back();
      } catch (error) {
        console.warn('保存待办失败', error);
        toast.error(formatWriteError(error, '请稍后重试。'));
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
          note: note.trim() || null,
          status: 'todo',
          priority: taskPriorityKeyToNumber(priority),
          due_date: resolveDueDate(),
          extra_data: mergeIconIntoExtraData(
            mergeRewardPointsIntoExtraData(
              mergeLongTermTaskIntoExtraData(
                JSON.stringify({
                  reminder: reminderText || '',
                  repeat: repeatText || '',
                  schedule: scheduleMeta,
                  ...(wantAutoPlace ? { autoPlaceIntoSchedule: true } : {}),
                }),
                isLongTermTask,
              ),
              normalizeRewardPoints(rewardPointsText),
            ),
            entityIcon,
            DEFAULT_TODO_ICON,
          ),
        });
        // 项目未贴标签时才保存任务自有标签
        if (!inheritsProjectTags && selectedTagIds.length > 0) {
          await setTaskTagIds(id, selectedTagIds);
        }
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
          await markPendingTablesDirty(['tasks', 'projects', 'tags', 'tag_links']);
          void requestPush();
        } catch (syncErr) {
          console.warn('任务保存后标记同步失败', syncErr);
        }
        notifyAncestorsDataChanged();
        toast.success('已创建');
        router.back();
      } catch (error) {
        console.warn('创建任务失败', error);
        toast.error(formatWriteError(error, '任务未能写入，请稍后重试。'));
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
        note: note.trim() || null,
        acceptanceCriteria: acceptanceCriteria.trim(),
        schedule: scheduleMeta,
        isLongTermTask,
        autoPlaceIntoSchedule: wantAutoPlace,
        icon: entityIcon,
      },
    });
    router.back();
  };

  const topSubtitle = isStandalone
    ? '独立待办 · 不属于项目 · 稍后可升级'
    : projectName
      ? `${projectName} / 新增`
      : inheritsProjectSchedule
        ? '继承项目日程 · 叶子可入格'
        : '项目任务 · 叶子可入格';
  const screenTitle = isEditStandalone ? '编辑待办' : isStandalone ? '新建待办' : '新建任务';
  const formBusy = isSubmitting || loadingEdit;
  const foldCardBg = isDark ? colors.surfaceMuted : 'rgba(255,252,245,0.86)';
  const foldCardBorder = tf.line2;
  const scheduleSummary = [deadlineText || '未设置日程', reminderText, repeatText]
    .filter(Boolean)
    .join(' · ');
  const autoPlacePreviewH = autoPlaceExpand.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 56],
  });
  const rewardN = Math.round(Number(rewardPointsText) || 0);

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
              void requestPush();
            } catch (syncErr) {
              console.warn('待办删除后标记同步失败', syncErr);
            }
            notifyAncestorsDataChanged();
            router.back();
          } catch (error) {
            console.warn('删除待办失败', error);
            toast.error(formatWriteError(error, '待办删除失败，请稍后重试。'));
          } finally {
            setIsSubmitting(false);
          }
        },
      },
    ]);
  }, [editTaskId, formBusy, notifyAncestorsDataChanged, router, title]);

  const bumpReward = (delta: number) => {
    const cur = Number(rewardPointsText);
    const base = Number.isFinite(cur) ? cur : 0;
    setRewardPointsText(String(Math.max(-999, Math.min(999, Math.round(base + delta)))));
  };

  if (isStandalone) {
    const footPad = Math.max(insets.bottom, 12);
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: tf.paper }]} edges={['left', 'right']}>
        <ComposerTopBar
          title={screenTitle}
          subtitle={topSubtitle}
          onBack={() => router.back()}
          onSubmit={() => void handleCreateTask()}
          submitting={formBusy}
          submitLabel="保存"
        />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
          <ScrollView
            refreshControl={refreshControl}
            contentContainerStyle={[styles.foldContent, { paddingBottom: 96 + footPad }]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}>
            {loadingEdit ? (
              <View style={styles.editLoading}>
                <ActivityIndicator size="large" color={tf.frog} />
                <Text style={[styles.loadingText, { color: tf.faint }]}>加载待办…</Text>
              </View>
            ) : (
              <>
                <FoldRiseIn animate={foldAnimate} index={0} duration={520} staggerMs={42} fromY={10} holdHidden={foldAnimate}>
                  <View style={[styles.fcard, { backgroundColor: foldCardBg, borderColor: foldCardBorder }]}>
                    <View style={styles.titleRow}>
                      <EntityIconPickerField
                        compact
                        value={entityIcon}
                        onChange={setEntityIcon}
                        fallback={DEFAULT_TODO_ICON}
                        disabled={formBusy}
                        accessibilityLabel="选择待办图标"
                      />
                      <View style={{ flex: 1 }}>
                        <TextInput
                          ref={titleInputRef}
                          value={title}
                          onChangeText={handleTitleChange}
                          placeholder="写下待办名称…"
                          placeholderTextColor={tf.faint}
                          multiline
                          maxLength={titleMaxLength}
                          style={[styles.foldTitleInput, { color: tf.ink, fontFamily: fonts.serif }]}
                        />
                        <Text style={[styles.charCounter, { color: tf.faint }]}>
                          {title.length}/{titleMaxLength} · 标题必填
                        </Text>
                      </View>
                    </View>
                    <View style={styles.foldChipRow}>
                      <Pressable
                        onPress={() => setStandaloneIntent('active')}
                        accessibilityRole="button"
                        accessibilityState={{ selected: standaloneIntent === 'active' }}
                        style={[
                          styles.fchip,
                          standaloneIntent === 'active' && { backgroundColor: tf.pond, borderColor: tf.pond },
                        ]}>
                        <Text
                          style={[
                            styles.fchipText,
                            { color: standaloneIntent === 'active' ? tf.onPond : '#7C897E' },
                          ]}>
                          正常待办
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={() => setStandaloneIntent('shelved')}
                        accessibilityRole="button"
                        accessibilityState={{ selected: standaloneIntent === 'shelved' }}
                        style={[
                          styles.fchip,
                          standaloneIntent === 'shelved' && { backgroundColor: tf.pond, borderColor: tf.pond },
                        ]}>
                        <Text
                          style={[
                            styles.fchipText,
                            { color: standaloneIntent === 'shelved' ? tf.onPond : '#7C897E' },
                          ]}>
                          暂时搁置
                        </Text>
                      </Pressable>
                    </View>
                    {standaloneIntent === 'shelved' ? (
                      <Text style={[styles.standaloneShelvedHint, { color: tf.faint }]}>
                        搁置项会留在待办栏，不能勾选完成；需要时点「激活」变为正常待办。
                      </Text>
                    ) : null}
                    <View style={{ marginTop: 8 }}>
                      <ProjectTagPickerField
                        selectedIds={selectedTagIds}
                        allTags={allTags}
                        loading={tagsLoading}
                        locked={false}
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
                  </View>
                </FoldRiseIn>

                <FoldRiseIn animate={foldAnimate} index={1} duration={520} staggerMs={42} fromY={10} holdHidden={foldAnimate}>
                  <View style={[styles.fcard, { backgroundColor: foldCardBg, borderColor: foldCardBorder }]}>
                    <TaskFoldPriorityGrid value={priority} onChange={setPriority} />
                  </View>
                </FoldRiseIn>

                {standaloneIntent === 'active' ? (
                  <FoldRiseIn animate={foldAnimate} index={2} duration={520} staggerMs={42} fromY={10} holdHidden={foldAnimate}>
                    <View style={[styles.fcard, { backgroundColor: foldCardBg, borderColor: foldCardBorder }]}>
                      <Pressable
                        onPress={openSchedulePicker}
                        accessibilityRole="button"
                        accessibilityLabel="修改日程"
                        style={({ pressed }) => [
                          styles.calendarbtn,
                          {
                            borderColor: 'rgba(216,205,187,0.8)',
                            backgroundColor: isDark ? colors.input : 'rgba(255,255,255,0.55)',
                            opacity: pressed ? 0.88 : 1,
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
                            {[reminderText, repeatText].filter(Boolean).join(' · ') || '提醒 / 重复可选'}
                          </Text>
                        </View>
                        <Text style={{ fontSize: 11, color: '#8C998E' }}>修改 ›</Text>
                      </Pressable>

                      <View style={styles.frow}>
                        <Text style={[styles.frowLab, { color: '#8A968C' }]}>自动入格</Text>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 11, color: tf.faint }}>
                            {autoPlaceGate.ok ? '重复 + 具体时间已满足' : '需同时有重复与具体时间'}
                          </Text>
                        </View>
                        <TaskFoldSwitch
                          value={autoPlaceIntoSchedule}
                          onValueChange={() => toggleAutoPlaceIntoSchedule()}
                          bounceToken={switchBounceToken}
                          accessibilityLabel="自动入格"
                        />
                      </View>

                      <Animated.View style={{ height: autoPlacePreviewH, overflow: 'hidden' }}>
                        <View
                          style={[
                            styles.fbox,
                            {
                              backgroundColor: 'rgba(232,239,217,0.4)',
                              borderColor: '#C8D8B1',
                            },
                          ]}>
                          <Text style={{ fontSize: 11, color: '#607A5C', lineHeight: 16 }}>
                            <Text style={{ fontWeight: '700' }}>自动入格预览 </Text>
                            {repeatText || '重复日'} {deadlineText || ''} → 冲突时顺延到下一空档。
                          </Text>
                        </View>
                      </Animated.View>

                      {!autoPlaceGate.ok ? (
                        <View style={styles.hintline}>
                          <MaterialIcons name="lightbulb-outline" size={12} color="#8A5F25" />
                          <Text style={{ fontSize: 10, color: '#8A5F25', flex: 1 }}>
                            缺少重复或具体时间时，开关会弹回并保持关闭。
                          </Text>
                        </View>
                      ) : null}
                    </View>
                  </FoldRiseIn>
                ) : null}

                <FoldRiseIn animate={foldAnimate} index={3} duration={520} staggerMs={42} fromY={10} holdHidden={foldAnimate}>
                  <View style={[styles.fcard, styles.fcardTight, { backgroundColor: foldCardBg, borderColor: foldCardBorder }]}>
                    <View style={styles.frow}>
                      <Text style={[styles.frowLab, { color: '#8A968C' }]}>奖励积分</Text>
                      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                        <Text style={{ fontSize: 14, fontWeight: '700', color: tf.ink2, fontFamily: fonts.mono }}>
                          {rewardN > 0 ? `+${rewardN}` : String(rewardN)}
                        </Text>
                        <Text style={{ fontSize: 10, color: tf.faint }}>完成时结算</Text>
                      </View>
                      <View style={styles.stepper}>
                        <Pressable onPress={() => bumpReward(-1)} style={styles.stepperBtn} accessibilityLabel="减少积分">
                          <Text style={{ color: '#6F7D72', fontWeight: '700' }}>−</Text>
                        </Pressable>
                        <Text style={{ fontFamily: fonts.mono, color: '#5C6D60', minWidth: 18, textAlign: 'center' }}>
                          {rewardN}
                        </Text>
                        <Pressable onPress={() => bumpReward(1)} style={styles.stepperBtn} accessibilityLabel="增加积分">
                          <Text style={{ color: '#6F7D72', fontWeight: '700' }}>+</Text>
                        </Pressable>
                      </View>
                    </View>
                    <View
                      style={[
                        styles.frow,
                        { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(232,224,210,0.52)' },
                      ]}>
                      <Text style={[styles.frowLab, { color: '#8A968C' }]}>验收标准</Text>
                      <TextInput
                        value={acceptanceCriteria}
                        onChangeText={setAcceptanceCriteria}
                        placeholder="怎样算完成？（可选）"
                        placeholderTextColor={tf.faint}
                        style={[styles.frowInput, { color: tf.ink2, flex: 1 }]}
                      />
                    </View>
                  </View>
                </FoldRiseIn>

                <FoldRiseIn animate={foldAnimate} index={4} duration={520} staggerMs={42} fromY={10} holdHidden={foldAnimate}>
                  <View style={[styles.fcard, { backgroundColor: foldCardBg, borderColor: foldCardBorder }]}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                      <Text style={{ fontSize: 12, fontWeight: '800', color: '#5B6A5D' }}>更多设置</Text>
                      <Text style={{ fontSize: 10, color: tf.faint }}>可稍后补</Text>
                    </View>
                    <View style={styles.frow}>
                      <Text style={[styles.frowLab, { color: '#8A968C' }]}>提醒</Text>
                      <Text style={[styles.frowVal, { color: tf.ink2 }]} numberOfLines={1}>
                        {reminderText || '未设置'}
                      </Text>
                      <Pressable onPress={openSchedulePicker}>
                        <Text style={{ fontSize: 11, color: '#8C998E' }}>修改 ›</Text>
                      </Pressable>
                    </View>
                    <View
                      style={[
                        styles.frow,
                        { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(232,224,210,0.52)' },
                      ]}>
                      <Text style={[styles.frowLab, { color: '#8A968C' }]}>重复</Text>
                      <Text style={[styles.frowVal, { color: tf.ink2 }]} numberOfLines={1}>
                        {repeatText || '不重复'}
                      </Text>
                    </View>
                    {isEditStandalone ? (
                      <Pressable
                        onPress={removeStandaloneTodo}
                        disabled={formBusy}
                        accessibilityRole="button"
                        style={({ pressed }) => [
                          styles.deleteBtn,
                          {
                            marginTop: 10,
                            borderColor: isDark ? 'rgba(248,113,113,0.45)' : 'rgba(186,26,26,0.35)',
                            opacity: formBusy ? 0.55 : pressed ? 0.8 : 1,
                          },
                        ]}>
                        <MaterialIcons name="delete-outline" size={18} color={isDark ? '#f87171' : '#ba1a1a'} />
                        <Text style={[styles.deleteText, { color: isDark ? '#f87171' : '#ba1a1a' }]}>删除待办</Text>
                      </Pressable>
                    ) : null}
                  </View>
                </FoldRiseIn>

                {autoPlaceIntoSchedule && standaloneIntent === 'active' ? (
                  <FoldRiseIn animate={foldAnimate} index={5} duration={520} staggerMs={42} fromY={10} holdHidden={foldAnimate}>
                    <View
                      style={[
                        styles.fcard,
                        styles.fcardTight,
                        {
                          backgroundColor: 'rgba(232,239,217,0.36)',
                          borderColor: '#C8D8B1',
                        },
                      ]}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <View style={[styles.frogmark, { backgroundColor: tf.pond }]}>
                          <MaterialIcons name="spa" size={14} color={tf.sun} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 12, fontWeight: '700', color: '#4F6152' }}>
                            创建后 · {repeatText || '按重复'} 自动入格
                          </Text>
                          <Text style={{ fontSize: 10, color: '#7F947B', marginTop: 2 }}>{scheduleSummary}</Text>
                        </View>
                        <View style={[styles.autoTag, { backgroundColor: tf.lily2 }]}>
                          <Text style={{ fontSize: 10, color: tf.frog, fontWeight: '700' }}>自动</Text>
                        </View>
                      </View>
                    </View>
                  </FoldRiseIn>
                ) : null}
              </>
            )}
          </ScrollView>

          <View style={[styles.foldFoot, { paddingBottom: footPad }]}>
            <Pressable
              onPress={() => void handleCreateTask()}
              disabled={formBusy}
              style={({ pressed }) => [
                styles.foldPrimary,
                {
                  backgroundColor: tf.pond,
                  opacity: formBusy ? 0.65 : pressed ? 0.9 : 1,
                },
              ]}>
              {formBusy ? (
                <ActivityIndicator color={tf.onPond} />
              ) : (
                <>
                  <MaterialIcons name="check" size={16} color={tf.onPond} />
                  <Text style={[styles.foldPrimaryText, { color: tf.onPond }]}>
                    {isEditStandalone ? '保存待办' : '创建待办'}
                  </Text>
                </>
              )}
            </Pressable>
            <View style={[styles.hintline, { justifyContent: 'center', marginTop: 6 }]}>
              <View style={[styles.dotLive, { backgroundColor: tf.sage }]} />
              <Text style={{ fontSize: 10, color: '#99A199' }}>本机草稿已保存 · 联网后同步</Text>
            </View>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  const footPad = Math.max(insets.bottom, 12);
  const inheritBannerBg = isDark ? 'rgba(232,239,217,0.12)' : 'rgba(232,239,217,0.36)';
  const inheritBannerBorder = isDark ? tf.line2 : '#C8D8B1';
  const scheduleLocked = inheritsProjectSchedule;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: tf.paper }]} edges={['left', 'right']}>
      <ComposerTopBar
        title={screenTitle}
        subtitle={topSubtitle}
        onBack={() => router.back()}
        onSubmit={() => void handleCreateTask()}
        submitting={formBusy}
        submitLabel="创建"
      />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView
          refreshControl={refreshControl}
          contentContainerStyle={[styles.foldContent, { paddingBottom: 96 + footPad }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          {projectName ? (
            <FoldRiseIn animate={foldAnimate} index={0} duration={520} staggerMs={42} fromY={10} holdHidden={foldAnimate}>
              <View
                style={[
                  styles.fcard,
                  styles.fcardTight,
                  { backgroundColor: inheritBannerBg, borderColor: inheritBannerBorder, paddingVertical: 9 },
                ]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <View style={[styles.projectAvatar, { backgroundColor: tf.lily2 }]}>
                    <Text style={{ fontSize: 13 }}>{entityIcon || '📁'}</Text>
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ fontSize: 13, fontWeight: '700', color: '#4F6152' }} numberOfLines={1}>
                      {projectName}
                    </Text>
                    <Text style={{ fontSize: 10, color: '#8A988C', marginTop: 2 }} numberOfLines={1}>
                      {inheritsProjectSchedule
                        ? `继承项目日程${deadlineText ? ` · ${deadlineText}` : ''}`
                        : '叶子任务 · 可被指派青蛙'}
                    </Text>
                  </View>
                  <View style={[styles.leafTag, { backgroundColor: tf.lily2 }]}>
                    <Text style={{ fontSize: 10, color: tf.frog, fontWeight: '700' }}>叶子任务</Text>
                  </View>
                </View>
              </View>
            </FoldRiseIn>
          ) : null}

          <FoldRiseIn
            animate={foldAnimate}
            index={projectName ? 1 : 0}
            duration={520}
            staggerMs={42}
            fromY={10}
            holdHidden={foldAnimate}>
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
                    ref={titleInputRef}
                    value={title}
                    onChangeText={handleTitleChange}
                    placeholder="写下任务名称…"
                    placeholderTextColor={tf.faint}
                    multiline
                    maxLength={titleMaxLength}
                    style={[styles.foldTitleInput, { color: tf.ink, fontFamily: fonts.serif }]}
                  />
                  <Text style={[styles.charCounter, { color: tf.faint }]}>
                    {title.length}/{titleMaxLength} · 标题必填
                  </Text>
                </View>
              </View>
              <View style={styles.foldChipRow}>
                <View style={[styles.fchip, { backgroundColor: tf.pond, borderColor: tf.pond }]}>
                  <Text style={[styles.fchipText, { color: tf.onPond }]}>叶子任务</Text>
                </View>
                <Pressable
                  onPress={() => setIsLongTermTask((v) => !v)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isLongTermTask }}
                  style={[
                    styles.fchip,
                    isLongTermTask && { backgroundColor: tf.pond, borderColor: tf.pond },
                  ]}>
                  <MaterialIcons
                    name="timer"
                    size={12}
                    color={isLongTermTask ? tf.onPond : '#7C897E'}
                    style={{ marginRight: 3 }}
                  />
                  <Text
                    style={[
                      styles.fchipText,
                      { color: isLongTermTask ? tf.onPond : '#7C897E' },
                    ]}>
                    长期任务
                  </Text>
                </Pressable>
                <Text style={{ marginLeft: 'auto', fontSize: 10, color: '#A2AAA1', alignSelf: 'center' }}>
                  {isLongTermTask ? '完成可仅结束今日会话' : '可被指派青蛙'}
                </Text>
              </View>
            </View>
          </FoldRiseIn>

          {quickProjectId ? (
            <FoldRiseIn animate={foldAnimate} index={2} duration={520} staggerMs={42} fromY={10} holdHidden={foldAnimate}>
              <View style={[styles.fcard, styles.fcardTight, { backgroundColor: foldCardBg, borderColor: foldCardBorder }]}>
                <View style={styles.frow}>
                  <Text style={[styles.frowLab, { color: '#8A968C' }]}>标签</Text>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <ProjectTagPickerField
                      selectedIds={selectedTagIds}
                      allTags={allTags}
                      loading={tagsLoading}
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
                    <MaterialIcons name="lock-outline" size={14} color={tf.faint} />
                  ) : null}
                </View>
                {inheritsProjectTags ? (
                  <View style={styles.hintline}>
                    <MaterialIcons name="lock-outline" size={12} color="#8A5F25" />
                    <Text style={{ fontSize: 10, color: '#8A5F25', flex: 1 }}>
                      项目标签与任务自有标签互斥，创建后继承项目标签。
                    </Text>
                  </View>
                ) : null}
              </View>
            </FoldRiseIn>
          ) : null}

          <FoldRiseIn
            animate={foldAnimate}
            index={quickProjectId ? 3 : 2}
            duration={520}
            staggerMs={42}
            fromY={10}
            holdHidden={foldAnimate}>
            <View style={[styles.fcard, { backgroundColor: foldCardBg, borderColor: foldCardBorder }]}>
              <TaskFoldPriorityGrid
                value={priority}
                onChange={setPriority}
                subtitle={projectName ? '从项目继承，可改' : '四象限优先级'}
              />
            </View>
          </FoldRiseIn>

          <FoldRiseIn
            animate={foldAnimate}
            index={quickProjectId ? 4 : 3}
            duration={520}
            staggerMs={42}
            fromY={10}
            holdHidden={foldAnimate}>
            <View style={[styles.fcard, { backgroundColor: foldCardBg, borderColor: foldCardBorder }]}>
              <Pressable
                onPress={scheduleLocked ? undefined : openSchedulePicker}
                disabled={scheduleLocked}
                accessibilityRole="button"
                accessibilityLabel={scheduleLocked ? '日程已继承项目，不可修改' : '修改日程'}
                style={({ pressed }) => [
                  styles.calendarbtn,
                  {
                    borderColor: 'rgba(216,205,187,0.8)',
                    backgroundColor: isDark ? colors.input : 'rgba(255,255,255,0.55)',
                    opacity: scheduleLocked ? 0.72 : pressed ? 0.88 : 1,
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
                    {scheduleLocked
                      ? `继承项目${deadlineText ? ` · ${deadlineText}` : ''}`
                      : [reminderText, repeatText].filter(Boolean).join(' · ') || '提醒 / 重复可选'}
                  </Text>
                </View>
                {scheduleLocked ? (
                  <MaterialIcons name="lock-outline" size={14} color={tf.faint} />
                ) : (
                  <Text style={{ fontSize: 11, color: '#8C998E' }}>修改 ›</Text>
                )}
              </Pressable>

              <View style={styles.frow}>
                <Text style={[styles.frowLab, { color: '#8A968C' }]}>自动入格</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 11, color: tf.faint }}>
                    {autoPlaceGate.ok
                      ? inheritsProjectSchedule
                        ? '与项目日程一致 · 可开启'
                        : '重复 + 具体时间已满足'
                      : '需同时有重复与具体时间'}
                  </Text>
                </View>
                <TaskFoldSwitch
                  value={autoPlaceIntoSchedule}
                  onValueChange={() => toggleAutoPlaceIntoSchedule()}
                  bounceToken={switchBounceToken}
                  accessibilityLabel="自动入格"
                />
              </View>

              <Animated.View style={{ height: autoPlacePreviewH, overflow: 'hidden' }}>
                <View
                  style={[
                    styles.fbox,
                    {
                      backgroundColor: 'rgba(232,239,217,0.4)',
                      borderColor: '#C8D8B1',
                    },
                  ]}>
                  <Text style={{ fontSize: 11, color: '#607A5C', lineHeight: 16 }}>
                    <Text style={{ fontWeight: '700' }}>自动入格预览 </Text>
                    {repeatText || '重复日'} {deadlineText || ''} → 冲突时顺延到下一空档。
                  </Text>
                </View>
              </Animated.View>

              <View
                style={[
                  styles.frow,
                  { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(232,224,210,0.52)' },
                ]}>
                <Text style={[styles.frowLab, { color: '#8A968C' }]}>奖励积分</Text>
                <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: tf.ink2, fontFamily: fonts.mono }}>
                    {rewardN > 0 ? `+${rewardN}` : String(rewardN)}
                  </Text>
                  <Text style={{ fontSize: 10, color: tf.faint }}>完成时结算</Text>
                </View>
                <View style={styles.stepper}>
                  <Pressable onPress={() => bumpReward(-1)} style={styles.stepperBtn} accessibilityLabel="减少积分">
                    <Text style={{ color: '#6F7D72', fontWeight: '700' }}>−</Text>
                  </Pressable>
                  <Text style={{ fontFamily: fonts.mono, color: '#5C6D60', minWidth: 18, textAlign: 'center' }}>
                    {rewardN}
                  </Text>
                  <Pressable onPress={() => bumpReward(1)} style={styles.stepperBtn} accessibilityLabel="增加积分">
                    <Text style={{ color: '#6F7D72', fontWeight: '700' }}>+</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          </FoldRiseIn>

          <FoldRiseIn
            animate={foldAnimate}
            index={quickProjectId ? 5 : 4}
            duration={520}
            staggerMs={42}
            fromY={10}
            holdHidden={foldAnimate}>
            <View style={[styles.fcard, styles.fcardTight, { backgroundColor: foldCardBg, borderColor: foldCardBorder }]}>
              <View style={styles.frow}>
                <Text style={[styles.frowLab, { color: '#8A968C' }]}>验收标准</Text>
                <TextInput
                  value={acceptanceCriteria}
                  onChangeText={setAcceptanceCriteria}
                  placeholder="怎样算完成？（可选）"
                  placeholderTextColor={tf.faint}
                  style={[styles.frowInput, { color: tf.ink2, flex: 1 }]}
                />
                <MaterialIcons name="edit" size={14} color={tf.faint} />
              </View>
              <View style={styles.hintline}>
                <MaterialIcons name="cruelty-free" size={12} color={tf.frog} />
                <Text style={{ fontSize: 10, color: '#6F856B', flex: 1 }}>
                  保存后可长按任务，放入今日或本周空档。
                </Text>
              </View>
            </View>
          </FoldRiseIn>

          <FoldRiseIn
            animate={foldAnimate}
            index={quickProjectId ? 6 : 5}
            duration={520}
            staggerMs={42}
            fromY={10}
            holdHidden={foldAnimate}>
            <View style={[styles.fcard, { backgroundColor: foldCardBg, borderColor: foldCardBorder }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <Text style={{ fontSize: 12, fontWeight: '800', color: '#5B6A5D' }}>更多</Text>
                <Text style={{ fontSize: 10, color: tf.faint }}>叶子任务默认继承项目设置</Text>
              </View>
              <View style={styles.frow}>
                <Text style={[styles.frowLab, { color: '#8A968C' }]}>提醒</Text>
                <Text style={[styles.frowVal, { color: tf.ink2 }]} numberOfLines={1}>
                  {reminderText || '未设置'}
                </Text>
                <Pressable onPress={scheduleLocked ? undefined : openSchedulePicker} disabled={scheduleLocked}>
                  <Text style={{ fontSize: 11, color: scheduleLocked ? tf.faint : '#8C998E' }}>
                    {scheduleLocked ? '锁定' : '修改 ›'}
                  </Text>
                </Pressable>
              </View>
              <View
                style={[
                  styles.frow,
                  { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(232,224,210,0.52)' },
                ]}>
                <Text style={[styles.frowLab, { color: '#8A968C' }]}>重复</Text>
                <Text style={[styles.frowVal, { color: tf.ink2 }]} numberOfLines={1}>
                  {repeatText || '不重复'}
                </Text>
              </View>
              <View
                style={[
                  styles.frow,
                  { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(232,224,210,0.52)' },
                ]}>
                <Text style={[styles.frowLab, { color: '#8A968C' }]}>备注</Text>
                <TextInput
                  value={note}
                  onChangeText={setNote}
                  placeholder="可选补充说明"
                  placeholderTextColor={tf.faint}
                  style={[styles.frowInput, { color: tf.ink2, flex: 1 }]}
                />
                <MaterialIcons name="edit" size={14} color={tf.faint} />
              </View>
            </View>
          </FoldRiseIn>

          {autoPlaceIntoSchedule ? (
            <FoldRiseIn
              animate={foldAnimate}
              index={quickProjectId ? 7 : 6}
              duration={520}
              staggerMs={42}
              fromY={10}
              holdHidden={foldAnimate}>
              <View
                style={[
                  styles.fcard,
                  styles.fcardTight,
                  {
                    backgroundColor: 'rgba(232,239,217,0.36)',
                    borderColor: '#C8D8B1',
                  },
                ]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <View style={[styles.frogmark, { backgroundColor: tf.pond }]}>
                    <MaterialIcons name="spa" size={14} color={tf.sun} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 12, fontWeight: '700', color: '#4F6152' }}>
                      创建后 · {repeatText || '按重复'} 自动入格
                    </Text>
                    <Text style={{ fontSize: 10, color: '#7F947B', marginTop: 2 }}>{scheduleSummary}</Text>
                  </View>
                  <View style={[styles.autoTag, { backgroundColor: tf.lily2 }]}>
                    <Text style={{ fontSize: 10, color: tf.frog, fontWeight: '700' }}>自动</Text>
                  </View>
                </View>
              </View>
            </FoldRiseIn>
          ) : null}
        </ScrollView>

        <View style={[styles.foldFoot, { paddingBottom: footPad }]}>
          <Pressable
            onPress={() => void handleCreateTask()}
            disabled={formBusy}
            style={({ pressed }) => [
              styles.foldPrimary,
              {
                backgroundColor: tf.pond,
                opacity: formBusy ? 0.65 : pressed ? 0.9 : 1,
              },
            ]}>
            {formBusy ? (
              <ActivityIndicator color={tf.onPond} />
            ) : (
              <>
                <MaterialIcons name="cruelty-free" size={16} color={tf.onPond} />
                <Text style={[styles.foldPrimaryText, { color: tf.onPond }]}>创建任务</Text>
              </>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  charCounter: { alignSelf: 'flex-end', fontSize: 11, fontWeight: '500' },
  editLoading: {
    paddingVertical: 48,
    alignItems: 'center',
    gap: 12,
  },
  loadingText: { fontSize: 12, fontWeight: '500' },
  standaloneShelvedHint: {
    fontSize: 12,
    lineHeight: 17,
    marginTop: 6,
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
  foldContent: {
    paddingHorizontal: 14,
    paddingTop: 10,
    gap: 8,
    maxWidth: 560,
    width: '100%',
    alignSelf: 'center',
  },
  fcard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 10,
    marginBottom: 0,
  },
  fcardTight: { paddingVertical: 8 },
  foldTitleInput: {
    padding: 0,
    fontSize: 18,
    fontWeight: '600',
    lineHeight: 24,
    minHeight: 40,
  },
  foldChipRow: { flexDirection: 'row', gap: 6, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' },
  fchip: {
    height: 28,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: '#F1EDE1',
    borderWidth: 1,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  fchipText: { fontSize: 12, fontWeight: '600' },
  projectAvatar: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  leafTag: {
    height: 18,
    paddingHorizontal: 7,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
  frowInput: { fontSize: 13, paddingVertical: 4, paddingHorizontal: 0 },
  fbox: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 6,
    marginTop: 4,
  },
  hintline: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepperBtn: {
    width: 22,
    height: 22,
    borderRadius: 6,
    backgroundColor: '#F0EBDE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  frogmark: {
    width: 28,
    height: 28,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  autoTag: {
    height: 18,
    paddingHorizontal: 7,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
  dotLive: { width: 5, height: 5, borderRadius: 3 },
});

