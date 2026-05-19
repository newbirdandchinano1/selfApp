import { useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

function navigateToTaskFromNotification(router: ReturnType<typeof useRouter>, data: unknown) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return;
  const record = data as Record<string, unknown>;
  if (record.type !== 'task-reminder') return;
  const taskId = typeof record.taskId === 'string' ? record.taskId.trim() : '';
  if (!taskId) return;
  router.push({ pathname: '/edit-task', params: { id: taskId } });
}

export function TaskReminderNotificationListener() {
  const router = useRouter();
  const handledResponseIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (Platform.OS === 'web') return;

    const handleResponse = (response: Notifications.NotificationResponse) => {
      const responseId = response.notification.request.identifier;
      if (responseId && handledResponseIdRef.current === responseId) return;
      if (responseId) handledResponseIdRef.current = responseId;
      navigateToTaskFromNotification(router, response.notification.request.content.data);
    };

    const subscription = Notifications.addNotificationResponseReceivedListener(handleResponse);

    void Notifications.getLastNotificationResponseAsync().then((last) => {
      if (!last) return;
      handleResponse(last);
    });

    return () => subscription.remove();
  }, [router]);

  return null;
}
