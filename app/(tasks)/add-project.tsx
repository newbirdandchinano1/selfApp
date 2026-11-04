/**
 * 新建项目 — 对齐设计稿 shot 17
 * 名称校验抖动 · 依赖不合法 toast · FoldRiseIn 入场 · 创建成功
 */
import {
  ComposerCategoryModal,
  ComposerTopBar,
  taskPriorityKeyToNumber,
  type TaskPriorityKey,
} from '@/components/composer';
import {
  clampTitle,
  ENTITY_TITLE_MAX,
  extractDueDateFromDeadlineText,
  useComposerSchedule,
  validateRequiredTitle,
} from '@/components/entity-form';
import { MonthGoalPickerField } from '@/components/life-road/MonthGoalPickerField';
import { PrerequisiteProjectPickerField } from '@/components/projects/PrerequisiteProjectPickerField';
import { ProgressHabitBindingsField } from '@/components/projects/ProgressHabitBindingsField';
import { ProjectTagPickerField } from '@/components/projects/ProjectTagPickerField';
import { FoldRiseIn, useFoldMotionGate } from '@/components/review/fold-motion';
import { AcceptanceChecklistEditor } from '@/components/tasks/AcceptanceChecklistEditor';
import { BoundHabitPickerField } from '@/components/tasks/BoundHabitPickerField';
import { EntityIconPickerField } from '@/components/tasks/EntityIconPickerField';
import { NoteImageAttach } from '@/components/tasks/note-image-attach';
import { RewardPointsStepper } from '@/components/tasks/RewardPointsStepper';
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
  type AcceptanceCriterionItem,
} from '@/lib/acceptance-criteria';
import { markPendingTablesDirty } from '@/lib/api-incremental-sync';
import { toast } from '@/lib/app-feedback';
import {
  DEFAULT_PROJECT_ICON,
  mergeIconIntoExtraData,
} from '@/lib/constants/entity-icon-choices';
import { makeTimestampEntityId } from '@/lib/entity-id';
import { mergeLongTermProjectIntoExtraData } from '@/lib/long-term-task';
import { mergeNoteImageUrisIntoExtraData } from '@/lib/note-image-extra';
import { bindNoteImages, ensureNoteImagesRemote } from '@/lib/note-images';
import { getHabits } from '@/lib/repositories/habits/habit';
import { getHabitContexts } from '@/lib/repositories/habits/habit-context';
import type { HabitRow } from '@/lib/repositories/habits/habit.types';
import { getMonthGoalsLocal } from '@/lib/repositories/life-road/life-road-node';
import type { LifeRoadNodeRow } from '@/lib/repositories/life-road/life-road-node.types';
import { INBOX_PROJECT_CATEGORY_ID, INBOX_PROJECT_CATEGORY_NAME } from '@/lib/repositories/projects/constants';
import {
  filterHabitsForProjectCompletionPicker,
  mergeCompletionHabitIdsIntoExtraData,
} from '@/lib/repositories/projects/project-completion-habits';
import {
  filterHabitsForProjectProgressPicker,
  mergeProgressHabitBindingsIntoExtraData,
  stampProgressHabitBindingsSinceYmd,
  validateProgressHabitBindingsForSave,
  type ProjectProgressHabitBinding,
} from '@/lib/repositories/projects/project-progress-habits';
import { getDayBoundarySync, getLogicalLocalYmd } from '@/lib/tasks-logical-day';
import {
  mergePrerequisiteIdsIntoExtraData,
  validatePrerequisiteSelection,
} from '@/lib/repositories/projects/project-prerequisites';
import { ensureProjectScheduleMetaForSave } from '@/lib/repositories/projects/project-schedule-save';
import { createProject, getProjectCategories, getProjects, isProjectNameDuplicate } from '@/lib/repositories/projects/project';
import { getProjectTags, setProjectTagIds } from '@/lib/repositories/projects/project-tag';
import type { ProjectCategoryRow, ProjectRow } from '@/lib/repositories/projects/project.types';
import type { ProjectTagRow } from '@/lib/repositories/projects/project-tag.types';
import { createTask } from '@/lib/repositories/tasks/task';
import {
  mergeRewardPointsIntoExtraData,
  normalizeRewardPoints,
} from '@/lib/reward-points';
import { dueDateFromScheduleMeta } from '@/lib/schedule-inherit';
import { normalizeRouteParam } from '@/lib/schedule-picker-bridge';
import { requestPush } from '@/lib/sync-manager';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import {
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

function buildProjectId() {
  return makeTimestampEntityId('p_', 8);
}

function buildTaskId() {
  return makeTimestampEntityId('tsk_', 8);
}

function formatPriorityShort(priority: number): string {
  if (priority >= 4) return 'P1';
  if (priority === 3) return 'P2';
  if (priority === 2) return 'P3';
  if (priority === 1) return 'P4';
  return '';
}

type InitialTaskDraft = { id: string; title: string };

function ensureInboxCategory(rows: ProjectCategoryRow[]): ProjectCategoryRow[] {
  const now = new Date().toISOString();
  const inbox: ProjectCategoryRow = {
    id: INBOX_PROJECT_CATEGORY_ID,
    name: INBOX_PROJECT_CATEGORY_NAME,
    sort_order: 0,
    created_at: now,
    updated_at: now,
    sync_status: 'synced',
    extra_data: null,
  };

  const withoutInbox = rows.filter((row) => row.id !== INBOX_PROJECT_CATEGORY_ID);
  const existing = rows.find((row) => row.id === INBOX_PROJECT_CATEGORY_ID);
  if (!existing) return [inbox, ...withoutInbox];

  return [
    {
      ...existing,
      name: INBOX_PROJECT_CATEGORY_NAME,
    },
    ...withoutInbox,
  ];
}

const PAGE_API_KEY = 'add-project';

export default function AddProjectScreen() {
  const { wrapLoad, notifyAncestorsDataChanged } = usePageApiSync(PAGE_API_KEY);
  const router = useRouter();
  const params = useLocalSearchParams<{
    source?: string;
    categoryId?: string | string[];
    /** 复盘建议等入口预填项目名 */
    title?: string;
    /** 从月目标「快速创建项目」预填归属 */
    life_month_goal_id?: string | string[];
  }>();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useAppTheme();
  const { tf, fonts } = useTaskFoldTheme();
  const { animate: foldAnimate } = useFoldMotionGate();

  const prefillTitle =
    typeof params.title === 'string' ? params.title.trim() : Array.isArray(params.title) ? (params.title[0] ?? '').trim() : '';
  const [title, setTitle] = React.useState(prefillTitle);
  const [entityIcon, setEntityIcon] = React.useState(DEFAULT_PROJECT_ICON);
  const [notes, setNotes] = React.useState('');
  const [noteImageUris, setNoteImageUris] = React.useState<string[]>([]);
  const [acceptanceItems, setAcceptanceItems] = React.useState<AcceptanceCriterionItem[]>([
    createEmptyAcceptanceItem(),
  ]);
  const [categories, setCategories] = React.useState<ProjectCategoryRow[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = React.useState<string | null>(null);
  const [categoryModalVisible, setCategoryModalVisible] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  const [allProjects, setAllProjects] = React.useState<ProjectRow[]>([]);
  const [projectsLoading, setProjectsLoading] = React.useState(true);
  const [prerequisiteProjectIds, setPrerequisiteProjectIds] = React.useState<string[]>([]);
  const [completionHabitIds, setCompletionHabitIds] = React.useState<string[]>([]);
  const [progressHabitBindings, setProgressHabitBindings] = React.useState<
    ProjectProgressHabitBinding[]
  >([]);
  const [allHabits, setAllHabits] = React.useState<HabitRow[]>([]);
  const [habitContexts, setHabitContexts] = React.useState<{ id: string; name: string }[]>([]);
  const [habitsLoading, setHabitsLoading] = React.useState(true);
  const [selectedTagIds, setSelectedTagIds] = React.useState<string[]>([]);
  const [allTags, setAllTags] = React.useState<ProjectTagRow[]>([]);
  const [tagsLoading, setTagsLoading] = React.useState(true);
  const [isLongTermProject, setIsLongTermProject] = React.useState(false);
  const routeMonthGoalId = React.useMemo(() => {
    const raw = params.life_month_goal_id;
    const s = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw[0] : '';
    return (s ?? '').trim() || null;
  }, [params.life_month_goal_id]);
  const [selectedMonthGoalId, setSelectedMonthGoalId] = React.useState<string | null>(
    routeMonthGoalId,
  );
  const [monthGoals, setMonthGoals] = React.useState<LifeRoadNodeRow[]>([]);
  const [monthGoalsLoading, setMonthGoalsLoading] = React.useState(true);
  const monthGoalPrefillBanner = React.useMemo(() => {
    if (!routeMonthGoalId) return null;
    const g = monthGoals.find((n) => n.id === routeMonthGoalId);
    if (!g) return '已从道路月目标创建，归属已预填';
    const m = g.month != null ? `${g.month} 月` : '月目标';
    return `已从「${m} · ${g.title}」创建，归属已预填`;
  }, [monthGoals, routeMonthGoalId]);
  const [rewardPointsText, setRewardPointsText] = React.useState('20');
  const [priority, setPriority] = React.useState<TaskPriorityKey>('urgent-not-important');
  const [initialTasks, setInitialTasks] = React.useState<InitialTaskDraft[]>([]);
  const [draftInitialTitle, setDraftInitialTitle] = React.useState('');
  const [addingInitialTask, setAddingInitialTask] = React.useState(false);
  const appliedRouteCategoryRef = React.useRef(false);
  const titleShake = React.useRef(new Animated.Value(0)).current;
  const titleInputRef = React.useRef<React.ElementRef<typeof TextInput>>(null);
  const draftInitialInputRef = React.useRef<React.ElementRef<typeof TextInput>>(null);

  const routeCategoryId = React.useMemo(() => {
    const raw = params.categoryId;
    const s = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw[0] : '';
    const t = (s ?? '').trim();
    if (!t || t === 'all') return null;
    return t;
  }, [params.categoryId]);

  const scheduleSource = normalizeRouteParam(params.source as string | string[] | undefined) || 'add-project';
  const {
    deadlineText,
    reminderText,
    repeatText,
    scheduleMeta,
    openSchedulePicker,
  } = useComposerSchedule({ source: scheduleSource });

  const foldCardBg = isDark ? colors.surfaceMuted : 'rgba(255,252,245,0.86)';
  const foldCardBorder = tf.line2;
  const logicalTodayYmd = React.useMemo(
    () => getLogicalLocalYmd(new Date(), getDayBoundarySync()),
    [],
  );
  const frowBorder = {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(232,224,210,0.52)',
  } as const;

  useFocusEffect(
    React.useCallback(() => {
      void (async () => {
        try {
          const tags = await getProjectTags();
          setAllTags(tags);
          setSelectedTagIds((prev) => prev.filter((id) => tags.some((t) => t.id === id)));
        } catch (error) {
          console.warn('刷新项目标签失败', error);
        }
      })();
    }, []),
  );

  const reload = React.useCallback(async (forceRefresh = false) => {
    await wrapLoad(async () => {
      try {
        const rows = await getProjectCategories();
        setCategories(ensureInboxCategory(rows));
      } catch (error) {
        console.warn('加载项目分类失败', error);
        setCategories(ensureInboxCategory([]));
      }
      setProjectsLoading(true);
      try {
        const projectRows = await getProjects();
        setAllProjects(projectRows);
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
      setMonthGoalsLoading(true);
      try {
        setMonthGoals(await getMonthGoalsLocal());
      } catch (error) {
        console.warn('加载月目标失败', error);
        setMonthGoals([]);
      } finally {
        setMonthGoalsLoading(false);
      }
      setHabitsLoading(true);
      try {
        const [contexts, habits] = await Promise.all([getHabitContexts(), getHabits()]);
        setHabitContexts(contexts.map((c) => ({ id: c.id, name: c.name })));
        setAllHabits(habits);
      } catch (error) {
        console.warn('加载小习惯列表失败', error);
        setHabitContexts([]);
        setAllHabits([]);
      } finally {
        setHabitsLoading(false);
      }
    }, forceRefresh);
  }, [wrapLoad]);

  const habitSections = React.useMemo(() => {
    const filtered = filterHabitsForProjectCompletionPicker(allHabits, completionHabitIds);
    const habitsByContext = new Map<string, HabitRow[]>();
    for (const habit of filtered) {
      const list = habitsByContext.get(habit.context) ?? [];
      list.push(habit);
      habitsByContext.set(habit.context, list);
    }
    return habitContexts.map((ctx) => ({
      contextId: ctx.id,
      contextName: ctx.name,
      habits: habitsByContext.get(ctx.id) ?? [],
    }));
  }, [allHabits, completionHabitIds, habitContexts]);

  const progressHabitSections = React.useMemo(() => {
    const selectedIds = progressHabitBindings.map((b) => b.habitId);
    const filtered = filterHabitsForProjectProgressPicker(allHabits, selectedIds);
    const habitsByContext = new Map<string, HabitRow[]>();
    for (const habit of filtered) {
      const list = habitsByContext.get(habit.context) ?? [];
      list.push(habit);
      habitsByContext.set(habit.context, list);
    }
    return habitContexts.map((ctx) => ({
      contextId: ctx.id,
      contextName: ctx.name,
      habits: habitsByContext.get(ctx.id) ?? [],
    }));
  }, [allHabits, habitContexts, progressHabitBindings]);

  const { refreshControl } = usePagePullRefresh(PAGE_API_KEY, reload);

  React.useEffect(() => {
    void reload();
  }, [reload]);

  const selectableProjectCategories = React.useMemo(
    () => categories.filter((c) => c.id !== INBOX_PROJECT_CATEGORY_ID),
    [categories],
  );

  React.useEffect(() => {
    if (categories.length === 0 || appliedRouteCategoryRef.current) return;
    appliedRouteCategoryRef.current = true;
    if (
      routeCategoryId &&
      routeCategoryId !== INBOX_PROJECT_CATEGORY_ID &&
      categories.some((c) => c.id === routeCategoryId)
    ) {
      setSelectedCategoryId(routeCategoryId);
      return;
    }
    const firstNonInbox = categories.find((c) => c.id !== INBOX_PROJECT_CATEGORY_ID);
    setSelectedCategoryId(firstNonInbox?.id ?? null);
  }, [categories, routeCategoryId]);

  const playTitleShake = React.useCallback(() => {
    titleShake.setValue(0);
    Animated.sequence([
      Animated.timing(titleShake, { toValue: 1, duration: 50, useNativeDriver: true }),
      Animated.timing(titleShake, { toValue: -1, duration: 50, useNativeDriver: true }),
      Animated.timing(titleShake, { toValue: 1, duration: 50, useNativeDriver: true }),
      Animated.timing(titleShake, { toValue: 0, duration: 50, useNativeDriver: true }),
    ]).start();
    titleInputRef.current?.focus?.();
  }, [titleShake]);

  const createProjectRecord = React.useCallback(async () => {
    const titleCheck = validateRequiredTitle(title, { emptyMessage: '请输入项目名称后再创建。' });
    if (!titleCheck.ok) {
      toast.warn(titleCheck.message);
      playTitleShake();
      return;
    }
    const trimmedTitle = titleCheck.title;
    const hasDuplicateName = await isProjectNameDuplicate(trimmedTitle);
    if (hasDuplicateName) {
      toast.warn('项目名称不能重复，请更换后重试');
      playTitleShake();
      return;
    }
    if (creating) return;

    const prereqValidation = validatePrerequisiteSelection(null, prerequisiteProjectIds, allProjects);
    if (!prereqValidation.ok) {
      toast.warn(prereqValidation.message);
      return;
    }

    const progressValidation = validateProgressHabitBindingsForSave(progressHabitBindings);
    if (!progressValidation.ok) {
      toast.warn(progressValidation.message);
      return;
    }
    const stampedProgressBindings = stampProgressHabitBindingsSinceYmd(
      progressValidation.bindings,
      logicalTodayYmd,
      progressHabitBindings,
    );

    setCreating(true);
    try {
      const projectId = buildProjectId();
      const scheduleToSave = ensureProjectScheduleMetaForSave(scheduleMeta, deadlineText);
      const extra = mergeProgressHabitBindingsIntoExtraData(
        mergeCompletionHabitIdsIntoExtraData(
          mergePrerequisiteIdsIntoExtraData({ schedule: scheduleToSave }, prerequisiteProjectIds),
          completionHabitIds,
        ),
        stampedProgressBindings,
      );
      const checklist = isLongTermProject ? acceptanceItems : [];
      const withLongTerm = mergeLongTermProjectIntoExtraData(JSON.stringify(extra), isLongTermProject);
      const withReward = mergeRewardPointsIntoExtraData(
        withLongTerm,
        normalizeRewardPoints(rewardPointsText),
      );
      const withIcon = mergeIconIntoExtraData(withReward, entityIcon, DEFAULT_PROJECT_ICON);
      let withAcceptance = mergeAcceptanceChecklistIntoExtraData(withIcon, checklist) ?? withIcon;
      let nextNoteImages = isLongTermProject ? [] : [...noteImageUris];
      if (nextNoteImages.length > 0) {
        nextNoteImages = await ensureNoteImagesRemote({
          localUris: nextNoteImages,
          owner: { table: 'projects', id: projectId },
        });
        withAcceptance =
          mergeNoteImageUrisIntoExtraData(withAcceptance, nextNoteImages) ?? withAcceptance;
      }
      const projectPriority = taskPriorityKeyToNumber(priority);
      const projectDueDate = dueDateFromScheduleMeta(
        scheduleToSave,
        extractDueDateFromDeadlineText(deadlineText),
      );
      await createProject({
        id: projectId,
        name: trimmedTitle,
        category_id: selectedCategoryId,
        life_month_goal_id: selectedMonthGoalId,
        life_bet_id: null,
        priority: projectPriority,
        note: isLongTermProject
          ? acceptanceChecklistToLines(acceptanceItems) || null
          : notes.trim() || null,
        due_date: projectDueDate,
        extra_data: withAcceptance,
      });
      if (nextNoteImages.length > 0) {
        await bindNoteImages({ table: 'projects', id: projectId }, nextNoteImages);
      }
      await setProjectTagIds(projectId, selectedTagIds);

      const seededTasks = initialTasks
        .map((t) => ({ id: t.id, title: t.title.trim() }))
        .filter((t) => t.title.length > 0);
      for (const seed of seededTasks) {
        await createTask({
          id: seed.id,
          project_id: projectId,
          category_id: selectedCategoryId,
          parent_task_id: null,
          title: seed.title,
          status: 'todo',
          priority: projectPriority,
          due_date: projectDueDate,
          extra_data: scheduleToSave
            ? JSON.stringify({ schedule: scheduleToSave })
            : null,
        });
      }

      try {
        const projectSyncTables = seededTasks.length
          ? ['projects', 'project_categories', 'tags', 'tag_links', 'tasks']
          : ['projects', 'project_categories', 'tags', 'tag_links'];
        await markPendingTablesDirty(projectSyncTables);
        await requestPush({
          awaitSync: true,
          rethrow: true,
          // 本地已落库；同步失败勿挂全局「加载失败」蒙层
          quiet: true,
          onlyTables: projectSyncTables,
        });
      } catch (syncErr) {
        console.warn('项目创建后同步到服务器失败', syncErr);
      }
      notifyAncestorsDataChanged();
      toast.success(
        seededTasks.length > 0
          ? `已创建 · ${trimmedTitle} · ${seededTasks.length} 个初始任务`
          : `已创建 · ${trimmedTitle}`,
      );
      router.back();
    } catch (error) {
      console.warn('创建项目失败', error);
      toast.error('项目保存失败，请稍后重试');
    } finally {
      setCreating(false);
    }
  }, [
    allProjects,
    completionHabitIds,
    progressHabitBindings,
    logicalTodayYmd,
    creating,
    deadlineText,
    entityIcon,
    initialTasks,
    acceptanceItems,
    isLongTermProject,
    notes,
    noteImageUris,
    notifyAncestorsDataChanged,
    playTitleShake,
    prerequisiteProjectIds,
    priority,
    rewardPointsText,
    router,
    scheduleMeta,
    selectedCategoryId,
    selectedMonthGoalId,
    selectedTagIds,
    title,
  ]);

  const priorityShort = formatPriorityShort(taskPriorityKeyToNumber(priority));

  const draftInitialTitleRef = React.useRef(draftInitialTitle);
  draftInitialTitleRef.current = draftInitialTitle;
  const committingInitialRef = React.useRef(false);

  const commitDraftInitialTask = React.useCallback(() => {
    if (committingInitialRef.current) return;
    committingInitialRef.current = true;
    const trimmed = draftInitialTitleRef.current.trim();
    setDraftInitialTitle('');
    setAddingInitialTask(false);
    if (trimmed) {
      setInitialTasks((prev) => [...prev, { id: buildTaskId(), title: trimmed.slice(0, 80) }]);
    }
    requestAnimationFrame(() => {
      committingInitialRef.current = false;
    });
  }, []);

  const startAddInitialTask = React.useCallback(() => {
    if (creating) return;
    setAddingInitialTask(true);
    setDraftInitialTitle('');
    requestAnimationFrame(() => draftInitialInputRef.current?.focus?.());
  }, [creating]);

  const titleMax = ENTITY_TITLE_MAX.project;
  const handleTitleChange = (text: string) => {
    setTitle(clampTitle(text, titleMax));
  };

  const rewardN = Math.round(Number(rewardPointsText) || 0);
  const footPad = Math.max(insets.bottom, 12);
  const titleShakeX = titleShake.interpolate({
    inputRange: [-1, 0, 1],
    outputRange: [-6, 0, 6],
  });

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: tf.paper }]} edges={['left', 'right']}>
      <ComposerTopBar
        title="新建项目"
        subtitle="分类 · 优先级 · 依赖 · 日程"
        onBack={() => router.back()}
        onSubmit={() => void createProjectRecord()}
        submitting={creating}
        submitLabel="创建"
      />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView
          refreshControl={refreshControl}
          contentContainerStyle={[styles.foldContent, { paddingBottom: 110 + footPad }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <FoldRiseIn animate={foldAnimate} index={0} duration={520} staggerMs={42} fromY={10} holdHidden={foldAnimate}>
            <Animated.View
              style={[
                styles.fcard,
                { backgroundColor: foldCardBg, borderColor: foldCardBorder, transform: [{ translateX: titleShakeX }] },
              ]}>
              <View style={styles.titleRow}>
                <EntityIconPickerField
                  compact
                  value={entityIcon}
                  onChange={setEntityIcon}
                  fallback={DEFAULT_PROJECT_ICON}
                  disabled={creating}
                  accessibilityLabel="选择项目图标"
                />
                <View style={{ flex: 1 }}>
                  <TextInput
                    ref={titleInputRef}
                    value={title}
                    onChangeText={handleTitleChange}
                    placeholder="写下项目名称…"
                    placeholderTextColor={tf.faint}
                    multiline
                    maxLength={titleMax}
                    style={[styles.foldTitleInput, { color: tf.ink, fontFamily: fonts.serif }]}
                  />
                </View>
              </View>
              <View style={styles.foldChipRow}>
                {selectableProjectCategories.slice(0, 4).map((cat) => {
                  const active = selectedCategoryId === cat.id;
                  return (
                    <Pressable
                      key={cat.id}
                      onPress={() => setSelectedCategoryId(cat.id)}
                      style={[
                        styles.fchip,
                        active && { backgroundColor: tf.pond, borderColor: tf.pond },
                      ]}>
                      <Text style={[styles.fchipText, { color: active ? tf.onPond : '#7C897E' }]}>
                        {cat.name}
                      </Text>
                    </Pressable>
                  );
                })}
                <Pressable
                  onPress={() => setCategoryModalVisible(true)}
                  style={[styles.fchip, styles.fchipOut, { borderColor: tf.line2 }]}>
                  <Text style={[styles.fchipText, { color: '#8C988E' }]}>＋ 分类</Text>
                </Pressable>
                <Text style={{ marginLeft: 'auto', fontSize: 10, color: tf.faint, alignSelf: 'center' }}>
                  名称不可重复
                </Text>
              </View>
            </Animated.View>
          </FoldRiseIn>

          <FoldRiseIn animate={foldAnimate} index={1} duration={520} staggerMs={42} fromY={10} holdHidden={foldAnimate}>
            <View style={[styles.fcard, { backgroundColor: foldCardBg, borderColor: foldCardBorder }]}>
              <TaskFoldPriorityGrid
                value={priority}
                onChange={setPriority}
                subtitle="项目本身不直接进入四象限，任务会"
              />
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
                <Text style={[styles.frowLab, { color: '#8A968C' }]}>前置项目</Text>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <PrerequisiteProjectPickerField
                    selectedIds={prerequisiteProjectIds}
                    allProjects={allProjects}
                    loading={projectsLoading}
                    onChange={setPrerequisiteProjectIds}
                    textColor={tf.ink}
                    outline={tf.muted}
                    placeholderColor={tf.faint}
                    primary={tf.pond}
                    surfaceLow={isDark ? colors.input : '#F1EDE1'}
                    surfaceLowest={isDark ? colors.surface : tf.card}
                    isDark={isDark}
                  />
                </View>
              </View>
              <View style={[styles.frow, frowBorder, { alignItems: 'flex-start', paddingVertical: 10 }]}>
                <Text style={[styles.frowLab, { color: '#8A968C', marginTop: 10 }]}>完成条件</Text>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <BoundHabitPickerField
                    selectedHabitIds={completionHabitIds}
                    sections={habitSections}
                    loading={habitsLoading}
                    onChange={setCompletionHabitIds}
                    textColor={tf.ink}
                    outline={tf.muted}
                    placeholderColor={tf.faint}
                    primary={tf.pond}
                    surfaceLow={isDark ? colors.input : '#F1EDE1'}
                    surfaceLowest={isDark ? colors.surface : tf.card}
                    isDark={isDark}
                    emptyHint="可选；这些习惯的周期目标成功后，才建议结案"
                    selectedHint="全部达成周期目标后，才满足项目完成条件"
                    modalTitle="完成条件 · 小习惯"
                    modalDesc="可多选。仅显示已设周期目标的养成/戒除习惯；全部达成后才可收尾本项目（任务齐时也可自动归档）。"
                  />
                </View>
              </View>
              <View style={[styles.frow, frowBorder, { alignItems: 'flex-start', paddingVertical: 10 }]}>
                <Text style={[styles.frowLab, { color: '#8A968C', marginTop: 10 }]}>推进进度</Text>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <ProgressHabitBindingsField
                    bindings={progressHabitBindings}
                    sections={progressHabitSections}
                    loading={habitsLoading}
                    onChange={setProgressHabitBindings}
                    anchorYmd={logicalTodayYmd}
                    textColor={tf.ink}
                    outline={tf.muted}
                    placeholderColor={tf.faint}
                    primary={tf.pond}
                    surfaceLow={isDark ? colors.input : '#F1EDE1'}
                    surfaceLowest={isDark ? colors.surface : tf.card}
                    isDark={isDark}
                  />
                </View>
              </View>
              <Pressable
                onPress={openSchedulePicker}
                style={({ pressed }) => [styles.frow, frowBorder, { opacity: pressed ? 0.88 : 1 }]}>
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
                <Text style={[styles.frowLab, { color: '#8A968C' }]}>长期</Text>
                <Text style={{ flex: 1, fontSize: 12, color: tf.faint }}>无子任务时可指派青蛙</Text>
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
                      setNoteImageUris([]);
                    } else {
                      setNotes((prev) => prev.trim() || acceptanceChecklistToLines(acceptanceItems));
                      setAcceptanceItems([createEmptyAcceptanceItem()]);
                    }
                    setIsLongTermProject(next);
                  }}
                  accessibilityLabel="长期项目"
                />
              </View>
              <View style={styles.hintline}>
                <MaterialIcons name="lightbulb-outline" size={13} color={tf.faint} />
                <Text style={{ flex: 1, fontSize: 11, color: tf.faint, lineHeight: 15 }}>
                  项目设日程后，下属任务默认继承；越界会被钳制。
                </Text>
              </View>
            </View>
          </FoldRiseIn>

          <FoldRiseIn animate={foldAnimate} index={3} duration={520} staggerMs={42} fromY={10} holdHidden={foldAnimate}>
            <View
              style={[
                styles.fcard,
                styles.fcardTight,
                { backgroundColor: foldCardBg, borderColor: foldCardBorder },
              ]}>
              <View style={styles.frow}>
                <Text style={[styles.frowLab, { color: '#8A968C' }]}>奖励积分</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.frowValBold, { color: tf.ink2 }]}>
                    {rewardN > 0 ? `+${rewardN}` : String(rewardN)}
                  </Text>
                  <Text style={{ fontSize: 10, color: tf.faint }}>项目完成时结算</Text>
                </View>
                <RewardPointsStepper
                  value={rewardPointsText}
                  onChange={setRewardPointsText}
                  monoFontFamily={fonts.mono}
                />
              </View>
              {isLongTermProject ? (
                <View style={[styles.frow, frowBorder, { alignItems: 'flex-start', paddingVertical: 8 }]}>
                  <Text style={[styles.frowLab, { color: '#8A968C', marginTop: 4 }]}>验收标准</Text>
                  <View style={{ flex: 1, minWidth: 0 }}>
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
                  </View>
                </View>
              ) : (
                <View style={[styles.frow, frowBorder, { alignItems: 'flex-start', paddingVertical: 8 }]}>
                  <Text style={[styles.frowLab, { color: '#8A968C', marginTop: 4 }]}>备注</Text>
                  <View style={{ flex: 1, minWidth: 0, gap: 8 }}>
                    <TextInput
                      value={notes}
                      onChangeText={setNotes}
                      placeholder="可选补充说明，下方可贴多图"
                      placeholderTextColor={tf.faint}
                      multiline
                      style={[styles.frowInput, { color: tf.ink2, minHeight: 36 }]}
                    />
                    <NoteImageAttach
                      uris={noteImageUris}
                      onChangeUris={setNoteImageUris}
                      disabled={creating}
                      borderColor={tf.line2}
                      mutedColor={tf.faint}
                      surfaceColor={isDark ? colors.input : '#F1EDE1'}
                    />
                  </View>
                </View>
              )}
              <View style={[styles.frow, frowBorder]}>
                <Text style={[styles.frowLab, { color: '#8A968C' }]}>标签</Text>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <ProjectTagPickerField
                    selectedIds={selectedTagIds}
                    allTags={allTags}
                    loading={tagsLoading}
                    onChange={setSelectedTagIds}
                    textColor={tf.ink}
                    outline={tf.muted}
                    placeholderColor={tf.faint}
                    primary={tf.pond}
                    surfaceLow={isDark ? colors.input : '#F1EDE1'}
                    surfaceLowest={isDark ? colors.surface : tf.card}
                    isDark={isDark}
                  />
                </View>
              </View>
            </View>
          </FoldRiseIn>

          <FoldRiseIn animate={foldAnimate} index={4} duration={520} staggerMs={42} fromY={8} holdHidden={foldAnimate}>
            <View
              style={[
                styles.fcard,
                styles.fcardTight,
                { backgroundColor: foldCardBg, borderColor: foldCardBorder, paddingVertical: 12 },
              ]}>
              <MonthGoalPickerField
                selectedId={selectedMonthGoalId}
                monthGoals={monthGoals}
                loading={monthGoalsLoading}
                onChange={setSelectedMonthGoalId}
                prefillBanner={monthGoalPrefillBanner}
              />
              <Text style={{ fontSize: 11, lineHeight: 16, color: tf.faint, marginTop: 10 }}>
                道路归属只影响导图里的挂载位置，不会改变项目自身的任务、日历与积分。
              </Text>
            </View>
          </FoldRiseIn>

          <FoldRiseIn animate={foldAnimate} index={5} duration={520} staggerMs={42} fromY={8} holdHidden={foldAnimate}>
            <View
              style={[
                styles.fbox,
                { backgroundColor: foldCardBg, borderColor: foldCardBorder },
              ]}>
              <Text style={{ fontSize: 12, color: tf.muted, lineHeight: 18 }}>
                <Text style={{ fontWeight: '800', color: '#546A58' }}>创建后</Text>
                {' · '}
                自动生成「收集箱项目」？不会。先加任务，再把叶子任务指派为青蛙；有子任务后项目本身不能再当青蛙实体。
              </Text>
            </View>
          </FoldRiseIn>

          <FoldRiseIn animate={foldAnimate} index={6} duration={520} staggerMs={42} fromY={10} holdHidden={foldAnimate}>
            <View
              style={[
                styles.fcard,
                styles.fcardTight,
                { backgroundColor: foldCardBg, borderColor: foldCardBorder },
              ]}>
              <View style={styles.initialHead}>
                <Text style={{ fontSize: 13, fontWeight: '800', color: '#5B6A5D' }}>初始任务</Text>
                <Text style={{ fontSize: 10, color: tf.faint, flex: 1 }}>可选 · 创建后仍可编辑</Text>
                <Pressable
                  onPress={startAddInitialTask}
                  disabled={creating}
                  hitSlop={8}
                  style={({ pressed }) => ({ opacity: creating ? 0.5 : pressed ? 0.75 : 1 })}>
                  <Text style={{ fontSize: 11, color: '#6F856B', fontWeight: '600' }}>＋ 添加</Text>
                </Pressable>
              </View>
              {initialTasks.length === 0 && !addingInitialTask ? (
                <Text style={{ fontSize: 12, color: tf.faint, paddingVertical: 6, paddingHorizontal: 2 }}>
                  创建时可顺手记下首批叶子任务
                </Text>
              ) : null}
              {initialTasks.map((task) => (
                <View key={task.id} style={styles.trow}>
                  <View style={[styles.cb, { borderColor: tf.line2 }]}>
                    <MaterialIcons name="check" size={11} color={tf.faint} />
                  </View>
                  <Text style={[styles.tn, { color: tf.ink2 }]} numberOfLines={2}>
                    {task.title}
                  </Text>
                  {priorityShort ? (
                    <Text style={[styles.tp, { color: tf.faint }]}>{priorityShort}</Text>
                  ) : null}
                  <Pressable
                    onPress={() =>
                      setInitialTasks((prev) => prev.filter((item) => item.id !== task.id))
                    }
                    disabled={creating}
                    hitSlop={8}
                    accessibilityLabel="移除初始任务">
                    <MaterialIcons name="close" size={14} color={tf.faint} />
                  </Pressable>
                </View>
              ))}
              {addingInitialTask ? (
                <View style={styles.trow}>
                  <View style={[styles.cb, { borderColor: tf.pond, backgroundColor: 'rgba(79,124,81,0.08)' }]} />
                  <TextInput
                    ref={draftInitialInputRef}
                    value={draftInitialTitle}
                    onChangeText={(t) => setDraftInitialTitle(t.slice(0, 80))}
                    placeholder="任务名称…"
                    placeholderTextColor={tf.faint}
                    autoFocus
                    returnKeyType="done"
                    onSubmitEditing={commitDraftInitialTask}
                    onBlur={commitDraftInitialTask}
                    editable={!creating}
                    style={[styles.tnInput, { color: tf.ink2 }]}
                  />
                  <Pressable onPress={commitDraftInitialTask} hitSlop={8}>
                    <Text style={{ fontSize: 11, color: tf.pond, fontWeight: '700' }}>完成</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          </FoldRiseIn>

          <FoldRiseIn animate={foldAnimate} index={7} duration={520} staggerMs={42} fromY={8} holdHidden={foldAnimate}>
            <View
              style={[
                styles.fbox,
                { backgroundColor: foldCardBg, borderColor: foldCardBorder },
              ]}>
              <Text style={{ fontSize: 12, color: tf.muted, lineHeight: 18 }}>
                <Text style={{ fontWeight: '800', color: '#546A58' }}>创建后</Text>
                {' · '}
                项目出现在分类顶部；日程会继承给下属任务；有子任务后项目本身不能再当青蛙实体。
              </Text>
            </View>
          </FoldRiseIn>

          <FoldRiseIn animate={foldAnimate} index={8} duration={520} staggerMs={42} fromY={8} holdHidden={foldAnimate}>
            <View style={styles.hintline}>
              <MaterialIcons name="sync" size={13} color={tf.faint} />
              <Text style={{ fontSize: 11, color: tf.faint }}>创建时会先写本机，联网后再同步。</Text>
            </View>
          </FoldRiseIn>
        </ScrollView>

        <View style={[styles.foldFoot, { paddingBottom: footPad, backgroundColor: tf.paper }]}>
          <Pressable
            onPress={() => void createProjectRecord()}
            disabled={creating}
            style={({ pressed }) => [
              styles.foldPrimary,
              {
                backgroundColor: tf.pond,
                opacity: creating ? 0.65 : pressed ? 0.9 : 1,
              },
            ]}>
            <MaterialIcons name="eco" size={18} color={tf.onPond} />
            <Text style={[styles.foldPrimaryText, { color: tf.onPond }]}>
              {creating ? '创建中…' : '创建项目'}
            </Text>
          </Pressable>
          <Text style={{ textAlign: 'center', fontSize: 11, color: tf.faint, marginTop: 6 }}>
            创建后可继续添加任务树
          </Text>
        </View>
      </KeyboardAvoidingView>

      <ComposerCategoryModal
        visible={categoryModalVisible}
        title="选择项目分类"
        selectedId={selectedCategoryId}
        onClose={() => setCategoryModalVisible(false)}
        onSelect={setSelectedCategoryId}
        options={[
          { id: null, name: '未分类' },
          ...selectableProjectCategories.map((item) => ({ id: item.id, name: item.name })),
        ]}
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
  fcard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 10,
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
  },
  fchipOut: { backgroundColor: 'transparent' },
  fchipText: { fontSize: 12, fontWeight: '600' },
  frow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 40,
  },
  frowLab: { width: 64, fontSize: 12, flexShrink: 0 },
  frowValBold: { fontSize: 13, fontWeight: '700' },
  frowInput: { fontSize: 13, paddingVertical: 4, paddingHorizontal: 0, fontWeight: '600' },
  hintline: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 5,
    paddingTop: 6,
    paddingLeft: 4,
  },
  fbox: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  initialHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 2,
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
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tn: { flex: 1, fontSize: 13, fontWeight: '600', lineHeight: 18 },
  tnInput: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    paddingVertical: 0,
    paddingHorizontal: 0,
    minHeight: 20,
  },
  tp: { fontSize: 10, fontWeight: '700' },
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
