import { AppButton } from '@/components/ui';
import { ScreenHeader } from '@/components/ui/screen-header';
import { Layout, Radius, Shadows, Spacing, Typography } from '@/constants/design-tokens';
import { useAppTheme } from '@/hooks/use-app-theme';
import { consumeSchedulePickerResult } from '@/lib/schedule-picker-bridge';
import { formatTaskReminderLabel } from '@/lib/task-reminder-schedule';
import { createTask } from '@/lib/repositories/tasks/task';
import type { TaskPriority } from '@/lib/repositories/tasks/task.types';
import { getDayBoundarySync, getLogicalLocalYmd } from '@/lib/tasks-logical-day';
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

function SectionCaption({ children }: { children: string }) {
  const { colors } = useAppTheme();
  return <Text style={[Typography.caption, styles.blockCaption, { color: colors.textSecondary }]}>{children}</Text>;
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

function extractDueDateFromDeadlineText(deadlineText: string) {
  const all = deadlineText.match(/\d{4}-\d{2}-\d{2}/g);
  if (!all?.length) return null;
  return all[all.length - 1] ?? null;
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
  const { colors, shadows } = useAppTheme();

  const [title, setTitle] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [priority, setPriority] = React.useState<PriorityKey>('not-urgent-not-important');
  const [deadlineText, setDeadlineText] = React.useState('');
  const [reminderText, setReminderText] = React.useState('');
  const [repeatText, setRepeatText] = React.useState('');
  const [scheduleMeta, setScheduleMeta] = React.useState<TaskScheduleMeta | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const priorityChips: Array<{ key: PriorityKey; label: string; hint: string; dot: string }> = [
    { key: 'urgent-important', label: '紧急重要', hint: '先做', dot: colors.danger },
    { key: 'urgent-not-important', label: '紧急不重要', hint: '速办', dot: colors.tertiary },
    { key: 'not-urgent-important', label: '不紧急重要', hint: '规划', dot: colors.primary },
    { key: 'not-urgent-not-important', label: '不紧急不重要', hint: '抽空', dot: colors.textMuted },
  ];

  const readScheduleResult = React.useCallback(() => {
    const picked = consumeSchedulePickerResult(SCHEDULE_SOURCE);
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
    if (isDueYmdToday(extractDueYmdFromSchedulePick(picked))) {
      setPriority('urgent-important');
    }
  }, []);

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
    }, [readScheduleResult]),
  );

  const currentPriorityLabel = priorityChips.find((c) => c.key === priority)?.label ?? '不紧急不重要';

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
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]} edges={['left', 'right', 'bottom']}>
      <ScreenHeader title="新建待办" subtitle="不挂项目 · 仍可与日程、提醒同步" onBack={() => router.back()} />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}>
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: Spacing['7xl'] + 72 + Math.max(insets.bottom, 0) },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <View style={[styles.heroCard, shadows.card, { backgroundColor: colors.surface, borderColor: colors.outline }]}>
            <View style={[styles.heroRail, { backgroundColor: colors.primary }]} />

            <View style={styles.heroBody}>
              <SectionCaption>待办标题</SectionCaption>
              <TextInput
                value={title}
                onChangeText={(t) => setTitle(t.slice(0, MAX_TITLE_LEN))}
                placeholder="用一句话写清楚要做什么…"
                placeholderTextColor={colors.textMuted}
                maxLength={MAX_TITLE_LEN}
                multiline
                style={[styles.titleField, { color: colors.text }]}
              />
              <Text style={[styles.counter, { color: colors.textSecondary }]}>
                {title.length}/{MAX_TITLE_LEN}
              </Text>

              <SectionCaption>重要程度</SectionCaption>
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
                          borderColor: active ? chip.dot : colors.outline,
                          backgroundColor: active ? `${chip.dot}18` : colors.surfaceSubtle,
                        },
                        pressed && { opacity: 0.88 },
                      ]}>
                      <View style={[styles.chipDot, { backgroundColor: chip.dot }]} />
                      <View>
                        <Text style={[styles.chipLabel, { color: colors.text }]}>{chip.label}</Text>
                        <Text style={[styles.chipHint, { color: colors.textSecondary }]}>{chip.hint}</Text>
                      </View>
                    </Pressable>
                  );
                })}
              </ScrollView>

              <View style={styles.sectionSpacer} />
              <SectionCaption>时间安排</SectionCaption>
              <Pressable
                onPress={openSchedulePicker}
                style={({ pressed }) => [
                  styles.scheduleCard,
                  {
                    borderColor: colors.outline,
                    backgroundColor: colors.surfaceSubtle,
                    opacity: pressed ? 0.92 : 1,
                  },
                ]}>
                <View style={[styles.scheduleIconWrap, { backgroundColor: colors.primaryMuted }]}>
                  <MaterialIcons name="schedule" size={26} color={colors.primary} />
                </View>
                <View style={{ flex: 1, gap: Spacing.xs }}>
                  <Text style={[styles.schedulePrimary, { color: colors.text }]}>
                    {deadlineText || '点按设置日期、时间与重复'}
                  </Text>
                  {(reminderText || repeatText) && (
                    <View style={styles.scheduleMetaRow}>
                      {!!reminderText && (
                        <View style={[styles.miniTag, { borderColor: colors.outline }]}>
                          <MaterialIcons name="notifications-active" size={12} color={colors.primary} />
                          <Text style={[styles.miniTagText, { color: colors.textSecondary }]} numberOfLines={1}>
                            {reminderText}
                          </Text>
                        </View>
                      )}
                      {!!repeatText && (
                        <View style={[styles.miniTag, { borderColor: colors.outline }]}>
                          <MaterialIcons name="repeat" size={12} color={colors.primary} />
                          <Text style={[styles.miniTagText, { color: colors.textSecondary }]} numberOfLines={1}>
                            {repeatText}
                          </Text>
                        </View>
                      )}
                    </View>
                  )}
                </View>
                <MaterialIcons name="chevron-right" size={22} color={colors.textSecondary} />
              </Pressable>

              <View style={styles.sectionSpacer} />
              <SectionCaption>备忘 / 上下文</SectionCaption>
              <View style={[styles.notesShell, { borderColor: colors.outline, backgroundColor: colors.input }]}>
                <TextInput
                  value={notes}
                  onChangeText={setNotes}
                  placeholder="可选：补充背景、链接、相关人…"
                  placeholderTextColor={colors.textMuted}
                  multiline
                  style={[styles.notesInput, { color: colors.text }]}
                />
              </View>
            </View>
          </View>
        </ScrollView>

        <View
          style={[
            styles.footer,
            {
              paddingBottom: Spacing['3xl'] + Math.max(insets.bottom, 0),
              backgroundColor: colors.headerScrim,
              borderTopColor: colors.outline,
            },
          ]}>
          <AppButton
            label={submitting ? '保存中…' : '保存到待办列表'}
            variant="primary"
            size="lg"
            fullWidth
            loading={submitting}
            disabled={submitting}
            onPress={() => void handleSave()}
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  scrollContent: {
    maxWidth: Layout.contentMaxWidth,
    alignSelf: 'center',
    width: '100%',
    paddingHorizontal: Spacing['5xl'],
    paddingTop: Spacing['3xl'],
  },
  heroCard: {
    flexDirection: 'row',
    borderRadius: Radius.sheet,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  heroRail: { width: 5 },
  heroBody: {
    flex: 1,
    paddingVertical: Spacing['3xl'],
    paddingRight: Spacing['3xl'],
    paddingLeft: Spacing.xl,
    gap: Spacing.md,
  },
  blockCaption: { opacity: 0.9 },
  sectionSpacer: { height: Spacing.sm },
  titleField: {
    ...Typography.h3,
    minHeight: 52,
    paddingVertical: Spacing.xs,
  },
  counter: { fontSize: 11, fontWeight: '600', alignSelf: 'flex-end' },
  chipRow: { flexDirection: 'row', gap: Spacing.lg, paddingVertical: Spacing.xs },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    borderRadius: Radius.lg,
    borderWidth: 1.5,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.lg,
  },
  chipDot: { width: 8, height: 8, borderRadius: 4 },
  chipLabel: { fontSize: 12, fontWeight: '800' },
  chipHint: { fontSize: 10, fontWeight: '600', marginTop: 1 },
  scheduleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xl,
    borderRadius: Radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.xl,
  },
  scheduleIconWrap: {
    width: 48,
    height: 48,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  schedulePrimary: { fontSize: 15, fontWeight: '700', lineHeight: 20 },
  scheduleMetaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  miniTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.md,
    paddingVertical: 3,
    maxWidth: '100%',
  },
  miniTagText: { fontSize: 11, fontWeight: '600', flexShrink: 1 },
  notesShell: {
    borderRadius: Radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.lg,
    minHeight: 100,
  },
  notesInput: { fontSize: 14, fontWeight: '500', lineHeight: 20, minHeight: 88, textAlignVertical: 'top' },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing['5xl'],
    paddingTop: Spacing['3xl'],
  },
});
