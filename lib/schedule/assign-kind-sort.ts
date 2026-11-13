/**
 * 时间线 / 最简列表指派拉通排序：
 * 类型优先：项目 → 任务 → 待办 → 小习惯；
 * 同类型再对齐各类列表内部规则。
 */
import { compareDatetimeDesc } from '@/lib/api-read-helpers';
import { parseRewardPointsFromExtraData } from '@/lib/reward-points';
import type { TimelineEventKind } from '@/lib/schedule/timeline/types';

/** 与 TimelineEventKind / 课表 blockKind 一致 */
export type AssignDisplayKind = TimelineEventKind;

/** 越小越靠前：项目 → 任务 → 待办 → 小习惯 */
export const ASSIGN_DISPLAY_KIND_RANK: Record<AssignDisplayKind, number> = {
  proj: 0,
  frog: 1,
  todo: 2,
  habit: 3,
};

export const ASSIGN_DISPLAY_KIND_LABEL: Record<AssignDisplayKind, string> = {
  proj: '项目',
  frog: '任务',
  todo: '待办',
  habit: '小习惯',
};

export function assignDisplayKindLabel(kind: AssignDisplayKind): string {
  return ASSIGN_DISPLAY_KIND_LABEL[kind] ?? '指派';
}

export function compareAssignDisplayKind(a: AssignDisplayKind, b: AssignDisplayKind): number {
  const ra = ASSIGN_DISPLAY_KIND_RANK[a] ?? 99;
  const rb = ASSIGN_DISPLAY_KIND_RANK[b] ?? 99;
  return ra - rb;
}

/** 同类型内部排序所需的最小字段（对齐项目/任务/待办/习惯列表） */
export type AssignSortableItem = {
  kind: AssignDisplayKind;
  done: boolean;
  overdue: boolean;
  priority: number;
  title: string;
  /** 习惯 / 主体 id，习惯组内稳定序 */
  id?: string | null;
  /** 任务树 sort_order */
  sortOrder?: number | null;
  /** 有效截止毫秒；无截止为 null */
  dueMs?: number | null;
  rewardPoints?: number | null;
  updatedAt?: string | null;
  /** 次要平局：开始时刻 */
  startMins?: number | null;
};

function safeUpdatedDesc(a: string | null | undefined, b: string | null | undefined): number {
  return compareDatetimeDesc(a, b);
}

function compareDueAscNullLast(a: number | null | undefined, b: number | null | undefined): number {
  const hasA = a != null && Number.isFinite(a);
  const hasB = b != null && Number.isFinite(b);
  if (hasA !== hasB) return hasA ? -1 : 1;
  if (hasA && hasB && a !== b) return (a as number) - (b as number);
  return 0;
}

/** 项目列表：完成沉底 → priority↓ → 截止 → 积分↓ → updated↓ → 标题 → 时刻 */
function compareWithinProject(a: AssignSortableItem, b: AssignSortableItem): number {
  if (a.done !== b.done) return a.done ? 1 : -1;
  if (a.priority !== b.priority) return b.priority - a.priority;
  const byDue = compareDueAscNullLast(a.dueMs, b.dueMs);
  if (byDue !== 0) return byDue;
  const ra = a.rewardPoints ?? 0;
  const rb = b.rewardPoints ?? 0;
  if (ra !== rb) return rb - ra;
  const byUpdated = safeUpdatedDesc(a.updatedAt, b.updatedAt);
  if (byUpdated !== 0) return byUpdated;
  const byTitle = a.title.localeCompare(b.title, 'zh');
  if (byTitle !== 0) return byTitle;
  return (a.startMins ?? 0) - (b.startMins ?? 0);
}

/** 项目内任务：sort_order↑ → priority↓ → 截止↑ → updated↓ → 标题 → 时刻 */
function compareWithinTask(a: AssignSortableItem, b: AssignSortableItem): number {
  if (a.done !== b.done) return a.done ? 1 : -1;
  const sa = a.sortOrder ?? 0;
  const sb = b.sortOrder ?? 0;
  if (sa !== sb) return sa - sb;
  if (a.priority !== b.priority) return b.priority - a.priority;
  const byDue = compareDueAscNullLast(a.dueMs, b.dueMs);
  if (byDue !== 0) return byDue;
  const byUpdated = safeUpdatedDesc(a.updatedAt, b.updatedAt);
  if (byUpdated !== 0) return byUpdated;
  const byTitle = a.title.localeCompare(b.title, 'zh');
  if (byTitle !== 0) return byTitle;
  return (a.startMins ?? 0) - (b.startMins ?? 0);
}

/** 独立待办：完成沉底 → 过期置顶 → priority↓ → 截止 → 积分↓ → updated↓ → 标题 → 时刻 */
function compareWithinTodo(a: AssignSortableItem, b: AssignSortableItem): number {
  if (a.done !== b.done) return a.done ? 1 : -1;
  if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
  if (a.priority !== b.priority) return b.priority - a.priority;
  const byDue = compareDueAscNullLast(a.dueMs, b.dueMs);
  if (byDue !== 0) return byDue;
  const ra = a.rewardPoints ?? 0;
  const rb = b.rewardPoints ?? 0;
  if (ra !== rb) return rb - ra;
  const byUpdated = safeUpdatedDesc(a.updatedAt, b.updatedAt);
  if (byUpdated !== 0) return byUpdated;
  const byTitle = a.title.localeCompare(b.title, 'zh');
  if (byTitle !== 0) return byTitle;
  return (a.startMins ?? 0) - (b.startMins ?? 0);
}

/** 小习惯：完成沉底 → id 稳定序 → 标题 → 时刻 */
function compareWithinHabit(a: AssignSortableItem, b: AssignSortableItem): number {
  if (a.done !== b.done) return a.done ? 1 : -1;
  const idA = (a.id ?? '').trim();
  const idB = (b.id ?? '').trim();
  if (idA && idB) {
    const byId = idA.localeCompare(idB);
    if (byId !== 0) return byId;
  }
  const byTitle = a.title.localeCompare(b.title, 'zh');
  if (byTitle !== 0) return byTitle;
  return (a.startMins ?? 0) - (b.startMins ?? 0);
}

function compareWithinKind(a: AssignSortableItem, b: AssignSortableItem): number {
  switch (a.kind) {
    case 'proj':
      return compareWithinProject(a, b);
    case 'frog':
      return compareWithinTask(a, b);
    case 'todo':
      return compareWithinTodo(a, b);
    case 'habit':
      return compareWithinHabit(a, b);
    default:
      return a.title.localeCompare(b.title, 'zh');
  }
}

/**
 * 最简列表 / 全天区 / 同刻并排：类型优先，再同类别内部规则。
 */
export function compareAssignedScheduleItems(
  a: AssignSortableItem,
  b: AssignSortableItem,
): number {
  const byKind = compareAssignDisplayKind(a.kind, b.kind);
  if (byKind !== 0) return byKind;
  return compareWithinKind(a, b);
}

/**
 * 时间线定时块：纵轴仍按开始时刻；同起点再走类型 + 内部规则。
 */
export function compareTimelineTimedEvents(
  a: AssignSortableItem & { startMinutes: number; endMinutes: number },
  b: AssignSortableItem & { startMinutes: number; endMinutes: number },
): number {
  if (a.startMinutes !== b.startMinutes) return a.startMinutes - b.startMinutes;
  const byAssign = compareAssignedScheduleItems(
    { ...a, startMins: a.startMinutes },
    { ...b, startMins: b.startMinutes },
  );
  if (byAssign !== 0) return byAssign;
  if (a.endMinutes !== b.endMinutes) return b.endMinutes - a.endMinutes;
  return 0;
}

/** 从 extra_data / due_date 解析项目有效截止毫秒（对齐 sortProjectsForList） */
export function projectDueMsFromFields(params: {
  dueDate?: string | null;
  extraData?: string | null;
}): number | null {
  const scheduleRaw = params.extraData;
  if (scheduleRaw) {
    try {
      const parsed = JSON.parse(scheduleRaw) as {
        schedule?: { mode?: string; range?: { end?: string } };
      };
      const rangeEnd = parsed?.schedule?.range?.end?.trim();
      if (rangeEnd) {
        const ms = Date.parse(rangeEnd);
        if (!Number.isNaN(ms)) return ms;
      }
    } catch {
      /* ignore */
    }
  }
  if (params.dueDate?.trim()) {
    const ms = Date.parse(params.dueDate);
    if (!Number.isNaN(ms)) return ms;
  }
  return null;
}

export function rewardPointsFromExtra(extraData: string | null | undefined): number {
  return parseRewardPointsFromExtraData(extraData);
}
