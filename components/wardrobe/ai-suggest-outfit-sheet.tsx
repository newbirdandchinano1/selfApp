/**
 * 「AI 组一套」：库内单品组合草稿 → 拼图 seedItemIds（确认后才保存搭配）。
 */
import type { WardrobeItem, WardrobeOutfit } from '@/components/wardrobe/data';
import { useWardrobeTheme, wardrobeFonts, type WardrobePalette } from '@/constants/wardrobe-theme';
import type { WardrobeSuggestOutfitJson } from '@/lib/ai-api-client';
import { toast, toUserMessage } from '@/lib/app-feedback';
import {
  buildWardrobeItemAiSummaries,
  buildWardrobeOutfitAiSummaries,
  seasonHintFromFilter,
} from '@/lib/wardrobe-ai-context';
import { suggestWardrobeOutfit } from '@/lib/zhipu-image-parse';
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

export type AiSuggestOutfitSheetProps = {
  visible: boolean;
  onClose: () => void;
  items: WardrobeItem[];
  outfits: WardrobeOutfit[];
  occasion?: string;
  seasonFilter?: 'all' | 'ss' | 'aw' | string;
  seedItemIds?: string[];
  onOpenCollage: (seedItemIds: string[], meta?: { nameHint?: string; occasionHint?: string }) => void;
  onOpenOutfit?: (id: string) => void;
};

export function AiSuggestOutfitSheet({
  visible,
  onClose,
  items,
  outfits,
  occasion,
  seasonFilter = 'all',
  seedItemIds,
  onOpenCollage,
  onOpenOutfit,
}: AiSuggestOutfitSheetProps) {
  const insets = useSafeAreaInsets();
  const { w } = useWardrobeTheme();
  const styles = useMemo(() => createStyles(w), [w]);

  const [prefs, setPrefs] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<WardrobeSuggestOutfitJson | null>(null);
  const [fetched, setFetched] = useState(false);

  const seedNames = useMemo(() => {
    const ids = seedItemIds ?? [];
    return ids
      .map(id => items.find(i => i.id === id)?.name)
      .filter((n): n is string => Boolean(n));
  }, [items, seedItemIds]);

  useEffect(() => {
    if (!visible) {
      setPrefs('');
      setResult(null);
      setFetched(false);
      setLoading(false);
    }
  }, [visible]);

  const runSuggest = useCallback(async () => {
    if (!items.length) {
      toast.info('请先添加几件单品');
      return;
    }
    setLoading(true);
    try {
      const occ =
        occasion && occasion !== '全部' ? occasion : undefined;
      const r = await suggestWardrobeOutfit({
        occasion: occ,
        seasonHint: seasonHintFromFilter(seasonFilter),
        seedItemIds,
        items: buildWardrobeItemAiSummaries(items),
        outfits: buildWardrobeOutfitAiSummaries(outfits),
        preferences: prefs.trim() || undefined,
      });
      if (!r.ok) {
        toast.error(r.error || 'AI 组搭失败');
        return;
      }
      setResult(r.data);
      setFetched(true);
    } catch (e) {
      toast.error(toUserMessage(e, 'AI 组搭失败'));
    } finally {
      setLoading(false);
    }
  }, [items, outfits, occasion, prefs, seasonFilter, seedItemIds]);

  useEffect(() => {
    if (visible && !fetched && !loading && items.length > 0) {
      void runSuggest();
    }
  }, [visible, fetched, loading, items.length, runSuggest]);

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
            <Text style={styles.title}>AI 组一套</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Text style={styles.close}>关闭</Text>
            </Pressable>
          </View>
          <Text style={styles.sub}>
            {seedNames.length
              ? `围绕「${seedNames.join('、')}」从库内补齐搭配`
              : occasion && occasion !== '全部'
                ? `按场合「${occasion}」组合库内单品`
                : '按场合 / 季节从库内组合，确认后进拼图'}
          </Text>

          <TextInput
            style={styles.input}
            value={prefs}
            onChangeText={setPrefs}
            placeholder="可选偏好，如偏正式、少重复"
            placeholderTextColor={w.muted}
            editable={!loading}
          />

          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            showsVerticalScrollIndicator={false}>
            {loading ? (
              <View style={styles.loadingBox}>
                <ActivityIndicator color={w.pine} />
                <Text style={styles.loadingText}>正在组搭…</Text>
              </View>
            ) : null}

            {!loading && result ? (
              <View style={styles.card}>
                <Text style={styles.cardKicker}>草稿搭配</Text>
                <Text style={styles.cardTitle}>
                  {result.name_hint || '未命名搭配'}
                  {result.occasion_hint ? ` · ${result.occasion_hint}` : ''}
                </Text>
                <Text style={styles.cardItems}>
                  {result.itemIds.map(itemName).join(' · ')}
                </Text>
                {result.reason ? <Text style={styles.cardReason}>{result.reason}</Text> : null}
                {result.near_outfit_id ? (
                  <Pressable
                    onPress={() => {
                      if (onOpenOutfit) {
                        onOpenOutfit(result.near_outfit_id!);
                        onClose();
                      }
                    }}
                    disabled={!onOpenOutfit}>
                    <Text style={styles.nearText}>
                      接近已有：{result.near_outfit_name || result.near_outfit_id}
                    </Text>
                  </Pressable>
                ) : null}
                <Pressable
                  style={styles.btnPrimary}
                  onPress={() => {
                    onOpenCollage(result.itemIds, {
                      nameHint: result.name_hint || undefined,
                      occasionHint: result.occasion_hint || undefined,
                    });
                    onClose();
                  }}>
                  <Text style={styles.btnPrimaryText}>打开拼图编辑</Text>
                </Pressable>
              </View>
            ) : null}

            {!loading && fetched && !result ? (
              <Text style={styles.empty}>暂无候选</Text>
            ) : null}
          </ScrollView>

          <Pressable
            style={[styles.retryBtn, loading && styles.btnDisabled]}
            onPress={() => void runSuggest()}
            disabled={loading}>
            <Text style={styles.retryText}>{fetched ? '重新组搭' : '开始组搭'}</Text>
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
      marginBottom: 10,
      lineHeight: 18,
    },
    input: {
      borderWidth: 1,
      borderColor: w.line,
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontFamily: wardrobeFonts.sans,
      fontSize: 14,
      color: w.ink,
      backgroundColor: w.card,
      marginBottom: 12,
    },
    body: { flexGrow: 0 },
    bodyContent: { paddingBottom: 12 },
    loadingBox: { paddingVertical: 28, alignItems: 'center', gap: 10 },
    loadingText: { fontFamily: wardrobeFonts.sans, fontSize: 13, color: w.muted },
    card: {
      borderWidth: 1,
      borderColor: w.pine,
      borderRadius: 16,
      padding: 14,
      backgroundColor: w.paper2,
      gap: 6,
    },
    cardKicker: {
      fontFamily: wardrobeFonts.sans,
      fontSize: 11,
      letterSpacing: 0.6,
      color: w.muted,
    },
    cardTitle: {
      fontFamily: wardrobeFonts.sansSemiBold,
      fontSize: 16,
      color: w.ink,
    },
    cardItems: {
      fontFamily: wardrobeFonts.sans,
      fontSize: 14,
      color: w.ink2,
      lineHeight: 20,
    },
    cardReason: {
      fontFamily: wardrobeFonts.sans,
      fontSize: 13,
      color: w.ink2,
      lineHeight: 19,
    },
    nearText: {
      fontFamily: wardrobeFonts.sans,
      fontSize: 12,
      color: w.pine,
      marginTop: 2,
    },
    btnPrimary: {
      marginTop: 10,
      alignSelf: 'flex-start',
      paddingHorizontal: 14,
      paddingVertical: 9,
      borderRadius: 999,
      backgroundColor: w.pine,
    },
    btnPrimaryText: {
      fontFamily: wardrobeFonts.sansSemiBold,
      fontSize: 13,
      color: w.onPine,
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
