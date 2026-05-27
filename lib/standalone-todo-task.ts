import type { TaskRow } from '@/lib/repositories/tasks/task.types';

/** 无项目、无父任务的顶层任务 = 任务 Tab「待办」栏独立待办 */
export function isStandaloneTodoTask(
  task: Pick<TaskRow, 'project_id' | 'parent_task_id'>,
): boolean {
  return !task.project_id && !task.parent_task_id;
}

export function standaloneTodoEditorHref(taskId: string) {
  return {
    pathname: '/add-task' as const,
    params: { standalone: '1', id: taskId },
  };
}
