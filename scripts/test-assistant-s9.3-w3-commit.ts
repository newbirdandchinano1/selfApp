/**
 * S9.3 W3：§5.6-B 补洞 commit handlers 注册与 incomplete 校验。
 * 运行：npm run test:assistant-s9.3
 */
import assert from 'node:assert/strict';

import {
  buildClientCapabilities,
  ChatCommitExecutor,
  globalChatCommitExecutor,
} from '../lib/assistant/chat-commit';
import {
  W1_COMMIT_ACTIONS,
  W2_COMMIT_ACTIONS,
  W3_COMMIT_ACTIONS,
  commitFinanceAccount,
  commitFinanceAccountType,
  commitFinanceFlowCategory,
  commitHabitCheckin,
  commitHabitContext,
  commitIntakeTargets,
  commitLifeBet,
  commitRecipeBasket,
  commitRecipeCategory,
  commitRecipeCategoryDelete,
  commitRecipeCookLog,
  commitRecipeDelete,
  commitRecipeShop,
  commitReviewColumn,
  commitReviewJournal,
  commitSavingsDeposit,
  commitSavingsPlan,
  commitSchedulePlacement,
  commitTag,
  commitTaskCategory,
  commitProjectCategory,
  commitWardrobeBody,
  commitWardrobeMeta,
  commitWardrobeOutfit,
  commitWardrobeWear,
  commitWeight,
  ensureChatCommitHandlersRegistered,
  registerChatCommitHandlers,
} from '../lib/assistant/chat-commit-handlers';

let passed = 0;
let failed = 0;

function check(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`✓ ${name}`);
  } catch (e) {
    failed += 1;
    console.error(`✗ ${name}`);
    console.error(e);
  }
}

async function checkAsync(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed += 1;
    console.log(`✓ ${name}`);
  } catch (e) {
    failed += 1;
    console.error(`✗ ${name}`);
    console.error(e);
  }
}

ensureChatCommitHandlersRegistered();

check('W1+W2+W3 commit actions 已注册到全局 executor', () => {
  for (const action of [...W1_COMMIT_ACTIONS, ...W2_COMMIT_ACTIONS, ...W3_COMMIT_ACTIONS]) {
    assert.equal(
      globalChatCommitExecutor.has(action),
      true,
      `missing handler: ${action}`,
    );
  }
});

check('CLIENT_CAPABILITIES 含 W3 commit_*', () => {
  const caps = buildClientCapabilities();
  for (const action of W3_COMMIT_ACTIONS) {
    assert.ok(caps.includes(action), `capability missing: ${action}`);
  }
});

check('测试 executor 不自动灌真实 handler（保护 mock）', () => {
  const ex = new ChatCommitExecutor();
  ensureChatCommitHandlersRegistered(ex);
  assert.equal(ex.listRegisteredActions().length, 0);
  registerChatCommitHandlers(ex);
  assert.ok(ex.has('commit_finance_account'));
  assert.ok(ex.has('commit_habit_checkin'));
  assert.ok(ex.has('commit_weight'));
  assert.ok(ex.has('commit_recipe_basket'));
  assert.ok(ex.has('commit_wardrobe_outfit'));
  assert.ok(ex.has('commit_review_journal'));
  assert.ok(ex.has('commit_life_bet'));
  assert.ok(ex.has('commit_tag'));
  assert.ok(ex.has('commit_schedule_placement'));
});

async function main() {
  await checkAsync('缺名称时 commit_finance_account 失败', async () => {
    const r = await commitFinanceAccount({});
    assert.equal(r.ok, false);
    assert.equal(r.error?.code, 'incomplete_draft');
  });

  await checkAsync('缺名称时 commit_finance_flow_category 失败', async () => {
    const r = await commitFinanceFlowCategory({});
    assert.equal(r.ok, false);
    assert.equal(r.error?.code, 'incomplete_draft');
  });

  await checkAsync('缺名称时 commit_finance_account_type 失败', async () => {
    const r = await commitFinanceAccountType({});
    assert.equal(r.ok, false);
    assert.equal(r.error?.code, 'incomplete_draft');
  });

  await checkAsync('缺名称时 commit_savings_plan 失败', async () => {
    const r = await commitSavingsPlan({ target_amount: 1000 });
    assert.equal(r.ok, false);
    assert.equal(r.error?.code, 'incomplete_draft');
  });

  await checkAsync('缺金额时 commit_savings_deposit 失败', async () => {
    const r = await commitSavingsDeposit({ plan_name: '旅行' });
    assert.equal(r.ok, false);
    assert.equal(r.error?.code, 'incomplete_draft');
  });

  await checkAsync('缺习惯时 commit_habit_checkin 失败', async () => {
    const r = await commitHabitCheckin({});
    assert.equal(r.ok, false);
    assert.equal(r.error?.code, 'incomplete_draft');
  });

  await checkAsync('缺名称时 commit_habit_context 失败', async () => {
    const r = await commitHabitContext({});
    assert.equal(r.ok, false);
    assert.equal(r.error?.code, 'incomplete_draft');
  });

  await checkAsync('缺体重时 commit_weight 失败', async () => {
    const r = await commitWeight({});
    assert.equal(r.ok, false);
    assert.equal(r.error?.code, 'incomplete_draft');
  });

  await checkAsync('空目标时 commit_intake_targets 失败', async () => {
    const r = await commitIntakeTargets({});
    assert.equal(r.ok, false);
    assert.equal(r.error?.code, 'incomplete_draft');
  });

  await checkAsync('缺菜谱时 commit_recipe_basket 失败', async () => {
    const r = await commitRecipeBasket({});
    assert.equal(r.ok, false);
    assert.equal(r.error?.code, 'incomplete_draft');
  });

  await checkAsync('缺菜谱时 commit_recipe_shop 失败', async () => {
    const r = await commitRecipeShop({});
    assert.equal(r.ok, false);
    assert.equal(r.error?.code, 'incomplete_draft');
  });

  await checkAsync('缺菜谱时 commit_recipe_cook_log 失败', async () => {
    const r = await commitRecipeCookLog({});
    assert.equal(r.ok, false);
    assert.equal(r.error?.code, 'incomplete_draft');
  });

  await checkAsync('缺名称时 commit_recipe_category 失败', async () => {
    const r = await commitRecipeCategory({});
    assert.equal(r.ok, false);
    assert.equal(r.error?.code, 'incomplete_draft');
  });

  await checkAsync('缺菜谱时 commit_recipe_delete 失败', async () => {
    const r = await commitRecipeDelete({});
    assert.equal(r.ok, false);
    assert.equal(r.error?.code, 'incomplete_draft');
  });

  await checkAsync('缺分类时 commit_recipe_category_delete 失败', async () => {
    const r = await commitRecipeCategoryDelete({});
    assert.equal(r.ok, false);
    assert.equal(r.error?.code, 'incomplete_draft');
  });

  await checkAsync('缺名称时 commit_wardrobe_outfit 失败', async () => {
    const r = await commitWardrobeOutfit({});
    assert.equal(r.ok, false);
    assert.equal(r.error?.code, 'incomplete_draft');
  });

  await checkAsync('缺单品时 commit_wardrobe_wear 失败', async () => {
    const r = await commitWardrobeWear({});
    assert.equal(r.ok, false);
    assert.equal(r.error?.code, 'incomplete_draft');
  });

  await checkAsync('缺名称时 commit_wardrobe_meta 失败', async () => {
    const r = await commitWardrobeMeta({});
    assert.equal(r.ok, false);
    assert.equal(r.error?.code, 'incomplete_draft');
  });

  await checkAsync('空身材档案时 commit_wardrobe_body 失败', async () => {
    const r = await commitWardrobeBody({});
    assert.equal(r.ok, false);
    assert.equal(r.error?.code, 'incomplete_draft');
  });

  await checkAsync('缺正文时 commit_review_journal 失败', async () => {
    const r = await commitReviewJournal({});
    assert.equal(r.ok, false);
    assert.equal(r.error?.code, 'incomplete_draft');
  });

  await checkAsync('缺标题时 commit_review_column 失败', async () => {
    const r = await commitReviewColumn({});
    assert.equal(r.ok, false);
    assert.equal(r.error?.code, 'incomplete_draft');
  });

  await checkAsync('缺标题时 commit_life_bet 失败', async () => {
    const r = await commitLifeBet({});
    assert.equal(r.ok, false);
    assert.equal(r.error?.code, 'incomplete_draft');
  });

  await checkAsync('缺名称时 commit_task_category 失败', async () => {
    const r = await commitTaskCategory({});
    assert.equal(r.ok, false);
    assert.equal(r.error?.code, 'incomplete_draft');
  });

  await checkAsync('缺名称时 commit_project_category 失败', async () => {
    const r = await commitProjectCategory({});
    assert.equal(r.ok, false);
    assert.equal(r.error?.code, 'incomplete_draft');
  });

  await checkAsync('缺名称时 commit_tag 失败', async () => {
    const r = await commitTag({});
    assert.equal(r.ok, false);
    assert.equal(r.error?.code, 'incomplete_draft');
  });

  await checkAsync('缺主体时 commit_schedule_placement 失败', async () => {
    const r = await commitSchedulePlacement({ ymd: '2026-11-07' });
    assert.equal(r.ok, false);
    assert.equal(r.error?.code, 'incomplete_draft');
  });

  console.log(`\nS9.3 W3: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

void main();
