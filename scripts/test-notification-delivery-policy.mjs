/**
 * P0 送达策略纯规则单测。
 * 用法：node --experimental-strip-types scripts/test-notification-delivery-policy.mjs
 */
import assert from 'node:assert/strict';
import {
  DEFAULT_DELIVERY_POLICY_PREFS,
  buildScheduleClusterCopy,
  deferOutOfQuietHours,
  findNextAvailableSlot,
  isInEveningWrapWindow,
  isInQuietHours,
  isWrapNotificationData,
  localYmdFromMs,
  normalizeDeliveryIntensity,
  normalizeDeliveryPolicyPrefs,
  partitionByFireAtMinute,
  planNotificationFireAts,
  resolveDeliveryStrong,
} from '../lib/notification-delivery-policy.ts';

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

const prefs = {
  ...DEFAULT_DELIVERY_POLICY_PREFS,
  eveningWrap: { ...DEFAULT_DELIVERY_POLICY_PREFS.eveningWrap },
};

test('quiet hours cross midnight', () => {
  const night = new Date(2026, 10, 23, 23, 30, 0, 0);
  const morning = new Date(2026, 10, 24, 6, 0, 0, 0);
  const noon = new Date(2026, 10, 24, 12, 0, 0, 0);
  assert.equal(isInQuietHours(night, prefs), true);
  assert.equal(isInQuietHours(morning, prefs), true);
  assert.equal(isInQuietHours(noon, prefs), false);
});

test('defer out of quiet hours', () => {
  const night = new Date(2026, 10, 23, 23, 30, 0, 0);
  const deferred = deferOutOfQuietHours(night, prefs);
  assert.equal(deferred.getHours(), 7);
  assert.equal(deferred.getMinutes(), 0);
  assert.ok(deferred.getTime() > night.getTime());
});

test('evening wrap window', () => {
  const inWin = new Date(2026, 10, 23, 20, 0, 0, 0);
  const outWin = new Date(2026, 10, 23, 18, 0, 0, 0);
  assert.equal(isInEveningWrapWindow(inWin, prefs.eveningWrap), true);
  assert.equal(isInEveningWrapWindow(outWin, prefs.eveningWrap), false);
});

test('wrap data detection', () => {
  assert.equal(isWrapNotificationData({ wave: 'evening_wrap' }), true);
  assert.equal(isWrapNotificationData({ role: 'wrap' }), true);
  assert.equal(isWrapNotificationData({ slotKind: 'evening_wrap' }), true);
  assert.equal(isWrapNotificationData({ type: 'habit-reminder' }), false);
});

test('findNextAvailableSlot respects min interval', () => {
  const base = new Date(2026, 10, 23, 10, 0, 0, 0).getTime();
  const slot = findNextAvailableSlot({
    preferredMs: base,
    occupiedMs: [base],
    minIntervalMinutes: 4,
  });
  assert.ok(slot != null);
  assert.ok(slot - base >= 4 * 60_000);
});

test('plan stagger wraps and drop over cap', () => {
  const t20 = new Date(2026, 10, 23, 20, 0, 0, 0).getTime();
  const candidates = [
    {
      id: 'a',
      category: 'habit-reminder',
      fireAtMs: t20,
      priority: 30,
      isWrap: true,
      strong: false,
    },
    {
      id: 'b',
      category: 'health-intake-reminder',
      fireAtMs: t20,
      priority: 50,
      isWrap: true,
      strong: false,
    },
    {
      id: 'c',
      category: 'finance-ledger-wrap-reminder',
      fireAtMs: t20,
      priority: 80,
      isWrap: true,
      strong: false,
    },
    {
      id: 'd',
      category: 'finance-scheduled-expense-reminder',
      fireAtMs: t20,
      priority: 55,
      isWrap: true,
      strong: false,
    },
    {
      id: 'e',
      category: 'daily-review-reminder',
      fireAtMs: t20,
      priority: 40,
      isWrap: true,
      strong: false,
    },
  ];
  // wrap max = 4 → 第 5 条应 drop
  const planned = planNotificationFireAts(candidates, prefs, []);
  const systems = planned.filter(p => p.mode === 'system');
  const drops = planned.filter(p => p.mode === 'drop');
  assert.equal(systems.length, 4);
  assert.equal(drops.length, 1);
  // 错峰：系统通知时刻应互不相同
  const times = new Set(systems.map(s => s.fireAtMs));
  assert.equal(times.size, systems.length);
  // 高优先级 habit 应保留
  assert.ok(systems.some(s => s.id === 'a'));
});

test('plan defers quiet into morning', () => {
  const night = new Date(2026, 10, 23, 23, 45, 0, 0).getTime();
  const planned = planNotificationFireAts(
    [
      {
        id: 'n1',
        category: 'project-progress-reminder',
        fireAtMs: night,
        priority: 70,
        isWrap: false,
        strong: false,
      },
    ],
    prefs,
    [],
  );
  assert.equal(planned[0].mode, 'system');
  const d = new Date(planned[0].fireAtMs);
  assert.equal(d.getHours(), 7);
  assert.equal(localYmdFromMs(planned[0].fireAtMs), '2026-11-24');
});

test('day cap drops non-strong', () => {
  const tight = {
    ...prefs,
    maxSystemPerDay: 2,
    minIntervalMinutes: 0,
    eveningWrap: { ...prefs.eveningWrap, maxSystem: 10 },
  };
  const noon = new Date(2026, 10, 23, 12, 0, 0, 0).getTime();
  const candidates = ['x', 'y', 'z'].map((id, i) => ({
    id,
    category: 'project-progress-reminder',
    fireAtMs: noon + i * 60_000,
    priority: 70 + i,
    isWrap: false,
    strong: false,
  }));
  const planned = planNotificationFireAts(candidates, tight, []);
  assert.equal(planned.filter(p => p.mode === 'system').length, 2);
  assert.equal(planned.filter(p => p.mode === 'drop').length, 1);
});

test('normalize intensity + inboxOnly', () => {
  assert.equal(normalizeDeliveryIntensity('soft'), 'soft');
  assert.equal(normalizeDeliveryIntensity('weird'), 'normal');
  const n = normalizeDeliveryPolicyPrefs({
    inboxOnly: true,
    intensity: 'strong',
  });
  assert.equal(n.inboxOnly, true);
  assert.equal(n.intensity, 'strong');
  assert.equal(DEFAULT_DELIVERY_POLICY_PREFS.inboxOnly, false);
  assert.equal(DEFAULT_DELIVERY_POLICY_PREFS.intensity, 'normal');
});

test('resolveDeliveryStrong respects intensity', () => {
  assert.equal(
    resolveDeliveryStrong({ intensity: 'soft', explicit: true, categoryEligible: true }),
    false,
  );
  assert.equal(
    resolveDeliveryStrong({ intensity: 'normal', explicit: true, categoryEligible: true }),
    true,
  );
  assert.equal(
    resolveDeliveryStrong({ intensity: 'normal', categoryEligible: true }),
    false,
  );
  assert.equal(
    resolveDeliveryStrong({ intensity: 'strong', categoryEligible: true }),
    true,
  );
  assert.equal(
    resolveDeliveryStrong({ intensity: 'strong', explicit: false, categoryEligible: true }),
    false,
  );
  assert.equal(
    resolveDeliveryStrong({ intensity: 'strong', categoryEligible: false }),
    false,
  );
});

test('buildScheduleClusterCopy', () => {
  assert.deepEqual(buildScheduleClusterCopy([]), {
    title: '接下来',
    body: '有几件事到点了',
  });
  assert.deepEqual(buildScheduleClusterCopy(['写周报']), {
    title: '接下来',
    body: '写周报',
  });
  assert.deepEqual(buildScheduleClusterCopy(['A', 'B']), {
    title: '接下来',
    body: 'A、B',
  });
  assert.deepEqual(buildScheduleClusterCopy(['A', 'B', 'C']), {
    title: '接下来 · 3 件',
    body: 'A、B 等',
  });
});

test('partitionByFireAtMinute merges same minute', () => {
  const t0 = new Date(2026, 10, 23, 14, 0, 10, 0).getTime();
  const t1 = new Date(2026, 10, 23, 14, 0, 50, 0).getTime();
  const t2 = new Date(2026, 10, 23, 14, 1, 0, 0).getTime();
  const parts = partitionByFireAtMinute(
    [
      { id: 'a', fireAtMs: t0 },
      { id: 'b', fireAtMs: t1 },
      { id: 'c', fireAtMs: t2 },
    ],
    x => x.fireAtMs,
  );
  assert.equal(parts.length, 2);
  const same = parts.find(p => p.items.length === 2);
  const alone = parts.find(p => p.items.length === 1);
  assert.ok(same);
  assert.ok(alone);
  assert.deepEqual(
    same.items.map(i => i.id).sort(),
    ['a', 'b'],
  );
  assert.equal(alone.items[0].id, 'c');
});

console.log(`${passed} tests passed`);
