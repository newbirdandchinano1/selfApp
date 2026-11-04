/**
 * placement(+axis) → 起止分钟（阶段 C）
 * - 有存库分钟 → stored
 * - 否则由 slot 派生 → derived
 * - orphaned / 无格无分钟 → null
 * 本阶段不回写 DB。
 */
import {
  getSlotCount,
  listWorkSlots,
  placementEndMinutes,
  slotStartMinutes,
  type AxisLike,
} from '@/lib/schedule/axis';
import type { SchedulePlacementRow } from '@/lib/schedule/types';
import type {
  PlacementInterval,
  PlacementLikeForInterval,
} from '@/lib/schedule/timeline/types';

function isOrphaned(placement: PlacementLikeForInterval): boolean {
  if (placement.orphaned === true || placement.orphaned === 1) return true;
  return false;
}

function isAllDayFlag(raw: PlacementLikeForInterval['allDay']): boolean {
  return raw === true || raw === 1;
}

/**
 * 与课表 UI 一致：自首工作格铺满当日可排格 = 全天。
 * `allDayFlag` 为真时直接全天（习惯/待办虚拟块）。
 */
export function isAllDaySpan(
  startSlotIndex: number | null | undefined,
  spanSlots: number,
  daySlotCount: number,
  allDayFlag?: boolean,
): boolean {
  if (allDayFlag) return true;
  if (startSlotIndex == null) return false;
  return startSlotIndex === 0 && Math.max(1, spanSlots) >= Math.max(1, daySlotCount);
}

/** 分钟区间是否覆盖当日全部工作格（半开；用于仅有分钟无 slot 时） */
export function isAllDayByWorkCoverage(
  axis: AxisLike,
  startMinutes: number,
  endMinutes: number,
): boolean {
  const slots = listWorkSlots(axis);
  if (slots.length === 0) return false;
  const first = slots[0]!;
  const last = slots[slots.length - 1]!;
  return startMinutes <= first.startMinutes && endMinutes >= last.endMinutes;
}

function hasValidStoredMinutes(
  placement: PlacementLikeForInterval,
): placement is PlacementLikeForInterval & { startMinutes: number; endMinutes: number } {
  const start = placement.startMinutes;
  const end = placement.endMinutes;
  if (typeof start !== 'number' || !Number.isFinite(start)) return false;
  if (typeof end !== 'number' || !Number.isFinite(end)) return false;
  return end > start;
}

/**
 * 解析占用区间。orphaned 或无法派生时返回 null。
 */
export function resolvePlacementInterval(
  placement: PlacementLikeForInterval,
  axis: AxisLike,
): PlacementInterval | null {
  if (isOrphaned(placement)) return null;

  const daySlots = getSlotCount(axis);
  const flagAllDay = isAllDayFlag(placement.allDay);

  if (hasValidStoredMinutes(placement)) {
    const startMinutes = Math.trunc(placement.startMinutes);
    const endMinutes = Math.trunc(placement.endMinutes);
    const allDay =
      flagAllDay ||
      isAllDaySpan(placement.startSlotIndex, placement.spanSlots, daySlots) ||
      isAllDayByWorkCoverage(axis, startMinutes, endMinutes);
    return { startMinutes, endMinutes, allDay, source: 'stored' };
  }

  if (placement.startSlotIndex == null) return null;

  const startMinutes = slotStartMinutes(axis, placement.startSlotIndex);
  const endMinutes = placementEndMinutes(
    axis,
    placement.startSlotIndex,
    Math.max(1, placement.spanSlots),
  );
  if (!(endMinutes > startMinutes)) return null;

  const allDay =
    flagAllDay ||
    isAllDaySpan(placement.startSlotIndex, placement.spanSlots, daySlots, flagAllDay);

  return { startMinutes, endMinutes, allDay, source: 'derived' };
}

/**
 * 内存填充：缺分钟时写入 derived；有存库分钟则保留。
 * **不**改 orphaned / slot；**不**回写 DB。
 */
export function withResolvedPlacementMinutes(
  placement: SchedulePlacementRow,
  axis: AxisLike,
): SchedulePlacementRow {
  const iv = resolvePlacementInterval(placement, axis);
  if (!iv) return placement;

  const nextStart =
    placement.startMinutes != null &&
    placement.endMinutes != null &&
    placement.endMinutes > placement.startMinutes
      ? placement.startMinutes
      : iv.startMinutes;
  const nextEnd =
    placement.startMinutes != null &&
    placement.endMinutes != null &&
    placement.endMinutes > placement.startMinutes
      ? placement.endMinutes
      : iv.endMinutes;
  const nextAllDay =
    placement.allDay != null ? placement.allDay : iv.allDay ? 1 : 0;

  if (
    nextStart === placement.startMinutes &&
    nextEnd === placement.endMinutes &&
    nextAllDay === placement.allDay
  ) {
    return placement;
  }

  return {
    ...placement,
    startMinutes: nextStart,
    endMinutes: nextEnd,
    allDay: nextAllDay,
  };
}

export function normalizePlacementsMinutesInMemory(
  placements: SchedulePlacementRow[],
  axis: AxisLike,
): SchedulePlacementRow[] {
  if (placements.length === 0) return placements;
  let changed = false;
  const next = placements.map((p) => {
    const n = withResolvedPlacementMinutes(p, axis);
    if (n !== p) changed = true;
    return n;
  });
  return changed ? next : placements;
}
