import { useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

function navigateFromScheduleOrLegacyTask(
  router: ReturnType<typeof useRouter>,
  data: unknown,
) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return;
  const record = data as Record<string, unknown>;

  if (record.type === 'schedule-slot-reminder') {
    const subjectId = typeof record.subjectId === 'string' ? record.subjectId.trim() : '';
    if (!subjectId) return;
    if (record.subjectKind === 'habit') {
      router.push({ pathname: '/add-habit', params: { id: subjectId } });
      return;
    }
    if (record.subjectKind === 'project') {
      router.push({ pathname: '/edit-project', params: { id: subjectId } });
    } else {
      router.push({ pathname: '/edit-task', params: { id: subjectId } });
    }
    return;
  }

  // 兼容旧截止日待办提醒
  if (record.type === 'task-reminder') {
    const taskId = typeof record.taskId === 'string' ? record.taskId.trim() : '';
    if (!taskId) return;
    router.push({ pathname: '/edit-task', params: { id: taskId } });
  }
}

function navigateFromHealth(router: ReturnType<typeof useRouter>, data: unknown) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return;
  const record = data as Record<string, unknown>;
  if (record.type !== 'health-intake-reminder') return;
  router.push('/' as never);
}

/** 课程表占用提醒 + 健康摄入提醒点击跳转 */
export function ScheduleSlotReminderNotificationListener() {
  const router = useRouter();
  const handledResponseIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (Platform.OS === 'web') return;

    const handleResponse = (response: Notifications.NotificationResponse) => {
      const responseId = response.notification.request.identifier;
      if (responseId && handledResponseIdRef.current === responseId) return;
      if (responseId) handledResponseIdRef.current = responseId;
      const data = response.notification.request.content.data;
      navigateFromScheduleOrLegacyTask(router, data);
      navigateFromHealth(router, data);
    };

    const subscription = Notifications.addNotificationResponseReceivedListener(handleResponse);

    void Notifications.getLastNotificationResponseAsync().then(last => {
      if (!last) return;
      handleResponse(last);
    });

    return () => subscription.remove();
  }, [router]);

  return null;
}

/** @deprecated 使用 ScheduleSlotReminderNotificationListener */
export const TaskReminderNotificationListener = ScheduleSlotReminderNotificationListener;
