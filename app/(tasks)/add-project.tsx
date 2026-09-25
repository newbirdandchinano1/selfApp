import {
  ComposerCategoryModal,
  ComposerPriorityMatrix,
  ComposerTopBar,
  taskPriorityKeyToNumber,
  type TaskPriorityKey,
} from '@/components/composer';
import { PrerequisiteProjectPickerField } from '@/components/projects/PrerequisiteProjectPickerField';
import { ProjectTagPickerField } from '@/components/projects/ProjectTagPickerField';
import { useAppTheme } from '@/hooks/use-app-theme';
import { usePageApiSync, usePagePullRefresh } from '@/hooks/use-page-api-sync';
import { markPendingTablesDirty } from '@/lib/api-incremental-sync';
import { pushLocalChangesToApi } from '@/lib/api-write-sync';
import { makeTimestampEntityId } from '@/lib/entity-id';
import { consumeSchedulePickerResult, normalizeRouteParam } from '@/lib/schedule-picker-bridge';
import { formatTaskReminderLabel, type TaskReminderOption } from '@/lib/task-reminder-schedule';
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
import { dueDateFromScheduleMeta } from '@/lib/schedule-inherit';
import { mergeLongTermProjectIntoExtraData } from '@/lib/long-term-task';
import {
  mergeRewardPointsIntoExtraData,
  normalizeRewardPoints,
} from '@/lib/reward-points';
import { MaterialIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { useFocusEffect } from "expo-router/react-navigation";
import {
  Alert,
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

type SchedulePickerResult = {
  mode: 'date' | 'time';
  source: string;
  quickChip: string;
  allDay: boolean;
  hasExactTime: boolean;
  reminderOption: TaskReminderOption;
  reminderHour?: number;
  reminderMinute?: number;
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

type ProjectScheduleMeta = Pick<
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

const TITLE_MAX_LENGTH = 80;

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

function buildProjectId() {
  return makeTimestampEntityId('p_', 8);
}

function extractDueDate(deadlineText: string) {
  const all = deadlineText.match(/\d{4}-\d{2}-\d{2}/g);
  if (!all?.length) return null;
  return all[all.length - 1] ?? null;
}

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

  const [title, setTitle] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [deadlineText, setDeadlineText] = React.useState('');
  const [reminderText, setReminderText] = React.useState('');
  const [repeatText, setRepeatText] = React.useState('');
  const [scheduleMeta, setScheduleMeta] = React.useState<ProjectScheduleMeta | null>(null);
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
  const [rewardPointsText, setRewardPointsText] = React.useState('0');
  const [priority, setPriority] = React.useState<TaskPriorityKey>('not-urgent-not-important');
  const appliedRouteCategoryRef = React.useRef(false);

  const routeCategoryId = React.useMemo(() => {
    const raw = params.categoryId;
    const s = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw[0] : '';
    const t = (s ?? '').trim();
    if (!t || t === 'all') return null;
    return t;
  }, [params.categoryId]);

  const scheduleSource = normalizeRouteParam(params.source as string | string[] | undefined) || 'add-project';

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
      },
    });
  }, [router, scheduleMeta, scheduleSource]);

  React.useEffect(() => {
    readScheduleResult();
  }, [readScheduleResult]);

  useFocusEffect(
    React.useCallback(() => {
      readScheduleResult();
      void (async () => {
        try {
          const tags = await getProjectTags();
          setAllTags(tags);
          setSelectedTagIds((prev) => prev.filter((id) => tags.some((t) => t.id === id)));
        } catch (error) {
          console.warn('刷新项目标签失败', error);
        }
      })();
    }, [readScheduleResult]),
  );

  const reload = React.useCallback(async (forceApi = false) => {
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
    }, forceApi);
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

  const selectedCategoryName = React.useMemo(() => {
    if (!selectedCategoryId) return '';
    return categories.find((item) => item.id === selectedCategoryId)?.name ?? '';
  }, [categories, selectedCategoryId]);

  const createProjectRecord = React.useCallback(async () => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      Alert.alert('无法创建项目', '请输入项目名称后再创建。');
      return;
    }
    const hasDuplicateName = await isProjectNameDuplicate(trimmedTitle);
    if (hasDuplicateName) {
      Alert.alert('无法创建项目', '项目名称不能重复，请更换后重试。');
      return;
    }
    if (creating) return;

    const prereqValidation = validatePrerequisiteSelection(null, prerequisiteProjectIds, allProjects);
    if (!prereqValidation.ok) {
      Alert.alert('无法创建项目', prereqValidation.message);
      return;
    }

    setCreating(true);
    try {
      const projectId = buildProjectId();
      const scheduleToSave = ensureProjectScheduleMetaForSave(scheduleMeta, deadlineText);
      const extra = mergePrerequisiteIdsIntoExtraData({ schedule: scheduleToSave }, prerequisiteProjectIds);
      const withLongTerm = mergeLongTermProjectIntoExtraData(JSON.stringify(extra), isLongTermProject);
      const withReward = mergeRewardPointsIntoExtraData(
        withLongTerm,
        normalizeRewardPoints(rewardPointsText),
      );
      await createProject({
        id: projectId,
        name: trimmedTitle,
        category_id: selectedCategoryId,
        priority: taskPriorityKeyToNumber(priority),
        note: notes.trim() || null,
        due_date: dueDateFromScheduleMeta(scheduleToSave, extractDueDate(deadlineText)),
        extra_data: withReward,
      });
      await setProjectTagIds(projectId, selectedTagIds);
      try {
        await markPendingTablesDirty(['projects', 'tags', 'tag_links']);
        await pushLocalChangesToApi({ awaitSync: true, rethrow: true });
      } catch (syncErr) {
        console.warn('项目创建后同步到服务器失败', syncErr);
      }
      notifyAncestorsDataChanged();
      router.back();
    } catch (error) {
      console.warn('创建项目失败', error);
      Alert.alert('创建失败', '项目保存失败，请稍后重试。');
    } finally {
      setCreating(false);
    }
  }, [
    allProjects,
    creating,
    deadlineText,
    isLongTermProject,
    notes,
    notifyAncestorsDataChanged,
    prerequisiteProjectIds,
    priority,
    rewardPointsText,
    router,
    scheduleMeta,
    selectedCategoryId,
    selectedTagIds,
    title,
  ]);

  const handleTitleChange = (text: string) => {
    setTitle(text.slice(0, TITLE_MAX_LENGTH));
  };

  const panelBorder = isDark ? 'rgba(148,163,184,0.22)' : 'rgba(194,198,214,0.65)';
  const panelBg = isDark ? 'rgba(30,41,59,0.45)' : colors.surface;
  const fieldBg = isDark ? 'rgba(15,23,42,0.45)' : colors.input;
  const divider = isDark ? 'rgba(148,163,184,0.16)' : 'rgba(226,232,240,0.95)';

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['left', 'right', 'bottom']}>
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
          contentContainerStyle={[
            styles.content,
            { paddingBottom: 48 + Math.max(insets.bottom, 12) },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <View style={[styles.panel, { backgroundColor: panelBg, borderColor: panelBorder }]}>
            <Text style={[styles.panelTitle, { color: colors.text }]}>概要</Text>
            <TextInput
              value={title}
              onChangeText={handleTitleChange}
              placeholder="写下项目名称…"
              placeholderTextColor={colors.textMuted}
              multiline
              maxLength={TITLE_MAX_LENGTH}
              style={[styles.titleInput, { color: colors.text }]}
            />
            <Text style={[styles.charCounter, { color: colors.textSecondary }]}>
              {title.length}/{TITLE_MAX_LENGTH}
            </Text>

            <View style={[styles.panelDivider, { backgroundColor: divider }]} />

            <Pressable
              onPress={() => setCategoryModalVisible(true)}
              style={({ pressed }) => [
                styles.fieldRow,
                { backgroundColor: fieldBg, opacity: pressed ? 0.82 : 1 },
              ]}>
              <View style={styles.fieldRowLeft}>
                <MaterialIcons name="folder-open" size={18} color={colors.primary} />
                <View style={styles.fieldCopy}>
                  <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>分类</Text>
                  <Text style={[styles.fieldValue, { color: colors.text }]}>
                    {selectedCategoryName || '未分类'}
                  </Text>
                </View>
              </View>
              <MaterialIcons name="chevron-right" size={20} color={colors.textSecondary} />
            </Pressable>

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
          </View>

          <View style={[styles.panel, { backgroundColor: panelBg, borderColor: panelBorder }]}>
            <Text style={[styles.panelTitle, { color: colors.text }]}>优先级</Text>
            <ComposerPriorityMatrix value={priority} onChange={setPriority} />
          </View>

          <View style={[styles.panel, { backgroundColor: panelBg, borderColor: panelBorder }]}>
            <Text style={[styles.panelTitle, { color: colors.text }]}>依赖与日程</Text>
            <View style={styles.fieldBlock}>
              <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>前置项目</Text>
              <PrerequisiteProjectPickerField
                selectedIds={prerequisiteProjectIds}
                allProjects={allProjects}
                loading={projectsLoading}
                onChange={setPrerequisiteProjectIds}
                textColor={colors.text}
                outline={colors.textSecondary}
                placeholderColor={colors.textMuted}
                primary={colors.primary}
                surfaceLow={colors.input}
                surfaceLowest={colors.surfaceSubtle}
                isDark={isDark}
              />
            </View>

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
                <Text style={[styles.fieldValue, { color: colors.text }]}>{deadlineText || '未设置'}</Text>
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

          <View style={[styles.panel, { backgroundColor: panelBg, borderColor: panelBorder }]}>
            <Text style={[styles.panelTitle, { color: colors.text }]}>更多</Text>
            <Pressable
              onPress={() => setIsLongTermProject((v) => !v)}
              accessibilityRole="switch"
              accessibilityState={{ checked: isLongTermProject }}
              style={({ pressed }) => [
                styles.longTermRow,
                {
                  backgroundColor: isLongTermProject ? `${colors.primary}12` : fieldBg,
                  borderColor: isLongTermProject ? colors.primary : 'transparent',
                  opacity: pressed ? 0.88 : 1,
                },
              ]}>
              <View style={styles.longTermTextWrap}>
                <Text style={[styles.longTermTitle, { color: colors.text }]}>长期项目</Text>
                <Text style={[styles.longTermHint, { color: colors.textSecondary }]}>
                  无子任务时可指派为青蛙；完成时确认是否结束整项
                </Text>
              </View>
              <MaterialIcons
                name={isLongTermProject ? 'check-box' : 'check-box-outline-blank'}
                size={22}
                color={isLongTermProject ? colors.primary : colors.textSecondary}
              />
            </Pressable>

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
                完成整项后计入；负数扣除，可含小数；0 无变动
              </Text>
            </View>

            <View style={styles.fieldBlock}>
              <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>验收标准</Text>
              <View style={[styles.notesWrap, { backgroundColor: fieldBg }]}>
                <TextInput
                  value={notes}
                  onChangeText={setNotes}
                  placeholder="怎样算完成？（可选）"
                  placeholderTextColor={colors.textMuted}
                  multiline
                  textAlignVertical="top"
                  style={[styles.notesInput, { color: colors.text }]}
                />
              </View>
            </View>
          </View>
        </ScrollView>
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
});
