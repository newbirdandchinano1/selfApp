/**
 * 今日系统通知已推计数（本地）：供通知中心「已推 / 剩余额度」展示，
 * 并与 delivery.maxSystemPerDay 对齐。
 */

import { AppSettingKey, getAppSettingFromCache, setAppSetting } from '@/lib/app-settings-store';
import { getNotificationCenterSettings } from '@/lib/notification-center-settings';
import { localYmdFromMs } from '@/lib/notification-delivery-policy';

export type NotificationDailyBudgetState = {
  ymd: string;
  deliveredCount: number;
};

function todayYmd(now: Date = new Date()): string {
  return localYmdFromMs(now.getTime());
}

function normalizeState(raw: unknown, now: Date = new Date()): NotificationDailyBudgetState {
  const ymd = todayYmd(now);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ymd, deliveredCount: 0 };
  }
  const o = raw as Record<string, unknown>;
  const storedYmd = typeof o.ymd === 'string' ? o.ymd : '';
  const count =
    typeof o.deliveredCount === 'number' && Number.isFinite(o.deliveredCount)
      ? Math.max(0, Math.floor(o.deliveredCount))
      : 0;
  if (storedYmd !== ymd) return { ymd, deliveredCount: 0 };
  return { ymd, deliveredCount: count };
}

export async function getNotificationDailyBudgetState(
  now: Date = new Date(),
): Promise<NotificationDailyBudgetState> {
  const raw = await getAppSettingFromCache<unknown>(AppSettingKey.notificationDailyBudget);
  return normalizeState(raw, now);
}

/** 系统通知实际送达（横幅路径）时 +1；安静模式/仅 Inbox 可不计。 */
export async function recordNotificationSystemDelivered(
  now: Date = new Date(),
): Promise<NotificationDailyBudgetState> {
  const current = await getNotificationDailyBudgetState(now);
  const next: NotificationDailyBudgetState = {
    ymd: current.ymd,
    deliveredCount: current.deliveredCount + 1,
  };
  try {
    await setAppSetting(AppSettingKey.notificationDailyBudget, next);
  } catch {
    /* ignore */
  }
  return next;
}

export type NotificationBudgetSnapshot = {
  ymd: string;
  deliveredCount: number;
  maxSystemPerDay: number;
  remaining: number;
  inboxOnly: boolean;
};

/** 通知中心展示用快照 */
export async function getNotificationBudgetSnapshot(
  now: Date = new Date(),
): Promise<NotificationBudgetSnapshot> {
  const [state, settings] = await Promise.all([
    getNotificationDailyBudgetState(now),
    getNotificationCenterSettings(),
  ]);
  const max = settings.delivery.maxSystemPerDay;
  return {
    ymd: state.ymd,
    deliveredCount: state.deliveredCount,
    maxSystemPerDay: max,
    remaining: Math.max(0, max - state.deliveredCount),
    inboxOnly: settings.delivery.inboxOnly === true,
  };
}
