/**
 * S9.3：向 ChatCommitExecutor 注册真实 repository handlers。
 * 新增域只在此 register；handler 内动态 import，避免 Node 单测拉 RN。
 */

import {
  globalChatCommitExecutor,
  type ChatCommitExecutor,
} from '@/lib/assistant/chat-commit';
import { catalogCommitHandlers } from './catalog';
import { financeCommitHandlers } from './finance';
import { foodCommitHandlers } from './food';
import { habitCommitHandlers } from './habit';
import { lifeRoadCommitHandlers } from './life-road';
import { memoCommitHandlers } from './memo';
import { profileCommitHandlers } from './profile';
import { recipeCommitHandlers } from './recipe';
import { reviewCommitHandlers } from './review';
import { scheduleCommitHandlers } from './schedule';
import { tagCommitHandlers } from './tag';
import { taskCommitHandlers } from './task';
import { wardrobeCommitHandlers } from './wardrobe';
import { wishCommitHandlers } from './wish';

/** W1 已上线的 commit_*（对照表 A01–A22 核心） */
export const W1_COMMIT_ACTIONS = [
  'commit_finance_txn',
  'commit_finance_transfer',
  'commit_finance_scheduled',
  'commit_finance_cash_flow',
  'commit_finance_budget',
  'commit_task',
  'commit_project',
  'commit_habit',
  'commit_food_intake',
  'commit_memo',
] as const;

/** W2：其余已有 draft 域（对照表 A23–A34） */
export const W2_COMMIT_ACTIONS = [
  'commit_recipe',
  'commit_recipe_plan',
  'commit_wardrobe_item',
  'commit_wish',
  'commit_profile',
  'commit_life_road_node',
  'commit_life_direction',
  'commit_review_dimension',
] as const;

/** Catalog 通用确认写（无精品 commit 映射时兜底） */
export const CATALOG_COMMIT_ACTIONS = ['commit_catalog_write'] as const;

/** W3：§5.6-B 补洞（对照表 B01–B34） */
export const W3_COMMIT_ACTIONS = [
  'commit_finance_account',
  'commit_finance_flow_category',
  'commit_finance_account_type',
  'commit_savings_plan',
  'commit_savings_deposit',
  'commit_habit_checkin',
  'commit_habit_context',
  'commit_weight',
  'commit_intake_targets',
  'commit_recipe_basket',
  'commit_recipe_shop',
  'commit_recipe_cook_log',
  'commit_recipe_category',
  'commit_recipe_delete',
  'commit_recipe_category_delete',
  'commit_wardrobe_outfit',
  'commit_wardrobe_wear',
  'commit_wardrobe_meta',
  'commit_wardrobe_body',
  'commit_review_journal',
  'commit_review_column',
  'commit_life_bet',
  'commit_task_category',
  'commit_project_category',
  'commit_tag',
  'commit_schedule_placement',
] as const;

export const S93_COMMIT_ACTIONS = [
  ...W1_COMMIT_ACTIONS,
  ...W2_COMMIT_ACTIONS,
  ...W3_COMMIT_ACTIONS,
  ...CATALOG_COMMIT_ACTIONS,
] as const;

let registeredForGlobal = false;

export function registerChatCommitHandlers(
  executor: ChatCommitExecutor = globalChatCommitExecutor,
): void {
  const packs = [
    financeCommitHandlers,
    taskCommitHandlers,
    habitCommitHandlers,
    foodCommitHandlers,
    memoCommitHandlers,
    recipeCommitHandlers,
    wardrobeCommitHandlers,
    wishCommitHandlers,
    profileCommitHandlers,
    lifeRoadCommitHandlers,
    reviewCommitHandlers,
    tagCommitHandlers,
    scheduleCommitHandlers,
    catalogCommitHandlers,
  ];
  for (const pack of packs) {
    for (const [action, handler] of Object.entries(pack)) {
      executor.register(action, handler);
    }
  }
  if (executor === globalChatCommitExecutor) {
    registeredForGlobal = true;
  }
}

/**
 * 幂等：仅对全局 executor 补挂 handlers。
 * 测试传入的独立 executor 不自动灌真实 repository（避免覆盖 mock）。
 */
export function ensureChatCommitHandlersRegistered(
  executor: ChatCommitExecutor = globalChatCommitExecutor,
): void {
  if (executor !== globalChatCommitExecutor) return;
  if (registeredForGlobal) return;
  registerChatCommitHandlers(executor);
}

export { mergeCashFlowDraft as mergeCashFlowDraftForTest } from './cash-flow-draft';
export {
  commitFinanceTxn,
  commitFinanceTransfer,
  commitFinanceScheduled,
  commitFinanceCashFlow,
  commitFinanceBudget,
  commitFinanceAccount,
  commitFinanceFlowCategory,
  commitFinanceAccountType,
  commitSavingsPlan,
  commitSavingsDeposit,
} from './finance';
export {
  commitTask,
  commitProject,
  commitTaskCategory,
  commitProjectCategory,
} from './task';
export { commitHabit, commitHabitCheckin, commitHabitContext } from './habit';
export { commitFoodIntake, commitWeight, commitIntakeTargets } from './food';
export { commitMemo } from './memo';
export {
  commitRecipe,
  commitRecipePlan,
  commitRecipeBasket,
  commitRecipeShop,
  commitRecipeCookLog,
  commitRecipeCategory,
  commitRecipeDelete,
  commitRecipeCategoryDelete,
} from './recipe';
export {
  commitWardrobeItem,
  commitWardrobeOutfit,
  commitWardrobeWear,
  commitWardrobeMeta,
  commitWardrobeBody,
} from './wardrobe';
export { commitWish } from './wish';
export { commitProfile } from './profile';
export { commitLifeRoadNode, commitLifeDirection, commitLifeBet } from './life-road';
export {
  commitReviewDimension,
  commitReviewJournal,
  commitReviewColumn,
} from './review';
export { commitTag } from './tag';
export { commitSchedulePlacement } from './schedule';
export { commitCatalogWrite } from './catalog';
