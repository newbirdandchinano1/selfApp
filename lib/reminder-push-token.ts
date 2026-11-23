/**
 * 注册 Expo Push Token 到服务端（非 web / 非 Expo Go）。
 */
import { apiRegisterPushToken } from '@/lib/api/endpoints/reminders';
import { isExpoSandboxNotificationDisabled } from '@/lib/notification-policy';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

let lastRegisteredToken: string | null = null;
let inFlight: Promise<void> | null = null;

function easProjectId(): string | null {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  const id = extra?.eas?.projectId?.trim();
  return id || null;
}

export async function registerReminderPushToken(): Promise<void> {
  if (Platform.OS === 'web' || isExpoSandboxNotificationDisabled()) return;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const Notifications = await import('expo-notifications');
      const perm = await Notifications.getPermissionsAsync();
      let granted = perm.status === 'granted';
      if (!granted && perm.canAskAgain !== false) {
        const req = await Notifications.requestPermissionsAsync({
          ios: {
            allowAlert: true,
            allowBadge: true,
            allowSound: true,
            provideAppNotificationSettings: true,
          },
        });
        granted = req.status === 'granted';
      }
      if (!granted) return;

      const projectId = easProjectId();
      const tokenResult = await Notifications.getExpoPushTokenAsync(
        projectId ? { projectId } : undefined,
      );
      const token = String(tokenResult?.data ?? '').trim();
      if (!token) return;
      if (token === lastRegisteredToken) return;

      await apiRegisterPushToken({
        token,
        platform: Platform.OS,
      });
      lastRegisteredToken = token;
    } catch (e) {
      if (__DEV__) console.warn('[reminder-push] register failed', e);
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}
