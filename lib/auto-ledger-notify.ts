import {
  canScheduleAppNotification,
  isGlobalQuietHoursNow,
} from '@/lib/notification-center-settings';
import { trySoftPresentLocalNotification } from '@/lib/notification-foreground-delivery';
import { isExpoSandboxNotificationDisabled } from '@/lib/notification-policy';
import { upsertInboxFromNotification } from '@/lib/repositories/notifications/notification-inbox';
import {
  enqueueReminderJobsUpsert,
  flushReminderJobsQueue,
} from '@/lib/reminder-jobs-client';
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

/** 后台：写本地 Inbox + 上报立刻派发的服务端 job（推送）。 */
async function presentViaServerJob(params: {
  identifier: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
}): Promise<void> {
  await recordAutoLedgerInbox(params);
  enqueueReminderJobsUpsert([
    {
      dedupeKey: params.identifier,
      category: 'auto-ledger',
      fireAt: new Date().toISOString(),
      title: params.title,
      body: params.body,
      payload: params.data,
      strong: false,
    },
  ]);
  await flushReminderJobsQueue();
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
    const title = '截图记账';
    const body = message.length > 180 ? `${message.slice(0, 177)}…` : message;
    const data = { type: 'auto-ledger' };
    const softId = `auto-ledger-hint:${Date.now()}`;
    if (
      await trySoftPresentLocalNotification({
        category: 'auto-ledger',
        identifier: softId,
        title,
        body,
        data,
      })
    ) {
      return;
    }
    if (await isGlobalQuietHoursNow()) {
      await recordAutoLedgerInbox({ identifier: softId, title, body, data });
      return;
    }
    await presentViaServerJob({ identifier: softId, title, body, data });
  } catch (e) {
    console.warn('notifyAutoLedgerHint failed:', e);
  }
}

/** 快捷指令记账失败时通知（应用已在后台时用户仍能看到） */
export async function notifyAutoLedgerFailure(message: string): Promise<void> {
  if (Platform.OS === 'web' || isExpoSandboxNotificationDisabled()) {
    return;
  }
  if (!(await canScheduleAppNotification({ category: 'auto-ledger' }))) {
    return;
  }
  try {
    const title = '截图记账失败';
    const body = message.length > 180 ? `${message.slice(0, 177)}…` : message;
    const data = { type: 'auto-ledger' };
    const softId = `auto-ledger-fail:${Date.now()}`;
    if (
      await trySoftPresentLocalNotification({
        category: 'auto-ledger',
        identifier: softId,
        title,
        body,
        data,
      })
    ) {
      return;
    }
    if (await isGlobalQuietHoursNow()) {
      await recordAutoLedgerInbox({ identifier: softId, title, body, data });
      return;
    }
    await presentViaServerJob({ identifier: softId, title, body, data });
  } catch (e) {
    console.warn('notifyAutoLedgerFailure failed:', e);
  }
}
