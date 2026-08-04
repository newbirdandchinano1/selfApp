import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { formatDate } from '@/lib/schedule-inherit';
import { normalizeRouteParam } from '@/lib/schedule-picker-bridge';
import { getEligibleParentTaskCandidates, getTaskById } from '@/lib/repositories/tasks/task';
import type { TaskRow } from '@/lib/repositories/tasks/task.types';
import { MaterialIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import {
  ActivityIndicator,
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

declare global {
  // eslint-disable-next-line no-var
  var __pickParentTaskResult:
    | {
        source: string;
        parentTaskId: string | null;
      }
    | undefined;
}

function taskDueLabel(task: TaskRow): string {
  if (task.due_date) return formatDate(task.due_date);
  if (task.status === 'done') return '已完成';
  if (task.status === 'cancelled') return '已取消';
  return '未设置截止';
}

function buildDepthMap(tasks: TaskRow[]): Map<string, number> {
  const byId = new Map(tasks.map(t => [String(t.id), t]));
  const cache = new Map<string, number>();

  const depthOf = (id: string): number => {
    const cached = cache.get(id);
    if (cached != null) return cached;
    const row = byId.get(id);
    const parentId = row?.parent_task_id ? String(row.parent_task_id).trim() : '';
    const depth = parentId && byId.has(parentId) ? depthOf(parentId) + 1 : 0;
    cache.set(id, depth);
    return depth;
  };

  for (const t of tasks) depthOf(String(t.id));
  return cache;
}

export default function PickParentTaskScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ taskId?: string; source?: string; currentParentId?: string }>();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';

  const taskId = typeof params.taskId === 'string' ? params.taskId : '';
  const currentParentId =
    typeof params.currentParentId === 'string' && params.currentParentId.trim()
      ? params.currentParentId.trim()
      : null;
  const pickSource = normalizeRouteParam(params.source as string | string[] | undefined) || 'pick-parent-task';

  const [query, setQuery] = React.useState('');
  const [loading, setLoading] = React.useState(true);
  const [candidates, setCandidates] = React.useState<TaskRow[]>([]);
  const [selectedId, setSelectedId] = React.useState<string | null>(currentParentId);
  const [currentTitle, setCurrentTitle] = React.useState('');

  const primary = isDark ? '#60a5fa' : '#0058be';
  const primaryContainer = isDark ? '#1d4ed8' : '#2170e4';
  const outlineVariant = isDark ? 'rgba(148,163,184,0.22)' : 'rgba(194,198,214,0.7)';
  const outline = isDark ? 'rgba(148,163,184,0.65)' : 'rgba(114,119,133,0.8)';
  const surfaceLowest = theme.surface;

  React.useEffect(() => {
    if (!taskId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [current, rows] = await Promise.all([getTaskById(taskId), getEligibleParentTaskCandidates(taskId)]);
        if (cancelled) return;
        setCurrentTitle(current?.title?.trim() || '当前任务');
        setCandidates(rows);
        setSelectedId(currentParentId);
      } catch (error) {
        console.warn('加载可选父任务失败', error);
        if (!cancelled) setCandidates([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentParentId, taskId]);

  const depthMap = React.useMemo(() => buildDepthMap(candidates), [candidates]);

  const filteredCandidates = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter(t => `${t.title}${taskDueLabel(t)}`.toLowerCase().includes(q));
  }, [candidates, query]);

  const confirmPick = () => {
    globalThis.__pickParentTaskResult = {
      source: pickSource,
      parentTaskId: selectedId,
    };
    router.back();
  };

  const clearParent = () => {
    globalThis.__pickParentTaskResult = {
      source: pickSource,
      parentTaskId: null,
    };
    router.back();
  };

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
        <Text style={[styles.headerTitle, { color: primary }]}>选择父任务</Text>
        <View style={styles.headerRightPlaceholder} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: 150 + Math.max(insets.bottom, 12) }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <Text style={[styles.hint, { color: outline }]}>
            为「{currentTitle}」选择父任务。不可选自身及其子任务。
          </Text>

          <View style={[styles.searchWrap, { backgroundColor: isDark ? 'rgba(30,41,59,0.35)' : 'rgba(241,243,255,0.9)' }]}>
            <MaterialIcons name="search" size={20} color={outline} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="搜索任务..."
              placeholderTextColor={outlineVariant}
              style={[styles.searchInput, { color: theme.text }]}
            />
          </View>

          {loading ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator size="large" color={primary} />
            </View>
          ) : filteredCandidates.length === 0 ? (
            <View style={[styles.emptyRow, { borderColor: outlineVariant }]}>
              <MaterialIcons name="inbox" size={20} color={outline} />
              <Text style={[styles.emptyText, { color: outline }]}>
                {candidates.length === 0 ? '暂无可选父任务' : '没有匹配的任务'}
              </Text>
            </View>
          ) : (
            <View style={styles.list}>
              {filteredCandidates.map(item => {
                const active = selectedId === item.id;
                const depth = depthMap.get(String(item.id)) ?? 0;
                return (
                  <Pressable
                    key={item.id}
                    onPress={() => setSelectedId(item.id)}
                    style={({ pressed }) => [
                      styles.item,
                      {
                        backgroundColor: surfaceLowest,
                        borderColor: active ? `${primary}44` : outlineVariant,
                        marginLeft: Math.min(depth, 4) * 12,
                      },
                      pressed && { opacity: 0.86 },
                    ]}>
                    <View style={[styles.radio, { borderColor: active ? primary : outlineVariant }]}>
                      {active ? <View style={[styles.radioInner, { backgroundColor: primary }]} /> : null}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.itemTitle, { color: theme.text }]} numberOfLines={2}>
                        {item.title}
                      </Text>
                      <Text style={[styles.itemMeta, { color: outline }]}>{taskDueLabel(item)}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          )}
        </ScrollView>

        <View
          style={[
            styles.bottomBar,
            {
              paddingBottom: Math.max(insets.bottom, 12),
              backgroundColor: isDark ? 'rgba(15,23,42,0.65)' : 'rgba(250,248,255,0.65)',
              borderTopColor: isDark ? 'rgba(30,41,59,0.35)' : 'rgba(226,232,240,0.7)',
            },
          ]}>
          <View style={styles.bottomInner}>
            {currentParentId ? (
              <Pressable
                onPress={clearParent}
                style={({ pressed }) => [
                  styles.secondaryBtn,
                  { borderColor: outlineVariant, opacity: pressed ? 0.85 : 1 },
                ]}>
                <Text style={[styles.secondaryBtnText, { color: outline }]}>移除父任务</Text>
              </Pressable>
            ) : null}
            <Pressable
              onPress={confirmPick}
              disabled={!selectedId}
              style={({ pressed }) => [
                styles.confirmBtn,
                {
                  backgroundColor: !selectedId ? `${primary}55` : pressed ? primaryContainer : primary,
                },
                pressed && selectedId && { transform: [{ scale: 0.98 }] },
              ]}>
              <MaterialIcons name="check-circle" size={22} color="#fff" />
              <Text style={styles.confirmText}>确认关联</Text>
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
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingBottom: 10,
    borderBottomWidth: 1,
  },
  iconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 24, fontWeight: '800', letterSpacing: -0.4 },
  headerRightPlaceholder: { width: 36, height: 36 },
  content: { paddingTop: 92, paddingHorizontal: 18, gap: 14 },
  hint: { fontSize: 13, lineHeight: 20, fontWeight: '500' },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  searchInput: { flex: 1, fontSize: 15, fontWeight: '500', padding: 0 },
  loadingWrap: { paddingVertical: 40, alignItems: 'center' },
  emptyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  emptyText: { flex: 1, fontSize: 14, fontWeight: '600' },
  list: { gap: 10 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: 16,
    borderWidth: 1,
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioInner: { width: 10, height: 10, borderRadius: 5 },
  itemTitle: { fontSize: 15, fontWeight: '700', lineHeight: 20 },
  itemMeta: { fontSize: 12, fontWeight: '600', marginTop: 4 },
  bottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 18,
    paddingTop: 12,
    borderTopWidth: 1,
  },
  bottomInner: { maxWidth: 520, width: '100%', alignSelf: 'center', gap: 10 },
  secondaryBtn: {
    width: '100%',
    paddingVertical: 14,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  secondaryBtnText: { fontSize: 15, fontWeight: '700' },
  confirmBtn: {
    width: '100%',
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  confirmText: { color: '#fff', fontSize: 18, fontWeight: '900', letterSpacing: -0.2 },
});
