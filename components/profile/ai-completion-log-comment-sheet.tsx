/**
 * 完成履历「AI 短评」：只读展示，可复制或确认后写入备忘。
 */
import { foldFonts, useFoldTheme } from '@/constants/review-fold-theme';
import type { ProfileCompletionLogCommentJson } from '@/lib/ai-api-client';
import { Alert, toast, toUserMessage } from '@/lib/app-feedback';
import { createMemo } from '@/lib/memos';
import { draftProfileCompletionLogComment } from '@/lib/zhipu-image-parse';
import * as Clipboard from 'expo-clipboard';
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

export type AiCompletionLogCommentSheetProps = {
  visible: boolean;
  onClose: () => void;
  projectTitle: string;
  archiveSummary?: string | null;
  durationLabel?: string | null;
  pointsDelta?: number | null;
  source?: string | null;
};

export function AiCompletionLogCommentSheet({
  visible,
  onClose,
  projectTitle,
  archiveSummary,
  durationLabel,
  pointsDelta,
  source,
}: AiCompletionLogCommentSheetProps) {
  const insets = useSafeAreaInsets();
  const { fold } = useFoldTheme();
  const styles = useMemo(() => createStyles(fold.pine), [fold.pine]);

  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ProfileCompletionLogCommentJson | null>(null);
  const [fetched, setFetched] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) {
      setData(null);
      setFetched(false);
      setLoading(false);
      setSaving(false);
    }
  }, [visible]);

  const run = useCallback(async () => {
    if (!projectTitle.trim()) {
      toast.info('缺少项目标题');
      return;
    }
    setLoading(true);
    try {
      const r = await draftProfileCompletionLogComment({
        projectTitle,
        archiveSummary: archiveSummary ?? undefined,
        durationLabel: durationLabel ?? undefined,
        pointsDelta: pointsDelta ?? undefined,
        source: source ?? undefined,
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
  }, [archiveSummary, durationLabel, pointsDelta, projectTitle, source]);

  useEffect(() => {
    if (visible && !fetched && !loading && projectTitle.trim()) {
      void run();
    }
  }, [visible, fetched, loading, projectTitle, run]);

  const copy = async () => {
    if (!data?.comment.trim()) return;
    try {
      await Clipboard.setStringAsync(data.comment);
      toast.success('已复制短评');
    } catch {
      toast.error('复制失败');
    }
  };

  const saveToMemo = () => {
    if (!data?.comment.trim()) return;
    Alert.alert('写入备忘', '将这条短评保存为一条备忘？', [
      { text: '取消', style: 'cancel' },
      {
        text: '写入',
        onPress: () => {
          void (async () => {
            setSaving(true);
            try {
              await createMemo({
                title: `履历短评 · ${projectTitle.trim()}`,
                body: data.comment.trim(),
              });
              toast.success('已写入备忘');
              onClose();
            } catch (e) {
              toast.error(toUserMessage(e, '写入备忘失败'));
            } finally {
              setSaving(false);
            }
          })();
        },
      },
    ]);
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <View style={styles.handle} />
          <View style={styles.head}>
            <Text style={[styles.title, { fontFamily: foldFonts.serif }]}>履历短评</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Text style={styles.close}>关闭</Text>
            </Pressable>
          </View>
          <Text style={styles.sub}>这次做成了什么 · 可复制或存进备忘</Text>

          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            showsVerticalScrollIndicator={false}>
            {loading ? (
              <View style={styles.loadingBox}>
                <ActivityIndicator color={fold.pine} />
                <Text style={styles.loadingText}>正在生成…</Text>
              </View>
            ) : null}

            {!loading && data ? (
              <View style={styles.card}>
                <Text style={styles.comment}>{data.comment}</Text>
              </View>
            ) : null}

            {!loading && fetched && !data ? (
              <Text style={styles.empty}>暂无可用短评</Text>
            ) : null}
          </ScrollView>

          <View style={styles.footer}>
            <Pressable
              style={[styles.ghostBtn, (!data || loading) && styles.btnDisabled]}
              disabled={!data || loading}
              onPress={() => void copy()}>
              <Text style={styles.ghostText}>复制</Text>
            </Pressable>
            <Pressable
              style={[styles.primaryBtn, (!data || loading || saving) && styles.btnDisabled]}
              disabled={!data || loading || saving}
              onPress={saveToMemo}>
              <Text style={styles.primaryText}>{saving ? '写入中…' : '写入备忘'}</Text>
            </Pressable>
          </View>

          <Pressable
            style={[styles.regenBtn, loading && styles.btnDisabled]}
            disabled={loading}
            onPress={() => {
              setFetched(false);
              void run();
            }}>
            <Text style={styles.regenText}>重新生成</Text>
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
    bodyContent: { paddingBottom: 12, gap: 10 },
    loadingBox: { alignItems: 'center', paddingVertical: 28, gap: 10 },
    loadingText: { fontSize: 13, color: '#8A968C' },
    card: {
      padding: 14,
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: '#E0D6C4',
      backgroundColor: '#FFF',
    },
    comment: { fontSize: 15, color: '#2F3B32', lineHeight: 23, fontWeight: '600' },
    empty: { fontSize: 13, color: '#8A968C', textAlign: 'center', paddingVertical: 24 },
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
      flex: 1.3,
      paddingVertical: 12,
      borderRadius: 10,
      backgroundColor: accent,
      alignItems: 'center',
    },
    primaryText: { fontSize: 14, fontWeight: '700', color: '#FFF' },
    regenBtn: { marginTop: 8, paddingVertical: 10, alignItems: 'center' },
    regenText: { fontSize: 13, fontWeight: '600', color: '#7C897E' },
    btnDisabled: { opacity: 0.55 },
  });
}
