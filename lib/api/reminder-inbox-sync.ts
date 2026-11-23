/**
 * 服务端 reminder_inbox → 本地 notification_inbox（source=local）。
 * 启动 / 回前台 / 收到推送时拉取；本地已读回写服务端。
 */
import {
  apiFetchReminderInbox,
  apiMarkAllReminderInboxRead,
  apiMarkReminderInboxRead,
  type ReminderInboxItemDto,
} from '@/lib/api/endpoints/reminders';
import { AppSettingKey, getAppSetting, setAppSetting } from '@/lib/app-settings-store';
import {
  markReadByDedupeKey,
  upsertInboxFromNotification,
} from '@/lib/repositories/notifications/notification-inbox';

let syncInFlight: Promise<number> | null = null;

async function getUpdatedSince(): Promise<string | null> {
  try {
    const raw = await getAppSetting<string>(AppSettingKey.reminderInboxUpdatedSince);
    const t = typeof raw === 'string' ? raw.trim() : '';
    return t || null;
  } catch {
    return null;
  }
}

async function setUpdatedSince(iso: string): Promise<void> {
  try {
    await setAppSetting(AppSettingKey.reminderInboxUpdatedSince, iso);
  } catch {
    /* ignore */
  }
}

function payloadRecord(payload: unknown): Record<string, unknown> {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    return payload as Record<string, unknown>;
  }
  return {};
}

async function applyRemoteItem(item: ReminderInboxItemDto): Promise<void> {
  const data = {
    ...payloadRecord(item.payload),
    type: payloadRecord(item.payload).type ?? item.category,
    category: item.category,
    baseIdentifier: item.dedupeKey,
    serverReminderInboxId: item.id,
  };

  await upsertInboxFromNotification({
    dedupeKey: item.dedupeKey,
    category: item.category,
    title: item.title,
    body: item.body,
    data,
    createdAt: item.createdAt,
    source: 'local',
  });

  if (item.readAt) {
    await markReadByDedupeKey(item.dedupeKey, { skipServerMirror: true });
  }
}

/**
 * 增量拉取服务端提醒收件箱并写入本地。
 * @returns 本次写入条数
 */
export async function syncReminderInboxFromServer(): Promise<number> {
  if (syncInFlight) return syncInFlight;

  syncInFlight = (async () => {
    let written = 0;
    let cursor: string | null = null;
    let maxUpdated: string | null = await getUpdatedSince();
    const updatedSince = maxUpdated;
    let pages = 0;

    try {
      do {
        const page = await apiFetchReminderInbox({
          cursor,
          limit: 100,
          updatedSince,
        });
        for (const item of page.items ?? []) {
          try {
            await applyRemoteItem(item);
            written += 1;
            if (!maxUpdated || item.updatedAt > maxUpdated) {
              maxUpdated = item.updatedAt;
            }
          } catch (e) {
            if (__DEV__) console.warn('[reminder-inbox-sync] apply failed', item.dedupeKey, e);
          }
        }
        cursor = page.nextCursor;
        pages += 1;
      } while (cursor && pages < 20);

      if (maxUpdated) await setUpdatedSince(maxUpdated);
    } catch (e) {
      if (__DEV__) console.warn('[reminder-inbox-sync] pull failed', e);
    } finally {
      syncInFlight = null;
    }
    return written;
  })();

  return syncInFlight;
}

/** 本地标已读后回写服务端。 */
export async function mirrorReminderInboxReadToServer(params: {
  dedupeKey?: string | null;
  serverId?: string | null;
}): Promise<void> {
  const dedupeKey = String(params.dedupeKey ?? '').trim();
  const id = String(params.serverId ?? '').trim();
  if (!dedupeKey && !id) return;
  try {
    await apiMarkReminderInboxRead({
      dedupeKey: dedupeKey || undefined,
      id: id || undefined,
    });
  } catch (e) {
    if (__DEV__) console.warn('[reminder-inbox-sync] mark read failed', e);
  }
}

export async function mirrorReminderInboxMarkAllReadToServer(): Promise<void> {
  try {
    await apiMarkAllReminderInboxRead();
  } catch (e) {
    if (__DEV__) console.warn('[reminder-inbox-sync] mark all read failed', e);
  }
}
