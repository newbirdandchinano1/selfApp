/**
 * 统一通知路由：按 `data.type` 分发点击跳转与送达后重算。
 * 强提醒：默认进全屏处置页；完成/贪睡走 Action；未到最终升级波次不重排下一天。
 */

import type { NotificationCategoryId } from '@/lib/notification-catalog';
import {
  navigateByNotificationType,
  resyncReminderAfterAcknowledge,
} from '@/lib/notification-navigate';
import {
  acknowledgeStrongReminder,
  ensureStrongReminderNotificationCategory,
  serializeStrongReminderPayload,
  shouldRescheduleAfterDelivery,
  snoozeStrongReminder,
  STRONG_ACTION_COMPLETE,
  STRONG_ACTION_SNOOZE,
  stripReminderAccessorySuffix,
} from '@/lib/notification-strong-reminder';
import { useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

function notificationDataRecord(data: unknown): Record<string, unknown> | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  return data as Record<string, unknown>;
}

function isStrongPayload(data: Record<string, unknown> | null): boolean {
  if (!data) return false;
  return data.strong === true || data.strong === 1 || data.strong === 'true';
}

function openDisposeScreen(
  router: ReturnType<typeof useRouter>,
  response: Notifications.NotificationResponse,
): void {
  const content = response.notification.request.content;
  const data = notificationDataRecord(content.data) ?? {};
  const identifier = stripReminderAccessorySuffix(
    typeof data.baseIdentifier === 'string' && data.baseIdentifier
      ? data.baseIdentifier
      : response.notification.request.identifier,
  );
  const title =
    (typeof data.disposeTitle === 'string' && data.disposeTitle) ||
    content.title ||
    '提醒';
  const body =
    (typeof data.disposeBody === 'string' && data.disposeBody) ||
    content.body ||
    '';
  router.push({
    pathname: '/reminder-dispose',
    params: {
      payload: serializeStrongReminderPayload({
        baseIdentifier: identifier,
        title,
        body,
        data,
      }),
    },
  });
}

async function handleSnoozeAction(
  response: Notifications.NotificationResponse,
): Promise<void> {
  const content = response.notification.request.content;
  const data = notificationDataRecord(content.data) ?? {};
  const baseIdentifier = stripReminderAccessorySuffix(
    typeof data.baseIdentifier === 'string' && data.baseIdentifier
      ? data.baseIdentifier
      : response.notification.request.identifier,
  );
  const category = (
    typeof data.category === 'string' ? data.category : null
  ) as NotificationCategoryId | null;
  if (!category || !baseIdentifier) {
    await acknowledgeStrongReminder(baseIdentifier);
    return;
  }
  const title =
    (typeof data.disposeTitle === 'string' && data.disposeTitle) ||
    content.title ||
    '提醒';
  const body =
    (typeof data.disposeBody === 'string' && data.disposeBody) ||
    content.body ||
    '';
  const channelId =
    typeof data.channelId === 'string' && data.channelId
      ? data.channelId
      : 'strong-reminders';
  const channelName =
    typeof data.channelName === 'string' && data.channelName
      ? data.channelName
      : '强提醒';
  const importance =
    data.channelImportance === 'high' ? ('high' as const) : ('default' as const);
  const fingerprint =
    typeof data.fingerprint === 'string' ? data.fingerprint : baseIdentifier;
  const contextBlock =
    typeof data.contextBlock === 'string' ? data.contextBlock : '【频道】强提醒贪睡';

  await snoozeStrongReminder({
    category,
    baseIdentifier,
    channel: { id: channelId, name: channelName, importance },
    data,
    fallback: { title, body: body.replace(/^再次提醒：/, '') },
    fingerprint,
    contextBlock,
  });
}

/** 送达后需要重算下一次提醒的类型（强提醒未到最终升级波次时跳过）。 */
function rescheduleAfterDelivery(data: unknown): void {
  const record = notificationDataRecord(data);
  if (!record || typeof record.type !== 'string') return;
  if (!shouldRescheduleAfterDelivery(record)) return;
  resyncReminderAfterAcknowledge(record);
}

/** 合并后的本地通知监听：点击跳转 + 单次 DATE 提醒重排。 */
export function NotificationRouter() {
  const router = useRouter();
  const handledResponseIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (Platform.OS === 'web') return;

    void ensureStrongReminderNotificationCategory();

    const handleResponse = (response: Notifications.NotificationResponse) => {
      const responseId = `${response.notification.request.identifier}:${response.actionIdentifier}`;
      if (responseId && handledResponseIdRef.current === responseId) return;
      if (responseId) handledResponseIdRef.current = responseId;

      const data = response.notification.request.content.data;
      const record = notificationDataRecord(data);
      const actionId = response.actionIdentifier;

      if (actionId === STRONG_ACTION_SNOOZE) {
        void handleSnoozeAction(response);
        return;
      }

      if (actionId === STRONG_ACTION_COMPLETE) {
        const base =
          typeof record?.baseIdentifier === 'string' && record.baseIdentifier
            ? record.baseIdentifier
            : response.notification.request.identifier;
        void acknowledgeStrongReminder(base).then(() => {
          resyncReminderAfterAcknowledge(data);
          navigateByNotificationType(router, data);
        });
        return;
      }

      // 默认点击：强提醒进全屏处置页，其它类型直接跳转
      if (isStrongPayload(record)) {
        openDisposeScreen(router, response);
        return;
      }

      navigateByNotificationType(router, data);
      rescheduleAfterDelivery(data);
    };

    const responseSub = Notifications.addNotificationResponseReceivedListener(handleResponse);
    const receivedSub = Notifications.addNotificationReceivedListener(notification => {
      rescheduleAfterDelivery(notification.request.content.data);
    });

    void Notifications.getLastNotificationResponseAsync().then(last => {
      if (!last) return;
      handleResponse(last);
    });

    return () => {
      responseSub.remove();
      receivedSub.remove();
    };
  }, [router]);

  return null;
}
