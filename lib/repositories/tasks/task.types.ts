import type { SyncStatus } from '../../database.native';

export type TaskStatus = 'todo' | 'doing' | 'done' | 'blocked' | 'cancelled' | 'shelved';

/** 已完成或已取消，不再出现在活跃待办流中 */
export function isTaskTerminalStatus(status: TaskStatus | string): boolean {
  return status === 'done' || status === 'cancelled';
}

/** 暂时搁置：留在待办栏，不可勾选完成，可随时激活为待办 */
export function isTaskShelvedStatus(status: TaskStatus | string): boolean {
  return status === 'shelved';
}
export type TaskPriority = 0 | 1 | 2 | 3 | 4;

export type TaskRow = {
  id: string;
  project_id: string | null;
  category_id: string | null;
  parent_task_id: string | null;
  title: string;
  description: string | null;
  note: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  due_date: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  sync_status: SyncStatus;
  version: number;
  extra_data: string | null;
  /** 同一项目、同一父任务下的同级排序，数值越小越靠前 */
  sort_order: number;
};

export type CreateTaskInput = {
  id: string;
  title: string;
  project_id?: string | null;
  category_id?: string | null;
  parent_task_id?: string | null;
  description?: string | null;
  note?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  due_date?: string | null;
  extra_data?: string | null;
};

export type UpdateTaskInput = Partial<
  Pick<
    TaskRow,
    | 'project_id'
    | 'category_id'
    | 'parent_task_id'
    | 'title'
    | 'description'
    | 'note'
    | 'status'
    | 'priority'
    | 'due_date'
    | 'completed_at'
    | 'extra_data'
    | 'sort_order'
  >
>;

export type TaskCategoryRow = {
  id: string;
  name: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  sync_status: SyncStatus;
  version: number;
  extra_data: string | null;
};

export type CreateTaskCategoryInput = {
  id: string;
  name: string;
  extra_data?: string | null;
};

export type UpdateTaskCategoryInput = Partial<Pick<TaskCategoryRow, 'name' | 'extra_data'>>;
