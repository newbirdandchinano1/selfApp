/**
 * 阶段 C：通知收件箱映射 / 清理纯逻辑自测（不连 SQLite）。
 * 用法：node --experimental-strip-types scripts/test-notification-inbox.mjs
 */

import assert from 'node:assert/strict';
import {
  formatInboxBadgeCount,
  formatInboxBadgeDot,
  INBOX_TAB_BADGE_DOT,
} from '../lib/notification-inbox-badge.ts';
import { shouldSkipInboxIngestByGate } from '../lib/notification-inbox-ingest-rules.ts';
import { moduleTabForNotificationCategory } from '../lib/notification-inbox-mapping.ts';
import {
  NOTIFICATION_INBOX_MAX_ROWS,
  pickInboxIdsToPrune,
} from '../lib/notification-inbox-prune.ts';
import {
  aggregateUnreadSourceSnapshot,
  extractInboxSourceEntity,
  inboxRowMatchesAcknowledge,
  sourceAnchorForCategory,
} from '../lib/notification-inbox-source.ts';
import { stripReminderAccessorySuffix } from '../lib/notification-strong-reminder.ts';

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

test('category → moduleTab', () => {
  assert.equal(moduleTabForNotificationCategory('health-intake-reminder'), 'index');
  assert.equal(moduleTabForNotificationCategory('habit-reminder'), 'tasks');
  assert.equal(moduleTabForNotificationCategory('schedule-slot-reminder'), 'tasks');
  assert.equal(moduleTabForNotificationCategory('daily-review-reminder'), 'review');
  assert.equal(moduleTabForNotificationCategory('weekly-review-reminder'), 'review');
  assert.equal(moduleTabForNotificationCategory('auto-ledger'), 'finance');
  assert.equal(moduleTabForNotificationCategory('unknown-remote'), 'profile');
  assert.equal(moduleTabForNotificationCategory(null), 'profile');
  assert.equal(moduleTabForNotificationCategory(''), 'profile');
});

test('dedupe strips escalation suffix', () => {
  assert.equal(
    stripReminderAccessorySuffix('selfapp-habit-reminder:abc:esc:1'),
    'selfapp-habit-reminder:abc',
  );
});

test('prune removes stale read then oldest overflow to 200', () => {
  assert.equal(NOTIFICATION_INBOX_MAX_ROWS, 200);
  const nowMs = Date.parse('2030-06-01T00:00:00.000Z');
  const day = 24 * 60 * 60 * 1000;
  const rows = [];
  // 3 条已读且超过 30 天
  for (let i = 0; i < 3; i++) {
    rows.push({
      id: `old-read-${i}`,
      createdAt: new Date(nowMs - 60 * day).toISOString(),
      readAt: new Date(nowMs - 40 * day).toISOString(),
    });
  }
  // 205 条未读（按时间从旧到新）
  for (let i = 0; i < 205; i++) {
    rows.push({
      id: `unread-${i}`,
      createdAt: new Date(nowMs - (205 - i) * 60_000).toISOString(),
      readAt: null,
    });
  }
  const ids = pickInboxIdsToPrune(rows, {
    maxRows: 200,
    readRetentionMs: 30 * day,
    nowMs,
  });
  assert.ok(ids.includes('old-read-0'));
  assert.ok(ids.includes('old-read-1'));
  assert.ok(ids.includes('old-read-2'));
  // 205 未读在删掉 3 条已读后仍超 200 → 再删 5 条最旧未读
  assert.equal(ids.length, 3 + 5);
  assert.ok(ids.includes('unread-0'));
  assert.ok(ids.includes('unread-4'));
  assert.ok(!ids.includes('unread-5'));
});

test('prune same dedupe conceptually: maxRows exact keeps all', () => {
  const nowMs = Date.now();
  const rows = Array.from({ length: 200 }, (_, i) => ({
    id: `r${i}`,
    createdAt: new Date(nowMs - i * 1000).toISOString(),
    readAt: null,
  }));
  const ids = pickInboxIdsToPrune(rows, {
    maxRows: 200,
    readRetentionMs: 30 * 24 * 60 * 60 * 1000,
    nowMs,
  });
  assert.equal(ids.length, 0);
});

test('badge format caps at 99+', () => {
  assert.equal(formatInboxBadgeCount(0), undefined);
  assert.equal(formatInboxBadgeCount(-1), undefined);
  assert.equal(formatInboxBadgeCount(1), '1');
  assert.equal(formatInboxBadgeCount(99), '99');
  assert.equal(formatInboxBadgeCount(100), '99+');
});

test('tab badge uses red-dot sentinel', () => {
  assert.equal(formatInboxBadgeDot(0), undefined);
  assert.equal(formatInboxBadgeDot(1), INBOX_TAB_BADGE_DOT);
  assert.equal(formatInboxBadgeDot(12), INBOX_TAB_BADGE_DOT);
});

test('category → source anchor + entity extract', () => {
  assert.equal(sourceAnchorForCategory('health-intake-reminder'), 'health');
  assert.equal(sourceAnchorForCategory('habit-reminder'), 'habit');
  assert.equal(sourceAnchorForCategory('finance-budget-threshold-reminder'), 'budget');
  assert.equal(sourceAnchorForCategory('unknown'), null);
  assert.deepEqual(extractInboxSourceEntity({ habitId: 'h1' }), { kind: 'habit', id: 'h1' });
  assert.deepEqual(extractInboxSourceEntity({ subjectKind: 'task', subjectId: 't1' }), {
    kind: 'task',
    id: 't1',
  });
  assert.equal(extractInboxSourceEntity({ type: 'daily-review-reminder' }), null);
});

test('aggregate unread source snapshot + acknowledge match', () => {
  const snap = aggregateUnreadSourceSnapshot([
    { category: 'habit-reminder', data: { habitId: 'h1' } },
    { category: 'habit-reminder', data: { habitId: 'h1' } },
    { category: 'schedule-slot-reminder', data: { subjectKind: 'habit', subjectId: 'h2' } },
    { category: 'daily-review-reminder', dataJson: '{}' },
    { category: 'finance-scheduled-expense-reminder', data: { expenseId: 'e1' } },
  ]);
  assert.equal(snap.byAnchor.habit, 2);
  assert.equal(snap.byAnchor.schedule, 1);
  assert.equal(snap.byAnchor['daily-review'], 1);
  assert.equal(snap.byAnchor['scheduled-expense'], 1);
  assert.deepEqual(snap.entities.habit.sort(), ['h1', 'h2']);
  assert.deepEqual(snap.entities.scheduledExpense, ['e1']);

  assert.equal(
    inboxRowMatchesAcknowledge(
      { category: 'habit-reminder', data: { habitId: 'h1' } },
      { entity: { kind: 'habit', id: 'h1' } },
    ),
    true,
  );
  assert.equal(
    inboxRowMatchesAcknowledge(
      { category: 'schedule-slot-reminder', data: { subjectKind: 'habit', subjectId: 'h1' } },
      { entity: { kind: 'habit', id: 'h1' } },
    ),
    true,
  );
  assert.equal(
    inboxRowMatchesAcknowledge(
      { category: 'daily-review-reminder', data: {} },
      { anchors: ['daily-review'] },
    ),
    true,
  );
  assert.equal(
    inboxRowMatchesAcknowledge(
      { category: 'habit-reminder', data: { habitId: 'h9' } },
      { anchors: ['daily-review'] },
    ),
    false,
  );
});

// —— 阶段 G：suppress / 频道关闭不进列表；强提醒同 dedupe ——
test('ingest gate: suppress / no category / channel off skip', () => {
  assert.equal(
    shouldSkipInboxIngestByGate({
      sandboxDisabled: false,
      hasCategory: true,
      categoryAllowed: true,
      suppressed: false,
    }),
    false,
  );
  assert.equal(
    shouldSkipInboxIngestByGate({
      sandboxDisabled: false,
      hasCategory: true,
      categoryAllowed: true,
      suppressed: true,
    }),
    true,
  );
  assert.equal(
    shouldSkipInboxIngestByGate({
      sandboxDisabled: false,
      hasCategory: false,
      categoryAllowed: true,
      suppressed: false,
    }),
    true,
  );
  assert.equal(
    shouldSkipInboxIngestByGate({
      sandboxDisabled: false,
      hasCategory: true,
      categoryAllowed: false,
      suppressed: false,
    }),
    true,
  );
  assert.equal(
    shouldSkipInboxIngestByGate({
      sandboxDisabled: true,
      hasCategory: true,
      categoryAllowed: true,
      suppressed: false,
    }),
    true,
  );
});

test('strong reminder waves share one dedupe key', () => {
  const base = 'selfapp-habit-reminder:h1';
  // 与 resolveInboxDedupeKeyFromParts 一致：优先剥 suffix
  assert.equal(stripReminderAccessorySuffix(`${base}:esc:1`), base);
  assert.equal(stripReminderAccessorySuffix(`${base}:esc:2`), base);
  assert.equal(stripReminderAccessorySuffix(`${base}:snooze`), base);
  assert.equal(
    stripReminderAccessorySuffix(
      typeof base === 'string' && base.trim() ? base : `${base}:esc:1`,
    ),
    base,
  );
});

console.log(`\n${passed} passed`);
