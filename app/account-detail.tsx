import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { FINANCE_ACCOUNT_ICON_OPTIONS } from '@/lib/constants/finance-account-icons';
import {
  applyFinanceAccountBalanceCorrection,
  deleteFinanceAccount,
  financeBalanceInputTextFromLedger,
  financeTargetLedgerFromUserBalanceInput,
  getFinanceAccountsWithBalance,
  getFinanceTransactionsByAccountId,
  updateFinanceAccount,
} from '@/lib/repositories/finance/finance';
import { setFinanceSheetLaunchIntent } from '@/lib/finance-sheet-launch-intent';
import {
  isFinanceAccountExcludedFromAggregates,
  mergeFinanceAccountExcludeFromTotalAssets,
} from '@/lib/repositories/finance/finance-account-extra';
import type { FinanceAccountBalanceRow, FinanceTransactionRow } from '@/lib/repositories/finance/finance.types';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

type DetailItem = {
  id: string;
  time: string;
  tag: string;
  emoji: string;
  amount: string;
  flowLabel: string;
};

type MonthSection = {
  id: string;
  monthLabel: string;
  expense: string;
  income: string;
  expanded: boolean;
  details?: Array<{
    dateLabel: string;
    items: DetailItem[];
  }>;
};
const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const;

export default function AccountDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ accountId?: string; accountName?: string; accountNo?: string }>();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const themeKey = colorScheme === 'dark' ? 'dark' : 'light';
  const theme = Colors[themeKey];
  const isDark = colorScheme === 'dark';
  const [account, setAccount] = React.useState<FinanceAccountBalanceRow | null>(null);
  const [transactions, setTransactions] = React.useState<FinanceTransactionRow[]>([]);
  const [deleting, setDeleting] = React.useState(false);
  const [balanceModalOpen, setBalanceModalOpen] = React.useState(false);
  const [balanceDraft, setBalanceDraft] = React.useState('');
  const [savingBalance, setSavingBalance] = React.useState(false);
  /** 切换「不计入总资产」写入中的防抖态，避免连点 */
  const [savingExcludeFromTotal, setSavingExcludeFromTotal] = React.useState(false);
  const routeAccountId = typeof params.accountId === 'string' ? params.accountId : '';
  const routeAccountName = typeof params.accountName === 'string' ? params.accountName.trim() : '';
  const accountSignRule = account?.sign_rule ?? 1;
  const isLiabilityAccount = accountSignRule < 0 || account?.account_type === 'liability';

  const pageBg = isDark ? theme.background : '#f3f4f6';
  const surface = isDark ? '#111827' : '#ffffff';
  const cardBg = isDark ? '#1f2937' : '#FCF8F2';
  const titleText = isDark ? '#f9fafb' : '#111827';
  const subtleText = isDark ? '#9ca3af' : '#6b7280';
  const borderColor = isDark ? 'rgba(148,163,184,0.22)' : '#f3f4f6';
  const detailName = account?.name ?? (routeAccountName || '账户');
  const detailDesc = account?.account_no?.trim() ? account.account_no : isLiabilityAccount ? '负债明细' : '账户余额';

  const accountIcon = React.useCallback(
    (acc: FinanceAccountBalanceRow | null): keyof typeof MaterialIcons.glyphMap => {
      if (!acc) return 'account-balance-wallet';
      let extra: unknown = null;
      try {
        extra = acc.extra_data ? JSON.parse(acc.extra_data) : null;
      } catch {
        // ignore
      }
      if (extra && typeof extra === 'object') {
        const obj = extra as Record<string, unknown>;
        const iconKey = obj.ui_icon_key;
        if (typeof iconKey === 'string' && iconKey.length > 0) {
          const matchedIcon = FINANCE_ACCOUNT_ICON_OPTIONS.find((item) => item.key === iconKey)?.icon;
          if (matchedIcon) return matchedIcon;
          if (iconKey in MaterialIcons.glyphMap) {
            return iconKey as keyof typeof MaterialIcons.glyphMap;
          }
        }
      }
      const name = acc.name || '';
      if (name.includes('现金')) return 'payments';
      if (name.includes('支付宝')) return 'account-balance-wallet';
      if (name.includes('微信')) return 'chat';
      if (name.includes('银行')) return 'account-balance';
      if (acc.account_type === 'liability') return 'credit-card';
      return 'account-balance-wallet';
    },
    [],
  );

  const getDisplayAmount = React.useCallback(
    (tx: FinanceTransactionRow) => {
      const absAmount = Math.abs(tx.amount);
      if (isLiabilityAccount) {
        if (tx.transaction_type === 'income') return -absAmount;
        if (tx.transaction_type === 'expense') return absAmount;
        return -tx.amount;
      }
      if (tx.transaction_type === 'income') return absAmount;
      if (tx.transaction_type === 'expense') return -absAmount;
      return tx.amount;
    },
    [isLiabilityAccount]
  );

  const formatMoney = React.useCallback((amount: number) => {
    return `¥${Math.abs(amount).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }, []);

  const loadAccountDetail = React.useCallback(async () => {
    try {
      const allAccounts = await getFinanceAccountsWithBalance();
      const target =
        allAccounts.find((item) => item.id === routeAccountId) ??
        (routeAccountName ? allAccounts.find((item) => item.name === routeAccountName) : null) ??
        null;
      setAccount(target);
      if (!target) {
        setTransactions([]);
        return;
      }
      const txRows = await getFinanceTransactionsByAccountId(target.id);
      setTransactions(txRows);
    } catch (error) {
      console.warn('Failed to load account detail:', error);
      setAccount(null);
      setTransactions([]);
    }
  }, [routeAccountId, routeAccountName]);

  useFocusEffect(
    React.useCallback(() => {
      void loadAccountDetail();
    }, [loadAccountDetail]),
  );

  const excludeFromTotalAssets = React.useMemo(
    () => isFinanceAccountExcludedFromAggregates(account?.extra_data ?? null),
    [account?.extra_data],
  );

  const onToggleExcludeFromTotalAssets = React.useCallback(
    async (nextExcluded: boolean) => {
      const targetId = account?.id ?? routeAccountId;
      if (!targetId || savingExcludeFromTotal) return;
      try {
        setSavingExcludeFromTotal(true);
        const merged = mergeFinanceAccountExcludeFromTotalAssets(account?.extra_data ?? null, nextExcluded);
        await updateFinanceAccount(targetId, { extra_data: merged });
        await loadAccountDetail();
      } catch (error) {
        console.warn('Failed to update exclude_from_total_assets:', error);
        Alert.alert('保存失败', '请稍后重试。');
      } finally {
        setSavingExcludeFromTotal(false);
      }
    },
    [account?.extra_data, account?.id, loadAccountDetail, routeAccountId, savingExcludeFromTotal],
  );

  const resolvedAccountId = account?.id ?? routeAccountId;

  const handleBalanceDraftChange = React.useCallback((text: string) => {
    let s = text.replace(/[^\d.-]/g, '');
    const negative = s.startsWith('-');
    s = s.replace(/-/g, '');
    const dot = s.indexOf('.');
    if (dot !== -1) {
      s = s.slice(0, dot + 1) + s.slice(dot + 1).replace(/\./g, '');
    }
    if (negative) s = `-${s}`;
    setBalanceDraft(s);
  }, []);

  const openBalanceEditor = React.useCallback(() => {
    if (!account) {
      Alert.alert('无法编辑', '未找到账户信息。');
      return;
    }
    setBalanceDraft(
      financeBalanceInputTextFromLedger(account.balance ?? 0, account.sign_rule, account.account_type),
    );
    setBalanceModalOpen(true);
  }, [account]);

  const onConfirmBalanceEdit = React.useCallback(async () => {
    if (!account || savingBalance) return;
    const normalized = balanceDraft.trim().replace(/[^\d.-]/g, '');
    const n = normalized ? Number(normalized) : 0;
    if (!Number.isFinite(n)) {
      Alert.alert('金额无效', '请输入正确的数字。');
      return;
    }
    const targetLedger = financeTargetLedgerFromUserBalanceInput({
      userNumeric: n,
      signRule: account.sign_rule,
      accountType: account.account_type,
    });
    try {
      setSavingBalance(true);
      await applyFinanceAccountBalanceCorrection({
        accountId: account.id,
        targetLedgerBalance: targetLedger,
      });
      setBalanceModalOpen(false);
      await loadAccountDetail();
    } catch (e) {
      Alert.alert('保存失败', e instanceof Error && e.message.trim() ? e.message : '请稍后重试。');
    } finally {
      setSavingBalance(false);
    }
  }, [account, balanceDraft, loadAccountDetail, savingBalance]);

  const onPressEditAccountMeta = React.useCallback(() => {
    if (!resolvedAccountId) {
      Alert.alert('无法编辑', '未找到账户信息。');
      return;
    }
    router.push({ pathname: '/add-account', params: { editAccountId: resolvedAccountId } });
  }, [resolvedAccountId, router]);

  const onPressBookkeeping = React.useCallback(() => {
    if (!resolvedAccountId) {
      Alert.alert('无法记账', '未找到账户信息。');
      return;
    }
    setFinanceSheetLaunchIntent({ kind: 'manual', tab: 'sentence', accountId: resolvedAccountId });
    router.push('/(tabs)/finance');
  }, [resolvedAccountId, router]);

  const onPressTransfer = React.useCallback(() => {
    if (!resolvedAccountId) {
      Alert.alert('无法转账', '未找到账户信息。');
      return;
    }
    if (isLiabilityAccount || accountSignRule !== 1) {
      Alert.alert(
        '不支持转账',
        '仅在两个资产账户（钱包/银行卡等）之间可转账。负债请使用「记账」登记还款或新增负债。',
      );
      return;
    }
    setFinanceSheetLaunchIntent({ kind: 'transfer', fromAccountId: resolvedAccountId });
    router.push('/(tabs)/finance');
  }, [accountSignRule, isLiabilityAccount, resolvedAccountId, router]);

  const onDeleteAccount = React.useCallback(() => {
    if (deleting) return;
    const targetId = account?.id ?? routeAccountId;
    if (!targetId) {
      Alert.alert('无法删除', '未找到账户信息。');
      return;
    }
    const targetName = (account?.name ?? routeAccountName) || '该账户';
    Alert.alert('删除账户', `确认删除“${targetName}”吗？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          try {
            setDeleting(true);
            await deleteFinanceAccount(targetId);
            router.back();
          } catch (error) {
            console.warn('Failed to delete finance account:', error);
            Alert.alert('删除失败', '请稍后重试。');
          } finally {
            setDeleting(false);
          }
        },
      },
    ]);
  }, [account, deleting, routeAccountId, routeAccountName, router]);

  const monthSections = React.useMemo<MonthSection[]>(() => {
    if (transactions.length === 0) return [];
    const monthMap = new Map<string, FinanceTransactionRow[]>();
    for (const tx of transactions) {
      const monthKey = tx.happened_at.slice(0, 7);
      const rows = monthMap.get(monthKey);
      if (rows) rows.push(tx);
      else monthMap.set(monthKey, [tx]);
    }

    return Array.from(monthMap.entries()).map(([monthKey, rows], monthIndex) => {
      const [year, month] = monthKey.split('-');
      const incomeTotal = rows.reduce((sum, tx) => {
        const displayAmount = getDisplayAmount(tx);
        return displayAmount > 0 ? sum + Math.abs(displayAmount) : sum;
      }, 0);
      const expenseTotal = rows.reduce((sum, tx) => {
        const displayAmount = getDisplayAmount(tx);
        return displayAmount < 0 ? sum + Math.abs(displayAmount) : sum;
      }, 0);
      const dayMap = new Map<string, FinanceTransactionRow[]>();
      for (const tx of rows) {
        const dayKey = tx.happened_at.slice(0, 10);
        const dayRows = dayMap.get(dayKey);
        if (dayRows) dayRows.push(tx);
        else dayMap.set(dayKey, [tx]);
      }

      const details = Array.from(dayMap.entries()).map(([dayKey, dayRows]) => {
        const dt = new Date(dayKey);
        const dateLabel = Number.isNaN(dt.getTime())
          ? dayKey
          : `${dt.getMonth() + 1}月${dt.getDate()}日 (${WEEKDAY_LABELS[dt.getDay()]})`;
        const items: DetailItem[] = dayRows.map((tx) => {
          const happenedDate = new Date(tx.happened_at);
          const hour = Number.isNaN(happenedDate.getTime()) ? '00' : String(happenedDate.getHours()).padStart(2, '0');
          const minute = Number.isNaN(happenedDate.getTime()) ? '00' : String(happenedDate.getMinutes()).padStart(2, '0');
          const displayAmount = getDisplayAmount(tx);
          const isIncome = displayAmount > 0;
          const isExpense = displayAmount < 0;
          return {
            id: tx.id,
            time: `${hour}:${minute}`,
            tag: tx.name?.trim() || '交易',
            emoji: isIncome ? '📈' : isExpense ? '💸' : '💳',
            amount: `${isIncome ? '+' : isExpense ? '-' : ''} ${formatMoney(displayAmount)}`,
            flowLabel: tx.transaction_type === 'transfer' ? '转账' : isIncome ? '收入' : '支出',
          };
        });
        return { dateLabel, items };
      });

      return {
        id: monthKey,
        monthLabel: `${year}年${Number(month)}月`,
        expense: formatMoney(expenseTotal),
        income: formatMoney(incomeTotal),
        expanded: monthIndex === 0,
        details,
      };
    });
  }, [formatMoney, getDisplayAmount, transactions]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: pageBg }]} edges={['top', 'left', 'right']}>
      <View style={[styles.mobileContainer, { backgroundColor: surface }]}>
        <View
          style={[
            styles.header,
            {
              borderBottomColor: borderColor,
              paddingTop: 6,
              backgroundColor: surface,
            },
          ]}>
          <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.headerIconBtn, pressed && { opacity: 0.7 }]}>
            <MaterialIcons name="arrow-back" size={24} color={titleText} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: titleText }]}>账户详情</Text>
          <Pressable
            onPress={onDeleteAccount}
            disabled={deleting}
            style={({ pressed }) => [styles.headerIconBtn, deleting && { opacity: 0.5 }, pressed && { opacity: 0.7 }]}>
            <MaterialIcons name="delete-outline" size={22} color="#ef4444" />
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: 32 + Math.max(insets.bottom, 8) }]}
          showsVerticalScrollIndicator={false}>
          <View style={[styles.accountCard, { backgroundColor: cardBg }]}>
            <View style={styles.accountTopRow}>
              <Pressable
                onPress={onPressEditAccountMeta}
                disabled={!resolvedAccountId}
                accessibilityRole="button"
                accessibilityLabel="编辑账户名称、卡号与图标"
                style={({ pressed }) => [
                  styles.accountMetaPressable,
                  !resolvedAccountId && { opacity: 0.5 },
                  pressed && resolvedAccountId && { opacity: 0.82 },
                ]}>
                <View style={styles.avatarOuter}>
                  <View style={styles.avatarInner}>
                    <MaterialIcons name={accountIcon(account)} size={20} color="#111827" />
                    <View style={styles.avatarBadge}>
                      <Text style={styles.avatarBadgeDot}>.</Text>
                    </View>
                  </View>
                </View>
                <View style={styles.accountTitleCol}>
                  <Text style={[styles.accountName, { color: titleText }]}>{detailName}</Text>
                  <Text style={[styles.accountDesc, { color: subtleText }]}>{detailDesc}</Text>
                </View>
                <MaterialIcons name="chevron-right" size={22} color={subtleText} style={styles.accountMetaChevron} />
              </Pressable>
            </View>

            <View style={[styles.dashedDivider, { borderColor }]} />

            <View style={styles.balanceBlock}>
              <Text style={[styles.balanceLabel, { color: subtleText }]}>{isLiabilityAccount ? '负债' : '余额'}</Text>
              <View style={styles.balanceRow}>
                {(() => {
                  const rawBalance = account?.balance ?? 0;
                  const displayBalance = isLiabilityAccount ? Math.min(0, rawBalance) : Math.max(0, rawBalance);
                  const balancePrefix = displayBalance < 0 ? '-' : '';
                  return (
                <Text style={[styles.balanceText, { color: titleText }]}>
                      {`${balancePrefix}${formatMoney(displayBalance)}`}
                </Text>
                  );
                })()}
                <Pressable
                  onPress={openBalanceEditor}
                  accessibilityRole="button"
                  accessibilityLabel="编辑余额"
                  style={({ pressed }) => [pressed && { opacity: 0.75 }]}>
                  <MaterialIcons name="edit" size={16} color={subtleText} />
                </Pressable>
              </View>
            </View>

            {/* 资产：不计入「总资产」汇总；负债：不计入「总负债」汇总；首页净资产均与资产页一致 */}
            {account ? (
              <View style={[styles.optionRow, { borderTopColor: borderColor }]}>
                <View style={styles.optionTextCol}>
                  <Text style={[styles.optionTitle, { color: titleText }]}>
                    {isLiabilityAccount ? '不计入总负债' : '不计入总资产'}
                  </Text>
                  <Text style={[styles.optionHint, { color: subtleText }]}>
                    {isLiabilityAccount
                      ? '开启后，该负债不参与首页净资产与资产页「总负债」汇总'
                      : '开启后，该账户不参与首页净资产与资产页「总资产」汇总'}
                  </Text>
                </View>
                <Switch
                  value={excludeFromTotalAssets}
                  disabled={savingExcludeFromTotal}
                  onValueChange={(v) => void onToggleExcludeFromTotalAssets(v)}
                  trackColor={{ false: isDark ? '#374151' : '#e5e7eb', true: '#86efac' }}
                  thumbColor={excludeFromTotalAssets ? '#16a34a' : isDark ? '#9ca3af' : '#f4f4f5'}
                />
              </View>
            ) : null}

            <View style={styles.actionRow}>
              <Pressable
                onPress={onPressBookkeeping}
                style={({ pressed }) => [
                  styles.actionBtn,
                  { backgroundColor: surface, borderColor },
                  pressed && { opacity: 0.86 },
                ]}>
                <Text style={[styles.actionBtnText, { color: titleText }]}>记账</Text>
              </Pressable>
              <Pressable
                onPress={onPressTransfer}
                style={({ pressed }) => [
                  styles.actionBtn,
                  { backgroundColor: surface, borderColor },
                  pressed && { opacity: 0.86 },
                ]}>
                <Text style={[styles.actionBtnText, { color: titleText }]}>转账</Text>
              </Pressable>
            </View>
          </View>

          <View style={styles.detailsSection}>
            <View style={styles.detailsHeader}>
              <View style={styles.detailsTitleWrap}>
                <Text style={[styles.detailsTitle, { color: titleText }]}>账户明细</Text>
                <View style={styles.detailsUnderline} />
              </View>
            </View>

            {monthSections.map((section) => (
              <View key={section.id} style={styles.monthSection}>
                <View
                  style={[
                    styles.monthHeaderRow,
                    {
                      borderBottomColor: borderColor,
                      borderBottomWidth: section.expanded ? StyleSheet.hairlineWidth : 0,
                      paddingBottom: section.expanded ? 14 : 10,
                    },
                  ]}>
                  <View style={styles.monthHeaderTextCol}>
                    <Text style={[styles.monthTitle, { color: titleText }]}>{section.monthLabel}</Text>
                    {!isLiabilityAccount ? (
                      <Text style={[styles.monthMeta, { color: subtleText }]}>
                        流出 <Text style={styles.expenseText}>{section.expense}</Text>
                        <Text style={styles.monthDivider}> | </Text>
                        流入 <Text style={styles.incomeText}>{section.income}</Text>
                      </Text>
                    ) : null}
                  </View>
                  <MaterialIcons
                    name={section.expanded ? 'keyboard-arrow-down' : 'keyboard-arrow-right'}
                    size={22}
                    color={subtleText}
                  />
                </View>

                {section.expanded && section.details && section.details.length > 0 ? (
                  <View style={styles.dayDetailBlock}>
                    {section.details.map((day) => (
                      <View
                        key={`${section.id}-${day.dateLabel}`}
                        style={[
                          styles.dayGroupCard,
                          {
                            backgroundColor: isDark ? 'rgba(31, 41, 55, 0.55)' : '#f9fafb',
                            borderColor,
                          },
                        ]}>
                        <View
                          style={[
                            styles.dayGroupHeader,
                            { borderBottomColor: borderColor },
                          ]}>
                          <View style={[styles.dayGroupDot, { backgroundColor: isDark ? '#60a5fa' : '#3b82f6' }]} />
                          <Text style={[styles.dayTitle, { color: titleText }]}>{day.dateLabel}</Text>
                        </View>
                        {day.items.map((item, itemIndex) => {
                          const trimmed = item.amount.replace(/\s/g, '');
                          const amountColor =
                            trimmed.startsWith('+')
                              ? isDark
                                ? '#34d399'
                                : '#059669'
                              : trimmed.startsWith('-')
                                ? isDark
                                  ? '#f87171'
                                  : '#dc2626'
                                : titleText;
                          const isLast = itemIndex === day.items.length - 1;
                          return (
                            <View
                              key={item.id}
                              style={[
                                styles.detailEntry,
                                !isLast && {
                                  borderBottomWidth: StyleSheet.hairlineWidth,
                                  borderBottomColor: borderColor,
                                },
                              ]}>
                              <View style={styles.detailItemRow}>
                                <View style={styles.detailLeft}>
                                  <Text style={[styles.detailTime, { color: subtleText }]}>{item.time}</Text>
                                  <View
                                    style={[
                                      styles.tagPill,
                                      { backgroundColor: isDark ? 'rgba(250, 204, 21, 0.22)' : '#FEF08A' },
                                    ]}>
                                    <Text style={[styles.tagText, { color: titleText }]}>{item.tag}</Text>
                                    <Text style={styles.tagEmoji}>{item.emoji}</Text>
                                  </View>
                                </View>
                                <Text style={[styles.detailAmount, { color: amountColor }]}>{item.amount}</Text>
                              </View>
                              <View style={styles.sourceRow}>
                                <View
                                  style={[
                                    styles.sourceIcon,
                                    {
                                      borderColor,
                                      backgroundColor: isDark ? 'rgba(55, 65, 81, 0.6)' : '#ffffff',
                                    },
                                  ]}>
                                  <View style={styles.sourceIconLine} />
                                </View>
                                <Text style={[styles.sourceText, { color: subtleText }]}>{item.flowLabel}</Text>
                              </View>
                            </View>
                          );
                        })}
                      </View>
                    ))}
                    <View style={[styles.sectionDivider, { backgroundColor: borderColor }]} />
                  </View>
                ) : (
                  <View style={[styles.sectionDivider, { backgroundColor: borderColor }]} />
                )}
              </View>
            ))}
          </View>
        </ScrollView>
      </View>

      <Modal transparent animationType="fade" visible={balanceModalOpen} onRequestClose={() => !savingBalance && setBalanceModalOpen(false)}>
        <View style={styles.balanceModalRoot}>
          <Pressable style={styles.balanceModalBackdrop} onPress={() => !savingBalance && setBalanceModalOpen(false)} />
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.balanceModalCenter}
            pointerEvents="box-none">
            <View style={[styles.balanceModalCard, { backgroundColor: cardBg, borderColor }]}>
            <Text style={[styles.balanceModalTitle, { color: titleText }]}>调整{isLiabilityAccount ? '负债' : '余额'}</Text>
            <Text style={[styles.balanceModalHint, { color: subtleText }]}>
              {isLiabilityAccount
                ? '请输入负债金额（正数表示欠款规模）。保存后将记一笔「余额校正」流水。'
                : '保存后将记一笔「余额校正」流水，与当前流水汇总对齐。'}
            </Text>
            <View style={[styles.balanceModalInputRow, { borderColor }]}>
              <Text style={[styles.balanceModalCurrency, { color: titleText }]}>¥</Text>
              <TextInput
                value={balanceDraft}
                onChangeText={handleBalanceDraftChange}
                placeholder="0.00"
                placeholderTextColor={subtleText}
                keyboardType="decimal-pad"
                editable={!savingBalance}
                style={[styles.balanceModalInput, { color: titleText }]}
              />
            </View>
            <View style={styles.balanceModalActions}>
              <Pressable
                onPress={() => !savingBalance && setBalanceModalOpen(false)}
                style={({ pressed }) => [styles.balanceModalBtn, { borderColor }, pressed && { opacity: 0.85 }]}>
                <Text style={[styles.balanceModalBtnText, { color: titleText }]}>取消</Text>
              </Pressable>
              <Pressable
                onPress={() => void onConfirmBalanceEdit()}
                disabled={savingBalance}
                style={({ pressed }) => [
                  styles.balanceModalBtn,
                  styles.balanceModalBtnPrimary,
                  { backgroundColor: isDark ? '#2563eb' : '#1d4ed8', opacity: savingBalance ? 0.55 : pressed ? 0.9 : 1 },
                ]}>
                <Text style={styles.balanceModalBtnPrimaryText}>{savingBalance ? '保存中…' : '保存'}</Text>
              </Pressable>
            </View>
          </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  mobileContainer: {
    flex: 1,
    maxWidth: 430,
    width: '100%',
    alignSelf: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingBottom: 10,
    borderBottomWidth: 1,
  },
  headerIconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerRightPlaceholder: {
    width: 36,
    height: 36,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '800',
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  accountCard: {
    borderRadius: 18,
    padding: 18,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 1,
  },
  accountTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  accountMetaPressable: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minWidth: 0,
    borderRadius: 14,
    paddingVertical: 4,
    paddingRight: 2,
    marginHorizontal: -4,
    marginTop: -4,
  },
  accountTitleCol: {
    flex: 1,
    minWidth: 0,
  },
  accountMetaChevron: {
    flexShrink: 0,
    opacity: 0.65,
  },
  avatarOuter: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInner: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#A8E6CF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarEmoji: {
    fontSize: 16,
  },
  avatarBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#facc15',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#ffffff',
  },
  avatarBadgeDot: {
    fontSize: 8,
    lineHeight: 8,
    color: '#111827',
    marginTop: -1,
  },
  accountName: {
    fontSize: 17,
    fontWeight: '800',
  },
  accountDesc: {
    fontSize: 13,
    marginTop: 2,
  },
  dashedDivider: {
    borderTopWidth: 1,
    borderStyle: 'dashed',
    marginVertical: 16,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingTop: 14,
    marginTop: 4,
    marginBottom: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  optionTextCol: {
    flex: 1,
    minWidth: 0,
  },
  optionTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  optionHint: {
    fontSize: 12,
    marginTop: 4,
    lineHeight: 17,
  },
  balanceBlock: {
    marginBottom: 16,
  },
  balanceLabel: {
    fontSize: 13,
    marginBottom: 4,
  },
  balanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  balanceText: {
    fontSize: 28,
    fontWeight: '800',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  actionBtn: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
  },
  actionBtnText: {
    fontSize: 15,
    fontWeight: '600',
  },
  detailsSection: {
    marginTop: 28,
  },
  detailsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  detailsTitleWrap: {
    position: 'relative',
  },
  detailsTitle: {
    fontSize: 19,
    fontWeight: '900',
    zIndex: 2,
  },
  detailsUnderline: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 1,
    height: 6,
    borderRadius: 4,
    backgroundColor: '#FDE047',
    zIndex: 1,
    opacity: 0.85,
  },
  monthSection: {
    marginBottom: 22,
  },
  monthHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 12,
    paddingBottom: 10,
  },
  monthHeaderTextCol: {
    flex: 1,
    minWidth: 0,
    marginRight: 8,
  },
  monthTitle: {
    fontSize: 17,
    fontWeight: '800',
    marginBottom: 6,
  },
  monthMeta: {
    fontSize: 12,
  },
  expenseText: {
    color: '#3b82f6',
  },
  incomeText: {
    color: '#f59e0b',
  },
  monthDivider: {
    color: '#d1d5db',
  },
  dayDetailBlock: {
    marginTop: 4,
    gap: 14,
  },
  dayGroupCard: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 4,
  },
  dayGroupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  dayGroupDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  dayTitle: {
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.2,
    flex: 1,
  },
  detailEntry: {
    paddingVertical: 14,
  },
  detailItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  detailLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  detailTime: {
    fontSize: 14,
    width: 40,
  },
  tagPill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 999,
    paddingLeft: 12,
    paddingRight: 10,
    paddingVertical: 6,
    gap: 4,
    maxWidth: '68%',
  },
  tagText: {
    fontSize: 13,
    fontWeight: '600',
    flexShrink: 1,
  },
  tagEmoji: {
    fontSize: 16,
  },
  detailAmount: {
    fontSize: 17,
    fontWeight: '800',
    textAlign: 'right',
    flexShrink: 0,
    marginLeft: 8,
  },
  sourceRow: {
    marginTop: 10,
    marginLeft: 50,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sourceIcon: {
    width: 14,
    height: 14,
    borderRadius: 4,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f9fafb',
  },
  sourceIconLine: {
    width: 7,
    height: 1.5,
    backgroundColor: '#9ca3af',
  },
  sourceText: {
    fontSize: 12,
    lineHeight: 16,
  },
  sectionDivider: {
    height: 1,
    marginTop: 20,
  },
  balanceModalRoot: {
    flex: 1,
  },
  balanceModalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  balanceModalCenter: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 22,
  },
  balanceModalCard: {
    borderRadius: 16,
    padding: 20,
    borderWidth: StyleSheet.hairlineWidth,
  },
  balanceModalTitle: {
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 8,
  },
  balanceModalHint: {
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 16,
  },
  balanceModalInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 4,
    marginBottom: 18,
  },
  balanceModalCurrency: {
    fontSize: 20,
    fontWeight: '800',
    marginRight: 4,
  },
  balanceModalInput: {
    flex: 1,
    fontSize: 22,
    fontWeight: '800',
    paddingVertical: 10,
  },
  balanceModalActions: {
    flexDirection: 'row',
    gap: 10,
  },
  balanceModalBtn: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  balanceModalBtnText: {
    fontSize: 15,
    fontWeight: '700',
  },
  balanceModalBtnPrimary: {
    borderWidth: 0,
  },
  balanceModalBtnPrimaryText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#ffffff',
  },
});
