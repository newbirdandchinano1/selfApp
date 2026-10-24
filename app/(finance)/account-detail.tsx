import { AppInput } from '@/components/ui';
import {
  FoldCountUpText,
  FoldPopIn,
  FoldRiseIn,
  FOLD_MOTION_SPRING,
  useFoldMotionGate,
} from '@/components/review/fold-motion';
import { Layout, Spacing } from '@/constants/design-tokens';
import { useFinanceFoldTheme } from '@/constants/finance-fold-theme';
import { toast, toUserMessage } from '@/lib/app-feedback';
import { FINANCE_ACCOUNT_ICON_OPTIONS } from '@/lib/constants/finance-account-icons';
import { clearFinanceLastUsedAccountIfDeleted } from '@/lib/finance-last-used-account';
import { openFinanceSheet, subscribeFinanceSheetSaved } from '@/lib/finance-transaction-sheet/controller';
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
import { useFocusEffect } from 'expo-router/react-navigation';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { usePageApiSync, usePagePullRefresh } from '@/hooks/use-page-api-sync';
import {
  ActivityIndicator,
  Alert,
  Animated,
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
  amount: number;
  flowLabel: string;
  dayLabel: string;
};

type MonthSection = {
  id: string;
  monthLabel: string;
  count: number;
  net: number;
  expanded: boolean;
  items: DetailItem[];
};

const PAGE_API_KEY = 'account-detail';

function formatMoney(amount: number) {
  return `¥${Math.abs(amount).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatSignedMoney(amount: number) {
  if (!Number.isFinite(amount) || Math.abs(amount) < 0.005) return '¥0.00';
  const sign = amount > 0 ? '+' : '−';
  return `${sign}${formatMoney(amount)}`;
}

function ledgerInitial(name: string) {
  const t = name.trim();
  if (!t) return '记';
  return t.slice(0, 1);
}

export default function AccountDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ accountId?: string; accountName?: string; accountNo?: string }>();
  const insets = useSafeAreaInsets();
  const { ff, isDark, fonts: ffFonts } = useFinanceFoldTheme();
  const { animate: foldAnimate } = useFoldMotionGate();
  const { wrapLoad } = usePageApiSync(PAGE_API_KEY);

  const bg = ff.paper;
  const card = isDark ? ff.paper2 : ff.card;
  const text = ff.ink;
  const subtle = ff.muted;
  const faint = ff.faint;
  const line = ff.line;
  const pine = ff.pine;
  const clay = ff.clay;
  const income = ff.income;
  const expense = ff.expense;
  const headerScrim = isDark ? 'rgba(23,43,36,0.94)' : 'rgba(243,238,228,0.94)';

  const [account, setAccount] = React.useState<FinanceAccountBalanceRow | null>(null);
  const [transactions, setTransactions] = React.useState<FinanceTransactionRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [deleting, setDeleting] = React.useState(false);
  const [balanceModalOpen, setBalanceModalOpen] = React.useState(false);
  const [balanceDraft, setBalanceDraft] = React.useState('');
  const [savingBalance, setSavingBalance] = React.useState(false);
  const [savingExcludeFromTotal, setSavingExcludeFromTotal] = React.useState(false);
  const routeAccountId = typeof params.accountId === 'string' ? params.accountId : '';
  const routeAccountName = typeof params.accountName === 'string' ? params.accountName.trim() : '';
  const accountSignRule = account?.sign_rule ?? 1;
  const isLiabilityAccount = accountSignRule < 0 || account?.account_type === 'liability';

  const detailName = account?.name ?? (routeAccountName || '账户');
  const accountNo = account?.account_no?.trim() ?? '';
  const accountNote = account?.note?.trim() ?? '';
  const accountSubParts = [
    accountNo ? (accountNo.length <= 6 ? accountNo : `尾号 ${accountNo.slice(-4)}`) : null,
    accountNote || null,
    isLiabilityAccount ? '负债账户' : null,
  ].filter(Boolean);

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
    (tx: FinanceTransactionRow) =>
      computeTransactionLedgerEffect(tx.transaction_type, tx.amount, tx.extra_data),
    [],
  );

  const loadAccountDetailSeqRef = React.useRef(0);

  const loadAccountDetail = React.useCallback(
    async (forceRefresh = false) => {
      const seq = ++loadAccountDetailSeqRef.current;
      try {
        setError(null);
        const { account: target, transactions: txRows } = await fetchFinanceAccountDetail({
          accountId: routeAccountId,
          accountName: routeAccountName,
          serverFallback: true,
        });
        if (seq !== loadAccountDetailSeqRef.current) return;
        setAccount(target);
        setTransactions(target ? txRows : []);
      } catch (loadErr) {
        if (seq !== loadAccountDetailSeqRef.current) return;
        console.warn('Failed to load account detail:', loadErr);
        setError('加载失败，请重试');
        setAccount(null);
        setTransactions([]);
      } finally {
        if (seq === loadAccountDetailSeqRef.current) {
          setLoading(false);
        }
      }
    },
    [routeAccountId, routeAccountName],
  );

  const reloadAccountDetail = React.useCallback(
    async (forceRefresh = false) => {
      await wrapLoad(async () => {
        await loadAccountDetail(forceRefresh);
      }, forceRefresh);
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
  const includeInTotalAssets = !excludeFromTotalAssets;

  const onToggleIncludeInTotalAssets = React.useCallback(
    async (nextIncluded: boolean) => {
      const targetId = account?.id ?? routeAccountId;
      if (!targetId || savingExcludeFromTotal) return;
      const nextExcluded = !nextIncluded;
      const prevExtra = account?.extra_data ?? null;
      const merged = mergeFinanceAccountExcludeFromTotalAssets(prevExtra, nextExcluded);
      try {
        setSavingExcludeFromTotal(true);
        setAccount((prev) => (prev ? { ...prev, extra_data: merged } : prev));
        await updateFinanceAccount(targetId, { extra_data: merged });
        const { loadFinanceAccountDetail } = await import('@/lib/repositories/finance/finance');
        const local = await loadFinanceAccountDetail({
          accountId: routeAccountId || targetId,
          accountName: routeAccountName,
          cacheOnly: true,
        });
        if (local.account) {
          setAccount(local.account);
          setTransactions(local.transactions);
        }
      } catch (err) {
        console.warn('Failed to update exclude_from_total_assets:', err);
        setAccount((prev) => (prev ? { ...prev, extra_data: prevExtra } : prev));
        toast.error(toUserMessage(err, '保存失败，请稍后重试'));
      } finally {
        setSavingExcludeFromTotal(false);
      }
    },
    [account?.extra_data, account?.id, routeAccountId, routeAccountName, savingExcludeFromTotal],
  );

  const resolvedAccountId = account?.id ?? routeAccountId;

  const handleBalanceDraftChange = React.useCallback((raw: string) => {
    let s = raw.replace(/[^\d.-]/g, '');
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
      toast.warn('未找到账户信息');
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
      toast.warn('请输入正确的数字');
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
        signRule: account.sign_rule,
        accountType: account.account_type,
        currentLedgerBalance: account.balance ?? 0,
      });
      setBalanceModalOpen(false);
      await reloadAccountDetail();
      toast.success('已保存');
    } catch (e) {
      toast.error(toUserMessage(e, '保存失败，请稍后重试'));
    } finally {
      setSavingBalance(false);
    }
  }, [account, balanceDraft, reloadAccountDetail, savingBalance]);

  const onPressEditAccountMeta = React.useCallback(() => {
    if (!resolvedAccountId) {
      toast.warn('未找到账户信息');
      return;
    }
    router.push({ pathname: '/add-account', params: { editAccountId: resolvedAccountId } });
  }, [resolvedAccountId, router]);

  const onPressBookkeeping = React.useCallback(() => {
    if (!resolvedAccountId) {
      toast.warn('未找到账户信息');
      return;
    }
    openFinanceSheet({ kind: 'manual', tab: 'sentence', accountId: resolvedAccountId });
  }, [resolvedAccountId]);

  const onPressTransfer = React.useCallback(() => {
    if (!resolvedAccountId) {
      toast.warn(isLiabilityAccount ? '未找到账户信息，无法还款' : '未找到账户信息，无法转账');
      return;
    }
    if (isLiabilityAccount || accountSignRule !== 1) {
      openFinanceSheet({ kind: 'transfer', fromAccountId: null, toAccountId: resolvedAccountId });
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
      toast.warn('未找到账户信息');
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
            toast.success('已删除');
            router.back();
          } catch (err) {
            console.warn('Failed to delete finance account:', err);
            toast.error(toUserMessage(err, '删除失败，请稍后重试'));
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
      let net = 0;
      const items: DetailItem[] = [];
      const sortedRows = [...rows].sort((a, b) => b.happened_at.localeCompare(a.happened_at));
      for (const tx of sortedRows) {
        const displayAmount = getDisplayAmount(tx);
        net += displayAmount;
        const happenedDate = new Date(tx.happened_at);
        const mm = Number.isNaN(happenedDate.getTime())
          ? tx.happened_at.slice(5, 7)
          : String(happenedDate.getMonth() + 1).padStart(2, '0');
        const dd = Number.isNaN(happenedDate.getTime())
          ? tx.happened_at.slice(8, 10)
          : String(happenedDate.getDate()).padStart(2, '0');
        const hour = Number.isNaN(happenedDate.getTime())
          ? '00'
          : String(happenedDate.getHours()).padStart(2, '0');
        const minute = Number.isNaN(happenedDate.getTime())
          ? '00'
          : String(happenedDate.getMinutes()).padStart(2, '0');
        const isIncome = displayAmount > 0;
        const isExpense = displayAmount < 0;
        items.push({
          id: tx.id,
          time: `${hour}:${minute}`,
          tag: tx.name?.trim() || '交易',
          amount: displayAmount,
          flowLabel: tx.transaction_type === 'transfer' ? '转账' : isIncome ? '收入' : isExpense ? '支出' : '校正',
          dayLabel: `${mm}.${dd}`,
        });
      }

      return {
        id: monthKey,
        monthLabel: `${year} 年 ${Number(month)} 月`,
        count: items.length,
        net,
        expanded: expandedMonthIds.size === 0 ? monthIndex === 0 : expandedMonthIds.has(monthKey),
        items,
      };
    });
  }, [expandedMonthIds, getDisplayAmount, transactions]);

  React.useEffect(() => {
    setExpandedMonthIds(new Set());
  }, [routeAccountId, routeAccountName]);

  const rawBalance = account?.balance ?? 0;
  const displayBalance = isLiabilityAccount ? Math.min(0, rawBalance) : Math.max(0, rawBalance);
  const motionOn = foldAnimate && !loading && !!account;
  const headerSub = accountNo
    ? `ACCOUNT · ${accountNo.length > 8 ? accountNo.slice(-4) : accountNo}`
    : isLiabilityAccount
      ? 'ACCOUNT · LIABILITY'
      : 'ACCOUNT · DETAIL';

  const iconPressScale = React.useRef(new Animated.Value(1)).current;

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
          <View style={styles.headerCenter}>
            <Text style={[styles.headerTitle, { color: text, fontFamily: ffFonts.serif }]}>账户详情</Text>
            <Text style={[styles.headerSub, { color: subtle }]} numberOfLines={1}>
              {headerSub}
            </Text>
          </View>
          <Pressable
            onPress={onDeleteAccount}
            disabled={deleting || !resolvedAccountId}
            style={({ pressed }) => [
              styles.foldIconBtn,
              { borderColor: line, backgroundColor: card },
              (pressed || deleting) && { opacity: 0.7, transform: [{ scale: 0.94 }] },
            ]}
            accessibilityRole="button"
            accessibilityLabel="删除账户">
            <MaterialIcons name="delete-outline" size={16} color={clay} />
          </Pressable>
        </View>
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={pine} />
          <Text style={{ color: subtle, marginTop: 10, fontSize: 13 }}>加载账户…</Text>
        </View>
      ) : error ? (
        <View style={styles.loadingWrap}>
          <Text style={{ color: clay, fontSize: 14 }}>{error}</Text>
          <Pressable
            onPress={() => {
              setLoading(true);
              void reloadAccountDetail(true);
            }}
            style={[styles.retryBtn, { backgroundColor: pine, marginTop: 14 }]}>
            <Text style={{ color: ff.onPine, fontWeight: '700' }}>重试</Text>
          </Pressable>
        </View>
      ) : !account ? (
        <View style={styles.loadingWrap}>
          <Text style={{ color: subtle, fontSize: 14 }}>未找到该账户</Text>
        </View>
      ) : (
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
          <FoldRiseIn animate={motionOn} index={0} fromY={11}>
            <View style={styles.detailTop}>
              <FoldPopIn animate={motionOn} delayMs={80}>
                <Animated.View style={{ transform: [{ scale: iconPressScale }] }}>
                  <Pressable
                    onPress={onPressEditAccountMeta}
                    onPressIn={() => {
                      Animated.timing(iconPressScale, {
                        toValue: 0.94,
                        duration: 120,
                        easing: FOLD_MOTION_SPRING,
                        useNativeDriver: true,
                      }).start();
                    }}
                    onPressOut={() => {
                      Animated.timing(iconPressScale, {
                        toValue: 1,
                        duration: 220,
                        easing: FOLD_MOTION_SPRING,
                        useNativeDriver: true,
                      }).start();
                    }}
                    accessibilityRole="button"
                    accessibilityLabel="编辑账户"
                    style={styles.accountIcon}>
                    <MaterialIcons name={accountIcon(account)} size={26} color="#F3DDB8" />
                    <View style={[styles.accountIconBadge, { backgroundColor: card, borderColor: isDark ? line : '#D8CCB9' }]}>
                      <MaterialIcons name="edit" size={9} color="#68756C" />
                    </View>
                  </Pressable>
                </Animated.View>
              </FoldPopIn>
              <Text style={[styles.accountName, { color: pine, fontFamily: ffFonts.serif }]}>{detailName}</Text>
              {accountSubParts.length > 0 ? (
                <Text style={[styles.accountSub, { color: faint }]}>{accountSubParts.join(' · ')}</Text>
              ) : null}
            </View>
          </FoldRiseIn>

          <FoldRiseIn animate={motionOn} index={1} fromY={11}>
            <View style={[styles.balanceCard, { backgroundColor: card, borderColor: line }]}>
              <Text style={[styles.eyebrow, { color: faint }]}>
                {isLiabilityAccount ? 'Current liability' : 'Current balance'}
              </Text>
              <FoldCountUpText
                value={displayBalance}
                animate={motionOn}
                duration={760}
                textStyle={[
                  styles.balanceNum,
                  {
                    color: isLiabilityAccount && displayBalance < 0 ? clay : pine,
                    fontFamily: ffFonts.mono,
                  },
                ]}
                formatter={(n) => {
                  const prefix = n < 0 ? '-' : '';
                  return `${prefix}${formatMoney(n)}`;
                }}
              />
              <Pressable
                onPress={openBalanceEditor}
                accessibilityRole="button"
                accessibilityLabel="校正余额"
                style={({ pressed }) => [styles.balanceEdit, pressed && { opacity: 0.7 }]}>
                <MaterialIcons name="edit" size={12} color={subtle} />
                <Text style={{ color: subtle, fontSize: 12 }}>校正余额</Text>
              </Pressable>
              <Text style={[styles.miniNote, { color: faint }]}>
                修改余额会生成一笔「余额校正」流水，不参与预算
              </Text>
            </View>
          </FoldRiseIn>

          {!isLiabilityAccount ? (
            <FoldRiseIn animate={motionOn} index={2} fromY={11}>
              <View style={styles.countToggle}>
                <View style={styles.countToggleLeft}>
                  <MaterialIcons name="pie-chart-outline" size={16} color={subtle} />
                  <Text style={[styles.countToggleLabel, { color: subtle }]}>计入总资产</Text>
                  <Text style={[styles.countToggleTip, { color: faint }]}>关闭后净资产会同步减少</Text>
                </View>
                <Switch
                  value={includeInTotalAssets}
                  disabled={savingExcludeFromTotal}
                  onValueChange={(v) => void onToggleIncludeInTotalAssets(v)}
                  trackColor={{ false: isDark ? ff.line2 : '#D8D5CB', true: ff.sage }}
                  thumbColor={card}
                />
              </View>
            </FoldRiseIn>
          ) : null}

          <FoldRiseIn animate={motionOn} index={3} fromY={11}>
            <View style={styles.accountActions}>
              <Pressable
                onPress={onPressBookkeeping}
                style={({ pressed }) => [
                  styles.actionPrimary,
                  { backgroundColor: pine },
                  pressed && { opacity: 0.9, transform: [{ scale: 0.985 }] },
                ]}
                accessibilityRole="button"
                accessibilityLabel="记账">
                <MaterialIcons name="add" size={16} color={ff.onPine} />
                <Text style={[styles.actionPrimaryText, { color: ff.onPine }]}>记账</Text>
              </Pressable>
              <Pressable
                onPress={onPressTransfer}
                style={({ pressed }) => [
                  styles.actionGhost,
                  {
                    backgroundColor: isDark ? ff.paper2 : '#F7F2E7',
                    borderColor: ff.line2,
                  },
                  pressed && { opacity: 0.9, transform: [{ scale: 0.985 }] },
                ]}
                accessibilityRole="button"
                accessibilityLabel={isLiabilityAccount ? '还款' : '转账 / 还款'}>
                <MaterialIcons name="swap-horiz" size={16} color="#56645B" />
                <Text style={styles.actionGhostText}>{isLiabilityAccount ? '还款' : '转账 / 还款'}</Text>
              </Pressable>
            </View>
          </FoldRiseIn>

          <FoldRiseIn animate={motionOn} index={4} fromY={11}>
            <View style={styles.sectionH}>
              <Text style={[styles.sectionHT, { color: subtle }]}>Monthly ledger / 月流水</Text>
              <Text style={[styles.sectionHA, { color: faint }]}>本页只读</Text>
            </View>
          </FoldRiseIn>

          {monthSections.length === 0 ? (
            <FoldRiseIn animate={motionOn} index={5} fromY={11}>
              <View style={[styles.monthFold, { backgroundColor: card, borderColor: line, paddingVertical: 18 }]}>
                <Text style={{ color: faint, textAlign: 'center', fontSize: 12 }}>暂无流水</Text>
              </View>
            </FoldRiseIn>
          ) : (
            monthSections.map((section, sIdx) => (
              <FoldRiseIn key={section.id} animate={motionOn} index={5 + sIdx} fromY={11}>
                <View style={[styles.monthFold, { backgroundColor: card, borderColor: line }]}>
                  <Pressable
                    onPress={() => toggleMonthExpanded(section.id)}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: section.expanded }}
                    accessibilityLabel={`${section.monthLabel}，${section.expanded ? '收起' : '展开'}明细`}
                    style={({ pressed }) => [styles.monthH, pressed && { opacity: 0.82 }]}>
                    <MaterialIcons
                      name="keyboard-arrow-down"
                      size={18}
                      color={subtle}
                      style={{ transform: [{ rotate: section.expanded ? '0deg' : '-90deg' }] }}
                    />
                    <Text style={[styles.monthTitle, { color: '#3B4A41' }]}>{section.monthLabel}</Text>
                    <Text style={[styles.monthCount, { color: faint, fontFamily: ffFonts.mono }]}>
                      {section.count} 笔
                    </Text>
                    <Text
                      style={[
                        styles.monthSum,
                        {
                          color: section.net > 0.009 ? income : section.net < -0.009 ? expense : subtle,
                          fontFamily: ffFonts.mono,
                        },
                      ]}>
                      {formatSignedMoney(section.net)}
                    </Text>
                    {!section.expanded ? <MaterialIcons name="chevron-right" size={16} color={faint} /> : null}
                  </Pressable>

                  {section.expanded ? (
                    <View style={styles.monthBody}>
                      {section.items.map((item, i) => {
                        const amtColor =
                          item.amount > 0.009 ? income : item.amount < -0.009 ? expense : text;
                        const icBg =
                          item.amount > 0.009
                            ? isDark
                              ? 'rgba(106,160,131,0.22)'
                              : '#E7EFE9'
                            : item.amount < -0.009
                              ? isDark
                                ? 'rgba(198,106,76,0.2)'
                                : '#F4E4DC'
                              : isDark
                                ? 'rgba(255,255,255,0.08)'
                                : '#F0EBE0';
                        const icFg =
                          item.amount > 0.009 ? income : item.amount < -0.009 ? expense : subtle;
                        return (
                          <FoldRiseIn key={item.id} animate={motionOn} index={i} staggerMs={45} delayMs={40} fromY={8}>
                            <View
                              style={[
                                styles.ledgerRow,
                                i < section.items.length - 1
                                  ? { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: isDark ? line : '#ECE4D6' }
                                  : null,
                              ]}>
                              <View style={[styles.ledgerIc, { backgroundColor: icBg }]}>
                                <Text style={[styles.ledgerIcText, { color: icFg }]}>{ledgerInitial(item.tag)}</Text>
                              </View>
                              <View style={styles.ledgerMain}>
                                <Text style={[styles.ledgerTitle, { color: text }]} numberOfLines={1}>
                                  {item.tag}
                                </Text>
                                <Text style={[styles.ledgerMeta, { color: faint }]}>
                                  {item.dayLabel} · {item.time} · {item.flowLabel}
                                </Text>
                              </View>
                              <Text style={[styles.ledgerAmt, { color: amtColor, fontFamily: ffFonts.mono }]}>
                                {formatSignedMoney(item.amount)}
                              </Text>
                            </View>
                          </FoldRiseIn>
                        );
                      })}
                    </View>
                  ) : null}
                </View>
              </FoldRiseIn>
            ))
          )}

          <Text style={[styles.readOnlyNote, { color: faint }]}>
            流水编辑请回到首页或财务日历 · 这里只负责核对
          </Text>
        </ScrollView>
      )}

      <Modal
        transparent
        animationType="fade"
        visible={balanceModalOpen}
        onRequestClose={() => {
          if (!savingBalance) setBalanceModalOpen(false);
        }}>
        <View style={styles.balanceModalRoot}>
          <Pressable
            style={[styles.balanceModalBackdrop, { backgroundColor: 'rgba(29,41,35,0.42)' }]}
            onPress={() => {
              if (!savingBalance) setBalanceModalOpen(false);
            }}
          />
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.balanceModalCenter}
            pointerEvents="box-none">
            <View style={[styles.balanceModalCard, { backgroundColor: card, borderColor: line }]}>
              <Text style={[styles.balanceModalTitle, { color: text, fontFamily: ffFonts.serif }]}>
                校正{isLiabilityAccount ? '负债' : '余额'}
              </Text>
              <Text style={[styles.balanceModalHint, { color: subtle }]}>
                {isLiabilityAccount
                  ? '请输入负债金额（正数表示欠款规模）。保存后将记一笔「余额校正」流水。'
                  : '保存后将记一笔「余额校正」流水，与当前流水汇总对齐。'}
              </Text>
              <View
                style={[
                  styles.balanceModalInputRow,
                  { borderColor: line, backgroundColor: isDark ? ff.paper2 : '#F7F2E7' },
                ]}>
                <Text style={[styles.balanceModalYuan, { color: text, fontFamily: ffFonts.mono }]}>¥</Text>
                <AppInput
                  value={balanceDraft}
                  onChangeText={handleBalanceDraftChange}
                  placeholder="0.00"
                  keyboardType="decimal-pad"
                  editable={!savingBalance}
                  inputStyle={[styles.balanceModalInputText, { color: text, fontFamily: ffFonts.mono }]}
                  inputWrapStyle={[
                    styles.balanceModalInputWrap,
                    { flex: 1, borderWidth: 0, backgroundColor: 'transparent', paddingHorizontal: 0 },
                  ]}
                  containerStyle={styles.balanceModalInputContainerInline}
                />
              </View>
              <View style={styles.balanceModalActions}>
                <Pressable
                  onPress={() => !savingBalance && setBalanceModalOpen(false)}
                  disabled={savingBalance}
                  style={({ pressed }) => [
                    styles.balanceModalBtnGhost,
                    { borderColor: ff.line2, backgroundColor: isDark ? ff.paper2 : '#F7F2E7' },
                    pressed && { opacity: 0.85 },
                  ]}>
                  <Text style={{ color: '#56645B', fontWeight: '700' }}>取消</Text>
                </Pressable>
                <Pressable
                  onPress={() => void onConfirmBalanceEdit()}
                  disabled={savingBalance}
                  style={({ pressed }) => [
                    styles.balanceModalBtnPrimary,
                    { backgroundColor: pine },
                    pressed && { opacity: 0.9 },
                  ]}>
                  <Text style={{ color: ff.onPine, fontWeight: '700' }}>
                    {savingBalance ? '保存中…' : '保存'}
                  </Text>
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
  container: { flex: 1 },
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
  headerCenter: { flex: 1, minWidth: 0, alignItems: 'center', gap: 2 },
  headerTitle: { fontSize: 17, fontWeight: '600', letterSpacing: 0.2 },
  headerSub: { fontSize: 10, fontWeight: '600', letterSpacing: 0.6 },
  foldIconBtn: {
    width: 31,
    height: 31,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  retryBtn: {
    height: 38,
    paddingHorizontal: 20,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 10,
    gap: 8,
  },
  detailTop: {
    alignItems: 'center',
    paddingTop: 4,
    paddingBottom: 10,
  },
  accountIcon: {
    width: 50,
    height: 50,
    borderRadius: 16,
    backgroundColor: '#2C5647',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#1C372C',
    shadowOffset: { width: 0, height: 9 },
    shadowOpacity: 0.17,
    shadowRadius: 12,
    elevation: 4,
  },
  accountIconBadge: {
    position: 'absolute',
    right: -3,
    bottom: -3,
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  accountName: {
    fontSize: 18,
    fontWeight: '600',
    marginTop: 10,
  },
  accountSub: {
    fontSize: 12,
    marginTop: 3,
    textAlign: 'center',
    paddingHorizontal: 20,
  },
  balanceCard: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 12,
    alignItems: 'center',
  },
  eyebrow: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  balanceNum: {
    fontSize: 28,
    fontWeight: '700',
    marginTop: 4,
    letterSpacing: -0.4,
  },
  balanceEdit: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 6,
  },
  miniNote: {
    fontSize: 11,
    marginTop: 6,
    textAlign: 'center',
    lineHeight: 16,
  },
  countToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    paddingHorizontal: 2,
    gap: 10,
  },
  countToggleLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
    minWidth: 0,
  },
  countToggleLabel: { fontSize: 13, fontWeight: '600' },
  countToggleTip: { fontSize: 11 },
  accountActions: {
    flexDirection: 'row',
    gap: 8,
    marginVertical: 4,
  },
  actionPrimary: {
    flex: 1,
    height: 42,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  actionPrimaryText: { fontSize: 14, fontWeight: '700' },
  actionGhost: {
    flex: 1,
    height: 42,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  actionGhostText: { fontSize: 14, fontWeight: '700', color: '#56645B' },
  sectionH: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginTop: 6,
    marginBottom: 2,
    paddingHorizontal: 2,
  },
  sectionHT: { fontSize: 11, fontWeight: '700', letterSpacing: 0.4 },
  sectionHA: { fontSize: 10 },
  monthFold: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    overflow: 'hidden',
  },
  monthH: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 12,
  },
  monthTitle: { fontSize: 14, fontWeight: '700', flexShrink: 1 },
  monthCount: { fontSize: 12 },
  monthSum: { marginLeft: 'auto', fontSize: 12, fontWeight: '600' },
  monthBody: { paddingBottom: 4 },
  ledgerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
  },
  ledgerIc: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ledgerIcText: { fontSize: 12, fontWeight: '700' },
  ledgerMain: { flex: 1, minWidth: 0, gap: 2 },
  ledgerTitle: { fontSize: 14, fontWeight: '600' },
  ledgerMeta: { fontSize: 11 },
  ledgerAmt: { fontSize: 13, fontWeight: '700', textAlign: 'right' },
  readOnlyNote: {
    textAlign: 'center',
    fontSize: 11,
    marginTop: 6,
    marginBottom: 8,
  },
  balanceModalRoot: { flex: 1 },
  balanceModalBackdrop: { ...StyleSheet.absoluteFill },
  balanceModalCenter: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 22,
  },
  balanceModalCard: {
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 18,
  },
  balanceModalTitle: { fontSize: 18, fontWeight: '600' },
  balanceModalHint: {
    marginTop: 8,
    marginBottom: 16,
    fontSize: 12,
    lineHeight: 18,
  },
  balanceModalInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 12,
    marginBottom: 16,
  },
  balanceModalYuan: { fontSize: 22, fontWeight: '700' },
  balanceModalInputContainerInline: { flex: 1, marginBottom: 0 },
  balanceModalInputWrap: { minHeight: 48 },
  balanceModalInputText: { fontSize: 22, fontWeight: '700' },
  balanceModalActions: { flexDirection: 'row', gap: 8 },
  balanceModalBtnGhost: {
    flex: 1,
    height: 42,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  balanceModalBtnPrimary: {
    flex: 1,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
