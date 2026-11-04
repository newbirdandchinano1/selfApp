/**
 * 阶段 D：分钟回填纯逻辑（无 DB / 网络依赖，可供脚本单测）
 */
import {
  axisFromSnapshot,
  type AxisLike,
} from '@/lib/schedule/axis';
import type {
  SchedulePlacementRow,
  ScheduleWeekAxisSnapshot,
} from '@/lib/schedule/types';
import { resolvePlacementInterval } from '@/lib/schedule/timeline/from-placement';

export type BackfillAxisSource = 'snapshot' | 'current';

/** 有快照用快照轴，否则当前轴 */
export function pickAxisForBackfillWeek(
  snapshot: ScheduleWeekAxisSnapshot | null,
  currentAxis: AxisLike,
): { axis: AxisLike; source: BackfillAxisSource } {
  if (snapshot) {
    return { axis: axisFromSnapshot(snapshot), source: 'snapshot' };
  }
  return {
    axis: {
      startMinutes: currentAxis.startMinutes,
      endMinutes: currentAxis.endMinutes,
      slotHours: currentAxis.slotHours,
      breaks: currentAxis.breaks,
    },
    source: 'current',
  };
}

/**
 * 计算单条回填字段；无法派生返回 null（调用方跳过，不改 orphan）。
 */
export function computePlacementMinutesBackfill(
  placement: SchedulePlacementRow,
  axis: AxisLike,
): { startMinutes: number; endMinutes: number; allDay: number } | null {
  if (placement.orphaned) return null;
  if (placement.startSlotIndex == null) return null;
  if (
    placement.startMinutes != null &&
    placement.endMinutes != null &&
    placement.endMinutes > placement.startMinutes
  ) {
    return null;
  }
  const iv = resolvePlacementInterval(placement, axis);
  if (!iv) return null;
  return {
    startMinutes: iv.startMinutes,
    endMinutes: iv.endMinutes,
    allDay: iv.allDay ? 1 : 0,
  };
}
