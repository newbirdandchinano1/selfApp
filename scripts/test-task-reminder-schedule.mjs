/**
 * 待办截止 / 临期 / 滞留纯规则单测（不连系统通知）。
 * 用法：node --experimental-strip-types scripts/test-task-reminder-schedule.mjs
 */

import assert from 'node:assert/strict';
import {
  buildHabitEveningWrapFireAt,
  habitReminderNeedsEveningWrap,
} from '../lib/habit-reminder-logic.ts';
import {
  buildOverdueStickyFireAt,
  buildTaskReminderFireAt,
  formatNextTaskReminderLine,
  formatTaskReminderLabel,
  formatTaskReminderOptionLabel,
  isAutoDueSoonReminderOption,
  isCustomTaskReminderOption,
  isTaskDueSoon,
  isTaskPastDue,
  isTaskReminderConfigured,
  parseTaskReminderAdvanceDays,
  resolveTaskDeadlineReminderFireAt,
  resolveTaskDeadlineReminderIntensity,
  shouldSuppressTaskDeadlineReminder,
} from '../lib/task-reminder-schedule.ts';
import {
  isProjectStaleWithoutSlot,
  resolveProjectProgressNudge,
  shouldSuppressProjectProgressReminder,
} from '../lib/project-progress-reminder-logic.ts';

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

test('parse advance days + auto option', () => {
  assert.equal(parseTaskReminderAdvanceDays('不提前'), 0);
  assert.equal(parseTaskReminderAdvanceDays('自动临期'), 0);
  assert.equal(parseTaskReminderAdvanceDays('当天'), 0);
  assert.equal(parseTaskReminderAdvanceDays('提前1天'), 1);
  assert.equal(isAutoDueSoonReminderOption('自动临期'), true);
  assert.equal(isCustomTaskReminderOption('提前2天'), true);
  assert.equal(isCustomTaskReminderOption('自动临期'), false);
});

test('configured detection includes auto', () => {
  assert.equal(isTaskReminderConfigured('不提前', undefined), false);
  assert.equal(isTaskReminderConfigured('自动临期', undefined), true);
  assert.equal(isTaskReminderConfigured('当天', undefined), true);
});

test('build fireAt relative to due', () => {
  const fire = buildTaskReminderFireAt('2026-11-10', 1, {
    reminderOption: '提前1天',
    reminderHour: 9,
    reminderMinute: 0,
  });
  assert.ok(fire);
  assert.equal(fire.getDate(), 9);
  assert.equal(fire.getHours(), 9);
});

test('due soon / past due', () => {
  assert.equal(isTaskDueSoon({ todayYmd: '2026-11-04', dueYmd: '2026-11-05', windowDays: 1 }), true);
  assert.equal(isTaskDueSoon({ todayYmd: '2026-11-04', dueYmd: '2026-11-06', windowDays: 1 }), false);
  assert.equal(isTaskPastDue({ todayYmd: '2026-11-04', dueYmd: '2026-11-03' }), true);
});

test('suppress + intensity', () => {
  assert.equal(shouldSuppressTaskDeadlineReminder('shelved'), true);
  assert.equal(resolveTaskDeadlineReminderIntensity({ priority: 0 }), 'soft');
  assert.equal(resolveTaskDeadlineReminderIntensity({ priority: 2 }), 'normal');
  assert.equal(resolveTaskDeadlineReminderIntensity({ priority: 3 }), 'strong');
  assert.equal(
    resolveTaskDeadlineReminderIntensity({ priority: 0, isFrogToday: true }),
    'strong',
  );
});

test('auto due-soon main path', () => {
  const now = new Date(2026, 10, 4, 8, 0, 0, 0);
  const resolved = resolveTaskDeadlineReminderFireAt({
    dueYmd: '2026-11-04',
    schedule: { reminderOption: '自动临期' },
    todayYmd: '2026-11-04',
    now,
  });
  assert.ok(resolved);
  assert.equal(resolved.kind, 'auto_due_soon');
  assert.equal(resolved.fireAt.getHours(), 9);
});

test('off option only overdue sticky', () => {
  const now = new Date(2026, 10, 4, 8, 0, 0, 0);
  const none = resolveTaskDeadlineReminderFireAt({
    dueYmd: '2026-11-10',
    schedule: { reminderOption: '不提前' },
    todayYmd: '2026-11-04',
    now,
  });
  assert.equal(none, null);

  const sticky = resolveTaskDeadlineReminderFireAt({
    dueYmd: '2026-11-01',
    schedule: { reminderOption: '不提前' },
    todayYmd: '2026-11-04',
    now,
    enableOverdueSticky: true,
  });
  assert.ok(sticky);
  assert.equal(sticky.kind, 'overdue_sticky');
});

test('overdue sticky evening fallback', () => {
  const now = new Date(2026, 10, 4, 10, 0, 0, 0);
  const fire = buildOverdueStickyFireAt({
    todayYmd: '2026-11-04',
    schedule: { reminderHour: 9, reminderMinute: 0 },
    now,
  });
  assert.ok(fire);
  assert.equal(fire.getHours(), 20);
});

test('habit evening wrap', () => {
  assert.equal(habitReminderNeedsEveningWrap('soft'), false);
  assert.equal(habitReminderNeedsEveningWrap('normal'), true);
  const primary = new Date(2026, 10, 4, 9, 0, 0, 0);
  const wrap = buildHabitEveningWrapFireAt({
    primaryFireAt: primary,
    wrapHour: 20,
    wrapMinute: 0,
    now: new Date(2026, 10, 4, 8, 0, 0, 0),
  });
  assert.ok(wrap);
  assert.equal(wrap.getHours(), 20);
});

test('project stale progress nudge', () => {
  assert.equal(shouldSuppressProjectProgressReminder('paused'), true);
  assert.equal(
    isProjectStaleWithoutSlot({
      todayYmd: '2026-11-04',
      lastPlacementYmd: '2026-10-30',
      staleDays: 3,
    }),
    true,
  );
  assert.equal(
    resolveProjectProgressNudge({
      todayYmd: '2026-11-04',
      lastPlacementYmd: '2026-11-03',
      dueYmd: null,
      staleDays: 3,
    }),
    null,
  );
  assert.equal(
    resolveProjectProgressNudge({
      todayYmd: '2026-11-04',
      lastPlacementYmd: null,
      dueYmd: '2026-11-04',
      staleDays: 3,
    }),
    'due_soon',
  );
});

test('labels', () => {
  assert.equal(formatTaskReminderOptionLabel('自动临期'), '自动临期');
  const label = formatTaskReminderLabel({
    reminderOption: '自动临期',
    reminderHour: 9,
    reminderMinute: 0,
  });
  assert.match(label, /自动临期/);
  const next = formatNextTaskReminderLine({
    dueYmd: '2026-11-04',
    schedule: { reminderOption: '自动临期', reminderHour: 9, reminderMinute: 0 },
    todayYmd: '2026-11-04',
    now: new Date(2026, 10, 4, 8, 0, 0, 0),
  });
  assert.match(next, /下次提醒/);
});

console.log(`\n${passed} passed`);
