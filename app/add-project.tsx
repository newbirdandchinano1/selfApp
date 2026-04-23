import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { MaterialIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

type Subtask = { id: string; title: string; done: boolean };

type SchedulePickerResult = {
  mode: 'date' | 'time';
  source: string;
  quickChip: string;
  allDay: boolean;
  hasExactTime: boolean;
  date?: string;
  range?: { start: string; end: string };
  startTime: string;
  endTime: string;
};

export default function AddProjectScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ source?: string }>();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';

  const [title, setTitle] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [deadlineText, setDeadlineText] = React.useState('');
  const [subtasks, setSubtasks] = React.useState<Subtask[]>([]);

  const primary = isDark ? '#60a5fa' : '#0058be';
  const scheduleSource = params.source ?? 'add-project';
  const primaryContainer = isDark ? '#1d4ed8' : '#2170e4';
  const outlineVariant = isDark ? 'rgba(148,163,184,0.22)' : 'rgba(194,198,214,0.7)';
  const outline = isDark ? 'rgba(148,163,184,0.65)' : 'rgba(114,119,133,0.8)';
  const surfaceLow = isDark ? 'rgba(30,41,59,0.35)' : 'rgba(241,243,255,0.9)';
  const surfaceLowest = theme.surface;

  React.useEffect(() => {
    const picked = globalThis.__schedulePickerResult as SchedulePickerResult | undefined;
    if (!picked || picked.source !== scheduleSource) return;

    if (picked.mode === 'time' && picked.range) {
      setDeadlineText(`${picked.range.start.slice(0, 10)} ~ ${picked.range.end.slice(0, 10)}`);
    } else if (picked.date) {
      setDeadlineText(picked.date.slice(0, 10));
    }

    globalThis.__schedulePickerResult = undefined;
  }, [scheduleSource]);

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
            <TextInput value={title} onChangeText={setTitle} placeholder="项目名称" placeholderTextColor={outlineVariant} multiline style={[styles.titleInput, { color: theme.text }]} />
          </View>

          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: outline }]}>时间限制</Text>
            <View style={[styles.deadlineCard, { backgroundColor: surfaceLow }]}>
              <View style={[styles.deadlineIconWrap, { backgroundColor: surfaceLowest }]}>
                <MaterialIcons name="event-note" size={22} color={primary} />
              </View>
              <View style={styles.deadlineBody}>
                <Text style={[styles.deadlineKicker, { color: outline }]}>截止日期</Text>
                <Text style={[styles.deadlineValue, { color: theme.text }]}>{deadlineText}</Text>
              </View>
              <Pressable onPress={() => router.push({ pathname: '/schedule-picker', params: { source: scheduleSource } })} style={({ pressed }) => [styles.deadlineEdit, pressed && { opacity: 0.75 }]}>
                <MaterialIcons name="edit-calendar" size={22} color={primary} />
              </Pressable>
            </View>
          </View>

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
            <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.createBtn, { backgroundColor: pressed ? primaryContainer : primary }, pressed && { transform: [{ scale: 0.98 }] }]}>
              <MaterialIcons name="task-alt" size={22} color="#fff" />
              <Text style={styles.createText}>创建项目</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
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
  deadlineCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 16 },
  deadlineIconWrap: { width: 46, height: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 6, elevation: 2 },
  deadlineBody: { flex: 1, gap: 4 },
  deadlineKicker: { fontSize: 10, fontWeight: '700', letterSpacing: 2, textTransform: 'uppercase' },
  deadlineValue: { fontSize: 16, fontWeight: '800' },
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
});
