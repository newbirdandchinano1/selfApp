import { getDatabase } from '@/lib/database';
import { emitNotificationInboxChanged } from '@/lib/notification-inbox-events';
import { moduleTabForNotificationCategory } from '@/lib/notification-inbox-mapping';
import {
  NOTIFICATION_INBOX_MAX_ROWS,
  NOTIFICATION_INBOX_READ_RETENTION_DAYS,
  pickInboxIdsToPrune,
} from '@/lib/notification-inbox-prune';
import { stripReminderAccessorySuffix } from '@/lib/notification-strong-reminder';
import { newMutationId } from '@/lib/sync-write-meta';

import type {
  ListInboxOptions,
  NotificationInboxRow,
  NotificationInboxSource,
  NotificationModuleTab,
  UnreadCountByModuleTab,
  UpsertInboxFromNotificationInput,
} from './notification-inbox.types';

export type {
  ListInboxOptions,
  NotificationInboxRow,
  NotificationInboxSource,
  NotificationModuleTab,
  UnreadCountByModuleTab,
  UpsertInboxFromNotificationInput,
} from './notification-inbox.types';

export {
  NOTIFICATION_INBOX_MAX_ROWS,
  NOTIFICATION_INBOX_READ_RETENTION_DAYS,
  pickInboxIdsToPrune,
} from '@/lib/notification-inbox-prune';

type InboxDbRow = {
  id: string;
  dedupe_key: string;
  category: string;
  module_tab: string;
  title: string;
  body: string;
  data_json: string;
  created_at: string;
  read_at: string | null;
  source: string;
};

const MODULE_TABS: readonly NotificationModuleTab[] = [
  'index',
  'tasks',
  'finance',
  'review',
  'profile',
];

function isModuleTab(v: string): v is NotificationModuleTab {
  return (MODULE_TABS as readonly string[]).includes(v);
}

function mapRow(row: InboxDbRow): NotificationInboxRow {
  return {
    id: row.id,
    dedupeKey: row.dedupe_key,
    category: row.category,
    moduleTab: isModuleTab(row.module_tab) ? row.module_tab : 'profile',
    title: row.title,
    body: row.body ?? '',
    dataJson: row.data_json ?? '{}',
    createdAt: row.created_at,
    readAt: row.read_at ?? null,
    source: row.source === 'remote' ? 'remote' : 'local',
  };
}

function serializeDataJson(data: unknown): string {
  if (data == null) return '{}';
  if (typeof data === 'string') {
    const t = data.trim();
    if (!t) return '{}';
    try {
      JSON.parse(t);
      return t;
    } catch {
      return JSON.stringify({ raw: t });
    }
  }
  try {
    return JSON.stringify(data);
  } catch {
    return '{}';
  }
}

function newInboxId(): string {
  return `ni_${newMutationId()}`;
}

export async function ensureNotificationInboxTable(): Promise<void> {
  const db = await getDatabase();
  if (!db) return;
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS notification_inbox (
      id TEXT PRIMARY KEY NOT NULL,
      dedupe_key TEXT NOT NULL,
      category TEXT NOT NULL,
      module_tab TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      data_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      read_at TEXT NULL,
      source TEXT NOT NULL DEFAULT 'local'
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ux_notification_inbox_dedupe
      ON notification_inbox(dedupe_key);
    CREATE INDEX IF NOT EXISTS ix_notification_inbox_unread
      ON notification_inbox(read_at, module_tab, created_at);
    -- 角标聚合：WHERE read_at IS NULL GROUP BY source, module_tab
    CREATE INDEX IF NOT EXISTS ix_notification_inbox_unread_badge
      ON notification_inbox(read_at, source, module_tab);
  `);
}

/**
 * 按 dedupe_key 插入或更新；再次送达一律重新未读（read_at = null）。
 */
export async function upsertInboxFromNotification(
  input: UpsertInboxFromNotificationInput,
): Promise<NotificationInboxRow | null> {
  const dedupeKey = stripReminderAccessorySuffix(String(input.dedupeKey ?? '').trim());
  if (!dedupeKey) return null;

  const category = String(input.category ?? '').trim() || 'unknown';
  const title = String(input.title ?? '').trim() || '通知';
  const body = String(input.body ?? '');
  const dataJson = serializeDataJson(input.data);
  const createdAt =
    input.createdAt && Number.isFinite(Date.parse(input.createdAt))
      ? input.createdAt
      : new Date().toISOString();
  const source: NotificationInboxSource = input.source === 'remote' ? 'remote' : 'local';
  const moduleTab = input.moduleTab ?? moduleTabForNotificationCategory(category);

  await ensureNotificationInboxTable();
  const db = await getDatabase();
  if (!db) return null;

  const existing = await db.getFirstAsync<InboxDbRow>(
    `SELECT * FROM notification_inbox WHERE dedupe_key = ? LIMIT 1`,
    [dedupeKey],
  );

  if (existing) {
    await db.runAsync(
      `UPDATE notification_inbox
       SET category = ?, module_tab = ?, title = ?, body = ?, data_json = ?,
           created_at = ?, read_at = NULL, source = ?
       WHERE dedupe_key = ?`,
      [category, moduleTab, title, body, dataJson, createdAt, source, dedupeKey],
    );
  } else {
    await db.runAsync(
      `INSERT INTO notification_inbox (
         id, dedupe_key, category, module_tab, title, body, data_json,
         created_at, read_at, source
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
      [newInboxId(), dedupeKey, category, moduleTab, title, body, dataJson, createdAt, source],
    );
  }

  await pruneInbox();
  emitNotificationInboxChanged();

  const row = await db.getFirstAsync<InboxDbRow>(
    `SELECT * FROM notification_inbox WHERE dedupe_key = ? LIMIT 1`,
    [dedupeKey],
  );
  return row ? mapRow(row) : null;
}

export async function markReadByDedupeKey(dedupeKey: string): Promise<boolean> {
  const key = stripReminderAccessorySuffix(String(dedupeKey ?? '').trim());
  if (!key) return false;
  await ensureNotificationInboxTable();
  const db = await getDatabase();
  if (!db) return false;
  const now = new Date().toISOString();
  const result = await db.runAsync(
    `UPDATE notification_inbox
     SET read_at = ?
     WHERE dedupe_key = ? AND read_at IS NULL`,
    [now, key],
  );
  const changed = (result?.changes ?? 0) > 0;
  if (changed) emitNotificationInboxChanged();
  return changed;
}

export async function markReadById(id: string): Promise<boolean> {
  const rowId = String(id ?? '').trim();
  if (!rowId) return false;
  await ensureNotificationInboxTable();
  const db = await getDatabase();
  if (!db) return false;
  const now = new Date().toISOString();
  const result = await db.runAsync(
    `UPDATE notification_inbox
     SET read_at = ?
     WHERE id = ? AND read_at IS NULL`,
    [now, rowId],
  );
  const changed = (result?.changes ?? 0) > 0;
  if (changed) emitNotificationInboxChanged();
  return changed;
}

/**
 * 全部未读 → 已读。
 * 默认仅清 `local`（通知 Tab）；传 `source: 'remote'` 仅清资讯镜像。
 */
export async function markAllRead(opts?: {
  source?: NotificationInboxSource;
}): Promise<number> {
  await ensureNotificationInboxTable();
  const db = await getDatabase();
  if (!db) return 0;
  const now = new Date().toISOString();
  const source = opts?.source ?? 'local';
  const result = await db.runAsync(
    `UPDATE notification_inbox
     SET read_at = ?
     WHERE read_at IS NULL AND source = ?`,
    [now, source],
  );
  const n = result?.changes ?? 0;
  if (n > 0) emitNotificationInboxChanged();
  return n;
}

export async function listInbox(opts?: ListInboxOptions): Promise<NotificationInboxRow[]> {
  await ensureNotificationInboxTable();
  const db = await getDatabase();
  if (!db) return [];
  const limit = Math.max(1, Math.min(500, Math.floor(opts?.limit ?? NOTIFICATION_INBOX_MAX_ROWS)));
  const onlyUnread = opts?.onlyUnread === true;
  const source = opts?.source;
  const params: (string | number)[] = [];
  const where: string[] = [];
  if (onlyUnread) where.push('read_at IS NULL');
  if (source === 'local' || source === 'remote') {
    where.push('source = ?');
    params.push(source);
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  params.push(limit);
  const rows = await db.getAllAsync<InboxDbRow>(
    `SELECT * FROM notification_inbox
     ${whereSql}
     ORDER BY CASE WHEN read_at IS NULL THEN 0 ELSE 1 END ASC,
              created_at DESC
     LIMIT ?`,
    params,
  );
  return (rows ?? []).map(mapRow);
}

/**
 * 未读聚合：
 * - index/tasks/finance/review/profile：仅 `source='local'`（资讯不落业务 Tab）
 * - total：local + remote（铃铛）
 */
export async function countUnreadByModuleTab(): Promise<UnreadCountByModuleTab> {
  await ensureNotificationInboxTable();
  const db = await getDatabase();
  const empty: UnreadCountByModuleTab = {
    index: 0,
    tasks: 0,
    finance: 0,
    review: 0,
    profile: 0,
    total: 0,
  };
  if (!db) return empty;

  const rows = await db.getAllAsync<{ module_tab: string; source: string; c: number }>(
    `SELECT module_tab, source, COUNT(*) AS c
     FROM notification_inbox
     WHERE read_at IS NULL
     GROUP BY module_tab, source`,
  );

  const out = { ...empty };
  for (const row of rows ?? []) {
    const n = Math.max(0, Math.floor(Number(row.c) || 0));
    out.total += n;
    // 资讯 / remote 只计入 total，不打业务 Tab
    if (row.source === 'remote') continue;
    if (isModuleTab(row.module_tab)) {
      out[row.module_tab] += n;
    } else {
      out.profile += n;
    }
  }
  return out;
}

export async function pruneInbox(): Promise<number> {
  await ensureNotificationInboxTable();
  const db = await getDatabase();
  if (!db) return 0;

  const rows = await db.getAllAsync<{ id: string; created_at: string; read_at: string | null }>(
    `SELECT id, created_at, read_at FROM notification_inbox`,
  );
  const ids = pickInboxIdsToPrune(
    (rows ?? []).map(r => ({
      id: r.id,
      createdAt: r.created_at,
      readAt: r.read_at,
    })),
    {
      maxRows: NOTIFICATION_INBOX_MAX_ROWS,
      readRetentionMs: NOTIFICATION_INBOX_READ_RETENTION_DAYS * 24 * 60 * 60 * 1000,
      nowMs: Date.now(),
    },
  );
  if (ids.length === 0) return 0;

  // 分批删除，避免超长 IN 列表
  let deleted = 0;
  const chunkSize = 50;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const placeholders = chunk.map(() => '?').join(',');
    const result = await db.runAsync(
      `DELETE FROM notification_inbox WHERE id IN (${placeholders})`,
      chunk,
    );
    deleted += result?.changes ?? 0;
  }
  return deleted;
}

export async function getInboxByDedupeKey(
  dedupeKey: string,
): Promise<NotificationInboxRow | null> {
  const key = stripReminderAccessorySuffix(String(dedupeKey ?? '').trim());
  if (!key) return null;
  await ensureNotificationInboxTable();
  const db = await getDatabase();
  if (!db) return null;
  const row = await db.getFirstAsync<InboxDbRow>(
    `SELECT * FROM notification_inbox WHERE dedupe_key = ? LIMIT 1`,
    [key],
  );
  return row ? mapRow(row) : null;
}

/** 资讯远端 id → 本地 dedupe_key */
export function remoteInboxDedupeKey(remoteId: string): string {
  return `remote:${String(remoteId ?? '').trim()}`;
}

export type RemoteInboxMirrorItem = {
  id: string;
  title: string;
  body?: string;
  createdAt: string;
  readAt: string | null;
  /** 写入 data_json，供跳转等 */
  href?: string | null;
  module?: string | null;
  sourceKey?: string | null;
};

/**
 * 用服务端资讯页全量替换本地 `source='remote'` 镜像（便于铃铛 total 一次聚合）。
 * 保留服务端 read_at；空列表则清空本地资讯镜像。
 */
export async function replaceRemoteInboxMirror(
  items: RemoteInboxMirrorItem[],
): Promise<void> {
  await ensureNotificationInboxTable();
  const db = await getDatabase();
  if (!db) return;

  await db.execAsync('BEGIN IMMEDIATE');
  try {
    await db.runAsync(`DELETE FROM notification_inbox WHERE source = 'remote'`);
    for (const item of items) {
      const remoteId = String(item.id ?? '').trim();
      if (!remoteId) continue;
      const dedupeKey = remoteInboxDedupeKey(remoteId);
      const title = String(item.title ?? '').trim() || '资讯';
      const body = String(item.body ?? '');
      const createdAt =
        item.createdAt && Number.isFinite(Date.parse(item.createdAt))
          ? item.createdAt
          : new Date().toISOString();
      const readAt =
        item.readAt && Number.isFinite(Date.parse(item.readAt)) ? item.readAt : null;
      const dataJson = serializeDataJson({
        remoteId,
        href: item.href ?? null,
        module: item.module ?? 'messages',
        sourceKey: item.sourceKey ?? null,
      });
      await db.runAsync(
        `INSERT INTO notification_inbox (
           id, dedupe_key, category, module_tab, title, body, data_json,
           created_at, read_at, source
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'remote')`,
        [
          newInboxId(),
          dedupeKey,
          'remote-feed',
          'profile',
          title,
          body,
          dataJson,
          createdAt,
          readAt,
        ],
      );
    }
    await db.execAsync('COMMIT');
  } catch (e) {
    try {
      await db.execAsync('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw e;
  }

  await pruneInbox();
  emitNotificationInboxChanged();
}
