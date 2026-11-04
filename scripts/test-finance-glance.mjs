/**
 * 纯规则单测：财务一眼账 glance
 * 运行：npm run test:finance-glance
 */
import assert from 'node:assert/strict';
import {
  buildFinanceGlance,
  computeBudgetRemainingPercent,
  financeGlanceToWidgetProps,
  pickEarliestScheduledExpense,
  resolveBudgetAccent,
  resolveFinanceMaskAmounts,
} from '../lib/widgets/finance-glance.ts';

assert.equal(computeBudgetRemainingPercent(40), 60);
assert.equal(computeBudgetRemainingPercent(100), 0);
assert.equal(computeBudgetRemainingPercent(120), -20);
assert.equal(computeBudgetRemainingPercent(null), null);

assert.equal(resolveBudgetAccent(79, true), 'ok');
assert.equal(resolveBudgetAccent(80, true), 'warn80');
assert.equal(resolveBudgetAccent(100, true), 'over');
assert.equal(resolveBudgetAccent(50, false), 'none');

assert.equal(resolveFinanceMaskAmounts({ maskMode: 'force_mask', globalMaskDefault: false }), true);
assert.equal(resolveFinanceMaskAmounts({ maskMode: 'plain', globalMaskDefault: true }), false);
assert.equal(resolveFinanceMaskAmounts({ maskMode: 'follow', globalMaskDefault: true }), true);
assert.equal(resolveFinanceMaskAmounts({ maskMode: 'follow', globalMaskDefault: false }), false);

const next = pickEarliestScheduledExpense([
  {
    id: 'b',
    name: '晚间',
    amount: 20,
    ymd: '2026-11-05',
    hour: 20,
    minute: 0,
    dueMs: 200,
  },
  {
    id: 'a',
    name: '房租',
    amount: 3000,
    ymd: '2026-11-05',
    hour: 9,
    minute: 0,
    dueMs: 100,
  },
]);
assert.equal(next?.id, 'a');

const g1 = buildFinanceGlance({
  todaySpent: 128.5,
  budgetUsagePercent: 82,
  hasBudget: true,
  next: next,
  primaryMetric: 'today_spent',
  showNextScheduled: true,
  maskAmounts: false,
  statusLine: '下次提醒 · 定时支出',
});
assert.equal(g1.budgetAccent, 'warn80');
assert.ok(g1.budgetRemainingPercent != null && Math.abs(g1.budgetRemainingPercent - 18) < 0.01);

const w1 = financeGlanceToWidgetProps(g1);
assert.match(w1.primaryLine, /今日/);
assert.match(w1.primaryLine, /128/);
assert.match(w1.secondaryLine, /剩余 18%/);
assert.match(w1.nextLine, /房租/);
assert.equal(w1.budgetAccentCode, 1);
assert.equal(w1.hasNext, 1);

const w2 = financeGlanceToWidgetProps(
  buildFinanceGlance({
    todaySpent: 50,
    budgetUsagePercent: 110,
    hasBudget: true,
    next: null,
    primaryMetric: 'budget_remaining',
    showNextScheduled: true,
    maskAmounts: true,
    statusLine: '',
  }),
);
assert.match(w2.primaryLine, /剩余 0%/);
assert.match(w2.secondaryLine, /¥\*\*\*/);
assert.equal(w2.budgetAccentCode, 2);
assert.equal(w2.hasNext, 0);
assert.equal(w2.masked, 1);

console.log('test-finance-glance: ok');
