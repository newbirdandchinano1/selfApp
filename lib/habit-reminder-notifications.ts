import { Platform } from 'react-native';

const NOTIFICATION_PREFIX = 'selfapp-habit-reminder:';
const ANDROID_CHANNEL_ID = 'habit-reminders';

function notificationIdentifier(habitId: string): string {
  return `${NOTIFICATION_PREFIX}${habitId}`;
}

async function ensureAndroidChannel() {
  if (Platform.OS !== 'android') return;
  const Notifications = await import('expo-notifications');
  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    name: '习惯打卡提醒',
    importance: Notifications.AndroidImportance.DEFAULT,
    vibrationPattern: [0, 200, 120, 200],
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });
}

/** 取消某习惯的每日本地提醒（删除习惯或关闭提醒时调用）。 */
export async function cancelScheduledHabitReminder(habitId: string): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    const Notifications = await import('expo-notifications');
    await Notifications.cancelScheduledNotificationAsync(notificationIdentifier(habitId));
  } catch (e) {
    console.warn('取消习惯提醒失败', habitId, e);
  }
}

export type SyncHabitReminderParams = {
  habitId: string;
  enabled: boolean;
  hour: number;
  minute: number;
  /** 通知正文用习惯名称 */
  title: string;
};

/**
 * 根据开关与时刻登记或取消本地每日提醒（与 `extra_data.reminder` 一致）。
 * Web 端直接跳过；未授权时不会抛出，由调用方提示用户。
 */
export async function syncHabitReminderNotification(params: SyncHabitReminderParams): Promise<{
  scheduled: boolean;
  permissionDenied: boolean;
}> {
  if (Platform.OS === 'web') {
    return { scheduled: false, permissionDenied: false };
  }

  const { habitId, enabled, hour, minute, title } = params;
  const id = notificationIdentifier(habitId);

  let Notifications: typeof import('expo-notifications');
  try {
    Notifications = await import('expo-notifications');
  } catch (e) {
    console.warn('expo-notifications 不可用', e);
    return { scheduled: false, permissionDenied: false };
  }

  try {
    await Notifications.cancelScheduledNotificationAsync(id);
  } catch {
    /* 无已登记通知时忽略 */
  }

  if (!enabled) {
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

  const h = Math.max(0, Math.min(23, Math.floor(hour)));
  const m = Math.max(0, Math.min(59, Math.floor(minute)));
  const SchedulableTriggerInputTypes = Notifications.SchedulableTriggerInputTypes;
  const body = (title.trim() || '习惯') + '，该打卡啦';

  try {
    await Notifications.scheduleNotificationAsync({
      identifier: id,
      content: {
        title: '习惯打卡提醒',
        body,
        sound: true,
        data: { type: 'habit-reminder', habitId },
      },
      trigger: {
        type: SchedulableTriggerInputTypes.DAILY,
        hour: h,
        minute: m,
        channelId: Platform.OS === 'android' ? ANDROID_CHANNEL_ID : undefined,
      },
    });
    return { scheduled: true, permissionDenied: false };
  } catch (e) {
    console.warn('登记习惯提醒失败', habitId, e);
    return { scheduled: false, permissionDenied: false };
  }
}
