/**
 * 把 ActionCard 确认接到现有 Sheet / 路由（P0-2）。
 */
import type { ActionCard } from '@/lib/assistant/action-card';
import {
  executeAssistantConfirm,
  mapActionCardToConfirmPlan,
  type ExecuteConfirmResult,
} from '@/lib/assistant/confirm';
import { openFoodIntakeSheet } from '@/lib/assistant/food-intake-sheet';
import type { FoodTextIntakeJson } from '@/lib/ai-types';
import {
  openFinanceSheet,
  type FinanceAiDraftPayload,
} from '@/lib/finance-transaction-sheet/controller';
import type { Href } from 'expo-router';
import { router } from 'expo-router';

function asFinanceDraft(draft: Record<string, unknown>): FinanceAiDraftPayload {
  const txn =
    draft.transaction_type === 'income' || draft.transaction_type === 'expense'
      ? draft.transaction_type
      : 'expense';
  const amount = typeof draft.amount === 'number' && Number.isFinite(draft.amount) ? draft.amount : 0;
  return {
    transaction_type: txn,
    amount,
    name: typeof draft.name === 'string' && draft.name.trim() ? draft.name.trim() : '未命名',
    category_label: typeof draft.category_label === 'string' ? draft.category_label : null,
    account_name: typeof draft.account_name === 'string' ? draft.account_name : null,
    payment_account_label:
      typeof draft.payment_account_label === 'string' ? draft.payment_account_label : null,
  };
}

function asFoodDraft(draft: Record<string, unknown>): FoodTextIntakeJson {
  return {
    food_summary:
      (typeof draft.food_summary === 'string' && draft.food_summary.trim()) ||
      (typeof draft.food_name === 'string' && draft.food_name.trim()) ||
      '饮食',
    hydration_ml: Math.max(0, Number(draft.hydration_ml) || 0),
    protein_g: Math.max(0, Number(draft.protein_g) || 0),
    carbohydrate_g: Math.max(0, Number(draft.carbohydrate_g) || 0),
    calories_kcal: Math.max(0, Number(draft.calories_kcal) || 0),
    ai_evaluation: typeof draft.ai_evaluation === 'string' ? draft.ai_evaluation : '',
  };
}

export async function confirmAssistantCard(
  card: ActionCard,
  opts?: { allowedIds?: Iterable<string>; assignYmd?: string },
): Promise<ExecuteConfirmResult> {
  const plan = mapActionCardToConfirmPlan(card, {
    allowedIds: opts?.allowedIds,
    assignYmd: opts?.assignYmd,
    fallbackAssignYmd: opts?.assignYmd,
  });
  return executeAssistantConfirm(plan, {
    openFinancePreview: (draft, c) => {
      openFinanceSheet({
        kind: 'ai_draft',
        draft: asFinanceDraft(draft),
        sentence: c.summary || c.title,
      });
    },
    openFinanceTransferPreview: draft => {
      const amount =
        typeof draft.amount === 'number' && Number.isFinite(draft.amount) ? draft.amount : undefined;
      const fee =
        typeof draft.fee_amount === 'number' && Number.isFinite(draft.fee_amount)
          ? draft.fee_amount
          : undefined;
      openFinanceSheet({
        kind: 'transfer',
        fromAccountId: null,
        toAccountId: null,
        amount,
        feeAmount: fee,
        name: typeof draft.name === 'string' ? draft.name : undefined,
        fromAccountHint:
          typeof draft.from_account_hint === 'string' ? draft.from_account_hint : undefined,
        toAccountHint: typeof draft.to_account_hint === 'string' ? draft.to_account_hint : undefined,
      });
    },
    openFoodPreview: draft => {
      openFoodIntakeSheet({ seedAiDraft: asFoodDraft(draft) });
    },
    push: href => {
      router.push(href as Href);
    },
  });
}
