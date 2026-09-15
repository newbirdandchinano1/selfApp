import { parseRewardPointsFromExtraData } from '@/lib/reward-points';
import type { TaskTreeNode } from '../tasks/task';
import type { ProjectRow } from './project.types';
import { parseProjectExtraData, type ProjectExtraDataBag } from './project-extra-data';
import {
  getProjectScheduleYmdBounds,
  isProjectScheduleNotYetStarted,
} from './project-schedule-status';

export const PREREQUISITE_PROJECT_IDS_KEY = 'prerequisite_project_ids';

export type ProjectLockInfo = {
  locked: boolean;
  unmetPrerequisiteNames: string[];
  /** 计划区间/日期尚未开始 */
  scheduleNotStarted: boolean;
  scheduleStartYmd: string | null;
};

/** 递归：项目内任务树是否全部完成或取消 */
export function areAllTasksInProjectTreeDone(nodes: TaskTreeNode[]): boolean {
  for (const n of nodes) {
    if (n.status !== 'done' && n.status !== 'cancelled') return false;
    const ch = n.children;
    if (ch.length > 0 && !areAllTasksInProjectTreeDone(ch)) return false;
  }
  return true;
}

export function parsePrerequisiteProjectIds(extraData: string | null): string[] {
  const extra = parseProjectExtraData(extraData);
  return normalizePrerequisiteProjectIds(extra[PREREQUISITE_PROJECT_IDS_KEY]);
}

export function normalizePrerequisiteProjectIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const id = item.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** 前置项目是否已执行完毕：已完结/归档，或任务树（非空）全部完成 */
export function isPrerequisiteProjectFulfilled(project: ProjectRow, tree: TaskTreeNode[] = []): boolean {
  if (project.status === 'completed' || project.status === 'archived') return true;
  if (tree.length === 0) return false;
  return areAllTasksInProjectTreeDone(tree);
}

export function getPrerequisiteIdsFromExtra(extra: ProjectExtraDataBag): string[] {
  return normalizePrerequisiteProjectIds(extra[PREREQUISITE_PROJECT_IDS_KEY]);
}

export function buildProjectLockMap(
  projects: ProjectRow[],
  treeMap: Record<string, TaskTreeNode[]>,
  todayYmd?: string,
): Map<string, ProjectLockInfo> {
  const byId = new Map(projects.map((p) => [p.id, p]));
  const fulfilledCache = new Map<string, boolean>();

  const isFulfilled = (id: string): boolean => {
    if (fulfilledCache.has(id)) return fulfilledCache.get(id)!;
    const p = byId.get(id);
    if (!p) {
      fulfilledCache.set(id, true);
      return true;
    }
    const ok = isPrerequisiteProjectFulfilled(p, treeMap[id] ?? []);
    fulfilledCache.set(id, ok);
    return ok;
  };

  const map = new Map<string, ProjectLockInfo>();
  for (const project of projects) {
    const prereqIds = parsePrerequisiteProjectIds(project.extra_data);
    const unmet: string[] = [];
    for (const pid of prereqIds) {
      if (!isFulfilled(pid)) {
        unmet.push(byId.get(pid)?.name?.trim() || '未知项目');
      }
    }
    const scheduleNotStarted = todayYmd ? isProjectScheduleNotYetStarted(project, todayYmd) : false;
    const scheduleStartYmd = scheduleNotStarted ? getProjectScheduleYmdBounds(project).startYmd : null;
    map.set(project.id, {
      locked: unmet.length > 0 || scheduleNotStarted,
      unmetPrerequisiteNames: unmet,
      scheduleNotStarted,
      scheduleStartYmd,
    });
  }
  return map;
}

export function wouldCreatePrerequisiteCycle(
  projectId: string,
  newPrerequisiteIds: string[],
  projects: ProjectRow[],
): boolean {
  const byId = new Map(projects.map((p) => [p.id, p]));
  const getPrereqIds = (id: string) => {
    const row = byId.get(id);
    if (!row) return [];
    if (id === projectId) return normalizePrerequisiteProjectIds(newPrerequisiteIds);
    return parsePrerequisiteProjectIds(row.extra_data);
  };

  const visit = (startId: string): boolean => {
    const stack = [startId];
    const visiting = new Set<string>();
    while (stack.length) {
      const cur = stack.pop()!;
      if (cur === projectId) return true;
      if (visiting.has(cur)) continue;
      visiting.add(cur);
      for (const dep of getPrereqIds(cur)) {
        if (!byId.has(dep)) continue;
        stack.push(dep);
      }
    }
    return false;
  };

  return newPrerequisiteIds.some((pid) => pid !== projectId && visit(pid));
}

export type ValidatePrerequisiteSelectionResult =
  | { ok: true }
  | { ok: false; message: string };

export function validatePrerequisiteSelection(
  projectId: string | null,
  selectedIds: string[],
  allProjects: ProjectRow[],
): ValidatePrerequisiteSelectionResult {
  const normalized = normalizePrerequisiteProjectIds(selectedIds);
  if (projectId && normalized.includes(projectId)) {
    return { ok: false, message: '不能将本项目设为自身的前置项目。' };
  }
  const existingIds = new Set(allProjects.map((p) => p.id));
  const missing = normalized.filter((id) => !existingIds.has(id));
  if (missing.length > 0) {
    return { ok: false, message: '部分前置项目已不存在，请重新选择。' };
  }
  if (projectId && wouldCreatePrerequisiteCycle(projectId, normalized, allProjects)) {
    return { ok: false, message: '前置项目会形成循环依赖，请调整选择。' };
  }
  return { ok: true };
}

/**
 * 项目列表排序（结构性置底优先，再按业务键级联）：
 * 1. 上锁 → 置底
 * 2. 已完成 / 归档 → 靠后
 * 3. 标签权重分降序（取已贴标签的最大权重；无标签=0 → 靠后）
 *    ——标签表示「人生领域/该优先做什么」（如收入 > 爱好）；多标签取 max
 * 4. 紧急程度 priority 降序（0/未设最低 → 靠后）
 *    ——同一权重档内的相对紧急/重要（四象限），不是全局人生优先级
 * 5. 有截止日期的在前；同有截止则越早越前；无截止 → 靠后
 * 6. 积分奖励降序（无积分 / 0 → 靠后）
 * 7. updated_at 降序作最后平局
 */
export function sortProjectsForList(
  rows: ProjectRow[],
  lockedProjectIds?: Set<string>,
  tagWeightByProjectId?: Map<string, number>,
): ProjectRow[] {
  const safeTime = (value: string | null | undefined) => {
    if (!value) return 0;
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? 0 : ms;
  };
  /** 有效截止毫秒；无截止返回 null（排序时沉底） */
  const getDueMs = (project: ProjectRow): number | null => {
    const scheduleRaw = project.extra_data;
    if (scheduleRaw) {
      try {
        const parsed = JSON.parse(scheduleRaw) as { schedule?: { mode?: string; range?: { end?: string } } };
        const schedule = parsed?.schedule;
        const rangeEnd = schedule?.range?.end?.trim();
        if (rangeEnd) {
          const ms = Date.parse(rangeEnd);
          if (!Number.isNaN(ms)) return ms;
        }
      } catch {
        /* ignore */
      }
    }
    if (project.due_date?.trim()) {
      const ms = Date.parse(project.due_date);
      if (!Number.isNaN(ms)) return ms;
    }
    return null;
  };

  const getTagWeight = (projectId: string): number => {
    const w = tagWeightByProjectId?.get(projectId);
    return typeof w === 'number' && Number.isFinite(w) ? w : 0;
  };

  const clone = [...rows];
  clone.sort((a, b) => {
    const lockA = lockedProjectIds?.has(a.id) ?? false;
    const lockB = lockedProjectIds?.has(b.id) ?? false;
    if (lockA !== lockB) return lockA ? 1 : -1;

    const doneA = a.status === 'completed' || a.status === 'archived';
    const doneB = b.status === 'completed' || b.status === 'archived';
    if (doneA !== doneB) return doneA ? 1 : -1;

    // 人生领域优先：收入类应整体压过爱好类
    const tagA = getTagWeight(a.id);
    const tagB = getTagWeight(b.id);
    if (tagA !== tagB) return tagB - tagA;

    // 同领域内再比紧急程度
    const priorityA = a.priority ?? 0;
    const priorityB = b.priority ?? 0;
    if (priorityA !== priorityB) return priorityB - priorityA;

    // 无截止日期靠后；都有则越早越前
    const dueA = getDueMs(a);
    const dueB = getDueMs(b);
    const hasDueA = dueA != null;
    const hasDueB = dueB != null;
    if (hasDueA !== hasDueB) return hasDueA ? -1 : 1;
    if (hasDueA && hasDueB && dueA !== dueB) return dueA - dueB;

    // 无积分 / 0 分靠后
    const rewardA = parseRewardPointsFromExtraData(a.extra_data);
    const rewardB = parseRewardPointsFromExtraData(b.extra_data);
    if (rewardA !== rewardB) return rewardB - rewardA;

    return safeTime(b.updated_at) - safeTime(a.updated_at);
  });
  return clone;
}

export function mergePrerequisiteIdsIntoExtraData(
  extra: ProjectExtraDataBag,
  prerequisiteProjectIds: string[],
): ProjectExtraDataBag {
  const ids = normalizePrerequisiteProjectIds(prerequisiteProjectIds);
  const next: ProjectExtraDataBag = { ...extra };
  if (ids.length > 0) {
    next[PREREQUISITE_PROJECT_IDS_KEY] = ids;
  } else {
    delete next[PREREQUISITE_PROJECT_IDS_KEY];
  }
  return next;
}
