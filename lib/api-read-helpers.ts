/** 客户端排序 / 过滤辅助（替代无法直接映射的 SQL） */

import { parseStoredDatetime } from '@/lib/api-mysql-datetime';

export { isYmdInRange, addDaysToYmd } from '@/lib/date';
export { ymdFromDatetime, ymdFromAuditDatetime } from '@/lib/api-mysql-datetime';

export function compareDatetimeDesc(a: string | null | undefined, b: string | null | undefined): number {
  const ta = a ? parseStoredDatetime(a).getTime() : 0;
  const tb = b ? parseStoredDatetime(b).getTime() : 0;
  return (Number.isNaN(tb) ? 0 : tb) - (Number.isNaN(ta) ? 0 : ta);
}

export function sortByUpdatedDesc<T extends { updated_at?: string | null; created_at?: string | null }>(
  rows: T[],
): T[] {
  return [...rows].sort((a, b) => {
    const u = compareDatetimeDesc(a.updated_at, b.updated_at);
    if (u !== 0) return u;
    return compareDatetimeDesc(a.created_at, b.created_at);
  });
}

export function sortBySortOrderAsc<T extends { sort_order?: number | null; name?: string | null; created_at?: string | null }>(
  rows: T[],
): T[] {
  return [...rows].sort((a, b) => {
    const sa = a.sort_order ?? 1_000_000;
    const sb = b.sort_order ?? 1_000_000;
    if (sa !== sb) return sa - sb;
    const na = (a.name ?? '').localeCompare(b.name ?? '', 'zh-CN');
    if (na !== 0) return na;
    return compareDatetimeDesc(a.created_at, b.created_at) * -1;
  });
}

export function isBlank(value: unknown): boolean {
  return value == null || (typeof value === 'string' && value.trim() === '');
}

export function sortByNameAsc<T extends { name?: string | null }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '', 'zh-CN', { sensitivity: 'base' }));
}

export function matchesOverviewScope(row: { project_id?: string | null; parent_task_id?: string | null }): boolean {
  return isBlank(row.project_id) && isBlank(row.parent_task_id);
}
