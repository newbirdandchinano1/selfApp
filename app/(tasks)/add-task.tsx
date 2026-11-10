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
import { ProgressCountersField } from '@/components/progress/ProgressCountersField';
import { AcceptanceChecklistEditor } from '@/components/tasks/AcceptanceChecklistEditor';
import { NoteImageAttach } from '@/components/tasks/note-image-attach';
import { RewardPointsStepper } from '@/components/tasks/RewardPointsStepper';
import { TaskFoldPriorityGrid } from '@/components/tasks/task-fold-priority-grid';
import { TaskFoldMotion, useTaskFoldTheme } from '@/constants/task-fold-theme';
import {
  bumpNonUrgentToUrgentPriority,
  isNonUrgentPriorityKey,
  shouldLockNonUrgentPriority,
} from '@/lib/due-soon-priority-bump';
import { getDayBoundarySync, getLogicalLocalYmd } from '@/lib/tasks-logical-day';
import { useAppTheme } from '@/hooks/use-app-theme';
import { usePageApiSync, usePagePullRefresh } from '@/hooks/use-page-api-sync';
import { setAddTaskResult } from '@/lib/add-task-bridge';
import { markPendingTablesDirty } from '@/lib/api-incremental-sync';
import { requestPush } from '@/lib/sync-manager';
import { makeTimestampEntityId } from '@/lib/entity-id';
import { toast, Alert, toUserMessage } from '@/lib/app-feedback';
import type { ScheduleMeta } from '@/lib/schedule/meta';
import { parseTaskOneLiner } from '@/lib/zhipu-image-parse';
import { formatWriteError } from '@/lib/format-write-error';
import { clearProjectFrogFields } from '@/lib/frog-assignment';
import { mergeLongTermTaskIntoExtraData } from '@/lib/long-term-task';
import { preserveFrogAssignFieldsInExtra } from '@/lib/standalone-todo-assign-sync';
import {
  acceptanceChecklistToLines,
  createEmptyAcceptanceItem,
  linesToAcceptanceChecklist,
  mergeAcceptanceChecklistIntoExtraData,
  type AcceptanceCriterionItem,
} from '@/lib/acceptance-criteria';
import {
  mergeNoteImageUrisIntoExtraData,
  noteImageUrisEqual,
  parseNoteImageUris,
} from '@/lib/note-image-extra';
import {
  bindNoteImages,
  ensureNoteImagesRemote,
  releaseRemovedNoteImages,
} from '@/lib/note-images';
import {
  mergeRewardPointsIntoExtraData,
  normalizeRewardPoints,
  parseRewardPointsFromExtraData,
} from '@/lib/reward-points';
import {
  mergeProgressCountersIntoExtraDataString,
  parseProgressCounters,
  stampProgressCountersSinceYmd,
  validateProgressCountersForSave,
  type ProgressCounter,
} from '@/lib/repositories/progress/progress-counters';
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
import {
  isTaskTerminalStatus,
  type TaskPriority,
  type TaskRow,
  type TaskStatus,
} from '@/lib/repositories/tasks/task.types';
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
import { setPendingSchedulePlace } from '@/lib/schedule-place-bridge';
import { isStandaloneTodoTask } from '@/lib/standalone-todo-task';
import { MaterialIcons } from '@expo/vector-icons';
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
    /** 复盘建议等入口预填 */
    title?: string;
    note?: string;
    /** 复盘 AI 增强：priority / due_ymd / schedule JSON */
    priority?: string;
    due_ymd?: string;
    schedule?: string;
  }>();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useAppTheme();
  const { tf, fonts } = useTaskFoldTheme();
  const { animate: foldAnimate } = useFoldMotionGate();
  const titleInputRef = React.useRef<React.ElementRef<typeof TextInput>>(null);

  const [title, setTitle] = React.useState(() => firstRouteParam(params.title).trim());
  const [entityIcon, setEntityIcon] = React.useState(DEFAULT_TODO_ICON);
  const [acceptanceItems, setAcceptanceItems] = React.useState<AcceptanceCriterionItem[]>([
    createEmptyAcceptanceItem(),
  ]);
  const [note, setNote] = React.useState(() => firstRouteParam(params.note).trim());
  const [noteImageUris, setNoteImageUris] = React.useState<string[]>([]);
  const [rewardPointsText, setRewardPointsText] = React.useState('0');
  const [progressCounters, setProgressCounters] = React.useState<ProgressCounter[]>([]);
  const [priority, setPriority] = React.useState<TaskPriorityKey>(() => {
    const raw = Number(firstRouteParam(params.priority));
    if (Number.isFinite(raw) && raw >= 1 && raw <= 4) return taskPriorityToKey(raw);
    return 'not-urgent-not-important';
  });
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [isLongTermTask, setIsLongTermTask] = React.useState(false);
  const [projectName, setProjectName] = React.useState<string | null>(null);
  /** 独立待办：正常待办 vs 暂时搁置（时间未定，不可直接完成） */
  const [standaloneIntent, setStandaloneIntent] = React.useState<'active' | 'shelved'>('active');
  const [loadingEdit, setLoadingEdit] = React.useState(false);
  const [selectedTagIds, setSelectedTagIds] = React.useState<string[]>([]);
  const [allTags, setAllTags] = React.useState<TagRow[]>([]);
  const [tagsLoading, setTagsLoading] = React.useState(false);
  const [aiFillOpen, setAiFillOpen] = React.useState(false);
  const [aiFillText, setAiFillText] = React.useState('');
  const [aiFillBusy, setAiFillBusy] = React.useState(false);
  const [inheritsProjectSchedule, setInheritsProjectSchedule] = React.useState(false);
  const [inheritsProjectTags, setInheritsProjectTags] = React.useState(false);
  const editTaskStatusRef = React.useRef<string>('todo');
  const loadedNoteImageUrisRef = React.useRef<string[]>([]);

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

  const lockNonUrgentPriority = React.useMemo(() => {
    const todayYmd = getLogicalLocalYmd(new Date(), getDayBoundarySync());
    const dueYmd = resolveDueDate()?.trim().slice(0, 10) || null;
    return shouldLockNonUrgentPriority(todayYmd, dueYmd);
  }, [resolveDueDate, deadlineText, scheduleMeta]);

  React.useEffect(() => {
    if (!lockNonUrgentPriority || !isNonUrgentPriorityKey(priority)) return;
    const bumped = bumpNonUrgentToUrgentPriority(taskPriorityKeyToNumber(priority));
    if (bumped != null) setPriority(taskPriorityToKey(bumped));
  }, [lockNonUrgentPriority, priority]);

  React.useEffect(() => {
    if (lockScheduleFromParam) setInheritsProjectSchedule(true);
  }, [lockScheduleFromParam]);

  React.useEffect(() => {
    if (defaultScheduleApplied.current || scheduleMeta) return;
    // 复盘 / 深链：schedule JSON 或 due_ymd
    const scheduleRaw = firstRouteParam(params.schedule);
    if (scheduleRaw) {
      try {
        const parsed = JSON.parse(scheduleRaw) as ScheduleMeta;
        if (parsed && typeof parsed === 'object') {
          defaultScheduleApplied.current = true;
          applySchedule(parsed);
          setStandaloneIntent('active');
          return;
        }
      } catch {
        // fall through
      }
    }
    const dueYmd = firstRouteParam(params.due_ymd);
    if (dueYmd && /^\d{4}-\d{2}-\d{2}$/.test(dueYmd)) {
      defaultScheduleApplied.current = true;
      applySchedule({
        mode: 'date',
        allDay: true,
        date: `${dueYmd}T12:00:00`,
        reminderOption: '不提前',
        repeatOption: '不重复',
      });
      setStandaloneIntent('active');
      return;
    }
    const inherited = resolveInheritedDefaultSchedule(
      parseDefaultScheduleParam(typeof params.defaultSchedule === 'string' ? params.defaultSchedule : undefined),
      dateLimit,
    );
    if (!inherited) return;
    defaultScheduleApplied.current = true;
    applySchedule(inherited);
    if (lockScheduleFromParam) setInheritsProjectSchedule(true);
  }, [
    applySchedule,
    dateLimit,
    lockScheduleFromParam,
    params.defaultSchedule,
    params.due_ymd,
    params.schedule,
    scheduleMeta,
  ]);

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
    // 独立待办无「长期」开关：统一走备注（description 旧验收文案并入备注兼容）
    const legacyAcceptance = (task.description ?? '').trim();
    const legacyNote = (task.note ?? '').trim();
    setNote(legacyNote || legacyAcceptance);
    const loadedNoteImages = parseNoteImageUris(task.extra_data);
    loadedNoteImageUrisRef.current = loadedNoteImages;
    setNoteImageUris(loadedNoteImages);
    setAcceptanceItems([createEmptyAcceptanceItem()]);
    setRewardPointsText(String(parseRewardPointsFromExtraData(task.extra_data)));
    setProgressCounters(parseProgressCounters(task.extra_data));
    setPriority(taskPriorityToKey(task.priority ?? 0));
    editTaskStatusRef.current = task.status;
    const shelved = task.status === 'shelved';
    setStandaloneIntent(shelved ? 'shelved' : 'active');
    if (shelved) {
      clearSchedule();
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
    const countersValidation = validateProgressCountersForSave(progressCounters);
    if (!countersValidation.ok) {
      toast.warn(countersValidation.message);
      return;
    }
    const logicalTodayYmd = getLogicalLocalYmd(new Date(), getDayBoundarySync());
    const stampedCounters = stampProgressCountersSinceYmd(
      countersValidation.counters,
      logicalTodayYmd,
      progressCounters,
    );
    if (isStandalone) {
      try {
        setIsSubmitting(true);
        const shelved = standaloneIntent === 'shelved';
        // 表单日期 = 截止日期；指派日由用户手动入格写入，保存时不得互写
        const dueDate = shelved ? null : resolveDueDate();

        let previousExtra: string | null = null;
        if (isEditStandalone && editTaskId) {
          try {
            const prev = await ensureLocalRowForWrite<TaskRow>('tasks', editTaskId);
            previousExtra = prev?.extra_data ?? null;
          } catch {
            /* ignore */
          }
        }

        const extraPayload = mergeIconIntoExtraData(
          mergeRewardPointsIntoExtraData(
            mergeProgressCountersIntoExtraDataString(
              shelved
                ? JSON.stringify({ reminder: '', repeat: '', schedule: null })
                : JSON.stringify({
                    reminder: reminderText || '',
                    repeat: repeatText || '',
                    schedule: scheduleMeta,
                  }),
              stampedCounters,
            ) ?? '{}',
            normalizeRewardPoints(rewardPointsText),
          ),
          entityIcon,
          DEFAULT_TODO_ICON,
        );
        const trimmedNote = note.trim() || null;
        let nextNoteImages = [...noteImageUris];
        if (isEditStandalone) {
          const previousNoteImages = loadedNoteImageUrisRef.current;
          if (nextNoteImages.length > 0) {
            nextNoteImages = await ensureNoteImagesRemote({
              localUris: nextNoteImages,
              owner: { table: 'tasks', id: editTaskId },
            });
          }
          let nextExtra = mergeAcceptanceChecklistIntoExtraData(extraPayload, []) ?? extraPayload;
          nextExtra = mergeNoteImageUrisIntoExtraData(nextExtra, nextNoteImages) ?? nextExtra;
          nextExtra = preserveFrogAssignFieldsInExtra(nextExtra, previousExtra);
          await updateTask(editTaskId, {
            title: trimmedTitle,
            description: null,
            note: trimmedNote,
            status: resolveStandaloneStatusOnSave(editTaskStatusRef.current, standaloneIntent),
            priority: labelToTaskPriority(priorityLabel),
            due_date: dueDate,
            extra_data: nextExtra,
          });
          await bindNoteImages({ table: 'tasks', id: editTaskId }, nextNoteImages);
          await releaseRemovedNoteImages(previousNoteImages, nextNoteImages);
          loadedNoteImageUrisRef.current = nextNoteImages;
          if (!noteImageUrisEqual(nextNoteImages, noteImageUris)) setNoteImageUris(nextNoteImages);
          await setTaskTagIds(editTaskId, selectedTagIds);
        } else {
          const id = makeTimestampEntityId('tsk_', 8);
          if (nextNoteImages.length > 0) {
            nextNoteImages = await ensureNoteImagesRemote({
              localUris: nextNoteImages,
              owner: { table: 'tasks', id },
            });
          }
          let nextExtra = mergeAcceptanceChecklistIntoExtraData(extraPayload, []) ?? extraPayload;
          nextExtra = mergeNoteImageUrisIntoExtraData(nextExtra, nextNoteImages) ?? nextExtra;
          await createTask({
            id,
            project_id: null,
            category_id: null,
            parent_task_id: null,
            title: trimmedTitle,
            description: null,
            note: trimmedNote,
            status: shelved ? 'shelved' : 'todo',
            priority: labelToTaskPriority(priorityLabel),
            due_date: dueDate,
            extra_data: nextExtra,
          });
          if (nextNoteImages.length > 0) {
            await bindNoteImages({ table: 'tasks', id }, nextNoteImages);
          }
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
        const checklist = isLongTermTask ? acceptanceItems : [];
        const description = isLongTermTask
          ? acceptanceChecklistToLines(acceptanceItems) || null
          : null;
        const noteToSave = isLongTermTask ? null : note.trim() || null;
        let nextNoteImages = isLongTermTask ? [] : [...noteImageUris];
        if (nextNoteImages.length > 0) {
          nextNoteImages = await ensureNoteImagesRemote({
            localUris: nextNoteImages,
            owner: { table: 'tasks', id },
          });
        }
        let extraPayload = mergeIconIntoExtraData(
          mergeRewardPointsIntoExtraData(
            mergeLongTermTaskIntoExtraData(
              mergeProgressCountersIntoExtraDataString(
                JSON.stringify({
                  reminder: reminderText || '',
                  repeat: repeatText || '',
                  schedule: scheduleMeta,
                }),
                stampedCounters,
              ) ?? '{}',
              isLongTermTask,
            ),
            normalizeRewardPoints(rewardPointsText),
          ),
          entityIcon,
          DEFAULT_TODO_ICON,
        );
        extraPayload = mergeAcceptanceChecklistIntoExtraData(extraPayload, checklist) ?? extraPayload;
        extraPayload = mergeNoteImageUrisIntoExtraData(extraPayload, nextNoteImages) ?? extraPayload;
        await createTask({
          id,
          project_id: quickProjectId,
          category_id: quickTaskCategoryId,
          parent_task_id: null,
          title: trimmedTitle,
          description,
          note: noteToSave,
          status: 'todo',
          priority: taskPriorityKeyToNumber(priority),
          due_date: resolveDueDate(),
          extra_data: extraPayload,
        });
        if (nextNoteImages.length > 0) {
          await bindNoteImages({ table: 'tasks', id }, nextNoteImages);
        }
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
        note: isLongTermTask ? null : note.trim() || null,
        noteImageUris: isLongTermTask ? [] : noteImageUris,
        acceptanceCriteria: isLongTermTask ? acceptanceChecklistToLines(acceptanceItems) : '',
        schedule: scheduleMeta,
        isLongTermTask,
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
  const rewardN = Math.round(Number(rewardPointsText) || 0);

  const handleAiFillStandalone = React.useCallback(async () => {
    const text = aiFillText.trim();
    if (!text) {
      toast.info('请先输入一句话');
      return;
    }
    setAiFillBusy(true);
    try {
      const r = await parseTaskOneLiner({
        text,
        todayYmd: getLogicalLocalYmd(new Date(), getDayBoundarySync()),
        tagNames: allTags.map((t) => t.name).filter(Boolean).slice(0, 40),
      });
      if (!r.ok) {
        toast.error(r.error || 'AI 解析失败');
        return;
      }
      const d = r.data;
      setTitle(clampTitle(d.title, titleMaxLength));
      if (d.note) setNote(d.note);
      if (d.priority > 0) setPriority(taskPriorityToKey(d.priority));
      if (d.reward_points != null) setRewardPointsText(String(d.reward_points));
      if (d.schedule) {
        applySchedule(d.schedule as ScheduleMeta);
        setStandaloneIntent('active');
      } else if (d.due_ymd) {
        applySchedule({
          mode: 'date',
          allDay: true,
          date: `${d.due_ymd}T12:00:00`,
          reminderOption: '不提前',
          repeatOption: '不重复',
        });
        setStandaloneIntent('active');
      }
      if (d.tag_hints.length && allTags.length) {
        const lowerHints = new Set(d.tag_hints.map((x) => x.toLowerCase()));
        const matched = allTags
          .filter((t) => lowerHints.has(t.name.trim().toLowerCase()))
          .map((t) => t.id);
        if (matched.length) setSelectedTagIds(matched);
      }
      setAiFillOpen(false);
      setAiFillText('');
      toast.success('已填入，请确认后保存');
    } catch (e) {
      toast.error(toUserMessage(e, 'AI 解析失败'));
    } finally {
      setAiFillBusy(false);
    }
  }, [aiFillText, allTags, applySchedule, titleMaxLength]);

  const beginPlaceStandaloneOnSchedule = React.useCallback(() => {
    if (!isEditStandalone || !editTaskId || formBusy) return;
    if (standaloneIntent === 'shelved') {
      Alert.alert('无法入格', '已搁置的待办请先激活后再指派到日程表。');
      return;
    }
    if (isTaskTerminalStatus(editTaskStatusRef.current)) {
      Alert.alert('无法入格', '已完成/已取消的待办不能指派为青蛙。');
      return;
    }
    const trimmed = title.trim();
    if (!trimmed) {
      Alert.alert('无法入格', '请先填写待办名称。');
      return;
    }
    setPendingSchedulePlace({
      kind: 'task',
      id: editTaskId,
      title: trimmed,
      priority: taskPriorityKeyToNumber(priority),
      dueDate: resolveDueDate()?.slice(0, 10) ?? null,
      acceptanceCriteria: isLongTermTask
        ? acceptanceItems
            .map((i) => i.text.trim())
            .filter(Boolean)
            .join('\n')
        : note.trim(),
      rewardPoints: normalizeRewardPoints(rewardPointsText),
      projectId: null,
      projectName: null,
    });
    router.push('/(tabs)/tasks');
  }, [
    acceptanceItems,
    editTaskId,
    formBusy,
    isEditStandalone,
    isLongTermTask,
    note,
    priority,
    resolveDueDate,
    rewardPointsText,
    router,
    standaloneIntent,
    title,
  ]);

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
                    {!isEditStandalone ? (
                      <Pressable
                        onPress={() => setAiFillOpen(true)}
                        disabled={formBusy || aiFillBusy}
                        accessibilityRole="button"
                        accessibilityLabel="AI 填入"
                        style={({ pressed }) => [
                          styles.aiFillBtn,
                          {
                            borderColor: tf.line2,
                            backgroundColor: isDark ? colors.input : 'rgba(255,255,255,0.55)',
                            opacity: pressed || formBusy || aiFillBusy ? 0.7 : 1,
                          },
                        ]}>
                        <MaterialIcons name="auto-awesome" size={16} color={tf.frog} />
                        <Text style={[styles.aiFillBtnText, { color: tf.frog }]}>AI 填入</Text>
                        <Text style={[styles.aiFillBtnHint, { color: tf.faint }]}>一句话建待办</Text>
                      </Pressable>
                    ) : null}
                  </View>
                </FoldRiseIn>

                <FoldRiseIn animate={foldAnimate} index={1} duration={520} staggerMs={42} fromY={10} holdHidden={foldAnimate}>
                  <View style={[styles.fcard, { backgroundColor: foldCardBg, borderColor: foldCardBorder }]}>
                    <TaskFoldPriorityGrid
                      value={priority}
                      onChange={setPriority}
                      lockNonUrgent={lockNonUrgentPriority}
                    />
                  </View>
                </FoldRiseIn>

                {standaloneIntent === 'active' ? (
                  <FoldRiseIn animate={foldAnimate} index={2} duration={520} staggerMs={42} fromY={10} holdHidden={foldAnimate}>
                    <View style={[styles.fcard, { backgroundColor: foldCardBg, borderColor: foldCardBorder }]}>
                      <Pressable
                        onPress={openSchedulePicker}
                        accessibilityRole="button"
                        accessibilityLabel="设置截止日期"
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
                            {deadlineText || '设置截止日期'}
                          </Text>
                          <Text style={[styles.calSub, { color: tf.faint }]} numberOfLines={1}>
                            {[reminderText, repeatText].filter(Boolean).join(' · ') ||
                              '指派到日程请在列表长按或入格'}
                          </Text>
                        </View>
                        <Text style={{ fontSize: 11, color: '#8C998E' }}>修改 ›</Text>
                      </Pressable>

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
                      <RewardPointsStepper
                        value={rewardPointsText}
                        onChange={setRewardPointsText}
                        monoFontFamily={fonts.mono}
                      />
                    </View>
                    <View
                      style={[
                        styles.frow,
                        {
                          borderTopWidth: StyleSheet.hairlineWidth,
                          borderTopColor: 'rgba(232,224,210,0.52)',
                          alignItems: 'flex-start',
                          paddingVertical: 10,
                        },
                      ]}>
                      <Text style={[styles.frowLab, { color: '#8A968C', marginTop: 10 }]}>计数进度</Text>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <ProgressCountersField
                          counters={progressCounters}
                          disabled={formBusy}
                          onChange={setProgressCounters}
                          anchorYmd={getLogicalLocalYmd(new Date(), getDayBoundarySync())}
                          textColor={tf.ink2}
                          outline={tf.muted}
                          placeholderColor={tf.faint}
                          primary={tf.frog}
                          surfaceLow={isDark ? colors.input : '#F1EDE1'}
                          surfaceLowest={isDark ? colors.surfaceSubtle : '#FFFCF5'}
                        />
                      </View>
                    </View>
                    <View
                      style={[
                        styles.frow,
                        {
                          borderTopWidth: StyleSheet.hairlineWidth,
                          borderTopColor: 'rgba(232,224,210,0.52)',
                          alignItems: 'flex-start',
                          paddingVertical: 8,
                        },
                      ]}>
                      <Text style={[styles.frowLab, { color: '#8A968C', marginTop: 4 }]}>备注</Text>
                      <View style={{ flex: 1, minWidth: 0, gap: 8 }}>
                        <TextInput
                          value={note}
                          onChangeText={setNote}
                          placeholder="可选补充说明，下方可贴多图"
                          placeholderTextColor={tf.faint}
                          multiline
                          style={[styles.frowInput, { color: tf.ink2, minHeight: 36 }]}
                        />
                        <NoteImageAttach
                          uris={noteImageUris}
                          onChangeUris={setNoteImageUris}
                          disabled={formBusy}
                          borderColor={tf.line2}
                          mutedColor={tf.faint}
                          surfaceColor={isDark ? colors.input : '#F1EDE1'}
                        />
                      </View>
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
                      <>
                        <Pressable
                          onPress={beginPlaceStandaloneOnSchedule}
                          disabled={formBusy || standaloneIntent === 'shelved'}
                          accessibilityRole="button"
                          accessibilityLabel="放入日程"
                          style={({ pressed }) => [
                            styles.deleteBtn,
                            {
                              marginTop: 10,
                              borderColor: isDark ? 'rgba(127,166,149,0.45)' : 'rgba(95,131,88,0.35)',
                              backgroundColor: isDark ? 'rgba(127,166,149,0.12)' : 'rgba(232,239,217,0.55)',
                              opacity:
                                formBusy || standaloneIntent === 'shelved' ? 0.55 : pressed ? 0.8 : 1,
                            },
                          ]}>
                          <MaterialIcons name="event-available" size={18} color={tf.frog} />
                          <Text style={[styles.deleteText, { color: tf.frog }]}>放入日程</Text>
                        </Pressable>
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
                      </>
                    ) : null}
                  </View>
                </FoldRiseIn>

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

        <Modal
          visible={aiFillOpen}
          animationType="fade"
          transparent
          onRequestClose={() => !aiFillBusy && setAiFillOpen(false)}>
          <View style={styles.aiModalBackdrop}>
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={() => !aiFillBusy && setAiFillOpen(false)}
            />
            <View style={[styles.aiModalCard, { backgroundColor: isDark ? colors.surface : '#FFFCF5' }]}>
              <Text style={[styles.aiModalTitle, { color: tf.ink, fontFamily: fonts.serif }]}>
                AI 填入待办
              </Text>
              <Text style={[styles.aiModalSub, { color: tf.faint }]}>
                例如：周五前交季度总结，重要紧急，提前一天提醒
              </Text>
              <TextInput
                style={[
                  styles.aiModalInput,
                  {
                    color: tf.ink,
                    borderColor: tf.line2,
                    backgroundColor: isDark ? colors.input : '#FFF',
                  },
                ]}
                value={aiFillText}
                onChangeText={setAiFillText}
                placeholder="一句话描述待办…"
                placeholderTextColor={tf.faint}
                multiline
                editable={!aiFillBusy}
                autoFocus
              />
              <View style={styles.aiModalActions}>
                <Pressable
                  disabled={aiFillBusy}
                  onPress={() => {
                    setAiFillOpen(false);
                    setAiFillText('');
                  }}
                  style={styles.aiModalGhost}>
                  <Text style={{ color: tf.ink2, fontWeight: '700' }}>取消</Text>
                </Pressable>
                <Pressable
                  disabled={aiFillBusy}
                  onPress={() => void handleAiFillStandalone()}
                  style={[
                    styles.aiModalPrimary,
                    { backgroundColor: tf.pond, opacity: aiFillBusy ? 0.65 : 1 },
                  ]}>
                  {aiFillBusy ? (
                    <ActivityIndicator color={tf.onPond} />
                  ) : (
                    <Text style={{ color: tf.onPond, fontWeight: '800' }}>AI 填入</Text>
                  )}
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
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
                  onPress={() => {
                    setIsLongTermTask((v) => {
                      const next = !v;
                      if (next) {
                        // 开启长期：备注行迁移为验收项（若清单为空）
                        setAcceptanceItems((prev) => {
                          const hasText = prev.some((i) => i.text.trim());
                          if (hasText) return prev;
                          const fromNote = linesToAcceptanceChecklist(note);
                          return fromNote.length > 0 ? fromNote : [createEmptyAcceptanceItem()];
                        });
                        setNoteImageUris([]);
                      } else {
                        // 关闭长期：验收文案并入备注（若备注为空）
                        setNote((prev) => {
                          if (prev.trim()) return prev;
                          return acceptanceChecklistToLines(acceptanceItems);
                        });
                        setAcceptanceItems([createEmptyAcceptanceItem()]);
                      }
                      return next;
                    });
                  }}
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
                lockNonUrgent={lockNonUrgentPriority}
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
                <RewardPointsStepper
                  value={rewardPointsText}
                  onChange={setRewardPointsText}
                  monoFontFamily={fonts.mono}
                />
              </View>
              <View
                style={[
                  styles.frow,
                  {
                    borderTopWidth: StyleSheet.hairlineWidth,
                    borderTopColor: 'rgba(232,224,210,0.52)',
                    alignItems: 'flex-start',
                    paddingVertical: 10,
                  },
                ]}>
                <Text style={[styles.frowLab, { color: '#8A968C', marginTop: 10 }]}>计数进度</Text>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <ProgressCountersField
                    counters={progressCounters}
                    disabled={formBusy}
                    onChange={setProgressCounters}
                    anchorYmd={getLogicalLocalYmd(new Date(), getDayBoundarySync())}
                    textColor={tf.ink2}
                    outline={tf.muted}
                    placeholderColor={tf.faint}
                    primary={tf.frog}
                    surfaceLow={isDark ? colors.input : '#F1EDE1'}
                    surfaceLowest={isDark ? colors.surfaceSubtle : '#FFFCF5'}
                  />
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
              {isLongTermTask ? (
                <View style={{ paddingVertical: 4 }}>
                  <Text style={[styles.frowLab, { color: '#8A968C', marginBottom: 4 }]}>验收标准</Text>
                  <AcceptanceChecklistEditor
                    items={acceptanceItems}
                    onChange={setAcceptanceItems}
                    mode="edit"
                    inkColor={tf.ink2}
                    faintColor={tf.faint}
                    frogColor={tf.frog}
                    onPondColor={tf.onPond}
                    lineColor={tf.line2}
                  />
                  <View style={[styles.hintline, { marginTop: 4 }]}>
                    <MaterialIcons name="info-outline" size={12} color={tf.faint} />
                    <Text style={{ fontSize: 10, color: tf.faint, flex: 1 }}>
                      验收清单提示目标达成，与子任务拆分互不冲突。
                    </Text>
                  </View>
                </View>
              ) : (
                <View style={[styles.frow, { alignItems: 'flex-start', paddingVertical: 8 }]}>
                  <Text style={[styles.frowLab, { color: '#8A968C', marginTop: 4 }]}>备注</Text>
                  <View style={{ flex: 1, minWidth: 0, gap: 8 }}>
                    <TextInput
                      value={note}
                      onChangeText={setNote}
                      placeholder="可选补充说明，下方可贴多图"
                      placeholderTextColor={tf.faint}
                      multiline
                      style={[styles.frowInput, { color: tf.ink2, minHeight: 36 }]}
                    />
                    <NoteImageAttach
                      uris={noteImageUris}
                      onChangeUris={setNoteImageUris}
                      disabled={formBusy}
                      borderColor={tf.line2}
                      mutedColor={tf.faint}
                      surfaceColor={isDark ? colors.input : '#F1EDE1'}
                    />
                  </View>
                </View>
              )}
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
            </View>
          </FoldRiseIn>

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
  aiFillBtn: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  aiFillBtnText: { fontSize: 13, fontWeight: '800' },
  aiFillBtnHint: { marginLeft: 'auto', fontSize: 11, fontWeight: '600' },
  aiModalBackdrop: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 22,
    backgroundColor: 'rgba(20,28,22,0.42)',
  },
  aiModalCard: {
    borderRadius: 16,
    padding: 16,
    gap: 10,
  },
  aiModalTitle: { fontSize: 18, fontWeight: '800' },
  aiModalSub: { fontSize: 12, lineHeight: 17 },
  aiModalInput: {
    minHeight: 88,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    textAlignVertical: 'top',
  },
  aiModalActions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  aiModalGhost: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  aiModalPrimary: {
    flex: 1.2,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
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

