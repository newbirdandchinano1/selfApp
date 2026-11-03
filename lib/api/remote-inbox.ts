/**
 * 资讯 Tab 数据源：TrendRadar 热点（/api/app/news/*）。
 *
 * - 列表：最新一天热榜条目
 * - 已读：本机 notification_inbox(source=remote) 镜像；热点接口无已读态
 * - 点击外链：打开条目 url
 */
import {
  apiNewsLatest,
  type TrendRadarNewsItem,
} from '@/lib/api/endpoints/news';
import {
  markAllRead,
  markReadByDedupeKey,
  remoteInboxDedupeKey,
  replaceRemoteInboxMirror,
} from '@/lib/repositories/notifications/notification-inbox';
import { getDatabase } from '@/lib/database';

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
  /** 渠道名（对应 TrendRadar platformName） */
  sourceKey?: string | null;
  /** hotlist | rss */
  section?: string | null;
};

export type RemoteInboxPage = {
  items: RemoteInboxItem[];
  nextCursor: string | null;
  /** 热点报告日 YYYY-MM-DD */
  reportDate?: string | null;
  total?: number;
};

/** 当日热榜通常数百条；一次拉满便于渠道 Tab 聚合 */
const FEED_PAGE_LIMIT = 500;

function buildNewsBody(item: TrendRadarNewsItem): string {
  const parts: string[] = [];
  const platform = String(item.platformName ?? '').trim();
  if (platform) parts.push(platform);
  if (item.rankNo != null && Number.isFinite(item.rankNo)) {
    parts.push(
      item.rankEnd != null && item.rankEnd !== item.rankNo
        ? `排名 ${item.rankNo}-${item.rankEnd}`
        : `排名 ${item.rankNo}`,
    );
  }
  const group = String(item.keywordGroup ?? '').trim();
  if (group) parts.push(group);
  if (item.crawlCount != null && item.crawlCount > 0) {
    parts.push(`${item.crawlCount} 次`);
  }
  if (item.appearTime) parts.push(String(item.appearTime));
  return parts.join(' · ');
}

/** 用报告日拼一个可排序的 ISO；同日靠 rank / id 再排 */
function newsCreatedAt(item: TrendRadarNewsItem): string {
  const date = String(item.reportDate ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const rank = item.rankNo != null && Number.isFinite(item.rankNo) ? item.rankNo : 999;
    // 排名越靠前 createdAt 略新，便于「未读优先」后仍有稳定次序
    const minute = Math.min(59, Math.max(0, 60 - Math.min(rank, 60)));
    return `${date}T12:${String(minute).padStart(2, '0')}:00.000+08:00`;
  }
  return new Date().toISOString();
}

function mapNewsItem(item: TrendRadarNewsItem, readAt: string | null): RemoteInboxItem {
  const href =
    typeof item.url === 'string' && item.url.trim() && /^https?:\/\//i.test(item.url.trim())
      ? item.url.trim()
      : null;
  const platform = String(item.platformName ?? '').trim() || '其他';
  const section = String(item.section ?? '').trim() || 'hotlist';
  return {
    id: String(item.id),
    title: String(item.title ?? '').trim() || '热点',
    body: buildNewsBody(item),
    createdAt: newsCreatedAt(item),
    readAt,
    href,
    sourceUrl: href,
    module: 'messages',
    sourceKey: platform,
    section,
  };
}

async function loadLocalRemoteReadMap(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const db = await getDatabase();
    if (!db) return map;
    const rows = await db.getAllAsync<{ dedupe_key: string; read_at: string | null }>(
      `SELECT dedupe_key, read_at FROM notification_inbox
        WHERE source = 'remote' AND read_at IS NOT NULL AND TRIM(read_at) != ''`,
    );
    for (const row of rows ?? []) {
      const key = String(row.dedupe_key ?? '').trim();
      const readAt = row.read_at != null ? String(row.read_at).trim() : '';
      if (!key.startsWith('remote:') || !readAt || !Number.isFinite(Date.parse(readAt))) continue;
      map.set(key.slice('remote:'.length), readAt);
    }
  } catch (e) {
    if (__DEV__) console.warn('[remote-inbox] load read map failed', e);
  }
  return map;
}

function sortFeedItems(items: TrendRadarNewsItem[]): TrendRadarNewsItem[] {
  return [...items].sort((a, b) => {
    if (a.isNew !== b.isNew) return a.isNew ? -1 : 1;
    const ar = a.rankNo ?? 9999;
    const br = b.rankNo ?? 9999;
    if (ar !== br) return ar - br;
    return b.id - a.id;
  });
}

/**
 * 拉取最新一天 TrendRadar 热点，并 mirror 到本地 notification_inbox(source=remote)。
 * `cursor` 传 offset 数字字符串时可翻页（可选）。
 */
export async function fetchRemoteInboxPage(params?: {
  cursor?: string | null;
  limit?: number;
  signal?: AbortSignal;
  /** 默认 true：首屏/无 cursor 时替换本地资讯镜像 */
  mirrorLocal?: boolean;
}): Promise<RemoteInboxPage> {
  const limit = Math.min(
    500,
    Math.max(1, Math.floor(params?.limit ?? FEED_PAGE_LIMIT)),
  );
  const offset =
    params?.cursor && /^\d+$/.test(params.cursor) ? Math.max(0, parseInt(params.cursor, 10)) : 0;

  const latest = await apiNewsLatest({
    limit,
    offset,
    signal: params?.signal,
  });

  const readMap = await loadLocalRemoteReadMap();
  const sorted = sortFeedItems(Array.isArray(latest?.items) ? latest.items : []);
  const items = sorted.map((row) => mapNewsItem(row, readMap.get(String(row.id)) ?? null));

  const shouldMirror = params?.mirrorLocal !== false && offset === 0;
  if (shouldMirror) {
    try {
      await replaceRemoteInboxMirror(
        items.map((i) => ({
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

  const total = Number(latest?.total ?? items.length);
  const nextOffset = offset + items.length;
  const nextCursor = nextOffset < total ? String(nextOffset) : null;

  return {
    items,
    nextCursor,
    reportDate: latest?.date ?? null,
    total,
  };
}

/** 热点无服务端已读接口：只写本地 mirror */
export async function markRemoteInboxRead(
  id: string,
  _params?: { signal?: AbortSignal },
): Promise<void> {
  const remoteId = String(id ?? '').trim();
  if (!remoteId) return;
  try {
    await markReadByDedupeKey(remoteInboxDedupeKey(remoteId));
  } catch (e) {
    if (__DEV__) console.warn('[remote-inbox] local mark-read failed', e);
  }
}

/** 热点无服务端已读接口：本地 remote 源全部已读 */
export async function markAllRemoteInboxRead(_params?: {
  signal?: AbortSignal;
}): Promise<void> {
  try {
    await markAllRead({ source: 'remote' });
  } catch (e) {
    if (__DEV__) console.warn('[remote-inbox] local mark-all failed', e);
  }
}
