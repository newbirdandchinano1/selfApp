/**
 * S9.3 W2：recipe / wardrobe / wish / profile / life_road / review commit handlers。
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
  commitLifeDirection,
  commitLifeRoadNode,
  commitProfile,
  commitRecipe,
  commitRecipePlan,
  commitReviewDimension,
  commitWardrobeItem,
  commitWish,
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

check('W1+W2 commit actions 已注册到全局 executor', () => {
  for (const action of [...W1_COMMIT_ACTIONS, ...W2_COMMIT_ACTIONS]) {
    assert.equal(
      globalChatCommitExecutor.has(action),
      true,
      `missing handler: ${action}`,
    );
  }
});

check('CLIENT_CAPABILITIES 含 W2 commit_*', () => {
  const caps = buildClientCapabilities();
  for (const action of W2_COMMIT_ACTIONS) {
    assert.ok(caps.includes(action), `capability missing: ${action}`);
  }
});

check('测试 executor 不自动灌真实 handler（保护 mock）', () => {
  const ex = new ChatCommitExecutor();
  ensureChatCommitHandlersRegistered(ex);
  assert.equal(ex.listRegisteredActions().length, 0);
  registerChatCommitHandlers(ex);
  assert.ok(ex.has('commit_recipe'));
  assert.ok(ex.has('commit_wardrobe_item'));
  assert.ok(ex.has('commit_wish'));
  assert.ok(ex.has('commit_profile'));
  assert.ok(ex.has('commit_life_road_node'));
  assert.ok(ex.has('commit_review_dimension'));
});

async function main() {
  await checkAsync('缺标题时 commit_recipe 失败', async () => {
    const r = await commitRecipe({});
    assert.equal(r.ok, false);
    assert.equal(r.error?.code, 'incomplete_draft');
  });

  await checkAsync('空 plan 时 commit_recipe_plan 失败', async () => {
    const r = await commitRecipePlan({ plan: [] });
    assert.equal(r.ok, false);
    assert.equal(r.error?.code, 'incomplete_draft');
  });

  await checkAsync('缺名称时 commit_wardrobe_item 失败', async () => {
    const r = await commitWardrobeItem({});
    assert.equal(r.ok, false);
    assert.equal(r.error?.code, 'incomplete_draft');
  });

  await checkAsync('缺标题时 commit_wish 失败', async () => {
    const r = await commitWish({});
    assert.equal(r.ok, false);
    assert.equal(r.error?.code, 'incomplete_draft');
  });

  await checkAsync('兑换意图 commit_wish 拒绝', async () => {
    const r = await commitWish({ title: '电影', action: 'redeem' });
    assert.equal(r.ok, false);
    assert.equal(r.error?.code, 'forbidden');
  });

  await checkAsync('空草稿时 commit_profile 失败', async () => {
    const r = await commitProfile({});
    assert.equal(r.ok, false);
    assert.equal(r.error?.code, 'incomplete_draft');
  });

  await checkAsync('缺节点时 commit_life_road_node 失败', async () => {
    const r = await commitLifeRoadNode({});
    assert.equal(r.ok, false);
    assert.equal(r.error?.code, 'incomplete_draft');
  });

  await checkAsync('终态无 allow_terminal 时拒绝', async () => {
    const r = await commitLifeRoadNode({
      node_id: 'lrn_dummy',
      title: '测试',
      status: 'arrived',
    });
    assert.equal(r.ok, false);
    assert.equal(r.error?.code, 'terminal_needs_confirm');
  });

  await checkAsync('缺正文时 commit_life_direction 失败', async () => {
    const r = await commitLifeDirection({});
    assert.equal(r.ok, false);
    assert.equal(r.error?.code, 'incomplete_draft');
  });

  await checkAsync('缺标题时 commit_review_dimension 失败', async () => {
    const r = await commitReviewDimension({ scope: 'daily', body: 'x' });
    assert.equal(r.ok, false);
    assert.equal(r.error?.code, 'incomplete_draft');
  });

  console.log(`\nS9.3 W2: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

void main();
