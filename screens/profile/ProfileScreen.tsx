import { ProfileMoreSheet, type ProfileMoreMenuItem } from '@/components/profile/ProfileMoreSheet';
import { ProfileRoadCard } from '@/components/profile/ProfileRoadCard';
import {
  FoldCountUpText,
  FoldRiseIn,
  FOLD_MOTION_EASE,
  useFoldMotionGate,
} from '@/components/review/fold-motion';
import { glassTabBarContentInset } from '@/components/recipe/recipe-glass-tab-bar';
import { AppIcon } from '@/components/ui/app-icon';
import {
  getMinTouchTarget,
  Layout,
  Spacing,
} from '@/constants/design-tokens';
import { foldFonts, useFoldTheme } from '@/constants/review-fold-theme';
import {
  formatInboxBadgeCount,
  useNotificationInboxBadges,
} from '@/hooks/use-notification-inbox-badges';
import { useLocalQuery } from '@/hooks/use-local-query';
import { usePageApiSync, usePagePullRefresh } from '@/hooks/use-page-api-sync';
import { usePageFocusReload } from '@/hooks/use-page-focus-reload';
import { listUiRefreshTables } from '@/lib/page-api-scope';
import { subscribePointsBalanceChanged } from '@/lib/points-balance-events';
import {
  formatWeekRangeLabel,
  loadProfileHubStats,
  type ProfileHubStats,
} from '@/lib/profile-hub-stats';
import { fetchProfileLifeRoad } from '@/lib/profile-page-api';
import { getPointsBalance } from '@/lib/repositories/points/points';
import { getDefaultUser, subscribeDefaultUserUpdates } from '@/lib/repositories/users/user';
import type { UserRow } from '@/lib/repositories/users/user.types';
import { formatPoints } from '@/lib/reward-points';
import { reportTabBarScroll } from '@/lib/tab-bar-auto-hide';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

const PAGE_API_KEY = 'tabs/profile';
const LOCAL_TABLES = listUiRefreshTables(PAGE_API_KEY);
const MIN_TOUCH = getMinTouchTarget(Platform.OS);
const EMPTY = '—';

function monogramFromName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '我';
  return trimmed.slice(0, 1);
}

function metricDisplay(value: number | null | undefined, empty = EMPTY): string {
  if (value == null || value <= 0) return empty;
  return String(value);
}

function formatSyncClock(d = new Date()): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function formatWeightRecordLabel(ymd: string | null): string {
  if (!ymd || ymd.length < 10) return '暂无记录';
  const m = Number(ymd.slice(5, 7));
  const day = Number(ymd.slice(8, 10));
  return `最近记录 ${m}月${day}日`;
}

/** 头像呼吸光环（设计稿 avatarGlow） */
function BreathingAvatar({
  label,
  animate,
}: {
  label: string;
  animate: boolean;
}) {
  const { fold } = useFoldTheme();
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!animate) {
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 1900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [animate, pulse]);

  const glowScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] });
  const glowOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.22, 0.42] });

  return (
    <View style={styles.avatarWrap}>
      {animate ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.avatarGlow,
            {
              backgroundColor: fold.sage,
              opacity: glowOpacity,
              transform: [{ scale: glowScale }],
            },
          ]}
        />
      ) : null}
      <View style={[styles.avatar, { backgroundColor: fold.pineButton }]}>
        <Text style={[styles.avatarGlyph, { color: fold.onPineButton, fontFamily: foldFonts.serif }]}>
          {label}
        </Text>
      </View>
      <View style={[styles.avatarDot, { backgroundColor: fold.sage, borderColor: fold.paper }]} />
    </View>
  );
}

/** 体重柱生长（设计稿 sparkGrow，35ms 错峰） */
function WeightSparkline({
  points,
  animate,
}: {
  points: { ymd: string; weight_kg: number }[];
  animate: boolean;
}) {
  const { fold } = useFoldTheme();
  const progress = useRef(new Animated.Value(animate ? 0 : 1)).current;

  useEffect(() => {
    if (!animate) {
      progress.setValue(1);
      return;
    }
    progress.setValue(0);
    const anim = Animated.timing(progress, {
      toValue: 1,
      duration: 650,
      delay: 160,
      easing: FOLD_MOTION_EASE,
      useNativeDriver: false,
    });
    anim.start();
    return () => anim.stop();
  }, [animate, progress, points.length]);

  if (points.length < 2) {
    return (
      <View style={[styles.sparkEmpty, { backgroundColor: fold.paper2 }]}>
        <Text style={{ color: fold.faint, fontSize: 11 }}>
          {points.length === 1 ? '再记一次即可看趋势' : '保存体重后开始记录趋势'}
        </Text>
      </View>
    );
  }

  const values = points.map((p) => p.weight_kg);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(0.1, max - min);
  const last = points.length - 1;

  return (
    <View style={styles.sparkRow}>
      {points.map((p, i) => {
        const ratio = (p.weight_kg - min) / span;
        const targetH = 6 + ratio * 28;
        const height = progress.interpolate({
          inputRange: [0, 1],
          outputRange: [2, targetH],
        });
        const isNow = i === last;
        return (
          <View key={p.ymd} style={styles.sparkBarWrap}>
            <Animated.View
              style={[
                styles.sparkBar,
                {
                  height,
                  backgroundColor: isNow ? fold.pine2 : fold.sage,
                  opacity: isNow ? 1 : 0.55 + ratio * 0.35,
                },
              ]}
            />
          </View>
        );
      })}
    </View>
  );
}

export default function ProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const { wrapLoad } = usePageApiSync(PAGE_API_KEY);
  const reloadPageRef = useRef<((forceRefresh?: boolean) => Promise<void>) | null>(null);
  const { fold } = useFoldTheme();
  const { animate: motionOn } = useFoldMotionGate();
  const inboxBadges = useNotificationInboxBadges();
  const bellBadgeLabel = formatInboxBadgeCount(inboxBadges.total);
  const [user, setUser] = useState<UserRow | null>(null);
  const [pointsBalance, setPointsBalance] = useState(0);
  const [hub, setHub] = useState<ProfileHubStats | null>(null);
  const [syncClock, setSyncClock] = useState(formatSyncClock);
  const [moreOpen, setMoreOpen] = useState(false);
  const bellShake = useRef(new Animated.Value(0)).current;
  const prevBadgeRef = useRef(0);

  const contentMaxWidth = windowWidth >= 768 ? Layout.contentMaxWidthWide : undefined;
  const scrollBottomPad = Spacing['6xl'];

  const displayName = user?.name?.trim() || '给自己起个名字';
  const hasRealName = Boolean(user?.name?.trim());
  const heightText = metricDisplay(user?.height);
  const weightRaw = hub?.weightTrend.latestKg ?? user?.weight;
  const weightText =
    weightRaw != null && weightRaw > 0
      ? (Number.isInteger(weightRaw) ? String(weightRaw) : weightRaw.toFixed(1))
      : EMPTY;
  const ageText = metricDisplay(user?.age);
  const weightKg = hub?.weightTrend.latestKg ?? (user && user.weight > 0 ? user.weight : null);
  const hasBmi = Boolean(user && user.height > 0 && weightKg != null && weightKg > 0);
  const bmiText = hasBmi
    ? (weightKg! / ((user!.height / 100) * (user!.height / 100))).toFixed(1)
    : EMPTY;

  const loadUser = useCallback(async () => {
    try {
      setUser(await getDefaultUser());
    } catch {
      setUser(null);
    }
  }, []);

  const loadPoints = useCallback(async () => {
    try {
      setPointsBalance(await getPointsBalance());
    } catch {
      // keep
    }
  }, []);

  const loadHub = useCallback(async (nextUser: UserRow | null, balance: number) => {
    try {
      setHub(await loadProfileHubStats(nextUser, balance));
      setSyncClock(formatSyncClock());
    } catch (e) {
      if (__DEV__) console.warn('[profile] hub stats failed', e);
    }
  }, []);

  const reloadPage = useCallback(
    async (forceRefresh = false) => {
      try {
        await wrapLoad(async () => {
          await Promise.all([
            loadUser(),
            loadPoints(),
            fetchProfileLifeRoad({ serverFallback: true }).catch((e) => {
              if (__DEV__) console.warn('[profile] life-road fetch failed', e);
            }),
          ]);
        }, forceRefresh);
        const [currentUser, balance] = await Promise.all([
          getDefaultUser().catch(() => null),
          getPointsBalance().catch(() => pointsBalance),
        ]);
        if (currentUser) setUser(currentUser);
        setPointsBalance(balance);
        await loadHub(currentUser, balance);
      } catch {
        // ignore
      }
    },
    [wrapLoad, loadUser, loadPoints, loadHub, pointsBalance],
  );
  reloadPageRef.current = reloadPage;

  const { refreshControl } = usePagePullRefresh(PAGE_API_KEY, reloadPage);

  usePageFocusReload(PAGE_API_KEY, () => {
    void reloadPageRef.current?.(false).catch((e) => {
      if (__DEV__) console.warn('[profile] reload failed', e);
    });
  }, { observeLocal: false });
  useLocalQuery(LOCAL_TABLES, () => {
    void reloadPageRef.current?.(false).catch((e) => {
      if (__DEV__) console.warn('[profile] reload failed', e);
    });
  });

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      const unsubscribeUser = subscribeDefaultUserUpdates(() => {
        if (cancelled) return;
        void (async () => {
          await loadUser();
          const u = await getDefaultUser().catch(() => null);
          await loadHub(u, pointsBalance);
        })();
      });
      const unsubscribePoints = subscribePointsBalanceChanged((balance) => {
        if (cancelled) return;
        setPointsBalance(balance);
        void loadHub(user, balance);
      });
      return () => {
        cancelled = true;
        unsubscribeUser();
        unsubscribePoints();
      };
    }, [loadUser, loadHub, pointsBalance, user]),
  );

  useEffect(() => {
    void (async () => {
      await Promise.all([
        loadUser(),
        loadPoints(),
        fetchProfileLifeRoad({ serverFallback: true }).catch((e) => {
          if (__DEV__) console.warn('[profile] life-road fetch failed', e);
        }),
      ]);
      const [currentUser, balance] = await Promise.all([
        getDefaultUser().catch(() => null),
        getPointsBalance().catch(() => 0),
      ]);
      if (currentUser) setUser(currentUser);
      setPointsBalance(balance);
      await loadHub(currentUser, balance);
    })();
  }, [loadUser, loadPoints, loadHub]);

  // 新消息角标变化 → 铃铛轻摆（设计稿 03）
  useEffect(() => {
    const total = inboxBadges.total;
    if (total > prevBadgeRef.current && motionOn) {
      bellShake.setValue(0);
      Animated.sequence([
        Animated.timing(bellShake, {
          toValue: 1,
          duration: 120,
          easing: FOLD_MOTION_EASE,
          useNativeDriver: true,
        }),
        Animated.timing(bellShake, {
          toValue: -1,
          duration: 140,
          easing: FOLD_MOTION_EASE,
          useNativeDriver: true,
        }),
        Animated.timing(bellShake, {
          toValue: 0,
          duration: 160,
          easing: FOLD_MOTION_EASE,
          useNativeDriver: true,
        }),
      ]).start();
    }
    prevBadgeRef.current = total;
  }, [bellShake, inboxBadges.total, motionOn]);

  const openEdit = (tab?: 'basic' | 'persona' | 'body') => {
    if (tab) router.push(`/edit-profile?tab=${tab}`);
    else router.push('/edit-profile');
  };
  const openWishBoard = () => router.push('/wish-board');
  const openLifeRoad = () => router.push('/life-road');
  const retryHub = () => {
    void reloadPage(true);
  };

  const wishLine = (() => {
    if (!hub?.wish.nearestWishTitle) return '去心愿板添加一个目标';
    if (hub.wish.canRedeemNearest) return `可兑换「${hub.wish.nearestWishTitle}」`;
    return `离「${hub.wish.nearestWishTitle}」还差 ${formatPoints(hub.wish.pointsNeeded)} 分 · 最近可兑换心愿`;
  })();

  const fillChips = hub?.fillChips ?? [];
  const completenessPercent = hub?.completenessPercent ?? 0;
  const filledCount = hub?.filledCount ?? 0;
  const totalCount = hub?.totalCount ?? 0;

  const moreItems: ProfileMoreMenuItem[] = useMemo(() => {
    const weekIn = formatPoints(hub?.wish.weekEarned ?? 0);
    const weekOut = formatPoints(hub?.wish.weekSpent ?? 0);
    const redeemable = hub?.wish.redeemableCount ?? 0;
    const logs = hub?.menuCounts.completionLogs ?? 0;
    const memos = hub?.menuCounts.memos ?? 0;
    const recipes = hub?.menuCounts.recipes ?? 0;
    return [
      {
        key: 'notification-center',
        title: '提醒设置',
        subtitle: '通知权限、频道与免打扰',
        meta: '设置 ›',
        icon: 'notifications',
        onPress: () => router.push({ pathname: '/messages', params: { tab: 'settings' } }),
      },
      {
        key: 'project-completion-logs',
        title: '完成履历',
        subtitle: '已完成项目的只读归档',
        meta: logs > 0 ? `${logs} 项 ›` : '›',
        icon: 'history',
        onPress: () => router.push('/project-completion-logs'),
      },
      {
        key: 'wish-board',
        title: '心愿板',
        subtitle: '用积分兑换想要的生活',
        meta: redeemable > 0 ? `${redeemable} 件可换 ›` : '›',
                icon: 'card-giftcard',
        onPress: () => router.push('/wish-board'),
      },
      {
        key: 'points-ledger',
        title: '积分记录',
        subtitle: `本周 +${weekIn} / -${weekOut}`,
        meta: '明细 ›',
        icon: 'receipt-long',
        onPress: () => router.push('/points-ledger'),
      },
      {
        key: 'memo-list',
        title: '备忘录',
        subtitle: '随手记与 AI 摘要',
        meta: memos > 0 ? `${memos} 条 ›` : '›',
        icon: 'sticky-note-2',
        onPress: () => router.push('/memo-list'),
      },
      {
        key: 'my-recipes',
        title: '我的菜谱',
        subtitle: '常做的菜与营养估算',
        meta: recipes > 0 ? `${recipes} 道 ›` : '›',
        icon: 'restaurant-menu',
        onPress: () => router.push('/my-recipes'),
      },
      {
        key: 'blog',
        title: '博客',
        subtitle: '内嵌浏览 · www.jaxz.xyz',
        meta: '›',
        icon: 'menu-book',
        onPress: () => router.push('/blog'),
      },
    ];
  }, [hub, router]);

  const bellRotate = bellShake.interpolate({
    inputRange: [-1, 0, 1],
    outputRange: ['-8deg', '0deg', '8deg'],
  });

  const weekRange =
    hub?.week != null
      ? formatWeekRangeLabel(hub.week.weekStartYmd, hub.week.weekEndYmd)
      : '';

  const tasksDelta = hub?.week.tasksDeltaVsLastWeek;
  const tasksDeltaLabel =
    tasksDelta == null
      ? '本周完成 ›'
      : tasksDelta === 0
        ? '与上周持平 ›'
        : tasksDelta > 0
          ? `较上周 +${tasksDelta} ›`
          : `较上周 ${tasksDelta} ›`;

  const weightDelta = hub?.weightTrend.deltaKg;
  const weightDeltaLabel =
    weightDelta == null
      ? '近 30 天'
      : `${weightDelta > 0 ? '+' : ''}${weightDelta} kg`;

  const archiveGoal =
    hub?.archive.goal && hub.archive.goal !== '无'
      ? hub.archive.goal
      : '未设置';

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: fold.paper }]} edges={['left', 'right']}>
      <ScrollView
        refreshControl={refreshControl}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop: insets.top + 8,
            paddingBottom: scrollBottomPad + glassTabBarContentInset(insets.bottom),
            maxWidth: contentMaxWidth,
            width: '100%',
            alignSelf: 'center',
            paddingHorizontal: 16,
          },
        ]}
        onScroll={(e) => reportTabBarScroll(e.nativeEvent.contentOffset.y)}
        scrollEventThrottle={16}>
        {/* AppBar */}
        <FoldRiseIn animate={motionOn} index={0} staggerMs={45} fromY={10}>
          <View style={styles.appBar}>
            <View style={styles.appBarTitleWrap}>
              <Text style={[styles.appTitle, { color: fold.ink }]}>我的</Text>
              <Text style={[styles.appSub, { color: fold.muted }]}>
                PROFILE · 本机优先 · {syncClock} 已同步
              </Text>
            </View>
            <View style={styles.appBarTools}>
              <Animated.View style={{ transform: [{ rotate: bellRotate }] }}>
                <Pressable
                  onPress={() => router.push('/messages')}
                  accessibilityRole="button"
                  accessibilityLabel={
                    bellBadgeLabel ? `消息，${bellBadgeLabel} 条未读` : '消息'
                  }
                  style={({ pressed }) => [
                    styles.iconBtn,
                    {
                      borderColor: fold.line,
                      backgroundColor: pressed ? fold.paper2 : 'rgba(255,252,245,0.6)',
                      minWidth: MIN_TOUCH,
                      minHeight: MIN_TOUCH,
                    },
                  ]}>
                  <AppIcon name="notifications-none" size={18} color={fold.ink2} />
                  {bellBadgeLabel ? (
                    <View
                      pointerEvents="none"
                      style={[styles.bellBadge, { backgroundColor: fold.clay, borderColor: fold.paper }]}>
                      <Text style={styles.bellBadgeText}>{bellBadgeLabel}</Text>
                    </View>
                  ) : null}
                </Pressable>
              </Animated.View>
              <Pressable
                onPress={() => setMoreOpen(true)}
                accessibilityRole="button"
                accessibilityLabel="更多菜单"
                style={({ pressed }) => [
                  styles.iconBtn,
                  {
                    borderColor: fold.line,
                    backgroundColor: pressed ? fold.paper2 : 'rgba(255,252,245,0.65)',
                    minWidth: MIN_TOUCH,
                    minHeight: MIN_TOUCH,
                  },
                ]}>
                <AppIcon name="more-horiz" size={18} color={fold.ink2} />
              </Pressable>
            </View>
          </View>
        </FoldRiseIn>

        {/* Hero */}
        <FoldRiseIn animate={motionOn} index={1} staggerMs={45} fromY={12}>
          <View style={styles.hero}>
            <Pressable onPress={() => openEdit()} accessibilityRole="button" accessibilityLabel="编辑资料">
              <BreathingAvatar
                label={monogramFromName(hasRealName ? displayName : '我')}
                animate={motionOn}
              />
            </Pressable>
            <Pressable style={styles.heroTxt} onPress={() => openEdit()} accessibilityRole="button">
              <Text
                style={[styles.heroName, { color: fold.ink, fontFamily: foldFonts.serif }]}
                numberOfLines={1}>
                {displayName}
              </Text>
              <View style={styles.heroSubRow}>
                <View style={[styles.tagGreen, { backgroundColor: fold.sage2 }]}>
                  <Text style={[styles.tagGreenText, { color: fold.pine2 }]}>
                    资料 {completenessPercent}%
                  </Text>
                </View>
                <Text style={[styles.heroMeta, { color: fold.muted }]} numberOfLines={1}>
                  已完善 {filledCount} / {totalCount}
                  {hub?.zodiacLabel ? ` · ${hub.zodiacLabel}` : ''}
                </Text>
              </View>
            </Pressable>
            <Pressable
              onPress={() => openEdit()}
              accessibilityRole="button"
              accessibilityLabel="编辑"
              style={({ pressed }) => [
                styles.pillBtn,
                {
                  borderColor: fold.line2,
                  backgroundColor: pressed ? fold.paper2 : 'rgba(255,252,245,0.66)',
                  minHeight: Math.max(28, MIN_TOUCH * 0.7),
                },
              ]}>
              <AppIcon name="edit" size={12} color={fold.ink2} />
              <Text style={[styles.pillBtnText, { color: fold.ink2 }]}>编辑</Text>
            </Pressable>
          </View>
        </FoldRiseIn>

        {/* 资料待完善 */}
        {fillChips.length > 0 ? (
          <FoldRiseIn animate={motionOn} index={2} staggerMs={45} fromY={12}>
            <View style={[styles.card, { backgroundColor: fold.card, borderColor: fold.line }]}>
              <View style={styles.rowBetween}>
                <Text style={[styles.cardTitle, { color: fold.ink2 }]}>资料待完善</Text>
                <Text style={[styles.cardHint, { color: fold.faint }]}>补全后 AI 建议更准</Text>
              </View>
              <View style={styles.chipRow}>
                {fillChips.map((chip) => (
                  <Pressable
                    key={chip.key}
                    onPress={() => openEdit(chip.tab)}
                    style={({ pressed }) => [
                      styles.chip,
                      chip.filled
                        ? { backgroundColor: fold.sage2, borderColor: '#D6E4DA' }
                        : { backgroundColor: '#F7F0E2', borderColor: '#E6D9C4' },
                      pressed && { transform: [{ scale: 0.94 }] },
                    ]}>
                    <Text
                      style={[
                        styles.chipText,
                        { color: chip.filled ? fold.pine2 : '#8B6B3A' },
                      ]}>
                      {chip.label}
                      {chip.filled ? ' ✓' : ' ›'}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <View style={[styles.progressTrack, { backgroundColor: fold.paper2 }]}>
                <View
                  style={[
                    styles.progressFill,
                    {
                      width: `${Math.min(100, Math.max(0, completenessPercent))}%`,
                      backgroundColor: fold.sage,
                    },
                  ]}
                />
              </View>
            </View>
          </FoldRiseIn>
        ) : null}

        {/* 积分卡 */}
        <FoldRiseIn animate={motionOn} index={3} staggerMs={45} fromY={12}>
          <Pressable
            onPress={openWishBoard}
            accessibilityRole="button"
            accessibilityLabel={`当前积分 ${formatPoints(pointsBalance)}，打开心愿板`}
            style={({ pressed }) => [
              styles.pointsCard,
              {
                backgroundColor: fold.summaryBg,
                borderColor: '#2A4A3E',
                opacity: pressed ? 0.94 : 1,
                transform: [{ scale: pressed ? 0.985 : 1 }],
              },
            ]}>
            <View style={styles.pointsDecor} pointerEvents="none" />
            <View style={styles.pcTop}>
              <FoldCountUpText
                value={pointsBalance}
                animate={motionOn}
                duration={760}
                formatter={(n) => formatPoints(Math.round(n))}
                textStyle={[styles.pcBal, { color: fold.badgeText, fontFamily: foldFonts.mono }]}
              />
              <Text style={[styles.pcLab, { color: fold.summaryMuted }]}>当前积分</Text>
              {(hub?.wish.redeemableCount ?? 0) > 0 ? (
                <View style={[styles.tagAmber, { marginLeft: 'auto', backgroundColor: fold.badgeBg, borderColor: fold.badgeBorder }]}>
                  <Text style={[styles.tagAmberText, { color: fold.badgeText }]}>
                    可兑换 {hub!.wish.redeemableCount}
                  </Text>
                </View>
              ) : null}
            </View>
            <View style={styles.pcHint}>
              <AppIcon name="favorite" size={12} color="#E2B87C" />
              <Text style={styles.pcHintText} numberOfLines={2}>
                {wishLine}
              </Text>
            </View>
            <View style={styles.pcFoot}>
              <Text style={styles.pcWeek}>
                本周{' '}
                <Text style={{ color: '#9FD3B4', fontWeight: '700' }}>
                  +{formatPoints(hub?.wish.weekEarned ?? 0)}
                </Text>
                {' / '}
                <Text style={{ color: '#E9A08A', fontWeight: '700' }}>
                  -{formatPoints(hub?.wish.weekSpent ?? 0)}
                </Text>
              </Text>
              <View style={styles.pcCta}>
                <Text style={styles.pcCtaText}>去心愿板</Text>
                <AppIcon name="chevron-right" size={12} color="#F2E5CC" />
              </View>
            </View>
          </Pressable>
        </FoldRiseIn>

        {/* 道路 */}
        <FoldRiseIn animate={motionOn} index={4} staggerMs={45} fromY={12}>
          <ProfileRoadCard
            road={hub?.road}
            onOpen={openLifeRoad}
            onRetry={retryHub}
            onWriteDirection={openLifeRoad}
          />
        </FoldRiseIn>

        {/* 本周节奏 */}
        <FoldRiseIn animate={motionOn} index={5} staggerMs={45} fromY={12}>
          <View style={[styles.card, { backgroundColor: fold.card, borderColor: fold.line }]}>
            <View style={[styles.rowBetween, { marginBottom: 6 }]}>
              <Text style={[styles.cardTitle, { color: fold.ink2 }]}>本周节奏</Text>
              <Text style={[styles.cardHint, { color: fold.faint }]}>{weekRange}</Text>
            </View>
            <View style={styles.rhythmGrid}>
              <Pressable
                onPress={() => router.push('/(tabs)/tasks')}
                style={[styles.rh, { backgroundColor: fold.paper2 }]}>
                <FoldCountUpText
                  value={hub?.week.habitCheckInRatePercent ?? 0}
                  animate={motionOn}
                  duration={700}
                  delayMs={80}
                  textStyle={[styles.rhNum, { color: fold.pine, fontFamily: foldFonts.mono }]}
                />
                <Text style={[styles.rhLabel, { color: fold.muted }]}>习惯打卡率 %</Text>
                <Text style={[styles.rhEm, { color: fold.faint }]}>
                  {hub?.week.habitCheckInTotal ?? 0} / {hub?.week.habitExpectedSlots ?? 0} ›
                </Text>
              </Pressable>
              <Pressable
                onPress={() => router.push('/(tabs)/tasks')}
                style={[styles.rh, { backgroundColor: fold.paper2 }]}>
                <FoldCountUpText
                  value={hub?.week.tasksCompleted ?? 0}
                  animate={motionOn}
                  duration={700}
                  delayMs={120}
                  textStyle={[styles.rhNum, { color: fold.pine, fontFamily: foldFonts.mono }]}
                />
                <Text style={[styles.rhLabel, { color: fold.muted }]}>任务完成</Text>
                <Text style={[styles.rhEm, { color: fold.faint }]}>{tasksDeltaLabel}</Text>
              </Pressable>
              <Pressable
                onPress={() => router.push('/daily-review')}
                style={[styles.rh, { backgroundColor: fold.paper2 }]}>
                <Text style={[styles.rhNum, { color: fold.pine, fontFamily: foldFonts.mono }]}>
                  {hub?.week.dailyReviewDays ?? 0}/{hub?.week.daysElapsedInclusive ?? 1}
                </Text>
                <Text style={[styles.rhLabel, { color: fold.muted }]}>日复盘已写</Text>
                <Text style={[styles.rhEm, { color: fold.faint }]}>
                  {hub?.week.weeklyReviewDone ? '含周复盘 ✓ ›' : '写复盘 ›'}
                </Text>
              </Pressable>
            </View>
            <View style={styles.rhStrip}>
              {(hub?.week.dayStrip ?? [false, false, false, false, false, false, false]).map(
                (on, i) => {
                  const isToday = hub?.week.todayStripIndex === i;
                  return (
                    <View
                      key={`d${i}`}
                      style={[
                        styles.rhDot,
                        {
                          backgroundColor: isToday
                            ? fold.amber
                            : on
                              ? fold.sage
                              : fold.line2,
                        },
                      ]}
                    />
                  );
                },
              )}
            </View>
          </View>
        </FoldRiseIn>

        {/* 档案摘要 */}
        <FoldRiseIn animate={motionOn} index={6} staggerMs={45} fromY={12}>
          <Pressable
            onPress={() => openEdit('basic')}
            accessibilityRole="button"
            accessibilityLabel="档案摘要，点击编辑资料"
            style={({ pressed }) => [
              styles.card,
              {
                backgroundColor: fold.card,
                borderColor: fold.line,
                opacity: pressed ? 0.94 : 1,
              },
            ]}>
            <View style={[styles.rowBetween, { marginBottom: 5 }]}>
              <Text style={[styles.cardTitle, { color: fold.ink2 }]}>档案摘要</Text>
              <Text style={[styles.cardHint, { color: fold.faint }]}>点击编辑资料 ›</Text>
            </View>
            <View style={styles.sumGrid}>
              <View style={[styles.sumItem, { backgroundColor: fold.paper2 }]}>
                <Text style={[styles.sumKey, { color: fold.ink2 }]}>目标</Text>
                <Text style={[styles.sumVal, { color: fold.muted }]} numberOfLines={1}>
                  {archiveGoal}
                </Text>
              </View>
              <View style={[styles.sumItem, { backgroundColor: fold.paper2 }]}>
                <Text style={[styles.sumKey, { color: fold.ink2 }]}>生活习惯</Text>
                <Text style={[styles.sumVal, { color: fold.muted }]} numberOfLines={1}>
                  {hub?.archive.lifestyle ?? '未设置'}
                </Text>
              </View>
              <View style={[styles.sumItem, { backgroundColor: fold.paper2 }]}>
                <Text style={[styles.sumKey, { color: fold.ink2 }]}>健身日</Text>
                <Text style={[styles.sumVal, { color: fold.muted }]} numberOfLines={1}>
                  {hub?.archive.workoutDaysLabel ?? '未设置'}
                </Text>
              </View>
              <View style={[styles.sumItem, { backgroundColor: fold.paper2 }]}>
                <Text style={[styles.sumKey, { color: fold.ink2 }]}>人物画像</Text>
                <Text style={[styles.sumVal, { color: fold.muted }]} numberOfLines={1}>
                  {hub?.archive.personaFilled
                    ? `已填写 · ${hub.archive.personaCharCount} 字`
                    : '未填写'}
                </Text>
              </View>
            </View>
            <View style={[styles.sumItem, { backgroundColor: fold.paper2, marginTop: 5 }]}>
              <Text style={[styles.sumKey, { color: fold.ink2 }]}>饮食偏好</Text>
              <Text style={[styles.sumVal, { color: fold.muted }]} numberOfLines={2}>
                {hub?.archive.dietaryEmpty ? '未设置' : hub?.archive.dietarySummary ?? '未设置'}
              </Text>
            </View>
          </Pressable>
        </FoldRiseIn>

        {/* 身体数据 */}
        <FoldRiseIn animate={motionOn} index={7} staggerMs={45} fromY={12}>
          <Pressable
            onPress={() => openEdit('body')}
            accessibilityRole="button"
            accessibilityLabel="身体数据，进入体征"
            style={({ pressed }) => [
              styles.card,
              {
                backgroundColor: fold.card,
                borderColor: fold.line,
                opacity: pressed ? 0.94 : 1,
              },
            ]}>
            <View style={[styles.rowBetween, { marginBottom: 6 }]}>
              <Text style={[styles.cardTitle, { color: fold.ink2 }]}>身体数据</Text>
              <Text style={[styles.cardHint, { color: fold.faint }]}>进入体征 ›</Text>
            </View>
            <View style={styles.bodyGrid}>
              {[
                { v: heightText, u: '身高 cm' },
                { v: weightText, u: '体重 kg' },
                { v: bmiText, u: 'BMI' },
                { v: ageText, u: '年龄' },
              ].map((cell) => (
                <View key={cell.u} style={[styles.bodyCell, { backgroundColor: fold.paper2 }]}>
                  <Text style={[styles.bodyNum, { color: fold.pine, fontFamily: foldFonts.mono }]}>
                    {cell.v}
                  </Text>
                  <Text style={[styles.bodyUnit, { color: fold.muted }]}>{cell.u}</Text>
                </View>
              ))}
            </View>
            <WeightSparkline points={hub?.weightTrend.points ?? []} animate={motionOn} />
            <View style={styles.miniNote}>
              <AppIcon name="insights" size={12} color={fold.muted} />
              <Text style={[styles.miniNoteText, { color: fold.muted }]}>
                近 30 天{' '}
                <Text style={{ color: fold.pine2, fontWeight: '700' }}>{weightDeltaLabel}</Text>
                {' · '}
                {formatWeightRecordLabel(hub?.weightTrend.lastRecordYmd ?? null)}
              </Text>
            </View>
          </Pressable>
        </FoldRiseIn>
      </ScrollView>

      <ProfileMoreSheet
        visible={moreOpen}
        items={moreItems}
        onClose={() => setMoreOpen(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: {
    gap: 8,
  },
  appBar: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 2,
  },
  appBarTitleWrap: { flex: 1, minWidth: 0 },
  appTitle: { fontSize: 17, fontWeight: '700' },
  appSub: { fontSize: 10, marginTop: 2 },
  appBarTools: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  iconBtn: {
    width: 33,
    height: 33,
    borderRadius: 17,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bellBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 4,
    borderRadius: 9,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bellBadgeText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '800',
    lineHeight: 11,
  },
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingVertical: 4,
    paddingHorizontal: 2,
  },
  avatarWrap: {
    width: 50,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarGlow: {
    position: 'absolute',
    width: 54,
    height: 54,
    borderRadius: 18,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarGlyph: {
    fontSize: 20,
    fontWeight: '600',
  },
  avatarDot: {
    position: 'absolute',
    right: -1,
    bottom: -1,
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2.5,
  },
  heroTxt: { flex: 1, minWidth: 0 },
  heroName: { fontSize: 20, fontWeight: '600' },
  heroSubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 3,
  },
  heroMeta: { fontSize: 11, flexShrink: 1 },
  tagGreen: {
    height: 19,
    paddingHorizontal: 6,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tagGreenText: { fontSize: 10, fontWeight: '700' },
  pillBtn: {
    height: 28,
    paddingHorizontal: 11,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  pillBtnText: { fontSize: 11, fontWeight: '700' },
  card: {
    borderRadius: 19,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 11,
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  cardTitle: { fontSize: 12, fontWeight: '700' },
  cardHint: { fontSize: 10 },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 7,
  },
  chip: {
    height: 22,
    paddingHorizontal: 8,
    borderRadius: 7,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipText: { fontSize: 11, fontWeight: '700' },
  progressTrack: {
    height: 4,
    borderRadius: 2,
    marginTop: 8,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
  },
  pointsCard: {
    borderRadius: 19,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    overflow: 'hidden',
    position: 'relative',
  },
  pointsDecor: {
    position: 'absolute',
    right: -44,
    top: -64,
    width: 180,
    height: 180,
    borderRadius: 90,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(241,190,120,0.16)',
  },
  pcTop: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    zIndex: 1,
  },
  pcBal: {
    fontSize: 31,
    fontWeight: '700',
    lineHeight: 34,
  },
  pcLab: {
    fontSize: 10,
    letterSpacing: 1,
    paddingBottom: 4,
  },
  tagAmber: {
    height: 19,
    paddingHorizontal: 7,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tagAmberText: { fontSize: 10, fontWeight: '700' },
  pcHint: {
    marginTop: 7,
    borderRadius: 8,
    paddingVertical: 5,
    paddingHorizontal: 7,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.1)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    zIndex: 1,
  },
  pcHintText: {
    flex: 1,
    fontSize: 11,
    color: '#E4D6BB',
  },
  pcFoot: {
    marginTop: 9,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: 1,
  },
  pcWeek: {
    fontSize: 11,
    color: '#A9BFB3',
  },
  pcCta: {
    height: 25,
    paddingHorizontal: 9,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.16)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  pcCtaText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#F2E5CC',
  },
  rhythmGrid: {
    flexDirection: 'row',
    gap: 6,
  },
  rh: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 7,
    paddingHorizontal: 8,
  },
  rhNum: {
    fontSize: 17,
    fontWeight: '700',
    lineHeight: 20,
  },
  rhLabel: { fontSize: 10, marginTop: 2 },
  rhEm: { fontSize: 9, marginTop: 2 },
  rhStrip: {
    marginTop: 8,
    flexDirection: 'row',
    gap: 4,
  },
  rhDot: {
    flex: 1,
    height: 5,
    borderRadius: 2.5,
  },
  sumGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
  },
  sumItem: {
    width: '48%',
    flexGrow: 1,
    minWidth: '46%',
    borderRadius: 9,
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  sumKey: { fontSize: 11, fontWeight: '700' },
  sumVal: { fontSize: 11, marginTop: 2 },
  bodyGrid: {
    flexDirection: 'row',
    gap: 5,
  },
  bodyCell: {
    flex: 1,
    borderRadius: 9,
    paddingVertical: 6,
    paddingHorizontal: 4,
    alignItems: 'center',
  },
  bodyNum: {
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 18,
  },
  bodyUnit: { fontSize: 9, marginTop: 2 },
  sparkRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
    height: 34,
    marginTop: 8,
  },
  sparkBarWrap: {
    flex: 1,
    height: 34,
    justifyContent: 'flex-end',
  },
  sparkBar: {
    width: '100%',
    borderTopLeftRadius: 2,
    borderTopRightRadius: 2,
    minHeight: 2,
  },
  sparkEmpty: {
    marginTop: 8,
    height: 34,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniNote: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  miniNoteText: { fontSize: 11, flex: 1 },
});
