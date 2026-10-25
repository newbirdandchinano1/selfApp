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
import { LifeBetPickerField } from '@/components/life-road/LifeBetPickerField';
import { PrerequisiteProjectPickerField } from '@/components/projects/PrerequisiteProjectPickerField';
import { ProjectTagPickerField } from '@/components/projects/ProjectTagPickerField';
import { FoldRiseIn, useFoldMotionGate } from '@/components/review/fold-motion';
import { AcceptanceChecklistEditor } from '@/components/tasks/AcceptanceChecklistEditor';
import { EntityIconPickerField } from '@/components/tasks/EntityIconPickerField';
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
import { getLifeBetsLocal } from '@/lib/repositories/life-road/life-bet';
import type { LifeBetRow } from '@/lib/repositories/life-road/life-bet.types';
import { INBOX_PROJECT_CATEGORY_ID, INBOX_PROJECT_CATEGORY_NAME } from '@/lib/repositories/projects/constants';
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
  const params = useLocalSearchParams<{ source?: string; categoryId?: string | string[] }>();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useAppTheme();
  const { tf, fonts } = useTaskFoldTheme();
  const { animate: foldAnimate } = useFoldMotionGate();

  const [title, setTitle] = React.useState('');
  const [entityIcon, setEntityIcon] = React.useState(DEFAULT_PROJECT_ICON);
  const [notes, setNotes] = React.useState('');
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
  const [selectedTagIds, setSelectedTagIds] = React.useState<string[]>([]);
  const [allTags, setAllTags] = React.useState<ProjectTagRow[]>([]);
  const [tagsLoading, setTagsLoading] = React.useState(true);
  const [isLongTermProject, setIsLongTermProject] = React.useState(false);
  const [selectedLifeBetId, setSelectedLifeBetId] = React.useState<string | null>(null);
  const [lifeBets, setLifeBets] = React.useState<LifeBetRow[]>([]);
  const [lifeBetsLoading, setLifeBetsLoading] = React.useState(true);
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
  }, [wrapLoad]);

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

    setCreating(true);
    try {
      const projectId = buildProjectId();
      const scheduleToSave = ensureProjectScheduleMetaForSave(scheduleMeta, deadlineText);
      const extra = mergePrerequisiteIdsIntoExtraData({ schedule: scheduleToSave }, prerequisiteProjectIds);
      const checklist = isLongTermProject ? acceptanceItems : [];
      const withLongTerm = mergeLongTermProjectIntoExtraData(JSON.stringify(extra), isLongTermProject);
      const withReward = mergeRewardPointsIntoExtraData(
        withLongTerm,
        normalizeRewardPoints(rewardPointsText),
      );
      const withIcon = mergeIconIntoExtraData(withReward, entityIcon, DEFAULT_PROJECT_ICON);
      const withAcceptance = mergeAcceptanceChecklistIntoExtraData(withIcon, checklist) ?? withIcon;
      const projectPriority = taskPriorityKeyToNumber(priority);
      const projectDueDate = dueDateFromScheduleMeta(
        scheduleToSave,
        extractDueDateFromDeadlineText(deadlineText),
      );
      await createProject({
        id: projectId,
        name: trimmedTitle,
        category_id: selectedCategoryId,
        life_bet_id: selectedLifeBetId,
        priority: projectPriority,
        note: isLongTermProject
          ? acceptanceChecklistToLines(acceptanceItems) || null
          : notes.trim() || null,
        due_date: projectDueDate,
        extra_data: withAcceptance,
      });
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
    creating,
    deadlineText,
    entityIcon,
    initialTasks,
    acceptanceItems,
    isLongTermProject,
    notes,
    notifyAncestorsDataChanged,
    playTitleShake,
    prerequisiteProjectIds,
    priority,
    rewardPointsText,
    router,
    scheduleMeta,
    selectedCategoryId,
    selectedLifeBetId,
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

  const bumpReward = React.useCallback((delta: number) => {
    const cur = Number(rewardPointsText);
    const base = Number.isFinite(cur) ? cur : 0;
    setRewardPointsText(String(Math.max(-999, Math.min(999, Math.round(base + delta)))));
  }, [rewardPointsText]);

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
                <View style={styles.stepper}>
                  <Pressable onPress={() => bumpReward(-1)} style={styles.stepperBtn}>
                    <Text style={{ color: '#6F7D72', fontWeight: '700' }}>−</Text>
                  </Pressable>
                  <Text style={{ fontFamily: fonts.mono, fontSize: 13, color: '#5C6D60', minWidth: 24, textAlign: 'center' }}>
                    {rewardN}
                  </Text>
                  <Pressable onPress={() => bumpReward(1)} style={styles.stepperBtn}>
                    <Text style={{ color: '#6F7D72', fontWeight: '700' }}>+</Text>
                  </Pressable>
                </View>
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
                  <TextInput
                    value={notes}
                    onChangeText={setNotes}
                    placeholder="可选补充说明"
                    placeholderTextColor={tf.faint}
                    multiline
                    style={[styles.frowInput, { color: tf.ink2, flex: 1, minHeight: 36 }]}
                  />
                  <MaterialIcons name="edit" size={14} color="#A4ADA3" style={{ marginTop: 6 }} />
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
              <View style={[styles.frow, frowBorder]}>
                <Text style={[styles.frowLab, { color: '#8A968C' }]}>道路</Text>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <LifeBetPickerField
                    selectedId={selectedLifeBetId}
                    allBets={lifeBets}
                    loading={lifeBetsLoading}
                    onChange={setSelectedLifeBetId}
                    textColor={tf.ink}
                    outline={tf.muted}
                    placeholderColor={tf.faint}
                    primary={tf.pond}
                    surfaceLow={isDark ? colors.input : '#F1EDE1'}
                    surfaceLowest={colors.surface}
                    isDark={isDark}
                  />
                </View>
              </View>
            </View>
          </FoldRiseIn>

          <FoldRiseIn animate={foldAnimate} index={4} duration={520} staggerMs={42} fromY={8} holdHidden={foldAnimate}>
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

          <FoldRiseIn animate={foldAnimate} index={5} duration={520} staggerMs={42} fromY={10} holdHidden={foldAnimate}>
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

          <FoldRiseIn animate={foldAnimate} index={6} duration={520} staggerMs={42} fromY={8} holdHidden={foldAnimate}>
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

          <FoldRiseIn animate={foldAnimate} index={7} duration={520} staggerMs={42} fromY={8} holdHidden={foldAnimate}>
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
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepperBtn: {
    width: 22,
    height: 22,
    borderRadius: 6,
    backgroundColor: '#F0EBDE',
    alignItems: 'center',
    justifyContent: 'center',
  },
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
