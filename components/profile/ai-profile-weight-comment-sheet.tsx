/**
 * 我的页「体重趋势短评」：只读展示 + 非诊疗提示。
 */
import { foldFonts, useFoldTheme } from '@/constants/review-fold-theme';
import type { ProfileWeightCommentJson } from '@/lib/ai-api-client';
import { toast, toUserMessage } from '@/lib/app-feedback';
import { analyzeProfileWeightComment } from '@/lib/zhipu-image-parse';
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

export type AiProfileWeightCommentSheetProps = {
  visible: boolean;
  onClose: () => void;
  points: Array<{ ymd: string; kg: number }>;
  goal?: string | null;
  heightCm?: number | null;
};

export function AiProfileWeightCommentSheet({
  visible,
  onClose,
  points,
  goal,
  heightCm,
}: AiProfileWeightCommentSheetProps) {
  const insets = useSafeAreaInsets();
  const { fold } = useFoldTheme();
  const styles = useMemo(() => createStyles(fold.pine), [fold.pine]);

  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ProfileWeightCommentJson | null>(null);
  const [fetched, setFetched] = useState(false);

  useEffect(() => {
    if (!visible) {
      setData(null);
      setFetched(false);
      setLoading(false);
    }
  }, [visible]);

  const run = useCallback(async () => {
    setLoading(true);
    try {
      const r = await analyzeProfileWeightComment({
        points,
        goal: goal ?? undefined,
        heightCm: heightCm ?? undefined,
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
  }, [goal, heightCm, points]);

  useEffect(() => {
    if (visible && !fetched && !loading && points.length > 0) {
      void run();
    }
  }, [visible, fetched, loading, points.length, run]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <View style={styles.handle} />
          <View style={styles.head}>
            <Text style={[styles.title, { fontFamily: foldFonts.serif }]}>体重趋势短评</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Text style={styles.close}>关闭</Text>
            </Pressable>
          </View>
          <Text style={styles.sub}>只读 · 非诊疗建议 · 数据仅本机</Text>

          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            showsVerticalScrollIndicator={false}>
            {loading ? (
              <View style={styles.loadingBox}>
                <ActivityIndicator color={fold.pine} />
                <Text style={styles.loadingText}>正在分析…</Text>
              </View>
            ) : null}

            {!loading && data ? (
              <View style={styles.card}>
                <Text style={styles.comment}>{data.comment}</Text>
                {data.caution ? (
                  <Text style={styles.caution}>提示 · {data.caution}</Text>
                ) : null}
              </View>
            ) : null}

            {!loading && fetched && !data ? (
              <Text style={styles.empty}>暂无可用短评</Text>
            ) : null}
          </ScrollView>

          <Pressable
            style={[styles.ghostBtn, (loading || !points.length) && styles.btnDisabled]}
            disabled={loading || !points.length}
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
      gap: 10,
    },
    comment: { fontSize: 15, color: '#2F3B32', lineHeight: 23, fontWeight: '600' },
    caution: { fontSize: 12, color: '#8B6B3A', lineHeight: 18 },
    empty: { fontSize: 13, color: '#8A968C', textAlign: 'center', paddingVertical: 24 },
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
