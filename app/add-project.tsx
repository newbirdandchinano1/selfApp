import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { consumeSchedulePickerResult, normalizeRouteParam } from '@/lib/schedule-picker-bridge';
import { INBOX_PROJECT_CATEGORY_ID, INBOX_PROJECT_CATEGORY_NAME } from '@/lib/repositories/projects/constants';
import { createProject, getProjectCategories, isProjectNameDuplicate } from '@/lib/repositories/projects/project';
import type { ProjectCategoryRow } from '@/lib/repositories/projects/project.types';
import { MaterialIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

type Subtask = { id: string; title: string; done: boolean };

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
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
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
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';

  const [title, setTitle] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [deadlineText, setDeadlineText] = React.useState('');
  const [reminderText, setReminderText] = React.useState('');
  const [repeatText, setRepeatText] = React.useState('');
  const [scheduleMeta, setScheduleMeta] = React.useState<ProjectScheduleMeta | null>(null);
  const [subtasks, setSubtasks] = React.useState<Subtask[]>([]);
  const [categories, setCategories] = React.useState<ProjectCategoryRow[]>([]);
  /** 新建项目不允许选「收集箱」：无其它分类时为 null（未分类），否则默认为第一个非收集箱分类 */
  const [selectedCategoryId, setSelectedCategoryId] = React.useState<string | null>(null);
  const [categoryModalVisible, setCategoryModalVisible] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  const appliedRouteCategoryRef = React.useRef(false);

  const routeCategoryId = React.useMemo(() => {
    const raw = params.categoryId;
    const s = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw[0] : '';
    const t = (s ?? '').trim();
    if (!t || t === 'all') return null;
    return t;
  }, [params.categoryId]);

  const primary = isDark ? '#60a5fa' : '#0058be';
  const scheduleSource = normalizeRouteParam(params.source as string | string[] | undefined) || 'add-project';
  const primaryContainer = isDark ? '#1d4ed8' : '#2170e4';
  const outlineVariant = isDark ? 'rgba(148,163,184,0.22)' : 'rgba(194,198,214,0.7)';
  const outline = isDark ? 'rgba(148,163,184,0.65)' : 'rgba(114,119,133,0.8)';
  const surfaceLow = isDark ? 'rgba(30,41,59,0.35)' : 'rgba(241,243,255,0.9)';
  const surfaceLowest = theme.surface;

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

  }, [scheduleSource]);

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

  React.useEffect(() => {
    readScheduleResult();
  }, [readScheduleResult]);

  useFocusEffect(
    React.useCallback(() => {
      readScheduleResult();
    }, [readScheduleResult])
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

  const selectableProjectCategories = React.useMemo(
    () => categories.filter((c) => c.id !== INBOX_PROJECT_CATEGORY_ID),
    [categories]
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

    setCreating(true);
    try {
      await createProject({
        id: buildProjectId(),
        name: trimmedTitle,
        category_id: selectedCategoryId,
        note: notes.trim() || null,
        due_date: extractDueDate(deadlineText),
        extra_data: JSON.stringify({
          schedule: scheduleMeta,
        }),
      });
      router.back();
    } catch (error) {
      console.warn('创建项目失败', error);
      Alert.alert('创建失败', '项目保存失败，请稍后重试。');
    } finally {
      setCreating(false);
    }
  }, [creating, deadlineText, notes, router, scheduleMeta, selectedCategoryId, title]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={['top']}>
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 12), backgroundColor: isDark ? 'rgba(15,23,42,0.82)' : 'rgba(255,255,255,0.82)', borderBottomColor: isDark ? 'rgba(30,41,59,0.35)' : 'rgba(226,232,240,0.7)' }]}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.75 }]}>
          <MaterialIcons name="arrow-back" size={22} color={primary} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: primary }]}>添加项目</Text>
        <View style={styles.iconBtn} />
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
              maxLength={TITLE_MAX_LENGTH}
              style={[styles.titleInput, { color: theme.text }]}
            />
            <Text style={[styles.charCounter, { color: outline }]}>
              {title.length}/{TITLE_MAX_LENGTH}
            </Text>
          </View>

          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: outline }]}>项目分类</Text>
            <Pressable
              onPress={() => setCategoryModalVisible(true)}
              style={({ pressed }) => [
                styles.categorySelect,
                { backgroundColor: surfaceLow, borderColor: outlineVariant },
                pressed && { opacity: 0.8 },
              ]}>
              <View style={styles.categoryLeft}>
                <MaterialIcons name="folder-open" size={18} color={primary} />
              <Text style={[styles.categoryValue, { color: theme.text }]}>{selectedCategoryName || '未分类'}</Text>
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
              <Pressable onPress={openSchedulePicker} style={({ pressed }) => [styles.deadlineEdit, pressed && { opacity: 0.75 }]}>
                <MaterialIcons name="edit-calendar" size={22} color={primary} />
              </Pressable>
            </View>
          </View>

          {/*
          <View style={styles.section}>
            <View style={styles.subtaskHeader}>
              <Text style={[styles.sectionLabel, { color: outline }]}>项目拆解</Text>
              <Pressable onPress={() => router.push('/add-task')} style={({ pressed }) => [styles.linkBtn, pressed && { opacity: 0.75 }]}>
                <MaterialIcons name="add-circle" size={16} color={primary} />
                <Text style={[styles.linkBtnText, { color: primary }]}>添加任务</Text>
              </Pressable>
            </View>
            <View style={styles.subtaskList}>
              {subtasks.map((s) => (
                <View key={s.id} style={[styles.subtaskRow, { backgroundColor: surfaceLowest }]}>
                  <View style={[styles.checkbox, { borderColor: outlineVariant, backgroundColor: s.done ? primary : 'transparent' }]} />
                  <Text style={[styles.subtaskText, { color: theme.text }]} numberOfLines={1}>{s.title}</Text>
                  <MaterialIcons name="close" size={18} color={outline} />
                </View>
              ))}
            </View>
          </View>
          */}

          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: outline }]}>上下文备注</Text>
            <View style={[styles.notesWrap, { backgroundColor: surfaceLow }]}>
              <TextInput value={notes} onChangeText={setNotes} placeholder="在此记录更多背景信息..." placeholderTextColor={outline} multiline style={[styles.notesInput, { color: theme.text }]} />
              <View style={styles.notesIcon} pointerEvents="none"><MaterialIcons name="notes" size={20} color={outlineVariant} /></View>
            </View>
          </View>
        </ScrollView>

        <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 12), backgroundColor: isDark ? 'rgba(15,23,42,0.65)' : 'rgba(250,248,255,0.65)', borderTopColor: isDark ? 'rgba(30,41,59,0.35)' : 'rgba(226,232,240,0.7)' }]}>
          <View style={styles.bottomInner}>
            <Pressable
              onPress={createProjectRecord}
              disabled={creating}
              style={({ pressed }) => [
                styles.createBtn,
                { backgroundColor: pressed ? primaryContainer : primary, opacity: creating ? 0.7 : 1 },
                pressed && { transform: [{ scale: 0.98 }] },
              ]}>
              <MaterialIcons name="task-alt" size={22} color="#fff" />
              <Text style={styles.createText}>{creating ? '创建中...' : '创建项目'}</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>

      <Modal transparent visible={categoryModalVisible} animationType="fade" onRequestClose={() => setCategoryModalVisible(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setCategoryModalVisible(false)}>
          <Pressable onPress={() => {}} style={[styles.modalCard, { backgroundColor: surfaceLowest, borderColor: outlineVariant }]}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>选择项目分类</Text>
            <Pressable
              onPress={() => {
                setSelectedCategoryId(null);
                setCategoryModalVisible(false);
              }}
              style={({ pressed }) => [styles.modalItem, pressed && { opacity: 0.8 }]}>
              <Text style={[styles.modalItemText, { color: theme.text }]}>未分类</Text>
              {selectedCategoryId === null ? <MaterialIcons name="check" size={18} color={primary} /> : null}
            </Pressable>
            {selectableProjectCategories.map((item) => (
              <Pressable
                key={item.id}
                onPress={() => {
                  setSelectedCategoryId(item.id);
                  setCategoryModalVisible(false);
                }}
                style={({ pressed }) => [styles.modalItem, pressed && { opacity: 0.8 }]}>
                <Text style={[styles.modalItemText, { color: theme.text }]}>{item.name}</Text>
                {selectedCategoryId === item.id ? <MaterialIcons name="check" size={18} color={primary} /> : null}
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
  subtaskRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.04, shadowRadius: 8, elevation: 1 },
  checkbox: { width: 20, height: 20, borderRadius: 6, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  subtaskText: { flex: 1, fontSize: 14, fontWeight: '600' },
  notesWrap: { borderRadius: 16, padding: 14, minHeight: 120 },
  notesInput: { minHeight: 92, fontSize: 14, fontWeight: '500', lineHeight: 20, paddingRight: 34 },
  notesIcon: { position: 'absolute', right: 12, bottom: 12 },
  bottomBar: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 18, paddingTop: 12, borderTopWidth: 1 },
  bottomInner: { maxWidth: 520, width: '100%', alignSelf: 'center' },
  createBtn: { width: '100%', paddingVertical: 16, borderRadius: 16, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 10, shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.14, shadowRadius: 20, elevation: 8 },
  createText: { color: '#fff', fontSize: 18, fontWeight: '900', letterSpacing: -0.2 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.38)', justifyContent: 'center', paddingHorizontal: 18 },
  modalCard: { borderWidth: 1, borderRadius: 16, padding: 14, gap: 8 },
  modalTitle: { fontSize: 16, fontWeight: '800', marginBottom: 4 },
  modalItem: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modalItemText: { fontSize: 14, fontWeight: '600' },
});
