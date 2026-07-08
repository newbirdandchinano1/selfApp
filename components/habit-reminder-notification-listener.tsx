import { resyncHabitReminderForHabitId } from '@/lib/habit-reminder-notifications';
import * as Notifications from 'expo-notifications';
import { useEffect } from 'react';
import { Platform } from 'react-native';

function habitIdFromReminderData(data: unknown): string | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const record = data as Record<string, unknown>;
  if (record.type !== 'habit-reminder') return null;
  return typeof record.habitId === 'string' && record.habitId ? record.habitId : null;
}

/** 习惯提醒为 DATE 单次触发：送达或点击后重算该习惯的下一次提醒。 */
export function HabitReminderNotificationListener() {
  useEffect(() => {
    if (Platform.OS === 'web') return;

    const reschedule = (data: unknown) => {
      const habitId = habitIdFromReminderData(data);
      if (!habitId) return;
      void resyncHabitReminderForHabitId(habitId);
    };

    const receivedSub = Notifications.addNotificationReceivedListener((notification) => {
      reschedule(notification.request.content.data);
    });
    const responseSub = Notifications.addNotificationResponseReceivedListener((response) => {
      reschedule(response.notification.request.content.data);
    });

    return () => {
      receivedSub.remove();
      responseSub.remove();
    };
  }, []);

  return null;
}
