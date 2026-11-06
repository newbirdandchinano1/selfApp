/**
 * 任务短评 / 阻塞诊断：确认后追加到备注。
 */
import { useTaskFoldTheme } from '@/constants/task-fold-theme';
import type { TaskCommentJson } from '@/lib/ai-api-client';
import { toast, toUserMessage } from '@/lib/app-feedback';
import { getDayBoundarySync, getLogicalLocalYmd } from '@/lib/tasks-logical-day';
import { analyzeTaskComment } from '@/lib/zhipu-image-parse';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export type AiTaskCommentSheetProps = {
  visible: boolean;
  onClose: () => void;
  title: string;
  note?: string | null;
  status?: string | null;
  subtaskDoneRatio?: number | null;
  overdueDays?: number | null;
  onAppend: (comment: string) => Promise<void> | void;
};

export function AiTaskCommentSheet({
  visible,
  onClose,
  title,
  note,
  status,
  subtaskDoneRatio,
  overdueDays,
  onAppend,
}: AiTaskCommentSheetProps) {
  const insets = useSafeAreaInsets();
  const { tf, fonts } = useTaskFoldTheme();
  const styles = useMemo(() => createStyles(tf.frog), [tf.frog]);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [data, setData] = useState<TaskCommentJson | null>(null);
  const [fetched, setFetched] = useState(false);

  useEffect(() => {
    if (!visible) {
      setData(null);
      setFetched(false);
      setLoading(false);
      setSaving(false);
    }
  }, [visible]);

  const run = useCallback(async () => {
    setLoading(true);
    try {
      const r = await analyzeTaskComment({
        title,
        note: note ?? undefined,
        status: status ?? undefined,
        subtaskDoneRatio: subtaskDoneRatio ?? undefined,
        overdueDays: overdueDays ?? undefined,
        todayYmd: getLogicalLocalYmd(new Date(), getDayBoundarySync()),
      });
      if (!r.ok) {
        toast.error(r.error || '短评生成失败');
        return;
      }
      setData(r.data);
      setFetched(true);
    } catch (e) {
      toast.error(toUserMessage(e, '短评生成失败'));
    } finally {
      setLoading(false);
    }
  }, [note, overdueDays, status, subtaskDoneRatio, title]);

  useEffect(() => {
    if (visible && !fetched && !loading && title.trim()) {
      void run();
    }
  }, [visible, fetched, loading, title, run]);

  const confirm = useCallback(async () => {
    if (!data?.comment) return;
    setSaving(true);
    try {
      await onAppend(data.comment);
      onClose();
      toast.success('已追加到备注');
    } catch (e) {
      toast.error(toUserMessage(e, '写入备注失败'));
    } finally {
      setSaving(false);
    }
  }, [data, onAppend, onClose]);

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <Text style={[styles.title, { fontFamily: fonts.serif }]}>AI 短评</Text>
          <Text style={styles.sub}>1～2 句下一步建议 · 确认后追加到备注</Text>

          {loading ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator color={tf.frog} />
              <Text style={styles.loadingText}>正在分析…</Text>
            </View>
          ) : null}

          {!loading && data?.comment ? (
            <View style={styles.card}>
              <Text style={styles.comment}>{data.comment}</Text>
            </View>
          ) : null}

          <View style={styles.footer}>
            <Pressable style={styles.ghostBtn} disabled={loading || saving} onPress={onClose}>
              <Text style={styles.ghostText}>取消</Text>
            </Pressable>
            <Pressable
              style={[styles.secondaryBtn, (loading || saving) && styles.btnDisabled]}
              disabled={loading || saving}
              onPress={() => {
                setFetched(false);
                void run();
              }}>
              <Text style={styles.secondaryText}>重试</Text>
            </Pressable>
            <Pressable
              style={[styles.primaryBtn, (!data || loading || saving) && styles.btnDisabled]}
              disabled={!data || loading || saving}
              onPress={() => void confirm()}>
              {saving ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <Text style={styles.primaryText}>追加备注</Text>
              )}
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
      backgroundColor: '#FFFCF5',
      borderTopLeftRadius: 18,
      borderTopRightRadius: 18,
      paddingHorizontal: 16,
      paddingTop: 16,
      gap: 10,
    },
    title: { fontSize: 18, fontWeight: '800', color: '#2F3B32' },
    sub: { fontSize: 12, color: '#8A968C', marginBottom: 4 },
    loadingBox: { alignItems: 'center', paddingVertical: 24, gap: 10 },
    loadingText: { fontSize: 13, color: '#8A968C' },
    card: {
      padding: 12,
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: '#E0D6C4',
      backgroundColor: '#FFF',
    },
    comment: { fontSize: 14, color: '#2F3B32', lineHeight: 21 },
    footer: { flexDirection: 'row', gap: 8, paddingTop: 4 },
    ghostBtn: {
      flex: 0.9,
      paddingVertical: 12,
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: '#C9D0C6',
      alignItems: 'center',
    },
    ghostText: { fontSize: 14, fontWeight: '700', color: '#536155' },
    secondaryBtn: {
      flex: 0.9,
      paddingVertical: 12,
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: accent,
      alignItems: 'center',
    },
    secondaryText: { fontSize: 14, fontWeight: '700', color: accent },
    primaryBtn: {
      flex: 1.3,
      paddingVertical: 12,
      borderRadius: 10,
      backgroundColor: accent,
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 44,
    },
    primaryText: { fontSize: 14, fontWeight: '700', color: '#FFF' },
    btnDisabled: { opacity: 0.55 },
  });
}
