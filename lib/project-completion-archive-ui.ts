import type {
  ProjectCompletionLogRow,
  ProjectCompletionLogSource,
} from '@/lib/repositories/projects/project-completion-logs';

export type ArchiveFilterKey = 'all' | 'month' | 'archive' | 'compress' | 'manual_delete';

export type MonthSection = {
  key: string;
  label: string;
  year: number;
  month: number;
  items: ProjectCompletionLogRow[];
  count: number;
  points: number;
};

const WEEKDAY_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const;

export function sourceLabel(source: string): string {
  if (source === 'compress') return '到期压缩';
  if (source === 'manual_delete') return '手动删除细节';
  return '归档';
}

export function sourceShortLabel(source: string): string {
  if (source === 'compress') return '到期压缩';
  if (source === 'manual_delete') return '手动删除';
  return '归档';
}

export function sourceTone(
  source: string,
): 'archive' | 'compressed' | 'deleted' {
  if (source === 'compress') return 'compressed';
  if (source === 'manual_delete') return 'deleted';
  return 'archive';
}

export function monthKeyFromYmd(ymd: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(ymd.trim());
  if (!m) return 'unknown';
  return `${m[1]}-${m[2]}`;
}

export function monthLabelFromKey(key: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  if (!m) return '更早';
  return `${Number(m[1])}年${Number(m[2])}月`;
}

export function localYmd(d = new Date()): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${day}`;
}

export function localMonthKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function formatCompletedDayMeta(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return ymd;
  return `${Number(m[2])}月${Number(m[3])}日`;
}

export function formatDetailDateLine(ymd: string, completedAt: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return ymd;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const wd = Number.isNaN(d.getTime()) ? '' : WEEKDAY_CN[d.getDay()];
  let timePart = '';
  if (completedAt) {
    const raw = completedAt.includes('T') ? completedAt : completedAt.replace(' ', 'T');
    const t = new Date(raw);
    if (!Number.isNaN(t.getTime())) {
      const hh = String(t.getHours()).padStart(2, '0');
      const mm = String(t.getMinutes()).padStart(2, '0');
      timePart = ` · ${hh}:${mm} 归档`;
    }
  }
  return `${Number(m[1])}年${Number(m[2])}月${Number(m[3])}日${wd ? ` · ${wd}` : ''}${timePart}`;
}

export function formatDetailSubtitleYmd(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return ymd;
  return `${m[1]}.${m[2]}.${m[3]}`;
}

export function filterLogs(
  items: ProjectCompletionLogRow[],
  filter: ArchiveFilterKey,
  monthKey: string,
): ProjectCompletionLogRow[] {
  switch (filter) {
    case 'month':
      return items.filter((r) => monthKeyFromYmd(r.completed_ymd) === monthKey);
    case 'archive':
      return items.filter((r) => r.source === 'archive' || !r.source);
    case 'compress':
      return items.filter((r) => r.source === 'compress');
    case 'manual_delete':
      return items.filter((r) => r.source === 'manual_delete');
    default:
      return items;
  }
}

export function groupLogsByMonth(items: ProjectCompletionLogRow[]): MonthSection[] {
  const map = new Map<string, ProjectCompletionLogRow[]>();
  for (const row of items) {
    const key = monthKeyFromYmd(row.completed_ymd);
    const list = map.get(key) ?? [];
    list.push(row);
    map.set(key, list);
  }
  return [...map.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([key, rows]) => {
      const ym = /^(\d{4})-(\d{2})$/.exec(key);
      return {
        key,
        label: monthLabelFromKey(key),
        year: ym ? Number(ym[1]) : 0,
        month: ym ? Number(ym[2]) : 0,
        items: rows,
        count: rows.length,
        points: rows.reduce((s, r) => s + (Number(r.points_delta) || 0), 0),
      };
    });
}

export type ArchiveSummaryStats = {
  total: number;
  yearCount: number;
  year: number;
  monthCount: number;
  monthPoints: number;
  monthTasks: number;
  streakMonths: number;
  /** 近 12 个月完成数，旧→新 */
  spark: number[];
  counts: Record<ArchiveFilterKey, number>;
};

export function buildArchiveSummary(
  items: ProjectCompletionLogRow[],
  now = new Date(),
): ArchiveSummaryStats {
  const year = now.getFullYear();
  const monthKey = localMonthKey(now);
  const yearPrefix = `${year}-`;

  let yearCount = 0;
  let monthCount = 0;
  let monthPoints = 0;
  let monthTasks = 0;
  let archive = 0;
  let compress = 0;
  let manual = 0;

  const monthBuckets = new Map<string, number>();
  for (const row of items) {
    if (row.completed_ymd.startsWith(yearPrefix)) yearCount += 1;
    if (monthKeyFromYmd(row.completed_ymd) === monthKey) {
      monthCount += 1;
      monthPoints += Number(row.points_delta) || 0;
      monthTasks += Math.max(0, Number(row.done_task_count) || 0);
    }
    const src = (row.source || 'archive') as ProjectCompletionLogSource | string;
    if (src === 'compress') compress += 1;
    else if (src === 'manual_delete') manual += 1;
    else archive += 1;

    const mk = monthKeyFromYmd(row.completed_ymd);
    if (mk !== 'unknown') monthBuckets.set(mk, (monthBuckets.get(mk) ?? 0) + 1);
  }

  const spark: number[] = [];
  for (let i = 11; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    spark.push(monthBuckets.get(key) ?? 0);
  }

  let streakMonths = 0;
  for (let i = 0; i < 36; i += 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if ((monthBuckets.get(key) ?? 0) > 0) streakMonths += 1;
    else break;
  }

  return {
    total: items.length,
    yearCount,
    year,
    monthCount,
    monthPoints,
    monthTasks,
    streakMonths,
    spark,
    counts: {
      all: items.length,
      month: monthCount,
      archive,
      compress,
      manual_delete: manual,
    },
  };
}

export type SourceFlowNode = {
  icon: 'explore' | 'extension' | 'inventory' | 'delete-outline' | 'archive' | 'inventory-2';
  title: string;
  subtitle: string;
  tag?: string;
  tagTone?: 'green' | 'gray' | 'amber' | 'clay';
  trailing?: string;
};

export function buildSourceFlow(row: ProjectCompletionLogRow): {
  badge: string;
  badgeTone: 'amber' | 'green' | 'clay';
  nodes: SourceFlowNode[];
  endNote: string;
} {
  const name = row.name.trim() || '未命名项目';
  const day = formatCompletedDayMeta(row.completed_ymd);
  const tasks =
    row.task_count > 0
      ? `${row.done_task_count} / ${row.task_count} 任务`
      : '无任务明细';
  const codeTail = row.id.replace(/^pcl_/, '').slice(-2).toUpperCase() || '00';

  if (row.source === 'compress') {
    return {
      badge: '到期压缩',
      badgeTone: 'amber',
      nodes: [
        {
          icon: 'extension',
          title: `项目「${name}」`,
          subtitle: `${tasks} · ${day} 结束`,
          tag: '已归档',
          tagTone: 'gray',
        },
        {
          icon: 'inventory',
          title: '压缩为完成履历',
          subtitle: '保留结果与备注，不再占道路名额',
          trailing: `ARC-…${codeTail}`,
        },
      ],
      endNote: '到期压缩：项目结束后保留结果，不保留可编辑状态。任务明细只读。',
    };
  }

  if (row.source === 'manual_delete') {
    return {
      badge: '手动删除',
      badgeTone: 'clay',
      nodes: [
        {
          icon: 'extension',
          title: `项目「${name}」`,
          subtitle: day,
          tag: '已删除细节',
          tagTone: 'clay',
        },
        {
          icon: 'delete-outline',
          title: '手动删除细节',
          subtitle: '任务与正文不可恢复，履历仍保留',
          trailing: `ARC-…${codeTail}`,
        },
      ],
      endNote: '手动删除细节：完整记录已清除，完成履历作为只读快照保留。',
    };
  }

  return {
    badge: '项目归档',
    badgeTone: 'green',
    nodes: [
      {
        icon: 'extension',
        title: `项目「${name}」`,
        subtitle: `${tasks} · ${day}`,
        tag: '已完成',
        tagTone: 'green',
      },
      {
        icon: 'archive',
        title: '写入完成履历',
        subtitle: '保留结果与备注，只读归档',
        trailing: `ARC-…${codeTail}`,
      },
    ],
    endNote: '项目归档：完成后写入履历快照。如需重做，请从原项目新建一次。',
  };
}
