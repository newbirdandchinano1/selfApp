import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  applyScheduleMetaToLabels,
  parseDateLimitParam,
  parseDefaultScheduleParam,
  type ScheduleMetaLike,
} from '@/lib/schedule-inherit';
import { consumeSchedulePickerResult, normalizeRouteParam } from '@/lib/schedule-picker-bridge';
import { formatTaskReminderLabel, type TaskReminderOption } from '@/lib/task-reminder-schedule';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from "expo-router/react-navigation";
import { makeTimestampEntityId } from '@/lib/entity-id';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

type Subtask = {
  id: string;
  title: string;
  done: boolean;
  deadline?: string;
  deadlineText?: string;
  reminder?: string;
  reminderText?: string;
  repeat?: string;
  repeatText?: string;
  note?: string | null;
  schedule?: ScheduleMetaLike | null;
};
type SchedulePickerResult = {
  mode: 'date' | 'time';
  source: string;
  quickChip: string;
  allDay: boolean;
  hasExactTime: boolean;
  reminderOption: TaskReminderOption;
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

declare global {
  // eslint-disable-next-line no-var
  var __addSubtaskResult:
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

export default function AddSubtaskScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ source?: string; dateLimit?: string; defaultSchedule?: string }>();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';

  const [title, setTitle] = React.useState('');
  const [deadlineText, setDeadlineText] = React.useState('');
  const [reminderText, setReminderText] = React.useState('');
  const [repeatText, setRepeatText] = React.useState('');
  const [scheduleMeta, setScheduleMeta] = React.useState<TaskScheduleMeta | null>(null);

  const primary = isDark ? '#60a5fa' : '#0058be';
  const scheduleSource = normalizeRouteParam(params.source as string | string[] | undefined) || 'add-subtask';
  const dateLimit = React.useMemo(
    () => parseDateLimitParam(typeof params.dateLimit === 'string' ? params.dateLimit : undefined),
    [params.dateLimit],
  );
  const defaultScheduleApplied = React.useRef(false);

  React.useEffect(() => {
    if (defaultScheduleApplied.current || scheduleMeta) return;
    const inherited = parseDefaultScheduleParam(
      typeof params.defaultSchedule === 'string' ? params.defaultSchedule : undefined,
    );
    if (!inherited) return;
    defaultScheduleApplied.current = true;
    const applied = applyScheduleMetaToLabels(inherited);
    setDeadlineText(applied.deadlineText);
    setReminderText(applied.reminderText);
    setRepeatText(applied.repeatText);
    setScheduleMeta(applied.scheduleMeta as TaskScheduleMeta);
  }, [params.defaultSchedule, scheduleMeta]);
  const outlineVariant = isDark ? 'rgba(148,163,184,0.22)' : 'rgba(194,198,214,0.7)';
  const outline = isDark ? 'rgba(148,163,184,0.65)' : 'rgba(114,119,133,0.8)';
  const surfaceLowest = theme.surface;
  const panelBorder = isDark ? 'rgba(148,163,184,0.22)' : 'rgba(194,198,214,0.65)';
  const panelBg = isDark ? 'rgba(30,41,59,0.45)' : '#ffffff';
  const fieldBg = isDark ? 'rgba(15,23,42,0.45)' : 'rgba(241,243,255,0.72)';
  const divider = isDark ? 'rgba(148,163,184,0.16)' : 'rgba(226,232,240,0.95)';

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
        dateLimit: dateLimit ? JSON.stringify(dateLimit) : '',
      },
    });
  }, [dateLimit, router, scheduleMeta, scheduleSource]);

  React.useEffect(() => {
    readScheduleResult();
  }, [readScheduleResult]);

  useFocusEffect(
    React.useCallback(() => {
      readScheduleResult();
    }, [readScheduleResult])
  );

  const createSubtask = () => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;
    globalThis.__addSubtaskResult = {
      source: scheduleSource,
      task: {
        id: makeTimestampEntityId('tsk_', 8),
        title: trimmedTitle,
        done: false,
        deadline: deadlineText,
        deadlineText,
        reminder: reminderText,
        reminderText,
        repeat: repeatText,
        repeatText,
        note: null,
        schedule: scheduleMeta,
      },
    };
    router.back();
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={['top']}>
      <View
        style={[
          styles.header,
          {
            paddingTop: Math.max(insets.top, 8),
            backgroundColor: theme.background,
            borderBottomColor: divider,
          },
        ]}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.iconBtn}>
          <MaterialIcons name="arrow-back" size={22} color={theme.text} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: theme.text }]}>添加子任务</Text>
        <Pressable
          onPress={createSubtask}
          hitSlop={10}
          style={({ pressed }) => [
            styles.headerActionBtn,
            { backgroundColor: primary, opacity: pressed ? 0.88 : 1 },
          ]}>
          <Text style={styles.headerActionText}>创建</Text>
        </Pressable>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: 40 + Math.max(insets.bottom, 12) }]}
          showsVerticalScrollIndicator={false}>
          <View style={[styles.panel, { backgroundColor: panelBg, borderColor: panelBorder }]}>
            <Text style={[styles.panelTitle, { color: theme.text }]}>概要</Text>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="子任务名称（30字以内）"
              placeholderTextColor={outlineVariant}
              multiline
              maxLength={30}
              style={[styles.titleInput, { color: theme.text }]}
            />
            <Text style={[styles.charCounter, { color: outline }]}>{title.length}/30</Text>
          </View>

          <View style={[styles.panel, { backgroundColor: panelBg, borderColor: panelBorder }]}>
            <Text style={[styles.panelTitle, { color: theme.text }]}>日程</Text>
            <Pressable
              onPress={openSchedulePicker}
              style={({ pressed }) => [
                styles.scheduleRow,
                { backgroundColor: fieldBg, opacity: pressed ? 0.85 : 1 },
              ]}>
              <View style={[styles.scheduleIcon, { backgroundColor: surfaceLowest }]}>
                <MaterialIcons name="event-note" size={20} color={primary} />
              </View>
              <View style={styles.deadlineBody}>
                <Text style={[styles.fieldLabel, { color: outline }]}>时间限制</Text>
                <Text style={[styles.fieldValue, { color: theme.text }]}>{deadlineText || '未设置'}</Text>
                {!!(reminderText || repeatText) && (
                  <View style={styles.tagRow}>
                    {!!reminderText && (
                      <View style={[styles.metaTag, { backgroundColor: surfaceLowest, borderColor: outlineVariant }]}>
                        <MaterialIcons name="notifications-active" size={13} color={primary} />
                        <Text style={[styles.metaTagText, { color: theme.text }]}>{reminderText}</Text>
                      </View>
                    )}
                    {!!repeatText && (
                      <View style={[styles.metaTag, { backgroundColor: surfaceLowest, borderColor: outlineVariant }]}>
                        <MaterialIcons name="repeat" size={13} color={primary} />
                        <Text style={[styles.metaTagText, { color: theme.text }]}>{repeatText}</Text>
                      </View>
                    )}
                  </View>
                )}
              </View>
              <MaterialIcons name="chevron-right" size={20} color={outline} />
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  iconBtn: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', letterSpacing: -0.2 },
  headerActionBtn: {
    minWidth: 64,
    height: 34,
    paddingHorizontal: 14,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerActionText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  content: { paddingTop: 84, paddingHorizontal: 14, gap: 12 },
  panel: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    padding: 14,
    gap: 12,
  },
  panelTitle: { fontSize: 15, fontWeight: '700', letterSpacing: -0.2 },
  titleInput: { padding: 0, fontSize: 22, fontWeight: '700', lineHeight: 28 },
  charCounter: { alignSelf: 'flex-end', fontSize: 11, fontWeight: '500' },
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
  deadlineBody: { flex: 1, gap: 4, minWidth: 0 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  metaTag: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 3,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metaTagText: { fontSize: 11, fontWeight: '600' },
});
