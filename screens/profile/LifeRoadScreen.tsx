/**
 * 道路总览：对齐设计稿 11 / 14（时间桶 Tab、总方向卡、名额已满拦截）。
 * 动效：入场 420ms 错峰；切桶赌注上浮；满额点新增抖动 + 琥珀闪。
 */
import {
  FoldRiseIn,
  FOLD_MOTION_EASE,
  useFoldMotionGate,
} from '@/components/review/fold-motion';
import { AppIcon } from '@/components/ui/app-icon';
import { getMinTouchTarget, Spacing } from '@/constants/design-tokens';
import { foldFonts, useFoldTheme } from '@/constants/review-fold-theme';
import { toast, toUserMessage, Alert } from '@/lib/app-feedback';
import { usePageApiSync, usePagePullRefresh } from '@/hooks/use-page-api-sync';
import {
  getLifeBetDerivedStats,
  getLifeBetProgressRatio,
  listActiveProjectsForLifeBet,
  resolveLifeBetProgressRatio,
  type LifeBetActiveProjectRef,
  type LifeBetDerivedStats,
} from '@/lib/life-road/life-road-derived';
import {
  formatLifeBetListMeta,
  LIFE_BET_HORIZON_LABELS,
  LIFE_BET_STATUS_LABELS,
  lifeBetFoldStatusTone,
} from '@/lib/life-road/life-road-labels';
import {
  currentCalendarYear,
  LIFE_BET_YEAR_ACTIVE_LIMIT,
  type LifeBetHorizon,
} from '@/lib/life-road/life-road-limits';
import {
  countActiveYearBetsLocal,
  deleteLifeBet,
  getLifeBets,
  updateLifeBet,
} from '@/lib/repositories/life-road/life-bet';
import type { LifeBetRow } from '@/lib/repositories/life-road/life-bet.types';
import { getLifeDirection } from '@/lib/repositories/life-road/life-direction';
import type { LifeDirectionRow } from '@/lib/repositories/life-road/life-direction.types';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

const PAGE_KEY = 'life-road';
const MIN_TOUCH = getMinTouchTarget(Platform.OS);
const HORIZON_ORDER: LifeBetHorizon[] = ['year', 'multi', 'farther'];

type BetView = {
  bet: LifeBetRow;
  derived: LifeBetDerivedStats;
  projects: LifeBetActiveProjectRef[];
  projectTotal: number;
  progressRatio: number;
};

async function swapSortOrder(a: LifeBetRow, b: LifeBetRow): Promise<void> {
  const orderA = a.sort_order;
  const orderB = b.sort_order;
  if (orderA === orderB) {
    await updateLifeBet(a.id, { sort_order: orderA - 1 });
    await updateLifeBet(b.id, { sort_order: orderB + 1 });
    return;
  }
  await updateLifeBet(a.id, { sort_order: orderB });
  await updateLifeBet(b.id, { sort_order: orderA });
}

function formatUpdatedAt(iso: string | null | undefined): string {
  if (!iso) return '尚未更新';
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return '尚未更新';
  return `更新于 ${d.getMonth() + 1}月${d.getDate()}日 · 影响赌注排序`;
}

function ProgressBar({
  ratio,
  animate,
  trackColor,
  fillColor,
}: {
  ratio: number;
  animate: boolean;
  trackColor: string;
  fillColor: string;
}) {
  const width = useRef(new Animated.Value(animate ? 0 : ratio)).current;
  useEffect(() => {
    if (!animate) {
      width.setValue(ratio);
      return;
    }
    Animated.timing(width, {
      toValue: ratio,
      duration: 500,
      easing: FOLD_MOTION_EASE,
      useNativeDriver: false,
    }).start();
  }, [animate, ratio, width]);

  const pct = width.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  return (
    <View style={[styles.progressTrack, { backgroundColor: trackColor }]}>
      <Animated.View style={[styles.progressFill, { width: pct, backgroundColor: fillColor }]} />
    </View>
  );
}

function BetCard({
  view,
  index,
  total,
  animate,
  animKey,
  onEdit,
  onPromote,
  onDemote,
  onDelete,
  showDelete,
  fold,
}: {
  view: BetView;
  index: number;
  total: number;
  animate: boolean;
  animKey: number;
  onEdit: () => void;
  onPromote: () => void;
  onDemote: () => void;
  onDelete: () => void;
  showDelete?: boolean;
  fold: ReturnType<typeof useFoldTheme>['fold'];
}) {
  const tone = lifeBetFoldStatusTone(view.bet.status, fold);
  const meta = formatLifeBetListMeta(view.bet, view.derived, Math.round(view.progressRatio * 100));
  const faded = view.bet.status === 'arrived' || view.bet.status === 'dropped';
  const canUp = index > 0;
  const canDown = index < total - 1;

  return (
    <FoldRiseIn animate={animate} index={index} staggerMs={45} fromY={14} key={`${animKey}-${view.bet.id}`}>
      <View
        style={[
          styles.betItem,
          {
            backgroundColor: 'rgba(255,252,245,0.92)',
            borderColor: fold.line,
            opacity: faded ? 0.66 : 1,
          },
        ]}>
        <Text style={[styles.grip, { color: fold.faint }]} accessibilityLabel="拖动手柄">
          ⋮⋮
        </Text>
        <Pressable onPress={onEdit} style={styles.betMain} accessibilityRole="button">
          <View style={styles.betTitleRow}>
            <Text style={[styles.betTitle, { color: fold.ink }]} numberOfLines={2}>
              {view.bet.title}
            </Text>
            <View style={[styles.betStatus, { backgroundColor: tone.bg }]}>
              <Text style={[styles.betStatusText, { color: tone.text }]}>
                {LIFE_BET_STATUS_LABELS[view.bet.status]}
              </Text>
            </View>
          </View>
          <Text style={[styles.betMeta, { color: fold.faint }]} numberOfLines={2}>
            {meta}
          </Text>
          {view.bet.status !== 'dropped' ? (
            <ProgressBar
              ratio={view.progressRatio}
              animate={animate}
              trackColor="#E7E2D5"
              fillColor={fold.pine2}
            />
          ) : null}
        </Pressable>
        <View style={styles.betActs}>
          <Pressable
            onPress={onPromote}
            disabled={!canUp}
            accessibilityLabel="上移"
            style={({ pressed }) => [
              styles.bactBtn,
              { backgroundColor: '#F0EBE0', opacity: !canUp ? 0.35 : pressed ? 0.75 : 1 },
            ]}>
            <AppIcon name="keyboard-arrow-up" size={14} color={fold.muted} />
          </Pressable>
          <Pressable
            onPress={onDemote}
            disabled={!canDown}
            accessibilityLabel="下移"
            style={({ pressed }) => [
              styles.bactBtn,
              { backgroundColor: '#F0EBE0', opacity: !canDown ? 0.35 : pressed ? 0.75 : 1 },
            ]}>
            <AppIcon name="keyboard-arrow-down" size={14} color={fold.muted} />
          </Pressable>
          {showDelete ? (
            <Pressable
              onPress={onDelete}
              accessibilityLabel="删除"
              style={({ pressed }) => [
                styles.bactBtn,
                { backgroundColor: '#F0EBE0', opacity: pressed ? 0.75 : 1 },
              ]}>
              <AppIcon name="delete-outline" size={12} color={fold.clay} />
            </Pressable>
          ) : (
            <Pressable
              onPress={onEdit}
              accessibilityLabel="编辑"
              style={({ pressed }) => [
                styles.bactBtn,
                { backgroundColor: '#F0EBE0', opacity: pressed ? 0.75 : 1 },
              ]}>
              <AppIcon name="edit" size={12} color={fold.muted} />
            </Pressable>
          )}
        </View>
      </View>
    </FoldRiseIn>
  );
}

export default function LifeRoadScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { fold } = useFoldTheme();
  const { animate: motionOn } = useFoldMotionGate();
  const params = useLocalSearchParams<{ focus?: string | string[] }>();
  const { wrapLoad, notifyAncestorsDataChanged } = usePageApiSync(PAGE_KEY);

  const [direction, setDirection] = useState<LifeDirectionRow | null>(null);
  const [bets, setBets] = useState<BetView[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [yearActiveCount, setYearActiveCount] = useState(0);
  const [horizon, setHorizon] = useState<LifeBetHorizon>('year');
  const [bucketAnimKey, setBucketAnimKey] = useState(0);
  const [sortMode, setSortMode] = useState(false);

  const shakeX = useRef(new Animated.Value(0)).current;
  const bannerFlash = useRef(new Animated.Value(0)).current;

  const yearFull = yearActiveCount >= LIFE_BET_YEAR_ACTIVE_LIMIT;
  const capacityMode = yearFull && horizon === 'year';

  const reload = useCallback(
    async (forceRefresh = false) => {
      setLoadError(null);
      try {
        await wrapLoad(async () => {
          const [nextDirection, nextBets] = await Promise.all([
            getLifeDirection({ serverFallback: true }),
            getLifeBets({ serverFallback: true }),
          ]);
          const views: BetView[] = await Promise.all(
            nextBets.map(async (bet) => {
              const [derived, linked, taskRatio] = await Promise.all([
                getLifeBetDerivedStats(bet.id, bet.status),
                listActiveProjectsForLifeBet(bet.id, 3),
                getLifeBetProgressRatio(bet.id),
              ]);
              return {
                bet,
                derived,
                projects: linked?.projects ?? [],
                projectTotal: linked?.total ?? 0,
                progressRatio: resolveLifeBetProgressRatio(
                  bet.status,
                  taskRatio,
                  linked?.total ?? derived.activeProjectCount,
                ),
              };
            }),
          );
          const activeYear = await countActiveYearBetsLocal(currentCalendarYear());
          setDirection(nextDirection);
          setBets(views);
          setYearActiveCount(activeYear);
        }, forceRefresh);
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : '加载失败');
      } finally {
        setLoading(false);
      }
    },
    [wrapLoad],
  );

  const { refreshControl } = usePagePullRefresh(PAGE_KEY, reload);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  useEffect(() => {
    const focus = Array.isArray(params.focus) ? params.focus[0] : params.focus;
    if (focus === 'full') {
      setHorizon('year');
    }
  }, [params.focus]);

  const grouped = useMemo(() => {
    const map: Record<LifeBetHorizon, BetView[]> = { year: [], multi: [], farther: [] };
    const archived: BetView[] = [];
    const yearNow = currentCalendarYear();
    for (const view of bets) {
      if (
        view.bet.status === 'arrived' ||
        (view.bet.horizon === 'year' && view.bet.year != null && view.bet.year < yearNow)
      ) {
        archived.push(view);
        continue;
      }
      if (view.bet.status === 'dropped') continue;
      map[view.bet.horizon].push(view);
    }
    return { map, archived };
  }, [bets]);

  const activeList = grouped.map[horizon];
  const horizonCounts = useMemo(() => {
    return {
      year: grouped.map.year.filter((v) =>
        v.bet.status === 'on_track' || v.bet.status === 'paused',
      ).length,
      multi: grouped.map.multi.length,
      farther: grouped.map.farther.length,
    };
  }, [grouped]);

  const flashCapacity = useCallback(() => {
    if (!motionOn) {
      toast.warn('今年名额已满 · 完成、移出今年或放弃后可腾出');
      return;
    }
    shakeX.setValue(0);
    bannerFlash.setValue(0);
    Animated.sequence([
      Animated.timing(shakeX, { toValue: 5, duration: 55, useNativeDriver: true }),
      Animated.timing(shakeX, { toValue: -5, duration: 55, useNativeDriver: true }),
      Animated.timing(shakeX, { toValue: 4, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeX, { toValue: -3, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeX, { toValue: 0, duration: 70, useNativeDriver: true }),
    ]).start();
    Animated.sequence([
      Animated.timing(bannerFlash, {
        toValue: 1,
        duration: 160,
        easing: FOLD_MOTION_EASE,
        useNativeDriver: false,
      }),
      Animated.timing(bannerFlash, {
        toValue: 0,
        duration: 280,
        easing: FOLD_MOTION_EASE,
        useNativeDriver: false,
      }),
    ]).start();
    toast.warn('今年名额已满 · 完成或放弃后可腾出');
  }, [bannerFlash, motionOn, shakeX]);

  const openAdd = useCallback(
    (target: LifeBetHorizon = horizon) => {
      if (target === 'year' && yearActiveCount >= LIFE_BET_YEAR_ACTIVE_LIMIT) {
        setHorizon('year');
        flashCapacity();
        return;
      }
      router.push({
        pathname: '/edit-life-bet/[id]',
        params: { id: 'new', horizon: target },
      });
    },
    [flashCapacity, horizon, router, yearActiveCount],
  );

  const onDeleteBet = useCallback(
    (bet: LifeBetRow) => {
      Alert.alert('删除这条道路？', '项目不会被删除，只会取消归属。', [
        { text: '取消', style: 'cancel' },
        {
          text: '删除',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                await deleteLifeBet(bet.id);
                notifyAncestorsDataChanged();
                toast.success('已删除');
                await reload();
              } catch (e) {
                toast.error(toUserMessage(e, '删除失败，请稍后重试'));
              }
            })();
          },
        },
      ]);
    },
    [notifyAncestorsDataChanged, reload],
  );

  const onMove = useCallback(
    async (list: BetView[], index: number, dir: -1 | 1) => {
      const other = list[index + dir];
      const self = list[index];
      if (!self || !other) return;
      try {
        await swapSortOrder(self.bet, other.bet);
        notifyAncestorsDataChanged();
        await reload();
      } catch (e) {
        Alert.alert('排序失败', e instanceof Error ? e.message : '请稍后重试');
      }
    },
    [notifyAncestorsDataChanged, reload],
  );

  const switchHorizon = (next: LifeBetHorizon) => {
    if (next === horizon) return;
    setHorizon(next);
    setBucketAnimKey((k) => k + 1);
  };

  const headerTitle = capacityMode ? `今年 · ${yearActiveCount} 条` : '我的道路';
  const headerSub = capacityMode
    ? '名额已满 · 先做完再写新的'
    : `今年 ${yearActiveCount} 条在路上 · 最多 ${LIFE_BET_YEAR_ACTIVE_LIMIT} 条`;

  const bannerBg = bannerFlash.interpolate({
    inputRange: [0, 1],
    outputRange: ['#FBEEDC', '#F5D9A8'],
  });

  const yearNow = currentCalendarYear();
  const archivedYear =
    grouped.archived[0]?.bet.year ??
    (grouped.archived.length > 0 ? yearNow - 1 : yearNow - 1);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: fold.paper }]} edges={['left', 'right']}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={[styles.appBar, { paddingTop: insets.top + 4, borderBottomColor: fold.line }]}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="返回"
          hitSlop={10}
          style={({ pressed }) => [
            styles.iconBtn,
            { borderColor: fold.line, backgroundColor: fold.card },
            pressed && { opacity: 0.88 },
          ]}>
          <AppIcon name="arrow-back" size={20} color={fold.ink} />
        </Pressable>
        <View style={styles.appBarTitleWrap}>
          <Text style={[styles.appTitle, { color: fold.ink }]}>{headerTitle}</Text>
          <Text style={[styles.appSub, { color: fold.muted }]} numberOfLines={1}>
            {headerSub}
          </Text>
        </View>
        {capacityMode ? (
          <Pressable
            onPress={() => setSortMode((v) => !v)}
            accessibilityRole="button"
            accessibilityLabel="排序"
            style={({ pressed }) => [
              styles.pillBtn,
              { borderColor: fold.line2, backgroundColor: 'rgba(255,252,245,0.66)' },
              pressed && { opacity: 0.88 },
            ]}>
            <Text style={[styles.pillBtnLabel, { color: fold.ink2 }]}>
              {sortMode ? '完成' : '排序'}
            </Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={() => router.push('/edit-life-direction')}
            accessibilityRole="button"
            accessibilityLabel="编辑总方向"
            style={({ pressed }) => [
              styles.pillBtn,
              { borderColor: fold.line2, backgroundColor: 'rgba(255,252,245,0.66)' },
              pressed && { opacity: 0.88 },
            ]}>
            <AppIcon name="edit" size={12} color={fold.ink2} />
            <Text style={[styles.pillBtnLabel, { color: fold.ink2 }]}>总方向</Text>
          </Pressable>
        )}
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={fold.pine} />
        </View>
      ) : (
        <ScrollView
          refreshControl={refreshControl}
          contentContainerStyle={[
            styles.scroll,
            { paddingBottom: Math.max(insets.bottom, 16) + 28 },
          ]}
          showsVerticalScrollIndicator={false}>
          {loadError ? (
            <View style={[styles.errorCard, { backgroundColor: fold.clay2, borderColor: fold.clay }]}>
              <Text style={{ color: fold.clay, textAlign: 'center', fontWeight: '700' }}>{loadError}</Text>
              <Pressable onPress={() => void reload(true)} style={[styles.retryBtn, { backgroundColor: fold.pine }]}>
                <Text style={{ color: fold.onPineButton, fontWeight: '700' }}>重试</Text>
              </Pressable>
            </View>
          ) : null}

          {!capacityMode ? (
            <FoldRiseIn animate={motionOn} index={0} staggerMs={45} fromY={10}>
              <Pressable
                onPress={() => router.push('/edit-life-direction')}
                style={[styles.dirCard, { backgroundColor: fold.card, borderColor: fold.line }]}>
                <View style={styles.rowline}>
                  <Text style={[styles.kicker, { color: fold.muted }]}>TOTAL DIRECTION</Text>
                  <View style={[styles.tagAmber, { backgroundColor: fold.amber2 }]}>
                    <Text style={[styles.tagAmberText, { color: '#8B6126' }]} numberOfLines={1}>
                      {direction?.year_theme?.trim() || String(yearNow)}
                    </Text>
                  </View>
                </View>
                {direction?.body ? (
                  <Text style={[styles.roadDir, { color: fold.pine, fontFamily: foldFonts.serif }]}>
                    {direction.body}
                  </Text>
                ) : (
                  <Text style={[styles.roadDirEmpty, { color: fold.muted }]}>
                    还没有写下方向。用来看清未来几年押什么，不是用来排任务。
                  </Text>
                )}
                <View style={styles.rowline}>
                  <Text style={[styles.dirMeta, { color: fold.faint }]}>
                    {formatUpdatedAt(direction?.updated_at)}
                  </Text>
                  <Text style={[styles.dirEdit, { color: '#8B6126' }]}>编辑 ›</Text>
                </View>
              </Pressable>
            </FoldRiseIn>
          ) : (
            <Animated.View
              style={[
                styles.limitBanner,
                {
                  backgroundColor: bannerBg,
                  borderColor: '#E7CFA6',
                },
              ]}>
              <AppIcon name="lock" size={14} color="#B08A4E" />
              <Text style={styles.limitBannerText}>
                <Text style={{ fontWeight: '800' }}>今年 {yearActiveCount} / {LIFE_BET_YEAR_ACTIVE_LIMIT} 已满。</Text>
                「在路上 + 暂搁」合计不超过 {LIFE_BET_YEAR_ACTIVE_LIMIT} 条，完成或放弃后自动腾出名额。
              </Text>
            </Animated.View>
          )}

          <FoldRiseIn animate={motionOn} index={1} staggerMs={45} fromY={10}>
            <View style={styles.roadTabs}>
              {HORIZON_ORDER.map((key) => {
                const on = horizon === key;
                const count =
                  key === 'year'
                    ? `${yearActiveCount} / ${LIFE_BET_YEAR_ACTIVE_LIMIT}`
                    : `${horizonCounts[key]} 条`;
                return (
                  <Pressable
                    key={key}
                    onPress={() => switchHorizon(key)}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: on }}
                    style={[
                      styles.roadTab,
                      {
                        backgroundColor: on ? fold.pineButton : '#F8F4EA',
                        borderColor: on ? fold.pineButton : fold.line,
                      },
                    ]}>
                    <Text
                      style={[
                        styles.roadTabTitle,
                        { color: on ? fold.onPineButton : fold.muted, fontWeight: on ? '800' : '700' },
                      ]}>
                      {LIFE_BET_HORIZON_LABELS[key]}
                    </Text>
                    <Text style={[styles.roadTabSub, { color: on ? '#B7CCC1' : '#A1A69D' }]}>
                      {count}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </FoldRiseIn>

          {activeList.length === 0 ? (
            <View style={[styles.emptySlot, { borderColor: fold.line, backgroundColor: fold.paper2 }]}>
              <Text style={{ color: fold.muted, fontWeight: '600' }}>
                {horizon === 'year' ? '今年还没有下注' : '这一段还空着'}
              </Text>
            </View>
          ) : (
            activeList.map((view, index) => (
              <BetCard
                key={view.bet.id}
                view={view}
                index={index}
                total={activeList.length}
                animate={motionOn}
                animKey={bucketAnimKey}
                fold={fold}
                showDelete={sortMode}
                onEdit={() =>
                  router.push({ pathname: '/edit-life-bet/[id]', params: { id: view.bet.id } })
                }
                onPromote={() => void onMove(activeList, index, -1)}
                onDemote={() => void onMove(activeList, index, 1)}
                onDelete={() => onDeleteBet(view.bet)}
              />
            ))
          )}

          <Animated.View style={{ transform: [{ translateX: shakeX }] }}>
            {horizon === 'year' && yearFull ? (
              <Pressable
                onPress={flashCapacity}
                accessibilityRole="button"
                accessibilityLabel="今年名额已满"
                style={[styles.addBtnLocked, { borderColor: fold.line2 }]}>
                <AppIcon name="lock" size={14} color="#9AA097" />
                <Text style={styles.addBtnLockedText}>今年名额已满</Text>
              </Pressable>
            ) : (
              <Pressable
                onPress={() => openAdd(horizon)}
                accessibilityRole="button"
                accessibilityLabel={`写下一条${LIFE_BET_HORIZON_LABELS[horizon]}赌注`}
                style={({ pressed }) => [
                  styles.addBtn,
                  { backgroundColor: fold.pineButton, opacity: pressed ? 0.92 : 1 },
                ]}>
                <AppIcon name="add" size={16} color={fold.onPineButton} />
                <Text style={[styles.addBtnText, { color: fold.onPineButton }]}>
                  写下一条{LIFE_BET_HORIZON_LABELS[horizon]}赌注
                </Text>
              </Pressable>
            )}
          </Animated.View>

          {capacityMode ? (
            <View style={[styles.tipsCard, { backgroundColor: fold.card, borderColor: fold.line }]}>
              <View style={styles.rowline}>
                <Text style={[styles.tipsTitle, { color: fold.ink2 }]}>腾出名额的三种方式</Text>
                <Text style={{ fontSize: 11, color: fold.faint }}>任选其一</Text>
              </View>
              {[
                { text: '标记一条为「已完成」', tag: '腾出 1', tone: 'green' as const },
                { text: '把一条移到「更远 / 多年」', tag: '腾出 1', tone: 'amber' as const },
                { text: '放弃一条并写一句原因', tag: '腾出 1', tone: 'gray' as const },
              ].map((row) => (
                <View key={row.text} style={styles.tipRow}>
                  <Text style={[styles.tipText, { color: fold.ink2 }]}>{row.text}</Text>
                  <View
                    style={[
                      styles.tipTag,
                      {
                        backgroundColor:
                          row.tone === 'green'
                            ? fold.sage2
                            : row.tone === 'amber'
                              ? fold.amber2
                              : fold.paper2,
                      },
                    ]}>
                    <Text
                      style={{
                        fontSize: 10,
                        fontWeight: '700',
                        color:
                          row.tone === 'green'
                            ? fold.pine2
                            : row.tone === 'amber'
                              ? '#8B6126'
                              : fold.muted,
                      }}>
                      {row.tag}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          ) : null}

          {!capacityMode && horizon === 'year' && grouped.archived.length > 0 ? (
            <>
              <View style={styles.bucketCap}>
                <Text style={{ color: fold.faint, fontSize: 12 }}>已归档 · {archivedYear}</Text>
                <Text style={{ color: fold.faint, fontSize: 12 }}>
                  查看 {grouped.archived.length} 条 ›
                </Text>
              </View>
              {grouped.archived.slice(0, 2).map((view, index) => (
                <BetCard
                  key={`arch-${view.bet.id}`}
                  view={view}
                  index={index}
                  total={1}
                  animate={motionOn}
                  animKey={bucketAnimKey + 100}
                  fold={fold}
                  onEdit={() =>
                    router.push({ pathname: '/edit-life-bet/[id]', params: { id: view.bet.id } })
                  }
                  onPromote={() => undefined}
                  onDemote={() => undefined}
                  onDelete={() => onDeleteBet(view.bet)}
                />
              ))}
            </>
          ) : null}

          {!capacityMode ? (
            <View style={[styles.noteCard, { backgroundColor: fold.card, borderColor: fold.line }]}>
              <AppIcon name="gps-fixed" size={12} color={fold.faint} />
              <Text style={[styles.noteText, { color: fold.faint }]}>
                今年「在路上 + 暂搁」合计最多 {LIFE_BET_YEAR_ACTIVE_LIMIT} 条；完成或放弃后才能腾出位置。
              </Text>
            </View>
          ) : null}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  appBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingBottom: 10,
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  appBarTitleWrap: { flex: 1, minWidth: 0 },
  appTitle: { fontSize: 18, fontWeight: '800', letterSpacing: -0.2 },
  appSub: { marginTop: 2, fontSize: 11, fontWeight: '600' },
  pillBtn: {
    height: 30,
    paddingHorizontal: 11,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  pillBtnLabel: { fontSize: 12, fontWeight: '700' },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingHorizontal: 15, paddingTop: 10, gap: 8 },
  errorCard: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    gap: 10,
    marginBottom: 6,
  },
  retryBtn: {
    alignSelf: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 12,
  },
  dirCard: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 11,
    marginBottom: 2,
  },
  rowline: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  kicker: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  tagAmber: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  tagAmberText: { fontSize: 10, fontWeight: '800' },
  roadDir: {
    fontSize: 15,
    lineHeight: 22,
    marginVertical: 6,
    fontWeight: '600',
  },
  roadDirEmpty: { fontSize: 13, lineHeight: 20, marginVertical: 6 },
  dirMeta: { fontSize: 11, flex: 1 },
  dirEdit: { fontSize: 11, fontWeight: '700' },
  roadTabs: { flexDirection: 'row', gap: 5, marginBottom: 2 },
  roadTab: {
    flex: 1,
    minHeight: 40,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 5,
    gap: 1,
  },
  roadTabTitle: { fontSize: 13 },
  roadTabSub: { fontSize: 10, fontWeight: '600' },
  betItem: {
    borderRadius: 13,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  grip: { fontSize: 12, lineHeight: 18, marginTop: 2, width: 14, textAlign: 'center' },
  betMain: { flex: 1, minWidth: 0 },
  betTitleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  betTitle: { flex: 1, fontSize: 14, fontWeight: '700', lineHeight: 20 },
  betStatus: {
    borderRadius: 5,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  betStatusText: { fontSize: 10, fontWeight: '700' },
  betMeta: { marginTop: 4, fontSize: 11, lineHeight: 16 },
  progressTrack: {
    height: 2,
    borderRadius: 2,
    marginTop: 6,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', borderRadius: 2 },
  betActs: { gap: 3 },
  bactBtn: {
    width: 24,
    height: 20,
    borderRadius: 5,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: MIN_TOUCH * 0.55,
  },
  addBtn: {
    height: 40,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 4,
  },
  addBtnText: { fontSize: 13, fontWeight: '800' },
  addBtnLocked: {
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    backgroundColor: '#E2DDD1',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 4,
  },
  addBtnLockedText: { fontSize: 13, fontWeight: '700', color: '#9AA097' },
  limitBanner: {
    borderRadius: 11,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 7,
    marginBottom: 2,
  },
  limitBannerText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
    color: '#8B5A1E',
  },
  tipsCard: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 11,
    paddingVertical: 10,
    marginTop: 4,
    gap: 4,
  },
  tipsTitle: { fontSize: 13, fontWeight: '800' },
  tipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
    gap: 8,
  },
  tipText: { flex: 1, fontSize: 12 },
  tipTag: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  bucketCap: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
    marginBottom: 2,
    paddingHorizontal: 2,
  },
  noteCard: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginTop: 4,
  },
  noteText: { flex: 1, fontSize: 11, lineHeight: 16 },
  emptySlot: {
    borderRadius: 13,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: 'dashed',
    paddingVertical: Spacing['4xl'],
    alignItems: 'center',
  },
});
