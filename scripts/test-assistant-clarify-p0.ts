/**
 * P0-4：澄清选项拼文案 + soft open_route 计划映射（不打网）。
 * 运行：npm run test:assistant-clarify-p0
 */
import assert from 'node:assert/strict';

import { composeClarifyResubmitText, isClarifyCard } from '../lib/assistant/clarify';
import { parseActionCard } from '../lib/assistant/action-card';
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

check('纯数字选项「记账 28 元」直接回投', () => {
  assert.equal(composeClarifyResubmitText('28', '记账 28 元'), '记账 28 元');
});

check('短标签 + 原文 → 「记账 咖啡 18」', () => {
  assert.equal(composeClarifyResubmitText('咖啡 18', '记账'), '记账 咖啡 18');
});

check('记饮食 + 原文', () => {
  assert.equal(composeClarifyResubmitText('冒菜', '记饮食'), '记饮食 冒菜');
});

check('取消保留原文', () => {
  assert.equal(composeClarifyResubmitText('随便', '取消'), '随便');
});

check('isClarifyCard', () => {
  assert.equal(isClarifyCard('clarify'), true);
  assert.equal(isClarifyCard('create'), false);
  assert.equal(isClarifyCard('navigate', '还要补充吗？'), true);
});

check('澄清卡 → clarify 计划', () => {
  const card = parseActionCard({
    id: 'c0',
    domain: 'general',
    intent: 'clarify',
    title: '需要补充',
    confidence: 0.4,
    needs_confirm: false,
    clarify_question: '「28」是记账还是别的？',
    clarify_choices: ['记账 28 元', '建待办', '记饮食'],
  });
  const plan = mapActionCardToConfirmPlan(card);
  assert.equal(plan.kind, 'clarify');
  if (plan.kind === 'clarify') {
    assert.ok(plan.choices?.includes('记账 28 元'));
  }
});

check('soft open_route 财务卡 → open_route 计划', () => {
  const card = parseActionCard({
    id: 'c0',
    domain: 'finance',
    intent: 'navigate',
    title: '打开财务继续',
    confidence: 0.65,
    needs_confirm: false,
    confirm_action: 'open_route',
    route_href: '/(tabs)/finance',
    route_params: { q: '看看这个' },
  });
  const plan = mapActionCardToConfirmPlan(card);
  assert.equal(plan.kind, 'open_route');
  if (plan.kind === 'open_route') {
    const href = plan.href as { pathname?: string; params?: Record<string, string> };
    assert.equal(href.pathname, '/(tabs)/finance');
    assert.equal(href.params?.q, '看看这个');
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
