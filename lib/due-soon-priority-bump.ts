/**
 * 截止日期临近（默认 3 天内）或已过期时：不紧急 → 紧急，保留重要/不重要。
 * （不紧急不重要 → 紧急不重要；不紧急重要 → 紧急重要）
 *
 * 规则必须落库：create/update 写路径会 clamp；列表仅作展示兜底。
 */

import { daysBetweenYmd } from '@/lib/project-progress-reminder-logic';
import type { ProjectRow } from '@/lib/repositories/projects/project.types';
import {
  normalizeTaskPriority,
  type TaskPriority,
  type TaskRow,
} from '@/lib/repositories/tasks/task.types';
import { dueDateFromScheduleMeta, parseScheduleMetaFromExtra } from '@/lib/schedule/meta';

type UrgentAxisPriorityKey =
  | 'urgent-important'
  | 'urgent-not-important'
  | 'not-urgent-important'
  | 'not-urgent-not-important';

/** 含今天：今天 / 明天 / 后天 / 大后天（共 0..3）；过期同属强制紧急 */
export const DUE_SOON_PRIORITY_WINDOW_DAYS = 3;

export function resolveTaskDueYmdForPriority(task: Pick<TaskRow, 'due_date' | 'extra_data'>): string | null {
  return dueDateFromScheduleMeta(parseScheduleMetaFromExtra(task.extra_data), task.due_date);
}

export function resolveProjectDueYmdForPriority(
  project: Pick<ProjectRow, 'due_date' | 'extra_data'>,
): string | null {
  return dueDateFromScheduleMeta(parseScheduleMetaFromExtra(project.extra_data), project.due_date);
}

/** 截止日在 [today, today+windowDays] 内（含两端） */
export function isDueWithinPriorityWindow(
  todayYmd: string,
  dueYmd: string | null | undefined,
  windowDays: number = DUE_SOON_PRIORITY_WINDOW_DAYS,
): boolean {
  if (!dueYmd?.trim()) return false;
  const days = daysBetweenYmd(todayYmd, dueYmd.trim().slice(0, 10));
  if (days == null) return false;
  const window = Math.max(0, windowDays);
  return days >= 0 && days <= window;
}

/**
 * 必须紧急：已过期，或剩余天数 ≤ windowDays（含今天）。
 * days = due - today；过期为负，临期为 0..window。
 */
export function isDeadlineRequiringUrgent(
  todayYmd: string,
  dueYmd: string | null | undefined,
  windowDays: number = DUE_SOON_PRIORITY_WINDOW_DAYS,
): boolean {
  if (!dueYmd?.trim()) return false;
  const days = daysBetweenYmd(todayYmd, dueYmd.trim().slice(0, 10));
  if (days == null) return false;
  return days <= Math.max(0, windowDays);
}

/**
 * 不紧急 → 紧急（保留重要轴）：
 * - 2 不紧急重要 → 4 紧急重要
 * - 0/1 未设或不紧急不重要 → 3 紧急不重要
 * - 已紧急（≥3）不变，返回 null
 */
export function bumpNonUrgentToUrgentPriority(priority: unknown): TaskPriority | null {
  const p = normalizeTaskPriority(priority);
  if (p >= 3) return null;
  if (p === 2) return 4;
  return 3;
}

export function isNonUrgentPriorityKey(key: UrgentAxisPriorityKey | string): boolean {
  return key === 'not-urgent-important' || key === 'not-urgent-not-important';
}

export function clampPriorityForDeadline(
  priority: unknown,
  todayYmd: string,
  dueYmd: string | null | undefined,
  opts?: { overdue?: boolean; windowDays?: number },
): TaskPriority {
  const current = normalizeTaskPriority(priority);
  const locked =
    !!opts?.overdue ||
    isDeadlineRequiringUrgent(todayYmd, dueYmd, opts?.windowDays ?? DUE_SOON_PRIORITY_WINDOW_DAYS);
  if (!locked) return current;
  return bumpNonUrgentToUrgentPriority(current) ?? current;
}

export function getDueSoonEffectivePriority(
  priority: unknown,
  todayYmd: string,
  dueYmd: string | null | undefined,
  windowDays: number = DUE_SOON_PRIORITY_WINDOW_DAYS,
): TaskPriority {
  return clampPriorityForDeadline(priority, todayYmd, dueYmd, { windowDays });
}

/**
 * 列表/详情共用的截止相关有效优先级：
 * - 已过期或临期窗口内：不紧急 → 紧急（保留重要轴）
 * - 否则：原 priority
 */
export function getDeadlineEffectivePriority(
  priority: unknown,
  opts: {
    todayYmd: string;
    dueYmd?: string | null;
    overdue?: boolean;
    windowDays?: number;
  },
): TaskPriority {
  return clampPriorityForDeadline(priority, opts.todayYmd, opts.dueYmd, {
    overdue: opts.overdue,
    windowDays: opts.windowDays,
  });
}

/** UI：临期/过期时禁止选手动改为不紧急 */
export function shouldLockNonUrgentPriority(
  todayYmd: string,
  dueYmd: string | null | undefined,
  opts?: { overdue?: boolean; windowDays?: number },
): boolean {
  return (
    !!opts?.overdue ||
    isDeadlineRequiringUrgent(todayYmd, dueYmd, opts?.windowDays ?? DUE_SOON_PRIORITY_WINDOW_DAYS)
  );
}

export const NON_URGENT_PRIORITY_LOCK_HINT = '截止日期剩余 3 天内（含已过期）不可改为不紧急';
