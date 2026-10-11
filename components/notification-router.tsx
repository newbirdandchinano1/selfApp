/**
 * 统一通知路由：送达写入收件箱；点击先消息页再业务；强提醒处置 / 完成 / 贪睡。
 */

import type { NotificationCategoryId } from '@/lib/notification-catalog';
import {
  ingestNotificationIntoInbox,
  resolveInboxDedupeKey,
} from '@/lib/notification-inbox-ingest';
import { resyncReminderAfterAcknowledge } from '@/lib/notification-navigate';
import {
  acknowledgeStrongReminder,
  ensureStrongReminderNotificationCategory,
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

async function handleSnoozeAction(
  response: Notifications.NotificationResponse,
): Promise<void> {
  // §1.2.2 A：贪睡仍未读；不打开消息页。补写收件箱以防后台送达未走 received。
  await ingestNotificationIntoInbox(response.notification);

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

/** 打开消息「通知」Tab 并 focus 该条；`after=dispose` 时消息页再进强提醒处置页。 */
function openMessagesInboxFocus(
  router: ReturnType<typeof useRouter>,
  dedupeKey: string,
  after?: 'dispose' | 'navigate',
): void {
  const params: Record<string, string> = {
    tab: 'inbox',
    focus: dedupeKey,
    // 同 dedupe 再次点击时强制触发消息页 effect
    focusNonce: String(Date.now()),
  };
  if (after === 'dispose') params.after = 'dispose';
  else if (after === 'navigate') params.after = 'navigate';
  router.push({ pathname: '/messages', params } as never);
}

/** 合并后的本地通知监听：收件箱写入 + 先消息后业务 + 强提醒 Action。 */
export function NotificationRouter() {
  const router = useRouter();
  const handledResponseIdRef = useRef<string | null>(null);

  useEffect(() => {
    // Web：不挂系统通知监听，避免崩；消息页仍可打开（空态）
    if (Platform.OS === 'web') return;

    void ensureStrongReminderNotificationCategory();

    const handleResponse = (response: Notifications.NotificationResponse) => {
      const responseId = `${response.notification.request.identifier}:${response.actionIdentifier}`;
      if (responseId && handledResponseIdRef.current === responseId) return;
      if (responseId) handledResponseIdRef.current = responseId;

      const data = response.notification.request.content.data;
      const record = notificationDataRecord(data);
      const actionId = response.actionIdentifier;
      const dedupeKey = resolveInboxDedupeKey(response.notification);

      if (actionId === STRONG_ACTION_SNOOZE) {
        void handleSnoozeAction(response);
        return;
      }

      // 点击路径：先补写收件箱（覆盖后台送达未走 received 的情况）
      void ingestNotificationIntoInbox(response.notification).then(() => {
        if (actionId === STRONG_ACTION_COMPLETE) {
          const base =
            typeof record?.baseIdentifier === 'string' && record.baseIdentifier
              ? record.baseIdentifier
              : response.notification.request.identifier;
          void acknowledgeStrongReminder(base).then(() => {
            resyncReminderAfterAcknowledge(data);
          });
          // 完成：经消息页标已读后再进业务（不进处置页）
          if (dedupeKey) openMessagesInboxFocus(router, dedupeKey, 'navigate');
          return;
        }

        // 默认点击：强提醒 → 消息页 focus 已读 → 处置页；其它 → 消息页 → 业务
        if (isStrongPayload(record)) {
          if (dedupeKey) openMessagesInboxFocus(router, dedupeKey, 'dispose');
          return;
        }

        if (dedupeKey) openMessagesInboxFocus(router, dedupeKey, 'navigate');
        rescheduleAfterDelivery(data);
      });
    };

    const responseSub = Notifications.addNotificationResponseReceivedListener(handleResponse);
    const receivedSub = Notifications.addNotificationReceivedListener(notification => {
      rescheduleAfterDelivery(notification.request.content.data);
      void ingestNotificationIntoInbox(notification);
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
