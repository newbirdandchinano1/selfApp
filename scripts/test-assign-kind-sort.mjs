/**
 * 指派排序：任务/项目/待办按优先级，小习惯垫后；同类别内部规则不变。
 * 运行：npx --yes tsx scripts/test-assign-kind-sort.mjs
 */
import assert from 'node:assert/strict';
import {
  ASSIGN_DISPLAY_KIND_LABEL,
  assignDisplayKindLabel,
  compareAssignedScheduleItems,
  compareTimelineTimedEvents,
} from '../lib/schedule/assign-kind-sort.ts';

const base = (partial) => ({
  done: false,
  overdue: false,
  priority: 0,
  title: 'x',
  id: 'id',
  sortOrder: 0,
  dueMs: null,
  rewardPoints: 0,
  updatedAt: null,
  startMins: 0,
  ...partial,
});

// 小习惯默认排在任务/项目/待办后面
{
  const items = [
    base({ kind: 'habit', title: '习惯', priority: 4 }),
    base({ kind: 'todo', title: '待办', priority: 1 }),
    base({ kind: 'frog', title: '任务', priority: 1 }),
    base({ kind: 'proj', title: '项目', priority: 1 }),
  ].sort(compareAssignedScheduleItems);
  assert.deepEqual(
    items.map((x) => x.kind),
    ['proj', 'frog', 'todo', 'habit'],
  );
}

// 跨类型按优先级：高优任务排在低优项目之前
{
  const a = base({ kind: 'proj', title: '低优项目', priority: 1 });
  const b = base({ kind: 'frog', title: '高优任务', priority: 4 });
  assert.ok(compareAssignedScheduleItems(b, a) < 0);
}

// 同优先级跨类型：仍按项目 → 任务 → 待办
{
  const items = [
    base({ kind: 'todo', title: '待办', priority: 2 }),
    base({ kind: 'frog', title: '任务', priority: 2 }),
    base({ kind: 'proj', title: '项目', priority: 2 }),
  ].sort(compareAssignedScheduleItems);
  assert.deepEqual(
    items.map((x) => x.kind),
    ['proj', 'frog', 'todo'],
  );
}

// 同类别内部不变：已完成项目沉底（相对未完成项目）
{
  const a = base({ kind: 'proj', title: '已完成', done: true, priority: 4 });
  const b = base({ kind: 'proj', title: '未完成', done: false, priority: 1 });
  assert.ok(compareAssignedScheduleItems(b, a) < 0);
}

// 同类别：任务按 sort_order
{
  const a = base({ kind: 'frog', title: 'B', sortOrder: 2 });
  const b = base({ kind: 'frog', title: 'A', sortOrder: 1 });
  assert.ok(compareAssignedScheduleItems(b, a) < 0);
}

// 同类别：待办过期置顶
{
  const a = base({ kind: 'todo', title: '普通', overdue: false, priority: 4 });
  const b = base({ kind: 'todo', title: '过期', overdue: true, priority: 1 });
  assert.ok(compareAssignedScheduleItems(b, a) < 0);
}

// 同类别：习惯完成沉底
{
  const a = base({ kind: 'habit', title: '未做', id: 'h2', done: false });
  const b = base({ kind: 'habit', title: '已做', id: 'h1', done: true });
  assert.ok(compareAssignedScheduleItems(a, b) < 0);
}

// 定时：不同起点仍按时刻
{
  const a = { ...base({ kind: 'habit', title: '晚' }), startMinutes: 600, endMinutes: 660 };
  const b = { ...base({ kind: 'proj', title: '早' }), startMinutes: 540, endMinutes: 600 };
  assert.ok(compareTimelineTimedEvents(b, a) < 0);
}

// 定时：同起点高优任务先于低优项目；习惯仍最后
{
  const habit = { ...base({ kind: 'habit', title: '习惯', priority: 4 }), startMinutes: 540, endMinutes: 600 };
  const lowProj = { ...base({ kind: 'proj', title: '低优', priority: 1 }), startMinutes: 540, endMinutes: 600 };
  const highFrog = { ...base({ kind: 'frog', title: '高优', priority: 4 }), startMinutes: 540, endMinutes: 600 };
  assert.ok(compareTimelineTimedEvents(highFrog, lowProj) < 0);
  assert.ok(compareTimelineTimedEvents(lowProj, habit) < 0);
}

// 标签文案
{
  assert.equal(assignDisplayKindLabel('proj'), '项目');
  assert.equal(assignDisplayKindLabel('frog'), '任务');
  assert.equal(assignDisplayKindLabel('todo'), '待办');
  assert.equal(assignDisplayKindLabel('habit'), '小习惯');
  assert.equal(ASSIGN_DISPLAY_KIND_LABEL.frog, '任务');
}

console.log('ok: assign-kind-sort');
