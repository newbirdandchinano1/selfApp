import {
  DEFAULT_SCHEDULE_AXIS,
  type ScheduleAxisSettings,
  type SchedulePlacementRow,
  type ScheduleSlotHours,
  type ScheduleWeekAxisSnapshot,
} from '@/lib/schedule/types';

export function clampSlotHours(raw: unknown): ScheduleSlotHours {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (n === 1 || n === 2 || n === 3 || n === 4) return n;
  return DEFAULT_SCHEDULE_AXIS.slotHours;
}

/** 一天内最大结束时刻：24:00（午夜），以分钟表示 */
export const SCHEDULE_DAY_END_MAX_MINUTES = 24 * 60;

/** 对齐到整点（向下）；24:00 保持为 1440 */
export function snapToHourMinutes(minutes: number, opts?: { allow24?: boolean }): number {
  if (!Number.isFinite(minutes)) return 0;
  const max = opts?.allow24 ? SCHEDULE_DAY_END_MAX_MINUTES : 23 * 60;
  const clamped = Math.min(max, Math.max(0, Math.round(minutes)));
  if (opts?.allow24 && clamped >= SCHEDULE_DAY_END_MAX_MINUTES) {
    return SCHEDULE_DAY_END_MAX_MINUTES;
  }
  return Math.floor(clamped / 60) * 60;
}

export function normalizeAxisSettings(
  raw: {
    startMinutes?: number;
    endMinutes?: number;
    slotHours?: number;
  } | null | undefined,
): Omit<ScheduleAxisSettings, 'updatedAt'> {
  const startRaw =
    typeof raw?.startMinutes === 'number' && Number.isFinite(raw.startMinutes)
      ? raw.startMinutes
      : DEFAULT_SCHEDULE_AXIS.startMinutes;
  const endRaw =
    typeof raw?.endMinutes === 'number' && Number.isFinite(raw.endMinutes)
      ? raw.endMinutes
      : DEFAULT_SCHEDULE_AXIS.endMinutes;
  return {
    startMinutes: snapToHourMinutes(startRaw, { allow24: false }),
    endMinutes: snapToHourMinutes(endRaw, { allow24: true }),
    slotHours: clampSlotHours(raw?.slotHours),
  };
}

/** 不允许跨日：结束必须严格晚于开始 */
export function validateAxisRange(axis: {
  startMinutes: number;
  endMinutes: number;
  slotHours: ScheduleSlotHours;
}): string | null {
  if (axis.endMinutes <= axis.startMinutes) {
    return '日结束时间必须晚于日开始时间（不允许跨日）。';
  }
  const slotMins = axis.slotHours * 60;
  if (axis.endMinutes - axis.startMinutes < slotMins) {
    return `日时间范围至少需要容纳 1 个 ${axis.slotHours} 小时格子。`;
  }
  return null;
}

export function getSlotCount(axis: {
  startMinutes: number;
  endMinutes: number;
  slotHours: number;
}): number {
  const slotMins = axis.slotHours * 60;
  if (slotMins <= 0) return 0;
  return Math.floor((axis.endMinutes - axis.startMinutes) / slotMins);
}

export function slotStartMinutes(
  axis: { startMinutes: number; slotHours: number },
  slotIndex: number,
): number {
  return axis.startMinutes + slotIndex * axis.slotHours * 60;
}

export function placementEndMinutes(
  axis: { startMinutes: number; slotHours: number },
  startSlotIndex: number,
  spanSlots: number,
): number {
  return slotStartMinutes(axis, startSlotIndex) + spanSlots * axis.slotHours * 60;
}

export function formatMinutesAsHm(minutes: number): string {
  const rounded = Math.round(minutes);
  if (rounded >= SCHEDULE_DAY_END_MAX_MINUTES) return '24:00';
  const m = ((rounded % (24 * 60)) + 24 * 60) % (24 * 60);
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export function parseHmToMinutes(hm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h < 0 || h > 23 || min < 0 || min > 59) {
    return null;
  }
  return h * 60 + min;
}

export type AxisConflict = {
  placementId: string;
  subjectKind: string;
  subjectId: string;
  reason: string;
};

/** 改日开始/结束时：用旧轴算出占用绝对时间，再对照新起止校验是否会被裁掉 */
export function findAxisRangeConflicts(
  oldAxis: { startMinutes: number; endMinutes: number; slotHours: number },
  newAxis: { startMinutes: number; endMinutes: number },
  placements: SchedulePlacementRow[],
): AxisConflict[] {
  const conflicts: AxisConflict[] = [];
  for (const p of placements) {
    if (p.orphaned || p.startSlotIndex == null) continue;
    const start = slotStartMinutes(oldAxis, p.startSlotIndex);
    const end = placementEndMinutes(oldAxis, p.startSlotIndex, p.spanSlots);
    if (start < newAxis.startMinutes || end > newAxis.endMinutes) {
      conflicts.push({
        placementId: p.id,
        subjectKind: p.subjectKind,
        subjectId: p.subjectId,
        reason: `占用 ${formatMinutesAsHm(start)}–${formatMinutesAsHm(end)} 超出新轴 ${formatMinutesAsHm(newAxis.startMinutes)}–${formatMinutesAsHm(newAxis.endMinutes)}`,
      });
    }
  }
  return conflicts;
}

export type RemapResult = {
  placementId: string;
  nextStartSlotIndex: number | null;
  orphaned: boolean;
};

/** 改格宽：按开始时间重映射；无法落入新轴 → orphaned */
export function remapPlacementsForSlotHours(
  oldAxis: { startMinutes: number; endMinutes: number; slotHours: number },
  newAxis: { startMinutes: number; endMinutes: number; slotHours: number },
  placements: SchedulePlacementRow[],
): RemapResult[] {
  const newSlotCount = getSlotCount(newAxis);
  const results: RemapResult[] = [];
  for (const p of placements) {
    if (p.orphaned || p.startSlotIndex == null) {
      results.push({ placementId: p.id, nextStartSlotIndex: null, orphaned: true });
      continue;
    }
    const startMins = slotStartMinutes(oldAxis, p.startSlotIndex);
    const span = Math.max(1, p.spanSlots);
    const endMins = startMins + span * oldAxis.slotHours * 60;
    const newSlotMins = newAxis.slotHours * 60;
    const rel = startMins - newAxis.startMinutes;
    if (rel < 0 || startMins >= newAxis.endMinutes) {
      results.push({ placementId: p.id, nextStartSlotIndex: null, orphaned: true });
      continue;
    }
    if (rel % newSlotMins !== 0) {
      // 开始时间无法对齐新格边界 → 未入格
      results.push({ placementId: p.id, nextStartSlotIndex: null, orphaned: true });
      continue;
    }
    const newIndex = rel / newSlotMins;
    if (newIndex < 0 || newIndex >= newSlotCount || !Number.isInteger(newIndex)) {
      results.push({ placementId: p.id, nextStartSlotIndex: null, orphaned: true });
      continue;
    }
    const newEnd = placementEndMinutes(newAxis, newIndex, span);
    if (newEnd > newAxis.endMinutes || newIndex + span > newSlotCount) {
      results.push({ placementId: p.id, nextStartSlotIndex: null, orphaned: true });
      continue;
    }
    results.push({ placementId: p.id, nextStartSlotIndex: newIndex, orphaned: false });
  }
  return results;
}

export function axisFromSnapshot(
  snap: ScheduleWeekAxisSnapshot,
): Omit<ScheduleAxisSettings, 'updatedAt'> {
  return {
    startMinutes: snap.startMinutes,
    endMinutes: snap.endMinutes,
    slotHours: snap.slotHours,
  };
}

export function maxSpanFromSlot(
  axis: { startMinutes: number; endMinutes: number; slotHours: number },
  startSlotIndex: number,
): number {
  const count = getSlotCount(axis);
  return Math.max(0, count - startSlotIndex);
}

/** 格高基准：按 2h 格宽铺满时的单格高度；可视区高度不随格宽变 */
export const SCHEDULE_REF_SLOT_HOURS = 2;
export const SCHEDULE_BASE_SLOT_H = 52;

export type ScheduleSlotLayout = {
  slotCount: number;
  /** 单格像素高度 */
  slotH: number;
  /** 格子区域固定可视高度（按 2h 参考轴） */
  fixedBodyH: number;
  /** 格宽 < 2h 时内容超出，需纵向滚动 */
  scrollable: boolean;
};

/**
 * 表体高度固定为「同起止、2h 格宽」时的高度。
 * 1h：格高保持基准，区域可上下滚动；≥2h：格高放大以填满固定高度。
 */
export function computeScheduleSlotLayout(
  axis: { startMinutes: number; endMinutes: number; slotHours: number },
  baseSlotH: number = SCHEDULE_BASE_SLOT_H,
): ScheduleSlotLayout {
  const refCount = Math.max(
    1,
    getSlotCount({
      startMinutes: axis.startMinutes,
      endMinutes: axis.endMinutes,
      slotHours: SCHEDULE_REF_SLOT_HOURS,
    }),
  );
  const fixedBodyH = refCount * baseSlotH;
  const slotCount = getSlotCount(axis);
  if (slotCount <= 0) {
    return { slotCount: 0, slotH: baseSlotH, fixedBodyH, scrollable: false };
  }
  if (axis.slotHours < SCHEDULE_REF_SLOT_HOURS) {
    return { slotCount, slotH: baseSlotH, fixedBodyH, scrollable: true };
  }
  return {
    slotCount,
    slotH: fixedBodyH / slotCount,
    fixedBodyH,
    scrollable: false,
  };
}
