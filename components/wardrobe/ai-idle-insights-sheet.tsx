/**
 * 闲置 / 少穿洞察：只读 tips + 跳转单品，不自动删改。
 */
import type { WardrobeItem } from '@/components/wardrobe/data';
import { useWardrobeTheme, wardrobeFonts, type WardrobePalette } from '@/constants/wardrobe-theme';
import type { WardrobeIdleInsightsJson } from '@/lib/ai-api-client';
import { toast, toUserMessage } from '@/lib/app-feedback';
import { buildWardrobeItemAiSummaries } from '@/lib/wardrobe-ai-context';
import { analyzeWardrobeIdleInsights } from '@/lib/zhipu-image-parse';
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

export type AiIdleInsightsSheetProps = {
  visible: boolean;
  onClose: () => void;
  items: WardrobeItem[];
  categoryNames?: string[];
  wornThisMonth?: number;
  onOpenItem: (id: string) => void;
};

export function AiIdleInsightsSheet({
  visible,
  onClose,
  items,
  categoryNames,
  wornThisMonth,
  onOpenItem,
}: AiIdleInsightsSheetProps) {
  const insets = useSafeAreaInsets();
  const { w } = useWardrobeTheme();
  const styles = useMemo(() => createStyles(w), [w]);

  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<WardrobeIdleInsightsJson | null>(null);
  const [fetched, setFetched] = useState(false);

  useEffect(() => {
    if (!visible) {
      setData(null);
      setFetched(false);
      setLoading(false);
    }
  }, [visible]);

  const runAnalyze = useCallback(async () => {
    if (!items.length) {
      toast.info('请先添加几件单品');
      return;
    }
    setLoading(true);
    try {
      const neverWorn = items.filter(i => !(i.wear > 0)).length;
      const wearSummary90d =
        typeof wornThisMonth === 'number'
          ? `本月穿过约 ${wornThisMonth} 件；零穿着约 ${neverWorn} 件`
          : undefined;
      const r = await analyzeWardrobeIdleInsights({
        items: buildWardrobeItemAiSummaries(items),
        categoryNames,
        wearSummary90d,
        limit: 8,
      });
      if (!r.ok) {
        toast.error(r.error || '洞察失败');
        return;
      }
      setData(r.data);
      setFetched(true);
    } catch (e) {
      toast.error(toUserMessage(e, '洞察失败'));
    } finally {
      setLoading(false);
    }
  }, [categoryNames, items, wornThisMonth]);

  useEffect(() => {
    if (visible && !fetched && !loading && items.length > 0) {
      void runAnalyze();
    }
  }, [visible, fetched, loading, items.length, runAnalyze]);

  const itemName = useCallback(
    (id: string) => items.find(i => i.id === id)?.name ?? id,
    [items],
  );

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <View style={styles.handle} />
          <View style={styles.head}>
            <Text style={styles.title}>闲置洞察</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Text style={styles.close}>关闭</Text>
            </Pressable>
          </View>
          <Text style={styles.sub}>只读建议，不会自动删改单品</Text>

          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            showsVerticalScrollIndicator={false}>
            {loading ? (
              <View style={styles.loadingBox}>
                <ActivityIndicator color={w.pine} />
                <Text style={styles.loadingText}>分析中…</Text>
              </View>
            ) : null}

            {!loading && data ? (
              <>
                {data.tips.length ? (
                  <View style={styles.block}>
                    <Text style={styles.blockTitle}>建议</Text>
                    {data.tips.map((t, i) => (
                      <Text key={`${i}-${t}`} style={styles.tip}>
                        · {t}
                      </Text>
                    ))}
                  </View>
                ) : null}

                {data.idle_item_ids.length ? (
                  <View style={styles.block}>
                    <Text style={styles.blockTitle}>少穿 / 闲置</Text>
                    {data.idle_item_ids.map(id => (
                      <Pressable
                        key={id}
                        style={styles.itemRow}
                        onPress={() => {
                          onOpenItem(id);
                          onClose();
                        }}>
                        <Text style={styles.itemName}>{itemName(id)}</Text>
                        <Text style={styles.itemGo}>查看</Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}

                {data.capsule_gaps.length ? (
                  <View style={styles.block}>
                    <Text style={styles.blockTitle}>胶囊缺口</Text>
                    {data.capsule_gaps.map((g, i) => (
                      <Text key={`${i}-${g}`} style={styles.tip}>
                        · {g}
                      </Text>
                    ))}
                  </View>
                ) : null}
              </>
            ) : null}

            {!loading && fetched && !data ? (
              <Text style={styles.empty}>暂无洞察</Text>
            ) : null}
          </ScrollView>

          <Pressable
            style={[styles.retryBtn, loading && styles.btnDisabled]}
            onPress={() => void runAnalyze()}
            disabled={loading}>
            <Text style={styles.retryText}>{fetched ? '重新分析' : '开始分析'}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function createStyles(w: WardrobePalette) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(20,28,26,0.42)',
      justifyContent: 'flex-end',
    },
    sheet: {
      backgroundColor: w.paper,
      borderTopLeftRadius: 22,
      borderTopRightRadius: 22,
      paddingHorizontal: 18,
      paddingTop: 10,
      maxHeight: '82%',
    },
    handle: {
      alignSelf: 'center',
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor: w.line2,
      marginBottom: 10,
    },
    head: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 4,
    },
    title: { fontFamily: wardrobeFonts.serif, fontSize: 22, color: w.ink },
    close: { fontFamily: wardrobeFonts.sans, fontSize: 14, color: w.muted },
    sub: {
      fontFamily: wardrobeFonts.sans,
      fontSize: 13,
      color: w.muted,
      marginBottom: 12,
    },
    body: { flexGrow: 0 },
    bodyContent: { paddingBottom: 12, gap: 12 },
    loadingBox: { paddingVertical: 28, alignItems: 'center', gap: 10 },
    loadingText: { fontFamily: wardrobeFonts.sans, fontSize: 13, color: w.muted },
    block: {
      borderWidth: 1,
      borderColor: w.line,
      borderRadius: 14,
      padding: 12,
      backgroundColor: w.card,
      gap: 6,
    },
    blockTitle: {
      fontFamily: wardrobeFonts.sansSemiBold,
      fontSize: 14,
      color: w.ink,
      marginBottom: 2,
    },
    tip: {
      fontFamily: wardrobeFonts.sans,
      fontSize: 13,
      color: w.ink2,
      lineHeight: 19,
    },
    itemRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 8,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: w.line,
    },
    itemName: {
      flex: 1,
      fontFamily: wardrobeFonts.sans,
      fontSize: 14,
      color: w.ink,
      paddingRight: 8,
    },
    itemGo: {
      fontFamily: wardrobeFonts.sansSemiBold,
      fontSize: 13,
      color: w.pine,
    },
    empty: {
      textAlign: 'center',
      paddingVertical: 24,
      fontFamily: wardrobeFonts.sans,
      color: w.muted,
    },
    retryBtn: {
      marginTop: 4,
      alignItems: 'center',
      paddingVertical: 14,
      borderRadius: 14,
      backgroundColor: w.paper2,
      borderWidth: 1,
      borderColor: w.line,
    },
    retryText: {
      fontFamily: wardrobeFonts.sansSemiBold,
      fontSize: 14,
      color: w.pine,
    },
    btnDisabled: { opacity: 0.55 },
  });
}
