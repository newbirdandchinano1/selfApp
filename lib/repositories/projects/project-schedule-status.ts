import type { ProjectRow } from './project.types';
import { parseProjectExtraData } from './project-extra-data';

type ProjectScheduleMeta = {
  mode?: 'date' | 'time';
  date?: string;
  range?: { start: string; end: string };
};

export function formatScheduleDateToYMD(value: string): string {
  const t = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return t.slice(0, 10);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseProjectSchedule(extraData: string | null): ProjectScheduleMeta | null {
  if (!extraData) return null;
  try {
    const parsed = parseProjectExtraData(extraData);
    const schedule = parsed?.schedule;
    if (!schedule || typeof schedule !== 'object' || Array.isArray(schedule)) return null;
    return schedule as ProjectScheduleMeta;
  } catch {
    return null;
  }
}

function ymdToLocalDate(ymd: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
  return new Date(y, mo, d);
}

/** 比较两个 YMD（无效值时退回字符串比较） */
export function compareYmd(a: string, b: string): number {
  const da = ymdToLocalDate(a);
  const db = ymdToLocalDate(b);
  if (!da || !db) return a.localeCompare(b);
  return da.getTime() - db.getTime();
}

function addDaysToYmd(ymd: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return ymd;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${day}`;
}

/** 逻辑日是否落在日程区间内（与任务页独立待办一致） */
export function isLogicalDayInYmdRange(todayYmd: string, startYmd: string, endYmd: string): boolean {
  if (!startYmd || !endYmd) return true;
  if (compareYmd(todayYmd, startYmd) < 0) return false;
  if (startYmd === endYmd) return compareYmd(todayYmd, startYmd) === 0;
  if (endYmd === addDaysToYmd(startYmd, 1)) return compareYmd(todayYmd, endYmd) < 0;
  return compareYmd(todayYmd, endYmd) <= 0;
}

export type ProjectScheduleYmdBounds = {
  startYmd: string | null;
  endYmd: string | null;
  isRange: boolean;
};

function hasScheduleRange(schedule: ProjectScheduleMeta | null): schedule is ProjectScheduleMeta & {
  range: { start: string; end: string };
} {
  return !!(schedule?.range?.start?.trim() && schedule?.range?.end?.trim());
}

export function getProjectScheduleYmdBounds(project: ProjectRow): ProjectScheduleYmdBounds {
  const schedule = parseProjectSchedule(project.extra_data);
  if (hasScheduleRange(schedule)) {
    return {
      startYmd: formatScheduleDateToYMD(schedule.range.start),
      endYmd: formatScheduleDateToYMD(schedule.range.end),
      isRange: true,
    };
  }
  if (schedule?.date) {
    const d = formatScheduleDateToYMD(schedule.date);
    return { startYmd: d, endYmd: d, isRange: false };
  }
  if (project.due_date?.trim()) {
    const d = formatScheduleDateToYMD(project.due_date);
    return { startYmd: d, endYmd: d, isRange: false };
  }
  return { startYmd: null, endYmd: null, isRange: false };
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

  const schedule = parseProjectSchedule(project.extra_data);
  if (hasScheduleRange(schedule)) {
    const start = formatScheduleDateToYMD(schedule.range.start);
    const end = formatScheduleDateToYMD(schedule.range.end);
    if (isLogicalDayInYmdRange(todayYmd, start, end)) return false;
    return compareYmd(todayYmd, start) < 0;
  }

  return compareYmd(todayYmd, bounds.startYmd) < 0;
}

export function isProjectScheduleExpired(project: ProjectRow, todayYmd: string): boolean {
  if (project.status === 'completed' || project.status === 'archived') return false;
  if (isProjectScheduleNotYetStarted(project, todayYmd)) return false;

  const schedule = parseProjectSchedule(project.extra_data);
  if (hasScheduleRange(schedule)) {
    const start = formatScheduleDateToYMD(schedule.range.start);
    const end = formatScheduleDateToYMD(schedule.range.end);
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
