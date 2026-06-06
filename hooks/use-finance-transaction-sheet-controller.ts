import { Colors } from '@/constants/theme';
import { makeTimestampEntityId } from '@/lib/entity-id';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { FINANCE_ACCOUNT_ICON_OPTIONS } from '@/lib/constants/finance-account-icons';
import { resolveFinanceAccountForAutoLedgerWithDefaults } from '@/lib/finance-account-match';
import {
    loadFinanceDefaultAccounts,
    sanitizeFinanceDefaultAccounts,
    type FinanceDefaultAccounts,
} from '@/lib/finance-default-accounts';
import { notifyFinanceSheetSaved } from '@/lib/finance-sheet-controller';
import type { FinanceSheetLaunchIntent } from '@/lib/finance-sheet-launch-intent';
import {
    parseFinanceSentenceLocal,
    pickSheetCategoryForParsed,
    type AccountPickerTarget,
    type ParsedOneLiner,
    type SentenceLedgerPreviewState,
    type SentenceResolveResult,
    type SheetTab,
} from '@/lib/finance-transaction-sheet/helpers';
import { financeTransactionSheetStyles } from '@/lib/finance-transaction-sheet/styles';
import { useFinanceSheetCategories } from '@/lib/finance-transaction-sheet/use-sheet-categories';
import {
    createFinanceTransaction,
    financeSignedAmountForSave,
    getFinanceAccountsWithBalance,
    getFinanceTransactions,
    normalizeFinanceSignRule,
    validateFinanceTransactionBeforeSave,
} from '@/lib/repositories/finance/finance';
import { budgetExtraPatchForTransaction } from '@/lib/repositories/finance/finance-transaction-extra';
import type { FinanceAccountBalanceRow } from '@/lib/repositories/finance/finance.types';
import {
    getActiveAiLlmApiKey,
    isActiveAiLlmConfigured,
    parseFinanceOneLinerFromText,
} from '@/lib/zhipu-image-parse';
import { useRouter } from 'expo-router';
import React from 'react';
import { Alert, Dimensions, Keyboard, Platform, type KeyboardEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export type FinanceTransactionSheetControllerOptions = {
  visible: boolean;
  launchIntent?: FinanceSheetLaunchIntent | null;
  onClose: () => void;
  onSaved?: () => void;
};

export function useFinanceTransactionSheetController({
  visible,
  launchIntent,
  onClose,
  onSaved,
}: FinanceTransactionSheetControllerOptions) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const themeKey = colorScheme === 'dark' ? 'dark' : 'light';
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
  const [financeAccounts, setFinanceAccounts] = React.useState<FinanceAccountBalanceRow[]>([]);
  const [sheetImageUris, setSheetImageUris] = React.useState<string[]>([]);
  const [sheetIncludeInBudget, setSheetIncludeInBudget] = React.useState(true);
  const sheetIncludeInBudgetRef = React.useRef(true);
  const applySheetIncludeInBudget = React.useCallback((value: boolean | ((prev: boolean) => boolean)) => {
    setSheetIncludeInBudget((prev) => {
      const next = typeof value === 'function' ? value(prev) : value;
      sheetIncludeInBudgetRef.current = next;
      return next;
    });
  }, []);
  const [sentenceLedgerPreview, setSentenceLedgerPreview] = React.useState<SentenceLedgerPreviewState>(null);
  const [isSentencePreviewBusy, setIsSentencePreviewBusy] = React.useState(false);
  const [sheetKeyboardInset, setSheetKeyboardInset] = React.useState(0);

  const financeAccountsRef = React.useRef<FinanceAccountBalanceRow[]>([]);
  const defaultAccountsRef = React.useRef<FinanceDefaultAccounts>({
    defaultPaymentAccountId: null,
    defaultIncomeAccountId: null,
  });

  const sheetCategories = useFinanceSheetCategories({ primary, secondary, tertiary, subtle });
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
  } = sheetCategories;

  const zhipuTxnReady = isActiveAiLlmConfigured();

  const manualSheetMaxHeight = React.useMemo(
    () => Dimensions.get('window').height - insets.top - 10,
    [insets.top],
  );
  const MANUAL_SHEET_CHROME_HEIGHT = 124;
  const sheetModalMaxHeight = React.useMemo(
    () => Math.max(200, manualSheetMaxHeight - sheetKeyboardInset),
    [manualSheetMaxHeight, sheetKeyboardInset],
  );
  const sheetModalBodyMaxHeight = React.useMemo(
    () => Math.max(200, sheetModalMaxHeight - MANUAL_SHEET_CHROME_HEIGHT),
    [sheetModalMaxHeight],
  );

  const formatCurrencyWithDecimals = React.useCallback((value: number) => {
    const prefix = value < 0 ? '-¥' : '¥';
    return `${prefix}${Math.abs(value).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }, []);

  const formatCurrencyBalanceForAccount = React.useCallback(
    (acc: FinanceAccountBalanceRow) => {
      const rule = normalizeFinanceSignRule(acc.sign_rule, acc.account_type);
      const v = rule < 0 ? Math.min(0, acc.balance ?? 0) : Math.max(0, acc.balance ?? 0);
      return formatCurrencyWithDecimals(v);
    },
    [formatCurrencyWithDecimals],
  );

  const accountIcon = React.useCallback((account: FinanceAccountBalanceRow) => {
    let extra: Record<string, unknown> | null = null;
    if (account.extra_data) {
      try {
        const raw = JSON.parse(account.extra_data) as unknown;
        if (raw && typeof raw === 'object') extra = raw as Record<string, unknown>;
      } catch {
        extra = null;
      }
    }
    const iconKey = extra && typeof extra.ui_icon_key === 'string' ? extra.ui_icon_key : undefined;
    if (iconKey && iconKey.length > 0) {
      const matched = FINANCE_ACCOUNT_ICON_OPTIONS.find((item) => item.key === iconKey)?.icon;
      if (matched) return matched;
    }
    const name = account.name;
    if (name.includes('现金')) return 'payments' as const;
    if (name.includes('支付宝')) return 'account-balance-wallet' as const;
    if (name.includes('微信')) return 'chat' as const;
    if (name.includes('银行')) return 'account-balance' as const;
    return 'account-balance-wallet' as const;
  }, []);

  const loadFinanceAccounts = React.useCallback(async () => {
    try {
      const rows = await getFinanceAccountsWithBalance();
      financeAccountsRef.current = rows;
      setFinanceAccounts(rows);
    } catch {
      financeAccountsRef.current = [];
      setFinanceAccounts([]);
    }
  }, []);

  const loadFinanceTransactions = React.useCallback(async () => {
    try {
      await getFinanceTransactions();
    } catch {
      /* 宿主页通过 notifyFinanceSheetSaved 刷新列表 */
    }
  }, []);

  const getDefaultSheetAccountIdForTab = React.useCallback((tab: SheetTab, accounts: FinanceAccountBalanceRow[]) => {
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
  }, []);

  const pickAccountForAutoLedger = React.useCallback(
    (
      accounts: FinanceAccountBalanceRow[],
      parsed: Pick<ParsedOneLiner, 'transaction_type' | 'account_name' | 'payment_account_label'>,
      defaults: FinanceDefaultAccounts,
    ) => {
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

  const resolveFinanceSentenceLine = React.useCallback(async (line: string): Promise<SentenceResolveResult> => {
    const trimmed = line.trim();
    if (!trimmed) return { ok: false, error: '请输入用一句话描述这笔账。' };
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
      if (loc.ok) return { ok: true, parsed: loc, source: 'local' };
      return { ok: false, error: `智谱解析未成功（${r.error}）。本地规则也无法识别，请写清数字金额后再试。` };
    }
    const loc = parseFinanceSentenceLocal(trimmed);
    if (loc.ok) return { ok: true, parsed: loc, source: 'local' };
    return { ok: false, error: '请写明金额（需含阿拉伯数字），或配置 EXPO_PUBLIC_ZHIPU_API_KEY 以使用智谱 AI 理解口语。' };
  }, []);

  const resetSheetForm = React.useCallback(
    (nextTab: SheetTab = 'sentence', opts?: { preserveBudget?: boolean }) => {
      setActiveSheetTab(nextTab);
      setSheetAmount('');
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
      const list = financeAccountsRef.current;
      if (list.length > 0) {
        setSelectedAccountId(getDefaultSheetAccountIdForTab(nextTab, list));
      }
    },
    [applySheetIncludeInBudget, getDefaultSheetAccountIdForTab],
  );

  const switchSheetTab = React.useCallback(
    (nextTab: SheetTab) => {
      if (activeSheetTab === nextTab) return;
      resetSheetForm(nextTab, { preserveBudget: true });
    },
    [activeSheetTab, resetSheetForm],
  );

  const applyLaunchIntent = React.useCallback(
    (intent: FinanceSheetLaunchIntent, list: FinanceAccountBalanceRow[]) => {
      if (intent.kind === 'auto_ledger_clipboard_image' || intent.kind === 'auto_ledger_clipboard_pending') {
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
    },
    [getDefaultSheetAccountIdForTab, resetSheetForm],
  );

  React.useEffect(() => {
    if (!visible) {
      setSheetKeyboardInset(0);
      return;
    }
    const winH = Dimensions.get('window').height;
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const onShow = (e: KeyboardEvent) => {
      const { height, screenY } = e.endCoordinates;
      const h = Math.max(0, Math.round(height));
      if (Platform.OS === 'ios' && screenY > 0 && screenY < winH) {
        setSheetKeyboardInset(Math.min(h, Math.max(0, Math.round(winH - screenY))));
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
  }, [visible]);

  React.useEffect(() => {
    if (!visible) return;
    void (async () => {
      const rawDefaults = await loadFinanceDefaultAccounts();
      defaultAccountsRef.current = sanitizeFinanceDefaultAccounts(rawDefaults, financeAccountsRef.current);
      await loadFinanceAccounts();
    })();
  }, [loadFinanceAccounts, visible]);

  React.useEffect(() => {
    if (!visible || !launchIntent) return;
    const list = financeAccountsRef.current;
    if (list.length === 0) return;
    applyLaunchIntent(launchIntent, list);
  }, [applyLaunchIntent, launchIntent, visible, financeAccounts.length]);

  React.useEffect(() => {
    setSentenceLedgerPreview(null);
  }, [sheetSentence]);

  const activeCategories =
    activeSheetTab === 'income' ? incomeCategories : activeSheetTab === 'expense' ? expenseCategories : expenseCategories;
  const selectedCategory = React.useMemo(
    () => activeCategories.find((item) => item.key === selectedCategoryKey) ?? activeCategories[0],
    [activeCategories, selectedCategoryKey],
  );
  const selectedAccount = React.useMemo(
    () => financeAccounts.find((account) => account.id === selectedAccountId) ?? financeAccounts[0] ?? null,
    [financeAccounts, selectedAccountId],
  );
  const transferFromAccount = React.useMemo(
    () => (transferFromAccountId ? financeAccounts.find((a) => a.id === transferFromAccountId) ?? null : null),
    [financeAccounts, transferFromAccountId],
  );
  const transferToAccount = React.useMemo(
    () => (transferToAccountId ? financeAccounts.find((a) => a.id === transferToAccountId) ?? null : null),
    [financeAccounts, transferToAccountId],
  );
  const transferSaveReady =
    transferFromAccount != null &&
    transferToAccount != null &&
    transferFromAccount.id !== transferToAccount.id &&
    transferFromAccount.sign_rule === 1 &&
    transferToAccount.sign_rule === 1;

  const sheetDateLabel = `${selectedHappenedAt.getMonth() + 1}月${selectedHappenedAt.getDate()}日`;
  const sheetTimeLabel = `${String(selectedHappenedAt.getHours()).padStart(2, '0')}:${String(selectedHappenedAt.getMinutes()).padStart(2, '0')}`;
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
  const amountDisplay = sheetAmount
    ? Number(sheetAmount).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '0.00';

  const keypadRows = React.useMemo(
    () => [
      ['1', '2', '3', 'backspace'],
      ['4', '5', '6', '+'],
      ['7', '8', '9', '-'],
      ['0', '.', 'done'],
    ],
    [],
  );

  const closeSheet = React.useCallback(() => {
    if (isSavingTransaction || isParsingSentence || isSentencePreviewBusy) return;
    setIsDatePickerVisible(false);
    setIsTimePickerVisible(false);
    setIsAccountPickerVisible(false);
    setAccountPickerTarget('sheet');
    onClose();
  }, [isParsingSentence, isSavingTransaction, isSentencePreviewBusy, onClose]);

  const handleSelectAccount = React.useCallback(
    (accountId: string) => {
      if (accountPickerTarget === 'transferFrom') {
        if (accountId === transferToAccountId) {
          Alert.alert('不能同一账户转账', '转出账户与入账账户不能相同，请选择其他账户。');
          return;
        }
        setTransferFromAccountId(accountId);
      } else if (accountPickerTarget === 'transferTo') {
        if (accountId === transferFromAccountId) {
          Alert.alert('不能同一账户转账', '转出账户与入账账户不能相同，请选择其他账户。');
          return;
        }
        setTransferToAccountId(accountId);
      } else {
        setSelectedAccountId(accountId);
      }
      setIsAccountPickerVisible(false);
      setAccountPickerTarget('sheet');
    },
    [accountPickerTarget, transferFromAccountId, transferToAccountId],
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
    if (key === 'done' || key === 'check') return;
    setSheetAmount((prev) => {
      if (key === '+' || key === '-') return prev;
      if (key === '.') return prev.includes('.') ? prev : `${prev || '0'}.`;
      const next = `${prev}${key}`;
      const normalized = next.replace(/^0+(?=\d)/, '');
      const [, decimals = ''] = normalized.split('.');
      if (decimals.length > 2) return prev;
      if (Number(normalized) > 99999999.99) return prev;
      return normalized;
    });
  }, []);

  const finishSaved = React.useCallback(() => {
    resetSheetForm('sentence');
    onClose();
    onSaved?.();
    notifyFinanceSheetSaved();
  }, [onClose, onSaved, resetSheetForm]);

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
    if (isSavingTransaction || isParsingSentence) return;
    if (activeSheetTab === 'transfer') {
      if (!transferFromAccount || !transferToAccount) {
        Alert.alert('请选择账户', '需要选择扣款账户与入账账户。');
        return;
      }
      if (transferFromAccount.id === transferToAccount.id) {
        Alert.alert('账户相同', '扣款与入账账户不能是同一个。');
        return;
      }
      if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
        Alert.alert('请输入金额', '转账金额需要大于 0。');
        return;
      }
      const ts = Date.now();
      const rnd = Math.random().toString(16).slice(2);
      const groupId = `tg_${ts}_${rnd}`;
      const happenedAt = selectedHappenedAt.toISOString();
      const noteTrim = sheetNote.trim() || null;
      const absAmount = amountNumber;
      const extraOut = JSON.stringify({
        manual: true,
        transfer_group_id: groupId,
        transfer_leg: 'out',
        counterparty_account_id: transferToAccount.id,
        counterparty_account_name: transferToAccount.name,
      });
      const extraIn = JSON.stringify({
        manual: true,
        transfer_group_id: groupId,
        transfer_leg: 'in',
        counterparty_account_id: transferFromAccount.id,
        counterparty_account_name: transferFromAccount.name,
      });
      const errFrom = await validateFinanceTransactionBeforeSave({
        accountId: transferFromAccount.id,
        transactionType: 'transfer',
        amount: absAmount,
        extraData: extraOut,
        accountName: transferFromAccount.name,
        uiLedgerBalance: transferFromAccount.balance,
      });
      const errTo = await validateFinanceTransactionBeforeSave({
        accountId: transferToAccount.id,
        transactionType: 'transfer',
        amount: absAmount,
        extraData: extraIn,
        accountName: transferToAccount.name,
        uiLedgerBalance: transferToAccount.balance,
      });
      if (errFrom || errTo) {
        Alert.alert('无法转账', errFrom ?? errTo ?? '转出或转入后账户余额不符合类型约束。');
        return;
      }
      try {
        setIsSavingTransaction(true);
        await createFinanceTransaction(
          {
            id: `ft_${ts}_out_${rnd}`,
            name: `转至「${transferToAccount.name}」`,
            happened_at: happenedAt,
            account_id: transferFromAccount.id,
            transaction_type: 'transfer',
            amount: absAmount,
            note: noteTrim,
            extra_data: extraOut,
          },
          { skipBalanceRecheck: true },
        );
        await createFinanceTransaction(
          {
            id: `ft_${ts}_in_${rnd}`,
            name: `转自「${transferFromAccount.name}」`,
            happened_at: happenedAt,
            account_id: transferToAccount.id,
            transaction_type: 'transfer',
            amount: absAmount,
            note: noteTrim,
            extra_data: extraIn,
          },
          { skipBalanceRecheck: true },
        );
        finishSaved();
      } catch (error) {
        Alert.alert('保存失败', error instanceof Error && error.message.trim() ? error.message : '转账记录保存失败，请稍后重试。');
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
      const includeInBudget = sheetIncludeInBudgetRef.current;
      const manualAccount = selectedAccount;

      setIsParsingSentence(true);
      try {
        const resolved = await resolveFinanceSentenceLine(line);
        if (!resolved.ok) {
          Alert.alert('无法识别', resolved.error);
          return;
        }
        const parsed = resolved.parsed;
        const defaults = sanitizeFinanceDefaultAccounts(defaultAccountsRef.current, financeAccountsRef.current);
        const account = manualAccount;
        const aiSuggestedAccount =
          resolved.source === 'ai'
            ? pickAccountForAutoLedger(financeAccountsRef.current, parsed, defaults)
            : null;
        if (!account) {
          Alert.alert('请选择账户', '需要选择一个可用账户后才能记账。');
          return;
        }
        const cat = pickSheetCategoryForParsed(parsed.transaction_type, parsed.category_label, expenseCategories, incomeCategories);
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
          Alert.alert('无法记账', boundsErr);
          return;
        }
        await createFinanceTransaction(
          {
            id: makeTimestampEntityId('ft_', 8),
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
              ...(aiSuggestedAccount && aiSuggestedAccount.id !== account.id
                ? { ai_suggested_account_id: aiSuggestedAccount.id, ai_suggested_account_name: aiSuggestedAccount.name }
                : {}),
              ...budgetExtraPatchForTransaction(transactionType, includeInBudget),
            }),
          },
          { skipBalanceRecheck: true },
        );
        finishSaved();
      } catch (error) {
        Alert.alert('保存失败', error instanceof Error && error.message.trim() ? error.message : '一句话记账处理失败，请稍后重试。');
      } finally {
        setIsParsingSentence(false);
      }
      return;
    }

    if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
      Alert.alert('请输入金额', '记账金额需要大于 0。');
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
      Alert.alert('无法记账', manualBoundsErr);
      return;
    }
    const title = sheetNote.trim() || selectedCategory?.label || (transactionType === 'income' ? '收入' : '支出');
    try {
      setIsSavingTransaction(true);
      await createFinanceTransaction(
        {
          id: makeTimestampEntityId('ft_', 8),
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
            ...budgetExtraPatchForTransaction(transactionType, sheetIncludeInBudgetRef.current),
          }),
        },
        { skipBalanceRecheck: true },
      );
      finishSaved();
    } catch (error) {
      Alert.alert('保存失败', error instanceof Error && error.message.trim() ? error.message : '手动记账保存失败，请稍后重试。');
    } finally {
      setIsSavingTransaction(false);
    }
  }, [
    activeSheetTab,
    amountNumber,
    expenseCategories,
    finishSaved,
    incomeCategories,
    isParsingSentence,
    isSavingTransaction,
    loadFinanceAccounts,
    onClose,
    onSaved,
    pickAccountForAutoLedger,
    resolveFinanceSentenceLine,
    selectedAccount,
    selectedCategory,
    selectedHappenedAt,
    sheetImageUris,
    sheetNote,
    sheetSentence,
    transferFromAccount,
    transferToAccount,
  ]);

  const styles = financeTransactionSheetStyles;

  return {
    styles,
    insets,
    isDark,
    bg,
    surface,
    text,
    subtle,
    outlineVariant,
    primary,
    secondary,
    tertiary,
    router,
    closeSheet,
    sheetKeyboardInset,
    sheetModalMaxHeight,
    sheetModalBodyMaxHeight,
    activeSheetTab,
    resetSheetForm,
    switchSheetTab,
    transferFromAccount,
    transferToAccount,
    transferFromAccountId,
    transferToAccountId,
    setTransferFromAccountId,
    setTransferToAccountId,
    setIsDatePickerVisible,
    setIsTimePickerVisible,
    setIsAccountPickerVisible,
    setAccountPickerTarget,
    accountIcon,
    amountDisplay,
    sheetDateLabel,
    sheetTimeLabel,
    sheetNote,
    setSheetNote,
    isDatePickerVisible,
    isTimePickerVisible,
    selectedHappenedAt,
    handleChangeSheetDate,
    handleChangeSheetTime,
    handleAmountKeyPress,
    handleSaveTransaction,
    canSaveTransaction,
    activeCategories,
    selectedCategoryKey,
    setSelectedCategoryKey,
    zhipuTxnReady,
    sheetSentence,
    setSheetSentence,
    sentenceLedgerPreview,
    isSentencePreviewBusy,
    handleSentenceLedgerPreview,
    canSaveSentence,
    isParsingSentence,
    sheetIncludeInBudget,
    applySheetIncludeInBudget,
    selectedAccount,
    sheetImageUris,
    setSheetImageUris,
    formatCurrencyWithDecimals,
    handleDatePickerChange,
    handleTimePickerChange,
    isAccountPickerVisible,
    accountPickerTarget,
    financeAccounts,
    handleSelectAccount,
    formatCurrencyBalanceForAccount,
    keypadRows,
    setSelectedHappenedAt,
    setSheetAmount,
    isSavingTransaction,
    openAddCategoryModal,
    closeAddCategoryModal,
    saveNewCategory,
    confirmDeleteCustomCategory,
    addModalVisible,
    newCategoryName,
    setNewCategoryName,
    newCategoryIcon,
    setNewCategoryIcon,
    isSavingCategory,
  };
}

export type FinanceTransactionSheetController = ReturnType<typeof useFinanceTransactionSheetController>;
