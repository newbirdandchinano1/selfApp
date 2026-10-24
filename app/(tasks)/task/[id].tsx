import { AddSubtaskSheet, type AddSubtaskDraft } from '@/components/entity-form';
import {
  FoldRiseIn,
  useFoldMotionGate,
} from '@/components/review/fold-motion';
import { FoldProgressBar } from '@/components/tasks/fold-progress-bar';
import { FoldProgressRing } from '@/components/tasks/fold-progress-ring';
import { TaskFoldMotion, useTaskFoldTheme } from '@/constants/task-fold-theme';
import { usePageApiSync, usePagePullRefresh } from '@/hooks/use-page-api-sync';
import { resolveAcceptanceCriteria } from '@/lib/acceptance-criteria';
import { formatTaskAuditDatetimeLocal } from '@/lib/api-mysql-datetime';
import { toast } from '@/lib/app-feedback';
import { formatYmd, parseYmd } from '@/lib/date';
import { formatWriteError } from '@/lib/format-write-error';
import { getFrogAssignedDates } from '@/lib/frog-assignment';
import { unassignFrogForDay } from '@/lib/frog-candidates-api';
import { notifyPageDataChanged } from '@/lib/page-api-session';
import { getProjectById } from '@/lib/repositories/projects/project';
import {
  countIncompleteDescendantTasks,
  createTask,
  deleteTask,
  getChildTasksByParentTaskId,
  getTaskById,
  getTaskTreeByRootTaskId,
  getTasksByProjectId,
  updateTask,
  type TaskTreeNode,
} from '@/lib/repositories/tasks/task';
import { normalizeTaskPriority } from '@/lib/repositories/tasks/task.types';
import {
  getRecentExecutionEventsForTaskIds,
  insertTaskExecutionEvent,
  type TaskExecutionEventWithTitle,
} from '@/lib/repositories/tasks/task-execution-events';
import { getTagsByEntity, getTagsByProjectId } from '@/lib/repositories/tags/tag';
import type { TagRow } from '@/lib/repositories/tags/tag.types';
import { parseRewardPointsFromExtraData } from '@/lib/reward-points';
import { dueDateFromScheduleMeta } from '@/lib/schedule-inherit';
import {
  consumeSchedulePickerResult,
  normalizeRouteParam,
  type PickedScheduleMeta,
  type SchedulePickerResult,
} from '@/lib/schedule-picker-bridge';
import type { ScheduleMeta } from '@/lib/schedule/meta';
import { isStandaloneTodoTask, standaloneTodoEditorHref } from '@/lib/standalone-todo-task';
import { requestPush } from '@/lib/sync-manager';
import { formatTaskReminderLabel, TASK_REMINDER_OPTIONS, type TaskReminderOption } from '@/lib/task-reminder-schedule';
import { parseTaskRepeatSchedule } from '@/lib/task-repeat-rollover';
import { getDayBoundarySync, getLogicalLocalYmd } from '@/lib/tasks-logical-day';
import { MaterialIcons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useIsFocused, useNavigation, usePreventRemove } from 'expo-router/react-navigation';
import React from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

declare global {
  // eslint-disable-next-line no-var
  var __addSubtaskResult:
    | {
        source: string;
        task: {
          id: string;
          title: string;
          deadline?: string;
          deadlineText?: string;
          reminder?: string;
          reminderText?: string;
          repeat?: string;
          repeatText?: string;
          note?: string | null;
          schedule?: PickedScheduleMeta | null;
          priority?: number;
          estimatedMinutes?: number;
        };
      }
    | undefined;
}

type ReminderOption = TaskReminderOption;
type RepeatOption = '不重复' | '每天' | '每周' | '每月' | '每年';
type SettingPickerType = 'reminder' | 'repeat' | null;
type TaskScheduleMeta = ScheduleMeta;

type TaskMetaExtra = Record<string, unknown> & {
  reminder?: string;
  repeat?: string;
  schedule?: TaskScheduleMeta | null;
};

function dueDateFromSchedulePick(picked: SchedulePickerResult): string | null {
  if (picked.repeatOption !== '不重复') return null;
  if (picked.mode === 'time' && picked.range?.end) return picked.range.end;
  if (picked.date) return picked.date;
  return null;
}

function parseTaskMeta(extraData: string | null): TaskMetaExtra {
  if (!extraData) return {};
  try {
    const parsed = JSON.parse(extraData) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as TaskMetaExtra;
    return {};
  } catch {
    return {};
  }
}

function formatTaskStatus(status: string) {
  if (status === 'doing') return '进行中';
  if (status === 'done') return '已完成';
  if (status === 'blocked') return '受阻';
  if (status === 'cancelled') return '已取消';
  if (status === 'shelved') return '暂时搁置';
  return '待办';
}

function formatTaskPriority(priority: number) {
  if (priority >= 4) return 'P1 紧急重要';
  if (priority === 3) return 'P2 紧急不重要';
  if (priority === 2) return 'P3 不紧急重要';
  if (priority === 1) return 'P4 不紧急不重要';
  return '';
}

function formatPriorityShort(priority: number) {
  if (priority >= 4) return 'P1';
  if (priority === 3) return 'P2';
  if (priority === 2) return 'P3';
  if (priority === 1) return 'P4';
  return '';
}

function statusTagTone(status: string): 'green' | 'amber' | 'gray' | 'rose' {
  if (status === 'doing' || status === 'done') return 'green';
  if (status === 'blocked' || status === 'shelved') return 'amber';
  if (status === 'cancelled') return 'rose';
  return 'gray';
}

function formatDateTimeCN(value: string | null) {
  if (!value) return '';
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const [y, m, d] = trimmed.split('-').map(Number);
    return `${m}/${d}`;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  if (hh === '00' && mm === '00') return `${m}/${d}`;
  return `${m}/${d} ${hh}:${mm}`;
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
  if (!value?.trim()) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(11, 16);
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${hour}:${minute}`;
}

function formatAssignYmdLabel(ymd: string) {
  const d = parseYmd(ymd);
  if (!d) return ymd;
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

/** 与 edit-task 一致：优先用 schedule 元数据展示区间/时刻，否则回退 due_date */
function buildScheduleDisplayLabel(schedule: TaskScheduleMeta | null | undefined, dueDate: string | null): string {
  if (schedule?.mode === 'time' && schedule.range?.start && schedule.range?.end) {
    const rangeStart = formatDate(schedule.range.start);
    const rangeEnd = formatDate(schedule.range.end);
    const rangeLabel = rangeStart === rangeEnd ? rangeStart : `${rangeStart} ~ ${rangeEnd}`;
    const timeLabel = schedule.allDay
      ? '全天'
      : `${formatTime(schedule.startTime ?? '')} - ${formatTime(schedule.endTime ?? '')}`;
    return `${rangeLabel} ${timeLabel}`.trim();
  }
  if (schedule?.date) {
    const dateLabel = formatDate(schedule.date);
    const timeLabel = schedule.allDay ? '全天' : schedule.hasExactTime ? formatTime(schedule.startTime ?? '') : '';
    return timeLabel ? `${dateLabel} ${timeLabel}` : dateLabel;
  }
  return formatDateTimeCN(dueDate);
}

function buildFrogSlotLabel(schedule: TaskScheduleMeta | null | undefined, assignYmd: string): string {
  const day = formatAssignYmdLabel(assignYmd);
  if (schedule?.hasExactTime && schedule.startTime) {
    const start = formatTime(schedule.startTime);
    const end = schedule.endTime ? formatTime(schedule.endTime) : '';
    return end ? `已入格 · ${day} ${start}–${end}` : `已入格 · ${day} ${start}`;
  }
  if (schedule?.allDay) return `已入格 · ${day} 全天`;
  return `已入格 · ${day}`;
}

const REMINDER_OPTIONS: ReminderOption[] = TASK_REMINDER_OPTIONS;
const REPEAT_OPTIONS: RepeatOption[] = ['不重复', '每天', '每周', '每月', '每年'];
const WEEKDAY_OPTIONS = [
  { label: '周一', value: 1 },
  { label: '周二', value: 2 },
  { label: '周三', value: 3 },
  { label: '周四', value: 4 },
  { label: '周五', value: 5 },
  { label: '周六', value: 6 },
  { label: '周日', value: 7 },
];
const MONTH_DAY_OPTIONS = Array.from({ length: 31 }, (_, i) => i + 1);

function parseYmdToDate(ymd: string | undefined | null): Date | null {
  if (!ymd?.trim()) return null;
  return parseYmd(ymd);
}

function toLocalYmd(d: Date): string {
  return formatYmd(d);
}

function patchMetaWithRepeat(
  currentMeta: TaskMetaExtra,
  repeatOption: RepeatOption,
  weeklyDays: number[],
  monthlyDays: number[],
  yearlyDate: Date,
): TaskMetaExtra {
  const repeatSummary =
    repeatOption === '不重复' ? '不重复' : formatRepeatSummary(repeatOption, weeklyDays, monthlyDays, yearlyDate);
  const repeat = repeatOption === '不重复' ? '' : repeatSummary;
  const schedule = currentMeta.schedule ?? ({} as TaskScheduleMeta);
  return {
    ...currentMeta,
    repeat,
    schedule: {
      ...schedule,
      repeatOption,
      repeatSummary,
      weeklyDays,
      monthlyDays,
      yearlyDate: toLocalYmd(yearlyDate),
    },
  };
}

function formatRepeatSummary(
  option: RepeatOption,
  weeklyDays: number[],
  monthlyDays: number[],
  yearlyDate: Date,
): string {
  if (option === '每周') {
    if (!weeklyDays.length) return '每周';
    const labels = WEEKDAY_OPTIONS.filter((item) => weeklyDays.includes(item.value)).map((item) => item.label);
    return `每周 ${labels.join('、')}`;
  }
  if (option === '每月') {
    if (!monthlyDays.length) return '每月';
    const sorted = [...monthlyDays].sort((a, b) => a - b);
    return `每月 ${sorted.join('、')}日`;
  }
  if (option === '每年') return `每年 ${yearlyDate.getMonth() + 1}月${yearlyDate.getDate()}日`;
  return option;
}

function countTreeProgress(node: TaskTreeNode | null): { done: number; total: number; ratio: number } {
  const children = node?.children ?? [];
  if (children.length === 0) {
    const done = node && (node.status === 'done' || node.status === 'cancelled') ? 1 : 0;
    return { done, total: node ? 1 : 0, ratio: done };
  }
  let done = 0;
  for (const c of children) {
    if (c.status === 'done' || c.status === 'cancelled') done += 1;
  }
  return { done, total: children.length, ratio: done / children.length };
}

function collectTreeIds(node: TaskTreeNode | null): string[] {
  if (!node) return [];
  const ids = [node.id];
  for (const child of node.children) ids.push(...collectTreeIds(child));
  return ids;
}

type LinkTaskRef = {
  id: string;
  title: string;
  status: string;
  kind: 'parent' | 'next';
  progressDone: number;
  progressTotal: number;
};

function formatActivityWhen(createdAt: string, todayYmd: string): string {
  const trimmed = createdAt.trim();
  const day = trimmed.slice(0, 10);
  const timeMatch = /(\d{2}):(\d{2})/.exec(trimmed);
  const hm = timeMatch ? `${timeMatch[1]}:${timeMatch[2]}` : '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    if (day === todayYmd) return hm || '今天';
    const d = parseYmd(day);
    const t = parseYmd(todayYmd);
    if (d && t) {
      const diff = Math.round((t.getTime() - d.getTime()) / 86400000);
      if (diff === 1) return '昨天';
      if (diff > 1 && diff < 7) return `${diff} 天前`;
    }
    const [, m, dd] = day.split('-');
    return `${Number(m)}/${Number(dd)}`;
  }
  return hm || trimmed.slice(5, 16);
}

function activityActionLabel(action: string): string {
  if (action === 'completed') return '完成';
  if (action === 'reopened') return '恢复为待办';
  return action;
}

function StatusTag({
  label,
  tone,
}: {
  label: string;
  tone: 'green' | 'amber' | 'gray' | 'rose' | 'frog';
}) {
  const { tf } = useTaskFoldTheme();
  const bg =
    tone === 'green'
      ? tf.lily2
      : tone === 'amber'
        ? tf.amber2
        : tone === 'rose'
          ? tf.rose2
          : tone === 'frog'
            ? '#E8EFD9'
            : '#EDE8DC';
  const color =
    tone === 'green'
      ? tf.frog
      : tone === 'amber'
        ? tf.amberInk
        : tone === 'rose'
          ? tf.rose
          : tone === 'frog'
            ? '#4F7450'
            : '#6E7A71';
  return (
    <View style={[styles.tag, { backgroundColor: bg }]}>
      <Text style={[styles.tagText, { color }]}>{label}</Text>
    </View>
  );
}

function FrogMarkHop({ children }: { children: React.ReactNode }) {
  const { animate } = useFoldMotionGate();
  const y = React.useRef(new Animated.Value(0)).current;
  const scale = React.useRef(new Animated.Value(1)).current;

  React.useEffect(() => {
    if (!animate) return;
    const anim = Animated.sequence([
      Animated.parallel([
        Animated.timing(y, {
          toValue: -9,
          duration: Math.round(TaskFoldMotion.frogHop * 0.32),
          useNativeDriver: true,
        }),
        Animated.timing(scale, {
          toValue: 1.04,
          duration: Math.round(TaskFoldMotion.frogHop * 0.32),
          useNativeDriver: true,
        }),
      ]),
      Animated.parallel([
        Animated.timing(y, {
          toValue: 0,
          duration: Math.round(TaskFoldMotion.frogHop * 0.3),
          useNativeDriver: true,
        }),
        Animated.timing(scale, {
          toValue: 0.98,
          duration: Math.round(TaskFoldMotion.frogHop * 0.3),
          useNativeDriver: true,
        }),
      ]),
      Animated.timing(scale, {
        toValue: 1,
        duration: Math.round(TaskFoldMotion.frogHop * 0.38),
        useNativeDriver: true,
      }),
    ]);
    anim.start();
    return () => anim.stop();
  }, [animate, scale, y]);

  return <Animated.View style={{ transform: [{ translateY: y }, { scale }] }}>{children}</Animated.View>;
}

const PAGE_API_KEY = 'task-detail';

export default function TaskDetailScreen() {
  const { id: idParam } = useLocalSearchParams<{ id?: string | string[] }>();
  const taskId = normalizeRouteParam(idParam);
  const { wrapLoad } = usePageApiSync(PAGE_API_KEY);
  const router = useRouter();
  const navigation = useNavigation();
  const isFocused = useIsFocused();
  const insets = useSafeAreaInsets();
  const { tf, fonts, isDark } = useTaskFoldTheme();
  const { animate: foldAnimate } = useFoldMotionGate();

  const [title, setTitle] = React.useState('');
  const [acceptanceCriteria, setAcceptanceCriteria] = React.useState('');
  const [status, setStatus] = React.useState('todo');
  const [priority, setPriority] = React.useState<number>(0);
  const [dueDate, setDueDate] = React.useState<string | null>(null);
  const [extraData, setExtraData] = React.useState<string | null>(null);
  const [tree, setTree] = React.useState<TaskTreeNode | null>(null);
  const [projectId, setProjectId] = React.useState<string | null>(null);
  const [categoryId, setCategoryId] = React.useState<string | null>(null);
  const [projectName, setProjectName] = React.useState('');
  const [parentTitle, setParentTitle] = React.useState('');
  const [parentTaskId, setParentTaskId] = React.useState<string | null>(null);
  const [rewardPoints, setRewardPoints] = React.useState(0);
  const [activityEvents, setActivityEvents] = React.useState<TaskExecutionEventWithTitle[]>([]);
  const [relatedTags, setRelatedTags] = React.useState<TagRow[]>([]);
  const [linkTasks, setLinkTasks] = React.useState<LinkTaskRef[]>([]);
  const [settingPickerType, setSettingPickerType] = React.useState<SettingPickerType>(null);
  const [repeatDetailVisible, setRepeatDetailVisible] = React.useState(false);
  const [reminderOption, setReminderOption] = React.useState<ReminderOption>('不提前');
  const [repeatOption, setRepeatOption] = React.useState<RepeatOption>('不重复');
  const [weeklyDays, setWeeklyDays] = React.useState<number[]>([1]);
  const [monthlyDays, setMonthlyDays] = React.useState<number[]>([1]);
  const [yearlyDate, setYearlyDate] = React.useState<Date>(new Date());
  const [yearlyDatePickerVisible, setYearlyDatePickerVisible] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [unassigning, setUnassigning] = React.useState(false);
  const [togglingId, setTogglingId] = React.useState<string | null>(null);
  const [addSubtaskOpen, setAddSubtaskOpen] = React.useState(false);

  const scheduleSource = React.useMemo(() => `task-detail-${taskId || 'unknown'}`, [taskId]);
  const extraDataRef = React.useRef<string | null>(null);
  extraDataRef.current = extraData;
  const dueDateRef = React.useRef<string | null>(null);
  dueDateRef.current = dueDate;
  const skipAutoSaveRef = React.useRef(false);
  const exitingAfterSaveRef = React.useRef(false);
  const creatingSubtaskIdRef = React.useRef<string | null>(null);
  const [taskLoaded, setTaskLoaded] = React.useState(false);
  const [skipRemoveGuard, setSkipRemoveGuard] = React.useState(false);
  /** 进入页时的 due/extra 快照；仅脏时离开才写库，避免每次返回都同步 */
  const [loadedScheduleSnapshot, setLoadedScheduleSnapshot] = React.useState<{
    dueDate: string | null;
    extraData: string | null;
  } | null>(null);
  const projectIdRef = React.useRef<string | null>(null);
  const categoryIdRef = React.useRef<string | null>(null);
  const priorityRef = React.useRef(0);
  projectIdRef.current = projectId;
  categoryIdRef.current = categoryId;
  priorityRef.current = priority;

  React.useEffect(() => {
    exitingAfterSaveRef.current = false;
    skipAutoSaveRef.current = false;
    setSkipRemoveGuard(false);
    setLoadedScheduleSnapshot(null);
    setTaskLoaded(false);
  }, [taskId]);

  const isScheduleDirty =
    taskLoaded &&
    loadedScheduleSnapshot != null &&
    ((dueDate ?? null) !== loadedScheduleSnapshot.dueDate ||
      (extraData ?? null) !== loadedScheduleSnapshot.extraData);

  const foldCardBg = isDark ? 'rgba(255,252,245,0.06)' : 'rgba(255,252,245,0.86)';
  const foldCardBorder = tf.line2;
  const addSubtaskSource = React.useMemo(() => `${scheduleSource}-add-subtask`, [scheduleSource]);
  const logicalToday = React.useMemo(
    () => getLogicalLocalYmd(new Date(), getDayBoundarySync()),
    [],
  );

  const applySchedulePick = React.useCallback((picked: SchedulePickerResult, baseExtraRaw: string | null) => {
    const currentMeta = parseTaskMeta(baseExtraRaw);
    const scheduleMeta: TaskScheduleMeta = {
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
    };
    const nextMeta: TaskMetaExtra = {
      ...currentMeta,
      reminder: formatTaskReminderLabel(scheduleMeta),
      repeat: picked.repeatOption === '不重复' ? '' : picked.repeatSummary,
      schedule: scheduleMeta,
    };

    setDueDate(dueDateFromSchedulePick(picked));
    setExtraData(JSON.stringify(nextMeta));
    setReminderOption(picked.reminderOption);
    setRepeatOption(picked.repeatOption);
    if (picked.weeklyDays.length > 0) setWeeklyDays(picked.weeklyDays);
    if (picked.monthlyDays.length > 0) setMonthlyDays(picked.monthlyDays);
    const parsedYearly = parseYmdToDate(picked.yearlyDate);
    if (parsedYearly) setYearlyDate(parsedYearly);
  }, []);

  const readScheduleResult = React.useCallback((): boolean => {
    const picked = consumeSchedulePickerResult(scheduleSource);
    if (!picked) return false;
    applySchedulePick(picked, extraDataRef.current);
    return true;
  }, [applySchedulePick, scheduleSource]);

  const loadTaskDetail = React.useCallback(async () => {
    if (!taskId) return;
    const row = await getTaskById(taskId);
    if (row && isStandaloneTodoTask(row)) {
      router.replace(standaloneTodoEditorHref(taskId));
      return;
    }
    if (row) {
      const nextDue = row.due_date ?? null;
      const nextExtra = row.extra_data ?? null;
      setTaskLoaded(true);
      setLoadedScheduleSnapshot({ dueDate: nextDue, extraData: nextExtra });
      setTitle(row.title);
      setAcceptanceCriteria(resolveAcceptanceCriteria(row.description, row.note));
      setStatus(row.status);
      setPriority(row.priority ?? 0);
      setDueDate(nextDue);
      setExtraData(nextExtra);
      setProjectId(row.project_id ?? null);
      setCategoryId(row.category_id ?? null);
      setRewardPoints(parseRewardPointsFromExtraData(row.extra_data));
      const parsed = parseTaskMeta(row.extra_data ?? null);
      const reminder = typeof parsed.reminder === 'string' ? parsed.reminder.trim() : '';
      const scheduleReminder = parsed.schedule?.reminderOption?.trim();
      const reminderFromText = (() => {
        if (!reminder) return null;
        if (REMINDER_OPTIONS.includes(reminder as ReminderOption)) return reminder as ReminderOption;
        if (reminder === '当天' || reminder.startsWith('当天 ')) return '当天' as ReminderOption;
        const m = /^(提前\d+天)/.exec(reminder);
        if (m && REMINDER_OPTIONS.includes(m[1] as ReminderOption)) return m[1] as ReminderOption;
        return null;
      })();
      setReminderOption(
        scheduleReminder && REMINDER_OPTIONS.includes(scheduleReminder as ReminderOption)
          ? (scheduleReminder as ReminderOption)
          : reminderFromText ?? '不提前',
      );
      const repeatSchedule = parseTaskRepeatSchedule(row.extra_data ?? null);
      if (repeatSchedule) {
        setRepeatOption(repeatSchedule.repeatOption);
        if (repeatSchedule.weeklyDays.length > 0) setWeeklyDays(repeatSchedule.weeklyDays);
        if (repeatSchedule.monthlyDays.length > 0) setMonthlyDays(repeatSchedule.monthlyDays);
        const parsedYearly = parseYmdToDate(repeatSchedule.yearlyDate);
        if (parsedYearly) setYearlyDate(parsedYearly);
      } else {
        setRepeatOption('不重复');
      }

      if (row.project_id) {
        try {
          const project = await getProjectById(row.project_id);
          setProjectName(project?.name?.trim() || '');
        } catch {
          setProjectName('');
        }
      } else {
        setProjectName('');
      }

      setParentTaskId(row.parent_task_id ?? null);
      if (row.parent_task_id) {
        try {
          const parent = await getTaskById(row.parent_task_id);
          setParentTitle(parent?.title?.trim() || '');
        } catch {
          setParentTitle('');
        }
      } else {
        setParentTitle('');
      }

      try {
        const [ownTags, projectTags] = await Promise.all([
          getTagsByEntity('task', taskId),
          row.project_id ? getTagsByProjectId(row.project_id) : Promise.resolve([] as TagRow[]),
        ]);
        const seen = new Set<string>();
        const merged: TagRow[] = [];
        for (const tag of [...projectTags, ...ownTags]) {
          if (seen.has(tag.id)) continue;
          seen.add(tag.id);
          merged.push(tag);
        }
        setRelatedTags(merged);
      } catch {
        setRelatedTags([]);
      }
    } else {
      setTaskLoaded(false);
      setLoadedScheduleSnapshot(null);
      setTitle('');
      setAcceptanceCriteria('');
      setStatus('todo');
      setPriority(0);
      setDueDate(null);
      setExtraData(null);
      setProjectId(null);
      setCategoryId(null);
      setProjectName('');
      setParentTitle('');
      setParentTaskId(null);
      setRewardPoints(0);
      setRelatedTags([]);
      setLinkTasks([]);
      setActivityEvents([]);
    }
    const t = await getTaskTreeByRootTaskId(taskId);
    setTree(t);

    if (row) {
      const treeIds = collectTreeIds(t ?? { ...row, children: [] });
      try {
        const events = await getRecentExecutionEventsForTaskIds(treeIds, 3);
        setActivityEvents(events);
      } catch {
        setActivityEvents([]);
      }

      const links: LinkTaskRef[] = [];
      try {
        if (row.parent_task_id) {
          const parentTree = await getTaskTreeByRootTaskId(row.parent_task_id);
          if (parentTree) {
            const pProg = countTreeProgress(parentTree);
            links.push({
              id: parentTree.id,
              title: parentTree.title,
              status: parentTree.status,
              kind: 'parent',
              progressDone: pProg.done,
              progressTotal: pProg.total,
            });
          }
          const siblings = await getChildTasksByParentTaskId(row.parent_task_id);
          const idx = siblings.findIndex((s) => s.id === taskId);
          const next = idx >= 0 ? siblings.slice(idx + 1).find((s) => s.status !== 'done' && s.status !== 'cancelled') : null;
          if (next) {
            const nProg = countTreeProgress(next);
            links.push({
              id: next.id,
              title: next.title,
              status: next.status,
              kind: 'next',
              progressDone: nProg.done,
              progressTotal: nProg.total,
            });
          }
        } else if (row.project_id) {
          const roots = await getTasksByProjectId(row.project_id);
          const idx = roots.findIndex((s) => s.id === taskId);
          const next = idx >= 0 ? roots.slice(idx + 1).find((s) => s.status !== 'done' && s.status !== 'cancelled') : null;
          if (next) {
            const nProg = countTreeProgress(next);
            links.push({
              id: next.id,
              title: next.title,
              status: next.status,
              kind: 'next',
              progressDone: nProg.done,
              progressTotal: nProg.total,
            });
          }
        }
      } catch {
        /* ignore link errors */
      }
      setLinkTasks(links);
    }
  }, [router, taskId]);

  const reloadTaskDetail = React.useCallback(
    async (forceRefresh = false) => {
      await wrapLoad(async () => {
        await loadTaskDetail();
      }, forceRefresh);
    },
    [loadTaskDetail, wrapLoad],
  );

  const { refreshControl } = usePagePullRefresh(PAGE_API_KEY, reloadTaskDetail);
  const progress = React.useMemo(() => countTreeProgress(tree), [tree]);

  const createSubtaskFromDraft = React.useCallback(
    async (draft: AddSubtaskDraft) => {
      if (!taskId || creatingSubtaskIdRef.current === draft.id) return;
      creatingSubtaskIdRef.current = draft.id;
      try {
        const subtaskSchedule = draft.schedule ?? null;
        const due =
          dueDateFromScheduleMeta(
            subtaskSchedule,
            (draft.deadline || draft.deadlineText || '').trim() || null,
          ) ?? null;
        const hasPayloadPriority = typeof draft.priority === 'number' && draft.priority > 0;
        let subtaskPriority = normalizeTaskPriority(
          hasPayloadPriority ? draft.priority : priorityRef.current,
        );
        const pid = projectIdRef.current;
        if (!hasPayloadPriority && pid) {
          try {
            const project = await getProjectById(pid);
            if (project) subtaskPriority = normalizeTaskPriority(project.priority ?? 0);
          } catch {
            /* keep parent priority */
          }
        }
        await createTask({
          id: draft.id,
          project_id: pid,
          category_id: categoryIdRef.current,
          parent_task_id: taskId,
          title: draft.title.trim() || '未命名任务',
          note: draft.note?.trim() || null,
          status: 'todo',
          priority: subtaskPriority,
          due_date: due,
          extra_data: JSON.stringify({
            reminder: draft.reminder || draft.reminderText || '',
            repeat: draft.repeat || draft.repeatText || '',
            schedule: subtaskSchedule,
            ...(typeof draft.estimatedMinutes === 'number'
              ? { estimatedMinutes: draft.estimatedMinutes }
              : {}),
          }),
        });
        toast.success(
          progress.total > 0
            ? `子任务已添加 · 父任务进度 ${Math.round((progress.done / progress.total) * 100)}% → ${Math.round((progress.done / (progress.total + 1)) * 100)}%`
            : '子任务已添加',
        );
        notifyPageDataChanged(PAGE_API_KEY);
        await reloadTaskDetail(true);
      } catch (error) {
        console.warn('创建子任务失败', error);
        toast.error(formatWriteError(error, '子任务创建失败，请稍后重试。'));
        throw error;
      } finally {
        if (creatingSubtaskIdRef.current === draft.id) {
          creatingSubtaskIdRef.current = null;
        }
      }
    },
    [progress.done, progress.total, reloadTaskDetail, taskId],
  );

  React.useEffect(() => {
    readScheduleResult();
  }, [readScheduleResult]);

  useFocusEffect(
    React.useCallback(() => {
      const consumedSchedule = readScheduleResult();
      if (!consumedSchedule) {
        void reloadTaskDetail().catch((e) => console.warn('加载任务详情失败', e));
      }
    }, [readScheduleResult, reloadTaskDetail]),
  );

  const persistTaskDetail = React.useCallback(async (): Promise<boolean> => {
    if (!taskId || !taskLoaded || skipAutoSaveRef.current) return true;
    const nextDue = dueDateRef.current ?? null;
    const nextExtra = extraDataRef.current ?? null;
    const baseline = loadedScheduleSnapshot;
    if (
      baseline == null ||
      (nextDue === baseline.dueDate && nextExtra === baseline.extraData)
    ) {
      return true;
    }
    try {
      setSaving(true);
      await updateTask(taskId, {
        due_date: nextDue,
        extra_data: nextExtra,
      });
      // quiet：仍 await 推送，但不挂全屏「正在同步」蒙层，避免离开时闪一下
      await requestPush({ awaitSync: true, rethrow: true, quiet: true });
      setLoadedScheduleSnapshot({ dueDate: nextDue, extraData: nextExtra });
      return true;
    } catch (error) {
      console.warn('保存任务详情失败', error);
      toast.error(formatWriteError(error, '未能保存任务设置，请稍后重试。'));
      return false;
    } finally {
      setSaving(false);
    }
  }, [loadedScheduleSnapshot, taskId, taskLoaded]);

  const performLeave = React.useCallback(
    (leaveAction?: () => void) => {
      if (exitingAfterSaveRef.current) return;
      exitingAfterSaveRef.current = true;
      setSkipRemoveGuard(true);
      if (leaveAction) leaveAction();
      else router.back();
    },
    [router],
  );

  const exitWithSave = React.useCallback(async () => {
    if (exitingAfterSaveRef.current || saving) return;
    if (!isScheduleDirty) {
      performLeave();
      return;
    }
    // 先关掉离开守卫，避免 save 期间 router.back / 手势与 usePreventRemove 互相打架
    exitingAfterSaveRef.current = true;
    setSkipRemoveGuard(true);
    const ok = await persistTaskDetail();
    if (!ok) {
      exitingAfterSaveRef.current = false;
      setSkipRemoveGuard(false);
      return;
    }
    router.back();
  }, [isScheduleDirty, performLeave, persistTaskDetail, router, saving]);

  const navigateAfterDeleteTask = React.useCallback(() => {
    performLeave();
  }, [performLeave]);

  const removeTask = React.useCallback(() => {
    if (!taskId || saving || !taskLoaded) return;
    (async () => {
      try {
        const incomplete = await countIncompleteDescendantTasks(taskId);
        const message =
          incomplete > 0
            ? `该任务下有 ${incomplete} 个未完成子任务。\n\n确认删除该任务，并连同其所有子任务一起删除吗？（删除后在同步或恢复功能前无法找回）`
            : '删除后在同步或恢复功能前无法找回，确认删除吗？';

        Alert.alert('删除任务', message, [
          { text: '取消', style: 'cancel' },
          {
            text: '删除',
            style: 'destructive',
            onPress: async () => {
              try {
                skipAutoSaveRef.current = true;
                setSkipRemoveGuard(true);
                setSaving(true);
                await deleteTask(taskId);
                notifyPageDataChanged(PAGE_API_KEY);
                toast.success('已删除');
                navigateAfterDeleteTask();
              } catch (error) {
                console.warn('删除任务失败', error);
                toast.error(formatWriteError(error, '任务删除失败，请稍后重试。'));
              } finally {
                setSaving(false);
              }
            },
          },
        ]);
      } catch (error) {
        console.warn('统计子任务失败', error);
        Alert.alert('删除任务', '删除后在同步或恢复功能前无法找回，确认删除吗？', [
          { text: '取消', style: 'cancel' },
          {
            text: '删除',
            style: 'destructive',
            onPress: async () => {
              try {
                skipAutoSaveRef.current = true;
                setSkipRemoveGuard(true);
                setSaving(true);
                await deleteTask(taskId);
                notifyPageDataChanged(PAGE_API_KEY);
                toast.success('已删除');
                navigateAfterDeleteTask();
              } catch (err) {
                console.warn('删除任务失败', err);
                toast.error(formatWriteError(err, '任务删除失败，请稍后重试。'));
              } finally {
                setSaving(false);
              }
            },
          },
        ]);
      }
    })();
  }, [navigateAfterDeleteTask, saving, taskId, taskLoaded]);

  const preventRemove =
    isFocused &&
    taskLoaded &&
    isScheduleDirty &&
    !skipRemoveGuard &&
    !skipAutoSaveRef.current &&
    !exitingAfterSaveRef.current;

  usePreventRemove(preventRemove, ({ data }) => {
    void (async () => {
      if (exitingAfterSaveRef.current) return;
      exitingAfterSaveRef.current = true;
      setSkipRemoveGuard(true);
      const ok = await persistTaskDetail();
      if (!ok) {
        exitingAfterSaveRef.current = false;
        setSkipRemoveGuard(false);
        return;
      }
      navigation.dispatch(data.action);
    })();
  });

  const meta = React.useMemo(() => parseTaskMeta(extraData), [extraData]);
  const statusLabel = formatTaskStatus(status);
  const priorityLabel = formatTaskPriority(priority);
  const dueLabel = React.useMemo(
    () => buildScheduleDisplayLabel(meta.schedule, dueDate),
    [dueDate, meta.schedule],
  );
  const frogDates = React.useMemo(() => getFrogAssignedDates(extraData), [extraData]);
  const hasFrog = frogDates.length > 0;
  const latestFrogYmd = frogDates.length > 0 ? frogDates[frogDates.length - 1]! : '';
  const isLeaf = (tree?.children?.length ?? 0) === 0;
  const incompleteChildren = React.useMemo(
    () => (tree?.children ?? []).filter((c) => c.status !== 'done' && c.status !== 'cancelled').length,
    [tree],
  );
  const acceptanceLines = React.useMemo(
    () =>
      acceptanceCriteria
        .split(/\n+/)
        .map((s) => s.trim())
        .filter(Boolean),
    [acceptanceCriteria],
  );
  const subtitle = React.useMemo(() => {
    const parts = [projectName, parentTitle].filter(Boolean);
    if (parts.length === 0) return isLeaf ? '叶子任务' : '任务详情';
    return `${parts.join(' · ')}${isLeaf ? ' · 叶子任务' : ''}`;
  }, [isLeaf, parentTitle, projectName]);

  const activityFeed = React.useMemo(() => {
    type FeedRow = { key: string; title: string; detail: string; when: string; tone: 'frog' | 'amber' };
    const rows: FeedRow[] = [];
    if (hasFrog && latestFrogYmd) {
      const slot = buildFrogSlotLabel(meta.schedule, latestFrogYmd).replace(/^已入格 ·\s*/, '');
      rows.push({
        key: `frog-${latestFrogYmd}`,
        title: '手动入格',
        detail: ` · ${slot}`,
        when: formatActivityWhen(`${latestFrogYmd} 12:00:00`, logicalToday),
        tone: 'frog',
      });
    }
    for (const ev of activityEvents) {
      const name = ev.task_title?.trim() || (ev.task_id === taskId ? title : '子任务');
      const action = activityActionLabel(ev.action);
      const progressHint =
        ev.action === 'completed' && progress.total > 0
          ? ` · 子任务进度 ${progress.done} / ${progress.total}`
          : '';
      rows.push({
        key: ev.id,
        title: name,
        detail: ` ${action}${progressHint}`,
        when: formatActivityWhen(ev.created_at, logicalToday),
        tone: ev.action === 'completed' ? 'frog' : 'amber',
      });
    }
    return rows.slice(0, 3);
  }, [
    activityEvents,
    hasFrog,
    latestFrogYmd,
    logicalToday,
    meta.schedule,
    progress.done,
    progress.total,
    taskId,
    title,
  ]);

  const repeatSummary = React.useMemo(
    () =>
      repeatOption === '不重复'
        ? '不重复'
        : formatRepeatSummary(repeatOption, weeklyDays, monthlyDays, yearlyDate),
    [monthlyDays, repeatOption, weeklyDays, yearlyDate],
  );
  const settingPickerTitle = settingPickerType === 'reminder' ? '提醒设置' : '重复设置';
  const settingPickerOptions = settingPickerType === 'reminder' ? REMINDER_OPTIONS : REPEAT_OPTIONS;
  const settingPickerValue = settingPickerType === 'reminder' ? reminderOption : repeatOption;

  const restoreRepeatFromExtra = React.useCallback(() => {
    const repeatSchedule = parseTaskRepeatSchedule(extraData);
    if (repeatSchedule) {
      setRepeatOption(repeatSchedule.repeatOption);
      setWeeklyDays(repeatSchedule.weeklyDays.length > 0 ? repeatSchedule.weeklyDays : [1]);
      setMonthlyDays(repeatSchedule.monthlyDays.length > 0 ? repeatSchedule.monthlyDays : [1]);
      const parsedYearly = parseYmdToDate(repeatSchedule.yearlyDate);
      if (parsedYearly) setYearlyDate(parsedYearly);
    } else {
      setRepeatOption('不重复');
    }
  }, [extraData]);

  const toggleWeeklyDay = (day: number) => {
    setWeeklyDays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]));
  };

  const toggleMonthlyDay = (day: number) => {
    setMonthlyDays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]));
  };
  const yearlyPickerMinDate = React.useMemo(
    () => new Date(yearlyDate.getFullYear() - 100, 0, 1),
    [yearlyDate],
  );
  const yearlyPickerMaxDate = React.useMemo(
    () => new Date(yearlyDate.getFullYear() + 100, 11, 31),
    [yearlyDate],
  );

  const openSchedulePicker = React.useCallback(() => {
    const parsed = parseTaskMeta(extraData);
    const schedule = parsed.schedule ?? null;
    const scheduleInit = schedule
      ? {
          mode: schedule.mode,
          quickChip: '',
          allDay: schedule.allDay,
          hasExactTime: schedule.hasExactTime,
          reminderOption: schedule.reminderOption,
          reminderHour: schedule.reminderHour,
          reminderMinute: schedule.reminderMinute,
          repeatOption: schedule.repeatOption,
          repeatSummary: schedule.repeatSummary,
          weeklyDays: schedule.weeklyDays,
          monthlyDays: schedule.monthlyDays,
          yearlyDate: schedule.yearlyDate,
          date: schedule.date,
          range: schedule.range,
          startTime: schedule.startTime,
          endTime: schedule.endTime,
        }
      : undefined;
    router.push({
      pathname: '/schedule-picker',
      params: {
        source: scheduleSource,
        initial: scheduleInit ? JSON.stringify(scheduleInit) : '',
      },
    });
  }, [extraData, router, scheduleSource]);

  const cancelFrogPlacement = React.useCallback(() => {
    if (!taskId || !latestFrogYmd || unassigning) return;
    Alert.alert('取消指派', '果冻块将回到候选池，确认取消入格吗？', [
      { text: '取消', style: 'cancel' },
      {
        text: '取消指派',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              setUnassigning(true);
              await unassignFrogForDay({ kind: 'task', id: taskId, assignYmd: latestFrogYmd });
              notifyPageDataChanged(PAGE_API_KEY);
              toast.success('已取消指派 · 果冻块回到候选池');
              await reloadTaskDetail(true);
            } catch (error) {
              console.warn('取消指派失败', error);
              toast.error(formatWriteError(error, '取消指派失败，请稍后重试。'));
            } finally {
              setUnassigning(false);
            }
          })();
        },
      },
    ]);
  }, [latestFrogYmd, reloadTaskDetail, taskId, unassigning]);

  const toggleChildDone = React.useCallback(
    async (child: TaskTreeNode) => {
      if (togglingId) return;
      const nextDone = child.status !== 'done' && child.status !== 'cancelled';
      try {
        setTogglingId(child.id);
        await updateTask(child.id, {
          status: nextDone ? 'done' : 'todo',
          completed_at: nextDone ? formatTaskAuditDatetimeLocal() : null,
        });
        try {
          await insertTaskExecutionEvent(
            child.id,
            nextDone ? 'completed' : 'reopened',
            child.title ?? null,
          );
        } catch (eventError) {
          console.warn('写入子任务活动记录失败', eventError);
        }
        notifyPageDataChanged(PAGE_API_KEY);
        await reloadTaskDetail(true);
      } catch (error) {
        console.warn('更新子任务失败', error);
        toast.error(formatWriteError(error, '子任务状态更新失败。'));
      } finally {
        setTogglingId(null);
      }
    },
    [reloadTaskDetail, togglingId],
  );

  const footPad = Math.max(insets.bottom, 12);
  const rise = (index: number, children: React.ReactNode) => (
    <FoldRiseIn
      animate={foldAnimate}
      index={index}
      duration={520}
      staggerMs={TaskFoldMotion.schedBlockStagger}
      fromY={10}
      holdHidden={foldAnimate}>
      {children}
    </FoldRiseIn>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: tf.paper }]} edges={['top', 'left', 'right']}>
      <View style={[styles.appbar, { borderBottomColor: tf.line }]}>
        <Pressable
          onPress={() => void exitWithSave()}
          disabled={saving}
          hitSlop={10}
          accessibilityLabel="返回"
          style={({ pressed }) => [
            styles.iconbtn,
            { backgroundColor: isDark ? 'rgba(255,252,245,0.08)' : 'rgba(255,252,245,0.55)', borderColor: tf.line2 },
            pressed && { opacity: 0.75 },
          ]}>
          <MaterialIcons name="arrow-back" size={20} color={tf.ink2} />
        </Pressable>
        <View style={styles.appbarCenter}>
          <Text style={[styles.appbarTitle, { color: tf.ink }]}>任务详情</Text>
          <Text style={[styles.appbarSub, { color: tf.faint }]} numberOfLines={1}>
            {subtitle}
          </Text>
        </View>
        <Pressable
          onPress={removeTask}
          disabled={saving || !taskLoaded || !taskId}
          hitSlop={10}
          accessibilityLabel="删除任务"
          style={({ pressed }) => [
            styles.iconbtn,
            {
              backgroundColor: isDark ? 'rgba(255,252,245,0.08)' : 'rgba(255,252,245,0.55)',
              borderColor: tf.line2,
              opacity: saving || !taskLoaded || !taskId ? 0.45 : pressed ? 0.75 : 1,
            },
          ]}>
          <MaterialIcons name="delete-outline" size={20} color={tf.rose} />
        </Pressable>
      </View>

      <ScrollView
        refreshControl={refreshControl}
        contentContainerStyle={[styles.content, { paddingBottom: 120 + footPad }]}
        showsVerticalScrollIndicator={false}>
        {!taskLoaded && !title ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator color={tf.frog} />
            <Text style={{ color: tf.faint, marginTop: 8, fontSize: 12 }}>加载任务…</Text>
          </View>
        ) : (
          <>
            {rise(
              0,
              <View style={[styles.fcard, { backgroundColor: foldCardBg, borderColor: foldCardBorder }]}>
                <View style={styles.heroRow}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text
                      style={[styles.heroTitle, { color: tf.pond, fontFamily: fonts.serif }]}
                      numberOfLines={3}>
                      {title || '未找到任务'}
                    </Text>
                    <View style={styles.tagRow}>
                      <StatusTag label={statusLabel} tone={statusTagTone(status)} />
                      {!!priorityLabel && <StatusTag label={priorityLabel} tone="amber" />}
                      {isLeaf ? <StatusTag label="叶子任务" tone="gray" /> : null}
                      {hasFrog ? <StatusTag label="🐸 已入格" tone="frog" /> : null}
                    </View>
                  </View>
                  <FoldProgressRing ratio={progress.ratio} size={40} strokeWidth={3} />
                </View>
                <View style={{ marginTop: 10 }}>
                  <FoldProgressBar ratio={progress.ratio} height={4} />
                </View>
                <View style={styles.metaRow}>
                  <Text style={[styles.metaText, { color: tf.faint }]}>
                    {progress.total > 0 ? `${progress.done} / ${progress.total} 子任务` : '无子任务'}
                  </Text>
                  <View style={[styles.dot, { backgroundColor: tf.faint }]} />
                  <Text style={[styles.metaText, { color: tf.faint, fontFamily: fonts.mono }]}>
                    {rewardPoints > 0 ? `+${rewardPoints}` : String(rewardPoints)} 积分
                  </Text>
                  {dueLabel ? (
                    <>
                      <View style={[styles.dot, { backgroundColor: tf.faint }]} />
                      <Text style={[styles.metaText, { color: tf.faint }]} numberOfLines={1}>
                        {dueLabel} 截止
                      </Text>
                    </>
                  ) : null}
                  {projectId ? (
                    <Pressable
                      onPress={() =>
                        router.push({ pathname: '/edit-project', params: { id: projectId } })
                      }
                      style={{ marginLeft: 'auto' }}
                      hitSlop={8}>
                      <Text style={{ fontSize: 11, color: '#6F856B', fontWeight: '600' }}>项目详情 ›</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>,
            )}

            {hasFrog
              ? rise(
                  1,
                  <View
                    style={[
                      styles.fcard,
                      {
                        backgroundColor: 'rgba(232,239,217,0.36)',
                        borderColor: '#C8D8B1',
                      },
                    ]}>
                    <View style={styles.frogRow}>
                      <FrogMarkHop>
                        <View style={[styles.frogmark, { backgroundColor: tf.lily }]}>
                          <MaterialIcons name="spa" size={16} color={tf.frog} />
                        </View>
                      </FrogMarkHop>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={[styles.frogTitle, { color: '#445E45' }]} numberOfLines={1}>
                          {buildFrogSlotLabel(meta.schedule, latestFrogYmd)}
                        </Text>
                        <Text style={{ fontSize: 11, color: '#7F947B', marginTop: 2 }}>
                          {latestFrogYmd === logicalToday ? '今日指派' : '已指派'} · 与其他占用请在日程中核对
                        </Text>
                      </View>
                      <Pressable
                        onPress={cancelFrogPlacement}
                        disabled={unassigning}
                        style={({ pressed }) => [
                          styles.fchipBtn,
                          {
                            backgroundColor: 'rgba(255,255,255,0.6)',
                            opacity: unassigning ? 0.55 : pressed ? 0.8 : 1,
                          },
                        ]}>
                        {unassigning ? (
                          <ActivityIndicator size="small" color={tf.frog} />
                        ) : (
                          <Text style={{ fontSize: 11, color: '#4F6152', fontWeight: '650' }}>取消指派</Text>
                        )}
                      </Pressable>
                    </View>
                  </View>,
                )
              : null}

            {rise(
              hasFrog ? 2 : 1,
              <View style={[styles.fcard, { backgroundColor: foldCardBg, borderColor: foldCardBorder }]}>
                <View style={styles.sectionHead}>
                  <Text style={[styles.sectionTitle, { color: tf.ink2 }]}>验收标准</Text>
                  <Pressable
                    onPress={() =>
                      taskId &&
                      router.push({ pathname: '/edit-task', params: { id: taskId, from: 'task-detail' } })
                    }
                    hitSlop={8}
                    style={{ marginLeft: 'auto' }}>
                    <Text style={{ fontSize: 11, color: '#6F856B', fontWeight: '600' }}>编辑 ›</Text>
                  </Pressable>
                </View>
                {acceptanceLines.length > 0 ? (
                  acceptanceLines.map((line, i) => (
                    <View key={`${i}-${line.slice(0, 12)}`} style={styles.subhabit}>
                      <View style={[styles.cb2, { borderColor: tf.line2 }]} />
                      <Text style={[styles.subhabitText, { color: tf.ink2 }]}>{line}</Text>
                    </View>
                  ))
                ) : (
                  <Text style={{ fontSize: 12, color: tf.faint, paddingVertical: 4 }}>暂无验收标准</Text>
                )}
              </View>,
            )}

            {rise(
              hasFrog ? 3 : 2,
              <View style={[styles.fcard, { backgroundColor: foldCardBg, borderColor: foldCardBorder }]}>
                <View style={styles.sectionHead}>
                  <Text style={[styles.sectionTitle, { color: tf.ink2 }]}>子任务</Text>
                  {incompleteChildren > 0 ? (
                    <Text style={{ fontSize: 11, color: tf.faint, marginLeft: 6 }}>
                      {incompleteChildren} 未完成
                    </Text>
                  ) : null}
                </View>
                {(tree?.children ?? []).map((child) => {
                  const done = child.status === 'done' || child.status === 'cancelled';
                  const childFrog = getFrogAssignedDates(child.extra_data).length > 0;
                  const pShort = formatPriorityShort(child.priority ?? 0);
                  return (
                    <View key={child.id} style={styles.trow}>
                      <Pressable
                        onPress={() => void toggleChildDone(child)}
                        disabled={togglingId === child.id}
                        hitSlop={6}
                        style={[
                          styles.cb,
                          done && { backgroundColor: tf.frog, borderColor: tf.frog },
                          !done && { borderColor: tf.line2 },
                        ]}>
                        {togglingId === child.id ? (
                          <ActivityIndicator size="small" color={done ? '#fff' : tf.frog} />
                        ) : done ? (
                          <MaterialIcons name="check" size={12} color="#fff" />
                        ) : null}
                      </Pressable>
                      <Pressable
                        onPress={() => router.push({ pathname: '/task/[id]', params: { id: child.id } })}
                        style={{ flex: 1, minWidth: 0 }}>
                        <Text
                          style={[
                            styles.tn,
                            {
                              color: done ? tf.faint : tf.ink2,
                              textDecorationLine: done ? 'line-through' : 'none',
                            },
                          ]}
                          numberOfLines={2}>
                          {child.title}
                        </Text>
                      </Pressable>
                      {childFrog ? (
                        <View style={styles.frogleaf}>
                          <Text style={{ fontSize: 10, color: '#4F7450' }}>🐸</Text>
                        </View>
                      ) : null}
                      {pShort ? (
                        <Text style={[styles.tp, { color: tf.faint, fontFamily: fonts.mono }]}>{pShort}</Text>
                      ) : null}
                    </View>
                  );
                })}
                <View style={styles.treefoot}>
                  <Pressable
                    onPress={() => setAddSubtaskOpen(true)}
                    style={({ pressed }) => [
                      styles.addSub,
                      { opacity: pressed ? 0.75 : 1 },
                    ]}>
                    <MaterialIcons name="add" size={14} color={tf.frog} />
                    <Text style={{ fontSize: 12, color: tf.frog, fontWeight: '700' }}>添加子任务</Text>
                  </Pressable>
                  <Text style={{ fontSize: 10, color: tf.faint, marginLeft: 'auto' }}>
                    子任务不可直接入格
                  </Text>
                </View>
              </View>,
            )}

            {rise(
              hasFrog ? 4 : 3,
              <Pressable
                onPress={openSchedulePicker}
                style={({ pressed }) => [
                  styles.fcard,
                  styles.schedCard,
                  {
                    backgroundColor: foldCardBg,
                    borderColor: foldCardBorder,
                    opacity: pressed ? 0.9 : 1,
                  },
                ]}>
                <View style={[styles.si, { backgroundColor: '#F1EDE1' }]}>
                  <MaterialIcons name="repeat" size={14} color="#7E8C80" />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[styles.schedMain, { color: '#536155' }]} numberOfLines={1}>
                    {meta.reminder?.trim() || reminderOption !== '不提前'
                      ? `${repeatSummary} · ${meta.reminder?.trim() || reminderOption}`
                      : dueLabel || '未设置日程'}
                  </Text>
                  <Text style={{ fontSize: 10, color: '#9CA59C', marginTop: 2 }}>
                    {repeatOption === '不重复'
                      ? '点击修改提醒与重复'
                      : '重复任务 · 完成后生成下一次实例'}
                  </Text>
                </View>
                {!!priorityLabel && <StatusTag label={formatPriorityShort(priority) || 'P'} tone="amber" />}
              </Pressable>,
            )}

            {/* 设计稿 shot13 底部三栏：活动记录 / 关联 / 依赖与后续 */}
            {rise(
              hasFrog ? 5 : 4,
              <View style={[styles.fcard, styles.extraCard, { backgroundColor: foldCardBg, borderColor: foldCardBorder }]}>
                <View style={styles.sectionHead}>
                  <Text style={[styles.sectionTitle, { color: tf.ink2 }]}>活动记录</Text>
                  <Text style={{ fontSize: 11, color: tf.faint, marginLeft: 6 }}>
                    {activityFeed.length > 0 ? `最近 ${activityFeed.length} 条` : '暂无'}
                  </Text>
                  <Pressable
                    onPress={() => router.push('/tasks-overview')}
                    hitSlop={8}
                    style={{ marginLeft: 'auto' }}>
                    <Text style={{ fontSize: 11, color: '#6F856B', fontWeight: '600' }}>全部 ›</Text>
                  </Pressable>
                </View>
                {activityFeed.length === 0 ? (
                  <Text style={{ fontSize: 12, color: tf.faint, paddingVertical: 4 }}>
                    完成或恢复子任务后会出现在这里
                  </Text>
                ) : (
                  activityFeed.map((row, i) => (
                    <View
                      key={row.key}
                      style={[
                        styles.actrow,
                        i === 0 ? { borderTopWidth: 0, paddingTop: 2 } : null,
                      ]}>
                      <View
                        style={[
                          styles.ad,
                          { backgroundColor: row.tone === 'frog' ? tf.frog : tf.amber },
                        ]}
                      />
                      <Text style={[styles.at, { color: tf.ink2 }]} numberOfLines={2}>
                        <Text style={{ fontWeight: '700' }}>{row.title}</Text>
                        {row.detail}
                      </Text>
                      <Text style={[styles.aw, { color: tf.faint }]}>{row.when}</Text>
                    </View>
                  ))
                )}
              </View>,
            )}

            {rise(
              hasFrog ? 6 : 5,
              <View style={[styles.fcard, styles.extraCard, { backgroundColor: foldCardBg, borderColor: foldCardBorder }]}>
                <View style={styles.sectionHead}>
                  <Text style={[styles.sectionTitle, { color: '#536155' }]}>关联</Text>
                  <Pressable
                    onPress={() =>
                      taskId &&
                      router.push({ pathname: '/edit-task', params: { id: taskId, from: 'task-detail' } })
                    }
                    hitSlop={8}
                    style={{ marginLeft: 'auto' }}>
                    <Text style={{ fontSize: 11, color: '#6F856B', fontWeight: '600' }}>管理 ›</Text>
                  </Pressable>
                </View>
                <View style={styles.chipWrap}>
                  {relatedTags.map((tag) => (
                    <View
                      key={tag.id}
                      style={[styles.fchipSoft, { backgroundColor: '#E8EFD9' }]}>
                      <Text style={{ fontSize: 11, color: '#4F7450', fontWeight: '650' }} numberOfLines={1}>
                        {tag.name}
                      </Text>
                    </View>
                  ))}
                  {parentTitle ? (
                    <Pressable
                      onPress={() =>
                        parentTaskId &&
                        router.push({ pathname: '/task/[id]', params: { id: parentTaskId } })
                      }
                      style={[styles.fchipSoft, { backgroundColor: isDark ? tf.mist : '#F1EDE1' }]}>
                      <Text style={{ fontSize: 11, color: '#5B6A5D', fontWeight: '650' }} numberOfLines={1}>
                        {parentTitle}
                      </Text>
                    </Pressable>
                  ) : null}
                  {relatedTags.length === 0 && !parentTitle ? (
                    <Text style={{ fontSize: 12, color: tf.faint }}>暂无标签或关联主任务</Text>
                  ) : null}
                </View>
              </View>,
            )}

            {rise(
              hasFrog ? 7 : 6,
              <View style={[styles.fcard, styles.extraCard, { backgroundColor: foldCardBg, borderColor: foldCardBorder }]}>
                <View style={styles.sectionHead}>
                  <Text style={[styles.sectionTitle, { color: tf.ink2 }]}>依赖与后续</Text>
                  {linkTasks.length > 0 ? (
                    <Text style={{ fontSize: 11, color: tf.faint, marginLeft: 6 }}>
                      {linkTasks.length} 项
                    </Text>
                  ) : null}
                  <Pressable
                    onPress={() =>
                      taskId &&
                      router.push({ pathname: '/edit-task', params: { id: taskId, from: 'task-detail' } })
                    }
                    hitSlop={8}
                    style={{ marginLeft: 'auto' }}>
                    <Text style={{ fontSize: 11, color: '#6F856B', fontWeight: '600' }}>管理 ›</Text>
                  </Pressable>
                </View>
                {linkTasks.length === 0 ? (
                  <Text style={{ fontSize: 12, color: tf.faint, paddingVertical: 4 }}>
                    无父任务或同级后续任务
                  </Text>
                ) : (
                  linkTasks.map((link, i) => (
                    <Pressable
                      key={`${link.kind}-${link.id}`}
                      onPress={() => router.push({ pathname: '/task/[id]', params: { id: link.id } })}
                      style={[
                        styles.histrow,
                        i === 0 ? { borderTopWidth: 0 } : null,
                      ]}>
                      <Text style={[styles.hi, { color: tf.muted }]}>
                        {link.kind === 'parent' ? '↳' : '→'}
                      </Text>
                      <View style={styles.hc2}>
                        <Text style={[styles.hcTitle, { color: tf.ink2 }]} numberOfLines={1}>
                          {link.title}
                        </Text>
                        <Text style={{ fontSize: 10, color: tf.faint, marginTop: 1 }} numberOfLines={1}>
                          {link.kind === 'parent'
                            ? `父任务 · ${link.progressDone} / ${Math.max(link.progressTotal, 1)} · 完成后本任务才可收尾`
                            : '后续任务 · 等待本任务完成'}
                        </Text>
                      </View>
                      <Text style={{ fontSize: 10, color: '#9DA69D' }}>
                        {formatTaskStatus(link.status)}
                      </Text>
                    </Pressable>
                  ))
                )}
              </View>,
            )}
          </>
        )}
      </ScrollView>

      <View style={[styles.foldFoot, { paddingBottom: footPad }]}>
        <Pressable
          onPress={() =>
            taskId &&
            router.push({ pathname: '/edit-task', params: { id: taskId, from: 'task-detail' } })
          }
          style={({ pressed }) => [
            styles.foldPrimary,
            { backgroundColor: tf.pond, opacity: pressed ? 0.9 : 1 },
          ]}>
          <MaterialIcons name="edit" size={16} color={tf.onPond} />
          <Text style={[styles.foldPrimaryText, { color: tf.onPond }]}>编辑任务</Text>
        </Pressable>
      </View>

      <Modal
        visible={settingPickerType !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setSettingPickerType(null)}>
        <Pressable style={styles.pickerBackdrop} onPress={() => setSettingPickerType(null)}>
          <View
            onStartShouldSetResponder={() => true}
            style={[styles.pickerCard, { backgroundColor: isDark ? tf.paper2 : '#FFFCF5' }]}>
            <Text style={[styles.pickerTitle, { color: tf.ink }]}>{settingPickerTitle}</Text>
            <View style={styles.optionList}>
              {settingPickerOptions.map((option) => {
                const selected = option === settingPickerValue;
                return (
                  <Pressable
                    key={option}
                    style={[
                      styles.optionRow,
                      {
                        borderColor: selected ? tf.frog : tf.line,
                        backgroundColor: selected ? 'rgba(79,124,81,0.1)' : 'transparent',
                      },
                    ]}
                    onPress={() => {
                      const currentMeta = parseTaskMeta(extraData);
                      if (settingPickerType === 'reminder') {
                        const next = option as ReminderOption;
                        setReminderOption(next);
                        const schedule = { ...(currentMeta.schedule ?? {}), reminderOption: next };
                        if (next === '不提前') {
                          delete schedule.reminderHour;
                          delete schedule.reminderMinute;
                        }
                        const nextMeta: TaskMetaExtra = {
                          ...currentMeta,
                          reminder: formatTaskReminderLabel(schedule),
                          schedule,
                        };
                        setExtraData(JSON.stringify(nextMeta));
                      } else {
                        const next = option as RepeatOption;
                        setRepeatOption(next);
                        if (next === '每周' || next === '每月' || next === '每年') {
                          setRepeatDetailVisible(true);
                        } else {
                          const nextMeta = patchMetaWithRepeat(
                            currentMeta,
                            next,
                            weeklyDays,
                            monthlyDays,
                            yearlyDate,
                          );
                          setExtraData(JSON.stringify(nextMeta));
                        }
                      }
                      setSettingPickerType(null);
                    }}>
                    <Text style={[styles.optionText, { color: selected ? tf.frog : tf.ink }]}>
                      {option}
                    </Text>
                    {selected ? <MaterialIcons name="check" size={18} color={tf.frog} /> : null}
                  </Pressable>
                );
              })}
            </View>
          </View>
        </Pressable>
      </Modal>

      <Modal
        visible={repeatDetailVisible}
        transparent
        animationType="fade"
        onRequestClose={() => {
          restoreRepeatFromExtra();
          setRepeatDetailVisible(false);
        }}>
        <Pressable
          style={styles.pickerBackdrop}
          onPress={() => {
            restoreRepeatFromExtra();
            setRepeatDetailVisible(false);
          }}>
          <View
            onStartShouldSetResponder={() => true}
            style={[styles.pickerCard, { backgroundColor: isDark ? tf.paper2 : '#FFFCF5' }]}>
            <Text style={[styles.pickerTitle, { color: tf.ink }]}>
              {repeatOption === '每周'
                ? '选择每周重复日'
                : repeatOption === '每月'
                  ? '选择每月重复日期'
                  : '选择每年重复日期'}
            </Text>
            {repeatOption === '每周' ? (
              <View style={styles.tagWrap}>
                {WEEKDAY_OPTIONS.map((item) => {
                  const active = weeklyDays.includes(item.value);
                  return (
                    <Pressable
                      key={item.value}
                      style={[
                        styles.tagItem,
                        {
                          borderColor: active ? tf.frog : tf.line,
                          backgroundColor: active ? 'rgba(79,124,81,0.1)' : 'transparent',
                        },
                      ]}
                      onPress={() => toggleWeeklyDay(item.value)}>
                      <Text style={[styles.tagItemText, { color: active ? tf.frog : tf.ink }]}>
                        {item.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
            {repeatOption === '每月' ? (
              <View style={styles.tagWrap}>
                {MONTH_DAY_OPTIONS.map((day) => {
                  const active = monthlyDays.includes(day);
                  return (
                    <Pressable
                      key={day}
                      style={[
                        styles.tagItem,
                        {
                          borderColor: active ? tf.frog : tf.line,
                          backgroundColor: active ? 'rgba(79,124,81,0.1)' : 'transparent',
                        },
                      ]}
                      onPress={() => toggleMonthlyDay(day)}>
                      <Text style={[styles.tagItemText, { color: active ? tf.frog : tf.ink }]}>
                        {day}日
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
            {repeatOption === '每年' ? (
              <Pressable
                style={[styles.yearlyDateBtn, { borderColor: tf.line }]}
                onPress={() => setYearlyDatePickerVisible(true)}>
                <Text style={{ fontSize: 14, fontWeight: '650', color: tf.ink }}>
                  {yearlyDate.getMonth() + 1}月{yearlyDate.getDate()}日
                </Text>
                <MaterialIcons name="calendar-month" size={18} color={tf.muted} />
              </Pressable>
            ) : null}
            <View style={styles.pickerActions}>
              <Pressable
                onPress={() => {
                  const currentMeta = parseTaskMeta(extraData);
                  const nextMeta = patchMetaWithRepeat(
                    currentMeta,
                    repeatOption,
                    weeklyDays,
                    monthlyDays,
                    yearlyDate,
                  );
                  setExtraData(JSON.stringify(nextMeta));
                  setRepeatDetailVisible(false);
                }}
                style={[styles.pickerBtn, { backgroundColor: tf.pond }]}>
                <Text style={[styles.pickerBtnText, { color: tf.onPond }]}>完成</Text>
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Modal>

      <Modal
        visible={yearlyDatePickerVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setYearlyDatePickerVisible(false)}>
        <Pressable style={styles.pickerBackdrop} onPress={() => setYearlyDatePickerVisible(false)}>
          <View
            onStartShouldSetResponder={() => true}
            style={[styles.pickerCard, { backgroundColor: isDark ? tf.paper2 : '#FFFCF5' }]}>
            <Text style={[styles.pickerTitle, { color: tf.ink }]}>选择每年日期</Text>
            <DateTimePicker
              value={yearlyDate}
              mode="date"
              display={Platform.OS === 'ios' ? 'inline' : 'spinner'}
              minimumDate={yearlyPickerMinDate}
              maximumDate={yearlyPickerMaxDate}
              onChange={(_, date) => {
                if (!date) return;
                const normalized = new Date(date);
                normalized.setHours(0, 0, 0, 0);
                setYearlyDate(normalized);
              }}
            />
            <View style={styles.pickerActions}>
              <Pressable
                onPress={() => setYearlyDatePickerVisible(false)}
                style={[styles.pickerBtn, { backgroundColor: tf.pond }]}>
                <Text style={[styles.pickerBtnText, { color: tf.onPond }]}>确定</Text>
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Modal>

      <AddSubtaskSheet
        visible={addSubtaskOpen}
        onClose={() => setAddSubtaskOpen(false)}
        onSubmit={createSubtaskFromDraft}
        parentTitle={title}
        parentPriority={priority}
        progressDone={progress.done}
        progressTotal={progress.total}
        scheduleSource={addSubtaskSource}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  appbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  iconbtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  appbarCenter: { flex: 1, minWidth: 0 },
  appbarTitle: { fontSize: 16, fontWeight: '750' },
  appbarSub: { fontSize: 11, marginTop: 1 },
  content: {
    paddingHorizontal: 14,
    paddingTop: 10,
    gap: 8,
    maxWidth: 560,
    width: '100%',
    alignSelf: 'center',
  },
  loadingBox: { paddingVertical: 48, alignItems: 'center' },
  fcard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  /** 对齐设计稿 .extra-card：详情页后半段补充信息块 */
  extraCard: {
    marginTop: 2,
  },
  heroRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  heroTitle: { fontSize: 20, fontWeight: '600', lineHeight: 26 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 8 },
  tag: {
    height: 20,
    paddingHorizontal: 8,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tagText: { fontSize: 10, fontWeight: '700' },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 5,
    marginTop: 8,
  },
  metaText: { fontSize: 11 },
  dot: { width: 3, height: 3, borderRadius: 2 },
  frogRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  frogmark: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  frogTitle: { fontSize: 13, fontWeight: '700' },
  fchipBtn: {
    height: 28,
    paddingHorizontal: 10,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionHead: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  sectionTitle: { fontSize: 13, fontWeight: '750' },
  subhabit: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingVertical: 5,
  },
  cb2: {
    width: 16,
    height: 16,
    borderRadius: 5,
    borderWidth: 1.2,
    marginTop: 1,
  },
  subhabitText: { flex: 1, fontSize: 12, lineHeight: 17, fontWeight: '500' },
  trow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 7,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(232,224,210,0.55)',
  },
  cb: {
    width: 18,
    height: 18,
    borderRadius: 5,
    borderWidth: 1.2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tn: { fontSize: 13, fontWeight: '650', lineHeight: 18 },
  tp: { fontSize: 10, fontWeight: '700' },
  frogleaf: {
    height: 18,
    paddingHorizontal: 5,
    borderRadius: 6,
    backgroundColor: '#E8EFD9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  treefoot: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(232,224,210,0.55)',
  },
  addSub: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  schedCard: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 9 },
  si: {
    width: 26,
    height: 26,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  schedMain: { fontSize: 12, fontWeight: '700' },
  actrow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingVertical: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(232,224,210,0.55)',
  },
  ad: { width: 6, height: 6, borderRadius: 3, marginTop: 5 },
  at: { flex: 1, fontSize: 12, lineHeight: 17 },
  aw: { fontSize: 10, marginTop: 2 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 },
  fchipSoft: {
    height: 24,
    paddingHorizontal: 9,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    maxWidth: '100%',
  },
  histrow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 7,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(232,224,210,0.55)',
  },
  hi: { fontSize: 14, width: 16, textAlign: 'center', fontWeight: '700' },
  hc2: { flex: 1, minWidth: 0 },
  hcTitle: { fontSize: 13, fontWeight: '700' },
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
  pickerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(25,34,28,0.42)',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  pickerCard: { borderRadius: 16, padding: 16, gap: 12 },
  pickerTitle: { fontSize: 16, fontWeight: '700', textAlign: 'center' },
  optionList: { gap: 8 },
  optionRow: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  optionText: { fontSize: 15, fontWeight: '500' },
  tagWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tagItem: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  tagItemText: { fontSize: 14, fontWeight: '500' },
  yearlyDateBtn: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pickerActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
  pickerBtn: {
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    minWidth: 72,
    alignItems: 'center',
  },
  pickerBtnText: { fontSize: 14, fontWeight: '600' },
});
