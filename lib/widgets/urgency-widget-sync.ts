/**
 * 待办 / 截止紧急度 → iOS 主屏 / 锁屏小组件。
 * 截止日口径对齐 task-deadline-reminder（dueDateFromScheduleMeta）；
 * 临期项目对齐自动临期窗口（isProjectDueSoonForProgress）。
 */
import { Platform } from 'react-native';

import { isProjectDueSoonForProgress } from '@/lib/project-progress-reminder-logic';
import { getProjects } from '@/lib/repositories/projects/project';
import type { ProjectRow } from '@/lib/repositories/projects/project.types';
import { getTasks } from '@/lib/repositories/tasks/task';
import {
  isTaskActiveStatus,
  normalizeTaskPriority,
  type TaskRow,
} from '@/lib/repositories/tasks/task.types';
import {
  dueDateFromScheduleMeta,
  parseScheduleMetaFromExtra,
} from '@/lib/schedule/meta';
import { getLogicalLocalYmd, resolveDayBoundaryForPage } from '@/lib/tasks-logical-day';
import {
  buildUrgencyGlance,
  urgencyGlanceToWidgetProps,
  type UrgencyCandidate,
  type UrgencyWidgetProps,
} from '@/lib/widgets/urgency-glance';
import { isExpoWidgetsNativeAvailable } from '@/lib/widgets/expo-widgets-compat';
import {
  ensureHomeWidgetsRegistered,
  pushWidgetSnapshotVerified,
} from '@/lib/widgets/widget-bridge';
import { getWidgetsSettings, shouldPushUrgencyWidget } from '@/lib/widgets/widgets-settings';
import { whenHomeWidgetsDbReady } from '@/lib/widgets/widget-sync-ready';

let syncChain: Promise<void> = Promise.resolve();
let lastFingerprint = '';

function pausedProps(): UrgencyWidgetProps {
  return {
    ...urgencyGlanceToWidgetProps(
      buildUrgencyGlance({
        overdue: [],
        dueToday: [],
        dueSoonProjects: [],
        showOverdue: true,
        showDueToday: true,
        showDueSoonProjects: true,
        showTopTitle: false,
        emptyLabel: '组件已暂停',
      }),
    ),
    countsLine: '—',
    lockCountsLine: '—',
    statusLine: '组件已暂停',
  };
}

function resolveTaskDueYmd(task: TaskRow): string | null {
  const schedule = parseScheduleMetaFromExtra(task.extra_data);
  return dueDateFromScheduleMeta(schedule, task.due_date);
}

function resolveProjectDueYmd(project: ProjectRow): string | null {
  const schedule = parseScheduleMetaFromExtra(project.extra_data);
  return dueDateFromScheduleMeta(schedule, project.due_date);
}

function collectTaskCandidates(tasks: TaskRow[], todayYmd: string): {
  overdue: UrgencyCandidate[];
  dueToday: UrgencyCandidate[];
} {
  const overdue: UrgencyCandidate[] = [];
  const dueToday: UrgencyCandidate[] = [];
  for (const task of tasks) {
    if (!isTaskActiveStatus(task.status)) continue;
    const dueYmd = resolveTaskDueYmd(task);
    if (!dueYmd) continue;
    const base: UrgencyCandidate = {
      id: task.id,
      title: task.title?.trim() || '待办',
      kind: 'overdue',
      dueYmd,
      priority: normalizeTaskPriority(task.priority),
    };
    if (dueYmd < todayYmd) {
      overdue.push({ ...base, kind: 'overdue' });
    } else if (dueYmd === todayYmd) {
      dueToday.push({ ...base, kind: 'due_today' });
    }
  }
  return { overdue, dueToday };
}

function collectDueSoonProjects(
  projects: ProjectRow[],
  todayYmd: string,
  windowDays: number,
): UrgencyCandidate[] {
  const out: UrgencyCandidate[] = [];
  for (const project of projects) {
    if (project.status !== 'active') continue;
    const dueYmd = resolveProjectDueYmd(project);
    if (
      !isProjectDueSoonForProgress({
        todayYmd,
        dueYmd,
        windowDays,
      })
    ) {
      continue;
    }
    out.push({
      id: project.id,
      title: project.name?.trim() || '项目',
      kind: 'due_soon_project',
      dueYmd: dueYmd!,
      priority: normalizeTaskPriority(project.priority ?? 0),
    });
  }
  return out;
}

export async function buildTodayUrgencyGlance(now = new Date()) {
  const settings = await getWidgetsSettings();
  const urgency = settings.urgency;
  const boundary = await resolveDayBoundaryForPage('tasks');
  const todayYmd = getLogicalLocalYmd(now, boundary);

  const [tasks, projects] = await Promise.all([
    getTasks().catch(() => [] as TaskRow[]),
    getProjects().catch(() => [] as ProjectRow[]),
  ]);

  const { overdue, dueToday } = collectTaskCandidates(tasks, todayYmd);
  const dueSoonProjects = collectDueSoonProjects(
    projects,
    todayYmd,
    urgency.dueSoonWindowDays,
  );

  return buildUrgencyGlance({
    overdue,
    dueToday,
    dueSoonProjects,
    showOverdue: urgency.showOverdue,
    showDueToday: urgency.showDueToday,
    showDueSoonProjects: urgency.showDueSoonProjects,
    showTopTitle: urgency.showTopTitle,
    emptyLabel: urgency.emptyLabel,
  });
}

async function syncUrgencyWidgetNow(reason: string): Promise<void> {
  if (Platform.OS !== 'ios') return;
  await whenHomeWidgetsDbReady();
  await ensureHomeWidgetsRegistered();
  const settings = await getWidgetsSettings();
  const UrgencyWidget = (await import('@/widgets/UrgencyWidget')).default;

  if (!shouldPushUrgencyWidget(settings)) {
    try {
      await pushWidgetSnapshotVerified(UrgencyWidget as never, pausedProps() as never);
    } catch (e) {
      console.warn('[widgets] urgency pause failed', e);
    }
    return;
  }

  const glance = await buildTodayUrgencyGlance();
  const props = urgencyGlanceToWidgetProps(glance);
  const fp = [
    props.countsLine,
    props.lockCountsLine,
    props.topTitle,
    props.statusLine,
    props.showOverdue,
    props.showDueToday,
    props.showDueSoon,
    props.showTopTitle,
  ].join('|');
  if (fp === lastFingerprint && reason === 'debounce') return;

  try {
    await pushWidgetSnapshotVerified(UrgencyWidget as never, props as never);
    lastFingerprint = fp;
  } catch (e) {
    console.warn('[widgets] urgency snapshot failed', reason, e);
  }

  if (__DEV__) {
    console.log('[widgets] urgency synced', reason, {
      counts: props.countsLine,
      calm: props.isCalm,
    });
  }
}

export function scheduleUrgencyWidgetSync(reason: string): void {
  if (Platform.OS !== 'ios') return;
  if (!isExpoWidgetsNativeAvailable()) return;
  const task = syncChain.then(() => syncUrgencyWidgetNow(reason));
  syncChain = task.catch((e) => {
    if (__DEV__) console.warn('[widgets] urgency sync chain error', reason, e);
  });
  void task;
}

export async function previewUrgencyWidgetProps(): Promise<UrgencyWidgetProps> {
  try {
    const settings = await getWidgetsSettings();
    if (!settings.privacy.previewUseRealData) {
      const showTop = settings.urgency.showTopTitle && !settings.privacy.lockScreenStrict;
      return urgencyGlanceToWidgetProps(
        buildUrgencyGlance({
          overdue: [
            {
              id: '1',
              title: '提交周报',
              kind: 'overdue',
              dueYmd: '2026-11-02',
              priority: 3,
            },
          ],
          dueToday: [
            {
              id: '2',
              title: '买菜',
              kind: 'due_today',
              dueYmd: '2026-11-04',
              priority: 2,
            },
          ],
          dueSoonProjects: [
            {
              id: '3',
              title: '搬家清单',
              kind: 'due_soon_project',
              dueYmd: '2026-11-05',
              priority: 1,
            },
          ],
          showOverdue: settings.urgency.showOverdue,
          showDueToday: settings.urgency.showDueToday,
          showDueSoonProjects: settings.urgency.showDueSoonProjects,
          showTopTitle: showTop,
          emptyLabel: settings.urgency.emptyLabel,
        }),
      );
    }
    return urgencyGlanceToWidgetProps(await buildTodayUrgencyGlance());
  } catch {
    return {
      ...pausedProps(),
      statusLine: '暂无紧急摘要',
      countsLine: '—',
      lockCountsLine: '—',
    };
  }
}
