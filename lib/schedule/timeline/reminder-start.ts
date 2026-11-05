/**
 * 阶段 I：日程提醒 / 周边触发点 — 分钟优先解析（纯逻辑，无 RN / 无 app_settings）
 */
import type { AxisLike } from '@/lib/schedule/axis';
import { resolvePlacementInterval } from '@/lib/schedule/timeline/from-placement';
import type { SchedulePlacementRow } from '@/lib/schedule/types';

/** 周一 YMD + weekday(1–7) → 指派日 YMD（纯字符串，不碰日界设置） */
export function assignYmdForPlacement(weekStartYmd: string, weekday: number): string {
  const w = Math.min(7, Math.max(1, Math.round(weekday)));
  const parts = weekStartYmd.split('-').map((x) => Number(x));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return weekStartYmd;
  const [y, mo, d] = parts as [number, number, number];
  const base = new Date(y, mo - 1, d, 12, 0, 0, 0);
  base.setDate(base.getDate() + (w - 1));
  const yy = base.getFullYear();
  const mm = String(base.getMonth() + 1).padStart(2, '0');
  const dd = String(base.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/** 逻辑日 YMD + 轴分钟（可 >1440 跨午夜）→ 本地 Date */
export function axisMinutesToLocalDate(assignYmd: string, startMinutes: number): Date {
  const parts = assignYmd.split('-').map((x) => Number(x));
  const y = parts[0] ?? 1970;
  const mo = parts[1] ?? 1;
  const d = parts[2] ?? 1;
  const startMins = Math.trunc(startMinutes);
  const h = Math.floor(startMins / 60);
  const m = ((startMins % 60) + 60) % 60;
  return new Date(y, mo - 1, d, h, m, 0, 0);
}

/**
 * 占用开始时刻（分钟优先；无存库分钟则 slot 派生）。
 * orphaned / 无法解析 → null。
 */
export function resolvePlacementReminderStart(
  placement: SchedulePlacementRow,
  axis: AxisLike,
): { startMinutes: number; startAt: Date; assignYmd: string } | null {
  const iv = resolvePlacementInterval(placement, axis);
  if (!iv) return null;
  const assignYmd = assignYmdForPlacement(placement.weekStartYmd, placement.weekday);
  return {
    startMinutes: iv.startMinutes,
    startAt: axisMinutesToLocalDate(assignYmd, iv.startMinutes),
    assignYmd,
  };
}
