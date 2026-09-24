import {
  DEFAULT_SCHEDULE_AXIS,
  SCHEDULE_BREAK_LABEL_MAX_LEN,
  SCHEDULE_BREAKS_MAX,
  type ScheduleAxisSettings,
  type ScheduleBreak,
  type SchedulePlacementRow,
  type ScheduleSlotHours,
  type ScheduleWeekAxisSnapshot,
} from '@/lib/schedule/types';

export type AxisLike = {
  startMinutes: number;
  endMinutes: number;
  slotHours: number;
  breaks?: ScheduleBreak[];
};

export type ScheduleWorkSlot = {
  slotIndex: number;
  startMinutes: number;
  endMinutes: number;
};

export type ScheduleTimelineRow =
  | ({ kind: 'work' } & ScheduleWorkSlot)
  | { kind: 'break'; startMinutes: number; endMinutes: number; label: string };

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

export function normalizeBreakLabel(raw: unknown): string {
  if (typeof raw !== 'string') return '休息';
  const t = raw.replace(/\s+/g, '').slice(0, SCHEDULE_BREAK_LABEL_MAX_LEN);
  return t || '休息';
}

/** 规范断开时段：整点、落在日内、合并重叠、按开始排序 */
export function normalizeBreaks(
  raw: unknown,
  dayStartMinutes: number,
  dayEndMinutes: number,
): ScheduleBreak[] {
  if (!Array.isArray(raw)) return [];
  const dayStart = snapToHourMinutes(dayStartMinutes, { allow24: false });
  const dayEnd = snapToHourMinutes(dayEndMinutes, { allow24: true });
  const parsed: ScheduleBreak[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;
    const start = snapToHourMinutes(Number(o.startMinutes), { allow24: false });
    const end = snapToHourMinutes(Number(o.endMinutes), { allow24: true });
    if (!(end > start)) continue;
    const clippedStart = Math.max(start, dayStart);
    const clippedEnd = Math.min(end, dayEnd);
    if (!(clippedEnd > clippedStart)) continue;
    parsed.push({
      startMinutes: clippedStart,
      endMinutes: clippedEnd,
      label: normalizeBreakLabel(o.label),
    });
  }
  parsed.sort((a, b) => a.startMinutes - b.startMinutes || a.endMinutes - b.endMinutes);
  const merged: ScheduleBreak[] = [];
  for (const b of parsed) {
    const last = merged[merged.length - 1];
    if (last && b.startMinutes <= last.endMinutes) {
      last.endMinutes = Math.max(last.endMinutes, b.endMinutes);
      if (!last.label && b.label) last.label = b.label;
    } else {
      merged.push({ ...b });
    }
  }
  return merged.slice(0, SCHEDULE_BREAKS_MAX);
}

export function normalizeAxisSettings(
  raw: {
    startMinutes?: number;
    endMinutes?: number;
    slotHours?: number;
    breaks?: unknown;
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
  const startMinutes = snapToHourMinutes(startRaw, { allow24: false });
  const endMinutes = snapToHourMinutes(endRaw, { allow24: true });
  return {
    startMinutes,
    endMinutes,
    slotHours: clampSlotHours(raw?.slotHours),
    breaks: normalizeBreaks(raw?.breaks, startMinutes, endMinutes),
  };
}

export function breaksEqual(a: ScheduleBreak[] | undefined, b: ScheduleBreak[] | undefined): boolean {
  const aa = a ?? [];
  const bb = b ?? [];
  if (aa.length !== bb.length) return false;
  for (let i = 0; i < aa.length; i++) {
    const x = aa[i]!;
    const y = bb[i]!;
    if (
      x.startMinutes !== y.startMinutes ||
      x.endMinutes !== y.endMinutes ||
      x.label !== y.label
    ) {
      return false;
    }
  }
  return true;
}

/** 不允许跨日：结束必须严格晚于开始；断开后至少剩 1 个可排格 */
export function validateAxisRange(axis: {
  startMinutes: number;
  endMinutes: number;
  slotHours: ScheduleSlotHours;
  breaks?: ScheduleBreak[];
}): string | null {
  if (axis.endMinutes <= axis.startMinutes) {
    return '日结束时间必须晚于日开始时间（不允许跨日）。';
  }
  const slotMins = axis.slotHours * 60;
  if (axis.endMinutes - axis.startMinutes < slotMins) {
    return `日时间范围至少需要容纳 1 个 ${axis.slotHours} 小时格子。`;
  }
  const work = listWorkSlots(axis);
  if (work.length === 0) {
    return '断开时段过多，请至少保留一个可排时段。';
  }
  return null;
}

/**
 * 按格宽铺满可排时段；遇到断开则截断当前格并插入断开行。
 * 例：格宽 2h、午休 12–14 → …10–12、[午休 12–14]、14–16…
 * 例：格宽 2h、断开 13–14 → …10–12、12–13（截断）、[13–14]、14–16…
 */
export function buildScheduleTimeline(axis: AxisLike): ScheduleTimelineRow[] {
  const breaks = normalizeBreaks(axis.breaks, axis.startMinutes, axis.endMinutes);
  const slotMins = Math.max(60, Math.round(axis.slotHours) * 60);
  const rows: ScheduleTimelineRow[] = [];
  let cursor = axis.startMinutes;
  let workIndex = 0;

  while (cursor < axis.endMinutes) {
    const covering = breaks.find((b) => cursor >= b.startMinutes && cursor < b.endMinutes);
    if (covering) {
      rows.push({
        kind: 'break',
        startMinutes: Math.max(cursor, covering.startMinutes),
        endMinutes: covering.endMinutes,
        label: covering.label,
      });
      cursor = covering.endMinutes;
      continue;
    }
    const nextBreak = breaks.find((b) => b.startMinutes > cursor);
    const limit = nextBreak ? nextBreak.startMinutes : axis.endMinutes;
    const end = Math.min(cursor + slotMins, limit, axis.endMinutes);
    if (end <= cursor) break;
    rows.push({
      kind: 'work',
      slotIndex: workIndex,
      startMinutes: cursor,
      endMinutes: end,
    });
    workIndex += 1;
    cursor = end;
  }
  return rows;
}

export function listWorkSlots(axis: AxisLike): ScheduleWorkSlot[] {
  return buildScheduleTimeline(axis).filter((r): r is { kind: 'work' } & ScheduleWorkSlot => r.kind === 'work');
}

export function getSlotCount(axis: AxisLike): number {
  return listWorkSlots(axis).length;
}

export function slotStartMinutes(axis: AxisLike, slotIndex: number): number {
  const slot = listWorkSlots(axis)[slotIndex];
  return slot?.startMinutes ?? axis.startMinutes + slotIndex * axis.slotHours * 60;
}

export function slotEndMinutes(axis: AxisLike, slotIndex: number): number {
  const slot = listWorkSlots(axis)[slotIndex];
  if (slot) return slot.endMinutes;
  return slotStartMinutes(axis, slotIndex) + axis.slotHours * 60;
}

export function placementEndMinutes(
  axis: AxisLike,
  startSlotIndex: number,
  spanSlots: number,
): number {
  const slots = listWorkSlots(axis);
  const span = Math.max(1, spanSlots);
  const endSlot = slots[startSlotIndex + span - 1];
  if (endSlot) return endSlot.endMinutes;
  return slotStartMinutes(axis, startSlotIndex) + span * axis.slotHours * 60;
}

export function formatMinutesAsHm(minutes: number): string {
  const rounded = Math.round(minutes);
  if (rounded >= SCHEDULE_DAY_END_MAX_MINUTES) return '24:00';
  const m = ((rounded % (24 * 60)) + 24 * 60) % (24 * 60);
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/** 左侧时间轴：时段区间，如 7-8、10-12（无前导零） */
export function formatSlotRangeLabel(startMinutes: number, endOrSlotHours: number): string {
  // 兼容：第二个参数既可是结束分钟，也可是格宽小时（< 24 视为小时）
  const start = Math.max(0, Math.round(startMinutes));
  const end =
    endOrSlotHours > 0 && endOrSlotHours < 24
      ? start + Math.max(1, endOrSlotHours) * 60
      : Math.round(endOrSlotHours);
  const startH = Math.floor(start / 60);
  const endH = end >= SCHEDULE_DAY_END_MAX_MINUTES ? 24 : Math.floor(end / 60);
  return `${startH}-${endH}`;
}

export function formatMinuteRangeLabel(startMinutes: number, endMinutes: number): string {
  const start = Math.max(0, Math.round(startMinutes));
  const end = Math.max(start, Math.round(endMinutes));
  const startH = Math.floor(start / 60);
  const endH = end >= SCHEDULE_DAY_END_MAX_MINUTES ? 24 : Math.floor(end / 60);
  return `${startH}-${endH}`;
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

function rangesOverlap(a0: number, a1: number, b0: number, b1: number): boolean {
  return a0 < b1 && b0 < a1;
}

/** 改日开始/结束时：用旧轴算出占用绝对时间，再对照新起止校验是否会被裁掉 */
export function findAxisRangeConflicts(
  oldAxis: AxisLike,
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
  /** 按绝对时长换算后的新跨格数；orphaned 时省略 */
  nextSpanSlots?: number;
  orphaned: boolean;
};

function findWorkSlotIndexForStart(slots: ScheduleWorkSlot[], startMins: number): number | null {
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i]!;
    if (startMins >= s.startMinutes && startMins < s.endMinutes) return i;
  }
  // 并入：落在两格之间时取前一格（变宽 floor）
  let floor: number | null = null;
  for (let i = 0; i < slots.length; i++) {
    if (slots[i]!.startMinutes <= startMins) floor = i;
  }
  return floor;
}

/**
 * 改格宽 / 断开：按绝对时间重映射并保留占用时长。
 * - 变宽：开始并入所在大格；变窄：按时长拆格。
 * - 落入断开时段 → orphaned。
 */
export function remapPlacementsForSlotHours(
  oldAxis: AxisLike,
  newAxis: AxisLike,
  placements: SchedulePlacementRow[],
): RemapResult[] {
  const oldSlots = listWorkSlots(oldAxis);
  const newSlots = listWorkSlots(newAxis);
  const newBreaks = normalizeBreaks(newAxis.breaks, newAxis.startMinutes, newAxis.endMinutes);
  const results: RemapResult[] = [];

  for (const p of placements) {
    if (p.orphaned || p.startSlotIndex == null) {
      results.push({ placementId: p.id, nextStartSlotIndex: null, orphaned: true });
      continue;
    }
    if (newSlots.length === 0) {
      results.push({ placementId: p.id, nextStartSlotIndex: null, orphaned: true });
      continue;
    }

    const oldSpan = Math.max(1, p.spanSlots);
    const oldStartSlot = oldSlots[p.startSlotIndex];
    const startMins = oldStartSlot
      ? oldStartSlot.startMinutes
      : slotStartMinutes(oldAxis, p.startSlotIndex);
    const endMins = oldStartSlot
      ? placementEndMinutes(oldAxis, p.startSlotIndex, oldSpan)
      : startMins + oldSpan * oldAxis.slotHours * 60;

    if (newBreaks.some((b) => rangesOverlap(startMins, endMins, b.startMinutes, b.endMinutes))) {
      // 与断开重叠：尝试截到断开前；若开始已在断开内则 orphan
      const hit = newBreaks.find((b) => rangesOverlap(startMins, endMins, b.startMinutes, b.endMinutes));
      if (hit && startMins >= hit.startMinutes && startMins < hit.endMinutes) {
        results.push({ placementId: p.id, nextStartSlotIndex: null, orphaned: true });
        continue;
      }
    }

    const newIndex = findWorkSlotIndexForStart(newSlots, startMins);
    if (newIndex == null) {
      results.push({ placementId: p.id, nextStartSlotIndex: null, orphaned: true });
      continue;
    }

    const snapped = newSlots[newIndex]!;
    // 目标覆盖到原结束；跨断开时只保留断开前连续格
    let newSpan = 1;
    let coverEnd = snapped.endMinutes;
    for (let i = newIndex + 1; i < newSlots.length; i++) {
      if (coverEnd >= endMins) break;
      const next = newSlots[i]!;
      if (next.startMinutes !== coverEnd) break; // 中间有断开，不可跨
      if (newBreaks.some((b) => rangesOverlap(snapped.startMinutes, next.endMinutes, b.startMinutes, b.endMinutes))) {
        break;
      }
      newSpan += 1;
      coverEnd = next.endMinutes;
    }
    // 若单格已够（变宽并入）且原时长不超过该格，span=1
    if (snapped.endMinutes >= endMins) {
      newSpan = 1;
    } else {
      // 继续扩展直到盖住 endMins 或碰到断开
      newSpan = 1;
      coverEnd = snapped.endMinutes;
      while (coverEnd < endMins && newIndex + newSpan < newSlots.length) {
        const next = newSlots[newIndex + newSpan]!;
        if (next.startMinutes !== coverEnd) break;
        newSpan += 1;
        coverEnd = next.endMinutes;
      }
    }

    if (newSpan < 1) {
      results.push({ placementId: p.id, nextStartSlotIndex: null, orphaned: true });
      continue;
    }

    const finalEnd = placementEndMinutes(newAxis, newIndex, newSpan);
    if (
      newBreaks.some((b) =>
        rangesOverlap(snapped.startMinutes, finalEnd, b.startMinutes, b.endMinutes),
      )
    ) {
      results.push({ placementId: p.id, nextStartSlotIndex: null, orphaned: true });
      continue;
    }

    results.push({
      placementId: p.id,
      nextStartSlotIndex: newIndex,
      nextSpanSlots: newSpan,
      orphaned: false,
    });
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
    breaks: normalizeBreaks(snap.breaks, snap.startMinutes, snap.endMinutes),
  };
}

/** 从起点起连续可排格数（遇断开即停，不可跨断开跨格） */
export function maxSpanFromSlot(axis: AxisLike, startSlotIndex: number): number {
  const slots = listWorkSlots(axis);
  if (startSlotIndex < 0 || startSlotIndex >= slots.length) return 0;
  let n = 1;
  let end = slots[startSlotIndex]!.endMinutes;
  for (let i = startSlotIndex + 1; i < slots.length; i++) {
    const next = slots[i]!;
    if (next.startMinutes !== end) break;
    n += 1;
    end = next.endMinutes;
  }
  return n;
}

/** 格高基准：按 2h 格宽铺满时的单格高度；可视区高度不随格宽变 */
export const SCHEDULE_REF_SLOT_HOURS = 2;
export const SCHEDULE_BASE_SLOT_H = 52;

export type ScheduleSlotLayout = {
  /** 可排工作格数量 */
  slotCount: number;
  timeline: ScheduleTimelineRow[];
  /** 与 timeline 平行的行高 */
  rowHeights: number[];
  /** 格子区域固定可视高度（按 2h 参考轴、全日墙钟） */
  fixedBodyH: number;
  /** 内容总高度 */
  totalBodyH: number;
  /** 格宽 < 2h 时内容超出，需纵向滚动 */
  scrollable: boolean;
};

/**
 * 表体高度固定为「同起止、2h 格宽」时的高度（按墙钟跨度）。
 * 行高按时长比例分配；断开行同样占位。
 */
export function computeScheduleSlotLayout(
  axis: AxisLike,
  baseSlotH: number = SCHEDULE_BASE_SLOT_H,
): ScheduleSlotLayout {
  const timeline = buildScheduleTimeline(axis);
  const slotCount = timeline.filter((r) => r.kind === 'work').length;
  const totalHours = timeline.reduce(
    (sum, r) => sum + (r.endMinutes - r.startMinutes) / 60,
    0,
  );
  const refCount = Math.max(
    1,
    Math.floor((axis.endMinutes - axis.startMinutes) / (SCHEDULE_REF_SLOT_HOURS * 60)),
  );
  const fixedBodyH = refCount * baseSlotH;

  if (timeline.length === 0 || totalHours <= 0) {
    return {
      slotCount: 0,
      timeline: [],
      rowHeights: [],
      fixedBodyH,
      totalBodyH: fixedBodyH,
      scrollable: false,
    };
  }

  let hourPx: number;
  let scrollable: boolean;
  if (axis.slotHours < SCHEDULE_REF_SLOT_HOURS) {
    hourPx = baseSlotH;
    scrollable = true;
  } else {
    hourPx = fixedBodyH / totalHours;
    scrollable = false;
  }

  const rowHeights = timeline.map((r) => ((r.endMinutes - r.startMinutes) / 60) * hourPx);
  const totalBodyH = rowHeights.reduce((a, b) => a + b, 0);
  return { slotCount, timeline, rowHeights, fixedBodyH, totalBodyH, scrollable };
}

/** 占用色块高度：跨连续工作格时累加对应行高 */
export function placementBlockHeight(
  axis: AxisLike,
  layout: ScheduleSlotLayout,
  startSlotIndex: number,
  spanSlots: number,
): number {
  const span = Math.max(1, spanSlots);
  let h = 0;
  for (let i = 0; i < layout.timeline.length; i++) {
    const row = layout.timeline[i]!;
    if (row.kind !== 'work') continue;
    if (row.slotIndex >= startSlotIndex && row.slotIndex < startSlotIndex + span) {
      h += layout.rowHeights[i] ?? 0;
    }
  }
  return Math.max(0, h);
}

