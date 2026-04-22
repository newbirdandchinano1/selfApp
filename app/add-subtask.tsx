import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

type PriorityKey = 'urgent-important' | 'urgent-not-important' | 'not-urgent-important' | 'not-urgent-not-important';

export default function AddSubtaskScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';

  const [title, setTitle] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [priority, setPriority] = React.useState<PriorityKey>('urgent-important');
  const [priorityOpen, setPriorityOpen] = React.useState(false);

  const primary = isDark ? '#60a5fa' : '#0058be';
  const primaryContainer = isDark ? '#1d4ed8' : '#2170e4';
  const outlineVariant = isDark ? 'rgba(148,163,184,0.22)' : 'rgba(194,198,214,0.7)';
  const outline = isDark ? 'rgba(148,163,184,0.65)' : 'rgba(114,119,133,0.8)';
  const surfaceLow = isDark ? 'rgba(30,41,59,0.35)' : 'rgba(241,243,255,0.9)';
  const surfaceLowest = theme.surface;

  const priorityOptions: Array<{ key: PriorityKey; label: string; color: string }> = [
    { key: 'urgent-important', label: '紧急重要', color: isDark ? '#f87171' : '#ba1a1a' },
    { key: 'urgent-not-important', label: '紧急不重要', color: isDark ? '#fbbf24' : '#825100' },
    { key: 'not-urgent-important', label: '不紧急重要', color: isDark ? '#60a5fa' : '#0058be' },
    { key: 'not-urgent-not-important', label: '不紧急不重要', color: isDark ? '#94a3b8' : '#727785' },
  ];
  const currentPriority = priorityOptions.find((p) => p.key === priority) ?? priorityOptions[0];

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={['top']}>
      <View
        style={[
          styles.header,
          {
            paddingTop: Math.max(insets.top, 12),
            backgroundColor: isDark ? 'rgba(15,23,42,0.82)' : 'rgba(255,255,255,0.82)',
            borderBottomColor: isDark ? 'rgba(30,41,59,0.35)' : 'rgba(226,232,240,0.7)',
          },
        ]}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.iconBtn}>
          <MaterialIcons name="arrow-back" size={22} color={primary} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: primary }]}>添加子任务</Text>
        <View style={styles.headerRightPlaceholder} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: 150 + Math.max(insets.bottom, 12) }]}
          showsVerticalScrollIndicator={false}>
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: outline }]}>基础信息</Text>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="任务名称"
              placeholderTextColor={outlineVariant}
              multiline
              style={[styles.titleInput, { color: theme.text }]}
            />
          </View>

          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: outline }]}>关联主任务</Text>
            <View style={[styles.mainTaskCard, { backgroundColor: surfaceLow, borderColor: `${primary}1A` }]}>
              <View style={styles.mainTaskLeft}>
                <View style={[styles.mainTaskIconWrap, { backgroundColor: `${primary}1A` }]}>
                  <MaterialIcons name="account-tree" size={20} color={primary} />
                </View>
                <View>
                  <Text style={[styles.mainTaskKicker, { color: outline }]}>所属主任务</Text>
                  <Text style={[styles.mainTaskTitle, { color: theme.text }]}>Q4 市场推广方案</Text>
                </View>
              </View>

              <Pressable style={[styles.swapBtn, { backgroundColor: isDark ? 'rgba(148,163,184,0.14)' : '#dae2fd' }]}>
                <MaterialIcons name="swap-horiz" size={14} color={primary} />
                <Text style={[styles.swapText, { color: primary }]}>更换主任务</Text>
              </Pressable>
            </View>
          </View>

          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: outline }]}>优先级别</Text>
            <Pressable
              onPress={() => setPriorityOpen(true)}
              style={({ pressed }) => [styles.prioritySelect, { backgroundColor: surfaceLow, borderColor: `${outlineVariant}70` }, pressed && { opacity: 0.85 }]}>
              <View style={styles.priorityLeft}>
                <View style={[styles.priorityDot, { backgroundColor: currentPriority.color }]} />
                <Text style={[styles.priorityValue, { color: theme.text }]}>{currentPriority.label}</Text>
              </View>
              <MaterialIcons name="expand-more" size={22} color={outline} />
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
                <Text style={[styles.deadlineValue, { color: theme.text }]}>Oct 24, 2023 — 14:00</Text>
              </View>
              <Pressable onPress={() => router.push('/schedule-picker')} style={styles.deadlineEdit}>
                <MaterialIcons name="edit-calendar" size={22} color={primary} />
              </Pressable>
            </View>
          </View>

          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: outline }]}>上下文备注</Text>
            <View style={[styles.notesWrap, { backgroundColor: surfaceLow }]}>
              <TextInput
                value={notes}
                onChangeText={setNotes}
                placeholder="在此记录更多背景信息..."
                placeholderTextColor={outline}
                multiline
                style={[styles.notesInput, { color: theme.text }]}
              />
              <View style={styles.notesIcon} pointerEvents="none">
                <MaterialIcons name="notes" size={20} color={outlineVariant} />
              </View>
            </View>
          </View>
        </ScrollView>

        <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 12), backgroundColor: isDark ? 'rgba(15,23,42,0.65)' : 'rgba(250,248,255,0.65)', borderTopColor: isDark ? 'rgba(30,41,59,0.35)' : 'rgba(226,232,240,0.7)' }]}>
          <View style={styles.bottomInner}>
            <Pressable
              onPress={() => router.back()}
              style={({ pressed }) => [styles.createBtn, { backgroundColor: pressed ? primaryContainer : primary }, pressed && { transform: [{ scale: 0.98 }] }]}>
              <MaterialIcons name="task-alt" size={22} color="#fff" />
              <Text style={styles.createText}>创建子任务</Text>
            </Pressable>
          </View>
        </View>

        <Modal transparent visible={priorityOpen} animationType="fade" onRequestClose={() => setPriorityOpen(false)}>
          <Pressable style={styles.priorityOverlay} onPress={() => setPriorityOpen(false)}>
            <Pressable onPress={() => {}} style={[styles.prioritySheet, { backgroundColor: surfaceLowest, borderColor: isDark ? 'rgba(148,163,184,0.2)' : 'rgba(194,198,214,0.5)' }]}>
              <Text style={[styles.prioritySheetTitle, { color: theme.text }]}>选择优先级别</Text>
              {priorityOptions.map((item) => {
                const active = item.key === priority;
                return (
                  <Pressable
                    key={item.key}
                    onPress={() => {
                      setPriority(item.key);
                      setPriorityOpen(false);
                    }}
                    style={({ pressed }) => [styles.priorityItem, { backgroundColor: active ? `${item.color}14` : 'transparent', borderColor: active ? `${item.color}44` : `${outlineVariant}60` }, pressed && { opacity: 0.85 }]}>
                    <View style={[styles.priorityDot, { backgroundColor: item.color }]} />
                    <Text style={[styles.priorityItemText, { color: theme.text }]}>{item.label}</Text>
                    {active ? <MaterialIcons name="check" size={18} color={item.color} /> : null}
                  </Pressable>
                );
              })}
            </Pressable>
          </Pressable>
        </Modal>
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
  headerRightPlaceholder: { width: 36, height: 36 },
  content: { paddingTop: 92, paddingHorizontal: 18, gap: 22 },
  section: { gap: 10 },
  sectionLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1.6, textTransform: 'uppercase', opacity: 0.75 },
  titleInput: { padding: 0, fontSize: 30, fontWeight: '900', lineHeight: 36 },
  mainTaskCard: { borderRadius: 14, borderWidth: 1, padding: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  mainTaskLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  mainTaskIconWrap: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  mainTaskKicker: { fontSize: 10, fontWeight: '700', letterSpacing: 1.4, textTransform: 'uppercase' },
  mainTaskTitle: { fontSize: 18, fontWeight: '800', marginTop: 2 },
  swapBtn: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 4 },
  swapText: { fontSize: 10, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase' },
  prioritySelect: { borderRadius: 20, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  priorityLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  priorityDot: { width: 10, height: 10, borderRadius: 5 },
  priorityValue: { fontSize: 14, fontWeight: '700' },
  deadlineCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 16 },
  deadlineIconWrap: { width: 46, height: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 6, elevation: 2 },
  deadlineBody: { flex: 1, gap: 4 },
  deadlineKicker: { fontSize: 10, fontWeight: '700', letterSpacing: 2, textTransform: 'uppercase' },
  deadlineValue: { fontSize: 16, fontWeight: '800' },
  deadlineEdit: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  notesWrap: { borderRadius: 16, padding: 14, minHeight: 120 },
  notesInput: { minHeight: 92, fontSize: 14, fontWeight: '500', lineHeight: 20, paddingRight: 34 },
  notesIcon: { position: 'absolute', right: 12, bottom: 12 },
  bottomBar: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 18, paddingTop: 12, borderTopWidth: 1 },
  bottomInner: { maxWidth: 520, width: '100%', alignSelf: 'center' },
  createBtn: { width: '100%', paddingVertical: 16, borderRadius: 16, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 10, shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.14, shadowRadius: 20, elevation: 8 },
  createText: { color: '#fff', fontSize: 18, fontWeight: '900', letterSpacing: -0.2 },
  priorityOverlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.35)', justifyContent: 'flex-end', padding: 18 },
  prioritySheet: { borderRadius: 18, borderWidth: 1, padding: 14, gap: 10 },
  prioritySheetTitle: { fontSize: 14, fontWeight: '800', marginBottom: 2 },
  priorityItem: { borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  priorityItemText: { flex: 1, fontSize: 14, fontWeight: '600' },
});