/**
 * 待办 / 截止紧急度 · 纯规则（可单测）。
 * 口径：
 * - 逾期：未完成待办截止日 < 今日
 * - 今日截止：未完成待办截止日 = 今日
 * - 临期项目：活跃项目截止日落在 [今日, 今日+窗口]（对齐自动临期窗口 1/2/3 天）
 */

export type UrgencyDueSoonWindowDays = 1 | 2 | 3;

export type UrgencyCandidate = {
  id: string;
  title: string;
  /** overdue | due_today | due_soon_project */
  kind: 'overdue' | 'due_today' | 'due_soon_project';
  dueYmd: string;
  priority: number;
};

export type UrgencyGlanceInput = {
  overdue: UrgencyCandidate[];
  dueToday: UrgencyCandidate[];
  dueSoonProjects: UrgencyCandidate[];
  showOverdue: boolean;
  showDueToday: boolean;
  showDueSoonProjects: boolean;
  showTopTitle: boolean;
  emptyLabel?: string;
};

export type UrgencyGlance = {
  overdueCount: number;
  dueTodayCount: number;
  dueSoonProjectCount: number;
  topTitle: string;
  topKind: UrgencyCandidate['kind'] | '';
  showOverdue: boolean;
  showDueToday: boolean;
  showDueSoonProjects: boolean;
  showTopTitle: boolean;
  emptyLabel: string;
  isCalm: boolean;
};

export type UrgencyWidgetProps = {
  title: string;
  countsLine: string;
  lockCountsLine: string;
  topTitle: string;
  statusLine: string;
  overdueCount: number;
  dueTodayCount: number;
  dueSoonCount: number;
  showOverdue: number;
  showDueToday: number;
  showDueSoon: number;
  showTopTitle: number;
  isCalm: number;
  deepLink: string;
};

export function clampUrgencyDueSoonWindowDays(raw: unknown): UrgencyDueSoonWindowDays {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (n === 2) return 2;
  if (n === 3) return 3;
  return 1;
}

/** 最高优先级：逾期优先 → 今日截止 → 临期项目；同档按截止日升序、优先级降序 */
export function pickTopUrgencyCandidate(
  overdue: UrgencyCandidate[],
  dueToday: UrgencyCandidate[],
  dueSoonProjects: UrgencyCandidate[],
): UrgencyCandidate | null {
  const rank = (a: UrgencyCandidate, b: UrgencyCandidate) =>
    a.dueYmd.localeCompare(b.dueYmd) || b.priority - a.priority || a.title.localeCompare(b.title, 'zh');

  if (overdue.length > 0) {
    return [...overdue].sort(rank)[0]!;
  }
  if (dueToday.length > 0) {
    return [...dueToday].sort(rank)[0]!;
  }
  if (dueSoonProjects.length > 0) {
    return [...dueSoonProjects].sort(rank)[0]!;
  }
  return null;
}

export function buildUrgencyGlance(input: UrgencyGlanceInput): UrgencyGlance {
  const overdue = input.showOverdue ? input.overdue : [];
  const dueToday = input.showDueToday ? input.dueToday : [];
  const dueSoonProjects = input.showDueSoonProjects ? input.dueSoonProjects : [];
  const emptyLabel = (input.emptyLabel || '').trim() || '暂无紧急项';
  const top = input.showTopTitle
    ? pickTopUrgencyCandidate(overdue, dueToday, dueSoonProjects)
    : null;
  const overdueCount = overdue.length;
  const dueTodayCount = dueToday.length;
  const dueSoonProjectCount = dueSoonProjects.length;
  const isCalm = overdueCount + dueTodayCount + dueSoonProjectCount === 0;

  return {
    overdueCount,
    dueTodayCount,
    dueSoonProjectCount,
    topTitle: top ? top.title.trim().slice(0, 20) : '',
    topKind: top?.kind ?? '',
    showOverdue: input.showOverdue,
    showDueToday: input.showDueToday,
    showDueSoonProjects: input.showDueSoonProjects,
    showTopTitle: input.showTopTitle,
    emptyLabel,
    isCalm,
  };
}

function buildCountsLine(glance: UrgencyGlance, compact: boolean): string {
  if (glance.isCalm) return glance.emptyLabel;
  const parts: string[] = [];
  if (glance.showOverdue) {
    parts.push(compact ? `逾${glance.overdueCount}` : `逾期 ${glance.overdueCount}`);
  }
  if (glance.showDueToday) {
    parts.push(compact ? `今${glance.dueTodayCount}` : `今日 ${glance.dueTodayCount}`);
  }
  if (glance.showDueSoonProjects) {
    parts.push(compact ? `临${glance.dueSoonProjectCount}` : `临期 ${glance.dueSoonProjectCount}`);
  }
  return parts.join(compact ? ' · ' : '  ');
}

function topKindLabel(kind: UrgencyCandidate['kind'] | ''): string {
  if (kind === 'overdue') return '最近逾期';
  if (kind === 'due_today') return '今日截止';
  if (kind === 'due_soon_project') return '临期项目';
  return '';
}

export function urgencyGlanceToWidgetProps(
  glance: UrgencyGlance,
  opts?: { deepLink?: string },
): UrgencyWidgetProps {
  const deepLink = opts?.deepLink ?? 'zheng://tasks';
  const countsLine = buildCountsLine(glance, false);
  const lockCountsLine = glance.isCalm
    ? glance.emptyLabel
    : buildCountsLine(
        {
          ...glance,
          showDueSoonProjects: false,
          dueSoonProjectCount: 0,
        },
        true,
      );

  let statusLine = glance.emptyLabel;
  if (!glance.isCalm) {
    if (glance.showTopTitle && glance.topTitle) {
      const tag = topKindLabel(glance.topKind);
      statusLine = tag ? `${tag} · ${glance.topTitle}` : glance.topTitle;
    } else {
      statusLine = '点按打开任务';
    }
  }

  return {
    title: '紧急度',
    countsLine,
    lockCountsLine,
    topTitle: glance.showTopTitle ? glance.topTitle : '',
    statusLine,
    overdueCount: glance.overdueCount,
    dueTodayCount: glance.dueTodayCount,
    dueSoonCount: glance.dueSoonProjectCount,
    showOverdue: glance.showOverdue ? 1 : 0,
    showDueToday: glance.showDueToday ? 1 : 0,
    showDueSoon: glance.showDueSoonProjects ? 1 : 0,
    showTopTitle: glance.showTopTitle && glance.topTitle ? 1 : 0,
    isCalm: glance.isCalm ? 1 : 0,
    deepLink,
  };
}
