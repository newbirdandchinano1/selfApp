/**
 * 健康摄入本地提醒（缺口 + 时机）：
 * - 餐次窗口催最大缺口，并可带傍晚收口
 * - 仅傍晚收口 / 水分轻间隔（从最近一次记录起算）
 * - 关注项过滤、免打扰延后、稍后再说、今日不催
 * - 每日最多 2 条未来预约；达标后取消
 */

import { buildNotificationIdentifier } from '@/lib/notification-catalog';
import {
  getNotificationCenterSettings,
  healthFocusKeyLabel,
  patchNotificationCenterSettings,
  type HealthIntakeFocusKey,
  type HealthIntakeReminderPrefs,
} from '@/lib/notification-center-settings';
import {
  buildHealthIntakeReminderCopy,
  computeHealthIntakeFireAts,
  deferOutOfQuietHours,
  isInQuietHours,
  listHealthIntakeDeficits,
  parseHealthIntakeTimestamp,
  MAX_HEALTH_INTAKE_REMINDERS_PER_DAY,
  HEALTH_INTAKE_SNOOZE_MINUTES,
  type HealthIntakeDeficit,
  type HealthIntakeFireSlot,
} from '@/lib/health-intake-reminder-logic';
import {
  cancelScheduledByCategory,
  isLocalNotificationSchedulingUnavailable,
  scheduleDateReminder,
} from '@/lib/notification-scheduler';
import { getResolvedGlobalIntakeTargets } from '@/lib/global-intake-targets';
import { getHealthDayMetricsForUser } from '@/lib/repositories/health/health';
import type { HealthIntakeDayTotals, HealthRecordRow } from '@/lib/repositories/health/health.types';
import { getDefaultUser } from '@/lib/repositories/users/user';
import { getLogicalLocalYmd, resolveDayBoundaryForPage } from '@/lib/tasks-logical-day';

export {
  buildHealthIntakeReminderCopy,
  computeHealthIntakeFireAts,
  deferOutOfQuietHours,
  isInQuietHours,
  listHealthIntakeDeficits,
  parseHealthIntakeTimestamp,
  MAX_HEALTH_INTAKE_REMINDERS_PER_DAY,
  HEALTH_INTAKE_SNOOZE_MINUTES,
};
export type { HealthIntakeDeficit, HealthIntakeFireSlot };

const ANDROID_CHANNEL = {
  id: 'health-intake-reminders',
  name: '健康摄入提醒',
  importance: 'default' as const,
  vibrationPattern: [0, 200, 120, 200],
};

export const HEALTH_INTAKE_REMINDER_CATEGORY_ID = 'health-intake-reminder-actions';
export const HEALTH_ACTION_SNOOZE = 'HEALTH_SNOOZE';
export const HEALTH_ACTION_MUTE_TODAY = 'HEALTH_MUTE_TODAY';

let healthCategoryEnsured = false;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function healthIntakeReminderIdentifier(logicalYmd: string, index: number): string {
  return (
    buildNotificationIdentifier('health-intake-reminder', `${logicalYmd}:${index}`) ??
    `selfapp-health-intake-reminder:${logicalYmd}:${index}`
  );
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

/** 注册健康提醒 Action（稍后再说 / 今日不催），幂等。 */
export async function ensureHealthIntakeReminderCategory(
  Notifications?: typeof import('expo-notifications') | null,
): Promise<void> {
  if (healthCategoryEnsured) return;
  try {
    const mod = Notifications ?? (await import('expo-notifications'));
    await mod.setNotificationCategoryAsync(HEALTH_INTAKE_REMINDER_CATEGORY_ID, [
      {
        identifier: HEALTH_ACTION_SNOOZE,
        buttonTitle: `稍后再说 ${HEALTH_INTAKE_SNOOZE_MINUTES} 分`,
        options: { opensAppToForeground: false },
      },
      {
        identifier: HEALTH_ACTION_MUTE_TODAY,
        buttonTitle: '今日不催这项',
        options: { opensAppToForeground: false },
      },
    ]);
    healthCategoryEnsured = true;
  } catch (e) {
    console.warn('注册健康提醒通知类别失败', e);
  }
}

/**
 * 按当前摄入与偏好重新登记健康提醒。
 * 达标 / 关注项均静音后取消当天后续。
 */
export async function syncHealthIntakeReminderNotifications(): Promise<void> {
  if (isLocalNotificationSchedulingUnavailable()) return;

  await cancelScheduledByCategory('health-intake-reminder');

  const settings = await getNotificationCenterSettings();
  if (!settings.masterEnabled || settings.categories['health-intake-reminder'] === false) {
    return;
  }

  const user = await getDefaultUser();
  if (!user?.id) return;

  const boundary = await resolveDayBoundaryForPage('health');
  const now = new Date();
  const logicalYmd = getLogicalLocalYmd(now, boundary);

  let prefs: HealthIntakeReminderPrefs = settings.health;
  if (prefs.snoozeUntilMs != null && prefs.snoozeUntilMs <= now.getTime()) {
    prefs = (await patchNotificationCenterSettings({ health: { snoozeUntilMs: null } })).health;
  }

  const metrics = await getHealthDayMetricsForUser(user.id, logicalYmd, { cacheOnly: true }).catch(
    () => null,
  );
  const totals: HealthIntakeDayTotals = metrics?.totals ?? {
    hydration: 0,
    protein: 0,
    carbohydrate: 0,
    calories: 0,
  };
  const targets = resolveTargets(metrics?.latest ?? null);
  const deficits = listHealthIntakeDeficits(totals, targets, prefs, logicalYmd);
  if (deficits.length === 0) return;

  const effectiveDeficits =
    prefs.mode === 'hydration_interval'
      ? deficits.filter(d => d.key === 'hydration')
      : deficits;
  if (effectiveDeficits.length === 0) return;

  const lastIntakeAt = parseHealthIntakeTimestamp(metrics?.latest?.created_at);
  const fireSlots = computeHealthIntakeFireAts({
    prefs,
    logicalYmd,
    now,
    lastIntakeAt,
  });
  if (fireSlots.length === 0) return;

  const copy = buildHealthIntakeReminderCopy(effectiveDeficits);
  const fingerprint = `${logicalYmd}|${prefs.mode}|${copy.deficitSummary}|${copy.primaryKey ?? ''}`;

  await ensureHealthIntakeReminderCategory();

  for (let i = 0; i < fireSlots.length; i++) {
    const slot = fireSlots[i]!;
    const id = healthIntakeReminderIdentifier(logicalYmd, i);
    const roleHint =
      slot.role === 'wrap' ? '收口' : slot.role === 'meal' ? '餐次' : '间隔';
    await scheduleDateReminder({
      category: 'health-intake-reminder',
      identifier: id,
      fireAt: slot.fireAt,
      channel: ANDROID_CHANNEL,
      categoryIdentifier: HEALTH_INTAKE_REMINDER_CATEGORY_ID,
      data: {
        type: 'health-intake-reminder',
        logicalYmd,
        primaryKey: copy.primaryKey,
        role: slot.role,
      },
      fallback: {
        title: copy.title,
        body: copy.body,
      },
      fingerprint: `${fingerprint}|${roleHint}|${i}`,
      contextBlock: [
        '【频道】健康摄入提醒',
        `【逻辑日】${logicalYmd}`,
        `【模式】${prefs.mode}`,
        `【角色】${roleHint}`,
        `【未达标】${copy.deficitSummary}`,
      ].join('\n'),
      strong: false,
    });
  }
}

/** 前台送达前：若已达标 / 无有效缺口则抑制展示 */
export async function shouldSuppressHealthIntakeReminderNotification(): Promise<boolean> {
  try {
    const user = await getDefaultUser();
    if (!user?.id) return true;
    const settings = await getNotificationCenterSettings();
    const boundary = await resolveDayBoundaryForPage('health');
    const logicalYmd = getLogicalLocalYmd(new Date(), boundary);
    const metrics = await getHealthDayMetricsForUser(user.id, logicalYmd, { cacheOnly: true });
    const totals = metrics?.totals ?? {
      hydration: 0,
      protein: 0,
      carbohydrate: 0,
      calories: 0,
    };
    const targets = resolveTargets(metrics?.latest ?? null);
    const deficits = listHealthIntakeDeficits(totals, targets, settings.health, logicalYmd);
    if (settings.health.mode === 'hydration_interval') {
      return deficits.every(d => d.key !== 'hydration');
    }
    return deficits.length === 0;
  } catch (e) {
    console.warn('判断健康提醒抑制失败', e);
    return false;
  }
}

/** 「稍后再说」：推迟 N 分钟后再排 */
export async function snoozeHealthIntakeReminder(
  minutes: number = HEALTH_INTAKE_SNOOZE_MINUTES,
): Promise<void> {
  const mins = Math.max(15, Math.min(240, Math.round(minutes)));
  const until = Date.now() + mins * 60_000;
  await patchNotificationCenterSettings({ health: { snoozeUntilMs: until } });
  await syncHealthIntakeReminderNotifications();
}

/** 「今日不催这项」：静音指定指标至本逻辑日结束 */
export async function muteHealthIntakeKeysForToday(
  keys: HealthIntakeFocusKey[],
  logicalYmd?: string,
): Promise<void> {
  const boundary = await resolveDayBoundaryForPage('health');
  const ymd = logicalYmd ?? getLogicalLocalYmd(new Date(), boundary);
  const settings = await getNotificationCenterSettings();
  const prevKeys =
    settings.health.dayMuteYmd === ymd ? settings.health.dayMuteKeys : [];
  const merged = Array.from(new Set([...prevKeys, ...keys]));
  await patchNotificationCenterSettings({
    health: { dayMuteYmd: ymd, dayMuteKeys: merged },
  });
  await syncHealthIntakeReminderNotifications();
}

export type HealthIntakeReminderStatusSummary = {
  kind: 'off' | 'met' | 'snoozed' | 'scheduled' | 'none';
  line: string;
  nextFireAt: Date | null;
  primaryLabel: string | null;
};

/** 健康页状态行：下次提醒 / 已达标 / 已推迟 */
export async function getHealthIntakeReminderStatusSummary(
  now: Date = new Date(),
): Promise<HealthIntakeReminderStatusSummary> {
  try {
    const settings = await getNotificationCenterSettings();
    if (!settings.masterEnabled || settings.categories['health-intake-reminder'] === false) {
      return { kind: 'off', line: '健康提醒已关闭', nextFireAt: null, primaryLabel: null };
    }

    const user = await getDefaultUser();
    if (!user?.id) {
      return { kind: 'none', line: '健康提醒未就绪', nextFireAt: null, primaryLabel: null };
    }

    const boundary = await resolveDayBoundaryForPage('health');
    const logicalYmd = getLogicalLocalYmd(now, boundary);
    const prefs = settings.health;
    if (prefs.snoozeUntilMs != null && prefs.snoozeUntilMs > now.getTime()) {
      const t = new Date(prefs.snoozeUntilMs);
      return {
        kind: 'snoozed',
        line: `稍后再说至 ${pad2(t.getHours())}:${pad2(t.getMinutes())}`,
        nextFireAt: t,
        primaryLabel: null,
      };
    }

    const metrics = await getHealthDayMetricsForUser(user.id, logicalYmd, { cacheOnly: true }).catch(
      () => null,
    );
    const totals: HealthIntakeDayTotals = metrics?.totals ?? {
      hydration: 0,
      protein: 0,
      carbohydrate: 0,
      calories: 0,
    };
    const targets = resolveTargets(metrics?.latest ?? null);
    const deficits = listHealthIntakeDeficits(totals, targets, prefs, logicalYmd);
    const effective =
      prefs.mode === 'hydration_interval'
        ? deficits.filter(d => d.key === 'hydration')
        : deficits;

    if (effective.length === 0) {
      return {
        kind: 'met',
        line: '今日关注项已达标，提醒已停',
        nextFireAt: null,
        primaryLabel: null,
      };
    }

    const lastIntakeAt = parseHealthIntakeTimestamp(metrics?.latest?.created_at);
    const slots = computeHealthIntakeFireAts({
      prefs,
      logicalYmd,
      now,
      lastIntakeAt,
    });
    const next = slots[0]?.fireAt ?? null;
    const primary = effective[0]!;
    if (!next) {
      return {
        kind: 'none',
        line: `主盯${primary.label} · 今日暂无后续提醒`,
        nextFireAt: null,
        primaryLabel: primary.label,
      };
    }
    return {
      kind: 'scheduled',
      line: `下次提醒 · ${pad2(next.getHours())}:${pad2(next.getMinutes())} · 主盯${primary.label}`,
      nextFireAt: next,
      primaryLabel: primary.label,
    };
  } catch (e) {
    console.warn('读取健康提醒状态失败', e);
    return { kind: 'none', line: '健康提醒状态暂不可用', nextFireAt: null, primaryLabel: null };
  }
}

export function isHealthIntakeActionIdentifier(actionId: string): boolean {
  return actionId === HEALTH_ACTION_SNOOZE || actionId === HEALTH_ACTION_MUTE_TODAY;
}

export function healthIntakePrimaryKeyFromData(
  data: Record<string, unknown> | null,
): HealthIntakeFocusKey | null {
  const k = data?.primaryKey;
  if (k === 'hydration' || k === 'protein' || k === 'carbohydrate' || k === 'calories') {
    return k;
  }
  return null;
}

export { healthFocusKeyLabel };
