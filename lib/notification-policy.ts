import Constants from 'expo-constants';
import { Platform } from 'react-native';

/** Expo Go 是沙盒运行环境：不登记、不展示本地通知，避免应用退出后仍由系统触发。 */
export function isExpoSandboxNotificationDisabled(): boolean {
  return Platform.OS !== 'web' && Constants.appOwnership === 'expo';
}

export async function clearExpoSandboxNotifications(): Promise<void> {
  if (!isExpoSandboxNotificationDisabled()) return;

  const Notifications = await import('expo-notifications');
  await Promise.all([
    Notifications.cancelAllScheduledNotificationsAsync(),
    Notifications.dismissAllNotificationsAsync(),
  ]);
}
