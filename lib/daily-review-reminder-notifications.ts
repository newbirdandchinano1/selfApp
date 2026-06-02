import type { DailyReviewReminderSettings } from '@/lib/daily-review-reminder-settings';
import { getDailyReviewReminderSettings } from '@/lib/daily-review-reminder-settings';
import { Platform } from 'react-native';

const NOTIFICATION_ID = 'selfapp-daily-review-reminder';
const ANDROID_CHANNEL_ID = 'daily-review-reminders';

async function ensureAndroidChannel() {
  if (Platform.OS !== 'android') return;
  const Notifications = await import('expo-notifications');
  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    name: '每日复盘提醒',
    importance: Notifications.AndroidImportance.DEFAULT,
    vibrationPattern: [0, 200, 120, 200],
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });
}

export type SyncDailyReviewReminderResult = {
  scheduled: boolean;
  permissionDenied: boolean;
};

/** 根据已保存设置登记或取消每日复盘本地通知提醒。 */
export async function syncDailyReviewReminderNotification(
  settings?: DailyReviewReminderSettings,
): Promise<SyncDailyReviewReminderResult> {
  if (Platform.OS === 'web') {
    return { scheduled: false, permissionDenied: false };
  }

  const resolved = settings ?? (await getDailyReviewReminderSettings());

  let Notifications: typeof import('expo-notifications');
  try {
    Notifications = await import('expo-notifications');
  } catch (e) {
    console.warn('expo-notifications 不可用', e);
    return { scheduled: false, permissionDenied: false };
  }

  try {
    await Notifications.cancelScheduledNotificationAsync(NOTIFICATION_ID);
  } catch {
    /* 无已登记通知时忽略 */
  }

  if (!resolved.enabled) {
    return { scheduled: false, permissionDenied: false };
  }

  const perm = await Notifications.getPermissionsAsync();
  let granted = perm.status === 'granted';
  if (!granted && perm.canAskAgain !== false) {
    const req = await Notifications.requestPermissionsAsync();
    granted = req.status === 'granted';
  }
  if (!granted) {
    return { scheduled: false, permissionDenied: true };
  }

  await ensureAndroidChannel();

  const hour = Math.max(0, Math.min(23, Math.floor(resolved.hour)));
  const minute = Math.max(0, Math.min(59, Math.floor(resolved.minute)));
  const SchedulableTriggerInputTypes = Notifications.SchedulableTriggerInputTypes;
  const channelId = Platform.OS === 'android' ? ANDROID_CHANNEL_ID : undefined;

  try {
    await Notifications.scheduleNotificationAsync({
      identifier: NOTIFICATION_ID,
      content: {
        title: '每日复盘提醒',
        body: '记得花几分钟完成今日复盘。',
        sound: true,
        data: { type: 'daily-review-reminder' },
      },
      trigger: {
        type: SchedulableTriggerInputTypes.DAILY,
        hour,
        minute,
        channelId,
      },
    });
    return { scheduled: true, permissionDenied: false };
  } catch (e) {
    console.warn('登记每日复盘提醒失败', e);
    return { scheduled: false, permissionDenied: false };
  }
}
