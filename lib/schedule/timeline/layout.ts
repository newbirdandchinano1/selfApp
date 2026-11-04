/**
 * 阶段 F：时间线布局计算
 * - 全天事件与定时事件分离
 * - 同刻重叠 → 横向多栏（决议 #4）
 * - 高度 ∝ 时长（设最小高度，避免点不到）
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
 * 返回每个事件的 column / columns。同簇事件共享 columns 以保证列宽一致。
 */
export function layoutOverlappingEvents(timed: TimelineEvent[]): TimedEventLayout[] {
  const sorted = [...timed].sort(compareByStart);
  const result: TimedEventLayout[] = [];

  let cluster: { event: TimelineEvent; column: number }[] = [];
  let laneEnds: number[] = [];
  let clusterMaxEnd = -Infinity;

  const flushCluster = () => {
    if (cluster.length === 0) return;
    const columns = laneEnds.length;
    for (const item of cluster) {
      result.push({ event: item.event, column: item.column, columns });
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
