import { FinanceCategoryPicker } from '@/components/finance/finance-category-picker';
import { FinanceFoldBudgetSheet } from '@/components/finance/finance-fold-budget-sheet';
import {
  FinanceFoldAlbumScanPanel,
  FinanceFoldExpenseIncomePanel,
  FinanceFoldPhrasePanel,
  FinanceFoldRecordFab,
  FinanceFoldSegment,
  FinanceFoldSheetChrome,
  FinanceFoldSheetHead,
  FinanceFoldTransferPanel,
  type FinanceAlbumScanResult,
  type FinanceFoldParsePill,
} from '@/components/finance/finance-fold-record-sheet';
import {
  FinanceAccountCarouselSkeleton,
  FinanceBudgetCardSkeleton,
  FinanceTxnListSkeleton,
} from '@/components/skeletons/finance';
import { HomeSkeletonShell } from '@/components/home-skeleton-shell';
import { FinanceSavingsGoalBlock } from '@/components/finance/finance-savings-goal-block';
import { FoldCountUpText, FoldRiseIn, useFoldMotionGate } from '@/components/review/fold-motion';
import { Layout, Radius, Shadows, Spacing } from '@/constants/design-tokens';
import { useFinanceFoldTheme } from '@/constants/finance-fold-theme';
import { usePageDayBoundary } from '@/contexts/day-boundary-context';
import { useHomeSkeletonReveal } from '@/hooks/use-home-skeleton-reveal';
import { useReducedMotionState } from '@/hooks/use-reduced-motion';
import { usePageApiSync, usePagePullRefresh } from '@/hooks/use-page-api-sync';
import { usePageFocusReload } from '@/hooks/use-page-focus-reload';
import { useLocalQuery } from '@/hooks/use-local-query';
import { listUiRefreshTables } from '@/lib/page-api-scope';
import { shouldSkipDuplicateAutoLedgerImage } from '@/lib/auto-ledger-dedupe';
import {
    subscribeAutoLedgerCompleted,
    subscribeAutoLedgerUiState,
} from '@/lib/auto-ledger-events';
import { notifyAutoLedgerFailure, notifyAutoLedgerHint } from '@/lib/auto-ledger-notify';
import {
    AUTO_LEDGER_HANDOFF_SPLASH_MS,
    AUTO_LEDGER_MAX_ATTEMPTS,
    AUTO_LEDGER_RETRY_DELAY_MS,
    sleepMs,
} from '@/lib/auto-ledger-retry';
import { cancelAutoLedgerJob } from '@/lib/auto-ledger-runner';
import {
    enterAutoLedgerSession,
    leaveAutoLedgerSession,
    runInAutoLedgerSession,
} from '@/lib/auto-ledger-session';
import { FINANCE_ACCOUNT_ICON_OPTIONS } from '@/lib/constants/finance-account-icons';
import { toast, toUserMessage } from '@/lib/app-feedback';
import { makeTimestampEntityId } from '@/lib/entity-id';
import { resolveFinanceAccountForAutoLedgerWithDefaults } from '@/lib/finance-account-match';
import { resolveHappenedAtForBillLedger } from '@/lib/finance-bill-happened-at';
import {
    getCachedFinanceLastUsedAccountId,
    loadFinanceLastUsedAccountId,
    sanitizeFinanceLastUsedAccountId,
} from '@/lib/finance-last-used-account';
import {
    budgetDaysLeftIncludingToday,
    clampBudgetRefreshDay,
    computeDailyBudgetFromPeriodSurplus,
    DEFAULT_BUDGET_REFRESH_DAY,
    formatBudgetPeriodCountdownLabel,
    getBudgetMonthKeyForDate,
    getBudgetPeriodStartForDate,
    getNextBudgetPeriodStart,
    getPreviousBudgetPeriodStart,
    loadBudgetRefreshDay,
    loadMonthBudgetSettings,
    persistBudgetRefreshDay,
    persistMonthBudgetSettings,
    resolvePeriodBudgetSurplus,
    type MonthBudgetSetting,
} from '@/lib/finance-monthly-budget';
import { loadFinanceSavingsGoal } from '@/lib/finance-savings-goal';
import {
    collectPaidScheduledExpenseSlots,
    loadScheduledFinanceExpenses,
    sumScheduledExpensesInRange,
    type ScheduledFinanceExpense,
} from '@/lib/finance-scheduled-expense';
import { computeScheduledWithholdingRemaining } from '@/lib/finance-scheduled-withholding';
import { scheduleRunScheduledFinanceExpenses } from '@/lib/finance-scheduled-expense-runner';
import {
    consumeFinanceSheetLaunchIntent,
    notifyFinanceSheetSaved,
    peekFinanceSheetLaunchIntent,
    subscribeFinanceSheetSaved,
    type FinanceSheetLaunchIntent,
} from '@/lib/finance-transaction-sheet/controller';
import {
    describeFinanceTransferPair,
    resolveTransferLaunchAccounts,
} from '@/lib/finance-transaction-sheet/helpers';
import { useFinanceSheetCategories } from '@/lib/finance-transaction-sheet/use-sheet-categories';
import {
    createFinanceTransaction,
    createFinanceTransferTransactions,
    deleteFinanceTransaction,
    financeSignedAmountForSave,
    getFinanceAccountsWithBalance,
    getFinanceFlowCategories,
    getFinanceTransactions,
    normalizeFinanceSignRule,
    validateFinanceTransactionBeforeSave,
} from '@/lib/repositories/finance/finance';
import { fetchFinanceHome, fetchFinanceRecentDays } from '@/lib/finance-page-api';
import { aggregateTransactions } from '@/lib/finance-aggregate';
import { formatYmd } from '@/lib/date';
import {
  computeNetWorthTotal,
  computeTotalAssets,
  computeTotalLiabilitiesAbs,
  financeLiabilityDebtMagnitude,
  isFinanceLiabilityAccount,
} from '@/lib/finance-net-worth';
import { isFinanceAccountHiddenFromHome } from '@/lib/repositories/finance/finance-account-extra';
import {
    budgetExtraPatchForTransaction,
    buildFinanceTransferTxnExtra,
    isFinanceTransactionExcludedFromBudget,
} from '@/lib/repositories/finance/finance-transaction-extra';
import type { FinanceAccountBalanceRow, FinanceTransactionRow } from '@/lib/repositories/finance/finance.types';
import { formatFinanceHappenedAt, parseStoredDatetime } from '@/lib/api-mysql-datetime';
import { compareDatetimeDesc } from '@/lib/api-read-helpers';
import { addDaysToLogicalYmd, getLogicalLocalYmd, logicalYmdToLocalDate } from '@/lib/tasks-logical-day';
import { reportTabBarScroll } from '@/lib/tab-bar-auto-hide';
import { glassTabBarContentInset } from '@/components/recipe/recipe-glass-tab-bar';
import {
    getActiveAiLlmApiKey,
    isActiveAiLlmConfigured,
    parseFinanceOneLinerFromImage,
    parseFinanceOneLinerFromText,
} from '@/lib/zhipu-image-parse';
import { MaterialIcons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useFocusEffect } from "expo-router/react-navigation";
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import React from 'react';
import {
    ActivityIndicator,
    Alert,
    Animated,
    Dimensions,
    Easing,
    Keyboard,
    KeyboardAvoidingView,
    Modal,
    Platform,
    Pressable,
    StyleProp,
    StyleSheet,
    Switch,
    Text,
    TextInput,
    View,
    ViewStyle,
    type KeyboardEvent,
} from 'react-native';
import { Gesture, GestureDetector, ScrollView } from 'react-native-gesture-handler';
import Swipeable from 'react-native-gesture-handler/ReanimatedSwipeable';
import { runOnJS } from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { moveAppToBackground } from 'zheng-background';

const AUTO_LEDGER_NOT_BILL_MESSAGE =
  '这不是账单或支付凭证截图，请换一张支付成功页、账单详情或小票等图片。';
const PAGE_API_KEY = 'tabs/finance';
const LOCAL_TABLES = listUiRefreshTables(PAGE_API_KEY);

type TxnMetaTag = {
  label: string;
  tone?: 'time' | 'account' | 'status' | 'income' | 'expense' | 'transfer';
};

type Txn = {
  id: string;
  dayKey: string;
  icon: keyof typeof MaterialIcons.glyphMap;
  iconColor: string;
  title: string;
  tags: TxnMetaTag[];
  amount: string;
  amountColor: string;
  insight: string;
  insightIsAiBody: boolean;
  /** 截图自动记账等进行中占位 */
  insightPendingAi: boolean;
  /** 截图自动记账 AI 分析中占位，尚未落库 */
  isPendingPlaceholder?: boolean;
};

type PendingAutoLedgerRow = {
  id: string;
  source: 'clipboard' | 'shortcut_intent' | 'picker';
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
      : item.source === 'picker'
        ? 'AI 正在识别图片并记账…'
        : 'AI 正在识别剪贴板截图…';
  return {
    id: item.id,
    dayKey: todayDayKey,
    icon: 'auto-awesome',
    iconColor: subtle,
    title: '截图记账',
    tags: [
      { label: `${hour}:${minute}`, tone: 'time' },
      { label: retrying ? '重试中' : 'AI 分析中', tone: 'status' },
    ],
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
): { text: string; isAiBody: boolean; pendingAi: boolean } {
  const trimmed = txn.ai_comment?.trim();
  // 历史无评价不强制补全；有评价才展示，避免列表页轰炸后端 txn-comment
  if (trimmed) return { text: `AI 评价：${trimmed}`, isAiBody: true, pendingAi: false };
  return { text: '', isAiBody: false, pendingAi: false };
}

function buildTxnMetaTags(input: {
  time: string;
  typeLabel: string;
  accountLabel: string;
  tone: 'income' | 'expense' | 'transfer';
}): TxnMetaTag[] {
  return [
    { label: input.time, tone: 'time' },
    { label: input.typeLabel, tone: input.tone },
    { label: input.accountLabel, tone: 'account' },
  ];
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
const NET_WORTH_TREND_CHART_H = 96;
/** 仅给折线描边与选中圆点半径留位；背景圆角单独绘制，不再靠加大 inset 躲裁切。 */
const NET_WORTH_TREND_CHART_INSET = 8;

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
  const incomeHints = /(?:^|[\s,，])(收入|到账|进账|工资|奖金|补贴|退款|回款)/;
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

/** 相册识图结果时间片：`10.23 12:18` */
function formatAlbumHappenedLabel(at: Date): string {
  const mm = at.getMonth() + 1;
  const dd = String(at.getDate()).padStart(2, '0');
  const hh = String(at.getHours()).padStart(2, '0');
  const mi = String(at.getMinutes()).padStart(2, '0');
  return `${mm}.${dd} ${hh}:${mi}`;
}

type AlbumScanPhase = 'off' | 'scanning' | 'result' | 'error';

function TxnItemInner({
  themeText,
  themeSubtle,
  dividerColor,
  monoFont,
  item,
  style,
  showDivider,
  onPress,
}: {
  themeText: string;
  themeSubtle: string;
  dividerColor: string;
  monoFont?: string;
  item: Txn;
  style?: StyleProp<ViewStyle>;
  showDivider?: boolean;
  onPress?: () => void;
}) {
  const [expanded, setExpanded] = React.useState(() => item.insight.length <= 44 || !item.insightIsAiBody);
  React.useEffect(() => {
    setExpanded(item.insight.length <= 44 || !item.insightIsAiBody);
  }, [item.insight, item.insightIsAiBody]);

  const canToggle = item.insightIsAiBody && item.insight.length > 44;
  const maxLines = canToggle && !expanded ? 2 : undefined;
  const iconTint = `${item.iconColor}18`;
  const timeTag = item.tags.find((t) => t.tone === 'time');
  const metaLine = item.tags
    .filter((t) => t.tone !== 'time')
    .map((t) => t.label)
    .join(' · ');

  const inner = (
    <Animated.View
      style={[
        styles.txnItem,
        showDivider ? { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: dividerColor } : null,
        style,
      ]}>
      <View style={[styles.txnIconWrap, { backgroundColor: iconTint }]}>
        <MaterialIcons name={item.icon} size={16} color={item.iconColor} />
      </View>
      <View style={styles.txnMain}>
        <Text style={[styles.txnTitle, { color: themeText }]} numberOfLines={1}>
          {item.title}
        </Text>
        <Text style={[styles.txnMetaLine, { color: themeSubtle }]} numberOfLines={1}>
          {metaLine || '—'}
        </Text>
        {item.insight ? (
          <View style={[styles.insightRow, item.insightPendingAi ? styles.insightRowPending : null]}>
            {item.insightPendingAi ? (
              <ActivityIndicator size="small" color={themeSubtle} />
            ) : (
              <MaterialIcons
                name="auto-awesome"
                size={11}
                color={item.insightIsAiBody ? item.iconColor : themeSubtle}
              />
            )}
            <View style={styles.insightBodyWrap}>
              <Text
                numberOfLines={maxLines}
                style={[
                  styles.insightText,
                  {
                    color: item.insightIsAiBody ? themeText : themeSubtle,
                    opacity: item.insightIsAiBody ? 0.72 : 0.85,
                  },
                ]}>
                {item.insight}
              </Text>
              {canToggle ? (
                <Pressable onPress={() => setExpanded((v) => !v)} hitSlop={8}>
                  <Text style={[styles.insightToggleText, { color: item.iconColor }]}>
                    {expanded ? '收起' : '展开'}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        ) : null}
      </View>
      <View style={styles.txnAmtCol}>
        <Text
          style={[
            styles.txnAmount,
            { color: item.amountColor, fontFamily: monoFont },
          ]}>
          {item.amount}
        </Text>
        {timeTag ? (
          <Text style={[styles.txnTimeOnly, { color: themeSubtle }]}>{timeTag.label}</Text>
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

const TxnItem = React.memo(TxnItemInner);

export default function FinanceScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { wrapLoad, resetSync } = usePageApiSync(PAGE_API_KEY);
  /** 用户在本页做过写操作后调用，下次聚焦时再从后端全量拉取 */
  const markPageDirty = resetSync;
  /** 首次数据未就绪前展示骨架屏，避免显示全 0 假数据 */
  const [initialFinanceLoadPending, setInitialFinanceLoadPending] = React.useState(true);
  const { enabled: reduceMotion, ready: motionReady } = useReducedMotionState();
  const financeContentRevealDoneRef = React.useRef(false);
  const {
    showSkeleton: showFinanceSkeleton,
    skeletonMounted: financeSkeletonMounted,
    skeletonOpacity: financeSkeletonOpacity,
    contentOpacity: financeContentOpacity,
  } = useHomeSkeletonReveal(initialFinanceLoadPending);
  const { ff, isDark, fonts: ffFonts } = useFinanceFoldTheme();
  const { animate: foldAnimate } = useFoldMotionGate();

  const bg = ff.paper;
  const surface = isDark ? ff.paper2 : ff.card;
  const surfaceSubtle = isDark ? ff.cardSoft : ff.paper2;
  const surfaceMuted = isDark ? 'rgba(255,255,255,0.06)' : '#F5F0E5';
  const text = ff.ink;
  const subtle = ff.muted;
  const textMuted = ff.faint;
  const outlineVariant = ff.line;
  const outlineStrong = ff.line2;
  const primary = ff.pine;
  const primaryMuted = ff.sage2;
  const primarySoft = ff.sage;
  const secondary = ff.income;
  const tertiary = ff.amber;
  const danger = ff.clay;
  const progressTrack = ff.budgetTrack;
  const progressFill = ff.amber;
  const headerScrim = isDark ? 'rgba(23,43,36,0.94)' : 'rgba(243,238,228,0.94)';
  const weekdayCn = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const;
  const { logicalTodayYmd: calendarTodayYmd, logicalTodayDate: today, boundary: financeDayBoundary } =
    usePageDayBoundary('finance');
  const calendarYesterdayYmd = React.useMemo(
    () => addDaysToLogicalYmd(calendarTodayYmd, -1),
    [calendarTodayYmd],
  );
  const headerDateLabel = `${today.getMonth() + 1}月${today.getDate()}日 · ${weekdayCn[today.getDay()]}`;
  const calendarMonthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const daysToMonthEnd = Math.max(0, calendarMonthEnd - today.getDate());
  const headerSubLabel =
    daysToMonthEnd <= 0 ? '本月最后一天' : `距离本月结束还有 ${daysToMonthEnd} 天`;

  const formatCurrencyWithDecimals = React.useCallback((value: number) => {
    const prefix = value < 0 ? '-¥' : '¥';
    return `${prefix}${Math.abs(value).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }, []);

  // 悬浮玻璃底栏之上：记一笔 FAB 贴右下
  const collapsedBottom = glassTabBarContentInset(insets.bottom) + 12;
  /** 列表底部预留：避开记一笔 FAB + 悬浮底栏 */
  const scrollContentBottom = 168;
  const [isSheetVisible, setIsSheetVisible] = React.useState(false);
  const [activeSheetTab, setActiveSheetTab] = React.useState<SheetTab>('sentence');
  const [sheetAmount, setSheetAmount] = React.useState('');
  const [sheetSentence, setSheetSentence] = React.useState('');
  const [isParsingSentence, setIsParsingSentence] = React.useState(false);
  const [sheetNote, setSheetNote] = React.useState('');
  const [selectedCategoryKey, setSelectedCategoryKey] = React.useState('food');
  const [selectedAccountId, setSelectedAccountId] = React.useState<string | null>(null);
  const [selectedHappenedAt, setSelectedHappenedAt] = React.useState(() => new Date());
  const prevCalendarTodayYmdRef = React.useRef(calendarTodayYmd);
  React.useEffect(() => {
    const prev = prevCalendarTodayYmdRef.current;
    if (prev === calendarTodayYmd) return;
    prevCalendarTodayYmdRef.current = calendarTodayYmd;
    // 有效日界翻页后：若仍停在「今天/昨天」锚点，则跳到当前时刻
    setSelectedHappenedAt((value) => {
      const valueYmd = getLogicalLocalYmd(value, financeDayBoundary);
      const staleFromYmd = addDaysToLogicalYmd(prev, -1);
      if (valueYmd >= staleFromYmd) return new Date();
      return value;
    });
  }, [calendarTodayYmd, financeDayBoundary]);
  const [isDatePickerVisible, setIsDatePickerVisible] = React.useState(false);
  const [isTimePickerVisible, setIsTimePickerVisible] = React.useState(false);
  const [isAccountPickerVisible, setIsAccountPickerVisible] = React.useState(false);
  const [accountPickerTarget, setAccountPickerTarget] = React.useState<AccountPickerTarget>('sheet');
  const [transferFromAccountId, setTransferFromAccountId] = React.useState<string | null>(null);
  const [transferToAccountId, setTransferToAccountId] = React.useState<string | null>(null);
  const [transferAmountTarget, setTransferAmountTarget] = React.useState<'amount' | 'fee'>('amount');
  const [transferFeeAmount, setTransferFeeAmount] = React.useState('');
  const [isSavingTransaction, setIsSavingTransaction] = React.useState(false);
  const [financeTransactions, setFinanceTransactions] = React.useState<FinanceTransactionRow[]>([]);
  /** 服务端 home.monthly；有值时优先于本地 aggregateTransactions */
  const [serverMonthly, setServerMonthly] = React.useState<{ income: number; expense: number } | null>(null);
  const [financeAccounts, setFinanceAccounts] = React.useState<FinanceAccountBalanceRow[]>([]);
  const [pendingAutoLedgers, setPendingAutoLedgers] = React.useState<PendingAutoLedgerRow[]>([]);
  const [autoLedgerToastVisible, setAutoLedgerToastVisible] = React.useState(false);
  const [autoLedgerToastMessage, setAutoLedgerToastMessage] = React.useState('正在识别截图并记账…');
  const autoLedgerReturnToPreviousAppRef = React.useRef(false);
  const autoLedgerDidBackgroundRef = React.useRef(false);
  /** handoff 已在 startAutoLedgerHandoff 中 enter，process 结束时配对 leave */
  const autoLedgerHandoffSessionHeldRef = React.useRef(false);
  const autoLedgerHandoffTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoLedgerImageUriRef = React.useRef<string | null>(null);
  const autoLedgerSourceRef = React.useRef<'clipboard' | 'shortcut_intent' | 'picker'>('clipboard');
  const cancelledAutoLedgerIdsRef = React.useRef<Set<string>>(new Set());
  const financeTransactionsRef = React.useRef<FinanceTransactionRow[]>([]);
  const flowCategoryNamesRef = React.useRef<Record<string, string>>({});
  const financeAccountsRef = React.useRef<FinanceAccountBalanceRow[]>([]);
  /** 作废进行中的 reload，避免慢 home 覆盖刚记账后的本地列表 */
  const financeReloadGenerationRef = React.useRef(0);

  React.useLayoutEffect(() => {
    financeTransactionsRef.current = financeTransactions;
  }, [financeTransactions]);

  const activeSheetTabRef = React.useRef<SheetTab>('sentence');
  React.useLayoutEffect(() => {
    activeSheetTabRef.current = activeSheetTab;
  }, [activeSheetTab]);
  const [budgetCardNetExpanded, setBudgetCardNetExpanded] = React.useState(false);
  const [selectedNetTrendIndex, setSelectedNetTrendIndex] = React.useState(0);
  const [netTrendScrubbing, setNetTrendScrubbing] = React.useState(false);
  /** 预算卡与月度汇总是否显示真实金额（false 时显示 ****） */
  const [showNetAmounts, setShowNetAmounts] = React.useState(true);
  const [monthBudgetSettings, setMonthBudgetSettings] = React.useState<Record<string, MonthBudgetSetting>>({});
  /** 预算周期刷新日（每月几日起算新一周期），默认 1 日。 */
  const [budgetRefreshDay, setBudgetRefreshDay] = React.useState(DEFAULT_BUDGET_REFRESH_DAY);
  const [budgetRefreshDayDraft, setBudgetRefreshDayDraft] = React.useState(DEFAULT_BUDGET_REFRESH_DAY);
  const [isBudgetAdjustVisible, setIsBudgetAdjustVisible] = React.useState(false);
  const [isTodayBudgetHintVisible, setIsTodayBudgetHintVisible] = React.useState(false);
  const [budgetBaseDraft, setBudgetBaseDraft] = React.useState('');
  const [periodSurplusDraft, setPeriodSurplusDraft] = React.useState('');
  const [periodSurplusLoadedFromBudget, setPeriodSurplusLoadedFromBudget] = React.useState<number | null>(null);
  const [modalIncludeLast, setModalIncludeLast] = React.useState(false);
  const [scheduledExpenses, setScheduledExpenses] = React.useState<ScheduledFinanceExpense[]>([]);
  const [savingsGoalTargetDate, setSavingsGoalTargetDate] = React.useState<string | null>(null);
  /** 收支明细：除「今天」外，初次最多再展示的历史日数（2 → 今天+前两日共三天） */
  const INITIAL_HISTORY_DAY_SLICES = 2;
  /** 触底后继续加载的历史日数（按有记录的自然日聚合） */
  const LOAD_MORE_HISTORY_DAY_STEP = 3;
  const [historyHasMoreRemote, setHistoryHasMoreRemote] = React.useState(false);
  const [visibleDayCount, setVisibleDayCount] = React.useState(INITIAL_HISTORY_DAY_SLICES);
  const [isLoadingMoreDays, setIsLoadingMoreDays] = React.useState(false);
  const [sheetImageUris, setSheetImageUris] = React.useState<string[]>([]);
  /** 支出/收入是否计入本月预算 */
  const [sheetIncludeInBudget, setSheetIncludeInBudget] = React.useState(true);
  const sheetIncludeInBudgetRef = React.useRef(true);
  const applySheetIncludeInBudget = React.useCallback((value: boolean | ((prev: boolean) => boolean)) => {
    setSheetIncludeInBudget((prev) => {
      const next = typeof value === 'function' ? value(prev) : value;
      sheetIncludeInBudgetRef.current = next;
      return next;
    });
  }, []);
  const [isPickingImage, setIsPickingImage] = React.useState(false);
  const [sentenceLedgerPreview, setSentenceLedgerPreview] = React.useState<SentenceLedgerPreviewState>(null);
  const [isSentencePreviewBusy, setIsSentencePreviewBusy] = React.useState(false);
  const [albumScanPhase, setAlbumScanPhase] = React.useState<AlbumScanPhase>('off');
  const [albumImageUri, setAlbumImageUri] = React.useState<string | null>(null);
  const [albumScanError, setAlbumScanError] = React.useState<string | null>(null);
  const [albumScanResult, setAlbumScanResult] = React.useState<FinanceAlbumScanResult | null>(null);
  const [albumParsePayload, setAlbumParsePayload] = React.useState<null | {
    transaction_type: 'expense' | 'income';
    amount: number;
    name: string;
    category_key: string;
    category_label: string;
    account_id: string;
    account_name: string;
    happened_at: string;
    imageDataUri: string;
  }>(null);
  const [albumConfirming, setAlbumConfirming] = React.useState(false);
  /** 递增以作废进行中的相册识图异步结果（关闭弹层 / 取消选图） */
  const albumScanGenerationRef = React.useRef(0);
  /** 手动记账弹窗内键盘高度，用于整体上移弹层并收缩可滚动区域，避免一句话输入框被 IME 遮挡 */
  const [sheetKeyboardInset, setSheetKeyboardInset] = React.useState(0);
  const budgetBaseInputRef = React.useRef<TextInput>(null);
  const periodSurplusInputRef = React.useRef<TextInput>(null);

  const baseBottomAnim = React.useRef(new Animated.Value(collapsedBottom)).current;
  const revealAnim = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    if (!motionReady || reduceMotion) {
      baseBottomAnim.stopAnimation();
      baseBottomAnim.setValue(collapsedBottom);
      return;
    }
    const move = Animated.timing(baseBottomAnim, {
      toValue: collapsedBottom,
      duration: 180,
      easing: Easing.out(Easing.quad),
      useNativeDriver: false,
    });
    move.start();
    return () => move.stop();
  }, [baseBottomAnim, collapsedBottom, insets.bottom, motionReady, reduceMotion]);

  React.useEffect(() => {
    if (initialFinanceLoadPending) return;

    const snapReveal = () => {
      revealAnim.stopAnimation();
      revealAnim.setValue(1);
      financeContentOpacity.setValue(1);
      financeContentRevealDoneRef.current = true;
    };

    // 已揭示过或减少动态 / 偏好未就绪：只保证终态，禁止再把 revealAnim 打回 0（会整页透明）
    if (financeContentRevealDoneRef.current || !motionReady || reduceMotion) {
      snapReveal();
      return;
    }

    financeContentRevealDoneRef.current = true;
    snapReveal();
  }, [financeContentOpacity, initialFinanceLoadPending, motionReady, reduceMotion, revealAnim]);

  const loadFinanceTransactions = React.useCallback(async (forceRefresh = false) => {
    try {
      const [rows, categories] = await Promise.all([
        getFinanceTransactions({ forceRefresh, cacheOnly: true }),
        getFinanceFlowCategories({ cacheOnly: true }),
      ]);
      flowCategoryNamesRef.current = Object.fromEntries(categories.map((c) => [c.id, c.name]));
      financeTransactionsRef.current = rows;
      setFinanceTransactions(rows);
    } catch (error) {
      console.warn('Failed to load finance transactions:', error);
      flowCategoryNamesRef.current = {};
      financeTransactionsRef.current = [];
      setFinanceTransactions([]);
    }
  }, []);

  const reloadFinanceTransactions = React.useCallback(
    async (forceRefresh = false) => {
      await wrapLoad(async () => {
        await loadFinanceTransactions(forceRefresh);
      }, forceRefresh);
    },
    [loadFinanceTransactions, wrapLoad],
  );

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

  const reloadFinanceAccounts = React.useCallback(
    async (forceRefresh = false) => {
      await wrapLoad(async () => {
        await loadFinanceAccounts();
      }, forceRefresh);
    },
    [loadFinanceAccounts, wrapLoad],
  );

  React.useEffect(() => {
    return subscribeAutoLedgerUiState((state) => {
      setPendingAutoLedgers(state.pending);
      setAutoLedgerToastVisible(state.toastVisible);
      setAutoLedgerToastMessage(state.toastMessage);
    });
  }, []);

  React.useEffect(() => {
    return subscribeAutoLedgerCompleted(() => {
      markPageDirty();
      financeReloadGenerationRef.current += 1;
      void reloadFinanceTransactions();
      void reloadFinanceAccounts();
    });
  }, [markPageDirty, reloadFinanceAccounts, reloadFinanceTransactions]);

  React.useEffect(() => {
    return subscribeFinanceSheetSaved(() => {
      markPageDirty();
      // 作废进行中的 home 拉取，防止慢响应盖掉刚写入的流水
      financeReloadGenerationRef.current += 1;
      // 经 wrapLoad 读本地，与自动记账一致；勿裸调 load*（会强制 REST，列表不及时更新）
      void reloadFinanceTransactions();
      void reloadFinanceAccounts();
    });
  }, [markPageDirty, reloadFinanceAccounts, reloadFinanceTransactions]);

  const handleDeleteFinanceTxn = React.useCallback(
    (txnId: string, displayTitle: string) => {
      const label = displayTitle.trim() || '该笔记录';
      Alert.alert('删除记录', `确定删除「${label}」吗？`, [
        { text: '取消', style: 'cancel' },
        {
          text: '删除',
          style: 'destructive',
          onPress: async () => {
            markPageDirty();
            try {
              await deleteFinanceTransaction(txnId);
              await Promise.all([reloadFinanceTransactions(), reloadFinanceAccounts()]);
              toast.success('已删除');
            } catch (error) {
              console.warn('Failed to delete finance transaction:', error);
              toast.error(toUserMessage(error, '删除失败，请稍后重试。'));
            }
          },
        },
      ]);
    },
    [loadFinanceAccounts, loadFinanceTransactions, markPageDirty],
  );

  React.useEffect(() => {
    void loadMonthBudgetSettings().then(setMonthBudgetSettings);
    void loadBudgetRefreshDay().then(setBudgetRefreshDay);
    void loadScheduledFinanceExpenses().then(setScheduledExpenses);
    void loadFinanceSavingsGoal().then((g) => setSavingsGoalTargetDate(g?.targetDate ?? null));
  }, []);

  /** 手动记账弹窗：不超过安全区顶部以下，避免顶栏关闭按钮被挡 */
  const manualSheetMaxHeight = React.useMemo(() => Dimensions.get('window').height - insets.top - 10, [insets.top]);
  /** 折叠记一笔顶栏 + Segment 估算高度，余量给下方可滚动内容 */
  const MANUAL_SHEET_CHROME_HEIGHT = 168;

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

  const getDayKey = React.useCallback(
    (value: Date) => getLogicalLocalYmd(value, financeDayBoundary),
    [financeDayBoundary],
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

  const todayTxns = React.useMemo(
    () =>
      financeTransactions.filter((txn) => {
        const happenedAt = parseStoredDatetime(txn.happened_at);
        if (Number.isNaN(happenedAt.getTime())) return false;
        return getDayKey(happenedAt) === calendarTodayYmd;
      }),
    [calendarTodayYmd, financeTransactions, getDayKey],
  );

  const todayExpenseTotal = React.useMemo(
    () =>
      todayTxns.reduce((sum, txn) => {
        if (txn.transaction_type !== 'expense') return sum;
        return sum + Math.abs(txn.amount);
      }, 0),
    [todayTxns]
  );

  const todayBudgetExpenseTotal = React.useMemo(
    () =>
      todayTxns.reduce((sum, txn) => {
        if (txn.transaction_type !== 'expense') return sum;
        if (isFinanceTransactionExcludedFromBudget(txn.extra_data, txn.transaction_type)) return sum;
        return sum + Math.abs(txn.amount);
      }, 0),
    [todayTxns]
  );

  const todayIncomeTotal = React.useMemo(
    () =>
      todayTxns.reduce((sum, txn) => {
        if (txn.transaction_type !== 'income') return sum;
        return sum + Math.abs(txn.amount);
      }, 0),
    [todayTxns]
  );

  const sortedTransactions = React.useMemo(() => {
    return [...financeTransactions].sort((a, b) => {
      const u = compareDatetimeDesc(a.updated_at, b.updated_at);
      if (u !== 0) return u;
      return compareDatetimeDesc(a.happened_at, b.happened_at);
    });
  }, [financeTransactions]);
  const todayDayKey = calendarTodayYmd;
  const sortedDayKeys = React.useMemo(() => {
    const keys = new Set<string>();
    sortedTransactions.forEach((txn) => {
      const happenedAt = parseStoredDatetime(txn.happened_at);
      if (Number.isNaN(happenedAt.getTime())) return;
      const dayKey = getDayKey(happenedAt);
      if (dayKey <= calendarTodayYmd) {
        keys.add(dayKey);
      }
    });
    // 按发生日从近到远，与「更新时间」排序解耦，避免「加载更多」日期错乱
    return Array.from(keys).sort((a, b) => b.localeCompare(a));
  }, [getDayKey, calendarTodayYmd, sortedTransactions]);
  const historyDayKeys = React.useMemo(() => sortedDayKeys.filter((k) => k !== todayDayKey), [sortedDayKeys, todayDayKey]);
  const hasMoreHistoryDays = visibleDayCount < historyDayKeys.length || historyHasMoreRemote;
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
    if (visibleDayCount < historyDayKeys.length) {
      setVisibleDayCount((prev) =>
        Math.min(prev + LOAD_MORE_HISTORY_DAY_STEP, historyDayKeys.length),
      );
      setIsLoadingMoreDays(false);
      return;
    }
    const oldest = historyDayKeys[historyDayKeys.length - 1] ?? todayDayKey;
    void (async () => {
      try {
        const more = await fetchFinanceRecentDays({
          before: oldest,
          days: LOAD_MORE_HISTORY_DAY_STEP,
          // 未勾选财务日界时为 0:00；勾选后与侧边栏日界一致
          dayBoundaryHour: financeDayBoundary.hour,
          dayBoundaryMinute: financeDayBoundary.minute,
          serverFallback: true,
        });
        if (more.transactions.length > 0) {
          const byId = new Map(financeTransactionsRef.current.map((t) => [t.id, t]));
          for (const t of more.transactions) byId.set(t.id, t);
          const merged = [...byId.values()];
          financeTransactionsRef.current = merged;
          setFinanceTransactions(merged);
        }
        setHistoryHasMoreRemote(more.historyHasMore);
        setVisibleDayCount((prev) => prev + LOAD_MORE_HISTORY_DAY_STEP);
      } catch (e) {
        console.warn('Failed to load more finance history days:', e);
        setHistoryHasMoreRemote(false);
      } finally {
        setIsLoadingMoreDays(false);
      }
    })();
  }, [hasMoreHistoryDays, historyDayKeys, isLoadingMoreDays, todayDayKey, visibleDayCount, financeDayBoundary]);

  const handleMainScroll = React.useCallback(
    (event: { nativeEvent: { contentOffset: { y: number }; layoutMeasurement: { height: number }; contentSize: { height: number } } }) => {
      const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
      reportTabBarScroll(contentOffset.y);
      if (!hasMoreHistoryDays || isLoadingMoreDays) {
        return;
      }
      const distanceToBottom = contentSize.height - (contentOffset.y + layoutMeasurement.height);
      if (distanceToBottom < 80) {
        loadMoreHistoryDays();
      }
    },
    [hasMoreHistoryDays, isLoadingMoreDays, loadMoreHistoryDays]
  );

  const zhipuTxnReady = isActiveAiLlmConfigured();

  const pickAccountForAutoLedger = React.useCallback(
    (
      accounts: FinanceAccountBalanceRow[],
      parsed: Pick<ParsedOneLiner, 'transaction_type' | 'account_name' | 'payment_account_label'>,
      lastUsedAccountId: string | null,
    ): FinanceAccountBalanceRow | null => {
      if (!accounts.length) return null;
      const candidates = accounts.map((a) => ({ id: a.id, name: a.name, account_no: a.account_no }));
      const matched = resolveFinanceAccountForAutoLedgerWithDefaults(candidates, {
        transactionType: parsed.transaction_type,
        accountName: parsed.account_name ?? null,
        paymentAccountLabel: parsed.payment_account_label ?? null,
        lastUsedAccountId,
      });
      if (!matched) return accounts[0] ?? null;
      return accounts.find((a) => a.id === matched.id) ?? accounts[0] ?? null;
    },
    [],
  );

  /** 手动记账弹窗：默认选中上次记账账户 */
  const getDefaultSheetAccountIdForTab = React.useCallback(
    (_tab: SheetTab, accounts: FinanceAccountBalanceRow[]): string | null => {
      if (!accounts.length) return null;
      const lastUsedId = sanitizeFinanceLastUsedAccountId(getCachedFinanceLastUsedAccountId(), accounts);
      if (lastUsedId) return lastUsedId;
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
      .sort((a, b) => {
        const u = compareDatetimeDesc(a.updated_at, b.updated_at);
        if (u !== 0) return u;
        return compareDatetimeDesc(a.happened_at, b.happened_at);
      })
      .map((txn) => {
        const happenedAt = parseStoredDatetime(txn.happened_at);
        const hour = Number.isNaN(happenedAt.getTime()) ? '00' : String(happenedAt.getHours()).padStart(2, '0');
        const minute = Number.isNaN(happenedAt.getTime()) ? '00' : String(happenedAt.getMinutes()).padStart(2, '0');
        const accountLabel = accountNameMap.get(txn.account_id) ?? '未知账户';

        const displayAmount = getTxnDisplayAmount(txn);
        const isTransfer = txn.transaction_type === 'transfer';
        const isIncome = !isTransfer && txn.transaction_type === 'income';
        const isExpense = !isTransfer && txn.transaction_type === 'expense';
        const typeLabel = isTransfer ? '转账' : isIncome ? '收入' : '支出';
        const typeTone: TxnMetaTag['tone'] = isTransfer ? 'transfer' : isIncome ? 'income' : 'expense';
        const icon: keyof typeof MaterialIcons.glyphMap = isTransfer
          ? 'sync-alt'
          : isIncome
            ? 'savings'
            : isExpense
              ? 'shopping-bag'
              : 'sync-alt';
        const iconColor = isTransfer ? subtle : isIncome ? secondary : isExpense ? tertiary : subtle;
        const amountColor = isTransfer ? text : isIncome ? secondary : isExpense ? danger : text;
        const amountPrefix = displayAmount > 0 ? '+' : displayAmount < 0 ? '-' : '';

        const aiLine = buildTxnAiInsightLine(txn);

        return {
          id: txn.id,
          dayKey: todayDayKey,
          icon,
          iconColor,
          title: txn.name?.trim() || '交易',
          tags: buildTxnMetaTags({
            time: `${hour}:${minute}`,
            typeLabel,
            accountLabel,
            tone: typeTone,
          }),
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
    getTxnDisplayAmount,
    pendingAutoLedgers,
    danger,
    secondary,
    subtle,
    tertiary,
    text,
    todayDayKey,
    todayTxns,
  ]);

  const historySections = React.useMemo(() => {
    const yesterdayDayKey = calendarYesterdayYmd;
    const weekdayCnLocal = weekdayCn;

    const sectionMap = new Map<
      string,
      {
        dayKey: string;
        date: Date;
        label: string;
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
      const created = { dayKey, date, label, income: 0, expense: 0, items: [] as Txn[] };
      sectionMap.set(dayKey, created);
      return created;
    };

    sortedTransactions.forEach((txn) => {
      const happenedAt = parseStoredDatetime(txn.happened_at);
      if (Number.isNaN(happenedAt.getTime())) return;
      const dayKey = getDayKey(happenedAt);
      if (dayKey === todayDayKey) return;
      if (!visibleDayKeySet.has(dayKey)) return;

      const section = upsert(dayKey);
      const displayAmount = getTxnDisplayAmount(txn);
      if (txn.transaction_type === 'income') section.income += Math.abs(txn.amount);
      if (txn.transaction_type === 'expense') section.expense += Math.abs(txn.amount);

      const hour = String(happenedAt.getHours()).padStart(2, '0');
      const minute = String(happenedAt.getMinutes()).padStart(2, '0');
      const accountLabel = accountNameMap.get(txn.account_id) ?? '未知账户';

      const isTransfer = txn.transaction_type === 'transfer';
      const isIncome = !isTransfer && txn.transaction_type === 'income';
      const isExpense = !isTransfer && txn.transaction_type === 'expense';
      const typeLabel = isTransfer ? '转账' : isIncome ? '收入' : '支出';
      const typeTone: TxnMetaTag['tone'] = isTransfer ? 'transfer' : isIncome ? 'income' : 'expense';
      const icon: keyof typeof MaterialIcons.glyphMap = isTransfer
        ? 'sync-alt'
        : isIncome
          ? 'savings'
          : isExpense
            ? 'shopping-bag'
            : 'sync-alt';
      const iconColor = isTransfer ? subtle : isIncome ? secondary : isExpense ? tertiary : subtle;
      const amountColor = isTransfer ? text : isIncome ? secondary : isExpense ? danger : text;
      const amountPrefix = displayAmount > 0 ? '+' : displayAmount < 0 ? '-' : '';

      const aiLine = buildTxnAiInsightLine(txn);

      section.items.push({
        id: txn.id,
        dayKey,
        icon,
        iconColor,
        title: txn.name?.trim() || '交易',
        tags: buildTxnMetaTags({
          time: `${hour}:${minute}`,
          typeLabel,
          accountLabel,
          tone: typeTone,
        }),
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
    getDayKey,
    getTxnDisplayAmount,
    danger,
    secondary,
    sortedTransactions,
    subtle,
    tertiary,
    text,
    todayDayKey,
    visibleDayKeySet,
    calendarYesterdayYmd,
    weekdayCn,
  ]);

  const displayTxns = React.useMemo<Txn[]>(() => {
    return sortedTransactions
      .filter((txn) => {
        const happenedAt = parseStoredDatetime(txn.happened_at);
        if (Number.isNaN(happenedAt.getTime())) return false;
        if (getDayKey(happenedAt) === todayDayKey) return false;
        return visibleDayKeySet.has(getDayKey(happenedAt));
      })
      .map((txn) => {
      const happenedAt = parseStoredDatetime(txn.happened_at);
      const hour = Number.isNaN(happenedAt.getTime()) ? '00' : String(happenedAt.getHours()).padStart(2, '0');
      const minute = Number.isNaN(happenedAt.getTime()) ? '00' : String(happenedAt.getMinutes()).padStart(2, '0');
      const accountLabel = accountNameMap.get(txn.account_id) ?? '未知账户';

      const displayAmount = getTxnDisplayAmount(txn);
      const isTransfer = txn.transaction_type === 'transfer';
      const isIncome = !isTransfer && txn.transaction_type === 'income';
      const isExpense = !isTransfer && txn.transaction_type === 'expense';
      const typeLabel = isTransfer ? '转账' : isIncome ? '收入' : '支出';
      const typeTone: TxnMetaTag['tone'] = isTransfer ? 'transfer' : isIncome ? 'income' : 'expense';
      const icon: keyof typeof MaterialIcons.glyphMap = isTransfer
        ? 'sync-alt'
        : isIncome
          ? 'savings'
          : isExpense
            ? 'shopping-bag'
            : 'sync-alt';
      const iconColor = isTransfer ? subtle : isIncome ? secondary : isExpense ? tertiary : subtle;
      const amountColor = isTransfer ? text : isIncome ? secondary : isExpense ? danger : text;
      const amountPrefix = displayAmount > 0 ? '+' : displayAmount < 0 ? '-' : '';

      const aiLine = buildTxnAiInsightLine(txn);

      return {
        id: txn.id,
        dayKey: getDayKey(happenedAt),
        icon,
        iconColor,
        title: txn.name?.trim() || '交易',
        tags: buildTxnMetaTags({
          time: `${hour}:${minute}`,
          typeLabel,
          accountLabel,
          tone: typeTone,
        }),
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
    getDayKey,
    getTxnDisplayAmount,
    danger,
    secondary,
    sortedTransactions,
    subtle,
    tertiary,
    text,
    todayDayKey,
    visibleDayKeySet,
  ]);

  const monthStartYmd = formatYmd(new Date(today.getFullYear(), today.getMonth(), 1));
  const monthEndYmd = formatYmd(new Date(today.getFullYear(), today.getMonth() + 1, 0));
  const localMonthlyAgg = React.useMemo(
    () =>
      aggregateTransactions(financeTransactions, {
        start: monthStartYmd,
        end: monthEndYmd,
      }),
    [financeTransactions, monthEndYmd, monthStartYmd],
  );
  const monthlyIncome = serverMonthly?.income ?? localMonthlyAgg.income;
  const monthlyExpense = serverMonthly?.expense ?? localMonthlyAgg.expense;

  const budgetPeriodStart = getBudgetPeriodStartForDate(today, budgetRefreshDay);
  const budgetPeriodEndExclusive = getNextBudgetPeriodStart(budgetPeriodStart, budgetRefreshDay);
  const budgetPeriodTransactions = React.useMemo(() => {
    return financeTransactions.filter((txn) => {
      const happenedAt = parseStoredDatetime(txn.happened_at);
      return happenedAt >= budgetPeriodStart && happenedAt < budgetPeriodEndExclusive;
    });
  }, [financeTransactions, budgetPeriodStart, budgetPeriodEndExclusive]);

  const monthlyBudgetExpense = React.useMemo(
    () =>
      budgetPeriodTransactions.reduce((sum, txn) => {
        if (txn.transaction_type !== 'expense') return sum;
        if (isFinanceTransactionExcludedFromBudget(txn.extra_data, txn.transaction_type)) return sum;
        return sum + Math.abs(txn.amount);
      }, 0),
    [budgetPeriodTransactions]
  );

  const monthlyBudgetIncome = React.useMemo(
    () =>
      budgetPeriodTransactions.reduce((sum, txn) => {
        if (txn.transaction_type !== 'income') return sum;
        if (isFinanceTransactionExcludedFromBudget(txn.extra_data, txn.transaction_type)) return sum;
        return sum + Math.abs(txn.amount);
      }, 0),
    [budgetPeriodTransactions]
  );

  /** 本预算周期定时支出预扣合计（整周期，用于预算总额扣减；与 exclude_from_budget 配套）。 */
  const scheduledBudgetDeduction = React.useMemo(
    () => sumScheduledExpensesInRange(scheduledExpenses, budgetPeriodStart, budgetPeriodEndExclusive),
    [scheduledExpenses, budgetPeriodStart, budgetPeriodEndExclusive],
  );

  const paidScheduledExpenseSlots = React.useMemo(
    () => collectPaidScheduledExpenseSlots(financeTransactions),
    [financeTransactions],
  );

  /**
   * 定时预扣展示 / 预期存款抬高：共用同一口径（见 computeScheduledWithholdingRemaining）。
   * 预算总额仍用整周期 `scheduledBudgetDeduction`。
   */
  const scheduledWithholdingRemaining = React.useMemo(
    () =>
      computeScheduledWithholdingRemaining({
        items: scheduledExpenses,
        today,
        budgetPeriodEndExclusive,
        savingsGoalTargetDate,
        now: new Date(),
        paidSlots: paidScheduledExpenseSlots,
      }),
    [
      scheduledExpenses,
      today,
      budgetPeriodEndExclusive,
      savingsGoalTargetDate,
      paidScheduledExpenseSlots,
      financeTransactions,
    ],
  );

  const monthlySurplus = monthlyIncome - monthlyExpense;
  const savingsRate = monthlyIncome > 0 ? (monthlySurplus / monthlyIncome) * 100 : 0;

  const prevBudgetPeriodStart = getPreviousBudgetPeriodStart(budgetPeriodStart, budgetRefreshDay);
  const prevBudgetPeriodEndExclusive = budgetPeriodStart;
  const prevBudgetPeriodTransactions = React.useMemo(() => {
    return financeTransactions.filter((txn) => {
      const happenedAt = parseStoredDatetime(txn.happened_at);
      return happenedAt >= prevBudgetPeriodStart && happenedAt < prevBudgetPeriodEndExclusive;
    });
  }, [financeTransactions, prevBudgetPeriodStart, prevBudgetPeriodEndExclusive]);
  const prevBudgetPeriodIncome = React.useMemo(
    () =>
      prevBudgetPeriodTransactions.reduce((sum, txn) => {
        if (txn.transaction_type !== 'income') return sum;
        return sum + Math.abs(txn.amount);
      }, 0),
    [prevBudgetPeriodTransactions]
  );
  const prevBudgetPeriodExpense = React.useMemo(
    () =>
      prevBudgetPeriodTransactions.reduce((sum, txn) => {
        if (txn.transaction_type !== 'expense') return sum;
        return sum + Math.abs(txn.amount);
      }, 0),
    [prevBudgetPeriodTransactions]
  );
  const lastMonthRemaining = Math.max(0, prevBudgetPeriodIncome - prevBudgetPeriodExpense);

  const hiddenAmountText = '****';
  const monthlyIncomeText = showNetAmounts ? formatCurrencyWithDecimals(monthlyIncome) : hiddenAmountText;
  const monthlyExpenseText = showNetAmounts ? formatCurrencyWithDecimals(monthlyExpense) : hiddenAmountText;
  const monthlySurplusText = showNetAmounts ? formatCurrencyWithDecimals(monthlySurplus) : hiddenAmountText;
  const monthlySurplusColor = monthlySurplus > 0 ? secondary : monthlySurplus < 0 ? danger : text;
  const savingRateText = showNetAmounts ? `${savingsRate.toFixed(1)}%` : '--';

  const daysLeftIncludingToday = budgetDaysLeftIncludingToday(today, budgetPeriodEndExclusive);
  const budgetPeriodCountdownLabel = formatBudgetPeriodCountdownLabel(daysLeftIncludingToday);
  const currentMonthKey = getBudgetMonthKeyForDate(today, budgetRefreshDay);
  const budgetSheetMonthNumber = parseInt(currentMonthKey.split('-')[1] ?? '1', 10);
  const persistedBudgetSetting = monthBudgetSettings[currentMonthKey];
  const effectiveBaseBudget =
    currentMonthKey in monthBudgetSettings ? monthBudgetSettings[currentMonthKey]!.baseAmount : 0;
  const includeLastBalanceEffective = persistedBudgetSetting?.includeLastBalance ?? false;
  const grossBudgetAmount = includeLastBalanceEffective
    ? effectiveBaseBudget + lastMonthRemaining
    : effectiveBaseBudget;
  const budgetTotalAmount = Math.max(
    0,
    grossBudgetAmount - scheduledBudgetDeduction + monthlyBudgetIncome,
  );
  const parsedBudgetDraft = parseFloat(budgetBaseDraft.trim().replace(/,/g, ''));
  const baseForBudgetPreview =
    Number.isFinite(parsedBudgetDraft) && parsedBudgetDraft >= 0 ? parsedBudgetDraft : effectiveBaseBudget;
  const budgetPreviewGross = modalIncludeLast ? baseForBudgetPreview + lastMonthRemaining : baseForBudgetPreview;
  const budgetPreviewTotal = Math.max(0, budgetPreviewGross - scheduledBudgetDeduction + monthlyBudgetIncome);
  const autoPeriodSurplusPreview = budgetPreviewTotal - monthlyBudgetExpense;
  /**
   * 页面主展示始终按「预算总额 - 已用」实时计算，避免预算结余被手动草稿值或旧的覆盖值锁死。
   * 预算详情弹层里的输入仍可用于手动校正，但不会影响主卡片的自动刷新。
   */
  const budgetSurplusAmount = budgetTotalAmount - monthlyBudgetExpense;
  const parsedPeriodSurplusDraft = parseFloat(periodSurplusDraft.trim().replace(/,/g, ''));
  const isPeriodSurplusDirty =
    periodSurplusLoadedFromBudget == null ||
    !Number.isFinite(parsedPeriodSurplusDraft) ||
    Math.abs(parsedPeriodSurplusDraft - periodSurplusLoadedFromBudget) >= 0.005;
  const budgetUsedPercentRaw = budgetTotalAmount > 0 ? (monthlyBudgetExpense / budgetTotalAmount) * 100 : 0;
  const budgetUsedPercent = Math.min(100, Math.max(0, budgetUsedPercentRaw));
  /** 调整预算弹层打开时用草稿预览，使「今日可用」与定时预扣/基数/结余编辑同步。 */
  const todayBudgetTotalAmount = isBudgetAdjustVisible ? budgetPreviewTotal : budgetTotalAmount;
  const todayBudgetSurplusAmount = isBudgetAdjustVisible
    ? Number.isFinite(parsedPeriodSurplusDraft)
      ? parsedPeriodSurplusDraft
      : autoPeriodSurplusPreview
    : budgetSurplusAmount;
  const dailyBudgetFromRemaining = computeDailyBudgetFromPeriodSurplus(
    todayBudgetSurplusAmount,
    todayBudgetTotalAmount,
    daysLeftIncludingToday,
  );
  const hasConfiguredMonthBudget =
    isBudgetAdjustVisible || currentMonthKey in monthBudgetSettings || monthlyBudgetIncome > 0;
  const dailyBudgetAmount = dailyBudgetFromRemaining;
  const todayAvailableAmount = Math.max(0, dailyBudgetAmount - todayBudgetExpenseTotal);
  const isPeriodBudgetDepleted = todayBudgetSurplusAmount <= 0;
  const todayBudgetOverAmount =
    isPeriodBudgetDepleted && todayBudgetExpenseTotal > 0
      ? todayBudgetExpenseTotal
      : dailyBudgetAmount > 0
        ? Math.max(0, todayBudgetExpenseTotal - dailyBudgetAmount)
        : 0;
  const isTodayBudgetOver = todayBudgetOverAmount > 0;
  const todayBudgetUsagePct = dailyBudgetAmount > 0 ? Math.min(1, todayBudgetExpenseTotal / dailyBudgetAmount) : 0;

  const budgetUiNaturalMonth = budgetRefreshDay === DEFAULT_BUDGET_REFRESH_DAY;
  const budgetUiScopeShort = budgetUiNaturalMonth ? '本月' : '本周期';
  const budgetUiPrevCarryLabel = budgetUiNaturalMonth ? '上月剩余' : '上周期剩余';
  const budgetUiIncludePrevLabel = budgetUiNaturalMonth ? '包含上月结余' : '包含上周期结余';
  const todayBudgetDailyExplain = hasConfiguredMonthBudget
    ? `剩余预算 ÷ 含今天在内的 ${daysLeftIncludingToday} 天`
    : `${budgetUiScopeShort}预算 ÷ 含今天在内的 ${daysLeftIncludingToday} 天`;

  /** 净资产汇总：排除「不计入」账户，与资产页 hero 一致 */
  const netTotalForTrend = React.useMemo(() => computeNetWorthTotal(financeAccounts), [financeAccounts]);
  const totalAssetsAmount = React.useMemo(() => computeTotalAssets(financeAccounts), [financeAccounts]);
  const totalLiabilitiesAbsAmount = React.useMemo(
    () => computeTotalLiabilitiesAbs(financeAccounts),
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

  /** 仅展示「今天」与当前选中日，避免底部一排无意义稀疏点。 */
  const netTrendVisibleNodeIndices = React.useMemo(() => {
    const indices = new Set<number>();
    if (netTrendLastIndex >= 0) indices.add(netTrendLastIndex);
    if (selectedNetTrendIndex >= 0 && selectedNetTrendIndex < netTrendPoints.length) {
      indices.add(selectedNetTrendIndex);
    }
    return [...indices].sort((a, b) => a - b);
  }, [netTrendLastIndex, netTrendPoints.length, selectedNetTrendIndex]);

  const selectedNetTrend =
    netTrendPoints[selectedNetTrendIndex] ?? netTrendPoints[netTrendLastIndex] ?? { value: netTotalForTrend, label: '今天', dayKey: netWorthTrendDayKey };
  const isSelectedNetTrendToday = selectedNetTrendIndex === netTrendLastIndex;
  /** 今日净资产必须与账户余额汇总一致；历史日期仍用趋势回溯值。 */
  const displayedNetWorthAmount = isSelectedNetTrendToday ? netTotalForTrend : selectedNetTrend.value;

  const enabledScheduledCount = React.useMemo(
    () => scheduledExpenses.filter((item) => item.enabled).length,
    [scheduledExpenses],
  );

  /** 较月初净资产变动（从 30 日趋势点推算，有则展示） */
  const netMonthChange = React.useMemo(() => {
    if (netTrendPoints.length < 2) return null;
    const monthStartKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
    const startPt =
      netTrendPoints.find((p) => p.dayKey === monthStartKey) ??
      netTrendPoints.find((p) => p.dayKey >= monthStartKey) ??
      netTrendPoints[0];
    if (!startPt) return null;
    const delta = netTotalForTrend - startPt.value;
    const pct = Math.abs(startPt.value) > 0.005 ? (delta / Math.abs(startPt.value)) * 100 : null;
    return { delta, pct };
  }, [netTotalForTrend, netTrendPoints, today]);

  const foldEntranceAnimate = foldAnimate && !initialFinanceLoadPending;
  const todayAvailableRingPct =
    dailyBudgetAmount > 0
      ? Math.min(1, Math.max(0, todayAvailableAmount / dailyBudgetAmount))
      : 0;

  /** 与 Svg viewBox 一致；圆点层不裁切，故 inset 只需覆盖圆点半径。 */
  const trendChartGeometry = React.useMemo(() => {
    const w = NET_WORTH_TREND_CHART_W;
    const h = NET_WORTH_TREND_CHART_H;
    const inset = NET_WORTH_TREND_CHART_INSET;
    if (netTrendPoints.length < 2) return null;

    const vals = netTrendPoints.map((p) => p.value);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const rawSpan = max - min;
    const innerW = w - inset * 2;
    const innerH = h - inset * 2;
    const baselineY = h - inset;

    // 无波动居中；有波动时几乎铺满绘图区，避免中间大块空档。
    const flat = rawSpan <= 0;
    const yMin = flat ? min - 1 : min;
    const yMax = flat ? max + 1 : max;
    const span = yMax - yMin || 1;

    const points = vals.map((value, i) => ({
      x: inset + (i / (vals.length - 1)) * innerW,
      y: inset + (1 - (value - yMin) / span) * innerH,
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

  const updateNetTrendIndexFromLocationX = React.useCallback((locationX: number) => {
    const n = netTrendPointCountRef.current;
    if (n < 2) return;
    const width = trendChartPlotWidthRef.current;
    if (width <= 0) return;
    const idx = netWorthTrendIndexFromLocationX(locationX, width, n);
    setSelectedNetTrendIndex(idx);
  }, []);

  const beginNetTrendScrub = React.useCallback(
    (locationX: number) => {
      setNetTrendScrubbing(true);
      updateNetTrendIndexFromLocationX(locationX);
    },
    [updateNetTrendIndexFromLocationX],
  );

  const endNetTrendScrub = React.useCallback(() => {
    setNetTrendScrubbing(false);
  }, []);

  const netWorthTrendScrubGesture = React.useMemo(() => {
    // 图表区域按下即激活，避免被外层 ScrollView 抢走（RN responder 在此场景不可靠）
    const pan = Gesture.Pan()
      .manualActivation(true)
      .shouldCancelWhenOutside(false)
      .onTouchesDown((_e, state) => {
        'worklet';
        state.activate();
      })
      .onStart((e) => {
        'worklet';
        runOnJS(beginNetTrendScrub)(e.x);
      })
      .onUpdate((e) => {
        'worklet';
        runOnJS(updateNetTrendIndexFromLocationX)(e.x);
      })
      .onFinalize(() => {
        'worklet';
        runOnJS(endNetTrendScrub)();
      });

    const tap = Gesture.Tap().onEnd((e) => {
      'worklet';
      runOnJS(updateNetTrendIndexFromLocationX)(e.x);
    });

    return Gesture.Simultaneous(pan, tap);
  }, [beginNetTrendScrub, endNetTrendScrub, updateNetTrendIndexFromLocationX]);

  const formatCurrencyBalance = React.useCallback(
    (value: number) => {
      if (!showNetAmounts) return hiddenAmountText;
      const prefix = value < 0 ? '-¥' : '¥';
      return `${prefix}${Math.abs(value).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    },
    [showNetAmounts]
  );

  /** 列表展示：资产类余额不低于 0，负债类展示债务额度（兼容正负账本余额） */
  const formatCurrencyBalanceForAccount = React.useCallback(
    (acc: FinanceAccountBalanceRow) => {
      if (!showNetAmounts) return hiddenAmountText;
      if (isFinanceLiabilityAccount(acc)) {
        return formatCurrencyBalance(-financeLiabilityDebtMagnitude(acc.balance));
      }
      const v = Math.max(0, acc.balance ?? 0);
      return formatCurrencyBalance(v);
    },
    [formatCurrencyBalance, showNetAmounts]
  );

  /** 账户资产卡片：资产按余额高→低，负债按债务绝对值高→低，并保证负债账户也能出现在轮播中 */
  const financeAccountsSortedByBalance = React.useMemo(() => {
    const visible = financeAccounts.filter(
      (acc) => !isFinanceAccountHiddenFromHome(acc.extra_data ?? null),
    );
    const displayBalance = (acc: FinanceAccountBalanceRow) => {
      if (isFinanceLiabilityAccount(acc)) return -financeLiabilityDebtMagnitude(acc.balance);
      return Math.max(0, acc.balance ?? 0);
    };
    const assets = visible
      .filter((acc) => !isFinanceLiabilityAccount(acc))
      .sort((a, b) => displayBalance(b) - displayBalance(a));
    const liabilities = visible
      .filter((acc) => isFinanceLiabilityAccount(acc))
      .sort((a, b) => Math.abs(displayBalance(b)) - Math.abs(displayBalance(a)));
    const MAX_CARDS = 8;
    if (liabilities.length === 0) return assets.slice(0, MAX_CARDS);
    const liabilitySlots = Math.min(liabilities.length, Math.max(2, Math.ceil(MAX_CARDS / 3)));
    const assetSlots = Math.max(0, MAX_CARDS - liabilitySlots);
    return [...assets.slice(0, assetSlots), ...liabilities.slice(0, liabilitySlots)];
  }, [financeAccounts]);

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

  const {
    expenseCategories,
    incomeCategories,
    addModalVisible,
    newCategoryName,
    setNewCategoryName,
    newCategoryIcon,
    setNewCategoryIcon,
    isSavingCategory,
    openAddCategoryModal,
    closeAddCategoryModal,
    saveNewCategory,
    confirmDeleteCustomCategory,
  } = useFinanceSheetCategories({ primary, secondary, tertiary, subtle });

  const beginAutoLedgerShortcutSession = React.useCallback(() => {
    autoLedgerReturnToPreviousAppRef.current = true;
    autoLedgerDidBackgroundRef.current = false;
  }, []);

  const isAutoLedgerHandoffSession = React.useCallback(
    () => autoLedgerReturnToPreviousAppRef.current || autoLedgerDidBackgroundRef.current,
    [],
  );

  const dismissAutoLedgerHandoffSplash = React.useCallback(() => {
    if (autoLedgerHandoffTimerRef.current != null) {
      clearTimeout(autoLedgerHandoffTimerRef.current);
      autoLedgerHandoffTimerRef.current = null;
    }
    setAutoLedgerToastVisible(false);
    autoLedgerReturnToPreviousAppRef.current = false;
  }, []);

  const startAutoLedgerHandoff = React.useCallback(
    async (source: 'clipboard' | 'shortcut_intent', message?: string) => {
      beginAutoLedgerShortcutSession();
      autoLedgerSourceRef.current = source;
      setAutoLedgerToastMessage(message ?? '正在识别截图并记账…');
      setAutoLedgerToastVisible(true);
      await enterAutoLedgerSession();
      autoLedgerHandoffSessionHeldRef.current = true;

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

  const cancelPendingAutoLedger = React.useCallback((pendingId: string) => {
    cancelAutoLedgerJob(pendingId);
    dismissAutoLedgerHandoffSplash();
  }, [dismissAutoLedgerHandoffSplash]);

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
      ledgerSource: 'clipboard' | 'shortcut_intent' | 'picker' = 'clipboard',
    ) => {
      if (shouldSkipDuplicateAutoLedgerImage(imageDataUri)) {
        return;
      }
      const handoffHeld = autoLedgerHandoffSessionHeldRef.current;
      if (!handoffHeld) {
        await enterAutoLedgerSession();
      }
      try {
      autoLedgerImageUriRef.current = imageDataUri;
      autoLedgerSourceRef.current = ledgerSource;
      const handoff = isAutoLedgerHandoffSession();

      const key = getActiveAiLlmApiKey().trim();
      if (!key) {
        const msg = '未配置智谱密钥（EXPO_PUBLIC_ZHIPU_API_KEY）。';
        if (handoff) {
          void notifyAutoLedgerFailure(msg);
        } else {
          toast.error(msg);
        }
        return;
      }

      if (!accounts.length) {
        const msg = '请先添加至少一个账户。';
        if (handoff) {
          void notifyAutoLedgerFailure(msg);
        } else {
          toast.error(msg);
        }
        return;
      }

      const pendingId = makeTimestampEntityId('pal_', 8);
      const maxAttempts = AUTO_LEDGER_MAX_ATTEMPTS;
      cancelledAutoLedgerIdsRef.current.delete(pendingId);
      setPendingAutoLedgers((prev) => [
        { id: pendingId, source: ledgerSource, retryAttempt: 1, maxAttempts },
        ...prev,
      ]);

      const isCancelled = () => cancelledAutoLedgerIdsRef.current.has(pendingId);
      const accountHints = accounts.map((a) => ({ name: a.name, account_no: a.account_no }));
      let lastError = '请稍后重试。';

      try {
        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
          if (isCancelled()) return;

          if (attempt > 1) {
            setPendingAutoLedgers((prev) =>
              prev.map((row) =>
                row.id === pendingId ? { ...row, retryAttempt: attempt, maxAttempts } : row,
              ),
            );
            await sleepMs(AUTO_LEDGER_RETRY_DELAY_MS);
            if (isCancelled()) return;
          }

          try {
            const resolved = await parseFinanceOneLinerFromImage({
              apiKey: key,
              imageDataUri,
              accounts: accountHints,
              maxAttempts: 2,
              retryDelayMs: 800,
            });
            if (isCancelled()) return;

            if (!resolved.ok) {
              if (resolved.notBill) {
                if (handoff) {
                  void notifyAutoLedgerHint(AUTO_LEDGER_NOT_BILL_MESSAGE);
                } else {
                  toast.info(AUTO_LEDGER_NOT_BILL_MESSAGE);
                }
                return;
              }
              lastError = resolved.error;
              console.warn(`Auto ledger parse attempt ${attempt}/${maxAttempts} failed:`, resolved.error);
              continue;
            }

            const lastUsedAccountId = sanitizeFinanceLastUsedAccountId(
              getCachedFinanceLastUsedAccountId(),
              accounts,
            );
            const account = pickAccountForAutoLedger(
              accounts,
              {
                transaction_type: resolved.transaction_type,
                account_name: resolved.account_name,
                payment_account_label: resolved.payment_account_label,
              },
              lastUsedAccountId,
            );
            if (!account) {
              const msg = '请先添加至少一个账户。';
              if (handoff) {
                void notifyAutoLedgerFailure(msg);
              } else {
                toast.error(msg);
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
            const signedAmount = financeSignedAmountForSave(account.sign_rule, account.account_type, amountAbs);
            const boundsErr = await validateFinanceTransactionBeforeSave({
              accountId: account.id,
              transactionType,
              amount: signedAmount,
              extraData: null,
              accountName: account.name,
              uiLedgerBalance: account.balance,
            });
            if (boundsErr) {
              if (handoff) {
                void notifyAutoLedgerFailure(boundsErr);
              } else {
                toast.warn(boundsErr);
              }
              return;
            }

            const txnId = makeTimestampEntityId('ft_', 8);
            const { iso: happenedAtIso, fromBill: happenedAtFromBill } = resolveHappenedAtForBillLedger(
              resolved.happened_at,
            );
            const noteLine =
              ledgerSource === 'shortcut_intent'
                ? `快捷指令截图 · ${parsed.name}`
                : ledgerSource === 'picker'
                  ? `图片记账 · ${parsed.name}`
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
                from_picker_image: ledgerSource === 'picker',
                recognized_payment_account: resolved.payment_account_label,
                matched_account_name: account.name,
                recognized_happened_at: resolved.happened_at,
                happened_at_from_bill: happenedAtFromBill,
                category_key: cat.key,
                category_label: cat.label,
                attachments: [{ type: 'image', uri: imageDataUri }],
              }),
            });
            markPageDirty();
            await Promise.all([reloadFinanceTransactions(), reloadFinanceAccounts()]);
            return;
          } catch (error) {
            lastError =
              error instanceof Error && error.message.trim() ? error.message : '请稍后重试。';
            console.warn(`Auto ledger attempt ${attempt}/${maxAttempts} failed:`, error);
          }
        }

        if (isCancelled()) return;

        const failMsg = `已自动重试 ${maxAttempts} 次仍未成功，请检查网络或截图是否清晰后重试。\n\n${lastError}`;
        if (handoff) {
          void notifyAutoLedgerFailure(failMsg);
        } else {
          toast.error(toUserMessage(lastError, '已自动重试多次仍未成功，请检查网络或截图后重试。'));
        }
      } finally {
        cancelledAutoLedgerIdsRef.current.delete(pendingId);
        setPendingAutoLedgers((prev) => prev.filter((row) => row.id !== pendingId));
      }
      } finally {
        if (handoffHeld) {
          autoLedgerHandoffSessionHeldRef.current = false;
        }
        await leaveAutoLedgerSession();
      }
    },
    [
      expenseCategories,
      incomeCategories,
      isAutoLedgerHandoffSession,
      loadFinanceAccounts,
      loadFinanceTransactions,
      markPageDirty,
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
    transferFromAccount.id !== transferToAccount.id;
  const transferPairMeta = React.useMemo(
    () => describeFinanceTransferPair(transferFromAccount, transferToAccount),
    [transferFromAccount, transferToAccount],
  );
  const sheetDateLabel = `${selectedHappenedAt.getMonth() + 1}月${selectedHappenedAt.getDate()}日`;
  const sheetTimeLabel = `${String(selectedHappenedAt.getHours()).padStart(2, '0')}:${String(selectedHappenedAt.getMinutes()).padStart(2, '0')}`;
  const hasAccounts = financeAccounts.length > 0;
  const amountNumber = Number(sheetAmount);
  const transferFeeNumber = transferFeeAmount === '' ? 0 : Number(transferFeeAmount);
  const transferFeeValid =
    transferFeeAmount === '' ||
    (Number.isFinite(transferFeeNumber) &&
      transferFeeNumber >= 0 &&
      (!Number.isFinite(amountNumber) || transferFeeNumber < amountNumber));
  const canSaveTransaction =
    Number.isFinite(amountNumber) &&
    amountNumber > 0 &&
    transferFeeValid &&
    !isSavingTransaction &&
    (activeSheetTab === 'transfer' ? transferSaveReady : Boolean(selectedAccount));
  const canSaveSentence =
    Boolean(selectedAccount) &&
    sheetSentence.trim().length > 0 &&
    !isSavingTransaction &&
    !isParsingSentence &&
    !isSentencePreviewBusy;
  const amountDisplay = sheetAmount ? Number(sheetAmount).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00';
  const transferFeeDisplay = transferFeeAmount
    ? Number(transferFeeAmount).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '0.00';

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

  const resetAlbumScanState = React.useCallback(() => {
    albumScanGenerationRef.current += 1;
    setAlbumScanPhase('off');
    setAlbumImageUri(null);
    setAlbumScanError(null);
    setAlbumScanResult(null);
    setAlbumParsePayload(null);
    setAlbumConfirming(false);
  }, []);

  const resetSheetForm = React.useCallback((nextTab: SheetTab = 'sentence', opts?: { preserveBudget?: boolean }) => {
    setActiveSheetTab(nextTab);
    setSheetAmount('');
    setTransferFeeAmount('');
    setTransferAmountTarget('amount');
    setSheetSentence('');
    setSheetNote('');
    setSheetImageUris([]);
    if (!opts?.preserveBudget) {
      applySheetIncludeInBudget(true);
    }
    setSelectedHappenedAt(new Date());
    setIsDatePickerVisible(false);
    setIsTimePickerVisible(false);
    setIsAccountPickerVisible(false);
    setAccountPickerTarget('sheet');
    setSelectedCategoryKey(nextTab === 'income' ? 'salary' : 'food');
    setSentenceLedgerPreview(null);
    setIsSentencePreviewBusy(false);
    resetAlbumScanState();
    const list = financeAccountsRef.current;
    if (list.length > 0) {
      setSelectedAccountId(getDefaultSheetAccountIdForTab(nextTab, list));
    }
  }, [applySheetIncludeInBudget, getDefaultSheetAccountIdForTab, resetAlbumScanState]);

  const switchSheetTab = React.useCallback(
    (nextTab: SheetTab) => {
      if (activeSheetTab === nextTab) return;
      resetSheetForm(nextTab, { preserveBudget: true });
    },
    [activeSheetTab, resetSheetForm],
  );

  const applyManualOrTransferSheetIntent = React.useCallback(
    (intent: FinanceSheetLaunchIntent) => {
      const list = financeAccountsRef.current;
      if (intent.kind === 'auto_ledger_clipboard_pending' || intent.kind === 'auto_ledger_clipboard_image') {
        return;
      }
      if (!list.length) {
        toast.warn('当前还没有可用账户，请先前往资产页添加账户后再记账。');
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
      const resolved = resolveTransferLaunchAccounts(list, {
        fromAccountId: intent.fromAccountId,
        toAccountId: intent.toAccountId,
      });
      if (!resolved) {
        toast.warn('至少需要两个账户才能进行转账或还款。');
        return;
      }
      resetSheetForm('transfer');
      setTransferFromAccountId(resolved.fromId);
      setTransferToAccountId(resolved.toId);
      setIsSheetVisible(true);
    },
    [getDefaultSheetAccountIdForTab, resetSheetForm],
  );

  const reload = React.useCallback(async (forceRefresh = false) => {
    const generation = ++financeReloadGenerationRef.current;
    const isStale = () => generation !== financeReloadGenerationRef.current;

    return wrapLoad(async () => {
      try {
        const settings = await loadMonthBudgetSettings();
        if (isStale()) return;
        setMonthBudgetSettings(settings);
        const rd = await loadBudgetRefreshDay();
        if (isStale()) return;
        setBudgetRefreshDay(rd);
        await loadFinanceLastUsedAccountId();
        if (isStale()) return;

        // 未同步或强制刷新：走 home；已有列表时本地重读（含刚记账的 pending）
        if (forceRefresh || !financeTransactionsRef.current.length) {
          const home = await fetchFinanceHome({
            logicalToday: calendarTodayYmd,
            dayBoundaryHour: financeDayBoundary.hour,
            dayBoundaryMinute: financeDayBoundary.minute,
            historyDays: INITIAL_HISTORY_DAY_SLICES,
            daysBack: 90,
            budgetRefreshDay: rd,
            serverFallback: true,
            forceRefresh,
          });
          if (isStale()) return;
          flowCategoryNamesRef.current = Object.fromEntries(
            home.categories.map((c) => [c.id, c.name]),
          );
          financeTransactionsRef.current = home.transactions;
          setFinanceTransactions(home.transactions);
          setServerMonthly(home.fromApi && home.monthly ? home.monthly : null);
          // 首页账户一律再走本地规范化（负债类型/余额），避免直接使用 API 原始行漏计总负债
          const normalizedAccounts = await getFinanceAccountsWithBalance({ cacheOnly: true });
          if (isStale()) return;
          financeAccountsRef.current = normalizedAccounts;
          setFinanceAccounts(normalizedAccounts);
          setHistoryHasMoreRemote(home.historyHasMore);
          setVisibleDayCount(INITIAL_HISTORY_DAY_SLICES);
        } else {
          setServerMonthly(null);
          await Promise.all([loadFinanceTransactions(), loadFinanceAccounts()]);
          if (isStale()) return;
        }

        const [scheduled, savingsGoal] = await Promise.all([
          loadScheduledFinanceExpenses(),
          loadFinanceSavingsGoal(),
        ]);
        if (isStale()) return;
        setScheduledExpenses(scheduled);
        setSavingsGoalTargetDate(savingsGoal?.targetDate ?? null);
      } catch (e) {
        console.warn('Finance tab refresh failed:', e);
        throw e;
      }
    }, forceRefresh);
  }, [
    calendarTodayYmd,
    financeDayBoundary.hour,
    financeDayBoundary.minute,
    loadFinanceAccounts,
    loadFinanceTransactions,
    wrapLoad,
  ]);

  const reloadPage = React.useCallback(async (forceRefresh = false) => {
    try {
      const result = await reload(forceRefresh);
      if (!result.ok || result.restFailed) {
        setInitialFinanceLoadPending(false);
        return;
      }
      setInitialFinanceLoadPending(false);
    } catch {
      setInitialFinanceLoadPending(false);
    }
  }, [reload]);

  usePageFocusReload(PAGE_API_KEY, reloadPage, { observeLocal: false });
  useLocalQuery(LOCAL_TABLES, () => {
    void reloadPage(false);
  });

  useFocusEffect(
    React.useCallback(() => {
      if (isSheetVisible) return;
      setSelectedHappenedAt((prev) => {
        const ymd = getLogicalLocalYmd(prev, financeDayBoundary);
        if (ymd < calendarTodayYmd) return new Date();
        return prev;
      });
    }, [isSheetVisible, calendarTodayYmd, financeDayBoundary]),
  );

  useFocusEffect(
    React.useCallback(() => {
      scheduleRunScheduledFinanceExpenses('finance-tab-focus');
      // 从「定时支出」返回时重读，避免预扣栏仍用旧列表
      void loadScheduledFinanceExpenses().then(setScheduledExpenses);

      let cancelled = false;
      void (async () => {
        try {
          const pendingIntent = peekFinanceSheetLaunchIntent();
          const isAutoLedgerIntent =
            pendingIntent?.kind === 'auto_ledger_clipboard_pending' ||
            pendingIntent?.kind === 'auto_ledger_clipboard_image';
          const intent = isAutoLedgerIntent ? null : consumeFinanceSheetLaunchIntent();
          if (!intent) return;

          await reloadFinanceAccounts();
          if (cancelled) return;

          const list = financeAccountsRef.current;
          if (list.length > 0) {
            applyManualOrTransferSheetIntent(intent);
          }
        } catch (e) {
          console.warn('Finance tab sheet intent failed:', e);
        }
      })();

      return () => {
        cancelled = true;
      };
    }, [applyManualOrTransferSheetIntent, reloadFinanceAccounts]),
  );

  const { refreshControl } = usePagePullRefresh(PAGE_API_KEY, reloadPage);

  const closeSheet = React.useCallback(() => {
    if (isSavingTransaction || isParsingSentence || isSentencePreviewBusy || albumConfirming) return;
    setIsDatePickerVisible(false);
    setIsTimePickerVisible(false);
    setIsAccountPickerVisible(false);
    setAccountPickerTarget('sheet');
    resetAlbumScanState();
    setIsSheetVisible(false);
  }, [albumConfirming, isParsingSentence, isSavingTransaction, isSentencePreviewBusy, resetAlbumScanState]);

  const closeBudgetAdjust = React.useCallback(() => {
    setIsBudgetAdjustVisible(false);
  }, []);

  const openBudgetAdjust = React.useCallback(() => {
    const row = monthBudgetSettings[currentMonthKey];
    const base = row ? row.baseAmount : 0;
    const inc = row?.includeLastBalance ?? false;
    const gross = inc ? base + lastMonthRemaining : base;
    const totalWithIncome = Math.max(0, gross - scheduledBudgetDeduction + monthlyBudgetIncome);
    const autoSurplus = totalWithIncome - monthlyBudgetExpense;
    setBudgetBaseDraft(base.toFixed(2));
    setPeriodSurplusDraft(autoSurplus.toFixed(2));
    setPeriodSurplusLoadedFromBudget(autoSurplus);
    setModalIncludeLast(inc);
    setBudgetRefreshDayDraft(budgetRefreshDay);
    setIsBudgetAdjustVisible(true);
  }, [
    budgetRefreshDay,
    currentMonthKey,
    lastMonthRemaining,
    monthBudgetSettings,
    monthlyBudgetExpense,
    monthlyBudgetIncome,
    scheduledBudgetDeduction,
  ]);

  const handleSaveBudgetAdjust = React.useCallback(() => {
    const normalized = budgetBaseDraft.trim().replace(/,/g, '');
    const n = parseFloat(normalized);
    if (!Number.isFinite(n) || n < 0) {
      toast.warn('请输入大于等于 0 的月预算基数。');
      return;
    }
    const surplusNormalized = periodSurplusDraft.trim().replace(/,/g, '');
    const surplusN = parseFloat(surplusNormalized);
    if (!Number.isFinite(surplusN)) {
      toast.warn('请输入有效的本周期预算结余。');
      return;
    }
    const previewGross = modalIncludeLast ? n + lastMonthRemaining : n;
    const previewTotal = Math.max(0, previewGross - scheduledBudgetDeduction + monthlyBudgetIncome);
    const autoSurplus = previewTotal - monthlyBudgetExpense;
    const surplusDelta = surplusN - autoSurplus;
    const adjustedBase = Math.max(0, n + surplusDelta);
    const nextRefresh = clampBudgetRefreshDay(budgetRefreshDayDraft);
    markPageDirty();
    void persistBudgetRefreshDay(nextRefresh);
    setBudgetRefreshDay(nextRefresh);
    setMonthBudgetSettings((prev) => {
      const next = {
        ...prev,
        [currentMonthKey]: {
          baseAmount: adjustedBase,
          includeLastBalance: modalIncludeLast,
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
    lastMonthRemaining,
    markPageDirty,
    modalIncludeLast,
    monthlyBudgetExpense,
    monthlyBudgetIncome,
    periodSurplusDraft,
    scheduledBudgetDeduction,
  ]);

  const handleResetBudgetAdjust = React.useCallback(() => {
    markPageDirty();
    setMonthBudgetSettings((prev) => {
      if (!(currentMonthKey in prev)) return prev;
      const next = { ...prev };
      delete next[currentMonthKey];
      void persistMonthBudgetSettings(next);
      return next;
    });
    setIsBudgetAdjustVisible(false);
  }, [currentMonthKey, markPageDirty]);

  /** 滑杆目标为「展示用预算总额」，折算回月预算基数草稿 */
  const handleBudgetSliderChange = React.useCallback(
    (targetTotal: number) => {
      const gross = targetTotal + scheduledBudgetDeduction - monthlyBudgetIncome;
      const base = Math.max(0, gross - (modalIncludeLast ? lastMonthRemaining : 0));
      setBudgetBaseDraft(base.toFixed(2));
      const previewGross = modalIncludeLast ? base + lastMonthRemaining : base;
      const previewTotal = Math.max(0, previewGross - scheduledBudgetDeduction + monthlyBudgetIncome);
      const autoSurplus = previewTotal - monthlyBudgetExpense;
      setPeriodSurplusDraft(autoSurplus.toFixed(2));
      setPeriodSurplusLoadedFromBudget(autoSurplus);
    },
    [
      lastMonthRemaining,
      modalIncludeLast,
      monthlyBudgetExpense,
      monthlyBudgetIncome,
      scheduledBudgetDeduction,
    ],
  );

  const budgetAdjustAiHint = React.useMemo(() => {
    const surplus = Number.isFinite(parsedPeriodSurplusDraft)
      ? parsedPeriodSurplusDraft
      : autoPeriodSurplusPreview;
    const surplusText = formatCurrencyWithDecimals(surplus);
    if (surplus >= 0) {
      return `按目前节奏，${budgetUiScopeShort}预计结余 ${surplusText} · 今日可用约 ${formatCurrencyWithDecimals(todayAvailableAmount)}`;
    }
    return `按目前节奏，${budgetUiScopeShort}预计超支 ${formatCurrencyWithDecimals(Math.abs(surplus))} · 建议下调支出或上调预算`;
  }, [
    autoPeriodSurplusPreview,
    budgetUiScopeShort,
    formatCurrencyWithDecimals,
    parsedPeriodSurplusDraft,
    todayAvailableAmount,
  ]);

  const handleSelectAccount = React.useCallback(
    (accountId: string) => {
      if (accountPickerTarget === 'transferFrom') {
        if (accountId === transferToAccountId) {
          toast.warn(
            financeAccounts.length < 2
              ? '请先添加至少两个资产账户后再进行转账。'
              : '转出账户与入账账户不能相同，请选择其他账户。',
          );
          return;
        }
        setTransferFromAccountId(accountId);
      } else if (accountPickerTarget === 'transferTo') {
        if (accountId === transferFromAccountId) {
          toast.warn(
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

  const applyAmountKeyToValue = React.useCallback((prev: string, key: string): string => {
    if (key === 'backspace') return prev.slice(0, -1);
    if (key === 'done' || key === 'check') return prev;
    if (key === '+' || key === '-') return prev;
    if (key === '.') return prev.includes('.') ? prev : `${prev || '0'}.`;
    const next = `${prev}${key}`;
    const normalized = next.replace(/^0+(?=\d)/, '');
    const [, decimals = ''] = normalized.split('.');
    if (decimals.length > 2) return prev;
    if (Number(normalized) > 99999999.99) return prev;
    return normalized;
  }, []);

  const handleAmountKeyPress = React.useCallback(
    (key: string) => {
      if (activeSheetTab === 'transfer' && transferAmountTarget === 'fee') {
        setTransferFeeAmount((prev) => applyAmountKeyToValue(prev, key));
        return;
      }
      setSheetAmount((prev) => applyAmountKeyToValue(prev, key));
    },
    [activeSheetTab, applyAmountKeyToValue, transferAmountTarget],
  );

  const handleSentenceLedgerPreview = React.useCallback(async () => {
    if (!selectedAccount) {
      toast.warn('需要选择一个可用账户后再做识别预览。');
      return;
    }
    const line = sheetSentence.trim();
    if (!line) {
      toast.warn('用一句话描述这笔账。');
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
    if (isSavingTransaction || isParsingSentence) return;
    markPageDirty();
    // 先作废 in-flight home，再落库，避免保存过程中慢响应清空明细
    financeReloadGenerationRef.current += 1;
    if (activeSheetTab === 'transfer') {
      if (!transferFromAccount || !transferToAccount) {
        toast.warn('需要选择扣款账户与入账账户。');
        return;
      }
      if (transferFromAccount.id === transferToAccount.id) {
        toast.warn('扣款与入账账户不能是同一个。');
        return;
      }
      if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
        toast.warn('转账金额需要大于 0。');
        return;
      }
      const feeAbs =
        transferFeeAmount.trim() === ''
          ? 0
          : Number.isFinite(transferFeeNumber) && transferFeeNumber > 0
            ? transferFeeNumber
            : 0;
      if (transferFeeAmount.trim() !== '' && (!Number.isFinite(transferFeeNumber) || transferFeeNumber < 0)) {
        toast.warn('手续费需为大于等于 0 的数字，留空表示无手续费。');
        return;
      }
      if (feeAbs >= amountNumber) {
        toast.warn('手续费必须小于转账金额（从转账金额中扣除）。');
        return;
      }
      const ts = Date.now();
      const rnd = Math.random().toString(16).slice(2);
      const groupId = `tg_${ts}_${rnd}`;
      const idOut = `ft_${ts}_out_${rnd}`;
      const idIn = `ft_${ts}_in_${rnd}`;
      const happenedAt = formatFinanceHappenedAt(selectedHappenedAt);
      const absAmount = amountNumber;
      const netAmount = absAmount - feeAbs;
      const noteTrim = sheetNote.trim() || null;
      const fromName = transferFromAccount.name;
      const toName = transferToAccount.name;

      const extraOut = buildFinanceTransferTxnExtra({
        groupId,
        leg: 'out',
        counterpartyAccountId: transferToAccount.id,
        counterpartyAccountName: toName,
      });
      const extraIn = buildFinanceTransferTxnExtra({
        groupId,
        leg: 'in',
        counterpartyAccountId: transferFromAccount.id,
        counterpartyAccountName: fromName,
      });
      const errFrom = await validateFinanceTransactionBeforeSave({
        accountId: transferFromAccount.id,
        transactionType: 'transfer',
        amount: netAmount,
        extraData: extraOut,
        accountName: transferFromAccount.name,
        uiLedgerBalance: transferFromAccount.balance,
      });
      const errTo = await validateFinanceTransactionBeforeSave({
        accountId: transferToAccount.id,
        transactionType: 'transfer',
        amount: netAmount,
        extraData: extraIn,
        accountName: transferToAccount.name,
        uiLedgerBalance: transferToAccount.balance,
      });
      let errFee: string | null = null;
      if (feeAbs > 0) {
        errFee = await validateFinanceTransactionBeforeSave({
          accountId: transferFromAccount.id,
          transactionType: 'expense',
          amount: feeAbs,
          accountName: transferFromAccount.name,
          uiLedgerBalance: transferFromAccount.balance - netAmount,
        });
      }
      if (errFrom || errTo || errFee) {
        toast.warn(errFrom ?? errTo ?? errFee ?? '转出或转入后账户余额不符合类型约束。');
        return;
      }

      try {
        setIsSavingTransaction(true);
        await createFinanceTransferTransactions({
          idOut,
          idIn,
          ...(feeAbs > 0 ? { idFee: `ft_${ts}_fee_${rnd}`, feeAmount: feeAbs } : {}),
          groupId,
          fromAccountId: transferFromAccount.id,
          toAccountId: transferToAccount.id,
          fromAccountName: fromName,
          toAccountName: toName,
          amount: absAmount,
          happenedAt,
          note: noteTrim,
        });
        setIsSheetVisible(false);
        resetSheetForm('sentence');
        notifyFinanceSheetSaved();
        toast.success('已记账');
      } catch (error) {
        console.warn('Failed to create transfer transactions:', error);
        toast.error(toUserMessage(error, '转账记录保存失败，请稍后重试。'));
      } finally {
        setIsSavingTransaction(false);
      }
      return;
    }

    if (!selectedAccount) {
      toast.warn('需要选择一个可用账户后才能记账。');
      return;
    }

    if (activeSheetTab === 'sentence') {
      const line = sheetSentence.trim();
      if (!line) {
        toast.warn('用一句话描述这笔账，需包含金额。');
        return;
      }

      const happenedAtIso = formatFinanceHappenedAt(selectedHappenedAt);
      const includeInBudget = sheetIncludeInBudgetRef.current;
      const manualAccount = selectedAccount;

      setIsParsingSentence(true);
      try {
        const resolved = await resolveFinanceSentenceLine(line);
        if (!resolved.ok) {
          toast.warn(resolved.error);
          return;
        }
        const parsed = resolved.parsed;
        const lastUsedAccountId = sanitizeFinanceLastUsedAccountId(
          getCachedFinanceLastUsedAccountId(),
          financeAccountsRef.current,
        );
        const account = manualAccount;
        const aiSuggestedAccount =
          resolved.source === 'ai'
            ? pickAccountForAutoLedger(financeAccountsRef.current, parsed, lastUsedAccountId)
            : null;
        if (!account) {
          toast.warn('需要选择一个可用账户后才能记账。');
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
        const signedAmount = financeSignedAmountForSave(account.sign_rule, account.account_type, amountAbs);
        const boundsErr = await validateFinanceTransactionBeforeSave({
          accountId: account.id,
          transactionType,
          amount: signedAmount,
          extraData: null,
          accountName: account.name,
          uiLedgerBalance: account.balance,
        });
        if (boundsErr) {
          toast.warn(boundsErr);
          return;
        }

        const txnId = makeTimestampEntityId('ft_', 8);
        await createFinanceTransaction(
          {
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
              ...(aiSuggestedAccount && aiSuggestedAccount.id !== account.id
                ? { ai_suggested_account_id: aiSuggestedAccount.id, ai_suggested_account_name: aiSuggestedAccount.name }
                : {}),
              ...budgetExtraPatchForTransaction(transactionType, includeInBudget),
            }),
          },
          { skipBalanceRecheck: true },
        );
        setIsSheetVisible(false);
        resetSheetForm('sentence');
        notifyFinanceSheetSaved();
        toast.success('已记账');
      } catch (error) {
        console.warn('Sentence ledger pipeline failed:', error);
        toast.error(toUserMessage(error, '一句话记账处理失败，请稍后重试。'));
      } finally {
        setIsParsingSentence(false);
      }
      return;
    }

    if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
      toast.warn('记账金额需要大于 0。');
      return;
    }
    const transactionType = activeSheetTab;
    const signedAmount = financeSignedAmountForSave(
      selectedAccount.sign_rule,
      selectedAccount.account_type,
      amountNumber,
    );
    const manualBoundsErr = await validateFinanceTransactionBeforeSave({
      accountId: selectedAccount.id,
      transactionType,
      amount: signedAmount,
      extraData: null,
      accountName: selectedAccount.name,
      uiLedgerBalance: selectedAccount.balance,
    });
    if (manualBoundsErr) {
      toast.warn(manualBoundsErr);
      return;
    }
    const fallbackName = transactionType === 'income' ? '收入' : '支出';
    const title = sheetNote.trim() || selectedCategory?.label || fallbackName;

    try {
      setIsSavingTransaction(true);
      const txnId = makeTimestampEntityId('ft_', 8);
      await createFinanceTransaction(
        {
          id: txnId,
          name: title,
          happened_at: formatFinanceHappenedAt(selectedHappenedAt),
          account_id: selectedAccount.id,
          transaction_type: transactionType,
          amount: signedAmount,
          note: sheetNote.trim() || null,
          extra_data: JSON.stringify({
            manual: true,
            category_key: selectedCategory?.key ?? null,
            category_label: selectedCategory?.label ?? null,
            attachments: sheetImageUris.length ? sheetImageUris.map((uri) => ({ type: 'image', uri })) : null,
            ...budgetExtraPatchForTransaction(transactionType, sheetIncludeInBudgetRef.current),
          }),
        },
        { skipBalanceRecheck: true },
      );
      setIsSheetVisible(false);
      resetSheetForm('sentence');
      notifyFinanceSheetSaved();
      toast.success('已记账');
    } catch (error) {
      console.warn('Failed to create finance transaction:', error);
      toast.error(toUserMessage(error, '手动记账保存失败，请稍后重试。'));
    } finally {
      setIsSavingTransaction(false);
    }
  }, [
    activeSheetTab,
    amountNumber,
    expenseCategories,
    incomeCategories,
    isParsingSentence,
    isSavingTransaction,
    loadFinanceAccounts,
    loadFinanceTransactions,
    markPageDirty,
    pickAccountForAutoLedger,
    resetSheetForm,
    resolveFinanceSentenceLine,
    selectedAccount,
    selectedCategory,
    selectedHappenedAt,
    sheetImageUris,
    sheetNote,
    sheetSentence,
    transferFeeAmount,
    transferFeeNumber,
    transferFromAccount,
    transferToAccount,
  ]);

  const handleOpenComposer = React.useCallback((): boolean => {
    if (!hasAccounts) {
      toast.warn('当前还没有可用账户，请先前往资产页添加账户后再记账。');
      return false;
    }
    // 仅在弹窗未打开时重置表单；避免用户已输入金额/备注后点图片又被清空
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

      const accounts = financeAccountsRef.current;
      if (!accounts.length) {
        toast.warn('当前还没有可用账户，请先前往资产页添加账户后再记账。');
        return;
      }

      setIsPickingImage(true);
      try {
        const pickerOptions = {
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          allowsEditing: false,
          quality: 0.85,
          base64: true,
        } as const;

        let result: ImagePicker.ImagePickerResult;
        if (source === 'library') {
          const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (!permission.granted) {
            toast.warn('需要相册权限才能选择图片。');
            return;
          }
          result = await ImagePicker.launchImageLibraryAsync(pickerOptions);
        } else {
          const permission = await ImagePicker.requestCameraPermissionsAsync();
          if (!permission.granted) {
            toast.warn('需要相机权限才能拍摄图片。');
            return;
          }
          result = await ImagePicker.launchCameraAsync(pickerOptions);
        }

        if (result.canceled) return;

        const asset = result.assets[0];
        const b64 = asset?.base64;
        if (!b64) {
          toast.error('未能获取图片数据，请换一张图片重试。');
          return;
        }

        const mime = asset.mimeType?.trim() || 'image/jpeg';
        const imageDataUri = `data:${mime};base64,${b64}`;

        setAutoLedgerToastMessage(
          source === 'camera' ? '正在识别拍摄图片并记账…' : '正在识别相册图片并记账…',
        );
        setAutoLedgerToastVisible(true);
        await runInAutoLedgerSession(() =>
          processAutoLedgerFromImage(imageDataUri, accounts, 'picker'),
        );
      } catch (error) {
        console.warn('Failed to pick image for auto ledger:', error);
        toast.error('选择图片失败，请稍后重试。');
      } finally {
        setIsPickingImage(false);
        setAutoLedgerToastVisible(false);
      }
    },
    [isPickingImage, processAutoLedgerFromImage],
  );

  /** 弹层内相册识图：预览确认，不走静默 processAutoLedgerFromImage */
  const openAlbumScanFlow = React.useCallback(async () => {
    if (isPickingImage || albumConfirming || albumScanPhase === 'scanning') return;

    const accounts = financeAccountsRef.current;
    if (!accounts.length) {
      toast.warn('当前还没有可用账户，请先前往资产页添加账户后再记账。');
      return;
    }

    if (!isSheetVisible) {
      resetSheetForm('sentence');
      setIsSheetVisible(true);
    }

    const gen = ++albumScanGenerationRef.current;
    const isStale = () => gen !== albumScanGenerationRef.current;

    setIsDatePickerVisible(false);
    setIsTimePickerVisible(false);
    setIsAccountPickerVisible(false);
    setIsPickingImage(true);

    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (isStale()) return;
      if (!permission.granted) {
        toast.warn('需要相册权限才能选择图片。');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 0.85,
        base64: true,
      });

      if (isStale()) return;
      if (result.canceled) return;

      const asset = result.assets[0];
      const b64 = asset?.base64;
      if (!b64) {
        toast.error('未能获取图片数据，请换一张图片重试。');
        return;
      }

      const mime = asset.mimeType?.trim() || 'image/jpeg';
      const imageDataUri = `data:${mime};base64,${b64}`;
      setAlbumScanError(null);
      setAlbumScanResult(null);
      setAlbumParsePayload(null);
      setAlbumImageUri(imageDataUri);
      setAlbumScanPhase('scanning');

      const key = getActiveAiLlmApiKey().trim();
      if (!key) {
        setAlbumScanPhase('error');
        setAlbumScanError('未配置 AI 密钥，无法识图。');
        return;
      }

      const accountHints = accounts.map((a) => ({ name: a.name, account_no: a.account_no }));
      const resolved = await parseFinanceOneLinerFromImage({
        apiKey: key,
        imageDataUri,
        accounts: accountHints,
        maxAttempts: 2,
        retryDelayMs: 800,
      });

      if (isStale()) return;

      if (!resolved.ok) {
        setAlbumScanPhase('error');
        setAlbumScanError(
          resolved.notBill ? AUTO_LEDGER_NOT_BILL_MESSAGE : resolved.error || '未能识别出有效账单。',
        );
        return;
      }

      const lastUsedAccountId = sanitizeFinanceLastUsedAccountId(
        getCachedFinanceLastUsedAccountId(),
        accounts,
      );
      const account = pickAccountForAutoLedger(
        accounts,
        {
          transaction_type: resolved.transaction_type,
          account_name: resolved.account_name,
          payment_account_label: resolved.payment_account_label,
        },
        lastUsedAccountId,
      );
      if (!account) {
        setAlbumScanPhase('error');
        setAlbumScanError('请先添加至少一个账户。');
        return;
      }

      const cat = pickSheetCategoryForParsed(
        resolved.transaction_type,
        resolved.category_label,
        expenseCategories,
        incomeCategories,
      );
      const { iso: happenedAtIso } = resolveHappenedAtForBillLedger(resolved.happened_at);
      const happenedAtDate = parseStoredDatetime(happenedAtIso) ?? new Date();
      const happenedLabel = formatAlbumHappenedLabel(happenedAtDate);

      const scanResult: FinanceAlbumScanResult = {
        transaction_type: resolved.transaction_type,
        amount: resolved.amount,
        name: resolved.name,
        categoryLabel: cat.label,
        accountName: account.name,
        happenedLabel,
        confidenceLabel: '置信度 高',
      };

      setAlbumScanResult(scanResult);
      setAlbumParsePayload({
        transaction_type: resolved.transaction_type,
        amount: resolved.amount,
        name: resolved.name,
        category_key: cat.key,
        category_label: cat.label,
        account_id: account.id,
        account_name: account.name,
        happened_at: happenedAtIso,
        imageDataUri,
      });
      setAlbumScanPhase('result');
    } catch (error) {
      if (isStale()) return;
      console.warn('Album scan flow failed:', error);
      setAlbumScanPhase('error');
      setAlbumScanError(toUserMessage(error, '识图失败，请稍后重试。'));
    } finally {
      setIsPickingImage(false);
    }
  }, [
    albumConfirming,
    albumScanPhase,
    expenseCategories,
    incomeCategories,
    isPickingImage,
    isSheetVisible,
    pickAccountForAutoLedger,
    resetAlbumScanState,
    resetSheetForm,
  ]);

  const confirmAlbumScan = React.useCallback(async () => {
    if (albumConfirming || !albumParsePayload) return;
    const payload = albumParsePayload;
    const account = financeAccountsRef.current.find((a) => a.id === payload.account_id);
    if (!account) {
      toast.warn('账户已失效，请重新识图或手动记账。');
      return;
    }

    const signedAmount = financeSignedAmountForSave(account.sign_rule, account.account_type, payload.amount);
    const boundsErr = await validateFinanceTransactionBeforeSave({
      accountId: account.id,
      transactionType: payload.transaction_type,
      amount: signedAmount,
      extraData: null,
      accountName: account.name,
      uiLedgerBalance: account.balance,
    });
    if (boundsErr) {
      toast.warn(boundsErr);
      return;
    }

    setAlbumConfirming(true);
    markPageDirty();
    financeReloadGenerationRef.current += 1;
    try {
      const txnId = makeTimestampEntityId('ft_', 8);
      await createFinanceTransaction(
        {
          id: txnId,
          name: payload.name,
          happened_at: payload.happened_at,
          account_id: account.id,
          transaction_type: payload.transaction_type,
          amount: signedAmount,
          note: `图片记账 · ${payload.name}`,
          extra_data: JSON.stringify({
            manual: true,
            sentence: true,
            parse_source: 'ai',
            from_picker_image: true,
            from_album_scan_sheet: true,
            category_key: payload.category_key,
            category_label: payload.category_label,
            matched_account_name: payload.account_name,
            attachments: [{ type: 'image', uri: payload.imageDataUri }],
            ...budgetExtraPatchForTransaction(payload.transaction_type, sheetIncludeInBudgetRef.current),
          }),
        },
        { skipBalanceRecheck: true },
      );
      await Promise.all([reloadFinanceTransactions(), reloadFinanceAccounts()]);
      resetAlbumScanState();
      setIsSheetVisible(false);
      resetSheetForm('sentence');
      notifyFinanceSheetSaved();
      toast.success('已记账');
    } catch (error) {
      console.warn('Confirm album scan failed:', error);
      toast.error(toUserMessage(error, '入账失败，请稍后重试。'));
    } finally {
      setAlbumConfirming(false);
    }
  }, [
    albumConfirming,
    albumParsePayload,
    markPageDirty,
    reloadFinanceAccounts,
    reloadFinanceTransactions,
    resetAlbumScanState,
    resetSheetForm,
  ]);

  const applyAlbumScanToForm = React.useCallback(() => {
    if (!albumParsePayload) {
      resetAlbumScanState();
      return;
    }
    const p = albumParsePayload;
    setActiveSheetTab(p.transaction_type);
    setSheetAmount(String(p.amount));
    setSheetSentence(`${p.name} ${p.amount}`);
    setSheetNote(p.name);
    setSelectedCategoryKey(p.category_key);
    setSelectedAccountId(p.account_id);
    setSelectedHappenedAt(parseStoredDatetime(p.happened_at) ?? new Date());
    setSheetImageUris([p.imageDataUri]);
    setSentenceLedgerPreview(null);
    setAlbumScanPhase('off');
    setAlbumScanError(null);
    setAlbumScanResult(null);
    setAlbumParsePayload(null);
    setAlbumConfirming(false);
  }, [albumParsePayload, resetAlbumScanState]);

  const sentenceFoldPills = React.useMemo((): FinanceFoldParsePill[] => {
    if (sentenceLedgerPreview?.kind !== 'ok') return [];
    const typeLabel = sentenceLedgerPreview.transaction_type === 'income' ? '收入' : '支出';
    const pills: FinanceFoldParsePill[] = [
      {
        key: 'amt',
        label: `${typeLabel} ¥${sentenceLedgerPreview.amount.toFixed(2)}`,
        emphasize: true,
      },
      { key: 'cat', label: sentenceLedgerPreview.categoryLabel },
    ];
    if (selectedAccount?.name) {
      pills.push({ key: 'acc', label: selectedAccount.name, amber: true });
    }
    pills.push({ key: 'time', label: formatAlbumHappenedLabel(selectedHappenedAt) });
    return pills;
  }, [selectedAccount?.name, selectedHappenedAt, sentenceLedgerPreview]);

  const sentenceAiLine = React.useMemo(() => {
    if (sentenceLedgerPreview?.kind === 'error') return sentenceLedgerPreview.message;
    if (sentenceLedgerPreview?.kind === 'ok') {
      return sentenceLedgerPreview.source === 'ai'
        ? `智谱已识别：${sentenceLedgerPreview.name}`
        : `本地规则：${sentenceLedgerPreview.name}`;
    }
    return zhipuTxnReady
      ? '说一句日常消费，AI 会帮你拆成金额、分类与账户'
      : '未检测到 AI：仅本地规则（需句中含阿拉伯数字金额）';
  }, [sentenceLedgerPreview, zhipuTxnReady]);

  const foldTransferLabel =
    transferPairMeta.mode === 'repay'
      ? '还款'
      : transferPairMeta.mode === 'draw'
        ? '取款'
        : '转账';

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: bg }]} edges={['left', 'right']}>
      <ScrollView
        refreshControl={refreshControl}
        stickyHeaderIndices={[0]}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: scrollContentBottom },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        scrollEnabled={!netTrendScrubbing}
        scrollEventThrottle={16}
        onScroll={handleMainScroll}>
        <View
          style={[
            styles.header,
            {
              backgroundColor: headerScrim,
              borderBottomColor: outlineVariant,
              paddingTop: insets.top,
            },
          ]}
          collapsable={false}>
          <View style={styles.headerInnerFold}>
            <View style={styles.headerFoldText}>
              <Text
                style={[styles.headerTitleFold, { color: text, fontFamily: ffFonts.serif }]}
                numberOfLines={1}>
                {headerDateLabel}
              </Text>
              <Text style={[styles.headerSubFold, { color: subtle }]} numberOfLines={1}>
                {headerSubLabel}
              </Text>
            </View>
            <View style={styles.headerFoldActions}>
              <Pressable
                onPress={() => router.push('/finance-calendar')}
                style={({ pressed }) => [
                  styles.foldIconBtn,
                  { borderColor: outlineVariant, backgroundColor: surface },
                  pressed && { opacity: 0.85, transform: [{ scale: 0.94 }] },
                ]}
                accessibilityRole="button"
                accessibilityLabel="财务日历">
                <MaterialIcons name="calendar-today" size={16} color={ff.ink2} />
              </Pressable>
              <Pressable
                onPress={() => {
                  markPageDirty();
                  void reloadPage();
                  toast.success('已同步');
                }}
                style={({ pressed }) => [
                  styles.foldIconBtn,
                  { borderColor: outlineVariant, backgroundColor: surface },
                  pressed && { opacity: 0.85, transform: [{ scale: 0.94 }] },
                ]}
                accessibilityRole="button"
                accessibilityLabel="同步账户">
                <MaterialIcons name="sync" size={16} color={ff.ink2} />
              </Pressable>
            </View>
          </View>
        </View>

        <View style={styles.content}>
          <View style={styles.financeBodyStack}>
          {!initialFinanceLoadPending ? (
            <Animated.View style={{ opacity: financeContentOpacity }}>
          <View style={styles.sectionStack}>
          <FoldRiseIn animate={foldAnimate && !initialFinanceLoadPending} index={0} fromY={11}>
            <Pressable
              onPress={openBudgetAdjust}
              style={({ pressed }) => [
                styles.budgetCardFold,
                {
                  backgroundColor: ff.budgetFrom,
                  borderColor: ff.budgetBorder,
                  opacity: pressed ? 0.96 : 1,
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel="调整预算">
              <View style={styles.budgetFoldMain}>
                <View style={styles.budgetFoldLabelRow}>
                  <Text style={[styles.budgetFoldLabel, { color: ff.budgetLabel }]}>
                    {budgetUiScopeShort}预算结余
                  </Text>
                  <Pressable
                    onPress={() => setShowNetAmounts((prev) => !prev)}
                    hitSlop={8}
                    style={({ pressed }) => [
                      styles.budgetMiniEye,
                      pressed && { opacity: 0.75 },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={showNetAmounts ? '隐藏金额' : '显示金额'}>
                    <MaterialIcons
                      name={showNetAmounts ? 'visibility' : 'visibility-off'}
                      size={12}
                      color={ff.budgetLabel}
                    />
                  </Pressable>
                </View>
                <View style={styles.budgetFoldAmountRow}>
                  {showNetAmounts ? (
                    <FoldCountUpText
                      value={budgetSurplusAmount}
                      animate={foldAnimate}
                      duration={760}
                      textStyle={[
                        styles.budgetFoldAmount,
                        { color: ff.budgetAmount, fontFamily: ffFonts.mono },
                      ]}
                      formatter={(n) => formatCurrencyWithDecimals(n)}
                    />
                  ) : (
                    <Text
                      style={[
                        styles.budgetFoldAmount,
                        { color: ff.budgetAmount, fontFamily: ffFonts.mono },
                      ]}>
                      {hiddenAmountText}
                    </Text>
                  )}
                </View>
                <View style={styles.budgetFoldProgress}>
                  <View style={[styles.budgetFoldTrack, { backgroundColor: ff.budgetTrack }]}>
                    <View
                      style={[
                        styles.budgetFoldFill,
                        {
                          width: `${budgetUsedPercent}%`,
                          backgroundColor: ff.amber,
                        },
                      ]}
                    />
                  </View>
                  <View style={styles.budgetFoldFoot}>
                    <Text style={[styles.budgetFoldFootText, { color: ff.budgetFoot }]}>
                      已用{' '}
                      <Text style={{ color: ff.budgetAmountSoft, fontWeight: '700' }}>
                        {showNetAmounts ? `${Math.round(budgetUsedPercent)}%` : '--'}
                      </Text>
                      {' · '}
                      {budgetPeriodCountdownLabel}
                    </Text>
                    <Text style={[styles.budgetFoldFootText, { color: ff.budgetFoot }]}>
                      月预算{' '}
                      <Text style={{ color: ff.budgetAmountSoft, fontWeight: '700' }}>
                        {showNetAmounts
                          ? formatCurrencyWithDecimals(budgetTotalAmount)
                          : hiddenAmountText}
                      </Text>
                    </Text>
                  </View>
                </View>
              </View>
              <Pressable
                onPress={() => setIsTodayBudgetHintVisible(true)}
                style={styles.budgetFoldRingCol}
                accessibilityRole="button"
                accessibilityLabel="查看今日可用说明">
                {(() => {
                  const ringSize = 72;
                  const stroke = 5;
                  const r = (ringSize - stroke) / 2;
                  const c = 2 * Math.PI * r;
                  const usage = isTodayBudgetOver ? 1 : todayBudgetUsagePct;
                  const dash = c * usage;
                  const ringProg = isTodayBudgetOver ? ff.clay : ff.ringStroke;
                  return (
                    <>
                      <View style={{ width: ringSize, height: ringSize, alignItems: 'center', justifyContent: 'center' }}>
                        <Svg
                          width={ringSize}
                          height={ringSize}
                          viewBox={`0 0 ${ringSize} ${ringSize}`}
                          style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
                          <Circle
                            cx={ringSize / 2}
                            cy={ringSize / 2}
                            r={r}
                            stroke={ff.ringTrack}
                            strokeWidth={stroke}
                            fill="none"
                          />
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
                          <Text
                            style={[
                              styles.budgetFoldRingValue,
                              {
                                color: isTodayBudgetOver ? ff.clay : ff.budgetAmount,
                                fontFamily: ffFonts.mono,
                              },
                            ]}
                            numberOfLines={1}>
                            {showNetAmounts
                              ? formatCurrencyWithDecimals(
                                  isTodayBudgetOver ? todayBudgetOverAmount : todayAvailableAmount,
                                )
                              : hiddenAmountText}
                          </Text>
                          <Text style={[styles.budgetFoldRingLabel, { color: ff.budgetFoot }]}>
                            {isTodayBudgetOver ? '超出预算' : '今日可用'}
                          </Text>
                        </View>
                      </View>
                      <View style={styles.budgetFoldRingCap}>
                        <View style={[styles.foldDot, { backgroundColor: ff.amber }]} />
                        <Text style={{ color: ff.budgetLabel, fontSize: 10 }}>
                          今日已用{' '}
                          {showNetAmounts
                            ? formatCurrencyWithDecimals(todayBudgetExpenseTotal)
                            : hiddenAmountText}
                        </Text>
                      </View>
                    </>
                  );
                })()}
              </Pressable>
            </Pressable>
          </FoldRiseIn>

          <FoldRiseIn animate={foldAnimate && !initialFinanceLoadPending} index={1} fromY={11}>
            <FinanceSavingsGoalBlock
              currentNetWorth={netTotalForTrend}
              today={today}
              showAmounts={showNetAmounts}
              hiddenAmountText={hiddenAmountText}
              formatCurrency={formatCurrencyWithDecimals}
              isDark={isDark}
              text={text}
              subtle={subtle}
              primary={primary}
              surface={surface}
              surfaceMuted={surfaceMuted}
              primaryMuted={primaryMuted}
              danger={danger}
              secondary={secondary}
              outlineVariant={outlineVariant}
              tertiary={tertiary}
              scheduledDrainUntilTarget={scheduledWithholdingRemaining}
              scheduledBudgetDeduction={scheduledWithholdingRemaining}
              logicalTodayYmd={calendarTodayYmd}
              dayBoundaryHour={financeDayBoundary.hour}
              dayBoundaryMinute={financeDayBoundary.minute}
              onGoalChange={(g) => setSavingsGoalTargetDate(g?.targetDate ?? null)}
            />
          </FoldRiseIn>

          <FoldRiseIn animate={foldAnimate && !initialFinanceLoadPending} index={2} fromY={11}>
            <View
              style={[
                styles.netCardFold,
                { backgroundColor: surface, borderColor: outlineVariant },
              ]}>
              <View style={styles.budgetNetHeader}>
                <View style={styles.budgetNetHeaderLeft}>
                  <Text style={[styles.netLabelFold, { color: subtle }]}>净资产</Text>
                  <Pressable
                    onPress={() => setShowNetAmounts((prev) => !prev)}
                    hitSlop={8}
                    style={({ pressed }) => [
                      styles.netMiniEyeLight,
                      { backgroundColor: surfaceMuted, borderColor: outlineVariant },
                      pressed && { opacity: 0.75 },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={showNetAmounts ? '隐藏金额' : '显示金额'}>
                    <MaterialIcons
                      name={showNetAmounts ? 'visibility' : 'visibility-off'}
                      size={12}
                      color={subtle}
                    />
                  </Pressable>
                </View>
                <Pressable
                  onPress={() => router.push('/finance-stats')}
                  style={({ pressed }) => [
                    styles.trendPill,
                    {
                      borderColor: outlineVariant,
                      backgroundColor: surfaceMuted,
                    },
                    pressed && { opacity: 0.8 },
                  ]}>
                  <Text style={[styles.trendPillText, { color: subtle }]}>30 日</Text>
                  <MaterialIcons name="chevron-right" size={14} color={subtle} />
                </Pressable>
              </View>
              <Text
                style={[
                  styles.budgetNetAmount,
                  { color: primary, fontFamily: ffFonts.mono },
                ]}>
                {showNetAmounts
                  ? formatCurrencyWithDecimals(displayedNetWorthAmount)
                  : hiddenAmountText}
              </Text>
              {isSelectedNetTrendToday ? (
                <View style={styles.netBreakdownRow}>
                  <Text style={[styles.netBreakdownText, { color: subtle }]}>
                    总资产{' '}
                    {showNetAmounts
                      ? formatCurrencyWithDecimals(totalAssetsAmount)
                      : hiddenAmountText}
                  </Text>
                  <Text style={[styles.netBreakdownSep, { color: outlineVariant }]}>·</Text>
                  <Text style={[styles.netBreakdownText, { color: subtle }]}>
                    总负债{' '}
                    {showNetAmounts
                      ? formatCurrencyWithDecimals(totalLiabilitiesAbsAmount)
                      : hiddenAmountText}
                  </Text>
                </View>
              ) : (
                <Text style={[styles.trendChartDayLabel, { color: primary }]}>
                  {selectedNetTrend.label} · 净资产
                </Text>
              )}

              <View style={styles.trendChartWrap}>
                <GestureDetector gesture={netWorthTrendScrubGesture}>
                  <View
                    collapsable={false}
                    style={styles.trendChartPlot}
                    onLayout={(e) => {
                      trendChartPlotWidthRef.current = e.nativeEvent.layout.width;
                    }}
                    accessibilityRole="adjustable"
                    accessibilityLabel="净资产趋势图，点按或滑动查看不同日期"
                    accessibilityHint="在图表上点按或左右滑动以查看各日净资产">
                    <Svg
                      width="100%"
                      height={NET_WORTH_TREND_CHART_H}
                      viewBox={`0 0 ${NET_WORTH_TREND_CHART_W} ${NET_WORTH_TREND_CHART_H}`}
                      preserveAspectRatio="none"
                      pointerEvents="none"
                      style={StyleSheet.absoluteFill}>
                      {trendChartGeometry ? (
                        <>
                          <Defs>
                            <LinearGradient
                              id="netWorthTrendFill"
                              x1="0"
                              y1="0"
                              x2="0"
                              y2="1">
                              <Stop
                                offset="0"
                                stopColor={ff.sage}
                                stopOpacity={isDark ? 0.35 : 0.35}
                              />
                              <Stop offset="1" stopColor={ff.sage} stopOpacity={0} />
                            </LinearGradient>
                          </Defs>
                          <Path d={trendChartGeometry.areaD} fill="url(#netWorthTrendFill)" />
                          <Path
                            d={trendChartGeometry.pathD}
                            fill="none"
                            stroke={ff.pine3}
                            strokeWidth={1.5}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                          {selectedNetTrendChartPoint ? (
                            <Circle
                              cx={selectedNetTrendChartPoint.x}
                              cy={selectedNetTrendChartPoint.y}
                              r={3.2}
                              fill={ff.amber}
                              stroke={ff.card}
                              strokeWidth={1.5}
                            />
                          ) : null}
                        </>
                      ) : null}
                    </Svg>
                  </View>
                </GestureDetector>
              </View>

              <Pressable
                onPress={() => setBudgetCardNetExpanded((v) => !v)}
                style={[styles.netExpandFold, { borderTopColor: outlineVariant }]}
                accessibilityRole="button"
                accessibilityLabel={budgetCardNetExpanded ? '收起明细' : '展开明细'}>
                <Text style={[styles.netExpandText, { color: subtle }]}>
                  本月{' '}
                  <Text style={{ color: ff.ink2, fontWeight: '700' }}>
                    收入 {monthlyIncomeText}
                  </Text>
                  {' · '}
                  <Text style={{ color: ff.ink2, fontWeight: '700' }}>
                    支出 {monthlyExpenseText}
                  </Text>
                </Text>
                <MaterialIcons
                  name={budgetCardNetExpanded ? 'keyboard-arrow-up' : 'keyboard-arrow-down'}
                  size={16}
                  color={subtle}
                />
              </Pressable>
              {budgetCardNetExpanded ? (
                <View style={styles.netStats}>
                  <View style={[styles.netStatCol, { backgroundColor: surfaceSubtle }]}>
                    <Text style={[styles.netStatLabel, { color: subtle }]}>本月盈余</Text>
                    <Text style={[styles.netStatValue, { color: monthlySurplusColor }]}>
                      {monthlySurplusText}
                    </Text>
                  </View>
                  <View style={[styles.netStatCol, { backgroundColor: surfaceSubtle }]}>
                    <Text style={[styles.netStatLabel, { color: subtle }]}>储蓄率</Text>
                    <Text style={[styles.netStatValue, { color: text }]}>{savingRateText}</Text>
                  </View>
                </View>
              ) : null}
            </View>
          </FoldRiseIn>

          <FoldRiseIn animate={foldAnimate && !initialFinanceLoadPending} index={3} fromY={11}>
            <View style={styles.quickRow}>
              <Pressable
                onPress={() => router.push('/assets')}
                style={({ pressed }) => [
                  styles.quickBtn,
                  { backgroundColor: surface, borderColor: outlineVariant },
                  pressed && { opacity: 0.9 },
                ]}
                accessibilityRole="button"
                accessibilityLabel="资产">
                <View style={[styles.quickIcon, { backgroundColor: ff.sage2 }]}>
                  <MaterialIcons name="account-balance" size={14} color={ff.pine2} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[styles.quickTitle, { color: text }]}>资产</Text>
                  <Text style={[styles.quickSub, { color: subtle }]} numberOfLines={1}>
                    {financeAccounts.length} 个账户
                  </Text>
                </View>
              </Pressable>
              <Pressable
                onPress={() => router.push('/scheduled-expenses')}
                style={({ pressed }) => [
                  styles.quickBtn,
                  { backgroundColor: surface, borderColor: outlineVariant },
                  pressed && { opacity: 0.9 },
                ]}
                accessibilityRole="button"
                accessibilityLabel="定时支出">
                <View style={[styles.quickIcon, { backgroundColor: ff.amber2 }]}>
                  <MaterialIcons name="event-repeat" size={14} color={ff.amberInk} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[styles.quickTitle, { color: text }]}>定时支出</Text>
                  <Text style={[styles.quickSub, { color: subtle }]} numberOfLines={1}>
                    {scheduledExpenses.filter((s) => s.enabled).length} 项启用
                  </Text>
                </View>
              </Pressable>
              <Pressable
                onPress={() => router.push('/cash-flow')}
                style={({ pressed }) => [
                  styles.quickBtn,
                  { backgroundColor: surface, borderColor: outlineVariant },
                  pressed && { opacity: 0.9 },
                ]}
                accessibilityRole="button"
                accessibilityLabel="现金流">
                <View style={[styles.quickIcon, { backgroundColor: isDark ? 'rgba(100,131,140,0.22)' : '#E7EEF0' }]}>
                  <MaterialIcons name="show-chart" size={14} color={isDark ? '#9BB5BC' : '#587A83'} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[styles.quickTitle, { color: text }]}>现金流</Text>
                  <Text style={[styles.quickSub, { color: subtle }]} numberOfLines={1}>
                    自由进度
                  </Text>
                </View>
              </Pressable>
            </View>
          </FoldRiseIn>

          <FoldRiseIn animate={foldAnimate && !initialFinanceLoadPending} index={4} fromY={12}>
          <View style={styles.sectionStack}>
          <View style={styles.sectionEyebrowRow}>
            <Text style={[styles.sectionEyebrow, { color: ff.ink2 }]}>ACCOUNTS / 账户</Text>
            <Pressable onPress={() => router.push('/assets')} style={({ pressed }) => [styles.sectionLink, pressed && { opacity: 0.8 }]}>
              <Text style={[styles.sectionLinkText, { color: subtle }]}>全部</Text>
              <MaterialIcons name="chevron-right" size={14} color={subtle} />
            </Pressable>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.carousel}>
            {financeAccounts.length === 0 ? (
              <Pressable
                onPress={() => router.push('/add-account')}
                style={({ pressed }) => [
                  styles.accountCardFoldAdd,
                  { borderColor: ff.line2, backgroundColor: surface },
                  pressed && { opacity: 0.92 },
                ]}>
                <MaterialIcons name="add" size={18} color={subtle} />
                <Text style={{ color: subtle, fontSize: 11, fontWeight: '600' }}>添加账户</Text>
              </Pressable>
            ) : (
              <>
                {financeAccountsSortedByBalance.map((acc, idx) => {
                  const isLiab = isFinanceLiabilityAccount(acc);
                  const tone = isLiab ? 'warm' : idx % 3 === 1 ? 'soft' : 'pine';
                  const cardBg =
                    tone === 'warm' ? '#C88947' : tone === 'soft' ? '#E9DED0' : ff.budgetFrom;
                  const cardFg = tone === 'soft' ? '#3D473F' : ff.onPine;
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
                        styles.accountCardFold,
                        { backgroundColor: cardBg },
                        pressed && { opacity: 0.92, transform: [{ scale: 0.99 }] },
                      ]}>
                      <View style={styles.accountFoldTop}>
                        <Text style={[styles.accountFoldName, { color: cardFg }]} numberOfLines={1}>
                          {acc.account_no ? `${acc.name} · ${acc.account_no}` : acc.name}
                        </Text>
                        <MaterialIcons name={accountIcon(acc)} size={14} color={cardFg} style={{ opacity: 0.7 }} />
                      </View>
                      <Text
                        style={[
                          styles.accountFoldBal,
                          { color: cardFg, fontFamily: ffFonts.mono },
                        ]}>
                        {formatCurrencyBalanceForAccount(acc)}
                      </Text>
                      <View style={styles.accountFoldFoot}>
                        <Text style={{ color: cardFg, opacity: 0.7, fontSize: 10 }}>
                          {isLiab ? '负债' : '资产'}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
                <Pressable
                  onPress={() => router.push('/add-account')}
                  style={({ pressed }) => [
                    styles.accountCardFoldAdd,
                    { borderColor: ff.line2, backgroundColor: surface },
                    pressed && { opacity: 0.92 },
                  ]}>
                  <MaterialIcons name="add" size={18} color={subtle} />
                  <Text style={{ color: subtle, fontSize: 11, fontWeight: '600' }}>添加账户</Text>
                </Pressable>
              </>
            )}
          </ScrollView>

          <View style={styles.sectionEyebrowRow}>
            <Text style={[styles.sectionEyebrow, { color: ff.ink2 }]}>LEDGER / 今日流水</Text>
            <Text style={[styles.txnSwipeHint, { color: subtle }]}>左滑删除</Text>
          </View>
          <View style={styles.dayGroups}>
            <View style={[styles.ledgerGroup, { backgroundColor: bg }]}>
              <View style={styles.ledgerGroupH}>
                <Text style={[styles.ledgerGroupTitle, { color: ff.ink2 }]}>
                  {today.getMonth() + 1}月{today.getDate()}日 · 今天
                </Text>
                <Text style={[styles.ledgerGroupSum, { color: subtle, fontFamily: ffFonts.mono }]}>
                  支出 {formatCurrencyWithDecimals(todayExpenseTotal)}
                </Text>
              </View>
              {todayDisplayTxns.length === 0 ? (
                <View style={styles.dayGroupEmpty}>
                  <View style={[styles.emptyStateIconWrap, { backgroundColor: ff.sage2 }]}>
                    <MaterialIcons name="event-note" size={18} color={subtle} />
                  </View>
                  <Text style={[styles.emptyStateTitle, { color: text }]}>今天暂无记录</Text>
                  <Text style={[styles.emptyStateSubTitle, { color: subtle }]}>
                    点右下角记一笔，开始第一笔
                  </Text>
                </View>
              ) : (
                todayDisplayTxns.map((t, index) => {
                  const showDivider = index < todayDisplayTxns.length - 1;
                  const rowBody = (
                    <Animated.View
                      style={[
                        styles.txnSwipeForeground,
                        { backgroundColor: bg },
                        t.isPendingPlaceholder ? styles.txnSwipeForegroundPending : null,
                      ]}>
                      <TxnItem
                        themeText={text}
                        themeSubtle={subtle}
                        dividerColor={outlineVariant}
                        monoFont={ffFonts.mono}
                        item={t}
                        showDivider={showDivider && !t.isPendingPlaceholder}
                        onPress={
                          t.isPendingPlaceholder
                            ? undefined
                            : () => router.push(`/edit-finance-transaction/${t.id}`)
                        }
                      />
                    </Animated.View>
                  );

                  if (t.isPendingPlaceholder) {
                    return (
                      <React.Fragment key={t.id}>
                        {rowBody}
                        <Pressable
                          onPress={() => cancelPendingAutoLedger(t.id)}
                          style={({ pressed }) => [
                            styles.pendingAutoLedgerCancelBtn,
                            { borderColor: outlineVariant, backgroundColor: surface },
                            pressed && { opacity: 0.88 },
                          ]}
                          accessibilityRole="button"
                          accessibilityLabel="取消 AI 识别">
                          <Text style={[styles.pendingAutoLedgerCancelText, { color: subtle }]}>
                            取消识别
                          </Text>
                        </Pressable>
                        {showDivider ? (
                          <View style={[styles.txnRowDivider, { backgroundColor: outlineVariant }]} />
                        ) : null}
                      </React.Fragment>
                    );
                  }

                  return (
                    <Swipeable
                      key={t.id}
                      friction={2}
                      overshootRight={false}
                      rightThreshold={40}
                      childrenContainerStyle={{ backgroundColor: bg }}
                      renderRightActions={() => (
                        <View style={[styles.swipeDeleteTrack, { backgroundColor: ff.clay2 }]}>
                          <Pressable
                            onPress={() => handleDeleteFinanceTxn(t.id, t.title)}
                            style={({ pressed }) => [
                              styles.swipeDeletePill,
                              { backgroundColor: '#B8583C' },
                              pressed && { opacity: 0.88 },
                            ]}
                            accessibilityRole="button"
                            accessibilityLabel={`删除 ${t.title}`}>
                            <Text style={styles.swipeDeleteText}>删除</Text>
                          </Pressable>
                        </View>
                      )}>
                      {rowBody}
                    </Swipeable>
                  );
                })
              )}
            </View>

            {historySections.map((section) => {
              const isYesterday = section.dayKey === calendarYesterdayYmd;
              const dayTitle = isYesterday
                ? `${section.date.getMonth() + 1}月${section.date.getDate()}日 · 昨天`
                : `${section.date.getMonth() + 1}月${section.date.getDate()}日 · ${weekdayCn[section.date.getDay()]}`;
              return (
                <View key={section.dayKey} style={[styles.ledgerGroup, { backgroundColor: bg }]}>
                  <View style={styles.ledgerGroupH}>
                    <Text style={[styles.ledgerGroupTitle, { color: ff.ink2 }]}>{dayTitle}</Text>
                    <Text style={[styles.ledgerGroupSum, { color: subtle, fontFamily: ffFonts.mono }]}>
                      支出 {formatCurrencyWithDecimals(section.expense)}
                    </Text>
                  </View>
                  {section.items.map((t, index) => (
                    <Swipeable
                      key={t.id}
                      friction={2}
                      overshootRight={false}
                      rightThreshold={40}
                      childrenContainerStyle={{ backgroundColor: bg }}
                      renderRightActions={() => (
                        <View style={[styles.swipeDeleteTrack, { backgroundColor: ff.clay2 }]}>
                          <Pressable
                            onPress={() => handleDeleteFinanceTxn(t.id, t.title)}
                            style={({ pressed }) => [
                              styles.swipeDeletePill,
                              { backgroundColor: '#B8583C' },
                              pressed && { opacity: 0.88 },
                            ]}
                            accessibilityRole="button"
                            accessibilityLabel={`删除 ${t.title}`}>
                            <Text style={styles.swipeDeleteText}>删除</Text>
                          </Pressable>
                        </View>
                      )}>
                      <Animated.View style={[styles.txnSwipeForeground, { backgroundColor: bg }]}>
                        <TxnItem
                          themeText={text}
                          themeSubtle={subtle}
                          dividerColor={outlineVariant}
                          monoFont={ffFonts.mono}
                          item={t}
                          showDivider={index < section.items.length - 1}
                          onPress={() => router.push(`/edit-finance-transaction/${t.id}`)}
                        />
                      </Animated.View>
                    </Swipeable>
                  ))}
                </View>
              );
            })}

            {displayTxns.length > 0 && isLoadingMoreDays ? (
              <View style={styles.loadMoreRow}>
                <ActivityIndicator size="small" color={ff.sage} />
                <Text style={[styles.loadMoreText, { color: subtle }]}>正在加载更早的流水</Text>
              </View>
            ) : null}
            {displayTxns.length > 0 && !hasMoreHistoryDays ? (
              <Text style={[styles.loadMoreText, { color: subtle }]}>没有更早记录了</Text>
            ) : null}
          </View>
          </View>
          </FoldRiseIn>
          </View>
            </Animated.View>
          ) : null}

          {showFinanceSkeleton ? (
            <HomeSkeletonShell
              pending={initialFinanceLoadPending}
              mounted={financeSkeletonMounted}
              opacity={financeSkeletonOpacity}
              backgroundColor={bg}
            >
              <View style={styles.sectionStack}>
                <FinanceBudgetCardSkeleton
                  colors={{ surface, outline: outlineStrong, cardBg: surface }}
                />
                <View style={[styles.sectionPanel, { backgroundColor: surface, borderColor: outlineStrong }, Shadows.card]}>
                  <FinanceAccountCarouselSkeleton colors={{ surface: surfaceSubtle, outline: outlineVariant, cardBg: surfaceSubtle }} />
                </View>
                <View style={[styles.sectionPanel, { backgroundColor: surface, borderColor: outlineStrong }, Shadows.card]}>
                  <FinanceTxnListSkeleton colors={{ surface: surfaceSubtle, outline: outlineVariant, cardBg: surfaceSubtle }} />
                </View>
              </View>
            </HomeSkeletonShell>
          ) : null}
          </View>
        </View>
      </ScrollView>

      <FinanceFoldRecordFab
        ff={ff}
        bottom={baseBottomAnim}
        disabled={!hasAccounts}
        busy={isPickingImage}
        isDark={isDark}
        onPress={() => {
          void handleOpenComposer();
        }}
        onLongPress={() => {
          if (!isPickingImage) void openAlbumScanFlow();
        }}
      />

      <Modal visible={isSheetVisible} animationType="fade" transparent onRequestClose={closeSheet}>
        {albumScanPhase !== 'off' ? (
          <FinanceFoldSheetChrome
            ff={ff}
            isDark={isDark}
            paddingBottom={sheetKeyboardInset > 0 ? 0 : Math.max(16, insets.bottom)}
            maxHeight={sheetModalMaxHeight}
            marginBottom={sheetKeyboardInset}
            onClose={closeSheet}>
            <ScrollView
              style={[styles.sheetBodyScroll, { maxHeight: sheetModalBodyMaxHeight }]}
              contentContainerStyle={styles.sheetBodyScrollContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator
              nestedScrollEnabled
              bounces>
              <FinanceFoldAlbumScanPanel
                ff={ff}
                fonts={ffFonts}
                imageUri={albumImageUri}
                scanning={albumScanPhase === 'scanning'}
                result={albumScanResult}
                error={albumScanError}
                includeInBudget={sheetIncludeInBudget}
                onToggleBudget={() => applySheetIncludeInBudget((prev) => !prev)}
                onConfirm={() => void confirmAlbumScan()}
                onCorrect={applyAlbumScanToForm}
                onClose={() => {
                  if (!albumConfirming) resetAlbumScanState();
                }}
                confirming={albumConfirming}
              />
            </ScrollView>
          </FinanceFoldSheetChrome>
        ) : (
          <FinanceFoldSheetChrome
            ff={ff}
            isDark={isDark}
            paddingBottom={sheetKeyboardInset > 0 ? 0 : Math.max(16, insets.bottom)}
            maxHeight={sheetModalMaxHeight}
            marginBottom={sheetKeyboardInset}
            onClose={closeSheet}>
            <FinanceFoldSheetHead
              ff={ff}
              fonts={ffFonts}
              title="记一笔"
              subtitle="说一句、拍一张，剩下的交给账本。"
              onClose={closeSheet}
            />
            <FinanceFoldSegment
              ff={ff}
              active={activeSheetTab}
              onChange={switchSheetTab}
              transferLabel={foldTransferLabel}
            />

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
              <FinanceFoldTransferPanel
                ff={ff}
                fonts={ffFonts}
                amountDisplay={amountDisplay}
                feeDisplay={transferFeeDisplay}
                amountTarget={transferAmountTarget}
                onFocusAmount={() => setTransferAmountTarget('amount')}
                onFocusFee={() => setTransferAmountTarget('fee')}
                fromLabel={transferPairMeta.fromLabel}
                toLabel={transferPairMeta.toLabel}
                fromName={transferFromAccount?.name ?? '选择账户'}
                toName={transferToAccount?.name ?? '选择账户'}
                onPressFrom={() => {
                  setIsDatePickerVisible(false);
                  setIsTimePickerVisible(false);
                  setAccountPickerTarget('transferFrom');
                  setIsAccountPickerVisible(true);
                }}
                onPressTo={() => {
                  setIsDatePickerVisible(false);
                  setIsTimePickerVisible(false);
                  setAccountPickerTarget('transferTo');
                  setIsAccountPickerVisible(true);
                }}
                onSwap={() => {
                  setTransferFromAccountId(transferToAccountId);
                  setTransferToAccountId(transferFromAccountId);
                }}
                hint={
                  transferFromAccount && transferToAccount
                    ? transferFromAccount.id === transferToAccount.id
                      ? '请选择两个不同的账户。'
                      : transferPairMeta.hint
                    : null
                }
                note={sheetNote}
                onChangeNote={setSheetNote}
                timeLabel={`${sheetDateLabel} ${sheetTimeLabel}`}
                onPressTime={() => {
                  setIsAccountPickerVisible(false);
                  setIsTimePickerVisible(false);
                  setIsDatePickerVisible(true);
                }}
                canSave={canSaveTransaction}
                isSaving={isSavingTransaction}
                onSave={() => void handleSaveTransaction()}
                keypadKeys={keypadRows.flat()}
                onKeypadKey={handleAmountKeyPress}
              />
            ) : activeSheetTab === 'sentence' ? (
              <>
                <View style={[styles.sheetConfigRow, { marginBottom: 10 }]}>
                  <Pressable
                    onPress={() => {
                      setIsTimePickerVisible(false);
                      setIsAccountPickerVisible(false);
                      setIsDatePickerVisible(true);
                    }}
                    style={[styles.configChip, { backgroundColor: ff.cardSoft, borderColor: ff.line }]}>
                    <MaterialIcons name="calendar-today" size={16} color={ff.muted} />
                    <Text style={[styles.configChipText, { color: ff.ink }]}>{sheetDateLabel}</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      setIsTimePickerVisible(false);
                      setIsAccountPickerVisible(false);
                      setIsDatePickerVisible(true);
                    }}
                    style={({ pressed }) => [
                      styles.configChip,
                      { backgroundColor: ff.cardSoft, borderColor: ff.line },
                      pressed ? { opacity: 0.8 } : null,
                    ]}>
                    <MaterialIcons name="schedule" size={16} color={ff.muted} />
                    <Text style={[styles.configChipText, { color: ff.ink }]}>{sheetTimeLabel}</Text>
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
                      { backgroundColor: ff.cardSoft, borderColor: ff.line },
                      pressed ? { opacity: 0.8 } : null,
                    ]}>
                    <MaterialIcons name="account-balance-wallet" size={16} color={ff.pine} />
                    <Text style={[styles.configChipText, { color: ff.ink }]}>
                      {selectedAccount?.name ?? '支付账户'}
                    </Text>
                    <MaterialIcons name="expand-more" size={16} color={ff.muted} />
                  </Pressable>
                </View>
                <FinanceFoldPhrasePanel
                  ff={ff}
                  fonts={ffFonts}
                  sentence={sheetSentence}
                  onChangeSentence={setSheetSentence}
                  pills={sentenceFoldPills}
                  aiLine={sentenceAiLine}
                  includeInBudget={sheetIncludeInBudget}
                  onToggleBudget={() => applySheetIncludeInBudget((prev) => !prev)}
                  budgetDetail="占用本月"
                  canSave={canSaveSentence}
                  isSaving={isParsingSentence}
                  onPreview={() => void handleSentenceLedgerPreview()}
                  isPreviewBusy={isSentencePreviewBusy}
                  onConfirm={() => void handleSaveTransaction()}
                  onOpenAlbum={() => void openAlbumScanFlow()}
                  quickTags={['午餐', '打车', '咖啡', '工资']}
                  onQuickTag={(tag) =>
                    setSheetSentence((prev) => {
                      const t = prev.trim();
                      return t ? `${t} ${tag}` : tag;
                    })
                  }
                />
              </>
            ) : (
              <>
                <FinanceFoldExpenseIncomePanel
                  ff={ff}
                  fonts={ffFonts}
                  mode={activeSheetTab === 'income' ? 'income' : 'expense'}
                  amountDisplay={amountDisplay}
                  amountFocused
                  onFocusAmount={() => {}}
                  categories={activeCategories.map((c) => ({
                    key: c.key,
                    label: c.label,
                    isCustom: c.isCustom,
                  }))}
                  selectedCategoryKey={selectedCategoryKey}
                  onSelectCategory={setSelectedCategoryKey}
                  onAddCategory={() =>
                    openAddCategoryModal(activeSheetTab === 'income' ? 'income' : 'expense')
                  }
                  onLongPressCustomCategory={(item) => {
                    const cat = activeCategories.find((c) => c.key === item.key);
                    if (cat) confirmDeleteCustomCategory(cat);
                  }}
                  accountLabel={selectedAccount?.name ?? '选择账户'}
                  onPressAccount={() => {
                    setIsDatePickerVisible(false);
                    setIsTimePickerVisible(false);
                    setIsAccountPickerVisible((prev) => {
                      if (!prev) setAccountPickerTarget('sheet');
                      return !prev;
                    });
                  }}
                  timeLabel={`${sheetDateLabel} ${sheetTimeLabel}`}
                  onPressTime={() => {
                    setIsTimePickerVisible(false);
                    setIsAccountPickerVisible(false);
                    setIsDatePickerVisible(true);
                  }}
                  title={sheetNote}
                  onChangeTitle={setSheetNote}
                  includeInBudget={sheetIncludeInBudget}
                  onToggleBudget={() => applySheetIncludeInBudget((prev) => !prev)}
                  imageUris={sheetImageUris}
                  onRemoveImage={(idx) =>
                    setSheetImageUris((prev) => prev.filter((_, i) => i !== idx))
                  }
                  onPressImage={() => void openAlbumScanFlow()}
                  canSave={canSaveTransaction}
                  isSaving={isSavingTransaction}
                  onSave={() => void handleSaveTransaction()}
                  keypadKeys={keypadRows.flat()}
                  onKeypadKey={handleAmountKeyPress}
                />
                <View style={{ height: 0, overflow: 'hidden', opacity: 0 }} pointerEvents="none">
                  <FinanceCategoryPicker
                    categories={activeCategories}
                    selectedKey={selectedCategoryKey}
                    onSelectKey={setSelectedCategoryKey}
                    transactionType={activeSheetTab === 'income' ? 'income' : 'expense'}
                    singleRowCollapsed
                    subtle={subtle}
                    primary={primary}
                    text={text}
                    surface={surface}
                    outlineVariant={outlineVariant}
                    styles={styles}
                    onAddPress={() => openAddCategoryModal(activeSheetTab === 'income' ? 'income' : 'expense')}
                    onLongPressCustom={confirmDeleteCustomCategory}
                    addModalVisible={addModalVisible}
                    newCategoryName={newCategoryName}
                    onChangeNewCategoryName={setNewCategoryName}
                    newCategoryIcon={newCategoryIcon}
                    onChangeNewCategoryIcon={setNewCategoryIcon}
                    isSavingCategory={isSavingCategory}
                    onCloseAddModal={closeAddCategoryModal}
                    onSaveNewCategory={() => {
                      markPageDirty();
                      void saveNewCategory(setSelectedCategoryKey);
                    }}
                  />
                </View>
              </>
            )}
            </ScrollView>

            <Modal visible={isDatePickerVisible} transparent animationType="fade" onRequestClose={() => setIsDatePickerVisible(false)}>
              <View style={styles.pickerModalOverlay}>
                <Pressable style={styles.pickerModalBackdrop} onPress={() => setIsDatePickerVisible(false)} />
                <View
                  style={[
                    styles.pickerModalCard,
                    { backgroundColor: ff.card, borderColor: ff.line, shadowColor: isDark ? '#000' : '#0f172a' },
                  ]}>
                  <View style={[styles.pickerModalHeader, { borderBottomColor: ff.line }]}>
                    <Text style={[styles.pickerModalTitle, { color: ff.ink }]}>选择日期</Text>
                    <Pressable onPress={() => setIsDatePickerVisible(false)} style={styles.pickerModalCloseBtn}>
                      <MaterialIcons name="close" size={22} color={ff.muted} />
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
                      <Pressable
                        onPress={() => setSelectedHappenedAt(new Date())}
                        style={[styles.pickerModalAction, { borderColor: ff.line, backgroundColor: ff.cardSoft }]}>
                        <Text style={[styles.pickerModalActionText, { color: ff.ink }]}>今天</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => {
                          setIsDatePickerVisible(false);
                          setIsTimePickerVisible(true);
                        }}
                        style={[styles.pickerModalAction, { borderColor: ff.pine, backgroundColor: ff.pine }]}>
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
                <View
                  style={[
                    styles.pickerModalCard,
                    { backgroundColor: ff.card, borderColor: ff.line, shadowColor: isDark ? '#000' : '#0f172a' },
                  ]}>
                  <View style={[styles.pickerModalHeader, { borderBottomColor: ff.line }]}>
                    <Text style={[styles.pickerModalTitle, { color: ff.ink }]}>选择时间</Text>
                    <Pressable onPress={() => setIsTimePickerVisible(false)} style={styles.pickerModalCloseBtn}>
                      <MaterialIcons name="close" size={22} color={ff.muted} />
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
                      <Pressable
                        onPress={() => setSelectedHappenedAt(new Date())}
                        style={[styles.pickerModalAction, { borderColor: ff.line, backgroundColor: ff.cardSoft }]}>
                        <Text style={[styles.pickerModalActionText, { color: ff.ink }]}>现在</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => setIsTimePickerVisible(false)}
                        style={[styles.pickerModalAction, { borderColor: ff.pine, backgroundColor: ff.pine }]}>
                        <Text style={styles.pickerModalPrimaryText}>确定</Text>
                      </Pressable>
                    </View>
                  </View>
                </View>
              </View>
            </Modal>

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
                        ? `选择${transferPairMeta.fromLabel}`
                        : accountPickerTarget === 'transferTo'
                          ? `选择${transferPairMeta.toLabel}`
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
          </FinanceFoldSheetChrome>
        )}
      </Modal>

      <Modal visible={isBudgetAdjustVisible} animationType="fade" transparent onRequestClose={closeBudgetAdjust}>
        <FinanceFoldBudgetSheet
          visible={isBudgetAdjustVisible}
          ff={ff}
          isDark={isDark}
          paddingBottom={Math.max(16, insets.bottom)}
          maxHeight={sheetModalMaxHeight}
          scopeLabel={budgetUiScopeShort}
          budgetAmount={budgetPreviewTotal}
          budgetUsedAmount={monthlyBudgetExpense}
          budgetUsedPercent={
            budgetPreviewTotal > 0 ? Math.min(100, (monthlyBudgetExpense / budgetPreviewTotal) * 100) : 0
          }
          todayAvailable={isTodayBudgetOver ? 0 : todayAvailableAmount}
          todayRingPct={todayAvailableRingPct}
          scheduledDeduction={scheduledBudgetDeduction}
          hasSavedBudget={currentMonthKey in monthBudgetSettings}
          aiHint={budgetAdjustAiHint}
          onClose={closeBudgetAdjust}
          onChangeBudget={handleBudgetSliderChange}
          onManageScheduled={() => {
            closeBudgetAdjust();
            router.push('/scheduled-expenses');
          }}
          onReset={handleResetBudgetAdjust}
          onSave={handleSaveBudgetAdjust}
        />
      </Modal>

      <Modal
        visible={isTodayBudgetHintVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setIsTodayBudgetHintVisible(false)}>
        <View style={styles.budgetModalOverlayInner}>
          <Pressable style={styles.sheetBackdrop} onPress={() => setIsTodayBudgetHintVisible(false)} />
          <View style={[styles.budgetDetailsSheet, { paddingBottom: Math.max(24, insets.bottom), backgroundColor: surface }]}>
            <View style={styles.budgetDetailsHeader}>
              <Text style={[styles.budgetDetailsTitle, { color: text }]}>今日可用与剩余预算</Text>
              <Pressable
                onPress={() => setIsTodayBudgetHintVisible(false)}
                style={({ pressed }) => [styles.pickerModalCloseBtn, pressed && { opacity: 0.75 }]}
                accessibilityRole="button"
                accessibilityLabel="关闭">
                <MaterialIcons name="close" size={22} color={subtle} />
              </Pressable>
            </View>

            <View style={styles.budgetHintBody}>
              <View
                style={[
                  styles.budgetHintCard,
                  { backgroundColor: isDark ? 'rgba(148,163,184,0.12)' : '#f7f9fd', borderColor: outlineVariant },
                ]}>
                <View style={[styles.budgetHintAccent, { backgroundColor: primary }]} />
                <View
                  style={[
                    styles.budgetHintIconWrap,
                    { backgroundColor: isDark ? 'rgba(169,199,185, 0.14)' : 'rgba(30,57,50, 0.09)' },
                  ]}>
                  <MaterialIcons name="account-balance-wallet" size={22} color={primary} />
                </View>
                <View style={styles.budgetHintTextCol}>
                  <Text style={[styles.budgetHintLabel, { color: subtle }]}>剩余预算</Text>
                  <Text style={[styles.budgetHintValue, { color: text }]}>
                    {showNetAmounts ? formatCurrencyWithDecimals(todayBudgetSurplusAmount) : hiddenAmountText}
                  </Text>
                  <Text style={[styles.budgetHintExplain, { color: subtle }]}>
                    {budgetUiScopeShort}预算总额含基数与计入预算的收入，减去本周期已计入预算的支出；可在预算详情中手动校正结余。计入预算的收入会增加总额；标记为「不计入预算」的支出不会减少剩余预算。
                  </Text>
                </View>
              </View>

              <View
                style={[
                  styles.budgetHintCard,
                  { backgroundColor: isDark ? 'rgba(148,163,184,0.12)' : '#f7f9fd', borderColor: outlineVariant },
                ]}>
                <View style={[styles.budgetHintAccent, { backgroundColor: tertiary }]} />
                <View
                  style={[
                    styles.budgetHintIconWrap,
                    { backgroundColor: isDark ? 'rgba(251, 191, 36, 0.14)' : 'rgba(130, 81, 0, 0.09)' },
                  ]}>
                  <MaterialIcons name="pie-chart" size={22} color={tertiary} />
                </View>
                <View style={styles.budgetHintTextCol}>
                  <Text style={[styles.budgetHintLabel, { color: subtle }]}>
                    {isTodayBudgetOver ? '今日超出预算' : '今日可用预算'}
                  </Text>
                  <Text style={[styles.budgetHintValue, { color: isTodayBudgetOver ? danger : primary }]}>
                    {showNetAmounts
                      ? formatCurrencyWithDecimals(
                          isTodayBudgetOver ? todayBudgetOverAmount : todayAvailableAmount,
                        )
                      : hiddenAmountText}
                  </Text>
                  {showNetAmounts ? (
                    <View
                      style={[
                        styles.budgetHintMetaCapsule,
                        {
                          backgroundColor: isTodayBudgetOver
                            ? isDark
                              ? 'rgba(248,113,113,0.14)'
                              : '#fef2f2'
                            : isDark
                              ? 'rgba(169,199,185,0.14)'
                              : '#eef2fb',
                        },
                      ]}>
                      <Text
                        style={[
                          styles.budgetHintMetaText,
                          { color: isTodayBudgetOver ? danger : primary },
                        ]}>
                        日均可支配 {formatCurrencyWithDecimals(dailyBudgetAmount)} · 今日已用{' '}
                        {formatCurrencyWithDecimals(todayBudgetExpenseTotal)}
                        {isTodayBudgetOver
                          ? ` · 超出 ${formatCurrencyWithDecimals(todayBudgetOverAmount)}`
                          : ''}
                      </Text>
                    </View>
                  ) : null}
                  <Text style={[styles.budgetHintExplain, { color: subtle }]}>
                    日均可支配按 {todayBudgetDailyExplain} 计算；今日可用 = 日均可支配 − 今日已计入预算的支出。
                    {isTodayBudgetOver
                      ? ' 超出日均可支配时，圆环变红并显示超支金额。'
                      : ' 圆环进度表示今日已用占日均可支配的比例。'}
                  </Text>
                </View>
              </View>
            </View>

            <Pressable
              onPress={() => setIsTodayBudgetHintVisible(false)}
              style={({ pressed }) => [
                styles.budgetDetailsSaveBtn,
                { backgroundColor: tertiary, opacity: pressed ? 0.92 : 1 },
              ]}
              accessibilityRole="button"
              accessibilityLabel="知道了">
              <Text style={styles.budgetDetailsSaveText}>知道了</Text>
            </Pressable>
            <View style={[styles.budgetDetailsHomeIndicator, { backgroundColor: isDark ? '#9ca3af' : '#111827' }]} />
          </View>
        </View>
      </Modal>

      {autoLedgerToastVisible ? (
        <View
          pointerEvents="box-none"
          style={[styles.autoLedgerToastWrap, { top: insets.top + 8 }]}
          accessibilityLiveRegion="polite">
          <View style={[styles.autoLedgerToast, { backgroundColor: surface, borderColor: outlineVariant }]}>
            <ActivityIndicator size="small" color={tertiary} />
            <Text style={[styles.autoLedgerToastText, { color: text }]} numberOfLines={2}>
              {autoLedgerToastMessage}
            </Text>
            {pendingAutoLedgers.length > 0 ? (
              <Pressable
                onPress={() => cancelPendingAutoLedger(pendingAutoLedgers[0].id)}
                hitSlop={8}
                style={({ pressed }) => [pressed && { opacity: 0.75 }]}
                accessibilityRole="button"
                accessibilityLabel="取消 AI 识别">
                <Text style={[styles.autoLedgerToastCancel, { color: primary }]}>取消</Text>
              </Pressable>
            ) : null}
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
    paddingHorizontal: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerInnerFold: {
    width: '100%',
    minHeight: 54,
    paddingHorizontal: 17,
    paddingBottom: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  headerFoldText: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  headerTitleFold: {
    fontSize: 20,
    fontWeight: '600',
    letterSpacing: 0.2,
    lineHeight: 24,
  },
  headerSubFold: {
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.2,
  },
  headerFoldActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  foldIconBtn: {
    width: 31,
    height: 31,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
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
  budgetCardFold: {
    borderRadius: 20,
    borderWidth: 1,
    paddingVertical: 13,
    paddingHorizontal: 13,
    flexDirection: 'row',
    gap: 8,
    overflow: 'hidden',
    shadowColor: '#1A342A',
    shadowOpacity: 0.19,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: 10 },
    elevation: 6,
  },
  budgetFoldMain: {
    flex: 1,
    minWidth: 0,
    gap: 6,
  },
  budgetFoldLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  budgetFoldLabel: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.6,
  },
  budgetMiniEye: {
    width: 19,
    height: 19,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  budgetFoldAmountRow: {
    marginTop: 2,
  },
  budgetFoldAmount: {
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: -0.4,
  },
  budgetFoldProgress: {
    marginTop: 4,
    gap: 6,
  },
  budgetFoldTrack: {
    height: 4,
    borderRadius: 4,
    overflow: 'hidden',
  },
  budgetFoldFill: {
    height: '100%',
    borderRadius: 4,
  },
  budgetFoldFoot: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  budgetFoldFootText: {
    fontSize: 10,
    fontWeight: '500',
  },
  budgetFoldRingCol: {
    width: 88,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 2,
    gap: 5,
  },
  budgetFoldRingValue: {
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 16,
  },
  budgetFoldRingLabel: {
    fontSize: 9,
    fontWeight: '600',
    marginTop: 2,
    letterSpacing: 0.3,
  },
  budgetFoldRingCap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  foldDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
  },
  netCardFold: {
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 11,
    paddingHorizontal: 11,
    gap: 4,
  },
  netLabelFold: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  netMiniEyeLight: {
    width: 19,
    height: 19,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  netExpandFold: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: 6,
    paddingTop: 8,
  },
  netExpandText: {
    fontSize: 11,
    fontWeight: '500',
    flex: 1,
    minWidth: 0,
  },
  quickRow: {
    flexDirection: 'row',
    gap: 6,
  },
  quickBtn: {
    flex: 1,
    minHeight: 52,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 8,
  },
  quickIcon: {
    width: 26,
    height: 26,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickTitle: {
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 14,
  },
  quickSub: {
    fontSize: 9,
    fontWeight: '500',
    marginTop: 1,
  },
  sectionEyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 2,
    marginBottom: 4,
    paddingHorizontal: 2,
  },
  sectionEyebrow: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.4,
  },
  accountCardFold: {
    width: 184,
    height: 82,
    borderRadius: 15,
    paddingHorizontal: 10,
    paddingVertical: 9,
    overflow: 'hidden',
  },
  accountCardFoldAdd: {
    width: 112,
    height: 82,
    borderRadius: 15,
    borderWidth: 1,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  accountFoldTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  accountFoldName: {
    fontSize: 11,
    fontWeight: '700',
    flex: 1,
    minWidth: 0,
  },
  accountFoldBal: {
    fontSize: 16,
    fontWeight: '700',
    marginTop: 12,
    letterSpacing: -0.2,
  },
  accountFoldFoot: {
    marginTop: 2,
  },
  ledgerGroup: {
    marginBottom: 4,
  },
  ledgerGroupH: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: 2,
    marginBottom: 2,
    marginTop: 6,
  },
  ledgerGroupTitle: {
    fontSize: 12,
    fontWeight: '700',
  },
  ledgerGroupSum: {
    fontSize: 11,
    fontWeight: '600',
  },
  loadMoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
  },
  recordFabWrap: {
    position: 'absolute',
    right: 17,
    zIndex: 100,
    elevation: 20,
  },
  recordFab: {
    height: 43,
    paddingLeft: 12,
    paddingRight: 15,
    borderRadius: 22,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    shadowOpacity: 0.28,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  recordFabPlus: {
    width: 23,
    height: 23,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  recordFabText: {
    fontSize: 13,
    fontWeight: '800',
  },
  txnMetaLine: {
    fontSize: 11,
    fontWeight: '500',
    marginTop: 2,
  },
  txnAmtCol: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 2,
    paddingRight: 2,
  },
  txnTimeOnly: {
    fontSize: 10,
    fontWeight: '500',
    opacity: 0.75,
  },
  content: {
    width: '100%',
    paddingHorizontal: Spacing.md,
    paddingTop: 16,
  },
  financeBodyStack: {
    position: 'relative',
  },
  sectionStack: {
    gap: Spacing.xl,
  },
  sectionPanel: {
    borderRadius: Radius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing['3xl'],
    overflow: 'hidden',
  },
  netCard: {
    borderRadius: Radius['2xl'],
    padding: Spacing['4xl'],
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  budgetOverviewCard: {
    paddingTop: Spacing['4xl'],
    paddingBottom: Spacing['3xl'],
    gap: 0,
  },
  budgetHeroBand: {
    gap: 0,
  },
  budgetNetBand: {
    marginTop: Spacing['4xl'],
    paddingTop: Spacing['4xl'],
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  budgetShortcutsBand: {
    marginTop: Spacing['4xl'],
    paddingTop: Spacing.xl,
  },
  budgetTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  budgetTopMain: {
    flex: 1,
    minWidth: 0,
    gap: 8,
  },
  budgetTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  budgetSurplusTitle: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  budgetPeriodBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  budgetPeriodDeadlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: -4,
  },
  budgetPeriodCountdown: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  budgetPeriodEndDate: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.1,
    marginTop: -2,
  },
  budgetAmountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'nowrap',
    marginTop: 2,
  },
  budgetSurplusValue: {
    fontSize: 30,
    fontWeight: '900',
    letterSpacing: -0.9,
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
    marginTop: 6,
    paddingRight: 2,
  },
  budgetProgressLabels: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  budgetProgressEnd: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.1,
  },
  budgetProgressTrack: {
    height: 6,
    borderRadius: 999,
    overflow: 'hidden',
  },
  budgetProgressFill: {
    height: '100%',
    borderRadius: 999,
  },
  budgetTodayRing: {
    paddingTop: 2,
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  budgetTodayRingPad: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  budgetRingCenter: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
    maxWidth: 78,
  },
  budgetRingLabel: {
    fontSize: 11,
    fontWeight: '800',
    textAlign: 'center',
    lineHeight: 14,
    letterSpacing: 0.2,
  },
  budgetRingValue: {
    marginTop: 2,
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: -0.2,
    textAlign: 'center',
  },
  budgetHintBody: {
    paddingHorizontal: 24,
    gap: 12,
    marginBottom: 20,
  },
  budgetHintCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 14,
    paddingRight: 14,
    paddingLeft: 10,
    gap: 10,
    overflow: 'hidden',
  },
  budgetHintAccent: {
    width: 3,
    alignSelf: 'stretch',
    borderRadius: 999,
    marginLeft: 2,
  },
  budgetHintIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  budgetHintTextCol: {
    flex: 1,
    gap: 6,
    minWidth: 0,
  },
  budgetHintLabel: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  budgetHintValue: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  budgetHintMetaCapsule: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    maxWidth: '100%',
  },
  budgetHintMetaText: {
    fontSize: 11,
    fontWeight: '800',
    lineHeight: 15,
    letterSpacing: 0.1,
  },
  budgetHintExplain: {
    fontSize: 12,
    fontWeight: '500',
    lineHeight: 17,
    opacity: 0.92,
  },
  budgetNetDivider: {
    height: StyleSheet.hairlineWidth,
    marginTop: 18,
    marginBottom: 14,
    opacity: 1,
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
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  netBreakdownRow: {
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  netBreakdownText: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.1,
  },
  netBreakdownSep: {
    fontSize: 12,
    fontWeight: '700',
  },
  trendPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  trendPillText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  budgetNetAmountRow: {
    marginTop: 6,
    gap: 4,
  },
  trendChartDayLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.1,
  },
  budgetNetAmount: {
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  trendChartWrap: {
    marginTop: 10,
    width: '100%',
  },
  trendChartPlot: {
    position: 'relative',
    height: NET_WORTH_TREND_CHART_H,
    width: '100%',
    // 不裁切：圆点需完整显示；圆角只画在背景层
    overflow: 'visible',
  },
  trendChartPlotBg: {
    ...StyleSheet.absoluteFill,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  trendChartNodes: {
    ...StyleSheet.absoluteFill,
    zIndex: 1,
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
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.1,
    opacity: 0.75,
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
    width: 32,
    height: 32,
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
    gap: 10,
    justifyContent: 'space-between',
    marginTop: 12,
  },
  netStatCol: {
    width: '47%',
    gap: 6,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  netStatLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.2,
    opacity: 0.85,
  },
  netStatValue: {
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  assetsBtnRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 8,
    width: '100%',
  },
  assetsBtn: {
    flex: 1,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 10,
    paddingHorizontal: 8,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  assetsBtnText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.1,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginBottom: Spacing.xl,
    paddingBottom: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
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
    overflow: 'hidden',
  },
  txnSwipeForegroundPending: {
    opacity: 0.92,
  },
  pendingAutoLedgerCancelBtn: {
    alignSelf: 'flex-end',
    marginTop: -2,
    marginBottom: 10,
    marginRight: 14,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  pendingAutoLedgerCancelText: {
    fontSize: 12,
    fontWeight: '600',
  },
  swipeDeleteTrack: {
    width: 65,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingRight: 9,
  },
  swipeDeletePill: {
    height: 27,
    paddingHorizontal: 10,
    borderRadius: 7,
    justifyContent: 'center',
    alignItems: 'center',
  },
  swipeDeleteText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  dayGroups: {
    gap: 12,
    paddingTop: 2,
    paddingBottom: 4,
  },
  dayGroup: {
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  dayGroupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  dayGroupTitleCol: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  dayGroupTitle: {
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: -0.2,
  },
  dayGroupSub: {
    fontSize: 11,
    fontWeight: '600',
    opacity: 0.78,
  },
  dayGroupTotals: {
    alignItems: 'flex-end',
    gap: 2,
  },
  dayGroupTotalText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  dayGroupEmpty: {
    paddingVertical: 22,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  txnRowDivider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 62,
    opacity: 0.9,
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
    paddingVertical: 4,
    gap: 12,
    paddingRight: 4,
  },
  accountCard: {
    width: 168,
    borderRadius: Radius.xl,
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  accountCardDark: {
    width: 168,
    borderRadius: 16,
    padding: 14,
    gap: 10,
  },
  accountIconBadge: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  accountKicker: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.1,
    opacity: 0.9,
  },
  accountValue: {
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: -0.3,
  },
  txnItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 7,
    paddingHorizontal: 2,
  },
  txnIconWrap: {
    width: 29,
    height: 29,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  txnMain: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  txnTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  txnTitle: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: -0.1,
  },
  txnTagRow: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    alignItems: 'center',
    gap: 5,
    overflow: 'hidden',
  },
  txnTag: {
    flexShrink: 0,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  txnTagShrink: {
    flexShrink: 1,
    minWidth: 0,
    maxWidth: '100%',
  },
  txnTagText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.1,
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
    flexShrink: 0,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: -0.1,
  },
  insightRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 5,
    paddingRight: 2,
  },
  insightRowPending: {
    opacity: 0.9,
  },
  insightBodyWrap: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  insightToggleText: {
    fontSize: 10,
    fontWeight: '700',
    opacity: 0.9,
  },
  insightText: {
    fontSize: 11,
    fontWeight: '600',
    lineHeight: 15,
    letterSpacing: 0.1,
  },
  composerWrap: {
    position: 'absolute',
    left: Spacing.md,
    right: Spacing.md,
    alignItems: 'center',
    zIndex: 100,
    elevation: 20,
  },
  composerShell: {
    width: '100%',
    borderWidth: 1,
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
    paddingLeft: 6,
    paddingRight: 4,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  composerInput: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 44,
    borderRadius: 22,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  composerPlaceholder: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
  },
  composerDivider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
    marginVertical: 10,
    marginHorizontal: 2,
  },
  composerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 2,
  },
  composerActionBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
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
    ...StyleSheet.absoluteFill,
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
  transferFeeRow: {
    marginTop: -8,
    alignSelf: 'center',
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minWidth: 200,
  },
  transferFeeLabel: {
    fontSize: 13,
    fontWeight: '700',
  },
  transferFeeValue: {
    flex: 1,
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'right',
  },
  transferFeeHint: {
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: -4,
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
    ...StyleSheet.absoluteFill,
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
  autoLedgerToastCancel: {
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 10,
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
  budgetPeriodSurplusBlock: {
    gap: 8,
    marginTop: 8,
  },
  budgetPeriodSurplusHeader: {
    gap: 4,
  },
  budgetPeriodSurplusTitle: {
    fontSize: 14,
    fontWeight: '600',
  },
  budgetPeriodSurplusHint: {
    fontSize: 12,
    lineHeight: 17,
  },
  budgetPeriodSurplusInputCard: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 6,
  },
  budgetPeriodSurplusAutoHint: {
    fontSize: 12,
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
  budgetFixedExpensePayBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    minWidth: 62,
    justifyContent: 'center',
  },
  budgetFixedExpensePayText: {
    fontSize: 13,
    fontWeight: '600',
  },
  budgetFixedPaySection: {
    marginTop: 12,
    gap: 8,
  },
  budgetFixedPaySectionTitle: {
    fontSize: 12,
    fontWeight: '600',
  },
  budgetFixedPayList: {
    gap: 8,
  },
  budgetFixedPayChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  budgetFixedPayChipMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    minWidth: 0,
  },
  budgetFixedPayChipName: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
    minWidth: 0,
  },
  budgetFixedPayChipAmount: {
    fontSize: 13,
    fontWeight: '600',
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
