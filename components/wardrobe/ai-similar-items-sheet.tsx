/**
 * 库内找相似：只读候选 + 跳转单品，不自动改库。
 */
import type { WardrobeItem } from '@/components/wardrobe/data';
import { useWardrobeTheme, wardrobeFonts, type WardrobePalette } from '@/constants/wardrobe-theme';
import type { WardrobeSimilarItemJson } from '@/lib/ai-api-client';
import { toast, toUserMessage } from '@/lib/app-feedback';
import { buildWardrobeItemAiSummaries } from '@/lib/wardrobe-ai-context';
import { analyzeWardrobeSimilarItems } from '@/lib/zhipu-image-parse';
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

export type AiSimilarItemsSheetProps = {
  visible: boolean;
  onClose: () => void;
  items: WardrobeItem[];
  targetItemId: string | null;
  onOpenItem: (id: string) => void;
};

export function AiSimilarItemsSheet({
  visible,
  onClose,
  items,
  targetItemId,
  onOpenItem,
}: AiSimilarItemsSheetProps) {
  const insets = useSafeAreaInsets();
  const { w } = useWardrobeTheme();
  const styles = useMemo(() => createStyles(w), [w]);

  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<WardrobeSimilarItemJson[]>([]);
  const [fetched, setFetched] = useState(false);

  const target = useMemo(
    () => (targetItemId ? items.find(i => i.id === targetItemId) ?? null : null),
    [items, targetItemId],
  );

  useEffect(() => {
    if (!visible) {
      setRows([]);
      setFetched(false);
      setLoading(false);
    }
  }, [visible]);

  const runAnalyze = useCallback(async () => {
    if (!targetItemId || !target) {
      toast.info('请先打开一件单品');
      return;
    }
    if (items.length < 2) {
      toast.info('衣橱里再多几件单品再找相似');
      return;
    }
    setLoading(true);
    try {
      const r = await analyzeWardrobeSimilarItems({
        items: buildWardrobeItemAiSummaries(items),
        targetItemId,
        limit: 8,
      });
      if (!r.ok) {
        toast.error(r.error || '查找失败');
        return;
      }
      setRows(r.data.similar);
      setFetched(true);
    } catch (e) {
      toast.error(toUserMessage(e, '查找失败'));
    } finally {
      setLoading(false);
    }
  }, [items, target, targetItemId]);

  useEffect(() => {
    if (visible && targetItemId && !fetched && !loading) {
      void runAnalyze();
    }
  }, [visible, targetItemId, fetched, loading, runAnalyze]);

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
            <Text style={styles.title}>找相似</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Text style={styles.close}>关闭</Text>
            </Pressable>
          </View>
          <Text style={styles.sub}>
            {target ? `基于「${target.name}」在库内推荐` : '库内相似单品'}
          </Text>

          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            showsVerticalScrollIndicator={false}>
            {loading ? (
              <View style={styles.loadingBox}>
                <ActivityIndicator color={w.pine} />
                <Text style={styles.loadingText}>查找中…</Text>
              </View>
            ) : null}

            {!loading && rows.length ? (
              <View style={styles.block}>
                {rows.map(row => (
                  <Pressable
                    key={row.item_id}
                    style={styles.itemRow}
                    onPress={() => {
                      onOpenItem(row.item_id);
                      onClose();
                    }}>
                    <View style={styles.itemCopy}>
                      <Text style={styles.itemName}>{itemName(row.item_id)}</Text>
                      {row.reason ? <Text style={styles.itemReason}>{row.reason}</Text> : null}
                    </View>
                    <Text style={styles.itemGo}>查看</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}

            {!loading && fetched && !rows.length ? (
              <Text style={styles.empty}>暂无相似单品</Text>
            ) : null}
          </ScrollView>

          <Pressable
            style={[styles.retryBtn, loading && styles.btnDisabled]}
            onPress={() => void runAnalyze()}
            disabled={loading}>
            <Text style={styles.retryText}>{fetched ? '重新查找' : '开始查找'}</Text>
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
      paddingHorizontal: 12,
      backgroundColor: w.card,
    },
    itemRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 12,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: w.line,
    },
    itemCopy: { flex: 1, paddingRight: 8, gap: 2 },
    itemName: {
      fontFamily: wardrobeFonts.sans,
      fontSize: 14,
      color: w.ink,
    },
    itemReason: {
      fontFamily: wardrobeFonts.sans,
      fontSize: 12,
      color: w.muted,
      lineHeight: 17,
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
