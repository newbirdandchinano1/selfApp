/**
 * P0-1：全局助手 ActionCard / brief_context / confirm 映射单测。
 * 运行：npm run test:assistant-p0
 */
import assert from 'node:assert/strict';

import {
  parseActionCard,
  sanitizeActionCardAgainstWhitelist,
  type ActionCard,
} from '../lib/assistant/action-card';
import {
  buildAssistantBriefContext,
  buildAssistantBriefFactLines,
  collectAllowedIdsFromBriefContext,
  dayPartFromDate,
} from '../lib/assistant/brief-context';
import {
  executeAssistantConfirm,
  isForbiddenConfirmAction,
  mapActionCardToConfirmPlan,
} from '../lib/assistant/confirm';

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

check('dayPartFromDate 时段划分', () => {
  assert.equal(dayPartFromDate(new Date(2026, 10, 7, 8, 0)), 'morning');
  assert.equal(dayPartFromDate(new Date(2026, 10, 7, 14, 0)), 'afternoon');
  assert.equal(dayPartFromDate(new Date(2026, 10, 7, 19, 0)), 'evening');
  assert.equal(dayPartFromDate(new Date(2026, 10, 7, 23, 0)), 'night');
});

check('buildAssistantBriefContext 裁剪上限 + 采集白名单 id', () => {
  const frogs = Array.from({ length: 8 }, (_, i) => ({
    id: `tsk_${i}`,
    title: `任务${i}`,
    priority: i,
  }));
  const ctx = buildAssistantBriefContext({
    todayYmd: '2026-11-07',
    boundary: { hour: 4, minute: 0 },
    now: new Date(2026, 10, 7, 9, 0),
    frogCandidates: frogs,
    openTodos: frogs.map((t, i) => ({ ...t, id: `todo_${i}` })),
    habitGaps: [
      { id: 'hab_a', name: '冥想', today_count: 0, daily_goal: 1 },
      { id: 'hab_b', name: '跑步', today_count: 0, daily_goal: 1 },
      { id: 'hab_c', name: '阅读', today_count: 0, daily_goal: 1 },
      { id: 'hab_d', name: '拉伸', today_count: 0, daily_goal: 1 },
      { id: 'hab_e', name: '喝水', today_count: 0, daily_goal: 1 },
      { id: 'hab_f', name: '多余', today_count: 0, daily_goal: 1 },
    ],
    overdueCount: 2,
    recentTxns: [{ id: 'txn_1', name: '咖啡', amount: -18 }],
    upcomingScheduled: [{ id: 'sch_1', name: '房租', amount: 3000, due_ymd: '2026-11-07' }],
    budgetRemaining: 1260,
    todayUnlogged: false,
  });

  assert.equal(ctx.meta.today_ymd, '2026-11-07');
  assert.equal(ctx.meta.day_part, 'morning');
  assert.equal(ctx.tasks.frog_candidates.length, 5);
  assert.equal(ctx.tasks.open_todos.length, 8);
  assert.equal(ctx.habits.gaps.length, 5);
  assert.equal(ctx.finance.budget_remaining, 1260);

  const ids = collectAllowedIdsFromBriefContext(ctx);
  assert.ok(ids.includes('tsk_0'));
  assert.ok(ids.includes('hab_a'));
  assert.ok(ids.includes('txn_1'));
  assert.ok(ids.includes('sch_1'));
  assert.ok(!ids.includes('hab_f'));
  assert.ok(!ids.includes('tsk_7'));

  const facts = buildAssistantBriefFactLines(ctx);
  assert.ok(facts.some(f => f.domain === 'task' && f.text.includes('逾期 2')));
  assert.ok(facts.some(f => f.domain === 'finance' && /1[,，]?260/.test(f.text)));
  assert.ok(facts.some(f => f.domain === 'habit' && f.text.includes('冥想')));
});

check('parseActionCard 剔除敏感 confirm_action', () => {
  const card = parseActionCard({
    id: 'x1',
    domain: 'wish',
    intent: 'create',
    title: '兑奖',
    confidence: 0.9,
    needs_confirm: true,
    confirm_action: 'redeem_wish',
  });
  assert.equal(card.intent, 'clarify');
  assert.equal(card.confirm_action, undefined);
  assert.equal(card.needs_confirm, false);
});

check('parseActionCard 写库类强制 needs_confirm', () => {
  const card = parseActionCard({
    id: 'c1',
    domain: 'finance',
    intent: 'create',
    title: '记一笔',
    confidence: 0.9,
    needs_confirm: false,
    confirm_action: 'preview_finance_txn',
    draft: { amount: 18, name: '咖啡' },
  });
  assert.equal(card.needs_confirm, true);
  assert.equal(card.confirm_action, 'preview_finance_txn');
});

check('sanitizeActionCardAgainstWhitelist 丢弃非法 ref_ids / draft id', () => {
  const card: ActionCard = {
    id: 'b1',
    domain: 'task',
    intent: 'suggest_today',
    title: '建议先做',
    confidence: 0.8,
    needs_confirm: true,
    ref_ids: ['tsk_aaa', 'tsk_FORGED'],
    confirm_action: 'frog_assign',
    draft: { frog_task_id: 'tsk_aaa', reason: '逾期' },
  };
  const r = sanitizeActionCardAgainstWhitelist(card, ['tsk_aaa', 'hab_x']);
  assert.deepEqual(r.card.ref_ids, ['tsk_aaa']);
  assert.deepEqual(r.dropped_ids, ['tsk_FORGED']);
  assert.equal(r.degraded_to_clarify, false);
  assert.equal(r.card.draft?.frog_task_id, 'tsk_aaa');
});

check('sanitize：核心 id 全失效 → 降级 clarify', () => {
  const card: ActionCard = {
    id: 'b2',
    domain: 'task',
    intent: 'suggest_today',
    title: '建议先做',
    confidence: 0.8,
    needs_confirm: true,
    ref_ids: ['tsk_FORGED'],
    confirm_action: 'frog_assign',
    draft: { frog_task_id: 'tsk_FORGED' },
  };
  const r = sanitizeActionCardAgainstWhitelist(card, ['tsk_aaa']);
  assert.equal(r.degraded_to_clarify, true);
  assert.equal(r.card.intent, 'clarify');
  assert.equal(r.card.confirm_action, undefined);
  assert.ok(r.dropped_ids.includes('tsk_FORGED'));
});

check('mapConfirm：finance / task / open_route / frog_assign', () => {
  const finance = mapActionCardToConfirmPlan({
    id: 'c1',
    domain: 'finance',
    intent: 'create',
    title: '记一笔',
    confidence: 0.9,
    needs_confirm: true,
    confirm_action: 'preview_finance_txn',
    draft: { amount: 18, name: '咖啡', account_name: '微信' },
  });
  assert.equal(finance.kind, 'preview_finance_txn');

  const task = mapActionCardToConfirmPlan({
    id: 'c2',
    domain: 'task',
    intent: 'create',
    title: '新建待办',
    confidence: 0.84,
    needs_confirm: true,
    confirm_action: 'preview_task',
    draft: { title: '交季度总结', priority: 4, due_ymd: '2026-11-07' },
  });
  assert.equal(task.kind, 'preview_task');
  if (task.kind === 'preview_task') {
    const href = task.href as { pathname?: string; params?: Record<string, string> };
    assert.equal(href.pathname, '/add-task');
    assert.equal(href.params?.title, '交季度总结');
    assert.equal(href.params?.priority, '4');
  }

  const route = mapActionCardToConfirmPlan({
    id: 'b3',
    domain: 'habit',
    intent: 'navigate',
    title: '补打卡',
    confidence: 0.7,
    needs_confirm: false,
    confirm_action: 'open_route',
    route_href: '/(tasks)/habit-detail',
    route_params: { id: 'hab_x' },
  });
  assert.equal(route.kind, 'open_route');

  const frog = mapActionCardToConfirmPlan(
    {
      id: 'b1',
      domain: 'task',
      intent: 'suggest_today',
      title: '建议先做',
      confidence: 0.8,
      needs_confirm: true,
      ref_ids: ['tsk_aaa'],
      confirm_action: 'frog_assign',
      draft: { frog_task_id: 'tsk_aaa' },
    },
    { allowedIds: ['tsk_aaa'], assignYmd: '2026-11-07' },
  );
  assert.equal(frog.kind, 'frog_assign');
  if (frog.kind === 'frog_assign') {
    assert.equal(frog.taskId, 'tsk_aaa');
    assert.equal(frog.assignYmd, '2026-11-07');
  }
});

check('mapConfirm：伪造 frog id 经白名单后 rejected/clarify', () => {
  const plan = mapActionCardToConfirmPlan(
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
    { allowedIds: ['tsk_aaa'] },
  );
  assert.ok(plan.kind === 'clarify' || plan.kind === 'rejected');
});

check('isForbiddenConfirmAction', () => {
  assert.equal(isForbiddenConfirmAction('redeem_wish'), true);
  assert.equal(isForbiddenConfirmAction('preview_finance_txn'), false);
});

async function main() {
  await checkAsync('executeAssistantConfirm：preview 需注入；frog 可走 deps', async () => {
    const financePlan = mapActionCardToConfirmPlan({
      id: 'c1',
      domain: 'finance',
      intent: 'create',
      title: '记一笔',
      confidence: 0.9,
      needs_confirm: true,
      confirm_action: 'preview_finance_txn',
      draft: { amount: 18, name: '咖啡' },
    });
    const missing = await executeAssistantConfirm(financePlan, {});
    assert.equal(missing.ok, false);

    let opened = false;
    const ok = await executeAssistantConfirm(financePlan, {
      openFinancePreview: async () => {
        opened = true;
      },
    });
    assert.equal(ok.ok, true);
    assert.equal(opened, true);

    let assigned: { id: string; ymd: string } | null = null;
    const frogPlan = mapActionCardToConfirmPlan(
      {
        id: 'b1',
        domain: 'task',
        intent: 'suggest_today',
        title: '建议先做',
        confidence: 0.8,
        needs_confirm: true,
        ref_ids: ['tsk_aaa'],
        confirm_action: 'frog_assign',
        draft: { frog_task_id: 'tsk_aaa' },
      },
      { allowedIds: ['tsk_aaa'], assignYmd: '2026-11-07' },
    );
    const frogOk = await executeAssistantConfirm(frogPlan, {
      assignFrog: async (taskId, assignYmd) => {
        assigned = { id: taskId, ymd: assignYmd };
      },
    });
    assert.equal(frogOk.ok, true);
    assert.deepEqual(assigned, { id: 'tsk_aaa', ymd: '2026-11-07' });
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

void main();
