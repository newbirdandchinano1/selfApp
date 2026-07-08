import { useDayBoundary } from '@/contexts/day-boundary-context';
import { syncDailyReviewReminderNotification } from '@/lib/daily-review-reminder-notifications';
import { useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

function isDailyReviewReminderData(data: unknown): boolean {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  return (data as Record<string, unknown>).type === 'daily-review-reminder';
}

function navigateToDailyReviewFromNotification(
  router: ReturnType<typeof useRouter>,
  todayYmd: string,
  data: unknown,
) {
  if (!isDailyReviewReminderData(data)) return;
  router.push({ pathname: '/daily-review/[ymd]', params: { ymd: todayYmd } });
}

export function DailyReviewReminderNotificationListener() {
  const router = useRouter();
  const { logicalTodayYmd } = useDayBoundary();
  const handledResponseIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (Platform.OS === 'web') return;

    const handleResponse = (response: Notifications.NotificationResponse) => {
      const responseId = response.notification.request.identifier;
      if (responseId && handledResponseIdRef.current === responseId) return;
      if (responseId) handledResponseIdRef.current = responseId;
      const data = response.notification.request.content.data;
      navigateToDailyReviewFromNotification(router, logicalTodayYmd, data);
      if (isDailyReviewReminderData(data)) {
        void syncDailyReviewReminderNotification();
      }
    };

    const responseSub = Notifications.addNotificationResponseReceivedListener(handleResponse);
    const receivedSub = Notifications.addNotificationReceivedListener((notification) => {
      if (isDailyReviewReminderData(notification.request.content.data)) {
        void syncDailyReviewReminderNotification();
      }
    });

    void Notifications.getLastNotificationResponseAsync().then((last) => {
      if (!last) return;
      handleResponse(last);
    });

    return () => {
      responseSub.remove();
      receivedSub.remove();
    };
  }, [router, logicalTodayYmd]);

  return null;
}
