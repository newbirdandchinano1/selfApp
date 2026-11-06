/**
 * P0-3：daily-brief 事实规则 / 卡消毒 / 失败回退形状（不打网）。
 * 运行：npm run test:assistant-daily-brief-p0
 */
import assert from 'node:assert/strict';

import { parseActionCards, sanitizeActionCardsAgainstWhitelist } from '../lib/assistant/action-card';
import {
  buildAssistantBriefContext,
  buildAssistantBriefFactLines,
  collectAllowedIdsFromBriefContext,
} from '../lib/assistant/brief-context';
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

const sampleCtx = buildAssistantBriefContext({
  todayYmd: '2026-11-07',
  boundary: { hour: 4, minute: 0 },
  now: new Date(2026, 10, 7, 9, 0),
  overdueCount: 2,
  frogCandidates: [{ id: 'tsk_aaa', title: '写方案', priority: 4 }],
  openTodos: [{ id: 'todo_1', title: '回邮件' }],
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
    records: [{ title: '早饭', calories: 400 }],
  },
  budgetRemaining: 1260,
  todayUnlogged: false,
  upcomingScheduled: [{ id: 'sch_1', name: '房租提醒', amount: 3000, due_ymd: '2026-11-07' }],
});

check('规则 facts 含任务/蛋白/预算/习惯', () => {
  const facts = buildAssistantBriefFactLines(sampleCtx);
  assert.ok(facts.some(f => f.domain === 'task' && f.text.includes('逾期 2')));
  assert.ok(facts.some(f => f.domain === 'task' && f.text.includes('写方案')));
  assert.ok(facts.some(f => f.domain === 'health' && f.text.includes('42') && f.text.includes('110')));
  assert.ok(facts.some(f => f.domain === 'finance' && f.text.includes('预算剩余')));
  assert.ok(facts.some(f => f.domain === 'habit' && f.text.includes('冥想')));
});

check('daily-brief 样例卡：frog_assign + open_route ≤3 且白名单通过', () => {
  const allowed = collectAllowedIdsFromBriefContext(sampleCtx);
  const cards = parseActionCards([
    {
      id: 'b1',
      domain: 'task',
      intent: 'suggest_today',
      title: '建议先做',
      summary: '写方案（紧急重要）',
      confidence: 0.8,
      needs_confirm: true,
      ref_ids: ['tsk_aaa'],
      confirm_action: 'frog_assign',
      draft: { frog_task_id: 'tsk_aaa', assign_ymd: '2026-11-07', reason: '逾期且四象限最高' },
    },
    {
      id: 'b2',
      domain: 'food',
      intent: 'navigate',
      title: '补一餐蛋白',
      summary: '打开摄入，按缺口记一餐',
      confidence: 0.75,
      needs_confirm: false,
      confirm_action: 'open_route',
      route_href: '/(tabs)',
    },
    {
      id: 'b3',
      domain: 'habit',
      intent: 'navigate',
      title: '补打卡冥想',
      summary: '今日目标未完成',
      confidence: 0.77,
      needs_confirm: false,
      ref_ids: ['hab_x'],
      confirm_action: 'open_route',
      route_href: '/habit-detail',
      route_params: { habitId: 'hab_x' },
    },
  ]);
  assert.equal(cards.length, 3);
  const { cards: clean, dropped_ids } = sanitizeActionCardsAgainstWhitelist(cards, allowed);
  assert.equal(dropped_ids.length, 0);
  assert.equal(clean.length, 3);

  const frog = mapActionCardToConfirmPlan(clean[0], {
    allowedIds: allowed,
    assignYmd: '2026-11-07',
  });
  assert.equal(frog.kind, 'frog_assign');

  const food = mapActionCardToConfirmPlan(clean[1]);
  assert.equal(food.kind, 'open_route');

  const habit = mapActionCardToConfirmPlan(clean[2], { allowedIds: allowed });
  assert.equal(habit.kind, 'open_route');
});

check('伪造 frog id 被白名单降级', () => {
  const allowed = collectAllowedIdsFromBriefContext(sampleCtx);
  const cards = parseActionCards([
    {
      id: 'b9',
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
  const { cards: clean } = sanitizeActionCardsAgainstWhitelist(cards, allowed);
  const plan = mapActionCardToConfirmPlan(clean[0], {
    allowedIds: allowed,
    assignYmd: '2026-11-07',
  });
  assert.ok(plan.kind === 'clarify' || plan.kind === 'rejected');
});

check('空 brief 事实为空列表可展示', () => {
  const empty = buildAssistantBriefContext({
    todayYmd: '2026-11-07',
    boundary: { hour: 4, minute: 0 },
    now: new Date(2026, 10, 7, 9, 0),
  });
  const facts = buildAssistantBriefFactLines(empty);
  assert.equal(facts.length, 0);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
