/**
 * 课程表占用提醒：业务只决定「哪格何时、给谁」；权限/通道/排期走 scheduler。
 * 亦覆盖养成习惯虚拟入格块（不写占用表）。
 */

import { buildNotificationIdentifier } from '@/lib/notification-catalog';
import { getNotificationCenterSettings } from '@/lib/notification-center-settings';
import {
  cancelScheduledByPrefix,
  isLocalNotificationSchedulingUnavailable,
  scheduleDateReminder,
} from '@/lib/notification-scheduler';
import { getHabits } from '@/lib/repositories/habits/habit';
import { getAllHabitCheckInsMaps } from '@/lib/repositories/habits/habit-check-in';
import {
  getScheduleAxisSettings,
  getWeekAxisSnapshot,
  listPlacementsForEditableWeeks,
} from '@/lib/repositories/schedule/schedule-store';
import { getProjectById } from '@/lib/repositories/projects/project';
import { getTaskById } from '@/lib/repositories/tasks/task';
import { formatMinutesAsHm, slotStartMinutes } from '@/lib/schedule/axis';
import {
  buildVirtualHabitPlacementsForDays,
  virtualHabitScheduleReminderId,
} from '@/lib/schedule/habit-virtual-placement';
import type { ScheduleAxisSettings, SchedulePlacementRow } from '@/lib/schedule/types';
import { getWeekStartMondayYmd, ymdForWeekday } from '@/lib/schedule/week';
import {
  addDaysToLogicalYmd,
  formatLocalYmdFromDate,
  getLogicalLocalYmd,
  loadTasksDayBoundary,
  logicalYmdToLocalDate,
} from '@/lib/tasks-logical-day';

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
    await cancelScheduledByPrefix('selfapp-schedule-reminder:');
    // 清掉历史截止日待办前缀，避免残留预约
    await cancelScheduledByPrefix(LEGACY_TASK_PREFIX);
  } catch (e) {
    console.warn('取消日程表提醒失败', e);
  }
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

function placementStartDate(
  placement: SchedulePlacementRow,
  axis: {
    startMinutes: number;
    endMinutes: number;
    slotHours: number;
    breaks?: ScheduleAxisSettings['breaks'];
  },
): Date | null {
  if (placement.orphaned || placement.startSlotIndex == null) return null;
  const ymd = ymdForWeekday(placement.weekStartYmd, placement.weekday);
  const day = logicalYmdToLocalDate(ymd);
  const startMins = slotStartMinutes(axis, placement.startSlotIndex);
  const h = Math.floor(startMins / 60);
  const m = startMins % 60;
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m, 0, 0);
}

async function resolveSubjectTitle(
  kind: SchedulePlacementRow['subjectKind'],
  subjectId: string,
): Promise<{ title: string; skip: boolean } | null> {
  if (kind === 'task') {
    const task = await getTaskById(subjectId);
    if (!task) return null;
    if (task.status === 'done' || task.status === 'cancelled' || task.status === 'shelved') {
      return { title: task.title, skip: true };
    }
    return { title: task.title?.trim() || '待办', skip: false };
  }
  const project = await getProjectById(subjectId);
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

/**
 * 按当前课程表占用重新登记：每条有效占用一条，开始前 advanceMinutes 分钟。
 * 未入格（orphaned / 无 startSlotIndex）完全不推送。
 */
export async function syncScheduleSlotReminderNotifications(): Promise<void> {
  if (isLocalNotificationSchedulingUnavailable()) return;

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

  const advanceMs = Math.max(5, Math.min(60, settings.schedule.advanceMinutes)) * 60_000;
  const axisCache = new Map<string, Awaited<ReturnType<typeof resolveAxisForWeek>>>();

  for (const placement of placements) {
    if (placement.orphaned || placement.startSlotIndex == null) continue;

    let axis = axisCache.get(placement.weekStartYmd);
    if (!axis) {
      axis = await resolveAxisForWeek(placement.weekStartYmd);
      axisCache.set(placement.weekStartYmd, axis);
    }

    const startAt = placementStartDate(placement, axis);
    if (!startAt || Number.isNaN(startAt.getTime())) continue;
    const fireAt = new Date(startAt.getTime() - advanceMs);

    const subject = await resolveSubjectTitle(placement.subjectKind, placement.subjectId);
    if (!subject || subject.skip) continue;

    const id = scheduleSlotReminderIdentifier(placement.id);
    const startHm = formatMinutesAsHm(slotStartMinutes(axis, placement.startSlotIndex));
    const dayYmd = ymdForWeekday(placement.weekStartYmd, placement.weekday);
    const fingerprint = `${placement.id}|${subject.title}|${dayYmd}|${startHm}|${settings.schedule.advanceMinutes}`;

    await scheduleDateReminder({
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
        title: '日程表提醒',
        body: subject.title,
      },
      fingerprint,
      contextBlock: [
        '【频道】日程表提醒',
        `【类型】${placement.subjectKind === 'project' ? '项目' : '待办'}`,
        `【标题】${subject.title}`,
        `【开始】${dayYmd} ${startHm}`,
        `【提前】${settings.schedule.advanceMinutes} 分钟`,
      ].join('\n'),
    });
  }

  // 养成习惯虚拟入格：按格子开始时间登记（与占用提醒同一频道）
  try {
    const [habits, checkInsMaps] = await Promise.all([getHabits(), getAllHabitCheckInsMaps()]);
    const dayYmds: string[] = [];
    for (let i = 0; i < HABIT_VIRTUAL_LOOKAHEAD_DAYS; i++) {
      dayYmds.push(addDaysToLogicalYmd(todayYmd, i));
    }
    const weekAxisCache = new Map<string, Awaited<ReturnType<typeof resolveAxisForWeek>>>();
    const ymdsByWeek = new Map<string, string[]>();
    for (const ymd of dayYmds) {
      const monday = getWeekStartMondayYmd(ymd);
      const list = ymdsByWeek.get(monday) ?? [];
      list.push(ymd);
      ymdsByWeek.set(monday, list);
    }
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
        checkInsByHabit: checkInsMaps,
      });
      for (const v of virtuals) {
        if (v.done) continue;
        const startMins = slotStartMinutes(axis, v.startSlotIndex);
        const day = logicalYmdToLocalDate(v.assignYmd);
        const startAt = new Date(
          day.getFullYear(),
          day.getMonth(),
          day.getDate(),
          Math.floor(startMins / 60),
          startMins % 60,
          0,
          0,
        );
        const fireAt = new Date(startAt.getTime() - advanceMs);

        const placementId = virtualHabitScheduleReminderId(v.habitId, v.assignYmd);
        const id = scheduleSlotReminderIdentifier(placementId);
        const startHm = formatMinutesAsHm(startMins);
        const fingerprint = `${placementId}|${v.name}|${v.assignYmd}|${startHm}|${settings.schedule.advanceMinutes}`;

        await scheduleDateReminder({
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
            title: '日程表提醒',
            body: v.name,
          },
          fingerprint,
          contextBlock: [
            '【频道】日程表提醒',
            '【类型】习惯',
            `【标题】${v.name}`,
            `【开始】${v.assignYmd} ${startHm}`,
            `【提前】${settings.schedule.advanceMinutes} 分钟`,
          ].join('\n'),
        });
      }
    }
  } catch (e) {
    console.warn('登记习惯虚拟入格提醒失败', e);
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
  const advanceMs = Math.max(5, Math.min(60, settings.schedule.advanceMinutes)) * 60_000;
  const axisCache = new Map<string, Awaited<ReturnType<typeof resolveAxisForWeek>>>();
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
    if (placement.orphaned || placement.startSlotIndex == null) continue;
    let axis = axisCache.get(placement.weekStartYmd);
    if (!axis) {
      axis = await resolveAxisForWeek(placement.weekStartYmd);
      axisCache.set(placement.weekStartYmd, axis);
    }
    const startAt = placementStartDate(placement, axis);
    if (!startAt) continue;
    const fireAt = new Date(startAt.getTime() - advanceMs);
    if (fireAt.getTime() <= now) continue;
    const subject = await resolveSubjectTitle(placement.subjectKind, placement.subjectId);
    if (!subject || subject.skip) continue;
    const startHm = formatMinutesAsHm(slotStartMinutes(axis, placement.startSlotIndex));
    items.push({
      identifier: scheduleSlotReminderIdentifier(placement.id),
      title: '日程表提醒',
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
      for (const v of virtuals) {
        if (v.done) continue;
        const startMins = slotStartMinutes(axis, v.startSlotIndex);
        const day = logicalYmdToLocalDate(v.assignYmd);
        const startAt = new Date(
          day.getFullYear(),
          day.getMonth(),
          day.getDate(),
          Math.floor(startMins / 60),
          startMins % 60,
          0,
          0,
        );
        const fireAt = new Date(startAt.getTime() - advanceMs);
        if (fireAt.getTime() <= now) continue;
        const placementId = virtualHabitScheduleReminderId(v.habitId, v.assignYmd);
        items.push({
          identifier: scheduleSlotReminderIdentifier(placementId),
          title: '日程表提醒',
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
