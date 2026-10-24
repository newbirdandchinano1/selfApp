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

/** 自然日午夜 24:00，以分钟表示 */
export const SCHEDULE_DAY_END_MAX_MINUTES = 24 * 60;

/**
 * 日程轴允许的最大终点上限：次日 23:00 = 1440 + 23*60。
 * 实际可选终点由日界决定，见 scheduleEndMinutesFromDayBoundary。
 */
export const SCHEDULE_LOGICAL_END_MAX_MINUTES = SCHEDULE_DAY_END_MAX_MINUTES + 23 * 60;

/** 日界整点（向下对齐到小时）→ 分钟 */
export function scheduleDayStartMinutesFromDayBoundary(boundary: {
  hour: number;
  minute: number;
}): number {
  return snapToHourMinutes(boundary.hour * 60 + boundary.minute, { allow24: false });
}

/**
 * 日界 → 日程轴「日结束」可选上限（从属于日界，可跨午夜）：
 * - 日界 0:00 → 24:00（1440）
 * - 日界 H:00 → 次日 H:00（1440 + H*60）
 * 日开始仍可独立选择，不必 ≥ 日界。
 */
export function scheduleEndMinutesFromDayBoundary(boundary: {
  hour: number;
  minute: number;
}): number {
  const boundaryMins = scheduleDayStartMinutesFromDayBoundary(boundary);
  return boundaryMins === 0
    ? SCHEDULE_DAY_END_MAX_MINUTES
    : SCHEDULE_DAY_END_MAX_MINUTES + boundaryMins;
}

/**
 * 仅规范化轴设置；不把日界写回起点。
 * 若传入 boundary，会把终点钳到日界上限（不抬高起点）。
 */
export function applyDayBoundaryToAxis(
  axis: {
    startMinutes: number;
    endMinutes?: number;
    slotHours: ScheduleSlotHours;
    breaks?: unknown;
  },
  boundary?: { hour: number; minute: number },
): Omit<ScheduleAxisSettings, 'updatedAt'> {
  const normalized = normalizeAxisSettings({
    startMinutes: axis.startMinutes,
    endMinutes: axis.endMinutes,
    slotHours: axis.slotHours,
    breaks: axis.breaks,
  });
  if (!boundary) return normalized;
  const maxEnd = scheduleEndMinutesFromDayBoundary(boundary);
  if (normalized.endMinutes <= maxEnd) return normalized;
  return normalizeAxisSettings({
    ...normalized,
    endMinutes: maxEnd,
  });
}

/** 对齐到整点（向下）；allow24=午夜 1440；allowOvernight=逻辑日跨午夜终点 */
export function snapToHourMinutes(
  minutes: number,
  opts?: { allow24?: boolean; allowOvernight?: boolean },
): number {
  if (!Number.isFinite(minutes)) return 0;
  const max = opts?.allowOvernight
    ? SCHEDULE_LOGICAL_END_MAX_MINUTES
    : opts?.allow24
      ? SCHEDULE_DAY_END_MAX_MINUTES
      : 23 * 60;
  const clamped = Math.min(max, Math.max(0, Math.round(minutes)));
  if (
    !opts?.allowOvernight &&
    opts?.allow24 &&
    clamped >= SCHEDULE_DAY_END_MAX_MINUTES
  ) {
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
  const overnight = dayEndMinutes > SCHEDULE_DAY_END_MAX_MINUTES;
  const dayStart = snapToHourMinutes(dayStartMinutes, {
    allow24: false,
    allowOvernight: overnight,
  });
  const dayEnd = snapToHourMinutes(dayEndMinutes, {
    allow24: true,
    allowOvernight: overnight,
  });
  const parsed: ScheduleBreak[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;
    const start = snapToHourMinutes(Number(o.startMinutes), {
      allow24: false,
      allowOvernight: overnight,
    });
    const end = snapToHourMinutes(Number(o.endMinutes), {
      allow24: true,
      allowOvernight: overnight,
    });
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
  const endMinutes = snapToHourMinutes(endRaw, {
    allow24: true,
    allowOvernight: endRaw > SCHEDULE_DAY_END_MAX_MINUTES,
  });
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

/** 结束必须严格晚于开始；断开后至少剩 1 个可排格。终点可越过午夜（与日界无关）。 */
export function validateAxisRange(axis: {
  startMinutes: number;
  endMinutes: number;
  slotHours: ScheduleSlotHours;
  breaks?: ScheduleBreak[];
}): string | null {
  if (axis.endMinutes <= axis.startMinutes) {
    return '日结束时间必须晚于日开始时间。';
  }
  if (axis.endMinutes > SCHEDULE_LOGICAL_END_MAX_MINUTES) {
    return '日结束时间超出逻辑日范围。';
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

/** 轴分钟 → 展示用小时（跨午夜后用 0–23；恰为午夜终点显示 24） */
function axisHourLabel(minutes: number, asEnd: boolean): number {
  const rounded = Math.round(minutes);
  if (asEnd && rounded > 0 && rounded % SCHEDULE_DAY_END_MAX_MINUTES === 0) {
    return 24;
  }
  return Math.floor(rounded / 60) % 24;
}

export function formatMinutesAsHm(minutes: number): string {
  const rounded = Math.round(minutes);
  if (rounded === SCHEDULE_DAY_END_MAX_MINUTES) return '24:00';
  if (rounded > SCHEDULE_DAY_END_MAX_MINUTES && rounded % SCHEDULE_DAY_END_MAX_MINUTES === 0) {
    return '24:00';
  }
  const m =
    ((rounded % SCHEDULE_DAY_END_MAX_MINUTES) + SCHEDULE_DAY_END_MAX_MINUTES) %
    SCHEDULE_DAY_END_MAX_MINUTES;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/** 轴分钟展示：跨午夜标「次日」（设置页日结束用）。 */
export function formatScheduleAxisTimeLabel(minutes: number): string {
  const rounded = Math.round(minutes);
  if (rounded > SCHEDULE_DAY_END_MAX_MINUTES) {
    return `次日 ${formatMinutesAsHm(rounded)}`;
  }
  return formatMinutesAsHm(rounded);
}

/** 左侧时间轴：时段区间，如 7-8、10-12、0-2（无前导零） */
export function formatSlotRangeLabel(startMinutes: number, endOrSlotHours: number): string {
  // 兼容：第二个参数既可是结束分钟，也可是格宽小时（< 24 视为小时）
  const start = Math.max(0, Math.round(startMinutes));
  const end =
    endOrSlotHours > 0 && endOrSlotHours < 24
      ? start + Math.max(1, endOrSlotHours) * 60
      : Math.round(endOrSlotHours);
  return `${axisHourLabel(start, false)}-${axisHourLabel(end, true)}`;
}

export function formatMinuteRangeLabel(startMinutes: number, endMinutes: number): string {
  const start = Math.max(0, Math.round(startMinutes));
  const end = Math.max(start, Math.round(endMinutes));
  return `${axisHourLabel(start, false)}-${axisHourLabel(end, true)}`;
}

/**
 * 墙上时钟 → 逻辑日轴分钟（可 >1440）。
 * 仅当 wallNow 落在 logicalYmd 对应逻辑日内时有值。
 */
export function wallClockToAxisMinutes(
  wallNow: Date,
  logicalYmd: string,
  boundary: { hour: number; minute: number },
  getLogicalYmd: (now: Date, boundary: { hour: number; minute: number }) => string,
  formatWallYmd: (now: Date) => string,
): number | null {
  if (getLogicalYmd(wallNow, boundary) !== logicalYmd) return null;
  const wallMins =
    wallNow.getHours() * 60 + wallNow.getMinutes() + wallNow.getSeconds() / 60;
  const wallYmd = formatWallYmd(wallNow);
  if (wallYmd === logicalYmd) return wallMins;
  return wallMins + SCHEDULE_DAY_END_MAX_MINUTES;
}

/** 墙钟时分 → 轴分钟候选（同日 / 跨午夜次日晨），取落在轴内者 */
export function clockHmToAxisMinutes(
  axis: AxisLike,
  hour: number,
  minute: number,
): number | null {
  const h = Math.max(0, Math.min(23, Math.round(hour)));
  const m = Math.max(0, Math.min(59, Math.round(minute)));
  const wall = h * 60 + m;
  const candidates = [wall];
  if (axis.endMinutes > SCHEDULE_DAY_END_MAX_MINUTES) {
    candidates.push(wall + SCHEDULE_DAY_END_MAX_MINUTES);
  }
  for (const mins of candidates) {
    if (mins >= axis.startMinutes && mins < axis.endMinutes) return mins;
  }
  return null;
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
 * - 开始时刻落入断开时段 → orphaned。
 * - 跨断开的多格占用按工作格索引保留（跳过断开行）。
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

    // 开始时刻落在断开内 → 无法入格
    if (newBreaks.some((b) => startMins >= b.startMinutes && startMins < b.endMinutes)) {
      results.push({ placementId: p.id, nextStartSlotIndex: null, orphaned: true });
      continue;
    }

    const newIndex = findWorkSlotIndexForStart(newSlots, startMins);
    if (newIndex == null) {
      results.push({ placementId: p.id, nextStartSlotIndex: null, orphaned: true });
      continue;
    }

    const snapped = newSlots[newIndex]!;
    // 按工作格索引扩展到盖住原结束；中间可跳过断开（断开本身不是可排格）
    let newSpan = 1;
    let coverEnd = snapped.endMinutes;
    while (coverEnd < endMins && newIndex + newSpan < newSlots.length) {
      const next = newSlots[newIndex + newSpan]!;
      newSpan += 1;
      coverEnd = next.endMinutes;
    }
    newSpan = Math.min(newSpan, newSlots.length - newIndex);

    results.push({
      placementId: p.id,
      nextStartSlotIndex: newIndex,
      nextSpanSlots: Math.max(1, newSpan),
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

/**
 * 从起点起剩余可排格数（按工作格索引连续）。
 * 断开时段不是可排格，不截断可选格数；跨断开的多格占用跳过断开行。
 */
export function maxSpanFromSlot(axis: AxisLike, startSlotIndex: number): number {
  const slots = listWorkSlots(axis);
  if (startSlotIndex < 0 || startSlotIndex >= slots.length) return 0;
  return slots.length - startSlotIndex;
}

/** 格高基准：2h 参考格宽对应单格高度 */
export const SCHEDULE_REF_SLOT_HOURS = 2;
/**
 * 对齐设计稿 `.tt` 可视区：`repeat(N, 26px)` —— 外框高度按此锁定，不随内容撑高。
 */
export const SCHEDULE_VIEWPORT_SLOT_H = 26;
/**
 * 内容行高（2h 参考格）：约设计稿 CSS 的 2×，保证真机标题/副文可读；
 * 总高超出 `fixedBodyH` 时在表体内纵向滚动。
 */
export const SCHEDULE_BASE_SLOT_H = 52;
/** 截断短行仍可点选的下限 */
export const SCHEDULE_MIN_ROW_H = 14;

export type ScheduleSlotLayout = {
  /** 可排工作格数量 */
  slotCount: number;
  timeline: ScheduleTimelineRow[];
  /** 与 timeline 平行的行高（按时长比例；截断格更矮） */
  rowHeights: number[];
  /**
   * 设计稿对齐的固定可视高度（同起止、2h 格宽铺满时的 `.tt` 表体）。
   * UI 外框始终用此高度；内容更高时内滚。
   */
  fixedBodyH: number;
  /** 内容总高度（按时长 × 内容行高累加，通常长于 fixedBodyH） */
  totalBodyH: number;
  /** 内容超出可视高度时需纵向滚动 */
  scrollable: boolean;
  /** 每墙钟小时对应像素（截断/断开均按此换算） */
  hourPx: number;
};

/**
 * 行高 = 时段时长 × (baseSlotH / 2h)；截断格（如 12–13）自然变矮。
 * 可视区高度按设计稿 `VIEWPORT_SLOT_H` 锁定，内容超出则 scrollable。
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
  /** 外框对齐设计稿，与内容行高解耦 */
  const fixedBodyH = refCount * SCHEDULE_VIEWPORT_SLOT_H;
  const hourPx = baseSlotH / SCHEDULE_REF_SLOT_HOURS;

  if (timeline.length === 0 || totalHours <= 0) {
    return {
      slotCount: 0,
      timeline: [],
      rowHeights: [],
      fixedBodyH,
      totalBodyH: fixedBodyH,
      scrollable: false,
      hourPx,
    };
  }

  const rowHeights = timeline.map((r) => {
    const hours = (r.endMinutes - r.startMinutes) / 60;
    return Math.max(SCHEDULE_MIN_ROW_H, hours * hourPx);
  });
  const totalBodyH = rowHeights.reduce((a, b) => a + b, 0);
  const scrollable = totalBodyH > fixedBodyH + 1;
  return { slotCount, timeline, rowHeights, fixedBodyH, totalBodyH, scrollable, hourPx };
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

