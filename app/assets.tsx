import { AppCard, ScreenHeader, ScreenHeaderIconAction } from '@/components/ui';
import { Layout, Radius, Spacing, Typography } from '@/constants/design-tokens';
import { useAppTheme } from '@/hooks/use-app-theme';
import { usePageApiSync, usePagePullRefresh } from '@/hooks/use-page-api-sync';
import { FINANCE_ACCOUNT_ICON_OPTIONS } from '@/lib/constants/finance-account-icons';
import {
  loadFinanceDefaultAccounts,
  persistFinanceDefaultAccounts,
  sanitizeFinanceDefaultAccounts,
  type FinanceDefaultAccounts,
} from '@/lib/finance-default-accounts';
import { getFinanceAccountTypes, getFinanceAccountsWithBalance } from '@/lib/repositories/finance/finance';
import { isFinanceAccountExcludedFromAggregates } from '@/lib/repositories/finance/finance-account-extra';
import type { FinanceAccountBalanceRow, FinanceAccountTypeRow } from '@/lib/repositories/finance/finance.types';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';

const PAGE_API_KEY = 'assets';

export default function AssetsScreen() {
  const router = useRouter();
  const { wrapLoad } = usePageApiSync(PAGE_API_KEY);
  const insets = useSafeAreaInsets();
  const { colors, isDark, shadows } = useAppTheme();

  /** 资产配置环形图：蓝 / 深蓝 / 绿，与财务页主色一致（避免 tertiary 棕褐大面积） */
  const assetSegmentColors = React.useMemo(
    () => ({
      cash: colors.primarySoft,
      bank: colors.primary,
      invest: colors.secondary,
    }),
    [colors.primary, colors.primarySoft, colors.secondary],
  );

  const ringSize = 128;
  const ringStroke = 6;
  const r = (ringSize - ringStroke) / 2;
  const c = 2 * Math.PI * r;

  const dash = (p: number) => `${c * p} ${c * (1 - p)}`;

  const [accounts, setAccounts] = React.useState<FinanceAccountBalanceRow[]>([]);
  const [accountTypes, setAccountTypes] = React.useState<FinanceAccountTypeRow[]>([]);
  const [defaultAccounts, setDefaultAccounts] = React.useState<FinanceDefaultAccounts>({
    defaultPaymentAccountId: null,
    defaultIncomeAccountId: null,
  });
  const [defaultPickerTarget, setDefaultPickerTarget] = React.useState<'payment' | 'income' | null>(null);

  const assetAccounts = React.useMemo(
    () => accounts.filter((a) => a.sign_rule > 0),
    [accounts],
  );

  const defaultPaymentAccount = React.useMemo(
    () => assetAccounts.find((a) => a.id === defaultAccounts.defaultPaymentAccountId) ?? null,
    [assetAccounts, defaultAccounts.defaultPaymentAccountId],
  );
  const defaultIncomeAccount = React.useMemo(
    () => assetAccounts.find((a) => a.id === defaultAccounts.defaultIncomeAccountId) ?? null,
    [assetAccounts, defaultAccounts.defaultIncomeAccountId],
  );

  const reload = React.useCallback(async (forceApi = false) => {
    await wrapLoad(async () => {
      try {
        const [rows, typeRows, rawDefaults] = await Promise.all([
          getFinanceAccountsWithBalance(),
          getFinanceAccountTypes(),
          loadFinanceDefaultAccounts(),
        ]);
        setAccounts(rows);
        setAccountTypes(typeRows);
        setDefaultAccounts(sanitizeFinanceDefaultAccounts(rawDefaults, rows));
      } catch (e) {
        console.warn('Failed to load finance accounts:', e);
        setAccounts([]);
        setAccountTypes([]);
      }
    }, forceApi);
  }, [wrapLoad]);

  const { refreshControl } = usePagePullRefresh(PAGE_API_KEY, reload);

  const saveDefaultAccount = React.useCallback(
    async (target: 'payment' | 'income', accountId: string | null) => {
      const next: FinanceDefaultAccounts = {
        ...defaultAccounts,
        ...(target === 'payment'
          ? { defaultPaymentAccountId: accountId }
          : { defaultIncomeAccountId: accountId }),
      };
      const sanitized = sanitizeFinanceDefaultAccounts(next, accounts);
      setDefaultAccounts(sanitized);
      await persistFinanceDefaultAccounts(sanitized);
      setDefaultPickerTarget(null);
    },
    [accounts, defaultAccounts],
  );

  React.useEffect(() => {
    void reload();
  }, [reload]);

  useFocusEffect(
    React.useCallback(() => {
      void reload();
    }, [reload]),
  );

  const formatMoney0 = React.useCallback((value: number) => {
    const abs = Math.abs(value);
    return `¥${abs.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}`;
  }, []);

  const formatSignedMoney0 = React.useCallback((value: number) => {
    const abs = Math.abs(value);
    const prefix = value < 0 ? '-¥' : '¥';
    return `${prefix}${abs.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}`;
  }, []);

  /** 当前净资产：截断到分（向 0 取整），避免第三位小数四舍五入 */
  const formatSignedMoneyTrunc2 = React.useCallback((value: number) => {
    if (!Number.isFinite(value)) {
      return '¥0.00';
    }
    const factor = 100;
    const truncated = value >= 0 ? Math.floor(value * factor + 1e-9) / factor : Math.ceil(value * factor - 1e-9) / factor;
    const abs = Math.abs(truncated);
    const prefix = truncated < 0 ? '-¥' : '¥';
    return `${prefix}${abs.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }, []);

  const formatMoney2 = React.useCallback((value: number) => {
    const abs = Math.abs(value);
    return `¥${abs.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }, []);

  const formatDebtMoney2 = React.useCallback((value: number) => {
    const abs = Math.abs(value);
    if (abs === 0) return '¥0.00';
    return `-¥${abs.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }, []);

  type UiAccountType = 'cash_wallet' | 'bank' | 'investment' | 'liability' | 'custom' | 'unknown';

  const parseUiMeta = React.useCallback(
    (
      acc: FinanceAccountBalanceRow
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
            uiType === 'cash_wallet' || uiType === 'bank' || uiType === 'investment' || uiType === 'liability' || uiType === 'custom';

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
        // ignore JSON parse errors
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
    const groups: Array<{ name: string; rows: FinanceAccountBalanceRow[] }> = accountTypes.map((row) => ({
      name: row.name,
      rows: map.get(row.name) ?? [],
    }));
    for (const [name, rows] of map.entries()) {
      if (!accountTypes.some((item) => item.name === name)) {
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
      if (acc.sign_rule < 0 || acc.account_type === 'liability') return true;

      const meta = parseUiMeta(acc);
      if (meta.uiType === 'liability' || meta.uiIsLiability) return true;
      if (meta.uiType !== 'custom' || !meta.customTypeName) return false;

      return accountTypes.some((type) => type.name === meta.customTypeName && type.is_liability === 1);
    },
    [accountTypes, parseUiMeta],
  );

  /** 分组标题合计：自定义/混合组内可能含负债账户，按「资产 ≥0、负债 ≤0」折算后汇总 */
  const groupMixedLedgerSum = React.useCallback(
    (rows: FinanceAccountBalanceRow[]) =>
      rows.reduce((sum, a) => {
        if (isFinanceAccountExcludedFromAggregates(a.extra_data)) return sum;
        if (isLiabilityAccount(a)) return sum + Math.abs(Math.min(0, a.balance ?? 0));
        return sum + Math.max(0, a.balance ?? 0);
      }, 0),
    [isLiabilityAccount],
  );

  const sumLiabilityDebtMagnitudes = React.useCallback(
    (rows: FinanceAccountBalanceRow[]) =>
      rows.reduce((sum, a) => {
        if (isFinanceAccountExcludedFromAggregates(a.extra_data)) return sum;
        return sum + Math.abs(Math.min(0, a.balance ?? 0));
      }, 0),
    [],
  );

  const formatAccountRowBalance = React.useCallback(
    (acc: FinanceAccountBalanceRow) =>
      isLiabilityAccount(acc)
        ? formatDebtMoney2(Math.min(0, acc.balance ?? 0))
        : formatMoney2(Math.max(0, acc.balance ?? 0)),
    [isLiabilityAccount, formatDebtMoney2, formatMoney2],
  );

  const totalAssets = React.useMemo(
    () =>
      accounts.reduce((sum, a) => {
        if (isLiabilityAccount(a)) return sum;
        if (isFinanceAccountExcludedFromAggregates(a.extra_data)) return sum;
        return sum + Math.max(0, a.balance ?? 0);
      }, 0),
    [accounts, isLiabilityAccount],
  );
  const totalLiabilitiesAbs = React.useMemo(
    () =>
      accounts.reduce((sum, a) => {
        if (!isLiabilityAccount(a)) return sum;
        if (isFinanceAccountExcludedFromAggregates(a.extra_data)) return sum;
        return sum + Math.abs(Math.min(0, a.balance ?? 0));
      }, 0),
    [accounts, isLiabilityAccount],
  );
  const netWorth = React.useMemo(() => totalAssets - totalLiabilitiesAbs, [totalAssets, totalLiabilitiesAbs]);

  const sumAssetBalanceForDisplay = React.useCallback((rows: FinanceAccountBalanceRow[]) => {
    return rows.reduce((sum, a) => {
      if (isFinanceAccountExcludedFromAggregates(a.extra_data)) return sum;
      return sum + Math.max(0, a.balance ?? 0);
    }, 0);
  }, []);

  const cashTotal = React.useMemo(() => sumAssetBalanceForDisplay(grouped.cash_wallet), [grouped.cash_wallet, sumAssetBalanceForDisplay]);
  const bankTotal = React.useMemo(() => sumAssetBalanceForDisplay(grouped.bank), [grouped.bank, sumAssetBalanceForDisplay]);
  const investTotal = React.useMemo(() => sumAssetBalanceForDisplay(grouped.investment), [grouped.investment, sumAssetBalanceForDisplay]);

  const hasAssets = totalAssets > 0;
  const cashPct = hasAssets ? cashTotal / totalAssets : 0;
  const bankPct = hasAssets ? bankTotal / totalAssets : 0;
  const investPct = hasAssets ? investTotal / totalAssets : 0;

  const ringPct = hasAssets ? Math.round(((cashTotal + bankTotal + investTotal) / totalAssets) * 100) : 0;

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

      <ScrollView
        refreshControl={refreshControl}
        contentContainerStyle={[
          styles.content,
          {
            paddingBottom: Spacing['6xl'] + Math.max(insets.bottom, Spacing.md),
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
            <Text style={[Typography.display, styles.netWorth, { color: netWorth < 0 ? colors.danger : colors.text }]}>
              {formatSignedMoneyTrunc2(netWorth)}
            </Text>
            <Pressable
              onPress={() => router.push('/cash-flow')}
              style={({ pressed }) => [
                styles.trendPill,
                { backgroundColor: isDark ? 'rgba(52,211,153,0.2)' : 'rgba(0,108,73,0.1)' },
                pressed && { opacity: 0.8 },
              ]}>
              <MaterialIcons name="trending-up" size={16} color={colors.secondary} />
              <Text style={[Typography.bodyStrong, { color: colors.secondary }]}>2.4%</Text>
            </Pressable>
          </View>

          <View style={styles.totalsRow}>
            <View style={styles.totalBlock}>
              <Text style={[Typography.kicker, styles.totalLabel, { color: colors.textSecondary }]}>总资产</Text>
              <Text style={[Typography.bodyStrong, { color: colors.text }]}>{formatMoney2(totalAssets)}</Text>
            </View>
            <View style={[styles.vDivider, { backgroundColor: colors.outline }]} />
            <View style={styles.totalBlock}>
              <Text style={[Typography.kicker, styles.totalLabel, { color: colors.textSecondary }]}>总负债</Text>
              <Text style={[Typography.bodyStrong, { color: colors.danger }]}>{formatMoney2(totalLiabilitiesAbs)}</Text>
            </View>
          </View>
        </View>

        <View style={styles.bento}>
          <AppCard style={shadows.card}>
            <Text style={[Typography.h3, styles.cardTitle, { color: colors.text }]}>资产配置</Text>
            <View style={styles.assetRow}>
              <View style={styles.ringWrap}>
                <Svg width={ringSize} height={ringSize} viewBox={`0 0 ${ringSize} ${ringSize}`} style={{ transform: [{ rotate: '-90deg' }] }}>
                  <Circle cx={ringSize / 2} cy={ringSize / 2} r={r} stroke={colors.progressTrack} strokeWidth={2} fill="none" />
                  <Circle cx={ringSize / 2} cy={ringSize / 2} r={r} stroke={assetSegmentColors.cash} strokeWidth={ringStroke} strokeDasharray={dash(cashPct)} strokeDashoffset={c * (1 - cashPct)} fill="none" />
                  <Circle cx={ringSize / 2} cy={ringSize / 2} r={r} stroke={assetSegmentColors.bank} strokeWidth={ringStroke} strokeDasharray={dash(bankPct)} strokeDashoffset={c * (1 - bankPct)} fill="none" transform={`rotate(${cashPct * 360} ${ringSize / 2} ${ringSize / 2})`} />
                  <Circle cx={ringSize / 2} cy={ringSize / 2} r={r} stroke={assetSegmentColors.invest} strokeWidth={ringStroke} strokeDasharray={dash(investPct)} strokeDashoffset={c * (1 - investPct)} fill="none" transform={`rotate(${(cashPct + bankPct) * 360} ${ringSize / 2} ${ringSize / 2})`} />
                </Svg>
                <Text style={[Typography.title, styles.ringText, { color: colors.text }]}>{ringPct}%</Text>
              </View>

              <View style={styles.legend}>
                <View style={styles.legendRow}>
                  <View style={[styles.legendDot, { backgroundColor: assetSegmentColors.cash }]} />
                  <Text style={[Typography.body, { color: colors.text }]}>
                    现金 ({Math.round(cashPct * 100)}%)
                  </Text>
                </View>
                <View style={styles.legendRow}>
                  <View style={[styles.legendDot, { backgroundColor: assetSegmentColors.bank }]} />
                  <Text style={[Typography.body, { color: colors.text }]}>
                    银行 ({Math.round(bankPct * 100)}%)
                  </Text>
                </View>
                <View style={styles.legendRow}>
                  <View style={[styles.legendDot, { backgroundColor: assetSegmentColors.invest }]} />
                  <Text style={[Typography.body, { color: colors.text }]}>
                    投资 ({Math.round(investPct * 100)}%)
                  </Text>
                </View>
              </View>
            </View>
          </AppCard>
        </View>

        <AppCard style={[shadows.card, styles.defaultAccountsCard]}>
          <Text style={[Typography.title, { color: colors.text }]}>默认记账账户</Text>
          <Text style={[Typography.caption, styles.defaultAccountsHint, { color: colors.textSecondary }]}>
            截图/一句话自动记账未识别到账户时，支出用默认支付账户、收入用默认收入账户
          </Text>
          <Pressable
            onPress={() => setDefaultPickerTarget('payment')}
            style={({ pressed }) => [
              styles.defaultAccountRow,
              { borderColor: colors.outline, backgroundColor: isDark ? colors.surfaceMuted : colors.surfaceSubtle },
              pressed && { opacity: 0.85 },
            ]}>
            <View style={styles.defaultAccountRowLeft}>
              <MaterialIcons name="shopping-bag" size={18} color={colors.primary} />
              <Text style={[Typography.bodyStrong, { color: colors.text }]}>默认支付账户</Text>
            </View>
            <Text style={[Typography.bodyStrong, styles.defaultAccountRowValue, { color: defaultPaymentAccount ? colors.text : colors.textSecondary }]}>
              {defaultPaymentAccount?.name ?? '未设置'}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setDefaultPickerTarget('income')}
            style={({ pressed }) => [
              styles.defaultAccountRow,
              { borderColor: colors.outline, backgroundColor: isDark ? colors.surfaceMuted : colors.surfaceSubtle },
              pressed && { opacity: 0.85 },
            ]}>
            <View style={styles.defaultAccountRowLeft}>
              <MaterialIcons name="savings" size={18} color={colors.secondary} />
              <Text style={[Typography.bodyStrong, { color: colors.text }]}>默认收入账户</Text>
            </View>
            <Text style={[Typography.bodyStrong, styles.defaultAccountRowValue, { color: defaultIncomeAccount ? colors.text : colors.textSecondary }]}>
              {defaultIncomeAccount?.name ?? '未设置'}
            </Text>
          </Pressable>
        </AppCard>

        <View style={styles.accounts}>
          <View style={styles.addAccountRow}>
            <Pressable
              onPress={() => router.push('/add-account')}
              style={({ pressed }) => [styles.addAccountBtn, { backgroundColor: colors.primaryMuted }, pressed && { opacity: 0.85 }]}>
              <MaterialIcons name="add" size={18} color={colors.primary} />
              <Text style={[Typography.bodyStrong, { color: colors.primary }]}>添加新账户</Text>
            </Pressable>
          </View>

          <View style={styles.group}>
            <View style={styles.groupHeader}>
              <View style={styles.groupHeaderLeft}>
                <MaterialIcons name="wallet" size={20} color={assetSegmentColors.cash} />
                <Text style={[Typography.title, { color: colors.text }]}>现金与钱包</Text>
              </View>
              <Text style={[styles.groupSum, { color: assetSegmentColors.cash }]}>{formatMoney2(sumAssetBalanceForDisplay(grouped.cash_wallet))}</Text>
            </View>

            {grouped.cash_wallet.length === 0 ? (
              <Pressable
                onPress={() => router.push('/add-account')}
                style={({ pressed }) => [
                  styles.accountRow,
                  { backgroundColor: isDark ? colors.surfaceMuted : colors.input, borderLeftColor: assetSegmentColors.cash },
                  pressed && { opacity: 0.85 },
                ]}>
                <View style={styles.accountLeft}>
                  <View style={[styles.accountIconBox, { backgroundColor: colors.surface }]}>
                    <MaterialIcons name="add" size={20} color={assetSegmentColors.cash} />
                  </View>
                  <View>
                    <Text style={[Typography.bodyStrong, styles.accountName, { color: colors.text }]}>添加账户</Text>
                    <Text style={[Typography.caption, styles.accountMeta, { color: colors.textSecondary }]}>创建你的第一个账户</Text>
                  </View>
                </View>
              </Pressable>
            ) : (
              grouped.cash_wallet.map((acc) => (
                <Pressable
                  key={acc.id}
                  onPress={() => openAccountDetail(acc)}
                  style={({ pressed }) => [
                    styles.accountRow,
                    { backgroundColor: isDark ? colors.surfaceMuted : colors.input, borderLeftColor: assetSegmentColors.cash },
                    pressed && { opacity: 0.85 },
                  ]}>
                  <View style={styles.accountLeft}>
                    <View style={[styles.accountIconBox, { backgroundColor: colors.surface }]}>
                      <MaterialIcons name={accountIcon(acc)} size={20} color={assetSegmentColors.cash} />
                    </View>
                    <View>
                      <Text style={[Typography.bodyStrong, styles.accountName, { color: colors.text }]}>{acc.name}</Text>
                      <Text style={[Typography.caption, styles.accountMeta, { color: colors.textSecondary }]}>{acc.account_no ? acc.account_no : '现金/钱包'}</Text>
                    </View>
                  </View>
                  <Text style={[Typography.title, styles.accountAmount, { color: colors.text }]}>{formatAccountRowBalance(acc)}</Text>
                </Pressable>
              ))
            )}
          </View>

          <View style={styles.group}>
            <View style={styles.groupHeader}>
              <View style={styles.groupHeaderLeft}>
                <MaterialIcons name="account-balance" size={20} color={colors.primary} />
                <Text style={[Typography.title, { color: colors.text }]}>银行账户</Text>
              </View>
              <Text style={[styles.groupSum, { color: colors.primary }]}>{formatMoney2(sumAssetBalanceForDisplay(grouped.bank))}</Text>
            </View>

            {grouped.bank.length === 0 ? (
              <Pressable
                onPress={() => router.push('/add-account')}
                style={({ pressed }) => [
                  styles.accountRow,
                  { backgroundColor: isDark ? colors.surfaceMuted : colors.input, borderLeftColor: colors.primary },
                  pressed && { opacity: 0.85 },
                ]}>
                <View style={styles.accountLeft}>
                  <View style={[styles.accountIconBox, { backgroundColor: colors.surface }]}>
                    <MaterialIcons name="add" size={20} color={colors.primary} />
                  </View>
                  <View>
                    <Text style={[Typography.bodyStrong, styles.accountName, { color: colors.text }]}>添加账户</Text>
                    <Text style={[Typography.caption, styles.accountMeta, { color: colors.textSecondary }]}>添加银行卡/储蓄账户</Text>
                  </View>
                </View>
              </Pressable>
            ) : (
              grouped.bank.map((acc) => (
                <Pressable
                  key={acc.id}
                  onPress={() => openAccountDetail(acc)}
                  style={({ pressed }) => [
                    styles.accountRow,
                    { backgroundColor: isDark ? colors.surfaceMuted : colors.input, borderLeftColor: colors.primary },
                    pressed && { opacity: 0.85 },
                  ]}>
                  <View style={styles.accountLeft}>
                    <View style={[styles.accountIconBox, { backgroundColor: colors.surface }]}>
                      <MaterialIcons name={accountIcon(acc)} size={20} color={colors.primary} />
                    </View>
                    <View>
                      <Text style={[Typography.bodyStrong, styles.accountName, { color: colors.text }]}>{acc.name}</Text>
                      <Text style={[Typography.caption, styles.accountMeta, { color: colors.textSecondary }]}>{acc.account_no ? acc.account_no : '银行账户'}</Text>
                    </View>
                  </View>
                  <Text style={[Typography.title, styles.accountAmount, { color: colors.text }]}>{formatAccountRowBalance(acc)}</Text>
                </Pressable>
              ))
            )}
          </View>

          <View style={styles.group}>
            <View style={styles.groupHeader}>
              <View style={styles.groupHeaderLeft}>
                <MaterialIcons name="show-chart" size={20} color={colors.secondary} />
                <Text style={[Typography.title, { color: colors.text }]}>投资项目</Text>
              </View>
              <Text style={[styles.groupSum, { color: colors.secondary }]}>{formatMoney2(sumAssetBalanceForDisplay(grouped.investment))}</Text>
            </View>

            {grouped.investment.length === 0 ? (
              <Pressable
                onPress={() => router.push('/add-account')}
                style={({ pressed }) => [
                  styles.accountRow,
                  { backgroundColor: isDark ? colors.surfaceMuted : colors.input, borderLeftColor: colors.secondary },
                  pressed && { opacity: 0.85 },
                ]}>
                <View style={styles.accountLeft}>
                  <View style={[styles.accountIconBox, { backgroundColor: colors.surface }]}>
                    <MaterialIcons name="add" size={20} color={colors.secondary} />
                  </View>
                  <View>
                    <Text style={[Typography.bodyStrong, styles.accountName, { color: colors.text }]}>添加账户</Text>
                    <Text style={[Typography.caption, styles.accountMeta, { color: colors.textSecondary }]}>添加基金/股票/理财</Text>
                  </View>
                </View>
              </Pressable>
            ) : (
              grouped.investment.map((acc) => (
                <Pressable
                  key={acc.id}
                  onPress={() => openAccountDetail(acc)}
                  style={({ pressed }) => [
                    styles.accountRow,
                    { backgroundColor: isDark ? colors.surfaceMuted : colors.input, borderLeftColor: colors.secondary },
                    pressed && { opacity: 0.85 },
                  ]}>
                  <View style={styles.accountLeft}>
                    <View style={[styles.accountIconBox, { backgroundColor: colors.surface }]}>
                      <MaterialIcons name={accountIcon(acc)} size={20} color={colors.secondary} />
                    </View>
                    <View>
                      <Text style={[Typography.bodyStrong, styles.accountName, { color: colors.text }]}>{acc.name}</Text>
                      <Text style={[Typography.caption, styles.accountMeta, { color: colors.textSecondary }]}>{acc.account_no ? acc.account_no : '投资账户'}</Text>
                    </View>
                  </View>
                  <Text style={[Typography.title, styles.accountAmount, { color: colors.text }]}>{formatAccountRowBalance(acc)}</Text>
                </Pressable>
              ))
            )}
          </View>

          {customTypeGroups.map((g) => (
            <View key={`custom-group-${g.name}`} style={styles.group}>
              <View style={styles.groupHeader}>
                <View style={styles.groupHeaderLeft}>
                  <MaterialIcons name="tune" size={20} color={colors.textSecondary} />
                  <Text style={[Typography.title, { color: colors.text }]}>{g.name}</Text>
                </View>
                <Text style={[styles.groupSum, { color: colors.textSecondary }]}>{formatMoney0(groupMixedLedgerSum(g.rows))}</Text>
              </View>

              {g.rows.length === 0 ? (
                <Pressable
                  onPress={() => router.push('/add-account')}
                  style={({ pressed }) => [
                    styles.accountRow,
                    { backgroundColor: isDark ? colors.surfaceMuted : colors.input, borderLeftColor: colors.outline },
                    pressed && { opacity: 0.85 },
                  ]}>
                  <View style={styles.accountLeft}>
                    <View style={[styles.accountIconBox, { backgroundColor: colors.surface }]}>
                      <MaterialIcons name="add" size={20} color={colors.textSecondary} />
                    </View>
                    <View>
                      <Text style={[Typography.bodyStrong, styles.accountName, { color: colors.text }]}>添加账户</Text>
                      <Text style={[Typography.caption, styles.accountMeta, { color: colors.textSecondary }]}>类型：{g.name}</Text>
                    </View>
                  </View>
                </Pressable>
              ) : (
                g.rows.map((acc) => (
                  <Pressable
                    key={acc.id}
                    onPress={() => openAccountDetail(acc)}
                    style={({ pressed }) => [
                      styles.accountRow,
                      { backgroundColor: isDark ? colors.surfaceMuted : colors.input, borderLeftColor: colors.outline },
                      pressed && { opacity: 0.85 },
                    ]}>
                    <View style={styles.accountLeft}>
                      <View style={[styles.accountIconBox, { backgroundColor: colors.surface }]}>
                        <MaterialIcons name={accountIcon(acc)} size={20} color={colors.textSecondary} />
                      </View>
                      <View>
                        <Text style={[Typography.bodyStrong, styles.accountName, { color: colors.text }]}>{acc.name}</Text>
                        <Text style={[Typography.caption, styles.accountMeta, { color: colors.textSecondary }]}>{acc.account_no ? acc.account_no : g.name}</Text>
                      </View>
                    </View>
                    <Text style={[Typography.title, styles.accountAmount, { color: colors.text }]}>{formatAccountRowBalance(acc)}</Text>
                  </Pressable>
                ))
              )}
            </View>
          ))}

          {grouped.unknown.length > 0 ? (
            <View style={styles.group}>
              <View style={styles.groupHeader}>
                <View style={styles.groupHeaderLeft}>
                  <MaterialIcons name="tune" size={20} color={colors.textSecondary} />
                  <Text style={[Typography.title, { color: colors.text }]}>其他</Text>
                </View>
                <Text style={[styles.groupSum, { color: colors.textSecondary }]}>{formatMoney0(groupMixedLedgerSum(grouped.unknown))}</Text>
              </View>

              {grouped.unknown.map((acc) => (
                <Pressable
                  key={acc.id}
                  onPress={() => openAccountDetail(acc)}
                  style={({ pressed }) => [
                    styles.accountRow,
                    { backgroundColor: isDark ? colors.surfaceMuted : colors.input, borderLeftColor: colors.outline },
                    pressed && { opacity: 0.85 },
                  ]}>
                  <View style={styles.accountLeft}>
                    <View style={[styles.accountIconBox, { backgroundColor: colors.surface }]}>
                      <MaterialIcons name={accountIcon(acc)} size={20} color={colors.textSecondary} />
                    </View>
                    <View>
                      <Text style={[Typography.bodyStrong, styles.accountName, { color: colors.text }]}>{acc.name}</Text>
                      <Text style={[Typography.caption, styles.accountMeta, { color: colors.textSecondary }]}>{acc.account_no ? acc.account_no : '其他'}</Text>
                    </View>
                  </View>
                  <Text style={[Typography.title, styles.accountAmount, { color: colors.text }]}>{formatAccountRowBalance(acc)}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          <View style={[styles.group, styles.liabilityGroup, { borderTopColor: colors.outline }]}>
            <View style={styles.groupHeader}>
              <View style={styles.groupHeaderLeft}>
                <MaterialIcons name="credit-card-off" size={20} color={colors.danger} />
                <Text style={[Typography.title, { color: colors.danger }]}>负债</Text>
              </View>
              <Text style={[styles.groupSum, { color: colors.danger }]}>{formatDebtMoney2(sumLiabilityDebtMagnitudes(grouped.liability))}</Text>
            </View>

            <View style={styles.debtList}>
              {grouped.liability.length === 0 ? (
                <Pressable
                  onPress={() => router.push('/add-account')}
                  style={({ pressed }) => [
                    styles.debtRow,
                    {
                      backgroundColor: isDark ? 'rgba(220,38,38,0.2)' : 'rgba(220,38,38,0.1)',
                      borderLeftColor: colors.danger,
                    },
                    pressed && { opacity: 0.9 },
                  ]}>
                  <View style={styles.accountLeft}>
                    <View style={[styles.accountIconBox, { backgroundColor: colors.surface }]}>
                      <MaterialIcons name="add" size={20} color={colors.danger} />
                    </View>
                    <View>
                      <Text style={[Typography.bodyStrong, styles.accountName, { color: colors.text }]}>添加负债</Text>
                      <Text style={[Typography.caption, styles.accountMeta, { color: colors.textSecondary }]}>信用卡/贷款等</Text>
                    </View>
                  </View>
                </Pressable>
              ) : (
                grouped.liability.map((acc) => (
                  <Pressable
                    key={acc.id}
                    onPress={() => openAccountDetail(acc)}
                    style={({ pressed }) => [
                      styles.debtRow,
                      {
                      backgroundColor: isDark ? 'rgba(220,38,38,0.2)' : 'rgba(220,38,38,0.1)',
                      borderLeftColor: colors.danger,
                    },
                      pressed && { opacity: 0.9 },
                    ]}>
                    <View style={styles.accountLeft}>
                      <View style={[styles.accountIconBox, { backgroundColor: colors.surface }]}>
                        <MaterialIcons name={accountIcon(acc)} size={20} color={colors.danger} />
                      </View>
                      <View>
                        <Text style={[Typography.bodyStrong, styles.accountName, { color: colors.text }]}>{acc.name}</Text>
                        <Text style={[Typography.caption, styles.accountMeta, { color: colors.textSecondary }]}>{acc.account_no ? acc.account_no : '负债账户'}</Text>
                      </View>
                    </View>
                    <Text style={[Typography.title, styles.accountAmount, { color: colors.danger }]}>{formatAccountRowBalance(acc)}</Text>
                  </Pressable>
                ))
              )}
            </View>
          </View>
        </View>

      </ScrollView>

      <Modal visible={defaultPickerTarget != null} transparent animationType="fade" onRequestClose={() => setDefaultPickerTarget(null)}>
        <Pressable style={[styles.defaultPickerBackdrop, { backgroundColor: colors.overlay }]} onPress={() => setDefaultPickerTarget(null)}>
          <Pressable
            style={[styles.defaultPickerSheet, { backgroundColor: colors.surface, borderColor: colors.outline }]}
            onPress={(e) => e.stopPropagation()}>
            <Text style={[Typography.title, styles.defaultPickerTitle, { color: colors.text }]}>
              {defaultPickerTarget === 'income' ? '选择默认收入账户' : '选择默认支付账户'}
            </Text>
            <ScrollView style={styles.defaultPickerList} showsVerticalScrollIndicator={false}>
              <Pressable
                onPress={() => void saveDefaultAccount(defaultPickerTarget!, null)}
                style={({ pressed }) => [styles.defaultPickerItem, pressed && { opacity: 0.85 }]}>
                <Text style={[Typography.bodyStrong, { color: colors.textSecondary }]}>不设置</Text>
              </Pressable>
              {assetAccounts.map((acc) => {
                const selected =
                  defaultPickerTarget === 'payment'
                    ? acc.id === defaultAccounts.defaultPaymentAccountId
                    : acc.id === defaultAccounts.defaultIncomeAccountId;
                return (
                  <Pressable
                    key={acc.id}
                    onPress={() => void saveDefaultAccount(defaultPickerTarget!, acc.id)}
                    style={({ pressed }) => [styles.defaultPickerItem, pressed && { opacity: 0.85 }]}>
                    <Text style={[Typography.bodyStrong, { color: colors.text }]}>{acc.name}</Text>
                    {selected ? <MaterialIcons name="check" size={20} color={colors.primary} /> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: {
    paddingHorizontal: Spacing['5xl'],
    paddingTop: Spacing['3xl'],
    gap: Spacing['4xl'],
  },
  hero: {
    gap: Spacing.lg,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.lg,
  },
  heroKicker: {
    letterSpacing: 1.2,
    fontSize: 12,
    textTransform: 'none',
  },
  heroRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: Spacing.lg,
    flexWrap: 'wrap',
  },
  netWorth: {
    flexShrink: 1,
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
    alignItems: 'center',
    gap: Spacing['3xl'],
    marginTop: Spacing.xs,
  },
  totalBlock: { gap: Spacing.xs },
  totalLabel: {
    letterSpacing: 1.2,
    fontSize: 12,
    textTransform: 'none',
  },
  vDivider: { width: StyleSheet.hairlineWidth, height: 28, borderRadius: Radius.xs },
  bento: { gap: Spacing.xl },
  cardTitle: { marginBottom: Spacing['2xl'] },
  assetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing['4xl'],
  },
  ringWrap: { width: 128, height: 128, alignItems: 'center', justifyContent: 'center' },
  ringText: { position: 'absolute' },
  legend: { flex: 1, gap: Spacing.lg },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.lg },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  defaultAccountsCard: { gap: Spacing.lg },
  defaultAccountsHint: { lineHeight: 18 },
  defaultAccountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.xl,
    paddingHorizontal: Spacing.xl,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    gap: Spacing.xl,
  },
  defaultAccountRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    flex: 1,
  },
  defaultAccountRowValue: {
    maxWidth: '46%',
    textAlign: 'right',
  },
  defaultPickerBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    padding: Spacing['3xl'],
  },
  defaultPickerSheet: {
    borderRadius: Radius.sheet,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing['4xl'],
    maxHeight: '70%',
  },
  defaultPickerTitle: {
    marginBottom: Spacing.md,
  },
  defaultPickerList: {
    maxHeight: 360,
  },
  defaultPickerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing['2xl'],
    paddingHorizontal: Spacing.xs,
  },
  accounts: { gap: Spacing['4xl'] },
  addAccountRow: { alignItems: 'flex-end' },
  addAccountBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing['3xl'],
    paddingVertical: Spacing.lg,
    borderRadius: Radius.pill,
  },
  group: { gap: Spacing.xl },
  liabilityGroup: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing['4xl'],
  },
  groupHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  groupHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  groupSum: {
    ...Typography.kicker,
    letterSpacing: 1.6,
    fontSize: 12,
  },
  accountRow: {
    borderRadius: Radius.xl,
    padding: Spacing['2xl'],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderLeftWidth: 4,
  },
  accountLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xl,
    flex: 1,
    paddingRight: Spacing.xl,
  },
  accountIconBox: {
    width: 40,
    height: 40,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  accountName: { marginBottom: 2 },
  accountMeta: {},
  accountAmount: {},
  debtList: {
    gap: Spacing.lg,
    opacity: 0.92,
  },
  debtRow: {
    borderRadius: Radius.xl,
    padding: Spacing['2xl'],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderLeftWidth: 4,
  },
});
