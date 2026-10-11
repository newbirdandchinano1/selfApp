/**
 * 本地通知 → 收件箱写入（含 suppress / 频道开关双重校验）。
 * 供 NotificationRouter received / response 共用。
 */

import { shouldSuppressDailyReviewReminderNotification } from '@/lib/daily-review-reminder-notifications';
import { shouldSuppressHabitReminderNotification } from '@/lib/habit-reminder-notifications';
import { shouldSuppressHealthIntakeReminderNotification } from '@/lib/health-intake-reminder-notifications';
import {
  resolveNotificationCategoryFromData,
  resolveNotificationCategoryFromIdentifier,
  type NotificationCategoryId,
} from '@/lib/notification-catalog';
import { isNotificationCategoryAllowed } from '@/lib/notification-center-settings';
import { isExpoSandboxNotificationDisabled } from '@/lib/notification-policy';
import { shouldSkipInboxIngestByGate } from '@/lib/notification-inbox-ingest-rules';
import {
  upsertInboxFromNotification,
  type NotificationInboxRow,
} from '@/lib/repositories/notifications/notification-inbox';
import { stripReminderAccessorySuffix } from '@/lib/notification-strong-reminder';
import type { Notification } from 'expo-notifications';

export { shouldSkipInboxIngestByGate } from '@/lib/notification-inbox-ingest-rules';

/** 强提醒升级 / 贪睡 suffix 归一到同一 dedupe_key。 */
export function resolveInboxDedupeKeyFromParts(params: {
  identifier?: string | null;
  baseIdentifier?: string | null;
}): string {
  const base =
    typeof params.baseIdentifier === 'string' && params.baseIdentifier.trim()
      ? params.baseIdentifier
      : params.identifier;
  return stripReminderAccessorySuffix(String(base ?? '').trim());
}


function notificationDataRecord(data: unknown): Record<string, unknown> | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  return data as Record<string, unknown>;
}

function resolveCategory(
  data: unknown,
  identifier: string,
): NotificationCategoryId | null {
  return (
    resolveNotificationCategoryFromData(data) ??
    resolveNotificationCategoryFromIdentifier(identifier)
  );
}

async function resolveSuppressedForData(data: unknown): Promise<boolean> {
  const record = notificationDataRecord(data);
  if (!record) return false;
  if (record.type === 'habit-reminder' && typeof record.habitId === 'string') {
    return shouldSuppressHabitReminderNotification(record.habitId);
  }
  if (record.type === 'daily-review-reminder') {
    return shouldSuppressDailyReviewReminderNotification();
  }
  if (record.type === 'health-intake-reminder') {
    return shouldSuppressHealthIntakeReminderNotification();
  }
  return false;
}

/** 与 `_layout` setNotificationHandler 对齐：不应展示则不进收件箱。 */
export async function shouldSkipInboxIngest(
  data: unknown,
  identifier?: string,
): Promise<boolean> {
  const category = resolveCategory(data, identifier ?? '');
  const categoryAllowed = category
    ? await isNotificationCategoryAllowed(category)
    : false;
  return shouldSkipInboxIngestByGate({
    sandboxDisabled: isExpoSandboxNotificationDisabled(),
    hasCategory: !!category,
    categoryAllowed,
    suppressed: await resolveSuppressedForData(data),
  });
}

export function resolveInboxDedupeKey(notification: Notification): string {
  const data = notificationDataRecord(notification.request.content.data);
  return resolveInboxDedupeKeyFromParts({
    identifier: notification.request.identifier,
    baseIdentifier:
      typeof data?.baseIdentifier === 'string' ? data.baseIdentifier : null,
  });
}

/**
 * 将已展示（或即将展示）的本地通知 upsert 进收件箱。
 * 无 category / suppress / 频道关闭时不写。
 */
export async function ingestNotificationIntoInbox(
  notification: Notification,
): Promise<NotificationInboxRow | null> {
  const content = notification.request.content;
  const data = content.data;
  const identifier = notification.request.identifier;

  if (await shouldSkipInboxIngest(data, identifier)) return null;

  const category = resolveCategory(data, identifier);
  if (!category) return null;

  const dedupeKey = resolveInboxDedupeKey(notification);
  if (!dedupeKey) return null;

  const title =
    (typeof content.title === 'string' && content.title.trim()) || '通知';
  const body = typeof content.body === 'string' ? content.body : '';

  try {
    return await upsertInboxFromNotification({
      dedupeKey,
      category,
      title,
      body,
      data,
      source: 'local',
    });
  } catch (e) {
    console.warn('[notification-inbox] ingest failed', e);
    return null;
  }
}
