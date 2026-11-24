/**
 * 本周推进纯逻辑（无 RN / SQLite 依赖，便于脚本测试）。
 */
import { formatYmd } from '@/lib/date';
import type { TaskRow } from '@/lib/repositories/tasks/task.types';

export type RoadWeekTaskItem = {
  taskId: string;
  title: string;
  status: string;
  projectId: string;
  projectName: string;
};

export type RoadWeekTasksEmptyReason =
  | 'no_month_goal'
  | 'no_projects'
  | 'no_week_tasks'
  | null;

export type RoadWeekTasksResult = {
  weekStart: string;
  weekEnd: string;
  weekRangeLabel: string;
  tasks: RoadWeekTaskItem[];
  emptyReason: RoadWeekTasksEmptyReason;
};

export type ProjectWeekContext = {
  id: string;
  name: string;
  status: string;
  weekKey?: string | null;
  extraData?: string | null;
};

export function formatWeekRangeSlash(startYmd: string, endYmd: string): string {
  const fmt = (ymd: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
    if (!m) return ymd;
    return `${Number(m[2])}/${Number(m[3])}`;
  };
  return `${fmt(startYmd)}–${fmt(endYmd)}`;
}

/** 本周一至周日（本地日历） */
export function weekRangeFromAnchor(anchor: Date = new Date()): {
  startYmd: string;
  endYmd: string;
} {
  const d = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
  const dow = d.getDay();
  const offsetMon = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(d);
  monday.setDate(d.getDate() + offsetMon);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { startYmd: formatYmd(monday), endYmd: formatYmd(sunday) };
}

export type WeekTaskPredicate = (
  task: TaskRow,
  weekStartYmd: string,
  weekEndYmd: string,
  logicalTodayYmd: string,
  projectExtraData: string | null,
) => boolean;

/** 纯函数：从已加载任务中筛出当前月项目的本周任务 */
export function selectCurrentMonthWeekTasks(opts: {
  monthGoalId: string | null | undefined;
  projects: ProjectWeekContext[];
  tasks: TaskRow[];
  now?: Date;
  limit?: number;
  isTaskInWeek: WeekTaskPredicate;
}): RoadWeekTasksResult {
  const now = opts.now ?? new Date();
  const week = weekRangeFromAnchor(now);
  const weekRangeLabel = formatWeekRangeSlash(week.startYmd, week.endYmd);
  const limit = opts.limit ?? 3;
  const todayYmd = formatYmd(now);

  if (!opts.monthGoalId?.trim()) {
    return {
      weekStart: week.startYmd,
      weekEnd: week.endYmd,
      weekRangeLabel,
      tasks: [],
      emptyReason: 'no_month_goal',
    };
  }

  if (opts.projects.length === 0) {
    return {
      weekStart: week.startYmd,
      weekEnd: week.endYmd,
      weekRangeLabel,
      tasks: [],
      emptyReason: 'no_projects',
    };
  }

  const projectById = new Map(opts.projects.map((p) => [p.id, p] as const));
  const projectIds = new Set(opts.projects.map((p) => p.id));

  const matched: RoadWeekTaskItem[] = [];
  for (const t of opts.tasks) {
    const projectId = t.project_id?.trim() || '';
    if (!projectId || !projectIds.has(projectId)) continue;
    if (t.status === 'cancelled') continue;

    const project = projectById.get(projectId);
    if (
      !opts.isTaskInWeek(
        t,
        week.startYmd,
        week.endYmd,
        todayYmd,
        project?.extraData ?? null,
      )
    ) {
      continue;
    }

    matched.push({
      taskId: t.id,
      title: t.title?.trim() || '未命名任务',
      status: t.status,
      projectId,
      projectName: project?.name?.trim() || '项目',
    });
  }

  matched.sort((a, b) => {
    const doneA = a.status === 'done' ? 1 : 0;
    const doneB = b.status === 'done' ? 1 : 0;
    if (doneA !== doneB) return doneA - doneB;
    return a.title.localeCompare(b.title, 'zh');
  });

  const tasks = matched.slice(0, limit);
  return {
    weekStart: week.startYmd,
    weekEnd: week.endYmd,
    weekRangeLabel,
    tasks,
    emptyReason: tasks.length === 0 ? 'no_week_tasks' : null,
  };
}
