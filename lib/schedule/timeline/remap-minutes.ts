/**
 * 阶段 H：改轴 remap 分钟优先
 * - 有存库分钟 → 绝对时间保留
 * - 无分钟 → 旧轴 derived 后再 remap
 * - 新轴外 / 与 break 相交 / 无法双写 slot → orphaned
 * - 轴内 → 保留（或全天重算）分钟 + deriveSlotSpan 双写
 */
import {
  breakIntersectingInterval,
  deriveSlotSpanForMinutes,
  formatMinutesAsHm,
  workCoverageMinutes,
  type AxisLike,
} from '@/lib/schedule/axis';
import { resolvePlacementInterval } from '@/lib/schedule/timeline/from-placement';
import type { SchedulePlacementRow } from '@/lib/schedule/types';
import type { PlacementLikeForInterval } from '@/lib/schedule/timeline/types';

export type RemapMinutesResult = {
  placementId: string;
  /** 成功入轴时的绝对起止；orphaned 时为 null（由调用方决定是否清空列） */
  startMinutes: number | null;
  endMinutes: number | null;
  allDay: number | null;
  nextStartSlotIndex: number | null;
  nextSpanSlots?: number;
  orphaned: boolean;
  /** 便于日志：旧区间 → 新区间 */
  reason?: string;
};

function isOrphanedFlag(p: PlacementLikeForInterval): boolean {
  return p.orphaned === true || p.orphaned === 1;
}

/**
 * 区间是否完全落在新轴半开范围内 `[start, end)` 意义下的可排：
 * start >= axis.start && end <= axis.end（与阶段 G 写入校验一致）。
 */
export function intervalFitsAxisRange(
  axis: { startMinutes: number; endMinutes: number },
  startMinutes: number,
  endMinutes: number,
): boolean {
  return startMinutes >= axis.startMinutes && endMinutes <= axis.endMinutes;
}

/**
 * 按旧轴解析绝对分钟，再映射到新轴并双写 slot。
 * 已 orphaned 的行保持 orphaned（不尝试自动救回）。
 */
export function remapPlacementsForMinutes(
  oldAxis: AxisLike,
  newAxis: AxisLike,
  placements: SchedulePlacementRow[],
): RemapMinutesResult[] {
  const results: RemapMinutesResult[] = [];

  for (const p of placements) {
    if (isOrphanedFlag(p)) {
      results.push({
        placementId: p.id,
        startMinutes: null,
        endMinutes: null,
        allDay: null,
        nextStartSlotIndex: null,
        orphaned: true,
        reason: 'already_orphaned',
      });
      continue;
    }

    const iv = resolvePlacementInterval(p, oldAxis);
    if (!iv) {
      results.push({
        placementId: p.id,
        startMinutes: null,
        endMinutes: null,
        allDay: null,
        nextStartSlotIndex: null,
        orphaned: true,
        reason: 'unresolvable',
      });
      continue;
    }

    let startMinutes = iv.startMinutes;
    let endMinutes = iv.endMinutes;
    let allDay = iv.allDay ? 1 : 0;

    // 全天：随新轴工作覆盖重算绝对区间，避免缩轴后仍占旧全日
    if (iv.allDay) {
      const cov = workCoverageMinutes(newAxis);
      if (!cov) {
        results.push({
          placementId: p.id,
          startMinutes: null,
          endMinutes: null,
          allDay: null,
          nextStartSlotIndex: null,
          orphaned: true,
          reason: 'all_day_no_work_slots',
        });
        continue;
      }
      startMinutes = cov.startMinutes;
      endMinutes = cov.endMinutes;
      allDay = 1;
    }

    if (!intervalFitsAxisRange(newAxis, startMinutes, endMinutes)) {
      results.push({
        placementId: p.id,
        startMinutes: null,
        endMinutes: null,
        allDay: null,
        nextStartSlotIndex: null,
        orphaned: true,
        reason: `out_of_range ${formatMinutesAsHm(startMinutes)}–${formatMinutesAsHm(endMinutes)}`,
      });
      continue;
    }

    // 与写入一致：禁止与任一 break 相交/跨越
    const hitBreak = breakIntersectingInterval(newAxis, startMinutes, endMinutes);
    if (hitBreak) {
      results.push({
        placementId: p.id,
        startMinutes: null,
        endMinutes: null,
        allDay: null,
        nextStartSlotIndex: null,
        orphaned: true,
        reason: `break:${hitBreak.label || '断开'}`,
      });
      continue;
    }

    const cover = deriveSlotSpanForMinutes(newAxis, startMinutes, endMinutes);
    if (!cover) {
      results.push({
        placementId: p.id,
        startMinutes: null,
        endMinutes: null,
        allDay: null,
        nextStartSlotIndex: null,
        orphaned: true,
        reason: 'no_slot_cover',
      });
      continue;
    }

    results.push({
      placementId: p.id,
      startMinutes,
      endMinutes,
      allDay,
      nextStartSlotIndex: cover.startSlotIndex,
      nextSpanSlots: cover.spanSlots,
      orphaned: false,
      reason: iv.source === 'derived' ? 'derived_then_remap' : 'stored_minutes',
    });
  }

  return results;
}
