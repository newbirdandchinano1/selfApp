/**
 * 今年焦点「关联执行」：从客户端候选里建议任务/习惯/项目；
 * 仅导航或预填新建待办标题，不在道路表伪造 FK。
 */
import { useLifeRoadTheme } from '@/constants/life-road-theme';
import type { LifeRoadSuggestLinksJson } from '@/lib/ai-api-client';
import { toast, toUserMessage } from '@/lib/app-feedback';
import { getHabits } from '@/lib/repositories/habits/habit';
import { getProjects } from '@/lib/repositories/projects/project';
import { getTasks } from '@/lib/repositories/tasks/task';
import { isTaskShelvedStatus, isTaskTerminalStatus } from '@/lib/repositories/tasks/task.types';
import { suggestLifeRoadLinks } from '@/lib/zhipu-image-parse';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Candidate = { id: string; title: string };

export type AiLifeRoadSuggestLinksSheetProps = {
  visible: boolean;
  onClose: () => void;
  focusNode: {
    id?: string;
    title: string;
    note?: string | null;
    kind?: string;
    status?: string;
  } | null;
};

export function AiLifeRoadSuggestLinksSheet({
  visible,
  onClose,
  focusNode,
}: AiLifeRoadSuggestLinksSheetProps) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { lr } = useLifeRoadTheme();
  const styles = useMemo(() => createStyles(lr.pine), [lr.pine]);

  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<LifeRoadSuggestLinksJson | null>(null);
  const [tasks, setTasks] = useState<Candidate[]>([]);
  const [habits, setHabits] = useState<Candidate[]>([]);
  const [projects, setProjects] = useState<Candidate[]>([]);
  const [fetched, setFetched] = useState(false);

  useEffect(() => {
    if (!visible) {
      setData(null);
      setFetched(false);
      setLoading(false);
      setTasks([]);
      setHabits([]);
      setProjects([]);
    }
  }, [visible]);

  const run = useCallback(async () => {
    if (!focusNode?.title?.trim()) {
      toast.info('暂无今年焦点节点');
      return;
    }
    setLoading(true);
    try {
      const [taskRows, habitRows, projectRows] = await Promise.all([
        getTasks(),
        getHabits(),
        getProjects(),
      ]);
      const candTasks = taskRows
        .filter(t => !isTaskTerminalStatus(t.status) && !isTaskShelvedStatus(t.status))
        .slice(0, 40)
        .map(t => ({ id: t.id, title: t.title }));
      const candHabits = habitRows.slice(0, 30).map(h => ({ id: h.id, title: h.name }));
      const candProjects = projectRows
        .filter(
          p =>
            p.status === 'todo' ||
            p.status === 'doing' ||
            p.status === 'blocked' ||
            p.status === 'shelved' ||
            p.status === 'active' ||
            p.status === 'paused',
        )
        .slice(0, 30)
        .map(p => ({ id: p.id, title: p.name }));

      setTasks(candTasks);
      setHabits(candHabits);
      setProjects(candProjects);

      const r = await suggestLifeRoadLinks({
        focusNode: {
          id: focusNode.id,
          title: focusNode.title,
          note: focusNode.note ?? null,
          kind: focusNode.kind,
          status: focusNode.status,
        },
        candidateTasks: candTasks,
        candidateHabits: candHabits,
        candidateProjects: candProjects,
      });
      if (!r.ok) {
        toast.error(r.error || '关联建议失败');
        return;
      }
      setData(r.data);
      setFetched(true);
    } catch (e) {
      toast.error(toUserMessage(e, '关联建议失败'));
    } finally {
      setLoading(false);
    }
  }, [focusNode]);

  useEffect(() => {
    if (visible && !fetched && !loading && focusNode?.title) {
      void run();
    }
  }, [visible, fetched, loading, focusNode, run]);

  const titleById = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of tasks) m.set(t.id, t.title);
    for (const h of habits) m.set(h.id, h.title);
    for (const p of projects) m.set(p.id, p.title);
    return m;
  }, [habits, projects, tasks]);

  const openTask = (id: string) => {
    onClose();
    router.push({ pathname: '/task/[id]', params: { id } });
  };
  const openProject = (id: string) => {
    onClose();
    router.push({ pathname: '/edit-project', params: { id } });
  };
  const openHabit = () => {
    onClose();
    router.push('/(tabs)/tasks');
  };
  const prefillTodo = () => {
    const title = focusNode?.title?.trim().slice(0, 40) || '道路焦点执行';
    onClose();
    router.push({ pathname: '/add-task', params: { title, standalone: '1' } });
  };

  const hasAny =
    (data?.suggested_task_ids.length ?? 0) +
      (data?.suggested_habit_ids.length ?? 0) +
      (data?.suggested_project_ids.length ?? 0) >
    0;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <View style={styles.handle} />
          <View style={styles.head}>
            <Text style={styles.title}>关联执行</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Text style={styles.close}>关闭</Text>
            </Pressable>
          </View>
          <Text style={styles.sub}>
            焦点 · {focusNode?.title?.trim() || '—'} · 仅导航，不写道路关联字段
          </Text>

          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            showsVerticalScrollIndicator={false}>
            {loading ? (
              <View style={styles.loadingBox}>
                <ActivityIndicator color={lr.pine} />
                <Text style={styles.loadingText}>正在匹配…</Text>
              </View>
            ) : null}
            {!loading && data?.reason ? <Text style={styles.reason}>{data.reason}</Text> : null}
            {!loading && data
              ? data.suggested_task_ids.map(id => (
                  <Pressable key={`t-${id}`} style={styles.row} onPress={() => openTask(id)}>
                    <Text style={styles.badge}>待办</Text>
                    <Text style={styles.rowText} numberOfLines={2}>
                      {titleById.get(id) ?? id}
                    </Text>
                  </Pressable>
                ))
              : null}
            {!loading && data
              ? data.suggested_project_ids.map(id => (
                  <Pressable key={`p-${id}`} style={styles.row} onPress={() => openProject(id)}>
                    <Text style={styles.badge}>项目</Text>
                    <Text style={styles.rowText} numberOfLines={2}>
                      {titleById.get(id) ?? id}
                    </Text>
                  </Pressable>
                ))
              : null}
            {!loading && data
              ? data.suggested_habit_ids.map(id => (
                  <Pressable key={`h-${id}`} style={styles.row} onPress={openHabit}>
                    <Text style={styles.badge}>习惯</Text>
                    <Text style={styles.rowText} numberOfLines={2}>
                      {titleById.get(id) ?? id}
                    </Text>
                  </Pressable>
                ))
              : null}
            {!loading && fetched && !hasAny ? (
              <Text style={styles.empty}>没有匹配到现有候选，可预填新建待办标题</Text>
            ) : null}
          </ScrollView>

          <View style={styles.footer}>
            <Pressable style={styles.ghostBtn} disabled={loading} onPress={() => void run()}>
              <Text style={styles.ghostText}>重新匹配</Text>
            </Pressable>
            <Pressable style={styles.primaryBtn} onPress={prefillTodo}>
              <Text style={styles.primaryText}>预填新建待办</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function createStyles(accent: string) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      justifyContent: 'flex-end',
      backgroundColor: 'rgba(20,28,22,0.38)',
    },
    sheet: {
      maxHeight: '88%',
      backgroundColor: '#FFFCF5',
      borderTopLeftRadius: 18,
      borderTopRightRadius: 18,
      paddingHorizontal: 16,
      paddingTop: 8,
    },
    handle: {
      alignSelf: 'center',
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor: '#D8CDBB',
      marginBottom: 10,
    },
    head: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 4,
    },
    title: { fontSize: 20, fontWeight: '800', color: '#2F3B32' },
    close: { fontSize: 14, color: '#7C897E', fontWeight: '600' },
    sub: { fontSize: 12, color: '#8A968C', marginBottom: 10 },
    body: { flexGrow: 0 },
    bodyContent: { paddingBottom: 12, gap: 8 },
    loadingBox: { alignItems: 'center', paddingVertical: 28, gap: 10 },
    loadingText: { fontSize: 13, color: '#8A968C' },
    reason: { fontSize: 13, color: '#6F856B', lineHeight: 20, marginBottom: 4 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 10,
      paddingHorizontal: 10,
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: '#E0D6C4',
      backgroundColor: '#FFF',
    },
    badge: {
      fontSize: 11,
      fontWeight: '800',
      color: accent,
      backgroundColor: '#EAF3EC',
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 6,
      overflow: 'hidden',
    },
    rowText: { flex: 1, fontSize: 14, color: '#2F3B32', fontWeight: '600' },
    empty: { fontSize: 13, color: '#8A968C', textAlign: 'center', paddingVertical: 20 },
    footer: { flexDirection: 'row', gap: 10, paddingTop: 8 },
    ghostBtn: {
      flex: 1,
      paddingVertical: 12,
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: '#C9D0C6',
      alignItems: 'center',
    },
    ghostText: { fontSize: 14, fontWeight: '700', color: '#536155' },
    primaryBtn: {
      flex: 1.2,
      paddingVertical: 12,
      borderRadius: 10,
      backgroundColor: accent,
      alignItems: 'center',
    },
    primaryText: { fontSize: 14, fontWeight: '700', color: '#FFF' },
  });
}
