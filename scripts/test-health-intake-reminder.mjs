/**
 * 健康摄入提醒纯规则单测（不连系统通知）。
 * 用法：node --experimental-strip-types scripts/test-health-intake-reminder.mjs
 */

import assert from 'node:assert/strict';
import {
  buildHealthIntakeReminderCopy,
  computeHealthIntakeFireAts,
  deferOutOfQuietHours,
  isInQuietHours,
  listHealthIntakeDeficits,
  parseHealthIntakeTimestamp,
} from '../lib/health-intake-reminder-logic.ts';

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

const basePrefs = {
  mode: 'meal_windows',
  focusKeys: ['hydration', 'protein', 'carbohydrate', 'calories'],
  mealWindows: [
    { hour: 12, minute: 0 },
    { hour: 18, minute: 30 },
  ],
  wrapHour: 20,
  wrapMinute: 0,
  intervalMinutes: 60,
  quietStartHour: 23,
  quietStartMinute: 0,
  quietEndHour: 7,
  quietEndMinute: 0,
  snoozeUntilMs: null,
  dayMuteYmd: null,
  dayMuteKeys: [],
};

test('quiet hours cross midnight', () => {
  const d = new Date(2026, 10, 4, 23, 30, 0, 0);
  assert.equal(isInQuietHours(d, basePrefs), true);
  const morning = new Date(2026, 10, 4, 6, 0, 0, 0);
  assert.equal(isInQuietHours(morning, basePrefs), true);
  const noon = new Date(2026, 10, 4, 12, 0, 0, 0);
  assert.equal(isInQuietHours(noon, basePrefs), false);
});

test('defer out of quiet hours', () => {
  const d = new Date(2026, 10, 4, 23, 30, 0, 0);
  const deferred = deferOutOfQuietHours(d, basePrefs);
  assert.equal(deferred.getHours(), 7);
  assert.equal(deferred.getMinutes(), 0);
  assert.ok(deferred.getTime() > d.getTime());
});

test('deficits sorted by gap ratio + focus/mute', () => {
  const totals = { hydration: 500, protein: 10, carbohydrate: 100, calories: 1800 };
  const targets = { hydration: 2000, protein: 80, carbohydrate: 200, calories: 2000 };
  const all = listHealthIntakeDeficits(totals, targets, basePrefs, '2026-11-04');
  assert.equal(all[0].key, 'protein');
  const muted = listHealthIntakeDeficits(
    totals,
    targets,
    { ...basePrefs, dayMuteYmd: '2026-11-04', dayMuteKeys: ['protein'] },
    '2026-11-04',
  );
  assert.ok(muted.every(d => d.key !== 'protein'));
  const focused = listHealthIntakeDeficits(
    totals,
    targets,
    { ...basePrefs, focusKeys: ['hydration'] },
    '2026-11-04',
  );
  assert.equal(focused.length, 1);
  assert.equal(focused[0].key, 'hydration');
});

test('copy highlights primary deficit', () => {
  const deficits = listHealthIntakeDeficits(
    { hydration: 500, protein: 10, carbohydrate: 200, calories: 2000 },
    { hydration: 2000, protein: 80, carbohydrate: 200, calories: 2000 },
    basePrefs,
    '2026-11-04',
  );
  const copy = buildHealthIntakeReminderCopy(deficits);
  assert.equal(copy.primaryKey, 'protein');
  assert.match(copy.body, /蛋白质还差/);
  assert.match(copy.body, /记一餐就补上/);
});

test('meal_windows schedules future meal + wrap without past quota burn', () => {
  const now = new Date(2026, 10, 4, 13, 0, 0, 0);
  const slots = computeHealthIntakeFireAts({
    prefs: { ...basePrefs, mode: 'meal_windows' },
    logicalYmd: '2026-11-04',
    now,
  });
  assert.ok(slots.length >= 1);
  assert.ok(slots.length <= 2);
  assert.ok(slots.every(s => s.fireAt.getTime() > now.getTime()));
  const roles = slots.map(s => s.role);
  assert.ok(roles.includes('meal') || roles.includes('wrap'));
});

test('hydration_interval anchors from last intake', () => {
  const now = new Date(2026, 10, 4, 14, 0, 0, 0);
  const last = new Date(2026, 10, 4, 13, 0, 0, 0);
  const slots = computeHealthIntakeFireAts({
    prefs: { ...basePrefs, mode: 'hydration_interval', intervalMinutes: 60 },
    logicalYmd: '2026-11-04',
    now,
    lastIntakeAt: last,
  });
  assert.ok(slots.length >= 1);
  assert.equal(slots[0].role, 'interval');
  assert.equal(slots[0].fireAt.getHours(), 15);
});

test('snooze pushes earliest fire', () => {
  const now = new Date(2026, 10, 4, 10, 0, 0, 0);
  const snoozeUntil = new Date(2026, 10, 4, 16, 0, 0, 0).getTime();
  const slots = computeHealthIntakeFireAts({
    prefs: {
      ...basePrefs,
      mode: 'meal_windows',
      snoozeUntilMs: snoozeUntil,
    },
    logicalYmd: '2026-11-04',
    now,
  });
  assert.ok(slots.length >= 1);
  assert.ok(slots[0].fireAt.getTime() >= snoozeUntil);
});

test('parse timestamp', () => {
  const a = parseHealthIntakeTimestamp('2026-11-04 12:30:00');
  assert.ok(a instanceof Date);
  assert.equal(a.getHours(), 12);
  assert.equal(parseHealthIntakeTimestamp(''), null);
});

console.log(`\n${passed} passed`);
