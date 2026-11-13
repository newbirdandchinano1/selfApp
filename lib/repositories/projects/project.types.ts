import type { SyncStatus } from '../../database.native';

/**
 * 与任务 TaskStatus 对齐：
 * - todo 待办：未指派
 * - doing 进行中：已被指派
 * - blocked 受阻：有未满足的前置
 * - done 已完成
 * - cancelled 已放弃：用户主动放弃
 * - shelved 搁置：用户暂时搁置
 *
 * 旧值兼容：active→todo，paused→shelved，completed/archived→done
 */
export type ProjectStatus = 'todo' | 'doing' | 'done' | 'blocked' | 'cancelled' | 'shelved';

/** 与任务相同：0 未设，1–4 艾森豪威尔四象限 */
export type ProjectPriority = 0 | 1 | 2 | 3 | 4;

const LEGACY_PROJECT_STATUS_MAP: Record<string, ProjectStatus> = {
  active: 'todo',
  paused: 'shelved',
  completed: 'done',
  archived: 'done',
};

export function normalizeProjectStatus(raw: unknown): ProjectStatus {
  const s = String(raw ?? '').trim();
  if (
    s === 'todo' ||
    s === 'doing' ||
    s === 'done' ||
    s === 'blocked' ||
    s === 'cancelled' ||
    s === 'shelved'
  ) {
    return s;
  }
  return LEGACY_PROJECT_STATUS_MAP[s] ?? 'todo';
}

/** 已完成或已取消（含旧 completed/archived） */
export function isProjectTerminalStatus(status: ProjectStatus | string): boolean {
  const s = normalizeProjectStatus(status);
  return s === 'done' || s === 'cancelled';
}

/** 暂时搁置（含旧 paused） */
export function isProjectShelvedStatus(status: ProjectStatus | string): boolean {
  return normalizeProjectStatus(status) === 'shelved';
}

/** 活跃：待办 / 进行中 / 受阻（含旧 active） */
export function isProjectActiveStatus(status: ProjectStatus | string): boolean {
  const s = normalizeProjectStatus(status);
  return s === 'todo' || s === 'doing' || s === 'blocked';
}

export function formatProjectStatusLabel(status: ProjectStatus | string): string {
  switch (normalizeProjectStatus(status)) {
    case 'doing':
      return '进行中';
    case 'blocked':
      return '受阻';
    case 'done':
      return '已完成';
    case 'cancelled':
      return '已放弃';
    case 'shelved':
      return '搁置';
    case 'todo':
    default:
      return '待办';
  }
}

export type ProjectRow = {
  id: string;
  category_id: string | null;
  /** 归属道路赌注 life_bets.id（旧）；可空 */
  life_bet_id?: string | null;
  /** 归属月目标 life_road_nodes.id（kind=month）；可空，禁止放进 extra_data */
  life_month_goal_id?: string | null;
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
  life_bet_id?: string | null;
  life_month_goal_id?: string | null;
  status?: ProjectStatus;
  priority?: ProjectPriority;
  note?: string | null;
  due_date?: string | null;
  extra_data?: string | null;
};

export type UpdateProjectInput = Partial<
  Pick<
    ProjectRow,
    | 'category_id'
    | 'life_bet_id'
    | 'life_month_goal_id'
    | 'name'
    | 'status'
    | 'priority'
    | 'note'
    | 'due_date'
    | 'extra_data'
  >
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
