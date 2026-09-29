/**
 * 强提醒纯规则单测（不连系统通知）。
 * 用法：node --experimental-strip-types scripts/test-notification-strong-reminder.mjs
 */

import assert from 'node:assert/strict';
import {
  computeEscalationFireAts,
  escalationIdentifier,
  isEscalationOrSnoozeIdentifier,
  isStrongReminderCategory,
  maxStrongEscalationWave,
  parseStrongReminderPayload,
  shouldRescheduleAfterDelivery,
  snoozeFireAt,
  stripReminderAccessorySuffix,
  STRONG_ESCALATION_OFFSET_MINUTES,
  STRONG_SNOOZE_MINUTES,
} from '../lib/notification-strong-reminder.ts';

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

test('strong categories', () => {
  assert.equal(isStrongReminderCategory('habit-reminder'), true);
  assert.equal(isStrongReminderCategory('schedule-slot-reminder'), true);
  assert.equal(isStrongReminderCategory('daily-review-reminder'), true);
  assert.equal(isStrongReminderCategory('health-intake-reminder'), false);
  assert.equal(isStrongReminderCategory('auto-ledger'), false);
});

test('strip accessory suffix', () => {
  assert.equal(
    stripReminderAccessorySuffix('selfapp-habit-reminder:abc:esc:1'),
    'selfapp-habit-reminder:abc',
  );
  assert.equal(
    stripReminderAccessorySuffix('selfapp-daily-review-reminder:esc:2'),
    'selfapp-daily-review-reminder',
  );
  assert.equal(
    stripReminderAccessorySuffix('selfapp-habit-reminder:abc'),
    'selfapp-habit-reminder:abc',
  );
});

test('escalation identifier + detect', () => {
  assert.equal(
    escalationIdentifier('selfapp-habit-reminder:h1', 1),
    'selfapp-habit-reminder:h1:esc:1',
  );
  assert.equal(isEscalationOrSnoozeIdentifier('x:esc:1'), true);
  assert.equal(isEscalationOrSnoozeIdentifier('x:snooze'), true);
  assert.equal(isEscalationOrSnoozeIdentifier('x'), false);
});

test('reschedule only after final wave for strong', () => {
  assert.equal(shouldRescheduleAfterDelivery({ strong: false }), true);
  assert.equal(
    shouldRescheduleAfterDelivery({ strong: true, escalationWave: 0, maxEscalationWave: 2 }),
    false,
  );
  assert.equal(
    shouldRescheduleAfterDelivery({ strong: true, escalationWave: 1, maxEscalationWave: 2 }),
    false,
  );
  assert.equal(
    shouldRescheduleAfterDelivery({ strong: true, escalationWave: 2, maxEscalationWave: 2 }),
    true,
  );
});

test('escalation fireAts skip past', () => {
  assert.equal(maxStrongEscalationWave(), STRONG_ESCALATION_OFFSET_MINUTES.length);
  const primary = new Date('2030-01-01T10:00:00');
  const now = primary.getTime() + 6 * 60_000; // 主提醒后 6 分钟
  const list = computeEscalationFireAts(primary, now, 2000);
  assert.equal(list.length, 1);
  assert.equal(list[0].wave, 2);
  assert.equal(list[0].fireAt.getTime(), primary.getTime() + 15 * 60_000);
});

test('snooze fireAt', () => {
  const from = Date.parse('2030-01-01T12:00:00Z');
  const at = snoozeFireAt(from, STRONG_SNOOZE_MINUTES);
  assert.equal(at.getTime(), from + STRONG_SNOOZE_MINUTES * 60_000);
});

test('payload parse/reject', () => {
  const ok = parseStrongReminderPayload({
    baseIdentifier: 'selfapp-habit-reminder:h1:esc:1',
    title: '习惯打卡提醒',
    body: '跑步',
    data: { type: 'habit-reminder', habitId: 'h1' },
  });
  assert.ok(ok);
  assert.equal(ok.baseIdentifier, 'selfapp-habit-reminder:h1');
  assert.equal(ok.data.habitId, 'h1');
  assert.equal(parseStrongReminderPayload({ title: 'x' }), null);
  assert.equal(parseStrongReminderPayload('not-json'), null);
});

test('entity id survives escalation suffix strip', () => {
  const base = stripReminderAccessorySuffix('selfapp-habit-reminder:h1:esc:2');
  assert.equal(base, 'selfapp-habit-reminder:h1');
  assert.equal(base.slice('selfapp-habit-reminder:'.length), 'h1');
});

console.log(`\n${passed} tests passed`);
