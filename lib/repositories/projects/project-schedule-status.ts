import type { ProjectRow } from './project.types';
import {
  compareYmd,
  hasScheduleRange,
  isLogicalDayInYmdRange,
  parseScheduleMetaFromExtra,
  scheduleDateToYmd,
  scheduleMetaToYmdBounds,
  type ScheduleYmdBounds,
} from '@/lib/schedule';

/** @deprecated 使用 scheduleDateToYmd */
export const formatScheduleDateToYMD = scheduleDateToYmd;

/** @deprecated 使用 parseScheduleMetaFromExtra */
export function parseProjectSchedule(extraData: string | null) {
  return parseScheduleMetaFromExtra(extraData);
}

export { compareYmd, isLogicalDayInYmdRange };

export type ProjectScheduleYmdBounds = ScheduleYmdBounds;

export function getProjectScheduleYmdBounds(project: ProjectRow): ProjectScheduleYmdBounds {
  return scheduleMetaToYmdBounds(parseScheduleMetaFromExtra(project.extra_data), project.due_date);
}

/** 是否已设置日程（区间或单日） */
export function projectHasScheduleBounds(project: ProjectRow): boolean {
  const { startYmd, endYmd } = getProjectScheduleYmdBounds(project);
  return !!(startYmd && endYmd);
}

export function isProjectScheduleNotYetStarted(project: ProjectRow, todayYmd: string): boolean {
  if (project.status === 'completed' || project.status === 'archived') return false;
  const bounds = getProjectScheduleYmdBounds(project);
  if (!bounds.startYmd || !bounds.endYmd) return false;

  const schedule = parseScheduleMetaFromExtra(project.extra_data);
  if (hasScheduleRange(schedule)) {
    const start = scheduleDateToYmd(schedule.range.start);
    const end = scheduleDateToYmd(schedule.range.end);
    if (isLogicalDayInYmdRange(todayYmd, start, end)) return false;
    return compareYmd(todayYmd, start) < 0;
  }

  return compareYmd(todayYmd, bounds.startYmd) < 0;
}

export function isProjectScheduleExpired(project: ProjectRow, todayYmd: string): boolean {
  if (project.status === 'completed' || project.status === 'archived') return false;
  if (isProjectScheduleNotYetStarted(project, todayYmd)) return false;

  const schedule = parseScheduleMetaFromExtra(project.extra_data);
  if (hasScheduleRange(schedule)) {
    const start = scheduleDateToYmd(schedule.range.start);
    const end = scheduleDateToYmd(schedule.range.end);
    return !isLogicalDayInYmdRange(todayYmd, start, end);
  }

  const { endYmd } = getProjectScheduleYmdBounds(project);
  if (!endYmd) return false;
  return compareYmd(todayYmd, endYmd) > 0;
}

export function getProjectScheduleLabel(project: ProjectRow): string | null {
  const bounds = getProjectScheduleYmdBounds(project);
  if (bounds.isRange && bounds.startYmd && bounds.endYmd) {
    return `${bounds.startYmd} ~ ${bounds.endYmd}`;
  }
  if (bounds.endYmd) return bounds.endYmd;
  return null;
}
