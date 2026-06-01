import { readApiTable } from '@/lib/api-read';
import { sortBySortOrderAsc } from '@/lib/api-read-helpers';
import { makeTimestampEntityId } from '@/lib/entity-id';
import { getDatabase } from '../../database.native';
import type { FinanceFlowCategoryRow } from './finance.types';
import type { SheetCategory } from '@/lib/finance-transaction-sheet/helpers';
import { MaterialIcons } from '@expo/vector-icons';

export const FINANCE_SHEET_CATEGORY_ID_PREFIX = 'sheet-cat-';

export type FinanceSheetTransactionType = 'expense' | 'income';

type SheetCategoryExtra = {
  sheet?: boolean;
  transaction_type?: FinanceSheetTransactionType;
  icon?: string;
};

function parseSheetCategoryExtra(extraData: string | null): SheetCategoryExtra {
  if (!extraData) return {};
  try {
    const raw = JSON.parse(extraData) as unknown;
    if (!raw || typeof raw !== 'object') return {};
    const o = raw as Record<string, unknown>;
    const transaction_type =
      o.transaction_type === 'expense' || o.transaction_type === 'income' ? o.transaction_type : undefined;
    const icon = typeof o.icon === 'string' ? o.icon : undefined;
    return { sheet: o.sheet === true, transaction_type, icon };
  } catch {
    return {};
  }
}

function isMaterialIconName(v: string): v is keyof typeof MaterialIcons.glyphMap {
  return v in MaterialIcons.glyphMap;
}

export function financeSheetCategoryRowToSheetCategory(
  row: FinanceFlowCategoryRow,
  subtleColor: string,
): SheetCategory {
  const extra = parseSheetCategoryExtra(row.extra_data);
  const icon: keyof typeof MaterialIcons.glyphMap =
    extra.icon && isMaterialIconName(extra.icon) ? extra.icon : 'bookmark';
  return {
    key: row.id,
    icon,
    label: row.name,
    color: subtleColor,
    isCustom: true,
  };
}

export function isFinanceSheetCategoryRow(row: FinanceFlowCategoryRow): boolean {
  if (row.id.startsWith(FINANCE_SHEET_CATEGORY_ID_PREFIX)) return true;
  const extra = parseSheetCategoryExtra(row.extra_data);
  return extra.sheet === true;
}

export async function getFinanceSheetCustomCategories(transactionType: FinanceSheetTransactionType) {
  const rows = await readApiTable<FinanceFlowCategoryRow>('finance_flow_categories', { offlineFallback: true });
  return sortBySortOrderAsc(
    rows.filter(row => {
      if (!row.id.startsWith(FINANCE_SHEET_CATEGORY_ID_PREFIX)) return false;
      const extra = parseSheetCategoryExtra(row.extra_data);
      return extra.transaction_type === transactionType;
    }),
  );
}

export async function createFinanceSheetCustomCategory(
  name: string,
  transactionType: FinanceSheetTransactionType,
  icon: keyof typeof MaterialIcons.glyphMap = 'bookmark',
) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('分类名称不能为空');
  if (trimmed.length > 20) throw new Error('分类名称不能超过 20 字');
  const iconName = isMaterialIconName(icon) ? icon : 'bookmark';

  const db = await getDatabase();
  const dup = await db.getFirstAsync<{ id: string }>(
    `SELECT id FROM finance_flow_categories
     WHERE name = ? AND id LIKE ? LIMIT 1`,
    [trimmed, `${FINANCE_SHEET_CATEGORY_ID_PREFIX}%`],
  );
  if (dup) throw new Error('该分类名称已存在');

  const maxRow = await db.getFirstAsync<{ max_sort: number | null }>(
    `SELECT MAX(COALESCE(sort_order, 1000)) AS max_sort
     FROM finance_flow_categories
     WHERE id LIKE ?`,
    [`${FINANCE_SHEET_CATEGORY_ID_PREFIX}%`],
  );
  const nextSort = (maxRow?.max_sort ?? 1000) + 10;
  const id = makeTimestampEntityId(FINANCE_SHEET_CATEGORY_ID_PREFIX, 6);
  const extra_data = JSON.stringify({
    sheet: true,
    transaction_type: transactionType,
    icon: iconName,
  });

  await db.runAsync(
    `INSERT INTO finance_flow_categories (
      id, name, parent_id, sort_order, is_builtin, created_at, updated_at, sync_status, extra_data
    ) VALUES (?, ?, NULL, ?, 0, datetime('now'), datetime('now'), 'pending_create', ?)`,
    [id, trimmed, nextSort, extra_data],
  );
  return id;
}
