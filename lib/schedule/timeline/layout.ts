/**
 * 阶段 F：时间线布局计算
 * - 全天事件与定时事件分离
 * - 同刻重叠 → 横向多栏（决议 #4）
 * - 高度 ∝ 时长；宽度随标题长度自适应（非固定栏宽）
 */
import type { TimelineEvent, TimedEventLayout } from '@/lib/schedule/timeline/types';

/** 每墙钟分钟对应像素（时间线纵轴密度） */
export const TIMELINE_MINUTE_PX = 0.85;
/** 单条事件最小高度，保证可点 */
export const TIMELINE_MIN_EVENT_H = 26;

function compareByStart(a: TimelineEvent, b: TimelineEvent): number {
  if (a.startMinutes !== b.startMinutes) return a.startMinutes - b.startMinutes;
  if (a.endMinutes !== b.endMinutes) return b.endMinutes - a.endMinutes;
  return 0;
}

/** 分离全天 / 定时事件 */
export function splitAllDayEvents(events: TimelineEvent[]): {
  allDay: TimelineEvent[];
  timed: TimelineEvent[];
} {
  const allDay: TimelineEvent[] = [];
  const timed: TimelineEvent[] = [];
  for (const e of events) {
    if (e.allDay) allDay.push(e);
    else timed.push(e);
  }
  allDay.sort(compareByStart);
  timed.sort(compareByStart);
  return { allDay, timed };
}

/**
 * 重叠分栏：按「传递重叠簇」分组，簇内贪心装栏。
 * 返回每个事件的 column / columns / clusterId。
 */
export function layoutOverlappingEvents(timed: TimelineEvent[]): TimedEventLayout[] {
  const sorted = [...timed].sort(compareByStart);
  const result: TimedEventLayout[] = [];

  let cluster: { event: TimelineEvent; column: number }[] = [];
  let laneEnds: number[] = [];
  let clusterMaxEnd = -Infinity;
  let nextClusterId = 0;

  const flushCluster = () => {
    if (cluster.length === 0) return;
    const columns = laneEnds.length;
    const clusterId = nextClusterId++;
    for (const item of cluster) {
      result.push({
        event: item.event,
        column: item.column,
        columns,
        clusterId,
      });
    }
    cluster = [];
    laneEnds = [];
    clusterMaxEnd = -Infinity;
  };

  for (const event of sorted) {
    // 与当前簇无重叠（起点 >= 簇内最晚结束）→ 收束上一簇
    if (cluster.length > 0 && event.startMinutes >= clusterMaxEnd) {
      flushCluster();
    }
    // 找最早释放的栏
    let lane = 0;
    for (; lane < laneEnds.length; lane++) {
      if (laneEnds[lane]! <= event.startMinutes) break;
    }
    laneEnds[lane] = event.endMinutes;
    cluster.push({ event, column: lane });
    clusterMaxEnd = Math.max(clusterMaxEnd, event.endMinutes);
  }
  flushCluster();
  return result;
}

/** 事件高度（像素）：按分钟时长线性，设最小高度 */
export function eventHeightPx(
  event: Pick<TimelineEvent, 'startMinutes' | 'endMinutes'>,
  minutePx: number = TIMELINE_MINUTE_PX,
): number {
  const span = Math.max(0, event.endMinutes - event.startMinutes);
  return Math.max(TIMELINE_MIN_EVENT_H, span * minutePx);
}

/** 卡片最小宽度（可点 + 短标题兜底） */
export const TIMELINE_MIN_COLUMN_W = 72;

/** 把定时事件裁进轴范围；完全在轴外返回 null */
export function clampTimedEventToAxis(
  event: Pick<TimelineEvent, 'startMinutes' | 'endMinutes'>,
  axis: { startMinutes: number; endMinutes: number },
): { startMinutes: number; endMinutes: number } | null {
  const start = Math.max(event.startMinutes, axis.startMinutes);
  const end = Math.min(event.endMinutes, axis.endMinutes);
  if (!(end > start)) return null;
  return { startMinutes: start, endMinutes: end };
}

/**
 * 轴内事件的 top/height（像素）。
 * 长跨度事件裁进轴后高度不会溢出 body，避免撑破/盖住整条时间线。
 */
export function eventFrameInAxis(
  event: Pick<TimelineEvent, 'startMinutes' | 'endMinutes'>,
  axis: { startMinutes: number; endMinutes: number },
  minutePx: number = TIMELINE_MINUTE_PX,
): { top: number; height: number; startMinutes: number; endMinutes: number } | null {
  const clipped = clampTimedEventToAxis(event, axis);
  if (!clipped) return null;
  const bodyH = Math.max(0, axis.endMinutes - axis.startMinutes) * minutePx;
  const top = Math.max(0, (clipped.startMinutes - axis.startMinutes) * minutePx);
  const maxH = Math.max(0, bodyH - top);
  if (maxH < 1) return null;
  const rawH = eventHeightPx(clipped, minutePx);
  const height = Math.min(rawH, maxH);
  return { top, height, startMinutes: clipped.startMinutes, endMinutes: clipped.endMinutes };
}

/**
 * 按标题长度估算卡片内容宽（中文按全角、ASCII 半角）。
 * 宽度随文案伸缩，夹在 [minW, maxW]。
 */
export function preferredEventCardWidth(
  event: Pick<TimelineEvent, 'title' | 'icon' | 'done'>,
  opts?: { minW?: number; maxW?: number },
): number {
  const minW = opts?.minW ?? TIMELINE_MIN_COLUMN_W;
  const maxW = opts?.maxW ?? 320;
  const title = event.title ?? '';
  let textW = 0;
  for (let i = 0; i < title.length; i++) {
    const code = title.charCodeAt(i);
    // 粗体 ~12px：CJK≈12、拉丁≈7
    textW += code > 0xff ? 12 : 7;
  }
  const extras =
    16 /* 左色条+内边距 */ + (event.icon ? 18 : 0) + (event.done ? 16 : 0);
  return Math.round(Math.min(maxW, Math.max(minW, extras + textW)));
}

export type CardHorizFrame = {
  left: number;
  width: number;
};

/**
 * 同簇内：每张卡宽随标题自适应；列占位取该列卡片最大宽，避免横叠。
 * 返回每张卡的 left/width，以及整日内容总宽。
 */
export function layoutCardsHorizontally(
  items: {
    event: Pick<TimelineEvent, 'id' | 'title' | 'icon' | 'done'>;
    column: number;
    columns: number;
    clusterId: number;
  }[],
  opts?: { gap?: number; minW?: number; maxW?: number },
): { frames: Map<string, CardHorizFrame>; contentWidth: number } {
  const gap = opts?.gap ?? 4;
  const minW = opts?.minW ?? TIMELINE_MIN_COLUMN_W;
  const maxW = opts?.maxW ?? 320;
  const frames = new Map<string, CardHorizFrame>();

  const byCluster = new Map<number, typeof items>();
  for (const item of items) {
    const list = byCluster.get(item.clusterId);
    if (list) list.push(item);
    else byCluster.set(item.clusterId, [item]);
  }

  let contentWidth = 0;
  for (const clusterItems of byCluster.values()) {
    const cols = Math.max(1, ...clusterItems.map((x) => x.columns), 1);
    const colMaxW = Array.from({ length: cols }, () => minW);
    const cardW = new Map<string, number>();
    for (const item of clusterItems) {
      const w = preferredEventCardWidth(item.event, { minW, maxW });
      cardW.set(item.event.id, w);
      const col = Math.max(0, Math.min(cols - 1, item.column));
      colMaxW[col] = Math.max(colMaxW[col]!, w);
    }
    const colLeft: number[] = [];
    let x = 0;
    for (let c = 0; c < cols; c++) {
      colLeft[c] = x;
      x += colMaxW[c]! + (c < cols - 1 ? gap : 0);
    }
    contentWidth = Math.max(contentWidth, x);
    for (const item of clusterItems) {
      const col = Math.max(0, Math.min(cols - 1, item.column));
      frames.set(item.event.id, {
        left: colLeft[col]!,
        width: cardW.get(item.event.id) ?? minW,
      });
    }
  }

  return { frames, contentWidth };
}

/**
 * @deprecated 保留给旧测试/调用；新 UI 用 layoutCardsHorizontally 按标题自适应。
 * 多栏时均分或保底列宽。
 */
export function columnWidthForCluster(
  areaWidth: number,
  columns: number,
  opts?: { gap?: number; minColW?: number },
): { colW: number; contentWidth: number; scrollable: boolean } {
  const cols = Math.max(1, Math.round(columns));
  const gap = opts?.gap ?? 4;
  const minColW = opts?.minColW ?? TIMELINE_MIN_COLUMN_W;
  const safeArea = Math.max(0, areaWidth);
  if (cols <= 1) {
    return { colW: safeArea, contentWidth: safeArea, scrollable: false };
  }
  const natural = (safeArea - gap * (cols - 1)) / cols;
  if (Number.isFinite(natural) && natural >= minColW) {
    return { colW: natural, contentWidth: safeArea, scrollable: false };
  }
  const colW = Math.max(1, minColW);
  const contentWidth = cols * colW + gap * (cols - 1);
  return { colW, contentWidth, scrollable: contentWidth > safeArea + 0.5 };
}

/** 时间线主体总高度（像素） */
export function timelineBodyHeightPx(axis: {
  startMinutes: number;
  endMinutes: number;
}, minutePx: number = TIMELINE_MINUTE_PX): number {
  return Math.max(0, axis.endMinutes - axis.startMinutes) * minutePx;
}

/** 友好时长文案：如 1 小时 15 分 / 45 分钟 / 全天 */
export function formatEventDuration(startMinutes: number, endMinutes: number): string {
  const span = Math.max(0, Math.round(endMinutes - startMinutes));
  if (span <= 0) return '';
  const h = Math.floor(span / 60);
  const m = span % 60;
  if (h > 0 && m > 0) return `${h} 小时 ${m} 分`;
  if (h > 0) return `${h} 小时`;
  return `${m} 分钟`;
}
