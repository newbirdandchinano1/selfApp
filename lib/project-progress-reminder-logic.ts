/**
 * 项目推进提醒纯规则：无近期入格则滞留催促。
 */

const DEFAULT_REMINDER_HOUR = 9;
const DEFAULT_REMINDER_MINUTE = 0;

export const DEFAULT_PROJECT_STALE_DAYS = 3;

export type ProjectProgressNudgeKind = 'stale_no_slot' | 'due_soon';

function parseYmdParts(ymd: string): { y: number; mo: number; d: number } | null {
  const m = ymd.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  const d = parseInt(m[3], 10);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
  return { y, mo, d };
}

export function daysBetweenYmd(fromYmd: string, toYmd: string): number | null {
  const a = parseYmdParts(fromYmd);
  const b = parseYmdParts(toYmd);
  if (!a || !b) return null;
  const aMs = Date.UTC(a.y, a.mo - 1, a.d);
  const bMs = Date.UTC(b.y, b.mo - 1, b.d);
  return Math.round((bMs - aMs) / 86_400_000);
}

/** 最近入格日距今天是否达到滞留阈值（含从未入格） */
export function isProjectStaleWithoutSlot(params: {
  todayYmd: string;
  lastPlacementYmd: string | null;
  staleDays?: number;
}): boolean {
  const window = Math.max(1, params.staleDays ?? DEFAULT_PROJECT_STALE_DAYS);
  if (!params.lastPlacementYmd) return true;
  const gap = daysBetweenYmd(params.lastPlacementYmd, params.todayYmd);
  if (gap == null) return true;
  return gap >= window;
}

export function isProjectDueSoonForProgress(params: {
  todayYmd: string;
  dueYmd: string | null;
  windowDays?: number;
}): boolean {
  if (!params.dueYmd) return false;
  const days = daysBetweenYmd(params.todayYmd, params.dueYmd);
  if (days == null) return false;
  const window = Math.max(0, params.windowDays ?? 1);
  return days >= 0 && days <= window;
}

export function shouldSuppressProjectProgressReminder(status: string | null | undefined): boolean {
  const s = (status ?? '').trim();
  return (
    s === 'done' ||
    s === 'cancelled' ||
    s === 'shelved' ||
    s === 'completed' ||
    s === 'archived' ||
    s === 'paused'
  );
}

/** 下一次推进提醒：今日默认时刻；已过则明天同时刻 */
export function buildProjectProgressFireAt(params: {
  todayYmd: string;
  now?: Date;
  hour?: number;
  minute?: number;
}): Date | null {
  const parts = parseYmdParts(params.todayYmd);
  if (!parts) return null;
  const now = params.now ?? new Date();
  const hour = params.hour ?? DEFAULT_REMINDER_HOUR;
  const minute = params.minute ?? DEFAULT_REMINDER_MINUTE;
  const todayFire = new Date(parts.y, parts.mo - 1, parts.d, hour, minute, 0, 0);
  if (todayFire.getTime() > now.getTime() + 2000) return todayFire;
  const tomorrow = new Date(parts.y, parts.mo - 1, parts.d + 1, hour, minute, 0, 0);
  if (tomorrow.getTime() > now.getTime() + 2000) return tomorrow;
  return null;
}

export function resolveProjectProgressNudge(params: {
  todayYmd: string;
  lastPlacementYmd: string | null;
  dueYmd: string | null;
  staleDays?: number;
  dueSoonWindowDays?: number;
}): ProjectProgressNudgeKind | null {
  if (
    isProjectDueSoonForProgress({
      todayYmd: params.todayYmd,
      dueYmd: params.dueYmd,
      windowDays: params.dueSoonWindowDays,
    })
  ) {
    return 'due_soon';
  }
  if (
    isProjectStaleWithoutSlot({
      todayYmd: params.todayYmd,
      lastPlacementYmd: params.lastPlacementYmd,
      staleDays: params.staleDays,
    })
  ) {
    return 'stale_no_slot';
  }
  return null;
}
