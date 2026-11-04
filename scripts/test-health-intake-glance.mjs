/**
 * 纯规则单测：健康摄入缺口 glance
 * 运行：npm run test:health-intake-glance
 */
import assert from 'node:assert/strict';
import {
  buildHealthIntakeGlance,
  clampHealthIntakePercent,
  healthIntakeGlanceToWidgetProps,
  pickHealthIntakeRings,
  resolveHealthIntakeDisplayKeys,
} from '../lib/widgets/health-intake-glance.ts';

assert.equal(clampHealthIntakePercent(1200, 2500), 48);
assert.equal(clampHealthIntakePercent(2500, 2500), 100);
assert.equal(clampHealthIntakePercent(3000, 2500), 100);
assert.equal(clampHealthIntakePercent(10, 0), 0);

const careKeys = resolveHealthIntakeDisplayKeys({
  focusSource: 'follow_care',
  careKeys: ['hydration', 'calories', 'protein'],
  manualKeys: [],
});
assert.deepEqual(careKeys, ['hydration', 'calories', 'protein']);

const manualKeys = resolveHealthIntakeDisplayKeys({
  focusSource: 'manual',
  careKeys: ['protein'],
  manualKeys: ['calories', 'hydration', 'calories'],
});
assert.deepEqual(manualKeys, ['calories', 'hydration']);

const metrics = [
  { key: 'hydration', current: 1000, target: 2500 },
  { key: 'protein', current: 70, target: 80 },
  { key: 'carbohydrate', current: 200, target: 260 },
  { key: 'calories', current: 800, target: 2000 },
];

const single = pickHealthIntakeRings({
  metrics,
  displayKeys: ['hydration', 'protein', 'calories'],
  ringStyle: 'single',
});
assert.equal(single.length, 1);
// 水分与热量 gapRatio 同为 0.6，按剩余量水分更大
assert.equal(single[0].key, 'hydration');

const dual = pickHealthIntakeRings({
  metrics,
  displayKeys: ['hydration', 'protein', 'calories'],
  ringStyle: 'dual',
});
assert.equal(dual.length, 2);
assert.equal(dual[0].key, 'hydration');
assert.equal(dual[1].key, 'calories');

const g1 = buildHealthIntakeGlance({
  metrics,
  displayKeys: ['hydration', 'calories'],
  ringStyle: 'dual',
  statusLine: '下次提醒 · 12:00 · 主盯水分',
});
assert.equal(g1.status, 'progress');
const w1 = healthIntakeGlanceToWidgetProps(g1);
assert.equal(w1.ringCount, 2);
assert.equal(w1.ring1Label, '水分');
assert.equal(w1.allDone, 0);
assert.match(w1.statusLine, /下次提醒/);

const met = buildHealthIntakeGlance({
  metrics: [
    { key: 'hydration', current: 2500, target: 2500 },
    { key: 'calories', current: 2000, target: 2000 },
  ],
  displayKeys: ['hydration', 'calories'],
  ringStyle: 'dual',
  statusLine: '今日关注项已达标，提醒已停',
});
assert.equal(met.status, 'cleared');
const w2 = healthIntakeGlanceToWidgetProps(met);
assert.equal(w2.allDone, 1);
assert.equal(w2.ringCount, 2);

const empty = buildHealthIntakeGlance({
  metrics: [{ key: 'hydration', current: 0, target: 0 }],
  displayKeys: ['hydration'],
  ringStyle: 'single',
  statusLine: '',
});
assert.equal(empty.status, 'empty');
assert.equal(healthIntakeGlanceToWidgetProps(empty).hasItems, 0);

console.log('test-health-intake-glance: ok');
