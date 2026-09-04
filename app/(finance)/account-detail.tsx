import { AppButton, AppCard, AppIconButton, AppInput, ScreenHeader } from '@/components/ui';
import { Layout, Radius, Spacing, Typography } from '@/constants/design-tokens';
import { useAppTheme } from '@/hooks/use-app-theme';
import { FINANCE_ACCOUNT_ICON_OPTIONS } from '@/lib/constants/finance-account-icons';
import { clearFinanceLastUsedAccountIfDeleted } from '@/lib/finance-last-used-account';
import { openFinanceSheet, subscribeFinanceSheetSaved } from '@/lib/finance-sheet-controller';
import {
  applyFinanceAccountBalanceCorrection,
  computeTransactionLedgerEffect,
  deleteFinanceAccount,
  financeBalanceInputTextFromLedger,
  financeTargetLedgerFromUserBalanceInput,
  updateFinanceAccount,
} from '@/lib/repositories/finance/finance';
import { fetchFinanceAccountDetail } from '@/lib/finance-page-api';
import {
  isFinanceAccountExcludedFromAggregates,
  mergeFinanceAccountExcludeFromTotalAssets,
} from '@/lib/repositories/finance/finance-account-extra';
import type { FinanceAccountBalanceRow, FinanceTransactionRow } from '@/lib/repositories/finance/finance.types';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from "expo-router/react-navigation";
import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { usePageApiSync, usePagePullRefresh } from '@/hooks/use-page-api-sync';
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

function SectionHeading({ title }: { title: string }) {
  const { colors } = useAppTheme();
  return <Text style={[styles.sectionTitle, { color: colors.text }]}>{title}</Text>;
}

const PAGE_API_KEY = 'account-detail';

export default function AccountDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ accountId?: string; accountName?: string; accountNo?: string }>();
  const insets = useSafeAreaInsets();
  const { colors, isDark, shadows } = useAppTheme();
  const { wrapLoad } = usePageApiSync(PAGE_API_KEY);
  /** 与 `finance-stats`、财务首页收支语义一致 */
  const expenseColor = colors.primary;
  const incomeColor = colors.tertiary;

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

  const detailName = account?.name ?? (routeAccountName || '账户');
  const accountNo = account?.account_no?.trim() ?? '';
  const accountNote = account?.note?.trim() ?? '';
  const detailSubtitle = accountNo || (accountNote ? '' : isLiabilityAccount ? '负债明细' : '账户余额');

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

  /** 与账本余额汇总 `computeTransactionLedgerEffect` 一致，负债初始余额等流水不再被错误翻成正数 */
  const getDisplayAmount = React.useCallback(
    (tx: FinanceTransactionRow) =>
      computeTransactionLedgerEffect(tx.transaction_type, tx.amount, tx.extra_data),
    [],
  );

  const formatMoney = React.useCallback((amount: number) => {
    return `¥${Math.abs(amount).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }, []);

  const loadAccountDetailSeqRef = React.useRef(0);

  const loadAccountDetail = React.useCallback(async (forceRefresh = false) => {
    const seq = ++loadAccountDetailSeqRef.current;
    try {
      const { account: target, transactions: txRows } = await fetchFinanceAccountDetail({
        accountId: routeAccountId,
        accountName: routeAccountName,
        offlineFallback: true,
      });
      if (seq !== loadAccountDetailSeqRef.current) return;
      setAccount(target);
      setTransactions(target ? txRows : []);
    } catch (error) {
      if (seq !== loadAccountDetailSeqRef.current) return;
      console.warn('Failed to load account detail:', error);
      setAccount(null);
      setTransactions([]);
    }
  }, [routeAccountId, routeAccountName]);

  const reloadAccountDetail = React.useCallback(
    async (forceApi = false) => {
      await wrapLoad(async () => {
        await loadAccountDetail(forceApi);
      }, forceApi);
    },
    [loadAccountDetail, wrapLoad],
  );

  const { refreshControl } = usePagePullRefresh(PAGE_API_KEY, reloadAccountDetail);

  useFocusEffect(
    React.useCallback(() => {
      void reloadAccountDetail();
    }, [reloadAccountDetail]),
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
        await reloadAccountDetail();
      } catch (error) {
        console.warn('Failed to update exclude_from_total_assets:', error);
        Alert.alert('保存失败', '请稍后重试。');
      } finally {
        setSavingExcludeFromTotal(false);
      }
    },
    [account?.extra_data, account?.id, reloadAccountDetail, routeAccountId, savingExcludeFromTotal],
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
      await reloadAccountDetail();
    } catch (e) {
      Alert.alert('保存失败', e instanceof Error && e.message.trim() ? e.message : '请稍后重试。');
    } finally {
      setSavingBalance(false);
    }
  }, [account, balanceDraft, reloadAccountDetail, savingBalance]);

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
    openFinanceSheet({ kind: 'manual', tab: 'sentence', accountId: resolvedAccountId });
  }, [resolvedAccountId]);

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
    openFinanceSheet({ kind: 'transfer', fromAccountId: resolvedAccountId });
  }, [accountSignRule, isLiabilityAccount, resolvedAccountId]);

  useFocusEffect(
    React.useCallback(() => {
      return subscribeFinanceSheetSaved(() => {
        void reloadAccountDetail();
      });
    }, [reloadAccountDetail]),
  );

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
            await clearFinanceLastUsedAccountIfDeleted(targetId);
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

  const [expandedMonthIds, setExpandedMonthIds] = React.useState<Set<string>>(() => new Set());

  const toggleMonthExpanded = React.useCallback((monthId: string) => {
    setExpandedMonthIds((prev) => {
      const next = new Set(prev);
      if (next.has(monthId)) next.delete(monthId);
      else next.add(monthId);
      return next;
    });
  }, []);

  const monthSections = React.useMemo<MonthSection[]>(() => {
    if (transactions.length === 0) return [];
    const uniqueTransactions: FinanceTransactionRow[] = [];
    const seenTxIds = new Set<string>();
    for (const tx of transactions) {
      if (seenTxIds.has(tx.id)) continue;
      seenTxIds.add(tx.id);
      uniqueTransactions.push(tx);
    }
    const monthMap = new Map<string, FinanceTransactionRow[]>();
    for (const tx of uniqueTransactions) {
      const monthKey = tx.happened_at.slice(0, 7);
      const rows = monthMap.get(monthKey);
      if (rows) rows.push(tx);
      else monthMap.set(monthKey, [tx]);
    }

    const sortedMonthKeys = Array.from(monthMap.keys()).sort((a, b) => b.localeCompare(a));

    return sortedMonthKeys.map((monthKey, monthIndex) => {
      const rows = monthMap.get(monthKey)!;
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

      const details = Array.from(dayMap.entries())
        .sort(([a], [b]) => b.localeCompare(a))
        .map(([dayKey, dayRows]) => {
        const dt = new Date(dayKey);
        const dateLabel = Number.isNaN(dt.getTime())
          ? dayKey
          : `${dt.getMonth() + 1}月${dt.getDate()}日 (${WEEKDAY_LABELS[dt.getDay()]})`;
        const seenItemIds = new Set<string>();
        const items: DetailItem[] = [];
        for (const tx of dayRows) {
          if (seenItemIds.has(tx.id)) continue;
          seenItemIds.add(tx.id);
          const happenedDate = new Date(tx.happened_at);
          const hour = Number.isNaN(happenedDate.getTime()) ? '00' : String(happenedDate.getHours()).padStart(2, '0');
          const minute = Number.isNaN(happenedDate.getTime()) ? '00' : String(happenedDate.getMinutes()).padStart(2, '0');
          const displayAmount = getDisplayAmount(tx);
          const isIncome = displayAmount > 0;
          const isExpense = displayAmount < 0;
          items.push({
            id: tx.id,
            time: `${hour}:${minute}`,
            tag: tx.name?.trim() || '交易',
            emoji: isIncome ? '📈' : isExpense ? '💸' : '💳',
            amount: `${isIncome ? '+' : isExpense ? '-' : ''} ${formatMoney(displayAmount)}`,
            flowLabel: tx.transaction_type === 'transfer' ? '转账' : isIncome ? '收入' : '支出',
          });
        }
        return { dateLabel, items };
      });

      return {
        id: monthKey,
        monthLabel: `${year}年${Number(month)}月`,
        expense: formatMoney(expenseTotal),
        income: formatMoney(incomeTotal),
        expanded: expandedMonthIds.size === 0 ? monthIndex === 0 : expandedMonthIds.has(monthKey),
        details,
      };
    });
  }, [expandedMonthIds, formatMoney, getDisplayAmount, transactions]);

  React.useEffect(() => {
    setExpandedMonthIds(new Set());
  }, [routeAccountId, routeAccountName]);

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]} edges={['left', 'right']}>
      <ScreenHeader
        title="账户详情"
        onBack={() => router.back()}
        right={
          <AppIconButton
            icon="delete-outline"
            onPress={onDeleteAccount}
            disabled={deleting}
            color={colors.danger}
            accessibilityLabel="删除账户"
          />
        }
      />

      <ScrollView
        refreshControl={refreshControl}
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingBottom: Spacing['6xl'] + Math.max(insets.bottom, Spacing.md),
            maxWidth: Layout.contentMaxWidth,
            alignSelf: 'center',
            width: '100%',
          },
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled">
        <AppCard padded style={shadows.card}>
          <Pressable
            onPress={onPressEditAccountMeta}
            disabled={!resolvedAccountId}
            accessibilityRole="button"
            accessibilityLabel="编辑账户名称、卡号、备注与图标"
            style={({ pressed }) => [
              styles.accountMetaPressable,
              !resolvedAccountId && { opacity: 0.5 },
              pressed && resolvedAccountId && { opacity: 0.82 },
            ]}>
            <View style={[styles.avatarOuter, { backgroundColor: colors.surface }]}>
              <View style={[styles.avatarInner, { backgroundColor: colors.primaryMuted }]}>
                <MaterialIcons name={accountIcon(account)} size={20} color={colors.primary} />
                <View style={[styles.avatarBadge, { borderColor: colors.surface, backgroundColor: colors.accentIcon }]}>
                  <Text style={[styles.avatarBadgeDot, { color: colors.text }]}>.</Text>
                </View>
              </View>
            </View>
            <View style={styles.accountTitleCol}>
              <Text style={[Typography.title, { color: colors.text }]}>{detailName}</Text>
              {detailSubtitle ? (
                <Text style={[Typography.caption, styles.accountDesc, { color: colors.textSecondary }]}>
                  {detailSubtitle}
                </Text>
              ) : null}
            </View>
            <MaterialIcons name="chevron-right" size={22} color={colors.textMuted} style={styles.accountMetaChevron} />
          </Pressable>

          {accountNote ? (
            <View
              style={[
                styles.accountNoteBlock,
                {
                  backgroundColor: isDark ? colors.surfaceMuted : colors.input,
                  borderColor: colors.outline,
                },
              ]}>
              <Text style={[Typography.kicker, styles.accountNoteLabel, { color: colors.textSecondary }]}>备注</Text>
              <Text style={[Typography.body, styles.accountNoteText, { color: colors.text }]}>{accountNote}</Text>
            </View>
          ) : null}

          <View style={[styles.dashedDivider, { borderColor: colors.outline }]} />

          <View style={styles.balanceBlock}>
            <Text style={[Typography.caption, { color: colors.textSecondary }]}>
              {isLiabilityAccount ? '负债' : '余额'}
            </Text>
            <View style={styles.balanceRow}>
              {(() => {
                const rawBalance = account?.balance ?? 0;
                const displayBalance = isLiabilityAccount ? Math.min(0, rawBalance) : Math.max(0, rawBalance);
                const balancePrefix = displayBalance < 0 ? '-' : '';
                return (
                  <Text style={[Typography.display, styles.balanceAmount, { color: colors.text }]}>
                    {`${balancePrefix}${formatMoney(displayBalance)}`}
                  </Text>
                );
              })()}
              <AppIconButton
                icon="edit"
                size={16}
                color={colors.textSecondary}
                onPress={openBalanceEditor}
                accessibilityLabel="编辑余额"
                style={styles.balanceEditBtn}
              />
            </View>
          </View>

          {/* 资产：不计入「总资产」汇总；负债：同样是不计入「总资产」汇总；首页净资产均与资产页一致 */}
          {account ? (
            <View style={[styles.optionRow, { borderTopColor: colors.outline }]}>
              <View style={styles.optionTextCol}>
                <Text style={[Typography.bodyStrong, { color: colors.text }]}> 
                  不计入总资产
                </Text>
                <Text style={[Typography.caption, styles.optionHint, { color: colors.textSecondary }]}> 
                  {isLiabilityAccount
                    ? '开启后，该负债不参与首页净资产与资产页「总资产」汇总'
                    : '开启后，该账户不参与首页净资产与资产页「总资产」汇总'}
                </Text>
              </View>
              <Switch
                value={excludeFromTotalAssets}
                disabled={savingExcludeFromTotal}
                onValueChange={(v) => void onToggleExcludeFromTotalAssets(v)}
                trackColor={{ false: isDark ? colors.surfaceMuted : colors.outlineStrong, true: colors.successSwitch }}
                thumbColor={excludeFromTotalAssets ? colors.success : isDark ? colors.textMuted : colors.surface}
              />
            </View>
          ) : null}

          <View style={styles.actionRow}>
            <AppButton label="记账" variant="secondary" size="md" onPress={onPressBookkeeping} style={styles.actionBtn} />
            <AppButton label="转账" variant="secondary" size="md" onPress={onPressTransfer} style={styles.actionBtn} />
          </View>
        </AppCard>

        <View style={styles.detailsSection}>
          <SectionHeading title="账户明细" />

          {monthSections.map((section) => (
            <View key={section.id} style={styles.monthSection}>
              <Pressable
                onPress={() => toggleMonthExpanded(section.id)}
                accessibilityRole="button"
                accessibilityState={{ expanded: section.expanded }}
                accessibilityLabel={`${section.monthLabel}，${section.expanded ? '收起' : '展开'}明细`}
                style={({ pressed }) => [
                  styles.monthHeaderRow,
                  {
                    borderBottomColor: colors.outline,
                    borderBottomWidth: section.expanded ? StyleSheet.hairlineWidth : 0,
                    paddingBottom: section.expanded ? Spacing['2xl'] : Spacing.lg,
                    opacity: pressed ? 0.82 : 1,
                  },
                ]}>
                <View style={styles.monthHeaderTextCol}>
                  <Text style={[Typography.title, { color: colors.text }]}>{section.monthLabel}</Text>
                  {!isLiabilityAccount ? (
                    <Text style={[Typography.caption, { color: colors.textSecondary }]}>
                      流出 <Text style={{ color: expenseColor }}>{section.expense}</Text>
                      <Text style={{ color: colors.textMuted }}> | </Text>
                      流入 <Text style={{ color: incomeColor }}>{section.income}</Text>
                    </Text>
                  ) : null}
                </View>
                <MaterialIcons
                  name={section.expanded ? 'keyboard-arrow-down' : 'keyboard-arrow-right'}
                  size={22}
                  color={colors.textMuted}
                />
              </Pressable>

              {section.expanded && section.details && section.details.length > 0 ? (
                <View style={styles.dayDetailBlock}>
                  {section.details.map((day) => (
                    <View
                      key={`${section.id}-${day.dateLabel}`}
                      style={[
                        styles.dayGroupCard,
                        {
                          backgroundColor: isDark ? colors.surfaceMuted : colors.surfaceSubtle,
                          borderColor: colors.outline,
                        },
                      ]}>
                      <View style={[styles.dayGroupHeader, { borderBottomColor: colors.outline }]}>
                        <View style={[styles.dayGroupDot, { backgroundColor: colors.primary }]} />
                        <Text style={[Typography.bodyStrong, { color: colors.text }]}>{day.dateLabel}</Text>
                      </View>
                      {day.items.map((item, itemIndex) => {
                        const trimmed = item.amount.replace(/\s/g, '');
                        const amountColor =
                          trimmed.startsWith('+')
                            ? colors.secondary
                            : trimmed.startsWith('-')
                              ? colors.danger
                              : colors.text;
                        const isLast = itemIndex === day.items.length - 1;
                        return (
                          <View
                            key={item.id}
                            style={[
                              styles.detailEntry,
                              !isLast && {
                                borderBottomWidth: StyleSheet.hairlineWidth,
                                borderBottomColor: colors.outline,
                              },
                            ]}>
                            <View style={styles.detailItemRow}>
                              <View style={styles.detailLeft}>
                                <Text
                                  style={[Typography.caption, styles.detailTime, { color: colors.textSecondary }]}
                                  numberOfLines={1}>
                                  {item.time}
                                </Text>
                                <View
                                  style={[
                                    styles.tagPill,
                                    {
                                      backgroundColor: isDark ? colors.primaryMuted : colors.capsule,
                                      borderColor: colors.outline,
                                    },
                                  ]}>
                                  <Text style={[Typography.bodyStrong, styles.tagText, { color: colors.text }]}>
                                    {item.tag}
                                  </Text>
                                  <Text style={styles.tagEmoji}>{item.emoji}</Text>
                                </View>
                              </View>
                              <Text style={[Typography.title, styles.detailAmount, { color: amountColor }]}>
                                {item.amount}
                              </Text>
                            </View>
                            <View style={styles.sourceRow}>
                              <View
                                style={[
                                  styles.sourceIcon,
                                  {
                                    borderColor: colors.outline,
                                    backgroundColor: isDark ? colors.surfaceMuted : colors.surface,
                                  },
                                ]}>
                                <View style={[styles.sourceIconLine, { backgroundColor: colors.textMuted }]} />
                              </View>
                              <Text style={[Typography.caption, { color: colors.textSecondary }]}>{item.flowLabel}</Text>
                            </View>
                          </View>
                        );
                      })}
                    </View>
                  ))}
                  <View style={[styles.sectionDivider, { backgroundColor: colors.outline }]} />
                </View>
              ) : (
                <View style={[styles.sectionDivider, { backgroundColor: colors.outline }]} />
              )}
            </View>
          ))}
        </View>
      </ScrollView>

      <Modal
        transparent
        animationType="fade"
        visible={balanceModalOpen}
        onRequestClose={() => !savingBalance && setBalanceModalOpen(false)}>
        <View style={styles.balanceModalRoot}>
          <Pressable
            style={[styles.balanceModalBackdrop, { backgroundColor: colors.overlay }]}
            onPress={() => !savingBalance && setBalanceModalOpen(false)}
          />
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.balanceModalCenter}
            pointerEvents="box-none">
            <AppCard padded style={shadows.sheet}>
              <Text style={[Typography.h3, { color: colors.text }]}>
                调整{isLiabilityAccount ? '负债' : '余额'}
              </Text>
              <Text style={[Typography.caption, styles.balanceModalHint, { color: colors.textSecondary }]}>
                {isLiabilityAccount
                  ? '请输入负债金额（正数表示欠款规模）。保存后将记一笔「余额校正」流水。'
                  : '保存后将记一笔「余额校正」流水，与当前流水汇总对齐。'}
              </Text>
              <View style={[styles.balanceModalInputRow, { borderColor: colors.outline, backgroundColor: colors.input }]}>
                <Text style={[Typography.h2, { color: colors.text }]}>¥</Text>
                <AppInput
                  value={balanceDraft}
                  onChangeText={handleBalanceDraftChange}
                  placeholder="0.00"
                  keyboardType="decimal-pad"
                  editable={!savingBalance}
                  inputStyle={[Typography.h2, styles.balanceModalInputText]}
                  inputWrapStyle={[styles.balanceModalInputWrap, { flex: 1, borderWidth: 0, backgroundColor: 'transparent', paddingHorizontal: 0 }]}
                  containerStyle={styles.balanceModalInputContainerInline}
                />
              </View>
              <View style={styles.balanceModalActions}>
                <AppButton
                  label="取消"
                  variant="outline"
                  size="md"
                  onPress={() => !savingBalance && setBalanceModalOpen(false)}
                  disabled={savingBalance}
                  style={styles.balanceModalBtn}
                />
                <AppButton
                  label={savingBalance ? '保存中…' : '保存'}
                  variant="primary"
                  size="md"
                  loading={savingBalance}
                  onPress={() => void onConfirmBalanceEdit()}
                  style={styles.balanceModalBtn}
                />
              </View>
            </AppCard>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: Spacing['5xl'],
    paddingTop: Spacing['3xl'],
    gap: Spacing['4xl'],
  },
  accountMetaPressable: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xl,
    minWidth: 0,
    borderRadius: Radius.lg,
    paddingVertical: Spacing.xs,
    marginTop: -Spacing.xs,
  },
  accountTitleCol: {
    flex: 1,
    minWidth: 0,
  },
  accountDesc: {
    marginTop: Spacing.xs,
  },
  accountNoteBlock: {
    marginTop: Spacing.xl,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.lg,
    gap: Spacing.sm,
  },
  accountNoteLabel: {
    letterSpacing: 0.4,
  },
  accountNoteText: {
    lineHeight: 22,
  },
  accountMetaChevron: {
    flexShrink: 0,
    opacity: 0.65,
  },
  avatarOuter: {
    width: 40,
    height: 40,
    borderRadius: Radius.icon,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInner: {
    width: 32,
    height: 32,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 14,
    height: 14,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
  },
  avatarBadgeDot: {
    fontSize: 8,
    lineHeight: 8,
    marginTop: -1,
  },
  dashedDivider: {
    borderTopWidth: 1,
    borderStyle: 'dashed',
    marginVertical: Spacing['3xl'],
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.xl,
    paddingTop: Spacing['2xl'],
    marginTop: Spacing.xs,
    marginBottom: Spacing.xl,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  optionTextCol: {
    flex: 1,
    minWidth: 0,
  },
  optionHint: {
    marginTop: Spacing.xs,
    lineHeight: 17,
  },
  balanceBlock: {
    marginBottom: Spacing['3xl'],
    gap: Spacing.xs,
  },
  balanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  balanceAmount: {
    fontSize: 32,
    lineHeight: 36,
  },
  balanceEditBtn: {
    width: 32,
    height: 32,
  },
  actionRow: {
    flexDirection: 'row',
    gap: Spacing.lg,
  },
  actionBtn: {
    flex: 1,
  },
  detailsSection: {
    gap: Spacing['2xl'],
  },
  sectionTitle: {
    ...Typography.h2,
    fontSize: 18,
    marginBottom: Spacing['2xl'],
  },
  monthSection: {
    marginBottom: Spacing['3xl'],
  },
  monthHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: Spacing.xl,
  },
  monthHeaderTextCol: {
    flex: 1,
    minWidth: 0,
    marginRight: Spacing.md,
    gap: Spacing.sm,
  },
  dayDetailBlock: {
    marginTop: Spacing.xs,
    gap: Spacing['2xl'],
  },
  dayGroupCard: {
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing['2xl'],
    paddingTop: Spacing.xl,
    paddingBottom: Spacing.xs,
  },
  dayGroupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginBottom: Spacing.xl,
    paddingBottom: Spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  dayGroupDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  detailEntry: {
    paddingVertical: Spacing['2xl'],
  },
  detailItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.xl,
  },
  detailLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.lg,
    flex: 1,
    minWidth: 0,
  },
  detailTime: {
    width: 44,
    flexShrink: 0,
    textAlign: 'left',
    fontVariant: ['tabular-nums'],
  },
  tagPill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    paddingLeft: Spacing.xl,
    paddingRight: Spacing.lg,
    paddingVertical: Spacing.sm,
    gap: Spacing.xs,
    maxWidth: '68%',
  },
  tagText: {
    flexShrink: 1,
    fontSize: 13,
  },
  tagEmoji: {
    fontSize: 16,
  },
  detailAmount: {
    textAlign: 'right',
    flexShrink: 0,
    marginLeft: Spacing.md,
    fontSize: 17,
  },
  sourceRow: {
    marginTop: Spacing.lg,
    marginLeft: 44 + Spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  sourceIcon: {
    width: 14,
    height: 14,
    borderRadius: Radius.xs / 2,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sourceIconLine: {
    width: 7,
    height: 1.5,
  },
  sectionDivider: {
    height: StyleSheet.hairlineWidth,
    marginTop: Spacing['3xl'],
  },
  balanceModalRoot: {
    flex: 1,
  },
  balanceModalBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  balanceModalCenter: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: Spacing['5xl'],
  },
  balanceModalHint: {
    marginTop: Spacing.md,
    marginBottom: Spacing['3xl'],
    lineHeight: 19,
  },
  balanceModalInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.xl,
    marginBottom: Spacing['3xl'],
  },
  balanceModalInputContainerInline: {
    flex: 1,
    marginBottom: 0,
  },
  balanceModalInputWrap: {
    minHeight: 48,
  },
  balanceModalInputText: {
    fontSize: 22,
    fontWeight: '800',
  },
  balanceModalActions: {
    flexDirection: 'row',
    gap: Spacing.lg,
  },
  balanceModalBtn: {
    flex: 1,
  },
});
