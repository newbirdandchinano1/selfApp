import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { consumeSchedulePickerResult, normalizeRouteParam, type SchedulePickerResult } from '@/lib/schedule-picker-bridge';
import { getTaskById, getTaskTreeByRootTaskId, updateTask } from '@/lib/repositories/tasks/task';
import type { TaskTreeNode } from '@/lib/repositories/tasks/task';
import { MaterialIcons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { Alert, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

type ReminderOption = '不提前' | '提前1天' | '提前2天' | '提前3天' | '提前7天';
type RepeatOption = '不重复' | '每天' | '每周' | '每月' | '每年';
type SettingPickerType = 'reminder' | 'repeat' | null;
type TaskScheduleMeta = Pick<
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
  return '待办';
}

function formatTaskPriority(priority: number) {
  if (priority >= 4) return '重要且紧急';
  if (priority === 3) return '紧急不重要';
  if (priority === 2) return '不紧急重要';
  if (priority === 1) return '不紧急不重要';
  return '';
}

function getPriorityColor(priority: number, isDark: boolean) {
  if (priority >= 4) return isDark ? '#f87171' : '#ba1a1a';
  if (priority === 3) return isDark ? '#fbbf24' : '#825100';
  if (priority === 2) return isDark ? '#60a5fa' : '#0058be';
  return isDark ? '#94a3b8' : '#727785';
}

function formatDateTimeCN(value: string | null) {
  if (!value) return '';
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const [y, m, d] = trimmed.split('-').map(Number);
    return `${y}年${m}月${d}日`;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  if (hh === '00' && mm === '00') return `${y}年${m}月${d}日`;
  return `${y}年${m}月${d}日 · ${hh}:${mm}`;
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

/** 与 edit-task 一致：优先用 schedule 元数据展示区间/时刻，否则回退 due_date */
function buildScheduleDisplayLabel(schedule: TaskScheduleMeta | null | undefined, dueDate: string | null): string {
  if (schedule?.mode === 'time' && schedule.range?.start && schedule.range?.end) {
    const rangeStart = formatDate(schedule.range.start);
    const rangeEnd = formatDate(schedule.range.end);
    const rangeLabel = rangeStart === rangeEnd ? rangeStart : `${rangeStart} ~ ${rangeEnd}`;
    const timeLabel = schedule.allDay ? '全天' : `${formatTime(schedule.startTime)} - ${formatTime(schedule.endTime)}`;
    return `${rangeLabel} ${timeLabel}`.trim();
  }
  if (schedule?.date) {
    const dateLabel = formatDate(schedule.date);
    const timeLabel = schedule.allDay ? '全天' : schedule.hasExactTime ? formatTime(schedule.startTime) : '';
    return timeLabel ? `${dateLabel} ${timeLabel}` : dateLabel;
  }
  return formatDateTimeCN(dueDate);
}

const REMINDER_OPTIONS: ReminderOption[] = ['不提前', '提前1天', '提前2天', '提前3天', '提前7天'];
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

function formatRepeatSummary(option: RepeatOption, weeklyDays: number[], monthlyDays: number[], yearlyDate: Date): string {
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

function TaskTreeCard({
  node,
  depth = 0,
  rootTaskId,
  accent,
  border,
  surface,
  text,
  muted,
  isDark,
  onPressNode,
}: {
  node: TaskTreeNode;
  depth?: number;
  rootTaskId: string;
  accent: string;
  border: string;
  surface: string;
  text: string;
  muted: string;
  isDark: boolean;
  onPressNode: (taskId: string) => void;
}) {
  const isDone = node.status === 'done' || node.status === 'cancelled';
  const canNavigate = node.id !== rootTaskId;
  const isCurrentTask = node.id === rootTaskId;
  const nodePriorityColor = getPriorityColor(node.priority, isDark);
  return (
    <View style={{ marginTop: 10, marginLeft: depth * 14 }}>
      <Pressable
        onPress={() => {
          if (!canNavigate) return;
          onPressNode(node.id);
        }}
        style={[
          styles.treeItem,
          {
            backgroundColor: surface,
            borderColor: isCurrentTask ? `${nodePriorityColor}88` : border,
            opacity: node.status === 'blocked' ? 0.6 : canNavigate ? 1 : 0.92,
          },
        ]}>
        <View style={{ marginTop: 2 }}>
          <MaterialIcons
            name={isDone ? 'check-circle' : node.status === 'blocked' ? 'lock' : 'radio-button-unchecked'}
            size={20}
            color={isDone ? '#16a34a' : node.status === 'blocked' ? muted : nodePriorityColor}
          />
        </View>
        <View style={{ flex: 1 }}>
          <View style={styles.treeTitleRow}>
            <Text
              style={[
                styles.treeTitle,
                {
                  color: isDone ? muted : text,
                  textDecorationLine: isDone ? 'line-through' : 'none',
                },
              ]}
              numberOfLines={2}>
              {node.title}
            </Text>
            {isCurrentTask ? (
              <View style={[styles.currentTaskTag, { backgroundColor: `${nodePriorityColor}1A`, borderColor: `${nodePriorityColor}55` }]}>
                <Text style={[styles.currentTaskTagText, { color: nodePriorityColor }]}>当前任务</Text>
              </View>
            ) : null}
          </View>
          <Text style={[styles.treeMeta, { color: muted }]}>
            优先级 {node.priority} · {formatTaskStatus(node.status)}
          </Text>
        </View>
      </Pressable>

      {node.children.length > 0 ? (
        <View
          style={[
            styles.treeChildrenWrap,
            {
              borderLeftColor: isDark ? 'rgba(148,163,184,0.20)' : 'rgba(194,198,214,0.55)',
            },
          ]}>
          {node.children.map((child) => (
            <TaskTreeCard
              key={child.id}
              node={child}
              depth={0}
              rootTaskId={rootTaskId}
              accent={accent}
              border={border}
              surface={surface}
              text={text}
              muted={muted}
              isDark={isDark}
              onPressNode={onPressNode}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

export default function TaskDetailScreen() {
  const { id: idParam } = useLocalSearchParams<{ id?: string | string[] }>();
  const taskId = normalizeRouteParam(idParam);
  const router = useRouter();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';

  const [title, setTitle] = React.useState('');
  const [note, setNote] = React.useState('');
  const [status, setStatus] = React.useState('todo');
  const [priority, setPriority] = React.useState<number>(0);
  const [dueDate, setDueDate] = React.useState<string | null>(null);
  const [extraData, setExtraData] = React.useState<string | null>(null);
  const [tree, setTree] = React.useState<TaskTreeNode | null>(null);
  const [settingPickerType, setSettingPickerType] = React.useState<SettingPickerType>(null);
  const [repeatDetailVisible, setRepeatDetailVisible] = React.useState(false);
  const [reminderOption, setReminderOption] = React.useState<ReminderOption>('不提前');
  const [repeatOption, setRepeatOption] = React.useState<RepeatOption>('不重复');
  const [weeklyDays, setWeeklyDays] = React.useState<number[]>([1]);
  const [monthlyDays, setMonthlyDays] = React.useState<number[]>([1]);
  const [yearlyDate, setYearlyDate] = React.useState<Date>(new Date());
  const [yearlyDatePickerVisible, setYearlyDatePickerVisible] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  const scheduleSource = React.useMemo(() => `task-detail-${taskId || 'unknown'}`, [taskId]);
  const extraDataRef = React.useRef<string | null>(null);
  extraDataRef.current = extraData;

  const applySchedulePick = React.useCallback((picked: SchedulePickerResult, baseExtraRaw: string | null) => {
    const currentMeta = parseTaskMeta(baseExtraRaw);
    const scheduleMeta: TaskScheduleMeta = {
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
    };
    const nextMeta: TaskMetaExtra = {
      ...currentMeta,
      reminder: picked.reminderOption === '不提前' ? '' : picked.reminderOption,
      repeat: picked.repeatOption === '不重复' ? '' : picked.repeatSummary,
      schedule: scheduleMeta,
    };

    setDueDate(dueDateFromSchedulePick(picked));
    setExtraData(JSON.stringify(nextMeta));
    setReminderOption(picked.reminderOption);
    setRepeatOption(picked.repeatOption);
  }, []);

  const readScheduleResult = React.useCallback(() => {
    const picked = consumeSchedulePickerResult(scheduleSource);
    if (!picked) return;
    applySchedulePick(picked, extraDataRef.current);
  }, [applySchedulePick, scheduleSource]);

  const loadTaskDetail = React.useCallback(async () => {
    if (!taskId) return;
    const row = await getTaskById(taskId);
    if (row) {
      setTitle(row.title);
      setNote(row.note ?? '');
      setStatus(row.status);
      setPriority(row.priority ?? 0);
      setDueDate(row.due_date ?? null);
      setExtraData(row.extra_data ?? null);
      const parsed = parseTaskMeta(row.extra_data ?? null);
      const reminder = (typeof parsed.reminder === 'string' ? parsed.reminder : '') as ReminderOption | '';
      const repeat = (typeof parsed.repeat === 'string' ? parsed.repeat : '') as RepeatOption | '';
      setReminderOption(reminder && REMINDER_OPTIONS.includes(reminder as ReminderOption) ? (reminder as ReminderOption) : '不提前');
      setRepeatOption(repeat && REPEAT_OPTIONS.includes(repeat as RepeatOption) ? (repeat as RepeatOption) : '不重复');
    } else {
      setTitle('');
      setNote('');
      setStatus('todo');
      setPriority(0);
      setDueDate(null);
      setExtraData(null);
    }
    const t = await getTaskTreeByRootTaskId(taskId);
    setTree(t);
  }, [taskId]);

  React.useEffect(() => {
    loadTaskDetail().catch((e) => console.warn('加载任务详情失败', e));
  }, [loadTaskDetail]);

  React.useEffect(() => {
    readScheduleResult();
  }, [readScheduleResult]);

  useFocusEffect(
    React.useCallback(() => {
      readScheduleResult();
    }, [readScheduleResult])
  );

  const handleSave = React.useCallback(async () => {
    if (!taskId || saving) return;
    try {
      setSaving(true);
      await updateTask(taskId, {
        due_date: dueDate,
        extra_data: extraData ?? null,
      });
      router.replace('/(tabs)/tasks');
    } catch (error) {
      console.warn('保存任务详情失败', error);
      Alert.alert('保存失败', '未能保存任务设置，请稍后重试。');
    } finally {
      setSaving(false);
    }
  }, [dueDate, extraData, router, saving, taskId]);

  const bg = isDark ? theme.background : '#faf8ff';
  const surface = isDark ? 'rgba(30, 41, 59, 0.70)' : '#ffffff';
  const surfaceLow = isDark ? 'rgba(15, 23, 42, 0.55)' : '#f2f3ff';
  const border = isDark ? 'rgba(148,163,184,0.18)' : 'rgba(194,198,214,0.55)';
  const outline = isDark ? 'rgba(148,163,184,0.7)' : '#727785';
  const primary = isDark ? '#60a5fa' : '#0058be';
  const secondary = isDark ? '#34d399' : '#006c49';
  const error = isDark ? '#f87171' : '#ba1a1a';

  const meta = React.useMemo(() => parseTaskMeta(extraData), [extraData]);
  const statusLabel = formatTaskStatus(status);
  const priorityLabel = formatTaskPriority(priority);
  const dueLabel = React.useMemo(
    () => buildScheduleDisplayLabel(meta.schedule, dueDate),
    [dueDate, meta.schedule],
  );
  const priorityColor = getPriorityColor(priority, isDark);
  const repeatSummary = React.useMemo(
    () => (repeatOption === '不重复' ? '不重复' : formatRepeatSummary(repeatOption, weeklyDays, monthlyDays, yearlyDate)),
    [monthlyDays, repeatOption, weeklyDays, yearlyDate]
  );
  const settingPickerTitle = settingPickerType === 'reminder' ? '提醒设置' : '重复设置';
  const settingPickerOptions = settingPickerType === 'reminder' ? REMINDER_OPTIONS : REPEAT_OPTIONS;
  const settingPickerValue = settingPickerType === 'reminder' ? reminderOption : repeatOption;

  const toggleWeeklyDay = (day: number) => {
    setWeeklyDays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]));
  };

  const toggleMonthlyDay = (day: number) => {
    setMonthlyDays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]));
  };
  const yearlyPickerMinDate = React.useMemo(() => new Date(yearlyDate.getFullYear() - 100, 0, 1), [yearlyDate]);
  const yearlyPickerMaxDate = React.useMemo(() => new Date(yearlyDate.getFullYear() + 100, 11, 31), [yearlyDate]);

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

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: bg }]} edges={['top']}>
      <View style={[styles.topBar, { backgroundColor: isDark ? 'rgba(15,23,42,0.75)' : 'rgba(250,248,255,0.86)', borderBottomColor: border }]}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.7 }]}>
          <MaterialIcons name="arrow-back" size={22} color={primary} />
        </Pressable>
        <Text style={[styles.topTitle, { color: theme.text }]}>任务详情</Text>
        <Pressable
          onPress={handleSave}
          hitSlop={10}
          style={({ pressed }) => [styles.saveBtn, { borderColor: `${primary}33` }, pressed && { opacity: 0.75 }]}>
          <Text style={[styles.saveBtnText, { color: primary }]}>{saving ? '保存中' : '保存'}</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: 140 }]} showsVerticalScrollIndicator={false}>
        <View style={styles.section}>
          <Text style={[styles.headline, { color: theme.text }]} numberOfLines={3}>
            {title || '未找到任务'}
          </Text>

          <View style={styles.badgeRow}>
            <View style={[styles.badge, { backgroundColor: isDark ? 'rgba(148,163,184,0.14)' : '#e2e7ff' }]}>
              <View style={[styles.badgeDot, { backgroundColor: status === 'done' ? secondary : primary }]} />
              <Text style={[styles.badgeText, { color: primary }]}>{statusLabel}</Text>
            </View>
            {!!priorityLabel && (
              <View style={[styles.badge, { backgroundColor: `${priorityColor}1A` }]}>
                <MaterialIcons name="warning" size={14} color={priorityColor} />
                <Text style={[styles.badgeText, { color: priorityColor }]}>{priorityLabel}</Text>
              </View>
            )}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: outline }]}>背景与备注</Text>
          <View style={[styles.noteCard, { backgroundColor: surfaceLow, borderColor: border }]}>
            <View style={[styles.noteAccent, { backgroundColor: primary }]} />
            <Text style={[styles.noteText, { color: theme.textSecondary }]}>
              {note?.trim() ? note.trim() : '暂无备注'}
            </Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: outline }]}>执行树</Text>
          {tree ? (
            <View style={{ marginTop: 4 }}>
              <TaskTreeCard
                node={tree}
                rootTaskId={taskId}
                accent={primary}
                border={border}
                surface={surface}
                text={theme.text}
                muted={outline}
                isDark={isDark}
                onPressNode={(taskId) => router.push({ pathname: '/task/[id]', params: { id: taskId } })}
              />
            </View>
          ) : (
            <View style={[styles.noteCard, { backgroundColor: surfaceLow, borderColor: border }]}>
              <Text style={[styles.noteText, { color: theme.textSecondary }]}>暂无子任务</Text>
            </View>
          )}
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: outline }]}>配置</Text>

          <Pressable
            onPress={openSchedulePicker}
            style={[styles.configCard, { backgroundColor: surface, borderColor: border }]}>
            <View style={[styles.configIcon, { backgroundColor: `${primary}18` }]}>
              <MaterialIcons name="calendar-today" size={18} color={primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.configTitle, { color: theme.text }]}>截止日期</Text>
              <Text style={[styles.configSub, { color: theme.textSecondary }]}>{dueLabel || '未设置'}</Text>
            </View>
            <MaterialIcons name="chevron-right" size={20} color={isDark ? 'rgba(148,163,184,0.45)' : 'rgba(194,198,214,0.9)'} />
          </Pressable>

          <Pressable
            onPress={() => setSettingPickerType('reminder')}
            style={[styles.configCard, { backgroundColor: surface, borderColor: border }]}>
            <View style={[styles.configIcon, { backgroundColor: `${secondary}18` }]}>
              <MaterialIcons name="notifications-active" size={18} color={secondary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.configTitle, { color: theme.text }]}>提醒</Text>
              <Text style={[styles.configSub, { color: meta.reminder ? primary : theme.textSecondary }]}>{meta.reminder?.trim() || reminderOption || '未设置'}</Text>
            </View>
            <MaterialIcons name="chevron-right" size={20} color={isDark ? 'rgba(148,163,184,0.45)' : 'rgba(194,198,214,0.9)'} />
          </Pressable>

          <Pressable
            onPress={() => setSettingPickerType('repeat')}
            style={[styles.configCard, { backgroundColor: surface, borderColor: border }]}>
            <View style={[styles.configIcon, { backgroundColor: isDark ? 'rgba(148,163,184,0.12)' : '#e2e7ff' }]}>
              <MaterialIcons name="cycle" size={18} color={outline} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.configTitle, { color: theme.text }]}>重复</Text>
              <Text style={[styles.configSub, { color: theme.textSecondary }]}>{meta.repeat?.trim() || repeatSummary}</Text>
            </View>
            <MaterialIcons name="chevron-right" size={20} color={isDark ? 'rgba(148,163,184,0.45)' : 'rgba(194,198,214,0.9)'} />
          </Pressable>
        </View>
      </ScrollView>

      <View pointerEvents="box-none" style={styles.bottomBar}>
        <View style={[styles.bottomFade, { backgroundColor: isDark ? 'rgba(15,23,42,0.92)' : 'rgba(250,248,255,0.95)' }]} />
        <Pressable
          onPress={() =>
            taskId &&
            router.push({ pathname: '/edit-task', params: { id: taskId, from: 'task-detail' } })
          }
          style={({ pressed }) => [
            styles.editBtn,
            { backgroundColor: primary, shadowColor: primary },
            pressed && { opacity: 0.9, transform: [{ scale: 0.985 }] },
          ]}>
          <MaterialIcons name="edit" size={18} color="#fff" />
          <Text style={styles.editBtnText}>编辑任务</Text>
        </Pressable>
      </View>

      <Modal visible={settingPickerType !== null} transparent animationType="fade" onRequestClose={() => setSettingPickerType(null)}>
        <View style={styles.pickerBackdrop}>
          <View style={[styles.pickerCard, { backgroundColor: isDark ? 'rgba(15,23,42,0.96)' : '#fff' }]}>
            <Text style={[styles.pickerTitle, { color: theme.text }]}>{settingPickerTitle}</Text>
            <View style={styles.optionList}>
              {settingPickerOptions.map((option) => {
                const selected = option === settingPickerValue;
                return (
                  <Pressable
                    key={option}
                    style={[styles.optionRow, { borderColor: selected ? '#006c49' : border, backgroundColor: selected ? 'rgba(0,108,73,0.1)' : 'transparent' }]}
                    onPress={async () => {
                      const currentMeta = parseTaskMeta(extraData);
                      if (settingPickerType === 'reminder') {
                        const next = option as ReminderOption;
                        setReminderOption(next);
                        const nextMeta: TaskMetaExtra = { ...currentMeta, reminder: next === '不提前' ? '' : next };
                        setExtraData(JSON.stringify(nextMeta));
                      } else {
                        const next = option as RepeatOption;
                        setRepeatOption(next);
                        if (next === '每周' || next === '每月' || next === '每年') {
                          setRepeatDetailVisible(true);
                        } else {
                          const nextMeta: TaskMetaExtra = { ...currentMeta, repeat: next === '不重复' ? '' : next };
                          setExtraData(JSON.stringify(nextMeta));
                        }
                      }
                      setSettingPickerType(null);
                    }}>
                    <Text style={[styles.optionText, { color: selected ? '#006c49' : theme.text }]}>{option}</Text>
                    {selected ? <MaterialIcons name="check" size={18} color="#006c49" /> : null}
                  </Pressable>
                );
              })}
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={repeatDetailVisible} transparent animationType="fade" onRequestClose={() => setRepeatDetailVisible(false)}>
        <View style={styles.pickerBackdrop}>
          <View style={[styles.pickerCard, { backgroundColor: isDark ? 'rgba(15,23,42,0.96)' : '#fff' }]}>
            <Text style={[styles.pickerTitle, { color: theme.text }]}>
              {repeatOption === '每周' ? '选择每周重复日' : repeatOption === '每月' ? '选择每月重复日期' : '选择每年重复日期'}
            </Text>
            {repeatOption === '每周' ? (
              <View style={styles.tagWrap}>
                {WEEKDAY_OPTIONS.map((item) => {
                  const active = weeklyDays.includes(item.value);
                  return (
                    <Pressable
                      key={item.value}
                      style={[styles.tagItem, { borderColor: active ? '#006c49' : border, backgroundColor: active ? 'rgba(0,108,73,0.1)' : 'transparent' }]}
                      onPress={() => toggleWeeklyDay(item.value)}>
                      <Text style={[styles.tagText, { color: active ? '#006c49' : theme.text }]}>{item.label}</Text>
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
                      style={[styles.tagItem, { borderColor: active ? '#006c49' : border, backgroundColor: active ? 'rgba(0,108,73,0.1)' : 'transparent' }]}
                      onPress={() => toggleMonthlyDay(day)}>
                      <Text style={[styles.tagText, { color: active ? '#006c49' : theme.text }]}>{day}日</Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
            {repeatOption === '每年' ? (
              <Pressable style={[styles.yearlyDateBtn, { borderColor: border }]} onPress={() => setYearlyDatePickerVisible(true)}>
                <Text style={[styles.configTitle, { color: theme.text }]}>
                  {yearlyDate.getMonth() + 1}月{yearlyDate.getDate()}日
                </Text>
                <MaterialIcons name="calendar-month" size={18} color={outline} />
              </Pressable>
            ) : null}
            <View style={styles.pickerActions}>
              <Pressable
                onPress={() => {
                  const currentMeta = parseTaskMeta(extraData);
                  const repeatValue = repeatOption === '不重复' ? '' : formatRepeatSummary(repeatOption, weeklyDays, monthlyDays, yearlyDate);
                  const nextMeta: TaskMetaExtra = { ...currentMeta, repeat: repeatValue };
                  setExtraData(JSON.stringify(nextMeta));
                  setRepeatDetailVisible(false);
                }}
                style={[styles.pickerBtn, { backgroundColor: '#006c49' }]}>
                <Text style={[styles.pickerBtnText, { color: '#fff' }]}>完成</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
      <Modal visible={yearlyDatePickerVisible} transparent animationType="fade" onRequestClose={() => setYearlyDatePickerVisible(false)}>
        <View style={styles.pickerBackdrop}>
          <View style={[styles.pickerCard, { backgroundColor: isDark ? 'rgba(15,23,42,0.96)' : '#fff' }]}>
            <Text style={[styles.pickerTitle, { color: theme.text }]}>选择每年日期</Text>
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
              <Pressable onPress={() => setYearlyDatePickerVisible(false)} style={[styles.pickerBtn, { backgroundColor: '#006c49' }]}>
                <Text style={[styles.pickerBtnText, { color: '#fff' }]}>确定</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: {
    height: 56,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topTitle: {
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  saveBtn: {
    minWidth: 48,
    height: 34,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    borderWidth: 1,
  },
  saveBtnText: { fontSize: 13, fontWeight: '800' },
  content: { paddingHorizontal: 18, paddingTop: 18, gap: 22 },
  section: { gap: 12 },
  headline: {
    fontSize: 34,
    fontWeight: '900',
    letterSpacing: -0.5,
    lineHeight: 40,
  },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 10,
  },
  badgeDot: { width: 6, height: 6, borderRadius: 3 },
  badgeText: { fontSize: 10, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase' },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    marginLeft: 2,
  },
  noteCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    overflow: 'hidden',
  },
  noteAccent: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
  },
  noteText: { fontSize: 13, lineHeight: 19, fontWeight: '600' },
  treeItem: {
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 12,
    flexDirection: 'row',
    gap: 10,
  },
  treeTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  treeTitle: { fontSize: 13, fontWeight: '800', lineHeight: 18 },
  currentTaskTag: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    flexShrink: 0,
  },
  currentTaskTagText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.4 },
  treeMeta: { fontSize: 10, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase', marginTop: 3 },
  treeChildrenWrap: { marginLeft: 18, paddingLeft: 14, borderLeftWidth: 2, marginTop: 8 },
  configCard: {
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  configIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  configTitle: { fontSize: 13, fontWeight: '800' },
  configSub: { fontSize: 11, fontWeight: '700', marginTop: 4 },
  pickerBackdrop: { flex: 1, backgroundColor: 'rgba(2,6,23,0.4)', justifyContent: 'center', paddingHorizontal: 24 },
  pickerCard: { borderRadius: 16, padding: 16, gap: 12 },
  pickerTitle: { fontSize: 16, fontWeight: '700', textAlign: 'center' },
  optionList: { gap: 8 },
  optionRow: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  optionText: { fontSize: 15, fontWeight: '500' },
  tagWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tagItem: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  tagText: { fontSize: 14, fontWeight: '500' },
  yearlyDateBtn: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pickerActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
  pickerBtn: { borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10, minWidth: 72, alignItems: 'center' },
  pickerBtnText: { fontSize: 14, fontWeight: '600' },
  bottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 18,
    paddingBottom: 18,
    paddingTop: 10,
  },
  bottomFade: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.94,
  },
  editBtn: {
    height: 54,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.22,
    shadowRadius: 20,
    elevation: 6,
  },
  editBtnText: { color: '#fff', fontSize: 16, fontWeight: '800' },
});