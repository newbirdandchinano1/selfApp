/**
 * 习惯缺口 → 今日补打建议（只读，不自动打卡）。
 */
import { useTaskFoldTheme } from '@/constants/task-fold-theme';
import type { TaskAiHabitSummary, TaskHabitNudgeJson } from '@/lib/ai-api-client';
import { toast, toUserMessage } from '@/lib/app-feedback';
import { analyzeTaskHabitNudge } from '@/lib/zhipu-image-parse';
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

export type AiHabitNudgeSheetProps = {
  visible: boolean;
  onClose: () => void;
  todayYmd: string;
  habits: TaskAiHabitSummary[];
  boundTaskIds?: string[];
  onOpenHabit?: (habitId: string) => void;
};

export function AiHabitNudgeSheet({
  visible,
  onClose,
  todayYmd,
  habits,
  boundTaskIds,
  onOpenHabit,
}: AiHabitNudgeSheetProps) {
  const insets = useSafeAreaInsets();
  const { tf, fonts } = useTaskFoldTheme();
  const styles = useMemo(() => createStyles(tf.frog), [tf.frog]);

  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<TaskHabitNudgeJson | null>(null);
  const [fetched, setFetched] = useState(false);

  useEffect(() => {
    if (!visible) {
      setData(null);
      setFetched(false);
      setLoading(false);
    }
  }, [visible]);

  const nameOf = useCallback(
    (id: string) => habits.find(h => h.id === id)?.name?.trim() || id,
    [habits],
  );

  const run = useCallback(async () => {
    setLoading(true);
    try {
      const r = await analyzeTaskHabitNudge({
        habits,
        boundTaskIds,
        todayYmd,
      });
      if (!r.ok) {
        toast.error(r.error || '补打建议生成失败');
        return;
      }
      setData(r.data);
      setFetched(true);
    } catch (e) {
      toast.error(toUserMessage(e, '补打建议生成失败'));
    } finally {
      setLoading(false);
    }
  }, [boundTaskIds, habits, todayYmd]);

  useEffect(() => {
    if (visible && !fetched && !loading && habits.length > 0) {
      void run();
    }
  }, [visible, fetched, loading, habits.length, run]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <View style={styles.handle} />
          <View style={styles.head}>
            <Text style={[styles.title, { fontFamily: fonts.serif }]}>今日补打建议</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Text style={styles.close}>关闭</Text>
            </Pressable>
          </View>
          <Text style={styles.sub}>只读 · 不自动打卡</Text>

          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            showsVerticalScrollIndicator={false}>
            {loading ? (
              <View style={styles.loadingBox}>
                <ActivityIndicator color={tf.frog} />
                <Text style={styles.loadingText}>正在分析习惯缺口…</Text>
              </View>
            ) : null}

            {!loading &&
              data?.tips.map((tip, i) => (
                <View key={`${i}-${tip}`} style={styles.card}>
                  <Text style={styles.cardBody}>{tip}</Text>
                </View>
              ))}

            {!loading && data?.habit_ids?.length ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>建议优先</Text>
                {data.habit_ids.map(id => (
                  <Pressable
                    key={id}
                    style={styles.focusRow}
                    onPress={() => onOpenHabit?.(id)}
                    disabled={!onOpenHabit}>
                    <Text style={styles.focusText} numberOfLines={1}>
                      {nameOf(id)}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : null}

            {!loading && fetched && !data?.tips?.length && !data?.habit_ids?.length ? (
              <Text style={styles.empty}>暂无建议</Text>
            ) : null}
          </ScrollView>

          <Pressable
            style={[styles.ghostBtn, loading && styles.btnDisabled]}
            disabled={loading}
            onPress={() => {
              setFetched(false);
              void run();
            }}>
            <Text style={styles.ghostText}>重新生成</Text>
          </Pressable>
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
      maxHeight: '78%',
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
    bodyContent: { paddingBottom: 12, gap: 10 },
    loadingBox: { alignItems: 'center', paddingVertical: 28, gap: 10 },
    loadingText: { fontSize: 13, color: '#8A968C' },
    card: {
      padding: 12,
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: '#E0D6C4',
      backgroundColor: '#FFF',
    },
    cardBody: { fontSize: 13, color: '#536155', lineHeight: 19 },
    section: { gap: 6 },
    sectionTitle: { fontSize: 12, fontWeight: '800', color: '#6F856B' },
    focusRow: {
      paddingVertical: 10,
      paddingHorizontal: 10,
      borderRadius: 10,
      backgroundColor: '#F4F8F2',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: accent,
    },
    focusText: { fontSize: 14, fontWeight: '600', color: '#2F3B32' },
    empty: { fontSize: 13, color: '#8A968C', textAlign: 'center', paddingVertical: 20 },
    ghostBtn: {
      marginTop: 8,
      paddingVertical: 12,
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: '#C9D0C6',
      alignItems: 'center',
    },
    ghostText: { fontSize: 14, fontWeight: '700', color: '#536155' },
    btnDisabled: { opacity: 0.55 },
  });
}
