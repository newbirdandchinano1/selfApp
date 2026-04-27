import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { getFinanceAccountsWithBalance, getFinanceTransactionsByAccountId } from '@/lib/repositories/finance/finance';
import type { FinanceAccountBalanceRow, FinanceTransactionRow } from '@/lib/repositories/finance/finance.types';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
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
          <View style={styles.headerRightPlaceholder} />
        </View>

        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: 32 + Math.max(insets.bottom, 8) }]}
          showsVerticalScrollIndicator={false}>
          <View style={[styles.accountCard, { backgroundColor: cardBg }]}>
            <View style={styles.accountTopRow}>
              <View style={styles.accountMetaRow}>
                <View style={styles.avatarOuter}>
                  <View style={styles.avatarInner}>
                    <Text style={styles.avatarEmoji}>💬</Text>
                    <View style={styles.avatarBadge}>
                      <Text style={styles.avatarBadgeDot}>.</Text>
                    </View>
                  </View>
                </View>
                <View>
                  <Text style={[styles.accountName, { color: titleText }]}>{detailName}</Text>
                  <Text style={[styles.accountDesc, { color: subtleText }]}>{detailDesc}</Text>
                </View>
              </View>
            </View>

            <View style={[styles.dashedDivider, { borderColor }]} />

            <View style={styles.balanceBlock}>
              <Text style={[styles.balanceLabel, { color: subtleText }]}>{isLiabilityAccount ? '负债' : '余额'}</Text>
              <View style={styles.balanceRow}>
                {(() => {
                  const rawBalance = account?.balance ?? 0;
                  const normalizedBalance = isLiabilityAccount ? -Math.abs(rawBalance) : rawBalance;
                  const balancePrefix = normalizedBalance < 0 ? '-' : '';
                  return (
                <Text style={[styles.balanceText, { color: titleText }]}>
                      {`${balancePrefix}${formatMoney(normalizedBalance)}`}
                </Text>
                  );
                })()}
                <Pressable style={({ pressed }) => [pressed && { opacity: 0.75 }]}>
                  <MaterialIcons name="edit" size={16} color={subtleText} />
                </Pressable>
              </View>
            </View>

            <View style={styles.actionRow}>
              <Pressable
                style={({ pressed }) => [
                  styles.actionBtn,
                  { backgroundColor: surface, borderColor },
                  pressed && { opacity: 0.86 },
                ]}>
                <Text style={[styles.actionBtnText, { color: titleText }]}>记账</Text>
              </Pressable>
              <Pressable
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
                <View style={styles.monthHeaderRow}>
                  <View>
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
                    color="#c4c7d0"
                  />
                </View>

                {section.expanded && section.details && section.details.length > 0 ? (
                  <View style={styles.dayDetailBlock}>
                    {section.details.map((day) => (
                      <View key={`${section.id}-${day.dateLabel}`}>
                        <Text style={[styles.dayTitle, { color: subtleText }]}>{day.dateLabel}</Text>
                        {day.items.map((item) => (
                          <View key={item.id}>
                            <View style={styles.detailItemRow}>
                              <View style={styles.detailLeft}>
                                <Text style={[styles.detailTime, { color: titleText }]}>{item.time}</Text>
                                <View style={styles.tagPill}>
                                  <Text style={styles.tagText}>{item.tag}</Text>
                                  <Text style={styles.tagEmoji}>{item.emoji}</Text>
                                </View>
                              </View>
                              <Text style={[styles.detailAmount, { color: titleText }]}>{item.amount}</Text>
                            </View>
                            <View style={styles.sourceRow}>
                              <View style={[styles.sourceIcon, { borderColor }]}>
                                <View style={styles.sourceIconLine} />
                              </View>
                              <Text style={[styles.sourceText, { color: '#9ca3af' }]}>{item.flowLabel}</Text>
                            </View>
                          </View>
                        ))}
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
  accountMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
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
    marginBottom: 20,
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
    marginBottom: 6,
  },
  monthHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
  },
  monthTitle: {
    fontSize: 17,
    fontWeight: '800',
    marginBottom: 2,
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
    marginTop: 10,
  },
  dayTitle: {
    fontSize: 13,
    marginBottom: 10,
  },
  detailItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
    backgroundColor: '#FEF08A',
    borderRadius: 999,
    paddingLeft: 12,
    paddingRight: 10,
    paddingVertical: 4,
    gap: 4,
  },
  tagText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#111827',
  },
  tagEmoji: {
    fontSize: 16,
  },
  detailAmount: {
    fontSize: 18,
    fontWeight: '800',
  },
  sourceRow: {
    marginTop: 6,
    marginLeft: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
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
  },
  sectionDivider: {
    height: 1,
    marginTop: 16,
  },
});
