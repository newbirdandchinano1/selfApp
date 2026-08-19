import { isProjectInInboxCategory } from '@/lib/repositories/projects/constants';
import type { ProjectRow } from '@/lib/repositories/projects/project.types';
import { isMatrixTaskInCurrentWeek } from '@/lib/standalone-todo-visibility';
import type { TaskPriority, TaskRow } from '@/lib/repositories/tasks/task.types';

/** 无子任务的项目（任务树为空） */
export function isLeafProjectWithoutTasks(project: ProjectRow, taskCount: number): boolean {
  if (taskCount > 0) return false;
  if (project.status === 'completed' || project.status === 'archived') return false;
  return true;
}

/** 本周列表：项目计划时间范围与本周相交 */
export function isMatrixProjectInCurrentWeek(
  project: ProjectRow,
  weekStartYmd: string,
  weekEndYmd: string,
  logicalTodayYmd: string,
): boolean {
  return isMatrixTaskInCurrentWeek(
    projectToFrogTaskRow(project),
    weekStartYmd,
    weekEndYmd,
    logicalTodayYmd,
  );
}

/** 无子任务的活跃项目可被指派为青蛙（收集箱/终态/暂停除外） */
export function isProjectEligibleAsFrog(
  project: ProjectRow,
  taskCount: number,
  locked: boolean,
): boolean {
  if (taskCount > 0) return false;
  if (locked) return false;
  if (project.status !== 'active') return false;
  if (isProjectInInboxCategory(project.category_id)) return false;
  return true;
}

/** 将项目映射为今日青蛙列表所用的 TaskRow 形态（id 仍为项目 id） */
export function projectToFrogTaskRow(project: ProjectRow): TaskRow {
  const terminal = project.status === 'completed' || project.status === 'archived';
  return {
    id: project.id,
    project_id: null,
    category_id: project.category_id,
    parent_task_id: null,
    title: project.name,
    description: null,
    note: project.note,
    status: terminal ? 'done' : 'todo',
    priority: (project.priority ?? 0) as TaskPriority,
    due_date: project.due_date,
    completed_at: null,
    created_at: project.created_at,
    updated_at: project.updated_at,
    sync_status: project.sync_status,
    extra_data: project.extra_data,
    sort_order: 0,
  };
}
