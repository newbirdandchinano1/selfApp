import {
  buildExpenseCategories,
  buildIncomeCategories,
  mergeSheetCategories,
  type SheetCategory,
} from '@/lib/finance-transaction-sheet/helpers';
import {
  createFinanceSheetCustomCategory,
  financeSheetCategoryRowToSheetCategory,
  getFinanceSheetCustomCategories,
  type FinanceSheetTransactionType,
} from '@/lib/repositories/finance/finance-sheet-category';
import { deleteFinanceFlowCategory } from '@/lib/repositories/finance/finance';
import React from 'react';
import { Alert } from 'react-native';

export type FinanceSheetCategoryColors = {
  primary: string;
  secondary: string;
  tertiary: string;
  subtle: string;
};

export function useFinanceSheetCategories(colors: FinanceSheetCategoryColors) {
  const [customExpense, setCustomExpense] = React.useState<SheetCategory[]>([]);
  const [customIncome, setCustomIncome] = React.useState<SheetCategory[]>([]);
  const [customCategoriesReady, setCustomCategoriesReady] = React.useState(false);
  const [addModalVisible, setAddModalVisible] = React.useState(false);
  const [addModalTransactionType, setAddModalTransactionType] = React.useState<FinanceSheetTransactionType>('expense');
  const [newCategoryName, setNewCategoryName] = React.useState('');
  const [isSavingCategory, setIsSavingCategory] = React.useState(false);

  const reloadCustomCategories = React.useCallback(async () => {
    try {
      const [expRows, incRows] = await Promise.all([
        getFinanceSheetCustomCategories('expense'),
        getFinanceSheetCustomCategories('income'),
      ]);
      setCustomExpense(expRows.map((r) => financeSheetCategoryRowToSheetCategory(r, colors.subtle)));
      setCustomIncome(incRows.map((r) => financeSheetCategoryRowToSheetCategory(r, colors.subtle)));
    } catch (err) {
      console.warn('加载自定义记账分类失败', err);
    } finally {
      setCustomCategoriesReady(true);
    }
  }, [colors.subtle]);

  React.useEffect(() => {
    void reloadCustomCategories();
  }, [reloadCustomCategories]);

  const expenseCategories = React.useMemo(
    () =>
      mergeSheetCategories(
        buildExpenseCategories(colors.primary, colors.secondary, colors.tertiary, colors.subtle),
        customExpense,
      ),
    [colors.primary, colors.secondary, colors.subtle, colors.tertiary, customExpense],
  );

  const incomeCategories = React.useMemo(
    () =>
      mergeSheetCategories(
        buildIncomeCategories(colors.primary, colors.secondary, colors.tertiary, colors.subtle),
        customIncome,
      ),
    [colors.primary, colors.secondary, colors.subtle, colors.tertiary, customIncome],
  );

  const openAddCategoryModal = React.useCallback((transactionType: FinanceSheetTransactionType) => {
    setAddModalTransactionType(transactionType);
    setNewCategoryName('');
    setAddModalVisible(true);
  }, []);

  const closeAddCategoryModal = React.useCallback(() => {
    if (isSavingCategory) return;
    setAddModalVisible(false);
    setNewCategoryName('');
  }, [isSavingCategory]);

  const saveNewCategory = React.useCallback(
    async (onCreated?: (key: string) => void) => {
      const name = newCategoryName.trim();
      if (!name) {
        Alert.alert('请输入分类名称', '分类名称不能为空。');
        return;
      }
      setIsSavingCategory(true);
      try {
        const id = await createFinanceSheetCustomCategory(name, addModalTransactionType);
        await reloadCustomCategories();
        setAddModalVisible(false);
        setNewCategoryName('');
        onCreated?.(id);
      } catch (err) {
        Alert.alert('添加失败', err instanceof Error ? err.message : '添加分类失败');
      } finally {
        setIsSavingCategory(false);
      }
    },
    [addModalTransactionType, newCategoryName, reloadCustomCategories],
  );

  const confirmDeleteCustomCategory = React.useCallback(
    (item: SheetCategory) => {
      if (!item.isCustom) return;
      Alert.alert('删除分类', `确定删除「${item.label}」？已有流水仍保留原分类名称。`, [
        { text: '取消', style: 'cancel' },
        {
          text: '删除',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                await deleteFinanceFlowCategory(item.key);
                await reloadCustomCategories();
              } catch (err) {
                Alert.alert('删除失败', err instanceof Error ? err.message : '删除分类失败');
              }
            })();
          },
        },
      ]);
    },
    [reloadCustomCategories],
  );

  return {
    expenseCategories,
    incomeCategories,
    customCategoriesReady,
    reloadCustomCategories,
    addModalVisible,
    addModalTransactionType,
    newCategoryName,
    setNewCategoryName,
    isSavingCategory,
    openAddCategoryModal,
    closeAddCategoryModal,
    saveNewCategory,
    confirmDeleteCustomCategory,
  };
}
