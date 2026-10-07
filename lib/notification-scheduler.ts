/**
 * 本地通知统一排期层：权限、Android 通道、按前缀取消、DATE 登记 + 文案解析。
 * 业务侧只声明「何时 / 给谁 / 哪一类」，不复制样板。
 *
 * 批量模式（P1）：一次扫表 cancel、skipCancel、门禁复用、有限并发登记。
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

/** 本轮登记上下文：复用 Notifications 模块、权限结果与已确保的通道。 */
export type NotificationScheduleSession = {
  Notifications: NonNullable<Awaited<ReturnType<typeof loadExpoNotifications>>>;
  permissionGranted: boolean;
  ensuredChannelIds: Set<string>;
  strongCategoryReady: boolean;
};

export type ScheduleDateReminderOptions = {
  /** 外层已按前缀/identifier 清过时跳过内部 cancel，避免再扫全表 */
  skipCancel?: boolean;
  /** 复用本轮门禁（权限 / 通道 / 强提醒 category） */
  session?: NotificationScheduleSession | null;
};

export type ScheduleDateRemindersBulkOptions = {
  skipCancel?: boolean;
  /** 并发度，默认 6，钳制在 4～8 */
  concurrency?: number;
};

const PAST_SLACK_MS = 2000;
const DEFAULT_BULK_CONCURRENCY = 6;
const MIN_BULK_CONCURRENCY = 4;
const MAX_BULK_CONCURRENCY = 8;

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
 * 打开本轮排期会话：单次加载模块并问权限。
 * 通道 / 强提醒 category 在首次用到时写入 session。
 */
export async function createNotificationScheduleSession(): Promise<NotificationScheduleSession | null> {
  const Notifications = await loadExpoNotifications();
  if (!Notifications) return null;
  const permissionGranted = await ensureNotificationPermission(Notifications);
  return {
    Notifications,
    permissionGranted,
    ensuredChannelIds: new Set<string>(),
    strongCategoryReady: false,
  };
}

async function ensureChannelOnSession(
  session: NotificationScheduleSession,
  channel: AndroidChannelConfig,
): Promise<void> {
  if (Platform.OS !== 'android') return;
  if (session.ensuredChannelIds.has(channel.id)) return;
  await ensureAndroidNotificationChannel(channel, session.Notifications);
  session.ensuredChannelIds.add(channel.id);
}

async function ensureStrongCategoryOnSession(
  session: NotificationScheduleSession,
): Promise<void> {
  if (session.strongCategoryReady) return;
  await ensureStrongReminderNotificationCategory(session.Notifications);
  session.strongCategoryReady = true;
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

/** 一次扫表，按多个前缀批量取消（任一前缀命中即取消）。 */
export async function cancelScheduledByPrefixes(prefixes: string[]): Promise<void> {
  if (isLocalNotificationSchedulingUnavailable()) return;
  const cleaned = [
    ...new Set(prefixes.map(p => p.trim()).filter((p): p is string => p.length > 0)),
  ];
  if (cleaned.length === 0) return;
  try {
    const Notifications = await loadExpoNotifications();
    if (!Notifications) return;
    const pending = await Notifications.getAllScheduledNotificationsAsync();
    const toCancel = pending
      .map(r => r.identifier)
      .filter(
        (ident): ident is string =>
          typeof ident === 'string' && cleaned.some(p => ident.startsWith(p)),
      );
    if (toCancel.length === 0) return;
    await Promise.all(
      toCancel.map(ident =>
        Notifications.cancelScheduledNotificationAsync(ident).catch(() => undefined),
      ),
    );
  } catch (e) {
    console.warn('按前缀批量取消通知失败', cleaned, e);
  }
}

export async function cancelScheduledByPrefix(prefix: string): Promise<void> {
  await cancelScheduledByPrefixes([prefix]);
}

/** 按 catalog 中的 identifierPrefix 取消该类全部预约。 */
export async function cancelScheduledByCategory(
  category: NotificationCategoryId,
): Promise<void> {
  const prefix = getNotificationCategoryMeta(category).identifierPrefix;
  if (!prefix) return;
  await cancelScheduledByPrefix(prefix);
}

function clampBulkConcurrency(n: number | undefined): number {
  const raw = Number.isFinite(n) ? Math.floor(n as number) : DEFAULT_BULK_CONCURRENCY;
  return Math.max(MIN_BULK_CONCURRENCY, Math.min(MAX_BULK_CONCURRENCY, raw || DEFAULT_BULK_CONCURRENCY));
}

/** 有限并发执行；保持结果顺序与输入一致。 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const limit = Math.max(1, Math.min(Math.floor(concurrency) || 1, items.length));
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function runWorker(): Promise<void> {
    while (true) {
      const i = nextIndex;
      nextIndex += 1;
      if (i >= items.length) return;
      results[i] = await worker(items[i]!, i);
    }
  }

  await Promise.all(Array.from({ length: limit }, () => runWorker()));
  return results;
}

/**
 * 登记一条 DATE 本地通知：门禁 → 权限 → 通道 → 文案 → schedule。
 * `fireAt` 已过（含 2s 余量）则跳过。
 * 强提醒时额外登记 +5 / +15 分钟升级，并挂上完成/贪睡 Action。
 */
export async function scheduleDateReminder(
  params: ScheduleDateReminderParams,
  options?: ScheduleDateReminderOptions,
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

  const session = options?.session ?? null;
  const Notifications = session?.Notifications ?? (await loadExpoNotifications());
  if (!Notifications) {
    return { scheduled: false, permissionDenied: false };
  }

  if (session) {
    if (!session.permissionGranted) {
      return { scheduled: false, permissionDenied: true };
    }
  } else if (!(await ensureNotificationPermission(Notifications))) {
    return { scheduled: false, permissionDenied: true };
  }

  if (session) {
    await ensureChannelOnSession(session, params.channel);
  } else {
    await ensureAndroidNotificationChannel(params.channel, Notifications);
  }

  const useStrong =
    params.strong ?? isStrongReminderCategory(params.category);

  if (useStrong) {
    if (session) {
      await ensureStrongCategoryOnSession(session);
    } else {
      await ensureStrongReminderNotificationCategory(Notifications);
    }
  }

  // 重登记前清掉旧升级链，避免残留（bulk 路径外层已清前缀时可 skip）
  if (!options?.skipCancel) {
    await cancelScheduledByIdentifier(params.identifier);
  }

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

/**
 * 批量登记 DATE 提醒：单次门禁会话 + 有限并发。
 * 外层若已 `cancelScheduledByPrefixes`，请传 `skipCancel: true`。
 */
export async function scheduleDateRemindersBulk(
  items: ScheduleDateReminderParams[],
  options?: ScheduleDateRemindersBulkOptions,
): Promise<{ permissionDenied: boolean; scheduledCount: number }> {
  if (items.length === 0) {
    return { permissionDenied: false, scheduledCount: 0 };
  }

  const session = await createNotificationScheduleSession();
  if (!session) {
    return { permissionDenied: false, scheduledCount: 0 };
  }
  if (!session.permissionGranted) {
    return { permissionDenied: true, scheduledCount: 0 };
  }

  const concurrency = clampBulkConcurrency(options?.concurrency ?? DEFAULT_BULK_CONCURRENCY);
  const skipCancel = options?.skipCancel === true;
  let permissionDenied = false;
  let scheduledCount = 0;

  await mapWithConcurrency(items, concurrency, async item => {
    const result = await scheduleDateReminder(item, { skipCancel, session });
    if (result.permissionDenied) permissionDenied = true;
    if (result.scheduled) scheduledCount += 1;
  });

  return { permissionDenied, scheduledCount };
}
