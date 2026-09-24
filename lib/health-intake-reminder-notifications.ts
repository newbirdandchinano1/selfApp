/**
 * 健康摄入本地提醒：
 * - 逻辑日（resolveDayBoundaryForPage('health')）任一指标相对目标不足 → 未达标才登记
 * - 固定时刻 / 间隔模式；免打扰内延后到结束；每逻辑日最多 2 条
 * - masterEnabled / 频道关闭 / 沙箱 / Web：由 canSchedule + 同步入口统一处理
 */

import { resolveNotificationAiCopy } from '@/lib/notification-ai-copy';
import {
  canScheduleAppNotification,
  getNotificationCenterSettings,
  type HealthIntakeReminderPrefs,
} from '@/lib/notification-center-settings';
import { isExpoSandboxNotificationDisabled } from '@/lib/notification-policy';
import { getResolvedGlobalIntakeTargets } from '@/lib/global-intake-targets';
import {
  getHealthDayMetricsForUser,
} from '@/lib/repositories/health/health';
import type { HealthIntakeDayTotals, HealthRecordRow } from '@/lib/repositories/health/health.types';
import { getDefaultUser } from '@/lib/repositories/users/user';
import {
  getLogicalLocalYmd,
  resolveDayBoundaryForPage,
} from '@/lib/tasks-logical-day';
import { Platform } from 'react-native';

const NOTIFICATION_PREFIX = 'selfapp-health-intake-reminder:';
const ANDROID_CHANNEL_ID = 'health-intake-reminders';
const MAX_PER_LOGICAL_DAY = 2;

export function healthIntakeReminderIdentifier(logicalYmd: string, index: number): string {
  return `${NOTIFICATION_PREFIX}${logicalYmd}:${index}`;
}

async function ensureAndroidChannel() {
  if (Platform.OS !== 'android') return;
  const Notifications = await import('expo-notifications');
  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    name: '健康摄入提醒',
    importance: Notifications.AndroidImportance.DEFAULT,
    vibrationPattern: [0, 200, 120, 200],
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });
}

async function cancelAllHealthIntakeReminders() {
  const Notifications = await import('expo-notifications');
  const pending = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    pending
      .filter(r => typeof r.identifier === 'string' && r.identifier.startsWith(NOTIFICATION_PREFIX))
      .map(r => Notifications.cancelScheduledNotificationAsync(r.identifier)),
  );
}

function minutesOfDay(hour: number, minute: number): number {
  return hour * 60 + minute;
}

/** 免打扰是否覆盖某本地时刻（支持跨午夜，如 23:00–07:00） */
export function isInQuietHours(
  date: Date,
  prefs: Pick<
    HealthIntakeReminderPrefs,
    'quietStartHour' | 'quietStartMinute' | 'quietEndHour' | 'quietEndMinute'
  >,
): boolean {
  const t = minutesOfDay(date.getHours(), date.getMinutes());
  const start = minutesOfDay(prefs.quietStartHour, prefs.quietStartMinute);
  const end = minutesOfDay(prefs.quietEndHour, prefs.quietEndMinute);
  if (start === end) return false;
  if (start < end) return t >= start && t < end;
  return t >= start || t < end;
}

/** 若落在免打扰内，延后到免打扰结束（同日或次日） */
export function deferOutOfQuietHours(date: Date, prefs: HealthIntakeReminderPrefs): Date {
  if (!isInQuietHours(date, prefs)) return date;
  const end = new Date(date);
  end.setHours(prefs.quietEndHour, prefs.quietEndMinute, 0, 0);
  if (end.getTime() <= date.getTime()) {
    end.setDate(end.getDate() + 1);
  }
  return end;
}

function resolveTargets(latest: HealthRecordRow | null) {
  const fallback = getResolvedGlobalIntakeTargets();
  const pick = (raw: number | null | undefined, fb: number) => {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
    return Math.max(0, fb);
  };
  return {
    hydration: pick(latest?.target_hydration, fallback.hydrationMl),
    protein: pick(latest?.target_protein, fallback.proteinG),
    carbohydrate: pick(latest?.target_carbohydrate, fallback.carbohydrateG),
    calories: pick(latest?.target_calories, fallback.caloriesKcal),
  };
}

export type HealthIntakeDeficit = {
  key: 'hydration' | 'protein' | 'carbohydrate' | 'calories';
  label: string;
  current: number;
  target: number;
};

/** 任一相对目标不足 → 未达标 */
export function listHealthIntakeDeficits(
  totals: HealthIntakeDayTotals,
  targets: ReturnType<typeof resolveTargets>,
): HealthIntakeDeficit[] {
  const rows: HealthIntakeDeficit[] = [
    { key: 'hydration', label: '水分', current: totals.hydration, target: targets.hydration },
    { key: 'protein', label: '蛋白质', current: totals.protein, target: targets.protein },
    {
      key: 'carbohydrate',
      label: '碳水',
      current: totals.carbohydrate,
      target: targets.carbohydrate,
    },
    { key: 'calories', label: '热量', current: totals.calories, target: targets.calories },
  ];
  return rows.filter(r => r.target > 0 && r.current < r.target);
}

function buildFireAtOnLogicalDay(
  logicalYmd: string,
  hour: number,
  minute: number,
): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(logicalYmd.trim());
  if (!m) return null;
  return new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Math.max(0, Math.min(23, hour)),
    Math.max(0, Math.min(59, minute)),
    0,
    0,
  );
}

function addMinutes(d: Date, mins: number): Date {
  return new Date(d.getTime() + mins * 60_000);
}

/**
 * 计算本逻辑日剩余可登记的触发时刻（已计入「已过点」占用配额）。
 */
export function computeHealthIntakeFireAts(params: {
  prefs: HealthIntakeReminderPrefs;
  logicalYmd: string;
  now: Date;
}): Date[] {
  const { prefs, logicalYmd, now } = params;
  const candidates: Date[] = [];

  if (prefs.mode === 'fixed') {
    const base = buildFireAtOnLogicalDay(logicalYmd, prefs.fixedHour, prefs.fixedMinute);
    if (base) candidates.push(deferOutOfQuietHours(base, prefs));
  } else {
    // 间隔：从日界后首个整点步长起扫到逻辑日结束附近
    const dayStart = buildFireAtOnLogicalDay(logicalYmd, 0, 0);
    if (!dayStart) return [];
    let cursor = new Date(dayStart);
    // 从「现在」对齐到下一间隔点，同时扫整天以统计已过配额
    const endOfScan = addMinutes(dayStart, 24 * 60);
    cursor = new Date(Math.max(cursor.getTime(), dayStart.getTime()));
    // 对齐到当天 00:00 + n*interval
    const interval = prefs.intervalMinutes;
    let t = new Date(dayStart);
    while (t.getTime() < endOfScan.getTime()) {
      const deferred = deferOutOfQuietHours(t, prefs);
      // 延后后仍属同一逻辑日才计入（跨日延后由下次 sync 处理）
      candidates.push(deferred);
      t = addMinutes(t, interval);
    }
  }

  // 去重（同分）
  const uniq: Date[] = [];
  const seen = new Set<number>();
  for (const d of candidates) {
    const key = Math.floor(d.getTime() / 60_000);
    if (seen.has(key)) continue;
    seen.add(key);
    uniq.push(d);
  }
  uniq.sort((a, b) => a.getTime() - b.getTime());

  const pastOrNow = uniq.filter(d => d.getTime() <= now.getTime() + 2000);
  const future = uniq.filter(d => d.getTime() > now.getTime() + 2000);
  const used = Math.min(MAX_PER_LOGICAL_DAY, pastOrNow.length);
  const remain = Math.max(0, MAX_PER_LOGICAL_DAY - used);
  return future.slice(0, remain);
}

async function ensurePermission(
  Notifications: typeof import('expo-notifications'),
): Promise<boolean> {
  const perm = await Notifications.getPermissionsAsync();
  let granted = perm.status === 'granted';
  if (!granted && perm.canAskAgain !== false) {
    const req = await Notifications.requestPermissionsAsync();
    granted = req.status === 'granted';
  }
  return granted;
}

/**
 * 按当前摄入与偏好重新登记健康提醒。
 * 达标后取消当天后续；master 关闭由 resync 入口先 cancelAll。
 */
export async function syncHealthIntakeReminderNotifications(): Promise<void> {
  if (Platform.OS === 'web' || isExpoSandboxNotificationDisabled()) return;

  let Notifications: typeof import('expo-notifications');
  try {
    Notifications = await import('expo-notifications');
  } catch (e) {
    console.warn('expo-notifications 不可用', e);
    return;
  }

  await cancelAllHealthIntakeReminders();

  const settings = await getNotificationCenterSettings();
  if (!settings.masterEnabled || settings.categories['health-intake-reminder'] === false) {
    return;
  }

  if (!(await ensurePermission(Notifications))) return;
  await ensureAndroidChannel();

  const user = await getDefaultUser();
  if (!user?.id) return;

  const boundary = await resolveDayBoundaryForPage('health');
  const now = new Date();
  const logicalYmd = getLogicalLocalYmd(now, boundary);

  const metrics = await getHealthDayMetricsForUser(user.id, logicalYmd, { localOnly: true }).catch(
    () => null,
  );
  const totals: HealthIntakeDayTotals = metrics?.totals ?? {
    hydration: 0,
    protein: 0,
    carbohydrate: 0,
    calories: 0,
  };
  const targets = resolveTargets(metrics?.latest ?? null);
  const deficits = listHealthIntakeDeficits(totals, targets);
  if (deficits.length === 0) {
    // 达标：不再登记当天后续
    return;
  }

  const fireAts = computeHealthIntakeFireAts({
    prefs: settings.health,
    logicalYmd,
    now,
  });
  if (fireAts.length === 0) return;

  const deficitSummary = deficits
    .map(d => `${d.label} ${Math.round(d.current)}/${Math.round(d.target)}`)
    .join('；');
  const fingerprint = `${logicalYmd}|${settings.health.mode}|${deficitSummary}`;

  const SchedulableTriggerInputTypes = Notifications.SchedulableTriggerInputTypes;

  for (let i = 0; i < fireAts.length; i++) {
    const fireAt = fireAts[i]!;
    const id = healthIntakeReminderIdentifier(logicalYmd, i);
    if (!(await canScheduleAppNotification({ category: 'health-intake-reminder', identifier: id }))) {
      continue;
    }

    const copy = await resolveNotificationAiCopy({
      identifier: id,
      fingerprint,
      fallback: {
        title: '健康摄入提醒',
        body: `今日还有未达标：${deficits.map(d => d.label).join('、')}`,
      },
      contextBlock: [
        '【频道】健康摄入提醒',
        `【逻辑日】${logicalYmd}`,
        `【未达标】${deficitSummary}`,
      ].join('\n'),
    });

    try {
      await Notifications.scheduleNotificationAsync({
        identifier: id,
        content: {
          title: copy.title,
          body: copy.body,
          sound: true,
          data: { type: 'health-intake-reminder', logicalYmd },
        },
        trigger: {
          type: SchedulableTriggerInputTypes.DATE,
          date: fireAt,
          channelId: Platform.OS === 'android' ? ANDROID_CHANNEL_ID : undefined,
        },
      });
    } catch (e) {
      console.warn('登记健康摄入提醒失败', id, e);
    }
  }
}

/** 前台送达前：若已达标则抑制展示 */
export async function shouldSuppressHealthIntakeReminderNotification(): Promise<boolean> {
  try {
    const user = await getDefaultUser();
    if (!user?.id) return true;
    const boundary = await resolveDayBoundaryForPage('health');
    const logicalYmd = getLogicalLocalYmd(new Date(), boundary);
    const metrics = await getHealthDayMetricsForUser(user.id, logicalYmd, { localOnly: true });
    const totals = metrics?.totals ?? {
      hydration: 0,
      protein: 0,
      carbohydrate: 0,
      calories: 0,
    };
    const targets = resolveTargets(metrics?.latest ?? null);
    return listHealthIntakeDeficits(totals, targets).length === 0;
  } catch (e) {
    console.warn('判断健康提醒抑制失败', e);
    return false;
  }
}
