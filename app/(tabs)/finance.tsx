import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { FINANCE_ACCOUNT_ICON_OPTIONS } from '@/lib/constants/finance-account-icons';
import {
  getMonthKey,
  loadMonthBudgetSettings,
  persistMonthBudgetSettings,
  type MonthBudgetSetting,
} from '@/lib/finance-monthly-budget';
import {
  createFinanceTransaction,
  deleteFinanceTransaction,
  getFinanceAccountsWithBalance,
  getFinanceTransactions,
} from '@/lib/repositories/finance/finance';
import { isFinanceAccountExcludedFromAggregates } from '@/lib/repositories/finance/finance-account-extra';
import { isFinanceTransactionExcludedFromBudget } from '@/lib/repositories/finance/finance-transaction-extra';
import type { FinanceAccountBalanceRow, FinanceTransactionRow } from '@/lib/repositories/finance/finance.types';
import { MaterialIcons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import React from 'react';
import {
  Alert,
  Animated,
  Dimensions,
  Easing,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleProp,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  ViewStyle,
} from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import Constants from 'expo-constants';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Swipeable } from 'react-native-gesture-handler';

type SpeechRecognitionApi = typeof import('@jamsch/expo-speech-recognition');

type Txn = {
  id: string;
  dayKey: string;
  icon: keyof typeof MaterialIcons.glyphMap;
  iconColor: string;
  title: string;
  meta: string;
  amount: string;
  amountColor: string;
  insight?: string;
};

type SheetTab = 'expense' | 'income' | 'transfer';

/** 与 `getFinanceAccountsWithBalance` 中按账户汇总 balance 的规则一致：收入 +、支出 -、转账 0。 */
function getTxnNetWorthTotalDelta(txn: FinanceTransactionRow): number {
  if (txn.transaction_type === 'income') return Math.abs(txn.amount);
  if (txn.transaction_type === 'expense') return -Math.abs(txn.amount);
  return 0;
}

function parseFinanceDayKey(dayKey: string): { y: number; m: number; d: number } | null {
  const m = dayKey.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
  return { y, m: mo, d };
}

type SheetCategory = {
  key: string;
  icon: keyof typeof MaterialIcons.glyphMap;
  label: string;
  color: string;
};

function TxnItem({
  themeText,
  themeSubtle,
  outlineVariant,
  item,
  style,
  onPress,
}: {
  themeText: string;
  themeSubtle: string;
  outlineVariant: string;
  item: Txn;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
}) {
  const inner = (
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

  if (onPress) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => [pressed && { opacity: 0.88 }]}>
        {inner}
      </Pressable>
    );
  }

  return inner;
}

export default function FinanceScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const themeKey: keyof typeof Colors = colorScheme === 'dark' ? 'dark' : 'light';
  const baseTheme = Colors[themeKey];

  const isDark = themeKey === 'dark';

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
    const prefix = value < 0 ? '-¥' : '¥';
    return `${prefix}${Math.abs(value).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }, []);
  const todayLabel = `今日 ${today.getMonth() + 1}月${today.getDate()}日 ${weekdayCn[today.getDay()]}`;

  const collapsedBottom = 6;
  const [isSheetVisible, setIsSheetVisible] = React.useState(false);
  const [activeSheetTab, setActiveSheetTab] = React.useState<SheetTab>('expense');
  const [sheetAmount, setSheetAmount] = React.useState('');
  const [sheetNote, setSheetNote] = React.useState('');
  const [selectedCategoryKey, setSelectedCategoryKey] = React.useState('food');
  const [selectedAccountId, setSelectedAccountId] = React.useState<string | null>(null);
  const [selectedHappenedAt, setSelectedHappenedAt] = React.useState(() => new Date());
  const [isDatePickerVisible, setIsDatePickerVisible] = React.useState(false);
  const [isTimePickerVisible, setIsTimePickerVisible] = React.useState(false);
  const [isAccountPickerVisible, setIsAccountPickerVisible] = React.useState(false);
  const [isSavingTransaction, setIsSavingTransaction] = React.useState(false);
  const [financeTransactions, setFinanceTransactions] = React.useState<FinanceTransactionRow[]>([]);
  const [financeAccounts, setFinanceAccounts] = React.useState<FinanceAccountBalanceRow[]>([]);
  const [showNetAmounts, setShowNetAmounts] = React.useState(true);
  const [budgetCardNetExpanded, setBudgetCardNetExpanded] = React.useState(false);
  const [monthBudgetSettings, setMonthBudgetSettings] = React.useState<Record<string, MonthBudgetSetting>>({});
  const [isBudgetAdjustVisible, setIsBudgetAdjustVisible] = React.useState(false);
  const [budgetBaseDraft, setBudgetBaseDraft] = React.useState('');
  const [modalIncludeLast, setModalIncludeLast] = React.useState(false);
  const [visibleDayCount, setVisibleDayCount] = React.useState(1);
  const [isLoadingMoreDays, setIsLoadingMoreDays] = React.useState(false);
  const [sheetImageUris, setSheetImageUris] = React.useState<string[]>([]);
  /** 支出是否计入本月预算（收入页不展示该项，保存时也不会写入排除标记） */
  const [sheetIncludeInBudget, setSheetIncludeInBudget] = React.useState(true);
  const [isPickingImage, setIsPickingImage] = React.useState(false);
  const [isSpeechRecognizing, setIsSpeechRecognizing] = React.useState(false);
  const [speechApi, setSpeechApi] = React.useState<SpeechRecognitionApi | null>(null);
  const [speechApiStatus, setSpeechApiStatus] = React.useState<'loading' | 'ready' | 'unavailable'>('unavailable');
  const [speechTriedOnce, setSpeechTriedOnce] = React.useState(false);
  const budgetBaseInputRef = React.useRef<TextInput>(null);

  const baseBottomAnim = React.useRef(new Animated.Value(collapsedBottom)).current;
  const revealAnim = React.useRef(new Animated.Value(0)).current;

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

  const handleDeleteFinanceTxn = React.useCallback(
    (txnId: string, displayTitle: string) => {
      const label = displayTitle.trim() || '该笔记录';
      Alert.alert('删除记录', `确定删除「${label}」吗？`, [
        { text: '取消', style: 'cancel' },
        {
          text: '删除',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteFinanceTransaction(txnId);
              await Promise.all([loadFinanceTransactions(), loadFinanceAccounts()]);
            } catch (error) {
              console.warn('Failed to delete finance transaction:', error);
              Alert.alert('删除失败', '请稍后重试。');
            }
          },
        },
      ]);
    },
    [loadFinanceAccounts, loadFinanceTransactions],
  );

  React.useEffect(() => {
    void loadFinanceTransactions();
    void loadFinanceAccounts();
  }, [loadFinanceAccounts, loadFinanceTransactions]);

  React.useEffect(() => {
    void loadMonthBudgetSettings().then(setMonthBudgetSettings);
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      void loadFinanceTransactions();
      void loadFinanceAccounts();
      void loadMonthBudgetSettings().then(setMonthBudgetSettings);
    }, [loadFinanceAccounts, loadFinanceTransactions])
  );

  const speechSubsRef = React.useRef<Array<{ remove?: () => void }>>([]);
  const clearSpeechSubs = React.useCallback(() => {
    speechSubsRef.current.forEach((s) => s.remove?.());
    speechSubsRef.current = [];
  }, []);

  const screenWidth = Dimensions.get('window').width;
  const expandedWidth = Math.min(420, screenWidth - 36);

  /** 手动记账弹窗：不超过安全区顶部以下，避免顶栏关闭按钮被挡 */
  const manualSheetMaxHeight = React.useMemo(() => Dimensions.get('window').height - insets.top - 10, [insets.top]);
  /** 顶栏 + Tab 区域估算高度，余量给下方可滚动内容 */
  const MANUAL_SHEET_CHROME_HEIGHT = 124;
  const manualSheetBodyMaxHeight = React.useMemo(
    () => Math.max(200, manualSheetMaxHeight - MANUAL_SHEET_CHROME_HEIGHT),
    [manualSheetMaxHeight]
  );

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

  const getDayKey = React.useCallback((value: Date) => {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }, []);

  const accountNameMap = React.useMemo(() => {
    return new Map(financeAccounts.map((account) => [account.id, account.name]));
  }, [financeAccounts]);
  const accountExtraMap = React.useMemo(() => {
    return new Map(
      financeAccounts.map((account) => {
        let extra: Record<string, unknown> | null = null;
        if (account.extra_data) {
          try {
            const raw = JSON.parse(account.extra_data) as unknown;
            if (raw && typeof raw === 'object') {
              extra = raw as Record<string, unknown>;
            }
          } catch {
            extra = null;
          }
        }
        return [account.id, extra];
      })
    );
  }, [financeAccounts]);
  const accountSignRuleMap = React.useMemo(() => {
    return new Map(financeAccounts.map((account) => [account.id, account.sign_rule]));
  }, [financeAccounts]);

  const getTxnDisplayAmount = React.useCallback((txn: FinanceTransactionRow) => {
    const absAmount = Math.abs(txn.amount);
    if (txn.transaction_type === 'income') return absAmount;
    if (txn.transaction_type === 'expense') return -absAmount;
    return txn.amount;
  }, []);

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

  const todayBudgetExpenseTotal = React.useMemo(
    () =>
      todayTxns.reduce((sum, txn) => {
        const displayAmount = getTxnDisplayAmount(txn);
        if (displayAmount >= 0) return sum;
        if (isFinanceTransactionExcludedFromBudget(txn.extra_data)) return sum;
        return sum + Math.abs(displayAmount);
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

  const sortedTransactions = React.useMemo(() => {
    return [...financeTransactions].sort((a, b) => {
      const aTime = new Date(a.happened_at).getTime();
      const bTime = new Date(b.happened_at).getTime();
      return bTime - aTime;
    });
  }, [financeTransactions]);
  const todayDayKey = React.useMemo(() => getDayKey(today), [getDayKey, today]);
  const sortedDayKeys = React.useMemo(() => {
    const keys = new Set<string>();
    sortedTransactions.forEach((txn) => {
      const happenedAt = new Date(txn.happened_at);
      if (!Number.isNaN(happenedAt.getTime()) && happenedAt <= today) {
        keys.add(getDayKey(happenedAt));
      }
    });
    return Array.from(keys);
  }, [getDayKey, sortedTransactions, today]);
  const historyDayKeys = React.useMemo(() => sortedDayKeys.filter((k) => k !== todayDayKey), [sortedDayKeys, todayDayKey]);
  const hasMoreHistoryDays = visibleDayCount < historyDayKeys.length;
  const visibleDayKeySet = React.useMemo(() => {
    if (historyDayKeys.length === 0) {
      return new Set<string>();
    }
    return new Set(historyDayKeys.slice(0, visibleDayCount));
  }, [historyDayKeys, visibleDayCount]);

  React.useEffect(() => {
    setVisibleDayCount(1);
    setIsLoadingMoreDays(false);
  }, [todayDayKey, financeTransactions.length]);

  const loadMoreHistoryDays = React.useCallback(() => {
    if (!hasMoreHistoryDays || isLoadingMoreDays) {
      return;
    }
    setIsLoadingMoreDays(true);
    setVisibleDayCount((prev) => Math.min(prev + 1, historyDayKeys.length));
    setIsLoadingMoreDays(false);
  }, [hasMoreHistoryDays, historyDayKeys.length, isLoadingMoreDays]);

  const handleMainScroll = React.useCallback(
    (event: { nativeEvent: { contentOffset: { y: number }; layoutMeasurement: { height: number }; contentSize: { height: number } } }) => {
      if (!hasMoreHistoryDays || isLoadingMoreDays) {
        return;
      }
      const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
      const distanceToBottom = contentSize.height - (contentOffset.y + layoutMeasurement.height);
      if (distanceToBottom < 80) {
        loadMoreHistoryDays();
      }
    },
    [hasMoreHistoryDays, isLoadingMoreDays, loadMoreHistoryDays]
  );

  const todayDisplayTxns = React.useMemo<Txn[]>(() => {
    return todayTxns
      .slice()
      .sort((a, b) => new Date(b.happened_at).getTime() - new Date(a.happened_at).getTime())
      .map((txn) => {
        const happenedAt = new Date(txn.happened_at);
        const hour = Number.isNaN(happenedAt.getTime()) ? '00' : String(happenedAt.getHours()).padStart(2, '0');
        const minute = Number.isNaN(happenedAt.getTime()) ? '00' : String(happenedAt.getMinutes()).padStart(2, '0');
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
          dayKey: todayDayKey,
          icon,
          iconColor,
          title: txn.name?.trim() || '交易',
          meta: `今天 ${hour}:${minute} · ${typeLabel} · ${accountLabel}`,
          amount: `${amountPrefix}${formatCurrencyWithDecimals(Math.abs(displayAmount))}`,
          amountColor,
          insight: txn.ai_comment?.trim() ? `AI 洞察：${txn.ai_comment.trim()}` : undefined,
        };
      });
  }, [accountNameMap, formatCurrencyWithDecimals, getTxnDisplayAmount, secondary, subtle, tertiary, text, todayDayKey, todayTxns]);

  const historySections = React.useMemo(() => {
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayDayKey = getDayKey(yesterday);
    const weekdayCnLocal = weekdayCn;

    const sectionMap = new Map<
      string,
      {
        dayKey: string;
        date: Date;
        label: string;
        shortLabel: string;
        income: number;
        expense: number;
        items: Txn[];
      }
    >();

    const upsert = (dayKey: string, date: Date) => {
      const existing = sectionMap.get(dayKey);
      if (existing) return existing;
      const isYesterday = dayKey === yesterdayDayKey;
      const label = isYesterday ? '昨天' : `${date.getMonth() + 1}月${date.getDate()}日 ${weekdayCnLocal[date.getDay()]}`;
      const shortLabel = isYesterday ? '昨天' : `${date.getMonth() + 1}/${date.getDate()}`;
      const created = { dayKey, date, label, shortLabel, income: 0, expense: 0, items: [] as Txn[] };
      sectionMap.set(dayKey, created);
      return created;
    };

    sortedTransactions.forEach((txn) => {
      const happenedAt = new Date(txn.happened_at);
      if (Number.isNaN(happenedAt.getTime())) return;
      const dayKey = getDayKey(happenedAt);
      if (dayKey === todayDayKey) return;
      if (!visibleDayKeySet.has(dayKey)) return;

      const section = upsert(dayKey, happenedAt);
      const displayAmount = getTxnDisplayAmount(txn);
      if (displayAmount > 0) section.income += Math.abs(displayAmount);
      if (displayAmount < 0) section.expense += Math.abs(displayAmount);

      const hour = String(happenedAt.getHours()).padStart(2, '0');
      const minute = String(happenedAt.getMinutes()).padStart(2, '0');
      const accountLabel = accountNameMap.get(txn.account_id) ?? '未知账户';

      const isIncome = displayAmount > 0;
      const isExpense = displayAmount < 0;
      const typeLabel = txn.transaction_type === 'transfer' ? '转账' : isIncome ? '收入' : '支出';
      const icon: keyof typeof MaterialIcons.glyphMap = isIncome ? 'savings' : isExpense ? 'shopping-bag' : 'sync-alt';
      const iconColor = isIncome ? secondary : isExpense ? tertiary : subtle;
      const amountColor = isIncome ? secondary : isExpense ? '#dc2626' : text;
      const amountPrefix = isIncome ? '+' : isExpense ? '-' : '';

      section.items.push({
        id: txn.id,
        dayKey,
        icon,
        iconColor,
        title: txn.name?.trim() || '交易',
        meta: `${section.label} ${hour}:${minute} · ${typeLabel} · ${accountLabel}`,
        amount: `${amountPrefix}${formatCurrencyWithDecimals(Math.abs(displayAmount))}`,
        amountColor,
        insight: txn.ai_comment?.trim() ? `AI 洞察：${txn.ai_comment.trim()}` : undefined,
      });
    });

    // 保持分组顺序：按日期从近到远（和 sortedTransactions 一致）
    return Array.from(sectionMap.values()).sort((a, b) => b.date.getTime() - a.date.getTime());
  }, [
    accountNameMap,
    formatCurrencyWithDecimals,
    getDayKey,
    getTxnDisplayAmount,
    secondary,
    sortedTransactions,
    subtle,
    tertiary,
    text,
    todayDayKey,
    visibleDayKeySet,
    weekdayCn,
  ]);

  const displayTxns = React.useMemo<Txn[]>(() => {
    const now = new Date();
    const currentYmd = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayYmd = `${yesterday.getFullYear()}-${yesterday.getMonth()}-${yesterday.getDate()}`;

    return sortedTransactions
      .filter((txn) => {
        const happenedAt = new Date(txn.happened_at);
        if (Number.isNaN(happenedAt.getTime())) return false;
        if (getDayKey(happenedAt) === todayDayKey) return false;
        return visibleDayKeySet.has(getDayKey(happenedAt));
      })
      .map((txn) => {
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
        dayKey: getDayKey(happenedAt),
        icon,
        iconColor,
        title: txn.name?.trim() || '交易',
        meta: `${dayLabel} ${hour}:${minute} · ${typeLabel} · ${accountLabel}`,
        amount: `${amountPrefix}${formatCurrencyWithDecimals(Math.abs(displayAmount))}`,
        amountColor,
        insight: txn.ai_comment?.trim() ? `AI 洞察：${txn.ai_comment.trim()}` : undefined,
      };
    });
  }, [accountNameMap, formatCurrencyWithDecimals, getDayKey, getTxnDisplayAmount, secondary, sortedTransactions, subtle, tertiary, text, todayDayKey, visibleDayKeySet]);

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

  const monthlyBudgetExpense = React.useMemo(
    () =>
      monthlyTransactions.reduce((sum, txn) => {
        const displayAmount = getTxnDisplayAmount(txn);
        if (displayAmount >= 0) return sum;
        if (isFinanceTransactionExcludedFromBudget(txn.extra_data)) return sum;
        return sum + Math.abs(displayAmount);
      }, 0),
    [getTxnDisplayAmount, monthlyTransactions]
  );
  const monthlySurplus = monthlyIncome - monthlyExpense;
  const savingsRate = monthlyIncome > 0 ? (monthlySurplus / monthlyIncome) * 100 : 0;

  const calendarAnchor = `${today.getFullYear()}-${today.getMonth()}`;
  const prevMonthTransactions = React.useMemo(() => {
    const y = today.getFullYear();
    const m = today.getMonth();
    const start = new Date(y, m - 1, 1);
    const end = new Date(y, m, 1);
    return financeTransactions.filter((txn) => {
      const happenedAt = new Date(txn.happened_at);
      return happenedAt >= start && happenedAt < end;
    });
  }, [financeTransactions, calendarAnchor]);
  const prevMonthIncome = React.useMemo(
    () =>
      prevMonthTransactions.reduce((sum, txn) => {
        const displayAmount = getTxnDisplayAmount(txn);
        return displayAmount > 0 ? sum + Math.abs(displayAmount) : sum;
      }, 0),
    [getTxnDisplayAmount, prevMonthTransactions]
  );
  const prevMonthExpense = React.useMemo(
    () =>
      prevMonthTransactions.reduce((sum, txn) => {
        const displayAmount = getTxnDisplayAmount(txn);
        return displayAmount < 0 ? sum + Math.abs(displayAmount) : sum;
      }, 0),
    [getTxnDisplayAmount, prevMonthTransactions]
  );
  const lastMonthRemaining = Math.max(0, prevMonthIncome - prevMonthExpense);

  const hiddenAmountText = '****';
  const monthlyIncomeText = showNetAmounts ? formatCurrencyWithDecimals(monthlyIncome) : hiddenAmountText;
  const monthlyExpenseText = showNetAmounts ? formatCurrencyWithDecimals(monthlyExpense) : hiddenAmountText;
  const monthlySurplusText = showNetAmounts ? formatCurrencyWithDecimals(monthlySurplus) : hiddenAmountText;
  const monthlySurplusColor = monthlySurplus > 0 ? secondary : monthlySurplus < 0 ? '#dc2626' : text;
  const savingRateText = showNetAmounts ? `${savingsRate.toFixed(1)}%` : '--';

  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const dayOfMonth = today.getDate();
  const daysLeftIncludingToday = Math.max(1, daysInMonth - dayOfMonth + 1);
  const currentMonthKey = getMonthKey(today);
  const budgetSheetMonthNumber = parseInt(currentMonthKey.split('-')[1] ?? '1', 10);
  const persistedBudgetSetting = monthBudgetSettings[currentMonthKey];
  const effectiveBaseBudget =
    currentMonthKey in monthBudgetSettings ? monthBudgetSettings[currentMonthKey]!.baseAmount : 0;
  const includeLastBalanceEffective = persistedBudgetSetting?.includeLastBalance ?? false;
  const budgetTotalAmount = includeLastBalanceEffective
    ? effectiveBaseBudget + lastMonthRemaining
    : effectiveBaseBudget;
  const parsedBudgetDraft = parseFloat(budgetBaseDraft.trim().replace(/,/g, ''));
  const baseForBudgetPreview =
    Number.isFinite(parsedBudgetDraft) && parsedBudgetDraft >= 0 ? parsedBudgetDraft : effectiveBaseBudget;
  const budgetPreviewTotal = modalIncludeLast ? baseForBudgetPreview + lastMonthRemaining : baseForBudgetPreview;
  const budgetSurplusAmount = budgetTotalAmount - monthlyBudgetExpense;
  const budgetUsedPercentRaw = budgetTotalAmount > 0 ? (monthlyBudgetExpense / budgetTotalAmount) * 100 : 0;
  const budgetUsedPercent = Math.min(100, Math.max(0, budgetUsedPercentRaw));
  const dailyBudgetAmount =
    monthlyIncome > 0
      ? monthlyIncome / daysInMonth
      : budgetSurplusAmount > 0
        ? budgetSurplusAmount / daysLeftIncludingToday
        : budgetTotalAmount / daysLeftIncludingToday;
  const todayAvailableAmount = Math.max(0, dailyBudgetAmount - todayBudgetExpenseTotal);
  const todayBudgetUsagePct = dailyBudgetAmount > 0 ? Math.min(1, todayBudgetExpenseTotal / dailyBudgetAmount) : 0;

  /** 净资产汇总：排除标记为「不计入总资产/总负债」的账户，与资产页 hero、账户详情开关一致 */
  const netTotalForTrend = React.useMemo(
    () =>
      financeAccounts.reduce((sum, account) => {
        if (isFinanceAccountExcludedFromAggregates(account.extra_data)) return sum;
        return sum + account.balance;
      }, 0),
    [financeAccounts],
  );
  const netWorthTrendDayKey = getDayKey(today);
  const netTrendSeries = React.useMemo(() => {
    const DAYS = 30;
    const parsed = parseFinanceDayKey(netWorthTrendDayKey);
    if (!parsed) {
      return Array.from({ length: DAYS }, () => netTotalForTrend);
    }
    const { y: y0, m: m0, d: d0 } = parsed;

    const txns = financeTransactions
      .map((t) => {
        const ms = new Date(t.happened_at).getTime();
        return { ms, d: getTxnNetWorthTotalDelta(t) };
      })
      .filter((x) => Number.isFinite(x.ms));

    txns.sort((a, b) => b.ms - a.ms);

    const raw: number[] = [];
    let ti = 0;
    let suffix = 0;

    for (let offset = 0; offset < DAYS; offset++) {
      const d = new Date(y0, m0, d0 - offset);
      const nextDayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0).getTime();

      while (ti < txns.length && txns[ti].ms >= nextDayStart) {
        suffix += txns[ti].d;
        ti++;
      }
      raw.push(netTotalForTrend - suffix);
    }

    return raw.reverse();
  }, [financeTransactions, netTotalForTrend, netWorthTrendDayKey]);

  /** 与 Svg viewBox 一致；inset 需 ≥ 终点圆点半径 + 描边，避免裁切/溢出卡片。 */
  const trendChartPathD = React.useMemo(() => {
    const w = 272;
    const h = 44;
    const inset = 10;
    const vals = netTrendSeries;
    if (vals.length < 2) return '';
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const span = max - min || 1;
    const innerW = w - inset * 2;
    const innerH = h - inset * 2;
    return vals
      .map((v, i) => {
        const x = inset + (i / (vals.length - 1)) * innerW;
        const y = inset + (1 - (v - min) / span) * innerH;
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }, [netTrendSeries]);

  const trendChartLastPoint = React.useMemo(() => {
    const w = 272;
    const h = 44;
    const inset = 10;
    const vals = netTrendSeries;
    if (vals.length < 2) return { x: w / 2, y: h / 2 };
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const span = max - min || 1;
    const innerW = w - inset * 2;
    const innerH = h - inset * 2;
    const v = vals[vals.length - 1];
    const i = vals.length - 1;
    const x = inset + (i / (vals.length - 1)) * innerW;
    const y = inset + (1 - (v - min) / span) * innerH;
    return { x, y };
  }, [netTrendSeries]);

  const formatCurrencyBalance = React.useCallback(
    (value: number) => {
      if (!showNetAmounts) return hiddenAmountText;
      const prefix = value < 0 ? '-¥' : '¥';
      return `${prefix}${Math.abs(value).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    },
    [showNetAmounts]
  );

  const accountIcon = React.useCallback(
    (account: FinanceAccountBalanceRow): keyof typeof MaterialIcons.glyphMap => {
      const extra = accountExtraMap.get(account.id);
      const iconKey = extra && typeof extra.ui_icon_key === 'string' ? extra.ui_icon_key : undefined;
      if (iconKey && iconKey.length > 0) {
        const matchedIcon = FINANCE_ACCOUNT_ICON_OPTIONS.find((item) => item.key === iconKey)?.icon;
        if (matchedIcon) return matchedIcon;
        if (iconKey in MaterialIcons.glyphMap) {
          return iconKey as keyof typeof MaterialIcons.glyphMap;
        }
      }
      const name = account.name;
      if (name.includes('现金')) return 'payments';
      if (name.includes('支付宝')) return 'account-balance-wallet';
      if (name.includes('微信')) return 'chat';
      if (name.includes('银行')) return 'account-balance';
      return 'account-balance-wallet';
    },
    [accountExtraMap]
  );

  const expenseCategories = React.useMemo<SheetCategory[]>(
    () => [
      { key: 'food', icon: 'restaurant', label: '餐饮', color: primary },
      { key: 'snack', icon: 'icecream', label: '零食', color: secondary },
      { key: 'fruit', icon: 'eco', label: '水果', color: tertiary },
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

  const incomeCategories = React.useMemo<SheetCategory[]>(
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

  const activeCategories = activeSheetTab === 'income' ? incomeCategories : expenseCategories;
  const selectedCategory = React.useMemo(() => {
    return activeCategories.find((item) => item.key === selectedCategoryKey) ?? activeCategories[0];
  }, [activeCategories, selectedCategoryKey]);
  const selectedAccount = React.useMemo(() => {
    return financeAccounts.find((account) => account.id === selectedAccountId) ?? financeAccounts[0] ?? null;
  }, [financeAccounts, selectedAccountId]);
  const sheetDateLabel = `${selectedHappenedAt.getMonth() + 1}月${selectedHappenedAt.getDate()}日`;
  const sheetTimeLabel = `${String(selectedHappenedAt.getHours()).padStart(2, '0')}:${String(selectedHappenedAt.getMinutes()).padStart(2, '0')}`;
  const hasAccounts = financeAccounts.length > 0;
  const amountNumber = Number(sheetAmount);
  const canSaveTransaction = Boolean(selectedAccount) && Number.isFinite(amountNumber) && amountNumber > 0 && !isSavingTransaction;
  const amountDisplay = sheetAmount ? Number(sheetAmount).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00';

  React.useEffect(() => {
    if (!selectedAccountId && financeAccounts[0]) {
      setSelectedAccountId(financeAccounts[0].id);
    }
  }, [financeAccounts, selectedAccountId]);

  React.useEffect(() => {
    if (activeSheetTab === 'expense' && !expenseCategories.some((item) => item.key === selectedCategoryKey)) {
      setSelectedCategoryKey(expenseCategories[0]?.key ?? 'food');
    }
    if (activeSheetTab === 'income' && !incomeCategories.some((item) => item.key === selectedCategoryKey)) {
      setSelectedCategoryKey(incomeCategories[0]?.key ?? 'salary');
    }
  }, [activeSheetTab, expenseCategories, incomeCategories, selectedCategoryKey]);

  const resetSheetForm = React.useCallback((nextTab: SheetTab = 'expense') => {
    speechApi?.ExpoSpeechRecognitionModule.stop();
    setActiveSheetTab(nextTab);
    setSheetAmount('');
    setSheetNote('');
    setSheetImageUris([]);
    setSheetIncludeInBudget(true);
    setSelectedHappenedAt(new Date());
    setIsDatePickerVisible(false);
    setIsTimePickerVisible(false);
    setIsAccountPickerVisible(false);
    setSelectedCategoryKey(nextTab === 'income' ? 'salary' : 'food');
  }, []);

  const closeSheet = React.useCallback(() => {
    if (isSavingTransaction) return;
    speechApi?.ExpoSpeechRecognitionModule.stop();
    setIsDatePickerVisible(false);
    setIsTimePickerVisible(false);
    setIsAccountPickerVisible(false);
    setIsSheetVisible(false);
  }, [isSavingTransaction, speechApi]);

  const closeBudgetAdjust = React.useCallback(() => {
    setIsBudgetAdjustVisible(false);
  }, []);

  const openBudgetAdjust = React.useCallback(() => {
    const row = monthBudgetSettings[currentMonthKey];
    const base = row ? row.baseAmount : 0;
    const inc = row?.includeLastBalance ?? false;
    setBudgetBaseDraft(base.toFixed(2));
    setModalIncludeLast(inc);
    setIsBudgetAdjustVisible(true);
  }, [monthBudgetSettings, currentMonthKey]);

  const handleSaveBudgetAdjust = React.useCallback(() => {
    const normalized = budgetBaseDraft.trim().replace(/,/g, '');
    const n = parseFloat(normalized);
    if (!Number.isFinite(n) || n < 0) {
      Alert.alert('金额无效', '请输入大于等于 0 的月预算基数。');
      return;
    }
    setMonthBudgetSettings((prev) => {
      const next = {
        ...prev,
        [currentMonthKey]: { baseAmount: n, includeLastBalance: modalIncludeLast },
      };
      void persistMonthBudgetSettings(next);
      return next;
    });
    setIsBudgetAdjustVisible(false);
  }, [budgetBaseDraft, currentMonthKey, modalIncludeLast]);

  const handleResetBudgetAdjust = React.useCallback(() => {
    setMonthBudgetSettings((prev) => {
      if (!(currentMonthKey in prev)) return prev;
      const next = { ...prev };
      delete next[currentMonthKey];
      void persistMonthBudgetSettings(next);
      return next;
    });
    setIsBudgetAdjustVisible(false);
  }, [currentMonthKey]);

  const handleSelectAccount = React.useCallback((accountId: string) => {
    setSelectedAccountId(accountId);
    setIsAccountPickerVisible(false);
  }, []);

  const handleDatePickerChange = React.useCallback((event: { type?: string }, date?: Date) => {
    if (Platform.OS === 'android' && event?.type === 'dismissed') {
      setIsDatePickerVisible(false);
      return;
    }
    if (date) {
      setSelectedHappenedAt((prev) => {
        const next = new Date(prev);
        next.setFullYear(date.getFullYear(), date.getMonth(), date.getDate());
        return next;
      });
      if (Platform.OS !== 'ios') setIsDatePickerVisible(false);
    }
  }, []);

  const handleTimePickerChange = React.useCallback((event: { type?: string }, date?: Date) => {
    if (Platform.OS === 'android' && event?.type === 'dismissed') {
      setIsTimePickerVisible(false);
      return;
    }
    if (date) {
      setSelectedHappenedAt((prev) => {
        const next = new Date(prev);
        next.setHours(date.getHours(), date.getMinutes(), 0, 0);
        return next;
      });
      if (Platform.OS !== 'ios') setIsTimePickerVisible(false);
    }
  }, []);

  const handleChangeSheetDate = React.useCallback((deltaDays: number) => {
    setSelectedHappenedAt((prev) => {
      const next = new Date(prev);
      next.setDate(next.getDate() + deltaDays);
      return next;
    });
  }, []);

  const handleChangeSheetTime = React.useCallback((deltaHours: number, deltaMinutes = 0) => {
    setSelectedHappenedAt((prev) => {
      const next = new Date(prev);
      next.setHours(next.getHours() + deltaHours);
      next.setMinutes(next.getMinutes() + deltaMinutes);
      next.setSeconds(0, 0);
      return next;
    });
  }, []);

  const handleAmountKeyPress = React.useCallback((key: string) => {
    if (key === 'backspace') {
      setSheetAmount((prev) => prev.slice(0, -1));
      return;
    }
    if (key === 'done' || key === 'check') {
      return;
    }
    setSheetAmount((prev) => {
      if (key === '+' || key === '-') return prev;
      if (key === '.') {
        return prev.includes('.') ? prev : `${prev || '0'}.`;
      }
      const next = `${prev}${key}`;
      const normalized = next.replace(/^0+(?=\d)/, '');
      const [, decimals = ''] = normalized.split('.');
      if (decimals.length > 2) return prev;
      if (Number(normalized) > 99999999.99) return prev;
      return normalized;
    });
  }, []);

  const handleSaveTransaction = React.useCallback(async () => {
    // 保存前停止语音，避免异步识别结果覆盖输入框
    speechApi?.ExpoSpeechRecognitionModule.stop();
    if (!selectedAccount) {
      Alert.alert('请选择账户', '需要选择一个可用账户后才能记账。');
      return;
    }
    if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
      Alert.alert('请输入金额', '记账金额需要大于 0。');
      return;
    }
    if (activeSheetTab === 'transfer') {
      Alert.alert('暂未开放', '转账功能稍后支持，请先使用支出或收入记账。');
      return;
    }
    if (selectedAccount.sign_rule < 0 && selectedAccount.balance === 0 && activeSheetTab === 'income') {
      Alert.alert('无法记录收入', '该债务账户当前负债为 0，只能记录支出。');
      return;
    }

    const transactionType = activeSheetTab;
    const signedAmount = selectedAccount.sign_rule > 0 ? amountNumber : -amountNumber;
    const fallbackName = transactionType === 'income' ? '收入' : '支出';
    const title = sheetNote.trim() || selectedCategory?.label || fallbackName;

    try {
      setIsSavingTransaction(true);
      await createFinanceTransaction({
        id: `ft_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        name: title,
        happened_at: selectedHappenedAt.toISOString(),
        account_id: selectedAccount.id,
        transaction_type: transactionType,
        amount: signedAmount,
        note: sheetNote.trim() || null,
        extra_data: JSON.stringify({
          manual: true,
          category_key: selectedCategory?.key ?? null,
          category_label: selectedCategory?.label ?? null,
          attachments: sheetImageUris.length ? sheetImageUris.map((uri) => ({ type: 'image', uri })) : null,
          ...(transactionType === 'expense' && !sheetIncludeInBudget ? { exclude_from_budget: true } : {}),
        }),
      });
      setIsSheetVisible(false);
      resetSheetForm(transactionType);
      await Promise.all([loadFinanceTransactions(), loadFinanceAccounts()]);
    } catch (error) {
      console.warn('Failed to create finance transaction:', error);
      Alert.alert('保存失败', '手动记账保存失败，请稍后重试。');
    } finally {
      setIsSavingTransaction(false);
    }
  }, [
    activeSheetTab,
    amountNumber,
    loadFinanceAccounts,
    loadFinanceTransactions,
    resetSheetForm,
    selectedAccount,
    selectedCategory,
    selectedHappenedAt,
    sheetImageUris,
    sheetIncludeInBudget,
    sheetNote,
  ]);

  const handleOpenComposer = React.useCallback((): boolean => {
    if (!hasAccounts) {
      Alert.alert('请先添加账户', '当前还没有可用账户，请先前往资产页添加账户后再记账。');
      return false;
    }
    // 仅在弹窗未打开时重置表单；避免用户已输入金额/备注后点语音/图片又被清空
    if (!isSheetVisible) {
      resetSheetForm(activeSheetTab);
    }
    setSelectedAccountId((prev) => prev ?? financeAccounts[0]?.id ?? null);
    setIsSheetVisible(true);
    return true;
  }, [financeAccounts, hasAccounts, resetSheetForm, activeSheetTab, isSheetVisible]);

  const handlePickImage = React.useCallback(
    async (source: 'library' | 'camera') => {
      if (isPickingImage) return;

      const opened = handleOpenComposer();
      if (!opened) return;

      setIsPickingImage(true);
      try {
        if (source === 'library') {
          const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (!permission.granted) {
            Alert.alert('权限不足', '需要相册权限才能选择图片。');
            return;
          }

          const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            allowsEditing: false,
            quality: 1,
          });

          if (result.canceled) return;
          const uri = result.assets[0]?.uri;
          if (uri) setSheetImageUris([uri]);
          return;
        }

        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          Alert.alert('权限不足', '需要相机权限才能拍摄图片。');
          return;
        }

        const result = await ImagePicker.launchCameraAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          allowsEditing: false,
          quality: 1,
        });

        if (result.canceled) return;
        const uri = result.assets[0]?.uri;
        if (uri) setSheetImageUris([uri]);
      } catch (error) {
        console.warn('Failed to pick image:', error);
        Alert.alert('选择图片失败', '请稍后重试。');
      } finally {
        setIsPickingImage(false);
      }
    },
    [handleOpenComposer, isPickingImage]
  );

  const handleToggleVoiceInput = React.useCallback(() => {
    if (speechApiStatus === 'loading') {
      Alert.alert('正在加载语音...', '稍等片刻再试。');
      return;
    }

    // Expo Go（store client）下原生模块不可用，避免触发动态 import 报错
    if (Constants.executionEnvironment === 'storeClient') {
      setSpeechApiStatus('unavailable');
      setSpeechTriedOnce(true);
      Alert.alert('语音不可用', '当前是 Expo Go 环境，语音识别需要 Dev Build/Dev Client。');
      return;
    }

    if (isSpeechRecognizing) {
      speechApi?.ExpoSpeechRecognitionModule.stop();
      clearSpeechSubs();
      setIsSpeechRecognizing(false);
      return;
    }

    void (async () => {
      try {
        const opened = handleOpenComposer();
        if (!opened) return;

        if (speechApiStatus === 'unavailable' && speechTriedOnce) {
          Alert.alert('语音不可用', '当前是 Expo Go 环境，语音识别需要 Dev Build/Dev Client。');
          return;
        }

        let api = speechApi;
        if (!api) {
          setSpeechApiStatus('loading');
          api = (await import('@jamsch/expo-speech-recognition')) as SpeechRecognitionApi;
          setSpeechApi(api);
        }

        const recognitionModule = api?.ExpoSpeechRecognitionModule as
          | undefined
          | {
              requestPermissionsAsync?: () => Promise<{ granted: boolean }>;
              start?: (options: any) => void;
              stop?: () => void;
            };
        const emitter = api?.ExpoSpeechRecognitionModuleEmitter as
          | undefined
          | { addListener?: (eventName: string, listener: (...args: any[]) => void) => { remove?: () => void } };

        // Expo Go 下 native module 通常不可用；此时直接兜底退出，避免 TypeError
        if (!recognitionModule?.requestPermissionsAsync || !recognitionModule.start || !emitter?.addListener) {
          setSpeechApi(null);
          setSpeechApiStatus('unavailable');
          setSpeechTriedOnce(true);
          clearSpeechSubs();
          Alert.alert('语音不可用', '当前环境未包含语音识别原生模块，请使用开发构建(Dev Build)或稍后重试。');
          return;
        }

        setSpeechApiStatus('ready');
        const permission = await recognitionModule.requestPermissionsAsync();
        if (!permission.granted) {
          Alert.alert('权限不足', '需要麦克风权限才能进行语音识别。');
          return;
        }

        clearSpeechSubs();

        const subs: Array<{ remove?: () => void }> = [];
        const add = (eventName: string, listener: (...args: any[]) => void) => {
          const sub = emitter.addListener?.(eventName, listener);
          if (sub) subs.push(sub);
        };

        add('start', () => setIsSpeechRecognizing(true));
        add('end', () => setIsSpeechRecognizing(false));
        add('result', (event: any) => {
          const transcript = event?.results?.[0]?.transcript;
          if (typeof transcript === 'string' && transcript.trim().length > 0) {
            setSheetNote(transcript);
          }
          if (event?.isFinal) {
            recognitionModule.stop?.();
            clearSpeechSubs();
          }
        });
        add('error', (event: any) => {
          setIsSpeechRecognizing(false);
          const msg = event?.message || '语音识别失败';
          Alert.alert('语音识别失败', msg);
          clearSpeechSubs();
        });
        speechSubsRef.current = subs;

        recognitionModule.start({
          lang: 'zh-CN',
          interimResults: true,
          maxAlternatives: 1,
          continuous: false,
          addsPunctuation: false,
        });
      } catch (e) {
        console.warn('Voice input failed:', e);
        setSpeechApi(null);
        setSpeechApiStatus('unavailable');
        setSpeechTriedOnce(true);
        clearSpeechSubs();
        setIsSpeechRecognizing(false);
        Alert.alert('语音不可用', '当前环境未包含语音识别原生模块，请使用开发构建(Dev Build)或稍后重试。');
      }
    })();
  }, [clearSpeechSubs, handleOpenComposer, isSpeechRecognizing, speechApi, speechApiStatus, speechTriedOnce]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: bg }]} edges={['left', 'right']}>
      <ScrollView
        stickyHeaderIndices={[0]}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: 220 + collapsedBottom },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={handleMainScroll}>
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
            <Pressable
              onPress={() => router.push('/savings-plan')}
              style={({ pressed }) => [styles.headerIconBtn, pressed && { opacity: 0.75 }]}
              accessibilityRole="button"
              accessibilityLabel="存钱计划">
              <MaterialIcons name="savings" size={22} color={text} />
            </Pressable>
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
          <Animated.View style={{ opacity: heroOpacity, transform: [{ translateY: heroTranslateY }] }}>
            <View style={[styles.netCard, styles.budgetOverviewCard, { backgroundColor: surface, borderColor: outlineVariant }]}>
                  <View style={[styles.netAccent, { backgroundColor: primary, width: 3 }]} />

                  <View style={styles.budgetTopRow}>
                    <View style={styles.budgetTopMain}>
                      <View style={styles.budgetTitleRow}>
                        <Text style={[styles.budgetSurplusTitle, { color: subtle }]}>本月预算结余</Text>
                      </View>
                      <View style={styles.budgetAmountRow}>
                        <Pressable
                          onPress={openBudgetAdjust}
                          hitSlop={8}
                          style={({ pressed }) => [pressed && { opacity: 0.72 }]}
                          accessibilityRole="button"
                          accessibilityLabel="调整本月预算">
                          <Text style={[styles.budgetSurplusValue, { color: text }]}>
                            {showNetAmounts ? formatCurrencyWithDecimals(budgetSurplusAmount) : hiddenAmountText}
                          </Text>
                        </Pressable>
                        <Pressable
                          onPress={() => setShowNetAmounts((prev) => !prev)}
                          style={({ pressed }) => [styles.netVisibilityBtn, pressed && { opacity: 0.75 }]}
                          accessibilityRole="button"
                          accessibilityLabel={showNetAmounts ? '隐藏金额' : '显示金额'}>
                          <MaterialIcons name={showNetAmounts ? 'visibility-off' : 'visibility'} size={20} color={subtle} />
                        </Pressable>
                      </View>
                      <View style={[styles.budgetPctCapsule, { backgroundColor: isDark ? 'rgba(148,163,184,0.14)' : '#eef2fb' }]}>
                        <Text style={[styles.budgetPctCapsuleText, { color: primary }]}>
                          {showNetAmounts ? `${Math.round(budgetUsedPercent)}%` : '--'}
                        </Text>
                      </View>

                      <View style={styles.budgetProgressBlock}>
                        <View style={styles.budgetProgressLabels}>
                          <Text style={[styles.budgetProgressEnd, { color: subtle }]}>
                            已用 {showNetAmounts ? formatCurrencyWithDecimals(monthlyBudgetExpense) : hiddenAmountText}
                          </Text>
                          <Text style={[styles.budgetProgressEnd, { color: subtle }]}>
                            {showNetAmounts ? formatCurrencyWithDecimals(budgetTotalAmount) : hiddenAmountText}
                          </Text>
                        </View>
                        <View style={[styles.budgetProgressTrack, { backgroundColor: isDark ? 'rgba(148,163,184,0.12)' : '#e8ecf4' }]}>
                          <View
                            style={[
                              styles.budgetProgressFill,
                              {
                                width: `${budgetUsedPercent}%`,
                                backgroundColor: isDark ? 'rgba(148,163,184,0.35)' : '#d8dde8',
                              },
                            ]}
                          />
                        </View>
                      </View>
                    </View>

                    <View style={styles.budgetTodayRing}>
                      {(() => {
                        const ringSize = 78;
                        const stroke = 3.5;
                        const r = (ringSize - stroke) / 2;
                        const c = 2 * Math.PI * r;
                        const dash = c * todayBudgetUsagePct;
                        const ringTrack = isDark ? 'rgba(148,163,184,0.18)' : '#e3eefc';
                        const ringProg = isDark ? '#60a5fa' : '#7eb6ff';
                        return (
                          <View style={{ width: ringSize, height: ringSize, alignItems: 'center', justifyContent: 'center' }}>
                            <Svg
                              width={ringSize}
                              height={ringSize}
                              viewBox={`0 0 ${ringSize} ${ringSize}`}
                              style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
                              <Circle cx={ringSize / 2} cy={ringSize / 2} r={r} stroke={ringTrack} strokeWidth={stroke} fill="none" />
                              <Circle
                                cx={ringSize / 2}
                                cy={ringSize / 2}
                                r={r}
                                stroke={ringProg}
                                strokeWidth={stroke}
                                fill="none"
                                strokeDasharray={`${dash} ${c}`}
                                strokeLinecap="round"
                              />
                            </Svg>
                            <View style={styles.budgetRingCenter}>
                              <Text style={[styles.budgetRingLabel, { color: subtle }]} numberOfLines={2}>
                                今日可用
                              </Text>
                              <Text style={[styles.budgetRingValue, { color: text }]}>
                                {showNetAmounts ? formatCurrencyWithDecimals(todayAvailableAmount) : hiddenAmountText}
                              </Text>
                            </View>
                          </View>
                        );
                      })()}
                    </View>
                  </View>

                  <View style={[styles.budgetNetDivider, { backgroundColor: outlineVariant }]} />

                  <View style={styles.budgetNetHeader}>
                    <Pressable
                      onPress={() => setBudgetCardNetExpanded((v) => !v)}
                      style={({ pressed }) => [styles.budgetNetHeaderLeft, pressed && { opacity: 0.75 }]}
                      accessibilityRole="button"
                      accessibilityLabel={budgetCardNetExpanded ? '收起净资产详情' : '展开净资产详情'}>
                      <MaterialIcons
                        name={budgetCardNetExpanded ? 'keyboard-arrow-up' : 'keyboard-arrow-down'}
                        size={22}
                        color={subtle}
                      />
                      <Text style={[styles.budgetNetTitle, { color: text }]}>净资产</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => router.push('/finance-stats')}
                      style={({ pressed }) => [
                        styles.trendPill,
                        { borderColor: outlineVariant, backgroundColor: isDark ? 'rgba(148,163,184,0.10)' : '#f4f6fb' },
                        pressed && { opacity: 0.8 },
                      ]}>
                      <Text style={[styles.trendPillText, { color: subtle }]}>30 日趋势</Text>
                    </Pressable>
                  </View>
                  <Text style={[styles.budgetNetAmount, { color: text }]}>
                    {showNetAmounts ? formatCurrencyWithDecimals(netTotalForTrend) : hiddenAmountText}
                  </Text>

                  <View style={styles.trendChartWrap}>
                    <Svg width="100%" height={44} viewBox="0 0 272 44" preserveAspectRatio="meet">
                      {trendChartPathD.length > 4 ? (
                        <Path
                          d={trendChartPathD}
                          fill="none"
                          stroke={primary}
                          strokeWidth={2}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          opacity={0.85}
                        />
                      ) : null}
                      <Circle
                        cx={trendChartLastPoint.x}
                        cy={trendChartLastPoint.y}
                        r={4}
                        fill={surface}
                        stroke={primary}
                        strokeWidth={2}
                      />
                    </Svg>
                  </View>

                  {budgetCardNetExpanded ? (
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
                        <Text style={[styles.netStatValue, { color: monthlySurplusColor }]}>{monthlySurplusText}</Text>
                      </View>
                      <View style={styles.netStatCol}>
                        <Text style={[styles.netStatLabel, { color: subtle }]}>储蓄率</Text>
                        <Text style={[styles.netStatValue, { color: text }]}>{savingRateText}</Text>
                      </View>
                    </View>
                  ) : null}

                  <View
                    style={[
                      styles.assetsBtnRow,
                      { marginTop: budgetCardNetExpanded ? 12 : 4 },
                    ]}>
                    <Pressable
                      onPress={() => router.push('/assets')}
                      style={({ pressed }) => [
                        styles.assetsBtn,
                        { backgroundColor: `${primary}14`, borderColor: `${primary}33` },
                        pressed && { opacity: 0.9 },
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel="资产">
                      <MaterialIcons name="account-balance" size={18} color={primary} />
                      <Text style={[styles.assetsBtnText, { color: primary }]}>资产</Text>
                      <MaterialIcons name="arrow-forward-ios" size={14} color={primary} />
                    </Pressable>
                    <Pressable
                      onPress={() => router.push('/cash-flow')}
                      style={({ pressed }) => [
                        styles.assetsBtn,
                        { backgroundColor: `${primary}14`, borderColor: `${primary}33` },
                        pressed && { opacity: 0.9 },
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel="现金流图">
                      <MaterialIcons name="show-chart" size={18} color={primary} />
                      <Text style={[styles.assetsBtnText, { color: primary }]}>现金流图</Text>
                      <MaterialIcons name="arrow-forward-ios" size={14} color={primary} />
                    </Pressable>
                  </View>
            </View>
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
                    <MaterialIcons name={accountIcon(acc)} size={22} color={iconColor} />
                    <Text style={[styles.accountKicker, { color: kickerColor }]}>
                      {acc.account_no ? `${acc.name} (${acc.account_no})` : acc.name}
                    </Text>
                    <Text style={[styles.accountValue, { color: valueColor }]}>{formatCurrencyBalance(acc.balance)}</Text>
                  </Pressable>
                );
              })
            )}
          </ScrollView>

          <View style={[styles.sectionHeaderRow, { marginTop: 6 }]}>
            <Text style={[styles.sectionTitle, { color: text }]}>收支明细</Text>
            <Text style={[styles.txnSwipeHint, { color: subtle }]}>左滑删除</Text>
          </View>
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
          <View style={[styles.sectionDivider, { backgroundColor: outlineVariant }]} />
          <View style={styles.timelineWrap}>
            <View style={[styles.timelineLine, { backgroundColor: outlineVariant }]} />
            {todayDisplayTxns.map((t, idx) => {
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
                <Swipeable
                  key={t.id}
                  friction={2}
                  overshootRight={false}
                  rightThreshold={40}
                  renderRightActions={() => (
                    <View style={[styles.swipeDeleteTrack, { backgroundColor: bg }]}>
                      <Pressable
                        onPress={() => handleDeleteFinanceTxn(t.id, t.title)}
                        style={({ pressed }) => [styles.swipeDeletePill, pressed && { opacity: 0.88 }]}
                        accessibilityRole="button"
                        accessibilityLabel={`删除 ${t.title}`}>
                        <MaterialIcons name="delete-outline" size={20} color="#fff" />
                        <Text style={styles.swipeDeleteText}>删除</Text>
                      </Pressable>
                    </View>
                  )}>
                  <Animated.View
                    style={[
                      styles.txnSwipeForeground,
                      { backgroundColor: surface, borderColor: outlineVariant },
                      { opacity: itemOpacity, transform: [{ translateY: itemTranslateY }] },
                    ]}>
                    <TxnItem
                      themeText={text}
                      themeSubtle={subtle}
                      outlineVariant={outlineVariant}
                      item={t}
                      onPress={() => router.push(`/edit-finance-transaction/${t.id}`)}
                    />
                  </Animated.View>
                </Swipeable>
              );
            })}
            {todayDisplayTxns.length === 0 ? (
              <View style={[styles.emptyStateCard, { backgroundColor: surface, borderColor: outlineVariant }]}>
                <View style={[styles.emptyStateIconWrap, { backgroundColor: outlineVariant }]}>
                  <MaterialIcons name="event-note" size={18} color={subtle} />
                </View>
                <Text style={[styles.emptyStateTitle, { color: text }]}>今天暂无记录</Text>
                <Text style={[styles.emptyStateSubTitle, { color: subtle }]}>点击底部输入框，开始记第一笔</Text>
              </View>
            ) : null}
            {historySections.length > 0 ? <View style={[styles.dayDivider, { backgroundColor: outlineVariant }]} /> : null}
            {historySections.map((section) => (
              <React.Fragment key={section.dayKey}>
                <View style={styles.historyDayHeader}>
                  <View style={[styles.historyDayBadgeWrap, { backgroundColor: outlineVariant }]}>
                    <Text style={[styles.historyDayBadgeText, { color: subtle }]} numberOfLines={1}>
                      {section.shortLabel}
                    </Text>
                  </View>
                  <View style={styles.historyDayHeaderRight}>
                    <View style={styles.historyDayLegend}>
                      <Text style={[styles.historyDayLegendText, { color: '#dc2626' }]}>支出 {formatCurrencyWithDecimals(section.expense)}</Text>
                      <Text style={[styles.historyDayLegendDivider, { color: subtle }]}>·</Text>
                      <Text style={[styles.historyDayLegendText, { color: secondary }]}>收入 {formatCurrencyWithDecimals(section.income)}</Text>
                    </View>
                  </View>
                </View>
                {section.items.map((t, idx) => {
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
                    outputRange: [12 + idx * 4, 0],
                  });

                  return (
                    <Swipeable
                      key={t.id}
                      friction={2}
                      overshootRight={false}
                      rightThreshold={40}
                      renderRightActions={() => (
                        <View style={[styles.swipeDeleteTrack, { backgroundColor: bg }]}>
                          <Pressable
                            onPress={() => handleDeleteFinanceTxn(t.id, t.title)}
                            style={({ pressed }) => [styles.swipeDeletePill, pressed && { opacity: 0.88 }]}
                            accessibilityRole="button"
                            accessibilityLabel={`删除 ${t.title}`}>
                            <MaterialIcons name="delete-outline" size={20} color="#fff" />
                            <Text style={styles.swipeDeleteText}>删除</Text>
                          </Pressable>
                        </View>
                      )}>
                      <Animated.View
                        style={[
                          styles.txnSwipeForeground,
                          { backgroundColor: surface, borderColor: outlineVariant },
                          { opacity: itemOpacity, transform: [{ translateY: itemTranslateY }] },
                        ]}>
                        <TxnItem
                          themeText={text}
                          themeSubtle={subtle}
                          outlineVariant={outlineVariant}
                          item={t}
                          onPress={() => router.push(`/edit-finance-transaction/${t.id}`)}
                        />
                      </Animated.View>
                    </Swipeable>
                  );
                })}
                <View style={[styles.dayDivider, { backgroundColor: outlineVariant }]} />
              </React.Fragment>
            ))}
            {displayTxns.length > 0 && isLoadingMoreDays ? (
              <Text style={[styles.loadMoreText, { color: subtle }]}>加载中...</Text>
            ) : null}
            {displayTxns.length > 0 && !hasMoreHistoryDays ? (
              <Text style={[styles.loadMoreText, { color: subtle }]}>没有更早记录了</Text>
            ) : null}
          </View>
          </Animated.View>
        </View>
      </ScrollView>

      <Animated.View style={[styles.composerWrap, { bottom: baseBottomAnim }]}>
        <View style={{ width: expandedWidth, opacity: !hasAccounts ? 0.78 : 1 }}>
          <View style={styles.composerShell}>
            <View style={styles.composerRow}>
              <Pressable
                disabled={isPickingImage}
                onPress={() => void handlePickImage('library')}
                style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.85 }]}>
                <MaterialIcons name="photo-library" size={20} color="#111827" />
              </Pressable>

              <Pressable
                disabled={isPickingImage}
                onPress={() => void handlePickImage('camera')}
                style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.85 }]}>
                <MaterialIcons name="photo-camera" size={20} color="#111827" />
              </Pressable>

              <Pressable
                onPress={() => {
                  void handleOpenComposer();
                }}
                style={({ pressed }) => [styles.composerInput, pressed && { opacity: 0.92 }]} >
                <Text style={styles.composerPlaceholder}>记录支出...</Text>
              </Pressable>

              <Pressable
                onPress={handleToggleVoiceInput}
                style={({ pressed }) => [
                  styles.actionBtn,
                  styles.voiceBtn,
                  isSpeechRecognizing && { opacity: 0.72 },
                  speechApiStatus === 'loading' && { opacity: 0.6 },
                  pressed && { opacity: 0.92 },
                ]}>
                <MaterialIcons name="keyboard-voice" size={18} color="#fff" />
              </Pressable>
            </View>
          </View>
        </View>
      </Animated.View>

      <Modal visible={isSheetVisible} animationType="slide" transparent onRequestClose={closeSheet}>
        <View style={styles.sheetOverlay}>
          <Pressable style={styles.sheetBackdrop} onPress={closeSheet} />
          <View
            style={[
              styles.sheetContainer,
              {
                paddingBottom: Math.max(16, insets.bottom),
                maxHeight: manualSheetMaxHeight,
                backgroundColor: surface,
              },
            ]}>
            <View style={[styles.sheetHeader, { borderBottomColor: outlineVariant }]}>
              <Pressable onPress={closeSheet} style={({ pressed }) => [styles.sheetCloseBtn, pressed && { opacity: 0.75 }]}>
                <MaterialIcons name="close" size={24} color={subtle} />
              </Pressable>
              <Text style={[styles.sheetTitle, { color: text }]}>{activeSheetTab === 'transfer' ? '财务转账' : '手动记账'}</Text>
              <View style={styles.sheetCloseBtn} />
            </View>

            <View style={[styles.sheetTabs, { borderBottomColor: outlineVariant }]}>
              <Pressable onPress={() => resetSheetForm('expense')} style={styles.sheetTabBtn}>
                <Text style={[styles.sheetTabText, activeSheetTab === 'expense' ? { color: tertiary } : { color: subtle }]}>支出</Text>
                {activeSheetTab === 'expense' ? <View style={[styles.sheetTabLine, { backgroundColor: tertiary }]} /> : null}
              </Pressable>
              <Pressable onPress={() => resetSheetForm('income')} style={styles.sheetTabBtn}>
                <Text style={[styles.sheetTabText, activeSheetTab === 'income' ? { color: tertiary } : { color: subtle }]}>收入</Text>
                {activeSheetTab === 'income' ? <View style={[styles.sheetTabLine, { backgroundColor: tertiary }]} /> : null}
              </Pressable>
              <Pressable onPress={() => resetSheetForm('transfer')} style={styles.sheetTabBtn}>
                <Text style={[styles.sheetTabText, activeSheetTab === 'transfer' ? { color: tertiary } : { color: subtle }]}>转账</Text>
                {activeSheetTab === 'transfer' ? <View style={[styles.sheetTabLine, { backgroundColor: tertiary }]} /> : null}
              </Pressable>
            </View>

            <ScrollView
              style={[styles.sheetBodyScroll, { maxHeight: manualSheetBodyMaxHeight }]}
              contentContainerStyle={styles.sheetBodyScrollContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator
              nestedScrollEnabled
              bounces>
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
                    <Pressable
                      onPress={() => {
                        setIsTimePickerVisible(false);
                        setIsAccountPickerVisible(false);
                        setIsDatePickerVisible((prev) => !prev);
                      }}
                      style={({ pressed }) => [styles.transferDateBtn, { backgroundColor: isDark ? '#161d2b' : '#f2f3ff' }, pressed && { opacity: 0.85 }]}>
                      <MaterialIcons name="calendar-today" size={14} color={subtle} />
                      <Text style={[styles.transferDateText, { color: text }]}>{sheetDateLabel}</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => {
                        setIsDatePickerVisible(false);
                        setIsAccountPickerVisible(false);
                        setIsTimePickerVisible((prev) => !prev);
                      }}
                      style={({ pressed }) => [styles.transferDateBtn, { backgroundColor: isDark ? '#161d2b' : '#f2f3ff' }, pressed && { opacity: 0.85 }]}>
                      <MaterialIcons name="schedule" size={14} color={subtle} />
                      <Text style={[styles.transferDateText, { color: text }]}>{sheetTimeLabel}</Text>
                    </Pressable>
                  </View>

                  {isDatePickerVisible ? (
                    <View style={[styles.nativePickerCard, { backgroundColor: isDark ? '#161d2b' : '#f2f3ff', borderColor: outlineVariant }]}>
                      <Text style={[styles.inlinePickerTitle, { color: text }]}>选择日期</Text>
                      <View style={styles.inlinePickerActions}>
                        <Pressable onPress={() => handleChangeSheetDate(-1)} style={[styles.inlinePickerBtn, { backgroundColor: surface, borderColor: outlineVariant }]}>
                          <Text style={[styles.inlinePickerBtnText, { color: text }]}>前一天</Text>
                        </Pressable>
                        <Pressable onPress={() => setSelectedHappenedAt(new Date())} style={[styles.inlinePickerBtn, { backgroundColor: surface, borderColor: outlineVariant }]}>
                          <Text style={[styles.inlinePickerBtnText, { color: text }]}>今天</Text>
                        </Pressable>
                        <Pressable onPress={() => handleChangeSheetDate(1)} style={[styles.inlinePickerBtn, { backgroundColor: surface, borderColor: outlineVariant }]}>
                          <Text style={[styles.inlinePickerBtnText, { color: text }]}>后一天</Text>
                        </Pressable>
                      </View>
                    </View>
                  ) : null}

                  {isTimePickerVisible ? (
                    <View style={[styles.nativePickerCard, { backgroundColor: isDark ? '#161d2b' : '#f2f3ff', borderColor: outlineVariant }]}>
                      <Text style={[styles.inlinePickerTitle, { color: text }]}>选择时间</Text>
                      <View style={styles.inlinePickerActions}>
                        <Pressable onPress={() => handleChangeSheetTime(-1)} style={[styles.inlinePickerBtn, { backgroundColor: surface, borderColor: outlineVariant }]}>
                          <Text style={[styles.inlinePickerBtnText, { color: text }]}>-1 小时</Text>
                        </Pressable>
                        <Pressable onPress={() => handleChangeSheetTime(0, -10)} style={[styles.inlinePickerBtn, { backgroundColor: surface, borderColor: outlineVariant }]}>
                          <Text style={[styles.inlinePickerBtnText, { color: text }]}>-10 分钟</Text>
                        </Pressable>
                        <Pressable onPress={() => setSelectedHappenedAt(new Date())} style={[styles.inlinePickerBtn, { backgroundColor: surface, borderColor: outlineVariant }]}>
                          <Text style={[styles.inlinePickerBtnText, { color: text }]}>现在</Text>
                        </Pressable>
                        <Pressable onPress={() => handleChangeSheetTime(0, 10)} style={[styles.inlinePickerBtn, { backgroundColor: surface, borderColor: outlineVariant }]}>
                          <Text style={[styles.inlinePickerBtnText, { color: text }]}>+10 分钟</Text>
                        </Pressable>
                        <Pressable onPress={() => handleChangeSheetTime(1)} style={[styles.inlinePickerBtn, { backgroundColor: surface, borderColor: outlineVariant }]}>
                          <Text style={[styles.inlinePickerBtnText, { color: text }]}>+1 小时</Text>
                        </Pressable>
                      </View>
                    </View>
                  ) : null}
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
                        onPress={handleSaveTransaction}
                        style={({ pressed }) => [styles.transferCheckBtn, { backgroundColor: canSaveTransaction ? tertiary : subtle }, pressed && { opacity: 0.9 }]}>
                        <MaterialIcons name="check" size={30} color="#ffffff" />
                      </Pressable>
                    </View>
                  </View>
                </View>
              </>
            ) : (
              <>
                <View style={styles.categoryGrid}>
                  {activeCategories.map((item) => {
                    const isSelected = selectedCategoryKey === item.key;
                    return (
                    <Pressable key={item.key} style={styles.categoryItem} onPress={() => setSelectedCategoryKey(item.key)}>
                      <View style={[styles.categoryIconWrap, { backgroundColor: isSelected ? `${item.color}20` : outlineVariant, borderColor: isSelected ? item.color : 'transparent' }]}>
                        <MaterialIcons name={item.icon as keyof typeof MaterialIcons.glyphMap} size={22} color={item.color} />
                      </View>
                      <Text style={[styles.categoryLabel, { color: isSelected ? item.color : subtle }]}>{item.label}</Text>
                    </Pressable>
                    );
                  })}
                </View>

                <View style={[styles.sheetInputWrap, { backgroundColor: isDark ? '#161d2b' : '#f2f3ff' }]}>
                  <View style={styles.sheetConfigRow}>
                    <Pressable
                      onPress={() => {
                        setIsTimePickerVisible(false);
                        setIsAccountPickerVisible(false);
                        setIsDatePickerVisible((prev) => !prev);
                      }}
                      style={[styles.configChip, { backgroundColor: surface, borderColor: outlineVariant }]}>
                      <MaterialIcons name="calendar-today" size={16} color={subtle} />
                      <Text style={[styles.configChipText, { color: text }]}>{sheetDateLabel}</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => {
                        setIsDatePickerVisible(false);
                        setIsAccountPickerVisible(false);
                        setIsTimePickerVisible((prev) => !prev);
                      }}
                      style={({ pressed }) => [
                        styles.configChip,
                        { backgroundColor: surface, borderColor: outlineVariant },
                        pressed ? { opacity: 0.8 } : null,
                      ]}>
                      <MaterialIcons name="schedule" size={16} color={subtle} />
                      <Text style={[styles.configChipText, { color: text }]}>{sheetTimeLabel}</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => {
                        setIsDatePickerVisible(false);
                        setIsTimePickerVisible(false);
                        setIsAccountPickerVisible((prev) => !prev);
                      }}
                      style={({ pressed }) => [
                        styles.configChip,
                        { backgroundColor: surface, borderColor: outlineVariant },
                        pressed ? { opacity: 0.8 } : null,
                      ]}>
                      <MaterialIcons name="account-balance-wallet" size={16} color={tertiary} />
                      <Text style={[styles.configChipText, { color: text }]}>
                        {selectedAccount?.name ?? '支付账户'}
                      </Text>
                      <MaterialIcons name="expand-more" size={16} color={subtle} />
                    </Pressable>
                  </View>

                  {activeSheetTab === 'expense' ? (
                    <View
                      style={[
                        styles.sheetBudgetCard,
                        { backgroundColor: surface, borderColor: outlineVariant },
                      ]}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="计入本月预算"
                        accessibilityState={{ checked: sheetIncludeInBudget }}
                        onPress={() => setSheetIncludeInBudget((v) => !v)}
                        style={({ pressed }) => [
                          styles.sheetBudgetMainHit,
                          pressed ? { opacity: 0.82 } : null,
                        ]}>
                        <View
                          style={[
                            styles.sheetBudgetIconWrap,
                            {
                              backgroundColor: isDark ? 'rgba(251, 191, 36, 0.14)' : 'rgba(130, 81, 0, 0.09)',
                            },
                          ]}>
                          <MaterialIcons name="pie-chart" size={22} color={tertiary} />
                        </View>
                        <View style={styles.sheetBudgetTextCol}>
                          <Text style={[styles.sheetBudgetTitle, { color: text }]}>计入本月预算</Text>
                          <Text style={[styles.sheetBudgetSubtitle, { color: subtle }]} numberOfLines={2}>
                            {sheetIncludeInBudget
                              ? '占用本月预算与「今日可用」计算'
                              : '仍记为支出，不参与预算与今日可用'}
                          </Text>
                        </View>
                      </Pressable>
                      <Switch
                        value={sheetIncludeInBudget}
                        onValueChange={setSheetIncludeInBudget}
                        trackColor={{ false: isDark ? '#374151' : '#e5e7eb', true: '#4ade80' }}
                        thumbColor="#ffffff"
                        ios_backgroundColor={isDark ? '#374151' : '#e5e7eb'}
                      />
                    </View>
                  ) : null}

                  <View style={styles.sheetNoteRow}>
                    <View style={[styles.noteRowWrap, { backgroundColor: surface, borderColor: outlineVariant }]}>
                      <TextInput
                        value={sheetNote}
                        onChangeText={setSheetNote}
                        multiline
                        scrollEnabled
                        textAlignVertical="top"
                        style={[styles.noteRowInput, { color: text, backgroundColor: 'transparent' }]}
                        placeholder="添加备注..."
                        placeholderTextColor={subtle}
                      />
                    </View>
                  </View>

                  {sheetImageUris.length ? (
                    <View style={styles.attachmentPreview}>
                      <Text style={[styles.attachmentPreviewText, { color: subtle }]}>已添加图片</Text>
                      <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={styles.attachmentThumbRow}>
                        {sheetImageUris.map((uri, idx) => (
                          <View key={`${uri}-${idx}`} style={styles.attachmentThumbWrap}>
                            <Image source={{ uri }} style={styles.attachmentThumb} />
                            <Pressable
                              onPress={() => setSheetImageUris((prev) => prev.filter((_, i) => i !== idx))}
                              style={({ pressed }) => [styles.attachmentRemoveBtn, pressed && { opacity: 0.85 }]}>
                              <MaterialIcons name="close" size={14} color="#fff" />
                            </Pressable>
                          </View>
                        ))}
                      </ScrollView>
                    </View>
                  ) : null}

                  <Modal visible={isDatePickerVisible} transparent animationType="fade" onRequestClose={() => setIsDatePickerVisible(false)}>
                    <View style={styles.pickerModalOverlay}>
                      <Pressable style={styles.pickerModalBackdrop} onPress={() => setIsDatePickerVisible(false)} />
                      <View style={[styles.pickerModalCard, { backgroundColor: surface, borderColor: outlineVariant, shadowColor: isDark ? '#000' : '#0f172a' }]}>
                        <View style={[styles.pickerModalHeader, { borderBottomColor: outlineVariant }]}>
                          <Text style={[styles.pickerModalTitle, { color: text }]}>选择日期</Text>
                          <Pressable onPress={() => setIsDatePickerVisible(false)} style={styles.pickerModalCloseBtn}>
                            <MaterialIcons name="close" size={22} color={subtle} />
                          </Pressable>
                        </View>
                        <View style={styles.pickerModalBody}>
                          <DateTimePicker
                            value={selectedHappenedAt}
                            mode="date"
                            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                            locale="zh-CN"
                            themeVariant={isDark ? 'dark' : 'light'}
                            onChange={handleDatePickerChange}
                            style={styles.nativePicker}
                          />
                          <View style={styles.pickerModalFooter}>
                            <Pressable onPress={() => setSelectedHappenedAt(new Date())} style={[styles.pickerModalAction, { borderColor: outlineVariant, backgroundColor: isDark ? '#161d2b' : '#f2f3ff' }]}>
                              <Text style={[styles.pickerModalActionText, { color: text }]}>今天</Text>
                            </Pressable>
                            <Pressable onPress={() => setIsDatePickerVisible(false)} style={[styles.pickerModalAction, { borderColor: tertiary, backgroundColor: tertiary }]}>
                              <Text style={styles.pickerModalPrimaryText}>确定</Text>
                            </Pressable>
                          </View>
                        </View>
                      </View>
                    </View>
                  </Modal>

                  <Modal visible={isTimePickerVisible} transparent animationType="fade" onRequestClose={() => setIsTimePickerVisible(false)}>
                    <View style={styles.pickerModalOverlay}>
                      <Pressable style={styles.pickerModalBackdrop} onPress={() => setIsTimePickerVisible(false)} />
                      <View style={[styles.pickerModalCard, { backgroundColor: surface, borderColor: outlineVariant, shadowColor: isDark ? '#000' : '#0f172a' }]}>
                        <View style={[styles.pickerModalHeader, { borderBottomColor: outlineVariant }]}>
                          <Text style={[styles.pickerModalTitle, { color: text }]}>选择时间</Text>
                          <Pressable onPress={() => setIsTimePickerVisible(false)} style={styles.pickerModalCloseBtn}>
                            <MaterialIcons name="close" size={22} color={subtle} />
                          </Pressable>
                        </View>
                        <View style={styles.pickerModalBody}>
                          <DateTimePicker
                            value={selectedHappenedAt}
                            mode="time"
                            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                            locale="zh-CN"
                            themeVariant={isDark ? 'dark' : 'light'}
                            onChange={handleTimePickerChange}
                            style={styles.nativePicker}
                          />
                          <View style={styles.pickerModalFooter}>
                            <Pressable onPress={() => setSelectedHappenedAt(new Date())} style={[styles.pickerModalAction, { borderColor: outlineVariant, backgroundColor: isDark ? '#161d2b' : '#f2f3ff' }]}>
                              <Text style={[styles.pickerModalActionText, { color: text }]}>现在</Text>
                            </Pressable>
                            <Pressable onPress={() => setIsTimePickerVisible(false)} style={[styles.pickerModalAction, { borderColor: tertiary, backgroundColor: tertiary }]}>
                              <Text style={styles.pickerModalPrimaryText}>确定</Text>
                            </Pressable>
                          </View>
                        </View>
                      </View>
                    </View>
                  </Modal>

                  <Modal visible={isAccountPickerVisible} transparent animationType="fade" onRequestClose={() => setIsAccountPickerVisible(false)}>
                    <View style={styles.pickerModalOverlay}>
                      <Pressable style={styles.pickerModalBackdrop} onPress={() => setIsAccountPickerVisible(false)} />
                      <View style={[styles.pickerModalCard, { backgroundColor: surface, borderColor: outlineVariant, shadowColor: isDark ? '#000' : '#0f172a' }]}>
                        <View style={[styles.pickerModalHeader, { borderBottomColor: outlineVariant }]}>
                          <Text style={[styles.pickerModalTitle, { color: text }]}>选择账户</Text>
                          <Pressable onPress={() => setIsAccountPickerVisible(false)} style={styles.pickerModalCloseBtn}>
                            <MaterialIcons name="close" size={22} color={subtle} />
                          </Pressable>
                        </View>
                        <View style={styles.pickerModalBody}>
                          <ScrollView style={styles.accountPickerScroll} contentContainerStyle={styles.accountPickerList} showsVerticalScrollIndicator={false}>
                            {financeAccounts.map((account) => {
                              const selected = account.id === selectedAccount?.id;
                              return (
                                <Pressable
                                  key={account.id}
                                  onPress={() => handleSelectAccount(account.id)}
                                  style={({ pressed }) => [
                                    styles.accountPickerItem,
                                    { backgroundColor: selected ? `${tertiary}18` : isDark ? '#161d2b' : '#f2f3ff', borderColor: selected ? tertiary : outlineVariant },
                                    pressed ? { opacity: 0.84 } : null,
                                  ]}>
                                  <MaterialIcons name={accountIcon(account)} size={18} color={selected ? tertiary : subtle} />
                                  <View style={styles.accountPickerTextCol}>
                                    <Text style={[styles.accountPickerName, { color: text }]}>{account.name}</Text>
                                    <Text style={[styles.accountPickerBalance, { color: subtle }]}>{formatCurrencyBalance(account.balance)}</Text>
                                  </View>
                                  {selected ? <MaterialIcons name="check" size={18} color={tertiary} /> : null}
                                </Pressable>
                              );
                            })}
                          </ScrollView>
                        </View>
                      </View>
                    </View>
                  </Modal>

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
                          onPress={() => (isDone ? handleSaveTransaction() : handleAmountKeyPress(key))}
                          style={({ pressed }) => [
                            styles.keypadBtn,
                            isDone
                              ? [styles.keypadDoneBtn, { backgroundColor: canSaveTransaction ? tertiary : subtle }]
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
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={isBudgetAdjustVisible} animationType="slide" transparent onRequestClose={closeBudgetAdjust}>
        <KeyboardAvoidingView
          style={styles.sheetOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Pressable style={styles.sheetBackdrop} onPress={closeBudgetAdjust} />
          <View style={[styles.budgetDetailsSheet, { paddingBottom: Math.max(24, insets.bottom), backgroundColor: surface }]}>
            <View style={styles.budgetDetailsHeader}>
              <Text style={[styles.budgetDetailsTitle, { color: text }]}>
                {budgetSheetMonthNumber}月预算详情
              </Text>
              <Pressable
                onPress={handleResetBudgetAdjust}
                style={({ pressed }) => [styles.budgetDetailsResetBtn, pressed && { opacity: 0.85 }]}>
                <MaterialIcons name="refresh" size={16} color="#ef4444" />
                <Text style={styles.budgetDetailsResetText}>重置预算</Text>
              </Pressable>
            </View>

            <View style={styles.budgetDetailsTotalWrap}>
              <View style={[styles.budgetDetailsTotalCard, { backgroundColor: isDark ? 'rgba(148,163,184,0.12)' : '#f9fafb' }]}>
                <Text style={[styles.budgetDetailsTotalLabel, { color: subtle }]}>本月预算</Text>
                <Text style={[styles.budgetDetailsTotalValue, { color: text }]}>
                  {formatCurrencyWithDecimals(budgetPreviewTotal)}
                </Text>
              </View>
            </View>

            <View style={styles.budgetDetailsComposition}>
              <View style={styles.budgetDetailsCompositionTop}>
                <Text style={[styles.budgetDetailsCompositionTitle, { color: subtle }]}>本月预算构成</Text>
                <View style={styles.budgetDetailsSwitchRow}>
                  <Text style={[styles.budgetDetailsSwitchLabel, { color: subtle }]}>包含上月结余</Text>
                  <Switch
                    value={modalIncludeLast}
                    onValueChange={setModalIncludeLast}
                    trackColor={{ false: isDark ? '#374151' : '#e5e7eb', true: '#4ade80' }}
                    thumbColor="#ffffff"
                    ios_backgroundColor={isDark ? '#374151' : '#e5e7eb'}
                  />
                </View>
              </View>

              <View style={styles.budgetDetailsBreakdownRow}>
                <Pressable
                  onPress={() => budgetBaseInputRef.current?.focus()}
                  style={({ pressed }) => [
                    styles.budgetDetailsBreakdownCard,
                    {
                      backgroundColor: isDark ? 'rgba(148,163,184,0.12)' : '#f9fafb',
                      opacity: pressed ? 0.92 : 1,
                    },
                  ]}>
                  <View style={styles.budgetDetailsBreakdownLabelRow}>
                    <Text style={[styles.budgetDetailsBreakdownLabel, { color: subtle }]}>月预算基数</Text>
                    <MaterialIcons name="edit" size={12} color={primary} style={{ opacity: 0.85 }} />
                  </View>
                  <View style={styles.budgetDetailsBaseInputWrap}>
                    <Text style={[styles.budgetDetailsBreakdownYuan, { color: text }]}>¥</Text>
                    <TextInput
                      ref={budgetBaseInputRef}
                      value={budgetBaseDraft}
                      onChangeText={setBudgetBaseDraft}
                      keyboardType="decimal-pad"
                      placeholder="0.00"
                      placeholderTextColor={subtle}
                      style={[styles.budgetDetailsBreakdownInput, { color: text }]}
                      selectTextOnFocus
                    />
                  </View>
                </Pressable>

                <Text style={[styles.budgetDetailsPlus, { color: isDark ? '#4b5563' : '#d1d5db' }]}>+</Text>

                <View
                  style={[
                    styles.budgetDetailsBreakdownCard,
                    {
                      backgroundColor: isDark ? 'rgba(148,163,184,0.12)' : '#f9fafb',
                      opacity: modalIncludeLast ? 1 : 0.5,
                    },
                  ]}>
                  <Text style={[styles.budgetDetailsBreakdownLabel, { color: subtle }]}>上月剩余</Text>
                  <Text
                    style={[
                      styles.budgetDetailsBreakdownAmount,
                      modalIncludeLast ? { color: text } : { color: isDark ? '#4b5563' : '#d1d5db' },
                    ]}>
                    {modalIncludeLast ? formatCurrencyWithDecimals(lastMonthRemaining) : '--'}
                  </Text>
                </View>
              </View>
            </View>

            <Pressable
              onPress={handleSaveBudgetAdjust}
              style={({ pressed }) => [
                styles.budgetDetailsSaveBtn,
                { backgroundColor: tertiary, opacity: pressed ? 0.92 : 1 },
              ]}>
              <Text style={styles.budgetDetailsSaveText}>完成</Text>
            </Pressable>

            <View style={[styles.budgetDetailsHomeIndicator, { backgroundColor: isDark ? '#9ca3af' : '#111827' }]} />
          </View>
        </KeyboardAvoidingView>
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
  budgetOverviewCard: {
    paddingTop: 16,
  },
  budgetTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 4,
  },
  budgetTopMain: {
    flex: 1,
    minWidth: 0,
    gap: 8,
  },
  budgetTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  budgetSurplusTitle: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  budgetAmountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'nowrap',
  },
  budgetSurplusValue: {
    fontSize: 26,
    fontWeight: '900',
    letterSpacing: -0.8,
    flexShrink: 1,
  },
  budgetPctCapsule: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  budgetPctCapsuleText: {
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.4,
  },
  budgetProgressBlock: {
    gap: 8,
    marginTop: 4,
    paddingRight: 4,
  },
  budgetProgressLabels: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  budgetProgressEnd: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  budgetProgressTrack: {
    height: 5,
    borderRadius: 999,
    overflow: 'hidden',
  },
  budgetProgressFill: {
    height: '100%',
    borderRadius: 999,
  },
  budgetTodayRing: {
    paddingTop: 6,
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  budgetRingCenter: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    maxWidth: 76,
  },
  budgetRingLabel: {
    fontSize: 9,
    fontWeight: '800',
    textAlign: 'center',
    lineHeight: 12,
    letterSpacing: 0.2,
  },
  budgetRingValue: {
    marginTop: 2,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: -0.2,
    textAlign: 'center',
  },
  budgetNetDivider: {
    height: 1,
    marginTop: 16,
    marginBottom: 12,
    opacity: 0.65,
  },
  budgetNetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  budgetNetHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  budgetNetTitle: {
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: -0.2,
  },
  trendPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
  },
  trendPillText: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.6,
  },
  budgetNetAmount: {
    marginTop: 8,
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: -0.6,
  },
  trendChartWrap: {
    marginTop: 10,
    height: 52,
    width: '100%',
    justifyContent: 'center',
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
  netHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  netVisibilityBtn: {
    width: 30,
    height: 30,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  netStatsBtn: {
    height: 30,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  netStatsBtnText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
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
  assetsBtnRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 10,
    alignSelf: 'flex-start',
  },
  assetsBtn: {
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
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
  txnSwipeHint: {
    fontSize: 11,
    fontWeight: '600',
    opacity: 0.85,
  },
  txnSwipeForeground: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 8,
    paddingRight: 10,
    overflow: 'hidden',
  },
  swipeDeleteTrack: {
    width: 100,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingLeft: 14,
    paddingRight: 4,
  },
  swipeDeletePill: {
    minWidth: 68,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(220, 38, 38, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 2,
  },
  swipeDeleteText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '800',
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
  sectionDivider: {
    height: 1,
    marginTop: 14,
    marginBottom: 4,
    opacity: 0.72,
  },
  dayDivider: {
    height: 1,
    marginLeft: 52,
    marginTop: 2,
    marginBottom: 2,
    opacity: 0.72,
  },
  historyDayHeader: {
    marginTop: 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  historyDayBadgeWrap: {
    width: 40,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  historyDayBadgeText: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.2,
  },
  historyDayHeaderRight: {
    flex: 1,
    paddingTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  historyDayLegend: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  historyDayLegendText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  historyDayLegendDivider: {
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
  emptyStateCard: {
    marginTop: 4,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 18,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  emptyStateIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyStateTitle: {
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  emptyStateSubTitle: {
    fontSize: 12,
    fontWeight: '600',
    opacity: 0.85,
  },
  loadMoreText: {
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '600',
    opacity: 0.78,
    paddingTop: 4,
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
    zIndex: 100,
    elevation: 20,
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
    minHeight: 40,
    justifyContent: 'center',
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
    zIndex: 0,
  },
  sheetContainer: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    backgroundColor: '#ffffff',
    overflow: 'hidden',
    zIndex: 1,
    elevation: 24,
    flexDirection: 'column',
  },
  sheetBodyScroll: {
    flexGrow: 0,
  },
  sheetBodyScrollContent: {
    paddingBottom: 6,
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
    borderWidth: 1,
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
    paddingHorizontal: 12,
    paddingTop: 14,
    paddingBottom: 4,
  },
  sheetConfigRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  sheetBudgetCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    paddingLeft: 12,
    paddingRight: 10,
    paddingVertical: 11,
    marginBottom: 12,
    gap: 4,
  },
  sheetBudgetMainHit: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
  },
  sheetBudgetIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetBudgetTextCol: {
    flex: 1,
    marginLeft: 12,
    paddingRight: 6,
  },
  sheetBudgetTitle: {
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  sheetBudgetSubtitle: {
    fontSize: 12,
    fontWeight: '500',
    marginTop: 3,
    lineHeight: 16,
    opacity: 0.92,
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
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
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
  nativePickerCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 10,
    marginBottom: 12,
    gap: 10,
    overflow: 'hidden',
  },
  inlinePickerTitle: {
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.6,
  },
  nativePicker: {
    width: '100%',
    alignSelf: 'center',
  },
  pickerModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 18,
  },
  pickerModalBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  pickerModalCard: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 22,
    borderWidth: 1,
    overflow: 'hidden',
    shadowOpacity: 0.18,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 12 },
    elevation: 14,
  },
  pickerModalHeader: {
    minHeight: 52,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
  },
  pickerModalTitle: {
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: -0.2,
  },
  pickerModalCloseBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickerModalBody: {
    padding: 12,
    gap: 12,
  },
  pickerModalFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
  },
  pickerModalAction: {
    flex: 1,
    minHeight: 42,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickerModalActionText: {
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0.3,
  },
  pickerModalPrimaryText: {
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0.3,
    color: '#ffffff',
  },
  inlinePickerActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  inlinePickerBtn: {
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  inlinePickerBtnText: {
    fontSize: 12,
    fontWeight: '800',
  },
  accountPickerScroll: {
    maxHeight: 320,
  },
  accountPickerList: {
    gap: 8,
    paddingBottom: 2,
  },
  accountPickerItem: {
    minHeight: 50,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  accountPickerTextCol: {
    flex: 1,
    gap: 2,
  },
  accountPickerName: {
    fontSize: 13,
    fontWeight: '800',
  },
  accountPickerBalance: {
    fontSize: 11,
    fontWeight: '600',
  },
  sheetNoteRow: {
    marginTop: 0,
    marginBottom: 12,
  },
  noteRowInput: {
    width: '100%',
    minHeight: 104,
    maxHeight: 168,
    fontSize: 15,
    lineHeight: 22,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  noteRowWrap: {
    width: '100%',
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 0,
    paddingVertical: 0,
    overflow: 'hidden',
  },
  attachmentPreview: {
    marginTop: 0,
    marginBottom: 10,
  },
  attachmentPreviewText: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.3,
    marginBottom: 8,
  },
  attachmentThumbRow: {
    gap: 10,
    paddingRight: 6,
  },
  attachmentThumbWrap: {
    width: 72,
    height: 72,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.22)',
    overflow: 'hidden',
    position: 'relative',
  },
  attachmentThumb: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  attachmentRemoveBtn: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
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
  budgetDetailsSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
    maxWidth: 480,
    alignSelf: 'center',
    width: '100%',
  },
  budgetDetailsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 12,
  },
  budgetDetailsTitle: {
    fontSize: 20,
    fontWeight: '600',
    flex: 1,
    paddingRight: 12,
  },
  budgetDetailsResetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  budgetDetailsResetText: {
    color: '#ef4444',
    fontSize: 14,
    fontWeight: '600',
  },
  budgetDetailsTotalWrap: {
    paddingHorizontal: 24,
    marginBottom: 28,
  },
  budgetDetailsTotalCard: {
    borderRadius: 16,
    paddingVertical: 22,
    paddingHorizontal: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  budgetDetailsTotalLabel: {
    fontSize: 16,
    fontWeight: '600',
  },
  budgetDetailsTotalValue: {
    fontSize: 22,
    fontWeight: '600',
  },
  budgetDetailsComposition: {
    paddingHorizontal: 24,
    marginBottom: 20,
    gap: 16,
  },
  budgetDetailsCompositionTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  budgetDetailsCompositionTitle: {
    fontSize: 14,
    fontWeight: '600',
  },
  budgetDetailsSwitchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  budgetDetailsSwitchLabel: {
    fontSize: 14,
  },
  budgetDetailsBreakdownRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    justifyContent: 'space-between',
    gap: 4,
  },
  budgetDetailsBreakdownCard: {
    flex: 1,
    borderRadius: 16,
    padding: 18,
    minHeight: 96,
    justifyContent: 'space-between',
  },
  budgetDetailsBreakdownLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 8,
  },
  budgetDetailsBreakdownLabel: {
    fontSize: 14,
    fontWeight: '500',
  },
  budgetDetailsBaseInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  budgetDetailsBreakdownYuan: {
    fontSize: 18,
    fontWeight: '700',
  },
  budgetDetailsBreakdownInput: {
    flex: 1,
    fontSize: 18,
    fontWeight: '600',
    paddingVertical: 0,
    minWidth: 0,
  },
  budgetDetailsBreakdownAmount: {
    fontSize: 18,
    fontWeight: '600',
  },
  budgetDetailsPlus: {
    fontSize: 22,
    fontWeight: '300',
    alignSelf: 'center',
    paddingHorizontal: 6,
  },
  budgetDetailsSaveBtn: {
    marginHorizontal: 24,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 12,
  },
  budgetDetailsSaveText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '800',
  },
  budgetDetailsHomeIndicator: {
    width: 128,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 8,
    opacity: 0.35,
  },
});
