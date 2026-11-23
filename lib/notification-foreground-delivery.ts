/**
 * 前台通知软送达：不弹系统横幅，写 Inbox + 合并 Toast。
 */

import { isAppInForeground } from '@/lib/app-foreground';
import { toast } from '@/lib/app-feedback/toast-events';
import { isNotificationInboxOnlyMode } from '@/lib/notification-center-settings';
import { buildForegroundClusterToast } from '@/lib/notification-copy-templates';
import { upsertInboxFromNotification } from '@/lib/repositories/notifications/notification-inbox';
import type { NotificationCategoryId } from '@/lib/notification-catalog';

const CLUSTER_MS = 450;

type PendingItem = { title: string; body: string };

let pending: PendingItem[] = [];
let clusterTimer: ReturnType<typeof setTimeout> | null = null;

function flushCluster(): void {
  clusterTimer = null;
  const items = pending;
  pending = [];
  if (items.length === 0) return;
  toast.info(buildForegroundClusterToast(items));
}

/** 短窗内多条前台提醒合并成一条 Toast。 */
export function enqueueForegroundReminderToast(title: string, body: string): void {
  const t = title.trim() || '提醒';
  const b = body.trim();
  pending.push({ title: t, body: b });
  if (clusterTimer) clearTimeout(clusterTimer);
  clusterTimer = setTimeout(flushCluster, CLUSTER_MS);
}

export function isSoftForegroundDeliveryPreferred(opts?: {
  strong?: boolean;
}): boolean {
  if (opts?.strong) return false;
  return isAppInForeground();
}

/**
 * 即时通知：前台 → Inbox + Toast；后台 → 由调用方继续走系统通知。
 * @returns true 表示已软送达，调用方勿再 schedule 系统通知。
 */
export async function trySoftPresentLocalNotification(params: {
  category: NotificationCategoryId;
  identifier: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  strong?: boolean;
}): Promise<boolean> {
  let inboxOnly = false;
  try {
    inboxOnly = await isNotificationInboxOnlyMode();
  } catch {
    inboxOnly = false;
  }

  // 安静模式：只 Inbox，不弹系统、不 Toast
  if (inboxOnly) {
    try {
      await upsertInboxFromNotification({
        dedupeKey: params.identifier,
        category: params.category,
        title: params.title,
        body: params.body,
        data: params.data,
        source: 'local',
      });
    } catch (e) {
      console.warn('[notification] soft present inbox failed', e);
    }
    return true;
  }

  if (!isSoftForegroundDeliveryPreferred({ strong: params.strong })) {
    return false;
  }

  try {
    await upsertInboxFromNotification({
      dedupeKey: params.identifier,
      category: params.category,
      title: params.title,
      body: params.body,
      data: params.data,
      source: 'local',
    });
  } catch (e) {
    console.warn('[notification] soft present inbox failed', e);
  }

  enqueueForegroundReminderToast(params.title, params.body);
  return true;
}

/** 预约通知在前台送达时：Toast（Inbox 仍由 router ingest）。安静模式跳过。 */
export async function softDeliverScheduledNotificationReceived(params: {
  title: string;
  body: string;
  strong?: boolean;
}): Promise<void> {
  try {
    if (await isNotificationInboxOnlyMode()) return;
  } catch {
    /* ignore */
  }
  if (!isSoftForegroundDeliveryPreferred({ strong: params.strong })) return;
  enqueueForegroundReminderToast(params.title, params.body);
}
