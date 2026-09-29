/**
 * 本地通知统一排期层：权限、Android 通道、按前缀取消、DATE 登记 + 文案解析。
 * 业务侧只声明「何时 / 给谁 / 哪一类」，不复制样板。
 */

import type { NotificationCategoryId } from '@/lib/notification-catalog';
import { getNotificationCategoryMeta } from '@/lib/notification-catalog';
import { resolveNotificationAiCopy } from '@/lib/notification-ai-copy';
import { canScheduleAppNotification } from '@/lib/notification-center-settings';
import { isExpoSandboxNotificationDisabled } from '@/lib/notification-policy';
import {
  computeEscalationFireAts,
  ensureStrongReminderNotificationCategory,
  escalationIdentifier,
  isStrongReminderCategory,
  maxStrongEscalationWave,
  STRONG_REMINDER_CATEGORY_ID,
  STRONG_REMINDER_SOUND,
  stripReminderAccessorySuffix,
} from '@/lib/notification-strong-reminder';
import { Platform } from 'react-native';

export type AndroidChannelConfig = {
  id: string;
  name: string;
  importance?: 'default' | 'high';
  vibrationPattern?: number[];
};

export type ScheduleDateReminderParams = {
  category: NotificationCategoryId;
  identifier: string;
  fireAt: Date;
  channel: AndroidChannelConfig;
  /** 须含 `type`，与 catalog / Router 一致 */
  data: Record<string, unknown>;
  fallback: { title: string; body: string };
  fingerprint: string;
  contextBlock: string;
  sound?: boolean;
  /**
   * 强提醒：iOS Time Sensitive + 自定义铃声 + 完成/贪睡 Action + 未确认升级。
   * 默认：习惯 / 日程格 / 每日复盘为 true。
   */
  strong?: boolean;
};

export type ScheduleDateReminderResult = {
  scheduled: boolean;
  permissionDenied: boolean;
};

const PAST_SLACK_MS = 2000;

/** Web / Expo Go 沙箱：不登记本地通知。 */
export function isLocalNotificationSchedulingUnavailable(): boolean {
  return Platform.OS === 'web' || isExpoSandboxNotificationDisabled();
}

export async function loadExpoNotifications(): Promise<
  typeof import('expo-notifications') | null
> {
  if (isLocalNotificationSchedulingUnavailable()) return null;
  try {
    return await import('expo-notifications');
  } catch (e) {
    console.warn('expo-notifications 不可用', e);
    return null;
  }
}

export async function ensureNotificationPermission(
  Notifications?: typeof import('expo-notifications'),
): Promise<boolean> {
  const mod = Notifications ?? (await loadExpoNotifications());
  if (!mod) return false;
  const perm = await mod.getPermissionsAsync();
  let granted = perm.status === 'granted';
  if (!granted && perm.canAskAgain !== false) {
    const req = await mod.requestPermissionsAsync({
      ios: {
        allowAlert: true,
        allowBadge: true,
        allowSound: true,
        provideAppNotificationSettings: true,
      },
    });
    granted = req.status === 'granted';
  }
  return granted;
}

export async function ensureAndroidNotificationChannel(
  channel: AndroidChannelConfig,
  Notifications?: typeof import('expo-notifications'),
): Promise<void> {
  if (Platform.OS !== 'android') return;
  const mod = Notifications ?? (await loadExpoNotifications());
  if (!mod) return;
  const importance =
    channel.importance === 'high'
      ? mod.AndroidImportance.HIGH
      : mod.AndroidImportance.DEFAULT;
  await mod.setNotificationChannelAsync(channel.id, {
    name: channel.name,
    importance,
    vibrationPattern: channel.vibrationPattern ?? [0, 200, 120, 200],
    lockscreenVisibility: mod.AndroidNotificationVisibility.PUBLIC,
  });
}

/**
 * 取消主 identifier，并清掉其升级链（`id:esc:N`）。
 */
export async function cancelScheduledByIdentifier(identifier: string): Promise<void> {
  if (isLocalNotificationSchedulingUnavailable()) return;
  const raw = identifier.trim();
  if (!raw) return;
  const id = stripReminderAccessorySuffix(raw);
  try {
    const Notifications = await loadExpoNotifications();
    if (!Notifications) return;
    const pending = await Notifications.getAllScheduledNotificationsAsync();
    const toCancel = pending
      .map(r => r.identifier)
      .filter(
        (ident): ident is string =>
          typeof ident === 'string' && (ident === id || ident.startsWith(`${id}:`)),
      );
    if (!toCancel.includes(id)) toCancel.push(id);
    await Promise.all(
      toCancel.map(ident =>
        Notifications.cancelScheduledNotificationAsync(ident).catch(() => undefined),
      ),
    );
  } catch {
    /* 无已登记通知时忽略 */
  }
}

export async function cancelScheduledByPrefix(prefix: string): Promise<void> {
  if (isLocalNotificationSchedulingUnavailable()) return;
  const p = prefix.trim();
  if (!p) return;
  try {
    const Notifications = await loadExpoNotifications();
    if (!Notifications) return;
    const pending = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(
      pending
        .filter(r => typeof r.identifier === 'string' && r.identifier.startsWith(p))
        .map(r => Notifications.cancelScheduledNotificationAsync(r.identifier)),
    );
  } catch (e) {
    console.warn('按前缀取消通知失败', p, e);
  }
}

/** 按 catalog 中的 identifierPrefix 取消该类全部预约。 */
export async function cancelScheduledByCategory(
  category: NotificationCategoryId,
): Promise<void> {
  const prefix = getNotificationCategoryMeta(category).identifierPrefix;
  if (!prefix) return;
  await cancelScheduledByPrefix(prefix);
}

/**
 * 登记一条 DATE 本地通知：门禁 → 权限 → 通道 → 文案 → schedule。
 * `fireAt` 已过（含 2s 余量）则跳过。
 * 强提醒时额外登记 +5 / +15 分钟升级，并挂上完成/贪睡 Action。
 */
export async function scheduleDateReminder(
  params: ScheduleDateReminderParams,
): Promise<ScheduleDateReminderResult> {
  if (isLocalNotificationSchedulingUnavailable()) {
    return { scheduled: false, permissionDenied: false };
  }

  if (params.fireAt.getTime() <= Date.now() + PAST_SLACK_MS) {
    return { scheduled: false, permissionDenied: false };
  }

  if (
    !(await canScheduleAppNotification({
      category: params.category,
      identifier: params.identifier,
    }))
  ) {
    return { scheduled: false, permissionDenied: false };
  }

  const Notifications = await loadExpoNotifications();
  if (!Notifications) {
    return { scheduled: false, permissionDenied: false };
  }

  if (!(await ensureNotificationPermission(Notifications))) {
    return { scheduled: false, permissionDenied: true };
  }

  await ensureAndroidNotificationChannel(params.channel, Notifications);

  const useStrong =
    params.strong ?? isStrongReminderCategory(params.category);

  if (useStrong) {
    await ensureStrongReminderNotificationCategory(Notifications);
  }

  // 重登记前清掉旧升级链，避免残留
  await cancelScheduledByIdentifier(params.identifier);

  const copy = await resolveNotificationAiCopy({
    identifier: params.identifier,
    fingerprint: params.fingerprint,
    fallback: params.fallback,
    contextBlock: params.contextBlock,
  });

  const maxWave = useStrong ? maxStrongEscalationWave() : 0;
  const baseData: Record<string, unknown> = {
    ...params.data,
    type: params.data.type,
    strong: useStrong,
    escalationWave: 0,
    maxEscalationWave: maxWave,
    baseIdentifier: params.identifier,
    disposeTitle: copy.title,
    disposeBody: copy.body,
    channelId: params.channel.id,
    channelName: params.channel.name,
    channelImportance: params.channel.importance ?? 'default',
    category: params.category,
    fingerprint: params.fingerprint,
    contextBlock: params.contextBlock,
  };

  const iosStrong = useStrong && Platform.OS === 'ios';
  const contentBase = {
    title: copy.title,
    body: copy.body,
    sound: iosStrong
      ? STRONG_REMINDER_SOUND
      : params.sound !== false,
    ...(useStrong
      ? { categoryIdentifier: STRONG_REMINDER_CATEGORY_ID }
      : {}),
    ...(iosStrong ? { interruptionLevel: 'timeSensitive' as const } : {}),
  };

  try {
    await Notifications.scheduleNotificationAsync({
      identifier: params.identifier,
      content: {
        ...contentBase,
        data: baseData,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: params.fireAt,
        channelId: Platform.OS === 'android' ? params.channel.id : undefined,
      },
    });

    if (useStrong) {
      const escalations = computeEscalationFireAts(params.fireAt, Date.now(), PAST_SLACK_MS);
      await Promise.all(
        escalations.map(({ wave, fireAt }) =>
          Notifications.scheduleNotificationAsync({
            identifier: escalationIdentifier(params.identifier, wave),
            content: {
              ...contentBase,
              body: `再次提醒：${copy.body}`,
              data: {
                ...baseData,
                escalationWave: wave,
                disposeBody: `再次提醒：${copy.body}`,
              },
            },
            trigger: {
              type: Notifications.SchedulableTriggerInputTypes.DATE,
              date: fireAt,
              channelId: Platform.OS === 'android' ? params.channel.id : undefined,
            },
          }),
        ),
      );
    }

    return { scheduled: true, permissionDenied: false };
  } catch (e) {
    console.warn('登记本地通知失败', params.identifier, e);
    return { scheduled: false, permissionDenied: false };
  }
}
