import { getFrogAssignedDates } from '@/lib/frog-assignment';
import {
  compareYmd,
  projectHasScheduleBounds,
  isProjectScheduleExpired,
} from '@/lib/repositories/projects/project-schedule-status';
import {
  isProjectActiveStatus,
  normalizeProjectStatus,
  type ProjectStatus,
  type ProjectRow,
} from '@/lib/repositories/projects/project.types';
import {
  isTaskShelvedStatus,
  isTaskTerminalStatus,
  type TaskStatus,
} from '@/lib/repositories/tasks/task.types';
import { parseScheduleMetaFromExtra, scheduleMetaToYmdBounds } from '@/lib/schedule';

/** 放弃时间：写入 extra_data.cancelled_at（YYYY-MM-DD） */
export const CANCELLED_AT_KEY = 'cancelled_at';

export type WorkflowAutoStatus = 'todo' | 'doing' | 'blocked';

function parseExtraObject(extraData: string | null | undefined): Record<string, unknown> {
  if (!extraData) return {};
  try {
    const parsed = JSON.parse(extraData) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function getCancelledAtYmd(extraData: string | null | undefined): string | null {
  const raw = parseExtraObject(extraData)[CANCELLED_AT_KEY];
  if (typeof raw !== 'string') return null;
  const ymd = raw.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? ymd : null;
}

export function mergeCancelledAt(extraData: string | null | undefined, ymd: string): string {
  const current = parseExtraObject(extraData);
  return JSON.stringify({ ...current, [CANCELLED_AT_KEY]: ymd });
}

export function clearCancelledAt(extraData: string | null | undefined): string | null {
  const current = parseExtraObject(extraData);
  if (!(CANCELLED_AT_KEY in current)) return extraData ?? null;
  const { [CANCELLED_AT_KEY]: _removed, ...rest } = current;
  return Object.keys(rest).length === 0 ? null : JSON.stringify(rest);
}

export function hasFrogAssignment(extraData: string | null | undefined): boolean {
  return getFrogAssignedDates(extraData ?? null).length > 0;
}

/**
 * 自动推导活跃态：受阻 > 已指派(进行中) > 待办。
 * 终态 / 搁置由用户手控，不自动改写。
 */
export function deriveAutoWorkflowStatus(params: {
  assigned: boolean;
  blocked: boolean;
}): WorkflowAutoStatus {
  if (params.blocked) return 'blocked';
  if (params.assigned) return 'doing';
  return 'todo';
}

export function deriveTaskStatusAfterWorkflow(params: {
  current: TaskStatus | string;
  assigned: boolean;
  blocked: boolean;
}): TaskStatus {
  if (isTaskTerminalStatus(params.current) || isTaskShelvedStatus(params.current)) {
    return params.current as TaskStatus;
  }
  return deriveAutoWorkflowStatus(params);
}

export function deriveProjectStatusAfterWorkflow(params: {
  current: ProjectStatus | string;
  assigned: boolean;
  blocked: boolean;
}): ProjectStatus {
  const current = normalizeProjectStatus(params.current);
  if (current === 'done' || current === 'cancelled' || current === 'shelved') {
    return current;
  }
  return deriveAutoWorkflowStatus(params);
}

function entityHasScheduleOrDue(params: {
  due_date: string | null | undefined;
  extra_data: string | null | undefined;
}): boolean {
  if (params.due_date?.trim()) return true;
  const bounds = scheduleMetaToYmdBounds(
    parseScheduleMetaFromExtra(params.extra_data ?? null),
    params.due_date ?? null,
  );
  return !!(bounds.startYmd || bounds.endYmd);
}

/** 已取消且设置了时间：次日或过期后可归档收集箱 */
export function shouldArchiveCancelledEntity(params: {
  status: string;
  due_date: string | null | undefined;
  extra_data: string | null | undefined;
  todayYmd: string;
  /** 项目可用现成过期判断；任务不传 */
  project?: ProjectRow | null;
}): boolean {
  const status = String(params.status ?? '');
  const isCancelled =
    status === 'cancelled' || normalizeProjectStatus(status) === 'cancelled';
  if (!isCancelled) return false;
  if (!entityHasScheduleOrDue(params)) return false;

  const cancelledAt = getCancelledAtYmd(params.extra_data);
  const dayAfterCancel =
    cancelledAt != null && compareYmd(params.todayYmd, cancelledAt) > 0;

  let expired = false;
  if (params.project) {
    expired = isProjectScheduleExpired(params.project, params.todayYmd);
  } else {
    const bounds = scheduleMetaToYmdBounds(
      parseScheduleMetaFromExtra(params.extra_data ?? null),
      params.due_date ?? null,
    );
    if (bounds.endYmd) {
      expired = compareYmd(params.todayYmd, bounds.endYmd) > 0;
    }
  }

  return dayAfterCancel || expired;
}

export function projectRowHasScheduleOrDue(project: ProjectRow): boolean {
  if (project.due_date?.trim()) return true;
  return projectHasScheduleBounds(project);
}

/** 临期优先级 bump：仅活跃项目 */
export function isProjectPriorityBumpEligible(status: string): boolean {
  return isProjectActiveStatus(status);
}
