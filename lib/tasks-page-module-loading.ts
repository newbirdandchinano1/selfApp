/**
 * 阶段 D1：任务页模块级 LoadState 与整页骨架策略。
 * 整页 skeleton 只在「无本地快照且 core loading」时显示。
 */

export type LoadState = 'idle' | 'loading' | 'ready' | 'error';

export type TasksLoadState = {
  /** catalog + standaloneTodos */
  core: LoadState;
  /** projects-list */
  projects: LoadState;
  /** matrixWeek（依赖 core 解析出的项目 id） */
  matrix: LoadState;
  habits: LoadState;
  heatmap: LoadState;
  /** WeeklyFrogSchedule 组件自治；页面只跟踪对外态 */
  frogs: LoadState;
  points: LoadState;
};

export const IDLE_TASKS_LOAD_STATE: TasksLoadState = {
  core: 'idle',
  projects: 'idle',
  matrix: 'idle',
  habits: 'idle',
  heatmap: 'idle',
  frogs: 'idle',
  points: 'idle',
};

function envFlagOn(raw: string | undefined, defaultOn: boolean): boolean {
  if (raw == null || raw.trim() === '') return defaultOn;
  const v = raw.trim().toLowerCase();
  return v !== '0' && v !== 'false' && v !== 'off' && v !== 'no';
}

/**
 * 灰度开关：EXPO_PUBLIC_TASKS_MODULE_LOADING_ENABLED=0 回滚为单一 pending 骨架。
 * 默认开启（阶段 D 落地）；关开关即走旧 reload 路径。
 */
export function isTasksModuleLoadingEnabled(): boolean {
  return envFlagOn(process.env.EXPO_PUBLIC_TASKS_MODULE_LOADING_ENABLED, true);
}

/** 首屏并发上限（core 优先批次内） */
export const TASKS_PAGE_MAX_CONCURRENCY = 3;

export function patchTasksLoadState(
  prev: TasksLoadState,
  patch: Partial<TasksLoadState>,
): TasksLoadState {
  return { ...prev, ...patch };
}

export function shouldShowTasksFullPageSkeleton(opts: {
  enabled: boolean;
  hasLocalSnapshot: boolean;
  core: LoadState;
  /** 旧路径：单一 pending */
  legacyPending?: boolean;
}): boolean {
  if (!opts.enabled) return Boolean(opts.legacyPending);
  if (opts.hasLocalSnapshot) return false;
  return opts.core === 'loading' || opts.core === 'idle';
}

export function markModuleLoading(
  prev: TasksLoadState,
  keys: (keyof TasksLoadState)[],
): TasksLoadState {
  const next = { ...prev };
  for (const key of keys) next[key] = 'loading';
  return next;
}

export function markModuleResult(
  prev: TasksLoadState,
  key: keyof TasksLoadState,
  ok: boolean,
): TasksLoadState {
  return { ...prev, [key]: ok ? 'ready' : 'error' };
}

/** 分区骨架：模块仍在 loading，且本地该区尚无内容可展示 */
export function shouldShowTasksSectionSkeleton(
  state: LoadState,
  hasLocalContent: boolean,
): boolean {
  if (hasLocalContent) return false;
  return state === 'loading' || state === 'idle';
}
