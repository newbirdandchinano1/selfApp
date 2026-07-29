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

/** 项目列表排序：上锁置底；其余与原先一致（已完成在后、按截止日期） */
export function sortProjectsForList(rows: ProjectRow[], lockedProjectIds?: Set<string>): ProjectRow[] {
  const safeTime = (value: string | null | undefined) => {
    if (!value) return 0;
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? 0 : ms;
  };
  const getDueMs = (project: ProjectRow): number => {
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
      return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms;
    }
    return Number.POSITIVE_INFINITY;
  };

  const clone = [...rows];
  clone.sort((a, b) => {
    const lockA = lockedProjectIds?.has(a.id) ?? false;
    const lockB = lockedProjectIds?.has(b.id) ?? false;
    if (lockA !== lockB) return lockA ? 1 : -1;

    const doneA = a.status === 'completed' || a.status === 'archived';
    const doneB = b.status === 'completed' || b.status === 'archived';
    if (doneA !== doneB) return doneA ? 1 : -1;

    const priorityA = a.priority ?? 0;
    const priorityB = b.priority ?? 0;
    if (priorityA !== priorityB) return priorityB - priorityA;

    const dueA = getDueMs(a);
    const dueB = getDueMs(b);
    if (dueA !== dueB) return dueA - dueB;
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
