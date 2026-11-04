/**
 * 小习惯今日进度 · 纯规则（可单测）。
 * 口径对齐任务页：养成看当日目标；戒除看是否已确认；周期配额看周期达成（轻量）。
 */

export type HabitsTodayKind = 'build' | 'break' | 'task';

export type HabitsTodayItem = {
  id: string;
  name: string;
  kind: HabitsTodayKind;
  /** 今日是否已处理完（养成达标 / 戒除已确认 / 配额周期已达成） */
  done: boolean;
};

export type HabitsTodayGlance = {
  status: 'empty' | 'progress' | 'cleared';
  doneCount: number;
  totalCount: number;
  /** 未完成，按名称排序后截断前的完整列表 */
  pending: HabitsTodayItem[];
  listLimit: number;
};

export type HabitsTodayWidgetProps = {
  progressLine: string;
  statusLine: string;
  doneLabel: string;
  item1: string;
  item2: string;
  item3: string;
  moreLine: string;
  pendingVisible: number;
  hasItems: number;
  allDone: number;
  deepLink: string;
};

export function buildHabitsTodayGlance(input: {
  items: HabitsTodayItem[];
  listLimit?: 2 | 3;
}): HabitsTodayGlance {
  const listLimit = input.listLimit === 2 ? 2 : 3;
  const items = [...input.items];
  const totalCount = items.length;
  if (totalCount === 0) {
    return { status: 'empty', doneCount: 0, totalCount: 0, pending: [], listLimit };
  }
  const doneCount = items.filter((i) => i.done).length;
  const pending = items
    .filter((i) => !i.done)
    .sort((a, b) => a.name.localeCompare(b.name, 'zh'));
  if (pending.length === 0) {
    return { status: 'cleared', doneCount, totalCount, pending: [], listLimit };
  }
  return { status: 'progress', doneCount, totalCount, pending, listLimit };
}

export function habitsTodayGlanceToWidgetProps(
  glance: HabitsTodayGlance,
  opts?: { deepLink?: string; clearedLabel?: string },
): HabitsTodayWidgetProps {
  const deepLink = opts?.deepLink ?? 'zheng://tasks';
  const clearedLabel = (opts?.clearedLabel ?? '今日习惯已收齐').slice(0, 24);

  if (glance.status === 'empty') {
    return {
      progressLine: '0/0',
      statusLine: '暂无今日习惯',
      doneLabel: '',
      item1: '',
      item2: '',
      item3: '',
      moreLine: '',
      pendingVisible: 0,
      hasItems: 0,
      allDone: 0,
      deepLink,
    };
  }

  if (glance.status === 'cleared') {
    return {
      progressLine: `${glance.doneCount}/${glance.totalCount}`,
      statusLine: clearedLabel,
      doneLabel: clearedLabel,
      item1: '',
      item2: '',
      item3: '',
      moreLine: '',
      pendingVisible: 0,
      hasItems: 1,
      allDone: 1,
      deepLink,
    };
  }

  const remain = glance.pending.length;
  const shown = glance.pending.slice(0, glance.listLimit);
  const more = Math.max(0, remain - shown.length);
  const lines = shown.map((i) => {
    const tag = i.kind === 'break' ? '戒除' : i.kind === 'task' ? '配额' : '养成';
    return `${tag} · ${i.name}`.slice(0, 28);
  });

  return {
    progressLine: `${glance.doneCount}/${glance.totalCount}`,
    statusLine: `还差 ${remain} 项`,
    doneLabel: '',
    item1: lines[0] ?? '',
    item2: lines[1] ?? '',
    item3: lines[2] ?? '',
    moreLine: more > 0 ? `另有 ${more} 项` : '',
    pendingVisible: lines.length,
    hasItems: 1,
    allDone: 0,
    deepLink,
  };
}
