/**
 * 「今天穿什么」AI 候选 Sheet：只读推荐，确认后走现有 wear / 打开详情 / 拼图种子。
 */
import type { WardrobeItem, WardrobeOutfit } from '@/components/wardrobe/data';
import { useWardrobeTheme, wardrobeFonts, type WardrobePalette } from '@/constants/wardrobe-theme';
import type { WardrobeSuggestTodayAltJson, WardrobeSuggestTodayJson } from '@/lib/ai-api-client';
import { toast, toUserMessage } from '@/lib/app-feedback';
import {
  buildWardrobeItemAiSummaries,
  buildWardrobeOutfitAiSummaries,
  guessRecentlyWornItemIds,
  seasonHintFromFilter,
  todayYmdLocal,
} from '@/lib/wardrobe-ai-context';
import { suggestWardrobeToday } from '@/lib/zhipu-image-parse';
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

export type AiSuggestTodaySheetProps = {
  visible: boolean;
  onClose: () => void;
  items: WardrobeItem[];
  outfits: WardrobeOutfit[];
  seasonFilter?: 'all' | 'ss' | 'aw' | string;
  onOpenOutfit: (id: string) => void;
  onOpenItem: (id: string) => void;
  onWearOutfit: (id: string) => void;
  onWearItems?: (ids: string[]) => void;
  onSeedCollage?: (itemIds: string[]) => void;
};

type Candidate = {
  key: string;
  mode: 'outfit' | 'items';
  outfitId?: string;
  outfitName?: string;
  itemIds: string[];
  reason: string;
  primary: boolean;
};

function toCandidates(data: WardrobeSuggestTodayJson): Candidate[] {
  const out: Candidate[] = [];
  const push = (row: WardrobeSuggestTodayAltJson | WardrobeSuggestTodayJson, primary: boolean, idx: number) => {
    const mode = row.mode === 'outfit' ? 'outfit' : 'items';
    if (mode === 'outfit') {
      const oid = (row.outfitId ?? '').trim();
      if (!oid) return;
      out.push({
        key: `outfit:${oid}:${idx}`,
        mode: 'outfit',
        outfitId: oid,
        outfitName: (row.outfitName ?? '').trim() || undefined,
        itemIds: [],
        reason: (row.reason ?? '').trim(),
        primary,
      });
      return;
    }
    const ids = (row.itemIds ?? []).filter(Boolean);
    if (!ids.length) return;
    out.push({
      key: `items:${ids.join(',')}:${idx}`,
      mode: 'items',
      itemIds: ids,
      reason: (row.reason ?? '').trim(),
      primary,
    });
  };
  push(data, true, 0);
  (data.alternatives ?? []).forEach((alt, i) => push(alt, false, i + 1));
  return out;
}

export function AiSuggestTodaySheet({
  visible,
  onClose,
  items,
  outfits,
  seasonFilter = 'all',
  onOpenOutfit,
  onOpenItem,
  onWearOutfit,
  onWearItems,
  onSeedCollage,
}: AiSuggestTodaySheetProps) {
  const insets = useSafeAreaInsets();
  const { w } = useWardrobeTheme();
  const styles = useMemo(() => createStyles(w), [w]);

  const [loading, setLoading] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [fetched, setFetched] = useState(false);

  useEffect(() => {
    if (!visible) {
      setCandidates([]);
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
      const r = await suggestWardrobeToday({
        todayYmd: todayYmdLocal(),
        seasonHint: seasonHintFromFilter(seasonFilter),
        items: buildWardrobeItemAiSummaries(items),
        outfits: buildWardrobeOutfitAiSummaries(outfits),
        recentlyWornItemIds: guessRecentlyWornItemIds(items),
        avoidRepeat: true,
      });
      if (!r.ok) {
        toast.error(r.error || 'AI 推荐失败');
        return;
      }
      const next = toCandidates(r.data);
      setCandidates(next);
      setFetched(true);
      if (!next.length) toast.info('暂无合适推荐，可稍后再试');
    } catch (e) {
      toast.error(toUserMessage(e, 'AI 推荐失败'));
    } finally {
      setLoading(false);
    }
  }, [items, outfits, seasonFilter]);

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
            <Text style={styles.title}>今天穿什么</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Text style={styles.close}>关闭</Text>
            </Pressable>
          </View>
          <Text style={styles.sub}>从你的衣橱里挑，确认后再记录穿着</Text>

          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            showsVerticalScrollIndicator={false}>
            {loading ? (
              <View style={styles.loadingBox}>
                <ActivityIndicator color={w.pine} />
                <Text style={styles.loadingText}>正在搭配…</Text>
              </View>
            ) : null}

            {!loading &&
              candidates.map(c => (
                <View key={c.key} style={[styles.card, c.primary && styles.cardPrimary]}>
                  <Text style={styles.cardKicker}>{c.primary ? '推荐' : '备选'} · {c.mode === 'outfit' ? '已有搭配' : '单品组合'}</Text>
                  {c.mode === 'outfit' ? (
                    <Text style={styles.cardTitle}>{c.outfitName || '未命名搭配'}</Text>
                  ) : (
                    <Text style={styles.cardTitle}>
                      {c.itemIds.map(itemName).join(' · ')}
                    </Text>
                  )}
                  {c.reason ? <Text style={styles.cardReason}>{c.reason}</Text> : null}
                  <View style={styles.actions}>
                    {c.mode === 'outfit' && c.outfitId ? (
                      <>
                        <Pressable
                          style={styles.btnGhost}
                          onPress={() => {
                            onOpenOutfit(c.outfitId!);
                            onClose();
                          }}>
                          <Text style={styles.btnGhostText}>查看</Text>
                        </Pressable>
                        <Pressable
                          style={styles.btnPrimary}
                          onPress={() => {
                            onWearOutfit(c.outfitId!);
                            onClose();
                          }}>
                          <Text style={styles.btnPrimaryText}>穿这套</Text>
                        </Pressable>
                      </>
                    ) : (
                      <>
                        {c.itemIds[0] ? (
                          <Pressable
                            style={styles.btnGhost}
                            onPress={() => {
                              onOpenItem(c.itemIds[0]!);
                              onClose();
                            }}>
                            <Text style={styles.btnGhostText}>看首件</Text>
                          </Pressable>
                        ) : null}
                        {onSeedCollage ? (
                          <Pressable
                            style={styles.btnGhost}
                            onPress={() => {
                              onSeedCollage(c.itemIds);
                              onClose();
                            }}>
                            <Text style={styles.btnGhostText}>生成拼图</Text>
                          </Pressable>
                        ) : null}
                        {onWearItems ? (
                          <Pressable
                            style={styles.btnPrimary}
                            onPress={() => {
                              onWearItems(c.itemIds);
                              onClose();
                            }}>
                            <Text style={styles.btnPrimaryText}>穿这些</Text>
                          </Pressable>
                        ) : null}
                      </>
                    )}
                  </View>
                </View>
              ))}

            {!loading && fetched && candidates.length === 0 ? (
              <Text style={styles.empty}>暂无候选</Text>
            ) : null}
          </ScrollView>

          <Pressable
            style={[styles.retryBtn, loading && styles.btnDisabled]}
            onPress={() => void runSuggest()}
            disabled={loading}>
            <Text style={styles.retryText}>{fetched ? '重新推荐' : '开始推荐'}</Text>
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
    title: {
      fontFamily: wardrobeFonts.serif,
      fontSize: 22,
      color: w.ink,
    },
    close: {
      fontFamily: wardrobeFonts.sans,
      fontSize: 14,
      color: w.muted,
    },
    sub: {
      fontFamily: wardrobeFonts.sans,
      fontSize: 13,
      color: w.muted,
      marginBottom: 12,
    },
    body: { flexGrow: 0 },
    bodyContent: { paddingBottom: 12, gap: 10 },
    loadingBox: {
      paddingVertical: 28,
      alignItems: 'center',
      gap: 10,
    },
    loadingText: {
      fontFamily: wardrobeFonts.sans,
      fontSize: 13,
      color: w.muted,
    },
    card: {
      borderWidth: 1,
      borderColor: w.line,
      borderRadius: 16,
      padding: 14,
      backgroundColor: w.card,
      gap: 6,
    },
    cardPrimary: {
      borderColor: w.pine,
      backgroundColor: w.paper2,
    },
    cardKicker: {
      fontFamily: wardrobeFonts.sans,
      fontSize: 11,
      letterSpacing: 0.6,
      color: w.muted,
      textTransform: 'uppercase',
    },
    cardTitle: {
      fontFamily: wardrobeFonts.sansSemiBold,
      fontSize: 16,
      color: w.ink,
      lineHeight: 22,
    },
    cardReason: {
      fontFamily: wardrobeFonts.sans,
      fontSize: 13,
      color: w.ink2,
      lineHeight: 19,
    },
    actions: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginTop: 8,
    },
    btnGhost: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: w.line,
      backgroundColor: w.paper,
    },
    btnGhostText: {
      fontFamily: wardrobeFonts.sansSemiBold,
      fontSize: 13,
      color: w.ink2,
    },
    btnPrimary: {
      paddingHorizontal: 14,
      paddingVertical: 8,
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
