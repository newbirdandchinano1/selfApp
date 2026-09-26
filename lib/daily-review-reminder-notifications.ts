/**
 * 每日复盘本地提醒：业务只决定「哪天几点是否该填」；权限/通道/排期走 scheduler。
 */

import type { DailyReviewReminderSettings } from '@/lib/daily-review-reminder-settings';
import { getDailyReviewReminderSettings } from '@/lib/daily-review-reminder-settings';
import { getNotificationCategoryMeta } from '@/lib/notification-catalog';
import {
  cancelScheduledByIdentifier,
  isLocalNotificationSchedulingUnavailable,
  scheduleDateReminder,
} from '@/lib/notification-scheduler';
import { listDailyReviewsBetween } from '@/lib/repositories/insights/daily-review-journal';
import {
  collectColumnIds,
  parseDailyReviewBody,
  type ReviewFieldValues,
} from '@/lib/repositories/insights/review-journal-body';
import { listReviewTemplate } from '@/lib/repositories/insights/review-template';
import { getRollingSevenDayRangeEndingOnNextReviewDay } from '@/lib/repositories/insights/weekly-review';
import { getWeeklyReviewConfiguredWeekday } from '@/lib/weekly-review-settings';
import { formatYmd } from '@/lib/date';
import { getLogicalLocalYmd, resolveDayBoundaryForPage } from '@/lib/tasks-logical-day';

const ANDROID_CHANNEL = {
  id: 'daily-review-reminders',
  name: '每日复盘提醒',
  importance: 'default' as const,
  vibrationPattern: [0, 200, 120, 200],
};

const NOTIFICATION_ID =
  getNotificationCategoryMeta('daily-review-reminder').identifierPrefix ??
  'selfapp-daily-review-reminder';

const MAX_LOOKAHEAD_DAYS = 21;

function dailyEntryHasContent(fields: ReviewFieldValues): boolean {
  return Object.values(fields).some(v => (v ?? '').trim().length > 0);
}

/** 与 `components/review/review-utils` 的周复盘日跳过日复盘规则一致 */
function isDailyReviewSkippedForYmd(ymd: string, configuredDow: number | null): boolean {
  if (configuredDow === null) return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return false;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const { endYmd } = getRollingSevenDayRangeEndingOnNextReviewDay(d, configuredDow);
  return ymd === endYmd;
}

export type SyncDailyReviewReminderResult = {
  scheduled: boolean;
  permissionDenied: boolean;
};

/** 指定逻辑日是否已填写日复盘（有任一栏目非空）。 */
export async function isDailyReviewFilledForYmd(ymd: string): Promise<boolean> {
  const [tpl, rows] = await Promise.all([
    listReviewTemplate('daily'),
    listDailyReviewsBetween(ymd, ymd),
  ]);
  const row = rows[0];
  if (!row?.body?.trim()) return false;

  const colIds = collectColumnIds(tpl);
  const fields = parseDailyReviewBody(row.body, colIds);
  if (dailyEntryHasContent(fields)) return true;

  try {
    const o = JSON.parse(row.body) as { fields?: unknown };
    if (o?.fields && typeof o.fields === 'object' && !Array.isArray(o.fields)) {
      return Object.values(o.fields as Record<string, unknown>).some(
        v => String(v ?? '').trim().length > 0,
      );
    }
  } catch {
    return row.body.trim().length > 0;
  }
  return false;
}

/** 本周期已复盘天数文案，用于通知 body */
async function buildWeekProgressBodyHint(now: Date = new Date()): Promise<string> {
  try {
    const configuredDow = await getWeeklyReviewConfiguredWeekday();
    const rolling =
      configuredDow !== null
        ? (
            await import('@/lib/repositories/insights/weekly-review')
          ).getRollingSevenDayRangeEndingOnNextReviewDay(now, configuredDow)
        : (await import('@/lib/repositories/insights/weekly-review')).getRollingSevenDayRange(now);

    const [tpl, rows] = await Promise.all([
      listReviewTemplate('daily'),
      listDailyReviewsBetween(rolling.startYmd, rolling.endYmd),
    ]);
    const colIds = collectColumnIds(tpl);
    let filled = 0;
    let editable = 0;
    const todayYmd = formatYmd(now);
    for (let i = 0; i < 7; i++) {
      const d = new Date(rolling.start);
      d.setDate(rolling.start.getDate() + i);
      const ymd = formatYmd(d);
      if (isDailyReviewSkippedForYmd(ymd, configuredDow)) continue;
      if (ymd > todayYmd) continue;
      editable += 1;
      const row = rows.find(r => r.record_date_ymd === ymd);
      if (!row?.body?.trim()) continue;
      const fields = parseDailyReviewBody(row.body, colIds);
      if (dailyEntryHasContent(fields)) filled += 1;
    }
    if (editable <= 0) return '花几分钟写写今天发生了什么、有啥进步。';
    return `本周已复盘 ${filled}/${editable}，花几分钟写写今天。`;
  } catch {
    return '记得花几分钟完成今日复盘。';
  }
}

async function findNextDailyReviewReminderFireAt(
  hour: number,
  minute: number,
  now: Date = new Date(),
): Promise<Date | null> {
  const [boundary, configuredDow, tpl] = await Promise.all([
    resolveDayBoundaryForPage('review'),
    getWeeklyReviewConfiguredWeekday(),
    listReviewTemplate('daily'),
  ]);
  const colIds = collectColumnIds(tpl);
  const cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const rangeEnd = new Date(cursor);
  rangeEnd.setDate(cursor.getDate() + MAX_LOOKAHEAD_DAYS);
  const rows = await listDailyReviewsBetween(formatYmd(cursor), formatYmd(rangeEnd));
  const filledYmds = new Set<string>();
  for (const row of rows) {
    if (!row.body?.trim()) continue;
    const fields = parseDailyReviewBody(row.body, colIds);
    if (dailyEntryHasContent(fields)) {
      filledYmds.add(row.record_date_ymd);
      continue;
    }
    try {
      const o = JSON.parse(row.body) as { fields?: unknown };
      if (o?.fields && typeof o.fields === 'object' && !Array.isArray(o.fields)) {
        const has = Object.values(o.fields as Record<string, unknown>).some(
          v => String(v ?? '').trim().length > 0,
        );
        if (has) filledYmds.add(row.record_date_ymd);
      }
    } catch {
      if (row.body.trim().length > 0) filledYmds.add(row.record_date_ymd);
    }
  }

  for (let i = 0; i < MAX_LOOKAHEAD_DAYS; i++) {
    const day = new Date(cursor);
    day.setDate(cursor.getDate() + i);
    const fireAt = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute, 0, 0);
    if (fireAt.getTime() <= now.getTime() + 2000) continue;

    const logicalYmd = getLogicalLocalYmd(fireAt, boundary);
    if (isDailyReviewSkippedForYmd(logicalYmd, configuredDow)) continue;
    if (filledYmds.has(logicalYmd)) continue;
    return fireAt;
  }

  return null;
}

/** 根据已保存设置登记或取消每日复盘本地通知提醒。 */
export async function syncDailyReviewReminderNotification(
  settings?: DailyReviewReminderSettings,
): Promise<SyncDailyReviewReminderResult> {
  if (isLocalNotificationSchedulingUnavailable()) {
    return { scheduled: false, permissionDenied: false };
  }

  const resolved = settings ?? (await getDailyReviewReminderSettings());
  await cancelScheduledByIdentifier(NOTIFICATION_ID);

  if (!resolved.enabled) {
    return { scheduled: false, permissionDenied: false };
  }

  const hour = Math.max(0, Math.min(23, Math.floor(resolved.hour)));
  const minute = Math.max(0, Math.min(59, Math.floor(resolved.minute)));
  const fireAt = await findNextDailyReviewReminderFireAt(hour, minute);
  if (!fireAt) {
    return { scheduled: false, permissionDenied: false };
  }

  const fingerprint = `daily-review|${hour}:${minute}|${fireAt.toISOString().slice(0, 16)}`;
  const progressHint = await buildWeekProgressBodyHint(new Date());

  return scheduleDateReminder({
    category: 'daily-review-reminder',
    identifier: NOTIFICATION_ID,
    fireAt,
    channel: ANDROID_CHANNEL,
    data: {
      type: 'daily-review-reminder',
      href: '/(tabs)/review',
    },
    fallback: {
      title: '今日复盘',
      body: progressHint,
    },
    fingerprint,
    contextBlock: [
      '【频道】每日复盘提醒',
      '【语境】提醒用户填写今日日复盘',
      `【进度提示】${progressHint}`,
    ].join('\n'),
  });
}

/** 前台送达前：今日已填写复盘（或周复盘日）则抑制展示。 */
export async function shouldSuppressDailyReviewReminderNotification(): Promise<boolean> {
  try {
    const settings = await getDailyReviewReminderSettings();
    if (!settings.enabled) return true;

    const [boundary, configuredDow] = await Promise.all([
      resolveDayBoundaryForPage('review'),
      getWeeklyReviewConfiguredWeekday(),
    ]);
    const logicalYmd = getLogicalLocalYmd(new Date(), boundary);
    if (isDailyReviewSkippedForYmd(logicalYmd, configuredDow)) return true;
    return await isDailyReviewFilledForYmd(logicalYmd);
  } catch (e) {
    console.warn('判断复盘提醒抑制失败', e);
    return false;
  }
}
