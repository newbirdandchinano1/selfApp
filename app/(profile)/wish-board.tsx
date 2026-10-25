import { ScreenEmptyState } from '@/components/crud';
import { AddWishBoardModal } from '@/components/wish-board/add-wish-board-modal';
import { WishBoardBalanceBar } from '@/components/wish-board/wish-board-balance-bar';
import {
  pickDefaultWishBoardTab,
  WishBoardSegment,
  type WishBoardTabId,
} from '@/components/wish-board/wish-board-segment';
import { WishBoardShelfTile } from '@/components/wish-board/wish-board-shelf-tile';
import {
  formatWishBoxPoints,
  greetingByHour,
  greetingMoonByHour,
  monogramFromName,
  type WishBoxPalette,
  type WishBoxShadowSet,
} from '@/constants/wish-box-ui';
import { formatInboxBadgeCount, useNotificationInboxBadges } from '@/hooks/use-notification-inbox-badges';
import { useWishBoxTheme, useWishStyles } from '@/hooks/use-wish-box-theme';
import { useReducedMotionState } from '@/hooks/use-reduced-motion';
import { useWishBoardData } from '@/hooks/use-wish-board-data';
import { formatSignedMoneyTrunc2 } from '@/lib/finance-net-worth';
import { getDefaultUser } from '@/lib/repositories/users/user';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ListRenderItemInfo,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

export default function WishBoardScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { c, gradients, shadows } = useWishBoxTheme();
  const styles = useWishStyles(makeStyles);
  const inboxBadges = useNotificationInboxBadges();
  const bellBadge = formatInboxBadgeCount(inboxBadges.total);

  const {
    balance,
    monthEarned,
    items,
    redeemRecords,
    loading,
    loadError,
    eligibilityById,
    readyItems,
    waitingItems,
    currentNetWorth,
    reload,
    refreshControl,
  } = useWishBoardData();

  const { enabled: reduceMotion, ready: motionReady } = useReducedMotionState();
  const entranceOn = motionReady && !reduceMotion;

  const [addVisible, setAddVisible] = useState(false);
  const [tab, setTab] = useState<WishBoardTabId>('ready');
  const [displayName, setDisplayName] = useState('朋友');
  const tabTouchedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void getDefaultUser()
      .then(user => {
        if (cancelled) return;
        const name = user?.name?.trim();
        if (name) setDisplayName(name);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const tabCounts = useMemo(
    () => ({
      ready: readyItems.length,
      waiting: waitingItems.length,
    }),
    [readyItems.length, waitingItems.length],
  );

  useEffect(() => {
    if (loading || tabTouchedRef.current) return;
    setTab(pickDefaultWishBoardTab(tabCounts));
  }, [loading, tabCounts]);

  /** 等待区里距离达成最近的心愿缺口：差 1,320 分时提示「再攒 X 可解锁全部心愿」 */
  const unlockShortfall = useMemo(() => {
    if (waitingItems.length === 0) return 0;
    let nearestGap = Number.POSITIVE_INFINITY;
    for (const item of waitingItems) {
      const gap = Math.max(0, item.cost_points - balance);
      if (gap > 0 && gap < nearestGap) nearestGap = gap;
    }
    return Number.isFinite(nearestGap) ? nearestGap : 0;
  }, [waitingItems, balance]);

  /** 等待区排序后最靠前的心愿：waitingItems 已按「还差多少积分」由近到远排好 */
  const nearestWaiting = waitingItems[0] ?? null;

  const nearestHint = useMemo(() => {
    if (!nearestWaiting) return null;
    const elig = eligibilityById.get(nearestWaiting.id);
    const shortfall = Math.max(0, nearestWaiting.cost_points - balance);
    type HintPart = { text: string; strong?: boolean };
    const groups: HintPart[][] = [];
    for (const p of elig?.pending ?? []) {
      if (p.kind === 'net_worth') {
        const need = elig?.conditions.min_net_worth;
        const gap = typeof need === 'number' ? need - currentNetWorth : null;
        groups.push(
          gap != null && gap > 0
            ? [{ text: '还差 ' }, { text: formatMoneyShort(gap), strong: true }]
            : [{ text: '净资产未达标' }],
        );
      } else if (p.kind === 'todo') {
        groups.push([{ text: `完成待办「${p.missing ? '关联项已删除' : p.title}」` }]);
      } else if (p.kind === 'task') {
        groups.push([{ text: `完成任务「${p.missing ? '关联项已删除' : p.title}」` }]);
      } else {
        groups.push([{ text: `完成项目「${p.missing ? '关联项已删除' : p.title}」` }]);
      }
    }
    if (groups.length === 0 && !elig?.pointsOk && shortfall > 0) {
      groups.push([{ text: '还差 ' }, { text: formatWishBoxPoints(shortfall), strong: true }, { text: ' 分' }]);
    }
    const parts: HintPart[] = [];
    groups.slice(0, 2).forEach((group, i) => {
      if (i > 0) parts.push({ text: ' · ' });
      parts.push(...group);
    });
    return {
      title: `${nearestWaiting.title} · 还差一点点`,
      parts:
        parts.length > 0
          ? parts
          : [{ text: elig?.message ?? '完成条件后就能兑换' } as HintPart],
      id: nearestWaiting.id,
    };
  }, [nearestWaiting, eligibilityById, balance, currentNetWorth]);

  const latestRedeem = redeemRecords[0] ?? null;

  const onTabChange = useCallback((next: WishBoardTabId) => {
    tabTouchedRef.current = true;
    setTab(next);
  }, []);

  /** 点击心愿卡进入详情 / 点击底部差距卡查看还差什么，对齐 06 号设计稿 */
  const goDetail = useCallback(
    (id: string) => {
      router.push({ pathname: '/wish-board/[id]', params: { id } });
    },
    [router],
  );

  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<(typeof readyItems)[number]>) => {
      const isReady = tab === 'ready';
      return (
        <View style={styles.cell}>
          <WishBoardEnter index={index} animate={entranceOn}>
            <WishBoardShelfTile
              variant={isReady ? 'ready' : 'waiting'}
              item={item}
              balance={balance}
              eligibility={eligibilityById.get(item.id)}
              onPress={() => goDetail(item.id)}
            />
          </WishBoardEnter>
        </View>
      );
    },
    [balance, eligibilityById, entranceOn, goDetail, tab],
  );

  const listData = tab === 'ready' ? readyItems : waitingItems;
  const groupLabel =
    tab === 'ready' ? '现在就能兑换' : '再攒一点就能兑换';

  const listHeader = (
    <View>
      <WishBoardBalanceBar
        balance={balance}
        monthEarned={monthEarned}
        unlockShortfall={tab === 'waiting' ? unlockShortfall : undefined}
        redeemCount={redeemRecords.length}
        onFootprints={() => router.push('/wish-board-footprints')}
      />

      {loadError ? <Text style={styles.errorText}>{loadError}</Text> : null}

      <View style={styles.sec}>
        <View style={styles.secLeft}>
          <Text style={[styles.secTitle, { color: c.ink }]}>我的心愿</Text>
          <View style={[styles.countTag, { backgroundColor: c.priSoft }]}>
            <Text style={styles.countTagText}>{items.filter(i => i.status === 'active').length}</Text>
          </View>
        </View>
        <View style={styles.secRight}>
          <Pressable
            onPress={() => setAddVisible(true)}
            style={({ pressed }) => [
              styles.addBtn,
              { opacity: pressed ? 0.88 : 1, backgroundColor: c.priSoft },
            ]}
            accessibilityRole="button"
            accessibilityLabel="新增心愿">
            <Text style={styles.addBtnText}>＋ 新增</Text>
          </Pressable>
          <Pressable
            onPress={() => router.push('/wish-board-manage')}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="心愿管理">
            <Text style={[styles.moreText, { color: c.muted }]}>管理 ›</Text>
          </Pressable>
        </View>
      </View>

      <WishBoardSegment tab={tab} counts={tabCounts} onChange={onTabChange} />

      <View style={styles.grouph}>
        <View style={styles.groupLine} />
        <Text style={styles.groupText}>{groupLabel}</Text>
        <View style={styles.groupLine} />
      </View>
    </View>
  );

  const listFooter =
    tab === 'ready' && latestRedeem ? (
      <Pressable
        onPress={() => router.push('/wish-board-footprints')}
        style={({ pressed }) => [
          styles.recent,
          shadows.soft,
          {
            opacity: pressed ? 0.94 : 1,
            backgroundColor: c.card,
            borderColor: c.line,
          },
        ]}
        accessibilityRole="button"
        accessibilityLabel="查看积分足迹">
        <View style={styles.recentIcon}>
          <Text style={styles.recentEmoji}>🎁</Text>
        </View>
        <View style={styles.recentBody}>
          <Text style={[styles.recentTitle, { color: c.ink }]} numberOfLines={1}>
            最近兑换 · {latestRedeem.title}
          </Text>
          <Text style={[styles.recentSub, { color: c.muted }]} numberOfLines={1}>
            {formatRecentAt(latestRedeem.redeemed_at)} · 花费{' '}
            {formatWishBoxPoints(latestRedeem.cost_points)} 分
          </Text>
        </View>
        <Text style={styles.recentPts}>-{formatWishBoxPoints(latestRedeem.cost_points)}</Text>
        <Text style={styles.recentArrow}>›</Text>
      </Pressable>
    ) : tab === 'waiting' ? (
      <View style={styles.waitingFooter}>
        {nearestHint ? (
          <Pressable
            onPress={() => goDetail(nearestHint.id)}
            style={({ pressed }) => [
              styles.tipCard,
              { opacity: pressed ? 0.94 : 1, backgroundColor: c.tip, borderColor: c.tipLine },
            ]}
            accessibilityRole="button">
            <View style={styles.tipIcon}>
              <TipIconBackground />
              <Text style={styles.tipEmoji}>💡</Text>
            </View>
            <View style={styles.tipBody}>
              <Text style={[styles.tipTitle, { color: c.ink }]} numberOfLines={1}>
                {nearestHint.title}
              </Text>
              <Text style={[styles.tipSub, { color: c.muted }]} numberOfLines={2}>
                {nearestHint.parts.map((part, i) => (
                  <Text key={i} style={part.strong ? styles.tipSubStrong : undefined}>
                    {part.text}
                  </Text>
                ))}
              </Text>
            </View>
            <Text style={styles.tipArrow}>›</Text>
          </Pressable>
        ) : null}
        <Pressable
          onPress={() => setAddVisible(true)}
          style={({ pressed }) => [
            styles.dashAdd,
            { opacity: pressed ? 0.9 : 1, backgroundColor: c.card, borderColor: c.line },
          ]}
          accessibilityRole="button"
          accessibilityLabel="新增心愿">
          <Text style={styles.dashAddText}>＋ 许下新的心愿</Text>
        </Pressable>
      </View>
    ) : null;

  const empty =
    !loadError && listData.length === 0 ? (
      <ScreenEmptyState
        icon={tab === 'ready' ? 'check-circle-outline' : 'hourglass-empty'}
        title={items.length === 0 ? '还没有心愿' : tab === 'ready' ? '暂无可兑换心愿' : '再攒一点就能兑换'}
        subtitle={
          items.length === 0
            ? '许下第一个心愿，攒够积分就能兑换'
            : tab === 'ready'
              ? waitingItems.length > 0
                ? '心愿都还差一点积分，先去攒攒吧'
                : '所有心愿都已兑换过啦'
              : readyItems.length > 0
                ? '现在就有心愿可以兑换啦'
                : '完成条件、攒够积分就能兑换'
        }
        actionLabel={items.length === 0 ? '去许愿' : undefined}
        onAction={items.length === 0 ? () => setAddVisible(true) : undefined}
        style={styles.empty}
      />
    ) : null;

  return (
    <View style={[styles.root, { paddingTop: insets.top, backgroundColor: c.bg }]}>
      <View style={styles.appbar}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={10}
          style={styles.backHit}
          accessibilityRole="button"
          accessibilityLabel="返回">
          <MaterialIcons name="arrow-back-ios-new" size={16} color={c.ink2} />
        </Pressable>
        <View style={styles.appbarLeft}>
          <Text style={[styles.hello, { color: c.muted }]}>
            {greetingByHour()}，{displayName}
            {greetingMoonByHour()}
          </Text>
          <Text style={[styles.appTitle, { color: c.ink }]}>心愿板</Text>
        </View>
        <View style={styles.appbarRight}>
          <Pressable
            onPress={() => router.push('/wish-board-footprints')}
            style={({ pressed }) => [
              styles.iconBtn,
              shadows.soft,
              { opacity: pressed ? 0.88 : 1, backgroundColor: c.card, borderColor: c.line },
            ]}
            accessibilityRole="button"
            accessibilityLabel="积分足迹">
            <MaterialIcons name="schedule" size={18} color={c.ink2} />
          </Pressable>
          <Pressable
            onPress={() => router.push('/notification-center')}
            style={({ pressed }) => [
              styles.iconBtn,
              shadows.soft,
              { opacity: pressed ? 0.88 : 1, backgroundColor: c.card, borderColor: c.line },
            ]}
            accessibilityRole="button"
            accessibilityLabel="通知">
            <MaterialIcons name="notifications-none" size={19} color={c.ink2} />
            {bellBadge ? <View style={styles.dot} /> : null}
          </Pressable>
          <View style={styles.avatar}>
            <AvatarBackground />
            <Text style={styles.avatarText}>{monogramFromName(displayName)}</Text>
          </View>
        </View>
      </View>

      {loading && items.length === 0 ? (
        <View style={styles.loadingBox}>
          <Text style={styles.loadingText}>加载中…</Text>
        </View>
      ) : (
        <FlatList
          key={tab}
          data={listData}
          keyExtractor={item => item.id}
          numColumns={2}
          renderItem={renderItem}
          ListHeaderComponent={listHeader}
          ListFooterComponent={listFooter}
          ListEmptyComponent={empty}
          contentContainerStyle={styles.listContent}
          columnWrapperStyle={styles.row}
          showsVerticalScrollIndicator={false}
          refreshControl={refreshControl}
        />
      )}

      <AddWishBoardModal
        visible={addVisible}
        onClose={() => setAddVisible(false)}
        onCreated={() => void reload()}
      />
    </View>
  );
}

function AvatarBackground() {
  const rawId = React.useId();
  const { gradients } = useWishBoxTheme();
  const gradientId = `wishAvatar${rawId.replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
      <Defs>
        <LinearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={gradients.avatar[0]} />
          <Stop offset="1" stopColor={gradients.avatar[1]} />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${gradientId})`} />
    </Svg>
  );
}

/** 提示卡图标渐变底（135° 对角，#FFB37E → #EF5F38） */
function TipIconBackground() {
  const rawId = React.useId();
  const { gradients } = useWishBoxTheme();
  const gradientId = `wishTip${rawId.replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
      <Defs>
        <LinearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={gradients.avatar[0]} />
          <Stop offset="1" stopColor={gradients.avatar[1]} />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${gradientId})`} />
    </Svg>
  );
}

function WishBoardEnter({
  index,
  animate,
  children,
}: {
  index: number;
  animate: boolean;
  children: React.ReactNode;
}) {
  const [value] = useState(() => new Animated.Value(animate ? 0 : 1));

  useEffect(() => {
    if (!animate) {
      value.setValue(1);
      return;
    }
    value.setValue(0);
    const anim = Animated.timing(value, {
      toValue: 1,
      duration: 460,
      delay: index * 55 + 120,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    anim.start();
    return () => {
      anim.stop();
    };
  }, [animate, index, value]);

  const translateY = value.interpolate({ inputRange: [0, 1], outputRange: [14, 0] });

  return (
    <Animated.View style={{ flex: 1, opacity: value, transform: [{ translateY }] }}>
      {children}
    </Animated.View>
  );
}

/** 金额展示：整数去掉 .00（设计稿「还差 ¥8,600」） */
function formatMoneyShort(value: number): string {
  const text = formatSignedMoneyTrunc2(value);
  return text.endsWith('.00') ? text.slice(0, -3) : text;
}

function formatRecentAt(raw: string): string {
  const d = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return raw;
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${mm}-${dd} ${hh}:${mi}`;
}

function makeStyles(c: WishBoxPalette, shadows: WishBoxShadowSet) {
  return StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: c.bg,
    },
    appbar: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingTop: 8,
      paddingBottom: 4,
      gap: 8,
    },
    backHit: {
      width: 28,
      height: 40,
      alignItems: 'center',
      justifyContent: 'center',
    },
    appbarLeft: {
      flex: 1,
      minWidth: 0,
    },
    hello: {
      fontSize: 13,
      color: c.muted,
      fontWeight: '600',
    },
    appTitle: {
      fontSize: 24,
      fontWeight: '800',
      color: c.ink,
      letterSpacing: 1,
      marginTop: 1,
    },
    appbarRight: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    iconBtn: {
      width: 40,
      height: 40,
      borderRadius: 14,
      backgroundColor: c.card,
      borderWidth: 1,
      borderColor: c.line,
      alignItems: 'center',
      justifyContent: 'center',
    },
    dot: {
      position: 'absolute',
      top: 9,
      right: 10,
      width: 8,
      height: 8,
      borderRadius: 99,
      backgroundColor: c.pri,
      borderWidth: 2,
      borderColor: c.card,
    },
    avatar: {
      width: 40,
      height: 40,
      borderRadius: 14,
      backgroundColor: c.pri,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
      shadowColor: c.pri,
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.35,
      shadowRadius: 9,
      elevation: 4,
    },
    avatarText: {
      color: '#fff',
      fontWeight: '800',
      fontSize: 16,
    },
    loadingBox: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    loadingText: {
      color: c.muted,
      fontWeight: '600',
    },
    listContent: {
      paddingBottom: 36,
      flexGrow: 1,
    },
    row: {
      paddingHorizontal: 16,
      gap: 10,
    },
    cell: {
      flex: 1,
    },
    errorText: {
      textAlign: 'center',
      color: c.danger,
      fontWeight: '600',
      marginTop: 8,
      paddingHorizontal: 20,
    },
    sec: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 20,
      marginTop: 12,
      marginBottom: 10,
    },
    secLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
    },
    secTitle: {
      fontSize: 16.5,
      fontWeight: '800',
      color: c.ink,
    },
    countTag: {
      backgroundColor: c.priSoft,
      borderRadius: 99,
      paddingHorizontal: 9,
      paddingVertical: 3,
    },
    countTagText: {
      fontSize: 11,
      fontWeight: '700',
      color: c.pri,
      fontVariant: ['tabular-nums'],
    },
    secRight: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    addBtn: {
      backgroundColor: c.priSoft,
      borderRadius: 99,
      paddingHorizontal: 13,
      paddingVertical: 7,
    },
    addBtnText: {
      fontSize: 12.5,
      fontWeight: '800',
      color: c.pri,
    },
    moreText: {
      fontSize: 12.5,
      color: c.muted,
      fontWeight: '600',
    },
    grouph: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 20,
      marginTop: 10,
      marginBottom: 7,
    },
    groupLine: {
      flex: 1,
      height: StyleSheet.hairlineWidth,
      backgroundColor: c.line,
    },
    groupText: {
      fontSize: 11.5,
      fontWeight: '800',
      color: c.muted,
      letterSpacing: 0.3,
    },
    recent: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      marginHorizontal: 16,
      marginTop: 11,
      paddingVertical: 11,
      paddingHorizontal: 13,
      backgroundColor: c.card,
      borderWidth: 1,
      borderColor: c.line,
      borderRadius: 18,
    },
    recentIcon: {
      width: 38,
      height: 38,
      borderRadius: 12,
      backgroundColor: c.coinWash,
      alignItems: 'center',
      justifyContent: 'center',
    },
    recentEmoji: {
      fontSize: 19,
    },
    recentBody: {
      flex: 1,
      minWidth: 0,
    },
    recentTitle: {
      fontSize: 12.5,
      fontWeight: '800',
      color: c.ink,
    },
    recentSub: {
      fontSize: 10.5,
      color: c.muted,
      marginTop: 2,
    },
    recentPts: {
      fontSize: 13.5,
      fontWeight: '800',
      color: c.pri,
      fontVariant: ['tabular-nums'],
    },
    recentArrow: {
      fontSize: 15,
      fontWeight: '800',
      color: c.muted,
    },
    waitingFooter: {
      marginTop: 2,
      paddingBottom: 8,
    },
    tipCard: {
      marginHorizontal: 16,
      marginTop: 12,
      paddingVertical: 14,
      paddingHorizontal: 15,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      borderRadius: 20,
      borderWidth: 1.5,
      borderStyle: 'dashed',
      borderColor: c.tipLine,
      backgroundColor: c.tip,
    },
    tipIcon: {
      width: 44,
      height: 44,
      borderRadius: 15,
      backgroundColor: c.pri,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    tipEmoji: {
      fontSize: 22,
    },
    tipBody: {
      flex: 1,
      minWidth: 0,
    },
    tipTitle: {
      fontSize: 13.5,
      fontWeight: '800',
      color: c.ink,
    },
    tipSub: {
      fontSize: 11.5,
      color: c.muted,
      marginTop: 3,
      lineHeight: 18,
    },
    tipSubStrong: {
      color: c.pri,
      fontWeight: '800',
    },
    tipArrow: {
      fontSize: 16,
      color: c.pri,
      fontWeight: '800',
    },
    dashAdd: {
      marginHorizontal: 16,
      marginTop: 12,
      borderWidth: 1.5,
      borderStyle: 'dashed',
      borderColor: c.dashedLine,
      borderRadius: 20,
      paddingVertical: 15,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: c.card,
    },
    dashAddText: {
      fontSize: 13,
      fontWeight: '800',
      color: c.dashedText,
    },
    empty: {
      paddingTop: 36,
    },
  });
}
