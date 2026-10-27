/**
 * 任务 / 独立待办 / 项目列表组合筛选（客户端）。
 * 维度间 AND；同维度多选 OR（日期预设互斥单选）。
 */
import { addDaysToYmd, parseYmd } from '@/lib/date';
import { getIsLongTermProject, getIsLongTermTask } from '@/lib/long-term-task';
import type { ProjectRow } from '@/lib/repositories/projects/project.types';
import { normalizeTaskPriority } from '@/lib/repositories/tasks/task.types';
import type { TaskRow } from '@/lib/repositories/tasks/task.types';
import {
  parseScheduleMetaFromExtra,
  scheduleMetaToYmdBounds,
} from '@/lib/schedule/meta';
import { getWeekStartMondayYmd } from '@/lib/schedule/week';

export type TaskDatePreset = 'today' | 'tomorrow' | 'week' | 'month' | 'year';

/** 长期：全部 / 仅长期 / 仅非长期 */
export type TaskLongTermFilter = 'all' | 'yes' | 'no';

/** 项目列表作用域：全部 / 仅项目本身 / 仅子任务 */
export type TaskEntityScopeFilter = 'all' | 'project' | 'task';

export type TaskListFilterState = {
  search: string;
  datePreset: TaskDatePreset | null;
  /** 空 = 不限；多选 OR */
  tagIds: string[];
  /** 空 = 不限；1–4 对应四象限 */
  priorities: number[];
  longTerm: TaskLongTermFilter;
  /**
   * 项目列表专用：匹配对象。
   * - all：项目本身或任一子任务命中即保留
   * - project：仅项目本身命中才保留
   * - task：仅子任务命中才保留（任务树只留命中链）
   */
  entityScope: TaskEntityScopeFilter;
};

export const EMPTY_TASK_LIST_FILTER: TaskListFilterState = {
  search: '',
  datePreset: null,
  tagIds: [],
  priorities: [],
  longTerm: 'all',
  entityScope: 'all',
};

export const TASK_ENTITY_SCOPE_OPTIONS: {
  key: TaskEntityScopeFilter;
  label: string;
  short: string;
}[] = [
  { key: 'all', label: '全部', short: '全部' },
  { key: 'project', label: '仅项目', short: '仅项目' },
  { key: 'task', label: '仅任务', short: '仅任务' },
];

export const TASK_DATE_PRESET_OPTIONS: { key: TaskDatePreset; label: string }[] = [
  { key: 'today', label: '今天' },
  { key: 'tomorrow', label: '明天' },
  { key: 'week', label: '本周' },
  { key: 'month', label: '本月' },
  { key: 'year', label: '今年' },
];

export const TASK_PRIORITY_FILTER_OPTIONS: { value: number; label: string; short: string }[] = [
  { value: 4, label: '紧急重要', short: 'P1' },
  { value: 3, label: '紧急不重要', short: 'P2' },
  { value: 2, label: '不紧急重要', short: 'P3' },
  { value: 1, label: '不紧急不重要', short: 'P4' },
];

export function isTaskListFilterActive(filter: TaskListFilterState): boolean {
  return (
    filter.search.trim().length > 0 ||
    filter.datePreset != null ||
    filter.tagIds.length > 0 ||
    filter.priorities.length > 0 ||
    filter.longTerm !== 'all' ||
    (filter.entityScope ?? 'all') !== 'all'
  );
}

export function countActiveTaskListFilterDims(filter: TaskListFilterState): number {
  let n = 0;
  if (filter.search.trim()) n += 1;
  if (filter.datePreset) n += 1;
  if (filter.tagIds.length > 0) n += 1;
  if (filter.priorities.length > 0) n += 1;
  if (filter.longTerm !== 'all') n += 1;
  if ((filter.entityScope ?? 'all') !== 'all') n += 1;
  return n;
}

/** 筛选摘要文案（用于栏底提示） */
export function formatTaskListFilterScopeHint(filter: TaskListFilterState): string {
  const scope = filter.entityScope ?? 'all';
  if (scope === 'project') return '仅项目';
  if (scope === 'task') return '仅任务';
  return '';
}

export function resolveDatePresetRange(
  preset: TaskDatePreset,
  logicalTodayYmd: string,
): { startYmd: string; endYmd: string } {
  if (preset === 'today') {
    return { startYmd: logicalTodayYmd, endYmd: logicalTodayYmd };
  }
  if (preset === 'tomorrow') {
    const t = addDaysToYmd(logicalTodayYmd, 1);
    return { startYmd: t, endYmd: t };
  }
  if (preset === 'week') {
    const start = getWeekStartMondayYmd(logicalTodayYmd);
    return { startYmd: start, endYmd: addDaysToYmd(start, 6) };
  }
  if (preset === 'month') {
    const d = parseYmd(logicalTodayYmd);
    if (!d) {
      const y = logicalTodayYmd.slice(0, 4);
      const m = logicalTodayYmd.slice(5, 7);
      return { startYmd: `${y}-${m}-01`, endYmd: `${y}-${m}-28` };
    }
    const startYmd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    const endYmd = `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`;
    return { startYmd, endYmd };
  }
  const y = logicalTodayYmd.slice(0, 4);
  return { startYmd: `${y}-01-01`, endYmd: `${y}-12-31` };
}

function rangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

type DateBoundRow = { due_date: string | null; extra_data: string | null };

/** 日程 / due 覆盖的日历区间；无日期返回 null */
export function getEntityDateBounds(row: DateBoundRow): { startYmd: string; endYmd: string } | null {
  const bounds = scheduleMetaToYmdBounds(
    parseScheduleMetaFromExtra(row.extra_data),
    row.due_date,
  );
  if (!bounds.startYmd || !bounds.endYmd) return null;
  return { startYmd: bounds.startYmd, endYmd: bounds.endYmd };
}

/** @deprecated 使用 getEntityDateBounds */
export function getTaskDateBounds(task: TaskRow): { startYmd: string; endYmd: string } | null {
  return getEntityDateBounds(task);
}

function matchesDatePreset(
  row: DateBoundRow,
  preset: TaskDatePreset,
  logicalTodayYmd: string,
): boolean {
  const bounds = getEntityDateBounds(row);
  if (!bounds) return false;
  const range = resolveDatePresetRange(preset, logicalTodayYmd);
  return rangesOverlap(bounds.startYmd, bounds.endYmd, range.startYmd, range.endYmd);
}

function matchesSearchText(haystackParts: Array<string | null | undefined>, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return haystackParts
    .map((p) => (p ?? '').trim())
    .join('\n')
    .toLowerCase()
    .includes(q);
}

function matchesTags(
  entityId: string,
  selectedTagIds: string[],
  tagIdsByEntityId: Map<string, string[]> | undefined,
): boolean {
  if (selectedTagIds.length === 0) return true;
  const have = tagIdsByEntityId?.get(entityId) ?? [];
  if (have.length === 0) return false;
  const set = new Set(have);
  return selectedTagIds.some((id) => set.has(id));
}

function matchesPriority(priority: number | null | undefined, priorities: number[]): boolean {
  if (priorities.length === 0) return true;
  return priorities.includes(normalizeTaskPriority(priority));
}

function matchesLongTermFlag(isLongTerm: boolean, longTerm: TaskLongTermFilter): boolean {
  if (longTerm === 'all') return true;
  return longTerm === 'yes' ? isLongTerm : !isLongTerm;
}

export type ApplyTaskListFilterOpts = {
  logicalTodayYmd: string;
  /** entityId → tagId[] */
  tagIdsByTaskId?: Map<string, string[]>;
};

/** 项目筛选 opts（与任务同形，命名区分调用点） */
export type ApplyProjectListFilterOpts = {
  logicalTodayYmd: string;
  tagIdsByProjectId?: Map<string, string[]>;
  /**
   * 项目 id → 扁平任务（含子任务）。
   * 项目本身不匹配时，只要任一子任务匹配仍保留该项目。
   */
  tasksByProjectId?: Record<string, TaskRow[]>;
  /** 子任务标签；与 tasksByProjectId 配合做标签维度匹配 */
  tagIdsByTaskId?: Map<string, string[]>;
};

export function taskPassesListFilter(
  task: TaskRow,
  filter: TaskListFilterState,
  opts: ApplyTaskListFilterOpts,
): boolean {
  if (!matchesSearchText([task.title, task.note, task.description], filter.search)) return false;
  if (filter.datePreset && !matchesDatePreset(task, filter.datePreset, opts.logicalTodayYmd)) {
    return false;
  }
  if (!matchesTags(task.id, filter.tagIds, opts.tagIdsByTaskId)) return false;
  if (!matchesPriority(task.priority, filter.priorities)) return false;
  if (!matchesLongTermFlag(getIsLongTermTask(task.extra_data), filter.longTerm)) return false;
  return true;
}

export function applyTaskListFilter<T extends TaskRow>(
  rows: T[],
  filter: TaskListFilterState,
  opts: ApplyTaskListFilterOpts,
): T[] {
  if (!isTaskListFilterActive(filter)) return rows;
  return rows.filter((t) => taskPassesListFilter(t, filter, opts));
}

export function projectPassesListFilter(
  project: ProjectRow,
  filter: TaskListFilterState,
  opts: ApplyProjectListFilterOpts,
): boolean {
  if (!matchesSearchText([project.name, project.note], filter.search)) return false;
  if (filter.datePreset && !matchesDatePreset(project, filter.datePreset, opts.logicalTodayYmd)) {
    return false;
  }
  if (!matchesTags(project.id, filter.tagIds, opts.tagIdsByProjectId)) return false;
  if (!matchesPriority(project.priority, filter.priorities)) return false;
  if (!matchesLongTermFlag(getIsLongTermProject(project.extra_data), filter.longTerm)) return false;
  return true;
}

export function projectHasMatchingDescendantTask(
  projectId: string,
  filter: TaskListFilterState,
  opts: ApplyProjectListFilterOpts,
): boolean {
  const tasks = opts.tasksByProjectId?.[projectId];
  if (!tasks || tasks.length === 0) return false;
  const taskOpts: ApplyTaskListFilterOpts = {
    logicalTodayYmd: opts.logicalTodayYmd,
    tagIdsByTaskId: opts.tagIdsByTaskId,
  };
  return tasks.some((t) => taskPassesListFilter(t, filter, taskOpts));
}

export type ProjectListFilterMatchKind = 'none' | 'project' | 'task' | 'both';

/** 项目列表筛选命中类型（用于 UI 高亮：项目 / 任务 / 两者） */
export function getProjectListFilterMatchKind(
  project: ProjectRow,
  filter: TaskListFilterState,
  opts: ApplyProjectListFilterOpts,
): ProjectListFilterMatchKind {
  if (!isTaskListFilterActive(filter)) return 'none';
  const projectHit = projectPassesListFilter(project, filter, opts);
  const taskHit = projectHasMatchingDescendantTask(project.id, filter, opts);
  if (projectHit && taskHit) return 'both';
  if (projectHit) return 'project';
  if (taskHit) return 'task';
  return 'none';
}

/** 收集项目下命中筛选条件的任务 id（高亮用） */
export function collectMatchingTaskIdsInProject(
  projectId: string,
  filter: TaskListFilterState,
  opts: ApplyProjectListFilterOpts,
): Set<string> {
  const out = new Set<string>();
  if (!isTaskListFilterActive(filter)) return out;
  const tasks = opts.tasksByProjectId?.[projectId];
  if (!tasks || tasks.length === 0) return out;
  const taskOpts: ApplyTaskListFilterOpts = {
    logicalTodayYmd: opts.logicalTodayYmd,
    tagIdsByTaskId: opts.tagIdsByTaskId,
  };
  for (const t of tasks) {
    if (taskPassesListFilter(t, filter, taskOpts)) out.add(t.id);
  }
  return out;
}

/**
 * 项目本身匹配，或其下任一子任务匹配（受 entityScope 约束）。
 * - project：仅项目本身
 * - task：仅子任务
 * - all：二者任一
 */
export function projectOrDescendantPassesListFilter(
  project: ProjectRow,
  filter: TaskListFilterState,
  opts: ApplyProjectListFilterOpts,
): boolean {
  const scope = filter.entityScope ?? 'all';
  const projectHit = projectPassesListFilter(project, filter, opts);
  if (scope === 'project') return projectHit;
  const taskHit = projectHasMatchingDescendantTask(project.id, filter, opts);
  if (scope === 'task') return taskHit;
  return projectHit || taskHit;
}

export function applyProjectListFilter<T extends ProjectRow>(
  rows: T[],
  filter: TaskListFilterState,
  opts: ApplyProjectListFilterOpts,
): T[] {
  if (!isTaskListFilterActive(filter)) return rows;
  return rows.filter((p) => projectOrDescendantPassesListFilter(p, filter, opts));
}

type TaskTreeFilterNode = TaskRow & { children?: TaskTreeFilterNode[] };

/**
 * 列表筛选生效时裁剪任务树。
 * - 仅任务 / 项目未命中：只保留匹配任务及其祖先链
 * - 项目本身已命中且作用域非「仅任务」：原样返回完整任务树
 */
export function filterProjectTaskTreeForListFilter<T extends TaskTreeFilterNode>(
  nodes: T[],
  filter: TaskListFilterState,
  opts: ApplyTaskListFilterOpts,
  projectMatched: boolean,
): T[] {
  const scope = filter.entityScope ?? 'all';
  const showFullTree = projectMatched && scope !== 'task';
  if (!isTaskListFilterActive(filter) || showFullTree) return nodes;
  const result: T[] = [];
  for (const node of nodes) {
    const children = Array.isArray(node.children) ? (node.children as T[]) : [];
    const filteredChildren = filterProjectTaskTreeForListFilter(children, filter, opts, false);
    const selfMatch = taskPassesListFilter(node, filter, opts);
    if (!selfMatch && filteredChildren.length === 0) continue;
    result.push({ ...node, children: filteredChildren });
  }
  return result;
}

export function toggleInList<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((x) => x !== value) : [...list, value];
}
