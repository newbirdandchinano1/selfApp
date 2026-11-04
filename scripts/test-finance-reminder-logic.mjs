/**
 * 财务提醒纯规则单测（不连系统通知）。
 * 用法：node --experimental-strip-types scripts/test-finance-reminder-logic.mjs
 */

import assert from 'node:assert/strict';
import {
  buildScheduledExpenseAdvanceFireAt,
  computeBudgetUsagePercent,
  findNextLedgerWrapFireAt,
  findNextWeekdayFireAt,
  markBudgetThresholdNotified,
  pickNextScheduledExpenseReminder,
  resolveBudgetThresholdToNotify,
} from '../lib/finance-reminder-logic.ts';

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

test('advance fireAt subtracts minutes', () => {
  const at = buildScheduledExpenseAdvanceFireAt('2026-11-04', 10, 0, 30);
  assert.ok(at);
  assert.equal(at.getHours(), 9);
  assert.equal(at.getMinutes(), 30);
});

test('advance 0 is due clock', () => {
  const at = buildScheduledExpenseAdvanceFireAt('2026-11-04', 10, 15, 0);
  assert.ok(at);
  assert.equal(at.getHours(), 10);
  assert.equal(at.getMinutes(), 15);
});

test('pick advance when future', () => {
  const now = new Date(2026, 10, 4, 8, 0, 0, 0);
  const next = pickNextScheduledExpenseReminder({
    dueYmds: ['2026-11-04'],
    hour: 10,
    minute: 0,
    advanceMinutes: 30,
    eveningWrapEnabled: true,
    eveningWrapHour: 20,
    eveningWrapMinute: 0,
    now,
    needsReminderOnYmd: () => true,
  });
  assert.ok(next);
  assert.equal(next.kind, 'advance');
  assert.equal(next.fireAt.getHours(), 9);
});

test('pick evening wrap after due passed and unpaid', () => {
  const now = new Date(2026, 10, 4, 11, 0, 0, 0);
  const next = pickNextScheduledExpenseReminder({
    dueYmds: ['2026-11-04', '2026-11-05'],
    hour: 10,
    minute: 0,
    advanceMinutes: 30,
    eveningWrapEnabled: true,
    eveningWrapHour: 20,
    eveningWrapMinute: 0,
    now,
    needsReminderOnYmd: (ymd) => ymd === '2026-11-04',
  });
  assert.ok(next);
  assert.equal(next.kind, 'evening_wrap');
  assert.equal(next.dueYmd, '2026-11-04');
  assert.equal(next.fireAt.getHours(), 20);
});

test('skip paid day and use next due', () => {
  const now = new Date(2026, 10, 4, 11, 0, 0, 0);
  const next = pickNextScheduledExpenseReminder({
    dueYmds: ['2026-11-04', '2026-11-11'],
    hour: 10,
    minute: 0,
    advanceMinutes: 0,
    eveningWrapEnabled: false,
    eveningWrapHour: 20,
    eveningWrapMinute: 0,
    now,
    needsReminderOnYmd: (ymd) => ymd === '2026-11-11',
  });
  assert.ok(next);
  assert.equal(next.dueYmd, '2026-11-11');
  assert.equal(next.kind, 'advance');
});

test('budget percent and threshold order', () => {
  const usage = computeBudgetUsagePercent({
    baseAmount: 1000,
    includeLastBalance: false,
    lastPeriodRemaining: 0,
    scheduledDeduction: 0,
    periodIncome: 0,
    periodExpense: 850,
  });
  assert.equal(usage.totalBudget, 1000);
  assert.ok(Math.abs(usage.percent - 85) < 1e-6);
  const kind = resolveBudgetThresholdToNotify({
    percent: usage.percent,
    notify50: true,
    notify80: true,
    notifyOver: true,
    already: {},
  });
  assert.equal(kind, 't80');
  const after80 = markBudgetThresholdNotified({}, 't80');
  assert.equal(after80.t80, true);
  assert.equal(after80.t50, true);
  const again = resolveBudgetThresholdToNotify({
    percent: 85,
    notify50: true,
    notify80: true,
    notifyOver: true,
    already: after80,
  });
  assert.equal(again, null);
});

test('overspend prefers over', () => {
  const kind = resolveBudgetThresholdToNotify({
    percent: 120,
    notify50: true,
    notify80: true,
    notifyOver: true,
    already: {},
  });
  assert.equal(kind, 'over');
});

test('weekday fireAt skips past today slot', () => {
  // 2026-11-04 is Wednesday
  const now = new Date(2026, 10, 4, 12, 0, 0, 0);
  const sun = findNextWeekdayFireAt({ weekday: 0, hour: 10, minute: 0, now });
  assert.ok(sun);
  assert.equal(sun.getDay(), 0);
  assert.ok(sun.getTime() > now.getTime());
});

test('ledger wrap skips days with txn or mute', () => {
  const now = new Date(2026, 10, 4, 22, 0, 0, 0);
  const fireAt = findNextLedgerWrapFireAt({
    hour: 21,
    minute: 0,
    now,
    muteYmd: '2026-11-05',
    hasTxnOnYmd: (ymd) => ymd === '2026-11-04',
    ymdOf: (d) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    },
  });
  assert.ok(fireAt);
  // 4 有流水、5 静音 → 6
  assert.equal(fireAt.getDate(), 6);
  assert.equal(fireAt.getHours(), 21);
});

console.log(`\n${passed} tests passed`);
