import { Skeleton } from '@/components/ui';
import {
  FoldBreathe,
  FoldCountUpText,
  FoldRiseIn,
  FOLD_MOTION_EASE,
  useFoldMotionGate,
} from '@/components/review/fold-motion';
import { Layout } from '@/constants/design-tokens';
import { useFinanceFoldTheme } from '@/constants/finance-fold-theme';
import { usePageApiSync, usePagePullRefresh } from '@/hooks/use-page-api-sync';
import { FINANCE_ACCOUNT_ICON_OPTIONS } from '@/lib/constants/finance-account-icons';
import { fetchFinanceCatalog } from '@/lib/finance-page-api';
import {
  computeNetWorthTotal,
  computeTotalAssets,
  computeTotalLiabilitiesAbs,
  financeLiabilityDebtMagnitude,
  getTxnNetWorthTotalDelta,
  isFinanceLiabilityAccount,
} from '@/lib/finance-net-worth';
import { isFinanceAccountExcludedFromAggregates } from '@/lib/repositories/finance/finance-account-extra';
import { getFinanceTransactions } from '@/lib/repositories/finance/finance';
import type {
  FinanceAccountBalanceRow,
  FinanceAccountTypeRow,
  FinanceTransactionRow,
} from '@/lib/repositories/finance/finance.types';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router/react-navigation';
import { useRouter } from 'expo-router';
import React from 'react';
import {
  Animated,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';

const PAGE_API_KEY = 'assets';

type UiAccountType = 'cash_wallet' | 'bank' | 'investment' | 'liability' | 'custom' | 'unknown';

type AllocSegKey = 'bank' | 'invest' | 'cash' | 'other';

type AllocSegment = {
  key: AllocSegKey;
  label: string;
  amount: number;
  color: string;
  groupAnchor: string;
};

const ALLOC_COLORS: Record<AllocSegKey, string> = {
  bank: '#1E4034',
  invest: '#779887',
  cash: '#D7A054',
  other: '#D8CFC0',
};

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

function formatMoney2(value: number) {
  const abs = Math.abs(value);
  return `¥${abs.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatSignedMoneyTrunc2(value: number) {
  if (!Number.isFinite(value)) return '¥0.00';
  const factor = 100;
  const truncated =
    value >= 0 ? Math.floor(value * factor + 1e-9) / factor : Math.ceil(value * factor - 1e-9) / factor;
  const abs = Math.abs(truncated);
  const prefix = truncated < 0 ? '-¥' : '¥';
  return `${prefix}${abs.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDebtMoney2(value: number) {
  const abs = Math.abs(value);
  if (abs === 0) return '¥0.00';
  return `-¥${abs.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatCompactMoney(value: number) {
  const abs = Math.abs(value);
  if (abs >= 10000) {
    const wan = abs / 10000;
    const text = wan >= 100 ? wan.toFixed(0) : wan.toFixed(1).replace(/\.0$/, '');
    return `¥${text}万`;
  }
  if (abs >= 1000) return `¥${(abs / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return `¥${abs.toFixed(0)}`;
}

function AssetsPageSkeleton({ paper2, line }: { paper2: string; line: string }) {
  return (
    <View style={styles.skeletonWrap}>
      <View style={[styles.heroCard, { backgroundColor: paper2, borderColor: line }]}>
        <Skeleton width={110} height={12} borderRadius={6} />
        <Skeleton width={200} height={36} borderRadius={10} style={{ marginTop: 12 }} />
        <Skeleton width={160} height={14} borderRadius={7} style={{ marginTop: 10 }} />
        <View style={styles.splitRow}>
          <Skeleton width="48%" height={58} borderRadius={10} />
          <Skeleton width="48%" height={58} borderRadius={10} />
        </View>
      </View>
      <View style={[styles.allocCard, { backgroundColor: paper2, borderColor: line }]}>
        <Skeleton width={72} height={14} borderRadius={6} />
        <View style={[styles.allocWrap, { marginTop: 14 }]}>
          <Skeleton width={94} height={94} borderRadius={47} />
          <View style={{ flex: 1, gap: 10 }}>
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} width="100%" height={14} borderRadius={6} />
            ))}
          </View>
        </View>
      </View>
      {Array.from({ length: 2 }).map((_, g) => (
        <View key={g} style={{ gap: 8 }}>
          <Skeleton width={120} height={12} borderRadius={6} />
          <View style={[styles.acctList, { backgroundColor: paper2, borderColor: line }]}>
            {Array.from({ length: 2 }).map((_, i) => (
              <View key={i} style={[styles.acctItem, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: line }]}>
                <Skeleton width={27} height={27} borderRadius={8} />
                <View style={{ flex: 1, gap: 6 }}>
                  <Skeleton width="55%" height={13} borderRadius={5} />
                  <Skeleton width="35%" height={10} borderRadius={5} />
                </View>
                <Skeleton width={72} height={14} borderRadius={6} />
              </View>
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

/** 资产配置环图：多段 stroke + 入场生长（设计稿 800ms）+ 轻呼吸 */
function AllocDonut({
  segments,
  total,
  animate,
  holeColor,
  holeBorder,
  monoFont,
  pine,
  muted,
}: {
  segments: AllocSegment[];
  total: number;
  animate: boolean;
  holeColor: string;
  holeBorder: string;
  monoFont?: string;
  pine: string;
  muted: string;
}) {
  const size = 94;
  const stroke = 18;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const segKey = segments.map((s) => `${s.key}:${s.amount}`).join('|');
  const progress = React.useRef(new Animated.Value(animate ? 0 : 1)).current;
  const breathe = React.useRef(new Animated.Value(1)).current;

  React.useEffect(() => {
    if (!animate) {
      progress.setValue(1);
      return;
    }
    progress.setValue(0);
    const anim = Animated.timing(progress, {
      toValue: 1,
      duration: 800,
      delay: 80,
      easing: FOLD_MOTION_EASE,
      useNativeDriver: false,
    });
    anim.start();
    return () => anim.stop();
  }, [animate, progress, segKey]);

  React.useEffect(() => {
    if (!animate) {
      breathe.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, {
          toValue: 1.035,
          duration: 1700,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(breathe, {
          toValue: 1,
          duration: 1700,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [animate, breathe]);

  let offset = 0;
  const arcs = segments
    .filter((s) => s.amount > 0 && total > 0)
    .map((s) => {
      const ratio = s.amount / total;
      const len = Math.max(c * ratio, 0.8);
      const start = offset;
      offset += len;
      return { ...s, len, start };
    });

  const hole = size - stroke * 2 + 2;

  return (
    <Animated.View style={{ width: size, height: size, transform: [{ scale: breathe }] }}>
      <Svg width={size} height={size} style={{ transform: [{ rotate: '-90deg' }] }}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={holeBorder}
          strokeWidth={stroke}
          fill="none"
          opacity={0.35}
        />
        {arcs.map((arc) => (
          <AnimatedCircle
            key={arc.key}
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={arc.color}
            strokeWidth={stroke}
            fill="none"
            strokeDasharray={`${arc.len} ${c}`}
            strokeDashoffset={progress.interpolate({
              inputRange: [0, 1],
              outputRange: [arc.len + (c - arc.start), c - arc.start],
            })}
          />
        ))}
      </Svg>
      <View
        pointerEvents="none"
        style={[
          styles.allocHole,
          {
            backgroundColor: holeColor,
            borderColor: holeBorder,
            width: hole,
            height: hole,
            borderRadius: hole / 2,
            top: (size - hole) / 2,
            left: (size - hole) / 2,
          },
        ]}>
        <Text style={[styles.allocCenterPct, { color: pine, fontFamily: monoFont }]}>100%</Text>
        <Text style={[styles.allocCenterSub, { color: muted }]}>
          {total > 0 ? formatCompactMoney(total) : '¥0'}
        </Text>
      </View>
    </Animated.View>
  );
}

export default function AssetsScreen() {
  const router = useRouter();
  const { wrapLoad } = usePageApiSync(PAGE_API_KEY);
  const insets = useSafeAreaInsets();
  const { ff, isDark, fonts: ffFonts } = useFinanceFoldTheme();
  const { animate: foldAnimate, motionReady } = useFoldMotionGate();

  const bg = ff.paper;
  const card = isDark ? ff.paper2 : ff.card;
  const paper2 = isDark ? ff.cardSoft : ff.paper2;
  const text = ff.ink;
  const subtle = ff.muted;
  const faint = ff.faint;
  const line = ff.line;
  const pine = ff.pine;
  const clay = ff.clay;
  const income = ff.income;
  const headerScrim = isDark ? 'rgba(23,43,36,0.94)' : 'rgba(243,238,228,0.94)';

  const [accounts, setAccounts] = React.useState<FinanceAccountBalanceRow[]>([]);
  const [accountTypes, setAccountTypes] = React.useState<FinanceAccountTypeRow[]>([]);
  const [transactions, setTransactions] = React.useState<FinanceTransactionRow[]>([]);
  const [initialLoadPending, setInitialLoadPending] = React.useState(true);
  const [skeletonMounted, setSkeletonMounted] = React.useState(true);
  /** 骨架淡出后再播入场，避免动效在透明层里播完 */
  const [entranceReady, setEntranceReady] = React.useState(false);
  const [syncLabel, setSyncLabel] = React.useState('同步中');

  const skeletonOpacity = React.useRef(new Animated.Value(1)).current;
  const contentOpacity = React.useRef(new Animated.Value(0)).current;
  const contentRevealDoneRef = React.useRef(false);
  const scrollRef = React.useRef<React.ComponentRef<typeof ScrollView>>(null);
  const groupYRef = React.useRef<Record<string, number>>({});

  const reload = React.useCallback(
    async (forceRefresh = false) => {
      await wrapLoad(async () => {
        try {
          const [catalog, txns] = await Promise.all([
            fetchFinanceCatalog({ serverFallback: true }),
            getFinanceTransactions({ cacheOnly: !forceRefresh }),
          ]);
          setAccounts(catalog.accounts);
          setAccountTypes(catalog.accountTypes);
          setTransactions(txns);
          const now = new Date();
          setSyncLabel(
            `最后同步 ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
          );
        } catch (e) {
          console.warn('Failed to load finance accounts:', e);
          setAccounts([]);
          setAccountTypes([]);
          setTransactions([]);
        } finally {
          setInitialLoadPending(false);
        }
      }, forceRefresh);
    },
    [wrapLoad],
  );

  const { refreshControl } = usePagePullRefresh(PAGE_API_KEY, reload);

  React.useEffect(() => {
    void reload();
  }, [reload]);

  useFocusEffect(
    React.useCallback(() => {
      void reload();
    }, [reload]),
  );

  React.useEffect(() => {
    if (initialLoadPending || !motionReady) return;
    if (contentRevealDoneRef.current) {
      contentOpacity.setValue(1);
      setEntranceReady(true);
      return;
    }
    contentRevealDoneRef.current = true;

    // 减少动态：直接终态，不播入场
    if (!foldAnimate) {
      skeletonOpacity.setValue(0);
      contentOpacity.setValue(1);
      setSkeletonMounted(false);
      setEntranceReady(true);
      return;
    }

    // 有动效：先只显示骨架；下一帧再挂载内容（FoldRiseIn 从 0 起），再淡出骨架
    setEntranceReady(false);
    contentOpacity.setValue(0);
    setSkeletonMounted(true);
    skeletonOpacity.setValue(1);

    const raf = requestAnimationFrame(() => {
      setEntranceReady(true);
      contentOpacity.setValue(1);
    });
    return () => cancelAnimationFrame(raf);
  }, [contentOpacity, foldAnimate, initialLoadPending, motionReady, skeletonOpacity]);

  /** 内容已挂载后再淡出骨架，避免露白或终态闪屏 */
  React.useEffect(() => {
    if (!entranceReady || !foldAnimate || !skeletonMounted) return;
    const raf = requestAnimationFrame(() => {
      Animated.timing(skeletonOpacity, {
        toValue: 0,
        duration: 200,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setSkeletonMounted(false);
      });
    });
    return () => cancelAnimationFrame(raf);
  }, [entranceReady, foldAnimate, skeletonMounted, skeletonOpacity]);

  const parseUiMeta = React.useCallback(
    (
      acc: FinanceAccountBalanceRow,
    ): {
      uiType: UiAccountType;
      uiIcon?: keyof typeof MaterialIcons.glyphMap;
      customTypeName?: string;
      uiIsLiability?: boolean;
    } => {
      try {
        const raw = acc.extra_data ? (JSON.parse(acc.extra_data) as unknown) : null;
        if (raw && typeof raw === 'object') {
          const obj = raw as Record<string, unknown>;
          const uiType = obj.ui_account_type;
          const iconKey = obj.ui_icon_key;
          const customTypeName = typeof obj.ui_custom_type_name === 'string' ? obj.ui_custom_type_name.trim() : '';
          const uiIsLiability = typeof obj.ui_is_liability === 'boolean' ? obj.ui_is_liability : undefined;
          const typeOk =
            uiType === 'cash_wallet' ||
            uiType === 'bank' ||
            uiType === 'investment' ||
            uiType === 'liability' ||
            uiType === 'custom';

          let uiIcon: keyof typeof MaterialIcons.glyphMap | undefined;
          if (typeof iconKey === 'string' && iconKey.length > 0) {
            const matchedIcon = FINANCE_ACCOUNT_ICON_OPTIONS.find((item) => item.key === iconKey)?.icon;
            if (matchedIcon) {
              uiIcon = matchedIcon;
            } else if (iconKey in MaterialIcons.glyphMap) {
              uiIcon = iconKey as keyof typeof MaterialIcons.glyphMap;
            }
          }

          return {
            uiType: typeOk ? (uiType as UiAccountType) : acc.account_type === 'liability' ? 'liability' : 'unknown',
            uiIcon,
            customTypeName: customTypeName || undefined,
            uiIsLiability,
          };
        }
      } catch {
        // ignore
      }
      return { uiType: acc.account_type === 'liability' ? 'liability' : 'unknown', uiIcon: undefined };
    },
    [],
  );

  const customTypeGroups = React.useMemo(() => {
    const map = new Map<string, FinanceAccountBalanceRow[]>();
    for (const a of accounts) {
      const meta = parseUiMeta(a);
      if (meta.uiType !== 'custom') continue;
      const key = meta.customTypeName && meta.customTypeName.length > 0 ? meta.customTypeName : '自定义';
      const list = map.get(key);
      if (list) list.push(a);
      else map.set(key, [a]);
    }
    const groups: Array<{ name: string; rows: FinanceAccountBalanceRow[] }> = [];
    for (const row of accountTypes) {
      const rows = map.get(row.name) ?? [];
      if (rows.length > 0) groups.push({ name: row.name, rows });
    }
    for (const [name, rows] of map.entries()) {
      if (!accountTypes.some((item) => item.name === name) && rows.length > 0) {
        groups.push({ name, rows });
      }
    }
    return groups;
  }, [accountTypes, accounts, parseUiMeta]);

  const grouped = React.useMemo(() => {
    const result: Record<UiAccountType, FinanceAccountBalanceRow[]> = {
      cash_wallet: [],
      bank: [],
      investment: [],
      liability: [],
      custom: [],
      unknown: [],
    };
    for (const a of accounts) {
      const { uiType } = parseUiMeta(a);
      (result[uiType] ?? result.unknown).push(a);
    }
    return result;
  }, [accounts, parseUiMeta]);

  const isLiabilityAccount = React.useCallback(
    (acc: FinanceAccountBalanceRow) => {
      if (isFinanceLiabilityAccount(acc)) return true;
      const meta = parseUiMeta(acc);
      if (meta.uiType === 'liability' || meta.uiIsLiability) return true;
      if (meta.uiType !== 'custom' || !meta.customTypeName) return false;
      return accountTypes.some((type) => type.name === meta.customTypeName && type.is_liability === 1);
    },
    [accountTypes, parseUiMeta],
  );

  const groupMixedLedgerSum = React.useCallback(
    (rows: FinanceAccountBalanceRow[]) =>
      rows.reduce((sum, a) => {
        if (isLiabilityAccount(a) || isFinanceLiabilityAccount(a)) {
          return sum + financeLiabilityDebtMagnitude(a.balance);
        }
        if (isFinanceAccountExcludedFromAggregates(a.extra_data)) return sum;
        return sum + Math.max(0, a.balance ?? 0);
      }, 0),
    [isLiabilityAccount],
  );

  const sumLiabilityDebtMagnitudes = React.useCallback(
    (rows: FinanceAccountBalanceRow[]) =>
      rows.reduce((sum, a) => sum + financeLiabilityDebtMagnitude(a.balance), 0),
    [],
  );

  const formatAccountRowBalance = React.useCallback(
    (acc: FinanceAccountBalanceRow) =>
      isLiabilityAccount(acc)
        ? formatDebtMoney2(-financeLiabilityDebtMagnitude(acc.balance))
        : formatMoney2(Math.max(0, acc.balance ?? 0)),
    [isLiabilityAccount],
  );

  const totalAssets = React.useMemo(() => computeTotalAssets(accounts), [accounts]);
  const totalLiabilitiesAbs = React.useMemo(() => computeTotalLiabilitiesAbs(accounts), [accounts]);
  const netWorth = React.useMemo(() => computeNetWorthTotal(accounts), [accounts]);

  const monthTrend = React.useMemo(() => {
    const now = new Date();
    const monthStartMs = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0).getTime();
    let delta = 0;
    let hit = 0;
    for (const txn of transactions) {
      const ms = new Date(txn.happened_at).getTime();
      if (!Number.isFinite(ms) || ms < monthStartMs) continue;
      delta += getTxnNetWorthTotalDelta(txn);
      hit += 1;
    }
    const base = netWorth - delta;
    const pct =
      Math.abs(base) >= 0.01 ? (delta / Math.abs(base)) * 100 : hit > 0 && Math.abs(delta) >= 0.01 ? 100 : null;
    return { delta, pct, hasActivity: hit > 0 };
  }, [netWorth, transactions]);

  const sumAssetBalanceForDisplay = React.useCallback((rows: FinanceAccountBalanceRow[]) => {
    return rows.reduce((sum, a) => {
      if (isFinanceAccountExcludedFromAggregates(a.extra_data)) return sum;
      return sum + Math.max(0, a.balance ?? 0);
    }, 0);
  }, []);

  /** 资产配置：按类型（银行 / 投资 / 现金 / 其他），负债不计 */
  const allocSegments = React.useMemo<AllocSegment[]>(() => {
    const buckets: Record<AllocSegKey, number> = { bank: 0, invest: 0, cash: 0, other: 0 };
    for (const a of accounts) {
      if (isLiabilityAccount(a) || isFinanceAccountExcludedFromAggregates(a.extra_data)) continue;
      const amount = Math.max(0, a.balance ?? 0);
      if (amount <= 0) continue;
      const { uiType } = parseUiMeta(a);
      if (uiType === 'bank') buckets.bank += amount;
      else if (uiType === 'investment') buckets.invest += amount;
      else if (uiType === 'cash_wallet') buckets.cash += amount;
      else buckets.other += amount;
    }
    const order: AllocSegKey[] = ['bank', 'invest', 'cash', 'other'];
    const labels: Record<AllocSegKey, string> = {
      bank: '银行',
      invest: '投资',
      cash: '现金',
      other: '其他',
    };
    const anchors: Record<AllocSegKey, string> = {
      bank: 'bank',
      invest: 'invest',
      cash: 'cash',
      other: customTypeGroups[0] ? `custom-${customTypeGroups[0].name}` : 'unknown',
    };
    return order
      .map((key) => ({
        key,
        label: labels[key],
        amount: buckets[key],
        color: isDark && key === 'bank' ? ff.pine : ALLOC_COLORS[key],
        groupAnchor: anchors[key],
      }))
      .filter((s) => s.amount > 0);
  }, [accounts, customTypeGroups, ff.pine, isDark, isLiabilityAccount, parseUiMeta]);

  const hasAssets = totalAssets > 0;

  const accountIcon = React.useCallback(
    (acc: FinanceAccountBalanceRow) => {
      const { uiIcon } = parseUiMeta(acc);
      if (uiIcon) return uiIcon;
      if (acc.account_type === 'liability') return 'credit-card';
      if (acc.name.includes('现金')) return 'payments';
      if (acc.name.includes('支付宝')) return 'account-balance-wallet';
      if (acc.name.includes('微信')) return 'chat';
      if (acc.name.includes('银行')) return 'account-balance';
      return 'account-balance-wallet';
    },
    [parseUiMeta],
  );

  const accountDotLabel = React.useCallback((acc: FinanceAccountBalanceRow) => {
    const name = acc.name.trim();
    if (!name) return '账';
    return name.slice(0, 1);
  }, []);

  const openAccountDetail = React.useCallback(
    (acc: FinanceAccountBalanceRow) => {
      router.push({
        pathname: '/account-detail',
        params: {
          accountId: String(acc.id),
          accountName: acc.name,
          accountNo: acc.account_no ?? '',
        },
      });
    },
    [router],
  );

  const scrollToGroup = React.useCallback((anchor: string) => {
    const y = groupYRef.current[anchor];
    if (typeof y === 'number') {
      scrollRef.current?.scrollTo({ y: Math.max(0, y - 12), animated: true });
    }
  }, []);

  const onGroupLayout = React.useCallback((key: string, e: LayoutChangeEvent) => {
    groupYRef.current[key] = e.nativeEvent.layout.y;
  }, []);

  const trendTone = monthTrend.delta > 0.009 ? 'up' : monthTrend.delta < -0.009 ? 'down' : 'flat';
  const trendColor = trendTone === 'up' ? income : trendTone === 'down' ? clay : subtle;
  const trendPctLabel =
    monthTrend.pct == null
      ? null
      : `${monthTrend.delta >= 0 ? '+' : '−'}${
          Math.abs(monthTrend.pct) >= 10 ? Math.abs(monthTrend.pct).toFixed(0) : Math.abs(monthTrend.pct).toFixed(1)
        }%`;

  const fabBottom = Math.max(insets.bottom, 12) + 24;
  const scrollBottomPad = fabBottom + 56;
  /**
   * 入场总闸：仅在内容首挂且允许动效时为 true。
   * 内容在 entranceReady 后才挂载，故 FoldRiseIn 首屏即从 0 起，无终态闪屏。
   */
  const motionOn = foldAnimate && entranceReady;
  const showContent = entranceReady || (motionReady && !foldAnimate);
  const hasAnyAccount = accounts.length > 0;

  /** 列表组基础延迟：接在资产配置卡之后 */
  const LIST_ENTRANCE_BASE_MS = 220;
  const LIST_GROUP_GAP_MS = 85;
  const LIST_ROW_STAGGER_MS = 48;

  const renderAccountGroup = (
    key: string,
    title: string,
    titleEn: string,
    tone: 'bank' | 'invest' | 'debt' | 'neutral',
    rows: FinanceAccountBalanceRow[],
    sumLabel: string,
    groupIndex: number,
    debtStyle = false,
  ) => {
    if (rows.length === 0) return null;
    const dotBg =
      tone === 'invest'
        ? isDark
          ? 'rgba(215,160,84,0.22)'
          : '#F4E9D7'
        : tone === 'debt'
          ? isDark
            ? 'rgba(198,106,76,0.22)'
            : '#F3E0D9'
          : isDark
            ? 'rgba(134,167,149,0.2)'
            : '#E9EFE8';
    const dotFg =
      tone === 'invest' ? ff.amberInk : tone === 'debt' ? ff.clayInk : isDark ? ff.sage : '#486654';
    const groupDelay = LIST_ENTRANCE_BASE_MS + groupIndex * LIST_GROUP_GAP_MS;

    return (
      <View key={key} style={styles.acctGroup} onLayout={(e) => onGroupLayout(key, e)}>
        <FoldRiseIn
          animate={motionOn}
          delayMs={groupDelay}
          duration={420}
          fromY={16}
          fromScale={0.97}
          staggerMs={0}>
          <View style={styles.acctGroupH}>
            <Text style={[styles.acctGroupTitle, { color: debtStyle ? clay : '#4D5C52' }]}>
              {title} <Text style={{ color: faint }}>/ {titleEn}</Text>
            </Text>
            <Text style={[styles.acctGroupSum, { color: debtStyle ? clay : subtle, fontFamily: ffFonts.mono }]}>
              {sumLabel}
            </Text>
          </View>
        </FoldRiseIn>
        <View style={[styles.acctList, { backgroundColor: card, borderColor: line }]}>
          {rows.map((acc, index) => {
            const meta = parseUiMeta(acc);
            const subParts = [
              meta.uiType === 'bank'
                ? '储蓄卡'
                : meta.uiType === 'investment'
                  ? '基金'
                  : meta.uiType === 'cash_wallet'
                    ? '现金'
                    : meta.uiType === 'liability'
                      ? '负债'
                      : meta.customTypeName || '账户',
              acc.account_no ? (acc.account_no.length <= 6 ? acc.account_no : `尾号 ${acc.account_no.slice(-4)}`) : null,
              acc.note?.trim() || null,
            ].filter(Boolean);
            return (
              <FoldRiseIn
                key={acc.id}
                animate={motionOn}
                index={index}
                staggerMs={LIST_ROW_STAGGER_MS}
                delayMs={groupDelay + 55}
                duration={400}
                fromY={14}
                fromScale={0.98}>
                <Pressable
                  onPress={() => openAccountDetail(acc)}
                  accessibilityRole="button"
                  accessibilityLabel={`${acc.name} ${formatAccountRowBalance(acc)}`}
                  style={({ pressed }) => [
                    styles.acctItem,
                    index > 0
                      ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: isDark ? line : '#ECE4D6' }
                      : null,
                    pressed && { opacity: 0.82, transform: [{ scale: 0.985 }] },
                  ]}>
                  <View style={[styles.acctDot, { backgroundColor: dotBg }]}>
                    {tone === 'invest' || tone === 'debt' ? (
                      <MaterialIcons name={accountIcon(acc)} size={14} color={dotFg} />
                    ) : (
                      <Text style={[styles.acctDotText, { color: dotFg }]}>{accountDotLabel(acc)}</Text>
                    )}
                  </View>
                  <View style={styles.acctMain}>
                    <Text style={[styles.acctName, { color: text }]} numberOfLines={1}>
                      {acc.name}
                      {acc.account_no && meta.uiType === 'bank' ? ` · ${acc.account_no.slice(-4)}` : ''}
                    </Text>
                    {subParts.length > 0 ? (
                      <Text style={[styles.acctSub, { color: faint }]} numberOfLines={1}>
                        {subParts.join(' · ')}
                      </Text>
                    ) : null}
                  </View>
                  <Text
                    style={[
                      styles.acctValue,
                      {
                        color: debtStyle || isLiabilityAccount(acc) ? clay : '#405147',
                        fontFamily: ffFonts.mono,
                      },
                    ]}>
                    {formatAccountRowBalance(acc)}
                  </Text>
                  <MaterialIcons name="chevron-right" size={16} color={faint} />
                </Pressable>
              </FoldRiseIn>
            );
          })}
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: bg }]} edges={['left', 'right']}>
      <View style={[styles.header, { paddingTop: insets.top, backgroundColor: headerScrim, borderBottomColor: line }]}>
        <View style={styles.headerInner}>
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => [
              styles.foldIconBtn,
              { borderColor: line, backgroundColor: card },
              pressed && { opacity: 0.85, transform: [{ scale: 0.94 }] },
            ]}
            accessibilityRole="button"
            accessibilityLabel="返回">
            <MaterialIcons name="arrow-back" size={16} color={ff.ink2} />
          </Pressable>
          <View style={styles.headerText}>
            <Text style={[styles.headerTitle, { color: text, fontFamily: ffFonts.serif }]}>资产</Text>
            <Text style={[styles.headerSub, { color: subtle }]} numberOfLines={1}>
              {hasAnyAccount ? `真实账户 · ${syncLabel}` : '真实账户 · 还没有开始'}
            </Text>
          </View>
          <View style={styles.headerActions}>
            <Pressable
              onPress={() => router.push('/finance-calendar')}
              style={({ pressed }) => [
                styles.foldIconBtn,
                { borderColor: line, backgroundColor: card },
                pressed && { opacity: 0.85, transform: [{ scale: 0.94 }] },
              ]}
              accessibilityRole="button"
              accessibilityLabel="财务日历">
              <MaterialIcons name="calendar-today" size={16} color={ff.ink2} />
            </Pressable>
          </View>
        </View>
      </View>

      <View style={styles.body}>
        {skeletonMounted ? (
          <Animated.View
            pointerEvents={initialLoadPending || !showContent ? 'auto' : 'none'}
            style={[StyleSheet.absoluteFill, { opacity: skeletonOpacity, zIndex: 2 }]}>
            <ScrollView
              contentContainerStyle={[
                styles.content,
                {
                  paddingBottom: scrollBottomPad,
                  maxWidth: Layout.contentMaxWidth,
                  alignSelf: 'center',
                  width: '100%',
                },
              ]}
              showsVerticalScrollIndicator={false}>
              <AssetsPageSkeleton paper2={paper2} line={line} />
            </ScrollView>
          </Animated.View>
        ) : null}

        {/* 仅 entranceReady 后挂载：FoldRiseIn 首屏 animate=true 从 0 起，无终态闪屏 */}
        {showContent ? (
        <Animated.View style={{ flex: 1, opacity: contentOpacity }}>
          <ScrollView
            ref={scrollRef}
            refreshControl={refreshControl}
            contentContainerStyle={[
              styles.content,
              {
                paddingBottom: scrollBottomPad,
                maxWidth: Layout.contentMaxWidth,
                alignSelf: 'center',
                width: '100%',
              },
            ]}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled">
            <FoldRiseIn animate={motionOn} duration={460} fromY={20} fromScale={0.96} delayMs={0}>
              <View
                style={[
                  styles.heroCard,
                  {
                    backgroundColor: isDark ? ff.paper2 : undefined,
                    borderColor: line,
                  },
                  !isDark && styles.heroCardLight,
                ]}>
                {!isDark ? <View pointerEvents="none" style={styles.heroDecor} /> : null}
                <Text style={[styles.eyebrow, { color: faint, textAlign: hasAnyAccount ? 'left' : 'center' }]}>
                  Net worth / 净资产
                </Text>
                {!hasAnyAccount ? (
                  <Text
                    style={[
                      styles.assetAmount,
                      { color: faint, fontFamily: ffFonts.mono, fontSize: 28, textAlign: 'center' },
                    ]}>
                    ¥ —
                  </Text>
                ) : (
                  <FoldCountUpText
                    value={netWorth}
                    animate={motionOn}
                    duration={760}
                    delayMs={90}
                    textStyle={[
                      styles.assetAmount,
                      {
                        color: netWorth < 0 ? clay : pine,
                        fontFamily: ffFonts.mono,
                      },
                    ]}
                    formatter={(n) => formatSignedMoneyTrunc2(n)}
                  />
                )}
                <FoldRiseIn animate={motionOn} delayMs={120} duration={360} fromY={10}>
                  <View style={[styles.assetChange, !hasAnyAccount && { justifyContent: 'center' }]}>
                    {!hasAnyAccount ? (
                      <Text style={{ color: faint, fontSize: 12 }}>添加第一个账户后开始计算</Text>
                    ) : (
                      <>
                        {trendPctLabel ? (
                          <Text style={{ color: trendColor, fontFamily: ffFonts.mono, fontWeight: '700', fontSize: 12 }}>
                            {trendPctLabel}
                          </Text>
                        ) : null}
                        <Text style={{ color: trendColor, fontSize: 12, flexShrink: 1 }}>
                          {monthTrend.hasActivity && Math.abs(monthTrend.delta) >= 0.01
                            ? `较月初 ${monthTrend.delta >= 0 ? '+' : '−'}${formatMoney2(Math.abs(monthTrend.delta))}`
                            : '较月初持平'}
                        </Text>
                        {trendTone === 'up' ? (
                          <View style={[styles.tagGreen, { marginLeft: 'auto' }]}>
                            <Text style={styles.tagGreenText}>跑赢预算</Text>
                          </View>
                        ) : null}
                      </>
                    )}
                  </View>
                </FoldRiseIn>
                <View style={styles.splitRow}>
                  <FoldRiseIn
                    animate={motionOn}
                    index={0}
                    staggerMs={55}
                    delayMs={160}
                    duration={400}
                    fromY={12}
                    fromScale={0.96}
                    style={{ flex: 1 }}>
                    <View
                      style={[
                        styles.splitCell,
                        {
                          backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : '#F4EEE2',
                          borderColor: isDark ? line : '#E7DDCC',
                        },
                      ]}>
                      <Text style={[styles.splitLabel, { color: faint }]}>总资产</Text>
                      <Text
                        style={[
                          styles.splitValue,
                          { color: hasAnyAccount ? '#3A4C41' : faint, fontFamily: ffFonts.mono },
                        ]}>
                        {formatMoney2(totalAssets)}
                      </Text>
                    </View>
                  </FoldRiseIn>
                  <FoldRiseIn
                    animate={motionOn}
                    index={1}
                    staggerMs={55}
                    delayMs={160}
                    duration={400}
                    fromY={12}
                    fromScale={0.96}
                    style={{ flex: 1 }}>
                    <View
                      style={[
                        styles.splitCell,
                        {
                          backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : '#F4EEE2',
                          borderColor: isDark ? line : '#E7DDCC',
                        },
                      ]}>
                      <Text style={[styles.splitLabel, { color: faint }]}>总负债</Text>
                      <Text
                        style={[
                          styles.splitValue,
                          { color: hasAnyAccount ? clay : faint, fontFamily: ffFonts.mono },
                        ]}>
                        {formatMoney2(totalLiabilitiesAbs)}
                      </Text>
                    </View>
                  </FoldRiseIn>
                </View>
              </View>
            </FoldRiseIn>

            {hasAnyAccount ? (
              <FoldRiseIn animate={motionOn} delayMs={90} duration={460} fromY={18} fromScale={0.96}>
                <View style={[styles.allocCard, { backgroundColor: card, borderColor: line }]}>
                  <View style={styles.allocHeader}>
                    <Text style={[styles.allocTitle, { color: text }]}>资产配置</Text>
                    <Text style={[styles.allocHint, { color: faint }]}>按当前市值</Text>
                  </View>
                  {allocSegments.length === 0 ? (
                    <Text style={{ color: subtle, fontSize: 13, marginTop: 8 }}>暂无资产分布</Text>
                  ) : (
                    <View style={styles.allocWrap}>
                      <AllocDonut
                        segments={allocSegments}
                        total={totalAssets}
                        animate={motionOn}
                        holeColor={card}
                        holeBorder={isDark ? line : '#EDE4D5'}
                        monoFont={ffFonts.mono}
                        pine={pine}
                        muted={faint}
                      />
                      <View style={styles.legend}>
                        {allocSegments.map((seg, i) => {
                          const pct = hasAssets ? Math.round((seg.amount / totalAssets) * 100) : 0;
                          return (
                            <FoldRiseIn
                              key={seg.key}
                              animate={motionOn}
                              index={i}
                              staggerMs={50}
                              delayMs={200}
                              duration={400}
                              fromY={12}
                              fromScale={0.97}>
                              <Pressable
                                onPress={() => scrollToGroup(seg.groupAnchor)}
                                accessibilityRole="button"
                                accessibilityLabel={`${seg.label} ${pct}% ${formatMoney2(seg.amount)}`}
                                style={({ pressed }) => [styles.legendRow, pressed && { opacity: 0.75 }]}>
                                <View style={[styles.legendDot, { backgroundColor: seg.color }]} />
                                <Text style={[styles.legendLabel, { color: subtle }]}>{seg.label}</Text>
                                <Text style={[styles.legendPct, { color: '#3E5045', fontFamily: ffFonts.mono }]}>
                                  {pct}%
                                </Text>
                                <Text style={[styles.legendAmt, { color: faint }]}>
                                  {formatCompactMoney(seg.amount)}
                                </Text>
                              </Pressable>
                            </FoldRiseIn>
                          );
                        })}
                      </View>
                    </View>
                  )}
                </View>
              </FoldRiseIn>
            ) : null}

            {!hasAnyAccount ? (
              <View style={styles.emptyBlock}>
                <FoldRiseIn animate={motionOn} delayMs={100} duration={460} fromY={18} fromScale={0.96}>
                  <View
                    style={[
                      styles.emptyCard,
                      {
                        borderColor: isDark ? line : '#D5C7B3',
                        backgroundColor: isDark ? ff.cardSoft : 'rgba(255,252,245,0.54)',
                      },
                    ]}>
                    <FoldBreathe animate={motionOn} style={styles.emptyIllus}>
                      <View
                        style={[
                          styles.emptySheet,
                          styles.emptySheet1,
                          { backgroundColor: isDark ? ff.paper2 : '#F2EBDD', borderColor: isDark ? line : '#DACDB9' },
                        ]}
                      />
                      <View
                        style={[
                          styles.emptySheet,
                          styles.emptySheet2,
                          { backgroundColor: isDark ? ff.paper2 : '#F8F4EA', borderColor: isDark ? line : '#DACDB9' },
                        ]}
                      />
                      <View
                        style={[
                          styles.emptySheet,
                          styles.emptySheet3,
                          { backgroundColor: card, borderColor: isDark ? line : '#DACDB9' },
                        ]}>
                        <MaterialIcons name="add" size={18} color="#9CAB9F" />
                      </View>
                    </FoldBreathe>
                    <Text style={[styles.emptyTitle, { color: pine, fontFamily: ffFonts.serif }]}>
                      先放进一个真实账户
                    </Text>
                    <Text style={[styles.emptyBody, { color: subtle }]}>
                      银行卡、支付宝、现金或投资账户。{'\n'}余额只用于看总览，不会连接银行。
                    </Text>
                    <Pressable
                      onPress={() => router.push('/add-account')}
                      style={({ pressed }) => [
                        styles.emptyCta,
                        { backgroundColor: pine },
                        pressed && { opacity: 0.9, transform: [{ scale: 0.98 }] },
                      ]}>
                      <MaterialIcons name="add" size={16} color={ff.onPine} />
                      <Text style={[styles.emptyCtaText, { color: ff.onPine }]}>添加账户</Text>
                    </Pressable>
                  </View>
                </FoldRiseIn>

                <FoldRiseIn animate={motionOn} delayMs={180} duration={400} fromY={14} fromScale={0.98}>
                  <View
                    style={[
                      styles.ghostAccount,
                      {
                        borderColor: isDark ? line : '#CFC0AA',
                        backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(255,252,245,0.35)',
                      },
                    ]}>
                    <MaterialIcons name="account-balance" size={16} color={faint} />
                    <Text style={{ color: faint, fontSize: 12 }}>账户列表会出现在这里</Text>
                  </View>
                </FoldRiseIn>

                <FoldRiseIn animate={motionOn} delayMs={240} duration={360} fromY={10}>
                  <View style={styles.sectionH}>
                    <Text style={[styles.sectionHT, { color: subtle }]}>Add later / 以后也可以</Text>
                    <Text style={[styles.sectionHA, { color: faint }]}>从首页或账户详情</Text>
                  </View>
                </FoldRiseIn>
                <FoldRiseIn animate={motionOn} index={0} staggerMs={55} delayMs={280} duration={400} fromY={12} fromScale={0.98}>
                  <View
                    style={[
                      styles.rowLink,
                      {
                        backgroundColor: isDark ? ff.paper2 : '#F5F0E5',
                        borderColor: isDark ? line : '#E5DBC9',
                      },
                    ]}>
                    <View style={[styles.rowLinkIcon, { backgroundColor: isDark ? ff.sage2 : '#E8EFE8' }]}>
                      <MaterialIcons name="repeat" size={14} color={isDark ? ff.sage : '#4B6B59'} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.rowLinkTitle, { color: text }]}>房贷、信用卡也可以登记</Text>
                      <Text style={[styles.rowLinkSub, { color: faint }]}>负债会从净资产中扣除</Text>
                    </View>
                  </View>
                </FoldRiseIn>
                <FoldRiseIn animate={motionOn} index={1} staggerMs={55} delayMs={280} duration={400} fromY={12} fromScale={0.98}>
                  <View
                    style={[
                      styles.rowLink,
                      {
                        backgroundColor: isDark ? ff.paper2 : '#F5F0E5',
                        borderColor: isDark ? line : '#E5DBC9',
                      },
                    ]}>
                    <View style={[styles.rowLinkIcon, { backgroundColor: isDark ? ff.amber2 : '#F4E9D7' }]}>
                      <MaterialIcons name="shield" size={14} color={ff.amberInk} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.rowLinkTitle, { color: text }]}>随时可关闭「计入总资产」</Text>
                      <Text style={[styles.rowLinkSub, { color: faint }]}>不影响账户本身与流水</Text>
                    </View>
                  </View>
                </FoldRiseIn>
              </View>
            ) : (
              <View style={styles.accounts}>
                {(() => {
                  let gi = 0;
                  const nodes: React.ReactNode[] = [];
                  const push = (
                    key: string,
                    title: string,
                    titleEn: string,
                    tone: 'bank' | 'invest' | 'debt' | 'neutral',
                    rows: FinanceAccountBalanceRow[],
                    sumLabel: string,
                    debtStyle = false,
                  ) => {
                    if (rows.length === 0) return;
                    nodes.push(
                      renderAccountGroup(key, title, titleEn, tone, rows, sumLabel, gi, debtStyle),
                    );
                    gi += 1;
                  };
                  push(
                    'cash',
                    '现金',
                    'Cash',
                    'neutral',
                    grouped.cash_wallet,
                    formatMoney2(sumAssetBalanceForDisplay(grouped.cash_wallet)),
                  );
                  push(
                    'bank',
                    '银行',
                    'Bank',
                    'bank',
                    grouped.bank,
                    formatMoney2(sumAssetBalanceForDisplay(grouped.bank)),
                  );
                  push(
                    'invest',
                    '投资',
                    'Invest',
                    'invest',
                    grouped.investment,
                    formatMoney2(sumAssetBalanceForDisplay(grouped.investment)),
                  );
                  for (const g of customTypeGroups) {
                    push(
                      `custom-${g.name}`,
                      g.name,
                      'Custom',
                      'neutral',
                      g.rows,
                      formatMoney2(groupMixedLedgerSum(g.rows)),
                    );
                  }
                  if (grouped.unknown.length > 0) {
                    push(
                      'unknown',
                      '其他',
                      'Other',
                      'neutral',
                      grouped.unknown,
                      formatMoney2(groupMixedLedgerSum(grouped.unknown)),
                    );
                  }
                  push(
                    'liability',
                    '负债',
                    'Debt',
                    'debt',
                    grouped.liability,
                    formatDebtMoney2(sumLiabilityDebtMagnitudes(grouped.liability)),
                    true,
                  );
                  return nodes;
                })()}
                <FoldRiseIn animate={motionOn} delayMs={LIST_ENTRANCE_BASE_MS + 160} duration={360} fromY={8}>
                  <Text style={[styles.miniNote, { color: faint }]}>
                    合计 {accounts.length} 个账户 · 负债不计入配置比例
                  </Text>
                </FoldRiseIn>
              </View>
            )}
          </ScrollView>
        </Animated.View>
        ) : null}

        <Pressable
          onPress={() => router.push('/add-account')}
          accessibilityRole="button"
          accessibilityLabel="添加账户"
          style={({ pressed }) => [
            styles.fab,
            {
              bottom: fabBottom,
              backgroundColor: pine,
              shadowColor: ff.shadow,
            },
            pressed && { opacity: 0.92, transform: [{ scale: 0.96 }] },
          ]}>
          <MaterialIcons name="add" size={24} color={ff.onPine} />
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  body: { flex: 1 },
  header: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    zIndex: 60,
  },
  headerInner: {
    minHeight: 54,
    paddingHorizontal: 14,
    paddingBottom: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerText: { flex: 1, minWidth: 0, gap: 3 },
  headerTitle: { fontSize: 20, fontWeight: '600', letterSpacing: 0.2, lineHeight: 24 },
  headerSub: { fontSize: 11, fontWeight: '500', letterSpacing: 0.2 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  foldIconBtn: {
    width: 31,
    height: 31,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 10,
  },
  skeletonWrap: { gap: 10 },
  heroCard: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 12,
    overflow: 'hidden',
    position: 'relative',
  },
  heroCardLight: {
    backgroundColor: '#FFFCF5',
  },
  heroDecor: {
    position: 'absolute',
    right: -32,
    top: -52,
    width: 150,
    height: 150,
    borderRadius: 75,
    borderWidth: 1,
    borderColor: '#E9DCC4',
  },
  eyebrow: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  assetAmount: {
    fontSize: 32,
    fontWeight: '700',
    letterSpacing: -0.5,
    marginTop: 4,
    lineHeight: 38,
  },
  assetChange: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
    flexWrap: 'wrap',
  },
  tagGreen: {
    height: 20,
    paddingHorizontal: 8,
    borderRadius: 10,
    backgroundColor: '#E7EFE9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tagGreenText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#3F6B54',
  },
  splitRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  splitCell: {
    flex: 1,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 9,
    gap: 3,
  },
  splitLabel: { fontSize: 10 },
  splitValue: { fontSize: 14, fontWeight: '700' },
  allocCard: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  allocHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  allocTitle: { fontSize: 14, fontWeight: '700' },
  allocHint: { fontSize: 11 },
  allocWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  allocHole: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  allocCenterPct: { fontSize: 15, fontWeight: '700' },
  allocCenterSub: { fontSize: 10, marginTop: 1 },
  legend: { flex: 1, gap: 8, minWidth: 0 },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendDot: { width: 6, height: 6, borderRadius: 2 },
  legendLabel: { fontSize: 12, flexShrink: 1 },
  legendPct: { marginLeft: 'auto', fontSize: 12, fontWeight: '700' },
  legendAmt: { fontSize: 11, minWidth: 42, textAlign: 'right' },
  accounts: { gap: 10 },
  acctGroup: { gap: 6 },
  acctGroupH: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: 2,
  },
  acctGroupTitle: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  acctGroupSum: { fontSize: 12 },
  acctList: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    overflow: 'hidden',
  },
  acctItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 11,
    minHeight: 52,
  },
  acctDot: {
    width: 27,
    height: 27,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  acctDotText: { fontSize: 12, fontWeight: '700' },
  acctMain: { flex: 1, minWidth: 0, gap: 2 },
  acctName: { fontSize: 14, fontWeight: '600' },
  acctSub: { fontSize: 11 },
  acctValue: { fontSize: 13, fontWeight: '700', textAlign: 'right' },
  miniNote: {
    textAlign: 'center',
    fontSize: 11,
    marginTop: 2,
    marginBottom: 4,
  },
  emptyBlock: { gap: 8 },
  emptyCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderStyle: 'dashed',
    paddingHorizontal: 16,
    paddingVertical: 22,
    alignItems: 'center',
  },
  emptyIllus: {
    width: 74,
    height: 64,
    marginBottom: 12,
    alignSelf: 'center',
    position: 'relative',
  },
  emptySheet: {
    position: 'absolute',
    width: 54,
    height: 34,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptySheet1: { top: 15, left: 10, transform: [{ rotate: '-8deg' }] },
  emptySheet2: { top: 12, left: 12, transform: [{ rotate: '7deg' }] },
  emptySheet3: { top: 8, left: 12 },
  emptyTitle: { fontSize: 17, fontWeight: '600' },
  emptyBody: {
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 14,
  },
  emptyCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 36,
    paddingHorizontal: 18,
    borderRadius: 12,
  },
  emptyCtaText: { fontSize: 13, fontWeight: '700' },
  ghostAccount: {
    height: 72,
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: 'dashed',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  sectionH: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginTop: 4,
    marginBottom: 2,
    paddingHorizontal: 2,
  },
  sectionHT: { fontSize: 11, fontWeight: '700', letterSpacing: 0.4 },
  sectionHA: { fontSize: 10 },
  rowLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 11,
    borderWidth: StyleSheet.hairlineWidth,
  },
  rowLinkIcon: {
    width: 24,
    height: 24,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowLinkTitle: { fontSize: 13, fontWeight: '700' },
  rowLinkSub: { fontSize: 11, marginTop: 2 },
  fab: {
    position: 'absolute',
    right: 17,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 6,
    zIndex: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.08)',
  },
});
