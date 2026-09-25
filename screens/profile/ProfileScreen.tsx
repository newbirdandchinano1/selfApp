import { AppIcon, type AppIconName } from '@/components/ui/app-icon';
import { AppText } from '@/components/ui/app-text';
import {
  getMinTouchTarget,
  getTaskUiColors,
  Layout,
  Radius,
  Shadows,
  Spacing,
} from '@/constants/design-tokens';
import { useAppTheme } from '@/hooks/use-app-theme';
import { usePageApiSync, usePagePullRefresh } from '@/hooks/use-page-api-sync';
import { usePageFocusReload } from '@/hooks/use-page-focus-reload';
import { subscribePointsBalanceChanged } from '@/lib/points-balance-events';
import {
  loadProfileHubStats,
  type ProfileHubStats,
} from '@/lib/profile-hub-stats';
import { getPointsBalance } from '@/lib/repositories/points/points';
import { getDefaultUser, subscribeDefaultUserUpdates } from '@/lib/repositories/users/user';
import type { UserRow } from '@/lib/repositories/users/user.types';
import { formatPoints } from '@/lib/reward-points';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

const PAGE_API_KEY = 'tabs/profile';
const MIN_TOUCH = getMinTouchTarget(Platform.OS);
const EMPTY = '—';

type ProfileMenuItem = {
  key: string;
  title: string;
  subtitle: string;
  icon: AppIconName;
  href:
    | '/wish-board'
    | '/points-ledger'
    | '/project-completion-logs'
    | '/memo-list'
    | '/my-recipes'
    | '/notification-center';
  accent: string;
  wash: string;
};

const PROFILE_MENU_BASE: Omit<ProfileMenuItem, 'accent' | 'wash'>[] = [
  {
    key: 'notification-center',
    title: '提醒总览',
    subtitle: '饮食、复盘、习惯与日程提醒',
    icon: 'notifications',
    href: '/notification-center',
  },
  {
    key: 'wish-board',
    title: '心愿板',
    subtitle: '用积分兑换心愿',
    icon: 'card-giftcard',
    href: '/wish-board',
  },
  {
    key: 'points-ledger',
    title: '积分记录',
    subtitle: '查看全部积分流水',
    icon: 'receipt-long',
    href: '/points-ledger',
  },
  {
    key: 'project-completion-logs',
    title: '完成履历',
    subtitle: '已完成项目的轻量记录',
    icon: 'history',
    href: '/project-completion-logs',
  },
  {
    key: 'memo-list',
    title: '备忘录',
    subtitle: '笔记、标签与置顶',
    icon: 'sticky-note-2',
    href: '/memo-list',
  },
  {
    key: 'my-recipes',
    title: '我的菜谱',
    subtitle: '收藏与自建菜谱',
    icon: 'restaurant-menu',
    href: '/my-recipes',
  },
];

function monogramFromName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '我';
  return trimmed.slice(0, 1);
}

function metricDisplay(value: number | null | undefined, empty = EMPTY): string {
  if (value == null || value <= 0) return empty;
  return String(value);
}

function WeightSparkline({
  points,
  color,
  trackColor,
}: {
  points: { ymd: string; weight_kg: number }[];
  color: string;
  trackColor: string;
}) {
  if (points.length < 2) {
    return (
      <View style={[styles.sparkEmpty, { backgroundColor: trackColor }]}>
        <AppText variant="caption" chrome style={{ color }}>
          {points.length === 1 ? '再记一次即可看趋势' : '保存体重后开始记录趋势'}
        </AppText>
      </View>
    );
  }
  const values = points.map((p) => p.weight_kg);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(0.1, max - min);
  return (
    <View style={styles.sparkRow}>
      {points.map((p) => {
        const ratio = (p.weight_kg - min) / span;
        const height = 8 + ratio * 36;
        return (
          <View key={p.ymd} style={styles.sparkBarWrap}>
            <View
              style={[
                styles.sparkBar,
                {
                  height,
                  backgroundColor: color,
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
  const reloadPageRef = useRef<((forceApi?: boolean) => Promise<void>) | null>(null);
  const { colors, isDark } = useAppTheme();
  const taskUi = getTaskUiColors(isDark);
  const [user, setUser] = useState<UserRow | null>(null);
  const [pointsBalance, setPointsBalance] = useState(0);
  const [hub, setHub] = useState<ProfileHubStats | null>(null);

  const contentMaxWidth = windowWidth >= 768 ? Layout.contentMaxWidthWide : undefined;
  const scrollBottomPad = Spacing['6xl'];

  const displayName = user?.name?.trim() || '给自己起个名字';
  const hasRealName = Boolean(user?.name?.trim());
  const heightText = metricDisplay(user?.height);
  const weightText = metricDisplay(hub?.weightTrend.latestKg ?? user?.weight);
  const ageText = metricDisplay(user?.age);
  const weightKg = hub?.weightTrend.latestKg ?? (user && user.weight > 0 ? user.weight : null);
  const hasBmi = Boolean(user && user.height > 0 && weightKg != null && weightKg > 0);
  const bmiText = hasBmi
    ? (weightKg! / ((user!.height / 100) * (user!.height / 100))).toFixed(1)
    : EMPTY;
  const bodyIncomplete = heightText === EMPTY || weightText === EMPTY || ageText === EMPTY;

  const menuItems: ProfileMenuItem[] = useMemo(
    () => [
      {
        ...PROFILE_MENU_BASE[0],
        accent: isDark ? '#38bdf8' : '#0284c7',
        wash: isDark ? 'rgba(56,189,248,0.16)' : 'rgba(2,132,199,0.1)',
      },
      {
        ...PROFILE_MENU_BASE[1],
        accent: taskUi.pointsAccent,
        wash: taskUi.pointsChipBg,
      },
      {
        ...PROFILE_MENU_BASE[2],
        accent: colors.primary,
        wash: taskUi.primaryWash,
      },
      {
        ...PROFILE_MENU_BASE[3],
        accent: isDark ? '#38bdf8' : '#0284c7',
        wash: isDark ? 'rgba(56,189,248,0.16)' : 'rgba(2,132,199,0.1)',
      },
      {
        ...PROFILE_MENU_BASE[4],
        accent: isDark ? '#a78bfa' : '#7c3aed',
        wash: isDark ? 'rgba(167,139,250,0.16)' : 'rgba(124,58,237,0.1)',
      },
      {
        ...PROFILE_MENU_BASE[5],
        accent: isDark ? '#34d399' : colors.secondary,
        wash: taskUi.successWash,
      },
    ],
    [colors.primary, colors.secondary, isDark, taskUi],
  );

  const loadUser = useCallback(async () => {
    try {
      const currentUser = await getDefaultUser();
      setUser(currentUser);
    } catch {
      setUser(null);
    }
  }, []);

  const loadPoints = useCallback(async () => {
    try {
      const balance = await getPointsBalance();
      setPointsBalance(balance);
    } catch {
      // keep last known balance
    }
  }, []);

  const loadHub = useCallback(async (nextUser: UserRow | null, balance: number) => {
    try {
      const stats = await loadProfileHubStats(nextUser, balance);
      setHub(stats);
    } catch (e) {
      if (__DEV__) console.warn('[profile] hub stats failed', e);
    }
  }, []);

  const reloadPage = useCallback(
    async (forceApi = false) => {
      try {
        await wrapLoad(async () => {
          await Promise.all([loadUser(), loadPoints()]);
        }, forceApi);
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

  usePageFocusReload(PAGE_API_KEY, (forceApi) => {
    void reloadPageRef.current?.(forceApi).catch((e) => {
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
      await Promise.all([loadUser(), loadPoints()]);
      const [currentUser, balance] = await Promise.all([
        getDefaultUser().catch(() => null),
        getPointsBalance().catch(() => 0),
      ]);
      if (currentUser) setUser(currentUser);
      setPointsBalance(balance);
      await loadHub(currentUser, balance);
    })();
  }, [loadUser, loadPoints, loadHub]);

  const openEdit = (tab?: 'basic' | 'persona' | 'body') => {
    if (tab) router.push(`/edit-profile?tab=${tab}`);
    else router.push('/edit-profile');
  };
  const openWishBoard = () => router.push('/wish-board');

  const stats = [
    { key: 'height', label: '身高', value: heightText, unit: heightText === EMPTY ? '' : 'cm' },
    { key: 'weight', label: '体重', value: weightText, unit: weightText === EMPTY ? '' : 'kg' },
    { key: 'bmi', label: 'BMI', value: bmiText, unit: '' },
    { key: 'age', label: '年龄', value: ageText, unit: ageText === EMPTY ? '' : '岁' },
  ];

  const wishLine = (() => {
    if (!hub?.wish.nearestWishTitle) return '去心愿板添加一个目标';
    if (hub.wish.canRedeemNearest) return `可兑换「${hub.wish.nearestWishTitle}」`;
    return `离「${hub.wish.nearestWishTitle}」还差 ${formatPoints(hub.wish.pointsNeeded)}`;
  })();

  const missingItems = hub?.completeness.filter((c) => !c.filled) ?? [];

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={['left', 'right']}>
      <ScrollView
        refreshControl={refreshControl}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop: insets.top + Spacing['3xl'],
            paddingBottom: scrollBottomPad,
            maxWidth: contentMaxWidth,
            width: '100%',
            alignSelf: 'center',
            paddingHorizontal: Layout.pagePaddingX,
          },
        ]}>
        <View style={styles.identityRow}>
          <View
            style={[
              styles.monogram,
              {
                backgroundColor: colors.primaryMuted,
                borderColor: taskUi.primaryWashBorder,
              },
            ]}
            accessibilityElementsHidden
            importantForAccessibility="no">
            <AppText variant="h1" chrome style={{ color: colors.primary, fontWeight: '700' }}>
              {monogramFromName(hasRealName ? displayName : '我')}
            </AppText>
          </View>

          <View style={styles.identityText}>
            <AppText variant="h1" style={{ color: colors.text }} numberOfLines={2}>
              {displayName}
            </AppText>
            <AppText variant="caption" chrome style={{ color: colors.textSecondary }}>
              {bodyIncomplete ? '完善身体数据，BMI 更准' : '身体数据已就绪'}
            </AppText>
          </View>

          <Pressable
            onPress={() => openEdit()}
            accessibilityRole="button"
            accessibilityLabel="编辑个人信息"
            hitSlop={Layout.hitSlop}
            style={({ pressed }) => [
              styles.editIconBtn,
              {
                minWidth: MIN_TOUCH,
                minHeight: MIN_TOUCH,
                backgroundColor: colors.surface,
                borderColor: colors.outline,
                opacity: pressed ? 0.82 : 1,
              },
            ]}>
            <AppIcon name="edit" size={20} color={colors.primary} />
          </Pressable>
        </View>

        {missingItems.length > 0 ? (
          <View
            style={[
              styles.checklistCard,
              { backgroundColor: colors.surface, borderColor: colors.outline },
            ]}>
            <AppText variant="title" style={{ color: colors.text, fontWeight: '700' }}>
              资料待完善 · {missingItems.length} 项
            </AppText>
            <View style={styles.checklistRow}>
              {missingItems.map((item) => (
                <Pressable
                  key={item.key}
                  onPress={() => openEdit(item.tab)}
                  style={({ pressed }) => [
                    styles.checkChip,
                    {
                      backgroundColor: colors.primaryMuted,
                      borderColor: taskUi.primaryWashBorder,
                      opacity: pressed ? 0.88 : 1,
                    },
                  ]}>
                  <AppText variant="caption" chrome style={{ color: colors.primary }}>
                    {item.label}
                  </AppText>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        <Pressable
          onPress={openWishBoard}
          accessibilityRole="button"
          accessibilityLabel={`当前积分 ${formatPoints(pointsBalance)}，打开心愿板`}
          style={({ pressed }) => [
            styles.pointsCard,
            Shadows.card,
            {
              backgroundColor: isDark ? '#2a2110' : '#fff8eb',
              borderColor: taskUi.pointsChipBorder,
              opacity: pressed ? 0.92 : 1,
              transform: [{ scale: pressed ? 0.985 : 1 }],
            },
          ]}>
          <View style={styles.pointsTop}>
            <View
              style={[
                styles.pointsIconWrap,
                { backgroundColor: isDark ? 'rgba(245,158,11,0.22)' : 'rgba(245,158,11,0.18)' },
              ]}>
              <AppIcon name="stars" size={22} color={taskUi.pointsAccent} />
            </View>
            <View style={styles.pointsCopy}>
              <AppText variant="label" chrome style={{ color: taskUi.pointsAccent }}>
                当前积分
              </AppText>
              <AppText
                variant="display"
                style={[styles.pointsValue, { color: colors.text }]}
                numberOfLines={1}>
                {formatPoints(pointsBalance)}
              </AppText>
            </View>
          </View>
          <View style={[styles.pointsMeta, { borderTopColor: taskUi.pointsChipBorder }]}>
            <AppText variant="bodyStrong" chrome style={{ color: taskUi.pointsAccent }} numberOfLines={1}>
              {wishLine}
            </AppText>
            <AppText variant="caption" chrome style={{ color: colors.textSecondary }}>
              本周 +{formatPoints(hub?.wish.weekEarned ?? 0)} / -{formatPoints(hub?.wish.weekSpent ?? 0)}
            </AppText>
          </View>
          <View style={[styles.pointsCta, { borderTopColor: taskUi.pointsChipBorder }]}>
            <AppText variant="bodyStrong" chrome style={{ color: taskUi.pointsAccent }}>
              去心愿板兑换
            </AppText>
            <AppIcon name="chevron-right" size={20} color={taskUi.pointsAccent} />
          </View>
        </Pressable>

        <View
          style={[
            styles.bodyCard,
            {
              backgroundColor: colors.surface,
              borderColor: colors.outline,
            },
          ]}>
          <Pressable
            onPress={() => router.push('/(tabs)/tasks')}
            accessibilityRole="button"
            accessibilityLabel="本周节奏，查看任务"
            style={({ pressed }) => [
              styles.bodyHeader,
              { opacity: pressed ? 0.88 : 1 },
            ]}>
            <AppText variant="title" style={{ color: colors.text, fontWeight: '700' }}>
              本周节奏
            </AppText>
            <AppText variant="caption" chrome style={{ color: colors.primary }}>
              查看任务
            </AppText>
          </Pressable>
          <View style={styles.rhythmRow}>
            <Pressable
              onPress={() => router.push('/(tabs)/tasks')}
              style={({ pressed }) => [styles.rhythmItem, pressed && { opacity: 0.88 }]}>
              <AppText variant="h3" chrome style={{ color: colors.text, fontWeight: '700' }}>
                {hub?.week.habitCheckInRatePercent ?? 0}%
              </AppText>
              <AppText variant="caption" chrome style={{ color: colors.textSecondary }}>
                习惯打卡
              </AppText>
            </Pressable>
            <Pressable
              onPress={() => router.push('/(tabs)/tasks')}
              style={({ pressed }) => [styles.rhythmItem, pressed && { opacity: 0.88 }]}>
              <AppText variant="h3" chrome style={{ color: colors.text, fontWeight: '700' }}>
                {hub?.week.tasksCompleted ?? 0}
              </AppText>
              <AppText variant="caption" chrome style={{ color: colors.textSecondary }}>
                任务完成
              </AppText>
            </Pressable>
            <Pressable
              onPress={() => router.push('/daily-review')}
              style={({ pressed }) => [styles.rhythmItem, pressed && { opacity: 0.88 }]}>
              <AppText variant="h3" chrome style={{ color: colors.text, fontWeight: '700' }}>
                {hub?.week.dailyReviewDays ?? 0}/{hub?.week.daysElapsedInclusive ?? 1}
              </AppText>
              <AppText variant="caption" chrome style={{ color: colors.textSecondary }}>
                {hub?.week.weeklyReviewDone ? '日复盘 · 周已写' : '日复盘'}
              </AppText>
            </Pressable>
          </View>
        </View>

        <Pressable
          onPress={() => openEdit('basic')}
          accessibilityRole="button"
          accessibilityLabel="档案摘要，点击编辑"
          style={({ pressed }) => [
            styles.bodyCard,
            {
              backgroundColor: colors.surface,
              borderColor: colors.outline,
              opacity: pressed ? 0.92 : 1,
            },
          ]}>
          <View style={styles.bodyHeader}>
            <AppText variant="title" style={{ color: colors.text, fontWeight: '700' }}>
              档案摘要
            </AppText>
            <AppText variant="caption" chrome style={{ color: colors.primary }}>
              编辑
            </AppText>
          </View>
          <AppText variant="body" style={{ color: colors.textSecondary }}>
            目标 {hub?.archive.goal ?? '无'} · {hub?.archive.lifestyle ?? '未设置'}
          </AppText>
          <AppText variant="caption" chrome style={{ color: colors.textSecondary }}>
            健身日 {hub?.archive.workoutDaysLabel ?? '未设置'}
            {' · '}
            画像 {hub?.archive.personaFilled ? '已填写' : '未填'}
            {' · '}
            饮食 {hub?.archive.dietarySummary ?? '未设置'}
          </AppText>
          <AppText variant="caption" chrome style={{ color: colors.textMuted, marginTop: Spacing.xs }}>
            影响饮食建议与训练日提醒
          </AppText>
        </Pressable>

        <Pressable
          onPress={() => openEdit('body')}
          accessibilityRole="button"
          accessibilityLabel={
            bodyIncomplete
              ? '身体数据未完善，点击编辑'
              : `身高 ${heightText} 厘米，体重 ${weightText} 千克，BMI ${bmiText}，年龄 ${ageText}，点击编辑`
          }
          style={({ pressed }) => [
            styles.bodyCard,
            {
              backgroundColor: colors.surface,
              borderColor: colors.outline,
              opacity: pressed ? 0.92 : 1,
            },
          ]}>
          <View style={styles.bodyHeader}>
            <AppText variant="title" style={{ color: colors.text, fontWeight: '700' }}>
              身体数据
            </AppText>
            <AppText variant="caption" chrome style={{ color: colors.primary }}>
              {bodyIncomplete ? '去完善' : '编辑'}
            </AppText>
          </View>
          <View style={styles.statsGrid}>
            {stats.map((item) => {
              const empty = item.value === EMPTY;
              return (
                <View
                  key={item.key}
                  style={[
                    styles.statTile,
                    {
                      backgroundColor: isDark ? taskUi.surfaceFrost : colors.background,
                      borderColor: taskUi.hairlineSoft,
                    },
                  ]}>
                  <AppText variant="label" chrome style={{ color: colors.textSecondary }}>
                    {item.label}
                  </AppText>
                  <AppText
                    variant="h3"
                    chrome
                    style={{
                      color: empty ? colors.textSecondary : colors.text,
                      fontWeight: empty ? '500' : '700',
                    }}>
                    {item.unit ? `${item.value} ${item.unit}` : item.value}
                  </AppText>
                </View>
              );
            })}
          </View>
          <View style={styles.trendBlock}>
            <AppText variant="caption" chrome style={{ color: colors.textSecondary }}>
              近 30 天体重（本地）
            </AppText>
            <WeightSparkline
              points={hub?.weightTrend.points ?? []}
              color={colors.primary}
              trackColor={isDark ? taskUi.surfaceFrost : colors.background}
            />
          </View>
        </Pressable>

        <AppText
          variant="label"
          chrome
          style={[styles.sectionLabel, { color: colors.textSecondary }]}>
          更多
        </AppText>
        <View
          style={[
            styles.menuGroup,
            {
              backgroundColor: colors.surface,
              borderColor: colors.outline,
            },
          ]}>
          {menuItems.map((item, idx) => {
            const isLast = idx === menuItems.length - 1;
            return (
              <Pressable
                key={item.key}
                onPress={() => router.push(item.href as never)}
                accessibilityRole="button"
                accessibilityLabel={`${item.title}，${item.subtitle}`}
                style={({ pressed }) => [
                  styles.menuRow,
                  {
                    minHeight: Math.max(MIN_TOUCH + 20, 64),
                    borderBottomWidth: isLast ? 0 : StyleSheet.hairlineWidth,
                    borderBottomColor: taskUi.hairline,
                    opacity: pressed ? 0.88 : 1,
                  },
                ]}>
                <View style={[styles.menuIconWrap, { backgroundColor: item.wash }]}>
                  <AppIcon name={item.icon} size={22} color={item.accent} />
                </View>
                <View style={styles.menuTextWrap}>
                  <AppText variant="title" style={{ color: colors.text, fontWeight: '700' }}>
                    {item.title}
                  </AppText>
                  <AppText variant="caption" chrome style={{ color: colors.textSecondary }}>
                    {item.subtitle}
                  </AppText>
                </View>
                <AppIcon name="chevron-right" size={20} color={colors.textSecondary} />
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: {
    gap: Spacing['3xl'],
  },
  identityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing['3xl'],
  },
  monogram: {
    width: 64,
    height: 64,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  identityText: {
    flex: 1,
    gap: Spacing.xs,
    minWidth: 0,
  },
  editIconBtn: {
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checklistCard: {
    borderRadius: Radius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing['4xl'],
    gap: Spacing.xl,
  },
  checklistRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  checkChip: {
    borderRadius: Radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.xl,
    minHeight: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pointsCard: {
    borderRadius: Radius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  pointsTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing['3xl'],
    paddingHorizontal: Spacing['4xl'],
    paddingTop: Spacing['4xl'],
    paddingBottom: Spacing['3xl'],
  },
  pointsIconWrap: {
    width: 48,
    height: 48,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pointsCopy: {
    flex: 1,
    gap: Spacing.xs,
    minWidth: 0,
  },
  pointsValue: {
    fontSize: 36,
    lineHeight: 42,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  pointsMeta: {
    paddingHorizontal: Spacing['4xl'],
    paddingBottom: Spacing['3xl'],
    gap: Spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing['3xl'],
  },
  pointsCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing['4xl'],
    paddingVertical: Spacing['3xl'],
    borderTopWidth: StyleSheet.hairlineWidth,
    minHeight: MIN_TOUCH,
  },
  bodyCard: {
    borderRadius: Radius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing['4xl'],
    gap: Spacing['3xl'],
  },
  bodyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rhythmRow: {
    flexDirection: 'row',
    gap: Spacing.md,
  },
  rhythmItem: {
    flex: 1,
    gap: Spacing.xs,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.md,
  },
  statTile: {
    width: '48%',
    flexGrow: 1,
    minWidth: '46%',
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: Spacing['3xl'],
    paddingHorizontal: Spacing['2xl'],
    gap: Spacing.xs,
  },
  trendBlock: {
    gap: Spacing.md,
  },
  sparkRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 3,
    minHeight: 48,
  },
  sparkBarWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
    minHeight: 48,
  },
  sparkBar: {
    width: '100%',
    maxWidth: 10,
    borderRadius: 4,
    alignSelf: 'center',
  },
  sparkEmpty: {
    minHeight: 48,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl,
  },
  sectionLabel: {
    marginTop: Spacing.sm,
    marginBottom: -Spacing.md,
    marginLeft: Spacing.sm,
    textTransform: 'none',
  },
  menuGroup: {
    borderRadius: Radius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  menuRow: {
    paddingHorizontal: Spacing['3xl'],
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xl,
  },
  menuIconWrap: {
    width: 42,
    height: 42,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuTextWrap: {
    flex: 1,
    gap: 2,
  },
});
