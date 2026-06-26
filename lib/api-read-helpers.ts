/** 客户端排序 / 过滤辅助（替代无法直接映射的 SQL） */

import { parseStoredDatetime } from '@/lib/api-mysql-datetime';

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

export function ymdFromDatetime(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  const d = parseStoredDatetime(value);
  if (Number.isNaN(d.getTime())) {
    const m = value.trim().match(/^(\d{4}-\d{2}-\d{2})/);
    return m?.[1] ?? null;
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** @deprecated 请对 completed_at / updated_at 使用 ymdFromAuditDatetime */
export { ymdFromAuditDatetime } from '@/lib/api-mysql-datetime';

export function isYmdInRange(ymd: string, startYmd: string, endYmd: string): boolean {
  return ymd >= startYmd && ymd <= endYmd;
}

export function addDaysToYmd(ymd: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return ymd;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  d.setDate(d.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function sortByNameAsc<T extends { name?: string | null }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '', 'zh-CN', { sensitivity: 'base' }));
}

export function matchesOverviewScope(row: { project_id?: string | null; parent_task_id?: string | null }): boolean {
  return isBlank(row.project_id) && isBlank(row.parent_task_id);
}
