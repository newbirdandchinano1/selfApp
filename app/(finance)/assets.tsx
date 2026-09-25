import { ScreenHeader, ScreenHeaderIconAction, Skeleton } from '@/components/ui';
import { Layout, Radius, Spacing, Typography } from '@/constants/design-tokens';
import { useAppTheme } from '@/hooks/use-app-theme';
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
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

const PAGE_API_KEY = 'assets';

type UiAccountType = 'cash_wallet' | 'bank' | 'investment' | 'liability' | 'custom' | 'unknown';

type ThemeColors = ReturnType<typeof useAppTheme>['colors'];

function AssetsPageSkeleton({ colors }: { colors: ThemeColors }) {
  return (
    <View style={styles.skeletonWrap}>
      <View style={styles.hero}>
        <Skeleton width={72} height={12} borderRadius={6} />
        <Skeleton width={220} height={40} borderRadius={10} style={{ marginTop: Spacing.md }} />
        <Skeleton width={96} height={28} borderRadius={14} style={{ marginTop: Spacing.lg }} />
        <View style={styles.totalsRow}>
          <Skeleton width="46%" height={64} borderRadius={Radius.lg} />
          <Skeleton width="46%" height={64} borderRadius={Radius.lg} />
        </View>
      </View>

      <View style={[styles.allocPanel, { backgroundColor: colors.surface, borderColor: colors.outline }]}>
        <Skeleton width={72} height={16} borderRadius={6} />
        <Skeleton width="100%" height={12} borderRadius={6} style={{ marginTop: Spacing['3xl'] }} />
        <View style={{ gap: Spacing.lg, marginTop: Spacing['3xl'] }}>
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} width="100%" height={18} borderRadius={6} />
          ))}
        </View>
      </View>

      {Array.from({ length: 2 }).map((_, g) => (
        <View key={g} style={{ gap: Spacing.xl }}>
          <View style={styles.groupHeader}>
            <Skeleton width={120} height={16} borderRadius={6} />
            <Skeleton width={64} height={12} borderRadius={6} />
          </View>
          <View style={[styles.groupPanel, { backgroundColor: colors.surface, borderColor: colors.outline }]}>
            {Array.from({ length: 3 }).map((_, i) => (
              <View
                key={i}
                style={[
                  styles.accountRow,
                  i < 2 ? { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.outline } : null,
                ]}>
                <Skeleton width={36} height={36} borderRadius={Radius.md} />
                <View style={{ flex: 1, gap: Spacing.sm }}>
                  <Skeleton width="55%" height={14} borderRadius={6} />
                  <Skeleton width="35%" height={11} borderRadius={5} />
                </View>
                <Skeleton width={72} height={16} borderRadius={6} />
              </View>
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

export default function AssetsScreen() {
  const router = useRouter();
  const { wrapLoad } = usePageApiSync(PAGE_API_KEY);
  const insets = useSafeAreaInsets();
  const { colors, isDark, shadows } = useAppTheme();

  const assetSegmentColors = React.useMemo(
    () => ({
      cash: colors.primarySoft,
      bank: colors.primary,
      invest: colors.secondary,
    }),
    [colors.primary, colors.primarySoft, colors.secondary],
  );

  const [accounts, setAccounts] = React.useState<FinanceAccountBalanceRow[]>([]);
  const [accountTypes, setAccountTypes] = React.useState<FinanceAccountTypeRow[]>([]);
  const [transactions, setTransactions] = React.useState<FinanceTransactionRow[]>([]);
  const [initialLoadPending, setInitialLoadPending] = React.useState(true);
  const [skeletonMounted, setSkeletonMounted] = React.useState(true);

  const skeletonOpacity = React.useRef(new Animated.Value(1)).current;
  const contentOpacity = React.useRef(new Animated.Value(0)).current;
  const contentRevealDoneRef = React.useRef(false);

  const reload = React.useCallback(
    async (forceApi = false) => {
      await wrapLoad(async () => {
        try {
          const [catalog, txns] = await Promise.all([
            fetchFinanceCatalog({ offlineFallback: true }),
            getFinanceTransactions({ localOnly: !forceApi }),
          ]);
          setAccounts(catalog.accounts);
          setAccountTypes(catalog.accountTypes);
          setTransactions(txns);
        } catch (e) {
          console.warn('Failed to load finance accounts:', e);
          setAccounts([]);
          setAccountTypes([]);
          setTransactions([]);
        } finally {
          setInitialLoadPending(false);
        }
      }, forceApi);
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
    if (initialLoadPending) return;
    if (contentRevealDoneRef.current) {
      contentOpacity.setValue(1);
      return;
    }
    contentRevealDoneRef.current = true;
    setSkeletonMounted(true);
    skeletonOpacity.setValue(1);
    contentOpacity.setValue(0);
    Animated.parallel([
      Animated.timing(skeletonOpacity, {
        toValue: 0,
        duration: 240,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(contentOpacity, {
        toValue: 1,
        duration: 300,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished) setSkeletonMounted(false);
    });
  }, [contentOpacity, initialLoadPending, skeletonOpacity]);

  const formatMoney2 = React.useCallback((value: number) => {
    const abs = Math.abs(value);
    return `¥${abs.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }, []);

  const formatSignedMoneyTrunc2 = React.useCallback((value: number) => {
    if (!Number.isFinite(value)) return '¥0.00';
    const factor = 100;
    const truncated =
      value >= 0 ? Math.floor(value * factor + 1e-9) / factor : Math.ceil(value * factor - 1e-9) / factor;
    const abs = Math.abs(truncated);
    const prefix = truncated < 0 ? '-¥' : '¥';
    return `${prefix}${abs.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }, []);

  const formatDebtMoney2 = React.useCallback((value: number) => {
    const abs = Math.abs(value);
    if (abs === 0) return '¥0.00';
    return `-¥${abs.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }, []);

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
    [isLiabilityAccount, formatDebtMoney2, formatMoney2],
  );

  const totalAssets = React.useMemo(() => computeTotalAssets(accounts), [accounts]);
  const totalLiabilitiesAbs = React.useMemo(() => computeTotalLiabilitiesAbs(accounts), [accounts]);
  const netWorth = React.useMemo(() => computeNetWorthTotal(accounts), [accounts]);

  /** 本月净资产变动（真实流水），替代原来的假 2.4% */
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

  /** 资产配置：按具体账户余额占比（不含负债 / 已排除汇总的账户） */
  const allocSegments = React.useMemo(() => {
    const palette = [
      colors.primary,
      colors.primarySoft,
      colors.secondary,
      colors.tertiary,
      isDark ? '#a78bfa' : '#7c3aed',
      isDark ? '#f472b6' : '#db2777',
      isDark ? '#38bdf8' : '#0284c7',
      isDark ? '#fbbf24' : '#d97706',
      isDark ? '#2dd4bf' : '#0f766e',
      isDark ? '#fb923c' : '#ea580c',
    ];
    const rows = accounts
      .filter((a) => !isLiabilityAccount(a) && !isFinanceAccountExcludedFromAggregates(a.extra_data))
      .map((a) => ({
        account: a,
        amount: Math.max(0, a.balance ?? 0),
      }))
      .filter((row) => row.amount > 0)
      .sort((a, b) => b.amount - a.amount || a.account.name.localeCompare(b.account.name, 'zh-CN'));

    return rows.map((row, index) => ({
      key: row.account.id,
      label: row.account.name,
      amount: row.amount,
      color: palette[index % palette.length]!,
      account: row.account,
    }));
  }, [
    accounts,
    isLiabilityAccount,
    colors.primary,
    colors.primarySoft,
    colors.secondary,
    colors.tertiary,
    isDark,
  ]);

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

  const trendTone =
    monthTrend.delta > 0.009 ? 'up' : monthTrend.delta < -0.009 ? 'down' : 'flat';
  const trendColor =
    trendTone === 'up' ? colors.secondary : trendTone === 'down' ? colors.danger : colors.textSecondary;
  const trendBg =
    trendTone === 'up'
      ? isDark
        ? 'rgba(52,211,153,0.18)'
        : 'rgba(0,108,73,0.1)'
      : trendTone === 'down'
        ? isDark
          ? 'rgba(248,113,113,0.18)'
          : 'rgba(220,38,38,0.1)'
        : isDark
          ? 'rgba(148,163,184,0.16)'
          : 'rgba(148,163,184,0.12)';
  const trendLabel =
    monthTrend.pct == null
      ? monthTrend.hasActivity
        ? '本月变动'
        : '本月持平'
      : `${Math.abs(monthTrend.pct) >= 10 ? Math.abs(monthTrend.pct).toFixed(0) : Math.abs(monthTrend.pct).toFixed(1)}%`;
  const trendIcon: keyof typeof MaterialIcons.glyphMap =
    trendTone === 'up' ? 'trending-up' : trendTone === 'down' ? 'trending-down' : 'trending-flat';

  const fabBottom = Math.max(insets.bottom, Spacing.md) + Spacing['3xl'];
  const scrollBottomPad = fabBottom + 64;

  const renderAccountGroup = (
    key: string,
    title: string,
    icon: keyof typeof MaterialIcons.glyphMap,
    accent: string,
    rows: FinanceAccountBalanceRow[],
    sumLabel: string,
    debtStyle = false,
  ) => {
    if (rows.length === 0) return null;
    return (
      <View key={key} style={styles.group}>
        <View style={styles.groupHeader}>
          <View style={styles.groupHeaderLeft}>
            <View style={[styles.groupIconBadge, { backgroundColor: isDark ? `${accent}33` : `${accent}18` }]}>
              <MaterialIcons name={icon} size={16} color={accent} />
            </View>
            <Text style={[Typography.title, { color: debtStyle ? colors.danger : colors.text }]}>{title}</Text>
            <Text style={[Typography.caption, { color: colors.textMuted }]}>{rows.length}</Text>
          </View>
          <Text style={[styles.groupSum, { color: debtStyle ? colors.danger : accent }]}>{sumLabel}</Text>
        </View>

        <View
          style={[
            styles.groupPanel,
            {
              backgroundColor: colors.surface,
              borderColor: colors.outline,
            },
            debtStyle && {
              backgroundColor: isDark ? 'rgba(220,38,38,0.12)' : 'rgba(220,38,38,0.06)',
              borderColor: isDark ? 'rgba(248,113,113,0.28)' : 'rgba(220,38,38,0.18)',
            },
          ]}>
          {rows.map((acc, index) => (
            <Pressable
              key={acc.id}
              onPress={() => openAccountDetail(acc)}
              accessibilityRole="button"
              accessibilityLabel={`${acc.name} ${formatAccountRowBalance(acc)}`}
              style={({ pressed }) => [
                styles.accountRow,
                index < rows.length - 1
                  ? { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.outline }
                  : null,
                pressed && { opacity: 0.82, backgroundColor: colors.surfaceMuted },
              ]}>
              <View style={[styles.accountIconBox, { backgroundColor: isDark ? colors.surfaceMuted : colors.input }]}>
                <MaterialIcons name={accountIcon(acc)} size={20} color={accent} />
              </View>
              <View style={styles.accountTextCol}>
                <Text style={[Typography.bodyStrong, { color: colors.text }]} numberOfLines={1}>
                  {acc.name}
                </Text>
                {acc.account_no ? (
                  <Text style={[Typography.caption, { color: colors.textSecondary }]} numberOfLines={1}>
                    {acc.account_no}
                  </Text>
                ) : null}
              </View>
              <Text
                style={[
                  Typography.title,
                  styles.accountAmount,
                  { color: debtStyle || isLiabilityAccount(acc) ? colors.danger : colors.text },
                ]}>
                {formatAccountRowBalance(acc)}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
    );
  };

  const hasAnyAccount = accounts.length > 0;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['left', 'right']}>
      <ScreenHeader
        title="资产"
        onBack={() => router.back()}
        right={
          <ScreenHeaderIconAction
            icon="calendar-today"
            onPress={() => router.push('/finance-calendar')}
            accessibilityLabel="财务日历"
          />
        }
      />

      <View style={styles.body}>
        {skeletonMounted ? (
          <Animated.View
            pointerEvents={initialLoadPending ? 'auto' : 'none'}
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
              <AssetsPageSkeleton colors={colors} />
            </ScrollView>
          </Animated.View>
        ) : null}

        <Animated.View style={{ flex: 1, opacity: contentOpacity }}>
          <ScrollView
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
            <View style={styles.hero}>
              <Text style={[Typography.kicker, styles.heroKicker, { color: colors.textSecondary }]}>当前净资产</Text>
              <View style={styles.heroRow}>
                <Text
                  style={[
                    Typography.display,
                    styles.netWorth,
                    { color: netWorth < 0 ? colors.danger : colors.text, fontSize: 40, lineHeight: 48 },
                  ]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.55}>
                  {formatSignedMoneyTrunc2(netWorth)}
                </Text>
                <Pressable
                  onPress={() => router.push('/cash-flow')}
                  accessibilityRole="button"
                  accessibilityLabel={`本月净资产趋势 ${trendLabel}`}
                  style={({ pressed }) => [styles.trendPill, { backgroundColor: trendBg }, pressed && { opacity: 0.8 }]}>
                  <MaterialIcons name={trendIcon} size={16} color={trendColor} />
                  <Text style={[Typography.bodyStrong, { color: trendColor }]}>{trendLabel}</Text>
                </Pressable>
              </View>
              {monthTrend.hasActivity && Math.abs(monthTrend.delta) >= 0.01 ? (
                <Text style={[Typography.caption, { color: colors.textMuted }]}>
                  本月 {monthTrend.delta >= 0 ? '+' : '−'}
                  {formatMoney2(Math.abs(monthTrend.delta))}
                </Text>
              ) : (
                <Text style={[Typography.caption, { color: colors.textMuted }]}>相对月初净资产变化 · 点按查看现金流</Text>
              )}

              <View style={styles.totalsRow}>
                <View style={[styles.totalChip, { backgroundColor: colors.surfaceSubtle, borderColor: colors.outline }]}>
                  <Text style={[Typography.kicker, styles.totalLabel, { color: colors.textSecondary }]}>总资产</Text>
                  <Text style={[Typography.bodyStrong, { color: colors.text }]}>{formatMoney2(totalAssets)}</Text>
                </View>
                <View style={[styles.totalChip, { backgroundColor: colors.surfaceSubtle, borderColor: colors.outline }]}>
                  <Text style={[Typography.kicker, styles.totalLabel, { color: colors.textSecondary }]}>总负债</Text>
                  <Text style={[Typography.bodyStrong, { color: colors.danger }]}>
                    {formatMoney2(totalLiabilitiesAbs)}
                  </Text>
                </View>
              </View>
            </View>

            <View
              style={[
                styles.allocPanel,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.outline,
                },
                shadows.card,
              ]}>
              <View style={styles.allocHeader}>
                <Text style={[Typography.h3, { color: colors.text }]}>资产配置</Text>
                {hasAssets ? (
                  <Text style={[Typography.caption, { color: colors.textMuted }]}>按账户占比</Text>
                ) : null}
              </View>

              {allocSegments.length === 0 ? (
                <Text style={[Typography.body, { color: colors.textSecondary, marginTop: Spacing.xl }]}>
                  暂无资产分布，添加账户后将在此展示
                </Text>
              ) : (
                <>
                  <View style={[styles.stackBar, { backgroundColor: colors.progressTrack }]}>
                    {allocSegments.map((seg) => {
                      const flex = hasAssets ? Math.max(seg.amount / totalAssets, 0.02) : 1;
                      return (
                        <View
                          key={seg.key}
                          style={{
                            flex,
                            backgroundColor: seg.color,
                            minWidth: 4,
                          }}
                        />
                      );
                    })}
                  </View>

                  <View style={styles.legend}>
                    {allocSegments.map((seg) => {
                      const pct = hasAssets ? Math.round((seg.amount / totalAssets) * 100) : 0;
                      return (
                        <Pressable
                          key={seg.key}
                          onPress={() => openAccountDetail(seg.account)}
                          accessibilityRole="button"
                          accessibilityLabel={`${seg.label} ${pct}% ${formatMoney2(seg.amount)}`}
                          style={({ pressed }) => [styles.legendRow, pressed && { opacity: 0.75 }]}>
                          <View style={styles.legendLeft}>
                            <View style={[styles.legendDot, { backgroundColor: seg.color }]} />
                            <Text style={[Typography.body, { color: colors.text, flexShrink: 1 }]} numberOfLines={1}>
                              {seg.label}
                            </Text>
                            <Text style={[Typography.caption, { color: colors.textMuted }]}>{pct}%</Text>
                          </View>
                          <Text style={[Typography.bodyStrong, { color: colors.text }]}>{formatMoney2(seg.amount)}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </>
              )}
            </View>

            {!hasAnyAccount ? (
              <View
                style={[
                  styles.emptyPanel,
                  { backgroundColor: colors.surface, borderColor: colors.outline },
                ]}>
                <View style={[styles.emptyIconWrap, { backgroundColor: colors.primaryMuted }]}>
                  <MaterialIcons name="account-balance-wallet" size={28} color={colors.primary} />
                </View>
                <Text style={[Typography.h3, { color: colors.text, textAlign: 'center' }]}>还没有账户</Text>
                <Text style={[Typography.body, { color: colors.textSecondary, textAlign: 'center' }]}>
                  添加现金、银行卡或投资账户后，这里会汇总你的净资产与配置
                </Text>
                <Pressable
                  onPress={() => router.push('/add-account')}
                  style={({ pressed }) => [
                    styles.emptyCta,
                    { backgroundColor: colors.primary },
                    pressed && { opacity: 0.88 },
                  ]}>
                  <MaterialIcons name="add" size={18} color="#fff" />
                  <Text style={[Typography.bodyStrong, { color: '#fff' }]}>添加账户</Text>
                </Pressable>
              </View>
            ) : (
              <View style={styles.accounts}>
                {renderAccountGroup(
                  'cash',
                  '现金与钱包',
                  'wallet',
                  assetSegmentColors.cash,
                  grouped.cash_wallet,
                  formatMoney2(sumAssetBalanceForDisplay(grouped.cash_wallet)),
                )}
                {renderAccountGroup(
                  'bank',
                  '银行账户',
                  'account-balance',
                  colors.primary,
                  grouped.bank,
                  formatMoney2(sumAssetBalanceForDisplay(grouped.bank)),
                )}
                {renderAccountGroup(
                  'invest',
                  '投资项目',
                  'show-chart',
                  colors.secondary,
                  grouped.investment,
                  formatMoney2(sumAssetBalanceForDisplay(grouped.investment)),
                )}
                {customTypeGroups.map((g) =>
                  renderAccountGroup(
                    `custom-${g.name}`,
                    g.name,
                    'tune',
                    colors.textSecondary,
                    g.rows,
                    formatMoney2(groupMixedLedgerSum(g.rows)),
                  ),
                )}
                {grouped.unknown.length > 0
                  ? renderAccountGroup(
                      'unknown',
                      '其他',
                      'more-horiz',
                      colors.textSecondary,
                      grouped.unknown,
                      formatMoney2(groupMixedLedgerSum(grouped.unknown)),
                    )
                  : null}
                {renderAccountGroup(
                  'liability',
                  '负债',
                  'credit-card-off',
                  colors.danger,
                  grouped.liability,
                  formatDebtMoney2(sumLiabilityDebtMagnitudes(grouped.liability)),
                  true,
                )}
              </View>
            )}
          </ScrollView>
        </Animated.View>

        <Pressable
          onPress={() => router.push('/add-account')}
          accessibilityRole="button"
          accessibilityLabel="添加账户"
          style={({ pressed }) => [
            styles.fab,
            {
              bottom: fabBottom,
              backgroundColor: colors.primary,
              shadowColor: isDark ? '#000' : colors.primary,
            },
            pressed && { opacity: 0.9, transform: [{ scale: 0.96 }] },
          ]}>
          <MaterialIcons name="add" size={28} color="#fff" />
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  body: { flex: 1 },
  content: {
    paddingHorizontal: Spacing['5xl'],
    paddingTop: Spacing['3xl'],
    gap: Spacing['5xl'],
  },
  skeletonWrap: { gap: Spacing['5xl'] },
  hero: {
    gap: Spacing.md,
    paddingTop: Spacing.sm,
  },
  heroKicker: {
    letterSpacing: 1.2,
    fontSize: 12,
    textTransform: 'none',
  },
  heroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.lg,
    flexWrap: 'wrap',
  },
  netWorth: {
    flexShrink: 1,
    minWidth: 0,
  },
  trendPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.pill,
  },
  totalsRow: {
    flexDirection: 'row',
    gap: Spacing.xl,
    marginTop: Spacing.lg,
  },
  totalChip: {
    flex: 1,
    gap: Spacing.xs,
    paddingHorizontal: Spacing['3xl'],
    paddingVertical: Spacing.xl,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  totalLabel: {
    letterSpacing: 1.2,
    fontSize: 11,
    textTransform: 'none',
  },
  allocPanel: {
    borderRadius: Radius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing['4xl'],
    gap: Spacing['3xl'],
  },
  allocHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: Spacing.lg,
  },
  stackBar: {
    height: 12,
    borderRadius: Radius.pill,
    overflow: 'hidden',
    flexDirection: 'row',
  },
  legend: { gap: Spacing.lg },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.xl,
  },
  legendLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    flex: 1,
    minWidth: 0,
  },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  accounts: { gap: Spacing['4xl'] },
  group: { gap: Spacing.xl },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.lg,
    paddingHorizontal: Spacing.xs,
  },
  groupHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    flex: 1,
    minWidth: 0,
  },
  groupIconBadge: {
    width: 28,
    height: 28,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  groupSum: {
    ...Typography.kicker,
    letterSpacing: 0.6,
    fontSize: 12,
    textTransform: 'none',
  },
  groupPanel: {
    borderRadius: Radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xl,
    paddingHorizontal: Spacing['3xl'],
    paddingVertical: Spacing['2xl'],
    minHeight: 56,
  },
  accountIconBox: {
    width: 36,
    height: 36,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  accountTextCol: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  accountAmount: {
    fontVariant: ['tabular-nums'],
  },
  emptyPanel: {
    borderRadius: Radius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing['5xl'],
    paddingVertical: Spacing['6xl'],
    alignItems: 'center',
    gap: Spacing.xl,
  },
  emptyIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.sm,
  },
  emptyCta: {
    marginTop: Spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing['4xl'],
    paddingVertical: Spacing.xl,
    borderRadius: Radius.pill,
  },
  fab: {
    position: 'absolute',
    right: Spacing['5xl'],
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.28,
    shadowRadius: 16,
    elevation: 6,
    zIndex: 8,
  },
});
