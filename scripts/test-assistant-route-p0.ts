/**
 * P0-2：route 客户端契约 / confirm 接线形状（不打网）。
 * 运行：npm run test:assistant-route-p0
 */
import assert from 'node:assert/strict';

import { parseActionCards, sanitizeActionCardsAgainstWhitelist } from '../lib/assistant/action-card';
import { mapActionCardToConfirmPlan } from '../lib/assistant/confirm';
import {
  buildAssistantBriefContext,
  collectAllowedIdsFromBriefContext,
} from '../lib/assistant/brief-context';

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

check('parse route 样例卡 → preview_finance_txn 计划', () => {
  const cards = parseActionCards([
    {
      id: 'c1',
      domain: 'finance',
      intent: 'create',
      title: '记一笔支出',
      summary: '咖啡 ¥18 · 微信',
      confidence: 0.91,
      needs_confirm: true,
      confirm_action: 'preview_finance_txn',
      draft: {
        transaction_type: 'expense',
        amount: 18,
        name: '咖啡',
        account_name: '微信',
        category_label: '饮品',
      },
    },
  ]);
  const plan = mapActionCardToConfirmPlan(cards[0]);
  assert.equal(plan.kind, 'preview_finance_txn');
  if (plan.kind === 'preview_finance_txn') {
    assert.equal(plan.draft.amount, 18);
    assert.equal(plan.draft.name, '咖啡');
  }
});

check('food 卡 → preview_food_intake', () => {
  const cards = parseActionCards([
    {
      id: 'c1',
      domain: 'food',
      intent: 'create',
      title: '记饮食',
      confidence: 0.8,
      needs_confirm: true,
      confirm_action: 'preview_food_intake',
      draft: {
        food_summary: '冒菜',
        hydration_ml: 0,
        protein_g: 20,
        carbohydrate_g: 40,
        calories_kcal: 450,
        ai_evaluation: '',
      },
    },
  ]);
  assert.equal(mapActionCardToConfirmPlan(cards[0]).kind, 'preview_food_intake');
});

check('task 卡 → preview_task href /add-task', () => {
  const cards = parseActionCards([
    {
      id: 'c2',
      domain: 'task',
      intent: 'create',
      title: '新建待办',
      confidence: 0.84,
      needs_confirm: true,
      confirm_action: 'preview_task',
      draft: { title: '交季度总结', priority: 4, due_ymd: '2026-11-07' },
    },
  ]);
  const plan = mapActionCardToConfirmPlan(cards[0]);
  assert.equal(plan.kind, 'preview_task');
  if (plan.kind === 'preview_task') {
    const href = plan.href as { pathname?: string; params?: Record<string, string> };
    assert.equal(href.pathname, '/add-task');
    assert.equal(href.params?.title, '交季度总结');
  }
});

check('brief 白名单消毒伪造 frog id', () => {
  const ctx = buildAssistantBriefContext({
    todayYmd: '2026-11-07',
    boundary: { hour: 0, minute: 0 },
    frogCandidates: [{ id: 'tsk_aaa', title: '写方案' }],
  });
  const allowed = collectAllowedIdsFromBriefContext(ctx);
  const cards = parseActionCards([
    {
      id: 'b1',
      domain: 'task',
      intent: 'suggest_today',
      title: '建议先做',
      confidence: 0.8,
      needs_confirm: true,
      ref_ids: ['tsk_FORGED'],
      confirm_action: 'frog_assign',
      draft: { frog_task_id: 'tsk_FORGED' },
    },
  ]);
  const { cards: cleaned } = sanitizeActionCardsAgainstWhitelist(cards, allowed);
  assert.equal(cleaned[0].intent, 'clarify');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
