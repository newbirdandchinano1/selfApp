import { FinanceCategoryPicker } from '@/components/finance/finance-category-picker';
import { Colors } from '@/constants/theme';
import { usePullToRefresh } from '@/hooks/use-pull-to-refresh';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useFinanceSheetCategories } from '@/lib/finance-transaction-sheet/use-sheet-categories';
import { FINANCE_SHEET_CATEGORY_ID_PREFIX } from '@/lib/repositories/finance/finance-sheet-category';
import {
  deleteFinanceTransaction,
  getFinanceAccountsWithBalance,
  getFinanceTransactionById,
  updateFinanceTransaction,
} from '@/lib/repositories/finance/finance';
import {
  budgetExtraPatchForTransaction,
  isExpenseIncludedInBudget,
} from '@/lib/repositories/finance/finance-transaction-extra';
import { notifyFinanceSheetSaved } from '@/lib/finance-sheet-controller';
import { tryPersistFinanceTxnAiComment } from '@/lib/repositories/finance/finance-txn-ai-comment';
import type { FinanceAccountBalanceRow, FinanceTransactionRow } from '@/lib/repositories/finance/finance.types';
import { MaterialIcons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
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

export default function EditFinanceTransactionScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id: rawId } = useLocalSearchParams<{ id: string }>();
  const id = typeof rawId === 'string' ? rawId : Array.isArray(rawId) ? rawId[0] : '';

  const colorScheme = useColorScheme();
  const themeKey = colorScheme === 'dark' ? 'dark' : 'light';
  const baseTheme = Colors[themeKey];
  const isDark = themeKey === 'dark';

  const pageBg = isDark ? baseTheme.background : '#f3f4f6';
  const surface = isDark ? '#111827' : '#ffffff';
  const text = isDark ? baseTheme.text : '#131b2e';
  const subtle = isDark ? baseTheme.textSecondary : '#6b7280';
  const outlineVariant = isDark ? 'rgba(148,163,184,0.22)' : 'rgba(194,198,214,0.35)';
  const primary = isDark ? '#60a5fa' : '#0058be';
  const secondary = isDark ? '#34d399' : '#006c49';
  const tertiary = isDark ? '#fbbf24' : '#825100';

  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
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
  /** 用户已手动切换预算开关后，异步 load 完成时不得覆盖 */
  const budgetTouchedByUserRef = React.useRef(false);

  const applyIncludeInBudget = React.useCallback((value: boolean | ((prev: boolean) => boolean)) => {
    setIncludeInBudget((prev) => {
      const next = typeof value === 'function' ? value(prev) : value;
      includeInBudgetRef.current = next;
      return next;
    });
  }, []);

  const userToggleIncludeInBudget = React.useCallback(() => {
    budgetTouchedByUserRef.current = true;
    applyIncludeInBudget((prev) => !prev);
  }, [applyIncludeInBudget]);
  const [aiComment, setAiComment] = React.useState('');

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
  } = useFinanceSheetCategories({ primary, secondary, tertiary, subtle });

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

  const load = React.useCallback(async (silent = false) => {
    if (!id) {
      if (!silent) setLoading(false);
      setRow(null);
      return;
    }
    if (!silent) setLoading(true);
    try {
      const [txn, accRows] = await Promise.all([getFinanceTransactionById(id), getFinanceAccountsWithBalance()]);
      setAccounts(accRows);
      if (!txn) {
        setRow(null);
        return;
      }
      setRow(txn);
      const ttype = txn.transaction_type === 'income' || txn.transaction_type === 'expense' || txn.transaction_type === 'transfer' ? txn.transaction_type : 'expense';
      setTab(ttype);
      setNameDraft(txn.name?.trim() ?? '');
      setNoteDraft(txn.note?.trim() ?? '');
      setAmountDraft(Math.abs(Number(txn.amount)).toFixed(2));
      setAiComment(txn.ai_comment?.trim() ?? '');
      const d = new Date(txn.happened_at);
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
        const includedInBudget = ttype !== 'expense' ? true : isExpenseIncludedInBudget(txn.extra_data);
        applyIncludeInBudget(includedInBudget);
      }
    } catch (e) {
      console.warn('Failed to load finance transaction:', e);
      setRow(null);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [applyIncludeInBudget, id]);

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

  const onSave = React.useCallback(async () => {
    if (saving) return;
    if (!row || !selectedAccount) {
      Alert.alert('无法保存', '缺少交易或账户信息。');
      return;
    }
    const absAmount = parseFloat(amountDraft.trim().replace(/,/g, ''));
    if (!Number.isFinite(absAmount) || absAmount <= 0) {
      Alert.alert('金额无效', '请输入大于 0 的金额。');
      return;
    }
    const title =
      nameDraft.trim() ||
      (tab !== 'transfer' ? selectedCategory?.label : null) ||
      (tab === 'income' ? '收入' : tab === 'expense' ? '支出' : '转账');
    const signedAmount = selectedAccount.sign_rule > 0 ? absAmount : -absAmount;

    try {
      setSaving(true);
      const extraPatch: Record<string, unknown> = {
        manual: true,
        category_key: tab === 'transfer' ? null : selectedCategory?.key ?? null,
        category_label: tab === 'transfer' ? null : selectedCategory?.label ?? null,
        ...budgetExtraPatchForTransaction(tab, includeInBudgetRef.current),
      };
      const mergedExtra = mergeExtraData(row.extra_data, extraPatch);
      await updateFinanceTransaction(row.id, {
        name: title,
        happened_at: happenedAt.toISOString(),
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
          happened_at: happenedAt.toISOString(),
          transaction_type: tab,
          amount: signedAmount,
          note: noteDraft.trim() || null,
          accountLabel: selectedAccount.name,
          categoryLabel: selectedCategory?.label ?? '未分类',
        });
      }
      router.back();
    } catch (e) {
      console.warn('Failed to update finance transaction:', e);
      Alert.alert('保存失败', '请检查金额与账户类型后重试。');
    } finally {
      setSaving(false);
    }
  }, [amountDraft, happenedAt, nameDraft, noteDraft, router, row, saving, selectedAccount, selectedCategory, tab]);

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
            router.back();
          } catch (e) {
            console.warn('Failed to delete finance transaction:', e);
            Alert.alert('删除失败', '请稍后重试。');
          } finally {
            setDeleting(false);
          }
        },
      },
    ]);
  }, [deleting, row, router]);

  if (!id) {
    return (
      <SafeAreaView style={[styles.centered, { backgroundColor: pageBg }]} edges={['top', 'left', 'right']}>
        <Text style={{ color: text, fontSize: 15, fontWeight: '600' }}>缺少记录 ID</Text>
        <Pressable onPress={() => router.back()} style={{ marginTop: 16, padding: 12 }}>
          <Text style={{ color: primary, fontWeight: '700' }}>返回</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={[styles.centered, { backgroundColor: pageBg }]} edges={['top', 'left', 'right']}>
        <ActivityIndicator size="large" color={primary} />
      </SafeAreaView>
    );
  }

  if (!row) {
    return (
      <SafeAreaView style={[styles.centered, { backgroundColor: pageBg }]} edges={['top', 'left', 'right']}>
        <Text style={{ color: text, fontSize: 15, fontWeight: '600' }}>未找到该笔收支</Text>
        <Pressable onPress={() => router.back()} style={{ marginTop: 16, padding: 12 }}>
          <Text style={{ color: primary, fontWeight: '700' }}>返回</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: pageBg }} edges={['top', 'left', 'right']}>
      <View style={[styles.header, { backgroundColor: surface, borderBottomColor: outlineVariant }]}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.headerBtn, pressed && { opacity: 0.75 }]}>
          <MaterialIcons name="arrow-back" size={24} color={text} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: text }]}>编辑收支明细</Text>
        <Pressable
          onPress={() => void onSave()}
          disabled={saving}
          style={({ pressed }) => [styles.headerBtn, styles.saveBtn, pressed && { opacity: 0.8 }, saving && { opacity: 0.5 }]}>
          <Text style={{ color: primary, fontWeight: '800', fontSize: 16 }}>{saving ? '保存中' : '保存'}</Text>
        </Pressable>
      </View>

      <ScrollView
        refreshControl={refreshControl}
        contentContainerStyle={{ paddingBottom: Math.max(24, insets.bottom + 16), paddingHorizontal: 16, paddingTop: 16 }}
        keyboardShouldPersistTaps="handled">
        <View style={[styles.card, { backgroundColor: surface, borderColor: outlineVariant }]}>
          <Text style={[styles.label, { color: subtle }]}>类型</Text>
          <View style={styles.tabRow}>
            {(['expense', 'income', 'transfer'] as const).map((t) => {
              const active = tab === t;
              const lab = t === 'expense' ? '支出' : t === 'income' ? '收入' : '转账';
              return (
                  <Pressable
                  key={t}
                  onPress={() => setTab(t)}
                  style={({ pressed }) => [
                    styles.tabChip,
                    { borderColor: outlineVariant, backgroundColor: isDark ? '#161d2b' : '#faf8ff' },
                    active && { borderColor: tertiary, backgroundColor: `${tertiary}18` },
                    pressed && { opacity: 0.88 },
                  ]}>
                  <Text style={[styles.tabChipText, { color: active ? tertiary : subtle }]}>{lab}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {tab !== 'transfer' ? (
          <View style={[styles.card, { backgroundColor: surface, borderColor: outlineVariant, marginTop: 12 }]}>
            <Text style={[styles.label, { color: subtle }]}>账户</Text>
          <Pressable
            onPress={() => setAccountPickerOpen(true)}
            style={({ pressed }) => [
              styles.selectorRow,
              { borderColor: outlineVariant, backgroundColor: isDark ? '#161d2b' : '#faf8ff' },
              pressed && { opacity: 0.9 },
            ]}>
            <MaterialIcons name="account-balance-wallet" size={20} color={primary} />
            <Text style={[styles.selectorText, { color: text }]}>{selectedAccount?.name ?? '选择账户'}</Text>
            <MaterialIcons name="expand-more" size={22} color={subtle} />
          </Pressable>

            <Text style={[styles.label, { color: subtle, marginTop: 14 }]}>AI 评价</Text>
            <View style={[styles.aiCommentCard, { borderColor: outlineVariant, backgroundColor: isDark ? '#161d2b' : '#faf8ff' }]}>
            <MaterialIcons name="auto-awesome" size={18} color={aiComment ? secondary : subtle} />
            <Text style={[styles.aiCommentText, { color: aiComment ? text : subtle }]}>
              {aiComment || '暂无 AI 评价，保存后会尝试自动生成；也可在列表页查看完整评价。'}
            </Text>
          </View>

            {aiComment ? (
            <Pressable
              onPress={async () => {
                if (!row || !selectedAccount) return;
                try {
                  setSaving(true);
                  const signedAmount = selectedAccount.sign_rule > 0 ? Math.abs(Number(amountDraft)) : -Math.abs(Number(amountDraft));
                  const absAmount = Math.abs(Number(amountDraft));
                  if (!Number.isFinite(absAmount) || absAmount <= 0) {
                    Alert.alert('金额无效', '请输入大于 0 的金额。');
                    return;
                  }
                  const title = nameDraft.trim() || (tab === 'income' ? '收入' : tab === 'expense' ? '支出' : '转账');
                  const result = await tryPersistFinanceTxnAiComment(row.id, {
                    name: title,
                    happened_at: happenedAt.toISOString(),
                    transaction_type: tab,
                    amount: signedAmount,
                    note: noteDraft.trim() || null,
                    accountLabel: selectedAccount.name,
                    categoryLabel: selectedCategory?.label ?? '未分类',
                  });
                  setAiComment(result.ok ? result.comment : aiComment);
                } catch (e) {
                  console.warn('Failed to refresh finance AI comment:', e);
                } finally {
                  setSaving(false);
                }
              }}
              style={({ pressed }) => [styles.aiCommentAction, pressed && { opacity: 0.86 }]}>
              <Text style={{ color: primary, fontWeight: '800' }}>重新生成 AI 评价</Text>
            </Pressable>
          ) : null}

            <Text style={[styles.label, { color: subtle }]}>分类</Text>
            <FinanceCategoryPicker
              categories={activeCategories}
              selectedKey={categoryKey}
              onSelectKey={setCategoryKey}
              transactionType={tab === 'income' ? 'income' : 'expense'}
              subtle={subtle}
              primary={primary}
              text={text}
              surface={surface}
              outlineVariant={outlineVariant}
              styles={styles}
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
          </View>
        ) : (
          <View style={[styles.card, { backgroundColor: surface, borderColor: outlineVariant, marginTop: 12 }]}>
            <Text style={[styles.hint, { color: subtle }]}>转账记录可修改金额、时间与备注；分类不适用。</Text>
          </View>
        )}

        {tab === 'expense' ? (
          <Pressable
            accessibilityRole="switch"
            accessibilityLabel="计入本月预算"
            accessibilityState={{ checked: includeInBudget }}
            onPress={userToggleIncludeInBudget}
            style={({ pressed }) => [
              styles.card,
              styles.budgetOptionRow,
              { backgroundColor: surface, borderColor: outlineVariant, marginTop: 12 },
              pressed ? { opacity: 0.82 } : null,
            ]}>
            <View style={styles.budgetOptionHit}>
              <View
                style={[
                  styles.budgetOptionIconWrap,
                  {
                    backgroundColor: isDark ? 'rgba(251, 191, 36, 0.14)' : 'rgba(130, 81, 0, 0.09)',
                  },
                ]}>
                <MaterialIcons name="pie-chart" size={22} color={tertiary} />
              </View>
              <View style={styles.budgetOptionTextCol}>
                <Text style={[styles.budgetOptionTitle, { color: text }]}>计入本月预算</Text>
                <Text style={[styles.budgetOptionSubtitle, { color: subtle }]} numberOfLines={2}>
                  {includeInBudget
                    ? '占用本月预算与「今日可用」计算'
                    : '仍记为支出，不参与预算与今日可用'}
                </Text>
              </View>
            </View>
            <Switch
              value={includeInBudget}
              pointerEvents="none"
              trackColor={{ false: isDark ? '#374151' : '#e5e7eb', true: '#4ade80' }}
              thumbColor="#ffffff"
              ios_backgroundColor={isDark ? '#374151' : '#e5e7eb'}
            />
          </Pressable>
        ) : null}

        <View style={[styles.card, { backgroundColor: surface, borderColor: outlineVariant, marginTop: 12 }]}>
          <Text style={[styles.label, { color: subtle }]}>标题</Text>
          <TextInput
            value={nameDraft}
            onChangeText={setNameDraft}
            placeholder="例如：午餐、工资"
            placeholderTextColor={subtle}
            style={[styles.input, { color: text, borderColor: outlineVariant, backgroundColor: isDark ? '#161d2b' : '#faf8ff' }]}
          />
          <Text style={[styles.label, { color: subtle, marginTop: 14 }]}>备注</Text>
          <TextInput
            value={noteDraft}
            onChangeText={setNoteDraft}
            placeholder="选填"
            placeholderTextColor={subtle}
            multiline
            style={[styles.input, styles.inputMultiline, { color: text, borderColor: outlineVariant, backgroundColor: isDark ? '#161d2b' : '#faf8ff' }]}
          />
          <Text style={[styles.label, { color: subtle, marginTop: 14 }]}>金额（元）</Text>
          <TextInput
            value={amountDraft}
            onChangeText={setAmountDraft}
            keyboardType="decimal-pad"
            placeholder="0.00"
            placeholderTextColor={subtle}
            style={[styles.input, { color: text, borderColor: outlineVariant, backgroundColor: isDark ? '#161d2b' : '#faf8ff' }]}
          />
        </View>

        <View style={[styles.card, { backgroundColor: surface, borderColor: outlineVariant, marginTop: 12 }]}>
          <Text style={[styles.label, { color: subtle }]}>账户</Text>
          <Pressable
            onPress={() => setAccountPickerOpen(true)}
            style={({ pressed }) => [
              styles.selectorRow,
              { borderColor: outlineVariant, backgroundColor: isDark ? '#161d2b' : '#faf8ff' },
              pressed && { opacity: 0.9 },
            ]}>
            <MaterialIcons name="account-balance-wallet" size={20} color={primary} />
            <Text style={[styles.selectorText, { color: text }]}>{selectedAccount?.name ?? '选择账户'}</Text>
            <MaterialIcons name="expand-more" size={22} color={subtle} />
          </Pressable>

          <Text style={[styles.label, { color: subtle, marginTop: 14 }]}>发生时间</Text>
          <View style={styles.dateRow}>
            <Pressable
              onPress={() => {
                setTimePickerOpen(false);
                setDatePickerOpen((v) => !v);
              }}
              style={({ pressed }) => [
                styles.dateChip,
                { borderColor: outlineVariant, backgroundColor: isDark ? '#161d2b' : '#faf8ff' },
                pressed && { opacity: 0.9 },
              ]}>
              <MaterialIcons name="calendar-today" size={16} color={subtle} />
              <Text style={{ color: text, fontWeight: '600', marginLeft: 8 }}>
                {happenedAt.getMonth() + 1}月{happenedAt.getDate()}日
              </Text>
            </Pressable>
            <Pressable
              onPress={() => {
                setDatePickerOpen(false);
                setTimePickerOpen((v) => !v);
              }}
              style={({ pressed }) => [
                styles.dateChip,
                { borderColor: outlineVariant, backgroundColor: isDark ? '#161d2b' : '#faf8ff' },
                pressed && { opacity: 0.9 },
              ]}>
              <MaterialIcons name="schedule" size={16} color={subtle} />
              <Text style={{ color: text, fontWeight: '600', marginLeft: 8 }}>
                {String(happenedAt.getHours()).padStart(2, '0')}:{String(happenedAt.getMinutes()).padStart(2, '0')}
              </Text>
            </Pressable>
          </View>

          {datePickerOpen ? (
            <DateTimePicker
              value={happenedAt}
              mode="date"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={(_, date) => {
                if (Platform.OS === 'android') setDatePickerOpen(false);
                if (date) {
                  setHappenedAt((prev) => {
                    const n = new Date(prev);
                    n.setFullYear(date.getFullYear(), date.getMonth(), date.getDate());
                    return n;
                  });
                }
              }}
            />
          ) : null}
          {timePickerOpen ? (
            <DateTimePicker
              value={happenedAt}
              mode="time"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={(_, date) => {
                if (Platform.OS === 'android') setTimePickerOpen(false);
                if (date) {
                  setHappenedAt((prev) => {
                    const n = new Date(prev);
                    n.setHours(date.getHours(), date.getMinutes(), 0, 0);
                    return n;
                  });
                }
              }}
            />
          ) : null}
        </View>

        <Pressable
          onPress={onDelete}
          disabled={deleting}
          style={({ pressed }) => [
            styles.deleteBtn,
            { borderColor: 'rgba(239,68,68,0.45)', backgroundColor: isDark ? 'rgba(127,29,29,0.25)' : '#fef2f2' },
            pressed && { opacity: 0.88 },
            deleting && { opacity: 0.55 },
          ]}>
          <MaterialIcons name="delete-outline" size={22} color="#dc2626" />
          <Text style={{ color: '#dc2626', fontWeight: '800', marginLeft: 8, fontSize: 16 }}>删除本条</Text>
        </Pressable>
      </ScrollView>

      <Modal visible={accountPickerOpen} transparent animationType="fade" onRequestClose={() => setAccountPickerOpen(false)}>
        <View style={styles.modalRoot}>
          <Pressable style={styles.modalBackdrop} onPress={() => setAccountPickerOpen(false)} />
          <View style={[styles.modalSheet, { backgroundColor: surface, paddingBottom: Math.max(16, insets.bottom) }]}>
            <Text style={[styles.modalTitle, { color: text }]}>选择账户</Text>
            <ScrollView style={{ maxHeight: 360 }}>
              {accounts.map((acc) => (
                <Pressable
                  key={acc.id}
                  onPress={() => {
                    setAccountId(acc.id);
                    setAccountPickerOpen(false);
                  }}
                  style={({ pressed }) => [
                    styles.accountRow,
                    { borderBottomColor: outlineVariant },
                    acc.id === accountId && { backgroundColor: isDark ? 'rgba(96,165,250,0.12)' : 'rgba(0,88,190,0.08)' },
                    pressed && { opacity: 0.88 },
                  ]}>
                  <Text style={{ color: text, fontSize: 16, fontWeight: '600' }}>{acc.name}</Text>
                  {acc.id === accountId ? <MaterialIcons name="check" size={22} color={primary} /> : null}
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerBtn: { padding: 10, minWidth: 44, alignItems: 'center', justifyContent: 'center' },
  saveBtn: { alignItems: 'flex-end' },
  headerTitle: { fontSize: 17, fontWeight: '800' },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
  },
  label: { fontSize: 13, fontWeight: '700', marginBottom: 8 },
  hint: { fontSize: 14, lineHeight: 20 },
  tabRow: { flexDirection: 'row', gap: 10 },
  tabChip: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
  },
  tabChipText: { fontWeight: '800', fontSize: 14 },
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
  budgetOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  budgetOptionHit: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
  },
  budgetOptionIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  budgetOptionTextCol: {
    flex: 1,
    marginLeft: 12,
    paddingRight: 6,
  },
  budgetOptionTitle: {
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  budgetOptionSubtitle: {
    fontSize: 12,
    fontWeight: '500',
    marginTop: 3,
    lineHeight: 16,
    opacity: 0.92,
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  inputMultiline: { minHeight: 88, textAlignVertical: 'top' },
  selectorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  selectorText: { flex: 1, marginLeft: 10, fontSize: 16, fontWeight: '600' },
  aiCommentCard: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  aiCommentText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
  },
  aiCommentAction: {
    marginTop: 10,
    alignSelf: 'flex-start',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(96,165,250,0.08)',
  },
  dateRow: { flexDirection: 'row', gap: 10 },
  dateChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
  },
  deleteBtn: {
    marginTop: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  modalSheet: {
    marginHorizontal: 16,
    marginBottom: 24,
    borderRadius: 16,
    paddingTop: 12,
    maxHeight: '70%',
  },
  modalTitle: { fontSize: 17, fontWeight: '800', paddingHorizontal: 16, marginBottom: 8 },
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
