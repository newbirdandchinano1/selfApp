/**
 * 人生道路「季末 / 年终回顾」：只读回顾 + 可选下期主题草稿。
 */
import { foldFonts, useFoldTheme } from '@/constants/review-fold-theme';
import type { LifeRoadPeriodReviewJson } from '@/lib/ai-api-client';
import { toast, toUserMessage } from '@/lib/app-feedback';
import { analyzeLifeRoadPeriodReview } from '@/lib/zhipu-image-parse';
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

const OPEN_LABEL: Record<string, string> = {
  tasks: '去任务',
  review: '去复盘',
  'life-road': '留在道路',
  'wish-board': '去心愿板',
};

export type AiLifeRoadPeriodReviewSheetProps = {
  visible: boolean;
  onClose: () => void;
  period: string;
  calendarYear: number;
  quarter?: number | null;
  directionBody?: string | null;
  yearTheme?: string | null;
  statusCounts?: Record<string, number>;
  arrivedTitles?: string[];
  nodeSummaries?: Array<Record<string, unknown>>;
  /** 用户确认「下期主题」草稿后回调 */
  onApplyTheme?: (theme: string) => void;
  /** 点击 open_hint 深链回调 */
  onOpenHint?: (hint: string) => void;
};

export function AiLifeRoadPeriodReviewSheet({
  visible,
  onClose,
  period,
  calendarYear,
  quarter,
  directionBody,
  yearTheme,
  statusCounts,
  arrivedTitles,
  nodeSummaries,
  onApplyTheme,
  onOpenHint,
}: AiLifeRoadPeriodReviewSheetProps) {
  const insets = useSafeAreaInsets();
  const { fold } = useFoldTheme();
  const styles = useMemo(() => createStyles(fold.pine), [fold.pine]);

  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<LifeRoadPeriodReviewJson | null>(null);
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
      const r = await analyzeLifeRoadPeriodReview({
        period,
        calendarYear,
        quarter: quarter ?? undefined,
        directionBody: directionBody ?? undefined,
        yearTheme: yearTheme ?? undefined,
        statusCounts,
        arrivedTitles,
        nodeSummaries,
      });
      if (!r.ok) {
        toast.error(r.error || '回顾生成失败');
        return;
      }
      setData(r.data);
      setFetched(true);
    } catch (e) {
      toast.error(toUserMessage(e, '回顾生成失败'));
    } finally {
      setLoading(false);
    }
  }, [
    arrivedTitles,
    calendarYear,
    directionBody,
    nodeSummaries,
    period,
    quarter,
    statusCounts,
    yearTheme,
  ]);

  useEffect(() => {
    if (visible && !fetched && !loading) {
      void run();
    }
  }, [visible, fetched, loading, run]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <View style={styles.handle} />
          <View style={styles.head}>
            <Text style={[styles.title, { fontFamily: foldFonts.serif }]}>季末回顾</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Text style={styles.close}>关闭</Text>
            </Pressable>
          </View>
          <Text style={styles.sub}>只读回顾 · 下期主题需确认才写入</Text>

          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            showsVerticalScrollIndicator={false}>
            {loading ? (
              <View style={styles.loadingBox}>
                <ActivityIndicator color={fold.pine} />
                <Text style={styles.loadingText}>正在回顾…</Text>
              </View>
            ) : null}

            {!loading && data ? (
              <>
                <Text style={styles.review}>{data.review}</Text>

                {data.highlights.length ? (
                  <View style={styles.card}>
                    <Text style={styles.cardTitle}>这段路的亮点</Text>
                    {data.highlights.map((h, i) => (
                      <View key={`${i}-${h}`} style={styles.highlightRow}>
                        <Text style={styles.highlightDot}>✦</Text>
                        <Text style={styles.highlightText}>{h}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}

                {data.next_theme_draft && onApplyTheme ? (
                  <View style={styles.themeCard}>
                    <Text style={styles.themeLabel}>下期主题草稿</Text>
                    <Text style={styles.themeText}>{data.next_theme_draft}</Text>
                    <Pressable
                      style={styles.themeBtn}
                      onPress={() => {
                        onApplyTheme(data.next_theme_draft!);
                        toast.success('已写入年度主题，记得保存');
                        onClose();
                      }}>
                      <Text style={styles.themeBtnText}>写入年度主题</Text>
                    </Pressable>
                  </View>
                ) : data.next_theme_draft ? (
                  <View style={styles.themeCard}>
                    <Text style={styles.themeLabel}>下期主题草稿</Text>
                    <Text style={styles.themeText}>{data.next_theme_draft}</Text>
                  </View>
                ) : null}

                {data.open_hint && onOpenHint ? (
                  <Pressable
                    style={styles.focusRow}
                    onPress={() => {
                      const hint = data.open_hint;
                      if (!hint) return;
                      onOpenHint(hint);
                      onClose();
                    }}>
                    <Text style={styles.focusText}>
                      {OPEN_LABEL[data.open_hint] ?? '去看看'} ›
                    </Text>
                  </Pressable>
                ) : null}
              </>
            ) : null}

            {!loading && fetched && !data ? (
              <Text style={styles.empty}>暂无可用回顾</Text>
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
    review: { fontSize: 15, color: '#2F3B32', lineHeight: 24, fontWeight: '600' },
    card: {
      padding: 12,
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: '#E0D6C4',
      backgroundColor: '#FFF',
      gap: 6,
    },
    cardTitle: { fontSize: 13, fontWeight: '800', color: '#2F3B32' },
    highlightRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
    highlightDot: { fontSize: 12, color: '#7C9A7E', marginTop: 2 },
    highlightText: { flex: 1, fontSize: 13, color: '#536155', lineHeight: 19 },
    themeCard: {
      padding: 12,
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: accent,
      backgroundColor: '#F4F8F2',
      gap: 6,
    },
    themeLabel: { fontSize: 12, fontWeight: '700', color: accent },
    themeText: { fontSize: 14, color: '#2F3B32', lineHeight: 20, fontWeight: '700' },
    themeBtn: {
      marginTop: 4,
      alignSelf: 'flex-start',
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 8,
      backgroundColor: accent,
    },
    themeBtnText: { fontSize: 12, fontWeight: '700', color: '#FFF' },
    focusRow: {
      paddingVertical: 10,
      paddingHorizontal: 10,
      borderRadius: 10,
      backgroundColor: '#F4F8F2',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: accent,
    },
    focusText: { fontSize: 14, fontWeight: '700', color: '#2F3B32' },
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
