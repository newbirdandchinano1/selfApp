import { AppIconButton } from '@/components/ui';
import { Layout, Spacing } from '@/constants/design-tokens';
import { Colors } from '@/constants/theme';
import { useDayBoundary } from '@/contexts/day-boundary-context';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { FINANCE_ACCOUNT_ICON_OPTIONS } from '@/lib/constants/finance-account-icons';
import {
  budgetDaysLeftIncludingToday,
  budgetPeriodLengthDays,
  clampBudgetRefreshDay,
  DEFAULT_BUDGET_REFRESH_DAY,
  getBudgetMonthKeyForDate,
  getBudgetPeriodStartForDate,
  getNextBudgetPeriodStart,
  getPreviousBudgetPeriodStart,
  loadBudgetRefreshDay,
  loadMonthBudgetSettings,
  persistBudgetRefreshDay,
  persistMonthBudgetSettings,
  sumBudgetFixedExpenses,
  type BudgetFixedExpense,
  type MonthBudgetSetting,
} from '@/lib/finance-monthly-budget';
import {
  addDaysToLogicalYmd,
  getLogicalLocalYmd,
  logicalYmdToLocalDate,
} from '@/lib/tasks-logical-day';
import {
  createFinanceTransaction,
  deleteFinanceTransaction,
  getFinanceAccountsWithBalance,
  getFinanceFlowCategories,
  getFinanceTransactions,
  validateFinanceLedgerBalanceAfterChange,
} from '@/lib/repositories/finance/finance';
import { isFinanceAccountExcludedFromAggregates } from '@/lib/repositories/finance/finance-account-extra';
import { isFinanceTransactionExcludedFromBudget } from '@/lib/repositories/finance/finance-transaction-extra';
import { tryPersistFinanceTxnAiComment } from '@/lib/repositories/finance/finance-txn-ai-comment';
import type { FinanceAccountBalanceRow, FinanceTransactionRow } from '@/lib/repositories/finance/finance.types';
import { notifyAutoLedgerFailure } from '@/lib/auto-ledger-notify';
import {
  AUTO_LEDGER_HANDOFF_SPLASH_MS,
  AUTO_LEDGER_MAX_ATTEMPTS,
  AUTO_LEDGER_RETRY_DELAY_MS,
  sleepMs,
} from '@/lib/auto-ledger-retry';
import {
  loadFinanceDefaultAccounts,
  sanitizeFinanceDefaultAccounts,
  type FinanceDefaultAccounts,
} from '@/lib/finance-default-accounts';
import { resolveFinanceAccountForAutoLedgerWithDefaults } from '@/lib/finance-account-match';
import { setFinanceSheetBridge } from '@/lib/finance-sheet-bridge';
import { consumeFinanceSheetLaunchIntent, type FinanceSheetLaunchIntent } from '@/lib/finance-sheet-launch-intent';
import { consumeShortcutAutoLedgerImageDataUri } from '@/lib/shortcut-auto-ledger-pending';
import { moveAppToBackground } from 'zheng-background';
import { scheduleGithubFinanceCloudSyncDebounced } from '@/lib/github-cloud-sync';
import {
  getActiveAiLlmApiKey,
  getActiveAiLlmProviderLabel,
  isActiveAiLlmConfigured,
  parseFinanceOneLinerFromImage,
  parseFinanceOneLinerFromText,
} from '@/lib/zhipu-image-parse';
import { MaterialIcons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useFocusEffect } from '@react-navigation/native';
import Constants from 'expo-constants';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import React from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  Easing,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
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
  type GestureResponderEvent,
  type KeyboardEvent,
} from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from 'react-native-svg';

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
  insight: string;
  insightIsAiBody: boolean;
  /** 已配置模型且 AI 评价尚未写入：生成中或队列等待 */
  insightPendingAi: boolean;
  /** 截图自动记账 AI 分析中占位，尚未落库 */
  isPendingPlaceholder?: boolean;
};

type PendingAutoLedgerRow = {
  id: string;
  source: 'clipboard' | 'shortcut_intent';
  retryAttempt?: number;
  maxAttempts?: number;
};

function buildPendingAutoLedgerTxn(item: PendingAutoLedgerRow, todayDayKey: string, subtle: string): Txn {
  const now = new Date();
  const hour = String(now.getHours()).padStart(2, '0');
  const minute = String(now.getMinutes()).padStart(2, '0');
  const retrying =
    item.retryAttempt != null && item.maxAttempts != null && item.retryAttempt > 1;
  const insight = retrying
    ? `识别失败，正在重试（${item.retryAttempt}/${item.maxAttempts}）…`
    : item.source === 'shortcut_intent'
      ? 'AI 正在识别快捷指令截图…'
      : 'AI 正在识别剪贴板截图…';
  return {
    id: item.id,
    dayKey: todayDayKey,
    icon: 'auto-awesome',
    iconColor: subtle,
    title: '截图记账',
    meta: retrying ? `今天 ${hour}:${minute} · 重试中` : `今天 ${hour}:${minute} · AI 分析中`,
    amount: '···',
    amountColor: subtle,
    insight,
    insightIsAiBody: false,
    insightPendingAi: true,
    isPendingPlaceholder: true,
  };
}

type SheetTab = 'sentence' | 'expense' | 'income' | 'transfer';

type AccountPickerTarget = 'sheet' | 'transferFrom' | 'transferTo';

function readTransferLeg(extra_data: string | null): 'out' | 'in' | null {
  if (!extra_data) return null;
  try {
    const raw = JSON.parse(extra_data) as unknown;
    if (!raw || typeof raw !== 'object') return null;
    const leg = (raw as Record<string, unknown>).transfer_leg;
    return leg === 'out' || leg === 'in' ? leg : null;
  } catch {
    return null;
  }
}

function buildTxnAiInsightLine(
  txn: FinanceTransactionRow,
  opts: { zhipuReady: boolean; generatingId: string | null; skippedIds: Set<string> },
): { text: string; isAiBody: boolean; pendingAi: boolean } {
  const trimmed = txn.ai_comment?.trim();
  if (trimmed) return { text: `AI 评价：${trimmed}`, isAiBody: true, pendingAi: false };
  if (opts.skippedIds.has(txn.id)) {
    return { text: 'AI 评价：生成失败，离开再进入本页或重新加载列表后可重试', isAiBody: false, pendingAi: false };
  }
  if (txn.id === opts.generatingId) {
    return { text: 'AI 正在分析这笔收支…', isAiBody: false, pendingAi: true };
  }
  if (!opts.zhipuReady) {
    const prov = getActiveAiLlmProviderLabel();
    const env =
      prov === '豆包'
        ? 'EXPO_PUBLIC_ARK_API_KEY（或兼容旧名 EXPO_PUBLIC_GEMINI_API_KEY）'
        : 'EXPO_PUBLIC_ZHIPU_API_KEY';
    return { text: `AI 评价：未配置${prov}密钥，无法自动生成（${env}）`, isAiBody: false, pendingAi: false };
  }
  return { text: 'AI 分析排队中，请稍候…', isAiBody: false, pendingAi: true };
}

/** 与 `getFinanceAccountsWithBalance` 中按账户汇总 balance 的规则一致：收入 +、支出 -、转账按转出/转入计入。 */
function getTxnNetWorthTotalDelta(txn: FinanceTransactionRow): number {
  if (txn.transaction_type === 'income') return Math.abs(txn.amount);
  if (txn.transaction_type === 'expense') return -Math.abs(txn.amount);
  if (txn.transaction_type === 'transfer') {
    const leg = readTransferLeg(txn.extra_data);
    const absAmount = Math.abs(txn.amount);
    if (leg === 'out') return -absAmount;
    if (leg === 'in') return absAmount;
  }
  return 0;
}

const NET_WORTH_TREND_CHART_W = 272;
const NET_WORTH_TREND_CHART_H = 52;
const NET_WORTH_TREND_CHART_INSET = 12;
const NET_WORTH_TREND_VISIBLE_NODE_COUNT = 5;

type NetWorthTrendPoint = {
  value: number;
  dayKey: string;
  label: string;
};

function formatNetWorthTrendDayLabel(date: Date, isToday: boolean): string {
  if (isToday) return '今天';
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

/** 将图表区域内的触摸 x 坐标映射为折线数据点索引。 */
function netWorthTrendIndexFromLocationX(locationX: number, plotWidth: number, pointCount: number): number {
  if (pointCount <= 1) return 0;
  if (plotWidth <= 0) return pointCount - 1;
  const inset = NET_WORTH_TREND_CHART_INSET;
  const innerW = NET_WORTH_TREND_CHART_W - inset * 2;
  const viewBoxX = (locationX / plotWidth) * NET_WORTH_TREND_CHART_W;
  const t = (viewBoxX - inset) / innerW;
  const clamped = Math.max(0, Math.min(1, t));
  return Math.round(clamped * (pointCount - 1));
}

/** 在折线上均匀取约 5 个可见节点（含首尾）。 */
function getSparseTrendNodeIndices(length: number, count = NET_WORTH_TREND_VISIBLE_NODE_COUNT): number[] {
  if (length <= 0) return [];
  if (length === 1) return [0];
  const n = Math.min(count, length);
  const indices = new Set<number>();
  for (let k = 0; k < n; k++) {
    indices.add(Math.round((k * (length - 1)) / (n - 1)));
  }
  return [...indices].sort((a, b) => a - b);
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

type ParsedOneLiner = {
  transaction_type: 'expense' | 'income';
  amount: number;
  name: string;
  category_label?: string | null;
  account_name?: string | null;
  payment_account_label?: string | null;
};

type SentenceResolveResult =
  | { ok: true; parsed: ParsedOneLiner; source: 'ai' | 'local' }
  | { ok: false; error: string };

type SentenceLedgerPreviewState =
  | null
  | {
      kind: 'ok';
      source: 'ai' | 'local';
      transaction_type: 'expense' | 'income';
      amount: number;
      name: string;
      categoryLabel: string;
    }
  | { kind: 'error'; message: string };

/** 无智谱密钥时的极简规则解析（需含阿拉伯数字金额）。 */
function parseFinanceSentenceLocal(raw: string): ({ ok: true } & ParsedOneLiner) | { ok: false } {
  const s = raw.trim().replace(/\s+/g, ' ');
  if (!s) return { ok: false };
  const incomeHints = /(?:^|[\s,，])(收入|到账|进账|工资|奖金|补贴|退款|回款|(?:收到)?转账)/;
  const transaction_type: 'income' | 'expense' = incomeHints.test(s) ? 'income' : 'expense';
  const numRe = /(\d+(?:\.\d+)?)\s*(?:元|块|￥|¥)?/;
  const m = s.match(numRe);
  if (!m) return { ok: false };
  const amount = Number(m[1]);
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false };
  const capped = Math.min(amount, 99999999.99);
  let name = s
    .replace(m[0], ' ')
    .replace(/[,，。、;；]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  name = name
    .replace(/^(支出|花了|消费|买了|买|付|支付)/, '')
    .replace(/^(收入|到账|进账|收到)/, '')
    .trim();
  if (!name) name = transaction_type === 'income' ? '收入' : '支出';
  if (name.length > 80) name = `${name.slice(0, 77)}…`;
  return { ok: true, transaction_type, amount: capped, name, category_label: null };
}

function pickSheetCategoryForParsed(
  transactionType: 'expense' | 'income',
  categoryLabelHint: string | null | undefined,
  expenseCats: SheetCategory[],
  incomeCats: SheetCategory[],
): SheetCategory {
  const pool = transactionType === 'income' ? incomeCats : expenseCats;
  if (!pool.length) {
    return { key: 'other', icon: 'label', label: '其他', color: '#94a3b8' };
  }
  const h = categoryLabelHint?.trim();
  if (h) {
    const exact = pool.find((c) => c.label === h);
    if (exact) return exact;
    const fuzzy = pool.find((c) => h.includes(c.label) || c.label.includes(h));
    if (fuzzy) return fuzzy;
  }
  return pool[0];
}

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
        <View
          style={[
            styles.insightTag,
            { backgroundColor: outlineVariant },
            item.insightPendingAi ? styles.insightTagPendingAi : null,
          ]}>
          {item.insightPendingAi ? (
            <ActivityIndicator size="small" color={themeSubtle} />
          ) : (
            <MaterialIcons name="auto-awesome" size={14} color={item.insightIsAiBody ? item.iconColor : themeSubtle} />
          )}
          <Text
            style={[
              styles.insightText,
              { color: item.insightIsAiBody ? item.iconColor : themeSubtle, flexShrink: 1 },
            ]}>
            {item.insight}
          </Text>
        </View>
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
  const { boundary: dayBoundary, logicalTodayYmd, logicalTodayDate: today } = useDayBoundary();
  const logicalYesterdayYmd = React.useMemo(
    () => addDaysToLogicalYmd(logicalTodayYmd, -1),
    [logicalTodayYmd],
  );
  const headerDateLabel = `${today.getMonth() + 1}月${today.getDate()}日 ${weekdayCn[today.getDay()]}`;

  const formatCurrencyWithDecimals = React.useCallback((value: number) => {
    const prefix = value < 0 ? '-¥' : '¥';
    return `${prefix}${Math.abs(value).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }, []);
  const todayLabel = `今日 ${today.getMonth() + 1}月${today.getDate()}日 ${weekdayCn[today.getDay()]}`;

  const collapsedBottom = 6;
  const [isSheetVisible, setIsSheetVisible] = React.useState(false);
  const [activeSheetTab, setActiveSheetTab] = React.useState<SheetTab>('sentence');
  const [sheetAmount, setSheetAmount] = React.useState('');
  const [sheetSentence, setSheetSentence] = React.useState('');
  const [isParsingSentence, setIsParsingSentence] = React.useState(false);
  const [sheetNote, setSheetNote] = React.useState('');
  const [selectedCategoryKey, setSelectedCategoryKey] = React.useState('food');
  const [selectedAccountId, setSelectedAccountId] = React.useState<string | null>(null);
  const [selectedHappenedAt, setSelectedHappenedAt] = React.useState(() => new Date());
  const [isDatePickerVisible, setIsDatePickerVisible] = React.useState(false);
  const [isTimePickerVisible, setIsTimePickerVisible] = React.useState(false);
  const [isAccountPickerVisible, setIsAccountPickerVisible] = React.useState(false);
  const [accountPickerTarget, setAccountPickerTarget] = React.useState<AccountPickerTarget>('sheet');
  const [transferFromAccountId, setTransferFromAccountId] = React.useState<string | null>(null);
  const [transferToAccountId, setTransferToAccountId] = React.useState<string | null>(null);
  const [isSavingTransaction, setIsSavingTransaction] = React.useState(false);
  const [financeTransactions, setFinanceTransactions] = React.useState<FinanceTransactionRow[]>([]);
  const [financeAccounts, setFinanceAccounts] = React.useState<FinanceAccountBalanceRow[]>([]);
  const [generatingTxnAiId, setGeneratingTxnAiId] = React.useState<string | null>(null);
  const [txnAiFailEpoch, setTxnAiFailEpoch] = React.useState(0);
  const [pendingAutoLedgers, setPendingAutoLedgers] = React.useState<PendingAutoLedgerRow[]>([]);
  const [autoLedgerToastVisible, setAutoLedgerToastVisible] = React.useState(false);
  const [autoLedgerToastMessage, setAutoLedgerToastMessage] = React.useState('正在识别截图并记账…');
  const autoLedgerReturnToPreviousAppRef = React.useRef(false);
  const autoLedgerDidBackgroundRef = React.useRef(false);
  const autoLedgerHandoffTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoLedgerImageUriRef = React.useRef<string | null>(null);
  const autoLedgerSourceRef = React.useRef<'clipboard' | 'shortcut_intent'>('clipboard');
  const financeTransactionsRef = React.useRef<FinanceTransactionRow[]>([]);
  const flowCategoryNamesRef = React.useRef<Record<string, string>>({});
  const financeAccountsRef = React.useRef<FinanceAccountBalanceRow[]>([]);
  const txnAiBackfillRunning = React.useRef(false);
  const txnAiSkippedIdsRef = React.useRef<Set<string>>(new Set());
  const runTxnAiBackfillRef = React.useRef<() => Promise<void>>(async () => undefined);
  const defaultAccountsRef = React.useRef<FinanceDefaultAccounts>({
    defaultPaymentAccountId: null,
    defaultIncomeAccountId: null,
  });

  React.useLayoutEffect(() => {
    financeTransactionsRef.current = financeTransactions;
  }, [financeTransactions]);

  const activeSheetTabRef = React.useRef<SheetTab>('sentence');
  React.useLayoutEffect(() => {
    activeSheetTabRef.current = activeSheetTab;
  }, [activeSheetTab]);
  const [budgetCardNetExpanded, setBudgetCardNetExpanded] = React.useState(false);
  const [selectedNetTrendIndex, setSelectedNetTrendIndex] = React.useState(0);
  /** 预算卡与月度汇总是否显示真实金额（false 时显示 ****） */
  const [showNetAmounts, setShowNetAmounts] = React.useState(true);
  const [monthBudgetSettings, setMonthBudgetSettings] = React.useState<Record<string, MonthBudgetSetting>>({});
  /** 预算周期刷新日（每月几日起算新一周期），默认 1 日。 */
  const [budgetRefreshDay, setBudgetRefreshDay] = React.useState(DEFAULT_BUDGET_REFRESH_DAY);
  const [budgetRefreshDayDraft, setBudgetRefreshDayDraft] = React.useState(DEFAULT_BUDGET_REFRESH_DAY);
  const [isBudgetAdjustVisible, setIsBudgetAdjustVisible] = React.useState(false);
  const [budgetBaseDraft, setBudgetBaseDraft] = React.useState('');
  const [modalIncludeLast, setModalIncludeLast] = React.useState(false);
  const [fixedExpensesDraft, setFixedExpensesDraft] = React.useState<BudgetFixedExpense[]>([]);
  /** 收支明细：除「今天」外，初次最多再展示的历史日数（2 → 今天+前两日共三天） */
  const INITIAL_HISTORY_DAY_SLICES = 2;
  /** 触底后继续加载的历史日数（按有记录的自然日聚合） */
  const LOAD_MORE_HISTORY_DAY_STEP = 3;
  const [visibleDayCount, setVisibleDayCount] = React.useState(INITIAL_HISTORY_DAY_SLICES);
  const [isLoadingMoreDays, setIsLoadingMoreDays] = React.useState(false);
  const [sheetImageUris, setSheetImageUris] = React.useState<string[]>([]);
  /** 支出是否计入本月预算（收入页不展示该项，保存时也不会写入排除标记） */
  const [sheetIncludeInBudget, setSheetIncludeInBudget] = React.useState(true);
  const [isPickingImage, setIsPickingImage] = React.useState(false);
  const [isSpeechRecognizing, setIsSpeechRecognizing] = React.useState(false);
  const [speechApi, setSpeechApi] = React.useState<SpeechRecognitionApi | null>(null);
  const [speechApiStatus, setSpeechApiStatus] = React.useState<'loading' | 'ready' | 'unavailable'>('unavailable');
  const [speechTriedOnce, setSpeechTriedOnce] = React.useState(false);
  const [sentenceLedgerPreview, setSentenceLedgerPreview] = React.useState<SentenceLedgerPreviewState>(null);
  const [isSentencePreviewBusy, setIsSentencePreviewBusy] = React.useState(false);
  /** 手动记账弹窗内键盘高度，用于整体上移弹层并收缩可滚动区域，避免一句话输入框被 IME 遮挡 */
  const [sheetKeyboardInset, setSheetKeyboardInset] = React.useState(0);
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
      const [rows, categories] = await Promise.all([getFinanceTransactions(), getFinanceFlowCategories()]);
      txnAiSkippedIdsRef.current.clear();
      flowCategoryNamesRef.current = Object.fromEntries(categories.map((c) => [c.id, c.name]));
      financeTransactionsRef.current = rows;
      setFinanceTransactions(rows);
      setTxnAiFailEpoch((e) => e + 1);
      queueMicrotask(() => {
        void runTxnAiBackfillRef.current();
      });
    } catch (error) {
      console.warn('Failed to load finance transactions:', error);
      flowCategoryNamesRef.current = {};
      financeTransactionsRef.current = [];
      setFinanceTransactions([]);
    }
  }, []);

  const loadFinanceAccounts = React.useCallback(async () => {
    try {
      const rows = await getFinanceAccountsWithBalance();
      financeAccountsRef.current = rows;
      setFinanceAccounts(rows);
    } catch (error) {
      console.warn('Failed to load finance accounts:', error);
      financeAccountsRef.current = [];
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
              scheduleGithubFinanceCloudSyncDebounced();
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
    void loadBudgetRefreshDay().then(setBudgetRefreshDay);
  }, []);

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

  const sheetModalMaxHeight = React.useMemo(
    () => Math.max(200, manualSheetMaxHeight - sheetKeyboardInset),
    [manualSheetMaxHeight, sheetKeyboardInset]
  );
  const sheetModalBodyMaxHeight = React.useMemo(
    () => Math.max(200, sheetModalMaxHeight - MANUAL_SHEET_CHROME_HEIGHT),
    [sheetModalMaxHeight]
  );

  React.useEffect(() => {
    if (!isSheetVisible) {
      setSheetKeyboardInset(0);
      return;
    }
    const winH = Dimensions.get('window').height;
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const onShow = (e: KeyboardEvent) => {
      const { height, screenY } = e.endCoordinates;
      const h = Math.max(0, Math.round(height));
      /** 用「屏幕底 − 键盘顶」与 height 取较小值，避免与系统上报高度叠算导致白底离键盘还差一截 */
      if (Platform.OS === 'ios' && screenY > 0 && screenY < winH) {
        const fromScreenY = Math.max(0, Math.round(winH - screenY));
        setSheetKeyboardInset(Math.min(h, fromScreenY));
        return;
      }
      setSheetKeyboardInset(h);
    };
    const onHide = () => setSheetKeyboardInset(0);
    const subShow = Keyboard.addListener(showEvent, onShow);
    const subHide = Keyboard.addListener(hideEvent, onHide);
    return () => {
      subShow.remove();
      subHide.remove();
    };
  }, [isSheetVisible]);

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

  const getDayKey = React.useCallback(
    (value: Date) => getLogicalLocalYmd(value, dayBoundary),
    [dayBoundary],
  );

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
    if (txn.transaction_type === 'transfer') {
      const leg = readTransferLeg(txn.extra_data);
      if (leg === 'out') return -absAmount;
      if (leg === 'in') return absAmount;
      return 0;
    }
    return txn.amount;
  }, []);

  const runTxnAiBackfill = React.useCallback(async () => {
    const key = getActiveAiLlmApiKey().trim();
    if (!key || txnAiBackfillRunning.current) return;
    txnAiBackfillRunning.current = true;
    try {
      const cats = flowCategoryNamesRef.current;
      while (true) {
        const accMap = new Map(financeAccountsRef.current.map((a) => [a.id, a.name]));
        const snapshot = financeTransactionsRef.current;
        const txn = snapshot.find((r) => !r.ai_comment?.trim() && !txnAiSkippedIdsRef.current.has(r.id));
        if (!txn) break;

        const accountLabel = accMap.get(txn.account_id) ?? '未知账户';
        const categoryLabel = txn.flow_category_id ? cats[txn.flow_category_id] ?? '未分类' : '未分类';

        setGeneratingTxnAiId(txn.id);
        try {
          const result = await tryPersistFinanceTxnAiComment(txn.id, {
            name: txn.name,
            happened_at: txn.happened_at,
            transaction_type: txn.transaction_type,
            amount: txn.amount,
            note: txn.note,
            accountLabel,
            categoryLabel,
          });
          if (result.ok) {
            setFinanceTransactions((prev) => {
              const next = prev.map((t) => (t.id === txn.id ? { ...t, ai_comment: result.comment } : t));
              financeTransactionsRef.current = next;
              return next;
            });
          } else {
            txnAiSkippedIdsRef.current.add(txn.id);
            setTxnAiFailEpoch((e) => e + 1);
          }
        } finally {
          setGeneratingTxnAiId(null);
        }
      }
    } finally {
      txnAiBackfillRunning.current = false;
    }
  }, []);

  React.useLayoutEffect(() => {
    runTxnAiBackfillRef.current = runTxnAiBackfill;
  }, [runTxnAiBackfill]);

  const todayTxns = React.useMemo(
    () =>
      financeTransactions.filter((txn) => {
        const happenedAt = new Date(txn.happened_at);
        if (Number.isNaN(happenedAt.getTime())) return false;
        return getLogicalLocalYmd(happenedAt, dayBoundary) === logicalTodayYmd;
      }),
    [dayBoundary, financeTransactions, logicalTodayYmd],
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
  const todayDayKey = logicalTodayYmd;
  const sortedDayKeys = React.useMemo(() => {
    const keys = new Set<string>();
    sortedTransactions.forEach((txn) => {
      const happenedAt = new Date(txn.happened_at);
      if (Number.isNaN(happenedAt.getTime())) return;
      const dayKey = getDayKey(happenedAt);
      if (dayKey <= logicalTodayYmd) {
        keys.add(dayKey);
      }
    });
    return Array.from(keys);
  }, [getDayKey, logicalTodayYmd, sortedTransactions]);
  const historyDayKeys = React.useMemo(() => sortedDayKeys.filter((k) => k !== todayDayKey), [sortedDayKeys, todayDayKey]);
  const hasMoreHistoryDays = visibleDayCount < historyDayKeys.length;
  const visibleDayKeySet = React.useMemo(() => {
    if (historyDayKeys.length === 0) {
      return new Set<string>();
    }
    return new Set(historyDayKeys.slice(0, visibleDayCount));
  }, [historyDayKeys, visibleDayCount]);

  React.useEffect(() => {
    setVisibleDayCount(INITIAL_HISTORY_DAY_SLICES);
    setIsLoadingMoreDays(false);
  }, [todayDayKey, financeTransactions.length]);

  const loadMoreHistoryDays = React.useCallback(() => {
    if (!hasMoreHistoryDays || isLoadingMoreDays) {
      return;
    }
    setIsLoadingMoreDays(true);
    setVisibleDayCount((prev) =>
      Math.min(prev + LOAD_MORE_HISTORY_DAY_STEP, historyDayKeys.length),
    );
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

  const zhipuTxnReady = isActiveAiLlmConfigured();
  const aiLlmProviderLabel = getActiveAiLlmProviderLabel();

  const pickAccountForAutoLedger = React.useCallback(
    (
      accounts: FinanceAccountBalanceRow[],
      parsed: Pick<ParsedOneLiner, 'transaction_type' | 'account_name' | 'payment_account_label'>,
      defaults: FinanceDefaultAccounts,
    ): FinanceAccountBalanceRow | null => {
      if (!accounts.length) return null;
      const candidates = accounts.map((a) => ({ id: a.id, name: a.name, account_no: a.account_no }));
      const matched = resolveFinanceAccountForAutoLedgerWithDefaults(candidates, {
        transactionType: parsed.transaction_type,
        accountName: parsed.account_name ?? null,
        paymentAccountLabel: parsed.payment_account_label ?? null,
        defaultPaymentAccountId: defaults.defaultPaymentAccountId,
        defaultIncomeAccountId: defaults.defaultIncomeAccountId,
      });
      if (!matched) return accounts[0] ?? null;
      return accounts.find((a) => a.id === matched.id) ?? accounts[0] ?? null;
    },
    [],
  );

  /** 手动记账弹窗：按 Tab 选中默认支付/收入账户 */
  const getDefaultSheetAccountIdForTab = React.useCallback(
    (tab: SheetTab, accounts: FinanceAccountBalanceRow[]): string | null => {
      if (!accounts.length) return null;
      const defaults = defaultAccountsRef.current;
      if (tab === 'income') {
        const id = defaults.defaultIncomeAccountId;
        if (id && accounts.some((a) => a.id === id)) return id;
      } else if (tab === 'expense' || tab === 'sentence') {
        const id = defaults.defaultPaymentAccountId;
        if (id && accounts.some((a) => a.id === id)) return id;
      }
      return accounts[0]?.id ?? null;
    },
    [],
  );

  /** 当前选择的文本模型优先，失败则本地规则（与 `parseFinanceOneLinerFromText` / 调试页同源密钥）。 */
  const resolveFinanceSentenceLine = React.useCallback(async (line: string): Promise<SentenceResolveResult> => {
    const trimmed = line.trim();
    if (!trimmed) {
      return { ok: false, error: '请输入用一句话描述这笔账。' };
    }
    const accountHints = financeAccountsRef.current.map((a) => ({ name: a.name, account_no: a.account_no }));
    const key = getActiveAiLlmApiKey().trim();
    if (key) {
      const r = await parseFinanceOneLinerFromText({
        apiKey: key,
        text: trimmed,
        maxAttempts: 6,
        retryDelayMs: 800,
        accounts: accountHints.length > 0 ? accountHints : undefined,
      });
      if (r.ok) {
        return {
          ok: true,
          source: 'ai',
          parsed: {
            transaction_type: r.transaction_type,
            amount: r.amount,
            name: r.name,
            category_label: r.category_label,
            account_name: r.account_name,
            payment_account_label: r.payment_account_label,
          },
        };
      }
      const loc = parseFinanceSentenceLocal(trimmed);
      if (loc.ok) {
        return { ok: true, parsed: loc, source: 'local' };
      }
      return {
        ok: false,
        error: `智谱解析未成功（${r.error}）。本地规则也无法识别，请写清数字金额后再试。`,
      };
    }
    const loc = parseFinanceSentenceLocal(trimmed);
    if (loc.ok) return { ok: true, parsed: loc, source: 'local' };
    return {
      ok: false,
      error: '请写明金额（需含阿拉伯数字），或配置 EXPO_PUBLIC_ZHIPU_API_KEY 以使用智谱 AI 理解口语。',
    };
  }, []);

  React.useEffect(() => {
    setSentenceLedgerPreview(null);
  }, [sheetSentence]);

  const todayDisplayTxns = React.useMemo<Txn[]>(() => {
    const pendingRows = pendingAutoLedgers.map((row) => buildPendingAutoLedgerTxn(row, todayDayKey, subtle));
    const savedRows = todayTxns
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

        const aiLine = buildTxnAiInsightLine(txn, {
          zhipuReady: zhipuTxnReady,
          generatingId: generatingTxnAiId,
          skippedIds: txnAiSkippedIdsRef.current,
        });

        return {
          id: txn.id,
          dayKey: todayDayKey,
          icon,
          iconColor,
          title: txn.name?.trim() || '交易',
          meta: `今天 ${hour}:${minute} · ${typeLabel} · ${accountLabel}`,
          amount: `${amountPrefix}${formatCurrencyWithDecimals(Math.abs(displayAmount))}`,
          amountColor,
          insight: aiLine.text,
          insightIsAiBody: aiLine.isAiBody,
          insightPendingAi: aiLine.pendingAi,
        };
      });
    return [...pendingRows, ...savedRows];
  }, [
    accountNameMap,
    formatCurrencyWithDecimals,
    generatingTxnAiId,
    getTxnDisplayAmount,
    pendingAutoLedgers,
    secondary,
    subtle,
    tertiary,
    text,
    todayDayKey,
    todayTxns,
    txnAiFailEpoch,
    zhipuTxnReady,
  ]);

  const historySections = React.useMemo(() => {
    const yesterdayDayKey = logicalYesterdayYmd;
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

    const upsert = (dayKey: string) => {
      const existing = sectionMap.get(dayKey);
      if (existing) return existing;
      const date = logicalYmdToLocalDate(dayKey);
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

      const section = upsert(dayKey);
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

      const aiLine = buildTxnAiInsightLine(txn, {
        zhipuReady: zhipuTxnReady,
        generatingId: generatingTxnAiId,
        skippedIds: txnAiSkippedIdsRef.current,
      });

      section.items.push({
        id: txn.id,
        dayKey,
        icon,
        iconColor,
        title: txn.name?.trim() || '交易',
        meta: `${section.label} ${hour}:${minute} · ${typeLabel} · ${accountLabel}`,
        amount: `${amountPrefix}${formatCurrencyWithDecimals(Math.abs(displayAmount))}`,
        amountColor,
        insight: aiLine.text,
        insightIsAiBody: aiLine.isAiBody,
        insightPendingAi: aiLine.pendingAi,
      });
    });

    // 保持分组顺序：按日期从近到远（和 sortedTransactions 一致）
    return Array.from(sectionMap.values()).sort((a, b) => b.date.getTime() - a.date.getTime());
  }, [
    accountNameMap,
    formatCurrencyWithDecimals,
    generatingTxnAiId,
    getDayKey,
    getTxnDisplayAmount,
    secondary,
    sortedTransactions,
    subtle,
    tertiary,
    text,
    todayDayKey,
    visibleDayKeySet,
    logicalYesterdayYmd,
    weekdayCn,
    zhipuTxnReady,
    txnAiFailEpoch,
  ]);

  const displayTxns = React.useMemo<Txn[]>(() => {
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
      const dayKey = getDayKey(happenedAt);
      const dayDate = logicalYmdToLocalDate(dayKey);
      const dayLabel =
        dayKey === logicalTodayYmd
          ? '今天'
          : dayKey === logicalYesterdayYmd
            ? '昨天'
            : `${dayDate.getMonth() + 1}月${dayDate.getDate()}日`;
      const accountLabel = accountNameMap.get(txn.account_id) ?? '未知账户';

      const displayAmount = getTxnDisplayAmount(txn);
      const isIncome = displayAmount > 0;
      const isExpense = displayAmount < 0;
      const typeLabel = txn.transaction_type === 'transfer' ? '转账' : isIncome ? '收入' : '支出';
      const icon: keyof typeof MaterialIcons.glyphMap = isIncome ? 'savings' : isExpense ? 'shopping-bag' : 'sync-alt';
      const iconColor = isIncome ? secondary : isExpense ? tertiary : subtle;
      const amountColor = isIncome ? secondary : isExpense ? '#dc2626' : text;
      const amountPrefix = isIncome ? '+' : isExpense ? '-' : '';

      const aiLine = buildTxnAiInsightLine(txn, {
        zhipuReady: zhipuTxnReady,
        generatingId: generatingTxnAiId,
        skippedIds: txnAiSkippedIdsRef.current,
      });

      return {
        id: txn.id,
        dayKey: getDayKey(happenedAt),
        icon,
        iconColor,
        title: txn.name?.trim() || '交易',
        meta: `${dayLabel} ${hour}:${minute} · ${typeLabel} · ${accountLabel}`,
        amount: `${amountPrefix}${formatCurrencyWithDecimals(Math.abs(displayAmount))}`,
        amountColor,
        insight: aiLine.text,
        insightIsAiBody: aiLine.isAiBody,
        insightPendingAi: aiLine.pendingAi,
      };
    });
  }, [
    accountNameMap,
    formatCurrencyWithDecimals,
    generatingTxnAiId,
    getDayKey,
    getTxnDisplayAmount,
    logicalTodayYmd,
    logicalYesterdayYmd,
    secondary,
    sortedTransactions,
    subtle,
    tertiary,
    text,
    todayDayKey,
    visibleDayKeySet,
    zhipuTxnReady,
    txnAiFailEpoch,
  ]);

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

  const budgetPeriodStart = getBudgetPeriodStartForDate(today, budgetRefreshDay);
  const budgetPeriodEndExclusive = getNextBudgetPeriodStart(budgetPeriodStart, budgetRefreshDay);
  const budgetPeriodTransactions = React.useMemo(() => {
    return financeTransactions.filter((txn) => {
      const happenedAt = new Date(txn.happened_at);
      return happenedAt >= budgetPeriodStart && happenedAt < budgetPeriodEndExclusive;
    });
  }, [financeTransactions, budgetPeriodStart, budgetPeriodEndExclusive]);

  const monthlyBudgetExpense = React.useMemo(
    () =>
      budgetPeriodTransactions.reduce((sum, txn) => {
        const displayAmount = getTxnDisplayAmount(txn);
        if (displayAmount >= 0) return sum;
        if (isFinanceTransactionExcludedFromBudget(txn.extra_data)) return sum;
        return sum + Math.abs(displayAmount);
      }, 0),
    [getTxnDisplayAmount, budgetPeriodTransactions]
  );
  const monthlySurplus = monthlyIncome - monthlyExpense;
  const savingsRate = monthlyIncome > 0 ? (monthlySurplus / monthlyIncome) * 100 : 0;

  const prevBudgetPeriodStart = getPreviousBudgetPeriodStart(budgetPeriodStart, budgetRefreshDay);
  const prevBudgetPeriodEndExclusive = budgetPeriodStart;
  const prevBudgetPeriodTransactions = React.useMemo(() => {
    return financeTransactions.filter((txn) => {
      const happenedAt = new Date(txn.happened_at);
      return happenedAt >= prevBudgetPeriodStart && happenedAt < prevBudgetPeriodEndExclusive;
    });
  }, [financeTransactions, prevBudgetPeriodStart, prevBudgetPeriodEndExclusive]);
  const prevBudgetPeriodIncome = React.useMemo(
    () =>
      prevBudgetPeriodTransactions.reduce((sum, txn) => {
        const displayAmount = getTxnDisplayAmount(txn);
        return displayAmount > 0 ? sum + Math.abs(displayAmount) : sum;
      }, 0),
    [getTxnDisplayAmount, prevBudgetPeriodTransactions]
  );
  const prevBudgetPeriodExpense = React.useMemo(
    () =>
      prevBudgetPeriodTransactions.reduce((sum, txn) => {
        const displayAmount = getTxnDisplayAmount(txn);
        return displayAmount < 0 ? sum + Math.abs(displayAmount) : sum;
      }, 0),
    [getTxnDisplayAmount, prevBudgetPeriodTransactions]
  );
  const lastMonthRemaining = Math.max(0, prevBudgetPeriodIncome - prevBudgetPeriodExpense);

  const budgetPeriodIncome = React.useMemo(
    () =>
      budgetPeriodTransactions.reduce((sum, txn) => {
        const displayAmount = getTxnDisplayAmount(txn);
        return displayAmount > 0 ? sum + Math.abs(displayAmount) : sum;
      }, 0),
    [getTxnDisplayAmount, budgetPeriodTransactions]
  );

  const hiddenAmountText = '****';
  const monthlyIncomeText = showNetAmounts ? formatCurrencyWithDecimals(monthlyIncome) : hiddenAmountText;
  const monthlyExpenseText = showNetAmounts ? formatCurrencyWithDecimals(monthlyExpense) : hiddenAmountText;
  const monthlySurplusText = showNetAmounts ? formatCurrencyWithDecimals(monthlySurplus) : hiddenAmountText;
  const monthlySurplusColor = monthlySurplus > 0 ? secondary : monthlySurplus < 0 ? '#dc2626' : text;
  const savingRateText = showNetAmounts ? `${savingsRate.toFixed(1)}%` : '--';

  const budgetPeriodTotalDays = budgetPeriodLengthDays(budgetPeriodStart, budgetPeriodEndExclusive);
  const daysLeftIncludingToday = budgetDaysLeftIncludingToday(today, budgetPeriodEndExclusive);
  const currentMonthKey = getBudgetMonthKeyForDate(today, budgetRefreshDay);
  const budgetSheetMonthNumber = parseInt(currentMonthKey.split('-')[1] ?? '1', 10);
  const persistedBudgetSetting = monthBudgetSettings[currentMonthKey];
  const effectiveBaseBudget =
    currentMonthKey in monthBudgetSettings ? monthBudgetSettings[currentMonthKey]!.baseAmount : 0;
  const includeLastBalanceEffective = persistedBudgetSetting?.includeLastBalance ?? false;
  const persistedFixedExpensesTotal = sumBudgetFixedExpenses(persistedBudgetSetting?.fixedExpenses);
  const grossBudgetAmount = includeLastBalanceEffective
    ? effectiveBaseBudget + lastMonthRemaining
    : effectiveBaseBudget;
  const budgetTotalAmount = Math.max(0, grossBudgetAmount - persistedFixedExpensesTotal);
  const parsedBudgetDraft = parseFloat(budgetBaseDraft.trim().replace(/,/g, ''));
  const baseForBudgetPreview =
    Number.isFinite(parsedBudgetDraft) && parsedBudgetDraft >= 0 ? parsedBudgetDraft : effectiveBaseBudget;
  const previewFixedExpensesTotal = sumBudgetFixedExpenses(fixedExpensesDraft);
  const budgetPreviewGross = modalIncludeLast ? baseForBudgetPreview + lastMonthRemaining : baseForBudgetPreview;
  const budgetPreviewTotal = Math.max(0, budgetPreviewGross - previewFixedExpensesTotal);
  const budgetSurplusAmount = budgetTotalAmount - monthlyBudgetExpense;
  const budgetUsedPercentRaw = budgetTotalAmount > 0 ? (monthlyBudgetExpense / budgetTotalAmount) * 100 : 0;
  const budgetUsedPercent = Math.min(100, Math.max(0, budgetUsedPercentRaw));
  const dailyBudgetAmount =
    budgetPeriodIncome > 0
      ? budgetPeriodIncome / budgetPeriodTotalDays
      : budgetSurplusAmount > 0
        ? budgetSurplusAmount / daysLeftIncludingToday
        : budgetTotalAmount / daysLeftIncludingToday;
  const todayAvailableAmount = Math.max(0, dailyBudgetAmount - todayBudgetExpenseTotal);
  const todayBudgetUsagePct = dailyBudgetAmount > 0 ? Math.min(1, todayBudgetExpenseTotal / dailyBudgetAmount) : 0;

  const budgetUiNaturalMonth = budgetRefreshDay === DEFAULT_BUDGET_REFRESH_DAY;
  const budgetUiScopeShort = budgetUiNaturalMonth ? '本月' : '本周期';
  const budgetUiPrevCarryLabel = budgetUiNaturalMonth ? '上月剩余' : '上周期剩余';
  const budgetUiIncludePrevLabel = budgetUiNaturalMonth ? '包含上月结余' : '包含上周期结余';

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
  const netTrendPoints = React.useMemo((): NetWorthTrendPoint[] => {
    const DAYS = 30;
    const parsed = parseFinanceDayKey(netWorthTrendDayKey);
    if (!parsed) {
      return Array.from({ length: DAYS }, (_, i) => ({
        value: netTotalForTrend,
        dayKey: netWorthTrendDayKey,
        label: i === DAYS - 1 ? '今天' : `${DAYS - 1 - i} 天前`,
      }));
    }
    const { y: y0, m: m0, d: d0 } = parsed;

    const txns = financeTransactions
      .map((t) => {
        const ms = new Date(t.happened_at).getTime();
        return { ms, d: getTxnNetWorthTotalDelta(t) };
      })
      .filter((x) => Number.isFinite(x.ms));

    txns.sort((a, b) => b.ms - a.ms);

    const raw: NetWorthTrendPoint[] = [];
    let ti = 0;
    let suffix = 0;

    for (let offset = 0; offset < DAYS; offset++) {
      const date = new Date(y0, m0, d0 - offset);
      const nextDayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1, 0, 0, 0, 0).getTime();

      while (ti < txns.length && txns[ti].ms >= nextDayStart) {
        suffix += txns[ti].d;
        ti++;
      }
      raw.push({
        value: netTotalForTrend - suffix,
        dayKey: getDayKey(date),
        label: formatNetWorthTrendDayLabel(date, offset === 0),
      });
    }

    return raw.reverse();
  }, [financeTransactions, getDayKey, netTotalForTrend, netWorthTrendDayKey]);

  const netTrendLastIndex = netTrendPoints.length - 1;

  React.useEffect(() => {
    if (netTrendPoints.length > 0) {
      setSelectedNetTrendIndex(netTrendPoints.length - 1);
    }
  }, [netTrendPoints.length, netWorthTrendDayKey]);

  const netTrendSparseNodeIndices = React.useMemo(
    () => getSparseTrendNodeIndices(netTrendPoints.length),
    [netTrendPoints.length],
  );

  const netTrendVisibleNodeIndices = React.useMemo(() => {
    const indices = new Set(netTrendSparseNodeIndices);
    if (selectedNetTrendIndex >= 0 && selectedNetTrendIndex < netTrendPoints.length) {
      indices.add(selectedNetTrendIndex);
    }
    return [...indices].sort((a, b) => a - b);
  }, [netTrendSparseNodeIndices, netTrendPoints.length, selectedNetTrendIndex]);

  const selectedNetTrend =
    netTrendPoints[selectedNetTrendIndex] ?? netTrendPoints[netTrendLastIndex] ?? { value: netTotalForTrend, label: '今天', dayKey: netWorthTrendDayKey };
  const isSelectedNetTrendToday = selectedNetTrendIndex === netTrendLastIndex;

  /** 与 Svg viewBox 一致；inset 需 ≥ 终点圆点半径 + 描边，避免裁切。 */
  const trendChartGeometry = React.useMemo(() => {
    const w = NET_WORTH_TREND_CHART_W;
    const h = NET_WORTH_TREND_CHART_H;
    const inset = NET_WORTH_TREND_CHART_INSET;
    if (netTrendPoints.length < 2) return null;

    const vals = netTrendPoints.map((p) => p.value);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const span = max - min || 1;
    const innerW = w - inset * 2;
    const innerH = h - inset * 2;
    const baselineY = h - inset;

    const points = vals.map((value, i) => ({
      x: inset + (i / (vals.length - 1)) * innerW,
      y: inset + (1 - (value - min) / span) * innerH,
    }));

    const pathD = points
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
      .join(' ');
    const first = points[0];
    const last = points[points.length - 1];
    const areaD = `${pathD} L${last.x.toFixed(1)},${baselineY.toFixed(1)} L${first.x.toFixed(1)},${baselineY.toFixed(1)} Z`;

    return { points, pathD, areaD };
  }, [netTrendPoints]);

  const selectedNetTrendChartPoint =
    trendChartGeometry && selectedNetTrendIndex >= 0
      ? trendChartGeometry.points[selectedNetTrendIndex]
      : null;

  const trendChartPlotWidthRef = React.useRef(0);
  const netTrendPointCountRef = React.useRef(netTrendPoints.length);
  netTrendPointCountRef.current = netTrendPoints.length;

  const updateNetTrendIndexFromTouch = React.useCallback((evt: GestureResponderEvent) => {
    const n = netTrendPointCountRef.current;
    if (n < 2) return;
    const idx = netWorthTrendIndexFromLocationX(evt.nativeEvent.locationX, trendChartPlotWidthRef.current, n);
    setSelectedNetTrendIndex(idx);
  }, []);

  const netWorthTrendChartPanResponder = React.useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => netTrendPointCountRef.current >= 2,
        onMoveShouldSetPanResponder: () => netTrendPointCountRef.current >= 2,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: updateNetTrendIndexFromTouch,
        onPanResponderMove: updateNetTrendIndexFromTouch,
      }),
    [updateNetTrendIndexFromTouch],
  );

  const formatCurrencyBalance = React.useCallback(
    (value: number) => {
      if (!showNetAmounts) return hiddenAmountText;
      const prefix = value < 0 ? '-¥' : '¥';
      return `${prefix}${Math.abs(value).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    },
    [showNetAmounts]
  );

  /** 列表展示：资产类余额不低于 0，负债类不高于 0（与记账约束一致） */
  const formatCurrencyBalanceForAccount = React.useCallback(
    (acc: FinanceAccountBalanceRow) => {
      if (!showNetAmounts) return hiddenAmountText;
      const v = acc.sign_rule < 0 ? Math.min(0, acc.balance ?? 0) : Math.max(0, acc.balance ?? 0);
      return formatCurrencyBalance(v);
    },
    [formatCurrencyBalance, showNetAmounts]
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

  const beginAutoLedgerShortcutSession = React.useCallback(() => {
    autoLedgerReturnToPreviousAppRef.current = true;
    autoLedgerDidBackgroundRef.current = false;
  }, []);

  const isAutoLedgerHandoffSession = React.useCallback(
    () => autoLedgerReturnToPreviousAppRef.current || autoLedgerDidBackgroundRef.current,
    [],
  );

  const startAutoLedgerHandoff = React.useCallback(
    (source: 'clipboard' | 'shortcut_intent', message?: string) => {
      beginAutoLedgerShortcutSession();
      autoLedgerSourceRef.current = source;
      setAutoLedgerToastMessage(message ?? '正在识别截图并记账…');
      setAutoLedgerToastVisible(true);

      if (autoLedgerHandoffTimerRef.current != null) {
        clearTimeout(autoLedgerHandoffTimerRef.current);
      }
      autoLedgerHandoffTimerRef.current = setTimeout(() => {
        autoLedgerHandoffTimerRef.current = null;
        setAutoLedgerToastVisible(false);
        autoLedgerReturnToPreviousAppRef.current = false;
        autoLedgerDidBackgroundRef.current = true;
        void moveAppToBackground();
      }, AUTO_LEDGER_HANDOFF_SPLASH_MS);
    },
    [beginAutoLedgerShortcutSession],
  );

  React.useEffect(() => {
    return () => {
      if (autoLedgerHandoffTimerRef.current != null) {
        clearTimeout(autoLedgerHandoffTimerRef.current);
      }
    };
  }, []);

  const readClipboardImageForAutoLedger = React.useCallback(async (): Promise<string | null> => {
    if (Platform.OS === 'web') {
      return null;
    }
    try {
      const has = await Clipboard.hasImageAsync();
      if (!has) {
        return null;
      }
      const img = await Clipboard.getImageAsync({ format: 'png' });
      if (!img?.data) {
        return null;
      }
      autoLedgerImageUriRef.current = img.data;
      return img.data;
    } catch {
      return null;
    }
  }, []);

  const processAutoLedgerFromImage = React.useCallback(
    async (
      imageDataUri: string,
      accounts: FinanceAccountBalanceRow[],
      ledgerSource: 'clipboard' | 'shortcut_intent' = 'clipboard',
    ) => {
      autoLedgerImageUriRef.current = imageDataUri;
      autoLedgerSourceRef.current = ledgerSource;
      const handoff = isAutoLedgerHandoffSession();

      const key = getActiveAiLlmApiKey().trim();
      if (!key) {
        const prov = getActiveAiLlmProviderLabel();
        const env =
          prov === '豆包'
            ? 'EXPO_PUBLIC_ARK_API_KEY（或兼容旧名 EXPO_PUBLIC_GEMINI_API_KEY）'
            : 'EXPO_PUBLIC_ZHIPU_API_KEY';
        const msg = `未配置 ${prov} 密钥（${env}）。`;
        if (handoff) {
          void notifyAutoLedgerFailure(msg);
        } else {
          Alert.alert('无法自动记账', msg);
        }
        return;
      }

      if (!accounts.length) {
        const msg = '请先添加至少一个账户。';
        if (handoff) {
          void notifyAutoLedgerFailure(msg);
        } else {
          Alert.alert('无法自动记账', msg);
        }
        return;
      }

      const pendingId = `pending_auto_ledger_${Date.now()}_${Math.random().toString(16).slice(2)}`;
      const maxAttempts = AUTO_LEDGER_MAX_ATTEMPTS;
      setPendingAutoLedgers((prev) => [
        { id: pendingId, source: ledgerSource, retryAttempt: 1, maxAttempts },
        ...prev,
      ]);

      const accountHints = accounts.map((a) => ({ name: a.name, account_no: a.account_no }));
      let lastError = '请稍后重试。';

      try {
        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
          if (attempt > 1) {
            setPendingAutoLedgers((prev) =>
              prev.map((row) =>
                row.id === pendingId ? { ...row, retryAttempt: attempt, maxAttempts } : row,
              ),
            );
            await sleepMs(AUTO_LEDGER_RETRY_DELAY_MS);
          }

          try {
            const resolved = await parseFinanceOneLinerFromImage({
              apiKey: key,
              imageDataUri,
              accounts: accountHints,
              maxAttempts: 2,
              retryDelayMs: 800,
            });
            if (!resolved.ok) {
              lastError = resolved.error;
              console.warn(`Auto ledger parse attempt ${attempt}/${maxAttempts} failed:`, resolved.error);
              continue;
            }

            const defaults = sanitizeFinanceDefaultAccounts(defaultAccountsRef.current, accounts);
            const account = pickAccountForAutoLedger(
              accounts,
              {
                transaction_type: resolved.transaction_type,
                account_name: resolved.account_name,
                payment_account_label: resolved.payment_account_label,
              },
              defaults,
            );
            if (!account) {
              const msg = '请先添加至少一个账户。';
              if (handoff) {
                void notifyAutoLedgerFailure(msg);
              } else {
                Alert.alert('无法自动记账', msg);
              }
              return;
            }

            const parsed = {
              transaction_type: resolved.transaction_type,
              amount: resolved.amount,
              name: resolved.name,
              category_label: resolved.category_label,
            };

            const cat = pickSheetCategoryForParsed(
              parsed.transaction_type,
              parsed.category_label,
              expenseCategories,
              incomeCategories,
            );
            const transactionType = parsed.transaction_type;
            const amountAbs = parsed.amount;
            const signedAmount = account.sign_rule > 0 ? amountAbs : -amountAbs;
            const boundsErr = validateFinanceLedgerBalanceAfterChange(
              account.sign_rule,
              account.balance ?? 0,
              transactionType,
              signedAmount,
              null,
            );
            if (boundsErr) {
              if (handoff) {
                void notifyAutoLedgerFailure(boundsErr);
              } else {
                Alert.alert('无法记账', boundsErr);
              }
              return;
            }

            const txnId = `ft_${Date.now()}_${Math.random().toString(16).slice(2)}`;
            const happenedAtIso = new Date().toISOString();
            const noteLine =
              ledgerSource === 'shortcut_intent'
                ? `快捷指令截图 · ${parsed.name}`
                : `剪贴板截图 · ${parsed.name}`;

            await createFinanceTransaction({
              id: txnId,
              name: parsed.name,
              happened_at: happenedAtIso,
              account_id: account.id,
              transaction_type: transactionType,
              amount: signedAmount,
              note: noteLine,
              extra_data: JSON.stringify({
                manual: true,
                sentence: true,
                parse_source: 'ai',
                from_clipboard_screenshot: ledgerSource === 'clipboard',
                from_shortcut_intent: ledgerSource === 'shortcut_intent',
                recognized_payment_account: resolved.payment_account_label,
                matched_account_name: account.name,
                category_key: cat.key,
                category_label: cat.label,
                attachments: [{ type: 'image', uri: imageDataUri }],
              }),
            });
            await Promise.all([loadFinanceTransactions(), loadFinanceAccounts()]);
            scheduleGithubFinanceCloudSyncDebounced();
            return;
          } catch (error) {
            lastError =
              error instanceof Error && error.message.trim() ? error.message : '请稍后重试。';
            console.warn(`Auto ledger attempt ${attempt}/${maxAttempts} failed:`, error);
          }
        }

        const failMsg = `已自动重试 ${maxAttempts} 次仍未成功，请检查网络或截图是否清晰后重试。\n\n${lastError}`;
        if (handoff) {
          void notifyAutoLedgerFailure(failMsg);
        } else {
          Alert.alert('自动记账失败', failMsg);
        }
      } finally {
        setPendingAutoLedgers((prev) => prev.filter((row) => row.id !== pendingId));
      }
    },
    [
      expenseCategories,
      incomeCategories,
      isAutoLedgerHandoffSession,
      loadFinanceAccounts,
      loadFinanceTransactions,
      pickAccountForAutoLedger,
    ],
  );

  const keypadRows = React.useMemo(
    () => [
      ['1', '2', '3', 'backspace'],
      ['4', '5', '6', '+'],
      ['7', '8', '9', '-'],
      ['0', '.', 'done'],
    ],
    []
  );

  const activeCategories =
    activeSheetTab === 'income' ? incomeCategories : activeSheetTab === 'expense' ? expenseCategories : expenseCategories;
  const selectedCategory = React.useMemo(() => {
    return activeCategories.find((item) => item.key === selectedCategoryKey) ?? activeCategories[0];
  }, [activeCategories, selectedCategoryKey]);
  const selectedAccount = React.useMemo(() => {
    return financeAccounts.find((account) => account.id === selectedAccountId) ?? financeAccounts[0] ?? null;
  }, [financeAccounts, selectedAccountId]);
  const transferFromAccount = React.useMemo(
    () => (transferFromAccountId ? financeAccounts.find((a) => a.id === transferFromAccountId) ?? null : null),
    [financeAccounts, transferFromAccountId]
  );
  const transferToAccount = React.useMemo(
    () => (transferToAccountId ? financeAccounts.find((a) => a.id === transferToAccountId) ?? null : null),
    [financeAccounts, transferToAccountId]
  );
  const transferSaveReady =
    transferFromAccount != null &&
    transferToAccount != null &&
    transferFromAccount.id !== transferToAccount.id &&
    transferFromAccount.sign_rule === 1 &&
    transferToAccount.sign_rule === 1;
  const sheetDateLabel = `${selectedHappenedAt.getMonth() + 1}月${selectedHappenedAt.getDate()}日`;
  const sheetTimeLabel = `${String(selectedHappenedAt.getHours()).padStart(2, '0')}:${String(selectedHappenedAt.getMinutes()).padStart(2, '0')}`;
  const hasAccounts = financeAccounts.length > 0;
  const amountNumber = Number(sheetAmount);
  const canSaveTransaction =
    Number.isFinite(amountNumber) &&
    amountNumber > 0 &&
    !isSavingTransaction &&
    (activeSheetTab === 'transfer' ? transferSaveReady : Boolean(selectedAccount));
  const canSaveSentence =
    Boolean(selectedAccount) &&
    sheetSentence.trim().length > 0 &&
    !isSavingTransaction &&
    !isParsingSentence &&
    !isSentencePreviewBusy;
  const amountDisplay = sheetAmount ? Number(sheetAmount).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00';

  React.useEffect(() => {
    if (!selectedAccountId && financeAccounts.length > 0) {
      setSelectedAccountId(getDefaultSheetAccountIdForTab(activeSheetTab, financeAccounts));
    }
  }, [activeSheetTab, financeAccounts, getDefaultSheetAccountIdForTab, selectedAccountId]);

  React.useEffect(() => {
    if (!isSheetVisible || activeSheetTab !== 'transfer') return;
    const list = financeAccounts;
    if (!list.length) return;
    setTransferFromAccountId((prevFrom) => {
      const fromId = prevFrom && list.some((a) => a.id === prevFrom) ? prevFrom : list[0].id;
      setTransferToAccountId((prevTo) => {
        if (prevTo && list.some((a) => a.id === prevTo) && prevTo !== fromId) return prevTo;
        return list.find((a) => a.id !== fromId)?.id ?? fromId;
      });
      return fromId;
    });
  }, [isSheetVisible, activeSheetTab, financeAccounts]);

  React.useEffect(() => {
    if (activeSheetTab === 'sentence') return;
    if (activeSheetTab === 'expense' && !expenseCategories.some((item) => item.key === selectedCategoryKey)) {
      setSelectedCategoryKey(expenseCategories[0]?.key ?? 'food');
    }
    if (activeSheetTab === 'income' && !incomeCategories.some((item) => item.key === selectedCategoryKey)) {
      setSelectedCategoryKey(incomeCategories[0]?.key ?? 'salary');
    }
  }, [activeSheetTab, expenseCategories, incomeCategories, selectedCategoryKey]);

  const resetSheetForm = React.useCallback((nextTab: SheetTab = 'sentence') => {
    speechApi?.ExpoSpeechRecognitionModule.stop();
    setActiveSheetTab(nextTab);
    setSheetAmount('');
    setSheetSentence('');
    setSheetNote('');
    setSheetImageUris([]);
    setSheetIncludeInBudget(true);
    setSelectedHappenedAt(new Date());
    setIsDatePickerVisible(false);
    setIsTimePickerVisible(false);
    setIsAccountPickerVisible(false);
    setAccountPickerTarget('sheet');
    setSelectedCategoryKey(nextTab === 'income' ? 'salary' : 'food');
    setSentenceLedgerPreview(null);
    setIsSentencePreviewBusy(false);
    const list = financeAccountsRef.current;
    if (list.length > 0) {
      setSelectedAccountId(getDefaultSheetAccountIdForTab(nextTab, list));
    }
  }, [getDefaultSheetAccountIdForTab, speechApi]);

  const applyManualOrTransferSheetIntent = React.useCallback(
    (intent: FinanceSheetLaunchIntent) => {
      const list = financeAccountsRef.current;
      if (intent.kind === 'auto_ledger_clipboard_pending' || intent.kind === 'auto_ledger_clipboard_image') {
        return;
      }
      if (!list.length) {
        Alert.alert('请先添加账户', '当前还没有可用账户，请先前往资产页添加账户后再记账。');
        return;
      }
      if (intent.kind === 'manual') {
        resetSheetForm(intent.tab);
        const accId =
          intent.accountId && list.some((a) => a.id === intent.accountId)
            ? intent.accountId
            : getDefaultSheetAccountIdForTab(intent.tab, list) ?? list[0].id;
        setSelectedAccountId(accId);
        setIsSheetVisible(true);
        return;
      }
      const assetOnly = list.filter((a) => a.sign_rule === 1);
      if (assetOnly.length < 2) {
        Alert.alert('无法转账', '至少需要两个资产账户才能进行转账。');
        return;
      }
      resetSheetForm('transfer');
      const fromId =
        intent.fromAccountId && assetOnly.some((a) => a.id === intent.fromAccountId)
          ? intent.fromAccountId
          : assetOnly[0].id;
      const toId = assetOnly.find((a) => a.id !== fromId)?.id ?? assetOnly[1]?.id ?? fromId;
      setTransferFromAccountId(fromId);
      setTransferToAccountId(toId);
      setIsSheetVisible(true);
    },
    [getDefaultSheetAccountIdForTab, resetSheetForm],
  );

  /** 仅在财务 Tab 聚焦时接管弹窗；账户详情等栈页由根级 FinanceSheetHost 渲染 */
  useFocusEffect(
    React.useCallback(() => {
      setFinanceSheetBridge({
        open: (intent) => {
          void loadFinanceAccounts().then(() => applyManualOrTransferSheetIntent(intent));
        },
      });
      return () => setFinanceSheetBridge(null);
    }, [applyManualOrTransferSheetIntent, loadFinanceAccounts]),
  );

  useFocusEffect(
    React.useCallback(() => {
      let cancelled = false;
      void (async () => {
        try {
          await Promise.all([loadFinanceTransactions(), loadFinanceAccounts()]);
          if (cancelled) return;

          const rawDefaults = await loadFinanceDefaultAccounts();
          if (!cancelled) {
            defaultAccountsRef.current = sanitizeFinanceDefaultAccounts(rawDefaults, financeAccountsRef.current);
          }

          const intent = consumeFinanceSheetLaunchIntent();
          const list = financeAccountsRef.current;

          if (intent) {
            if (intent.kind === 'auto_ledger_clipboard_pending') {
              startAutoLedgerHandoff('clipboard', '正在读取并识别截图…');
              const imageUri = await readClipboardImageForAutoLedger();
              if (cancelled) return;
              if (imageUri) {
                if (list.length > 0) {
                  void processAutoLedgerFromImage(imageUri, list, 'clipboard');
                } else {
                  void notifyAutoLedgerFailure('请先添加至少一个账户。');
                }
              } else {
                void notifyAutoLedgerFailure(
                  '剪贴板里没有图片或读取失败，请先在快捷指令中复制截图并允许粘贴。',
                );
              }
            } else if (intent.kind === 'auto_ledger_clipboard_image') {
              if (list.length > 0) {
                startAutoLedgerHandoff('clipboard');
                void processAutoLedgerFromImage(intent.imageDataUri, list, 'clipboard');
              } else {
                startAutoLedgerHandoff('clipboard');
                void notifyAutoLedgerFailure('请先添加至少一个账户。');
              }
            } else if (list.length > 0) {
              applyManualOrTransferSheetIntent(intent);
            }
          } else {
            const shortcutImageUri = await consumeShortcutAutoLedgerImageDataUri();
            if (cancelled) return;
            if (shortcutImageUri) {
              autoLedgerImageUriRef.current = shortcutImageUri;
              if (list.length > 0) {
                startAutoLedgerHandoff('shortcut_intent');
                void processAutoLedgerFromImage(shortcutImageUri, list, 'shortcut_intent');
              } else {
                startAutoLedgerHandoff('shortcut_intent');
                void notifyAutoLedgerFailure('请先添加至少一个账户。');
              }
            }
          }

          const settings = await loadMonthBudgetSettings();
          if (!cancelled) setMonthBudgetSettings(settings);
          const rd = await loadBudgetRefreshDay();
          if (!cancelled) setBudgetRefreshDay(rd);
        } catch (e) {
          console.warn('Finance tab focus refresh failed:', e);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [
      getDefaultSheetAccountIdForTab,
      loadFinanceAccounts,
      loadFinanceTransactions,
      processAutoLedgerFromImage,
      readClipboardImageForAutoLedger,
      applyManualOrTransferSheetIntent,
      resetSheetForm,
      startAutoLedgerHandoff,
    ])
  );

  const closeSheet = React.useCallback(() => {
    if (isSavingTransaction || isParsingSentence || isSentencePreviewBusy) return;
    speechApi?.ExpoSpeechRecognitionModule.stop();
    setIsDatePickerVisible(false);
    setIsTimePickerVisible(false);
    setIsAccountPickerVisible(false);
    setAccountPickerTarget('sheet');
    setIsSheetVisible(false);
  }, [isParsingSentence, isSavingTransaction, isSentencePreviewBusy, speechApi]);

  const closeBudgetAdjust = React.useCallback(() => {
    setIsBudgetAdjustVisible(false);
  }, []);

  const newBudgetFixedExpenseId = React.useCallback(
    () => `mfe_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    [],
  );

  const openBudgetAdjust = React.useCallback(() => {
    const row = monthBudgetSettings[currentMonthKey];
    const base = row ? row.baseAmount : 0;
    const inc = row?.includeLastBalance ?? false;
    setBudgetBaseDraft(base.toFixed(2));
    setModalIncludeLast(inc);
    setFixedExpensesDraft(row?.fixedExpenses ? row.fixedExpenses.map((item) => ({ ...item })) : []);
    setBudgetRefreshDayDraft(budgetRefreshDay);
    setIsBudgetAdjustVisible(true);
  }, [monthBudgetSettings, currentMonthKey, budgetRefreshDay]);

  const handleAddFixedExpense = React.useCallback(() => {
    setFixedExpensesDraft((prev) => [...prev, { id: newBudgetFixedExpenseId(), name: '', amount: 0 }]);
  }, [newBudgetFixedExpenseId]);

  const handleUpdateFixedExpense = React.useCallback(
    (id: string, patch: Partial<Pick<BudgetFixedExpense, 'name' | 'amount'>>) => {
      setFixedExpensesDraft((prev) =>
        prev.map((item) => (item.id === id ? { ...item, ...patch } : item)),
      );
    },
    [],
  );

  const handleDeleteFixedExpense = React.useCallback((id: string, name: string) => {
    Alert.alert('删除固定支出', `确定删除「${name || '未命名'}」？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => setFixedExpensesDraft((prev) => prev.filter((item) => item.id !== id)),
      },
    ]);
  }, []);

  const sanitizeFixedExpensesDraft = React.useCallback((): BudgetFixedExpense[] => {
    const out: BudgetFixedExpense[] = [];
    for (const item of fixedExpensesDraft) {
      const name = item.name.trim();
      const amount = item.amount;
      if (!name) continue;
      if (!Number.isFinite(amount) || amount <= 0) continue;
      out.push({ id: item.id, name, amount });
    }
    return out;
  }, [fixedExpensesDraft]);

  const handleSaveBudgetAdjust = React.useCallback(() => {
    const normalized = budgetBaseDraft.trim().replace(/,/g, '');
    const n = parseFloat(normalized);
    if (!Number.isFinite(n) || n < 0) {
      Alert.alert('金额无效', '请输入大于等于 0 的月预算基数。');
      return;
    }
    const incompleteFixed = fixedExpensesDraft.some((item) => {
      const hasName = item.name.trim().length > 0;
      const hasAmount = Number.isFinite(item.amount) && item.amount > 0;
      return (hasName && !hasAmount) || (!hasName && hasAmount);
    });
    if (incompleteFixed) {
      Alert.alert('固定支出未填完整', '请为每条固定支出填写名称和大于 0 的金额，或删除空白行。');
      return;
    }
    const fixedExpenses = sanitizeFixedExpensesDraft();
    const nextRefresh = clampBudgetRefreshDay(budgetRefreshDayDraft);
    void persistBudgetRefreshDay(nextRefresh);
    setBudgetRefreshDay(nextRefresh);
    setMonthBudgetSettings((prev) => {
      const next = {
        ...prev,
        [currentMonthKey]: {
          baseAmount: n,
          includeLastBalance: modalIncludeLast,
          ...(fixedExpenses.length > 0 ? { fixedExpenses } : {}),
        },
      };
      void persistMonthBudgetSettings(next);
      return next;
    });
    setIsBudgetAdjustVisible(false);
  }, [
    budgetBaseDraft,
    budgetRefreshDayDraft,
    currentMonthKey,
    fixedExpensesDraft,
    modalIncludeLast,
    sanitizeFixedExpensesDraft,
  ]);

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

  const handleSelectAccount = React.useCallback(
    (accountId: string) => {
      if (accountPickerTarget === 'transferFrom') {
        if (accountId === transferToAccountId) {
          Alert.alert(
            '不能同一账户转账',
            financeAccounts.length < 2
              ? '请先添加至少两个资产账户后再进行转账。'
              : '转出账户与入账账户不能相同，请选择其他账户。',
          );
          return;
        }
        setTransferFromAccountId(accountId);
      } else if (accountPickerTarget === 'transferTo') {
        if (accountId === transferFromAccountId) {
          Alert.alert(
            '不能同一账户转账',
            financeAccounts.length < 2
              ? '请先添加至少两个资产账户后再进行转账。'
              : '转出账户与入账账户不能相同，请选择其他账户。',
          );
          return;
        }
        setTransferToAccountId(accountId);
      } else {
        setSelectedAccountId(accountId);
      }
      setIsAccountPickerVisible(false);
      setAccountPickerTarget('sheet');
    },
    [accountPickerTarget, financeAccounts.length, transferFromAccountId, transferToAccountId],
  );

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

  const handleSentenceLedgerPreview = React.useCallback(async () => {
    if (!selectedAccount) {
      Alert.alert('请选择账户', '需要选择一个可用账户后再做识别预览。');
      return;
    }
    const line = sheetSentence.trim();
    if (!line) {
      Alert.alert('请输入内容', '用一句话描述这笔账。');
      return;
    }
    setIsSentencePreviewBusy(true);
    setSentenceLedgerPreview(null);
    try {
      const resolved = await resolveFinanceSentenceLine(line);
      if (!resolved.ok) {
        setSentenceLedgerPreview({ kind: 'error', message: resolved.error });
        return;
      }
      const cat = pickSheetCategoryForParsed(
        resolved.parsed.transaction_type,
        resolved.parsed.category_label,
        expenseCategories,
        incomeCategories,
      );
      setSentenceLedgerPreview({
        kind: 'ok',
        source: resolved.source,
        transaction_type: resolved.parsed.transaction_type,
        amount: resolved.parsed.amount,
        name: resolved.parsed.name,
        categoryLabel: cat.label,
      });
    } finally {
      setIsSentencePreviewBusy(false);
    }
  }, [selectedAccount, sheetSentence, resolveFinanceSentenceLine, expenseCategories, incomeCategories]);

  const handleSaveTransaction = React.useCallback(async () => {
    speechApi?.ExpoSpeechRecognitionModule.stop();

    if (activeSheetTab === 'transfer') {
      if (!transferFromAccount || !transferToAccount) {
        Alert.alert('请选择账户', '需要选择扣款账户与入账账户。');
        return;
      }
      if (transferFromAccount.id === transferToAccount.id) {
        Alert.alert('账户相同', '扣款与入账账户不能是同一个。');
        return;
      }
      if (transferFromAccount.sign_rule !== 1 || transferToAccount.sign_rule !== 1) {
        Alert.alert(
          '暂不支持',
          '转账目前仅在资产类账户之间可用。若涉及信用卡/负债账户，请用「支出」或「收入」分别记账。',
        );
        return;
      }
      if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
        Alert.alert('请输入金额', '转账金额需要大于 0。');
        return;
      }
      const ts = Date.now();
      const rnd = Math.random().toString(16).slice(2);
      const groupId = `tg_${ts}_${rnd}`;
      const idOut = `ft_${ts}_out_${rnd}`;
      const idIn = `ft_${ts}_in_${rnd}`;
      const happenedAt = selectedHappenedAt.toISOString();
      const absAmount = amountNumber;
      const noteTrim = sheetNote.trim() || null;
      const fromName = transferFromAccount.name;
      const toName = transferToAccount.name;
      const titleOut = `转至「${toName}」`;
      const titleIn = `转自「${fromName}」`;

      const extraOut = JSON.stringify({
        manual: true,
        transfer_group_id: groupId,
        transfer_leg: 'out',
        counterparty_account_id: transferToAccount.id,
        counterparty_account_name: toName,
      });
      const extraIn = JSON.stringify({
        manual: true,
        transfer_group_id: groupId,
        transfer_leg: 'in',
        counterparty_account_id: transferFromAccount.id,
        counterparty_account_name: fromName,
      });
      const errFrom = validateFinanceLedgerBalanceAfterChange(
        transferFromAccount.sign_rule,
        transferFromAccount.balance ?? 0,
        'transfer',
        absAmount,
        extraOut
      );
      const errTo = validateFinanceLedgerBalanceAfterChange(
        transferToAccount.sign_rule,
        transferToAccount.balance ?? 0,
        'transfer',
        absAmount,
        extraIn
      );
      if (errFrom || errTo) {
        Alert.alert('无法转账', errFrom ?? errTo ?? '转出或转入后账户余额不符合类型约束。');
        return;
      }

      try {
        setIsSavingTransaction(true);
        await createFinanceTransaction({
          id: idOut,
          name: titleOut,
          happened_at: happenedAt,
          account_id: transferFromAccount.id,
          transaction_type: 'transfer',
          amount: absAmount,
          note: noteTrim,
          extra_data: extraOut,
        });
        await createFinanceTransaction({
          id: idIn,
          name: titleIn,
          happened_at: happenedAt,
          account_id: transferToAccount.id,
          transaction_type: 'transfer',
          amount: absAmount,
          note: noteTrim,
          extra_data: extraIn,
        });
        setIsSheetVisible(false);
        resetSheetForm('sentence');
        await Promise.all([loadFinanceTransactions(), loadFinanceAccounts()]);
        scheduleGithubFinanceCloudSyncDebounced();
      } catch (error) {
        console.warn('Failed to create transfer transactions:', error);
        Alert.alert(
          '保存失败',
          error instanceof Error && error.message.trim() ? error.message : '转账记录保存失败，请稍后重试。',
        );
      } finally {
        setIsSavingTransaction(false);
      }
      return;
    }

    if (!selectedAccount) {
      Alert.alert('请选择账户', '需要选择一个可用账户后才能记账。');
      return;
    }

    if (activeSheetTab === 'sentence') {
      const line = sheetSentence.trim();
      if (!line) {
        Alert.alert('请输入内容', '用一句话描述这笔账，需包含金额。');
        return;
      }

      const happenedAtIso = selectedHappenedAt.toISOString();
      const includeInBudget = sheetIncludeInBudget;
      const manualAccount = selectedAccount;

      setIsSheetVisible(false);
      resetSheetForm('sentence');

      void (async () => {
        try {
          const resolved = await resolveFinanceSentenceLine(line);
          if (!resolved.ok) {
            Alert.alert('无法识别', resolved.error);
            return;
          }
          const parsed = resolved.parsed;
          const defaults = sanitizeFinanceDefaultAccounts(
            defaultAccountsRef.current,
            financeAccountsRef.current,
          );
          const account =
            resolved.source === 'ai'
              ? pickAccountForAutoLedger(financeAccountsRef.current, parsed, defaults) ?? manualAccount
              : manualAccount;
          if (!account) {
            Alert.alert('请选择账户', '需要选择一个可用账户后才能记账。');
            return;
          }

          const cat = pickSheetCategoryForParsed(
            parsed.transaction_type,
            parsed.category_label,
            expenseCategories,
            incomeCategories,
          );
          const transactionType = parsed.transaction_type;
          const amountAbs = parsed.amount;
          const signedAmount = account.sign_rule > 0 ? amountAbs : -amountAbs;
          const boundsErr = validateFinanceLedgerBalanceAfterChange(
            account.sign_rule,
            account.balance ?? 0,
            transactionType,
            signedAmount,
            null,
          );
          if (boundsErr) {
            Alert.alert('无法记账', boundsErr);
            return;
          }

          try {
            const txnId = `ft_${Date.now()}_${Math.random().toString(16).slice(2)}`;
            await createFinanceTransaction({
              id: txnId,
              name: parsed.name,
              happened_at: happenedAtIso,
              account_id: account.id,
              transaction_type: transactionType,
              amount: signedAmount,
              note: line,
              extra_data: JSON.stringify({
                manual: true,
                sentence: true,
                parse_source: resolved.source,
                category_key: cat.key,
                category_label: cat.label,
                attachments: null,
                ...(transactionType === 'expense' && !includeInBudget ? { exclude_from_budget: true } : {}),
              }),
            });
            await Promise.all([loadFinanceTransactions(), loadFinanceAccounts()]);
            scheduleGithubFinanceCloudSyncDebounced();
          } catch (error) {
            console.warn('Failed to create finance transaction:', error);
            Alert.alert(
              '保存失败',
              error instanceof Error && error.message.trim() ? error.message : '手动记账保存失败，请稍后重试。',
            );
          }
        } catch (error) {
          console.warn('Sentence ledger pipeline failed:', error);
          Alert.alert(
            '保存失败',
            error instanceof Error && error.message.trim() ? error.message : '一句话记账处理失败，请稍后重试。',
          );
        }
      })();

      return;
    }

    if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
      Alert.alert('请输入金额', '记账金额需要大于 0。');
      return;
    }
    const transactionType = activeSheetTab;
    const signedAmount = selectedAccount.sign_rule > 0 ? amountNumber : -amountNumber;
    const manualBoundsErr = validateFinanceLedgerBalanceAfterChange(
      selectedAccount.sign_rule,
      selectedAccount.balance ?? 0,
      transactionType,
      signedAmount,
      null
    );
    if (manualBoundsErr) {
      Alert.alert('无法记账', manualBoundsErr);
      return;
    }
    const fallbackName = transactionType === 'income' ? '收入' : '支出';
    const title = sheetNote.trim() || selectedCategory?.label || fallbackName;

    try {
      setIsSavingTransaction(true);
      const txnId = `ft_${Date.now()}_${Math.random().toString(16).slice(2)}`;
      await createFinanceTransaction({
        id: txnId,
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
      resetSheetForm('sentence');
      await Promise.all([loadFinanceTransactions(), loadFinanceAccounts()]);
      scheduleGithubFinanceCloudSyncDebounced();
    } catch (error) {
      console.warn('Failed to create finance transaction:', error);
      Alert.alert(
        '保存失败',
        error instanceof Error && error.message.trim() ? error.message : '手动记账保存失败，请稍后重试。',
      );
    } finally {
      setIsSavingTransaction(false);
    }
  }, [
    activeSheetTab,
    amountNumber,
    expenseCategories,
    incomeCategories,
    loadFinanceAccounts,
    loadFinanceTransactions,
    pickAccountForAutoLedger,
    resetSheetForm,
    resolveFinanceSentenceLine,
    selectedAccount,
    selectedCategory,
    selectedHappenedAt,
    sheetImageUris,
    sheetIncludeInBudget,
    sheetNote,
    sheetSentence,
    speechApi,
    transferFromAccount,
    transferToAccount,
  ]);

  const handleOpenComposer = React.useCallback((): boolean => {
    if (!hasAccounts) {
      Alert.alert('请先添加账户', '当前还没有可用账户，请先前往资产页添加账户后再记账。');
      return false;
    }
    // 仅在弹窗未打开时重置表单；避免用户已输入金额/备注后点语音/图片又被清空
    if (!isSheetVisible) {
      resetSheetForm('sentence');
    } else {
      setSelectedAccountId(
        (prev) => prev ?? getDefaultSheetAccountIdForTab(activeSheetTabRef.current, financeAccounts),
      );
    }
    setIsSheetVisible(true);
    return true;
  }, [financeAccounts, getDefaultSheetAccountIdForTab, hasAccounts, resetSheetForm, isSheetVisible]);

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
            if (activeSheetTabRef.current === 'sentence') setSheetSentence(transcript);
            else setSheetNote(transcript);
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
          ]}
          collapsable={false}>
          <View style={styles.headerInner}>
            <View style={styles.headerSide}>
              <AppIconButton
                icon="savings"
                color={text}
                hitSlop={Layout.hitSlop}
                onPress={() => router.push('/savings-plan')}
                accessibilityLabel="存钱计划"
              />
            </View>
            <View style={styles.headerCenter} pointerEvents="box-none">
              <Text style={[styles.headerTitle, { color: text }]} numberOfLines={1} pointerEvents="none">
                {headerDateLabel}
              </Text>
            </View>
            <View style={[styles.headerSide, styles.headerSideRight]}>
              <AppIconButton
                icon="calendar-today"
                color={text}
                hitSlop={Layout.hitSlop}
                onPress={() => router.push('/finance-calendar')}
                accessibilityLabel="财务日历"
              />
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
                        <Text style={[styles.budgetSurplusTitle, { color: subtle }]}>{budgetUiScopeShort}预算结余</Text>
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
                        <View style={[styles.budgetProgressTrack, { backgroundColor: isDark ? 'rgba(96,165,250,0.2)' : '#e3eefc' }]}>
                          <View
                            style={[
                              styles.budgetProgressFill,
                              {
                                width: `${budgetUsedPercent}%`,
                                backgroundColor: isDark ? '#60a5fa' : '#3b82f6',
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
                  <Text style={[styles.trendChartDayLabel, { color: isSelectedNetTrendToday ? subtle : primary }]}>
                    {selectedNetTrend.label}
                    {!isSelectedNetTrendToday ? ' · 净资产' : ''}
                  </Text>
                  <Text style={[styles.budgetNetAmount, { color: text }]}>
                    {showNetAmounts ? formatCurrencyWithDecimals(selectedNetTrend.value) : hiddenAmountText}
                  </Text>

                  <View style={styles.trendChartWrap}>
                    <View
                      style={styles.trendChartPlot}
                      onLayout={(e) => {
                        trendChartPlotWidthRef.current = e.nativeEvent.layout.width;
                      }}>
                      <Svg
                        width="100%"
                        height={NET_WORTH_TREND_CHART_H}
                        viewBox={`0 0 ${NET_WORTH_TREND_CHART_W} ${NET_WORTH_TREND_CHART_H}`}
                        preserveAspectRatio="none"
                        style={StyleSheet.absoluteFillObject}>
                        {trendChartGeometry ? (
                          <>
                            <Defs>
                              <LinearGradient id="netWorthTrendFill" x1="0" y1="0" x2="0" y2="1">
                                <Stop offset="0" stopColor={primary} stopOpacity={isDark ? 0.22 : 0.16} />
                                <Stop offset="1" stopColor={primary} stopOpacity={0} />
                              </LinearGradient>
                            </Defs>
                            <Path d={trendChartGeometry.areaD} fill="url(#netWorthTrendFill)" />
                            <Path
                              d={trendChartGeometry.pathD}
                              fill="none"
                              stroke={primary}
                              strokeWidth={2}
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                            {selectedNetTrendChartPoint && !isSelectedNetTrendToday ? (
                              <Path
                                d={`M${selectedNetTrendChartPoint.x.toFixed(1)},${NET_WORTH_TREND_CHART_INSET} L${selectedNetTrendChartPoint.x.toFixed(1)},${NET_WORTH_TREND_CHART_H - NET_WORTH_TREND_CHART_INSET}`}
                                stroke={isDark ? 'rgba(96,165,250,0.35)' : 'rgba(0,88,190,0.28)'}
                                strokeWidth={1}
                                strokeDasharray="3 3"
                              />
                            ) : null}
                          </>
                        ) : null}
                      </Svg>
                      {trendChartGeometry ? (
                        <View style={styles.trendChartNodes} pointerEvents="none">
                          {trendChartGeometry.points.map((p, i) => {
                            const isVisible = netTrendVisibleNodeIndices.includes(i);
                            const isSelected = i === selectedNetTrendIndex;
                            const isLast = i === netTrendLastIndex;
                            const dotSize = isSelected ? 10 : isLast ? 8 : 6;
                            return (
                              <View
                                key={`net-trend-node-${i}`}
                                style={[
                                  styles.trendChartNodeHit,
                                  {
                                    left: `${(p.x / NET_WORTH_TREND_CHART_W) * 100}%`,
                                    top: `${(p.y / NET_WORTH_TREND_CHART_H) * 100}%`,
                                  },
                                ]}>
                                {isVisible ? (
                                  <View
                                    style={[
                                      styles.trendChartNodeDot,
                                      {
                                        width: dotSize,
                                        height: dotSize,
                                        borderRadius: dotSize / 2,
                                        backgroundColor: isSelected ? primary : surface,
                                        borderColor: primary,
                                        borderWidth: isSelected ? 2 : 1.5,
                                      },
                                    ]}
                                  />
                                ) : null}
                              </View>
                            );
                          })}
                        </View>
                      ) : null}
                      {trendChartGeometry ? (
                        <View
                          {...netWorthTrendChartPanResponder.panHandlers}
                          style={styles.trendChartScrubOverlay}
                          accessibilityRole="adjustable"
                          accessibilityLabel="净资产趋势图，滑动查看不同日期"
                          accessibilityHint="在图表上左右滑动或按住拖动以查看各日净资产"
                        />
                      ) : null}
                    </View>
                    <Text style={[styles.trendChartHint, { color: subtle }]}>滑动折线图查看各日净资产</Text>
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
                    <Text style={[styles.accountValue, { color: valueColor }]}>{formatCurrencyBalanceForAccount(acc)}</Text>
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

              const rowBody = (
                <Animated.View
                  style={[
                    styles.txnSwipeForeground,
                    { backgroundColor: surface, borderColor: outlineVariant },
                    t.isPendingPlaceholder ? styles.txnSwipeForegroundPending : null,
                    { opacity: itemOpacity, transform: [{ translateY: itemTranslateY }] },
                  ]}>
                  <TxnItem
                    themeText={text}
                    themeSubtle={subtle}
                    outlineVariant={outlineVariant}
                    item={t}
                    onPress={
                      t.isPendingPlaceholder
                        ? undefined
                        : () => router.push(`/edit-finance-transaction/${t.id}`)
                    }
                  />
                </Animated.View>
              );

              if (t.isPendingPlaceholder) {
                return <React.Fragment key={t.id}>{rowBody}</React.Fragment>;
              }

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
                  {rowBody}
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
                /** 键盘打开时不再塞一条「安全区」底内边距，避免白底卡片里键盘与内容之间多出一条空带 */
                paddingBottom: sheetKeyboardInset > 0 ? 0 : Math.max(16, insets.bottom),
                maxHeight: sheetModalMaxHeight,
                marginBottom: sheetKeyboardInset,
                backgroundColor: surface,
              },
            ]}>
            <View style={[styles.sheetHeader, { borderBottomColor: outlineVariant }]}>
              <Pressable onPress={closeSheet} style={({ pressed }) => [styles.sheetCloseBtn, pressed && { opacity: 0.75 }]}>
                <MaterialIcons name="close" size={24} color={subtle} />
              </Pressable>
              <Text style={[styles.sheetTitle, { color: text }]}>
                {activeSheetTab === 'transfer' ? '财务转账' : activeSheetTab === 'sentence' ? '一句话记账' : '手动记账'}
              </Text>
              <View style={styles.sheetCloseBtn} />
            </View>

            <View style={[styles.sheetTabs, { borderBottomColor: outlineVariant }]}>
              <Pressable onPress={() => resetSheetForm('sentence')} style={styles.sheetTabBtn}>
                <Text style={[styles.sheetTabText, activeSheetTab === 'sentence' ? { color: tertiary } : { color: subtle }]}>一句话</Text>
                {activeSheetTab === 'sentence' ? <View style={[styles.sheetTabLine, { backgroundColor: tertiary }]} /> : null}
              </Pressable>
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
              style={[styles.sheetBodyScroll, { maxHeight: sheetModalBodyMaxHeight }]}
              contentContainerStyle={
                sheetKeyboardInset > 0
                  ? [styles.sheetBodyScrollContent, styles.sheetBodyScrollContentKeyboardOpen]
                  : styles.sheetBodyScrollContent
              }
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator
              nestedScrollEnabled
              bounces>
            {activeSheetTab === 'transfer' ? (
              <>
                <View style={styles.transferContent}>
                  <View style={styles.transferAccountRow}>
                    <Pressable
                      onPress={() => {
                        setIsDatePickerVisible(false);
                        setIsTimePickerVisible(false);
                        setAccountPickerTarget('transferFrom');
                        setIsAccountPickerVisible(true);
                      }}
                      style={({ pressed }) => [
                        styles.transferAccountCard,
                        { backgroundColor: isDark ? '#161d2b' : '#faf8ff', borderColor: outlineVariant },
                        pressed && { opacity: 0.88 },
                      ]}>
                      <Text style={[styles.transferAccountLabel, { color: subtle }]}>扣款账户</Text>
                      <View style={styles.transferAccountValueRow}>
                        <MaterialIcons
                          name={transferFromAccount ? accountIcon(transferFromAccount) : 'account-balance-wallet'}
                          size={20}
                          color={tertiary}
                        />
                        <Text style={[styles.transferAccountValue, { color: text }]} numberOfLines={1}>
                          {transferFromAccount?.name ?? '选择账户'}
                        </Text>
                      </View>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="交换扣款与入账账户"
                      onPress={() => {
                        setTransferFromAccountId(transferToAccountId);
                        setTransferToAccountId(transferFromAccountId);
                      }}
                      style={({ pressed }) => [styles.transferArrowWrap, pressed && { opacity: 0.75 }]}>
                      <MaterialIcons name="swap-horiz" size={28} color={subtle} />
                    </Pressable>
                    <Pressable
                      onPress={() => {
                        setIsDatePickerVisible(false);
                        setIsTimePickerVisible(false);
                        setAccountPickerTarget('transferTo');
                        setIsAccountPickerVisible(true);
                      }}
                      style={({ pressed }) => [
                        styles.transferAccountCard,
                        { backgroundColor: isDark ? '#161d2b' : '#faf8ff', borderColor: outlineVariant },
                        pressed && { opacity: 0.88 },
                      ]}>
                      <Text style={[styles.transferAccountLabel, { color: subtle }]}>入账账户</Text>
                      <View style={styles.transferAccountValueRow}>
                        <MaterialIcons
                          name={transferToAccount ? accountIcon(transferToAccount) : 'savings'}
                          size={20}
                          color={primary}
                        />
                        <Text style={[styles.transferAccountValue, { color: text }]} numberOfLines={1}>
                          {transferToAccount?.name ?? '选择账户'}
                        </Text>
                      </View>
                    </Pressable>
                  </View>

                  {transferFromAccount && transferToAccount ? (
                    transferFromAccount.id === transferToAccount.id ? (
                      <Text style={[styles.transferHintText, { color: subtle }]}>请选择两个不同的账户。</Text>
                    ) : transferFromAccount.sign_rule !== 1 || transferToAccount.sign_rule !== 1 ? (
                      <Text style={[styles.transferHintText, { color: subtle }]}>
                        转账目前仅在资产类账户之间可用。
                      </Text>
                    ) : null
                  ) : null}

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

                  <View style={[styles.sheetNoteRow, { marginTop: 4 }]}>
                    <View style={[styles.noteRowWrap, { backgroundColor: surface, borderColor: outlineVariant }]}>
                      <TextInput
                        value={sheetNote}
                        onChangeText={setSheetNote}
                        multiline
                        scrollEnabled
                        textAlignVertical="top"
                        style={[styles.noteRowInput, { color: text, backgroundColor: 'transparent', minHeight: 56 }]}
                        placeholder="备注（可选）"
                        placeholderTextColor={subtle}
                      />
                    </View>
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
                {activeSheetTab !== 'sentence' ? (
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
                ) : (
                  <View style={styles.sentenceHintBox}>
                    <Text style={[styles.sentenceHintText, { color: subtle }]}>
                      写清事由与金额。例如：午饭 28、打车 15.5 元、工资到账 8000
                    </Text>
                    <View style={styles.sentenceAiMetaRow}>
                      <MaterialIcons name="auto-awesome" size={16} color={zhipuTxnReady ? secondary : subtle} />
                      <Text
                        style={[
                          styles.sentenceAiMetaText,
                          { color: zhipuTxnReady ? secondary : subtle },
                        ]}
                        numberOfLines={2}>
                        {zhipuTxnReady
                          ? aiLlmProviderLabel === '豆包'
                            ? '已配置豆包密钥：一句话将优先由 AI 解析，失败时回退本地规则。'
                            : '已配置智谱密钥：一句话将优先由 AI（glm-4-flash）解析，失败时回退本地规则。'
                          : aiLlmProviderLabel === '豆包'
                            ? '未检测到豆包密钥：仅能用本地规则（需句中含阿拉伯数字金额）。在「我的」配置 EXPO_PUBLIC_ARK_API_KEY（或兼容旧名 EXPO_PUBLIC_GEMINI_API_KEY）后启用 AI。'
                            : '未检测到智谱密钥：仅能用本地规则（需句中含阿拉伯数字金额）。设置 EXPO_PUBLIC_ZHIPU_API_KEY 后启用 AI。'}
                      </Text>
                    </View>
                    <Pressable
                      onPress={() => router.push('/zhipu-api-test')}
                      style={({ pressed }) => [pressed && { opacity: 0.75 }]}>
                      <Text style={[styles.sentenceZhipuDevLink, { color: tertiary }]}>
                        智谱 API 调试页（验证密钥与请求）
                      </Text>
                    </Pressable>
                  </View>
                )}

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
                        setIsAccountPickerVisible((prev) => {
                          if (!prev) setAccountPickerTarget('sheet');
                          return !prev;
                        });
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

                  {activeSheetTab === 'expense' || activeSheetTab === 'sentence' ? (
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

                  {activeSheetTab === 'sentence' ? (
                    <View style={styles.sheetSentenceBlock}>
                      <View style={[styles.noteRowWrap, { backgroundColor: surface, borderColor: outlineVariant, minHeight: 130 }]}>
                        <TextInput
                          value={sheetSentence}
                          onChangeText={setSheetSentence}
                          multiline
                          scrollEnabled
                          textAlignVertical="top"
                          style={[styles.noteRowInput, { color: text, backgroundColor: 'transparent', minHeight: 96 }]}
                          placeholder="例如：咖啡 18、地铁 6、工资 12000"
                          placeholderTextColor={subtle}
                        />
                      </View>
                      {sentenceLedgerPreview?.kind === 'ok' ? (
                        <View
                          style={[
                            styles.sentencePreviewCard,
                            { backgroundColor: surface, borderColor: outlineVariant },
                          ]}>
                          <View
                            style={[
                              styles.sentencePreviewBadge,
                              {
                                backgroundColor:
                                  sentenceLedgerPreview.source === 'ai'
                                    ? isDark
                                      ? 'rgba(52,211,153,0.18)'
                                      : 'rgba(0,108,73,0.12)'
                                    : isDark
                                      ? 'rgba(148,163,184,0.2)'
                                      : 'rgba(66,71,84,0.1)',
                              },
                            ]}>
                            <Text
                              style={[
                                styles.sentencePreviewBadgeText,
                                {
                                  color: sentenceLedgerPreview.source === 'ai' ? secondary : subtle,
                                },
                              ]}>
                              {sentenceLedgerPreview.source === 'ai' ? '智谱 AI 识别' : '本地规则'}
                            </Text>
                          </View>
                          <Text style={[styles.sentencePreviewLine, { color: text }]}>
                            {sentenceLedgerPreview.transaction_type === 'income' ? '收入' : '支出'} ·{' '}
                            {formatCurrencyWithDecimals(sentenceLedgerPreview.amount)} · {sentenceLedgerPreview.name}
                          </Text>
                          <Text style={[styles.sentencePreviewLine, { color: subtle, fontWeight: '600' }]}>
                            分类：{sentenceLedgerPreview.categoryLabel}
                          </Text>
                        </View>
                      ) : sentenceLedgerPreview?.kind === 'error' ? (
                        <View
                          style={[
                            styles.sentencePreviewCard,
                            {
                              backgroundColor: isDark ? 'rgba(220,38,38,0.12)' : 'rgba(254,226,226,0.9)',
                              borderColor: isDark ? 'rgba(248,113,113,0.35)' : 'rgba(252,165,165,0.8)',
                            },
                          ]}>
                          <Text style={[styles.sentencePreviewErr, { color: isDark ? '#fecaca' : '#991b1b' }]}>
                            {sentenceLedgerPreview.message}
                          </Text>
                        </View>
                      ) : null}
                      <View style={styles.sentenceActionsRow}>
                        <Pressable
                          onPress={() => void handleSentenceLedgerPreview()}
                          disabled={!canSaveSentence}
                          style={({ pressed }) => [
                            styles.sheetSentencePreviewBtn,
                            {
                              borderColor: outlineVariant,
                              backgroundColor: isDark ? '#161d2b' : '#f2f3ff',
                              opacity: !canSaveSentence ? 0.55 : pressed ? 0.88 : 1,
                            },
                          ]}>
                          {isSentencePreviewBusy ? (
                            <ActivityIndicator color={tertiary} />
                          ) : (
                            <Text style={[styles.sheetSentencePreviewBtnText, { color: tertiary }]}>AI 识别预览</Text>
                          )}
                        </Pressable>
                        <Pressable
                          onPress={() => void handleSaveTransaction()}
                          disabled={!canSaveSentence}
                          style={({ pressed }) => [
                            styles.sheetSentenceSubmit,
                            styles.sheetSentenceSubmitFlex,
                            { backgroundColor: canSaveSentence ? tertiary : subtle },
                            pressed && canSaveSentence && { opacity: 0.9 },
                          ]}>
                          {isParsingSentence ? (
                            <ActivityIndicator color="#fff" />
                          ) : (
                            <Text style={styles.sheetSentenceSubmitText}>记账</Text>
                          )}
                        </Pressable>
                      </View>
                    </View>
                  ) : (
                    <>
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
                    </>
                  )}

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

                  {activeSheetTab !== 'sentence' ? (
                    <>
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
                    </>
                  ) : null}
                </View>
              </>
            )}
            </ScrollView>

            <Modal
              visible={isAccountPickerVisible}
              transparent
              animationType="fade"
              onRequestClose={() => {
                setIsAccountPickerVisible(false);
                setAccountPickerTarget('sheet');
              }}>
              <View style={styles.pickerModalOverlay}>
                <Pressable
                  style={styles.pickerModalBackdrop}
                  onPress={() => {
                    setIsAccountPickerVisible(false);
                    setAccountPickerTarget('sheet');
                  }}
                />
                <View style={[styles.pickerModalCard, { backgroundColor: surface, borderColor: outlineVariant, shadowColor: isDark ? '#000' : '#0f172a' }]}>
                  <View style={[styles.pickerModalHeader, { borderBottomColor: outlineVariant }]}>
                    <Text style={[styles.pickerModalTitle, { color: text }]}>
                      {accountPickerTarget === 'transferFrom'
                        ? '选择扣款账户'
                        : accountPickerTarget === 'transferTo'
                          ? '选择入账账户'
                          : '选择账户'}
                    </Text>
                    <Pressable
                      onPress={() => {
                        setIsAccountPickerVisible(false);
                        setAccountPickerTarget('sheet');
                      }}
                      style={styles.pickerModalCloseBtn}>
                      <MaterialIcons name="close" size={22} color={subtle} />
                    </Pressable>
                  </View>
                  <View style={styles.pickerModalBody}>
                    <ScrollView style={styles.accountPickerScroll} contentContainerStyle={styles.accountPickerList} showsVerticalScrollIndicator={false}>
                      {financeAccounts.map((account) => {
                        const selected =
                          accountPickerTarget === 'transferFrom'
                            ? account.id === transferFromAccountId
                            : accountPickerTarget === 'transferTo'
                              ? account.id === transferToAccountId
                              : account.id === selectedAccount?.id;
                        const transferPickBlocked =
                          (accountPickerTarget === 'transferFrom' && account.id === transferToAccountId) ||
                          (accountPickerTarget === 'transferTo' && account.id === transferFromAccountId);
                        return (
                          <Pressable
                            key={account.id}
                            disabled={transferPickBlocked}
                            onPress={() => handleSelectAccount(account.id)}
                            style={({ pressed }) => [
                              styles.accountPickerItem,
                              {
                                backgroundColor: selected ? `${tertiary}18` : isDark ? '#161d2b' : '#f2f3ff',
                                borderColor: selected ? tertiary : outlineVariant,
                              },
                              transferPickBlocked ? { opacity: 0.45 } : null,
                              pressed && !transferPickBlocked ? { opacity: 0.84 } : null,
                            ]}>
                            <MaterialIcons name={accountIcon(account)} size={18} color={selected ? tertiary : subtle} />
                            <View style={styles.accountPickerTextCol}>
                              <Text style={[styles.accountPickerName, { color: text }]}>{account.name}</Text>
                              <Text style={[styles.accountPickerBalance, { color: subtle }]}>{formatCurrencyBalanceForAccount(account)}</Text>
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
          </View>
        </View>
      </Modal>

      <Modal visible={isBudgetAdjustVisible} animationType="slide" transparent onRequestClose={closeBudgetAdjust}>
        <KeyboardAvoidingView
          style={styles.budgetKeyboardAvoidingRoot}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={0}>
          <View style={styles.budgetModalOverlayInner}>
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
                <View style={styles.budgetDetailsTotalTextCol}>
                  <Text style={[styles.budgetDetailsTotalLabel, { color: subtle }]}>真实{budgetUiScopeShort}预算</Text>
                  {previewFixedExpensesTotal > 0 ? (
                    <Text style={[styles.budgetDetailsTotalHint, { color: subtle }]}>
                      毛预算 {formatCurrencyWithDecimals(budgetPreviewGross)}，已扣固定支出{' '}
                      {formatCurrencyWithDecimals(previewFixedExpensesTotal)}
                    </Text>
                  ) : null}
                </View>
                <Text style={[styles.budgetDetailsTotalValue, { color: text }]}>
                  {formatCurrencyWithDecimals(budgetPreviewTotal)}
                </Text>
              </View>
            </View>

            <ScrollView
              style={styles.budgetDetailsScroll}
              contentContainerStyle={styles.budgetDetailsScrollContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}>
            <View style={styles.budgetDetailsComposition}>
              <View style={styles.budgetDetailsCompositionTop}>
                <Text style={[styles.budgetDetailsCompositionTitle, { color: subtle }]}>{budgetUiScopeShort}预算构成</Text>
                <View style={styles.budgetDetailsSwitchRow}>
                  <Text style={[styles.budgetDetailsSwitchLabel, { color: subtle }]}>{budgetUiIncludePrevLabel}</Text>
                  <Switch
                    value={modalIncludeLast}
                    onValueChange={setModalIncludeLast}
                    trackColor={{ false: isDark ? '#374151' : '#e5e7eb', true: '#4ade80' }}
                    thumbColor="#ffffff"
                    ios_backgroundColor={isDark ? '#374151' : '#e5e7eb'}
                  />
                </View>
              </View>

              <View style={styles.budgetRefreshDayBlock}>
                <View style={styles.budgetRefreshDayTextCol}>
                  <Text style={[styles.budgetRefreshDayTitle, { color: text }]}>预算刷新日</Text>
                  <Text style={[styles.budgetRefreshDayHint, { color: subtle }]}>
                    每月该日 0 点起进入新预算周期；默认 1 日即按自然月。短月会与当月最后一天对齐。
                  </Text>
                </View>
                <View style={styles.budgetRefreshDayStepper}>
                  <Pressable
                    onPress={() => setBudgetRefreshDayDraft((d) => Math.max(1, d - 1))}
                    style={({ pressed }) => [
                      styles.budgetRefreshDayStepBtn,
                      { borderColor: outlineVariant, opacity: pressed ? 0.84 : 1 },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel="预算刷新日减一">
                    <MaterialIcons name="remove" size={22} color={text} />
                  </Pressable>
                  <Text style={[styles.budgetRefreshDayValue, { color: text }]}>{budgetRefreshDayDraft}</Text>
                  <Pressable
                    onPress={() => setBudgetRefreshDayDraft((d) => Math.min(31, d + 1))}
                    style={({ pressed }) => [
                      styles.budgetRefreshDayStepBtn,
                      { borderColor: outlineVariant, opacity: pressed ? 0.84 : 1 },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel="预算刷新日加一">
                    <MaterialIcons name="add" size={22} color={text} />
                  </Pressable>
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
                  <Text style={[styles.budgetDetailsBreakdownLabel, { color: subtle }]}>{budgetUiPrevCarryLabel}</Text>
                  <Text
                    style={[
                      styles.budgetDetailsBreakdownAmount,
                      modalIncludeLast ? { color: text } : { color: isDark ? '#4b5563' : '#d1d5db' },
                    ]}>
                    {modalIncludeLast ? formatCurrencyWithDecimals(lastMonthRemaining) : '--'}
                  </Text>
                </View>
              </View>

              <View style={styles.budgetFixedExpensesBlock}>
                <View style={styles.budgetFixedExpensesHeader}>
                  <View style={styles.budgetFixedExpensesTitleCol}>
                    <Text style={[styles.budgetFixedExpensesTitle, { color: text }]}>每月固定支出</Text>
                    <Text style={[styles.budgetFixedExpensesHint, { color: subtle }]}>
                      房租、订阅等固定开销会从预算中预先扣除，剩余为真实可支配预算
                    </Text>
                  </View>
                  <Pressable
                    onPress={handleAddFixedExpense}
                    style={({ pressed }) => [
                      styles.budgetFixedExpensesAddBtn,
                      { borderColor: outlineVariant, opacity: pressed ? 0.84 : 1 },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel="添加固定支出">
                    <MaterialIcons name="add" size={18} color={primary} />
                    <Text style={[styles.budgetFixedExpensesAddText, { color: primary }]}>添加</Text>
                  </Pressable>
                </View>

                {fixedExpensesDraft.length === 0 ? (
                  <Text style={[styles.budgetFixedExpensesEmpty, { color: subtle }]}>暂无固定支出项</Text>
                ) : (
                  <View style={styles.budgetFixedExpensesList}>
                    {fixedExpensesDraft.map((item) => (
                      <View
                        key={item.id}
                        style={[
                          styles.budgetFixedExpenseRow,
                          { backgroundColor: isDark ? 'rgba(148,163,184,0.12)' : '#f9fafb', borderColor: outlineVariant },
                        ]}>
                        <TextInput
                          value={item.name}
                          onChangeText={(v) => handleUpdateFixedExpense(item.id, { name: v })}
                          placeholder="名称，如房租"
                          placeholderTextColor={subtle}
                          style={[styles.budgetFixedExpenseNameInput, { color: text }]}
                        />
                        <View style={[styles.budgetFixedExpenseAmountWrap, { borderColor: outlineVariant }]}>
                          <Text style={[styles.budgetFixedExpenseYuan, { color: subtle }]}>¥</Text>
                          <TextInput
                            value={item.amount > 0 ? String(item.amount) : ''}
                            onChangeText={(v) => {
                              const normalized = v.trim().replace(/,/g, '');
                              if (!normalized) {
                                handleUpdateFixedExpense(item.id, { amount: 0 });
                                return;
                              }
                              const n = parseFloat(normalized);
                              handleUpdateFixedExpense(item.id, {
                                amount: Number.isFinite(n) && n >= 0 ? n : 0,
                              });
                            }}
                            keyboardType="decimal-pad"
                            placeholder="0"
                            placeholderTextColor={subtle}
                            style={[styles.budgetFixedExpenseAmountInput, { color: text }]}
                          />
                        </View>
                        <Pressable
                          onPress={() => handleDeleteFixedExpense(item.id, item.name.trim())}
                          style={({ pressed }) => [
                            styles.budgetFixedExpenseDeleteBtn,
                            { opacity: pressed ? 0.72 : 1 },
                          ]}
                          accessibilityRole="button"
                          accessibilityLabel={`删除${item.name || '固定支出'}`}>
                          <MaterialIcons name="delete-outline" size={20} color="#ef4444" />
                        </Pressable>
                      </View>
                    ))}
                  </View>
                )}

                {previewFixedExpensesTotal > 0 ? (
                  <Text style={[styles.budgetFixedExpensesSum, { color: subtle }]}>
                    固定支出合计 {formatCurrencyWithDecimals(previewFixedExpensesTotal)}
                  </Text>
                ) : null}
              </View>
            </View>
            </ScrollView>

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
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {autoLedgerToastVisible ? (
        <View
          pointerEvents="none"
          style={[styles.autoLedgerToastWrap, { top: insets.top + 8 }]}
          accessibilityLiveRegion="polite">
          <View style={[styles.autoLedgerToast, { backgroundColor: surface, borderColor: outlineVariant }]}>
            <ActivityIndicator size="small" color={tertiary} />
            <Text style={[styles.autoLedgerToastText, { color: text }]} numberOfLines={2}>
              {autoLedgerToastMessage}
            </Text>
          </View>
        </View>
      ) : null}
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
    width: '100%',
    borderBottomWidth: 1,
    zIndex: 60,
    elevation: 24,
  },
  headerInner: {
    width: '100%',
    height: Layout.headerHeight,
    paddingHorizontal: Spacing['5xl'],
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerSide: {
    minWidth: Layout.iconButtonSize,
    alignItems: 'flex-start',
    justifyContent: 'center',
    zIndex: 2,
  },
  headerSideRight: {
    alignItems: 'flex-end',
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
  },
  headerTitle: {
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: -0.2,
  },
  content: {
    maxWidth: 420,
    alignSelf: 'center',
    width: '100%',
    paddingHorizontal: 20,
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
  trendChartDayLabel: {
    marginTop: 8,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  budgetNetAmount: {
    marginTop: 2,
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: -0.6,
  },
  trendChartWrap: {
    marginTop: 10,
    width: '100%',
  },
  trendChartPlot: {
    position: 'relative',
    height: NET_WORTH_TREND_CHART_H,
    width: '100%',
    overflow: 'visible',
  },
  trendChartNodes: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1,
  },
  trendChartScrubOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 2,
  },
  trendChartNodeHit: {
    position: 'absolute',
    width: 28,
    height: 28,
    marginLeft: -14,
    marginTop: -14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trendChartNodeDot: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 1.5,
    elevation: 1,
  },
  trendChartHint: {
    marginTop: 6,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.2,
    opacity: 0.85,
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
    paddingVertical: 12,
    paddingHorizontal: 16,
    overflow: 'hidden',
  },
  txnSwipeForegroundPending: {
    opacity: 0.92,
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
    /** 与 `txnSwipeForeground` 左内边距一致，使「今日」与时间轴脉络线同一列 */
    paddingLeft: 16,
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
    /** 与列表项正文列起点对齐：`txnSwipeForeground` 左内边距 + 图标 40 + `txnItem` gap 12 */
    marginLeft: 68,
    marginTop: 2,
    marginBottom: 2,
    opacity: 0.72,
  },
  historyDayHeader: {
    marginTop: 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    /** 与列表卡片左内边距一致，日期角标中心与 `timelineLine`（16+20）对齐 */
    paddingLeft: 16,
  },
  historyDayBadgeWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  historyDayBadgeText: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.2,
  },
  historyDayHeaderRight: {
    flex: 1,
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
    paddingRight: 20,
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
    position: 'relative',
    paddingTop: 12,
    paddingBottom: 8,
    gap: 18,
  },
  timelineLine: {
    position: 'absolute',
    /** 与 `txnSwipeForeground` 水平内边距 + 图标列宽度一半对齐（内边距 16 + 20） */
    left: 36,
    top: 14,
    bottom: 0,
    width: 1,
    opacity: 0.8,
    zIndex: 0,
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
    maxWidth: '100%',
  },
  insightTagPendingAi: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(148, 163, 184, 0.45)',
  },
  insightText: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.4,
  },
  composerWrap: {
    position: 'absolute',
    left: 20,
    right: 20,
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
  /** 预算 Modal：KAV 只负责 flex:1；底对齐与遮罩在内层，避免 padding 与 flex 居中叠算产生大块空白 */
  budgetKeyboardAvoidingRoot: {
    flex: 1,
  },
  budgetModalOverlayInner: {
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
  sheetBodyScrollContentKeyboardOpen: {
    paddingBottom: 0,
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
    paddingHorizontal: 6,
    gap: 2,
  },
  sheetTabBtn: {
    flex: 1,
    minWidth: 0,
    paddingTop: 12,
    paddingBottom: 10,
    alignItems: 'center',
  },
  sheetTabText: {
    fontSize: 12,
    fontWeight: '600',
  },
  sheetTabLine: {
    height: 2,
    marginTop: 8,
    borderRadius: 1,
    alignSelf: 'stretch',
  },
  sentenceHintBox: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 10,
  },
  sentenceHintText: {
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '500',
  },
  sheetSentenceBlock: {
    gap: 12,
    paddingBottom: 8,
  },
  sentenceAiMetaRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 10,
  },
  sentenceAiMetaText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
  },
  sentenceZhipuDevLink: {
    marginTop: 8,
    fontSize: 12,
    fontWeight: '800',
  },
  sentencePreviewCard: {
    borderRadius: 12,
    padding: 12,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 6,
  },
  sentencePreviewBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  sentencePreviewBadgeText: {
    fontSize: 11,
    fontWeight: '800',
  },
  sentencePreviewLine: {
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 20,
  },
  sentencePreviewErr: {
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
  },
  sentenceActionsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  sheetSentencePreviewBtn: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  sheetSentencePreviewBtnText: {
    fontSize: 15,
    fontWeight: '800',
  },
  sheetSentenceSubmit: {
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetSentenceSubmitFlex: {
    flex: 1,
  },
  sheetSentenceSubmitText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '800',
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
  transferHintText: {
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
    paddingHorizontal: 12,
    marginTop: -8,
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
  autoLedgerToastWrap: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 100,
    alignItems: 'center',
  },
  autoLedgerToast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    maxWidth: 400,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 6,
  },
  autoLedgerToastText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 20,
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
    zIndex: 1,
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
    gap: 12,
  },
  budgetDetailsTotalTextCol: {
    flex: 1,
    gap: 4,
  },
  budgetDetailsTotalLabel: {
    fontSize: 16,
    fontWeight: '600',
  },
  budgetDetailsTotalHint: {
    fontSize: 12,
    lineHeight: 17,
  },
  budgetDetailsTotalValue: {
    fontSize: 22,
    fontWeight: '600',
  },
  budgetDetailsScroll: {
    maxHeight: 420,
  },
  budgetDetailsScrollContent: {
    paddingBottom: 4,
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
  budgetRefreshDayBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 16,
    paddingVertical: 4,
  },
  budgetRefreshDayTextCol: {
    flex: 1,
    gap: 4,
  },
  budgetRefreshDayTitle: {
    fontSize: 14,
    fontWeight: '600',
  },
  budgetRefreshDayHint: {
    fontSize: 12,
    lineHeight: 17,
  },
  budgetRefreshDayStepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  budgetRefreshDayStepBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  budgetRefreshDayValue: {
    fontSize: 18,
    fontWeight: '700',
    minWidth: 28,
    textAlign: 'center',
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
  budgetFixedExpensesBlock: {
    gap: 12,
    marginTop: 4,
  },
  budgetFixedExpensesHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  budgetFixedExpensesTitleCol: {
    flex: 1,
    gap: 4,
  },
  budgetFixedExpensesTitle: {
    fontSize: 14,
    fontWeight: '600',
  },
  budgetFixedExpensesHint: {
    fontSize: 12,
    lineHeight: 17,
  },
  budgetFixedExpensesAddBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  budgetFixedExpensesAddText: {
    fontSize: 13,
    fontWeight: '600',
  },
  budgetFixedExpensesEmpty: {
    fontSize: 13,
    paddingVertical: 8,
  },
  budgetFixedExpensesList: {
    gap: 10,
  },
  budgetFixedExpenseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  budgetFixedExpenseNameInput: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
    paddingVertical: 4,
    minWidth: 0,
  },
  budgetFixedExpenseAmountWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 8,
    minWidth: 96,
  },
  budgetFixedExpenseYuan: {
    fontSize: 14,
    fontWeight: '600',
  },
  budgetFixedExpenseAmountInput: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    paddingVertical: 6,
    minWidth: 48,
    textAlign: 'right',
  },
  budgetFixedExpenseDeleteBtn: {
    padding: 4,
  },
  budgetFixedExpensesSum: {
    fontSize: 13,
    fontWeight: '500',
    textAlign: 'right',
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
