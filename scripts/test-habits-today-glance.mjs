/**
 * 纯规则单测：小习惯今日进度 glance
 * 运行：npm run test:habits-today-glance
 */
import assert from 'node:assert/strict';
import {
  buildHabitsTodayGlance,
  habitsTodayGlanceToWidgetProps,
} from '../lib/widgets/habits-today-glance.ts';

const items = [
  { id: '1', name: '喝水', kind: 'build', done: true },
  { id: '2', name: '早起', kind: 'build', done: false },
  { id: '3', name: '戒糖', kind: 'break', done: false },
  { id: '4', name: '阅读配额', kind: 'task', done: true },
];

const g1 = buildHabitsTodayGlance({ items, listLimit: 3 });
assert.equal(g1.status, 'progress');
assert.equal(g1.doneCount, 2);
assert.equal(g1.totalCount, 4);
assert.equal(g1.pending.length, 2);

const w1 = habitsTodayGlanceToWidgetProps(g1);
assert.equal(w1.progressLine, '2/4');
assert.match(w1.statusLine, /还差 2/);
assert.equal(w1.pendingVisible, 2);
assert.ok(w1.item1.includes('早起') || w1.item1.includes('戒糖'));

const g2 = buildHabitsTodayGlance({
  items: items.map((i) => ({ ...i, done: true })),
});
assert.equal(g2.status, 'cleared');
const w2 = habitsTodayGlanceToWidgetProps(g2);
assert.equal(w2.allDone, 1);
assert.match(w2.statusLine, /已收齐/);

const g3 = buildHabitsTodayGlance({ items: [] });
assert.equal(g3.status, 'empty');
assert.equal(habitsTodayGlanceToWidgetProps(g3).hasItems, 0);

const g4 = buildHabitsTodayGlance({
  items: [
    { id: 'a', name: 'A', kind: 'build', done: false },
    { id: 'b', name: 'B', kind: 'build', done: false },
    { id: 'c', name: 'C', kind: 'build', done: false },
    { id: 'd', name: 'D', kind: 'build', done: false },
  ],
  listLimit: 2,
});
const w4 = habitsTodayGlanceToWidgetProps(g4);
assert.equal(w4.pendingVisible, 2);
assert.match(w4.moreLine, /另有 2/);

console.log('test-habits-today-glance: ok');
