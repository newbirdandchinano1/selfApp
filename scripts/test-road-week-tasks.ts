/**
 * 道路本周任务聚合：无月目标 / 无项目 / 排除独立待办 / 最多 3 条。
 * 运行：npx --yes tsx scripts/test-road-week-tasks.ts
 */
import assert from 'node:assert/strict';
import {
  formatWeekRangeSlash,
  selectCurrentMonthWeekTasks,
} from '../lib/life-road/road-week-tasks-core';
import type { TaskRow } from '../lib/repositories/tasks/task.types';

function task(partial: Partial<TaskRow> & { id: string; title: string }): TaskRow {
  return {
    project_id: null,
    category_id: null,
    parent_task_id: null,
    description: null,
    note: null,
    status: 'todo',
    priority: 0,
    due_date: null,
    completed_at: null,
    sort_order: 0,
    created_at: '2026-01-01T00:00:00',
    updated_at: '2026-01-01T00:00:00',
    sync_status: 'synced',
    extra_data: null,
    ...partial,
  };
}

/** 测试用：仅看 due_date 是否落在本周 */
function dueInWeek(
  t: TaskRow,
  weekStart: string,
  weekEnd: string,
): boolean {
  const due = t.due_date?.trim().slice(0, 10) ?? '';
  return /^\d{4}-\d{2}-\d{2}$/.test(due) && due >= weekStart && due <= weekEnd;
}

assert.equal(formatWeekRangeSlash('2026-11-24', '2026-11-30'), '11/24–11/30');

{
  const r = selectCurrentMonthWeekTasks({
    monthGoalId: null,
    projects: [{ id: 'p1', name: 'A', status: 'active' }],
    tasks: [],
    now: new Date(2026, 10, 25),
    isTaskInWeek: dueInWeek,
  });
  assert.equal(r.emptyReason, 'no_month_goal');
  assert.equal(r.tasks.length, 0);
}

{
  const r = selectCurrentMonthWeekTasks({
    monthGoalId: 'm1',
    projects: [],
    tasks: [task({ id: 't1', title: 'x', project_id: 'p1', due_date: '2026-11-25' })],
    now: new Date(2026, 10, 25),
    isTaskInWeek: dueInWeek,
  });
  assert.equal(r.emptyReason, 'no_projects');
}

{
  const projects = [{ id: 'p1', name: 'Proj', status: 'active', extraData: null }];
  const tasks = [
    task({ id: 'solo', title: '独立待办', project_id: null, due_date: '2026-11-25' }),
    task({ id: 't1', title: '任务1', project_id: 'p1', due_date: '2026-11-25' }),
    task({ id: 't2', title: '任务2', project_id: 'p1', due_date: '2026-11-26' }),
    task({ id: 't3', title: '任务3', project_id: 'p1', due_date: '2026-11-27' }),
    task({ id: 't4', title: '任务4', project_id: 'p1', due_date: '2026-11-28' }),
  ];
  const r = selectCurrentMonthWeekTasks({
    monthGoalId: 'm1',
    projects,
    tasks,
    now: new Date(2026, 10, 25),
    limit: 3,
    isTaskInWeek: dueInWeek,
  });
  assert.ok(!r.tasks.some((t) => t.taskId === 'solo'));
  assert.equal(r.tasks.length, 3);
  assert.equal(r.emptyReason, null);
}

console.log('ok: road-week-tasks');
