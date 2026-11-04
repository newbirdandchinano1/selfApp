/**
 * 周复盘本地提醒：仅在配置的周复盘日到点催写；写完周刊则抑制。
 */

import type { WeeklyReviewReminderSettings } from '@/lib/weekly-review-reminder-settings';
import { getWeeklyReviewReminderSettings } from '@/lib/weekly-review-reminder-settings';
import { getNotificationCategoryMeta } from '@/lib/notification-catalog';
import {
  cancelScheduledByIdentifier,
  isLocalNotificationSchedulingUnavailable,
  scheduleDateReminder,
} from '@/lib/notification-scheduler';
import {
  collectColumnIds,
  hasAnyFilledField,
  parseDailyReviewBody,
  parseWeeklyReviewFields,
} from '@/lib/repositories/insights/review-journal-body';
import { listReviewTemplate } from '@/lib/repositories/insights/review-template';
import {
  getNextConfiguredReviewDayOnOrAfter,
  getRollingSevenDayRangeEndingOnNextReviewDay,
} from '@/lib/repositories/insights/weekly-review';
import { getWeeklyReviewJournalByWeek } from '@/lib/repositories/insights/weekly-review-journal';
import { listDailyReviewsBetween } from '@/lib/repositories/insights/daily-review-journal';
import { getWeeklyReviewConfiguredWeekday } from '@/lib/weekly-review-settings';
import { formatYmd } from '@/lib/date';

const ANDROID_CHANNEL = {
  id: 'weekly-review-reminders',
  name: '周复盘提醒',
  importance: 'default' as const,
  vibrationPattern: [0, 200, 120, 200],
};

const NOTIFICATION_ID =
  getNotificationCategoryMeta('weekly-review-reminder').identifierPrefix ??
  'selfapp-weekly-review-reminder';

const MAX_LOOKAHEAD_WEEKS = 8;

function dailyEntryHasContent(fields: Record<string, string>): boolean {
  return Object.values(fields).some(v => (v ?? '').trim().length > 0);
}

export type SyncWeeklyReviewReminderResult = {
  scheduled: boolean;
  permissionDenied: boolean;
};

export async function isWeeklyReviewFilledForWeekStart(weekStartYmd: string): Promise<boolean> {
  const [tpl, row] = await Promise.all([
    listReviewTemplate('weekly'),
    getWeeklyReviewJournalByWeek(weekStartYmd),
  ]);
  const colIds = collectColumnIds(tpl);
  const fields = parseWeeklyReviewFields(row, colIds);
  return hasAnyFilledField(fields);
}

async function buildWeeklyProgressBodyHint(now: Date = new Date()): Promise<string> {
  try {
    const configuredDow = await getWeeklyReviewConfiguredWeekday();
    if (configuredDow === null) {
      return '花几分钟收一收本周，写写周复盘。';
    }
    const rolling = getRollingSevenDayRangeEndingOnNextReviewDay(now, configuredDow);
    const [dailyTpl, rows] = await Promise.all([
      listReviewTemplate('daily'),
      listDailyReviewsBetween(rolling.startYmd, rolling.endYmd),
    ]);
    const colIds = collectColumnIds(dailyTpl);
    let filled = 0;
    let editable = 0;
    const todayYmd = formatYmd(now);
    for (let i = 0; i < 7; i++) {
      const d = new Date(rolling.start);
      d.setDate(rolling.start.getDate() + i);
      const ymd = formatYmd(d);
      if (ymd === rolling.endYmd) continue;
      if (ymd > todayYmd) continue;
      editable += 1;
      const row = rows.find(r => r.record_date_ymd === ymd);
      if (!row?.body?.trim()) continue;
      const fields = parseDailyReviewBody(row.body, colIds);
      if (dailyEntryHasContent(fields)) filled += 1;
    }
    if (editable <= 0) return '本周收口日到了，花几分钟写写周复盘。';
    return `本周日刊 ${filled}/${editable}，来收个周刊。`;
  } catch {
    return '记得花几分钟完成周复盘。';
  }
}

export async function findNextWeeklyReviewReminderFireAt(
  hour: number,
  minute: number,
  now: Date = new Date(),
): Promise<{ fireAt: Date; weekStartYmd: string } | null> {
  const configuredDow = await getWeeklyReviewConfiguredWeekday();
  if (configuredDow === null) return null;

  let cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  for (let w = 0; w < MAX_LOOKAHEAD_WEEKS; w++) {
    const reviewDay = getNextConfiguredReviewDayOnOrAfter(cursor, configuredDow);
    const fireAt = new Date(
      reviewDay.getFullYear(),
      reviewDay.getMonth(),
      reviewDay.getDate(),
      hour,
      minute,
      0,
      0,
    );
    if (fireAt.getTime() <= now.getTime() + 2000) {
      cursor = new Date(reviewDay);
      cursor.setDate(reviewDay.getDate() + 1);
      continue;
    }

    const rolling = getRollingSevenDayRangeEndingOnNextReviewDay(reviewDay, configuredDow);
    const filled = await isWeeklyReviewFilledForWeekStart(rolling.startYmd);
    if (filled) {
      cursor = new Date(reviewDay);
      cursor.setDate(reviewDay.getDate() + 1);
      continue;
    }
    return { fireAt, weekStartYmd: rolling.startYmd };
  }
  return null;
}

/** 根据已保存设置登记或取消周复盘本地通知。 */
export async function syncWeeklyReviewReminderNotification(
  settings?: WeeklyReviewReminderSettings,
): Promise<SyncWeeklyReviewReminderResult> {
  if (isLocalNotificationSchedulingUnavailable()) {
    return { scheduled: false, permissionDenied: false };
  }

  const resolved = settings ?? (await getWeeklyReviewReminderSettings());
  await cancelScheduledByIdentifier(NOTIFICATION_ID);

  if (!resolved.enabled) {
    return { scheduled: false, permissionDenied: false };
  }

  const configuredDow = await getWeeklyReviewConfiguredWeekday();
  if (configuredDow === null) {
    return { scheduled: false, permissionDenied: false };
  }

  const hour = Math.max(0, Math.min(23, Math.floor(resolved.hour)));
  const minute = Math.max(0, Math.min(59, Math.floor(resolved.minute)));
  const next = await findNextWeeklyReviewReminderFireAt(hour, minute);
  if (!next) {
    return { scheduled: false, permissionDenied: false };
  }

  const { fireAt, weekStartYmd } = next;
  const fingerprint = `weekly-review|${hour}:${minute}|${fireAt.toISOString().slice(0, 16)}`;
  const progressHint = await buildWeeklyProgressBodyHint(new Date());

  return scheduleDateReminder({
    category: 'weekly-review-reminder',
    identifier: NOTIFICATION_ID,
    fireAt,
    channel: ANDROID_CHANNEL,
    data: {
      type: 'weekly-review-reminder',
      href: '/(tabs)/review?focus=weekly',
      weekStartYmd,
      focus: 'weekly',
    },
    fallback: {
      title: '本周复盘',
      body: progressHint,
    },
    fingerprint,
    contextBlock: [
      '【频道】周复盘提醒',
      '【语境】提醒用户填写本周周复盘',
      `【进度提示】${progressHint}`,
      `【周期起点】${weekStartYmd}`,
    ].join('\n'),
  });
}

/** 前台送达前：未开 / 非周复盘日 / 已填周刊则抑制。 */
export async function shouldSuppressWeeklyReviewReminderNotification(): Promise<boolean> {
  try {
    const settings = await getWeeklyReviewReminderSettings();
    if (!settings.enabled) return true;

    const configuredDow = await getWeeklyReviewConfiguredWeekday();
    if (configuredDow === null) return true;

    const now = new Date();
    if (now.getDay() !== configuredDow) return true;

    const rolling = getRollingSevenDayRangeEndingOnNextReviewDay(now, configuredDow);
    return await isWeeklyReviewFilledForWeekStart(rolling.startYmd);
  } catch (e) {
    console.warn('判断周复盘提醒抑制失败', e);
    return false;
  }
}
