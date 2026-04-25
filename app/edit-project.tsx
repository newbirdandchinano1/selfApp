import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { INBOX_PROJECT_CATEGORY_ID } from '@/lib/repositories/projects/constants';
import { deleteProject, getProjectById, getProjectCategories, updateProject } from '@/lib/repositories/projects/project';
import type { ProjectCategoryRow } from '@/lib/repositories/projects/project.types';
import { countIncompleteTasksByProjectId, createTask, getTasksByProjectId, updateTask } from '@/lib/repositories/tasks/task';
import type { TaskPriority, TaskRow } from '@/lib/repositories/tasks/task.types';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
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
};
type SchedulePickerResult = {
  mode: 'date' | 'time';
  source: string;
  quickChip: string;
  allDay: boolean;
  hasExactTime: boolean;
  reminderOption: '不提前' | '提前1天' | '提前2天' | '提前3天' | '提前7天';
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
  reminderOption?: '不提前' | '提前1天' | '提前2天' | '提前3天' | '提前7天';
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

const TITLE_MAX_LENGTH = 30;

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

declare global {
  // eslint-disable-next-line no-var
  var __addTaskResult:
    | {
        source: string;
        task: Subtask;
      }
    | undefined;
}

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
  if (text.includes('紧急重要')) return 4;
  if (text.includes('紧急不重要')) return 3;
  if (text.includes('不紧急重要')) return 2;
  if (text.includes('不紧急不重要')) return 1;
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
  };
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

  if (value.includes('紧急重要')) {
    return {
      tint: isDark ? '#f87171' : '#ba1a1a',
      bg: isDark ? 'rgba(248,113,113,0.18)' : 'rgba(186,26,26,0.1)',
      border: isDark ? 'rgba(248,113,113,0.4)' : 'rgba(186,26,26,0.25)',
    };
  }

  if (value.includes('紧急不重要')) {
    return {
      tint: isDark ? '#fbbf24' : '#9a5b00',
      bg: isDark ? 'rgba(251,191,36,0.2)' : 'rgba(154,91,0,0.1)',
      border: isDark ? 'rgba(251,191,36,0.42)' : 'rgba(154,91,0,0.24)',
    };
  }

  if (value.includes('不紧急重要')) {
    return {
      tint: isDark ? '#60a5fa' : '#0058be',
      bg: isDark ? 'rgba(96,165,250,0.2)' : 'rgba(0,88,190,0.1)',
      border: isDark ? 'rgba(96,165,250,0.4)' : 'rgba(0,88,190,0.24)',
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

export default function EditProjectScreen() {
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
  const [subtasks, setSubtasks] = React.useState<Subtask[]>([]);
  const [persistedTaskIds, setPersistedTaskIds] = React.useState<Set<string>>(new Set());
  const [categories, setCategories] = React.useState<ProjectCategoryRow[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = React.useState<string | null>(null);
  const [categoryModalVisible, setCategoryModalVisible] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [loading, setLoading] = React.useState(true);

  const primary = isDark ? '#60a5fa' : '#0058be';
  const scheduleSource = params.source ?? `edit-project-${projectId || 'unknown'}`;
  const addTaskSource = `${scheduleSource}-add-task`;
  const primaryContainer = isDark ? '#1d4ed8' : '#2170e4';
  const outlineVariant = isDark ? 'rgba(148,163,184,0.22)' : 'rgba(194,198,214,0.7)';
  const outline = isDark ? 'rgba(148,163,184,0.65)' : 'rgba(114,119,133,0.8)';
  const surfaceLow = isDark ? 'rgba(30,41,59,0.35)' : 'rgba(241,243,255,0.9)';
  const surfaceLowest = theme.surface;
  const subtaskCardBg = isDark ? 'rgba(15,23,42,0.72)' : '#ffffff';
  const subtaskCardBorder = isDark ? 'rgba(148,163,184,0.3)' : 'rgba(194,198,214,0.55)';
  const subtaskIndicatorBg = isDark ? 'rgba(30,41,59,0.72)' : 'rgba(226,232,240,0.85)';

  const readScheduleResult = React.useCallback(() => {
    const picked = globalThis.__schedulePickerResult as SchedulePickerResult | undefined;
    if (!picked || picked.source !== scheduleSource) return;

    if (picked.mode === 'time' && picked.range) {
      const rangeStart = formatDate(picked.range.start);
      const rangeEnd = formatDate(picked.range.end);
      const rangeLabel = rangeStart === rangeEnd ? rangeStart : `${rangeStart} ~ ${rangeEnd}`;
      const timeLabel = picked.allDay ? '全天' : `${formatTime(picked.startTime)} - ${formatTime(picked.endTime)}`;
      setDeadlineText(`${rangeLabel} ${timeLabel}`);
    } else if (picked.date) {
      const dateLabel = formatDate(picked.date);
      const timeLabel = picked.allDay ? '全天' : picked.hasExactTime ? formatTime(picked.startTime) : '';
      setDeadlineText(timeLabel ? `${dateLabel} ${timeLabel}` : dateLabel);
    }
    setReminderText(picked.reminderOption === '不提前' ? '' : picked.reminderOption);
    setRepeatText(picked.repeatOption === '不重复' ? '' : picked.repeatSummary);
    setScheduleMeta({
      mode: picked.mode,
      allDay: picked.allDay,
      hasExactTime: picked.hasExactTime,
      reminderOption: picked.reminderOption,
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

    globalThis.__schedulePickerResult = undefined;
  }, [scheduleSource]);

  const readAddTaskResult = React.useCallback(() => {
    const payload = globalThis.__addTaskResult as { source: string; task: Subtask } | undefined;
    if (!payload || payload.source !== addTaskSource) return;
    setSubtasks((prev) => [...prev, payload.task]);
    globalThis.__addTaskResult = undefined;
  }, [addTaskSource]);

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
      setTitle(project.name);
      setSelectedCategoryId(project.category_id ?? INBOX_PROJECT_CATEGORY_ID);
      setNotes(project.note ?? '');
      const extraData = parseProjectExtraData(project.extra_data);
      setProjectExtraData(extraData);
      const loadedSchedule = (extraData.schedule ?? null) as ProjectScheduleMeta | null;
      setScheduleMeta(loadedSchedule);
      setReminderText(loadedSchedule?.reminderOption === '不提前' ? '' : loadedSchedule?.reminderOption ?? '');
      setRepeatText(loadedSchedule?.repeatOption === '不重复' ? '' : loadedSchedule?.repeatSummary ?? '');
      setDeadlineText(buildDeadlineTextFromSchedule(loadedSchedule) || (project.due_date ? formatDate(project.due_date) : ''));
      const projectTasks = await getTasksByProjectId(projectId);
      const rootSubtasks = projectTasks.map(mapTaskRowToSubtask);
      setSubtasks(rootSubtasks);
      setPersistedTaskIds(new Set(projectTasks.map((t) => t.id)));
    } catch (error) {
      console.warn('加载项目详情失败', error);
      Alert.alert('加载失败', '无法读取项目详情，请稍后重试。');
      router.back();
    } finally {
      setLoading(false);
    }
  }, [projectId, router]);

  React.useEffect(() => {
    loadProject();
  }, [loadProject]);

  React.useEffect(() => {
    let mounted = true;
    const loadCategories = async () => {
      try {
        const rows = await getProjectCategories();
        if (mounted) setCategories(rows);
      } catch (error) {
        console.warn('加载项目分类失败', error);
        if (mounted) setCategories([]);
      }
    };
    loadCategories();
    return () => {
      mounted = false;
    };
  }, []);

  React.useEffect(() => {
    readScheduleResult();
  }, [readScheduleResult]);

  React.useEffect(() => {
    readAddTaskResult();
  }, [readAddTaskResult]);

  useFocusEffect(
    React.useCallback(() => {
      readScheduleResult();
      readAddTaskResult();
    }, [readAddTaskResult, readScheduleResult])
  );

  const selectedCategoryName = React.useMemo(() => {
    if (!selectedCategoryId) return '';
    return categories.find((item) => item.id === selectedCategoryId)?.name ?? '';
  }, [categories, selectedCategoryId]);
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

  const openSchedulePicker = React.useCallback(() => {
    const scheduleInit: SchedulePickerInitPayload | undefined = scheduleMeta
      ? {
          mode: scheduleMeta.mode,
          quickChip: '',
          allDay: scheduleMeta.allDay,
          hasExactTime: scheduleMeta.hasExactTime,
          reminderOption: scheduleMeta.reminderOption,
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

    setSaving(true);
    try {
      await updateProject(projectId, {
        category_id: selectedCategoryId,
        name: trimmedTitle,
        note: notes.trim() || null,
        due_date: extractDueDate(deadlineText),
        extra_data: JSON.stringify({
          ...projectExtraData,
          schedule: scheduleMeta,
        }),
      });
      const existingTasks = await getTasksByProjectId(projectId);
      const existingTaskIds = new Set(existingTasks.map((item) => item.id));
      const normalizedCategoryId = selectedCategoryId === INBOX_PROJECT_CATEGORY_ID ? null : selectedCategoryId;

      for (const subtask of subtasks) {
        const payload = {
          project_id: projectId,
          category_id: normalizedCategoryId,
          parent_task_id: null,
          title: subtask.title.trim() || '未命名任务',
          note: subtask.note?.trim() || null,
          status: (subtask.done ? 'done' : 'todo') as TaskRow['status'],
          priority: toTaskPriority(subtask.priority || subtask.priorityLabel),
          due_date: extractDueDate(subtask.deadline || subtask.deadlineText || ''),
          extra_data: JSON.stringify({
            reminder: subtask.reminder || subtask.reminderText || '',
            repeat: subtask.repeat || subtask.repeatText || '',
          }),
        };

        if (existingTaskIds.has(subtask.id)) {
          await updateTask(subtask.id, payload);
        } else {
          await createTask({
            id: subtask.id,
            ...payload,
          });
        }
      }
      router.back();
    } catch (error) {
      console.warn('更新项目失败', error);
      Alert.alert('保存失败', '项目保存失败，请稍后重试。');
    } finally {
      setSaving(false);
    }
  }, [deadlineText, notes, projectExtraData, projectId, router, saving, scheduleMeta, selectedCategoryId, subtasks, title]);

  const removeProject = React.useCallback(() => {
    if (!projectId || saving || loading) return;
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
            onPress: async () => {
              try {
                setSaving(true);
                await deleteProject(projectId);
                router.back();
              } catch (error) {
                console.warn('删除项目失败', error);
                Alert.alert('删除失败', '项目删除失败，请稍后重试。');
              } finally {
                setSaving(false);
              }
            },
          },
        ]);
      } catch (error) {
        console.warn('统计项目任务失败', error);
        Alert.alert('删除项目', '删除后在同步或恢复功能前无法找回，确认删除吗？', [
          { text: '取消', style: 'cancel' },
          {
            text: '删除',
            style: 'destructive',
            onPress: async () => {
              try {
                setSaving(true);
                await deleteProject(projectId);
                router.back();
              } catch (err) {
                console.warn('删除项目失败', err);
                Alert.alert('删除失败', '项目删除失败，请稍后重试。');
              } finally {
                setSaving(false);
              }
            },
          },
        ]);
      }
    })();
  }, [loading, projectId, router, saving]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={['top']}>
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 12), backgroundColor: isDark ? 'rgba(15,23,42,0.82)' : 'rgba(255,255,255,0.82)', borderBottomColor: isDark ? 'rgba(30,41,59,0.35)' : 'rgba(226,232,240,0.7)' }]}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.75 }]}>
          <MaterialIcons name="arrow-back" size={22} color={primary} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: primary }]}>{loading ? '项目详情' : '编辑项目'}</Text>
        <Pressable
          onPress={saveProject}
          disabled={saving || loading}
          hitSlop={10}
          style={({ pressed }) => [styles.headerActionBtn, { opacity: saving || loading ? 0.55 : pressed ? 0.75 : 1 }]}>
          <Text style={[styles.headerActionText, { color: primary }]}>{saving ? '保存中' : '保存'}</Text>
        </Pressable>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: 150 + Math.max(insets.bottom, 12) }]} showsVerticalScrollIndicator={false}>
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: outline }]}>基础信息</Text>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="项目名称"
              placeholderTextColor={outlineVariant}
              multiline
              editable={!loading}
              maxLength={TITLE_MAX_LENGTH}
              style={[styles.titleInput, { color: theme.text, opacity: loading ? 0.65 : 1 }]}
            />
            <Text style={[styles.charCounter, { color: outline }]}>
              {title.length}/{TITLE_MAX_LENGTH}
            </Text>
          </View>

          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: outline }]}>项目分类</Text>
            <Pressable
              onPress={() => setCategoryModalVisible(true)}
              disabled={loading}
              style={({ pressed }) => [
                styles.categorySelect,
                { backgroundColor: surfaceLow, borderColor: outlineVariant, opacity: loading ? 0.65 : pressed ? 0.8 : 1 },
              ]}>
              <View style={styles.categoryLeft}>
                <MaterialIcons name="folder-open" size={18} color={primary} />
                <Text style={[styles.categoryValue, { color: theme.text }]}>{selectedCategoryName || '收集箱'}</Text>
              </View>
              <MaterialIcons name="expand-more" size={20} color={outline} />
            </Pressable>
          </View>

          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: outline }]}>时间限制</Text>
            <View style={[styles.deadlineCard, { backgroundColor: surfaceLow }]}>
              <View style={[styles.deadlineIconWrap, { backgroundColor: surfaceLowest }]}>
                <MaterialIcons name="event-note" size={22} color={primary} />
              </View>
              <View style={styles.deadlineBody}>
                <Text style={[styles.deadlineKicker, { color: outline }]}>截止日期</Text>
                <Text style={[styles.deadlineValue, { color: theme.text }]}>{deadlineText || '未设置'}</Text>
                {!!(reminderText || repeatText) && (
                  <View style={styles.tagRow}>
                    {!!reminderText && (
                      <View style={[styles.metaTag, { backgroundColor: surfaceLowest, borderColor: outlineVariant }]}>
                        <MaterialIcons name="notifications-active" size={14} color={primary} />
                        <Text style={[styles.metaTagText, { color: theme.text }]}>{reminderText}</Text>
                      </View>
                    )}
                    {!!repeatText && (
                      <View style={[styles.metaTag, { backgroundColor: surfaceLowest, borderColor: outlineVariant }]}>
                        <MaterialIcons name="repeat" size={14} color={primary} />
                        <Text style={[styles.metaTagText, { color: theme.text }]}>{repeatText}</Text>
                      </View>
                    )}
                  </View>
                )}
              </View>
              <Pressable onPress={openSchedulePicker} disabled={loading} style={({ pressed }) => [styles.deadlineEdit, pressed && { opacity: 0.75 }]}>
                <MaterialIcons name="edit-calendar" size={22} color={primary} />
              </Pressable>
            </View>
          </View>

          <View style={styles.section}>
            <View style={styles.subtaskHeader}>
              <Text style={[styles.sectionLabel, { color: outline }]}>任务拆解</Text>
              <Pressable
                onPress={() =>
                  router.push({
                    pathname: '/add-task',
                    params: {
                      source: addTaskSource,
                      dateLimit: taskDateLimit ? JSON.stringify(taskDateLimit) : '',
                    },
                  })
                }
                style={({ pressed }) => [styles.linkBtn, pressed && { opacity: 0.75 }]}>
                <MaterialIcons name="add-circle" size={16} color={primary} />
                <Text style={[styles.linkBtnText, { color: primary }]}>添加任务</Text>
              </Pressable>
            </View>
            <View style={styles.subtaskList}>
              {subtasks.map((s) => (
                <Pressable
                  key={s.id}
                  onPress={() => openEditTask(s.id)}
                  style={({ pressed }) => [
                    styles.subtaskRow,
                    { backgroundColor: subtaskCardBg, borderColor: subtaskCardBorder, opacity: pressed ? 0.86 : 1 },
                  ]}>
                  <View style={[styles.subtaskIndicator, { backgroundColor: subtaskIndicatorBg }]}>
                    <View style={[styles.checkbox, { borderColor: outlineVariant, backgroundColor: s.done ? primary : 'transparent' }]}>
                      {s.done && <MaterialIcons name="check" size={14} color="#fff" />}
                    </View>
                  </View>
                  <View style={styles.subtaskBody}>
                    <Text style={[styles.subtaskText, { color: theme.text }]} numberOfLines={1}>{s.title}</Text>
                    {!!(s.priority || s.priorityLabel || s.deadline || s.deadlineText || s.reminder || s.reminderText || s.repeat || s.repeatText || s.note) && (
                      <>
                        <View style={styles.subtaskMetaRow}>
                          {!!(s.priority || s.priorityLabel) && (
                            (() => {
                              const priorityText = s.priority || s.priorityLabel || '';
                              const priorityColor = getPriorityColor(priorityText, isDark);
                              return (
                                <View style={[styles.metaTag, { backgroundColor: priorityColor.bg, borderColor: priorityColor.border }]}>
                                  <MaterialIcons name="flag" size={14} color={priorityColor.tint} />
                                  <Text style={[styles.metaTagText, { color: priorityColor.tint }]}>{priorityText}</Text>
                                </View>
                              );
                            })()
                          )}
                          {!!(s.deadline || s.deadlineText) && (
                            <View style={[styles.metaTag, { backgroundColor: surfaceLow, borderColor: outlineVariant }]}>
                              <MaterialIcons name="event" size={14} color={primary} />
                              <Text style={[styles.metaTagText, { color: theme.text }]} numberOfLines={1}>{s.deadline || s.deadlineText}</Text>
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
                        </View>
                        {!!s.note && <Text style={[styles.subtaskNote, { color: outline }]} numberOfLines={2}>{s.note}</Text>}
                      </>
                    )}
                  </View>
                  <View style={[styles.subtaskAction, { backgroundColor: subtaskIndicatorBg }]}>
                    <MaterialIcons name="chevron-right" size={18} color={outline} />
                  </View>
                </Pressable>
              ))}
              {subtasks.length === 0 && (
                <View style={[styles.emptySubtaskRow, { backgroundColor: subtaskCardBg, borderColor: subtaskCardBorder }]}>
                  <View style={[styles.emptySubtaskIcon, { backgroundColor: subtaskIndicatorBg }]}>
                    <MaterialIcons name="playlist-add-check" size={18} color={outline} />
                  </View>
                  <Text style={[styles.emptySubtaskText, { color: outline }]}>暂无任务，点击右上角添加任务</Text>
                </View>
              )}
            </View>
          </View>

          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: outline }]}>上下文备注</Text>
            <View style={[styles.notesWrap, { backgroundColor: surfaceLow }]}>
              <TextInput value={notes} onChangeText={setNotes} placeholder="在此记录更多背景信息..." placeholderTextColor={outline} multiline editable={!loading} style={[styles.notesInput, { color: theme.text, opacity: loading ? 0.65 : 1 }]} />
              <View style={styles.notesIcon} pointerEvents="none"><MaterialIcons name="notes" size={20} color={outlineVariant} /></View>
            </View>
          </View>
        </ScrollView>

        <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 12), backgroundColor: isDark ? 'rgba(15,23,42,0.65)' : 'rgba(250,248,255,0.65)', borderTopColor: isDark ? 'rgba(30,41,59,0.35)' : 'rgba(226,232,240,0.7)' }]}>
          <View style={styles.bottomInner}>
            <Pressable
              onPress={removeProject}
              disabled={saving || loading}
              style={({ pressed }) => [
                styles.deleteBtn,
                {
                  backgroundColor: pressed ? '#991b1b' : '#ba1a1a',
                  opacity: saving || loading ? 0.7 : 1,
                },
                pressed && { transform: [{ scale: 0.98 }] },
              ]}>
              <MaterialIcons name="delete-outline" size={22} color="#fff" />
              <Text style={styles.createText}>删除项目</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>

      <Modal transparent visible={categoryModalVisible} animationType="fade" onRequestClose={() => setCategoryModalVisible(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setCategoryModalVisible(false)}>
          <Pressable onPress={() => {}} style={[styles.modalCard, { backgroundColor: surfaceLowest, borderColor: outlineVariant }]}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>选择项目分类</Text>
            {categories.map((item) => (
              <Pressable
                key={item.id}
                onPress={() => {
                  setSelectedCategoryId(item.id);
                  setCategoryModalVisible(false);
                }}
                style={({ pressed }) => [styles.modalItem, pressed && { opacity: 0.8 }]}>
                <Text style={[styles.modalItemText, { color: theme.text }]}>{item.name}</Text>
                {selectedCategoryId === item.id && <MaterialIcons name="check" size={18} color={primary} />}
              </Pressable>
            ))}
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  header: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingBottom: 10, borderBottomWidth: 1 },
  iconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  headerActionBtn: { minWidth: 46, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  headerActionText: { fontSize: 15, fontWeight: '800' },
  headerTitle: { fontSize: 24, fontWeight: '800', letterSpacing: -0.4 },
  content: { paddingTop: 92, paddingHorizontal: 18, gap: 22 },
  section: { gap: 10 },
  sectionLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1.6, textTransform: 'uppercase', opacity: 0.75 },
  titleInput: { padding: 0, fontSize: 30, fontWeight: '900', lineHeight: 36 },
  charCounter: { alignSelf: 'flex-end', fontSize: 12, fontWeight: '600' },
  categorySelect: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  categoryLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1, paddingRight: 10 },
  categoryValue: { fontSize: 14, fontWeight: '700' },
  deadlineCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 16 },
  deadlineIconWrap: { width: 46, height: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 6, elevation: 2 },
  deadlineBody: { flex: 1, gap: 4 },
  deadlineKicker: { fontSize: 10, fontWeight: '700', letterSpacing: 2, textTransform: 'uppercase' },
  deadlineValue: { fontSize: 16, fontWeight: '800' },
  tagRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  metaTag: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 999, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 4 },
  metaTagText: { fontSize: 12, fontWeight: '600' },
  deadlineEdit: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  subtaskHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  linkBtn: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  linkBtnText: { fontSize: 12, fontWeight: '900', letterSpacing: 1.2, textTransform: 'uppercase' },
  subtaskList: { gap: 10 },
  subtaskRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 12, borderRadius: 16, borderWidth: 1, shadowColor: '#0f172a', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.08, shadowRadius: 10, elevation: 2 },
  subtaskIndicator: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  checkbox: { width: 20, height: 20, borderRadius: 6, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  subtaskBody: { flex: 1, gap: 8, paddingRight: 2 },
  subtaskText: { flex: 1, fontSize: 15, fontWeight: '700', lineHeight: 20 },
  subtaskMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  subtaskNote: { fontSize: 12, fontWeight: '500', lineHeight: 18 },
  subtaskAction: { width: 28, height: 28, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  emptySubtaskRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 14, borderRadius: 16, borderWidth: 1, borderStyle: 'dashed' },
  emptySubtaskIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  emptySubtaskText: { flex: 1, fontSize: 13, fontWeight: '600' },
  notesWrap: { borderRadius: 16, padding: 14, minHeight: 120 },
  notesInput: { minHeight: 92, fontSize: 14, fontWeight: '500', lineHeight: 20, paddingRight: 34 },
  notesIcon: { position: 'absolute', right: 12, bottom: 12 },
  bottomBar: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 18, paddingTop: 12, borderTopWidth: 1 },
  bottomInner: { maxWidth: 520, width: '100%', alignSelf: 'center' },
  createBtn: { width: '100%', paddingVertical: 16, borderRadius: 16, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 10, shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.14, shadowRadius: 20, elevation: 8 },
  deleteBtn: { width: '100%', paddingVertical: 16, borderRadius: 16, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 10, shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.14, shadowRadius: 20, elevation: 8 },
  createText: { color: '#fff', fontSize: 18, fontWeight: '900', letterSpacing: -0.2 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.38)', justifyContent: 'center', paddingHorizontal: 18 },
  modalCard: { borderWidth: 1, borderRadius: 16, padding: 14, gap: 8 },
  modalTitle: { fontSize: 16, fontWeight: '800', marginBottom: 4 },
  modalItem: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modalItemText: { fontSize: 14, fontWeight: '600' },
});
