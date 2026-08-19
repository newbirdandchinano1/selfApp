import { AppButton, AppCard, AppScreen, ScreenHeader, ScreenHeaderIconAction } from '@/components/ui';
import { Radius, Shadows, Spacing, Typography } from '@/constants/design-tokens';
import { useAppTheme } from '@/hooks/use-app-theme';
import { isWishItemFulfilled } from '@/lib/repositories/wish-list/wish-list-extra';
import { getDepositSumsByActivePlanId } from '@/lib/repositories/savings-plan/savings-plan-deposit';
import { deleteWishItem, listWishItems, setWishItemFulfilled } from '@/lib/repositories/wish-list/wish-list';
import type { WishItemRow } from '@/lib/repositories/wish-list/wish-list.types';
import { usePageApiSync, usePagePullRefresh } from '@/hooks/use-page-api-sync';
import { fetchProfileWishList } from '@/lib/profile-page-api';
import {
  deleteLinkedPlanForWish,
  getLinkedSavingsPlanId,
  repairWishSavingsLinks,
} from '@/lib/wish-savings-link';
import {
  clearWishListRationalAiCache,
  computeWishListRationalFingerprint,
  getWishListRationalAiCache,
  saveWishListRationalAiCache,
} from '@/lib/repositories/wish-list/wish-list-rational-ai-cache';
import { analyzeWishListRationalReviewFromText, getActiveAiLlmApiKey, isActiveAiLlmConfigured } from '@/lib/zhipu-image-parse';
import { SavingsOverviewCard } from '@/components/wish-list/savings-overview-card';
import { WishListAiPanel } from '@/components/wish-list/wish-list-ai-panel';
import { WishListItemCard } from '@/components/wish-list/wish-list-item-card';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

const quarterTarget = 120_000;
const WISH_LIST_PAGE_KEY = 'wish-list';

function formatCny(value: number): string {
  return `¥ ${value.toLocaleString('zh-CN')}`;
}

function buildWishListAiContextText(rows: WishItemRow[], quarterGoal: number, totalPrice: number): string {
  const progressPct = quarterGoal > 0 ? Math.round((totalPrice / quarterGoal) * 100) : 0;
  const avgDesire = rows.length ? rows.reduce((s, r) => s + r.desire_level, 0) / rows.length : 0;
  const highDesireRows = rows.filter(r => r.desire_level >= 4);
  const highDesireTotal = highDesireRows.reduce(
    (s, r) => s + (Number.isFinite(r.price) ? r.price : 0),
    0,
  );
  const desireBuckets = [1, 2, 3, 4, 5].map(lv => ({
    lv,
    count: rows.filter(r => r.desire_level === lv).length,
  }));
  const desireDist = desireBuckets
    .filter(b => b.count > 0)
    .map(b => `等级${b.lv}:${b.count}条`)
    .join('、');

  const byCategory = new Map<string, { count: number; total: number }>();
  for (const row of rows) {
    const cat = row.category_label?.trim() || '未分类';
    const prev = byCategory.get(cat) ?? { count: 0, total: 0 };
    const price = Number.isFinite(row.price) ? row.price : 0;
    byCategory.set(cat, { count: prev.count + 1, total: prev.total + price });
  }
  const categorySummary = [...byCategory.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .map(([cat, v]) => `${cat}（${v.count}条/¥${v.total.toLocaleString('zh-CN')}）`)
    .join('；');

  const topFocus = [...rows]
    .sort((a, b) => b.desire_level - a.desire_level || b.price - a.price)
    .slice(0, 3)
    .map((r, i) => `${i + 1}) ${r.name}｜心动${r.desire_level}/5｜¥${r.price}`)
    .join('；');

  const lines = rows.map((row, idx) => {
    const cat = row.category_label?.trim() || '未分类';
    const reason = row.reason?.trim().replace(/\s+/g, ' ') ?? '';
    const reasonShort = reason.length > 160 ? `${reason.slice(0, 157)}…` : reason;
    return `${idx + 1}. ${row.name}｜预估 ¥${row.price}｜心动 ${row.desire_level}/5｜${cat}${reasonShort ? `｜理由：${reasonShort}` : '｜理由：未填写'}`;
  });

  return [
    `参考季度目标金额：¥${quarterGoal.toLocaleString('zh-CN')}（用于理解占 Q 目标比例等语境，非强制预算）`,
    `清单共 ${rows.length} 条，总预估支出 ¥${totalPrice.toLocaleString('zh-CN')}，约占季度目标 ${progressPct}%`,
    `平均心动等级：${avgDesire.toFixed(1)}/5；心动等级分布：${desireDist || '无'}`,
    `心动≥4 的条目：${highDesireRows.length} 条，合计 ¥${highDesireTotal.toLocaleString('zh-CN')}`,
    `类别金额分布：${categorySummary || '无'}`,
    `建议优先关注（按心动与价格）：${topFocus || '无'}`,
    '',
    '条目明细：',
    ...lines,
  ].join('\n');
}

function SwipeActions({
  primaryLabel,
  primaryIcon,
  primaryColor,
  onPrimary,
  onDelete,
}: {
  primaryLabel: string;
  primaryIcon: keyof typeof MaterialIcons.glyphMap;
  primaryColor: string;
  onPrimary: () => void;
  onDelete: () => void;
}) {
  return (
    <View style={styles.swipeTrack}>
      <Pressable
        onPress={onPrimary}
        style={({ pressed }) => [styles.swipeAction, { backgroundColor: primaryColor }, pressed && { opacity: 0.92 }]}
        accessibilityRole="button"
        accessibilityLabel={primaryLabel}>
        <MaterialIcons name={primaryIcon} size={22} color="#fff" />
        <Text style={styles.swipeActionText}>{primaryLabel}</Text>
      </Pressable>
      <Pressable
        onPress={onDelete}
        style={({ pressed }) => [styles.swipeAction, styles.swipeDelete, pressed && { opacity: 0.92 }]}
        accessibilityRole="button"
        accessibilityLabel="删除">
        <MaterialIcons name="delete-outline" size={22} color="#fff" />
        <Text style={styles.swipeActionText}>删除</Text>
      </Pressable>
    </View>
  );
}

export default function WishListScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, shadows } = useAppTheme();

  const [items, setItems] = useState<WishItemRow[]>([]);
  const [depositByPlanId, setDepositByPlanId] = useState<Record<string, number>>({});
  const [overviewRefreshKey, setOverviewRefreshKey] = useState(0);
  const [initialLoading, setInitialLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const zhipuReady = isActiveAiLlmConfigured();
  const [rationalRefreshToken, setRationalRefreshToken] = useState(0);
  const [aiHeadline, setAiHeadline] = useState<string | null>(null);
  const [aiReview, setAiReview] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const rationalRunRef = useRef(0);
  const savingsLinksRepairedRef = useRef(false);
  const { wrapLoad, resetSync } = usePageApiSync(WISH_LIST_PAGE_KEY);

  const reload = useCallback(
    async (forceApi = false) => {
      setLoadError(null);
      try {
        await wrapLoad(async () => {
          await fetchProfileWishList({ offlineFallback: true });
          if (!savingsLinksRepairedRef.current) {
            try {
              await repairWishSavingsLinks();
              savingsLinksRepairedRef.current = true;
            } catch (e) {
              if (__DEV__) console.warn('[wish-list] repairWishSavingsLinks failed', e);
            }
          }
          const [rows, deposits] = await Promise.all([listWishItems(), getDepositSumsByActivePlanId()]);
          setItems(rows);
          setDepositByPlanId(deposits);
          setOverviewRefreshKey(k => k + 1);
        }, forceApi);
      } catch {
        setLoadError('加载失败，请点击重试');
        setItems([]);
        setDepositByPlanId({});
      } finally {
        setInitialLoading(false);
      }
    },
    [wrapLoad],
  );

  const { onRefresh: onRefreshData } = usePagePullRefresh(WISH_LIST_PAGE_KEY, reload);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const activeItems = useMemo(() => items.filter(r => !isWishItemFulfilled(r)), [items]);
  const fulfilledItems = useMemo(() => items.filter(r => isWishItemFulfilled(r)), [items]);

  const summary = useMemo(() => {
    const total = activeItems.reduce((sum, row) => sum + (Number.isFinite(row.price) ? row.price : 0), 0);
    const progress = quarterTarget > 0 ? Math.min(999, Math.round((total / quarterTarget) * 100)) : 0;
    return { total, progress, count: activeItems.length };
  }, [activeItems]);

  /** 待购心愿关联计划的已存合计（用于存款总览「总进度」） */
  const planSavedTotal = useMemo(() => {
    let sum = 0;
    for (const row of activeItems) {
      const planId = getLinkedSavingsPlanId(row);
      if (planId) sum += depositByPlanId[planId] ?? 0;
    }
    return sum;
  }, [activeItems, depositByPlanId]);

  const topDesireName = useMemo(() => {
    const sorted = [...activeItems].sort((a, b) => b.desire_level - a.desire_level || b.price - a.price);
    return sorted[0]?.name ?? null;
  }, [activeItems]);

  const wishListAiContextText = useMemo(() => {
    if (activeItems.length === 0) return '';
    const total = activeItems.reduce((sum, row) => sum + (Number.isFinite(row.price) ? row.price : 0), 0);
    return buildWishListAiContextText(activeItems, quarterTarget, total);
  }, [activeItems]);

  const wishListFp = useMemo(() => computeWishListRationalFingerprint(items), [items]);

  useEffect(() => {
    if (initialLoading) return;

    const reqId = ++rationalRunRef.current;

    void (async () => {
      if (rationalRunRef.current !== reqId) return;

      if (activeItems.length === 0) {
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

      const key = getActiveAiLlmApiKey().trim();
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
  }, [initialLoading, wishListFp, activeItems.length, wishListAiContextText, zhipuReady, rationalRefreshToken]);

  const bumpAiRefresh = useCallback(() => {
    setRationalRefreshToken(t => t + 1);
  }, []);

  const aiHeadingDisplay = useMemo(() => {
    if (activeItems.length === 0) return fulfilledItems.length > 0 ? '待购清单已清空' : '从添加第一条开始';
    if (aiHeadline?.trim()) return aiHeadline.trim();
    return topDesireName ? '关注高心动单品' : '建议策略性延后';
  }, [activeItems.length, fulfilledItems.length, aiHeadline, topDesireName]);

  const showAiPending =
    zhipuReady && activeItems.length > 0 && (aiLoading || (!aiHeadline && !aiReview && !aiError));

  const requestMarkFulfilled = useCallback((row: WishItemRow, fulfilled: boolean) => {
    void (async () => {
      try {
        await setWishItemFulfilled(row.id, fulfilled);
        const fresh = await listWishItems();
        setItems(fresh);
      } catch {
        Alert.alert('操作失败', '请稍后重试');
      }
    })();
  }, []);

  const requestDeleteWish = useCallback((row: WishItemRow) => {
    Alert.alert('删除心愿', `确定删除「${row.name}」？关联的存钱计划将一并删除，此操作不可恢复。`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              await deleteLinkedPlanForWish(row);
              await deleteWishItem(row.id);
              setItems(prev => prev.filter(i => i.id !== row.id));
            } catch {
              Alert.alert('删除失败', '请稍后重试');
            }
          })();
        },
      },
    ]);
  }, []);

  return (
    <AppScreen
      edges={['left', 'right']}
      onRefreshData={onRefreshData}
      contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 12) + 88, gap: Spacing['4xl'] }}
      header={
        <ScreenHeader
          title="心愿单"
          subtitle="目标好物 · 与财务存钱计划同步"
          onBack={() => router.back()}
          right={
            <ScreenHeaderIconAction
              icon="add"
              onPress={() => router.push('/add-wish-item')}
              accessibilityLabel="添加好物"
            />
          }
        />
      }>
      {initialLoading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : null}

      {loadError ? (
        <Pressable
          onPress={() => {
            resetSync();
            savingsLinksRepairedRef.current = false;
            void reload(true);
          }}
          style={[styles.errorBanner, { borderColor: colors.outline }]}>
          <Text style={[Typography.bodyStrong, { color: colors.text }]}>{loadError}</Text>
          <Text style={[Typography.caption, { color: colors.primary }]}>点击重试</Text>
        </Pressable>
      ) : null}

      <AppCard style={[shadows.card, styles.summaryCard]}>
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <Svg width="100%" height="100%" viewBox="0 0 400 160" preserveAspectRatio="none">
            <Path d="M0,80 C100,160 200,0 400,80 L400,160 L0,160 Z" fill={colors.primary} fillOpacity={0.05} />
          </Svg>
        </View>

        <Text style={[Typography.caption, { color: colors.textSecondary }]}>总预估支出</Text>
        <Text style={[Typography.display, styles.summaryAmount, { color: colors.tertiary }]}>
          {formatCny(summary.total)}
        </Text>

        <View style={styles.summaryMetaRow}>
          <View style={[styles.summaryChip, { backgroundColor: colors.capsule, borderColor: colors.outline }]}>
            <MaterialIcons name="inventory-2" size={14} color={colors.primary} />
            <Text style={[Typography.caption, { color: colors.textSecondary }]}>
              {summary.count} 项待购
            </Text>
          </View>
          <View style={[styles.summaryChip, { backgroundColor: colors.capsule, borderColor: colors.outline }]}>
            <MaterialIcons name="trending-up" size={14} color={colors.tertiary} />
            <Text style={[Typography.caption, { color: colors.textSecondary }]}>
              占 Q 目标 {summary.progress}%
            </Text>
          </View>
        </View>

        <View style={styles.progressBlock}>
          <View style={styles.progressHead}>
            <Text style={[Typography.caption, { color: colors.textSecondary }]}>季度目标参考</Text>
            <Text style={[Typography.caption, { color: colors.textSecondary }]}>{summary.progress}%</Text>
          </View>
          <View style={[styles.progressTrack, { backgroundColor: colors.progressTrack }]}>
            <View
              style={[
                styles.progressFill,
                { width: `${Math.min(100, summary.progress)}%`, backgroundColor: colors.progressFill },
              ]}
            />
          </View>
        </View>
      </AppCard>

      <SavingsOverviewCard
        planSavedTotal={planSavedTotal}
        planTargetTotal={summary.total}
        refreshKey={overviewRefreshKey}
      />

      <View style={styles.section}>
        <View style={styles.sectionHead}>
          <View style={[styles.sectionAccent, { backgroundColor: colors.primary }]} />
          <View style={styles.sectionTitleBlock}>
            <Text style={[Typography.h3, { color: colors.text }]}>目标好物</Text>
            <Text style={[Typography.caption, { color: colors.textSecondary, marginTop: 4 }]}>
              左滑可实现或删除 · 点击编辑
            </Text>
          </View>
        </View>

        {!initialLoading && items.length === 0 ? (
          <View style={[styles.emptyBox, { backgroundColor: colors.surfaceMuted, borderColor: colors.outline }]}>
            <MaterialIcons name="redeem" size={36} color={colors.textMuted} />
            <Text style={[Typography.title, { color: colors.text }]}>还没有心愿条目</Text>
            <Text style={[Typography.body, { color: colors.textSecondary, textAlign: 'center' }]}>
              添加你看中的好物，并与财务存钱计划同步进度
            </Text>
            <AppButton
              label="添加好物"
              size="sm"
              onPress={() => router.push('/add-wish-item')}
              style={styles.emptyBtn}
            />
          </View>
        ) : null}

        {!initialLoading && items.length > 0 && activeItems.length === 0 ? (
          <Text style={[Typography.body, { color: colors.textSecondary }]}>
            待购清单已全部实现，可在下方「已实现」中查看或恢复。
          </Text>
        ) : null}

        {activeItems.map(row => {
          const linkedPlanId = getLinkedSavingsPlanId(row);
          const saved = linkedPlanId ? (depositByPlanId[linkedPlanId] ?? 0) : 0;
          const target = Number.isFinite(row.price) ? row.price : 0;
          const savingsPct =
            linkedPlanId && target > 0 ? Math.min(100, Math.round((saved / target) * 100)) : null;

          return (
            <Swipeable
              key={row.id}
              overshootRight={false}
              rightThreshold={48}
              renderRightActions={() => (
                <SwipeActions
                  primaryLabel="已实现"
                  primaryIcon="check-circle"
                  primaryColor={colors.success}
                  onPrimary={() => requestMarkFulfilled(row, true)}
                  onDelete={() => requestDeleteWish(row)}
                />
              )}>
              <WishListItemCard
                row={row}
                saved={saved}
                savingsPct={savingsPct}
                onPress={() => router.push({ pathname: '/edit-wish-item/[id]', params: { id: row.id } })}
              />
            </Swipeable>
          );
        })}
      </View>

      {fulfilledItems.length > 0 ? (
        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <View style={[styles.sectionAccent, { backgroundColor: colors.success }]} />
            <View style={styles.sectionTitleBlock}>
              <Text style={[Typography.h3, { color: colors.text }]}>已实现</Text>
              <Text style={[Typography.caption, { color: colors.textSecondary, marginTop: 4 }]}>
                {fulfilledItems.length} 条 · 左滑可恢复
              </Text>
            </View>
          </View>

          {fulfilledItems.map(row => (
            <Swipeable
              key={row.id}
              overshootRight={false}
              rightThreshold={48}
              renderRightActions={() => (
                <SwipeActions
                  primaryLabel="恢复"
                  primaryIcon="undo"
                  primaryColor={colors.primary}
                  onPrimary={() => requestMarkFulfilled(row, false)}
                  onDelete={() => requestDeleteWish(row)}
                />
              )}>
              <WishListItemCard
                row={row}
                fulfilled
                onPress={() => router.push({ pathname: '/edit-wish-item/[id]', params: { id: row.id } })}
              />
            </Swipeable>
          ))}
        </View>
      ) : null}

      <WishListAiPanel
        activeCount={activeItems.length}
        totalItems={items.length}
        totalAmountLabel={formatCny(summary.total)}
        topDesireName={topDesireName}
        headline={aiHeadingDisplay}
        review={aiReview}
        loading={aiLoading}
        error={aiError}
        zhipuReady={zhipuReady}
        showPending={showAiPending}
        onRefresh={bumpAiRefresh}
      />

      <View style={[styles.fabWrap, { bottom: Math.max(insets.bottom, 12) + 12 }]}>
        <AppButton
          label="添加好物"
          onPress={() => router.push('/add-wish-item')}
          style={styles.fab}
        />
      </View>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  loadingWrap: {
    paddingVertical: Spacing['6xl'],
    alignItems: 'center',
  },
  errorBanner: {
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing['4xl'],
    gap: Spacing.sm,
  },
  summaryCard: {
    gap: Spacing.md,
    overflow: 'hidden',
  },
  summaryAmount: {
    marginTop: -4,
  },
  summaryMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.md,
    marginTop: Spacing.sm,
  },
  summaryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  progressBlock: {
    marginTop: Spacing.lg,
    gap: Spacing.sm,
  },
  progressHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  progressTrack: {
    height: 6,
    borderRadius: Radius.pill,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: Radius.pill,
  },
  section: {
    gap: Spacing.md,
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  sectionAccent: {
    width: 4,
    height: 22,
    borderRadius: Radius.pill,
    marginTop: 2,
  },
  sectionTitleBlock: {
    flex: 1,
  },
  emptyBox: {
    borderRadius: Radius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: Spacing['6xl'],
    paddingHorizontal: Spacing['4xl'],
    alignItems: 'center',
    gap: Spacing.lg,
  },
  emptyBtn: {
    marginTop: Spacing.sm,
  },
  swipeTrack: {
    width: 168,
    flexDirection: 'row',
    alignSelf: 'stretch',
    marginLeft: Spacing.md,
    marginVertical: 2,
    borderRadius: Radius['2xl'],
    overflow: 'hidden',
  },
  swipeAction: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 4,
  },
  swipeDelete: {
    backgroundColor: '#dc2626',
  },
  swipeActionText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '800',
  },
  fabWrap: {
    position: 'absolute',
    left: Spacing['5xl'],
    right: Spacing['5xl'],
    maxWidth: 420,
    alignSelf: 'center',
    width: '100%',
  },
  fab: {
    ...Shadows.composer,
  },
});
