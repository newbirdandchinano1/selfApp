import {
  FoldPopIn,
  FoldRiseIn,
  useFoldMotionGate,
} from '@/components/review/fold-motion';
import { FinanceCategoryPicker } from '@/components/finance/finance-category-picker';
import { FinanceFoldSwitch } from '@/components/finance/finance-fold-switch';
import { Skeleton } from '@/components/ui';
import { Layout } from '@/constants/design-tokens';
import { useFinanceFoldTheme } from '@/constants/finance-fold-theme';
import { usePullToRefresh } from '@/hooks/use-pull-to-refresh';
import { toast, toUserMessage, Alert } from '@/lib/app-feedback';
import { formatFinanceHappenedAt, parseStoredDatetime } from '@/lib/api-mysql-datetime';
import { fetchFinanceCatalog } from '@/lib/finance-page-api';
import { useFinanceSheetCategories } from '@/lib/finance-transaction-sheet/use-sheet-categories';
import { notifyFinanceSheetSaved } from '@/lib/finance-transaction-sheet/controller';
import { FINANCE_SHEET_CATEGORY_ID_PREFIX } from '@/lib/repositories/finance/finance-sheet-category';
import {
  deleteFinanceTransaction,
  getFinanceTransactionById,
  updateFinanceTransaction,
} from '@/lib/repositories/finance/finance';
import type { FinanceAccountBalanceRow, FinanceTransactionRow } from '@/lib/repositories/finance/finance.types';
import {
  budgetExtraPatchForTransaction,
  isExpenseIncludedInBudget,
  isIncomeIncludedInBudget,
} from '@/lib/repositories/finance/finance-transaction-extra';
import { tryPersistFinanceTxnAiComment } from '@/lib/repositories/finance/finance-txn-ai-comment';
import { MaterialIcons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

type SheetTab = 'expense' | 'income' | 'transfer';

function parseExtraData(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    if (v && typeof v === 'object') return v as Record<string, unknown>;
  } catch {
    // ignore
  }
  return {};
}

function mergeExtraData(current: string | null, patch: Record<string, unknown>): string {
  const base = parseExtraData(current);
  return JSON.stringify({ ...base, ...patch });
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function formatMoney(value: number): string {
  const prefix = value < 0 ? '-¥' : '¥';
  return `${prefix}${Math.abs(value).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** 流水对账户账本余额的增减（与汇总口径一致：收入+、支出-） */
function balanceDeltaForTxn(type: SheetTab, absAmount: number): number {
  if (!Number.isFinite(absAmount) || absAmount <= 0) return 0;
  if (type === 'income') return absAmount;
  if (type === 'expense') return -absAmount;
  return 0;
}

export default function EditFinanceTransactionScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id: rawId } = useLocalSearchParams<{ id: string }>();
  const id = typeof rawId === 'string' ? rawId : Array.isArray(rawId) ? rawId[0] : '';

  const { ff, isDark, fonts: ffFonts } = useFinanceFoldTheme();
  const { animate: foldAnimate } = useFoldMotionGate();
  const motionOn = foldAnimate;

  const bg = ff.paper;
  const card = isDark ? ff.paper2 : ff.card;
  const text = ff.ink;
  const subtle = ff.muted;
  const faint = ff.faint;
  const line = ff.line;
  const pine = ff.pine;
  const clay = ff.clay;
  const headerScrim = isDark ? 'rgba(23,43,36,0.94)' : 'rgba(243,238,228,0.94)';
  const chipBg = isDark ? ff.paper2 : '#EFEADD';
  const aiBg = isDark ? 'rgba(224,176,114,0.14)' : '#F4EAD9';
  const aiBorder = isDark ? 'rgba(224,176,114,0.28)' : '#E8D4B6';
  const aiInk = isDark ? ff.amberInk : '#6E6455';
  const aiTitle = isDark ? ff.amberInk : '#6E5127';

  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [savePop, setSavePop] = React.useState(false);
  const [regenBusy, setRegenBusy] = React.useState(false);
  const [categorySheetOpen, setCategorySheetOpen] = React.useState(false);
  const [row, setRow] = React.useState<FinanceTransactionRow | null>(null);
  const [accounts, setAccounts] = React.useState<FinanceAccountBalanceRow[]>([]);

  const [tab, setTab] = React.useState<SheetTab>('expense');
  const [nameDraft, setNameDraft] = React.useState('');
  const [noteDraft, setNoteDraft] = React.useState('');
  const [amountDraft, setAmountDraft] = React.useState('');
  const [happenedAt, setHappenedAt] = React.useState(() => new Date());
  const [accountId, setAccountId] = React.useState<string | null>(null);
  const [categoryKey, setCategoryKey] = React.useState('food');
  const [accountPickerOpen, setAccountPickerOpen] = React.useState(false);
  const [datePickerOpen, setDatePickerOpen] = React.useState(false);
  const [timePickerOpen, setTimePickerOpen] = React.useState(false);
  const [includeInBudget, setIncludeInBudget] = React.useState(true);
  const includeInBudgetRef = React.useRef(true);
  const budgetTouchedByUserRef = React.useRef(false);
  const [aiComment, setAiComment] = React.useState('');

  const applyIncludeInBudget = React.useCallback((value: boolean | ((prev: boolean) => boolean)) => {
    setIncludeInBudget((prev) => {
      const next = typeof value === 'function' ? value(prev) : value;
      includeInBudgetRef.current = next;
      return next;
    });
  }, []);

  const userToggleIncludeInBudget = React.useCallback(
    (next: boolean) => {
      budgetTouchedByUserRef.current = true;
      applyIncludeInBudget(next);
    },
    [applyIncludeInBudget],
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
    customCategoriesReady,
  } = useFinanceSheetCategories({
    primary: pine,
    secondary: ff.income,
    tertiary: ff.amber,
    subtle,
  });

  const expenseCategoriesRef = React.useRef(expenseCategories);
  const incomeCategoriesRef = React.useRef(incomeCategories);
  expenseCategoriesRef.current = expenseCategories;
  incomeCategoriesRef.current = incomeCategories;

  const activeCategories = tab === 'income' ? incomeCategories : tab === 'expense' ? expenseCategories : [];

  const selectedCategory = React.useMemo(() => {
    const list = tab === 'income' ? incomeCategories : expenseCategories;
    return list.find((c) => c.key === categoryKey) ?? list[0];
  }, [categoryKey, expenseCategories, incomeCategories, tab]);

  const selectedAccount = React.useMemo(
    () => accounts.find((a) => a.id === accountId) ?? null,
    [accountId, accounts],
  );

  const load = React.useCallback(
    async (silent = false) => {
      if (!id) {
        if (!silent) setLoading(false);
        setRow(null);
        return;
      }
      if (!silent) setLoading(true);
      try {
        const [txn, catalog] = await Promise.all([
          getFinanceTransactionById(id),
          fetchFinanceCatalog({ serverFallback: true }),
        ]);
        const accRows = catalog.accounts;
        setAccounts(accRows);
        if (!txn) {
          setRow(null);
          return;
        }
        setRow(txn);
        const ttype =
          txn.transaction_type === 'income' ||
          txn.transaction_type === 'expense' ||
          txn.transaction_type === 'transfer'
            ? txn.transaction_type
            : 'expense';
        setTab(ttype);
        setNameDraft(txn.name?.trim() ?? '');
        setNoteDraft(txn.note?.trim() ?? '');
        setAmountDraft(Math.abs(Number(txn.amount)).toFixed(2));
        setAiComment(txn.ai_comment?.trim() ?? '');
        const d = parseStoredDatetime(txn.happened_at);
        setHappenedAt(Number.isNaN(d.getTime()) ? new Date() : d);
        setAccountId(txn.account_id);

        const extra = parseExtraData(txn.extra_data);
        const ck = typeof extra.category_key === 'string' ? extra.category_key : null;
        const cl = typeof extra.category_label === 'string' ? extra.category_label.trim() : '';
        const pool = ttype === 'income' ? incomeCategoriesRef.current : expenseCategoriesRef.current;
        if (ck) {
          const keys = new Set(pool.map((c) => c.key));
          if (keys.has(ck) || ck.startsWith(FINANCE_SHEET_CATEGORY_ID_PREFIX)) {
            setCategoryKey(ck);
          } else if (cl) {
            const byLabel = pool.find((c) => c.label === cl);
            setCategoryKey(byLabel?.key ?? (ttype === 'income' ? 'other-income' : 'other'));
          } else {
            setCategoryKey(ttype === 'income' ? 'other-income' : 'other');
          }
        } else if (cl) {
          const byLabel = pool.find((c) => c.label === cl);
          setCategoryKey(byLabel?.key ?? (ttype === 'income' ? 'other-income' : 'other'));
        } else {
          setCategoryKey(ttype === 'income' ? 'salary' : 'food');
        }

        if (silent) budgetTouchedByUserRef.current = false;
        if (!budgetTouchedByUserRef.current) {
          const includedInBudget =
            ttype === 'expense'
              ? isExpenseIncludedInBudget(txn.extra_data)
              : ttype === 'income'
                ? isIncomeIncludedInBudget(txn.extra_data)
                : true;
          applyIncludeInBudget(includedInBudget);
        }
      } catch (e) {
        console.warn('Failed to load finance transaction:', e);
        setRow(null);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [applyIncludeInBudget, id],
  );

  const { refreshControl } = usePullToRefresh(() => load(true));

  React.useEffect(() => {
    budgetTouchedByUserRef.current = false;
  }, [id]);

  React.useEffect(() => {
    void load();
  }, [load]);

  React.useEffect(() => {
    if (!customCategoriesReady) return;
    const pool = tab === 'income' ? incomeCategories : expenseCategories;
    if (pool.some((c) => c.key === categoryKey)) return;
    if (categoryKey.startsWith(FINANCE_SHEET_CATEGORY_ID_PREFIX)) {
      setCategoryKey(tab === 'income' ? 'other-income' : 'other');
      return;
    }
    setCategoryKey(tab === 'income' ? 'salary' : 'food');
  }, [categoryKey, customCategoriesReady, expenseCategories, incomeCategories, tab]);

  const absAmount = React.useMemo(() => {
    const n = parseFloat(amountDraft.trim().replace(/,/g, ''));
    return Number.isFinite(n) ? n : 0;
  }, [amountDraft]);

  const canSave = Boolean(row && selectedAccount && absAmount > 0 && !saving);

  const preview = React.useMemo(() => {
    if (!row || !selectedAccount) {
      return { balanceLabel: '—', budgetLabel: '—', surplusLabel: '—' };
    }
    const oldType: SheetTab =
      row.transaction_type === 'income' ||
      row.transaction_type === 'expense' ||
      row.transaction_type === 'transfer'
        ? row.transaction_type
        : 'expense';
    const oldAbs = Math.abs(Number(row.amount) || 0);
    const oldDelta = balanceDeltaForTxn(oldType, oldAbs);
    const newDelta = balanceDeltaForTxn(tab, absAmount);

    let previewBalance = selectedAccount.balance;
    if (selectedAccount.id === row.account_id) {
      previewBalance = selectedAccount.balance - oldDelta + newDelta;
    } else {
      previewBalance = selectedAccount.balance + newDelta;
    }

    const catLabel = tab === 'transfer' ? '转账' : selectedCategory?.label ?? '未分类';
    const budgetLabel =
      tab === 'transfer'
        ? '不计入预算'
        : includeInBudget
          ? `计入 · ${catLabel}`
          : `不计入 · ${catLabel}`;

    const impact = newDelta - (selectedAccount.id === row.account_id ? oldDelta : 0);
    const surplusLabel =
      tab === 'transfer'
        ? '转账不影响结余'
        : impact === 0
          ? '无变化'
          : impact > 0
            ? `结余 ${formatMoney(impact)}`
            : `结余 ${formatMoney(impact)}`;

    return {
      balanceLabel: formatMoney(previewBalance),
      budgetLabel,
      surplusLabel,
    };
  }, [absAmount, includeInBudget, row, selectedAccount, selectedCategory?.label, tab]);

  const happenedLabel = React.useMemo(() => {
    const y = happenedAt.getFullYear();
    const m = pad2(happenedAt.getMonth() + 1);
    const d = pad2(happenedAt.getDate());
    const hh = pad2(happenedAt.getHours());
    const mm = pad2(happenedAt.getMinutes());
    return `${y}.${m}.${d} · ${hh}:${mm}`;
  }, [happenedAt]);

  const onSave = React.useCallback(async () => {
    if (saving) return;
    if (!row || !selectedAccount) {
      toast.warn('缺少交易或账户信息。');
      return;
    }
    if (!Number.isFinite(absAmount) || absAmount <= 0) {
      toast.warn('请输入大于 0 的金额。');
      return;
    }
    const title =
      nameDraft.trim() ||
      (tab !== 'transfer' ? selectedCategory?.label : null) ||
      (tab === 'income' ? '收入' : tab === 'expense' ? '支出' : '转账');
    const signedAmount = selectedAccount.sign_rule > 0 ? absAmount : -absAmount;

    try {
      setSaving(true);
      setSavePop(true);
      const extraPatch: Record<string, unknown> = {
        manual: true,
        category_key: tab === 'transfer' ? null : selectedCategory?.key ?? null,
        category_label: tab === 'transfer' ? null : selectedCategory?.label ?? null,
        ...budgetExtraPatchForTransaction(tab, includeInBudgetRef.current),
      };
      const mergedExtra = mergeExtraData(row.extra_data, extraPatch);
      await updateFinanceTransaction(row.id, {
        name: title,
        happened_at: formatFinanceHappenedAt(happenedAt),
        account_id: selectedAccount.id,
        transaction_type: tab,
        amount: signedAmount,
        note: noteDraft.trim() || null,
        extra_data: mergedExtra,
      });
      setRow((prev) => (prev ? { ...prev, extra_data: mergedExtra } : prev));
      notifyFinanceSheetSaved();
      const existingAiComment = row.ai_comment?.trim() ?? '';
      if (tab !== 'transfer' && !existingAiComment) {
        await tryPersistFinanceTxnAiComment(row.id, {
          name: title,
          happened_at: formatFinanceHappenedAt(happenedAt),
          transaction_type: tab,
          amount: signedAmount,
          note: noteDraft.trim() || null,
          accountLabel: selectedAccount.name,
          categoryLabel: selectedCategory?.label ?? '未分类',
        });
      }
      toast.success('已保存');
      router.back();
    } catch (e) {
      console.warn('Failed to update finance transaction:', e);
      toast.error(toUserMessage(e, '请检查金额与账户类型后重试。'));
    } finally {
      setSaving(false);
      setTimeout(() => setSavePop(false), 400);
    }
  }, [
    absAmount,
    happenedAt,
    nameDraft,
    noteDraft,
    router,
    row,
    saving,
    selectedAccount,
    selectedCategory,
    tab,
  ]);

  const onRegenAi = React.useCallback(async () => {
    if (!row || !selectedAccount || regenBusy || tab === 'transfer') return;
    if (!Number.isFinite(absAmount) || absAmount <= 0) {
      toast.warn('请输入大于 0 的金额。');
      return;
    }
    try {
      setRegenBusy(true);
      const signedAmount = selectedAccount.sign_rule > 0 ? absAmount : -absAmount;
      const title =
        nameDraft.trim() || (tab === 'income' ? '收入' : tab === 'expense' ? '支出' : '转账');
      const result = await tryPersistFinanceTxnAiComment(row.id, {
        name: title,
        happened_at: formatFinanceHappenedAt(happenedAt),
        transaction_type: tab,
        amount: signedAmount,
        note: noteDraft.trim() || null,
        accountLabel: selectedAccount.name,
        categoryLabel: selectedCategory?.label ?? '未分类',
      });
      if (result.ok) {
        setAiComment(result.comment);
        toast.success('评价已更新');
      } else {
        toast.warn('暂时无法生成评价');
      }
    } catch (e) {
      console.warn('Failed to refresh finance AI comment:', e);
      toast.error(toUserMessage(e, '重新生成失败'));
    } finally {
      setRegenBusy(false);
    }
  }, [
    absAmount,
    happenedAt,
    nameDraft,
    noteDraft,
    regenBusy,
    row,
    selectedAccount,
    selectedCategory,
    tab,
  ]);

  const onDelete = React.useCallback(() => {
    if (!row || deleting) return;
    Alert.alert('删除记录', `确定删除「${row.name?.trim() || '该笔记录'}」吗？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          try {
            setDeleting(true);
            await deleteFinanceTransaction(row.id);
            notifyFinanceSheetSaved();
            toast.success('已删除');
            router.back();
          } catch (e) {
            console.warn('Failed to delete finance transaction:', e);
            toast.error(toUserMessage(e, '删除失败，请稍后重试。'));
          } finally {
            setDeleting(false);
          }
        },
      },
    ]);
  }, [deleting, row, router]);

  const amountColor = tab === 'income' ? ff.income : tab === 'expense' ? clay : pine;

  const renderHeader = (opts?: { showSave?: boolean }) => (
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
          <Text style={[styles.headerTitle, { color: text, fontFamily: ffFonts.serif }]}>编辑收支</Text>
          <Text style={[styles.headerSub, { color: subtle }]}>TRANSACTION · EDIT</Text>
        </View>
        {opts?.showSave !== false ? (
          <Pressable
            onPress={() => void onSave()}
            disabled={!canSave}
            style={({ pressed }) => [
              styles.pillSave,
              {
                backgroundColor: canSave ? pine : isDark ? ff.paper2 : '#EAE6DC',
                borderColor: canSave ? pine : line,
                opacity: canSave ? 1 : 0.7,
              },
              pressed && canSave && { opacity: 0.9, transform: [{ scale: 0.96 }] },
            ]}
            accessibilityRole="button"
            accessibilityLabel="保存">
            {savePop ? (
              <FoldPopIn animate={foldAnimate} delayMs={0} duration={320}>
                <Text style={[styles.pillSaveText, { color: canSave ? ff.onPine : faint }]}>
                  {saving ? '…' : '保存'}
                </Text>
              </FoldPopIn>
            ) : (
              <Text style={[styles.pillSaveText, { color: canSave ? ff.onPine : faint }]}>
                {saving ? '…' : '保存'}
              </Text>
            )}
          </Pressable>
        ) : (
          <View style={{ width: 48 }} />
        )}
      </View>
    </View>
  );

  if (!id) {
    return (
      <SafeAreaView style={[styles.root, { backgroundColor: bg }]} edges={['left', 'right']}>
        {renderHeader({ showSave: false })}
        <View style={styles.centered}>
          <Text style={{ color: text, fontSize: 15, fontWeight: '600' }}>缺少记录 ID</Text>
          <Pressable onPress={() => router.back()} style={{ marginTop: 16, padding: 12 }}>
            <Text style={{ color: pine, fontWeight: '700' }}>返回</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={[styles.root, { backgroundColor: bg }]} edges={['left', 'right']}>
        {renderHeader({ showSave: false })}
        <View style={styles.loadingWrap}>
          <Skeleton width="90%" height={56} borderRadius={14} />
          <Skeleton width="90%" height={140} borderRadius={18} style={{ marginTop: 10 }} />
          <Skeleton width="90%" height={88} borderRadius={18} style={{ marginTop: 10 }} />
        </View>
      </SafeAreaView>
    );
  }

  if (!row) {
    return (
      <SafeAreaView style={[styles.root, { backgroundColor: bg }]} edges={['left', 'right']}>
        {renderHeader({ showSave: false })}
        <View style={styles.centered}>
          <Text style={{ color: text, fontSize: 15, fontWeight: '600' }}>未找到该笔收支</Text>
          <Pressable onPress={() => router.back()} style={{ marginTop: 16, padding: 12 }}>
            <Text style={{ color: pine, fontWeight: '700' }}>返回</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: bg }]} edges={['left', 'right']}>
      {renderHeader()}

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          refreshControl={refreshControl}
          contentContainerStyle={[
            styles.scrollContent,
            {
              paddingBottom: Math.max(28, insets.bottom + 20),
              maxWidth: Layout.contentMaxWidth,
              alignSelf: 'center',
              width: '100%',
            },
          ]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}>
          <FoldRiseIn animate={motionOn} index={0} staggerMs={45} fromY={11}>
            <View style={[styles.segment, { backgroundColor: chipBg, borderColor: line }]}>
              {(['expense', 'income', 'transfer'] as const).map((t) => {
                const active = tab === t;
                const lab = t === 'expense' ? '支出' : t === 'income' ? '收入' : '转账';
                return (
                  <Pressable
                    key={t}
                    onPress={() => setTab(t)}
                    style={({ pressed }) => [
                      styles.segmentItem,
                      active && {
                        backgroundColor: isDark ? ff.cardSoft : '#FFFCF5',
                        shadowColor: '#2B352D',
                        shadowOpacity: isDark ? 0 : 0.08,
                        shadowRadius: 8,
                        shadowOffset: { width: 0, height: 3 },
                        elevation: active && !isDark ? 2 : 0,
                      },
                      pressed && { opacity: 0.9 },
                    ]}>
                    <Text
                      style={[
                        styles.segmentText,
                        { color: active ? pine : subtle, fontWeight: active ? '800' : '600' },
                      ]}>
                      {lab}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </FoldRiseIn>

          <FoldRiseIn animate={motionOn} index={1} staggerMs={45} fromY={11}>
            <View style={styles.amountBlock}>
              <Text style={[styles.amountCur, { color: ff.amberInk, fontFamily: ffFonts.mono }]}>¥</Text>
              <TextInput
                value={amountDraft}
                onChangeText={setAmountDraft}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor={faint}
                style={[
                  styles.amountInput,
                  { color: amountColor, fontFamily: ffFonts.mono },
                ]}
              />
            </View>
          </FoldRiseIn>

          <FoldRiseIn animate={motionOn} index={2} staggerMs={45} fromY={11}>
            <View style={[styles.formCard, { backgroundColor: card, borderColor: line }]}>
              <Pressable
                onPress={() => setAccountPickerOpen(true)}
                style={[styles.inputLine, { borderBottomColor: line }]}>
                <Text style={[styles.inputLab, { color: subtle }]}>账户</Text>
                <Text
                  style={[styles.inputVal, { color: selectedAccount ? text : faint }]}
                  numberOfLines={1}>
                  {selectedAccount?.name ?? '选择账户'}
                </Text>
                <MaterialIcons name="chevron-right" size={16} color={faint} />
              </Pressable>

              {tab !== 'transfer' ? (
                <Pressable
                  onPress={() => setCategorySheetOpen(true)}
                  style={[styles.inputLine, { borderBottomColor: line }]}>
                  <Text style={[styles.inputLab, { color: subtle }]}>分类</Text>
                  <Text style={[styles.inputVal, { color: text }]} numberOfLines={1}>
                    {selectedCategory?.label ?? '选择分类'}
                  </Text>
                  <View style={[styles.autoTag, { backgroundColor: isDark ? ff.sage2 : '#EEF2EE' }]}>
                    <Text style={[styles.autoTagText, { color: isDark ? ff.sage : '#6A7F72' }]}>自动</Text>
                  </View>
                  <MaterialIcons name="chevron-right" size={16} color={faint} />
                </Pressable>
              ) : null}

              <View style={[styles.inputLine, { borderBottomColor: line }]}>
                <Text style={[styles.inputLab, { color: subtle }]}>标题</Text>
                <TextInput
                  value={nameDraft}
                  onChangeText={setNameDraft}
                  placeholder={tab === 'income' ? '例如：工资' : '例如：午餐'}
                  placeholderTextColor={faint}
                  style={[styles.inputVal, { color: text }]}
                />
                <MaterialIcons name="edit" size={12} color={faint} />
              </View>

              <View style={[styles.inputLine, { borderBottomColor: line }]}>
                <Text style={[styles.inputLab, { color: subtle }]}>备注</Text>
                <TextInput
                  value={noteDraft}
                  onChangeText={setNoteDraft}
                  placeholder="选填"
                  placeholderTextColor={faint}
                  style={[styles.inputVal, { color: noteDraft ? text : faint, fontSize: 13 }]}
                />
                <MaterialIcons name="edit" size={12} color={faint} />
              </View>

              <Pressable
                onPress={() => {
                  setTimePickerOpen(false);
                  setDatePickerOpen(true);
                }}
                style={[styles.inputLine, { borderBottomWidth: 0 }]}>
                <Text style={[styles.inputLab, { color: subtle }]}>时间</Text>
                <Text style={[styles.inputVal, { color: text, fontFamily: ffFonts.mono }]}>
                  {happenedLabel}
                </Text>
                <MaterialIcons name="chevron-right" size={16} color={faint} />
              </Pressable>
            </View>
          </FoldRiseIn>

          {tab === 'expense' || tab === 'income' ? (
            <FoldRiseIn animate={motionOn} index={3} staggerMs={45} fromY={11}>
              <View style={[styles.formCard, styles.budgetCard, { backgroundColor: card, borderColor: line }]}>
                <View style={{ flex: 1, paddingRight: 10 }}>
                  <Text style={[styles.budgetTitle, { color: text }]}>计入本月预算</Text>
                  <Text style={[styles.budgetHint, { color: faint }]}>
                    {includeInBudget
                      ? tab === 'income'
                        ? '计入后增加本月预算与今日可用'
                        : `关闭后不计入${selectedCategory?.label ?? '分类'}预算与进度条`
                      : tab === 'income'
                        ? '仍记为收入，不参与预算与今日可用'
                        : '仍记为支出，不参与预算与今日可用'}
                  </Text>
                </View>
                <FinanceFoldSwitch
                  value={includeInBudget}
                  onValueChange={userToggleIncludeInBudget}
                  accessibilityLabel="计入本月预算"
                />
              </View>
            </FoldRiseIn>
          ) : null}

          <FoldRiseIn animate={motionOn} index={4} staggerMs={45} fromY={11}>
            <View style={[styles.formCard, { backgroundColor: card, borderColor: line }]}>
              <View style={styles.previewHead}>
                <Text style={[styles.previewTitle, { color: text }]}>保存后的变化</Text>
                <View style={[styles.previewTag, { backgroundColor: isDark ? ff.paper2 : '#EEE8DC' }]}>
                  <Text style={[styles.previewTagText, { color: subtle }]}>预览</Text>
                </View>
              </View>
              <View style={[styles.previewRow, { borderBottomColor: line }]}>
                <Text style={[styles.previewLab, { color: subtle }]}>
                  {selectedAccount?.name ?? '账户'}余额
                </Text>
                <Text style={[styles.previewVal, { color: text, fontFamily: ffFonts.mono }]}>
                  {preview.balanceLabel}
                </Text>
              </View>
              <View style={[styles.previewRow, { borderBottomColor: line }]}>
                <Text style={[styles.previewLab, { color: subtle }]}>
                  {tab === 'transfer' ? '预算归属' : `本月${selectedCategory?.label ?? '分类'}预算`}
                </Text>
                <Text style={[styles.previewVal, { color: text, fontFamily: ffFonts.mono }]}>
                  {preview.budgetLabel}
                </Text>
              </View>
              <View style={[styles.previewRow, { borderBottomWidth: 0 }]}>
                <Text style={[styles.previewLab, { color: subtle }]}>本月结余</Text>
                <Text style={[styles.previewVal, { color: text, fontFamily: ffFonts.mono }]}>
                  {preview.surplusLabel}
                </Text>
              </View>
            </View>
          </FoldRiseIn>

          {tab !== 'transfer' ? (
            <FoldRiseIn animate={motionOn} index={5} staggerMs={45} fromY={11}>
              <View style={[styles.aiEval, { backgroundColor: aiBg, borderColor: aiBorder }]}>
                <View style={styles.aiHead}>
                  <MaterialIcons name="auto-awesome" size={14} color={ff.amber} />
                  <Text style={[styles.aiHeadText, { color: aiTitle }]}>AI 评价</Text>
                  <Pressable
                    onPress={() => void onRegenAi()}
                    disabled={regenBusy}
                    hitSlop={8}
                    style={({ pressed }) => [
                      styles.regenBtn,
                      (pressed || regenBusy) && { opacity: 0.7 },
                    ]}>
                    {regenBusy ? (
                      <ActivityIndicator size="small" color={ff.amberInk} />
                    ) : (
                      <>
                        <MaterialIcons name="sync" size={12} color={ff.amberInk} />
                        <Text style={[styles.regenText, { color: ff.amberInk }]}>重新生成</Text>
                      </>
                    )}
                  </Pressable>
                </View>
                <Text style={[styles.aiBody, { color: aiInk }]}>
                  {aiComment ||
                    '暂无 AI 评价。保存本笔（尚无评价时）会尝试生成；也可点右上角重新生成。'}
                </Text>
              </View>
            </FoldRiseIn>
          ) : (
            <FoldRiseIn animate={motionOn} index={5} staggerMs={45} fromY={11}>
              <View style={[styles.helper, { backgroundColor: isDark ? ff.paper2 : '#F5F0E5', borderColor: line }]}>
                <MaterialIcons name="info-outline" size={14} color={ff.amber} />
                <Text style={[styles.helperText, { color: subtle }]}>
                  转账记录可修改金额、时间与备注；分类与预算开关不适用。
                </Text>
              </View>
            </FoldRiseIn>
          )}

          <FoldRiseIn animate={motionOn} index={6} staggerMs={45} fromY={8}>
            <Pressable
              onPress={onDelete}
              disabled={deleting}
              style={({ pressed }) => [
                styles.dangerLink,
                (pressed || deleting) && { opacity: 0.7 },
              ]}
              accessibilityRole="button"
              accessibilityLabel="删除这笔流水">
              <MaterialIcons name="delete-outline" size={16} color={clay} />
              <Text style={[styles.dangerText, { color: clay }]}>
                {deleting ? '删除中…' : '删除这笔流水'}
              </Text>
            </Pressable>
            <Text style={[styles.miniNote, { color: faint }]}>
              保存后会同步资产余额、预算与统计 · 不会回溯修改已归档月份
            </Text>
          </FoldRiseIn>
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal
        visible={categorySheetOpen && tab !== 'transfer'}
        transparent
        animationType="fade"
        onRequestClose={() => setCategorySheetOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setCategorySheetOpen(false)}>
          <Pressable
            style={[styles.categorySheet, { backgroundColor: card, borderColor: line }]}
            onPress={(e) => e.stopPropagation()}>
            <Text style={[styles.sheetTitle, { color: text }]}>选择分类</Text>
            <FinanceCategoryPicker
              categories={activeCategories}
              selectedKey={categoryKey}
              onSelectKey={(key) => {
                setCategoryKey(key);
                setCategorySheetOpen(false);
              }}
              transactionType={tab === 'income' ? 'income' : 'expense'}
              singleRowCollapsed={false}
              subtle={subtle}
              primary={pine}
              text={text}
              surface={card}
              outlineVariant={line}
              styles={categoryPickerStyles}
              onAddPress={() => openAddCategoryModal(tab === 'income' ? 'income' : 'expense')}
              onLongPressCustom={confirmDeleteCustomCategory}
              addModalVisible={addModalVisible}
              newCategoryName={newCategoryName}
              onChangeNewCategoryName={setNewCategoryName}
              newCategoryIcon={newCategoryIcon}
              onChangeNewCategoryIcon={setNewCategoryIcon}
              isSavingCategory={isSavingCategory}
              onCloseAddModal={closeAddCategoryModal}
              onSaveNewCategory={() => void saveNewCategory(setCategoryKey)}
            />
            <Pressable
              onPress={() => setCategorySheetOpen(false)}
              style={[styles.modalDone, { backgroundColor: pine, marginTop: 12 }]}>
              <Text style={{ color: ff.onPine, fontWeight: '700' }}>完成</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={accountPickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setAccountPickerOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setAccountPickerOpen(false)}>
          <Pressable
            style={[styles.accountSheet, { backgroundColor: card, borderColor: line }]}
            onPress={(e) => e.stopPropagation()}>
            <Text style={[styles.sheetTitle, { color: text }]}>选择账户</Text>
            <ScrollView style={{ maxHeight: 360 }}>
              {accounts.map((acc) => {
                const active = acc.id === accountId;
                return (
                  <Pressable
                    key={acc.id}
                    onPress={() => {
                      setAccountId(acc.id);
                      setAccountPickerOpen(false);
                    }}
                    style={({ pressed }) => [
                      styles.accountRow,
                      { borderBottomColor: line },
                      active && { backgroundColor: isDark ? ff.sage2 : 'rgba(30,64,52,0.06)' },
                      pressed && { opacity: 0.88 },
                    ]}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: text, fontSize: 15, fontWeight: '600' }}>{acc.name}</Text>
                      <Text style={{ color: faint, fontSize: 12, marginTop: 2, fontFamily: ffFonts.mono }}>
                        {formatMoney(acc.balance)}
                      </Text>
                    </View>
                    {active ? <MaterialIcons name="check" size={20} color={pine} /> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
            <Pressable
              onPress={() => setAccountPickerOpen(false)}
              style={[styles.modalDone, { backgroundColor: pine, marginTop: 12 }]}>
              <Text style={{ color: ff.onPine, fontWeight: '700' }}>完成</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {Platform.OS === 'ios' ? (
        <>
          <Modal visible={datePickerOpen} transparent animationType="fade" onRequestClose={() => setDatePickerOpen(false)}>
            <View style={styles.pickerOverlay}>
              <Pressable style={StyleSheet.absoluteFill} onPress={() => setDatePickerOpen(false)} />
              <View style={[styles.pickerCard, { backgroundColor: card, borderColor: line }]}>
                <View style={[styles.pickerHead, { borderBottomColor: line }]}>
                  <Text style={[styles.sheetTitle, { color: text, marginBottom: 0 }]}>选择日期</Text>
                  <Pressable
                    onPress={() => {
                      setDatePickerOpen(false);
                      setTimePickerOpen(true);
                    }}
                    hitSlop={8}>
                    <Text style={{ color: pine, fontWeight: '700', fontSize: 13 }}>下一步 · 时间</Text>
                  </Pressable>
                </View>
                <DateTimePicker
                  value={happenedAt}
                  mode="date"
                  display="spinner"
                  locale="zh-CN"
                  themeVariant={isDark ? 'dark' : 'light'}
                  textColor={text}
                  onChange={(_, date) => {
                    if (!date) return;
                    setHappenedAt((prev) => {
                      const n = new Date(prev);
                      n.setFullYear(date.getFullYear(), date.getMonth(), date.getDate());
                      return n;
                    });
                  }}
                  style={styles.nativePicker}
                />
                <View style={styles.pickerFooter}>
                  <Pressable
                    onPress={() => setHappenedAt(new Date())}
                    style={[styles.pickerAction, { borderColor: line, backgroundColor: chipBg }]}>
                    <Text style={{ color: text, fontWeight: '700' }}>今天</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      setDatePickerOpen(false);
                      setTimePickerOpen(true);
                    }}
                    style={[styles.pickerAction, { borderColor: pine, backgroundColor: pine }]}>
                    <Text style={{ color: ff.onPine, fontWeight: '700' }}>选时间</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          </Modal>

          <Modal visible={timePickerOpen} transparent animationType="fade" onRequestClose={() => setTimePickerOpen(false)}>
            <View style={styles.pickerOverlay}>
              <Pressable style={StyleSheet.absoluteFill} onPress={() => setTimePickerOpen(false)} />
              <View style={[styles.pickerCard, { backgroundColor: card, borderColor: line }]}>
                <View style={[styles.pickerHead, { borderBottomColor: line }]}>
                  <Text style={[styles.sheetTitle, { color: text, marginBottom: 0 }]}>选择时间</Text>
                  <Pressable onPress={() => setTimePickerOpen(false)} hitSlop={8}>
                    <MaterialIcons name="close" size={20} color={subtle} />
                  </Pressable>
                </View>
                <DateTimePicker
                  value={happenedAt}
                  mode="time"
                  display="spinner"
                  locale="zh-CN"
                  themeVariant={isDark ? 'dark' : 'light'}
                  textColor={text}
                  onChange={(_, date) => {
                    if (!date) return;
                    setHappenedAt((prev) => {
                      const n = new Date(prev);
                      n.setHours(date.getHours(), date.getMinutes(), 0, 0);
                      return n;
                    });
                  }}
                  style={styles.nativePicker}
                />
                <View style={styles.pickerFooter}>
                  <Pressable
                    onPress={() => setHappenedAt(new Date())}
                    style={[styles.pickerAction, { borderColor: line, backgroundColor: chipBg }]}>
                    <Text style={{ color: text, fontWeight: '700' }}>现在</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setTimePickerOpen(false)}
                    style={[styles.pickerAction, { borderColor: pine, backgroundColor: pine }]}>
                    <Text style={{ color: ff.onPine, fontWeight: '700' }}>确定</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          </Modal>
        </>
      ) : (
        <>
          {datePickerOpen ? (
            <DateTimePicker
              value={happenedAt}
              mode="date"
              display="default"
              onChange={(_, date) => {
                setDatePickerOpen(false);
                if (!date) return;
                setHappenedAt((prev) => {
                  const n = new Date(prev);
                  n.setFullYear(date.getFullYear(), date.getMonth(), date.getDate());
                  return n;
                });
                setTimeout(() => setTimePickerOpen(true), 240);
              }}
            />
          ) : null}
          {timePickerOpen ? (
            <DateTimePicker
              value={happenedAt}
              mode="time"
              display="default"
              onChange={(_, date) => {
                setTimePickerOpen(false);
                if (!date) return;
                setHappenedAt((prev) => {
                  const n = new Date(prev);
                  n.setHours(date.getHours(), date.getMinutes(), 0, 0);
                  return n;
                });
              }}
            />
          ) : null}
        </>
      )}
    </SafeAreaView>
  );
}

const categoryPickerStyles = StyleSheet.create({
  categoryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 4 },
  categoryItem: { width: '22%', alignItems: 'center' },
  categoryIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },
  categoryLabel: { marginTop: 6, fontSize: 11, fontWeight: '600', textAlign: 'center' },
});

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  header: { borderBottomWidth: StyleSheet.hairlineWidth, zIndex: 60 },
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
  pillSave: {
    minWidth: 48,
    height: 27,
    paddingHorizontal: 12,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillSaveText: { fontSize: 12, fontWeight: '700' },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 10,
    gap: 8,
  },
  segment: {
    flexDirection: 'row',
    gap: 3,
    borderRadius: 11,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 3,
  },
  segmentItem: {
    flex: 1,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentText: { fontSize: 13 },
  amountBlock: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingVertical: 6,
    gap: 4,
  },
  amountCur: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 8,
  },
  amountInput: {
    minWidth: 120,
    maxWidth: '80%',
    fontSize: 34,
    fontWeight: '750',
    letterSpacing: -0.4,
    textAlign: 'center',
    paddingVertical: 0,
  },
  formCard: {
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  budgetCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  budgetTitle: { fontSize: 14, fontWeight: '650' },
  budgetHint: { fontSize: 11, lineHeight: 15, marginTop: 2 },
  inputLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 44,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  inputLab: { width: 36, fontSize: 12, flexShrink: 0 },
  inputVal: {
    flex: 1,
    textAlign: 'right',
    fontSize: 14,
    fontWeight: '650',
    paddingVertical: 8,
    paddingHorizontal: 0,
  },
  autoTag: {
    height: 18,
    paddingHorizontal: 6,
    borderRadius: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  autoTagText: { fontSize: 10, fontWeight: '700' },
  previewHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 8,
    marginBottom: 2,
  },
  previewTitle: { fontSize: 13, fontWeight: '700' },
  previewTag: {
    height: 18,
    paddingHorizontal: 6,
    borderRadius: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewTagText: { fontSize: 10, fontWeight: '700' },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  previewLab: { fontSize: 13 },
  previewVal: { fontSize: 13, fontWeight: '650' },
  aiEval: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  aiHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  aiHeadText: { fontSize: 13, fontWeight: '750' },
  regenBtn: {
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    minHeight: 24,
  },
  regenText: { fontSize: 11, fontWeight: '650' },
  aiBody: { fontSize: 12, lineHeight: 18 },
  helper: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  helperText: { flex: 1, fontSize: 12, lineHeight: 18 },
  dangerLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 14,
    marginTop: 4,
  },
  dangerText: { fontSize: 13, fontWeight: '650' },
  miniNote: {
    textAlign: 'center',
    fontSize: 11,
    lineHeight: 16,
    marginTop: 2,
    marginBottom: 8,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'flex-end',
  },
  categorySheet: {
    marginHorizontal: 12,
    marginBottom: 20,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    maxHeight: '78%',
  },
  accountSheet: {
    marginHorizontal: 12,
    marginBottom: 20,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    maxHeight: '70%',
  },
  sheetTitle: { fontSize: 16, fontWeight: '700', marginBottom: 10 },
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modalDone: {
    height: 42,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 18,
  },
  pickerCard: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    paddingBottom: 12,
  },
  pickerHead: {
    minHeight: 48,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  pickerFooter: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 12,
    marginTop: 4,
  },
  pickerAction: {
    flex: 1,
    minHeight: 42,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nativePicker: {
    width: '100%',
    alignSelf: 'center',
  },
});
