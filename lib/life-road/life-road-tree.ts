/**
 * 道路导图树：把节点行 + 项目挂载组装成可折叠纵览结构。
 * 骨架（4 季 × 12 月）始终存在；无内容节点时为空位。
 */
import {
  currentCalendarMonth,
  currentCalendarYear,
  currentQuarter,
  monthToQuarter,
  QUARTER_MONTHS,
  type LifeRoadNodeKind,
} from '@/lib/life-road/life-road-node-model';
import type { LifeRoadNodeRow } from '@/lib/repositories/life-road/life-road-node.types';

export type RoadProjectRef = {
  id: string;
  name: string;
  status: string;
};

export type RoadMonthSlot = {
  month: number;
  quarter: 1 | 2 | 3 | 4;
  node: LifeRoadNodeRow | null;
  projects: RoadProjectRef[];
  isCurrent: boolean;
};

export type RoadQuarterSlot = {
  quarter: 1 | 2 | 3 | 4;
  node: LifeRoadNodeRow | null;
  months: RoadMonthSlot[];
  isCurrent: boolean;
  /** 该季下是否有任一内容或项目 */
  hasContent: boolean;
};

export type RoadYearBranch = {
  year: number;
  node: LifeRoadNodeRow | null;
  quarters: RoadQuarterSlot[];
  isCurrent: boolean;
};

export type RoadMindMapModel = {
  aboveYear: LifeRoadNodeRow[];
  years: RoadYearBranch[];
  /** 默认展开键 */
  defaultExpandedKeys: string[];
};

function sortNodes(a: LifeRoadNodeRow, b: LifeRoadNodeRow): number {
  if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
  return a.updated_at < b.updated_at ? 1 : -1;
}

export function buildRoadMindMap(
  nodes: LifeRoadNodeRow[],
  projectsByMonthId: Map<string, RoadProjectRef[]>,
  opts?: { now?: Date },
): RoadMindMapModel {
  const now = opts?.now ?? new Date();
  const cy = now.getFullYear();
  const cm = now.getMonth() + 1;
  const cq = monthToQuarter(cm);

  const aboveYear = nodes
    .filter((n) => n.kind === 'multi' || n.kind === 'farther')
    .filter((n) => n.status !== 'dropped')
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'multi' ? -1 : 1;
      return sortNodes(a, b);
    });

  const yearNodes = nodes.filter((n) => n.kind === 'year');
  const quarterNodes = nodes.filter((n) => n.kind === 'quarter');
  const monthNodes = nodes.filter((n) => n.kind === 'month');

  const yearSet = new Set<number>();
  yearSet.add(cy);
  for (const n of yearNodes) {
    if (n.calendar_year != null) yearSet.add(n.calendar_year);
  }
  for (const n of quarterNodes) {
    if (n.calendar_year != null) yearSet.add(n.calendar_year);
  }
  for (const n of monthNodes) {
    if (n.calendar_year != null) yearSet.add(n.calendar_year);
  }

  const years = [...yearSet].sort((a, b) => b - a).map((year) => {
    const yearNode =
      yearNodes.find((n) => n.calendar_year === year && n.status !== 'dropped') ??
      yearNodes.find((n) => n.calendar_year === year) ??
      null;

    const quarters: RoadQuarterSlot[] = ([1, 2, 3, 4] as const).map((q) => {
      const qNode =
        quarterNodes.find(
          (n) => n.calendar_year === year && n.quarter === q && n.status !== 'dropped',
        ) ??
        quarterNodes.find((n) => n.calendar_year === year && n.quarter === q) ??
        null;

      const months: RoadMonthSlot[] = QUARTER_MONTHS[q].map((month) => {
        const mNode =
          monthNodes.find(
            (n) =>
              n.calendar_year === year && n.month === month && n.status !== 'dropped',
          ) ??
          monthNodes.find((n) => n.calendar_year === year && n.month === month) ??
          null;
        const projects = mNode ? projectsByMonthId.get(mNode.id) ?? [] : [];
        return {
          month,
          quarter: q,
          node: mNode,
          projects,
          isCurrent: year === cy && month === cm,
        };
      });

      const hasContent =
        Boolean(qNode?.title?.trim()) ||
        months.some((m) => Boolean(m.node?.title?.trim()) || m.projects.length > 0);

      return {
        quarter: q,
        node: qNode,
        months,
        isCurrent: year === cy && q === cq,
        hasContent,
      };
    });

    return {
      year,
      node: yearNode,
      quarters,
      isCurrent: year === cy,
    };
  });

  const defaultExpandedKeys = [
    'above',
    `year:${cy}`,
    `quarter:${cy}:${cq}`,
    `month:${cy}:${cm}`,
  ];

  return { aboveYear, years, defaultExpandedKeys };
}

export function expandKeyForKind(
  kind: LifeRoadNodeKind | 'above' | 'skeleton-quarter' | 'skeleton-month',
  year?: number,
  quarter?: number,
  month?: number,
): string {
  if (kind === 'above') return 'above';
  if (kind === 'year' && year != null) return `year:${year}`;
  if ((kind === 'quarter' || kind === 'skeleton-quarter') && year != null && quarter != null) {
    return `quarter:${year}:${quarter}`;
  }
  if ((kind === 'month' || kind === 'skeleton-month') && year != null && month != null) {
    return `month:${year}:${month}`;
  }
  return kind;
}

/** 摘要卡：今年焦点优先取当前月标题，其次当前季，再次年目标 */
export function resolveYearFocusLine(model: RoadMindMapModel): string | null {
  const year = model.years.find((y) => y.isCurrent) ?? model.years[0];
  if (!year) return null;
  const cm = currentCalendarMonth();
  const cq = currentQuarter();
  const monthSlot = year.quarters
    .flatMap((q) => q.months)
    .find((m) => m.month === cm);
  const monthTitle = monthSlot?.node?.title?.trim();
  if (monthTitle) return monthTitle;
  const qSlot = year.quarters.find((q) => q.quarter === cq);
  const qTitle = qSlot?.node?.title?.trim();
  if (qTitle) return qTitle;
  const yearTitle = year.node?.title?.trim();
  if (yearTitle) return yearTitle;
  return null;
}

export function resolveSummaryYearLabel(): string {
  return `${currentCalendarYear()} · 焦点`;
}
