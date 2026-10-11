/**
 * 资讯 / 采集收件箱 API（阶段 F）。
 *
 * 未来扩展（本期不实现）：
 * 1. 后台配置扫描 URL → Worker 抓取 → INSERT app_inbox
 * 2. App 拉取后进「资讯」Tab；未读进铃铛数字
 * 3. 若某条带 module=health 等，本期仍不打业务 Tab 角标
 */
import { apiRequest } from '@/lib/api/http';
import {
  markAllRead,
  markReadByDedupeKey,
  remoteInboxDedupeKey,
  replaceRemoteInboxMirror,
} from '@/lib/repositories/notifications/notification-inbox';

export type RemoteInboxItem = {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  readAt: string | null;
  /** 与后端 href 对齐；兼容旧字段 sourceUrl */
  sourceUrl?: string | null;
  href?: string | null;
  module?: string;
  sourceKey?: string | null;
};

export type RemoteInboxPage = {
  items: RemoteInboxItem[];
  nextCursor: string | null;
};

function normalizeItem(raw: RemoteInboxItem): RemoteInboxItem {
  const href =
    (typeof raw.href === 'string' && raw.href.trim() ? raw.href : null) ??
    (typeof raw.sourceUrl === 'string' && raw.sourceUrl.trim() ? raw.sourceUrl : null);
  return {
    id: String(raw.id ?? ''),
    title: String(raw.title ?? ''),
    body: String(raw.body ?? ''),
    createdAt: String(raw.createdAt ?? ''),
    readAt: raw.readAt != null && String(raw.readAt).trim() ? String(raw.readAt) : null,
    href,
    sourceUrl: href,
    module: typeof raw.module === 'string' ? raw.module : 'messages',
    sourceKey:
      raw.sourceKey != null && String(raw.sourceKey).trim()
        ? String(raw.sourceKey)
        : null,
  };
}

function normalizePage(raw: RemoteInboxPage | null | undefined): RemoteInboxPage {
  const items = Array.isArray(raw?.items) ? raw!.items.map(normalizeItem) : [];
  return {
    items,
    nextCursor:
      raw?.nextCursor != null && String(raw.nextCursor).trim()
        ? String(raw.nextCursor)
        : null,
  };
}

/** GET /api/app/inbox；成功后 mirror 到本地 notification_inbox(source=remote) */
export async function fetchRemoteInboxPage(params?: {
  cursor?: string | null;
  limit?: number;
  signal?: AbortSignal;
  /** 默认 true：首屏/无 cursor 时替换本地资讯镜像 */
  mirrorLocal?: boolean;
}): Promise<RemoteInboxPage> {
  const qs = new URLSearchParams();
  if (params?.cursor) qs.set('cursor', params.cursor);
  if (params?.limit != null && Number.isFinite(params.limit)) {
    qs.set('limit', String(Math.floor(params.limit)));
  }
  const q = qs.toString();
  const page = normalizePage(
    await apiRequest<RemoteInboxPage>(`/api/app/inbox${q ? `?${q}` : ''}`, {
      method: 'GET',
      signal: params?.signal,
      skipGlobalLoading: true,
    }),
  );

  const shouldMirror = params?.mirrorLocal !== false && !params?.cursor;
  if (shouldMirror) {
    try {
      await replaceRemoteInboxMirror(
        page.items.map((i) => ({
          id: i.id,
          title: i.title,
          body: i.body,
          createdAt: i.createdAt,
          readAt: i.readAt,
          href: i.href ?? i.sourceUrl ?? null,
          module: i.module,
          sourceKey: i.sourceKey,
        })),
      );
    } catch (e) {
      if (__DEV__) console.warn('[remote-inbox] mirror failed', e);
    }
  }

  return page;
}

/** POST /api/app/inbox/:id/read；并同步本地 mirror 已读 */
export async function markRemoteInboxRead(
  id: string,
  params?: { signal?: AbortSignal },
): Promise<void> {
  const remoteId = String(id ?? '').trim();
  if (!remoteId) return;
  await apiRequest<unknown>(`/api/app/inbox/${encodeURIComponent(remoteId)}/read`, {
    method: 'POST',
    signal: params?.signal,
    skipGlobalLoading: true,
  });
  try {
    await markReadByDedupeKey(remoteInboxDedupeKey(remoteId));
  } catch (e) {
    if (__DEV__) console.warn('[remote-inbox] local mark-read failed', e);
  }
}

/** POST /api/app/inbox/read-all；并同步本地 mirror 全部已读 */
export async function markAllRemoteInboxRead(params?: {
  signal?: AbortSignal;
}): Promise<void> {
  await apiRequest<unknown>('/api/app/inbox/read-all', {
    method: 'POST',
    signal: params?.signal,
    skipGlobalLoading: true,
  });
  try {
    await markAllRead({ source: 'remote' });
  } catch (e) {
    if (__DEV__) console.warn('[remote-inbox] local mark-all failed', e);
  }
}
