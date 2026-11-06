/**
 * 「今天先做什么」AI 候选 Sheet：只读推荐；打开任务 / 指派青蛙走现有 API。
 */
import { useTaskFoldTheme } from '@/constants/task-fold-theme';
import type { TaskSuggestTodayJson } from '@/lib/ai-api-client';
import { toast, toUserMessage } from '@/lib/app-feedback';
import { assignFrogForDay, fetchFrogCandidates } from '@/lib/frog-candidates-api';
import {
  buildFrogCandidateAiSummaries,
  buildHabitAiSummaries,
  buildTaskAiSummaries,
  type HabitAiSource,
} from '@/lib/task-ai-context';
import type { TaskRow } from '@/lib/repositories/tasks/task.types';
import { formatTasksDayBoundaryLabel, type TasksDayBoundary } from '@/lib/tasks-logical-day';
import { suggestTaskToday } from '@/lib/zhipu-image-parse';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export type AiSuggestTodayTasksSheetProps = {
  visible: boolean;
  onClose: () => void;
  logicalTodayYmd: string;
  dayBoundary: TasksDayBoundary;
  tasks: TaskRow[];
  habits?: HabitAiSource[];
  tagsByTaskId?: Map<string, string[]>;
  onOpenTask: (taskId: string) => void;
  onAssignedFrog?: () => void;
};

export function AiSuggestTodayTasksSheet({
  visible,
  onClose,
  logicalTodayYmd,
  dayBoundary,
  tasks,
  habits = [],
  tagsByTaskId,
  onOpenTask,
  onAssignedFrog,
}: AiSuggestTodayTasksSheetProps) {
  const insets = useSafeAreaInsets();
  const { tf, fonts } = useTaskFoldTheme();
  const styles = useMemo(() => createStyles(tf.frog), [tf.frog]);

  const [loading, setLoading] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [preference, setPreference] = useState('');
  const [data, setData] = useState<TaskSuggestTodayJson | null>(null);
  const [fetched, setFetched] = useState(false);

  useEffect(() => {
    if (!visible) {
      setData(null);
      setFetched(false);
      setLoading(false);
      setPreference('');
    }
  }, [visible]);

  const titleOf = useCallback(
    (id: string) => tasks.find(t => t.id === id)?.title?.trim() || id,
    [tasks],
  );

  const runSuggest = useCallback(async () => {
    setLoading(true);
    try {
      const summaries = buildTaskAiSummaries(tasks, {
        logicalTodayYmd,
        tagsByTaskId,
      });
      let frogSummaries: ReturnType<typeof buildFrogCandidateAiSummaries> = [];
      try {
        const frogs = await fetchFrogCandidates({ assignYmd: logicalTodayYmd });
        frogSummaries = buildFrogCandidateAiSummaries(frogs.items);
      } catch {
        // 候选失败时仍可用活跃任务摘要
      }
      const r = await suggestTaskToday({
        todayYmd: logicalTodayYmd,
        dayBoundary: formatTasksDayBoundaryLabel(dayBoundary),
        preference: preference.trim() || undefined,
        tasks: summaries,
        frogCandidates: frogSummaries,
        habits: buildHabitAiSummaries(habits),
      });
      if (!r.ok) {
        toast.error(r.error || 'AI 推荐失败');
        return;
      }
      setData(r.data);
      setFetched(true);
      if (
        !r.data.primary_task_ids.length &&
        !r.data.frog_task_id &&
        !r.data.habit_ids.length
      ) {
        toast.info('暂无合适推荐，可稍后再试');
      }
    } catch (e) {
      toast.error(toUserMessage(e, 'AI 推荐失败'));
    } finally {
      setLoading(false);
    }
  }, [dayBoundary, habits, logicalTodayYmd, preference, tagsByTaskId, tasks]);

  useEffect(() => {
    if (visible && !fetched && !loading && tasks.length > 0) {
      void runSuggest();
    }
  }, [visible, fetched, loading, tasks.length, runSuggest]);

  const handleAssignFrog = useCallback(
    async (taskId: string) => {
      setAssigning(true);
      try {
        await assignFrogForDay({ kind: 'task', id: taskId, assignYmd: logicalTodayYmd });
        toast.success('已指派为今日青蛙');
        onAssignedFrog?.();
        onClose();
      } catch (e) {
        toast.error(toUserMessage(e, '指派青蛙失败'));
      } finally {
        setAssigning(false);
      }
    },
    [logicalTodayYmd, onAssignedFrog, onClose],
  );

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <View style={styles.handle} />
          <View style={styles.head}>
            <Text style={[styles.title, { fontFamily: fonts.serif }]}>今天先做什么</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Text style={styles.close}>关闭</Text>
            </Pressable>
          </View>
          <Text style={styles.sub}>只从你现有任务里挑；确认后再打开或指派青蛙</Text>

          <View style={styles.prefRow}>
            <TextInput
              style={styles.prefInput}
              value={preference}
              onChangeText={setPreference}
              placeholder="可选偏好，如：想先做深度工作"
              placeholderTextColor="#9AA69C"
              editable={!loading}
            />
            <Pressable
              style={[styles.refreshBtn, loading && styles.btnDisabled]}
              disabled={loading}
              onPress={() => {
                setFetched(false);
                void runSuggest();
              }}>
              <Text style={styles.refreshText}>{loading ? '…' : '再问'}</Text>
            </Pressable>
          </View>

          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            showsVerticalScrollIndicator={false}>
            {loading ? (
              <View style={styles.loadingBox}>
                <ActivityIndicator color={tf.frog} />
                <Text style={styles.loadingText}>正在想今天先做什么…</Text>
              </View>
            ) : null}

            {!loading && data ? (
              <>
                {data.reason ? <Text style={styles.reason}>{data.reason}</Text> : null}
                {data.primary_task_ids.map((id, idx) => (
                  <View
                    key={id}
                    style={[styles.card, idx === 0 && styles.cardPrimary]}>
                    <Text style={styles.cardLabel}>{idx === 0 ? '优先' : `其次 ${idx + 1}`}</Text>
                    <Text style={styles.cardTitle} numberOfLines={2}>
                      {titleOf(id)}
                    </Text>
                    <View style={styles.cardActions}>
                      <Pressable
                        style={styles.ghostBtn}
                        onPress={() => {
                          onOpenTask(id);
                          onClose();
                        }}>
                        <Text style={styles.ghostText}>打开</Text>
                      </Pressable>
                      {data.frog_task_id === id ? (
                        <Pressable
                          style={[styles.primaryBtn, assigning && styles.btnDisabled]}
                          disabled={assigning}
                          onPress={() => void handleAssignFrog(id)}>
                          <Text style={styles.primaryText}>
                            {assigning ? '指派中…' : '指派今日青蛙'}
                          </Text>
                        </Pressable>
                      ) : null}
                    </View>
                  </View>
                ))}

                {data.frog_task_id && !data.primary_task_ids.includes(data.frog_task_id) ? (
                  <View style={[styles.card, styles.cardPrimary]}>
                    <Text style={styles.cardLabel}>建议青蛙</Text>
                    <Text style={styles.cardTitle} numberOfLines={2}>
                      {titleOf(data.frog_task_id)}
                    </Text>
                    <View style={styles.cardActions}>
                      <Pressable
                        style={styles.ghostBtn}
                        onPress={() => {
                          onOpenTask(data.frog_task_id!);
                          onClose();
                        }}>
                        <Text style={styles.ghostText}>打开</Text>
                      </Pressable>
                      <Pressable
                        style={[styles.primaryBtn, assigning && styles.btnDisabled]}
                        disabled={assigning}
                        onPress={() => void handleAssignFrog(data.frog_task_id!)}>
                        <Text style={styles.primaryText}>
                          {assigning ? '指派中…' : '指派今日青蛙'}
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                ) : null}

                {data.habit_ids.length > 0 ? (
                  <View style={styles.tipsBox}>
                    <Text style={styles.tipsTitle}>习惯补打建议</Text>
                    {data.habit_ids.map(id => {
                      const name = habits.find(h => h.id === id)?.name ?? id;
                      return (
                        <Text key={id} style={styles.tipLine}>
                          · {name}
                        </Text>
                      );
                    })}
                  </View>
                ) : null}

                {data.tips.length > 0 ? (
                  <View style={styles.tipsBox}>
                    {data.tips.map((t, i) => (
                      <Text key={`${i}-${t}`} style={styles.tipLine}>
                        {t}
                      </Text>
                    ))}
                  </View>
                ) : null}
              </>
            ) : null}

            {!loading && !data && fetched ? (
              <Text style={styles.empty}>暂无推荐</Text>
            ) : null}
          </ScrollView>
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
    prefRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
    prefInput: {
      flex: 1,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: '#D8CDBB',
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 8,
      fontSize: 13,
      color: '#2F3B32',
      backgroundColor: '#FFF',
    },
    refreshBtn: {
      paddingHorizontal: 12,
      justifyContent: 'center',
      borderRadius: 10,
      backgroundColor: accent,
    },
    refreshText: { color: '#FFF', fontWeight: '700', fontSize: 13 },
    body: { flexGrow: 0 },
    bodyContent: { paddingBottom: 12, gap: 10 },
    loadingBox: { alignItems: 'center', paddingVertical: 28, gap: 10 },
    loadingText: { fontSize: 13, color: '#8A968C' },
    reason: { fontSize: 13, color: '#536155', lineHeight: 19, marginBottom: 2 },
    card: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: '#E0D6C4',
      borderRadius: 12,
      padding: 12,
      backgroundColor: '#FFF',
      gap: 6,
    },
    cardPrimary: { borderColor: accent, backgroundColor: '#F4F8F2' },
    cardLabel: { fontSize: 11, fontWeight: '700', color: accent, letterSpacing: 0.4 },
    cardTitle: { fontSize: 15, fontWeight: '700', color: '#2F3B32' },
    cardActions: { flexDirection: 'row', gap: 8, marginTop: 4 },
    ghostBtn: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 8,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: '#C9D0C6',
    },
    ghostText: { fontSize: 13, fontWeight: '700', color: '#536155' },
    primaryBtn: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 8,
      backgroundColor: accent,
    },
    primaryText: { fontSize: 13, fontWeight: '700', color: '#FFF' },
    tipsBox: { gap: 4, paddingVertical: 4 },
    tipsTitle: { fontSize: 12, fontWeight: '700', color: '#6F856B' },
    tipLine: { fontSize: 12, color: '#7C897E', lineHeight: 18 },
    empty: { textAlign: 'center', color: '#9AA69C', paddingVertical: 24 },
    btnDisabled: { opacity: 0.55 },
  });
}
