import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { isExpoSandboxNotificationDisabled } from '@/lib/notification-policy';

/** 截图记账提示（非失败类，如非账单截图） */
export async function notifyAutoLedgerHint(message: string): Promise<void> {
  if (Platform.OS === 'web' || isExpoSandboxNotificationDisabled()) {
    return;
  }
  try {
    const perm = await Notifications.getPermissionsAsync();
    let granted = perm.status === 'granted';
    if (!granted && perm.canAskAgain) {
      const req = await Notifications.requestPermissionsAsync();
      granted = req.status === 'granted';
    }
    if (!granted) {
      return;
    }
    await Notifications.scheduleNotificationAsync({
      content: {
        title: '截图记账',
        body: message.length > 180 ? `${message.slice(0, 177)}…` : message,
      },
      trigger: null,
    });
  } catch (e) {
    console.warn('notifyAutoLedgerHint failed:', e);
  }
}

/** 快捷指令记账失败时发本地通知（应用已在后台时用户仍能看到） */
export async function notifyAutoLedgerFailure(message: string): Promise<void> {
  if (Platform.OS === 'web') {
    return;
  }
  try {
    const perm = await Notifications.getPermissionsAsync();
    let granted = perm.status === 'granted';
    if (!granted && perm.canAskAgain) {
      const req = await Notifications.requestPermissionsAsync();
      granted = req.status === 'granted';
    }
    if (!granted) {
      return;
    }
    await Notifications.scheduleNotificationAsync({
      content: {
        title: '截图记账失败',
        body: message.length > 180 ? `${message.slice(0, 177)}…` : message,
      },
      trigger: null,
    });
  } catch (e) {
    console.warn('notifyAutoLedgerFailure failed:', e);
  }
}
