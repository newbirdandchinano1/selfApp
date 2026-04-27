import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { getFinanceAccountsWithBalance, getFinanceTransactions } from '@/lib/repositories/finance/finance';
import type { FinanceAccountBalanceRow, FinanceTransactionRow } from '@/lib/repositories/finance/finance.types';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import React from 'react';
import { Animated, Dimensions, Easing, Keyboard, Platform, Pressable, ScrollView, StyleProp, StyleSheet, Text, TextInput, View, ViewStyle } from 'react-native';
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

  const txns: Txn[] = [
    {
      id: 't1',
      icon: 'restaurant',
      iconColor: tertiary,
      title: '精致意式晚餐',
      meta: '今天 19:30 · 餐饮 · 招商银行 (8821)',
      amount: '-¥428.00',
      amountColor: text,
      insight: 'AI 洞察：本月餐饮超出平均 12%',
    },
    {
      id: 't2',
      icon: 'shopping-bag',
      iconColor: subtle,
      title: 'Apple Store 订阅',
      meta: '昨天 08:15 · 娱乐 · 现金余额',
      amount: '-¥98.00',
      amountColor: text,
    },
    {
      id: 't3',
      icon: 'savings',
      iconColor: secondary,
      title: '月度工资发放',
      meta: '3天前 · 收入 · 支付宝',
      amount: '+¥45,000.00',
      amountColor: secondary,
      insight: 'AI 洞察：建议将 20% 转入高收益理财',
    },
  ];

  const parseAmount = React.useCallback((amount: string) => {
    const numeric = Number(amount.replace(/[^\d.-]/g, ''));
    return Number.isFinite(numeric) ? numeric : 0;
  }, []);

  const formatCurrencyWithDecimals = React.useCallback((value: number) => {
    return `¥${value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }, []);

  const todayTxns = React.useMemo(() => txns.filter((txn) => txn.meta.includes('今天')), [txns]);
  const todayExpenseTotal = React.useMemo(
    () => todayTxns.reduce((sum, txn) => {
      const amount = parseAmount(txn.amount);
      return amount < 0 ? sum + Math.abs(amount) : sum;
    }, 0),
    [parseAmount, todayTxns]
  );
  const todayIncomeTotal = React.useMemo(
    () => todayTxns.reduce((sum, txn) => {
      const amount = parseAmount(txn.amount);
      return amount > 0 ? sum + amount : sum;
    }, 0),
    [parseAmount, todayTxns]
  );
  const todayLabel = `今日 ${today.getMonth() + 1}月${today.getDate()}日 ${weekdayCn[today.getDay()]}`;

  const collapsedHeight = 56;
  const focusedHeight = 148;
  const collapsedBottom = 6;

  const [inputText, setInputText] = React.useState('');
  const [keyboardOffset, setKeyboardOffset] = React.useState(0);
  const [inputFocused, setInputFocused] = React.useState(false);
  const [voiceMode, setVoiceMode] = React.useState(false);
  const [isRecording, setIsRecording] = React.useState(false);
  const [financeTransactions, setFinanceTransactions] = React.useState<FinanceTransactionRow[]>([]);
  const [financeAccounts, setFinanceAccounts] = React.useState<FinanceAccountBalanceRow[]>([]);
  const [animatedNetValue, setAnimatedNetValue] = React.useState(0);
  const [showNetAmounts, setShowNetAmounts] = React.useState(true);

  const focusAnim = React.useRef(new Animated.Value(0)).current;
  const voiceAnim = React.useRef(new Animated.Value(0)).current;
  const baseBottomAnim = React.useRef(new Animated.Value(collapsedBottom)).current;
  const revealAnim = React.useRef(new Animated.Value(0)).current;
  const recordingPulseAnim = React.useRef(new Animated.Value(0)).current;
  const netValueAnim = React.useRef(new Animated.Value(0)).current;
  const recordingLoopRef = React.useRef<Animated.CompositeAnimation | null>(null);
  const inputRef = React.useRef<TextInput>(null);

  React.useEffect(() => {
    if (Platform.OS === 'ios') {
      const onChange = Keyboard.addListener('keyboardWillChangeFrame', (e) => {
        const screenHeight = Dimensions.get('screen').height;
        const screenY = e.endCoordinates?.screenY ?? screenHeight;
        setKeyboardOffset(Math.max(0, screenHeight - screenY));
      });

      return () => {
        onChange.remove();
      };
    }

    const onShow = Keyboard.addListener('keyboardDidShow', (e) => {
      setKeyboardOffset(e.endCoordinates?.height ?? 0);
    });

    const onHide = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardOffset(0);
    });

    return () => {
      onShow.remove();
      onHide.remove();
    };
  }, []);

  React.useEffect(() => {
    Animated.timing(focusAnim, {
      toValue: inputFocused ? 1 : 0,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [focusAnim, inputFocused]);

  React.useEffect(() => {
    Animated.timing(voiceAnim, {
      toValue: voiceMode ? 1 : 0,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [voiceAnim, voiceMode]);

  React.useEffect(() => {
    const targetBottom =
      keyboardOffset > 0
        ? Platform.OS === 'android'
          ? 0
          : Math.max(0, keyboardOffset - insets.bottom)
        : collapsedBottom;

    Animated.timing(baseBottomAnim, {
      toValue: targetBottom,
      duration: 180,
      easing: Easing.out(Easing.quad),
      useNativeDriver: false,
    }).start();
  }, [baseBottomAnim, collapsedBottom, insets.bottom, keyboardOffset]);

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

  React.useEffect(() => {
    if (isRecording) {
      recordingLoopRef.current?.stop();
      recordingPulseAnim.setValue(0);
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(recordingPulseAnim, {
            toValue: 1,
            duration: 700,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: false,
          }),
          Animated.timing(recordingPulseAnim, {
            toValue: 0,
            duration: 700,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: false,
          }),
        ]),
      );
      recordingLoopRef.current = loop;
      loop.start();
      return;
    }

    recordingLoopRef.current?.stop();
    Animated.timing(recordingPulseAnim, {
      toValue: 0,
      duration: 160,
      useNativeDriver: false,
    }).start();
  }, [isRecording, recordingPulseAnim]);

  React.useEffect(() => {
    return () => {
      recordingLoopRef.current?.stop();
    };
  }, []);

  const handleFocusInput = React.useCallback(() => {
    setVoiceMode(false);
    setInputFocused(true);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  }, []);

  const handleBlurInput = React.useCallback(() => {
    if (!inputText.trim()) {
      setInputFocused(false);
    }
  }, [inputText]);

  const handleSubmit = React.useCallback(() => {
    if (!inputText.trim()) {
      return;
    }
    setInputText('');
    setInputFocused(false);
    setVoiceMode(false);
    Keyboard.dismiss();
  }, [inputText]);

  const handleToggleVoiceMode = React.useCallback(() => {
    if (inputText.trim()) {
      handleSubmit();
      return;
    }
    Keyboard.dismiss();
    setInputFocused(false);
    setVoiceMode((v) => !v);
    setIsRecording(false);
  }, [handleSubmit, inputText]);

  const handleVoicePressIn = React.useCallback(() => {
    setIsRecording(true);
  }, []);

  const handleVoicePressOut = React.useCallback(() => {
    setIsRecording(false);
  }, []);

  const screenWidth = Dimensions.get('window').width;
  const expandedWidth = Math.min(420, screenWidth - 36);

  const composerHeight = focusAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [collapsedHeight, focusedHeight],
  });

  const composerBorderRadius = focusAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [28, 24],
  });

  const inputAreaOpacity = voiceAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 0],
  });

  const voiceCapsuleOpacity = voiceAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
  });

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

  const recordingScale = recordingPulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.03],
  });

  const recordingGlowOpacity = recordingPulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.2, 0.46],
  });

  const formatCurrency = React.useCallback((value: number) => {
    return `¥${value.toLocaleString('zh-CN')}`;
  }, []);

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
        const isIncome = txn.transaction_type === 'income' || txn.amount > 0;
        return isIncome ? sum + Math.abs(txn.amount) : sum;
      }, 0),
    [monthlyTransactions]
  );
  const monthlyExpense = React.useMemo(
    () =>
      monthlyTransactions.reduce((sum, txn) => {
        const isExpense = txn.transaction_type === 'expense' || txn.amount < 0;
        return isExpense ? sum + Math.abs(txn.amount) : sum;
      }, 0),
    [monthlyTransactions]
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
                    onPress={() => router.push('/account-detail')}
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
            {txns.map((t, idx) => {
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
          </View>
          </Animated.View>
        </View>
      </ScrollView>

      <Animated.View style={[styles.composerWrap, { bottom: baseBottomAnim }]}> 
        <Animated.View
          style={[
            styles.composerShell,
            {
              width: expandedWidth,
              height: composerHeight,
              borderRadius: composerBorderRadius,
            },
          ]}>
          <Animated.View style={[styles.composerRow, { opacity: inputAreaOpacity }]}> 
            <Pressable style={({ pressed }) => [styles.iconBtn, pressed && styles.iconBtnPressed]}>
              <MaterialIcons name="photo-library" size={20} color="#111827" />
            </Pressable>

            <Pressable style={({ pressed }) => [styles.iconBtn, pressed && styles.iconBtnPressed]}>
              <MaterialIcons name="photo-camera" size={20} color="#111827" />
            </Pressable>

            <TextInput
              ref={inputRef}
              value={inputText}
              onChangeText={setInputText}
              placeholder="记录支出..."
              placeholderTextColor="#9ca3af"
              style={styles.composerInput}
              returnKeyType="send"
              onSubmitEditing={handleSubmit}
              onFocus={handleFocusInput}
              onBlur={handleBlurInput}
              submitBehavior="submit"
              multiline={inputFocused}
              textAlignVertical={inputFocused ? 'top' : 'center'}
            />

            <Pressable
              onPress={inputFocused || inputText.trim() ? handleSubmit : handleToggleVoiceMode}
              style={({ pressed }) => [
                styles.actionBtn,
                inputFocused || inputText.trim() ? styles.submitBtn : styles.voiceBtn,
                pressed && { opacity: 0.88, transform: [{ scale: 0.97 }] },
              ]}>
              <MaterialIcons
                name={inputFocused || inputText.trim() ? 'north-east' : 'keyboard-voice'}
                size={18}
                color="#fff"
              />
            </Pressable>
          </Animated.View>

          <Animated.View style={[styles.voiceCapsuleWrap, { opacity: voiceCapsuleOpacity }]} pointerEvents={voiceMode ? 'auto' : 'none'}>
            <Animated.View
              style={[
                styles.voiceCapsule,
                isRecording && styles.voiceCapsuleRecording,
                {
                  transform: [{ scale: recordingScale }],
                  shadowOpacity: isRecording ? recordingGlowOpacity : 0,
                },
              ]}>
              <Pressable
                onPressIn={handleVoicePressIn}
                onPressOut={handleVoicePressOut}
                delayLongPress={180}
                onLongPress={handleVoicePressIn}
                style={({ pressed }) => [styles.voiceHoldArea, pressed && { opacity: 0.95 }]}>
                <MaterialIcons name="keyboard-voice" size={18} color="#fff" />
                <Text style={styles.voiceCapsuleText}>{isRecording ? '录音中，松开发送' : '长按说话'}</Text>
              </Pressable>

              <Pressable
                onPress={() => {
                  setVoiceMode(false);
                  setIsRecording(false);
                }}
                style={({ pressed }) => [styles.voiceBackBtn, pressed && { opacity: 0.82 }]}>
                <MaterialIcons name="keyboard-arrow-right" size={18} color="#fff" />
              </Pressable>
            </Animated.View>
          </Animated.View>
        </Animated.View>
      </Animated.View>
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
  iconBtnPressed: {
    backgroundColor: '#f3f4f6',
  },
  composerInput: {
    flex: 1,
    color: '#111827',
    fontSize: 14,
    paddingVertical: 8,
    paddingHorizontal: 10,
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
  submitBtn: {
    backgroundColor: '#2563eb',
  },
  voiceCapsuleWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  voiceCapsule: {
    width: '100%',
    borderRadius: 999,
    backgroundColor: '#10b981',
    minHeight: 44,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    shadowColor: '#10b981',
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  voiceBackBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  voiceHoldArea: {
    flex: 1,
    minHeight: 36,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  voiceCapsuleRecording: {
    backgroundColor: '#059669',
  },
  voiceCapsuleText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
});
