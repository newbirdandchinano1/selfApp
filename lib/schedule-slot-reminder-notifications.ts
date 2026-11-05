/**
 * 课程表占用提醒：业务只决定「哪格何时、给谁」；权限/通道/排期走 scheduler。
 * 亦覆盖养成习惯虚拟入格块（不写占用表）。
 */

import { buildNotificationIdentifier } from '@/lib/notification-catalog';
import {
  getNotificationCenterSettings,
  resolveScheduleAdvanceMinutes,
  type ScheduleSlotSubjectKind,
} from '@/lib/notification-center-settings';
import { parseScheduleMetaFromExtra } from '@/lib/schedule/meta';
import { clampAdvanceMinutesOverride } from '@/lib/task-reminder-schedule';
import {
  cancelScheduledByPrefixes,
  isLocalNotificationSchedulingUnavailable,
  scheduleDateRemindersBulk,
  type ScheduleDateReminderParams,
} from '@/lib/notification-scheduler';
import { getHabitById, getHabits } from '@/lib/repositories/habits/habit';
import {
  getAllHabitCheckInsMaps,
  getCheckInsMapByHabitId,
} from '@/lib/repositories/habits/habit-check-in';
import type { HabitRow } from '@/lib/repositories/habits/habit.types';
import { getProjectsByIds } from '@/lib/repositories/projects/project';
import type { ProjectRow } from '@/lib/repositories/projects/project.types';
import {
  getScheduleAxisSettings,
  getWeekAxisSnapshot,
  listPlacementsForEditableWeeks,
} from '@/lib/repositories/schedule/schedule-store';
import { getTasksByIds } from '@/lib/repositories/tasks/task';
import type { TaskRow } from '@/lib/repositories/tasks/task.types';
import { formatMinutesAsHm, slotStartMinutes } from '@/lib/schedule/axis';
import {
  buildVirtualHabitPlacementsForDays,
  virtualHabitScheduleReminderId,
} from '@/lib/schedule/habit-virtual-placement';
import {
  axisMinutesToLocalDate,
  resolvePlacementReminderStart,
} from '@/lib/schedule/timeline/reminder-start';
import type { ScheduleAxisSettings, SchedulePlacementRow } from '@/lib/schedule/types';
import { getWeekStartMondayYmd } from '@/lib/schedule/week';
import {
  addDaysToLogicalYmd,
  formatLocalYmdFromDate,
  getLogicalLocalYmd,
  loadTasksDayBoundary,
} from '@/lib/tasks-logical-day';
import { AppSettingKey, getAppSettingRaw, setAppSetting } from '@/lib/app-settings-store';

export { axisMinutesToLocalDate, resolvePlacementReminderStart } from '@/lib/schedule/timeline/reminder-start';

type SubjectTitleLookup = {
  tasks: Map<string, TaskRow>;
  projects: Map<string, ProjectRow>;
};

const ANDROID_CHANNEL = {
  id: 'schedule-slot-reminders',
  name: '日程表提醒',
  importance: 'high' as const,
  vibrationPattern: [0, 250, 250, 250],
};

/** 虚拟习惯入格提醒向前扫描天数 */
const HABIT_VIRTUAL_LOOKAHEAD_DAYS = 21;

/** 一次性清掉历史截止日待办前缀（不再映射为业务类别） */
const LEGACY_TASK_PREFIX = 'selfapp-task-reminder:';

export function scheduleSlotReminderIdentifier(placementId: string): string {
  return (
    buildNotificationIdentifier('schedule-slot-reminder', placementId) ??
    `selfapp-schedule-reminder:${placementId}`
  );
}

export async function cancelAllScheduleSlotReminders(): Promise<void> {
  if (isLocalNotificationSchedulingUnavailable()) return;
  try {
    // 一次扫表清日程前缀 + 历史截止日待办前缀
    await cancelScheduledByPrefixes(['selfapp-schedule-reminder:', LEGACY_TASK_PREFIX]);
  } catch (e) {
    console.warn('取消日程表提醒失败', e);
  }
}

/** 仅取消某习惯的虚拟入格日程提醒（含强提醒升级链）。不动任务/项目占用。 */
export async function cancelScheduleSlotRemindersForHabit(habitId: string): Promise<void> {
  if (isLocalNotificationSchedulingUnavailable()) return;
  const key = habitId.trim();
  if (!key) return;
  try {
    // identifier = selfapp-schedule-reminder:habit:${habitId}:${ymd}[:+escalation]
    await cancelScheduledByPrefixes([`selfapp-schedule-reminder:habit:${key}:`]);
  } catch (e) {
    console.warn('取消习惯日程格提醒失败', key, e);
  }
}

function buildHabitVirtualLookaheadYmds(todayYmd: string): string[] {
  const dayYmds: string[] = [];
  for (let i = 0; i < HABIT_VIRTUAL_LOOKAHEAD_DAYS; i++) {
    dayYmds.push(addDaysToLogicalYmd(todayYmd, i));
  }
  return dayYmds;
}

function groupYmdsByWeekMonday(dayYmds: string[]): Map<string, string[]> {
  const ymdsByWeek = new Map<string, string[]>();
  for (const ymd of dayYmds) {
    const monday = getWeekStartMondayYmd(ymd);
    const list = ymdsByWeek.get(monday) ?? [];
    list.push(ymd);
    ymdsByWeek.set(monday, list);
  }
  return ymdsByWeek;
}

function slotReminderCopy(kind: ScheduleSlotSubjectKind, title: string): {
  notifTitle: string;
  typeLabel: string;
} {
  if (kind === 'project') {
    return { notifTitle: '推进项目', typeLabel: '项目' };
  }
  if (kind === 'habit') {
    return { notifTitle: '习惯时段', typeLabel: '习惯' };
  }
  return { notifTitle: '该做', typeLabel: '待办' };
}

/** 收集虚拟入格日程提醒参数（不登记）。 */
async function collectVirtualHabitSlotReminderParams(params: {
  habits: HabitRow[];
  checkInsByHabit: Map<string, Record<string, number>>;
  todayYmd: string;
  boundary: Awaited<ReturnType<typeof loadTasksDayBoundary>>;
  advanceMs: number;
  advanceMinutes: number;
  axisCache?: Map<string, Awaited<ReturnType<typeof resolveAxisForWeek>>>;
}): Promise<ScheduleDateReminderParams[]> {
  const {
    habits,
    checkInsByHabit,
    todayYmd,
    boundary,
    advanceMs,
    advanceMinutes,
  } = params;
  const weekAxisCache =
    params.axisCache ?? new Map<string, Awaited<ReturnType<typeof resolveAxisForWeek>>>();
  const ymdsByWeek = groupYmdsByWeekMonday(buildHabitVirtualLookaheadYmds(todayYmd));
  const items: ScheduleDateReminderParams[] = [];

  for (const [monday, ymds] of ymdsByWeek) {
    let axis = weekAxisCache.get(monday);
    if (!axis) {
      axis = await resolveAxisForWeek(monday);
      weekAxisCache.set(monday, axis);
    }
    const virtuals = buildVirtualHabitPlacementsForDays({
      habits,
      dayYmds: ymds,
      logicalTodayYmd: todayYmd,
      axis,
      dayBoundary: boundary,
      checkInsByHabit,
    });
    for (const v of virtuals) {
      if (v.done) continue;
      // 全天入格不走日程格提醒；有提醒时刻由习惯提醒通道负责
      if (v.allDay) continue;
      const startMins = slotStartMinutes(axis, v.startSlotIndex);
      const startAt = axisMinutesToLocalDate(v.assignYmd, startMins);
      const fireAt = new Date(startAt.getTime() - advanceMs);

      const placementId = virtualHabitScheduleReminderId(v.habitId, v.assignYmd);
      const id = scheduleSlotReminderIdentifier(placementId);
      const startHm = formatMinutesAsHm(startMins);
      const copy = slotReminderCopy('habit', v.name);
      const fingerprint = `${placementId}|${v.name}|${v.assignYmd}|${startHm}|${advanceMinutes}`;

      items.push({
        category: 'schedule-slot-reminder',
        identifier: id,
        fireAt,
        channel: ANDROID_CHANNEL,
        data: {
          type: 'schedule-slot-reminder',
          placementId,
          subjectKind: 'habit',
          subjectId: v.habitId,
        },
        fallback: {
          title: copy.notifTitle,
          body: v.name,
        },
        fingerprint,
        contextBlock: [
          '【频道】日程表提醒',
          `【类型】${copy.typeLabel}`,
          `【标题】${v.name}`,
          `【开始】${v.assignYmd} ${startHm}`,
          `【提前】${advanceMinutes} 分钟`,
        ].join('\n'),
      });
    }
  }

  return items;
}

/** 为已解析的虚拟入格批量登记日程提醒（skipCancel：外层已清前缀）。 */
async function scheduleVirtualHabitSlotReminders(params: {
  habits: HabitRow[];
  checkInsByHabit: Map<string, Record<string, number>>;
  todayYmd: string;
  boundary: Awaited<ReturnType<typeof loadTasksDayBoundary>>;
  advanceMs: number;
  advanceMinutes: number;
  axisCache?: Map<string, Awaited<ReturnType<typeof resolveAxisForWeek>>>;
  /** 外层已取消相关前缀时为 true（默认 true） */
  skipCancel?: boolean;
}): Promise<{ permissionDenied: boolean }> {
  const items = await collectVirtualHabitSlotReminderParams(params);
  if (items.length === 0) return { permissionDenied: false };
  const result = await scheduleDateRemindersBulk(items, {
    skipCancel: params.skipCancel !== false,
  });
  return { permissionDenied: result.permissionDenied };
}

async function resolveAxisForWeek(weekStartYmd: string): Promise<{
  startMinutes: number;
  endMinutes: number;
  slotHours: number;
  breaks: ScheduleAxisSettings['breaks'];
}> {
  const snap = await getWeekAxisSnapshot(weekStartYmd);
  if (snap) {
    return {
      startMinutes: snap.startMinutes,
      endMinutes: snap.endMinutes,
      slotHours: snap.slotHours,
      breaks: snap.breaks ?? [],
    };
  }
  const axis: ScheduleAxisSettings = await getScheduleAxisSettings();
  return {
    startMinutes: axis.startMinutes,
    endMinutes: axis.endMinutes,
    slotHours: axis.slotHours,
    breaks: axis.breaks ?? [],
  };
}

/** 本批占用涉及的 task/project 一次 IN 查询装入 Map，避免逐条 getById。 */
async function loadSubjectTitleLookup(placements: SchedulePlacementRow[]): Promise<SubjectTitleLookup> {
  const taskIds: string[] = [];
  const projectIds: string[] = [];
  for (const p of placements) {
    if (p.orphaned) continue;
    if (p.subjectKind === 'task') taskIds.push(p.subjectId);
    else if (p.subjectKind === 'project') projectIds.push(p.subjectId);
  }
  const [tasks, projects] = await Promise.all([
    getTasksByIds(taskIds),
    getProjectsByIds(projectIds),
  ]);
  return {
    tasks: new Map(tasks.map(t => [t.id, t])),
    projects: new Map(projects.map(p => [p.id, p])),
  };
}

function resolveSubjectTitle(
  kind: SchedulePlacementRow['subjectKind'],
  subjectId: string,
  lookup: SubjectTitleLookup,
): { title: string; skip: boolean } | null {
  if (kind === 'task') {
    const task = lookup.tasks.get(subjectId);
    if (!task) return null;
    if (task.status === 'done' || task.status === 'cancelled' || task.status === 'shelved') {
      return { title: task.title, skip: true };
    }
    return { title: task.title?.trim() || '待办', skip: false };
  }
  const project = lookup.projects.get(subjectId);
  if (!project) return null;
  if (
    project.status === 'completed' ||
    project.status === 'archived' ||
    project.status === 'paused'
  ) {
    return { title: project.name, skip: true };
  }
  return { title: project.name?.trim() || '项目', skip: false };
}

/** 收集任务/项目占用提醒参数（不登记）。 */
async function collectPlacementReminderParams(params: {
  placements: SchedulePlacementRow[];
  advanceByKind: { task: number; project: number; habit: number };
  axisCache: Map<string, Awaited<ReturnType<typeof resolveAxisForWeek>>>;
}): Promise<ScheduleDateReminderParams[]> {
  const { placements, advanceByKind, axisCache } = params;
  const items: ScheduleDateReminderParams[] = [];
  const subjectLookup = await loadSubjectTitleLookup(placements);

  for (const placement of placements) {
    if (placement.orphaned) continue;

    let axis = axisCache.get(placement.weekStartYmd);
    if (!axis) {
      axis = await resolveAxisForWeek(placement.weekStartYmd);
      axisCache.set(placement.weekStartYmd, axis);
    }

    const resolved = resolvePlacementReminderStart(placement, axis);
    if (!resolved || Number.isNaN(resolved.startAt.getTime())) continue;
    const { startAt, startMinutes: startMins, assignYmd: dayYmd } = resolved;

    const kind: ScheduleSlotSubjectKind =
      placement.subjectKind === 'project' ? 'project' : 'task';
    const subject = resolveSubjectTitle(placement.subjectKind, placement.subjectId, subjectLookup);
    if (!subject || subject.skip) continue;

    let advanceMinutes = Math.max(5, Math.min(60, advanceByKind[kind]));
    const row =
      kind === 'project'
        ? subjectLookup.projects.get(placement.subjectId)
        : subjectLookup.tasks.get(placement.subjectId);
    const override = clampAdvanceMinutesOverride(
      parseScheduleMetaFromExtra(row?.extra_data ?? null)?.advanceMinutesOverride,
    );
    if (override != null) advanceMinutes = override;
    const advanceMs = advanceMinutes * 60_000;
    const fireAt = new Date(startAt.getTime() - advanceMs);

    const id = scheduleSlotReminderIdentifier(placement.id);
    const startHm = formatMinutesAsHm(startMins);
    const copy = slotReminderCopy(kind, subject.title);
    const fingerprint = `${placement.id}|${subject.title}|${dayYmd}|${startHm}|${advanceMinutes}|${kind}`;

    items.push({
      category: 'schedule-slot-reminder',
      identifier: id,
      fireAt,
      channel: ANDROID_CHANNEL,
      data: {
        type: 'schedule-slot-reminder',
        placementId: placement.id,
        subjectKind: placement.subjectKind,
        subjectId: placement.subjectId,
      },
      fallback: {
        title: copy.notifTitle,
        body: subject.title,
      },
      fingerprint,
      contextBlock: [
        '【频道】日程表提醒',
        `【类型】${copy.typeLabel}`,
        `【标题】${subject.title}`,
        `【开始】${dayYmd} ${startHm}`,
        `【提前】${advanceMinutes} 分钟`,
      ].join('\n'),
    });
  }

  return items;
}

/**
 * 按当前课程表占用重新登记：每条有效占用一条，开始前 advanceMinutes 分钟。
 * 未入格（orphaned / 无法解析区间）完全不推送；开始时刻分钟优先。
 * 外层一次清前缀后，占用 + 虚拟入格合并 bulk 登记（skipCancel + 有限并发）。
 */
export async function syncScheduleSlotReminderNotifications(): Promise<void> {
  if (isLocalNotificationSchedulingUnavailable()) return;

  console.time('syncScheduleSlotReminderNotifications');
  try {
    await cancelAllScheduleSlotReminders();

    const settings = await getNotificationCenterSettings();
    if (!settings.masterEnabled || settings.categories['schedule-slot-reminder'] === false) {
      return;
    }

    const boundary = await loadTasksDayBoundary();
    const now = new Date();
    const todayYmd = getLogicalLocalYmd(now, boundary);
    const thisMonday = getWeekStartMondayYmd(todayYmd);
    const placements = await listPlacementsForEditableWeeks(thisMonday);

    const advanceByKind = {
      task: resolveScheduleAdvanceMinutes(settings.schedule, 'task'),
      project: resolveScheduleAdvanceMinutes(settings.schedule, 'project'),
      habit: resolveScheduleAdvanceMinutes(settings.schedule, 'habit'),
    };
    const habitAdvanceMinutes = advanceByKind.habit;
    const habitAdvanceMs = habitAdvanceMinutes * 60_000;
    const axisCache = new Map<string, Awaited<ReturnType<typeof resolveAxisForWeek>>>();

    const placementItems = await collectPlacementReminderParams({
      placements,
      advanceByKind,
      axisCache,
    });

    let habitItems: ScheduleDateReminderParams[] = [];
    try {
      const [habits, checkInsMaps] = await Promise.all([getHabits(), getAllHabitCheckInsMaps()]);
      habitItems = await collectVirtualHabitSlotReminderParams({
        habits,
        checkInsByHabit: checkInsMaps,
        todayYmd,
        boundary,
        advanceMs: habitAdvanceMs,
        advanceMinutes: habitAdvanceMinutes,
        axisCache,
      });
    } catch (e) {
      console.warn('收集习惯虚拟入格提醒失败', e);
    }

    const allItems = [...placementItems, ...habitItems];
    if (allItems.length === 0) return;

    await scheduleDateRemindersBulk(allItems, { skipCancel: true });
  } finally {
    console.timeEnd('syncScheduleSlotReminderNotifications');
  }
}

/**
 * 仅重排单个习惯的虚拟入格日程提醒（约 21 天）。
 * 用于习惯新建/编辑保存：不动任务/项目占用，也不重建其它习惯。
 * 可选传入已加载的 checkIns，避免保存路径重复读打卡表。
 */
export async function syncScheduleSlotRemindersForHabit(
  habitId: string,
  opts?: { checkIns?: Record<string, number> },
): Promise<{
  permissionDenied: boolean;
}> {
  if (isLocalNotificationSchedulingUnavailable()) {
    return { permissionDenied: false };
  }

  const key = habitId.trim();
  if (!key) return { permissionDenied: false };

  console.time(`syncScheduleSlotRemindersForHabit:${key}`);
  try {
    await cancelScheduleSlotRemindersForHabit(key);

    const settings = await getNotificationCenterSettings();
    if (!settings.masterEnabled || settings.categories['schedule-slot-reminder'] === false) {
      return { permissionDenied: false };
    }

    const habit = await getHabitById(key);
    if (!habit) return { permissionDenied: false };

    const checkIns = opts?.checkIns ?? (await getCheckInsMapByHabitId(key));
    const checkInsByHabit = new Map<string, Record<string, number>>([[key, checkIns]]);

    const boundary = await loadTasksDayBoundary();
    const todayYmd = getLogicalLocalYmd(new Date(), boundary);
    const advanceMinutes = resolveScheduleAdvanceMinutes(settings.schedule, 'habit');
    const advanceMs = advanceMinutes * 60_000;

    return await scheduleVirtualHabitSlotReminders({
      habits: [habit],
      checkInsByHabit,
      todayYmd,
      boundary,
      advanceMs,
      advanceMinutes,
    });
  } catch (e) {
    console.warn('增量同步习惯日程格提醒失败', key, e);
    return { permissionDenied: false };
  } finally {
    console.timeEnd(`syncScheduleSlotRemindersForHabit:${key}`);
  }
}

export async function listScheduleSlotReminderBusinessItems(): Promise<
  {
    identifier: string;
    title: string;
    body: string;
    subjectKind: 'task' | 'project' | 'habit';
    subjectId: string;
    placementId: string;
    fireAt: Date | null;
    customizeHref: string;
  }[]
> {
  const settings = await getNotificationCenterSettings();
  const boundary = await loadTasksDayBoundary();
  const todayYmd = getLogicalLocalYmd(new Date(), boundary);
  const thisMonday = getWeekStartMondayYmd(todayYmd);
  const placements = await listPlacementsForEditableWeeks(thisMonday);
  const advanceByKind = {
    task: resolveScheduleAdvanceMinutes(settings.schedule, 'task'),
    project: resolveScheduleAdvanceMinutes(settings.schedule, 'project'),
    habit: resolveScheduleAdvanceMinutes(settings.schedule, 'habit'),
  };
  const axisCache = new Map<string, Awaited<ReturnType<typeof resolveAxisForWeek>>>();
  const subjectLookup = await loadSubjectTitleLookup(placements);
  const items: {
    identifier: string;
    title: string;
    body: string;
    subjectKind: 'task' | 'project' | 'habit';
    subjectId: string;
    placementId: string;
    fireAt: Date | null;
    customizeHref: string;
  }[] = [];
  const now = Date.now();

  for (const placement of placements) {
    if (placement.orphaned) continue;
    let axis = axisCache.get(placement.weekStartYmd);
    if (!axis) {
      axis = await resolveAxisForWeek(placement.weekStartYmd);
      axisCache.set(placement.weekStartYmd, axis);
    }
    const resolved = resolvePlacementReminderStart(placement, axis);
    if (!resolved) continue;
    const { startAt, startMinutes: startMins } = resolved;
    const kind: ScheduleSlotSubjectKind =
      placement.subjectKind === 'project' ? 'project' : 'task';
    const subject = resolveSubjectTitle(placement.subjectKind, placement.subjectId, subjectLookup);
    if (!subject || subject.skip) continue;
    let advanceMinutes = advanceByKind[kind];
    const row =
      kind === 'project'
        ? subjectLookup.projects.get(placement.subjectId)
        : subjectLookup.tasks.get(placement.subjectId);
    const override = clampAdvanceMinutesOverride(
      parseScheduleMetaFromExtra(row?.extra_data ?? null)?.advanceMinutesOverride,
    );
    if (override != null) advanceMinutes = override;
    const advanceMs = advanceMinutes * 60_000;
    const fireAt = new Date(startAt.getTime() - advanceMs);
    if (fireAt.getTime() <= now) continue;
    const startHm = formatMinutesAsHm(startMins);
    const copy = slotReminderCopy(kind, subject.title);
    items.push({
      identifier: scheduleSlotReminderIdentifier(placement.id),
      title: copy.notifTitle,
      body: `${subject.title} · ${formatLocalYmdFromDate(startAt)} ${startHm}`,
      subjectKind: placement.subjectKind,
      subjectId: placement.subjectId,
      placementId: placement.id,
      fireAt,
      customizeHref:
        placement.subjectKind === 'project'
          ? `/edit-project?id=${encodeURIComponent(placement.subjectId)}`
          : `/edit-task?id=${encodeURIComponent(placement.subjectId)}`,
    });
  }

  try {
    const [habits, checkInsMaps] = await Promise.all([getHabits(), getAllHabitCheckInsMaps()]);
    const dayYmds: string[] = [];
    for (let i = 0; i < HABIT_VIRTUAL_LOOKAHEAD_DAYS; i++) {
      dayYmds.push(addDaysToLogicalYmd(todayYmd, i));
    }
    const ymdsByWeek = new Map<string, string[]>();
    for (const ymd of dayYmds) {
      const monday = getWeekStartMondayYmd(ymd);
      const list = ymdsByWeek.get(monday) ?? [];
      list.push(ymd);
      ymdsByWeek.set(monday, list);
    }
    for (const [monday, ymds] of ymdsByWeek) {
      let axis = axisCache.get(monday);
      if (!axis) {
        axis = await resolveAxisForWeek(monday);
        axisCache.set(monday, axis);
      }
      const virtuals = buildVirtualHabitPlacementsForDays({
        habits,
        dayYmds: ymds,
        logicalTodayYmd: todayYmd,
        axis,
        dayBoundary: boundary,
        checkInsByHabit: checkInsMaps,
      });
      const habitAdvanceMs = advanceByKind.habit * 60_000;
      for (const v of virtuals) {
        if (v.done) continue;
        if (v.allDay) continue;
        const startMins = slotStartMinutes(axis, v.startSlotIndex);
        const startAt = axisMinutesToLocalDate(v.assignYmd, startMins);
        const fireAt = new Date(startAt.getTime() - habitAdvanceMs);
        if (fireAt.getTime() <= now) continue;
        const placementId = virtualHabitScheduleReminderId(v.habitId, v.assignYmd);
        const copy = slotReminderCopy('habit', v.name);
        items.push({
          identifier: scheduleSlotReminderIdentifier(placementId),
          title: copy.notifTitle,
          body: `${v.name} · ${v.assignYmd} ${formatMinutesAsHm(startMins)}`,
          subjectKind: 'habit',
          subjectId: v.habitId,
          placementId,
          fireAt,
          customizeHref: `/add-habit?id=${encodeURIComponent(v.habitId)}`,
        });
      }
    }
  } catch (e) {
    console.warn('列举习惯日程提醒失败', e);
  }

  return items;
}

/** 阶段 I：强制按分钟重注册日程提醒的版本号 */
export const SCHEDULE_SLOT_REMINDER_MINUTES_RESYNC_VERSION = '1';

export const SCHEDULE_SLOT_REMINDER_MINUTES_RESYNC_KEY =
  AppSettingKey.scheduleSlotReminderMinutesResyncV1;

/**
 * 一次性：升级到分钟优先触发后，强制清旧预约并按 resolve 重登记。
 * 已跑过版本则跳过；失败不写版本号，下次启动可重试。
 */
export async function migrateScheduleSlotRemindersMinutesResyncIfNeeded(): Promise<boolean> {
  const flag = await getAppSettingRaw(SCHEDULE_SLOT_REMINDER_MINUTES_RESYNC_KEY);
  if (flag === SCHEDULE_SLOT_REMINDER_MINUTES_RESYNC_VERSION) return false;

  await syncScheduleSlotReminderNotifications();
  await setAppSetting(
    SCHEDULE_SLOT_REMINDER_MINUTES_RESYNC_KEY,
    SCHEDULE_SLOT_REMINDER_MINUTES_RESYNC_VERSION,
  );
  if (__DEV__) {
    console.log('[schedule-reminder] minutes resync done (phase I)');
  }
  return true;
}
