/**
 * P1：turn 客户端契约 + preview_recipe / preview_profile 映射单测。
 * 运行：npm run test:assistant-turn-p1
 */
import assert from 'node:assert/strict';
import { parseActionCards } from '../lib/assistant/action-card';
import { mapActionCardToConfirmPlan } from '../lib/assistant/confirm';

function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`[ok] ${name}`);
  } catch (e) {
    console.error(`[FAIL] ${name}`);
    throw e;
  }
}

check('parse turn 改草稿卡保留 id', () => {
  const cards = parseActionCards([
    {
      id: 'c1',
      domain: 'finance',
      intent: 'create',
      title: '记一笔支出',
      summary: '咖啡 · ¥18 · 支付宝',
      confidence: 0.91,
      needs_confirm: true,
      confirm_action: 'preview_finance_txn',
      draft: {
        transaction_type: 'expense',
        amount: 18,
        name: '咖啡',
        account_name: '支付宝',
      },
    },
  ]);
  assert.equal(cards[0].id, 'c1');
  assert.equal(cards[0].draft?.account_name, '支付宝');
  assert.equal(mapActionCardToConfirmPlan(cards[0]).kind, 'preview_finance_txn');
});

check('preview_recipe → recipe-edit', () => {
  const cards = parseActionCards([
    {
      id: 'c2',
      domain: 'recipe',
      intent: 'create',
      title: '新建菜谱',
      summary: '番茄炒蛋',
      confidence: 0.85,
      needs_confirm: true,
      confirm_action: 'preview_recipe',
      draft: { title: '番茄炒蛋' },
    },
  ]);
  const plan = mapActionCardToConfirmPlan(cards[0]);
  assert.equal(plan.kind, 'preview_recipe');
  if (plan.kind === 'preview_recipe') {
    assert.ok(typeof plan.href === 'object' || typeof plan.href === 'string');
  }
});

check('preview_profile → edit-profile', () => {
  const cards = parseActionCards([
    {
      id: 'c3',
      domain: 'general',
      intent: 'create',
      title: '画像草稿',
      confidence: 0.8,
      needs_confirm: true,
      confirm_action: 'preview_profile',
      draft: { persona: '喜欢跑步的工程师' },
    },
  ]);
  const plan = mapActionCardToConfirmPlan(cards[0]);
  assert.equal(plan.kind, 'preview_profile');
});

check('preview_habit / preview_memo / preview_wish', () => {
  assert.equal(
    mapActionCardToConfirmPlan(
      parseActionCards([
        {
          id: 'h1',
          domain: 'habit',
          intent: 'create',
          title: '新建习惯',
          confidence: 0.8,
          needs_confirm: true,
          confirm_action: 'preview_habit',
          draft: { name: '冥想' },
        },
      ])[0],
    ).kind,
    'preview_habit',
  );
  assert.equal(
    mapActionCardToConfirmPlan(
      parseActionCards([
        {
          id: 'm1',
          domain: 'memo',
          intent: 'create',
          title: '新建备忘',
          confidence: 0.8,
          needs_confirm: true,
          confirm_action: 'preview_memo',
          draft: { title: '开会纪要', body_plain: '三点决议' },
        },
      ])[0],
    ).kind,
    'preview_memo',
  );
  assert.equal(
    mapActionCardToConfirmPlan(
      parseActionCards([
        {
          id: 'w1',
          domain: 'wish',
          intent: 'create',
          title: '新建心愿',
          confidence: 0.8,
          needs_confirm: true,
          confirm_action: 'preview_wish',
          draft: { title: '机械键盘' },
        },
      ])[0],
    ).kind,
    'preview_wish',
  );
});

console.log('all turn / P1-2 confirm checks passed');
