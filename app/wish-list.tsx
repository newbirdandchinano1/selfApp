import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { deleteWishItem, listWishItems } from '@/lib/repositories/wish-list/wish-list';
import type { WishItemRow } from '@/lib/repositories/wish-list/wish-list.types';
import {
  clearWishListRationalAiCache,
  computeWishListRationalFingerprint,
  getWishListRationalAiCache,
  saveWishListRationalAiCache,
} from '@/lib/repositories/wish-list/wish-list-rational-ai-cache';
import { analyzeWishListRationalReviewFromText, getZhipuApiKey } from '@/lib/zhipu-image-parse';
import { MaterialIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

const quarterTarget = 120_000;

function formatCny(value: number): string {
  return `¥ ${value.toLocaleString('zh-CN')}`;
}

function desireLevelLabel(level: number): string {
  if (level >= 5) return '欲望等级 5 · 心之所向';
  if (level >= 4) return '欲望等级 4';
  if (level >= 3) return '欲望等级 3';
  if (level >= 2) return '欲望等级 2';
  return '欲望等级 1 · 理智购买';
}

function subtitleForRow(row: WishItemRow): string {
  if (row.category_label?.trim()) return row.category_label.trim();
  if (row.reason?.trim()) {
    const one = row.reason.trim().split(/\n/)[0];
    return one.length > 36 ? `${one.slice(0, 36)}…` : one;
  }
  return '未填写类别与理由';
}

function buildWishListAiContextText(rows: WishItemRow[], quarterGoal: number, totalPrice: number): string {
  const lines = rows.map((row, idx) => {
    const cat = row.category_label?.trim() || '未分类';
    const reason = row.reason?.trim().replace(/\s+/g, ' ') ?? '';
    const reasonShort = reason.length > 120 ? `${reason.slice(0, 117)}…` : reason;
    return `${idx + 1}. ${row.name}｜预估 ¥${row.price}｜欲望 ${row.desire_level}/5｜${cat}${reasonShort ? `｜理由：${reasonShort}` : ''}`;
  });
  return [
    `参考季度目标金额：¥${quarterGoal.toLocaleString('zh-CN')}（用于理解「占 Q 目标比例」等语境，非强制预算）`,
    `清单共 ${rows.length} 条，总预估支出 ¥${totalPrice.toLocaleString('zh-CN')}`,
    '',
    '条目明细：',
    ...lines,
  ].join('\n');
}

export default function WishListScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const scheme = (colorScheme ?? 'light') as 'light' | 'dark';
  const theme = Colors[scheme];
  const isDark = colorScheme === 'dark';

  const [items, setItems] = useState<WishItemRow[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const zhipuReady = Boolean(getZhipuApiKey().trim());
  /** 大于 0 时表示用户点击了「刷新 AI 评审」，须强制走网络并写库。 */
  const [rationalRefreshToken, setRationalRefreshToken] = useState(0);
  const [aiHeadline, setAiHeadline] = useState<string | null>(null);
  const [aiReview, setAiReview] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const rationalRunRef = useRef(0);

  const reload = useCallback(async () => {
    setLoadError(null);
    try {
      const rows = await listWishItems();
      setItems(rows);
    } catch {
      setLoadError('加载失败，请点击重试');
      setItems([]);
    } finally {
      setInitialLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload])
  );

  const bg = isDark ? theme.background : '#faf8ff';
  const cardBg = isDark ? '#111827' : '#ffffff';
  const cardSoft = isDark ? '#1f2937' : '#f2f3ff';
  const text = isDark ? theme.text : '#131b2e';
  const outline = isDark ? 'rgba(148,163,184,0.9)' : '#424754';
  const tertiary = isDark ? '#fbbf24' : '#825100';
  const primary = isDark ? '#60a5fa' : '#0058be';
  const borderSoft = isDark ? 'rgba(148,163,184,0.2)' : 'rgba(194,198,214,0.25)';

  const summary = useMemo(() => {
    const total = items.reduce((sum, row) => sum + (Number.isFinite(row.price) ? row.price : 0), 0);
    const progress = quarterTarget > 0 ? Math.min(999, Math.round((total / quarterTarget) * 100)) : 0;
    return { total, progress };
  }, [items]);

  const topDesireName = useMemo(() => {
    const sorted = [...items].sort((a, b) => b.desire_level - a.desire_level || b.price - a.price);
    return sorted[0]?.name ?? null;
  }, [items]);

  const wishListAiContextText = useMemo(() => {
    if (items.length === 0) return '';
    const total = items.reduce((sum, row) => sum + (Number.isFinite(row.price) ? row.price : 0), 0);
    return buildWishListAiContextText(items, quarterTarget, total);
  }, [items]);

  const wishListFp = useMemo(() => computeWishListRationalFingerprint(items), [items]);

  useEffect(() => {
    if (initialLoading) return;

    const reqId = ++rationalRunRef.current;

    void (async () => {
      if (rationalRunRef.current !== reqId) return;

      if (items.length === 0) {
        setAiHeadline(null);
        setAiReview(null);
        setAiError(null);
        setAiLoading(false);
        await clearWishListRationalAiCache();
        if (rationalRunRef.current !== reqId) return;
        setRationalRefreshToken(0);
        return;
      }

      const fp = wishListFp;
      const cached = await getWishListRationalAiCache();
      if (rationalRunRef.current !== reqId) return;

      const forceNetwork = rationalRefreshToken > 0;
      const cacheHit = Boolean(cached && cached.fingerprint === fp && !forceNetwork);
      if (cacheHit && cached) {
        setAiHeadline(cached.headline?.trim() || null);
        setAiReview(cached.review?.trim() || null);
        setAiError(null);
        setAiLoading(false);
        return;
      }

      const key = getZhipuApiKey().trim();
      if (!key) {
        setAiHeadline(null);
        setAiReview(null);
        setAiError(null);
        setAiLoading(false);
        setRationalRefreshToken(0);
        return;
      }

      const ctx = wishListAiContextText.trim();
      if (!ctx) {
        setAiLoading(false);
        setRationalRefreshToken(0);
        return;
      }

      setAiLoading(true);
      setAiError(null);

      const r = await analyzeWishListRationalReviewFromText({ apiKey: key, contextText: ctx });
      if (rationalRunRef.current !== reqId) return;
      setAiLoading(false);

      if (!r.ok) {
        setAiError(r.error);
        setAiHeadline(null);
        setAiReview(null);
        setRationalRefreshToken(0);
        return;
      }

      setAiHeadline(r.headline);
      setAiReview(r.review);
      await saveWishListRationalAiCache({
        fingerprint: fp,
        headline: r.headline,
        review: r.review,
      });
      if (rationalRunRef.current !== reqId) return;
      setRationalRefreshToken(0);
    })();
  }, [initialLoading, wishListFp, items.length, wishListAiContextText, zhipuReady, rationalRefreshToken]);

  const bumpAiRefresh = useCallback(() => {
    setRationalRefreshToken(t => t + 1);
  }, []);

  const aiHeadingDisplay = useMemo(() => {
    if (items.length === 0) return '从添加第一条开始';
    if (aiHeadline?.trim()) return aiHeadline.trim();
    return topDesireName ? '关注高欲望单品' : '建议策略性延后';
  }, [items.length, aiHeadline, topDesireName]);

  const showAiPending =
    zhipuReady && items.length > 0 && (aiLoading || (!aiHeadline && !aiReview && !aiError));

  const requestDeleteWish = useCallback(
    (row: WishItemRow) => {
      Alert.alert('删除心愿', `确定删除「${row.name}」？此操作不可恢复。`, [
        { text: '取消', style: 'cancel' },
        {
          text: '删除',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                await deleteWishItem(row.id);
                setItems(prev => prev.filter(i => i.id !== row.id));
              } catch {
                Alert.alert('删除失败', '请稍后重试');
              }
            })();
          },
        },
      ]);
    },
    [],
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: bg }]} edges={['left', 'right', 'top']}>
      <View
        style={[
          styles.topBar,
          {
            paddingTop: Math.max(insets.top, 10) + 6,
            backgroundColor: isDark ? 'rgba(17,24,39,0.8)' : 'rgba(255,255,255,0.8)',
            borderBottomColor: borderSoft,
          },
        ]}>
        <Pressable style={styles.roundIconBtn} onPress={() => router.back()}>
          <MaterialIcons name="arrow-back-ios-new" size={20} color={primary} />
        </Pressable>
        <Text style={[styles.topBarTitle, { color: text }]}>量化生活清单</Text>
        <View style={styles.topBarRightSpacer} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: Math.max(insets.bottom, 12) + 100 }]}>
        <View style={styles.hero}>
          <Text style={[styles.heroTitle, { color: text }]}>欲望清单</Text>
          <Text style={[styles.heroSub, { color: outline }]}>精选心头好与理性消费计划。</Text>
        </View>

        {initialLoading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator size="large" color={primary} />
          </View>
        ) : null}

        {loadError ? (
          <Pressable onPress={() => void reload()} style={[styles.errorBanner, { borderColor: borderSoft }]}>
            <Text style={[styles.errorText, { color: text }]}>{loadError}</Text>
            <Text style={[styles.errorRetry, { color: primary }]}>点击重试</Text>
          </Pressable>
        ) : null}

        <View style={[styles.summaryCard, { backgroundColor: cardBg }]}>
          <View style={[styles.summaryGlow, { backgroundColor: `${tertiary}14` }]} />
          <View>
            <Text style={[styles.summaryLabel, { color: outline }]}>总预估支出</Text>
            <Text style={[styles.summaryTotal, { color: tertiary }]}>{formatCny(summary.total)}</Text>
          </View>
          <View style={[styles.progressPill, { backgroundColor: `${tertiary}1F` }]}>
            <MaterialIcons name="trending-up" size={20} color={tertiary} />
            <Text style={[styles.progressPillText, { color: tertiary }]}>占Q3目标的{summary.progress}%</Text>
          </View>
        </View>

        <View style={[styles.aiReviewCard, { backgroundColor: cardSoft }]}>
          <View style={[styles.aiDecor, { backgroundColor: `${primary}12` }]} />
          <View style={styles.aiHead}>
            <View style={styles.aiKickerRow}>
              <MaterialIcons name="auto-awesome" size={18} color={primary} />
              <Text style={[styles.aiKicker, { color: primary }]}>AI 理性评审</Text>
            </View>
            <Text style={[styles.aiHeading, { color: text }]}>{aiHeadingDisplay}</Text>
          </View>
          <View style={[styles.aiBody, { borderTopColor: borderSoft }]}>
            {items.length === 0 ? (
              <Text style={[styles.aiText, { color: outline }]}>
                清单为空时暂无消费压力分析。点击右下角添加好物，数据将来自本地数据库。
              </Text>
            ) : (
              <>
                {aiReview?.trim() ? (
                  <Text style={[styles.aiText, { color: outline }]}>{aiReview.trim()}</Text>
                ) : (
                  <>
                    <Text style={[styles.aiText, { color: outline }]}>
                      当前共
                      <Text style={[styles.aiTextStrong, { color: text }]}> {items.length} </Text>
                      条心愿，总预估
                      <Text style={[styles.aiTextStrong, { color: text }]}> {formatCny(summary.total)} </Text>
                      。
                      {topDesireName ? (
                        <>
                          {' '}
                          其中<Text style={[styles.aiTextStrong, { color: text }]}> {topDesireName} </Text>
                          欲望等级较高，可优先评估必要性再下单。
                        </>
                      ) : null}
                    </Text>
                    {showAiPending ? (
                      <View style={styles.aiPendingRow}>
                        <ActivityIndicator size="small" color={primary} />
                        <Text style={[styles.aiPendingText, { color: outline }]}>正在请求智谱 GLM…</Text>
                      </View>
                    ) : null}
                    {aiError ? (
                      <Text style={[styles.aiText, { color: '#b45309' }]}>
                        生成失败：{aiError}。可点击「刷新 AI 评审」重试。
                      </Text>
                    ) : null}
                  </>
                )}

                {!zhipuReady ? (
                  <Text style={[styles.aiText, { color: outline }]}>
                    <Text style={[styles.aiAdviceTag, { color: primary }]}>提示：</Text>
                    配置智谱 API 密钥（EXPO_PUBLIC_ZHIPU_API_KEY）后，可由模型根据上文明细生成理性消费评审，与记账、备忘等能力共用同一密钥。
                  </Text>
                ) : null}

                {aiReview?.trim() ? (
                  <Text style={[styles.aiText, { color: outline }]}>
                    <Text style={[styles.aiAdviceTag, { color: primary }]}>说明：</Text>
                    内容由智谱模型根据本地清单生成，仅供自我观察参考，不构成消费或投资建议。
                  </Text>
                ) : null}

                {zhipuReady && items.length > 0 ? (
                  <Pressable
                    onPress={() => bumpAiRefresh()}
                    disabled={aiLoading}
                    style={({ pressed }) => [
                      styles.aiRefreshBtn,
                      {
                        borderColor: borderSoft,
                        backgroundColor: isDark ? 'rgba(30,41,59,0.6)' : 'rgba(255,255,255,0.75)',
                        opacity: aiLoading ? 0.55 : pressed ? 0.88 : 1,
                      },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel="刷新 AI 理性评审">
                    <MaterialIcons name="refresh" size={18} color={primary} />
                    <Text style={[styles.aiRefreshBtnText, { color: primary }]}>
                      {aiLoading ? '刷新中…' : '刷新 AI 评审'}
                    </Text>
                  </Pressable>
                ) : null}
              </>
            )}
          </View>
        </View>

        <View style={styles.listSection}>
          <View style={styles.listKickerRow}>
            <Text style={[styles.listKicker, { color: outline }]}>目标好物</Text>
            <Text style={[styles.listSwipeHint, { color: outline }]}>左滑删除</Text>
          </View>
          {!initialLoading && items.length === 0 ? (
            <View style={[styles.emptyCard, { backgroundColor: cardBg, borderColor: borderSoft }]}>
              <MaterialIcons name="redeem" size={40} color={outline} />
              <Text style={[styles.emptyTitle, { color: text }]}>还没有心愿条目</Text>
              <Text style={[styles.emptySub, { color: outline }]}>保存的条目会显示在这里</Text>
            </View>
          ) : null}
          {items.map(row => {
            const highlighted = row.desire_level >= 4;
            const thumb = row.reference_image_uri;
            return (
              <Swipeable
                key={row.id}
                overshootRight={false}
                rightThreshold={48}
                renderRightActions={() => (
                  <Pressable
                    onPress={() => requestDeleteWish(row)}
                    style={({ pressed }) => [styles.swipeDeleteAction, pressed && { opacity: 0.92 }]}
                    accessibilityRole="button"
                    accessibilityLabel={`删除 ${row.name}`}
                  >
                    <MaterialIcons name="delete-outline" size={24} color="#fff" />
                    <Text style={styles.swipeDeleteText}>删除</Text>
                  </Pressable>
                )}
              >
                <Pressable
                  onPress={() => router.push({ pathname: '/edit-wish-item/[id]', params: { id: row.id } })}
                  style={({ pressed }) => [{ opacity: pressed ? 0.92 : 1 }]}
                >
                  <View
                    style={[
                      styles.itemCard,
                      {
                        backgroundColor: cardBg,
                        borderLeftColor: highlighted ? primary : 'transparent',
                        borderLeftWidth: highlighted ? 4 : 0,
                      },
                    ]}>
                    <View style={styles.itemMainRow}>
                      <View style={[styles.itemIconWrap, { backgroundColor: cardSoft }]}>
                        {thumb ? (
                          <Image source={{ uri: thumb }} style={styles.itemThumb} contentFit="cover" transition={150} />
                        ) : (
                          <MaterialIcons name="card-giftcard" size={28} color={text} />
                        )}
                      </View>
                      <View style={styles.itemContent}>
                        <View style={styles.itemTextWrap}>
                          <Text style={[styles.itemName, { color: text }]}>{row.name}</Text>
                          <Text style={[styles.itemSubtitle, { color: outline }]} numberOfLines={2}>
                            {subtitleForRow(row)}
                          </Text>
                        </View>
                        <View style={styles.itemPriceWrap}>
                          <Text style={[styles.itemPrice, { color: tertiary }]}>{formatCny(row.price)}</Text>
                          <Text
                            style={[styles.itemPriority, { color: highlighted ? primary : outline }]}
                            numberOfLines={1}>
                            {desireLevelLabel(row.desire_level)}
                          </Text>
                        </View>
                      </View>
                    </View>
                    {row.ai_comment?.trim() ? (
                      <View
                        style={[
                          styles.itemAiFooter,
                          {
                            borderTopColor: borderSoft,
                            backgroundColor: isDark ? 'rgba(30,41,59,0.5)' : 'rgba(99,102,241,0.07)',
                          },
                        ]}>
                        <View style={styles.itemAiKickerRow}>
                          <MaterialIcons name="auto-awesome" size={14} color={primary} />
                          <Text style={[styles.itemAiKicker, { color: primary }]}>AI 评价</Text>
                        </View>
                        <Text style={[styles.itemAiBody, { color: outline }]}>{row.ai_comment.trim()}</Text>
                      </View>
                    ) : null}
                  </View>
                </Pressable>
              </Swipeable>
            );
          })}
        </View>
      </ScrollView>

      <Pressable
        onPress={() => router.push('/add-wish-item')}
        style={[
          styles.fab,
          {
            bottom: Math.max(insets.bottom, 12) + 12,
            backgroundColor: primary,
            shadowColor: '#131b2e',
          },
        ]}>
        <MaterialIcons name="add" size={20} color="#fff" />
        <Text style={styles.fabText}>添加新项目</Text>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  roundIconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topBarTitle: {
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: -0.4,
  },
  topBarRightSpacer: {
    width: 36,
    height: 36,
  },
  scrollContent: {
    maxWidth: 900,
    width: '100%',
    alignSelf: 'center',
    paddingHorizontal: 22,
    paddingTop: 132,
    gap: 18,
  },
  loadingWrap: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  errorBanner: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    gap: 6,
  },
  errorText: {
    fontSize: 14,
    fontWeight: '600',
  },
  errorRetry: {
    fontSize: 13,
    fontWeight: '800',
  },
  hero: {
    alignItems: 'center',
    gap: 8,
    marginBottom: 2,
  },
  heroTitle: {
    fontSize: 52,
    lineHeight: 56,
    letterSpacing: -1.2,
    fontWeight: '900',
  },
  heroSub: {
    fontSize: 18,
    fontWeight: '500',
  },
  summaryCard: {
    borderRadius: 20,
    padding: 24,
    gap: 14,
    overflow: 'hidden',
  },
  summaryGlow: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: '100%',
  },
  summaryLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  summaryTotal: {
    marginTop: 4,
    fontSize: 40,
    lineHeight: 44,
    fontWeight: '900',
    letterSpacing: -1,
  },
  progressPill: {
    alignSelf: 'flex-start',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  progressPillText: {
    fontSize: 13,
    fontWeight: '700',
  },
  aiReviewCard: {
    borderRadius: 20,
    padding: 22,
    overflow: 'hidden',
    gap: 14,
  },
  aiDecor: {
    position: 'absolute',
    width: 240,
    height: 240,
    borderRadius: 999,
    right: -80,
    top: -130,
  },
  aiHead: {
    gap: 8,
  },
  aiKickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  aiKicker: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  aiHeading: {
    fontSize: 30,
    lineHeight: 36,
    letterSpacing: -0.8,
    fontWeight: '900',
  },
  aiBody: {
    borderTopWidth: 1,
    paddingTop: 12,
    gap: 10,
  },
  aiText: {
    fontSize: 14,
    lineHeight: 21,
    fontWeight: '500',
  },
  aiTextStrong: {
    fontWeight: '700',
  },
  aiAdviceTag: {
    fontWeight: '700',
  },
  aiPendingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 2,
  },
  aiPendingText: {
    fontSize: 13,
    fontWeight: '600',
  },
  aiRefreshBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 4,
    alignSelf: 'flex-start',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  aiRefreshBtnText: {
    fontSize: 13,
    fontWeight: '800',
  },
  listSection: {
    gap: 12,
  },
  listKickerRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  listKicker: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  listSwipeHint: {
    fontSize: 11,
    fontWeight: '600',
    opacity: 0.85,
  },
  swipeDeleteAction: {
    width: 88,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#dc2626',
    borderRadius: 20,
    marginLeft: 10,
    marginVertical: 2,
    gap: 4,
  },
  swipeDeleteText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '800',
  },
  emptyCard: {
    borderRadius: 20,
    borderWidth: 1,
    paddingVertical: 28,
    paddingHorizontal: 20,
    alignItems: 'center',
    gap: 8,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '800',
  },
  emptySub: {
    fontSize: 14,
    fontWeight: '500',
    textAlign: 'center',
  },
  itemCard: {
    borderRadius: 20,
    overflow: 'hidden',
    flexDirection: 'column',
    alignItems: 'stretch',
  },
  itemMainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  itemIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  itemThumb: {
    width: 56,
    height: 56,
  },
  itemContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  itemTextWrap: {
    flex: 1,
  },
  itemName: {
    fontSize: 18,
    fontWeight: '900',
  },
  itemSubtitle: {
    marginTop: 4,
    fontSize: 14,
    fontWeight: '500',
  },
  itemAiFooter: {
    borderTopWidth: 1,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 13,
    gap: 6,
  },
  itemAiKickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  itemAiKicker: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  itemAiBody: {
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '500',
  },
  itemPriceWrap: {
    alignItems: 'flex-end',
    gap: 4,
    maxWidth: '46%',
  },
  itemPrice: {
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: -0.4,
  },
  itemPriority: {
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'right',
  },
  fab: {
    position: 'absolute',
    right: 20,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    shadowOpacity: 0.24,
    shadowOffset: { width: 0, height: 12 },
    shadowRadius: 16,
    elevation: 7,
  },
  fabText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0.4,
  },
});
