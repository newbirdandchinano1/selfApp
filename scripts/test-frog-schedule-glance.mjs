/**
 * 纯规则单测：今日青蛙 / 下一格 glance
 * 运行：npm run test:frog-schedule-glance
 */
import assert from 'node:assert/strict';
import {
  buildFrogScheduleGlance,
  frogScheduleGlanceToLiveActivityProps,
  frogScheduleGlanceToWidgetProps,
} from '../lib/widgets/frog-schedule-glance.ts';

const today = new Date(2026, 10, 4, 12, 0, 0, 0);
const blocks = [
  {
    placementId: 'a',
    subjectKind: 'task',
    subjectId: 't1',
    title: '写周报',
    displayKind: 'frog',
    startMins: 9 * 60,
    endMins: 11 * 60,
    done: true,
  },
  {
    placementId: 'b',
    subjectKind: 'task',
    subjectId: 't2',
    title: '推进项目',
    displayKind: 'project',
    startMins: 14 * 60,
    endMins: 16 * 60,
    done: false,
  },
  {
    placementId: 'c',
    subjectKind: 'task',
    subjectId: 't3',
    title: '跑步',
    displayKind: 'todo',
    startMins: 18 * 60,
    endMins: 19 * 60,
    done: false,
  },
];

const g1 = buildFrogScheduleGlance({
  blocks,
  now: new Date(2026, 10, 4, 10, 0, 0, 0),
  todayLocalDate: today,
});
assert.equal(g1.status, 'upcoming');
assert.equal(g1.focus?.placementId, 'b');
assert.equal(g1.upcoming.length, 1);
assert.equal(g1.upcoming[0].placementId, 'c');

const w1 = frogScheduleGlanceToWidgetProps(g1);
assert.equal(w1.hasFocus, 1);
assert.match(w1.statusLine, /下一场|距开始/);
assert.equal(frogScheduleGlanceToLiveActivityProps(g1), null);

const g2 = buildFrogScheduleGlance({
  blocks,
  now: new Date(2026, 10, 4, 15, 0, 0, 0),
  todayLocalDate: today,
});
assert.equal(g2.status, 'active');
assert.equal(g2.focus?.placementId, 'b');
const la = frogScheduleGlanceToLiveActivityProps(g2);
assert.ok(la);
assert.equal(la.placementId, 'b');
assert.match(la.statusLine, /剩余/);

const g3 = buildFrogScheduleGlance({
  blocks: blocks.map((b) => ({ ...b, done: true })),
  now: new Date(2026, 10, 4, 20, 0, 0, 0),
  todayLocalDate: today,
});
assert.equal(g3.status, 'cleared');
assert.equal(g3.focus, null);

const g4 = buildFrogScheduleGlance({
  blocks: [
    {
      placementId: 'x',
      subjectKind: 'task',
      subjectId: 'tx',
      title: '昨天拖过来的',
      displayKind: 'frog',
      startMins: 8 * 60,
      endMins: 9 * 60,
      done: false,
    },
  ],
  now: new Date(2026, 10, 4, 12, 0, 0, 0),
  todayLocalDate: today,
});
assert.equal(g4.overdueCount, 1);
assert.ok(g4.focus);

console.log('test-frog-schedule-glance: ok');
