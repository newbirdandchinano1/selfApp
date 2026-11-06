/**
 * 我的页「本周节奏」洞察：只读展示，可按 open_hint 深链。
 */
import { foldFonts, useFoldTheme } from '@/constants/review-fold-theme';
import type {
  ProfileWeekRhythmInsightsJson,
  ProfileWeekRhythmOpenHint,
} from '@/lib/ai-api-client';
import { toast, toUserMessage } from '@/lib/app-feedback';
import { analyzeProfileWeekRhythmInsights } from '@/lib/zhipu-image-parse';
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

const OPEN_LABEL: Record<ProfileWeekRhythmOpenHint, string> = {
  tasks: '去任务',
  review: '去复盘',
  'life-road': '去道路',
  'wish-board': '去心愿板',
};

export type AiWeekRhythmInsightsSheetProps = {
  visible: boolean;
  onClose: () => void;
  todayYmd: string;
  week?: Record<string, number | string | boolean | null>;
  roadFocusLine?: string | null;
  wishGapLine?: string | null;
  personaOneLiner?: string | null;
  onOpenHint?: (hint: ProfileWeekRhythmOpenHint) => void;
};

export function AiWeekRhythmInsightsSheet({
  visible,
  onClose,
  todayYmd,
  week,
  roadFocusLine,
  wishGapLine,
  personaOneLiner,
  onOpenHint,
}: AiWeekRhythmInsightsSheetProps) {
  const insets = useSafeAreaInsets();
  const { fold } = useFoldTheme();
  const styles = useMemo(() => createStyles(fold.pine), [fold.pine]);

  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ProfileWeekRhythmInsightsJson | null>(null);
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
      const r = await analyzeProfileWeekRhythmInsights({
        week,
        roadFocusLine: roadFocusLine ?? undefined,
        wishGapLine: wishGapLine ?? undefined,
        personaOneLiner: personaOneLiner ?? undefined,
        todayYmd,
      });
      if (!r.ok) {
        toast.error(r.error || '洞察生成失败');
        return;
      }
      setData(r.data);
      setFetched(true);
    } catch (e) {
      toast.error(toUserMessage(e, '洞察生成失败'));
    } finally {
      setLoading(false);
    }
  }, [personaOneLiner, roadFocusLine, todayYmd, week, wishGapLine]);

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
            <Text style={[styles.title, { fontFamily: foldFonts.serif }]}>本周节奏洞察</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Text style={styles.close}>关闭</Text>
            </Pressable>
          </View>
          <Text style={styles.sub}>只读建议 · 失败时仍可查看现有数字条</Text>

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

            {!loading && data?.suggestion ? (
              <Text style={styles.suggestion}>{data.suggestion}</Text>
            ) : null}

            {!loading &&
              data?.insights.map((ins, i) => (
                <View key={`${i}-${ins.title}`} style={styles.card}>
                  <Text style={styles.cardTitle}>{ins.title}</Text>
                  <Text style={styles.cardBody}>{ins.body}</Text>
                </View>
              ))}

            {!loading && data?.open_hint && onOpenHint ? (
              <Pressable
                style={styles.focusRow}
                onPress={() => {
                  const hint = data.open_hint;
                  if (!hint) return;
                  onOpenHint(hint);
                  onClose();
                }}>
                <Text style={styles.focusText}>{OPEN_LABEL[data.open_hint]} ›</Text>
              </Pressable>
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
    suggestion: {
      fontSize: 14,
      fontWeight: '700',
      color: accent,
      lineHeight: 20,
    },
    card: {
      padding: 12,
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: '#E0D6C4',
      backgroundColor: '#FFF',
      gap: 4,
    },
    cardTitle: { fontSize: 14, fontWeight: '800', color: '#2F3B32' },
    cardBody: { fontSize: 13, color: '#536155', lineHeight: 19 },
    focusRow: {
      paddingVertical: 10,
      paddingHorizontal: 10,
      borderRadius: 10,
      backgroundColor: '#F4F8F2',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: accent,
    },
    focusText: { fontSize: 14, fontWeight: '700', color: '#2F3B32' },
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
