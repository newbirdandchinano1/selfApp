/**
 * 提醒统一排期层：门禁 + 送达策略 + 上报服务端 reminder_jobs。
 * 不再登记本地 DATE 通知（避免杀进程后 Inbox 漏写 / 与推送双弹）。
 * 业务侧只声明「何时 / 给谁 / 哪一类」。
 */

import type { NotificationCategoryId } from '@/lib/notification-catalog';
import { getNotificationCategoryMeta } from '@/lib/notification-catalog';
import { resolveNotificationAiCopy } from '@/lib/notification-ai-copy';
import {
  canScheduleAppNotification,
  getNotificationCenterSettings,
} from '@/lib/notification-center-settings';
import {
  categoryDeliveryPriority,
  isWrapNotificationData,
  planNotificationFireAts,
  resolveDeliveryStrong,
  type DeliveryPolicyPrefs,
  type FirePlanCandidate,
} from '@/lib/notification-delivery-policy';
import { isExpoSandboxNotificationDisabled } from '@/lib/notification-policy';
import {
  isStrongEligibleCategory,
  maxStrongEscalationWave,
  stripReminderAccessorySuffix,
} from '@/lib/notification-strong-reminder';
import {
  enqueueReminderJobsCancel,
  enqueueReminderJobsUpsert,
  flushReminderJobsQueue,
} from '@/lib/reminder-jobs-client';
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
   * 强提醒：服务端高优先级推送 + 派发时挂升级 follow-up job。
   * P0：默认 false；仅业务显式传 true（如习惯 intensity=strong）。
   */
  strong?: boolean;
  /**
   * 非强提醒时可选挂自定义 Action 类别（推送端可能忽略）。
   */
  categoryIdentifier?: string;
};

export type ScheduleDateReminderResult = {
  scheduled: boolean;
  permissionDenied: boolean;
};

/** 本轮登记上下文（兼容旧调用；服务端路径下可为空壳）。 */
export type NotificationScheduleSession = {
  Notifications: NonNullable<Awaited<ReturnType<typeof loadExpoNotifications>>> | null;
  permissionGranted: boolean;
  ensuredChannelIds: Set<string>;
  strongCategoryReady: boolean;
};

export type ScheduleDateReminderOptions = {
  /** 外层已按前缀/identifier 清过时跳过内部 cancel */
  skipCancel?: boolean;
  session?: NotificationScheduleSession | null;
  /** 外层已跑过 planNotificationFireAts 时跳过，避免双重错峰 */
  skipDeliveryPolicy?: boolean;
};

export type ScheduleDateRemindersBulkOptions = {
  skipCancel?: boolean;
  concurrency?: number;
};

export { isGlobalQuietHoursNow } from '@/lib/notification-center-settings';

function resolveStrongForItem(
  item: Pick<ScheduleDateReminderParams, 'category' | 'strong'>,
  prefs: DeliveryPolicyPrefs,
): boolean {
  return resolveDeliveryStrong({
    intensity: prefs.intensity,
    explicit: item.strong,
    categoryEligible: isStrongEligibleCategory(item.category),
  });
}

function toFirePlanCandidate(
  item: ScheduleDateReminderParams,
  prefs: DeliveryPolicyPrefs,
): FirePlanCandidate {
  const strong = resolveStrongForItem(item, prefs);
  return {
    id: item.identifier,
    category: item.category,
    fireAtMs: item.fireAt.getTime(),
    priority: categoryDeliveryPriority(item.category) + (strong ? -5 : 0),
    isWrap: isWrapNotificationData(item.data),
    strong,
  };
}

async function resolveDeliveryPrefs(): Promise<DeliveryPolicyPrefs> {
  const settings = await getNotificationCenterSettings();
  return settings.delivery;
}

const PAST_SLACK_MS = 2000;
const DEFAULT_BULK_CONCURRENCY = 6;
const MIN_BULK_CONCURRENCY = 4;
const MAX_BULK_CONCURRENCY = 8;

/** Web / Expo Go：不挂本地系统通知模块（推送 token / 本地 schedule）。 */
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

export async function createNotificationScheduleSession(): Promise<NotificationScheduleSession | null> {
  const Notifications = await loadExpoNotifications();
  const permissionGranted = Notifications
    ? await ensureNotificationPermission(Notifications)
    : true; // 无本地模块时仍允许上报服务端 jobs
  return {
    Notifications,
    permissionGranted,
    ensuredChannelIds: new Set<string>(),
    strongCategoryReady: false,
  };
}

/**
 * 启动时一次性清掉本机全部 DATE 预约（旧版本地 schedule 残留），避免与 Expo Push 双弹。
 * 新路径只上报服务端 jobs，不再登记本地。
 */
export async function clearAllLegacyLocalScheduledNotifications(): Promise<void> {
  if (isLocalNotificationSchedulingUnavailable()) return;
  try {
    const Notifications = await loadExpoNotifications();
    if (!Notifications) return;
    await Notifications.cancelAllScheduledNotificationsAsync();
  } catch (e) {
    console.warn('清理遗留本地预约通知失败', e);
  }
}

/** 清掉本机残留的旧 DATE 预约，避免与推送双弹。 */
async function clearLegacyLocalByIdentifier(identifier: string): Promise<void> {
  if (isLocalNotificationSchedulingUnavailable()) return;
  const id = stripReminderAccessorySuffix(identifier.trim());
  if (!id) return;
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
    /* ignore */
  }
}

async function clearLegacyLocalByPrefixes(prefixes: string[]): Promise<void> {
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
    console.warn('按前缀清理遗留本地通知失败', cleaned, e);
  }
}

/**
 * 取消主 identifier（服务端 jobs + 遗留本地）。
 */
export async function cancelScheduledByIdentifier(identifier: string): Promise<void> {
  const raw = identifier.trim();
  if (!raw) return;
  const id = stripReminderAccessorySuffix(raw);
  enqueueReminderJobsCancel({ dedupeKeys: [id] });
  await clearLegacyLocalByIdentifier(id);
}

/** 按多个前缀批量取消。 */
export async function cancelScheduledByPrefixes(prefixes: string[]): Promise<void> {
  const cleaned = [
    ...new Set(prefixes.map(p => p.trim()).filter((p): p is string => p.length > 0)),
  ];
  if (cleaned.length === 0) return;
  enqueueReminderJobsCancel({ prefixes: cleaned });
  await clearLegacyLocalByPrefixes(cleaned);
}

export async function cancelScheduledByPrefix(prefix: string): Promise<void> {
  await cancelScheduledByPrefixes([prefix]);
}

/** 按 catalog 中的 identifierPrefix 取消该类全部预约。 */
export async function cancelScheduledByCategory(
  category: NotificationCategoryId,
): Promise<void> {
  const prefix = getNotificationCategoryMeta(category).identifierPrefix;
  if (prefix) {
    await cancelScheduledByPrefixes([prefix]);
  }
  enqueueReminderJobsCancel({ replaceCategories: [category] });
  await flushReminderJobsQueue();
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
 * 登记一条提醒：门禁 → 送达策略 → 文案 → 上报服务端 jobs。
 * 强提醒升级波由服务端派发主波时插入 follow-up。
 */
export async function scheduleDateReminder(
  params: ScheduleDateReminderParams,
  options?: ScheduleDateReminderOptions,
): Promise<ScheduleDateReminderResult> {
  const deliveryPrefs = await resolveDeliveryPrefs();
  let fireAt = params.fireAt;
  if (!options?.skipDeliveryPolicy) {
    const planned = planNotificationFireAts(
      [toFirePlanCandidate(params, deliveryPrefs)],
      deliveryPrefs,
      [],
    );
    const plan = planned[0];
    if (!plan || plan.mode === 'drop') {
      return { scheduled: false, permissionDenied: false };
    }
    fireAt = new Date(plan.fireAtMs);
  }

  if (fireAt.getTime() <= Date.now() + PAST_SLACK_MS) {
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

  const useStrong = resolveStrongForItem(params, deliveryPrefs);
  const baseId = stripReminderAccessorySuffix(params.identifier);

  if (!options?.skipCancel) {
    await cancelScheduledByIdentifier(baseId);
  } else {
    await clearLegacyLocalByIdentifier(baseId);
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
    baseIdentifier: baseId,
    disposeTitle: copy.title,
    disposeBody: copy.body,
    channelId: params.channel.id,
    channelName: params.channel.name,
    channelImportance: params.channel.importance ?? 'default',
    category: params.category,
    fingerprint: params.fingerprint,
    contextBlock: params.contextBlock,
  };

  enqueueReminderJobsUpsert([
    {
      dedupeKey: baseId,
      category: params.category,
      fireAt: fireAt.toISOString(),
      title: copy.title,
      body: copy.body,
      payload: baseData,
      strong: useStrong,
    },
  ]);

  return { scheduled: true, permissionDenied: false };
}

/**
 * 批量登记提醒：送达策略规划 + 有限并发上报服务端。
 * 外层若已 `cancelScheduledByPrefixes`，请传 `skipCancel: true`。
 */
export async function scheduleDateRemindersBulk(
  items: ScheduleDateReminderParams[],
  options?: ScheduleDateRemindersBulkOptions,
): Promise<{ permissionDenied: boolean; scheduledCount: number }> {
  if (items.length === 0) {
    return { permissionDenied: false, scheduledCount: 0 };
  }

  const prefs = await resolveDeliveryPrefs();
  const planned = planNotificationFireAts(
    items.map(i => toFirePlanCandidate(i, prefs)),
    prefs,
    [],
  );
  const planById = new Map(planned.map(p => [p.id, p]));

  const concurrency = clampBulkConcurrency(options?.concurrency ?? DEFAULT_BULK_CONCURRENCY);
  const skipCancel = options?.skipCancel === true;
  let scheduledCount = 0;

  await mapWithConcurrency(items, concurrency, async item => {
    const plan = planById.get(item.identifier);
    if (!plan || plan.mode === 'drop') return;
    const result = await scheduleDateReminder(
      { ...item, fireAt: new Date(plan.fireAtMs) },
      { skipCancel, skipDeliveryPolicy: true },
    );
    if (result.scheduled) scheduledCount += 1;
  });

  await flushReminderJobsQueue();
  return { permissionDenied: false, scheduledCount };
}
