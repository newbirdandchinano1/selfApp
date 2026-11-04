/**
 * 项目推进提醒：无近期入格滞留催促 / 临近项目截止。
 * 文案用「推进 xxx」，与待办「该做」区分。
 */

import { buildNotificationIdentifier } from '@/lib/notification-catalog';
import { getNotificationCenterSettings } from '@/lib/notification-center-settings';
import {
  cancelScheduledByIdentifier,
  cancelScheduledByPrefixes,
  isLocalNotificationSchedulingUnavailable,
  scheduleDateRemindersBulk,
  type ScheduleDateReminderParams,
} from '@/lib/notification-scheduler';
import {
  buildProjectProgressFireAt,
  resolveProjectProgressNudge,
  shouldSuppressProjectProgressReminder,
} from '@/lib/project-progress-reminder-logic';
import { getProjects } from '@/lib/repositories/projects/project';
import type { ProjectRow } from '@/lib/repositories/projects/project.types';
import { listPlacementsForWeek } from '@/lib/repositories/schedule/schedule-store';
import { dueDateFromScheduleMeta, parseScheduleMetaFromExtra } from '@/lib/schedule/meta';
import { getWeekStartMondayYmd, ymdForWeekday } from '@/lib/schedule/week';
import {
  addDaysToLogicalYmd,
  getLogicalLocalYmd,
  loadTasksDayBoundary,
} from '@/lib/tasks-logical-day';

const ANDROID_CHANNEL = {
  id: 'project-progress-reminders',
  name: '项目推进提醒',
  importance: 'default' as const,
  vibrationPattern: [0, 180, 120, 180],
};

const PREFIX = 'selfapp-project-progress-reminder:';

export function projectProgressReminderIdentifier(projectId: string): string {
  return (
    buildNotificationIdentifier('project-progress-reminder', projectId) ?? `${PREFIX}${projectId}`
  );
}

export async function cancelScheduledProjectProgressReminder(projectId: string): Promise<void> {
  if (isLocalNotificationSchedulingUnavailable()) return;
  const key = projectId.trim();
  if (!key) return;
  try {
    await cancelScheduledByIdentifier(projectProgressReminderIdentifier(key));
  } catch (e) {
    console.warn('取消项目推进提醒失败', key, e);
  }
}

export async function cancelAllProjectProgressReminders(): Promise<void> {
  if (isLocalNotificationSchedulingUnavailable()) return;
  try {
    await cancelScheduledByPrefixes([PREFIX]);
  } catch (e) {
    console.warn('取消全部项目推进提醒失败', e);
  }
}

async function loadLastPlacementYmdByProjectId(params: {
  todayYmd: string;
  lookbackDays: number;
}): Promise<Map<string, string>> {
  const mondays = new Set<string>();
  for (let i = 0; i <= params.lookbackDays + 7; i++) {
    mondays.add(getWeekStartMondayYmd(addDaysToLogicalYmd(params.todayYmd, -i)));
  }
  const lastByProject = new Map<string, string>();
  const weeks = await Promise.all([...mondays].map(m => listPlacementsForWeek(m)));
  for (const placements of weeks) {
    for (const p of placements) {
      if (p.subjectKind !== 'project' || p.orphaned || p.startSlotIndex == null) continue;
      const ymd = ymdForWeekday(p.weekStartYmd, p.weekday);
      const prev = lastByProject.get(p.subjectId);
      if (!prev || ymd > prev) lastByProject.set(p.subjectId, ymd);
    }
  }
  return lastByProject;
}

function buildItem(params: {
  project: ProjectRow;
  todayYmd: string;
  now: Date;
  lastPlacementYmd: string | null;
  staleDays: number;
  dueSoonWindowDays: number;
}): ScheduleDateReminderParams | null {
  const { project, todayYmd, now } = params;
  if (shouldSuppressProjectProgressReminder(project.status)) return null;

  const schedule = parseScheduleMetaFromExtra(project.extra_data);
  const dueYmd = dueDateFromScheduleMeta(schedule, project.due_date);
  const kind = resolveProjectProgressNudge({
    todayYmd,
    lastPlacementYmd: params.lastPlacementYmd,
    dueYmd,
    staleDays: params.staleDays,
    dueSoonWindowDays: params.dueSoonWindowDays,
  });
  if (!kind) return null;

  const fireAt = buildProjectProgressFireAt({ todayYmd, now });
  if (!fireAt) return null;

  const title = project.name?.trim() || '项目';
  const body =
    kind === 'due_soon' ? `${title} · 临近截止，安排推进` : `${title} · 多日未入格，推进一下`;
  const id = projectProgressReminderIdentifier(project.id);
  const fingerprint = `${project.id}|${title}|${kind}|${fireAt.toISOString().slice(0, 16)}|${params.lastPlacementYmd ?? 'none'}`;

  return {
    category: 'project-progress-reminder',
    identifier: id,
    fireAt,
    channel: ANDROID_CHANNEL,
    data: {
      type: 'project-progress-reminder',
      projectId: project.id,
      kind,
    },
    fallback: {
      title: '推进项目',
      body,
    },
    fingerprint,
    strong: false,
    contextBlock: [
      '【频道】项目推进提醒',
      `【标题】${title}`,
      `【原因】${kind}`,
      `【最近入格】${params.lastPlacementYmd ?? '无'}`,
    ].join('\n'),
  };
}

export async function collectProjectProgressReminderParams(opts?: {
  projects?: ProjectRow[];
  todayYmd?: string;
  now?: Date;
  staleDays?: number;
  dueSoonWindowDays?: number;
}): Promise<ScheduleDateReminderParams[]> {
  const now = opts?.now ?? new Date();
  const boundary = await loadTasksDayBoundary();
  const todayYmd = opts?.todayYmd ?? getLogicalLocalYmd(now, boundary);
  const settings = await getNotificationCenterSettings();
  const staleDays = opts?.staleDays ?? settings.schedule.projectStaleDays;
  const dueSoonWindowDays = opts?.dueSoonWindowDays ?? settings.schedule.dueSoonWindowDays;
  const projects = opts?.projects ?? (await getProjects());
  const lastMap = await loadLastPlacementYmdByProjectId({
    todayYmd,
    lookbackDays: Math.max(staleDays, 14),
  });

  const items: ScheduleDateReminderParams[] = [];
  for (const project of projects) {
    const item = buildItem({
      project,
      todayYmd,
      now,
      lastPlacementYmd: lastMap.get(project.id) ?? null,
      staleDays,
      dueSoonWindowDays,
    });
    if (item) items.push(item);
  }
  return items;
}

export async function syncProjectProgressReminderNotifications(): Promise<void> {
  if (isLocalNotificationSchedulingUnavailable()) return;

  console.time('syncProjectProgressReminderNotifications');
  try {
    await cancelAllProjectProgressReminders();
    const settings = await getNotificationCenterSettings();
    if (!settings.masterEnabled || settings.categories['project-progress-reminder'] === false) {
      return;
    }
    const items = await collectProjectProgressReminderParams();
    if (items.length === 0) return;
    await scheduleDateRemindersBulk(items, { skipCancel: true });
  } finally {
    console.timeEnd('syncProjectProgressReminderNotifications');
  }
}

export async function listProjectProgressReminderBusinessItems(): Promise<
  {
    identifier: string;
    title: string;
    body: string;
    projectId: string;
    fireAt: Date | null;
    customizeHref: string;
  }[]
> {
  const settings = await getNotificationCenterSettings();
  if (!settings.masterEnabled || settings.categories['project-progress-reminder'] === false) {
    return [];
  }
  const items = await collectProjectProgressReminderParams();
  const now = Date.now();
  return items
    .filter(i => i.fireAt.getTime() > now)
    .map(i => ({
      identifier: i.identifier,
      title: i.fallback.title,
      body: i.fallback.body,
      projectId: String(i.data.projectId ?? ''),
      fireAt: i.fireAt,
      customizeHref: `/edit-project?id=${encodeURIComponent(String(i.data.projectId ?? ''))}`,
    }));
}

export async function shouldSuppressProjectProgressReminderNotification(
  projectId: string,
): Promise<boolean> {
  const key = projectId.trim();
  if (!key) return false;
  try {
    const projects = await getProjects();
    const project = projects.find(p => p.id === key);
    if (!project) return true;
    return shouldSuppressProjectProgressReminder(project.status);
  } catch (e) {
    console.warn('判断项目推进提醒抑制失败', key, e);
    return false;
  }
}
