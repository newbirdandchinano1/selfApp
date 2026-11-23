/**
 * L0/L1 通知文案模板冒烟（无 RN）。
 * 运行：node --experimental-strip-types scripts/test-notification-copy-templates.mjs
 * 或：npm run test:notification-copy（若已登记）
 */
import assert from 'node:assert/strict';
import {
  buildEscalationBody,
  buildForegroundClusterToast,
  buildHabitPrimaryCopy,
  buildScheduleSlotCopy,
  buildTaskDeadlineCopy,
  dayPartFromHour,
  pickVariant,
} from '../lib/notification-copy-templates.ts';

assert.equal(pickVariant('a', ['x']), 'x');
assert.equal(pickVariant('same', ['a', 'b', 'c']), pickVariant('same', ['a', 'b', 'c']));
assert.notEqual(pickVariant('a', ['x', 'y']), undefined);

assert.equal(dayPartFromHour(8), 'morning');
assert.equal(dayPartFromHour(14), 'afternoon');
assert.equal(dayPartFromHour(19), 'evening');
assert.equal(dayPartFromHour(23), 'night');

const habit = buildHabitPrimaryCopy({
  habitName: '早起',
  intensity: 'normal',
  kind: 'build',
  progressLabel: '1/3',
  hour: 7,
  seed: 'habit-test',
});
assert.ok(habit.title.trim());
assert.ok(habit.body.includes('早起') || habit.body.includes('1/3'));

const slot = buildScheduleSlotCopy({
  subjectTitle: '写周报',
  kind: 'task',
  startHm: '14:00',
  seed: 'slot-test',
});
assert.ok(slot.title.trim());
assert.ok(slot.body.includes('写周报') || slot.body.includes('14:00'));

const deadline = buildTaskDeadlineCopy({
  taskTitle: '交税',
  kind: 'overdue_sticky',
  intensity: 'soft',
  dueYmd: '2026-11-01',
  seed: 'ddl-test',
});
assert.ok(deadline.title.includes('滞留') || deadline.title.includes('过期') || deadline.title.includes('拖'));

const esc1 = buildEscalationBody('记得喝水', 1);
const esc2 = buildEscalationBody('记得喝水', 2);
assert.ok(!esc1.startsWith('再次提醒：'));
assert.ok(esc1.includes('记得喝水'));
assert.ok(esc2.includes('记得喝水'));

assert.equal(buildForegroundClusterToast([]), '有新提醒');
assert.match(buildForegroundClusterToast([{ title: 'A', body: 'b' }]), /A/);
assert.match(
  buildForegroundClusterToast([
    { title: 'A', body: '1' },
    { title: 'B', body: '2' },
  ]),
  /2 条提醒/,
);

console.log('ok: notification-copy-templates');
