import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { FINANCE_ACCOUNT_ICON_OPTIONS } from '@/lib/constants/finance-account-icons';
import { getFinanceAccountTypes, getFinanceAccountsWithBalance } from '@/lib/repositories/finance/finance';
import type { FinanceAccountBalanceRow, FinanceAccountTypeRow } from '@/lib/repositories/finance/finance.types';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';

export default function AssetsScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';

  const surface = isDark ? 'rgba(15,23,42,0.9)' : theme.background;
  const card = theme.surface;
  const outlineVariant = isDark ? 'rgba(148,163,184,0.18)' : 'rgba(226,232,240,0.75)';
  const outline = isDark ? 'rgba(148,163,184,0.65)' : 'rgba(100,116,139,0.8)';

  const primaryBlue = isDark ? '#60a5fa' : '#0058be';
  const secondaryGreen = isDark ? '#34d399' : '#006c49';
  const tertiaryAmber = isDark ? '#fbbf24' : '#825100';
  const errorRed = isDark ? '#f87171' : '#ba1a1a';

  const ringSize = 128;
  const ringStroke = 6;
  const r = (ringSize - ringStroke) / 2;
  const c = 2 * Math.PI * r;

  const dash = (p: number) => `${c * p} ${c * (1 - p)}`;

  const [accounts, setAccounts] = React.useState<FinanceAccountBalanceRow[]>([]);
  const [accountTypes, setAccountTypes] = React.useState<FinanceAccountTypeRow[]>([]);

  const loadAccounts = React.useCallback(async () => {
    try {
      const [rows, typeRows] = await Promise.all([getFinanceAccountsWithBalance(), getFinanceAccountTypes()]);
      setAccounts(rows);
      setAccountTypes(typeRows);
    } catch (e) {
      console.warn('Failed to load finance accounts:', e);
      setAccounts([]);
      setAccountTypes([]);
    }
  }, []);

  React.useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);

  useFocusEffect(
    React.useCallback(() => {
      void loadAccounts();
    }, [loadAccounts]),
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

  const totalAssets = React.useMemo(
    () =>
      accounts.reduce((sum, a) => {
        if (isLiabilityAccount(a)) return sum;
        return sum + Math.max(0, a.balance ?? 0);
      }, 0),
    [accounts, isLiabilityAccount],
  );
  const totalLiabilitiesAbs = React.useMemo(
    () =>
      accounts.reduce((sum, a) => {
        if (!isLiabilityAccount(a)) return sum;
        return sum + Math.abs(a.balance ?? 0);
      }, 0),
    [accounts, isLiabilityAccount],
  );
  const netWorth = React.useMemo(() => totalAssets - totalLiabilitiesAbs, [totalAssets, totalLiabilitiesAbs]);

  const cashTotal = React.useMemo(() => grouped.cash_wallet.reduce((sum, a) => sum + Math.max(0, a.balance ?? 0), 0), [grouped.cash_wallet]);
  const bankTotal = React.useMemo(() => grouped.bank.reduce((sum, a) => sum + Math.max(0, a.balance ?? 0), 0), [grouped.bank]);
  const investTotal = React.useMemo(() => grouped.investment.reduce((sum, a) => sum + Math.max(0, a.balance ?? 0), 0), [grouped.investment]);

  const hasAssets = totalAssets > 0;
  const cashPct = hasAssets ? cashTotal / totalAssets : 0;
  const bankPct = hasAssets ? bankTotal / totalAssets : 0;
  const investPct = hasAssets ? investTotal / totalAssets : 0;

  const ringPct = hasAssets ? Math.round(((cashTotal + bankTotal + investTotal) / totalAssets) * 100) : 0;

  const groupSumAbs = React.useCallback((rows: FinanceAccountBalanceRow[]) => {
    return rows.reduce((sum, a) => sum + Math.abs(a.balance ?? 0), 0);
  }, []);

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
    <SafeAreaView style={[styles.container, { backgroundColor: surface }]}>
      <View style={[styles.header, { backgroundColor: isDark ? 'rgba(15,23,42,0.82)' : 'rgba(255,255,255,0.82)' }]}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.headerIconBtn, pressed && { opacity: 0.7 }]}>
          <MaterialIcons name="arrow-back" size={22} color={isDark ? 'rgba(248,250,252,0.92)' : 'rgba(15,23,42,0.92)'} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: isDark ? 'rgba(248,250,252,0.95)' : 'rgba(15,23,42,0.95)' }]}>资产</Text>
        <Pressable onPress={() => router.push('/finance-calendar')} style={({ pressed }) => [styles.headerIconBtn, pressed && { opacity: 0.7 }]}>
          <MaterialIcons name="calendar-today" size={22} color={isDark ? 'rgba(148,163,184,0.9)' : 'rgba(100,116,139,0.9)'} />
        </Pressable>
      </View>
      <View style={[styles.headerDivider, { backgroundColor: outlineVariant }]} />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <Text style={[styles.kicker, { color: outline }]}>当前净资产</Text>
          <View style={styles.heroRow}>
            <Text style={[styles.netWorth, { color: netWorth < 0 ? errorRed : theme.text }]}>{formatSignedMoney0(netWorth)}</Text>
            <Pressable
              onPress={() => router.push('/ai-finance-analysis')}
              style={({ pressed }) => [styles.pill, { backgroundColor: `${secondaryGreen}1A` }, pressed && { opacity: 0.8 }]}>
              <MaterialIcons name="trending-up" size={16} color={secondaryGreen} />
              <Text style={[styles.pillText, { color: secondaryGreen }]}>2.4%</Text>
            </Pressable>
          </View>

          <View style={styles.totalsRow}>
            <View style={styles.totalBlock}>
              <Text style={[styles.totalLabel, { color: outline }]}>总资产</Text>
              <Text style={[styles.totalValue, { color: theme.text }]}>{formatMoney0(totalAssets)}</Text>
            </View>
            <View style={[styles.vDivider, { backgroundColor: `${outlineVariant}80` }]} />
            <View style={styles.totalBlock}>
              <Text style={[styles.totalLabel, { color: outline }]}>总负债</Text>
              <Text style={[styles.totalValue, { color: errorRed }]}>{formatMoney0(totalLiabilitiesAbs)}</Text>
            </View>
          </View>
        </View>

        <View style={styles.bento}>
          <View style={[styles.assetCard, { backgroundColor: card, borderColor: `${outlineVariant}40` }]}>
            <Text style={[styles.cardTitle, { color: theme.text }]}>资产配置</Text>
            <View style={styles.assetRow}>
              <View style={styles.ringWrap}>
                <Svg width={ringSize} height={ringSize} viewBox={`0 0 ${ringSize} ${ringSize}`} style={{ transform: [{ rotate: '-90deg' }] }}>
                  <Circle cx={ringSize / 2} cy={ringSize / 2} r={r} stroke={isDark ? 'rgba(148,163,184,0.12)' : 'rgba(226,231,255,0.95)'} strokeWidth={2} fill="none" />
                  <Circle cx={ringSize / 2} cy={ringSize / 2} r={r} stroke={tertiaryAmber} strokeWidth={ringStroke} strokeDasharray={dash(cashPct)} strokeDashoffset={c * (1 - cashPct)} fill="none" />
                  <Circle cx={ringSize / 2} cy={ringSize / 2} r={r} stroke={primaryBlue} strokeWidth={ringStroke} strokeDasharray={dash(bankPct)} strokeDashoffset={c * (1 - bankPct)} fill="none" transform={`rotate(${cashPct * 360} ${ringSize / 2} ${ringSize / 2})`} />
                  <Circle cx={ringSize / 2} cy={ringSize / 2} r={r} stroke={secondaryGreen} strokeWidth={ringStroke} strokeDasharray={dash(investPct)} strokeDashoffset={c * (1 - investPct)} fill="none" transform={`rotate(${(cashPct + bankPct) * 360} ${ringSize / 2} ${ringSize / 2})`} />
                </Svg>
                <Text style={[styles.ringText, { color: theme.text }]}>{ringPct}%</Text>
              </View>

              <View style={styles.legend}>
                <View style={styles.legendRow}>
                  <View style={[styles.legendDot, { backgroundColor: tertiaryAmber }]} />
                  <Text style={[styles.legendText, { color: theme.text }]}>
                    现金 ({Math.round(cashPct * 100)}%)
                  </Text>
                </View>
                <View style={styles.legendRow}>
                  <View style={[styles.legendDot, { backgroundColor: primaryBlue }]} />
                  <Text style={[styles.legendText, { color: theme.text }]}>
                    银行 ({Math.round(bankPct * 100)}%)
                  </Text>
                </View>
                <View style={styles.legendRow}>
                  <View style={[styles.legendDot, { backgroundColor: secondaryGreen }]} />
                  <Text style={[styles.legendText, { color: theme.text }]}>
                    投资 ({Math.round(investPct * 100)}%)
                  </Text>
                </View>
              </View>
            </View>
          </View>

          <View style={[styles.growthCard, { backgroundColor: tertiaryAmber }]}>
            <View style={styles.growthTop}>
              <Text style={styles.growthKicker}>增长预测</Text>
              <Text style={styles.growthTitle}>预计下月增长 +¥12k</Text>
            </View>
            <Pressable
              onPress={() => router.push('/ai-finance-analysis')}
              style={({ pressed }) => [styles.growthBtn, pressed && { opacity: 0.8 }]}>
              <Text style={styles.growthBtnText}>查看分析</Text>
              <MaterialIcons name="arrow-forward" size={16} color="#fff" />
            </Pressable>
            <View style={[styles.growthGlow, { backgroundColor: isDark ? 'rgba(217,119,6,0.45)' : 'rgba(163,103,0,0.35)' }]} />
          </View>
        </View>

        <View style={styles.accounts}>
          <View style={styles.addAccountRow}>
            <Pressable
              onPress={() => router.push('/add-account')}
              style={({ pressed }) => [styles.addAccountBtn, { backgroundColor: `${primaryBlue}1A` }, pressed && { opacity: 0.85 }]}>
              <MaterialIcons name="add" size={18} color={primaryBlue} />
              <Text style={[styles.addAccountText, { color: primaryBlue }]}>添加新账户</Text>
            </Pressable>
          </View>

          <View style={styles.group}>
            <View style={styles.groupHeader}>
              <View style={styles.groupHeaderLeft}>
                <MaterialIcons name="wallet" size={20} color={tertiaryAmber} />
                <Text style={[styles.groupTitle, { color: theme.text }]}>现金与钱包</Text>
              </View>
              <Text style={[styles.groupSum, { color: tertiaryAmber }]}>{formatMoney0(groupSumAbs(grouped.cash_wallet))}</Text>
            </View>

            {grouped.cash_wallet.length === 0 ? (
              <Pressable
                onPress={() => router.push('/add-account')}
                style={({ pressed }) => [
                  styles.accountRow,
                  { backgroundColor: isDark ? 'rgba(148,163,184,0.10)' : 'rgba(242,243,255,0.9)', borderLeftColor: tertiaryAmber },
                  pressed && { opacity: 0.85 },
                ]}>
                <View style={styles.accountLeft}>
                  <View style={[styles.accountIconBox, { backgroundColor: card }]}>
                    <MaterialIcons name="add" size={20} color={tertiaryAmber} />
                  </View>
                  <View>
                    <Text style={[styles.accountName, { color: theme.text }]}>添加账户</Text>
                    <Text style={[styles.accountMeta, { color: outline }]}>创建你的第一个账户</Text>
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
                    { backgroundColor: isDark ? 'rgba(148,163,184,0.10)' : 'rgba(242,243,255,0.9)', borderLeftColor: tertiaryAmber },
                    pressed && { opacity: 0.85 },
                  ]}>
                  <View style={styles.accountLeft}>
                    <View style={[styles.accountIconBox, { backgroundColor: card }]}>
                      <MaterialIcons name={accountIcon(acc)} size={20} color={tertiaryAmber} />
                    </View>
                    <View>
                      <Text style={[styles.accountName, { color: theme.text }]}>{acc.name}</Text>
                      <Text style={[styles.accountMeta, { color: outline }]}>{acc.account_no ? acc.account_no : '现金/钱包'}</Text>
                    </View>
                  </View>
                  <Text style={[styles.accountAmount, { color: theme.text }]}>{formatMoney2(acc.balance)}</Text>
                </Pressable>
              ))
            )}
          </View>

          <View style={styles.group}>
            <View style={styles.groupHeader}>
              <View style={styles.groupHeaderLeft}>
                <MaterialIcons name="account-balance" size={20} color={primaryBlue} />
                <Text style={[styles.groupTitle, { color: theme.text }]}>银行账户</Text>
              </View>
              <Text style={[styles.groupSum, { color: primaryBlue }]}>{formatMoney0(groupSumAbs(grouped.bank))}</Text>
            </View>

            {grouped.bank.length === 0 ? (
              <Pressable
                onPress={() => router.push('/add-account')}
                style={({ pressed }) => [
                  styles.accountRow,
                  { backgroundColor: isDark ? 'rgba(148,163,184,0.10)' : 'rgba(242,243,255,0.9)', borderLeftColor: primaryBlue },
                  pressed && { opacity: 0.85 },
                ]}>
                <View style={styles.accountLeft}>
                  <View style={[styles.accountIconBox, { backgroundColor: card }]}>
                    <MaterialIcons name="add" size={20} color={primaryBlue} />
                  </View>
                  <View>
                    <Text style={[styles.accountName, { color: theme.text }]}>添加账户</Text>
                    <Text style={[styles.accountMeta, { color: outline }]}>添加银行卡/储蓄账户</Text>
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
                    { backgroundColor: isDark ? 'rgba(148,163,184,0.10)' : 'rgba(242,243,255,0.9)', borderLeftColor: primaryBlue },
                    pressed && { opacity: 0.85 },
                  ]}>
                  <View style={styles.accountLeft}>
                    <View style={[styles.accountIconBox, { backgroundColor: card }]}>
                      <MaterialIcons name={accountIcon(acc)} size={20} color={primaryBlue} />
                    </View>
                    <View>
                      <Text style={[styles.accountName, { color: theme.text }]}>{acc.name}</Text>
                      <Text style={[styles.accountMeta, { color: outline }]}>{acc.account_no ? acc.account_no : '银行账户'}</Text>
                    </View>
                  </View>
                  <Text style={[styles.accountAmount, { color: theme.text }]}>{formatMoney2(acc.balance)}</Text>
                </Pressable>
              ))
            )}
          </View>

          <View style={styles.group}>
            <View style={styles.groupHeader}>
              <View style={styles.groupHeaderLeft}>
                <MaterialIcons name="show-chart" size={20} color={secondaryGreen} />
                <Text style={[styles.groupTitle, { color: theme.text }]}>投资项目</Text>
              </View>
              <Text style={[styles.groupSum, { color: secondaryGreen }]}>{formatMoney0(groupSumAbs(grouped.investment))}</Text>
            </View>

            {grouped.investment.length === 0 ? (
              <Pressable
                onPress={() => router.push('/add-account')}
                style={({ pressed }) => [
                  styles.accountRow,
                  { backgroundColor: isDark ? 'rgba(148,163,184,0.10)' : 'rgba(242,243,255,0.9)', borderLeftColor: secondaryGreen },
                  pressed && { opacity: 0.85 },
                ]}>
                <View style={styles.accountLeft}>
                  <View style={[styles.accountIconBox, { backgroundColor: card }]}>
                    <MaterialIcons name="add" size={20} color={secondaryGreen} />
                  </View>
                  <View>
                    <Text style={[styles.accountName, { color: theme.text }]}>添加账户</Text>
                    <Text style={[styles.accountMeta, { color: outline }]}>添加基金/股票/理财</Text>
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
                    { backgroundColor: isDark ? 'rgba(148,163,184,0.10)' : 'rgba(242,243,255,0.9)', borderLeftColor: secondaryGreen },
                    pressed && { opacity: 0.85 },
                  ]}>
                  <View style={styles.accountLeft}>
                    <View style={[styles.accountIconBox, { backgroundColor: card }]}>
                      <MaterialIcons name={accountIcon(acc)} size={20} color={secondaryGreen} />
                    </View>
                    <View>
                      <Text style={[styles.accountName, { color: theme.text }]}>{acc.name}</Text>
                      <Text style={[styles.accountMeta, { color: outline }]}>{acc.account_no ? acc.account_no : '投资账户'}</Text>
                    </View>
                  </View>
                  <Text style={[styles.accountAmount, { color: theme.text }]}>{formatMoney2(acc.balance)}</Text>
                </Pressable>
              ))
            )}
          </View>

          {customTypeGroups.map((g) => (
            <View key={`custom-group-${g.name}`} style={styles.group}>
              <View style={styles.groupHeader}>
                <View style={styles.groupHeaderLeft}>
                  <MaterialIcons name="tune" size={20} color={outline} />
                  <Text style={[styles.groupTitle, { color: theme.text }]}>{g.name}</Text>
                </View>
                <Text style={[styles.groupSum, { color: outline }]}>{formatMoney0(groupSumAbs(g.rows))}</Text>
              </View>

              {g.rows.length === 0 ? (
                <Pressable
                  onPress={() => router.push('/add-account')}
                  style={({ pressed }) => [
                    styles.accountRow,
                    { backgroundColor: isDark ? 'rgba(148,163,184,0.10)' : 'rgba(242,243,255,0.9)', borderLeftColor: outlineVariant },
                    pressed && { opacity: 0.85 },
                  ]}>
                  <View style={styles.accountLeft}>
                    <View style={[styles.accountIconBox, { backgroundColor: card }]}>
                      <MaterialIcons name="add" size={20} color={outline} />
                    </View>
                    <View>
                      <Text style={[styles.accountName, { color: theme.text }]}>添加账户</Text>
                      <Text style={[styles.accountMeta, { color: outline }]}>类型：{g.name}</Text>
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
                      { backgroundColor: isDark ? 'rgba(148,163,184,0.10)' : 'rgba(242,243,255,0.9)', borderLeftColor: outlineVariant },
                      pressed && { opacity: 0.85 },
                    ]}>
                    <View style={styles.accountLeft}>
                      <View style={[styles.accountIconBox, { backgroundColor: card }]}>
                        <MaterialIcons name={accountIcon(acc)} size={20} color={outline} />
                      </View>
                      <View>
                        <Text style={[styles.accountName, { color: theme.text }]}>{acc.name}</Text>
                        <Text style={[styles.accountMeta, { color: outline }]}>{acc.account_no ? acc.account_no : g.name}</Text>
                      </View>
                    </View>
                    <Text style={[styles.accountAmount, { color: theme.text }]}>{formatMoney2(acc.balance)}</Text>
                  </Pressable>
                ))
              )}
            </View>
          ))}

          {grouped.unknown.length > 0 ? (
            <View style={styles.group}>
              <View style={styles.groupHeader}>
                <View style={styles.groupHeaderLeft}>
                  <MaterialIcons name="tune" size={20} color={outline} />
                  <Text style={[styles.groupTitle, { color: theme.text }]}>其他</Text>
                </View>
                <Text style={[styles.groupSum, { color: outline }]}>{formatMoney0(groupSumAbs(grouped.unknown))}</Text>
              </View>

              {grouped.unknown.map((acc) => (
                <Pressable
                  key={acc.id}
                  onPress={() => openAccountDetail(acc)}
                  style={({ pressed }) => [
                    styles.accountRow,
                    { backgroundColor: isDark ? 'rgba(148,163,184,0.10)' : 'rgba(242,243,255,0.9)', borderLeftColor: outlineVariant },
                    pressed && { opacity: 0.85 },
                  ]}>
                  <View style={styles.accountLeft}>
                    <View style={[styles.accountIconBox, { backgroundColor: card }]}>
                      <MaterialIcons name={accountIcon(acc)} size={20} color={outline} />
                    </View>
                    <View>
                      <Text style={[styles.accountName, { color: theme.text }]}>{acc.name}</Text>
                      <Text style={[styles.accountMeta, { color: outline }]}>{acc.account_no ? acc.account_no : '其他'}</Text>
                    </View>
                  </View>
                  <Text style={[styles.accountAmount, { color: theme.text }]}>{formatMoney2(acc.balance)}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          <View style={[styles.group, { borderTopColor: `${outlineVariant}80`, borderTopWidth: 1, paddingTop: 18 }]}>
            <View style={styles.groupHeader}>
              <View style={styles.groupHeaderLeft}>
                <MaterialIcons name="credit-card-off" size={20} color={errorRed} />
                <Text style={[styles.groupTitle, { color: errorRed }]}>负债</Text>
              </View>
              <Text style={[styles.groupSum, { color: errorRed }]}>{formatMoney0(groupSumAbs(grouped.liability))}</Text>
            </View>

            <View style={styles.debtList}>
              {grouped.liability.length === 0 ? (
                <Pressable
                  onPress={() => router.push('/add-account')}
                  style={({ pressed }) => [
                    styles.debtRow,
                    { backgroundColor: `${errorRed}1A`, borderLeftColor: errorRed },
                    pressed && { opacity: 0.9 },
                  ]}>
                  <View style={styles.accountLeft}>
                    <View style={[styles.accountIconBox, { backgroundColor: card }]}>
                      <MaterialIcons name="add" size={20} color={errorRed} />
                    </View>
                    <View>
                      <Text style={[styles.accountName, { color: theme.text }]}>添加负债</Text>
                      <Text style={[styles.accountMeta, { color: outline }]}>信用卡/贷款等</Text>
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
                      { backgroundColor: `${errorRed}1A`, borderLeftColor: errorRed },
                      pressed && { opacity: 0.9 },
                    ]}>
                    <View style={styles.accountLeft}>
                      <View style={[styles.accountIconBox, { backgroundColor: card }]}>
                        <MaterialIcons name={accountIcon(acc)} size={20} color={errorRed} />
                      </View>
                      <View>
                        <Text style={[styles.accountName, { color: theme.text }]}>{acc.name}</Text>
                        <Text style={[styles.accountMeta, { color: outline }]}>{acc.account_no ? acc.account_no : '负债账户'}</Text>
                      </View>
                    </View>
                    <Text style={[styles.accountAmount, { color: errorRed }]}>{formatDebtMoney2(acc.balance)}</Text>
                  </Pressable>
                ))
              )}
            </View>
          </View>
        </View>

        <View style={{ height: 24 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingVertical: 12 },
  headerIconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 16, fontWeight: '800', letterSpacing: -0.3 },
  headerDivider: { height: 1, width: '100%', opacity: 0.6 },
  content: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 110, gap: 18 },
  hero: { gap: 10, paddingTop: 6, paddingBottom: 10 },
  kicker: { fontSize: 12, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase' },
  heroRow: { flexDirection: 'row', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' },
  netWorth: { fontSize: 44, fontWeight: '900', letterSpacing: -1.4, lineHeight: 52 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 },
  pillText: { fontSize: 14, fontWeight: '900' },
  totalsRow: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 4 },
  totalBlock: { gap: 4 },
  totalLabel: { fontSize: 12, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase' },
  totalValue: { fontSize: 15, fontWeight: '800' },
  vDivider: { width: 1, height: 28, borderRadius: 1 },
  bento: { gap: 12 },
  assetCard: { borderRadius: 16, padding: 16, borderWidth: 1 },
  cardTitle: { fontSize: 18, fontWeight: '900', marginBottom: 14 },
  assetRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 18 },
  ringWrap: { width: 128, height: 128, alignItems: 'center', justifyContent: 'center' },
  ringText: { position: 'absolute', fontSize: 16, fontWeight: '900' },
  legend: { flex: 1, gap: 10 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { fontSize: 14, fontWeight: '600' },
  growthCard: { borderRadius: 16, padding: 16, overflow: 'hidden', minHeight: 160, justifyContent: 'space-between' },
  growthTop: { gap: 6, zIndex: 2 },
  growthKicker: { color: 'rgba(255,255,255,0.85)', fontSize: 10, fontWeight: '900', letterSpacing: 2, textTransform: 'uppercase' },
  growthTitle: { color: '#fff', fontSize: 20, fontWeight: '900', letterSpacing: -0.4 },
  growthBtn: { zIndex: 2, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)', backgroundColor: 'rgba(255,255,255,0.10)' },
  growthBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  growthGlow: { position: 'absolute', right: -60, bottom: -60, width: 220, height: 220, borderRadius: 999, opacity: 0.55 },
  accounts: { gap: 18 },
  addAccountRow: { alignItems: 'flex-end' },
  addAccountBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999 },
  addAccountText: { fontSize: 14, fontWeight: '900' },
  group: { gap: 12 },
  groupHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  groupHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  groupTitle: { fontSize: 16, fontWeight: '900' },
  groupSum: { fontSize: 12, fontWeight: '900', letterSpacing: 1.6, textTransform: 'uppercase' },
  accountRow: { borderRadius: 16, padding: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderLeftWidth: 4 },
  accountLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1, paddingRight: 12 },
  accountIconBox: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  accountImage: { width: 40, height: 40, borderRadius: 12 },
  accountName: { fontSize: 14, fontWeight: '800', marginBottom: 2 },
  accountMeta: { fontSize: 12, fontWeight: '600' },
  accountAmount: { fontSize: 16, fontWeight: '900' },
  debtList: {
    gap: 10,
    opacity: 0.92,
  },
  debtRow: {
    borderRadius: 16,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderLeftWidth: 4,
  },
});
