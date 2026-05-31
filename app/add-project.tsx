import {
  ComposerEditorialCard,
  ComposerHero,
  ComposerMain,
  ComposerNoteSection,
  ComposerOptionRow,
  ComposerScheduleSection,
  ComposerSection,
  ComposerCategoryModal,
  ComposerSectionHead,
  ComposerTopBar,
  composerStyles,
} from '@/components/composer';
import { PrerequisiteProjectPickerField } from '@/components/projects/PrerequisiteProjectPickerField';
import { Spacing } from '@/constants/design-tokens';
import { useAppTheme } from '@/hooks/use-app-theme';
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
import type { ProjectCategoryRow, ProjectRow } from '@/lib/repositories/projects/project.types';
import { CompletionRewardField } from '@/components/completion-reward/CompletionRewardField';
import type { CompletionReward } from '@/lib/completion-reward/completion-reward.types';
import { DEFAULT_COMPLETION_REWARD } from '@/lib/completion-reward/completion-reward.types';
import { mergeCompletionRewardIntoExtraData } from '@/lib/completion-reward/completion-reward-extra';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { Alert, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

type Subtask = { id: string; title: string; done: boolean };

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

const TITLE_MAX_LENGTH = 30;

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
    deleted_at: null,
    sync_status: 'synced',
    version: 1,
    extra_data: null,
  };

  const withoutInbox = rows.filter((row) => row.id !== INBOX_PROJECT_CATEGORY_ID);
  const existing = rows.find((row) => row.id === INBOX_PROJECT_CATEGORY_ID);
  if (!existing) return [inbox, ...withoutInbox];

  return [
    {
      ...existing,
      name: INBOX_PROJECT_CATEGORY_NAME,
      deleted_at: null,
    },
    ...withoutInbox,
  ];
}

export default function AddProjectScreen() {
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
  const [subtasks, setSubtasks] = React.useState<Subtask[]>([]);
  const [categories, setCategories] = React.useState<ProjectCategoryRow[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = React.useState<string | null>(null);
  const [categoryModalVisible, setCategoryModalVisible] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  const [allProjects, setAllProjects] = React.useState<ProjectRow[]>([]);
  const [projectsLoading, setProjectsLoading] = React.useState(true);
  const [prerequisiteProjectIds, setPrerequisiteProjectIds] = React.useState<string[]>([]);
  const [completionReward, setCompletionReward] = React.useState<CompletionReward>(DEFAULT_COMPLETION_REWARD);
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
    }, [readScheduleResult]),
  );

  React.useEffect(() => {
    let mounted = true;
    const loadCategories = async () => {
      try {
        const rows = await getProjectCategories();
        if (mounted) setCategories(ensureInboxCategory(rows));
      } catch (error) {
        console.warn('加载项目分类失败', error);
        if (mounted) setCategories(ensureInboxCategory([]));
      }
    };
    loadCategories();
    return () => {
      mounted = false;
    };
  }, []);

  React.useEffect(() => {
    let mounted = true;
    const loadAllProjects = async () => {
      setProjectsLoading(true);
      try {
        const rows = await getProjects();
        if (mounted) setAllProjects(rows);
      } catch (error) {
        console.warn('加载项目列表失败', error);
        if (mounted) setAllProjects([]);
      } finally {
        if (mounted) setProjectsLoading(false);
      }
    };
    void loadAllProjects();
    return () => {
      mounted = false;
    };
  }, []);

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
      const scheduleToSave = ensureProjectScheduleMetaForSave(scheduleMeta, deadlineText);
      const extra = mergePrerequisiteIdsIntoExtraData({ schedule: scheduleToSave }, prerequisiteProjectIds);
      await createProject({
        id: buildProjectId(),
        name: trimmedTitle,
        category_id: selectedCategoryId,
        note: notes.trim() || null,
        due_date: extractDueDate(deadlineText),
        extra_data: mergeCompletionRewardIntoExtraData(JSON.stringify(extra), completionReward),
      });
      router.back();
    } catch (error) {
      console.warn('创建项目失败', error);
      Alert.alert('创建失败', '项目保存失败，请稍后重试。');
    } finally {
      setCreating(false);
    }
  }, [allProjects, completionReward, creating, deadlineText, notes, prerequisiteProjectIds, router, scheduleMeta, selectedCategoryId, title]);

  const handleTitleChange = (text: string) => {
    setTitle(text.slice(0, TITLE_MAX_LENGTH));
  };

  return (
    <SafeAreaView style={[composerStyles.container, { backgroundColor: colors.background }]} edges={['left', 'right', 'bottom']}>
      <ComposerTopBar
        title="新建项目"
        subtitle="可设置分类、前置依赖与日程"
        onBack={() => router.back()}
        onSubmit={() => void createProjectRecord()}
        submitting={creating}
        submitLabel="创建"
      />

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={composerStyles.flex}>
        <ScrollView
          contentContainerStyle={[
            composerStyles.content,
            { paddingBottom: Spacing['6xl'] + Math.max(insets.bottom, Spacing.md) },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <ComposerMain>
            <ComposerHero
              badgeIcon="folder-special"
              kicker="这次要推进什么项目？"
              placeholder="写下项目名称…"
              value={title}
              onChangeText={handleTitleChange}
              maxLength={TITLE_MAX_LENGTH}
            />

            <ComposerSection>
              <ComposerSectionHead
                accentColor={colors.tertiary}
                title="项目分类"
                description="不可选收集箱；无其它分类时为未分类"
              />
              <ComposerOptionRow
                icon="folder-open"
                iconBg={colors.capsule}
                title="当前分类"
                value={selectedCategoryName || '未分类'}
                onPress={() => setCategoryModalVisible(true)}
                accessibilityLabel="选择项目分类"
              />
            </ComposerSection>

            <ComposerSection>
              <ComposerSectionHead
                accentColor={colors.primary}
                title="前置项目"
                description="需先完成所选项目后，本项目才可推进"
                rightIcon="account-tree"
              />
              <ComposerEditorialCard>
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
              </ComposerEditorialCard>
            </ComposerSection>

            <ComposerSection>
              <ComposerScheduleSection
                deadlineText={deadlineText}
                reminderText={reminderText}
                repeatText={repeatText}
                onPress={openSchedulePicker}
              />
            </ComposerSection>

            <ComposerSection>
              <ComposerSectionHead
                accentColor={colors.secondary}
                title="完成奖励"
                description="项目完成时可领取的小激励"
                rightIcon="emoji-events"
              />
              <ComposerEditorialCard>
                <CompletionRewardField
                  value={completionReward}
                  onChange={setCompletionReward}
                  textColor={colors.text}
                  outline={colors.textSecondary}
                  placeholderColor={colors.textMuted}
                  primary={colors.primary}
                  surfaceLow={colors.input}
                  surfaceLowest={colors.surfaceSubtle}
                  isDark={isDark}
                />
              </ComposerEditorialCard>
            </ComposerSection>

            <ComposerNoteSection
              value={notes}
              onChangeText={setNotes}
              placeholder="目标、范围、关键干系人…（可选）"
            />
          </ComposerMain>
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
