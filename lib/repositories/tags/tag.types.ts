import type { SyncStatus } from '../../database.native';

/** 可打标实体：项目 / 习惯 / 独立待办（无 parent_task_id 的 task）/ 备忘录 */
export type TagEntityType = 'project' | 'habit' | 'task' | 'memo';

export type TagRow = {
  id: string;
  name: string;
  color: string;
  description: string | null;
  /** 权重：数值越大越靠前 */
  weight: number;
  created_at: string;
  updated_at: string;
  sync_status: SyncStatus;
  extra_data: string | null;
};

export type CreateTagInput = {
  id: string;
  name: string;
  color: string;
  description?: string | null;
  weight?: number;
  extra_data?: string | null;
};

export type UpdateTagInput = Partial<
  Pick<TagRow, 'name' | 'color' | 'description' | 'weight' | 'extra_data'>
>;

export type TagLinkRow = {
  id: string;
  entity_type: TagEntityType;
  entity_id: string;
  tag_id: string;
  created_at: string;
  updated_at: string;
  sync_status: SyncStatus;
};

/** 预设标签色 */
export const TAG_COLOR_PRESETS = [
  '#EF4444',
  '#F97316',
  '#EAB308',
  '#22C55E',
  '#14B8A6',
  '#3B82F6',
  '#8B5CF6',
  '#EC4899',
  '#64748B',
] as const;

export const DEFAULT_TAG_COLOR = TAG_COLOR_PRESETS[8];

/** @deprecated 兼容旧导入名 */
export type ProjectTagRow = TagRow;
/** @deprecated 兼容旧导入名 */
export type CreateProjectTagInput = CreateTagInput;
/** @deprecated 兼容旧导入名 */
export type UpdateProjectTagInput = UpdateTagInput;
/** @deprecated 兼容旧导入名 */
export type ProjectTagLinkRow = TagLinkRow & { project_id?: string };
/** @deprecated 兼容旧导入名 */
export const PROJECT_TAG_COLOR_PRESETS = TAG_COLOR_PRESETS;
/** @deprecated 兼容旧导入名 */
export const DEFAULT_PROJECT_TAG_COLOR = DEFAULT_TAG_COLOR;
