/**
 * 健康摄入本地提醒（四时段进度阈值）：
 * - 早 / 午 / 下午 / 晚 检查点对比期望进度线，未跟上才催
 * - 关注项过滤、免打扰延后、稍后再说、今日不催
 * - 每日最多 2 条未来预约；跟上进度后取消
 */

import { buildNotificationIdentifier } from '@/lib/notification-catalog';
import {
  getNotificationCenterSettings,
  healthFocusKeyLabel,
  healthIntakePeriodLabel,
  patchNotificationCenterSettings,
  type HealthIntakeFocusKey,
  type HealthIntakeReminderPrefs,
} from '@/lib/notification-center-settings';
import { buildHealthIntakeCopy } from '@/lib/notification-copy-templates';
import {
  buildHealthIntakeReminderCopy,
  computeHealthIntakeFireAts,
  deferOutOfQuietHours,
  isInQuietHours,
  listHealthIntakePeriodDeficits,
  parseHealthIntakeTimestamp,
  resolveExpectedRatioAt,
  MAX_HEALTH_INTAKE_REMINDERS_PER_DAY,
  HEALTH_INTAKE_SNOOZE_MINUTES,
  type HealthIntakeDeficit,
  type HealthIntakeFireSlot,
  type HealthIntakePeriodId,
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
  listHealthIntakePeriodDeficits,
  parseHealthIntakeTimestamp,
  resolveExpectedRatioAt,
  MAX_HEALTH_INTAKE_REMINDERS_PER_DAY,
  HEALTH_INTAKE_SNOOZE_MINUTES,
};
export type { HealthIntakeDeficit, HealthIntakeFireSlot, HealthIntakePeriodId };

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
 * 按当前摄入与时段偏好重新登记健康提醒。
 * 已跟上各未来时段期望线 / 关注项均静音后取消当天后续。
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
  const dayTargets = resolveTargets(metrics?.latest ?? null);

  const fireSlots = computeHealthIntakeFireAts({
    prefs,
    logicalYmd,
    now,
    totals,
    dayTargets,
  });
  if (fireSlots.length === 0) return;

  await ensureHealthIntakeReminderCategory();

  const unitByKey: Record<HealthIntakeFocusKey, string> = {
    hydration: 'ml',
    protein: 'g',
    carbohydrate: 'g',
    calories: 'kcal',
  };
  const hintByKey: Record<HealthIntakeFocusKey, string> = {
    hydration: '喝一口就补上',
    protein: '记一餐就补上',
    carbohydrate: '记一餐就补上',
    calories: '看一眼今日摄入',
  };

  for (let i = 0; i < fireSlots.length; i++) {
    const slot = fireSlots[i]!;
    const deficits = listHealthIntakePeriodDeficits({
      totals,
      dayTargets,
      expectedRatio: slot.expectedRatio,
      prefs,
      logicalYmd,
    });
    if (deficits.length === 0) continue;

    const base = buildHealthIntakeReminderCopy(deficits);
    const periodLabel = healthIntakePeriodLabel(slot.periodId);
    const baseFingerprint = `${logicalYmd}|period|${slot.periodId}|${base.deficitSummary}|${base.primaryKey ?? ''}`;
    const id = healthIntakeReminderIdentifier(logicalYmd, i);
    const primary = deficits[0];
    const varied = primary
      ? buildHealthIntakeCopy({
          primaryLabel: primary.label,
          remainText: `${Math.round(primary.remain)}${unitByKey[primary.key]}`,
          progress: `${Math.round(primary.current)}/${Math.round(primary.target)}${unitByKey[primary.key]}`,
          hint: hintByKey[primary.key],
          otherLabels: deficits.slice(1).map(d => d.label),
          role: slot.periodId,
          seed: `${baseFingerprint}|${slot.periodId}|${i}`,
        })
      : { title: base.title, body: base.body };

    await scheduleDateReminder({
      category: 'health-intake-reminder',
      identifier: id,
      fireAt: slot.fireAt,
      channel: ANDROID_CHANNEL,
      categoryIdentifier: HEALTH_INTAKE_REMINDER_CATEGORY_ID,
      data: {
        type: 'health-intake-reminder',
        logicalYmd,
        primaryKey: base.primaryKey,
        role: slot.periodId,
        periodId: slot.periodId,
        expectedRatio: slot.expectedRatio,
      },
      fallback: {
        title: varied.title,
        body: varied.body,
      },
      fingerprint: `${baseFingerprint}|${periodLabel}|${i}`,
      contextBlock: [
        '【频道】健康摄入提醒',
        `【逻辑日】${logicalYmd}`,
        `【时段】${periodLabel}`,
        `【期望进度】${Math.round(slot.expectedRatio * 100)}%`,
        `【未跟上】${base.deficitSummary}`,
      ].join('\n'),
      strong: false,
    });
  }
}

/** 前台送达前：若已跟上此刻期望进度 / 无有效缺口则抑制展示 */
export async function shouldSuppressHealthIntakeReminderNotification(): Promise<boolean> {
  try {
    const user = await getDefaultUser();
    if (!user?.id) return true;
    const settings = await getNotificationCenterSettings();
    const boundary = await resolveDayBoundaryForPage('health');
    const now = new Date();
    const logicalYmd = getLogicalLocalYmd(now, boundary);
    const metrics = await getHealthDayMetricsForUser(user.id, logicalYmd, { cacheOnly: true });
    const totals = metrics?.totals ?? {
      hydration: 0,
      protein: 0,
      carbohydrate: 0,
      calories: 0,
    };
    const dayTargets = resolveTargets(metrics?.latest ?? null);
    const ratio = resolveExpectedRatioAt(now, settings.health.periods);
    const deficits = listHealthIntakePeriodDeficits({
      totals,
      dayTargets,
      expectedRatio: ratio,
      prefs: settings.health,
      logicalYmd,
    });
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

/** 健康页状态行：下次提醒 / 已跟上 / 已推迟 */
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
    const dayTargets = resolveTargets(metrics?.latest ?? null);

    const slots = computeHealthIntakeFireAts({
      prefs,
      logicalYmd,
      now,
      totals,
      dayTargets,
    });
    const next = slots[0] ?? null;
    if (!next) {
      const nowDeficits = listHealthIntakePeriodDeficits({
        totals,
        dayTargets,
        expectedRatio: resolveExpectedRatioAt(now, prefs.periods),
        prefs,
        logicalYmd,
      });
      if (nowDeficits.length === 0) {
        return {
          kind: 'met',
          line: '此时进度已跟上，提醒已停',
          nextFireAt: null,
          primaryLabel: null,
        };
      }
      return {
        kind: 'none',
        line: `主盯${nowDeficits[0]!.label} · 今日暂无后续提醒`,
        nextFireAt: null,
        primaryLabel: nowDeficits[0]!.label,
      };
    }

    const nextDeficits = listHealthIntakePeriodDeficits({
      totals,
      dayTargets,
      expectedRatio: next.expectedRatio,
      prefs,
      logicalYmd,
    });
    const primary = nextDeficits[0];
    const periodLabel = healthIntakePeriodLabel(next.periodId);
    return {
      kind: 'scheduled',
      line: `下次 · ${periodLabel} ${pad2(next.fireAt.getHours())}:${pad2(next.fireAt.getMinutes())}${
        primary ? ` · 主盯${primary.label}` : ''
      }`,
      nextFireAt: next.fireAt,
      primaryLabel: primary?.label ?? null,
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
