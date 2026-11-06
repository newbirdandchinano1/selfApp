/**
 * 任务「AI 拆解」预览：确认后批量建子任务 / 写入验收 checklist。
 */
import { useTaskFoldTheme } from '@/constants/task-fold-theme';
import type { TaskBreakdownJson } from '@/lib/ai-api-client';
import { toast, toUserMessage } from '@/lib/app-feedback';
import { getLogicalLocalYmd, getDayBoundarySync } from '@/lib/tasks-logical-day';
import { breakdownTask } from '@/lib/zhipu-image-parse';
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

export type AiTaskBreakdownSheetProps = {
  visible: boolean;
  onClose: () => void;
  title: string;
  note?: string | null;
  dueYmd?: string | null;
  projectName?: string | null;
  existingSubtaskTitles?: string[];
  mode?: 'subtasks' | 'acceptance' | 'both';
  onConfirm: (draft: TaskBreakdownJson) => Promise<void> | void;
};

export function AiTaskBreakdownSheet({
  visible,
  onClose,
  title,
  note,
  dueYmd,
  projectName,
  existingSubtaskTitles = [],
  mode = 'both',
  onConfirm,
}: AiTaskBreakdownSheetProps) {
  const insets = useSafeAreaInsets();
  const { tf, fonts } = useTaskFoldTheme();
  const styles = useMemo(() => createStyles(tf.frog), [tf.frog]);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [data, setData] = useState<TaskBreakdownJson | null>(null);
  const [fetched, setFetched] = useState(false);
  const [selectedSubs, setSelectedSubs] = useState<Set<number>>(() => new Set());
  const [selectedAcc, setSelectedAcc] = useState<Set<number>>(() => new Set());

  useEffect(() => {
    if (!visible) {
      setData(null);
      setFetched(false);
      setLoading(false);
      setSelectedSubs(new Set());
      setSelectedAcc(new Set());
    }
  }, [visible]);

  const runBreakdown = useCallback(async () => {
    setLoading(true);
    try {
      const r = await breakdownTask({
        title,
        note: note ?? undefined,
        dueYmd: dueYmd ?? undefined,
        projectName: projectName ?? undefined,
        existingSubtaskTitles,
        mode,
        todayYmd: getLogicalLocalYmd(new Date(), getDayBoundarySync()),
      });
      if (!r.ok) {
        toast.error(r.error || 'AI 拆解失败');
        return;
      }
      setData(r.data);
      setSelectedSubs(new Set(r.data.subtasks.map((_, i) => i)));
      setSelectedAcc(new Set(r.data.acceptance_items.map((_, i) => i)));
      setFetched(true);
    } catch (e) {
      toast.error(toUserMessage(e, 'AI 拆解失败'));
    } finally {
      setLoading(false);
    }
  }, [dueYmd, existingSubtaskTitles, mode, note, projectName, title]);

  useEffect(() => {
    if (visible && !fetched && !loading && title.trim()) {
      void runBreakdown();
    }
  }, [visible, fetched, loading, title, runBreakdown]);

  const toggle = (set: Set<number>, i: number, setter: (n: Set<number>) => void) => {
    const next = new Set(set);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    setter(next);
  };

  const handleConfirm = async () => {
    if (!data) return;
    const draft: TaskBreakdownJson = {
      ...data,
      subtasks: data.subtasks.filter((_, i) => selectedSubs.has(i)),
      acceptance_items: data.acceptance_items.filter((_, i) => selectedAcc.has(i)),
    };
    if (!draft.subtasks.length && !draft.acceptance_items.length) {
      toast.info('请至少勾选一项');
      return;
    }
    setSaving(true);
    try {
      await onConfirm(draft);
      onClose();
    } catch (e) {
      toast.error(toUserMessage(e, '写入失败'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <View style={styles.handle} />
          <View style={styles.head}>
            <Text style={[styles.title, { fontFamily: fonts.serif }]}>AI 拆解</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Text style={styles.close}>关闭</Text>
            </Pressable>
          </View>
          <Text style={styles.sub}>勾选后确认：子任务会新建，验收项写入 checklist</Text>

          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            showsVerticalScrollIndicator={false}>
            {loading ? (
              <View style={styles.loadingBox}>
                <ActivityIndicator color={tf.frog} />
                <Text style={styles.loadingText}>正在拆解…</Text>
              </View>
            ) : null}

            {!loading && data?.reason ? <Text style={styles.reason}>{data.reason}</Text> : null}

            {!loading && data?.subtasks.length ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>子任务</Text>
                {data.subtasks.map((s, i) => {
                  const on = selectedSubs.has(i);
                  return (
                    <Pressable
                      key={`s-${i}-${s.title}`}
                      style={[styles.row, on && styles.rowOn]}
                      onPress={() => toggle(selectedSubs, i, setSelectedSubs)}>
                      <Text style={styles.check}>{on ? '✓' : '○'}</Text>
                      <Text style={styles.rowText} numberOfLines={2}>
                        {s.title}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}

            {!loading && data?.acceptance_items.length ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>验收标准</Text>
                {data.acceptance_items.map((a, i) => {
                  const on = selectedAcc.has(i);
                  return (
                    <Pressable
                      key={`a-${i}-${a.text}`}
                      style={[styles.row, on && styles.rowOn]}
                      onPress={() => toggle(selectedAcc, i, setSelectedAcc)}>
                      <Text style={styles.check}>{on ? '✓' : '○'}</Text>
                      <Text style={styles.rowText} numberOfLines={2}>
                        {a.text}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
          </ScrollView>

          <View style={styles.footer}>
            <Pressable
              style={[styles.ghostBtn]}
              disabled={loading}
              onPress={() => {
                setFetched(false);
                void runBreakdown();
              }}>
              <Text style={styles.ghostText}>重新生成</Text>
            </Pressable>
            <Pressable
              style={[styles.primaryBtn, (loading || saving || !data) && styles.btnDisabled]}
              disabled={loading || saving || !data}
              onPress={() => void handleConfirm()}>
              <Text style={styles.primaryText}>{saving ? '写入中…' : '确认写入'}</Text>
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
    bodyContent: { paddingBottom: 12, gap: 12 },
    loadingBox: { alignItems: 'center', paddingVertical: 28, gap: 10 },
    loadingText: { fontSize: 13, color: '#8A968C' },
    reason: { fontSize: 13, color: '#536155', lineHeight: 19 },
    section: { gap: 6 },
    sectionTitle: { fontSize: 12, fontWeight: '800', color: '#6F856B', letterSpacing: 0.4 },
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
    rowOn: { borderColor: accent, backgroundColor: '#F4F8F2' },
    check: { width: 18, textAlign: 'center', color: accent, fontWeight: '800' },
    rowText: { flex: 1, fontSize: 14, color: '#2F3B32', fontWeight: '600' },
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
    btnDisabled: { opacity: 0.55 },
  });
}
