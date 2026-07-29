import type { SyncStatus } from '../../database.native';

export type ProjectStatus = 'active' | 'paused' | 'completed' | 'archived';

/** 与任务相同：0 未设，1–4 艾森豪威尔四象限 */
export type ProjectPriority = 0 | 1 | 2 | 3 | 4;

export type ProjectRow = {
  id: string;
  category_id: string | null;
  name: string;
  status: ProjectStatus;
  /** 艾森豪威尔优先级，与 tasks.priority 同口径 */
  priority: ProjectPriority;
  note: string | null;
  due_date: string | null;
  /** 最近一次进入收集箱的时间（SQLite datetime 文本）；出箱后清空 */
  inbox_entered_at: string | null;
  created_at: string;
  updated_at: string;
  sync_status: SyncStatus;
  extra_data: string | null;
};

export type CreateProjectInput = {
  id: string;
  name: string;
  category_id?: string | null;
  status?: ProjectStatus;
  priority?: ProjectPriority;
  note?: string | null;
  due_date?: string | null;
  extra_data?: string | null;
};

export type UpdateProjectInput = Partial<
  Pick<ProjectRow, 'category_id' | 'name' | 'status' | 'priority' | 'note' | 'due_date' | 'extra_data'>
>;

export type ProjectCategoryRow = {
  id: string;
  name: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
  sync_status: SyncStatus;
  extra_data: string | null;
};

export type CreateProjectCategoryInput = {
  id: string;
  name: string;
  extra_data?: string | null;
};

export type UpdateProjectCategoryInput = Partial<Pick<ProjectCategoryRow, 'name' | 'extra_data'>>;
