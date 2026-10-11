import * as Notifications from 'expo-notifications';
import { canScheduleAppNotification } from '@/lib/notification-center-settings';
import { isExpoSandboxNotificationDisabled } from '@/lib/notification-policy';
import { upsertInboxFromNotification } from '@/lib/repositories/notifications/notification-inbox';
import { Platform } from 'react-native';

async function recordAutoLedgerInbox(params: {
  identifier: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
}): Promise<void> {
  try {
    await upsertInboxFromNotification({
      dedupeKey: params.identifier,
      category: 'auto-ledger',
      title: params.title,
      body: params.body,
      data: params.data,
      source: 'local',
    });
  } catch (e) {
    console.warn('[auto-ledger] inbox upsert failed', e);
  }
}

/** 截图记账提示（非失败类，如非账单截图） */
export async function notifyAutoLedgerHint(message: string): Promise<void> {
  if (Platform.OS === 'web' || isExpoSandboxNotificationDisabled()) {
    return;
  }
  if (!(await canScheduleAppNotification({ category: 'auto-ledger' }))) {
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
    const title = '截图记账';
    const body = message.length > 180 ? `${message.slice(0, 177)}…` : message;
    const data = { type: 'auto-ledger' };
    const identifier = await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        data,
      },
      trigger: null,
    });
    // 即时通知后台送达不一定走 received，发送处补写收件箱
    await recordAutoLedgerInbox({ identifier, title, body, data });
  } catch (e) {
    console.warn('notifyAutoLedgerHint failed:', e);
  }
}

/** 快捷指令记账失败时发本地通知（应用已在后台时用户仍能看到） */
export async function notifyAutoLedgerFailure(message: string): Promise<void> {
  if (Platform.OS === 'web' || isExpoSandboxNotificationDisabled()) {
    return;
  }
  if (!(await canScheduleAppNotification({ category: 'auto-ledger' }))) {
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
    const title = '截图记账失败';
    const body = message.length > 180 ? `${message.slice(0, 177)}…` : message;
    const data = { type: 'auto-ledger' };
    const identifier = await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        data,
      },
      trigger: null,
    });
    await recordAutoLedgerInbox({ identifier, title, body, data });
  } catch (e) {
    console.warn('notifyAutoLedgerFailure failed:', e);
  }
}
