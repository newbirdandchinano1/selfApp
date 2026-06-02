import { useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

function navigateToDailyReviewFromNotification(router: ReturnType<typeof useRouter>, data: unknown) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return;
  const record = data as Record<string, unknown>;
  if (record.type !== 'daily-review-reminder') return;
  router.push('/weekly-review');
}

export function DailyReviewReminderNotificationListener() {
  const router = useRouter();
  const handledResponseIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (Platform.OS === 'web') return;

    const handleResponse = (response: Notifications.NotificationResponse) => {
      const responseId = response.notification.request.identifier;
      if (responseId && handledResponseIdRef.current === responseId) return;
      if (responseId) handledResponseIdRef.current = responseId;
      navigateToDailyReviewFromNotification(router, response.notification.request.content.data);
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
