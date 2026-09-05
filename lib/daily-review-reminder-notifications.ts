import type { DailyReviewReminderSettings } from '@/lib/daily-review-reminder-settings';
import { getDailyReviewReminderSettings } from '@/lib/daily-review-reminder-settings';
import { listDailyReviewsBetween } from '@/lib/repositories/insights/daily-review-journal';
import {
  collectColumnIds,
  parseDailyReviewBody,
  type ReviewFieldValues,
} from '@/lib/repositories/insights/review-journal-body';
import { listReviewTemplate } from '@/lib/repositories/insights/review-template';
import { getRollingSevenDayRangeEndingOnNextReviewDay } from '@/lib/repositories/insights/weekly-review';
import { getWeeklyReviewConfiguredWeekday } from '@/lib/weekly-review-settings';
import { getLogicalLocalYmd, resolveDayBoundaryForPage } from '@/lib/tasks-logical-day';
import { canScheduleAppNotification } from '@/lib/notification-center-settings';
import { isExpoSandboxNotificationDisabled } from '@/lib/notification-policy';
import { Platform } from 'react-native';

const NOTIFICATION_ID = 'selfapp-daily-review-reminder';
const ANDROID_CHANNEL_ID = 'daily-review-reminders';
const MAX_LOOKAHEAD_DAYS = 21;

function dailyEntryHasContent(fields: ReviewFieldValues): boolean {
  return Object.values(fields).some((v) => (v ?? '').trim().length > 0);
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

async function ensureAndroidChannel() {
  if (Platform.OS !== 'android') return;
  const Notifications = await import('expo-notifications');
  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    name: '每日复盘提醒',
    importance: Notifications.AndroidImportance.DEFAULT,
    vibrationPattern: [0, 200, 120, 200],
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });
}

export type SyncDailyReviewReminderResult = {
  scheduled: boolean;
  permissionDenied: boolean;
};

/** 指定逻辑日是否已填写日复盘（有任一栏目非空）。 */
export async function isDailyReviewFilledForYmd(ymd: string): Promise<boolean> {
  const [tpl, rows] = await Promise.all([listReviewTemplate('daily'), listDailyReviewsBetween(ymd, ymd)]);
  const row = rows[0];
  if (!row?.body?.trim()) return false;

  const colIds = collectColumnIds(tpl);
  const fields = parseDailyReviewBody(row.body, colIds);
  if (dailyEntryHasContent(fields)) return true;

  try {
    const o = JSON.parse(row.body) as { fields?: unknown };
    if (o?.fields && typeof o.fields === 'object' && !Array.isArray(o.fields)) {
      return Object.values(o.fields as Record<string, unknown>).some(
        (v) => String(v ?? '').trim().length > 0,
      );
    }
  } catch {
    return row.body.trim().length > 0;
  }
  return false;
}

function formatYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
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
          (v) => String(v ?? '').trim().length > 0,
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
  if (Platform.OS === 'web' || isExpoSandboxNotificationDisabled()) {
    return { scheduled: false, permissionDenied: false };
  }

  const resolved = settings ?? (await getDailyReviewReminderSettings());

  let Notifications: typeof import('expo-notifications');
  try {
    Notifications = await import('expo-notifications');
  } catch (e) {
    console.warn('expo-notifications 不可用', e);
    return { scheduled: false, permissionDenied: false };
  }

  try {
    await Notifications.cancelScheduledNotificationAsync(NOTIFICATION_ID);
  } catch {
    /* 无已登记通知时忽略 */
  }

  if (!resolved.enabled) {
    return { scheduled: false, permissionDenied: false };
  }

  if (
    !(await canScheduleAppNotification({
      category: 'daily-review-reminder',
      identifier: NOTIFICATION_ID,
    }))
  ) {
    return { scheduled: false, permissionDenied: false };
  }

  const perm = await Notifications.getPermissionsAsync();
  let granted = perm.status === 'granted';
  if (!granted && perm.canAskAgain !== false) {
    const req = await Notifications.requestPermissionsAsync();
    granted = req.status === 'granted';
  }
  if (!granted) {
    return { scheduled: false, permissionDenied: true };
  }

  await ensureAndroidChannel();

  const hour = Math.max(0, Math.min(23, Math.floor(resolved.hour)));
  const minute = Math.max(0, Math.min(59, Math.floor(resolved.minute)));
  const fireAt = await findNextDailyReviewReminderFireAt(hour, minute);
  if (!fireAt) {
    return { scheduled: false, permissionDenied: false };
  }

  const SchedulableTriggerInputTypes = Notifications.SchedulableTriggerInputTypes;
  const channelId = Platform.OS === 'android' ? ANDROID_CHANNEL_ID : undefined;

  try {
    await Notifications.scheduleNotificationAsync({
      identifier: NOTIFICATION_ID,
      content: {
        title: '每日复盘提醒',
        body: '记得花几分钟完成今日复盘。',
        sound: true,
        data: { type: 'daily-review-reminder' },
      },
      trigger: {
        type: SchedulableTriggerInputTypes.DATE,
        date: fireAt,
        channelId,
      },
    });
    return { scheduled: true, permissionDenied: false };
  } catch (e) {
    console.warn('登记每日复盘提醒失败', e);
    return { scheduled: false, permissionDenied: false };
  }
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
