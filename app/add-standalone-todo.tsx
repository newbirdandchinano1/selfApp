import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { createTask } from '@/lib/repositories/tasks/task';
import type { TaskPriority } from '@/lib/repositories/tasks/task.types';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import React from 'react';
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

/** 与 schedule-picker 约定的 source，避免与其它页面日程回传冲突 */
const SCHEDULE_SOURCE = 'add-standalone-todo';

const MAX_TITLE_LEN = 50;

type PriorityKey = 'urgent-important' | 'urgent-not-important' | 'not-urgent-important' | 'not-urgent-not-important';

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

function extractDueDateFromDeadlineText(deadlineText: string) {
  const all = deadlineText.match(/\d{4}-\d{2}-\d{2}/g);
  if (!all?.length) return null;
  return all[all.length - 1] ?? null;
}

/** 与任务库 priority 字段及 add-task 中文标签规则保持一致 */
function labelToTaskPriority(label: string): TaskPriority {
  const text = label.toLowerCase();
  if (text.includes('紧急重要')) return 4;
  if (text.includes('紧急不重要')) return 3;
  if (text.includes('不紧急重要')) return 2;
  if (text.includes('不紧急不重要')) return 1;
  return 0;
}

/**
 * 无项目待办的独立新建页：布局与「添加任务」页区分，但落库字段与日程选择器协议相同。
 */
export default function AddStandaloneTodoScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';

  const [title, setTitle] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [priority, setPriority] = React.useState<PriorityKey>('urgent-important');
  const [deadlineText, setDeadlineText] = React.useState('');
  const [reminderText, setReminderText] = React.useState('');
  const [repeatText, setRepeatText] = React.useState('');
  const [scheduleMeta, setScheduleMeta] = React.useState<TaskScheduleMeta | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const outline = isDark ? 'rgba(148,163,184,0.72)' : 'rgba(114,119,133,0.85)';
  const outlineSoft = isDark ? 'rgba(148,163,184,0.35)' : 'rgba(194,198,214,0.55)';
  const surface = isDark ? 'rgba(30,41,59,0.55)' : '#f4f6fb';
  const surfaceDeep = isDark ? 'rgba(15,23,42,0.92)' : '#ffffff';
  /** 本页主色：青绿系，与「添加任务」的蓝主色区分 */
  const accent = isDark ? '#2dd4bf' : '#0d9488';
  const accentMuted = isDark ? 'rgba(45,212,191,0.18)' : 'rgba(13,148,136,0.12)';

  const priorityChips: Array<{ key: PriorityKey; label: string; hint: string; dot: string }> = [
    { key: 'urgent-important', label: '紧急重要', hint: '先做', dot: isDark ? '#f87171' : '#b91c1c' },
    { key: 'urgent-not-important', label: '紧急不重要', hint: '速办', dot: isDark ? '#fbbf24' : '#a16207' },
    { key: 'not-urgent-important', label: '不紧急重要', hint: '规划', dot: isDark ? '#60a5fa' : '#1d4ed8' },
    { key: 'not-urgent-not-important', label: '不紧急不重要', hint: '抽空', dot: isDark ? '#94a3b8' : '#64748b' },
  ];

  const readScheduleResult = React.useCallback(() => {
    const picked = globalThis.__schedulePickerResult as SchedulePickerResult | undefined;
    if (!picked || picked.source !== SCHEDULE_SOURCE) return;

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
  }, []);

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
        source: SCHEDULE_SOURCE,
        initial: scheduleInit ? JSON.stringify(scheduleInit) : '',
        dateLimit: '',
      },
    });
  }, [router, scheduleMeta]);

  React.useEffect(() => {
    readScheduleResult();
  }, [readScheduleResult]);

  useFocusEffect(
    React.useCallback(() => {
      readScheduleResult();
    }, [readScheduleResult])
  );

  const currentPriorityLabel = priorityChips.find((c) => c.key === priority)?.label ?? '紧急重要';

  const handleSave = async () => {
    const trimmed = title.trim();
    if (!trimmed) {
      Alert.alert('无法保存', '请先填写待办标题。');
      return;
    }
    try {
      setSubmitting(true);
      const id = `tsk_${Date.now()}_${Math.random().toString(16).slice(2)}`;
      await createTask({
        id,
        project_id: null,
        category_id: null,
        parent_task_id: null,
        title: trimmed,
        note: notes.trim() || null,
        status: 'todo',
        priority: labelToTaskPriority(currentPriorityLabel),
        due_date: extractDueDateFromDeadlineText(deadlineText) ?? null,
        extra_data: JSON.stringify({
          reminder: reminderText || '',
          repeat: repeatText || '',
          schedule: scheduleMeta,
        }),
      });
      router.back();
    } catch (e) {
      console.warn('保存待办失败', e);
      Alert.alert('保存失败', '请稍后重试。');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: theme.background }]} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}>
        {/* 顶栏：与「添加任务」的绝对大标题不同，采用紧凑行内布局 */}
        <View style={[styles.topBar, { borderBottomColor: outlineSoft }]}>
          <Pressable onPress={() => router.back()} hitSlop={12} style={({ pressed }) => [styles.topIcon, pressed && { opacity: 0.7 }]}>
            <MaterialIcons name="arrow-back" size={22} color={accent} />
          </Pressable>
          <View style={styles.topTitleBlock}>
            <Text style={[styles.topTitle, { color: theme.text }]}>新建待办</Text>
            <Text style={[styles.topSubtitle, { color: outline }]}>不挂项目 · 仍可与日程、提醒同步</Text>
          </View>
          <View style={styles.topIcon} />
        </View>

        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingBottom: 120 + Math.max(insets.bottom, 8) }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          {/* 主卡片：左侧色条 + 分区，视觉上与 add-task 的「多段 uppercase 标签」区分 */}
          <View style={[styles.heroCard, { backgroundColor: surfaceDeep, borderColor: outlineSoft }]}>
            <View style={[styles.heroRail, { backgroundColor: accent }]} />

            <View style={styles.heroBody}>
              <Text style={[styles.blockCaption, { color: outline }]}>待办标题</Text>
              <TextInput
                value={title}
                onChangeText={(t) => setTitle(t.slice(0, MAX_TITLE_LEN))}
                placeholder="用一句话写清楚要做什么…"
                placeholderTextColor={outline}
                maxLength={MAX_TITLE_LEN}
                multiline
                style={[styles.titleField, { color: theme.text }]}
              />
              <Text style={[styles.counter, { color: outline }]}>
                {title.length}/{MAX_TITLE_LEN}
              </Text>

              <Text style={[styles.blockCaption, { color: outline, marginTop: 6 }]}>重要程度</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
                {priorityChips.map((chip) => {
                  const active = chip.key === priority;
                  return (
                    <Pressable
                      key={chip.key}
                      onPress={() => setPriority(chip.key)}
                      style={({ pressed }) => [
                        styles.chip,
                        {
                          borderColor: active ? chip.dot : outlineSoft,
                          backgroundColor: active ? `${chip.dot}18` : surface,
                        },
                        pressed && { opacity: 0.88 },
                      ]}>
                      <View style={[styles.chipDot, { backgroundColor: chip.dot }]} />
                      <View>
                        <Text style={[styles.chipLabel, { color: theme.text }]}>{chip.label}</Text>
                        <Text style={[styles.chipHint, { color: outline }]}>{chip.hint}</Text>
                      </View>
                    </Pressable>
                  );
                })}
              </ScrollView>

              <Text style={[styles.blockCaption, { color: outline, marginTop: 10 }]}>时间安排</Text>
              <Pressable
                onPress={openSchedulePicker}
                style={({ pressed }) => [
                  styles.scheduleCard,
                  {
                    borderColor: outlineSoft,
                    backgroundColor: surface,
                    opacity: pressed ? 0.92 : 1,
                  },
                ]}>
                <View style={[styles.scheduleIconWrap, { backgroundColor: accentMuted }]}>
                  <MaterialIcons name="schedule" size={26} color={accent} />
                </View>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={[styles.schedulePrimary, { color: theme.text }]}>{deadlineText || '点按设置日期、时间与重复'}</Text>
                  {(reminderText || repeatText) && (
                    <View style={styles.scheduleMetaRow}>
                      {!!reminderText && (
                        <View style={[styles.miniTag, { borderColor: outlineSoft }]}>
                          <MaterialIcons name="notifications-active" size={12} color={accent} />
                          <Text style={[styles.miniTagText, { color: outline }]} numberOfLines={1}>
                            {reminderText}
                          </Text>
                        </View>
                      )}
                      {!!repeatText && (
                        <View style={[styles.miniTag, { borderColor: outlineSoft }]}>
                          <MaterialIcons name="repeat" size={12} color={accent} />
                          <Text style={[styles.miniTagText, { color: outline }]} numberOfLines={1}>
                            {repeatText}
                          </Text>
                        </View>
                      )}
                    </View>
                  )}
                </View>
                <MaterialIcons name="chevron-right" size={22} color={outline} />
              </Pressable>

              <Text style={[styles.blockCaption, { color: outline, marginTop: 10 }]}>备忘 / 上下文</Text>
              <View style={[styles.notesShell, { borderColor: outlineSoft, backgroundColor: surface }]}>
                <TextInput
                  value={notes}
                  onChangeText={setNotes}
                  placeholder="可选：补充背景、链接、相关人…"
                  placeholderTextColor={outline}
                  multiline
                  style={[styles.notesInput, { color: theme.text }]}
                />
              </View>
            </View>
          </View>
        </ScrollView>

        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12), borderTopColor: outlineSoft }]}>
          <Pressable
            onPress={() => void handleSave()}
            disabled={submitting}
            style={({ pressed }) => [
              styles.saveBtn,
              { backgroundColor: accent, opacity: submitting ? 0.65 : pressed ? 0.9 : 1 },
            ]}>
            <MaterialIcons name="bookmark-add" size={22} color="#fff" />
            <Text style={styles.saveBtnText}>{submitting ? '保存中…' : '保存到待办列表'}</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  topIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  topTitleBlock: { flex: 1, alignItems: 'center' },
  topTitle: { fontSize: 17, fontWeight: '800' },
  topSubtitle: { fontSize: 11, fontWeight: '600', marginTop: 2 },
  scrollContent: { paddingHorizontal: 16, paddingTop: 16, gap: 14 },
  heroCard: {
    flexDirection: 'row',
    borderRadius: 22,
    borderWidth: 1,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 3,
  },
  heroRail: { width: 5 },
  heroBody: { flex: 1, paddingVertical: 16, paddingRight: 16, paddingLeft: 12, gap: 8 },
  blockCaption: { fontSize: 12, fontWeight: '700' },
  titleField: {
    fontSize: 20,
    fontWeight: '800',
    lineHeight: 26,
    minHeight: 52,
    paddingVertical: 4,
  },
  counter: { fontSize: 11, fontWeight: '600', alignSelf: 'flex-end' },
  chipRow: { flexDirection: 'row', gap: 10, paddingVertical: 4 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 14,
    borderWidth: 1.5,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  chipDot: { width: 8, height: 8, borderRadius: 4 },
  chipLabel: { fontSize: 12, fontWeight: '800' },
  chipHint: { fontSize: 10, fontWeight: '600', marginTop: 1 },
  scheduleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 16,
    borderWidth: 1,
    padding: 12,
  },
  scheduleIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  schedulePrimary: { fontSize: 15, fontWeight: '700', lineHeight: 20 },
  scheduleMetaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  miniTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    maxWidth: '100%',
  },
  miniTagText: { fontSize: 11, fontWeight: '600', flexShrink: 1 },
  notesShell: {
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 100,
  },
  notesInput: { fontSize: 14, fontWeight: '500', lineHeight: 20, minHeight: 88, textAlignVertical: 'top' },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    backgroundColor: 'transparent',
  },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    borderRadius: 999,
    paddingVertical: 15,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 6,
  },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '800' },
});
