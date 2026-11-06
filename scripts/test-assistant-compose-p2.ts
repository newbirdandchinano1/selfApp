/**
 * P2-1：compose 意图识别 / review_quick_create 确认映射（不打网）。
 * 运行：npm run test:assistant-compose-p2
 */
import assert from 'node:assert/strict';

import { parseActionCards, sanitizeActionCardsAgainstWhitelist } from '../lib/assistant/action-card';
import {
  buildAssistantBriefContext,
  collectAllowedIdsFromBriefContext,
} from '../lib/assistant/brief-context';
import {
  ASSISTANT_COMPOSE_MAX_CARDS,
  looksLikeComposeGoal,
} from '../lib/assistant/compose-intent';
import { mapActionCardToConfirmPlan } from '../lib/assistant/confirm';

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

check('按缺口安排晚上 → compose', () => {
  assert.equal(looksLikeComposeGoal('按缺口安排晚上'), true);
});
check('复盘后给三件能做的事 → compose', () => {
  assert.equal(looksLikeComposeGoal('复盘后给三件能做的事'), true);
});
check('咖啡 18 微信 → route', () => {
  assert.equal(looksLikeComposeGoal('咖啡 18 微信'), false);
});
check('一碗冒菜 → route', () => {
  assert.equal(looksLikeComposeGoal('一碗冒菜'), false);
});
check('随便安排明天开会 → 不误判 compose', () => {
  assert.equal(looksLikeComposeGoal('安排明天开会'), false);
});

const sampleCtx = buildAssistantBriefContext({
  todayYmd: '2026-11-07',
  boundary: { hour: 4, minute: 0 },
  now: new Date(2026, 10, 7, 20, 0),
  overdueCount: 2,
  frogCandidates: [{ id: 'tsk_aaa', title: '写方案', priority: 4 }],
  habitGaps: [{ id: 'hab_x', name: '冥想', today_count: 0, daily_goal: 1 }],
  healthFacts: {
    calories: 800,
    protein: 42,
    carbohydrate: 90,
    hydration: 500,
    targetCalories: 2000,
    targetProtein: 110,
    targetCarbohydrate: 200,
    targetHydration: 2000,
    records: [],
  },
});

check('review_quick_create → 待办预填 href（对齐 review-ai-quick-create）', () => {
  const allowed = collectAllowedIdsFromBriefContext(sampleCtx);
  const cards = parseActionCards([
    {
      id: 'c1',
      domain: 'review',
      intent: 'create',
      title: '复盘建议·待办',
      summary: '写方案',
      confidence: 0.78,
      needs_confirm: true,
      confirm_action: 'review_quick_create',
      draft: {
        action: 'todo',
        title: '写方案',
        body: '来自复盘编排：优先推进「写方案」',
      },
      ref_ids: ['tsk_aaa'],
    },
    {
      id: 'c2',
      domain: 'review',
      intent: 'create',
      title: '复盘建议·习惯',
      confidence: 0.76,
      needs_confirm: true,
      confirm_action: 'review_quick_create',
      draft: { action: 'habit', title: '冥想', body: '巩固习惯' },
      ref_ids: ['hab_x'],
    },
    {
      id: 'c3',
      domain: 'food',
      intent: 'navigate',
      title: '按缺口补一餐',
      confidence: 0.8,
      needs_confirm: false,
      confirm_action: 'open_route',
      route_href: '/(tabs)',
    },
  ]);
  assert.ok(cards.length <= ASSISTANT_COMPOSE_MAX_CARDS);
  const { cards: clean, dropped_ids } = sanitizeActionCardsAgainstWhitelist(cards, allowed);
  assert.equal(dropped_ids.length, 0);

  const todo = mapActionCardToConfirmPlan(clean[0], { allowedIds: allowed });
  assert.equal(todo.kind, 'review_quick_create');
  if (todo.kind === 'review_quick_create') {
    const href = todo.href;
    assert.ok(typeof href === 'object' && href.pathname === '/add-task');
    if (typeof href === 'object') {
      assert.ok(String(href.params?.title || '').includes('写方案'));
    }
  }

  const habit = mapActionCardToConfirmPlan(clean[1], { allowedIds: allowed });
  assert.equal(habit.kind, 'review_quick_create');
  if (habit.kind === 'review_quick_create') {
    const href = habit.href;
    assert.ok(typeof href === 'object' && href.pathname === '/add-habit');
  }

  const food = mapActionCardToConfirmPlan(clean[2]);
  assert.equal(food.kind, 'open_route');
});

check('draft_title 形态经 normalize 后仍可确认（Agent 会转 title）', () => {
  // App 侧若收到未归一化 draft，confirm 读 title；缺 title 时用 card.title
  const cards = parseActionCards([
    {
      id: 'c9',
      domain: 'review',
      intent: 'create',
      title: '明日青蛙',
      confidence: 0.7,
      needs_confirm: true,
      confirm_action: 'review_quick_create',
      draft: { action: 'todo', title: '明日青蛙', body: '只排一项' },
    },
  ]);
  const plan = mapActionCardToConfirmPlan(cards[0]);
  assert.equal(plan.kind, 'review_quick_create');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
