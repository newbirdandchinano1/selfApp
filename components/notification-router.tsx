/**
 * 统一通知路由：按 `data.type` 分发点击跳转与送达后重算。
 * 替代分散的 habit / schedule / daily-review 监听器。
 */

import { syncDailyReviewReminderNotification } from '@/lib/daily-review-reminder-notifications';
import { resyncHabitReminderForHabitId } from '@/lib/habit-reminder-notifications';
import { useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

function notificationDataRecord(data: unknown): Record<string, unknown> | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  return data as Record<string, unknown>;
}

function navigateByType(
  router: ReturnType<typeof useRouter>,
  data: unknown,
): void {
  const record = notificationDataRecord(data);
  if (!record || typeof record.type !== 'string') return;

  switch (record.type) {
    case 'schedule-slot-reminder': {
      const subjectId = typeof record.subjectId === 'string' ? record.subjectId.trim() : '';
      if (!subjectId) return;
      if (record.subjectKind === 'habit') {
        router.push({ pathname: '/add-habit', params: { id: subjectId } });
      } else if (record.subjectKind === 'project') {
        router.push({ pathname: '/edit-project', params: { id: subjectId } });
      } else {
        router.push({ pathname: '/edit-task', params: { id: subjectId } });
      }
      return;
    }
    case 'health-intake-reminder': {
      router.push('/' as never);
      return;
    }
    case 'daily-review-reminder': {
      router.push('/(tabs)/review');
      return;
    }
    case 'habit-reminder': {
      const habitId = typeof record.habitId === 'string' ? record.habitId.trim() : '';
      if (habitId) {
        router.push({ pathname: '/add-habit', params: { id: habitId } });
      }
      return;
    }
    default:
      return;
  }
}

/** 送达后需要重算下一次提醒的类型 */
function rescheduleAfterDelivery(data: unknown): void {
  const record = notificationDataRecord(data);
  if (!record || typeof record.type !== 'string') return;

  if (record.type === 'habit-reminder' && typeof record.habitId === 'string' && record.habitId) {
    void resyncHabitReminderForHabitId(record.habitId);
    return;
  }
  if (record.type === 'daily-review-reminder') {
    void syncDailyReviewReminderNotification();
  }
}

/** 合并后的本地通知监听：点击跳转 + 单次 DATE 提醒重排。 */
export function NotificationRouter() {
  const router = useRouter();
  const handledResponseIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (Platform.OS === 'web') return;

    const handleResponse = (response: Notifications.NotificationResponse) => {
      const responseId = response.notification.request.identifier;
      if (responseId && handledResponseIdRef.current === responseId) return;
      if (responseId) handledResponseIdRef.current = responseId;
      const data = response.notification.request.content.data;
      navigateByType(router, data);
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
