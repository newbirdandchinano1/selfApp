import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { getFinanceAccountsWithBalance, getFinanceTransactions } from '@/lib/repositories/finance/finance';
import type { FinanceAccountBalanceRow, FinanceTransactionRow } from '@/lib/repositories/finance/finance.types';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import React from 'react';
import { Animated, Dimensions, Easing, Modal, Pressable, ScrollView, StyleProp, StyleSheet, Text, TextInput, View, ViewStyle } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

type Txn = {
  id: string;
  icon: keyof typeof MaterialIcons.glyphMap;
  iconColor: string;
  title: string;
  meta: string;
  amount: string;
  amountColor: string;
  insight?: string;
};

function TxnItem({
  themeText,
  themeSubtle,
  outlineVariant,
  item,
  style,
}: {
  themeText: string;
  themeSubtle: string;
  outlineVariant: string;
  item: Txn;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Animated.View style={[styles.txnItem, style]}>
      <View style={[styles.txnIconWrap, { backgroundColor: outlineVariant }]}>
        <MaterialIcons name={item.icon} size={18} color={item.iconColor} />
      </View>
      <View style={styles.txnMain}>
        <View style={styles.txnTopRow}>
          <View style={styles.txnTextCol}>
            <Text style={[styles.txnTitle, { color: themeText }]}>{item.title}</Text>
            <Text style={[styles.txnMeta, { color: themeSubtle }]}>{item.meta}</Text>
          </View>
          <Text style={[styles.txnAmount, { color: item.amountColor }]}>{item.amount}</Text>
        </View>
        {item.insight ? (
          <View style={[styles.insightTag, { backgroundColor: outlineVariant }]}>
            <MaterialIcons name="auto-awesome" size={14} color={item.iconColor} />
            <Text style={[styles.insightText, { color: item.iconColor }]}>{item.insight}</Text>
          </View>
        ) : null}
      </View>
    </Animated.View>
  );
}

export default function FinanceScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const baseTheme = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';

  const bg = isDark ? baseTheme.background : '#faf8ff';
  const surface = isDark ? baseTheme.surface : '#ffffff';
  const text = isDark ? baseTheme.text : '#131b2e';
  const subtle = isDark ? baseTheme.textSecondary : '#424754';
  const outlineVariant = isDark ? 'rgba(148,163,184,0.16)' : 'rgba(194,198,214,0.26)';

  const primary = isDark ? '#60a5fa' : '#0058be';
  const secondary = isDark ? '#34d399' : '#006c49';
  const tertiary = isDark ? '#fbbf24' : '#825100';
  const weekdayCn = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const;
  const today = new Date();
  const headerDateLabel = `${today.getMonth() + 1}月${today.getDate()}日 ${weekdayCn[today.getDay()]}`;

  const formatCurrencyWithDecimals = React.useCallback((value: number) => {
    return `¥${value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }, []);
  const todayLabel = `今日 ${today.getMonth() + 1}月${today.getDate()}日 ${weekdayCn[today.getDay()]}`;

  const collapsedBottom = 6;
  const [isSheetVisible, setIsSheetVisible] = React.useState(false);
  const [activeSheetTab, setActiveSheetTab] = React.useState<'expense' | 'income' | 'transfer'>('expense');
  const [sheetAmount, setSheetAmount] = React.useState('');
  const [sheetNote, setSheetNote] = React.useState('');
  const [financeTransactions, setFinanceTransactions] = React.useState<FinanceTransactionRow[]>([]);
  const [financeAccounts, setFinanceAccounts] = React.useState<FinanceAccountBalanceRow[]>([]);
  const [animatedNetValue, setAnimatedNetValue] = React.useState(0);
  const [showNetAmounts, setShowNetAmounts] = React.useState(true);

  const baseBottomAnim = React.useRef(new Animated.Value(collapsedBottom)).current;
  const revealAnim = React.useRef(new Animated.Value(0)).current;
  const netValueAnim = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    Animated.timing(baseBottomAnim, {
      toValue: collapsedBottom,
      duration: 180,
      easing: Easing.out(Easing.quad),
      useNativeDriver: false,
    }).start();
  }, [baseBottomAnim, collapsedBottom, insets.bottom]);

  React.useEffect(() => {
    Animated.stagger(70, [
      Animated.timing(revealAnim, {
        toValue: 1,
        duration: 460,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [revealAnim]);

  React.useEffect(() => {
    const target = financeTransactions.reduce((sum, txn) => sum + txn.amount, 0);
    const id = netValueAnim.addListener(({ value }) => {
      setAnimatedNetValue(Math.round(value));
    });

    Animated.timing(netValueAnim, {
      toValue: target,
      duration: 900,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();

    return () => {
      netValueAnim.removeListener(id);
    };
  }, [financeTransactions, netValueAnim]);

  const loadFinanceTransactions = React.useCallback(async () => {
    try {
      const rows = await getFinanceTransactions();
      setFinanceTransactions(rows);
    } catch (error) {
      console.warn('Failed to load finance transactions:', error);
      setFinanceTransactions([]);
    }
  }, []);

  const loadFinanceAccounts = React.useCallback(async () => {
    try {
      const rows = await getFinanceAccountsWithBalance();
      setFinanceAccounts(rows);
    } catch (error) {
      console.warn('Failed to load finance accounts:', error);
      setFinanceAccounts([]);
    }
  }, []);

  React.useEffect(() => {
    void loadFinanceTransactions();
    void loadFinanceAccounts();
  }, [loadFinanceAccounts, loadFinanceTransactions]);

  useFocusEffect(
    React.useCallback(() => {
      void loadFinanceTransactions();
      void loadFinanceAccounts();
    }, [loadFinanceAccounts, loadFinanceTransactions])
  );

  const screenWidth = Dimensions.get('window').width;
  const expandedWidth = Math.min(420, screenWidth - 36);

  const heroTranslateY = revealAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [18, 0],
  });

  const heroOpacity = revealAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
  });

  const listTranslateY = revealAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [28, 0],
  });

  const listOpacity = revealAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
  });

  const formatCurrency = React.useCallback((value: number) => {
    return `¥${value.toLocaleString('zh-CN')}`;
  }, []);

  const accountNameMap = React.useMemo(() => {
    return new Map(financeAccounts.map((account) => [account.id, account.name]));
  }, [financeAccounts]);
  const accountSignRuleMap = React.useMemo(() => {
    return new Map(financeAccounts.map((account) => [account.id, account.sign_rule]));
  }, [financeAccounts]);

  const getTxnDisplayAmount = React.useCallback(
    (txn: FinanceTransactionRow) => {
      const accountSignRule = accountSignRuleMap.get(txn.account_id);
      const isLiabilityAccount = accountSignRule != null ? accountSignRule < 0 : txn.amount < 0;
      const absAmount = Math.abs(txn.amount);
      if (isLiabilityAccount) {
        if (txn.transaction_type === 'income') return -absAmount;
        if (txn.transaction_type === 'expense') return absAmount;
      } else {
        if (txn.transaction_type === 'income') return absAmount;
        if (txn.transaction_type === 'expense') return -absAmount;
      }
      return txn.amount;
    },
    [accountSignRuleMap]
  );

  const todayTxns = React.useMemo(
    () =>
      financeTransactions.filter((txn) => {
        const happenedAt = new Date(txn.happened_at);
        return (
          happenedAt.getFullYear() === today.getFullYear() &&
          happenedAt.getMonth() === today.getMonth() &&
          happenedAt.getDate() === today.getDate()
        );
      }),
    [financeTransactions, today]
  );

  const todayExpenseTotal = React.useMemo(
    () =>
      todayTxns.reduce((sum, txn) => {
        const displayAmount = getTxnDisplayAmount(txn);
        return displayAmount < 0 ? sum + Math.abs(displayAmount) : sum;
      }, 0),
    [getTxnDisplayAmount, todayTxns]
  );

  const todayIncomeTotal = React.useMemo(
    () =>
      todayTxns.reduce((sum, txn) => {
        const displayAmount = getTxnDisplayAmount(txn);
        return displayAmount > 0 ? sum + Math.abs(displayAmount) : sum;
      }, 0),
    [getTxnDisplayAmount, todayTxns]
  );

  const displayTxns = React.useMemo<Txn[]>(() => {
    const now = new Date();
    const currentYmd = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayYmd = `${yesterday.getFullYear()}-${yesterday.getMonth()}-${yesterday.getDate()}`;

    return financeTransactions.slice(0, 16).map((txn) => {
      const happenedAt = new Date(txn.happened_at);
      const hour = Number.isNaN(happenedAt.getTime()) ? '00' : String(happenedAt.getHours()).padStart(2, '0');
      const minute = Number.isNaN(happenedAt.getTime()) ? '00' : String(happenedAt.getMinutes()).padStart(2, '0');
      const ymd = `${happenedAt.getFullYear()}-${happenedAt.getMonth()}-${happenedAt.getDate()}`;
      const dayLabel = ymd === currentYmd ? '今天' : ymd === yesterdayYmd ? '昨天' : `${happenedAt.getMonth() + 1}月${happenedAt.getDate()}日`;
      const accountLabel = accountNameMap.get(txn.account_id) ?? '未知账户';

      const displayAmount = getTxnDisplayAmount(txn);
      const isIncome = displayAmount > 0;
      const isExpense = displayAmount < 0;
      const typeLabel = txn.transaction_type === 'transfer' ? '转账' : isIncome ? '收入' : '支出';
      const icon: keyof typeof MaterialIcons.glyphMap = isIncome ? 'savings' : isExpense ? 'shopping-bag' : 'sync-alt';
      const iconColor = isIncome ? secondary : isExpense ? tertiary : subtle;
      const amountColor = isIncome ? secondary : isExpense ? '#dc2626' : text;
      const amountPrefix = isIncome ? '+' : isExpense ? '-' : '';

      return {
        id: txn.id,
        icon,
        iconColor,
        title: txn.name?.trim() || '交易',
        meta: `${dayLabel} ${hour}:${minute} · ${typeLabel} · ${accountLabel}`,
        amount: `${amountPrefix}${formatCurrencyWithDecimals(Math.abs(displayAmount))}`,
        amountColor,
        insight: txn.ai_comment?.trim() ? `AI 洞察：${txn.ai_comment.trim()}` : undefined,
      };
    });
  }, [accountNameMap, financeTransactions, formatCurrencyWithDecimals, getTxnDisplayAmount, secondary, subtle, tertiary, text]);

  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  const monthlyTransactions = React.useMemo(() => {
    return financeTransactions.filter((txn) => {
      const happenedAt = new Date(txn.happened_at);
      return happenedAt >= monthStart && happenedAt < monthEnd;
    });
  }, [financeTransactions, monthEnd, monthStart]);
  const monthlyIncome = React.useMemo(
    () =>
      monthlyTransactions.reduce((sum, txn) => {
        const displayAmount = getTxnDisplayAmount(txn);
        return displayAmount > 0 ? sum + Math.abs(displayAmount) : sum;
      }, 0),
    [getTxnDisplayAmount, monthlyTransactions]
  );
  const monthlyExpense = React.useMemo(
    () =>
      monthlyTransactions.reduce((sum, txn) => {
        const displayAmount = getTxnDisplayAmount(txn);
        return displayAmount < 0 ? sum + Math.abs(displayAmount) : sum;
      }, 0),
    [getTxnDisplayAmount, monthlyTransactions]
  );
  const monthlySurplus = monthlyIncome - monthlyExpense;
  const savingsRate = monthlyIncome > 0 ? (monthlySurplus / monthlyIncome) * 100 : 0;

  const hiddenAmountText = '****';
  const netValueText = showNetAmounts ? formatCurrency(animatedNetValue) : hiddenAmountText;
  const netChangeText = showNetAmounts ? `${savingsRate.toFixed(1)}%` : '--';
  const monthlyIncomeText = showNetAmounts ? formatCurrencyWithDecimals(monthlyIncome) : hiddenAmountText;
  const monthlyExpenseText = showNetAmounts ? formatCurrencyWithDecimals(monthlyExpense) : hiddenAmountText;
  const monthlySurplusText = showNetAmounts ? formatCurrencyWithDecimals(monthlySurplus) : hiddenAmountText;
  const savingRateText = showNetAmounts ? `${savingsRate.toFixed(1)}%` : '--';

  const formatCurrencyBalance = React.useCallback(
    (value: number) => {
      if (!showNetAmounts) return hiddenAmountText;
      return `¥${value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    },
    [showNetAmounts]
  );

  const accountIcon = React.useCallback((name: string): keyof typeof MaterialIcons.glyphMap => {
    if (name.includes('现金')) return 'payments';
    if (name.includes('支付宝')) return 'account-balance-wallet';
    if (name.includes('微信')) return 'chat';
    return 'account-balance';
  }, []);

  const expenseCategories = React.useMemo(
    () => [
      { key: 'food', icon: 'restaurant', label: '餐饮', color: primary },
      { key: 'snack', icon: 'icecream', label: '零食', color: secondary },
      { key: 'fruit', icon: 'nutrition', label: '水果', color: tertiary },
      { key: 'drink', icon: 'local-cafe', label: '饮品', color: primary },
      { key: 'cook', icon: 'set-meal', label: '做饭食材', color: secondary },
      { key: 'traffic', icon: 'directions-car', label: '交通', color: tertiary },
      { key: 'home', icon: 'home', label: '居住', color: primary },
      { key: 'cloth', icon: 'checkroom', label: '服饰', color: secondary },
      { key: 'play', icon: 'sports-esports', label: '娱乐', color: tertiary },
      { key: 'other', icon: 'more-horiz', label: '其他', color: subtle },
    ],
    [primary, secondary, subtle, tertiary]
  );

  const incomeCategories = React.useMemo(
    () => [
      { key: 'salary', icon: 'payments', label: '工资', color: secondary },
      { key: 'bonus', icon: 'card-giftcard', label: '奖金', color: primary },
      { key: 'refund', icon: 'receipt-long', label: '报销', color: tertiary },
      { key: 'invest', icon: 'savings', label: '理财', color: secondary },
      { key: 'sideline', icon: 'storefront', label: '副业', color: primary },
      { key: 'allowance', icon: 'volunteer-activism', label: '补贴', color: tertiary },
      { key: 'redpack', icon: 'redeem', label: '红包', color: secondary },
      { key: 'gift', icon: 'card-membership', label: '礼金', color: primary },
      { key: 'rent', icon: 'home-work', label: '租金', color: tertiary },
      { key: 'other-income', icon: 'add-card', label: '其他', color: subtle },
    ],
    [primary, secondary, subtle, tertiary]
  );

  const keypadRows = React.useMemo(
    () => [
      ['1', '2', '3', 'backspace'],
      ['4', '5', '6', '+'],
      ['7', '8', '9', '-'],
      ['0', '0', '.', 'done'],
    ],
    []
  );

  const amountDisplay = sheetAmount || '0.00';
  const activeCategories = activeSheetTab === 'income' ? incomeCategories : expenseCategories;
  const sheetDateLabel = `${today.getMonth() + 1}月${today.getDate()}日`;

  const handleAmountKeyPress = React.useCallback((key: string) => {
    if (key === 'backspace') {
      setSheetAmount((prev) => prev.slice(0, -1));
      return;
    }
    if (key === 'done' || key === 'check') {
      setIsSheetVisible(false);
      return;
    }
    setSheetAmount((prev) => `${prev}${key}`);
  }, []);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: bg }]} edges={['left', 'right']}>
      <ScrollView
        stickyHeaderIndices={[0]}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: 220 + collapsedBottom },
        ]}
        showsVerticalScrollIndicator={false}>
        <View
          style={[
            styles.header,
            {
              backgroundColor: isDark ? 'rgba(15,23,42,0.82)' : 'rgba(255,255,255,0.82)',
              borderBottomColor: outlineVariant,
              paddingTop: insets.top,
            },
          ]}>
          <View style={styles.headerInner}>
            <View style={styles.headerSpacer} />
            <Text style={[styles.headerTitle, { color: text }]}>{headerDateLabel}</Text>
            <View style={styles.headerRight}>
              <Pressable
                onPress={() => router.push('/finance-calendar')}
                style={({ pressed }) => [styles.headerIconBtn, pressed && { opacity: 0.75 }]}> 
                <MaterialIcons name="calendar-today" size={22} color={text} />
              </Pressable>
            </View>
          </View>
        </View>

        <View style={styles.content}>
          <Animated.View
            style={[
              styles.netCard,
              { backgroundColor: surface, borderColor: outlineVariant, opacity: heroOpacity, transform: [{ translateY: heroTranslateY }] },
            ]}>

            <View style={[styles.netAccent, { backgroundColor: tertiary }]} />
            <View style={styles.netHeaderRow}>
              <Text style={[styles.netKicker, { color: subtle }]}>当前净资产</Text>
              <Pressable
                onPress={() => setShowNetAmounts((prev) => !prev)}
                style={({ pressed }) => [styles.netVisibilityBtn, pressed && { opacity: 0.75 }]}
                accessibilityRole="button"
                accessibilityLabel={showNetAmounts ? '隐藏当前卡片数字' : '显示当前卡片数字'}>
                <MaterialIcons name={showNetAmounts ? 'visibility-off' : 'visibility'} size={18} color={subtle} />
              </Pressable>
            </View>
            <View style={styles.netRow}>
              <Text style={[styles.netValue, { color: text }]}>{netValueText}</Text>
              <Text style={[styles.netChange, { color: secondary }]}>{netChangeText}</Text>
            </View>
            <View style={[styles.netDivider, { backgroundColor: outlineVariant }]} />
            <View style={styles.netStats}>
              <View style={styles.netStatCol}>
                <Text style={[styles.netStatLabel, { color: subtle }]}>本月收入</Text>
                <Text style={[styles.netStatValue, { color: secondary }]}>{monthlyIncomeText}</Text>
              </View>
              <View style={styles.netStatCol}>
                <Text style={[styles.netStatLabel, { color: subtle }]}>本月支出</Text>
                <Text style={[styles.netStatValue, { color: '#dc2626' }]}>{monthlyExpenseText}</Text>
              </View>
              <View style={styles.netStatCol}>
                <Text style={[styles.netStatLabel, { color: subtle }]}>本月盈余</Text>
                <Text style={[styles.netStatValue, { color: secondary }]}>{monthlySurplusText}</Text>
              </View>
              <View style={styles.netStatCol}>
                <Text style={[styles.netStatLabel, { color: subtle }]}>储蓄率</Text>
                <Text style={[styles.netStatValue, { color: text }]}>{savingRateText}</Text>
              </View>
            </View>
            <Pressable
              onPress={() => router.push('/assets')}
              style={({ pressed }) => [
                styles.assetsBtn,
                { backgroundColor: `${primary}14`, borderColor: `${primary}33` },
                pressed && { opacity: 0.9 },
              ]}>
              <MaterialIcons name="account-balance" size={18} color={primary} />
              <Text style={[styles.assetsBtnText, { color: primary }]}>资产</Text>
              <MaterialIcons name="arrow-forward-ios" size={14} color={primary} />
            </Pressable>
          </Animated.View>

          <Animated.View style={{ opacity: listOpacity, transform: [{ translateY: listTranslateY }] }}>
          <View style={styles.sectionHeaderRow}>
            <Text style={[styles.sectionTitle, { color: text }]}>账户资产</Text>
            <Pressable onPress={() => router.push('/assets')} style={({ pressed }) => [styles.sectionLink, pressed && { opacity: 0.8 }]}>
              <Text style={[styles.sectionLinkText, { color: subtle }]}>查看</Text>
              <MaterialIcons name="arrow-forward-ios" size={16} color={subtle} />
            </Pressable>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.carousel}>
            {financeAccounts.length === 0 ? (
              <Pressable
                onPress={() => router.push('/add-account')}
                style={({ pressed }) => [
                  styles.accountCard,
                  { backgroundColor: surface, borderColor: outlineVariant },
                  pressed && { opacity: 0.92, transform: [{ scale: 0.99 }] },
                ]}>
                <MaterialIcons name="add-circle-outline" size={22} color={primary} />
                <Text style={[styles.accountKicker, { color: subtle }]}>还没有账户</Text>
                <Text style={[styles.accountValue, { color: text }]}>去添加</Text>
              </Pressable>
            ) : (
              financeAccounts.slice(0, 8).map((acc, idx) => {
                const isAccent = idx === 1;
                const cardBg = isAccent ? (isDark ? 'rgba(30,41,59,0.92)' : '#283044') : surface;
                const kickerColor = isAccent ? 'rgba(255,255,255,0.70)' : subtle;
                const valueColor = isAccent ? '#fff' : text;
                const iconColor = isAccent ? (isDark ? '#fbbf24' : '#ffddb8') : primary;
                const cardStyle = isAccent ? styles.accountCardDark : styles.accountCard;

                return (
                  <Pressable
                    key={acc.id}
                    onPress={() =>
                      router.push({
                        pathname: '/account-detail',
                        params: {
                          accountId: acc.id,
                          accountName: acc.name,
                          accountNo: acc.account_no ?? '',
                        },
                      })
                    }
                    style={({ pressed }) => [
                      cardStyle,
                      isAccent ? { backgroundColor: cardBg } : { backgroundColor: cardBg, borderColor: outlineVariant },
                      pressed && { opacity: 0.92, transform: [{ scale: 0.99 }] },
                    ]}>
                    <MaterialIcons name={accountIcon(acc.name)} size={22} color={iconColor} />
                    <Text style={[styles.accountKicker, { color: kickerColor }]}>
                      {acc.account_no ? `${acc.name} (${acc.account_no})` : acc.name}
                    </Text>
                    <Text style={[styles.accountValue, { color: valueColor }]}>{formatCurrencyBalance(acc.balance)}</Text>
                  </Pressable>
                );
              })
            )}
          </ScrollView>

          <Text style={[styles.sectionTitle, { color: text, marginTop: 6 }]}>收支明细</Text>
          <View style={styles.sectionMetaRow}>
            <Text style={[styles.sectionMetaText, { color: subtle }]}>{todayLabel}</Text>
            <View style={styles.sectionLegendRow}>
              <Text style={[styles.sectionLegendText, { color: '#dc2626' }]}>
                支出 {formatCurrencyWithDecimals(todayExpenseTotal)}
              </Text>
              <Text style={[styles.sectionLegendDivider, { color: subtle }]}>·</Text>
              <Text style={[styles.sectionLegendText, { color: secondary }]}>
                收入 {formatCurrencyWithDecimals(todayIncomeTotal)}
              </Text>
            </View>
          </View>
          <View style={styles.timelineWrap}>
            <View style={[styles.timelineLine, { backgroundColor: outlineVariant }]} />
            {displayTxns.map((t, idx) => {
              const progress = revealAnim.interpolate({
                inputRange: [0, 0.4, 1],
                outputRange: [0, 0, 1],
              });

              const itemOpacity = progress.interpolate({
                inputRange: [0, 1],
                outputRange: [0, 1],
              });

              const itemTranslateY = progress.interpolate({
                inputRange: [0, 1],
                outputRange: [16 + idx * 5, 0],
              });

              return (
                <TxnItem
                  key={t.id}
                  themeText={text}
                  themeSubtle={subtle}
                  outlineVariant={outlineVariant}
                  item={t}
                  style={{ opacity: itemOpacity, transform: [{ translateY: itemTranslateY }] }}
                />
              );
            })}
            {displayTxns.length === 0 ? (
              <Text style={[styles.txnMeta, { color: subtle }]}>暂无收支明细，去记一笔吧。</Text>
            ) : null}
          </View>
          </Animated.View>
        </View>
      </ScrollView>

      <Animated.View style={[styles.composerWrap, { bottom: baseBottomAnim }]}>
        <Pressable
          onPress={() => setIsSheetVisible(true)}
          style={({ pressed }) => [
            { width: expandedWidth },
            pressed && { opacity: 0.92 },
          ]}>
          <View pointerEvents="none" style={styles.composerShell}>
            <View style={styles.composerRow}>
              <View style={styles.iconBtn}>
                <MaterialIcons name="photo-library" size={20} color="#111827" />
              </View>
              <View style={styles.iconBtn}>
                <MaterialIcons name="photo-camera" size={20} color="#111827" />
              </View>
              <View style={styles.composerInput}>
                <Text style={styles.composerPlaceholder}>记录支出...</Text>
              </View>
              <View style={[styles.actionBtn, styles.voiceBtn]}>
                <MaterialIcons name="keyboard-voice" size={18} color="#fff" />
              </View>
            </View>
          </View>
        </Pressable>
      </Animated.View>

      <Modal visible={isSheetVisible} animationType="slide" transparent onRequestClose={() => setIsSheetVisible(false)}>
        <View style={styles.sheetOverlay}>
          <Pressable style={styles.sheetBackdrop} onPress={() => setIsSheetVisible(false)} />
          <View style={[styles.sheetContainer, { paddingBottom: Math.max(16, insets.bottom) }]}>
            <View style={[styles.sheetHeader, { borderBottomColor: outlineVariant }]}>
              <Pressable onPress={() => setIsSheetVisible(false)} style={({ pressed }) => [styles.sheetCloseBtn, pressed && { opacity: 0.75 }]}>
                <MaterialIcons name="close" size={24} color={subtle} />
              </Pressable>
              <Text style={[styles.sheetTitle, { color: text }]}>{activeSheetTab === 'transfer' ? '财务转账' : '手动记账'}</Text>
              <View style={styles.sheetCloseBtn} />
            </View>

            <View style={[styles.sheetTabs, { borderBottomColor: outlineVariant }]}>
              <Pressable onPress={() => setActiveSheetTab('expense')} style={styles.sheetTabBtn}>
                <Text style={[styles.sheetTabText, activeSheetTab === 'expense' ? { color: tertiary } : { color: subtle }]}>支出</Text>
                {activeSheetTab === 'expense' ? <View style={[styles.sheetTabLine, { backgroundColor: tertiary }]} /> : null}
              </Pressable>
              <Pressable onPress={() => setActiveSheetTab('income')} style={styles.sheetTabBtn}>
                <Text style={[styles.sheetTabText, activeSheetTab === 'income' ? { color: tertiary } : { color: subtle }]}>收入</Text>
                {activeSheetTab === 'income' ? <View style={[styles.sheetTabLine, { backgroundColor: tertiary }]} /> : null}
              </Pressable>
              <Pressable onPress={() => setActiveSheetTab('transfer')} style={styles.sheetTabBtn}>
                <Text style={[styles.sheetTabText, activeSheetTab === 'transfer' ? { color: tertiary } : { color: subtle }]}>转账</Text>
                {activeSheetTab === 'transfer' ? <View style={[styles.sheetTabLine, { backgroundColor: tertiary }]} /> : null}
              </Pressable>
            </View>

            {activeSheetTab === 'transfer' ? (
              <>
                <View style={styles.transferContent}>
                  <View style={styles.transferAccountRow}>
                    <Pressable style={[styles.transferAccountCard, { backgroundColor: isDark ? '#161d2b' : '#faf8ff', borderColor: outlineVariant }]}>
                      <Text style={[styles.transferAccountLabel, { color: subtle }]}>扣款账户</Text>
                      <View style={styles.transferAccountValueRow}>
                        <MaterialIcons name="account-balance-wallet" size={20} color={tertiary} />
                        <Text style={[styles.transferAccountValue, { color: text }]}>活期账户</Text>
                      </View>
                    </Pressable>
                    <View style={styles.transferArrowWrap}>
                      <MaterialIcons name="arrow-right-alt" size={28} color={subtle} />
                    </View>
                    <Pressable style={[styles.transferAccountCard, { backgroundColor: isDark ? '#161d2b' : '#faf8ff', borderColor: outlineVariant }]}>
                      <Text style={[styles.transferAccountLabel, { color: subtle }]}>入账账户</Text>
                      <View style={styles.transferAccountValueRow}>
                        <MaterialIcons name="savings" size={20} color={primary} />
                        <Text style={[styles.transferAccountValue, { color: text }]}>Vault</Text>
                      </View>
                    </Pressable>
                  </View>

                  <View style={styles.transferAmountWrap}>
                    <Text style={[styles.amountYuan, { color: tertiary }]}>¥</Text>
                    <Text style={[styles.transferAmountValue, { color: tertiary }]}>{amountDisplay}</Text>
                  </View>

                  <View style={styles.transferDateWrap}>
                    <Pressable style={[styles.transferDateBtn, { backgroundColor: isDark ? '#161d2b' : '#f2f3ff' }]}>
                      <MaterialIcons name="calendar-today" size={14} color={subtle} />
                      <Text style={[styles.transferDateText, { color: text }]}>{sheetDateLabel}</Text>
                    </Pressable>
                  </View>
                </View>

                <View style={[styles.transferKeypadWrap, { backgroundColor: isDark ? '#161d2b' : '#f2f3ff' }]}>
                  <View style={styles.transferKeypadInner}>
                    <View style={styles.transferNumberGrid}>
                      {['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '00'].map((key) => (
                        <Pressable
                          key={key}
                          onPress={() => handleAmountKeyPress(key)}
                          style={({ pressed }) => [
                            styles.transferNumberBtn,
                            { backgroundColor: surface, borderColor: outlineVariant },
                            pressed && { opacity: 0.86 },
                          ]}>
                          <Text style={[styles.transferNumberText, { color: text }]}>{key}</Text>
                        </Pressable>
                      ))}
                    </View>
                    <View style={styles.transferActionCol}>
                      <Pressable
                        onPress={() => handleAmountKeyPress('backspace')}
                        style={({ pressed }) => [
                          styles.transferBackBtn,
                          { backgroundColor: surface, borderColor: outlineVariant },
                          pressed && { opacity: 0.86 },
                        ]}>
                        <MaterialIcons name="backspace" size={20} color={subtle} />
                      </Pressable>
                      <Pressable
                        onPress={() => handleAmountKeyPress('check')}
                        style={({ pressed }) => [styles.transferCheckBtn, { backgroundColor: tertiary }, pressed && { opacity: 0.9 }]}>
                        <MaterialIcons name="check" size={30} color="#ffffff" />
                      </Pressable>
                    </View>
                  </View>
                </View>
              </>
            ) : (
              <>
                <View style={styles.categoryGrid}>
                  {activeCategories.map((item) => (
                    <Pressable key={item.key} style={styles.categoryItem} onPress={() => {}}>
                      <View style={[styles.categoryIconWrap, { backgroundColor: outlineVariant }]}>
                        <MaterialIcons name={item.icon as keyof typeof MaterialIcons.glyphMap} size={22} color={item.color} />
                      </View>
                      <Text style={[styles.categoryLabel, { color: subtle }]}>{item.label}</Text>
                    </Pressable>
                  ))}
                </View>

                <View style={[styles.sheetInputWrap, { backgroundColor: isDark ? '#161d2b' : '#f2f3ff' }]}>
                  <View style={styles.sheetConfigRow}>
                    <View style={[styles.configChip, { backgroundColor: surface, borderColor: outlineVariant }]}>
                      <MaterialIcons name="calendar-today" size={16} color={subtle} />
                      <Text style={[styles.configChipText, { color: text }]}>{sheetDateLabel}</Text>
                    </View>
                    <View style={[styles.configChip, { backgroundColor: surface, borderColor: outlineVariant }]}>
                      <MaterialIcons name="account-balance-wallet" size={16} color={tertiary} />
                      <Text style={[styles.configChipText, { color: text }]}>支付账户</Text>
                      <MaterialIcons name="expand-more" size={16} color={subtle} />
                    </View>
                    <TextInput
                      value={sheetNote}
                      onChangeText={setSheetNote}
                      style={[styles.noteInput, { color: text }]}
                      placeholder="添加备注..."
                      placeholderTextColor={subtle}
                    />
                  </View>

                  <View style={styles.amountPreview}>
                    <Text style={[styles.amountYuan, { color: tertiary }]}>¥</Text>
                    <Text style={[styles.amountValue, { color: tertiary }]}>{amountDisplay}</Text>
                  </View>

                  <View style={styles.keypad}>
                    {keypadRows.flat().map((key, idx) => {
                      const isDone = key === 'done';
                      const isBackspace = key === 'backspace';
                      const showLabel = isBackspace ? 'backspace' : isDone ? '完成' : key;
                      return (
                        <Pressable
                          key={`${key}-${idx}`}
                          onPress={() => handleAmountKeyPress(key)}
                          style={({ pressed }) => [
                            styles.keypadBtn,
                            isDone
                              ? [styles.keypadDoneBtn, { backgroundColor: tertiary }]
                              : [styles.keypadNormalBtn, { backgroundColor: surface, borderColor: outlineVariant }],
                            key === '0' && idx === 12 ? styles.keypadWideBtn : null,
                            pressed && { opacity: 0.86 },
                          ]}>
                          {isBackspace ? (
                            <MaterialIcons name="backspace" size={20} color={subtle} />
                          ) : (
                            <Text style={isDone ? styles.keypadDoneText : [styles.keypadText, { color: text }]}>{showLabel}</Text>
                          )}
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 0,
  },
  header: {
    borderBottomWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: 60,
  },
  headerInner: {
    height: 48,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerSpacer: {
    width: 40,
    height: 40,
  },
  headerRight: {
    width: 40,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  headerIconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: -0.2,
  },
  content: {
    maxWidth: 420,
    alignSelf: 'center',
    width: '100%',
    paddingHorizontal: 18,
    paddingTop: 16,
    gap: 18,
  },
  netCard: {
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    overflow: 'hidden',
  },
  netAccent: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
  },
  netKicker: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 2.2,
    textTransform: 'uppercase',
    opacity: 0.75,
  },
  netHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  netVisibilityBtn: {
    width: 30,
    height: 30,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  netRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 10,
    flexWrap: 'wrap',
  },
  netValue: {
    fontSize: 44,
    fontWeight: '900',
    letterSpacing: -1.2,
    lineHeight: 48,
  },
  netChange: {
    fontSize: 13,
    fontWeight: '900',
  },
  netDivider: {
    height: 1,
    marginTop: 16,
    marginBottom: 14,
    opacity: 0.65,
  },
  netStats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
    justifyContent: 'space-between',
  },
  netStatCol: {
    width: '47%',
    gap: 6,
  },
  netStatLabel: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.8,
    textTransform: 'uppercase',
    opacity: 0.7,
  },
  netStatValue: {
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: -0.2,
  },
  assetsBtn: {
    marginTop: 16,
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    alignSelf: 'flex-start',
  },
  assetsBtnText: {
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 1.2,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: -0.3,
  },
  sectionMetaRow: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionMetaText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  sectionLegendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  sectionLegendText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  sectionLegendDivider: {
    fontSize: 11,
    fontWeight: '700',
    opacity: 0.7,
  },
  sectionLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 6,
    paddingVertical: 6,
  },
  sectionLinkText: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  carousel: {
    paddingVertical: 10,
    gap: 12,
    paddingRight: 18,
  },
  accountCard: {
    width: 200,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    gap: 10,
  },
  accountCardDark: {
    width: 200,
    borderRadius: 16,
    padding: 16,
    gap: 10,
  },
  accountKicker: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    opacity: 0.85,
  },
  accountValue: {
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: -0.2,
  },
  timelineWrap: {
    paddingTop: 12,
    paddingBottom: 8,
    gap: 18,
  },
  timelineLine: {
    position: 'absolute',
    left: 19,
    top: 14,
    bottom: 0,
    width: 1,
    opacity: 0.8,
  },
  txnItem: {
    flexDirection: 'row',
    gap: 12,
    paddingLeft: 0,
  },
  txnIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    marginLeft: 0,
    zIndex: 2,
  },
  txnMain: {
    flex: 1,
    paddingTop: 2,
    gap: 10,
  },
  txnTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  txnTextCol: {
    flex: 1,
    gap: 4,
  },
  txnTitle: {
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: -0.2,
  },
  txnMeta: {
    fontSize: 11,
    fontWeight: '600',
    opacity: 0.75,
    lineHeight: 15,
  },
  txnAmount: {
    fontSize: 14,
    fontWeight: '900',
  },
  insightTag: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 10,
    opacity: 0.95,
  },
  insightText: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.4,
  },
  composerWrap: {
    position: 'absolute',
    left: 18,
    right: 18,
    alignItems: 'center',
    zIndex: 40,
  },
  composerShell: {
    maxWidth: 420,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
    overflow: 'hidden',
    justifyContent: 'center',
    minHeight: 56,
    borderRadius: 28,
  },
  composerRow: {
    flex: 1,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  composerInput: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  composerPlaceholder: {
    color: '#9ca3af',
    fontSize: 14,
  },
  actionBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  voiceBtn: {
    backgroundColor: '#111827',
  },
  sheetOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  sheetBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  sheetContainer: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    backgroundColor: '#ffffff',
    overflow: 'hidden',
  },
  sheetHeader: {
    paddingHorizontal: 18,
    minHeight: 58,
    borderBottomWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sheetCloseBtn: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  sheetTabs: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    paddingHorizontal: 18,
    gap: 18,
  },
  sheetTabBtn: {
    paddingTop: 12,
    paddingBottom: 10,
  },
  sheetTabText: {
    fontSize: 15,
    fontWeight: '600',
  },
  sheetTabLine: {
    height: 2,
    marginTop: 8,
    borderRadius: 1,
  },
  categoryGrid: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: 16,
  },
  categoryItem: {
    width: '20%',
    alignItems: 'center',
    gap: 6,
  },
  categoryIconWrap: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  sheetInputWrap: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingHorizontal: 14,
    paddingTop: 14,
  },
  sheetConfigRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  configChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 7,
  },
  configChipText: {
    fontSize: 12,
    fontWeight: '600',
  },
  noteInput: {
    flex: 1,
    fontSize: 13,
    paddingHorizontal: 4,
    paddingVertical: 6,
  },
  amountPreview: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'flex-end',
    gap: 2,
    marginBottom: 14,
  },
  amountYuan: {
    fontSize: 28,
    fontWeight: '800',
  },
  amountValue: {
    fontSize: 44,
    fontWeight: '900',
    letterSpacing: -0.8,
  },
  keypad: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingBottom: 4,
  },
  keypadBtn: {
    height: 52,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    width: '23%',
  },
  keypadNormalBtn: {
    borderWidth: 1,
  },
  keypadWideBtn: {
    width: '48.5%',
  },
  keypadDoneBtn: {
    borderWidth: 0,
  },
  keypadText: {
    fontSize: 21,
    fontWeight: '800',
  },
  keypadDoneText: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '800',
  },
  transferContent: {
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 10,
    gap: 20,
  },
  transferAccountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  transferAccountCard: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 14,
    paddingHorizontal: 10,
    alignItems: 'center',
    gap: 6,
  },
  transferAccountLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  transferAccountValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  transferAccountValue: {
    fontSize: 14,
    fontWeight: '700',
  },
  transferArrowWrap: {
    width: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  transferAmountWrap: {
    minHeight: 112,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 2,
  },
  transferAmountValue: {
    fontSize: 56,
    fontWeight: '900',
    letterSpacing: -1,
  },
  transferDateWrap: {
    alignItems: 'center',
    paddingBottom: 2,
  },
  transferDateBtn: {
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  transferDateText: {
    fontSize: 13,
    fontWeight: '600',
  },
  transferKeypadWrap: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 4,
  },
  transferKeypadInner: {
    flexDirection: 'row',
    gap: 8,
  },
  transferNumberGrid: {
    flex: 3,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  transferNumberBtn: {
    width: '30.6%',
    minHeight: 52,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  transferNumberText: {
    fontSize: 22,
    fontWeight: '700',
  },
  transferActionCol: {
    flex: 1,
    gap: 8,
  },
  transferBackBtn: {
    minHeight: 52,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  transferCheckBtn: {
    flex: 1,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
