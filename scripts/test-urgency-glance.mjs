/**
 * 纯规则单测：待办 / 截止紧急度 glance
 * 运行：npm run test:urgency-glance
 */
import assert from 'node:assert/strict';
import {
  buildUrgencyGlance,
  clampUrgencyDueSoonWindowDays,
  pickTopUrgencyCandidate,
  urgencyGlanceToWidgetProps,
} from '../lib/widgets/urgency-glance.ts';

assert.equal(clampUrgencyDueSoonWindowDays(1), 1);
assert.equal(clampUrgencyDueSoonWindowDays(2), 2);
assert.equal(clampUrgencyDueSoonWindowDays(3), 3);
assert.equal(clampUrgencyDueSoonWindowDays(9), 1);
assert.equal(clampUrgencyDueSoonWindowDays('2'), 2);

const overdue = [
  { id: 'o2', title: '旧逾期', kind: 'overdue', dueYmd: '2026-11-01', priority: 2 },
  { id: 'o1', title: '近逾期', kind: 'overdue', dueYmd: '2026-11-02', priority: 4 },
];
const dueToday = [
  { id: 't1', title: '今日甲', kind: 'due_today', dueYmd: '2026-11-04', priority: 1 },
  { id: 't2', title: '今日乙', kind: 'due_today', dueYmd: '2026-11-04', priority: 3 },
];
const dueSoon = [
  { id: 'p1', title: '临期项目', kind: 'due_soon_project', dueYmd: '2026-11-05', priority: 2 },
];

const top = pickTopUrgencyCandidate(overdue, dueToday, dueSoon);
assert.equal(top?.id, 'o2');

const topToday = pickTopUrgencyCandidate([], dueToday, dueSoon);
assert.equal(topToday?.id, 't2');

const calm = buildUrgencyGlance({
  overdue: [],
  dueToday: [],
  dueSoonProjects: [],
  showOverdue: true,
  showDueToday: true,
  showDueSoonProjects: true,
  showTopTitle: true,
});
assert.equal(calm.isCalm, true);
assert.equal(calm.emptyLabel, '暂无紧急项');

const g1 = buildUrgencyGlance({
  overdue,
  dueToday,
  dueSoonProjects: dueSoon,
  showOverdue: true,
  showDueToday: true,
  showDueSoonProjects: true,
  showTopTitle: true,
});
assert.equal(g1.overdueCount, 2);
assert.equal(g1.dueTodayCount, 2);
assert.equal(g1.dueSoonProjectCount, 1);
assert.equal(g1.topTitle, '旧逾期');
assert.equal(g1.isCalm, false);

const w1 = urgencyGlanceToWidgetProps(g1);
assert.match(w1.countsLine, /逾期 2/);
assert.match(w1.countsLine, /今日 2/);
assert.match(w1.countsLine, /临期 1/);
assert.match(w1.statusLine, /最近逾期/);
assert.equal(w1.showTopTitle, 1);
assert.equal(w1.isCalm, 0);
assert.match(w1.lockCountsLine, /逾2/);
assert.doesNotMatch(w1.lockCountsLine, /临/);

const g2 = buildUrgencyGlance({
  overdue,
  dueToday,
  dueSoonProjects: dueSoon,
  showOverdue: false,
  showDueToday: true,
  showDueSoonProjects: false,
  showTopTitle: false,
});
assert.equal(g2.overdueCount, 0);
assert.equal(g2.dueTodayCount, 2);
assert.equal(g2.topTitle, '');
const w2 = urgencyGlanceToWidgetProps(g2);
assert.match(w2.countsLine, /今日 2/);
assert.doesNotMatch(w2.countsLine, /逾期/);
assert.equal(w2.showTopTitle, 0);

const wCalm = urgencyGlanceToWidgetProps(calm);
assert.equal(wCalm.countsLine, '暂无紧急项');
assert.equal(wCalm.isCalm, 1);

console.log('test-urgency-glance: ok');
